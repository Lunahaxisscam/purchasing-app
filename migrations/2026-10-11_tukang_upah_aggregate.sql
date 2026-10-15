-- ============================================================
-- MIGRASI: Upah Tukang — agregat per proyek (lazy loading)
-- Tanggal  : 11 Oktober 2026
-- Penulis  : Bamboo (Tech Lead)
-- Alasan   : User melaporkan modul "terlalu berat" — UI menarik SEMUA baris
--            (794 item + 118 kasbon + 57 proyek) dalam satu kali load.
--            Solusi: (1) agregat (jumlah item + total rincian) dihitung daemon
--            dan disimpan di tukang_projects supaya UI tidak perlu menarik
--            semua item; (2) UI lazy-load per tukang / per proyek.
-- ============================================================

BEGIN;

-- 1) Kolom agregat di tukang_projects
ALTER TABLE public.tukang_projects
    ADD COLUMN IF NOT EXISTS item_count INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_rincian NUMERIC;

-- 2) RPC sync_replace_tukang_detail — versi baru (projects + item_count/total_rincian)
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
        (tukang_key, project_name, total_upah, status, batch, sort_order,
         item_count, total_rincian, synced_at)
      VALUES (
        p_tukang_key,
        COALESCE(r->>'project_name', '—'),
        NULLIF(r->>'total_upah', '')::numeric,
        NULLIF(r->>'status', ''),
        NULLIF(r->>'batch', ''),
        COALESCE(NULLIF(r->>'sort_order','')::int, 0),
        COALESCE(NULLIF(r->>'item_count','')::int, 0),
        NULLIF(r->>'total_rincian', '')::numeric,
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

-- ROLLBACK:
--   ALTER TABLE public.tukang_projects DROP COLUMN IF EXISTS item_count, DROP COLUMN IF EXISTS total_rincian;
--   (fungsi sync_replace_tukang_detail dikembalikan ke versi tanpa kolom agregat bila perlu)
