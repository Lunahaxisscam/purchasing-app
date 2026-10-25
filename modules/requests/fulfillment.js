// ============================================================
// modules/requests/fulfillment.js — KONTRAK PEMENUHAN REQUEST (jalur lean)
// ============================================================
// Brief Tahap A poin 5:
//   "Pemenuhan request dihitung dari realisasi yang valid; jangan menandai
//    selesai hanya karena request dikirim. Sisa kebutuhan terbuka, bisa
//    ditutup admin dengan alasan singkat tanpa mengubah qty permintaan asli.
//    Kontrak pemenuhan dengan task B harus didokumentasikan."
//
// FILE INI ADALAH KONTRAK ITU (dipakai UI Request DAN task B / Bamboo
// t_aead7c06). Semua fungsi MURNI: tidak ada query, tidak ada tulis DB.
//
// SUMBER REALISASI (skema existing, tanpa kolom baru):
//   receiving_items.quantity_received  = qty yang BENAR-BENAR dibeli/diterima
//   receiving_items.pr_item_id         = tautan ke baris pr_items (FK, bukan
//                                        pencocokan nama)
//   receivings.status / [Tahap: DIBELI] = nota benar-benar sudah dibeli
//                                        (lib/purchaseNote.isPurchasedNota)
//   receivings.status RETUR/REFUND/RUSAK = BUKAN realisasi valid
//
// ATURAN PENTING:
//   1. `estimated_price` TIDAK PERNAH dianggap realisasi. Request dikirim
//      bukan berarti dibeli.
//   2. qty permintaan (`pr_items.quantity`) TIDAK PERNAH diubah oleh
//      pemenuhan. Sisa = qty − realisasi, dihitung saat tampil.
//   3. Nota yang masih DRAFT / belum DIBELI tidak menutup kebutuhan.
//   4. Pembelian lebih banyak dari qty PR dilaporkan `over` (tidak dipotong
//      diam-diam) tetapi status tetap SELESAI.
//   5. Penutupan manual hanya via penanda [Tutup: alasan] (leanRequest.js) —
//      bukan status palsu, bukan perubahan qty.
// ============================================================
import { isReceivingKendala } from '../../lib/constants'
import { isPurchasedNota } from '../../lib/purchaseNote'
import { closeReasonOf, isLeanMarked } from './leanRequest'

export const FULFILL_NONE = 'BELUM_DIBELI'
export const FULFILL_PARTIAL = 'SEBAGIAN'
export const FULFILL_DONE = 'SELESAI'
export const FULFILL_CLOSED = 'DITUTUP'

const EPS = 1e-9

function num(v) {
  const n = Number(v)
  return isFinite(n) ? n : 0
}

/**
 * Indeks realisasi per pr_item_id dari baris penerimaan.
 * @returns Map<prItemId, {qty:number, notes:Array<{receivingId, qty, date}>}>
 */
export function buildRealizationIndex({ receivings = [], receivingItems = [] } = {}) {
  const recById = new Map((receivings || []).map(r => [r.id, r]))
  const index = new Map()
  for (const ri of (receivingItems || [])) {
    if (!ri || !ri.pr_item_id) continue
    const rec = ri.receiving_id ? recById.get(ri.receiving_id) : null
    if (!rec) continue
    // Nota harus benar-benar DIBELI dan bukan Retur/Refund/Rusak.
    if (!isPurchasedNota(rec)) continue
    if (isReceivingKendala(rec.status)) continue
    const qty = num(ri.quantity_received)
    if (!(qty > 0)) continue
    const prev = index.get(ri.pr_item_id) || { qty: 0, notes: [] }
    prev.qty += qty
    prev.notes.push({
      receivingId: rec.id,
      qty,
      date: rec.received_date || rec.created_at || null,
      invoiceNo: rec.invoice_no || null
    })
    index.set(ri.pr_item_id, prev)
  }
  return index
}

/**
 * Status pemenuhan satu item PR.
 * @returns {{
 *   status: 'BELUM_DIBELI'|'SEBAGIAN'|'SELESAI'|'DITUTUP',
 *   requested: number, realized: number, remaining: number, over: number,
 *   closedReason: string|null, label: string, notes: Array
 * }}
 */
export function itemFulfillment(prItem, { realizationIndex = null, requestClosed = false, closedReason = null } = {}) {
  const requested = num(prItem?.quantity)
  const idx = realizationIndex || new Map()
  const real = idx.get(prItem?.id) || { qty: 0, notes: [] }
  const realized = Math.round(real.qty * 1000) / 1000
  const over = realized > requested + EPS ? Math.round((realized - requested) * 1000) / 1000 : 0
  const remaining = Math.max(0, Math.round((requested - realized) * 1000) / 1000)

  let status
  if (requested > 0 && realized >= requested - EPS) status = FULFILL_DONE
  else if (requestClosed) status = FULFILL_CLOSED
  else if (realized > 0) status = FULFILL_PARTIAL
  else status = FULFILL_NONE

  return {
    status,
    requested,
    realized,
    remaining,
    over,
    closedReason: status === FULFILL_CLOSED ? (closedReason || null) : null,
    notes: real.notes,
    label: statusLabel(status, remaining, closedReason)
  }
}

function statusLabel(status, remaining, closedReason) {
  if (status === FULFILL_DONE) return 'Selesai dibeli'
  if (status === FULFILL_PARTIAL) return `Sebagian — sisa ${remaining}`
  if (status === FULFILL_CLOSED) return `Ditutup${closedReason ? `: ${closedReason}` : ''}`
  return 'Belum dibeli'
}

/**
 * Ringkasan pemenuhan satu PR.
 * @returns {{
 *   items: Array, counts: {total, done, partial, none, closed},
 *   status: 'BELUM_DIBELI'|'SEBAGIAN'|'SELESAI'|'DITUTUP'|'KOSONG',
 *   label: string, requested:number, realized:number, remaining:number,
 *   closedReason: string|null, isLean: boolean
 * }}
 */
export function requestFulfillment(pr, { items = [], receivings = [], receivingItems = [], realizationIndex = null } = {}) {
  const idx = realizationIndex || buildRealizationIndex({ receivings, receivingItems })
  const closedReason = closeReasonOf(pr?.notes)
  const requestClosed = !!closedReason
  const rows = (items || []).map(it => ({ prItem: it, ...itemFulfillment(it, { realizationIndex: idx, requestClosed, closedReason }) }))
  const counts = { total: rows.length, done: 0, partial: 0, none: 0, closed: 0 }
  let requested = 0
  let realized = 0
  for (const r of rows) {
    requested += r.requested
    realized += r.realized
    if (r.status === FULFILL_DONE) counts.done++
    else if (r.status === FULFILL_PARTIAL) counts.partial++
    else if (r.status === FULFILL_CLOSED) counts.closed++
    else counts.none++
  }
  let status = FULFILL_NONE
  if (!rows.length) status = 'KOSONG'
  else if (counts.done === rows.length) status = FULFILL_DONE
  else if (counts.partial > 0 || counts.done > 0) status = FULFILL_PARTIAL
  else if (counts.closed === rows.length) status = FULFILL_CLOSED
  else status = FULFILL_NONE

  return {
    items: rows,
    counts,
    status,
    label: requestStatusLabel(status, counts),
    requested: Math.round(requested * 1000) / 1000,
    realized: Math.round(realized * 1000) / 1000,
    remaining: Math.max(0, Math.round((requested - realized) * 1000) / 1000),
    closedReason,
    isLean: isLeanMarked(pr?.notes)
  }
}

function requestStatusLabel(status, counts) {
  if (status === 'KOSONG') return 'Tanpa item'
  if (status === FULFILL_DONE) return 'Selesai'
  if (status === FULFILL_PARTIAL) {
    // Kalimat alami: kalau hanya sebagian (tanpa yang selesai/ditutup),
    // cukup "Sebagian" — jumlahnya sudah terlihat dari daftar item.
    if (!counts.done && !counts.closed && !counts.none) return 'Sebagian'
    const parts = []
    if (counts.done) parts.push(`${counts.done} selesai`)
    if (counts.partial) parts.push(`${counts.partial} sebagian`)
    if (counts.none) parts.push(`${counts.none} belum`)
    if (counts.closed) parts.push(`${counts.closed} ditutup`)
    return parts.join(' · ')
  }
  if (status === FULFILL_CLOSED) return 'Ditutup admin'
  return 'Belum dibeli'
}

/**
 * Kebutuhan yang MASIH TERBUKA (belum dibeli penuh & belum ditutup).
 * Ini yang dipakai modul Purchase (task B) untuk memilih kebutuhan.
 * Baris yang ditutup TIDAK muncul; qty asli tetap utuh di pr_items.
 */
export function openNeeds(pr, opts = {}) {
  const summary = requestFulfillment(pr, opts)
  return summary.items
    .filter(r => r.status === FULFILL_PARTIAL || r.status === FULFILL_NONE)
    .map(r => ({
      prItemId: r.prItem.id,
      prId: r.prItem.pr_id,
      materialId: r.prItem.material_id || null,
      itemName: r.prItem.item_name,
      unit: r.prItem.unit,
      requested: r.requested,
      realized: r.realized,
      remaining: r.remaining
    }))
}
