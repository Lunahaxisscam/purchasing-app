// ============================================================
// pages/api/bakpau/v1/purchases.js — INPUT PEMBELIAN DARI BAKPAU
// ============================================================
// POST saja. Autentikasi: Authorization: Bearer bpk.<keyId>.<secret>
// Scope wajib: purchasing:create
//
// Menerima HASIL EKSTRAKSI TERSTRUKTUR (bukan gambar mentah):
//   {
//     "idempotencyKey": "<kunci stabil per dokumen>",
//     "provenance": { "sourceType": "foto_nota", "sourceRef": "<file/id>",
//                     "extractedBy": "<agen>", "extractedAt": "<ISO>" },
//     "purchase": {
//       "vendorId" | "vendorName", "date": "YYYY-MM-DD", "invoiceNo": "",
//       "projectId" | "projectRef", "biayaLain": 0, "diskon": 0,
//       "statedTotal": 0,
//       "items": [ { "itemName": "...", "qty": 1, "harga": 1000, "unit": "Pcs",
//                    "projectId" | "projectRef", "prItemId" | "prNumber",
//                    "ambiguous": false, "ambiguousFields": [] } ]
//     }
//   }
//
// Baris yang tidak yakin WAJIB ditandai `ambiguous`/`ambiguousFields` oleh
// agen -> server menolak 422, tidak mengarang qty/harga/proyek.
// Nota/pembelian BUKAN penerimaan fisik: tidak ada serah terima otomatis.
// ============================================================

import { createBakpauCreateHandler } from '../../../../lib/bakpau/apiHandler.js'

export const config = { api: { bodyParser: true } }

export default createBakpauCreateHandler()
