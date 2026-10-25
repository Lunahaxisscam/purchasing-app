// ============================================================
// lib/bakpau/ledger.js — LEDGER IDEMPOTENSI (SATU, DIPAKAI BERSAMA)
// ============================================================
// KENAPA ADA FILE INI, DAN KENAPA TIDAK ADA "LEDGER KEDUA":
//   Idempotensi event per kanal butuh operasi ATOMIK (insert-if-absent).
//   Skema existing TIDAK punya tabel/unique index untuk itu:
//     * probe read-only: tabel `bakpau_events` / `bakpau_idempotency` TIDAK ADA
//       (PostgREST: PGRST205 'Could not find the table').
//     * `receivings.invoice_no` TIDAK punya unique index (dicek dari migrasi
//       existing: tidak ada constraint unik pada kolom itu).
//   Artinya pola "SELECT dulu, lalu INSERT" punya WINDOW BALAPAN: dua request
//   bersamaan bisa sama-sama lolos SELECT. Guard di aplikasi TIDAK menutup itu.
//
//   Karena itu:
//     1) `createDbLedger` hanya bekerja bila tabel ledger ada DAN unique index
//        pada `dedup_key` terpasang (draft migrasi:
//        migrations/2026-10-21_bakpau_connector_ledger.sql — BELUM dijalankan).
//     2) Tanpa tabel itu, `claim()` mengembalikan ok:false
//        (reason `ledger_unavailable`) dan connector WAJIB berhenti sebelum
//        menulis pembelian (fail closed) — bukan "berharap tidak balapan".
//     3) `createMemoryLedger` hanya untuk HARNESS (fixture sintetis), tidak
//        pernah dipakai di jalur produksi; ia meniru semantik atomik supaya
//        perilaku race bisa diuji.
//
// LEDGER INI BUKAN LEDGER KEUANGAN. Ia hanya menyimpan kunci idempotensi +
// hasil pengiriman notifikasi. Tidak ada nominal, tidak ada biaya, tidak ada
// ringkasan kumulatif. Satu-satunya sumber biaya tetap tabel `receivings` /
// `receiving_items` lewat boundary purchaseSave (admin + Bakpau sama).
// ============================================================

import { REASON } from './constants.js'

export const LEDGER_TABLE = 'bakpau_events'

// Error PostgREST/Supabase yang berarti "tabel belum ada".
function isMissingTable(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  return code === 'PGRST205' || /Could not find the table|does not exist/i.test(msg)
}

function isUniqueViolation(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  return code === '23505' || /duplicate key value|unique constraint/i.test(msg)
}

// ------------------------------------------------------------
// LEDGER DB (produksi) — atomik lewat UNIQUE(dedup_key)
// ------------------------------------------------------------
export function createDbLedger({ client, table = LEDGER_TABLE } = {}) {
  if (!client || typeof client.from !== 'function') {
    return {
      kind: 'db',
      available: false,
      async claim() { return { ok: false, reason: REASON.LEDGER_UNAVAILABLE, error: 'Klien DB tidak tersedia.' } },
      async release() {},
      async record() {}
    }
  }

  let probed = null
  async function probe() {
    if (probed) return probed
    const { error } = await client.from(table).select('dedup_key').limit(1)
    if (!error) { probed = { ok: true }; return probed }
    if (isMissingTable(error)) {
      probed = {
        ok: false,
        reason: REASON.LEDGER_UNAVAILABLE,
        error: `Tabel ledger "${table}" belum ada — jalur tulis pembelian ditahan (fail closed) ` +
          'sampai migrasi ledger dijalankan integrator.'
      }
      return probed
    }
    probed = { ok: false, reason: REASON.LEDGER_UNAVAILABLE, error: `Ledger tidak bisa dibaca: ${error.message}` }
    return probed
  }

  return {
    kind: 'db',
    get available() { return !!(probed && probed.ok) },
    probe,
    // claim atomik: INSERT ... ON CONFLICT DO NOTHING semantik.
    // Supabase: insert lalu tangkap 23505. Bila 23505 -> sudah diklaim pihak lain.
    async claim(dedupKey, meta = {}) {
      const p = await probe()
      if (!p.ok) return { ok: false, reason: p.reason, error: p.error }
      const { error } = await client.from(table).insert({
        dedup_key: String(dedupKey),
        kind: String(meta.kind || 'event'),
        status: 'claimed',
        payload: meta.payload || null
      })
      if (!error) return { ok: true, claimed: true }
      if (isUniqueViolation(error)) return { ok: true, claimed: false, existing: true }
      if (isMissingTable(error)) return { ok: false, reason: REASON.LEDGER_UNAVAILABLE, error: 'Tabel ledger hilang saat claim.' }
      return { ok: false, reason: REASON.LEDGER_UNAVAILABLE, error: `Claim gagal: ${error.message}` }
    },
    async release(dedupKey) {
      try { await client.from(table).delete().eq('dedup_key', String(dedupKey)) } catch { /* dilaporkan lewat hasil kirim */ }
    },
    async record(dedupKey, result) {
      try {
        await client.from(table).update({
          status: result && result.sent ? 'sent' : 'failed',
          result: { messageId: result?.messageId || null, attempts: result?.attempts || 0 }
        }).eq('dedup_key', String(dedupKey))
      } catch { /* tidak fatal: notifikasi sudah terkirim */ }
    },
    async mark(dedupKey, status, extra = {}) {
      try {
        await client.from(table).update({ status, ...extra }).eq('dedup_key', String(dedupKey))
      } catch { /* diabaikan: status ledger bukan sumber kebenaran transaksi */ }
    }
  }
}

// ------------------------------------------------------------
// LEDGER MEMORI (HARNESS SAJA) — semantik atomik yang sama
// ------------------------------------------------------------
export function createMemoryLedger({ clock = () => Date.now() } = {}) {
  const map = new Map()
  return {
    kind: 'memory',
    available: true,
    _map: map,
    async probe() { return { ok: true } },
    async claim(dedupKey, meta = {}) {
      const k = String(dedupKey)
      if (map.has(k)) return { ok: true, claimed: false, existing: true }
      map.set(k, { dedupKey: k, kind: meta.kind || 'event', status: 'claimed', at: clock(), payload: meta.payload || null })
      return { ok: true, claimed: true }
    },
    async release(dedupKey) { map.delete(String(dedupKey)) },
    async record(dedupKey, result) {
      const cur = map.get(String(dedupKey))
      if (cur) { cur.status = result && result.sent ? 'sent' : 'failed'; cur.result = { messageId: result?.messageId || null } }
    },
    async mark(dedupKey, status, extra = {}) {
      const cur = map.get(String(dedupKey))
      if (cur) { cur.status = status; Object.assign(cur, extra) }
    },
    get(dedupKey) { return map.get(String(dedupKey)) || null },
    size() { return map.size }
  }
}

// ------------------------------------------------------------
// KLAIM GABUNGAN: event (per kanal) + bukti (lintas kanal)
// ------------------------------------------------------------
// Kunci yang dipakai:
//   event   : `evt:<channelKey>`
//   evidence: `evd:<evidenceHash>`
// Keduanya WAJIB berhasil diklaim sebelum menulis pembelian. Bila klaim
// bukti ditolak (sudah ada), konektor mengembalikan status 'duplicate' dan
// TIDAK menulis apa pun. Bila klaim event ditolak, event ini retry -> tidak
// diproses lagi (tanpa notifikasi ulang kecuali diminta).
export async function claimBoth({ ledger, channelKey, evidenceHash, meta = {} } = {}) {
  if (!ledger) return { ok: false, reason: REASON.LEDGER_UNAVAILABLE, error: 'Ledger tidak tersedia.' }
  const evtKey = `evt:${channelKey}`
  const evt = await ledger.claim(evtKey, { kind: 'event', payload: meta })
  if (!evt.ok) return { ok: false, reason: evt.reason || REASON.LEDGER_UNAVAILABLE, error: evt.error }
  if (evt.claimed === false) {
    return { ok: false, duplicateEvent: true, reason: REASON.DUPLICATE_EVENT, evtKey, error: 'Event ini sudah pernah diproses.' }
  }
  const evdKey = `evd:${evidenceHash}`
  const evd = await ledger.claim(evdKey, { kind: 'evidence', payload: meta })
  if (!evd.ok) {
    // Event sudah diklaim tetapi bukti gagal dicek -> lepaskan event supaya
    // event ini bisa dicoba lagi (bukan dianggap selesai).
    await ledger.release(evtKey)
    return { ok: false, reason: evd.reason || REASON.LEDGER_UNAVAILABLE, error: evd.error }
  }
  if (evd.claimed === false) {
    return { ok: false, duplicateEvidence: true, reason: REASON.DUPLICATE_EVIDENCE, evtKey, evdKey, error: 'Bukti ini sudah tercatat (lintas kanal).' }
  }
  return { ok: true, evtKey, evdKey }
}

// Lepaskan kedua klaim (dipakai bila penulisan pembelian GAGAL total sehingga
// event/bukti boleh dicoba lagi tanpa membuat data ganda).
export async function releaseBoth({ ledger, evtKey, evdKey } = {}) {
  if (!ledger) return
  if (evtKey) await ledger.release(evtKey)
  if (evdKey) await ledger.release(evdKey)
}
