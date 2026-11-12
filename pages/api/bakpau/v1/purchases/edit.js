// ============================================================
// pages/api/bakpau/v1/purchases/edit.js — KOREKSI NOTA DARI BAKPAU
// ============================================================
// POST saja. Autentikasi: Authorization: Bearer bpk.<k...ret>
// Scope wajib: purchasing:edit (+ saklar BAKPAU_API_EDIT_ENABLED)
//
// Koreksi RESMI atas nota yang sudah tercatat — bukan duplikat baru.
// Satu transaksi SQL (bakpau_edit_purchase_atomic): klaim event edit,
// kunci baris nota, validasi, terapkan patch, snapshot before/after
// ke ledger bakpau_events.
//
// Body:
//   { "receivingId": "<uuid>", "reason": "koreksi tanggal nota",
//     "idempotencyKey": "edit-<ref stabil>",
//     "patch": { "date": "2026-11-09", "note": "...", "kendala": "...",
//                "invoiceNo": "...", "vendorId": "<uuid>", "projectId": "<uuid>",
//                "deliveryNote": "..." },
//     "items": [{ "itemName": "...", "qty": 2, "harga": 15000, "unit": "Lbr" }],
//     "provenance": { "sourceType": "...", "sourceRef": "...",
//                     "extractedBy": "...", "extractedAt": "..." } }
//
// Batasan (dipaksa DB):
//   * nota terhubung PR -> baris tidak boleh diganti / proyek tidak boleh
//     dipindah (409 pr_linked_items / pr_linked_header);
//   * invoiceNo tidak boleh kosong / bentrok (409 conflict_invoice);
//   * receivingId tidak dikenal -> 404 not_found;
//   * event_key deterministik: retry kunci sama -> 409 duplicate_event.
// ============================================================

import { createBakpauPurchaseEditHandler } from '../../../../../lib/bakpau/apiHandler.js'

export const config = { api: { bodyParser: true } }

export default createBakpauPurchaseEditHandler()
