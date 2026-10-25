// ============================================================
// lib/bakpau/verify.js — GERBANG MASUK: TANDA TANGAN, IDENTITAS, FRESHNESS
// ============================================================
// Prinsip: FAIL CLOSED. Tidak ada jalur "kalau ragu, izinkan".
// Semua penolakan mengembalikan { ok:false, reason, error } dan pemanggil
// WAJIB berhenti tanpa menulis apa pun.
//
// Tiga gerbang, semuanya harus lulus:
//   1) TANDA TANGAN  — payload harus terbukti datang dari platform yang benar.
//        Telegram : header `X-Telegram-Bot-Api-Secret-Token` == secret env
//                   (perbandingan constant-time; secret TIDAK pernah dicetak).
//        WhatsApp : HMAC-SHA256(rawBody, secret) == header `x-bakpau-signature`
//                   (format `sha256=<hex>`), ATAU token bersama
//                   `x-bakpau-token` == secret untuk bridge lokal yang tidak
//                   menandatangani body. Dua-duanya constant-time.
//        Secret tidak ada di env -> endpoint MENOLAK (bukan terbuka).
//   2) IDENTITAS     — pengirim harus ada di allowlist per kanal, dan chat
//        harus DM. Grup ditolak: identitas "siapa yang memerintahkan belanja"
//        tidak bisa dipastikan dari pesan grup.
//   3) FRESHNESS     — event lebih tua dari LIMITS.MAX_EVENT_AGE_SEC ditolak
//        (replay). Jam yang terlalu jauh di depan juga ditolak.
//        Idempotensi per kanal (event key) ditangani ledger, bukan di sini.
// ============================================================

import crypto from 'node:crypto'
import { LIMITS, ENV_KEYS, REASON } from './constants.js'

// Chat type yang boleh dipakai sebagai SUMBER INPUT.
// DM saja: pesan grup tidak membuktikan siapa yang berwenang membelanjakan
// uang proyek. Bila DAT kelak ingin grup, tambahkan di sini SETELAH ada
// keputusan tertulis (bukan lewat env).
export const INTAKE_ALLOWED_CHAT_TYPES = Object.freeze(['dm'])

function fail(reason, error) {
  return { ok: false, reason, error }
}

// Perbandingan string constant-time (panjang berbeda -> tetap dibandingkan
// lewat hash supaya tidak membocorkan panjang secret).
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? ''), 'utf8').digest()
  const hb = crypto.createHash('sha256').update(String(b ?? ''), 'utf8').digest()
  return crypto.timingSafeEqual(ha, hb) && String(a ?? '').length > 0
}

export function hmacSha256Hex(secret, body) {
  return crypto.createHmac('sha256', String(secret)).update(body, 'utf8').digest('hex')
}

// Header helper: nama header tidak case-sensitive.
function header(headers, name) {
  if (!headers) return ''
  const lower = String(name).toLowerCase()
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === lower) return String(headers[k] ?? '')
  }
  return ''
}

function parseList(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

// ------------------------------------------------------------
// 1) TANDA TANGAN
// ------------------------------------------------------------
export function verifyTelegramSignature({ headers, env } = {}) {
  const secret = String((env || {})[ENV_KEYS.TG_SECRET] || '').trim()
  if (!secret) return fail(REASON.NOT_CONFIGURED, `Secret webhook Telegram belum diset (${ENV_KEYS.TG_SECRET}).`)
  const got = header(headers, 'x-telegram-bot-api-secret-token')
  if (!got || !safeEqual(got, secret)) {
    return fail(REASON.BAD_SIGNATURE, 'Secret token webhook Telegram tidak cocok.')
  }
  return { ok: true }
}

export function verifyWhatsAppSignature({ headers, rawBody, env } = {}) {
  const secret = String((env || {})[ENV_KEYS.WA_SECRET] || '').trim()
  if (!secret) return fail(REASON.NOT_CONFIGURED, `Secret webhook WhatsApp belum diset (${ENV_KEYS.WA_SECRET}).`)

  const sig = header(headers, 'x-bakpau-signature')
  if (sig) {
    const m = String(sig).match(/^sha256=([a-f0-9]{64})$/i)
    if (!m) return fail(REASON.BAD_SIGNATURE, 'Format tanda tangan WhatsApp tidak dikenali.')
    const body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? {})
    const expect = hmacSha256Hex(secret, body)
    if (!safeEqual(m[1].toLowerCase(), expect)) {
      return fail(REASON.BAD_SIGNATURE, 'HMAC body WhatsApp tidak cocok.')
    }
    return { ok: true, via: 'hmac' }
  }

  const token = header(headers, 'x-bakpau-token')
  if (token && safeEqual(token, secret)) return { ok: true, via: 'token' }

  return fail(REASON.BAD_SIGNATURE, 'Payload WhatsApp tanpa tanda tangan/token yang sah.')
}

// ------------------------------------------------------------
// 2) IDENTITAS (allowlist per kanal)
// ------------------------------------------------------------
export function identityAllowlist(platform, env) {
  const e = env || {}
  if (platform === 'telegram') return parseList(e[ENV_KEYS.TG_ALLOWLIST])
  if (platform === 'whatsapp') return parseList(e[ENV_KEYS.WA_ALLOWLIST]).map(s => s.toLowerCase())
  return []
}

export function verifyIdentity({ event, env } = {}) {
  if (!event) return fail(REASON.EMPTY_EVENT, 'Event kosong.')
  if (event.senderIsBot) return fail(REASON.BOT_SENDER, 'Pengirim adalah bot — diabaikan.')

  const allowed = identityAllowlist(event.platform, env)
  if (!allowed.length) {
    return fail(REASON.NOT_CONFIGURED,
      `Allowlist ${event.platform} kosong (${event.platform === 'telegram' ? ENV_KEYS.TG_ALLOWLIST : ENV_KEYS.WA_ALLOWLIST}). ` +
      'Tanpa allowlist eksplisit, konektor menolak semua pengirim.')
  }
  const id = String(event.userId || '').toLowerCase()
  const chatId = String(event.chatId || '').toLowerCase()
  // Cocokkan pada userId ATAU chatId: di DM keduanya sama, di kanal lain
  // chatId bisa berbeda — keduanya harus eksplisit ada di allowlist.
  if (!id || !allowed.includes(id)) {
    return fail(REASON.IDENTITY_NOT_ALLOWED, `Pengirim ${event.userId || '(kosong)'} tidak ada di allowlist ${event.platform}.`)
  }
  if (event.platform === 'whatsapp' && chatId && !allowed.includes(chatId)) {
    return fail(REASON.IDENTITY_NOT_ALLOWED, `Chat ${event.chatId} tidak ada di allowlist WhatsApp.`)
  }
  if (!INTAKE_ALLOWED_CHAT_TYPES.includes(String(event.chatType || ''))) {
    return fail(REASON.CHAT_TYPE_NOT_ALLOWED,
      `chat_type "${event.chatType}" tidak diizinkan sebagai sumber input (hanya ${INTAKE_ALLOWED_CHAT_TYPES.join('/')}).`)
  }
  return { ok: true }
}

// ------------------------------------------------------------
// 3) FRESHNESS (anti replay)
// ------------------------------------------------------------
export function verifyFreshness({ event, now = Date.now() } = {}) {
  if (!event) return fail(REASON.EMPTY_EVENT, 'Event kosong.')
  const ts = Number(event.receivedAt)
  if (!isFinite(ts) || ts <= 0) {
    return fail(REASON.STALE_EVENT, 'Event tanpa waktu kirim yang sah — tidak bisa dinilai fresh/replay.')
  }
  const nowSec = Math.floor(Number(now) / 1000)
  const age = nowSec - ts
  if (age > LIMITS.MAX_EVENT_AGE_SEC) {
    return fail(REASON.STALE_EVENT, `Event berumur ${age} detik (batas ${LIMITS.MAX_EVENT_AGE_SEC}) — ditolak sebagai replay.`)
  }
  if (age < -LIMITS.MAX_FUTURE_SKEW_SEC) {
    return fail(REASON.STALE_EVENT, `Waktu event ${-age} detik di depan jam server — ditolak.`)
  }
  return { ok: true, ageSec: age }
}

// ------------------------------------------------------------
// Gerbang lengkap (dipakai API route & harness)
// ------------------------------------------------------------
export function verifyInbound({ platform, event, headers, rawBody, env, now } = {}) {
  const sig = platform === 'telegram'
    ? verifyTelegramSignature({ headers, env })
    : platform === 'whatsapp'
      ? verifyWhatsAppSignature({ headers, rawBody, env })
      : fail(REASON.UNSUPPORTED_PLATFORM, `Platform "${platform}" tidak didukung.`)
  if (!sig.ok) return sig

  const id = verifyIdentity({ event, env })
  if (!id.ok) return id

  const fresh = verifyFreshness({ event, now })
  if (!fresh.ok) return fresh

  return { ok: true, via: sig.via || 'secret', ageSec: fresh.ageSec }
}
