-- ============================================================
-- MIGRASI: RPC status sync dengan p_id (untuk modul Upah Tukang)
-- Tanggal  : 11 Oktober 2026
-- Alasan   : sync_status_read/write lama hanya menangani id='rekap_cost';
--            modul Upah Tukang butuh baris status sendiri (id='tukang_upah')
--            agar tombol "Refresh Sekarang" berfungsi seperti modul lain.
-- Catatan  : RPC lama TIDAK diubah (kompatibel penuh dengan daemon existing).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_status_read_id(p_token text, p_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tok text;
  v_row jsonb;
BEGIN
  SELECT v INTO v_tok FROM public.private_secrets WHERE k = 'drive_sync_token';
  IF v_tok IS NULL OR p_token IS DISTINCT FROM v_tok THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;
  SELECT to_jsonb(s) INTO v_row FROM public.sync_status s WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'status', COALESCE(v_row, '{}'::jsonb));
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_status_read_id(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_status_read_id(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_status_write_id(
  p_token text, p_id text, p_status text, p_message text, p_rows integer, p_trigger text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tok text;
BEGIN
  SELECT v INTO v_tok FROM public.private_secrets WHERE k = 'drive_sync_token';
  IF v_tok IS NULL OR p_token IS DISTINCT FROM v_tok THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;
  INSERT INTO public.sync_status (id) VALUES (p_id) ON CONFLICT (id) DO NOTHING;
  UPDATE public.sync_status
     SET last_status = p_status, last_message = p_message, rows_synced = p_rows,
         last_trigger = p_trigger, last_attempt_at = now(),
         last_synced_at = CASE WHEN p_status = 'OK' THEN now() ELSE last_synced_at END
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_status_write_id(text, text, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_status_write_id(text, text, text, text, integer, text) TO anon, authenticated, service_role;

COMMIT;

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sync_status_read_id(text, text);
--   DROP FUNCTION IF EXISTS public.sync_status_write_id(text, text, text, text, integer, text);
