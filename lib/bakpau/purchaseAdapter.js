// ============================================================
// lib/bakpau/purchaseAdapter.js — ADAPTER KE BOUNDARY PEMBELIAN BERSAMA
// ============================================================
// TUJUAN: input Bakpau (Telegram/WA) masuk lewat VALIDASI & TULISAN yang SAMA
// dengan input admin — bukan ledger kedua, bukan aturan validasi kedua.
//
// YANG DIPAKAI ULANG (import read-only, tidak ada file yang diubah):
//   * `validatePurchaseBoundary()` dari modules/receivings/purchaseSave.js
//     — satu-satunya kontrak validasi nota (vendor wajib, tanggal valid,
//       qty > 0, harga riil > 0, normalisasi angka, subtotal).
//   * `buildPurchaseNote()`, `buildItemPriceNote()`, `isPurchasedNota()`
//       dari lib/purchaseNote.js — format penanda nota yang dibaca UI,
//       Finance, dan resolver acuan harga.
//
// YANG TIDAK BISA DIPAKAI ULANG LANGSUNG (dan kenapa):
//   `savePurchase()` mengimpor klien Supabase dari `lib/supabaseClient`
//   (klien ANON milik browser). Konektor berjalan SERVER-SIDE dengan klien
//   service-role yang disuntikkan, jadi fungsi itu tidak bisa menerima klien.
//   Menyalin seluruh logikanya akan membuat jalur tulis kedua yang bisa
//   menyimpang — itu justru yang dilarang.
//
//   Karena itu adapter ini:
//     1) memakai validatePurchaseBoundary (kontrak bersama) untuk SEMUA
//        keputusan validitas;
//     2) menulis dengan PEMETAAN KOLOM yang IDENTIK dengan savePurchase,
//        dan pemetaan itu DIKUNCI oleh test (`logic_test.mjs` bagian ADAPTER
//        membandingkan key payload adapter vs key payload savePurchase asli);
//     3) mengusulkan patch minimal ke integrator (lihat
//        docs/bakpau-connector-contract.md §8) supaya ke depan ada SATU
//        fungsi `savePurchaseWithClient({client, …})` di purchaseSave.js dan
//        adapter ini cukup memanggilnya.
//
// TIDAK ADA di file ini: penulisan stok, serah terima, pembayaran, PR baru,
// approval_steps. Nota/pembayaran BUKAN penerimaan fisik.
// ============================================================

import { validatePurchaseBoundary, savePurchaseWithClient } from '../../modules/receivings/purchaseSave.js'
import { buildPurchaseNote, buildItemPriceNote, TAHAP_DIBELI } from '../../lib/purchaseNote.js'
import { buildEventMarks, buildItemMarks, parseConnectorMarkers } from './markers.js'
import { REASON } from './constants.js'

// Pemetaan header yang HARUS sama dengan modules/receivings/purchaseSave.js.
export const HEADER_COLUMNS = Object.freeze([
  'vendor_id', 'invoice_no', 'delivery_note', 'received_date', 'note', 'kendala',
  'purchase_request_id', 'project_id', 'status', 'alokasi', 'masuk_gudang'
])

export const ITEM_COLUMNS = Object.freeze([
  'receiving_id', 'pr_item_id', 'item_name', 'unit', 'quantity_received', 'note'
])

// Referensi internal untuk nota tanpa nomor vendor — pola yang SAMA dengan
// savePurchase (PH-<epoch36>-<rand>), supaya laporan bisa membedakan nomor
// toko asli dari referensi internal. Konektor memakai prefix `BK-` agar
// asal-usulnya jelas (bukan nomor toko karangan).
export function internalRefStamp({ now = Date.now(), rand = Math.random() } = {}) {
  const epoch = Math.floor(now / 1000).toString(36).toUpperCase().padStart(8, '0')
  const r = rand().toString(36).slice(2, 6).toUpperCase().padStart(4, 'X')
  return `BK-${epoch}-${r}`
}

// ------------------------------------------------------------
// Validasi (memakai boundary bersama)
// ------------------------------------------------------------
export function validateViaSharedBoundary(nota) {
  const res = validatePurchaseBoundary(nota)
  if (!res.ok) {
    return { ok: false, reason: res.reason || REASON.SAVE_FAILED, error: res.error }
  }
  return { ok: true, nota: res.nota }
}

// ------------------------------------------------------------
// TULIS — DELEGASI ke boundary bersama `savePurchaseWithClient`.
// ------------------------------------------------------------
// G7 (integrasi t_da4a9ef8): mapper kolom duplikat DIHAPUS. Admin dan konektor
// kini menulis lewat fungsi yang sama di modules/receivings/purchaseSave.js:
//   * validasi, anti-duplikat nota (vendor + nomor), pemakaian ulang cangkang
//     PR, penulisan header/baris, dan readback alokasi = satu implementasi;
//   * yang tetap milik konektor hanya JEJAK ASAL-USUL (marker event/bukti/
//     kanal) yang dikirim sebagai suffix catatan, dan `queueHandover: false`
//     karena nota/pembayaran bukan penerimaan fisik.
// `receivingId` diisi bila cangkang PR dipakai ulang (perilaku sama dengan
// savePurchase). Konektor TIDAK membuat cangkang; ia hanya memakai ulang bila
// cangkang kosong sudah ada (alur Approval lama), supaya tidak ada header ganda.
export async function writePurchase({
  client, validated, header = {}, lines = [], eventKey, evidenceHash, channel, senderId, messageId,
  shellReceivingId = null, projectId = null, prId = null, now = Date.now(), rand = Math.random
} = {}) {
  if (!client) return { ok: false, reason: REASON.NO_SERVICE_CREDENTIALS, error: 'Klien DB tidak tersedia.' }
  if (!validated || !validated.ok) return { ok: false, reason: REASON.SAVE_FAILED, error: 'Payload belum tervalidasi.' }

  const nota = validated.nota
  const eventMarks = buildEventMarks({ eventKey, evidenceHash, channel, senderId, messageId })
  const lineNoteSuffixes = nota.items.map((it, i) => {
    const line = lines[i] || {}
    return buildItemMarks({
      spec: line.spec || '',
      specAwal: line.specAwal || '',
      projectId: line.projectId || projectId || '',
      prItemId: it.prItemId || ''
    })
  })

  // Bentuk form = kontrak bersama. Nomor nota kosong -> referensi internal
  // dibuat oleh boundary bersama dengan prefix BK (bukan nomor toko karangan).
  const form = {
    vendorId: nota.vendorId,
    tanggal: nota.tanggal,
    invoiceNo: String(header.invoiceNo || '').trim(),
    notaUrl: header.notaUrl || '',
    buktiNota: header.buktiNota || '',
    buktiTransfer: header.buktiTransfer || '',
    catatan: header.catatan || '',
    biayaLain: nota.biayaLain,
    diskon: nota.diskon,
    items: nota.items.map(it => ({
      prItemId: it.prItemId || null,
      prId: it.prId || null,
      projectId: it.projectId || null,
      itemName: it.itemName,
      unit: it.unit || null,
      qty: it.qty,
      harga: it.harga
    }))
  }

  const res = await savePurchaseWithClient({
    client,
    form,
    receivings: [],
    receivingItems: [],
    vendors: [],
    headerNoteSuffix: eventMarks,
    lineNoteSuffixes,
    shellReceivingId: shellReceivingId || null,
    projectIdOverride: projectId || null,
    prIdOverride: prId || null,
    // Nota/pembayaran BUKAN penerimaan fisik: konektor tidak membuat dokumen
    // serah terima. Admin tetap membuatnya (default true di boundary).
    queueHandover: false,
    internalRefPrefix: 'BK'
  })

  if (!res.ok) {
    const reason = res.partial
      ? REASON.PARTIAL_WRITE
      : (res.reason || REASON.SAVE_FAILED)
    return {
      ok: false,
      reason,
      error: res.error,
      partial: !!res.partial,
      receivingId: res.receivingId || null,
      invoiceNo: res.invoiceNo || null,
      isInternalRef: !!res.isInternalRef,
      saved: (res.items || []).map((it, i) => ({ ...it, line: lines[i] || {} }))
    }
  }

  const written = (res.items || []).map((it, i) => ({ ...it, line: lines[i] || {} }))

  return {
    ok: true,
    receivingId: res.receivingId,
    invoiceNo: res.invoiceNo,
    isInternalRef: res.isInternalRef,
    statusFallback: res.statusFallback,
    status: res.status,
    itemCount: written.length,
    items: written,
    material: res.material,
    total: res.total,
    biayaLain: res.biayaLain,
    diskon: res.diskon,
    note: res.note
  }
}

function isCheckViolation(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  return code === '23514' || /check constraint/i.test(msg)
}

// ------------------------------------------------------------
// READBACK EXACT — syarat mutlak status 'tercatat'
// ------------------------------------------------------------
// Membaca ULANG dari DB (bukan dari payload yang kita kirim) lalu
// membandingkan field kritis satu per satu. Perbedaan sekecil apa pun =
// `ok:false` (status TIDAK boleh 'tercatat').
export async function readbackPurchase({ client, receivingId, expected } = {}) {
  if (!client) return { ok: false, reason: REASON.NO_SERVICE_CREDENTIALS, error: 'Klien DB tidak tersedia.' }
  if (!receivingId) return { ok: false, reason: REASON.READBACK_FAILED, error: 'ID nota tidak ada — tidak ada yang bisa dibaca ulang.' }

  const { data: heads, error: hErr } = await client.from('receivings').select('*').eq('id', receivingId).limit(1)
  if (hErr) return { ok: false, reason: REASON.READBACK_FAILED, error: `Readback nota gagal: ${hErr.message}` }
  const head = (heads || [])[0]
  if (!head) return { ok: false, reason: REASON.READBACK_FAILED, error: `Nota ${receivingId} tidak ditemukan saat readback.` }

  const { data: items, error: iErr } = await client.from('receiving_items').select('*').eq('receiving_id', receivingId)
  if (iErr) return { ok: false, reason: REASON.READBACK_FAILED, error: `Readback barang gagal: ${iErr.message}` }
  const rows = items || []

  const diffs = []
  const exp = expected || {}
  if (exp.vendorId && String(head.vendor_id) !== String(exp.vendorId)) diffs.push('vendor_id')
  if (exp.invoiceNo && String(head.invoice_no) !== String(exp.invoiceNo)) diffs.push('invoice_no')
  if (exp.date && String(head.received_date) !== String(exp.date)) diffs.push('received_date')
  if (exp.eventKey) {
    const mk = parseConnectorMarkers(head.note)
    if (mk.eventKey !== String(exp.eventKey)) diffs.push('marker:event')
    if (exp.evidenceHash && mk.evidenceHash !== String(exp.evidenceHash)) diffs.push('marker:evidence')
    if (exp.channel && mk.channel !== String(exp.channel)) diffs.push('marker:channel')
  }
  const posRows = rows.filter(r => Number(r.quantity_received) > 0)
  if (exp.itemCount !== undefined && posRows.length !== exp.itemCount) diffs.push(`item_count(${posRows.length}≠${exp.itemCount})`)
  if (Array.isArray(exp.items)) {
    // Pencocokan HARUS memakai identitas baris lengkap: nama + satuan + proyek
    // (+ qty). Satu SKU boleh dipecah ke beberapa proyek dalam satu nota
    // (alokasi per baris), jadi nama+satuan saja TIDAK unik dan akan
    // menghasilkan mismatch palsu. Setiap baris DB hanya boleh dipakai sekali
    // (`dipakai`), supaya dua baris kembar tidak saling "menutupi".
    const dipakai = new Set()
    for (const want of exp.items) {
      const wantProj = String(want.projectId || '')
      const candidates = posRows.filter(r => !dipakai.has(r.id)
        && String(r.item_name || '') === String(want.item_name || '')
        && String(r.unit || '') === String(want.unit || ''))
      const got = candidates.find(r => {
        const mk = parseConnectorMarkers(r.note)
        return String(mk.projectId || '') === wantProj
      }) || candidates[0]
      if (!got) { diffs.push(`item_hilang:${want.item_name}`); continue }
      dipakai.add(got.id)
      if (Math.round(Number(got.quantity_received) * 1000) !== Math.round(Number(want.quantity_received) * 1000)) {
        diffs.push(`qty:${want.item_name}`)
      }
      const wantPrice = buildItemPriceNote(want.harga)
      if (wantPrice && String(got.note || '').indexOf(wantPrice) < 0) diffs.push(`harga:${want.item_name}`)
      if (want.projectId) {
        const mk = parseConnectorMarkers(got.note)
        if (String(mk.projectId) !== wantProj) diffs.push(`proyek:${want.item_name}`)
      }
    }
  }

  if (diffs.length) {
    return {
      ok: false,
      reason: REASON.READBACK_MISMATCH,
      error: `Readback nota ${head.invoice_no || receivingId} TIDAK cocok pada: ${diffs.join(', ')}. ` +
        'Status "tercatat" tidak boleh diklaim.',
      diffs,
      head,
      items: rows
    }
  }

  return { ok: true, head, items: rows, verifiedAt: new Date().toISOString() }
}

// ------------------------------------------------------------
// Cari cangkang nota kosong milik baris PR (dipakai ulang, bukan digandakan)
// ------------------------------------------------------------
export async function findShellReceiving({ client, prItemIds = [] } = {}) {
  if (!client || !prItemIds.length) return { ok: true, shellReceivingId: null }
  const { data, error } = await client.from('receiving_items').select('id, receiving_id, pr_item_id, quantity_received').in('pr_item_id', prItemIds)
  if (error) return { ok: false, error: error.message }
  const rows = (data || []).filter(r => Number(r.quantity_received || 0) <= 0)
  const ids = [...new Set(rows.map(r => String(r.receiving_id)).filter(Boolean))]
  if (ids.length !== 1) return { ok: true, shellReceivingId: null }
  const { data: heads, error: hErr } = await client.from('receivings').select('*').eq('id', ids[0]).limit(1)
  if (hErr) return { ok: false, error: hErr.message }
  const head = (heads || [])[0]
  if (!head) return { ok: true, shellReceivingId: null }
  // Header yang sudah selesai (DIBELI / bernomor) TIDAK boleh dipakai ulang.
  const finished = String(head.status || '').toUpperCase() === 'DIBELI' || !!String(head.invoice_no || '').trim()
  return { ok: true, shellReceivingId: finished ? null : head.id }
}
