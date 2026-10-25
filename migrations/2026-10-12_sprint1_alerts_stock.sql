-- ============================================================
-- MIGRASI: Sprint 1 — Telegram Alerting + Minimum Stock BHP
-- Tanggal  : 12 Oktober 2026
-- Penulis  : Bamboo (Tech Lead)
-- Brief    : /home/ubuntu/bamboo_brief_sprint1.md
-- ============================================================
-- CAKUPAN:
--   1) materials.current_stock & materials.min_stock (Minimum Stock BHP)
--   2) telegram_alerts_log (anti-spam + audit alert terkirim)
--   3) private_secrets: telegram_bot_token & telegram_chat_id
--   4) Pengiriman Telegram LANGSUNG DARI DATABASE via ekstensi `http`
--      (token bot tidak pernah keluar dari DB — repo GitHub bersifat PUBLIC)
--   5) RPC:
--        telegram_send_test        — pesan uji koneksi (admin / drive token)
--        telegram_send_pr_alert    — Trigger A: PR > Rp 5 jt (angka dihitung
--                                    server-side dari pr_items — anti spoof)
--        telegram_send_cost_alerts — Trigger B: cost >= 65% + anti-spam
--        telegram_alert_status     — status konfigurasi + riwayat (admin)
--   6) receive_to_warehouse DIPERBARUI: "Ke Gudang" juga menambah
--      materials.current_stock (kolom baru; qty lama tidak berubah).
-- ============================================================
-- PRINSIP KEAMANAN:
--   * Token bot & chat id hanya hidup di private_secrets (tanpa policy client).
--     Tidak pernah ditulis di file kode / migrasi / response API.
--   * Idempotent: aman dijalankan berulang.
--   * TIDAK menyentuh tabel/trigger eksisting selain penambahan kolom aman.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0) Ekstensi http (request HTTPS dari Postgres). Schema extensions
--    = standar Supabase.
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- 1) KOLOM STOK BHP pada materials
--    current_stock = stok fisik saat ini (numeric, default 0)
--    min_stock     = batas minimum stok (numeric, default 0; 0 = nonaktif)
-- ------------------------------------------------------------
ALTER TABLE public.materials
    ADD COLUMN IF NOT EXISTS current_stock NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS min_stock NUMERIC DEFAULT 0;

-- Backfill aman: kolom qty lama (TEXT) → current_stock bila current_stock
-- masih kosong/0 sementara qty berisi ANGKA BULAT > 0 (tanpa titik/koma —
-- menghindari ambiguitas pemisah ribuan/desimal). Data qty tetap utuh.
UPDATE public.materials
SET current_stock = (NULLIF(trim(qty), ''))::numeric
WHERE (current_stock IS NULL OR current_stock = 0)
  AND qty IS NOT NULL
  AND trim(qty) ~ '^[0-9]+$'
  AND (NULLIF(trim(qty), ''))::numeric > 0;

-- ------------------------------------------------------------
-- 2) TABEL: telegram_alerts_log
--    * last_pct = persentase terakhir yang SUDAH dikirim utk proyek
--      (anti-spam cost warning: kirim ulang hanya bila naik >= 2 poin).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_alerts_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type TEXT NOT NULL,               -- 'pr_besar' | 'cost_warning'
    dedup_key TEXT NOT NULL,                -- 'pr:PR-042' | 'cost:61'
    project_no TEXT,
    last_pct NUMERIC,
    payload JSONB,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    sent_by TEXT
);

-- Satu baris per dedup_key — kunci anti-spam & anti-dobel.
CREATE UNIQUE INDEX IF NOT EXISTS telegram_alerts_log_dedup_uniq
    ON public.telegram_alerts_log(dedup_key);

CREATE INDEX IF NOT EXISTS telegram_alerts_log_type_idx
    ON public.telegram_alerts_log(alert_type, sent_at DESC);

-- RLS admin-only (pola sama dengan project_closings / project_cost_summary).
ALTER TABLE public.telegram_alerts_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_alerts_log_admin_all ON public.telegram_alerts_log;
CREATE POLICY telegram_alerts_log_admin_all ON public.telegram_alerts_log
    FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

GRANT SELECT ON public.telegram_alerts_log TO authenticated;

-- ------------------------------------------------------------
-- 3) SEED private_secrets (BARIS KOSONG — nilai token & chat id diisi
--    TERPISAH via SQL Editor / prosedur ops, TIDAK ditulis di file migrasi
--    karena repo PUBLIC).
-- ------------------------------------------------------------
INSERT INTO public.private_secrets (k, v) VALUES ('telegram_bot_token', '')
ON CONFLICT (k) DO NOTHING;

INSERT INTO public.private_secrets (k, v) VALUES ('telegram_chat_id', '')
ON CONFLICT (k) DO NOTHING;

-- ------------------------------------------------------------
-- 4) HELPER: format rupiah ala Indonesia (6.500.000) untuk isi pesan.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_telegram_rp(p NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'Rp ' || CASE
    WHEN p IS NULL THEN '0'
    ELSE translate(to_char(round(p), 'FM999,999,999,999,999,999,999'), ',', '.')
  END
$$;

REVOKE ALL ON FUNCTION public.fn_telegram_rp(NUMERIC) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4b) HELPER: kirim teks ke chat Telegram DAT (server-side, dari DB).
--     Token dibaca dari private_secrets — tidak pernah jadi parameter.
--     Return: { ok, status, error }
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_telegram_send(p_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_bot TEXT;
    v_chat TEXT;
    v_resp extensions.http_response;
    v_status INT;
    v_content TEXT;
BEGIN
    SELECT v INTO v_bot FROM public.private_secrets WHERE k = 'telegram_bot_token';
    SELECT v INTO v_chat FROM public.private_secrets WHERE k = 'telegram_chat_id';

    IF COALESCE(v_bot, '') = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'no_bot_token');
    END IF;
    IF COALESCE(v_chat, '') = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'no_chat_id');
    END IF;

    BEGIN
        v_resp := extensions.http_post(
            'https://api.telegram.org/bot' || v_bot || '/sendMessage',
            jsonb_build_object(
                'chat_id', v_chat,
                'text', p_text,
                'disable_web_page_preview', true
            )
        );
        v_status := v_resp.status;
        v_content := v_resp.content;
    EXCEPTION WHEN others THEN
        RETURN jsonb_build_object('ok', false, 'error', 'http_error: ' || SQLERRM);
    END;

    IF v_status BETWEEN 200 AND 299 AND COALESCE(v_content, '') LIKE '%"ok":true%' THEN
        RETURN jsonb_build_object('ok', true, 'status', v_status);
    END IF;

    RETURN jsonb_build_object('ok', false, 'status', v_status, 'error', left(COALESCE(v_content, ''), 300));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_telegram_send(TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4c) Guard internal: apakah caller admin? (auth.uid())
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_telegram_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT (p.role = 'admin')
    FROM public.profiles p
    WHERE p.id = auth.uid()
  ), FALSE)
$$;

REVOKE ALL ON FUNCTION public.fn_telegram_is_admin() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5a) RPC: telegram_send_test — kirim pesan uji koneksi.
--     Auth: admin (JWT) ATAU drive_sync_token (daemon/ops/CLI).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_send_test(p_token TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tok TEXT;
    v_ok BOOLEAN := FALSE;
    v_now TEXT;
    v_res JSONB;
BEGIN
    IF COALESCE(p_token, '') <> '' THEN
        SELECT v INTO v_tok FROM public.private_secrets WHERE k = 'drive_sync_token';
        v_ok := (v_tok IS NOT NULL AND p_token = v_tok);
    END IF;
    IF NOT v_ok THEN
        v_ok := public.fn_telegram_is_admin();
    END IF;
    IF NOT v_ok THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
    END IF;

    v_now := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'DD Mon YYYY, HH24:MI') || ' WIB';
    v_res := public.fn_telegram_send(
        E'✅ [TEST] Koneksi Alert Telegram Purchasing App OK\n' ||
        E'• Waktu : ' || v_now || E'\n' ||
        E'Bot notifikasi resmi terhubung. Alert PR > 5 Juta & Early Warning 65% siap dikirim ke chat ini.'
    );
    IF (v_res->>'ok')::boolean THEN
        RETURN jsonb_build_object('ok', true, 'sent', true, 'message', 'Pesan uji terkirim ke Telegram DAT.');
    END IF;
    RETURN jsonb_build_object('ok', false, 'sent', false, 'reason', 'send_failed', 'error', v_res->>'error');
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_send_test(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.telegram_send_test(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5b) RPC: telegram_send_pr_alert — Trigger A (PR > Rp 5 juta).
--     Auth: SEMUA user terautentikasi (pemohon PR boleh memicu alert;
--           payload dihitung SERVER-SIDE dari pr_items sehingga angka
--           tidak bisa dipalsukan dari browser).
--     Anti-dobel: dedup_key 'pr:<nomor>' — satu PR = maksimal satu alert.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_send_pr_alert(p_pr_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_email TEXT;
    v_pr RECORD;
    v_project_name TEXT;
    v_project_no TEXT;
    v_total NUMERIC := 0;
    v_key TEXT;
    v_claim_id UUID;
    v_msg TEXT;
    v_res JSONB;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

    SELECT id, pr_number, project_id INTO v_pr
    FROM public.purchase_requests WHERE id = p_pr_id;
    IF v_pr.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'pr_not_found');
    END IF;

    SELECT name, kode INTO v_project_name, v_project_no
    FROM public.projects WHERE id = v_pr.project_id;

    -- Estimasi total = SUM(harga × qty); fallback harga_acuan master material
    -- bila estimated_price item kosong (konsisten dgn tampilan modul PR).
    SELECT COALESCE(SUM(
             COALESCE(pi.estimated_price, m.harga_acuan, 0) * COALESCE(pi.quantity, 0)
           ), 0)
    INTO v_total
    FROM public.pr_items pi
    LEFT JOIN public.materials m ON m.id = pi.material_id
    WHERE pi.pr_id = p_pr_id;

    IF v_total <= 5000000 THEN
        RETURN jsonb_build_object('ok', true, 'sent', false, 'reason', 'below_threshold', 'total', v_total);
    END IF;

    v_key := 'pr:' || COALESCE(v_pr.pr_number, p_pr_id::text);

    -- Claim atomik (INSERT ... ON CONFLICT DO NOTHING) = anti-dobel.
    INSERT INTO public.telegram_alerts_log (alert_type, dedup_key, project_no, last_pct, payload, sent_by)
    VALUES ('pr_besar', v_key, v_project_no, v_total,
            jsonb_build_object('pr_number', v_pr.pr_number, 'total', v_total, 'requester', v_email),
            COALESCE(v_email, 'admin'))
    ON CONFLICT (dedup_key) DO NOTHING
    RETURNING id INTO v_claim_id;

    IF v_claim_id IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'sent', false, 'reason', 'already_alerted', 'total', v_total);
    END IF;

    v_msg :=
        E'🔔 [ALERT PURCHASING] Purchase Request Baru > Rp 5 Juta\n' ||
        E'• No PR      : ' || COALESCE(v_pr.pr_number, '—') || E'\n' ||
        E'• Proyek     : ' || COALESCE(v_project_name, '—') ||
            CASE WHEN COALESCE(v_project_no, '') <> '' THEN ' (' || v_project_no || ')' ELSE '' END || E'\n' ||
        E'• Total Est. : ' || public.fn_telegram_rp(v_total) || E'\n' ||
        E'• Diajukan   : ' || COALESCE(v_email, '—') || E'\n' ||
        E'Mohon tinjau di dashboard purchasing untuk approval.';

    v_res := public.fn_telegram_send(v_msg);
    IF (v_res->>'ok')::boolean THEN
        RETURN jsonb_build_object('ok', true, 'sent', true, 'total', v_total);
    END IF;

    -- Kirim gagal → batalkan claim supaya bisa dicoba lagi nanti.
    DELETE FROM public.telegram_alerts_log WHERE id = v_claim_id;
    RETURN jsonb_build_object('ok', false, 'sent', false, 'reason', 'send_failed', 'error', v_res->>'error');
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_send_pr_alert(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_send_pr_alert(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 5c) RPC: telegram_send_cost_alerts — Trigger B (cost >= 65%).
--     Auth: admin (JWT) ATAU drive_sync_token (daemon drive-sync).
--     Aturan:
--       * revenue > 0 dan cumulative_cost/revenue >= 65%
--       * status proyek on-going (ACTIVE / ON GOING / dst; NULL = aktif)
--       * anti-spam: belum pernah kirim ATAU naik >= p_min_step poin
--       * claim atomik sebelum kirim; release otomatis bila kirim gagal.
--     Return { ok, scanned, sent:[...], skipped, errors:[...] }
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_send_cost_alerts(p_token TEXT DEFAULT NULL, p_min_step NUMERIC DEFAULT 2.0)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tok TEXT;
    v_authorized BOOLEAN := FALSE;
    v_scanned INT := 0;
    v_skipped INT := 0;
    v_sent JSONB := '[]'::jsonb;
    v_errors JSONB := '[]'::jsonb;
    r RECORD;
    v_pct NUMERIC;
    v_pct_text TEXT;
    v_key TEXT;
    v_claim_id UUID;
    v_msg TEXT;
    v_res JSONB;
BEGIN
    IF COALESCE(p_token, '') <> '' THEN
        SELECT v INTO v_tok FROM public.private_secrets WHERE k = 'drive_sync_token';
        v_authorized := (v_tok IS NOT NULL AND p_token = v_tok);
    END IF;
    IF NOT v_authorized THEN
        v_authorized := public.fn_telegram_is_admin();
    END IF;
    IF NOT v_authorized THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
    END IF;

    FOR r IN
        SELECT project_no, project_name, revenue, cumulative_cost, project_status
        FROM public.project_cost_summary
        WHERE COALESCE(revenue, 0) > 0
          AND COALESCE(cumulative_cost, 0) > 0
    LOOP
        v_scanned := v_scanned + 1;

        v_pct := ROUND((r.cumulative_cost / r.revenue) * 100, 2);
        CONTINUE WHEN v_pct < 65;

        -- On-going saja: NULL/ACTIVE/ON GOING dianggap masih berjalan.
        CONTINUE WHEN r.project_status IS NOT NULL
             AND upper(r.project_status) NOT IN ('ACTIVE', 'ON GOING', 'ONGOING', 'ON_GOING', 'BERJALAN');

        v_key := 'cost:' || COALESCE(r.project_no, '');
        v_claim_id := NULL;

        -- Claim 1: belum pernah ada → insert (menang balapan = aman).
        INSERT INTO public.telegram_alerts_log (alert_type, dedup_key, project_no, last_pct, payload, sent_by)
        VALUES ('cost_warning', v_key, r.project_no, v_pct,
                jsonb_build_object('pct', v_pct, 'revenue', r.revenue, 'cumulative_cost', r.cumulative_cost),
                'telegram_send_cost_alerts')
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING id INTO v_claim_id;

        IF v_claim_id IS NULL THEN
            -- Claim 2: sudah pernah kirim → kirim ulang hanya bila naik >= p_min_step.
            -- (UPDATE kondisional = atomik; balapan dua pemanggil aman.)
            UPDATE public.telegram_alerts_log
            SET last_pct = v_pct,
                payload = jsonb_build_object('pct', v_pct, 'revenue', r.revenue,
                                             'cumulative_cost', r.cumulative_cost, 'prev_pct', last_pct),
                sent_at = now()
            WHERE dedup_key = v_key
              AND (last_pct IS NULL OR v_pct - last_pct >= p_min_step)
            RETURNING id INTO v_claim_id;
        END IF;

        IF v_claim_id IS NULL THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        v_pct_text := translate(to_char(round(v_pct, 2), 'FM999990.00'), '.', ',');
        v_msg :=
            E'⚠️ [EARLY WARNING] Biaya Proyek Mendekati Batas 70%\n' ||
            E'• Proyek     : ' || COALESCE(r.project_name, '—') ||
                CASE WHEN COALESCE(r.project_no, '') <> '' THEN ' (' || r.project_no || ')' ELSE '' END || E'\n' ||
            E'• Revenue    : ' || public.fn_telegram_rp(r.revenue) || E'\n' ||
            E'• Realisasi  : ' || public.fn_telegram_rp(r.cumulative_cost) || ' (' || v_pct_text || '%)' || E'\n' ||
            E'• Batas Max  : 70%\n' ||
            E'Peringatan: Realisasi biaya telah menyentuh batas peringatan dini (65%).';

        v_res := public.fn_telegram_send(v_msg);
        IF (v_res->>'ok')::boolean THEN
            v_sent := v_sent || jsonb_build_object(
                'project_no', r.project_no, 'project_name', r.project_name,
                'pct', v_pct, 'revenue', r.revenue, 'cumulative_cost', r.cumulative_cost);
        ELSE
            -- Kirim gagal → release claim (kembalikan last_pct sebelumnya / hapus baris baru).
            IF (SELECT payload ? 'prev_pct' FROM public.telegram_alerts_log WHERE id = v_claim_id) THEN
                UPDATE public.telegram_alerts_log
                SET last_pct = NULLIF(payload->>'prev_pct', '')::numeric,
                    payload = payload - 'prev_pct'
                WHERE id = v_claim_id;
            ELSE
                DELETE FROM public.telegram_alerts_log WHERE id = v_claim_id;
            END IF;
            v_errors := v_errors || jsonb_build_object(
                'project_no', r.project_no, 'error', v_res->>'error');
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'ok', true,
        'scanned', v_scanned,
        'sent', v_sent,
        'skipped', v_skipped,
        'errors', v_errors
    );
END;
$$;

-- Ter-gate oleh drive_sync_token (rahasia server) / admin JWT → aman dari anon.
REVOKE ALL ON FUNCTION public.telegram_send_cost_alerts(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.telegram_send_cost_alerts(TEXT, NUMERIC) TO anon, authenticated;

-- ------------------------------------------------------------
-- 5d) RPC: telegram_alert_status — status konfigurasi + riwayat (admin).
--     Untuk ops/diagnosa; token TIDAK pernah dikembalikan (hanya boolean).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telegram_alert_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bot TEXT;
    v_chat TEXT;
    v_recent JSONB;
BEGIN
    IF NOT public.fn_telegram_is_admin() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
    END IF;

    SELECT v INTO v_bot FROM public.private_secrets WHERE k = 'telegram_bot_token';
    SELECT v INTO v_chat FROM public.private_secrets WHERE k = 'telegram_chat_id';

    SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sent_at' DESC), '[]'::jsonb) INTO v_recent
    FROM (
        SELECT jsonb_build_object(
            'alert_type', alert_type, 'dedup_key', dedup_key, 'project_no', project_no,
            'last_pct', last_pct, 'sent_at', sent_at
        ) AS x
        FROM public.telegram_alerts_log
        ORDER BY sent_at DESC
        LIMIT 10
    ) t;

    RETURN jsonb_build_object(
        'ok', true,
        'configured', COALESCE(v_bot, '') <> '',
        'chat_id_masked', CASE WHEN COALESCE(v_chat, '') = '' THEN '' ELSE '***' || right(v_chat, 4) END,
        'recent', v_recent
    );
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_alert_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_alert_status() TO authenticated;

-- ------------------------------------------------------------
-- 6) receive_to_warehouse DIPERBARUI: "Ke Gudang" kini menambah
--    materials.current_stock SEBESAR kenaikan yang sama dengan qty.
--    (Logika lama tidak berubah; hanya satu assignment tambahan.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_to_warehouse(p_receiving_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eligible integer;
  affected integer;
  it record;
  prq numeric;
  added integer := 0;
  skipped integer := 0;
BEGIN
  SELECT COUNT(*) INTO eligible
  FROM public.receiving_items ri
  LEFT JOIN public.pr_items pi ON pi.id = ri.pr_item_id
  WHERE ri.receiving_id = p_receiving_id
    AND pi.material_id IS NOT NULL
    AND (COALESCE(ri.quantity_received, 0) > 0 OR COALESCE(ri.note, '') LIKE 'DITERIMA%');

  IF eligible = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'none_received', 'added', 0);
  END IF;

  UPDATE public.receivings
  SET alokasi = 'MASUK_GUDANG', masuk_gudang = true, gudang_at = now()
  WHERE id = p_receiving_id
    AND COALESCE(masuk_gudang, false) = false
    AND upper(COALESCE(status, 'NORMAL')) NOT IN ('RETUR', 'REFUND', 'RUSAK');

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already', 'added', 0);
  END IF;

  FOR it IN
    SELECT ri.quantity_received, ri.note, pi.material_id, pi.quantity AS pr_qty
    FROM public.receiving_items ri
    LEFT JOIN public.pr_items pi ON pi.id = ri.pr_item_id
    WHERE ri.receiving_id = p_receiving_id
  LOOP
    IF it.material_id IS NULL THEN skipped := skipped + 1; CONTINUE; END IF;
    IF COALESCE(it.quantity_received, 0) <= 0 AND COALESCE(it.note, '') NOT LIKE 'DITERIMA%' THEN
      skipped := skipped + 1; CONTINUE;
    END IF;

    prq := CASE WHEN COALESCE(it.quantity_received, 0) > 0 THEN it.quantity_received ELSE COALESCE(it.pr_qty, 0) END;
    IF prq IS NULL OR prq <= 0 THEN skipped := skipped + 1; CONTINUE; END IF;

    BEGIN
      UPDATE public.materials
      SET qty = ((COALESCE(NULLIF(trim(qty), ''), '0'))::numeric + prq)::text,
          current_stock = COALESCE(current_stock, 0) + prq
      WHERE id = it.material_id;
      IF FOUND THEN added := added + 1; ELSE skipped := skipped + 1; END IF;
    EXCEPTION WHEN others THEN
      skipped := skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'added', added, 'skipped', skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.receive_to_warehouse(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_to_warehouse(uuid) TO authenticated, service_role;

COMMIT;

-- ============================================================
-- ROLLBACK (bila perlu membatalkan migrasi ini):
--   DROP FUNCTION IF EXISTS public.telegram_alert_status();
--   DROP FUNCTION IF EXISTS public.telegram_send_cost_alerts(TEXT,NUMERIC);
--   DROP FUNCTION IF EXISTS public.telegram_send_pr_alert(UUID);
--   DROP FUNCTION IF EXISTS public.telegram_send_test(TEXT);
--   DROP FUNCTION IF EXISTS public.fn_telegram_is_admin();
--   DROP FUNCTION IF EXISTS public.fn_telegram_send(TEXT);
--   DROP FUNCTION IF EXISTS public.fn_telegram_rp(NUMERIC);
--   DROP TABLE IF EXISTS public.telegram_alerts_log;
--   ALTER TABLE public.materials DROP COLUMN IF EXISTS current_stock, DROP COLUMN IF EXISTS min_stock;
--   DELETE FROM public.private_secrets WHERE k IN ('telegram_bot_token','telegram_chat_id');
--   (receive_to_warehouse: kembalikan versi lama tanpa baris current_stock)
-- ============================================================
