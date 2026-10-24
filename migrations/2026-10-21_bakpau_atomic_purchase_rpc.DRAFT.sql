-- ============================================================
-- DRAFT — SATU TRANSAKSI PEMBELIAN BAKPAU (RPC bersama)
-- ============================================================
-- STATUS: DRAFT. BELUM DIJALANKAN DI PRODUKSI OLEH LANE INI.
-- PEMILIK SKEMA: Bandeng. Pemilik apply: integrator setelah
--   backup konsisten + isolated restore + review (gate tidak berubah).
-- Diuji HANYA pada PostgreSQL 16 terisolasi (port 55434) oleh
--   scripts/bakpau-api-test/run_real_db.py.
--
-- MENGAPA FUNGSI INI ADA (review Brooklyn 2026-10-21, NEEDS_REVISION)
-- ------------------------------------------------------------------
-- Jalur tulis lama memakai BEBERAPA request HTTP terpisah:
--     claim ledger -> INSERT header -> INSERT baris (loop) -> UPDATE ledger
-- Kegagalan di tengah meninggalkan header tanpa baris, dan `releaseBoth()`
-- pada kegagalan non-partial membuka kunci sehingga retry dapat menulis nota
-- kedua di atas header yang sudah ada. Jalur admin (form) tidak memakai
-- ledger itu sama sekali, jadi idempotensi lintas kanal tidak pernah benar.
--
-- Fungsi ini menggantikan SELURUH urutan itu dengan SATU transaksi:
--   1. klaim event (evt:<channel>:<idempotency>)  -> UNIQUE(dedup_key)
--   2. klaim bukti (evd:<sha256>)                 -> UNIQUE(dedup_key)
--   3. tolak nota ganda (vendor + invoice_no yang sudah DIBELI)
--   4. INSERT header
--   5. INSERT semua baris (satu statement)
--   6. UPDATE kedua baris ledger menjadi 'recorded' + receiving_id
-- Semua atau tidak sama sekali. RAISE apa pun = rollback total, termasuk
-- klaim ledger (tidak ada kunci "bocor" yang memaksa retry gagal selamanya).
--
-- KEAMANAN
--   * SECURITY INVOKER (bukan DEFINER): tidak menambah permukaan eskalasi.
--     Yang boleh EXECUTE hanya service_role — backend. anon/authenticated
--     TIDAK diberi izin, sehingga browser tidak bisa memanggilnya.
--   * Tidak ada SQL dinamis, tidak ada nama tabel/kolom dari parameter.
--   * `p_payload` divalidasi bentuknya; nilai uang/qty tidak boleh <= 0.
--   * Harga satuan tetap disimpan di `receiving_items.note` sebagai
--     `[Harga: n]` (skema dibekukan: tidak ada kolom harga). Fungsi ini
--     MENOLAK baris tanpa penanda harga, sehingga tidak ada baris tanpa
--     harga yang bisa lolos lewat jalur ini.
--
-- KOMPATIBILITAS
--   * Tidak mengubah tabel/kolom existing. Tidak ada DROP. Tidak ada
--     penulisan ke `handovers` (nota bukan penerimaan fisik).
--   * Rollback: DROP FUNCTION saja. Tidak ada data keuangan yang hilang.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bakpau_save_purchase_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_contract      int;
    v_event_key     text;
    v_evidence_hash text;
    v_channel       text;
    v_sender        text;
    v_message       text;
    v_idem          text;
    v_prov          jsonb;
    v_header        jsonb;
    v_items         jsonb;
    v_item          jsonb;
    v_vendor_id     uuid;
    v_project_id    uuid;
    v_pr_id         uuid;
    v_invoice_no    text;
    v_received_date date;
    v_note          text;
    v_status        text;
    v_material      numeric;
    v_biaya_lain    numeric;
    v_diskon        numeric;
    v_total         numeric;
    v_is_internal   boolean;
    v_prefix        text;
    v_receiving_id  uuid;
    v_existing_id   uuid;
    v_claimed       int;
    v_line_count    int;
    v_line_no       int;
    v_sum_subtotal  numeric := 0;
    v_rows          jsonb := '[]'::jsonb;
BEGIN
    -- ---------- 0) Bentuk payload ----------
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'payload bukan objek');
    END IF;

    v_contract := COALESCE((p_payload->>'contract_version')::int, 0);
    IF v_contract <> 1 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'contract_version tidak didukung');
    END IF;

    v_event_key     := btrim(COALESCE(p_payload->>'event_key', ''));
    v_evidence_hash := lower(btrim(COALESCE(p_payload->>'evidence_hash', '')));
    v_channel       := btrim(COALESCE(p_payload->>'channel', ''));
    v_sender        := NULLIF(btrim(COALESCE(p_payload->>'sender_id', '')), '');
    v_message       := NULLIF(btrim(COALESCE(p_payload->>'message_id', '')), '');
    v_idem          := btrim(COALESCE(p_payload->>'idempotency_key', ''));
    v_prov          := COALESCE(p_payload->'provenance', '{}'::jsonb);
    v_header        := COALESCE(p_payload->'header', '{}'::jsonb);
    v_items         := COALESCE(p_payload->'items', '[]'::jsonb);

    IF v_event_key = '' OR v_channel = '' OR v_idem = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'event_key/channel/idempotency_key wajib');
    END IF;
    IF v_evidence_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'evidence_hash harus sha256 hex');
    END IF;

    IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'items wajib berisi minimal satu baris');
    END IF;
    IF jsonb_array_length(v_items) > 80 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'terlalu banyak baris');
    END IF;

    -- ---------- 1) Nilai header ----------
    BEGIN
        v_vendor_id := (v_header->>'vendor_id')::uuid;
    EXCEPTION WHEN others THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'vendor_id bukan UUID');
    END;

    BEGIN
        v_project_id := NULLIF(btrim(COALESCE(v_header->>'project_id', '')), '')::uuid;
        v_pr_id      := NULLIF(btrim(COALESCE(v_header->>'purchase_request_id', '')), '')::uuid;
    EXCEPTION WHEN others THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'project_id/purchase_request_id bukan UUID');
    END;

    BEGIN
        v_received_date := (v_header->>'received_date')::date;
    EXCEPTION WHEN others THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'received_date bukan tanggal sah');
    END;

    v_note       := COALESCE(NULLIF(btrim(COALESCE(v_header->>'note', '')), ''), '');
    v_status     := COALESCE(NULLIF(btrim(COALESCE(v_header->>'status', '')), ''), 'DIBELI');
    v_material   := COALESCE((v_header->>'material')::numeric, 0);
    v_biaya_lain := COALESCE((v_header->>'biaya_lain')::numeric, 0);
    v_diskon     := COALESCE((v_header->>'diskon')::numeric, 0);
    v_total      := COALESCE((v_header->>'total')::numeric, 0);
    v_is_internal := COALESCE((v_header->>'is_internal_ref')::boolean, false);
    v_prefix     := COALESCE(NULLIF(btrim(COALESCE(v_header->>'internal_ref_prefix', '')), ''), 'BK');

    IF v_material < 0 OR v_biaya_lain < 0 OR v_diskon < 0 OR v_total < 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'nominal tidak boleh negatif');
    END IF;

    -- ---------- 2) Validasi baris (tanpa menyentuh tabel) ----------
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
        IF jsonb_typeof(v_item) <> 'object' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                      'detail', 'baris bukan objek');
        END IF;
        IF btrim(COALESCE(v_item->>'item_name', '')) = '' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                      'detail', 'item_name wajib');
        END IF;
        IF COALESCE((v_item->>'quantity_received')::numeric, 0) <= 0 THEN
            RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                      'detail', 'qty harus > 0');
        END IF;
        -- Harga hidup di note (`[Harga: n]`, skema dibekukan). Baris tanpa
        -- penanda harga DITOLAK: jalur ini tidak boleh menyimpan harga kosong.
        IF COALESCE(v_item->>'note', '') !~ '\[Harga:\s*[0-9]' THEN
            RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                      'detail', 'baris tanpa penanda harga');
        END IF;
        v_sum_subtotal := v_sum_subtotal + COALESCE((v_item->>'subtotal')::numeric, 0);
    END LOOP;

    -- Rincian baris WAJIB menjumlah ke `material` header. Bila tidak, payload
    -- tidak konsisten (aplikasi atau pemanggil lain keliru) -> tolak, jangan
    -- simpan total yang tidak bisa dipertanggungjawabkan.
    IF round(v_sum_subtotal) <> round(v_material) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'subtotal baris tidak sama dengan material');
    END IF;
    IF round(v_material + v_biaya_lain - v_diskon) <> round(v_total) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload',
                                  'detail', 'total tidak sama dengan material+biaya-diskon');
    END IF;

    -- ---------- 3) Klaim event (atomik via UNIQUE dedup_key) ----------
    INSERT INTO public.bakpau_events (dedup_key, kind, status, payload)
    VALUES ('evt:' || v_event_key, 'event', 'claimed',
            jsonb_build_object('channel', v_channel, 'idempotency_key', v_idem,
                               'provenance', v_prov, 'sender_id', v_sender,
                               'message_id', v_message))
    ON CONFLICT (dedup_key) DO NOTHING;

    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    IF v_claimed = 0 THEN
        SELECT receiving_id INTO v_existing_id
          FROM public.bakpau_events WHERE dedup_key = 'evt:' || v_event_key;
        RETURN jsonb_build_object('ok', false, 'code', 'duplicate_event',
                                  'receiving_id', v_existing_id,
                                  'event_key', v_event_key);
    END IF;

    -- ---------- 4) Klaim bukti (lintas kanal) ----------
    INSERT INTO public.bakpau_events (dedup_key, kind, status, payload)
    VALUES ('evd:' || v_evidence_hash, 'evidence', 'claimed',
            jsonb_build_object('channel', v_channel, 'idempotency_key', v_idem))
    ON CONFLICT (dedup_key) DO NOTHING;

    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    IF v_claimed = 0 THEN
        -- Bukti sudah tercatat di kanal lain. RETURN (bukan RAISE) tetap
        -- me-rollback klaim event di atas karena transaksi tidak commit:
        -- lihat pemanggil yang memperlakukan ini sebagai penolakan.
        RAISE EXCEPTION USING
            ERRCODE = 'BK002',
            MESSAGE = 'duplicate_evidence';
    END IF;

    -- ---------- 5) Nomor nota internal bila kosong ----------
    v_invoice_no := btrim(COALESCE(v_header->>'invoice_no', ''));
    IF v_invoice_no = '' THEN
        v_is_internal := true;
        -- Referensi internal jelas berbeda dari nomor toko (prefix BK-).
        v_invoice_no := v_prefix || '-' ||
            upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12));
    END IF;

    -- ---------- 6) Tolak nota ganda (vendor + nomor nota yang sudah DIBELI) ----------
    -- Ini yang membuat idempotensi berlaku LINTAS KANAL dan juga untuk admin:
    -- penjagaan berada di dalam transaksi, bukan di aplikasi.
    SELECT id INTO v_existing_id
      FROM public.receivings
     WHERE vendor_id = v_vendor_id
       AND invoice_no = v_invoice_no
       AND (COALESCE(note, '') LIKE '%[Tahap: DIBELI]%' OR upper(COALESCE(status, '')) = 'DIBELI')
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'BK001',
            MESSAGE = 'conflict_invoice';
    END IF;

    -- ---------- 7) Header ----------
    INSERT INTO public.receivings (
        vendor_id, invoice_no, delivery_note, received_date, note, kendala,
        purchase_request_id, project_id, status, alokasi, masuk_gudang
    ) VALUES (
        v_vendor_id,
        v_invoice_no,
        CASE WHEN v_is_internal THEN 'Nota internal ' || v_invoice_no ELSE 'Nota ' || v_invoice_no END,
        v_received_date,
        v_note,
        NULL,
        v_pr_id,
        v_project_id,
        v_status,
        NULL,
        false
    ) RETURNING id INTO v_receiving_id;

    -- ---------- 8) Baris (satu statement) ----------
    INSERT INTO public.receiving_items (
        receiving_id, pr_item_id, item_name, unit, quantity_received, note
    )
    SELECT v_receiving_id,
           NULLIF(btrim(COALESCE(e->>'pr_item_id', '')), '')::uuid,
           btrim(e->>'item_name'),
           NULLIF(btrim(COALESCE(e->>'unit', '')), ''),
           (e->>'quantity_received')::numeric,
           NULLIF(btrim(COALESCE(e->>'note', '')), '')
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(e, ord)
     ORDER BY ord;

    GET DIAGNOSTICS v_line_count = ROW_COUNT;
    IF v_line_count <> jsonb_array_length(v_items) THEN
        RAISE EXCEPTION USING ERRCODE = 'BK003', MESSAGE = 'line_count_mismatch';
    END IF;

    -- ---------- 9) Tutup ledger ----------
    UPDATE public.bakpau_events
       SET status = 'recorded',
           receiving_id = v_receiving_id,
           result = jsonb_build_object('receiving_id', v_receiving_id,
                                       'invoice_no', v_invoice_no,
                                       'item_count', v_line_count,
                                       'total', v_total)
     WHERE dedup_key IN ('evt:' || v_event_key, 'evd:' || v_evidence_hash);

    -- ---------- 10) Balasan (dibaca aplikasi untuk verifikasi semantik) ----------
    SELECT jsonb_agg(jsonb_build_object(
               'line_no', t.ord,
               'item_name', t.item_name,
               'unit', t.unit,
               'quantity_received', t.quantity_received,
               'project_id', t.project_id,
               'pr_item_id', t.pr_item_id
           ) ORDER BY t.ord)
      INTO v_rows
      FROM (
        SELECT ord,
               btrim(e->>'item_name') AS item_name,
               NULLIF(btrim(COALESCE(e->>'unit', '')), '') AS unit,
               (e->>'quantity_received')::numeric AS quantity_received,
               NULLIF(btrim(COALESCE(e->>'project_id', '')), '')::uuid AS project_id,
               NULLIF(btrim(COALESCE(e->>'pr_item_id', '')), '')::uuid AS pr_item_id
          FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t2(e, ord)
      ) t;

    RETURN jsonb_build_object(
        'ok', true,
        'code', 'recorded',
        'receiving_id', v_receiving_id,
        'invoice_no', v_invoice_no,
        'is_internal_ref', v_is_internal,
        'item_count', v_line_count,
        'total', v_total,
        'material', v_material,
        'biaya_lain', v_biaya_lain,
        'diskon', v_diskon,
        'event_key', v_event_key,
        'evidence_hash', v_evidence_hash,
        'channel', v_channel,
        'items', COALESCE(v_rows, '[]'::jsonb)
    );
END;
$$;

COMMENT ON FUNCTION public.bakpau_save_purchase_atomic(jsonb) IS
  'Satu transaksi: klaim idempotensi (event+bukti) + header + baris pembelian. Fail closed; tanpa penulisan handover/PR/invoice.';

-- Hanya backend (service_role) yang boleh memanggil. anon/authenticated TIDAK.
REVOKE ALL ON FUNCTION public.bakpau_save_purchase_atomic(jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.bakpau_save_purchase_atomic(jsonb) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.bakpau_save_purchase_atomic(jsonb) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.bakpau_save_purchase_atomic(jsonb) TO service_role';
  END IF;
END $$;

COMMIT;

-- ============================================================
-- ROLLBACK (aman; tidak menyentuh data keuangan)
-- ============================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.bakpau_save_purchase_atomic(jsonb);
-- COMMIT;
-- Setelah rollback, API create otomatis kembali FAIL CLOSED
-- (503 atomic_rpc_unavailable) — bukan kembali ke tulisan multipart.
--
-- CATATAN UNTUK BANDENG / INTEGRATOR
-- ----------------------------------
-- 1) Fungsi ini HANYA menulis `receivings` + `receiving_items` +
--    `bakpau_events`. Ia TIDAK membuat `handovers`, TIDAK membuat PR,
--    TIDAK menulis invoice/payment, TIDAK mengubah stok.
-- 2) Agar idempotensi benar-benar lintas kanal, jalur ADMIN juga harus
--    memanggil fungsi ini (atau fungsi bersama turunannya) — bukan
--    `savePurchaseWithClient` multipart. Itu perubahan integrator, bukan
--    sesuatu yang diklaim selesai oleh lane API ini.
-- 3) Fungsi memakai `gen_random_bytes` (pgcrypto) hanya untuk referensi
--    internal nota tanpa nomor. Bila pgcrypto tidak tersedia, ganti dengan
--    `md5(random()::text || clock_timestamp()::text)` — tetap unik secara
--    praktis, tetap bukan nomor toko.
-- 4) Signature BERUBAH = kontrak berubah: naikkan `contract_version` di
--    aplikasi (lib/bakpau/atomicPurchase.js) dan di fungsi ini bersamaan.
-- ============================================================
