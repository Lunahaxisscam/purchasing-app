// ============================================================
// lib/bakpau/notify.js — ROUTING NOTIFIKASI (TELEGRAM DAT SAJA)
// ============================================================
// Izin DAT untuk fase ini: notifikasi Bakpau HANYA ke Telegram DM DAT
// (platform telegram, chat_id 1320969465, user_id 1320969465, chat_type dm).
//
// YANG DITEGAKKAN DI FILE INI (bukan di UI, bukan di env):
//   1. Tujuan notifikasi TIDAK PERNAH diambil dari input masuk. Pesan WA dari
//      nomor siapa pun tidak bisa mengubah tujuan. Tidak ada fallback.
//   2. Hanya tujuan yang lolos `NOTIFY_ALLOWLIST` (konstanta) yang dikirim.
//      WhatsApp SELALU ditolak: platform keluar yang diizinkan hanya telegram.
//   3. Setiap notifikasi punya `dedupKey` -> dikirim maksimal SEKALI per
//      (jenis status + identitas transaksi). Retry pesan TIDAK PERNAH
//      mengulang penulisan pembelian (pemisahan lapisan: lihat connector.js).
//   4. Retry terbatas (LIMITS.MAX_NOTIFY_ATTEMPTS) dengan backoff; kegagalan
//      dilaporkan apa adanya (`sent:false`), TIDAK diubah menjadi "terkirim".
//
// Status 'tercatat' TIDAK PERNAH diklaim di sini: pemanggil hanya boleh
// memakai STATUS.TERCATAT setelah commit sukses + readback exact (connector.js
// menegakkan urutan itu). Draft/test tidak boleh mengaku tersimpan.
// ============================================================

import {
  DAT_NOTIFY_TARGET, NOTIFY_ALLOWLIST, OUTBOUND_DISABLED_PLATFORMS,
  LIMITS, STATUS, ENV_KEYS, REASON
} from './constants.js'

// ------------------------------------------------------------
// 1) VALIDASI TUJUAN (fail closed)
// ------------------------------------------------------------
export function isAllowlistedTarget(target) {
  if (!target || typeof target !== 'object') return false
  const platform = String(target.platform || '').toLowerCase()
  if (OUTBOUND_DISABLED_PLATFORMS.includes(platform)) return false
  return NOTIFY_ALLOWLIST.some(t =>
    t.platform === platform &&
    String(t.chatId) === String(target.chatId) &&
    String(t.userId) === String(target.userId) &&
    String(t.chatType) === String(target.chatType)
  )
}

// Tujuan efektif: SELALU konstanta. Parameter `requested` hanya dipakai untuk
// MENDETEKSI penyimpangan (dan menolak), tidak pernah untuk mengalihkan.
export function resolveTarget(requested) {
  if (requested) {
    if (!isAllowlistedTarget(requested)) {
      return {
        ok: false,
        reason: REASON.RECIPIENT_NOT_ALLOWLISTED,
        error: `Tujuan notifikasi ${requested.platform || '?'}:${requested.chatId || '?'} tidak ada di allowlist. ` +
          'Notifikasi fase ini hanya untuk Telegram DM DAT.'
      }
    }
    if (OUTBOUND_DISABLED_PLATFORMS.includes(String(requested.platform || '').toLowerCase())) {
      return { ok: false, reason: REASON.OUTBOUND_PLATFORM_DISABLED, error: 'Notifikasi WhatsApp dimatikan pada fase ini.' }
    }
  }
  return { ok: true, target: DAT_NOTIFY_TARGET }
}

// ------------------------------------------------------------
// 2) FORMATTER RINGKAS (vendor/proyek/refnota/link/PR+sisa)
// ------------------------------------------------------------
function rp(n) {
  const v = Number(n)
  return `Rp ${new Intl.NumberFormat('id-ID').format(isFinite(v) ? Math.round(v) : 0)}`
}

const HEADLINE = {
  [STATUS.DRAFT]: '📝 [BAKPAU] Draft pembelian — BELUM tersimpan',
  [STATUS.NEED_CLARIFICATION]: '❓ [BAKPAU] Perlu klarifikasi — BELUM tersimpan',
  [STATUS.TERCATAT]: '✅ [BAKPAU] Pembelian tercatat',
  [STATUS.DUPLICATE]: '🔁 [BAKPAU] Duplikat — tidak dicatat ulang',
  [STATUS.GAGAL]: '⛔ [BAKPAU] Gagal dicatat — TIDAK tersimpan'
}

export function formatNotification({ status, header = {}, lines = [], reasons = [], link = '', extra = [] } = {}) {
  const st = String(status || '').toLowerCase()
  const out = [HEADLINE[st] || `ℹ️ [BAKPAU] Status: ${st || '(kosong)'}`]
  const vendor = header.vendorName || '—'
  const proyek = [...new Set((lines || []).map(l => l.projectLabel).filter(Boolean))]
  const proyekText = proyek.length ? proyek.join(', ') : (header.projectLabel || '—')
  out.push(`• Toko    : ${vendor}`)
  out.push(`• Proyek  : ${proyekText}`)
  out.push(`• RefNota : ${header.isInternalRef
    ? `${header.invoiceNo || '—'} (tanpa nomor vendor, ref internal)`
    : (header.invoiceNo || '—')}`)
  if (header.date) out.push(`• Tanggal : ${header.date}`)
  if (isFinite(Number(header.total)) && Number(header.total) > 0) out.push(`• Total   : ${rp(header.total)}`)
  if (lines && lines.length) out.push(`• Barang  : ${lines.length} baris`)

  // PR + sisa HANYA bila tautan benar-benar terverifikasi (bukan tebakan).
  const prLines = (lines || []).filter(l => l.prNumber && l.prVerified)
  if (prLines.length) {
    const txt = prLines.map(l => `${l.prNumber}${l.sisa !== null && l.sisa !== undefined ? ` (sisa ${l.sisa})` : ''}`)
    out.push(`• PR      : ${[...new Set(txt)].join(', ')}`)
  }

  if (link) out.push(`• Link    : ${link}`)

  const rs = (reasons || []).filter(Boolean)
  if (rs.length) {
    out.push('', 'Perlu tindakan:')
    for (const r of rs.slice(0, 6)) out.push(`- ${r.message || r.code || r}`)
    if (rs.length > 6) out.push(`- … dan ${rs.length - 6} lagi`)
  }
  for (const e of (extra || [])) if (e) out.push(String(e))

  // Pengingat eksplisit supaya tidak ada yang salah baca status.
  if (st !== STATUS.TERCATAT) {
    out.push('', st === STATUS.DUPLICATE
      ? 'Tidak ada transaksi baru yang dibuat.'
      : 'Transaksi ini BELUM tercatat di sistem purchasing.')
  }
  return out.join('\n')
}

// ------------------------------------------------------------
// 3) KIRIM dengan dedup + retry terbatas
// ------------------------------------------------------------
// transport: { send(target, text) -> { ok, messageId?, error? } }
// ledger   : { claim(dedupKey) -> { ok, claimed:boolean, existing? },
//              release(dedupKey) -> void, record(dedupKey, result) -> void }
//   Ledger disuntikkan (dependency injection) supaya tidak ada "ledger kedua":
//   implementasi DB-nya ada di ledger.js dan bisa dipakai bersama admin.
export async function sendNotification({
  status, header, lines, reasons, link, extra,
  transport, ledger, env, requestedTarget, now = Date.now, sleep = defaultSleep
} = {}) {
  // (a) Tujuan
  const t = resolveTarget(requestedTarget)
  if (!t.ok) return { ok: false, sent: false, reason: t.reason, error: t.error }

  // (b) Saklar global (hanya bisa MEMATIKAN)
  if (String((env || {})[ENV_KEYS.NOTIFY_ENABLED] ?? '1').trim() === '0') {
    return { ok: false, sent: false, reason: REASON.NOTIFY_DISABLED, error: 'Notifikasi keluar dimatikan (BAKPAU_NOTIFY_ENABLED=0).' }
  }

  // (c) Transport wajib ada — tidak ada fallback kanal lain.
  if (!transport || typeof transport.send !== 'function') {
    return { ok: false, sent: false, reason: REASON.NOTIFY_TRANSPORT_UNAVAILABLE, error: 'Transport notifikasi tidak tersedia.' }
  }

  const text = formatNotification({ status, header, lines, reasons, link, extra })

  // (d) Dedup: satu notifikasi per (status + identitas transaksi/event).
  const dedupKey = String(header?.dedupKey || `${status}:${header?.eventKey || header?.invoiceNo || 'unknown'}`)
  if (ledger && typeof ledger.claim === 'function') {
    const claim = await ledger.claim(dedupKey)
    if (claim && claim.ok === false) {
      return { ok: false, sent: false, reason: claim.reason || REASON.LEDGER_UNAVAILABLE, error: claim.error || 'Ledger notifikasi tidak tersedia.' }
    }
    if (claim && claim.claimed === false) {
      return { ok: true, sent: false, skipped: true, reason: 'duplicate_notification', dedupKey, text }
    }
  }

  // (e) Retry TERBATAS. Tidak pernah menulis ulang pembelian: modul ini tidak
  //     punya akses tulis ke tabel pembelian sama sekali.
  let lastErr = ''
  for (let attempt = 1; attempt <= LIMITS.MAX_NOTIFY_ATTEMPTS; attempt++) {
    let res
    try {
      res = await transport.send(t.target, text)
    } catch (err) {
      res = { ok: false, error: err?.message || String(err) }
    }
    if (res && res.ok) {
      const out = { ok: true, sent: true, attempts: attempt, messageId: res.messageId || null, dedupKey, text, target: t.target }
      if (ledger && typeof ledger.record === 'function') await ledger.record(dedupKey, out)
      return out
    }
    lastErr = res?.error || 'kirim gagal'
    if (attempt < LIMITS.MAX_NOTIFY_ATTEMPTS) await sleep(LIMITS.NOTIFY_BACKOFF_MS * attempt)
  }

  // Gagal kirim: klaim dedup DILEPAS supaya percobaan berikutnya boleh kirim,
  // TETAPI status transaksi TIDAK berubah (tidak ada tulis ulang pembelian).
  if (ledger && typeof ledger.release === 'function') await ledger.release(dedupKey)
  return {
    ok: false,
    sent: false,
    attempts: LIMITS.MAX_NOTIFY_ATTEMPTS,
    reason: REASON.NOTIFY_SEND_FAILED,
    error: `Notifikasi gagal dikirim setelah ${LIMITS.MAX_NOTIFY_ATTEMPTS} percobaan: ${lastErr}`,
    dedupKey,
    text
  }
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ------------------------------------------------------------
// 4) TRANSPORT: RPC DB resmi (token bot tidak pernah ke browser)
// ------------------------------------------------------------
// Primitive notifikasi resmi aplikasi ini adalah RPC Postgres
// `fn_telegram_send(text)` (SECURITY DEFINER) yang membaca token dari
// private_secrets dan memanggil api.telegram.org — lihat
// migrations/2026-10-12_sprint1_alerts_stock.sql. Token bot TIDAK PERNAH
// melewati proses Node, dan chat tujuan di DB adalah DM DAT.
//
// Transport ini memakai klien SERVICE-ROLE di server saja. Bila kredensial
// service tidak ada -> transport TIDAK dibuat (fail closed, bukan pakai anon).
export function createRpcTransport({ client, sendRpc = 'fn_telegram_send' } = {}) {
  if (!client || typeof client.rpc !== 'function') return null
  return {
    kind: 'rpc',
    async send(target, text) {
      // Pertahanan berlapis: walau DB memegang chat_id, kita menolak lebih
      // dulu bila target bukan DAT (tidak ada tujuan lain yang sah).
      if (!isAllowlistedTarget(target)) {
        return { ok: false, error: `Target ${target?.platform}:${target?.chatId} bukan allowlist.` }
      }
      const { data, error } = await client.rpc(sendRpc, { p_text: text })
      if (error) return { ok: false, error: error.message }
      const ok = !!(data && data.ok === true)
      return { ok, error: ok ? undefined : (data?.error || 'rpc menolak kirim'), raw: data }
    }
  }
}
