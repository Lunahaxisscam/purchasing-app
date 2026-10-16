// ============================================================
// modules/receivings/receiptLogic.js — logika murni form "Terima Barang"
// ============================================================
// TANPA React / TANPA query DB. Dipakai oleh receiptForm.jsx (UI) dan
// diuji VERBATIM oleh scripts/receipt-flow-test (sandbox, tanpa DB).
//
// KONTRAK DIMENSI (arahan DAT t_5196b689 + audit t_905e0e5a):
//   penerimaan (datang) ≠ kondisi (rusak) ≠ tujuan (WS/tukang) ≠ status retur
//   - baik          = datang − rusak
//   - sisa          = dipesan − sudah diterima sebelumnya   (sebelum event ini)
//   - belum datang  = sisa − datang (setelah event ini)
//   - Σdatang kumulatif tidak boleh > dipesan (over-receipt butuh kebijakan
//     eksplisit — belum ada, jadi DIBLOK, bukan diterima diam-diam).
//   - rusak ≤ datang; jumlah datang & rusak non-negatif.
//   - tujuan baik boleh dibagi Workshop / Tukang; total tujuan ≤ baik.
//   - barang ke Tukang WAJIB ada nama penerima.
//   - rusak: "Tentukan nanti" (default) / "Kembalikan ke Supplier" /
//     "Dibuang" (wajib centang konfirmasi; foto bukti OPSIONAL — KOREKSI DAT
//     16 Okt: foto tidak memblokir transaksi, arsip Drive belum aktif).
//
// CATATAN SKEMA (freeze — arahan DAT): skema saat ini (receiving_items hanya
// punya quantity_received; handovers tanpa item rows) BELUM bisa mencatat
// dimensi rusak / tujuan per item / retur / buang. Semua dimensi itu tetap
// divalidasi penuh di sini, tetapi saat submit ditandai `schemaBlocks`
// (data TIDAK ditulis setengah-setengah, tidak di-packing ke kolom note).
// ============================================================

export const RETUR_NANTI = 'NANTI'       // tentukan nanti (default)
export const RETUR_SUPPLIER = 'SUPPLIER' // kembalikan ke supplier — status MENUNGGU dikembalikan
export const RETUR_DIBUANG = 'DIBUANG'   // dibuang — butuh konfirmasi; foto opsional

const EPS = 1e-9

// Angka qty dari input teks. '' / null / undefined => 0. 'abc' => NaN.
export function toQty(v) {
  if (v === '' || v === null || v === undefined) return 0
  const n = Number(v)
  return isFinite(n) ? n : NaN
}

// Baris item untuk form: pesanan, kumulatif sudah diterima, sisa.
// orderedFor(item) => number | null (null = tidak terhubung PR / qty tak diketahui)
export function buildRows(items, orderedFor) {
  return (items || []).map(it => {
    let ordered = null
    if (orderedFor) {
      const raw = orderedFor(it)
      const n = Number(raw)
      if (raw !== null && raw !== undefined && isFinite(n) && n > 0) ordered = n
    }
    const prevRaw = toQty(it.quantity_received)
    const prevCum = isFinite(prevRaw) && prevRaw > 0 ? prevRaw : 0
    return {
      id: it.id,
      prItemId: it.pr_item_id || null,
      item_name: it.item_name || '—',
      unit: it.unit || '',
      ordered,
      prevCum,
      sisa: ordered === null ? null : Math.max(0, ordered - prevCum)
    }
  })
}

// State awal satu item di form (belum diisi apa pun selain rusak=0 & retur nanti).
export function emptyEntry() {
  return { datang: '', rusak: '0', ws: '', tukang: '', penerima: '', retur: RETUR_NANTI, foto: null, konfirmasiBuang: false }
}

// Nilai terhitung satu item (tanpa validasi).
export function computeItem(row, entry) {
  const d = toQty(entry?.datang)
  const r = toQty(entry?.rusak)
  const ws = toQty(entry?.ws)
  const tk = toQty(entry?.tukang)
  const baik = (isFinite(d) && isFinite(r) && r <= d + EPS) ? d - r : NaN
  const datangN = isFinite(d) ? d : 0
  const belum = row.ordered === null ? null : Math.max(0, row.ordered - row.prevCum - datangN)
  const tujuan = (isFinite(ws) ? ws : 0) + (isFinite(tk) ? tk : 0)
  return { d, r, ws, tk, baik, belum, tujuan }
}

// Validasi satu item. Mengembalikan { errors, computed, valid }.
export function validateItem(row, entry) {
  const c = computeItem(row, entry)
  const errs = {}
  const d = c.d
  const r = c.r
  if (!isFinite(d) || d < 0) errs.datang = 'Jumlah datang harus angka ≥ 0.'
  if (!isFinite(r) || r < 0) errs.rusak = 'Jumlah rusak harus angka ≥ 0.'
  if (!errs.datang && !errs.rusak && r > d + EPS) {
    errs.rusak = `Jumlah rusak tidak boleh lebih dari jumlah datang (${r} > ${d}).`
  }
  if (!errs.datang && row.sisa !== null && isFinite(d) && d > row.sisa + EPS) {
    errs.datang = `Melebihi sisa pesanan (sisa ${row.sisa}${row.unit ? ' ' + row.unit : ''}). Over-receipt belum diizinkan — periksa jumlah.`
  }
  if (!isFinite(c.ws) || c.ws < 0) errs.ws = 'Jumlah ke Workshop harus angka ≥ 0.'
  if (!isFinite(c.tk) || c.tk < 0) errs.tukang = 'Jumlah ke Tukang harus angka ≥ 0.'
  if (!errs.ws && !errs.tukang && isFinite(c.baik) && (c.ws + c.tk) > c.baik + EPS) {
    errs.tujuan = `Total tujuan (${c.ws + c.tk}) melebihi jumlah baik (${c.baik}).`
  }
  if (!errs.tukang && isFinite(c.tk) && c.tk > EPS && !String(entry?.penerima || '').trim()) {
    errs.penerima = 'Nama penerima tukang wajib diisi jika ada barang yang diserahkan ke Tukang.'
  }
  if (isFinite(r) && r > EPS) {
    const retur = entry?.retur || RETUR_NANTI
    if (![RETUR_NANTI, RETUR_SUPPLIER, RETUR_DIBUANG].includes(retur)) {
      errs.retur = 'Pilihan penanganan barang rusak tidak dikenal.'
    }
    if (retur === RETUR_DIBUANG) {
      // KOREKSI DAT (16 Okt): foto bukti OPSIONAL — tidak memblokir transaksi.
      // Konfirmasi tindakan buang TETAP wajib.
      if (!entry?.konfirmasiBuang) errs.konfirmasiBuang = 'Centang konfirmasi bahwa barang benar-benar dibuang.'
    }
  }
  return { errors: errs, computed: c, valid: Object.keys(errs).length === 0 }
}

// Ringkasan + validasi SELURUH form.
// Mengembalikan:
//   itemErrors   : { [itemId]: { field: pesan } }
//   itemComputed : { [itemId]: computeItem(...) }
//   globalErrors : string[]  — form belum lengkap / invalid
//   schemaBlocks : string[]  — dimensi yang BELUM bisa dicatat skema saat ini
//   summary      : total angka untuk ringkasan akhir
//   valid        : tidak ada error input
//   recordable   : valid && tidak ada schemaBlocks (aman disimpan ke skema kini)
export function validateForm(rows, entries) {
  const itemErrors = {}
  const itemComputed = {}
  const globalErrors = []
  const schemaBlocks = []
  const summary = { items: rows.length, itemTerisi: 0, totalDatang: 0, totalRusak: 0, totalBaik: 0, totalWs: 0, totalTukang: 0, totalBelum: 0 }
  let anyDatang = false

  for (const row of rows) {
    const entry = entries?.[row.id] || emptyEntry()
    const v = validateItem(row, entry)
    itemErrors[row.id] = v.errors
    itemComputed[row.id] = v.computed
    const c = v.computed

    if (isFinite(c.d) && c.d > EPS) {
      anyDatang = true
      summary.itemTerisi += 1
      summary.totalDatang += c.d
    }
    if (isFinite(c.r) && c.r > EPS) summary.totalRusak += c.r
    if (isFinite(c.baik) && c.baik > EPS) summary.totalBaik += c.baik
    if (isFinite(c.ws) && c.ws > 0) summary.totalWs += c.ws
    if (isFinite(c.tk) && c.tk > 0) summary.totalTukang += c.tk
    if (c.belum !== null) summary.totalBelum += c.belum

    // Dimensi yang belum termodelkan skema (audit t_905e0e5a G2/G10/G12):
    // tetap divalidasi, tapi submit ditandai agar TIDAK ada data yang
    // dibuang diam-diam maupun dipacking ke kolom note.
    if (isFinite(c.r) && c.r > EPS) {
      schemaBlocks.push(`Rusak ${c.r}${row.unit ? ' ' + row.unit : ''} pada "${row.item_name}" — skema saat ini belum punya kolom jumlah rusak per penerimaan.`)
    }
    if ((isFinite(c.ws) && c.ws > EPS) || (isFinite(c.tk) && c.tk > EPS)) {
      schemaBlocks.push(`Tujuan per item pada "${row.item_name}" (Workshop ${isFinite(c.ws) ? c.ws : 0} / Tukang ${isFinite(c.tk) ? c.tk : 0}) — butuh rincian barang per penyerahan.`)
    }
  }

  if (!anyDatang) globalErrors.push('Isi minimal satu jumlah datang pada item yang benar-benar diterima.')

  const hasItemErrors = Object.values(itemErrors).some(e => Object.keys(e).length > 0)
  const valid = !hasItemErrors && globalErrors.length === 0
  return { itemErrors, itemComputed, globalErrors, schemaBlocks, summary, valid, recordable: valid && schemaBlocks.length === 0 }
}

// Rencana simpan: hanya item dengan datang > 0. prevCum = snapshot kumulatif
// SAAT FORM DIBUKA — dipakai untuk compare-and-swap saat menyimpan (idempotent).
export function buildSavePlan(rows, entries) {
  const plan = []
  for (const row of rows) {
    const d = toQty(entries?.[row.id]?.datang)
    if (isFinite(d) && d > EPS) {
      plan.push({ itemId: row.id, itemName: row.item_name, prevCum: row.prevCum, datang: d, newCum: row.prevCum + d })
    }
  }
  return plan
}

// Ringkasan daftar item untuk sel tabel Purchase (bahasa lapangan).
export function itemRingkas(items) {
  const list = items || []
  const names = list.map(it => String(it.item_name || '').trim()).filter(Boolean)
  const ringkas = names.length > 2
    ? `${names.slice(0, 2).join(', ')} +${names.length - 2} lainnya`
    : names.join(', ')
  return { count: list.length, names, ringkas }
}
