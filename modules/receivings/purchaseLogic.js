// ============================================================
// modules/receivings/purchaseLogic.js — LOGIKA MURNI MODUL PURCHASE (belanja)
// ============================================================
// Tanpa React, tanpa query DB. Dipakai oleh page.jsx / purchaseForm.jsx dan
// diuji VERBATIM oleh scripts/purchase-flow-test (sandbox, tanpa DB).
//
// TANGGUNG JAWAB MODUL (arahan DAT — rombak besar Purchase):
//   Purchase = ADMIN BELANJA KANTOR mencatat nota toko & uang keluar.
//   Berhenti sampai "barang dibeli". Distribusi fisik (gudang / tukang /
//   bermasalah) = modul Handover, BUKAN di sini.
//
// DUA TAB:
//   1) SIAP DIBELI  -> item PR berstatus APPROVED yang belum pernah dibeli.
//   2) RIWAYAT      -> nota belanja yang sudah selesai (punya no. nota).
//
// SATU NOTA = SATU TOKO. Satu nota boleh memuat item dari beberapa PR/proyek
// (DAT: "admin bisa mencentang beberapa barang untuk dibeli bersamaan ke toko
// yang sama"), jadi header nota tidak dipaksa satu PR — jejak per barang tetap
// lewat receiving_items.pr_item_id.
// ============================================================

import { parsePurchaseNote, isPurchasedNota, buildItemPriceNote } from '../../lib/purchaseNote'

export const TAB_READY = 'ready'
export const TAB_HISTORY = 'history'

const EPS = 1e-9

// Angka dari input teks ('' / null => 0, teks tak sah => NaN).
//
// DIPERBAIKI di paket akhir t_2e5ef03c (temuan S3/S6: FN-RUPIAH_LOCALE).
// Perilaku lama berbahaya secara finansial:
//   toNum('1.250.000') -> NaN  (titik ribuan lolos filter, Number() gagal)
//        -> computeItem memberi subtotal null -> buildSavePlan MEMBUANG baris
//           itu diam-diam -> nota tersimpan dengan total lebih kecil dari
//           kenyataan (biaya proyek kurang tercatat).
//   toNum('3 dus')     -> 3    (satuan dibuang senyap)
// Sekarang: pemisah ribuan id-ID dibaca benar, dan teks bersatuan DITOLAK
// (NaN) supaya validasi form menampilkan error alih-alih menebak angka.
export function toNum(v) {
  if (v === '' || v === null || v === undefined) return 0
  if (typeof v === 'number') return isFinite(v) ? v : NaN
  let s = String(v).trim().replace(/^(rp\.?|idr)\s*/i, '').replace(/\s/g, '')
  if (s === '') return 0
  const neg = s.startsWith('-')
  if (neg) s = s.slice(1)
  // hanya digit + pemisah yang boleh tersisa
  if (!/^\d[\d.,]*$/.test(s)) return NaN
  const commas = (s.match(/,/g) || []).length
  const dots = (s.match(/\./g) || []).length
  let n
  if (commas && dots) {
    // Pemakaian terakhir menentukan desimal (1.250.000,50 / 1,250,000.50).
    n = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? Number(s.split('.').join('').replace(',', '.'))
      : Number(s.split(',').join(''))
  } else if (dots) {
    // Titik = ribuan bila SETIAP grup setelah titik tepat 3 digit.
    n = /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.split('.').join('')) : Number(s)
  } else if (commas) {
    // Koma = desimal bila hanya satu; lebih dari satu = pemisah ribuan.
    n = commas === 1 ? Number(s.replace(',', '.')) : Number(s.split(',').join(''))
  } else {
    n = Number(s)
  }
  if (!isFinite(n)) return NaN
  return neg ? -n : n
}

function normUnit(u) {
  return String(u ?? '').trim().toLowerCase()
}

function labelProject(p) {
  if (!p) return ''
  return p.kode ? `[${p.kode}] ${p.name}` : String(p.name || '')
}

// Status item PR yang berarti "boleh dibelanjakan".
// - APPROVED : disetujui di modul Approval (sumber utama tab Siap Dibeli).
// - ORDERED  : pernah ditandai diorder pada alur lama; tetap boleh dibeli
//              bila belum ada nota belanjanya (tidak ada data hilang).
export function isBuyableStatus(status) {
  const s = String(status || '').toUpperCase()
  return s === 'APPROVED' || s === 'ORDERED'
}

// ------------------------------------------------------------
// 1) TAB SIAP DIBELI
// ------------------------------------------------------------
// Baris = satu item PR. Item dianggap SUDAH dibeli (hilang dari daftar) bila
// jumlah yang sudah dibeli >= qty PR. Bila admin membeli LEBIH SEDIKIT dari
// qty PR, sisanya TETAP tampil dengan qty default = sisa — kalau tidak, sisa
// kebutuhan proyek akan hilang diam-diam dari antrean belanja.
// Sumber "sudah dibeli": baris penerimaan yang menunjuk item itu, yaitu nota
// DIBELI (alur baru) ATAU baris dengan quantity_received > 0 (data lama).
export function buildReadyRows({
  prItems = [], requests = [], projects = [], vendors = [], materials = [],
  receivings = [], receivingItems = []
} = {}) {
  const prById = new Map((requests || []).map(r => [r.id, r]))
  const projById = new Map((projects || []).map(p => [p.id, p]))
  const vendorById = new Map((vendors || []).map(v => [v.id, v]))
  const matById = new Map((materials || []).map(m => [m.id, m]))
  const recById = new Map((receivings || []).map(r => [r.id, r]))

  // Status beli per pr_item (dari semua baris penerimaan yang menunjuk item itu).
  const boughtByPrItem = new Map()
  for (const ri of (receivingItems || [])) {
    if (!ri || !ri.pr_item_id) continue
    const rec = ri.receiving_id ? recById.get(ri.receiving_id) : null
    const qty = Number(ri.quantity_received || 0)
    const purchased = isPurchasedNota(rec)
    const prev = boughtByPrItem.get(ri.pr_item_id) || { purchased: false, qty: 0, nota: null }
    prev.purchased = prev.purchased || purchased || qty > 0
    prev.qty += isFinite(qty) && qty > 0 ? qty : 0
    if (purchased && rec) prev.nota = rec
    boughtByPrItem.set(ri.pr_item_id, prev)
  }

  const rows = []
  for (const it of (prItems || [])) {
    if (!it || !it.id) continue
    if (!isBuyableStatus(it.status)) continue
    const bought = boughtByPrItem.get(it.id)
    const qty = Number(it.quantity)
    const qtyPr = isFinite(qty) && qty > 0 ? qty : 1
    const boughtQty = bought ? bought.qty : 0
    // Sudah dibeli penuh -> tidak perlu dibeli lagi.
    if (bought && bought.purchased && boughtQty >= qtyPr - EPS) continue

    const pr = it.pr_id ? prById.get(it.pr_id) : null
    const projectId = it.project_id || pr?.project_id || null
    const proj = projectId ? projById.get(projectId) : null
    const vendor = it.vendor_id ? vendorById.get(it.vendor_id) : null
    const mat = it.material_id ? matById.get(it.material_id) : null
    const est = Number(it.estimated_price)
    // Sisa yang belum dibeli = qty PR − yang sudah dibeli (minimal 1 supaya
    // form tidak pernah menawarkan qty 0).
    const sisa = bought && bought.purchased ? Math.max(1, Math.round((qtyPr - boughtQty) * 100) / 100) : qtyPr

    rows.push({
      key: it.id,
      prItemId: it.id,
      prId: it.pr_id || null,
      prNumber: pr?.pr_number || '—',
      prTitle: pr?.title || '',
      itemName: String(it.item_name || it.kode || '—').trim(),
      kode: it.kode || '',
      unit: String(it.unit || '').trim(),
      qtyPr,
      qtyBought: boughtQty,
      qtySisa: sisa,
      estimasi: isFinite(est) && est > 0 ? est : null,
      materialId: it.material_id || null,
      hargaAcuan: mat && isFinite(Number(mat.harga_acuan)) && Number(mat.harga_acuan) > 0 ? Number(mat.harga_acuan) : null,
      kategori: mat?.category || String(it.supplier_category || '').trim() || '',
      projectId,
      projectName: labelProject(proj) || '—',
      vendorId: it.vendor_id || null,
      vendorName: vendor?.name || '',
      vendorKnown: !!vendor
    })
  }

  // Urutan stabil: vendor yang sudah tercatat dulu, lalu proyek, lalu nama.
  rows.sort((a, b) => {
    const va = a.vendorName || '\uffff'
    const vb = b.vendorName || '\uffff'
    if (va !== vb) return va.localeCompare(vb, 'id', { sensitivity: 'base' })
    if (a.projectName !== b.projectName) return a.projectName.localeCompare(b.projectName, 'id', { sensitivity: 'base' })
    return a.itemName.localeCompare(b.itemName, 'id', { sensitivity: 'base' })
  })
  return rows
}

// Filter tab Siap Dibeli: per vendor/toko atau per proyek (+ pencarian teks).
export function filterReadyRows(rows, { vendorId = '', projectId = '', q = '' } = {}) {
  let list = rows || []
  if (vendorId) list = list.filter(r => r.vendorId === vendorId)
  if (projectId) list = list.filter(r => r.projectId === projectId)
  const s = String(q || '').trim().toLowerCase()
  if (s) {
    list = list.filter(r => [r.itemName, r.kode, r.prNumber, r.projectName, r.vendorName, r.kategori]
      .some(v => String(v || '').toLowerCase().includes(s)))
  }
  return list
}

// Opsi filter vendor/proyek dari baris yang ADA (tanpa mengarang data).
export function readyFilterOptions(rows) {
  const vendors = new Map()
  const projects = new Map()
  let tanpaVendor = 0
  for (const r of (rows || [])) {
    if (r.vendorId) {
      if (!vendors.has(r.vendorId)) vendors.set(r.vendorId, { id: r.vendorId, name: r.vendorName || 'Vendor' })
    } else tanpaVendor++
    if (r.projectId && !projects.has(r.projectId)) projects.set(r.projectId, { id: r.projectId, name: r.projectName })
  }
  return {
    vendors: [...vendors.values()].sort((a, b) => a.name.localeCompare(b.name, 'id')),
    projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name, 'id')),
    tanpaVendor
  }
}

// ------------------------------------------------------------
// 2) TAB RIWAYAT PEMBELIAN
// ------------------------------------------------------------
// Klasifikasi nota:
//   PURCHASED : ditandai DIBELI (kolom status atau penanda [Tahap: DIBELI]).
//   LEGACY    : nota lama yang benar-benar mencatat uang keluar (punya nomor
//               nota, atau bertanggal + nominal) tapi dibuat sebelum alur
//               belanja baru (tanpa harga satuan per item). Ditampilkan dengan
//               label jujur "nota lama" — tidak diberi harga karangan.
//   DRAFT     : cangkang nota otomatis dari Approval — TIDAK ditampilkan.
//
// PENTING (defect t_9109cf5e): cangkang Approval mengisi `delivery_note`
// dengan "PO <no PR> - <judul>" (lihat ensure_item_in_purchase di pages/index.js).
// Karena itu `delivery_note` TIDAK boleh dijadikan bukti "ini nota". Kalau
// dipakai, tab Riwayat menampilkan baris hantu (tanpa nomor, tanpa toko, tanpa
// total) untuk setiap PR yang baru disetujui — sebelum ada uang keluar sama
// sekali. Bukti nota yang sah = `invoice_no` terisi, atau tanggal + nominal.
export function classifyNota(rec) {
  if (!rec) return 'DRAFT'
  if (isPurchasedNota(rec)) return 'PURCHASED'
  if (String(rec.invoice_no || '').trim()) return 'LEGACY'
  const berTanggal = !!String(rec.received_date || '').trim()
  const adaNominal = parsePurchaseNote(rec.note).material !== null
  return berTanggal && adaNominal ? 'LEGACY' : 'DRAFT'
}

export function buildHistoryRows({
  receivings = [], receivingItems = [], vendors = [], projects = [], requests = []
} = {}) {
  const vendorById = new Map((vendors || []).map(v => [v.id, v]))
  const projById = new Map((projects || []).map(p => [p.id, p]))
  const prById = new Map((requests || []).map(r => [r.id, r]))
  const itemsByRec = new Map()
  for (const ri of (receivingItems || [])) {
    if (!ri || !ri.receiving_id) continue
    const list = itemsByRec.get(ri.receiving_id) || []
    list.push(ri)
    itemsByRec.set(ri.receiving_id, list)
  }

  const rows = []
  for (const rec of (receivings || [])) {
    const kind = classifyNota(rec)
    if (kind === 'DRAFT') continue
    const note = parsePurchaseNote(rec.note)
    // Rincian nota = HANYA barang yang benar-benar dibeli di nota itu
    // (quantity_received > 0). Baris qty 0 adalah sisa cangkang Approval untuk
    // barang yang belum dibeli — kalau ikut ditampilkan, nota terlihat membeli
    // barang yang tidak ada di nota toko ("Sekrup x0") dan jumlah itemnya
    // membengkak. Nota tanpa baris berisi tetap jujur: "rincian tidak tercatat".
    const allItems = itemsByRec.get(rec.id) || []
    const items = allItems.filter(it => {
      const q = Number(it?.quantity_received)
      return isFinite(q) && q > 0
    })
    const proj = rec.project_id ? projById.get(rec.project_id) : null
    const pr = rec.purchase_request_id ? prById.get(rec.purchase_request_id) : null
    const qtyTotal = items.reduce((s, it) => s + (Number(it.quantity_received) || 0), 0)

    rows.push({
      key: rec.id,
      id: rec.id,
      kind,
      invoiceNo: String(rec.invoice_no || '').trim(),
      vendorId: rec.vendor_id || null,
      vendorName: rec.vendor_id ? (vendorById.get(rec.vendor_id)?.name || '') : '',
      projectId: rec.project_id || null,
      projectName: labelProject(proj) || '—',
      prNumber: pr?.pr_number || '',
      date: rec.received_date || (rec.created_at ? String(rec.created_at).slice(0, 10) : ''),
      material: note.material,
      biayaLain: note.biayaLain,
      diskon: note.diskon,
      total: note.total,
      itemCount: items.length,
      qtyTotal,
      hasNotaPhoto: !!note.buktiNota,
      hasTransferProof: !!note.buktiTransfer,
      buktiNotaSrc: note.buktiNota || '',
      buktiTransferSrc: note.buktiTransfer || '',
      notaUrl: note.notaUrl,
      catatan: note.catatan,
      items
    })
  }

  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))
    || String(b.invoiceNo).localeCompare(String(a.invoiceNo), 'id', { numeric: true }))
  return rows
}

// ------------------------------------------------------------
// 3) FORM "PROSES PEMBELIAN" (per toko)
// ------------------------------------------------------------
// Draft form dibuat dari item yang DICENTANG. Harga satuan riil SELALU kosong
// (diisi dari nota toko) — estimasi/acuan hanya ditampilkan sebagai
// pembanding, TIDAK pernah dipakai sebagai harga beli (defect P1 t_e88c28fb).
export function buildFormDraft(rows, { vendorId = '', today = null } = {}) {
  const list = rows || []
  const firstVendor = list.find(r => r.vendorId)?.vendorId || ''
  return {
    vendorId: vendorId || firstVendor || '',
    tanggal: today || new Date().toISOString().slice(0, 10),
    invoiceNo: '',
    biayaLain: '',
    diskon: '',
    notaUrl: '',
    buktiNota: '',
    buktiTransfer: '',
    catatan: '',
    items: list.map(r => ({
      prItemId: r.prItemId,
      itemName: r.itemName,
      unit: r.unit,
      qtyPr: r.qtyPr,
      // Qty default = SISA yang belum dibeli (bila sebelumnya dibeli sebagian),
      // bukan qty PR penuh — supaya tidak membeli ulang barang yang sudah ada.
      qty: String(r.qtySisa ?? r.qtyPr),
      harga: '',
      estimasi: r.estimasi,
      hargaAcuan: r.hargaAcuan,
      projectName: r.projectName,
      prNumber: r.prNumber,
      // Jejak PR/proyek dibawa ke form: header nota baru harus tetap tahu PR &
      // proyek asalnya (dipakai untuk mengisi purchase_request_id/project_id
      // dan proyek pada dokumen Handover). Tanpa ini nota tanpa cangkang
      // kehilangan jejak proyeknya.
      prId: r.prId || null,
      projectId: r.projectId || null
    }))
  }
}

// Hitung baris: subtotal material = qty × harga riil.
export function computeItem(it) {
  const qty = toNum(it?.qty)
  const harga = toNum(it?.harga)
  const validQty = isFinite(qty) && qty > 0
  const validHarga = isFinite(harga) && harga > 0
  const subtotal = validQty && validHarga ? Math.round(qty * harga) : null
  return { qty, harga, validQty, validHarga, subtotal }
}

// Total nota riil = total material + biaya lain/ongkir − diskon.
export function computeTotals({ items = [], biayaLain = '', diskon = '' } = {}) {
  let material = 0
  let terisi = 0
  let incomplete = 0
  for (const it of (items || [])) {
    const c = computeItem(it)
    if (c.subtotal !== null) { material += c.subtotal; terisi++ }
    else if (String(it.qty ?? '') !== '' || String(it.harga ?? '') !== '') incomplete++
  }
  const lain = toNum(biayaLain)
  const disc = toNum(diskon)
  const biaya = isFinite(lain) && lain > 0 ? Math.round(lain) : 0
  const potongan = isFinite(disc) && disc > 0 ? Math.round(disc) : 0
  const total = Math.max(0, material + biaya - potongan)
  return { material, biayaLain: biaya, diskon: potongan, total, terisi, incomplete }
}

// Validasi lengkap sebelum simpan. Tidak ada tulisan bila tidak valid.
export function validatePurchaseForm(form, { vendors = [] } = {}) {
  const errors = []
  const itemErrors = {}
  const vendorId = String(form?.vendorId || '').trim()
  const invoiceNo = String(form?.invoiceNo || '').trim()
  const tanggal = String(form?.tanggal || '').trim()
  const items = Array.isArray(form?.items) ? form.items : []

  if (!vendorId) errors.push('Toko / Vendor wajib dipilih.')
  else if (vendors.length && !vendors.some(v => v.id === vendorId)) errors.push('Toko / Vendor yang dipilih tidak dikenal.')
  if (!invoiceNo) errors.push('No. Invoice / No. Nota toko wajib diisi (mis. TB-88912).')
  if (!tanggal) errors.push('Tanggal belanja wajib diisi.')
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) errors.push('Tanggal belanja tidak valid.')
  if (!items.length) errors.push('Belum ada barang yang dipilih untuk dibeli.')

  for (const it of items) {
    const err = {}
    const c = computeItem(it)
    if (!c.validQty) err.qty = 'Qty beli harus lebih dari 0.'
    if (!c.validHarga) err.harga = 'Harga satuan riil wajib diisi (angka > 0).'
    if (Object.keys(err).length) itemErrors[it.prItemId] = err
  }
  const totals = computeTotals(form)

  return {
    valid: errors.length === 0 && Object.keys(itemErrors).length === 0,
    errors,
    itemErrors,
    totals
  }
}

// Payload siap simpan (satu nota = satu toko). Hanya item terisi yang ikut.
export function buildSavePlan(form) {
  const items = (Array.isArray(form?.items) ? form.items : [])
    .map(it => {
      const c = computeItem(it)
      return {
        prItemId: it.prItemId,
        itemName: String(it.itemName || '—').trim(),
        unit: String(it.unit || '').trim(),
        qty: c.qty,
        harga: c.harga,
        subtotal: c.subtotal,
        // Jejak PR/proyek dibawa supaya header nota baru tetap punya
        // purchase_request_id/project_id walau tidak ada cangkang Approval.
        prId: it.prId || null,
        projectId: it.projectId || null,
        itemNote: buildItemPriceNote(c.harga)
      }
    })
    .filter(it => it.prItemId && it.subtotal !== null)

  const totals = computeTotals(form)
  return {
    header: {
      vendorId: String(form?.vendorId || '').trim(),
      invoiceNo: String(form?.invoiceNo || '').trim(),
      tanggal: String(form?.tanggal || '').trim(),
      biayaLain: totals.biayaLain,
      diskon: totals.diskon,
      material: totals.material,
      total: totals.total,
      notaUrl: String(form?.notaUrl || '').trim(),
      buktiNota: String(form?.buktiNota || ''),
      buktiTransfer: String(form?.buktiTransfer || ''),
      catatan: String(form?.catatan || '').trim()
    },
    items,
    totals
  }
}

// Kelompokkan baris terpilih per toko — dipakai UI untuk memberi tahu bahwa
// satu nota hanya boleh satu toko (bila admin mencentang lintas toko).
export function groupByVendor(rows) {
  const map = new Map()
  for (const r of (rows || [])) {
    const key = r.vendorId || ''
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  return [...map.entries()].map(([vendorId, list]) => ({
    vendorId,
    vendorName: list[0]?.vendorName || '',
    count: list.length,
    rows: list
  }))
}

// Ringkasan satu nota untuk daftar riwayat/kartu mobile.
export function historySummary(row) {
  const n = row?.itemCount || 0
  const names = (row?.items || []).map(it => String(it.item_name || '').trim()).filter(Boolean)
  const ringkas = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} lainnya` : names.join(', ')
  return {
    count: n,
    names,
    ringkas,
    text: n ? `${n} item${ringkas ? ` — ${ringkas}` : ''}` : 'Rincian barang tidak tercatat'
  }
}
