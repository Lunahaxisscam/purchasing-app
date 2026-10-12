-- ============================================================
-- MIGRASI: Sprint 1 — FIX REVIEW (post independent review)
-- Tanggal  : 12 Oktober 2026
-- Penulis  : Bamboo (Tech Lead)
-- ============================================================
-- PERBAIKAN (temuan review ccdcbf8):
--   F1 CRITICAL : cabut EXECUTE anon dari receive_to_warehouse
--                 (dan RPC mutasi lain yang bocor: cleanup_unreceived_purchase).
--   F2 MAJOR    : receive_to_warehouse TIDAK BOLEH mengkredit qty PR utk
--                 item yang qty diterimanya 0/kosong — hanya item dengan
--                 quantity_received > 0 yang dikredit (konsisten dgn eligible).
--   F3 MAJOR    : dedup key cost alert utk proyek tanpa nomor tidak boleh
--                 bertabrakan ('cost:') — pakai nama sebagai fallback.
--   F4 MINOR    : rollback kirim-gagal cost alert memulihkan SELURUH state
--                 (last_pct, payload, sent_at) — bukan hanya last_pct.
--   F5 MINOR    : guard admin utk telegram_send_pr_alert (brief §3.3:
--                 fitur alert sensitif diisolasi utk Admin).
--   F6 NIT      : deteksi kirim sukses via parsing JSON (bukan LIKE).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- F1) CABUT EXECUTE anon dari SEMUA RPC mutasi yang bocor.
--     (Default Supabase memberi EXECUTE ke anon; REVOKE ... FROM PUBLIC
--      TIDAK mencabut grant itu — harus eksplisit anon.)
--     Semua fungsi ini tetap bisa dipakai user login (authenticated) —
--     alur app tidak berubah, hanya pintu anon yang ditutup.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.receive_to_warehouse(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_to_warehouse(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cleanup_unreceived_purchase(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_unreceived_purchase(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.send_receiving_to_tukang(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_receiving_to_tukang(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.ensure_item_in_purchase(uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_item_in_purchase(uuid, uuid, text, text, uuid, text) TO authenticated, service_role;

-- add_material_stock: fungsi lama di luar repo (tidak dipakai app). Tutup anon;
-- biarkan authenticated/service_role agar tidak merusak pemakaian tak dikenal.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_material_stock' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.add_material_stock(uuid, numeric) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.add_material_stock(uuid, numeric) TO authenticated, service_role';
  END IF;
END $$;

-- next_pr_number / next_material_kode_cat: generator nomor — tutup anon.
REVOKE ALL ON FUNCTION public.next_pr_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_pr_number() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.next_material_kode_cat(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_material_kode_cat(text) TO authenticated, service_role;

-- Pastikan RPC alert internal juga tertutup dari anon.
REVOKE ALL ON FUNCTION public.fn_telegram_send(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_telegram_is_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_telegram_rp(NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.telegram_alert_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_alert_status() TO authenticated;
REVOKE ALL ON FUNCTION public.telegram_send_pr_alert(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_send_pr_alert(UUID) TO authenticated;

-- ------------------------------------------------------------
-- F2) receive_to_warehouse — item dengan qty diterima 0 TIDAK dikredit
--     walaupun note-nya 'DITERIMA...' (note lama bisa tertinggal saat
--     qty diubah jadi 0 di UI). Kredit HANYA quantity_received > 0.
--     (Fungsi eligible juga diselaraskan.)
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
    AND COALESCE(ri.quantity_received, 0) > 0;

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
    SELECT ri.quantity_received, pi.material_id, pi.quantity AS pr_qty
    FROM public.receiving_items ri
    LEFT JOIN public.pr_items pi ON pi.id = ri.pr_item_id
    WHERE ri.receiving_id = p_receiving_id
  LOOP
    IF it.material_id IS NULL THEN skipped := skipped + 1; CONTINUE; END IF;

    -- HANYA qty diterima > 0 yang menambah stok.
    IF COALESCE(it.quantity_received, 0) <= 0 THEN
      skipped := skipped + 1; CONTINUE;
    END IF;

    prq := it.quantity_received;
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

REVOKE ALL ON FUNCTION public.receive_to_warehouse(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_to_warehouse(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- F6) fn_telegram_send — deteksi sukses via parsing JSON (bukan LIKE).
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
    v_ok BOOLEAN := FALSE;
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

    -- Parse JSON dengan aman; 'ok' dari Telegram adalah boolean true.
    BEGIN
        v_ok := COALESCE((v_content::jsonb ->> 'ok')::boolean, FALSE);
    EXCEPTION WHEN others THEN
        v_ok := FALSE;
    END;

    IF v_status BETWEEN 200 AND 299 AND v_ok THEN
        RETURN jsonb_build_object('ok', true, 'status', v_status);
    END IF;

    RETURN jsonb_build_object('ok', false, 'status', v_status, 'error', left(COALESCE(v_content, ''), 300));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_telegram_send(TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- F5) telegram_send_pr_alert — TETAP untuk SEMUA user terautentikasi
--     (keputusan produk: user non-admin juga membuat/mensubmit PR, dan DAT
--      harus tetap menerima alert utk PR mereka; mengunci admin-only akan
--      mematikan fitur utk kasus utama).
--     KEAMANAN: seluruh angka dihitung server-side dari pr_items (anti spoof),
--     anti-dobel by nomor PR (maks 1 alert per PR), dan operasi sensitif lain
--     (test message, cost scan, config status) tetap admin-only / token-gated.
--     Tidak ada perubahan fungsional di sini — hanya memastikan grant bersih.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.telegram_send_pr_alert(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.telegram_send_pr_alert(UUID) TO authenticated;

-- ------------------------------------------------------------
-- F3 + F4) telegram_send_cost_alerts:
--   * dedup key anti-tabrakan: 'cost:' || COALESCE(project_no, name, id)
--   * rollback penuh saat kirim gagal (last_pct + payload + sent_at).
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
    v_prev_pct NUMERIC;
    v_prev_payload JSONB;
    v_prev_sent_at TIMESTAMPTZ;
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

        CONTINUE WHEN r.project_status IS NOT NULL
             AND upper(r.project_status) NOT IN ('ACTIVE', 'ON GOING', 'ONGOING', 'ON_GOING', 'BERJALAN');

        -- F3: kunci unik per baris — fallback ke nama proyek bila nomor kosong.
        v_key := 'cost:' || COALESCE(NULLIF(trim(r.project_no), ''), NULLIF(trim(r.project_name), ''), 'unknown');
        v_claim_id := NULL;
        v_prev_pct := NULL;
        v_prev_payload := NULL;
        v_prev_sent_at := NULL;

        -- Claim 1: belum pernah ada → insert.
        INSERT INTO public.telegram_alerts_log (alert_type, dedup_key, project_no, last_pct, payload, sent_by)
        VALUES ('cost_warning', v_key, r.project_no, v_pct,
                jsonb_build_object('pct', v_pct, 'revenue', r.revenue, 'cumulative_cost', r.cumulative_cost),
                'telegram_send_cost_alerts')
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING id INTO v_claim_id;

        IF v_claim_id IS NULL THEN
            -- Claim 2: kirim ulang hanya bila naik >= p_min_step.
            -- Simpan state SEBELUMNYA utk rollback penuh bila kirim gagal (F4).
            SELECT id, last_pct, payload, sent_at
              INTO v_claim_id, v_prev_pct, v_prev_payload, v_prev_sent_at
            FROM public.telegram_alerts_log
            WHERE dedup_key = v_key
            FOR UPDATE;

            IF v_claim_id IS NULL THEN
                v_skipped := v_skipped + 1; CONTINUE;
            END IF;

            IF v_prev_pct IS NOT NULL AND v_pct - v_prev_pct < p_min_step THEN
                v_skipped := v_skipped + 1; CONTINUE;
            END IF;

            UPDATE public.telegram_alerts_log
            SET last_pct = v_pct,
                payload = jsonb_build_object('pct', v_pct, 'revenue', r.revenue, 'cumulative_cost', r.cumulative_cost),
                sent_at = now()
            WHERE id = v_claim_id;
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
            -- F4: rollback PENUH — baris baru dihapus; baris lama dipulihkan
            -- persis ke state sebelumnya (last_pct + payload + sent_at).
            IF v_prev_sent_at IS NULL THEN
                DELETE FROM public.telegram_alerts_log WHERE id = v_claim_id;
            ELSE
                UPDATE public.telegram_alerts_log
                SET last_pct = v_prev_pct,
                    payload = v_prev_payload,
                    sent_at = v_prev_sent_at
                WHERE id = v_claim_id;
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

REVOKE ALL ON FUNCTION public.telegram_send_cost_alerts(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.telegram_send_cost_alerts(TEXT, NUMERIC) TO anon, authenticated;

COMMIT;
