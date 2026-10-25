// ============================================================
// lib/bakpau/normalize.js — NORMALISASI INPUT DUA KANAL KE SATU BENTUK
// ============================================================
// Telegram dan WhatsApp punya bentuk payload berbeda. Seluruh sistem di
// belakangnya HANYA mengenal satu bentuk kanonik:
//
//   {
//     platform : 'telegram' | 'whatsapp',
//     channelKey: 'telegram:1320969465:4412'   // kunci idempotensi per kanal
//     chatId, userId, chatType ('dm' | 'group' | …),
//     messageId, receivedAt (epoch detik),
//     text      : teks pesan (sudah dirapikan, dipotong batas aman),
//     attachments: [{ kind:'photo'|'document', ref, mime, sizeBytes }],
//     senderIsBot: bool,
//     raw       : referensi mentah (TIDAK disimpan ke DB; hanya untuk audit tes)
//   }
//
// Normalizer TIDAK memutuskan boleh/tidak (itu tugas verify.js). Ia hanya
// menerjemahkan bentuk, dan mengembalikan `error` bila payload tidak bisa
// dipahami sama sekali (mis. bukan objek / tanpa id pesan).
// ============================================================

import { LIMITS } from './constants.js'

export const CHAT_TYPE_DM = 'dm'

function toEpochSeconds(v) {
  const n = Number(v)
  if (!isFinite(n) || n <= 0) return null
  // Beberapa platform mengirim milidetik.
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n)
}

function cleanText(v) {
  let s = String(v ?? '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ')
  s = s.split('\n').map(line => line.replace(/[ \t]+/g, ' ').trimEnd()).join('\n')
  s = s.replace(/\n{3,}/g, '\n\n').trim()
  if (s.length > LIMITS.MAX_TEXT_LEN) s = `${s.slice(0, LIMITS.MAX_TEXT_LEN)}\n…[dipotong]`
  return s
}

// ------------------------------------------------------------
// TELEGRAM — Update object (getUpdates / webhook).
// ------------------------------------------------------------
export function normalizeTelegram(update) {
  if (!update || typeof update !== 'object') {
    return { ok: false, reason: 'empty_event', error: 'Payload Telegram bukan objek.' }
  }
  const msg = update.message || update.edited_message || update.channel_post || null
  if (!msg) {
    return { ok: false, reason: 'empty_event', error: 'Update Telegram tidak memuat message.' }
  }
  const chat = msg.chat || {}
  const from = msg.from || {}
  const chatId = String(chat.id ?? '').trim()
  const userId = String(from.id ?? '').trim()
  const messageId = String(msg.message_id ?? '').trim()
  if (!chatId || !messageId) {
    return { ok: false, reason: 'empty_event', error: 'Update Telegram tanpa chat.id / message_id.' }
  }
  // chat.type Telegram: 'private' | 'group' | 'supergroup' | 'channel'.
  const rawType = String(chat.type || '').toLowerCase()
  const chatType = rawType === 'private' ? CHAT_TYPE_DM : (rawType || 'unknown')

  const attachments = []
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const best = msg.photo[msg.photo.length - 1] || {}
    attachments.push({
      kind: 'photo',
      ref: String(best.file_id || ''),
      mime: 'image/jpeg',
      sizeBytes: Number(best.file_size || 0) || 0,
      fileUniqueId: String(best.file_unique_id || '')
    })
  }
  if (msg.document) {
    attachments.push({
      kind: 'document',
      ref: String(msg.document.file_id || ''),
      mime: String(msg.document.mime_type || ''),
      sizeBytes: Number(msg.document.file_size || 0) || 0,
      fileUniqueId: String(msg.document.file_unique_id || ''),
      fileName: String(msg.document.file_name || '')
    })
  }

  const text = cleanText(msg.text || msg.caption || '')
  // Waktu pesan dari platform (epoch detik). TIDAK ditebak dari jam server:
  // tanpa waktu, verify.js menolak event (tidak bisa dinilai freshness/replay).
  const receivedAt = toEpochSeconds(msg.date)

  return {
    ok: true,
    event: {
      platform: 'telegram',
      channelKey: `telegram:${chatId}:${messageId}`,
      chatId,
      userId,
      chatType,
      messageId,
      receivedAt,
      text,
      attachments,
      senderIsBot: !!from.is_bot,
      senderName: [from.first_name, from.last_name].filter(Boolean).join(' ') || String(from.username || ''),
      updateId: String(update.update_id ?? ''),
      raw: { update_id: update.update_id ?? null, message_id: msg.message_id ?? null }
    }
  }
}

// ------------------------------------------------------------
// WHATSAPP — payload dari bridge lokal (bukan API resmi cloud).
// ------------------------------------------------------------
// Bentuk yang diterima (semua opsional-ketat, divalidasi di bawah):
//   { id, from, chatId, chatType, timestamp, body|text, hasMedia, mediaType,
//     mimetype, mediaRef|mediaId, senderIsBot }
// `from` = JID pengirim (mis. '62812…@s.whatsapp.net').
export function normalizeWhatsApp(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'empty_event', error: 'Payload WhatsApp bukan objek.' }
  }
  // Bridge bisa membungkus event: { type:'message', message:{…} }
  const p = payload.message && typeof payload.message === 'object' ? payload.message : payload
  const messageId = String(p.id?._serialized || p.id || p.messageId || '').trim()
  const chatId = String(p.chatId || p.from || '').trim()
  const userId = String(p.from || p.author || '').trim()
  if (!messageId || !chatId) {
    return { ok: false, reason: 'empty_event', error: 'Payload WhatsApp tanpa id pesan / chatId.' }
  }
  const rawType = String(p.chatType || p.type || 'dm').toLowerCase()
  const chatType = (rawType === 'private' || rawType === 'chat' || rawType === 'dm') ? CHAT_TYPE_DM : rawType

  const attachments = []
  if (p.hasMedia || p.mediaRef || p.mediaId) {
    attachments.push({
      kind: String(p.mediaType || 'document').toLowerCase() === 'image' ? 'photo' : 'document',
      ref: String(p.mediaRef || p.mediaId || ''),
      mime: String(p.mimetype || ''),
      sizeBytes: Number(p.sizeBytes || 0) || 0,
      fileUniqueId: String(p.mediaRef || p.mediaId || '')
    })
  }

  return {
    ok: true,
    event: {
      platform: 'whatsapp',
      channelKey: `whatsapp:${chatId}:${messageId}`,
      chatId,
      userId,
      chatType,
      messageId,
      receivedAt: toEpochSeconds(p.timestamp || p.t),
      text: cleanText(p.body || p.text || p.caption || ''),
      attachments,
      senderIsBot: !!p.senderIsBot,
      senderName: String(p.notifyName || p.senderName || ''),
      updateId: '',
      raw: { id: messageId, chatId }
    }
  }
}

// Entry point tunggal: pilih normalizer dari platform yang DIMINTA pemanggil.
// `platform` tidak pernah diambil dari payload (payload bisa berbohong).
export function normalizeInbound(platform, payload) {
  const p = String(platform || '').toLowerCase()
  if (p === 'telegram') return normalizeTelegram(payload)
  if (p === 'whatsapp') return normalizeWhatsApp(payload)
  return { ok: false, reason: 'unsupported_platform', error: `Platform "${platform}" tidak didukung.` }
}
