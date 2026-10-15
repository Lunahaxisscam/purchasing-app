-- ============================================================
-- MIGRASI: Upah Tukang — sync tahan duplikat (ON CONFLICT DO NOTHING)
-- Tanggal  : 15 Oktober 2026
-- Penulis  : Bamboo (Tech Lead)
-- Status   : SIAP — BELUM DIEKSEKUSI (menunggu audit & izin Brooklyn/DAT)
-- ============================================================
-- ALASAN (insiden produksi 11-15 Okt 2026):
--   Sync `pujon/projects` GAGAL TOTAL 4 hari berturut-turut dengan
--   DB 409 {'code': '23505', 'Key (tukang_key, project_name)=
--   (pujon, Project Steffi) already exists.'}.
--   Penyebab: tab 'List Proyek' memuat baris non-proyek ('Total project',
--   'Total kasbon', 'Berjalan', 'periode sebelumnya', 'Proyeksi',
--   'minggu ke N') DAN 5 proyek yang muncul 2x (blok utama + blok tambahan).
--   RPC sync_replace_tukang_detail memakai DELETE+INSERT loop; satu baris
--   duplikat membuat SELURUH transaksi kind 'projects' gagal, sehingga
--   hanya 1 dari 57 proyek masuk DB (data UI stale).
--
-- PERBAIKAN LAPIS 1 (sudah dikerjakan): daemon drive_sync/tukang_upah_sync.py
--   fetch_list_proyek() kini memfilter NON_PROJECT_LABELS + dedupe per nama.
--   Terverifikasi: pujon 57 proyek, tanpa duplikat, tanpa baris non-proyek.
--
-- PERBAIKAN LAPIS 2 (migrasi ini): RPC tidak lagi GAGAL bila ada duplikat —
--   baris duplikat dilewati (ON CONFLICT DO NOTHING). Sync tetap sukses dan
--   jumlah baris yang dilewati dilaporkan di respons ('skipped'). Ini
--   pertahanan agar perubahan sheet di masa depan tidak pernah membuat sync
--   gagal total lagi.
-- ============================================================

BEGIN;

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
  v_skipped integer := 0;
  v_seen text[] := '{}';
  v_name text;
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
      v_name := COALESCE(r->>'project_name', '—');
      -- Lewati duplikat DI DALAM payload (case-insensitive, whitespace dirapikan):
      -- mencegah 23505 walau sheet berisi proyek dobel.
      IF lower(btrim(v_name)) = ANY (v_seen) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      v_seen := array_append(v_seen, lower(btrim(v_name)));
      INSERT INTO public.tukang_projects
        (tukang_key, project_name, total_upah, status, batch, sort_order,
         item_count, total_rincian, synced_at)
      VALUES (
        p_tukang_key,
        v_name,
        NULLIF(r->>'total_upah', '')::numeric,
        NULLIF(r->>'status', ''),
        NULLIF(r->>'batch', ''),
        COALESCE(NULLIF(r->>'sort_order','')::int, 0),
        COALESCE(NULLIF(r->>'item_count','')::int, 0),
        NULLIF(r->>'total_rincian', '')::numeric,
        now()
      )
      ON CONFLICT (tukang_key, project_name) DO NOTHING;
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

  RETURN jsonb_build_object('ok', true, 'rows', n, 'skipped', v_skipped);
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_replace_tukang_detail(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_replace_tukang_detail(text, text, text, jsonb) TO anon, authenticated, service_role;

COMMIT;

-- CARA EKSEKUSI (setelah disetujui Brooklyn/DAT):
--   psql "$SUPABASE_DB_URL" -f migrations/2026-10-15_tukang_projects_on_conflict.sql
--   atau via Supabase SQL Editor (paste isi file).
--
-- VERIFIKASI SETELAH EKSEKUSI:
--   SELECT proname FROM pg_proc WHERE proname = 'sync_replace_tukang_detail';
--   -- lalu jalankan sync manual: python3 drive_sync/tukang_upah_sync.py --once
--   -- log harus menunjukkan: Detail: 57 proyek (pujon) tanpa "Sebagian gagal".
--
-- ROLLBACK:
--   Jalankan ulang isi migrations/2026-10-11_tukang_upah_aggregate.sql
--   (versi RPC tanpa ON CONFLICT / dedupe).
