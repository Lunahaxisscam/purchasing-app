// ============================================================
// scripts/reminders/auth.js — GUARD ADMIN UNTUK ENDPOINT REMINDER
// ============================================================
// SERVER-ONLY. Lapisan reminder TIDAK menulis ulang logika verifikasi admin:
// ia memakai SATU implementasi yang sama dengan modul invoice
// (modules/sales-invoice/auth.js, diverifikasi di S4) supaya tidak ada dua
// kebenaran otorisasi yang bisa menyimpang. File ini hanya:
//
//   1) memetakan variabel lingkungan khusus reminder
//      (REMINDER_PREVIEW_TOKEN, dengan fallback SALES_INVOICE_PREVIEW_TOKEN
//      supaya satu token pratinjau lokal cukup untuk semua endpoint admin),
//   2) menerjemahkan hasilnya menjadi bentuk yang dipakai handler.
//
// Konsekuensi yang disengaja: 401 tanpa sesi, 403 non-admin, 503 fail closed
// saat otorisasi belum dikonfigurasi — sama seperti endpoint admin lain.
// ============================================================

import { AuthError, authFailure, verifyAdmin } from '../../modules/sales-invoice/auth.js'

export { AuthError, authFailure }

// envForReminders(env) -> env dengan token pratinjau yang sudah dipetakan.
export function envForReminders(env = process.env) {
  const reminderToken = String(env.REMINDER_PREVIEW_TOKEN || '').trim()
  const fallback = String(env.SALES_INVOICE_PREVIEW_TOKEN || '').trim()
  return {
    ...env,
    SALES_INVOICE_PREVIEW_TOKEN: reminderToken || fallback
  }
}

// requireAdmin(req, env) -> { ok, user, role, via } | melempar AuthError
export async function requireAdmin(req, env = process.env, deps = {}) {
  return verifyAdmin(req, envForReminders(env), deps)
}
