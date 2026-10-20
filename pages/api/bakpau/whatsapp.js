// ============================================================
// pages/api/bakpau/whatsapp.js — WEBHOOK MASUK WHATSAPP (Bakpau)
// ============================================================
// Endpoint TIPIS: logika di lib/bakpau/httpHandler.js (file yang SAMA diuji
// harness). Platform DIKUNCI ke 'whatsapp' di sini.
//
// Autentikasi (salah satu, keduanya constant-time):
//   * HMAC-SHA256 atas body mentah -> header `x-bakpau-signature: sha256=<hex>`
//   * token bersama               -> header `x-bakpau-token: <secret>`
// Identitas: BAKPAU_WA_ALLOWED_JIDS (allowlist JID eksplisit, DM saja).
//
// CATATAN PENTING: route ini TIDAK membuat bridge/poller WhatsApp kedua. Ia
// hanya menerima event yang sudah diteruskan bridge resmi yang ADA
// (plugins/platforms/whatsapp). Bila bridge tidak meneruskan, endpoint ini
// tidak aktif dengan sendirinya — tidak ada koneksi WhatsApp dari sini.
//
// bodyParser DIMATIKAN supaya HMAC dihitung atas byte asli.
// ============================================================

import { createBakpauIntakeHandler } from '../../../lib/bakpau/httpHandler.js'

export const config = { api: { bodyParser: false } }

export default createBakpauIntakeHandler('whatsapp')
