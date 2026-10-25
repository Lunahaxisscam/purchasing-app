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
//   const cap = await getReceiptCapability()   // { ready, returnReady, ... }
//   const cap = await getReceiptCapability({ force: true })
// ============================================================
import { supabase } from '../../lib/supabaseClient'

// Kolom wajib untuk alur event penerimaan (harus sama dengan migrasi
// 02_receiving_events_physical.sql milik t_03b41644).
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
// Retur butuh DUA tabel (kasus + baris). Tanpa `return_lines`, riwayat retur
// tidak bisa dibaca → tombol Retur tidak boleh aktif (anti double-retur).
export const RETURN_LINE_COLUMNS = ['id', 'return_case_id', 'receiving_event_id', 'qty']
// View progres: nama kolom WAJIB persis (diprobe oleh form & banner).
export const PROGRESS_COLUMNS = [
  'receiving_item_id', 'qty_datang', 'qty_rusak', 'qty_baik', 'belum_diserahkan',
  'qty_bought', 'qty_arrived', 'qty_handed_over', 'tujuan_tukang'
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
  if (!supabase) return { ready: false, returnReady: false, events: false, progress: false, missing: ['Supabase tidak tersedia'], checkedAt: null }
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value
  if (inflight) return inflight

  inflight = (async () => {
    const events = await probeTable('receiving_events', EVENT_COLUMNS)
    const handoverItems = await probeTable('handover_items', HANDOVER_ITEM_COLUMNS)
    // Retur WAJIB punya return_lines: tanpa itu riwayat retur tidak terbaca dan
    // retur yang sama bisa dicatat berulang (anti double-retur).
    const returnLines = await probeTable('return_lines', RETURN_LINE_COLUMNS)
    // View progres: WAJIB untuk form READY (prevCum = qty_arrived dari view,
    // bukan quantity_received). Tanpa view, form tidak boleh jalan karena
    // akan menghitung sisa dari qty BELI (bug COMPATIBILITY_CUTOVER #1).
    const progress = await probeTable('v_receipt_progress', PROGRESS_COLUMNS)

    const missing = []
    if (!events.ok) missing.push(events.reason)
    if (!handoverItems.ok) missing.push(handoverItems.reason)
    if (!progress.ok) missing.push(progress.reason)
    if (!returnLines.ok) missing.push(`retur: ${returnLines.reason}`)

    // `ready` = ledger penerimaan + rincian serah terima + read-model progres.
    // `returnReady` = tambahan riwayat retur; tombol Retur hanya aktif bila
    // keduanya ada, karena tanpa `return_lines` retur bisa tercatat ganda.
    const coreReady = events.ok && handoverItems.ok && progress.ok
    const value = {
      ready: coreReady,
      returnReady: coreReady && returnLines.ok,
      events: events.ok,
      handoverItems: handoverItems.ok,
      returnLines: returnLines.ok,
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
  return `Penyimpanan per barang (kondisi/tujuan/retur/rincian serah terima) belum aktif: ${list || 'skema belum tersedia'}. Tidak ada data yang ditulis.`
}
