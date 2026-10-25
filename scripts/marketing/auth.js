// ============================================================
// scripts/marketing/auth.js — GUARD ADMIN UNTUK ENDPOINT MARKETING
// ============================================================
// SERVER-ONLY. Lapisan marketing TIDAK menulis ulang logika verifikasi admin:
// ia memakai SATU implementasi yang sama dengan modul invoice
// (modules/sales-invoice/auth.js, diverifikasi di S4) dan lapisan reminder
// (S5). Tidak ada dua kebenaran otorisasi.
//
// File ini hanya memetakan variabel lingkungan khusus marketing
// (MARKETING_PREVIEW_TOKEN, fallback SALES_INVOICE_PREVIEW_TOKEN) lalu
// menerjemahkan hasilnya ke bentuk yang dipakai handler.
//
// Konsekuensi yang disengaja: 401 tanpa sesi, 403 non-admin, 503 fail closed.
// ============================================================

import { AuthError, authFailure, verifyAdmin } from '../../modules/sales-invoice/auth.js'

export { AuthError, authFailure }

export function envForMarketing(env = process.env) {
  const own = String(env.MARKETING_PREVIEW_TOKEN || '').trim()
  const fallback = String(env.SALES_INVOICE_PREVIEW_TOKEN || '').trim()
  return {
    ...env,
    SALES_INVOICE_PREVIEW_TOKEN: own || fallback
  }
}

// requireAdmin(req, env) -> { ok, user, role, via } | melempar AuthError
export async function requireAdmin(req, env = process.env, deps = {}) {
  return verifyAdmin(req, envForMarketing(env), deps)
}
