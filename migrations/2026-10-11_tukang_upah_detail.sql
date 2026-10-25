-- ============================================================
-- MIGRASI: Upah Tukang — data per PROYEK (dari 3 tab Google Sheets)
-- Tanggal  : 11 Oktober 2026
-- Penulis  : Bamboo (Tech Lead)
-- Permintaan user: "upah tukang ambil dari google sheet per masing2 tukang
--                   per masing2 proyek" — sinkronkan tab Rincian Upah +
--                   List Proyek + Total Kasbon dari file tiap tukang
--                   (folder BAKSO - ACCOUNTING).
--
-- Tabel (semua RLS admin-only SELECT; tulis HANYA via RPC token daemon):
--   1. tukang_projects    — tab "List Proyek" (total upah per proyek + status + batch)
--   2. tukang_upah_items  — tab "Rincian Upah" (item pekerjaan per proyek)
--   3. tukang_kasbon      — tab "Total Kasbon" (riwayat kasbon)
--
-- CATATAN SATUAN: angka dibiarkan APA ADANYA seperti di sheet (belum
-- dikonversi ribuan→rupiah) — user masih verifikasi dengan tim finance.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) TABEL: tukang_projects (List Proyek per tukang)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tukang_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tukang_key TEXT NOT NULL,
    project_name TEXT NOT NULL,
    total_upah NUMERIC,
    status TEXT,
    batch TEXT,
    sort_order INT DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tukang_key, project_name)
);

CREATE INDEX IF NOT EXISTS idx_tukang_projects_key ON public.tukang_projects(tukang_key);

-- ------------------------------------------------------------
-- 2) TABEL: tukang_upah_items (Rincian Upah — item pekerjaan per proyek)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tukang_upah_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tukang_key TEXT NOT NULL,
    project_name TEXT NOT NULL,
    pekerjaan TEXT NOT NULL,
    ukuran TEXT,
    harga_satuan NUMERIC,
    upah_rincian NUMERIC,
    total_proyek NUMERIC,   -- terisi hanya pada baris subtotal ("Total Project X")
    catatan TEXT,
    sort_order INT DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tukang_upah_items_key  ON public.tukang_upah_items(tukang_key);
CREATE INDEX IF NOT EXISTS idx_tukang_upah_items_proj ON public.tukang_upah_items(tukang_key, project_name);

-- ------------------------------------------------------------
-- 3) TABEL: tukang_kasbon (Total Kasbon — riwayat kasbon)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tukang_kasbon (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tukang_key TEXT NOT NULL,
    tanggal DATE,
    jenis TEXT,
    deskripsi TEXT,
    metode TEXT,
    nominal NUMERIC,
    bukti TEXT,
    sort_order INT DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tukang_kasbon_key ON public.tukang_kasbon(tukang_key);

-- ------------------------------------------------------------
-- 4) RLS: baca admin-only; TIDAK ada policy tulis utk client
--    (daemon menulis lewat RPC SECURITY DEFINER bertoken di bawah).
-- ------------------------------------------------------------
ALTER TABLE public.tukang_projects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tukang_upah_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tukang_kasbon     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tukang_projects_admin_select ON public.tukang_projects;
CREATE POLICY tukang_projects_admin_select ON public.tukang_projects
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS tukang_upah_items_admin_select ON public.tukang_upah_items;
CREATE POLICY tukang_upah_items_admin_select ON public.tukang_upah_items
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS tukang_kasbon_admin_select ON public.tukang_kasbon;
CREATE POLICY tukang_kasbon_admin_select ON public.tukang_kasbon
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

REVOKE ALL ON public.tukang_projects   FROM anon, authenticated;
REVOKE ALL ON public.tukang_upah_items FROM anon, authenticated;
REVOKE ALL ON public.tukang_kasbon     FROM anon, authenticated;

GRANT SELECT ON public.tukang_projects   TO authenticated;
GRANT SELECT ON public.tukang_upah_items TO authenticated;
GRANT SELECT ON public.tukang_kasbon     TO authenticated;

-- ------------------------------------------------------------
-- 5) RPC: sync_replace_tukang_detail — GANTI SEMUA baris satu tukang
--    untuk satu jenis data (projects / items / kasbon). Atomic:
--    DELETE + INSERT dalam satu transaksi fungsi.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_replace_tukang_detail(
    p_token text, p_tukang_key text, p_kind text, p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tok text;
  r jsonb;
  n integer := 0;
BEGIN
  SELECT v INTO v_tok FROM public.private_secrets WHERE k = 'drive_sync_token';
  IF v_tok IS NULL OR p_token IS DISTINCT FROM v_tok THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;
  IF p_tukang_key IS NULL OR p_tukang_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_key');
  END IF;

  IF p_kind = 'projects' THEN
    DELETE FROM public.tukang_projects WHERE tukang_key = p_tukang_key;
    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
      INSERT INTO public.tukang_projects
        (tukang_key, project_name, total_upah, status, batch, sort_order, synced_at)
      VALUES (
        p_tukang_key,
        COALESCE(r->>'project_name', '—'),
        NULLIF(r->>'total_upah', '')::numeric,
        NULLIF(r->>'status', ''),
        NULLIF(r->>'batch', ''),
        COALESCE(NULLIF(r->>'sort_order','')::int, 0),
        now()
      );
      n := n + 1;
    END LOOP;
  ELSIF p_kind = 'items' THEN
    DELETE FROM public.tukang_upah_items WHERE tukang_key = p_tukang_key;
    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
      INSERT INTO public.tukang_upah_items
        (tukang_key, project_name, pekerjaan, ukuran, harga_satuan, upah_rincian, total_proyek, catatan, sort_order, synced_at)
      VALUES (
        p_tukang_key,
        COALESCE(r->>'project_name', '—'),
        COALESCE(r->>'pekerjaan', '—'),
        NULLIF(r->>'ukuran', ''),
        NULLIF(r->>'harga_satuan', '')::numeric,
        NULLIF(r->>'upah_rincian', '')::numeric,
        NULLIF(r->>'total_proyek', '')::numeric,
        NULLIF(r->>'catatan', ''),
        COALESCE(NULLIF(r->>'sort_order','')::int, 0),
        now()
      );
      n := n + 1;
    END LOOP;
  ELSIF p_kind = 'kasbon' THEN
    DELETE FROM public.tukang_kasbon WHERE tukang_key = p_tukang_key;
    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
      INSERT INTO public.tukang_kasbon
        (tukang_key, tanggal, jenis, deskripsi, metode, nominal, bukti, sort_order, synced_at)
      VALUES (
        p_tukang_key,
        NULLIF(r->>'tanggal', '')::date,
        NULLIF(r->>'jenis', ''),
        NULLIF(r->>'deskripsi', ''),
        NULLIF(r->>'metode', ''),
        NULLIF(r->>'nominal', '')::numeric,
        NULLIF(r->>'bukti', ''),
        COALESCE(NULLIF(r->>'sort_order','')::int, 0),
        now()
      );
      n := n + 1;
    END LOOP;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_kind');
  END IF;

  RETURN jsonb_build_object('ok', true, 'rows', n);
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_replace_tukang_detail(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_replace_tukang_detail(text, text, text, jsonb) TO anon, authenticated, service_role;

COMMIT;

-- ============================================================
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sync_replace_tukang_detail(text, text, text, jsonb);
--   DROP TABLE IF EXISTS public.tukang_projects;
--   DROP TABLE IF EXISTS public.tukang_upah_items;
--   DROP TABLE IF EXISTS public.tukang_kasbon;
-- ============================================================
