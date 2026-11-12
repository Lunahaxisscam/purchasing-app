-- ============================================================
-- 2026-11-12 — bakpau_edit_purchase_atomic(p_payload jsonb)
-- KOREKSI RESMI NOTA (izin DAT): satu transaksi = klaim event edit ->
-- kunci baris nota -> validasi -> terapkan patch -> snapshot before/after
-- ke ledger bakpau_events. Gagal di langkah mana pun = rollback total.
--
-- ATURAN:
--   * contract_version=1; event_key/channel/idempotency_key/reason wajib.
--   * patch whitelist: received_date, invoice_no, note, kendala,
--     delivery_note, vendor_id, project_id. Field asing ditolak.
--   * nota ber-PR: baris tidak boleh diganti; project_id tidak boleh
--     dipindah (qty barang PR hanya lewat alur PR).
--   * invoice_no tidak boleh kosong; unik per vendor di antara nota DIBELI.
--   * items (opsional) = penggantian PENUH baris; hanya untuk nota tanpa
--     pr_item_id; harga tetap di note `[Harga: n]`.
--   * search_path menyertakan 'extensions' (pgcrypto::gen_random_bytes).
--     PELAJARAN 12 Nov: search_path 'public, pg_temp' mem-bikin 42883
--     yang salah dilabeli atomic_rpc_unavailable.
-- Pemanggil: lib/bakpau/apiEdit.js (route purchases/edit, scope
-- purchasing:edit + BAKPAU_API_EDIT_ENABLED). Audit baris otomatis via
-- trg_activity_log di receivings/receiving_items.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bakpau_edit_purchase_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_contract        int;
  v_event_key       text;
  v_channel         text;
  v_idem            text;
  v_sender          text;
  v_message         text;
  v_prov            jsonb;
  v_patch           jsonb;
  v_items           jsonb;
  v_item            jsonb;
  v_reason          text;
  v_receiving_id    uuid;
  v_cur             public.receivings%ROWTYPE;
  v_claimed         int;
  v_existing        uuid;
  v_count           int;
  v_vendor_id       uuid;
  v_project_id      uuid;
  v_invoice_no      text;
  v_received_date   date;
  v_note            text;
  v_kendala         text;
  v_delivery_note   text;
  v_new_items       boolean := false;
  v_line_count      int;
  v_before          jsonb;
  v_after           jsonb;
BEGIN
  -- ---------- 0) Bentuk payload + kontrak ----------
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload', 'detail', 'payload bukan objek');
  END IF;
  v_contract := COALESCE((p_payload->>'contract_version')::int, 0);
  IF v_contract <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload', 'detail', 'contract_version tidak didukung');
  END IF;
  v_event_key := btrim(COALESCE(p_payload->>'event_key', ''));
  v_channel   := btrim(COALESCE(p_payload->>'channel', ''));
  v_idem      := btrim(COALESCE(p_payload->>'idempotency_key', ''));
  v_sender    := NULLIF(btrim(COALESCE(p_payload->>'sender_id', '')), '');
  v_message   := NULLIF(btrim(COALESCE(p_payload->>'message_id', '')), '');
  v_prov      := COALESCE(p_payload->'provenance', '{}'::jsonb);
  v_reason    := btrim(COALESCE(p_payload->>'reason', ''));
  v_patch     := COALESCE(p_payload->'patch', '{}'::jsonb);
  v_items     := p_payload->'items';

  IF v_event_key = '' OR v_channel = '' OR v_idem = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload', 'detail', 'event_key/channel/idempotency_key wajib');
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload', 'detail', 'reason wajib (3-500 karakter)');
  END IF;
  BEGIN
    v_receiving_id := (p_payload->>'receiving_id')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload', 'detail', 'receiving_id bukan UUID');
  END;
  IF jsonb_typeof(v_patch) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload', 'detail', 'patch bukan objek');
  END IF;
  IF v_items IS NOT NULL AND jsonb_typeof(v_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload', 'detail', 'items harus array');
  END IF;
  IF v_items IS NOT NULL AND jsonb_array_length(v_items) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload', 'detail', 'terlalu banyak baris');
  END IF;

  -- Field patch hanya yang dikenal.
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(v_patch) k
     WHERE k NOT IN ('received_date','invoice_no','note','kendala','delivery_note','vendor_id','project_id')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload', 'detail', 'field patch tidak dikenal');
  END IF;
  -- Minimal satu perubahan.
  IF v_items IS NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(v_patch) k
     WHERE k IN ('received_date','invoice_no','note','kendala','delivery_note','vendor_id','project_id')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload', 'detail', 'tidak ada perubahan');
  END IF;

  -- ---------- 1) Kunci transaksi bersama + baris nota ----------
  PERFORM pg_advisory_xact_lock(1102026110);
  SELECT * INTO v_cur FROM public.receivings WHERE id = v_receiving_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'detail', 'nota tidak ditemukan');
  END IF;

  -- ---------- 2) Klaim event edit (atomik via UNIQUE dedup_key) ----------
  INSERT INTO public.bakpau_events (dedup_key, kind, status, payload)
  VALUES ('evt:' || v_event_key, 'event', 'claimed',
          jsonb_build_object('channel', v_channel,
                             'idempotency_key', v_idem,
                             'provenance', v_prov,
                             'sender_id', v_sender,
                             'message_id', v_message,
                             'edit_of', v_receiving_id,
                             'reason', v_reason))
  ON CONFLICT (dedup_key) DO NOTHING;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    SELECT receiving_id INTO v_existing FROM public.bakpau_events WHERE dedup_key = 'evt:' || v_event_key;
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate_event', 'receiving_id', v_existing, 'event_key', v_event_key);
  END IF;

  -- ---------- 3) Nota ber-PR: baris tidak boleh diganti ----------
  IF v_items IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM public.receiving_items
     WHERE receiving_id = v_receiving_id AND pr_item_id IS NOT NULL;
    IF v_count > 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'pr_linked_items',
        'detail', 'nota punya baris terhubung PR — baris hanya boleh dikoreksi lewat alur PR');
    END IF;
  END IF;

  -- ---------- 4) Validasi nilai patch (belum menulis) ----------
  IF v_patch ? 'received_date' THEN
    BEGIN
      v_received_date := (v_patch->>'received_date')::date;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_patch', 'detail', 'received_date bukan tanggal sah');
    END;
  END IF;
  IF v_patch ? 'note'          THEN v_note          := COALESCE(v_patch->>'note', '');          END IF;
  IF v_patch ? 'kendala'       THEN v_kendala       := COALESCE(v_patch->>'kendala', '');       END IF;
  IF v_patch ? 'delivery_note' THEN v_delivery_note := COALESCE(v_patch->>'delivery_note', ''); END IF;
  IF v_patch ? 'vendor_id' THEN
    BEGIN
      v_vendor_id := (v_patch->>'vendor_id')::uuid;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_patch', 'detail', 'vendor_id bukan UUID');
    END;
    IF NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = v_vendor_id) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'vendor_unknown', 'detail', 'vendor tidak ditemukan');
    END IF;
  END IF;
  IF v_patch ? 'project_id' THEN
    IF v_cur.purchase_request_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'pr_linked_header',
        'detail', 'nota terhubung PR — proyek tidak boleh dipindah lewat API');
    END IF;
    BEGIN
      v_project_id := NULLIF(btrim(COALESCE(v_patch->>'project_id', '')), '')::uuid;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_patch', 'detail', 'project_id bukan UUID');
    END;
    IF v_project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'project_unknown', 'detail', 'proyek tidak ditemukan');
    END IF;
  END IF;
  IF v_patch ? 'invoice_no' THEN
    v_invoice_no := btrim(COALESCE(v_patch->>'invoice_no', ''));
    IF v_invoice_no = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_patch', 'detail', 'invoice_no tidak boleh kosong (identitas nota)');
    END IF;
    SELECT count(*) INTO v_count
      FROM public.receivings
     WHERE vendor_id = COALESCE(v_vendor_id, v_cur.vendor_id)
       AND invoice_no = v_invoice_no
       AND id <> v_receiving_id
       AND (COALESCE(note, '') LIKE '%[Tahap: DIBELI]%' OR upper(COALESCE(status, '')) = 'DIBELI');
    IF v_count > 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'conflict_invoice', 'detail', 'nomor nota sudah dipakai nota lain untuk vendor ini');
    END IF;
  END IF;

  -- ---------- 5) Validasi items pengganti ----------
  IF v_items IS NOT NULL THEN
    IF jsonb_array_length(v_items) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_patch', 'detail', 'items tidak boleh kosong');
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      IF jsonb_typeof(v_item) <> 'object' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_patch', 'detail', 'baris bukan objek');
      END IF;
      IF btrim(COALESCE(v_item->>'item_name', '')) = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_patch', 'detail', 'item_name wajib');
      END IF;
      IF COALESCE((v_item->>'quantity_received')::numeric, 0) <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_patch', 'detail', 'qty harus > 0');
      END IF;
      -- Harga hidup di note (`[Harga: n]`, skema dibekukan) — disusun oleh
      -- buildItemPriceNote() di aplikasi; SQL hanya menuntut penandanya ada.
      IF COALESCE(v_item->>'note', '') !~ '\[Harga:\s*[0-9]' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_patch', 'detail', 'baris tanpa penanda harga');
      END IF;
    END LOOP;
    v_new_items := true;
  END IF;

  -- ---------- 6) Snapshot BEFORE ----------
  SELECT jsonb_build_object(
    'invoice_no', v_cur.invoice_no,
    'received_date', v_cur.received_date,
    'note', v_cur.note,
    'kendala', v_cur.kendala,
    'delivery_note', v_cur.delivery_note,
    'vendor_id', v_cur.vendor_id,
    'project_id', v_cur.project_id,
    'purchase_request_id', v_cur.purchase_request_id,
    'status', v_cur.status,
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'item_name', i.item_name, 'unit', i.unit,
               'quantity_received', i.quantity_received, 'note', i.note
             ) ORDER BY i.created_at, i.id), '[]'::jsonb)
        FROM public.receiving_items i
       WHERE i.receiving_id = v_receiving_id
    )
  ) INTO v_before;

  -- ---------- 7) Terapkan patch (kolom tak dipatch tetap) ----------
  UPDATE public.receivings SET
    received_date = COALESCE(v_received_date, received_date),
    note          = COALESCE(v_note, note),
    kendala       = COALESCE(v_kendala, kendala),
    delivery_note = COALESCE(v_delivery_note, delivery_note),
    vendor_id     = COALESCE(v_vendor_id, vendor_id),
    project_id    = COALESCE(v_project_id, project_id),
    invoice_no    = COALESCE(v_invoice_no, invoice_no)
  WHERE id = v_receiving_id;

  -- ---------- 8) Ganti baris bila diminta ----------
  IF v_new_items THEN
    DELETE FROM public.receiving_items WHERE receiving_id = v_receiving_id;
    INSERT INTO public.receiving_items (receiving_id, pr_item_id, item_name, unit, quantity_received, note)
    SELECT v_receiving_id,
           NULL,
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
  ELSE
    SELECT count(*) INTO v_line_count FROM public.receiving_items WHERE receiving_id = v_receiving_id;
  END IF;

  -- ---------- 9) Snapshot AFTER ----------
  SELECT jsonb_build_object(
    'invoice_no', r.invoice_no,
    'received_date', r.received_date,
    'note', r.note,
    'kendala', r.kendala,
    'delivery_note', r.delivery_note,
    'vendor_id', r.vendor_id,
    'project_id', r.project_id,
    'purchase_request_id', r.purchase_request_id,
    'status', r.status,
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'item_name', i.item_name, 'unit', i.unit,
               'quantity_received', i.quantity_received, 'note', i.note
             ) ORDER BY i.created_at, i.id), '[]'::jsonb)
        FROM public.receiving_items i
       WHERE i.receiving_id = v_receiving_id
    )
  ) INTO v_after
    FROM public.receivings r
   WHERE r.id = v_receiving_id;

  -- ---------- 10) Tutup ledger ----------
  UPDATE public.bakpau_events
     SET status = 'recorded',
         receiving_id = v_receiving_id,
         result = jsonb_build_object('receiving_id', v_receiving_id,
                                     'reason', v_reason,
                                     'patch', v_patch,
                                     'items_replaced', v_new_items,
                                     'item_count', v_line_count,
                                     'before', v_before,
                                     'after', v_after)
   WHERE dedup_key = 'evt:' || v_event_key;

  -- ---------- 11) Balasan ----------
  RETURN jsonb_build_object(
    'ok', true,
    'code', 'edited',
    'receiving_id', v_receiving_id,
    'event_key', v_event_key,
    'channel', v_channel,
    'items_replaced', v_new_items,
    'item_count', v_line_count,
    'before', v_before,
    'after', v_after
  );
END;
$function$;
