// ============================================================
// pages/api/bakpau/v1/vendors.js — TAMBAH VENDOR DARI BAKPAU
// ============================================================
// POST saja. Autentikasi: Authorization: Bearer bpk.<k...ret>
// Scope wajib: purchasing:vendors:write (+ saklar BAKPAU_API_VENDORS_ENABLED)
//
// Body:
//   { "name": "Toko Jaya Plywood", "phone": "0812...", "storeLink": "",
//     "supplierCategory": "Plywood & Board, HPL & Edging", "contact": "Pak Jaya" }
//
// Duplikat nama (case-insensitive) -> 409 duplicate_vendor.
// Sukses -> 201 { ok, code: "vendor_recorded", data: { vendorId, name } }
// ============================================================

import { createBakpauVendorHandler } from '../../../../lib/bakpau/apiHandler.js'

export const config = { api: { bodyParser: true } }

export default createBakpauVendorHandler()
