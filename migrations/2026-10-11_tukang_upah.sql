-- ============================================================
-- MIGRASI: Modul Upah Tukang — mirror Dashboard per tukang
-- Tanggal  : 11 Oktober 2026
-- Penulis  : Bamboo (Tech Lead)
-- Sumber   : Google Sheets folder "BAKSO - ACCOUNTING"
--            (file per tukang: Asep_Simple_Upah_Kasbon,
--             Pujon_Simple_Upah_Kasbon — tab 'Dashboard')
-- Tabel    : tukang_dashboards (baca: admin-only; tulis: hanya RPC token daemon)
-- PRINSIP  : idempotent; tidak menyentuh tabel/trigger eksisting.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) TABEL: tukang_dashboards (snapshot dashboard per tukang)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tukang_dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tukang_key TEXT UNIQUE NOT NULL,          -- kunci stabil (mis. 'asep', 'pujon')
    tukang_name TEXT,                          -- dari baris "Nama Tukang / Subkon: ..."
    unit_bisnis TEXT,
    total_hak_upah NUMERIC,                    -- null bila sel '-' di sheet
    total_kasbon NUMERIC,
    total_pelunasan NUMERIC,
    saldo_berjalan NUMERIC,
    batches JSONB DEFAULT '[]'::jsonb,         -- daftar batch cut-off (baris tabel)
    total_row JSONB,                           -- baris "TOTAL KESELURUHAN BATCH"
    source_sheet_id TEXT,                      -- spreadsheet id Google
    source_url TEXT,                           -- link buka sheet
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2) RLS: baca admin-only; TIDAK ada policy tulis utk client
--    (daemon menulis lewat RPC SECURITY DEFINER bertoken).
-- ------------------------------------------------------------
ALTER TABLE public.tukang_dashboards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tukang_dashboards_admin_select ON public.tukang_dashboards;
CREATE POLICY tukang_dashboards_admin_select ON public.tukang_dashboards
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

REVOKE ALL ON public.tukang_dashboards FROM anon, authenticated;
GRANT SELECT ON public.tukang_dashboards TO authenticated;

-- ------------------------------------------------------------
-- 3) RPC: sync_write_tukang_dashboards — token-gated (token daemon sama
--    dengan drive_sync_token; upsert by tukang_key).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_write_tukang_dashboards(p_token text, p_rows jsonb)
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

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.tukang_dashboards (
      tukang_key, tukang_name, unit_bisnis,
      total_hak_upah, total_kasbon, total_pelunasan, saldo_berjalan,
      batches, total_row, source_sheet_id, source_url, synced_at
    ) VALUES (
      r->>'tukang_key', r->>'tukang_name', r->>'unit_bisnis',
      NULLIF(r->>'total_hak_upah','')::numeric,
      NULLIF(r->>'total_kasbon','')::numeric,
      NULLIF(r->>'total_pelunasan','')::numeric,
      NULLIF(r->>'saldo_berjalan','')::numeric,
      COALESCE(r->'batches', '[]'::jsonb),
      r->'total_row',
      r->>'source_sheet_id', r->>'source_url', now()
    )
    ON CONFLICT (tukang_key) DO UPDATE SET
      tukang_name = EXCLUDED.tukang_name,
      unit_bisnis = EXCLUDED.unit_bisnis,
      total_hak_upah = EXCLUDED.total_hak_upah,
      total_kasbon = EXCLUDED.total_kasbon,
      total_pelunasan = EXCLUDED.total_pelunasan,
      saldo_berjalan = EXCLUDED.saldo_berjalan,
      batches = EXCLUDED.batches,
      total_row = EXCLUDED.total_row,
      source_sheet_id = EXCLUDED.source_sheet_id,
      source_url = EXCLUDED.source_url,
      synced_at = now();
    n := n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'rows', n);
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_write_tukang_dashboards(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_write_tukang_dashboards(text, jsonb) TO anon, authenticated, service_role;

COMMIT;

-- ============================================================
-- ROLLBACK (bila perlu):
--   DROP FUNCTION IF EXISTS public.sync_write_tukang_dashboards(text, jsonb);
--   DROP TABLE IF EXISTS public.tukang_dashboards;
-- ============================================================
