// ============================================================
// pages/api/bakpau/v1/read.js — BACA DATA PURCHASING UNTUK AGEN BAKPAU
// ============================================================
// POST saja. Autentikasi: Authorization: Bearer bpk.<keyId>.<secret>
// Scope wajib: purchasing:read
//
// Body:
//   { "resource": "masters/projects" | "masters/materials" | "masters/vendors"
//                 | "purchase-requests" | "purchase-request-items"
//                 | "purchases" | "purchase-items" | "physical-status",
//     "query": { "limit": 50, "offset": 0, "order": "kode.asc", "<filter>": "..." } }
//
// Resource/kolom/filter adalah DAFTAR PUTIH di lib/bakpau/apiRead.js — tidak
// ada SQL, tidak ada nama tabel bebas, tidak ada wildcard LIKE.
// ============================================================

import { createBakpauReadHandler } from '../../../../lib/bakpau/apiHandler.js'

export const config = { api: { bodyParser: true } }

export default createBakpauReadHandler()
