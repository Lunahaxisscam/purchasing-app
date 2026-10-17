// ============================================================
// modules/receivings/receiptCapability.js — probe kemampuan skema (READ-ONLY)
// ============================================================
// Tujuan: aplikasi TIDAK BOLEH mengklaim "tersimpan" untuk dimensi
// (rusak / tujuan per barang / retur / rincian handover) yang belum punya
// tabel di database. Kontrak lengkap: docs/receiving-events-contract.md.
//
// Probe hanya MELAKUKAN SELECT (limit 1). Tidak ada tulisan, tidak ada DDL.
// Status disimpan di memori modul dengan TTL supaya tidak query tiap render,
// dan bisa dipaksa refresh setelah migrasi dijalankan schema owner.
//
// Pemakaian:
//   const cap = await getReceiptCapability()   // { ready, events, progress, missing }
//   const cap = await getReceiptCapability({ force: true })
// ============================================================
import { supabase } from '../../lib/supabaseClient'

// Kolom wajib untuk alur event penerimaan (harus sama dengan kontrak §1.1).
export const EVENT_COLUMNS = [
  'id', 'client_event_id', 'receiving_id', 'receiving_item_id', 'pr_item_id',
  'item_name', 'unit', 'qty_datang', 'qty_rusak', 'tujuan_ws', 'tujuan_tukang',
  'penerima_tukang', 'retur_status', 'retur_qty', 'discard_confirmed',
  'foto_ref', 'source', 'created_at'
]
export const HANDOVER_ITEM_COLUMNS = [
  'id', 'handover_id', 'receiving_event_id', 'receiving_item_id', 'pr_item_id',
  'item_name', 'qty_diserahkan', 'satuan', 'penerima', 'catatan', 'created_at'
]

const TTL_MS = 60 * 1000
let cache = null          // { at, value }
let inflight = null

function isMissingTable(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  // PostgREST: PGRST205 = tabel tidak ada di schema cache, 42P01 = undefined_table
  return code === 'PGRST205' || code === '42P01' || /Could not find the table/i.test(msg)
    || /does not exist/i.test(msg)
}

async function probeTable(table, columns) {
  try {
    const { error } = await supabase.from(table).select(columns.join(',')).limit(1)
    if (!error) return { ok: true }
    if (isMissingTable(error)) return { ok: false, reason: `tabel ${table} belum ada` }
    // Kolom hilang (PGRST204 / 42703) → tabel ada tapi versi skema berbeda.
    const code = String(error.code || '')
    if (code === 'PGRST204' || code === '42703' || /column .* does not exist/i.test(error.message || '')) {
      return { ok: false, reason: `kolom ${table} belum lengkap` }
    }
    // Error lain (mis. RLS) → anggap belum siap, jangan menebak.
    return { ok: false, reason: `${table}: ${error.message || 'tidak bisa dibaca'}` }
  } catch (err) {
    return { ok: false, reason: `${table}: ${err.message}` }
  }
}

// Probe utama. Selalu resolve (tidak pernah throw) supaya UI bisa jatuh ke
// mode legacy dengan pesan jujur.
export async function getReceiptCapability({ force = false } = {}) {
  if (!supabase) return { ready: false, events: false, progress: false, missing: ['Supabase tidak tersedia'], checkedAt: null }
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value
  if (inflight) return inflight

  inflight = (async () => {
    const events = await probeTable('receiving_events', EVENT_COLUMNS)
    const handoverItems = await probeTable('handover_items', HANDOVER_ITEM_COLUMNS)
    // View progres opsional — bila belum ada, UI menghitung dari event.
    const progress = await probeTable('v_receipt_progress', ['receiving_item_id', 'qty_datang', 'qty_rusak', 'qty_baik', 'tujuan_ws', 'tujuan_tukang', 'belum_diserahkan'])

    const missing = []
    if (!events.ok) missing.push(events.reason)
    if (!handoverItems.ok) missing.push(handoverItems.reason)
    if (!progress.ok) missing.push(`(opsional) ${progress.reason}`)

    const value = {
      ready: events.ok && handoverItems.ok,
      events: events.ok,
      handoverItems: handoverItems.ok,
      progress: progress.ok,
      missing,
      checkedAt: new Date().toISOString()
    }
    cache = { at: Date.now(), value }
    return value
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

// Dipakai test & setelah migrasi: lupakan hasil probe sebelumnya.
export function resetReceiptCapability() {
  cache = null
  inflight = null
}

// Pesan jujur standar (dipakai UI & form) — tidak pernah mengklaim tersimpan.
export function capabilityMessage(cap) {
  if (cap?.ready) return ''
  const list = (cap?.missing || []).filter(Boolean).join('; ')
  return `Penyimpanan per barang (kondisi/tujuan/retur/rincian serah terima) belum aktif: ${list || 'skema belum tersedia'}. Tidak ada data yang ditulis. Menunggu migrasi aditif task t_03b41644.`
}
