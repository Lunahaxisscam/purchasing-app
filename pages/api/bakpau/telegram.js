// ============================================================
// pages/api/bakpau/telegram.js — WEBHOOK MASUK TELEGRAM (Bakpau)
// ============================================================
// Endpoint TIPIS: seluruh logika ada di lib/bakpau/httpHandler.js supaya
// harness menguji file yang SAMA PERSIS dengan yang dipakai Next.
//
// Platform DIKUNCI ke 'telegram' di sini (tidak dari query/body).
// Autentikasi: header X-Telegram-Bot-Api-Secret-Token == BAKPAU_TELEGRAM_WEBHOOK_SECRET.
// Identitas : BAKPAU_TELEGRAM_ALLOWED_USER_IDS (allowlist eksplisit).
//
// POST saja. Tanpa secret/allowlist -> 503/401 (fail closed), bukan terbuka.
// ============================================================

import { createBakpauIntakeHandler } from '../../../lib/bakpau/httpHandler.js'

export const config = { api: { bodyParser: true } }

export default createBakpauIntakeHandler('telegram')
