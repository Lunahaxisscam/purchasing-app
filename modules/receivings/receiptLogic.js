// ============================================================
// modules/receivings/receiptLogic.js — logika murni form "Terima Barang"
// ============================================================
// TANPA React / TANPA query DB. Dipakai receiptForm.jsx dan diuji VERBATIM.
//
// KONTRAK DIMENSI (arahan DAT t_5196b689 + audit t_905e0e5a):
//   penerimaan (datang) ≠ kondisi (rusak) ≠ tujuan (WS/tukang) ≠ status retur
//   - baik          = datang − rusak
//   - sisa          = dipesan − sudah DATANG sebelumnya   (sebelum event ini)
//   - belum datang  = sisa − datang (setelah event ini)
//   - Σdatang kumulatif tidak boleh > dipesan (over-receipt DIBLOK)
//   - rusak ≤ datang; jumlah datang & rusak non-negatif.
//   - tujuan baik boleh dibagi Workshop / Tukang; total tujuan ≤ baik.
//   - barang ke Tukang WAJIB ada nama penerima.
//   - rusak: "Tentukan nanti" (default) / "Kembalikan ke Supplier" /
//     "Dibuang" (wajib centang konfirmasi; foto bukti OPSIONAL).
//
// ⚠️ SEMANTIK QTY (COMPATIBILITY_CUTOVER.md milik t_03b41644):
//   `prevCum` WAJIB dihitung dari `qty_arrived` (DATANG), BUKAN dari
//   `quantity_received` (BELI). Memakai quantity_received membuat nota yang
//   dibeli 10 tapi belum datang tampil "sudah diterima 10" → sisa 0 → barang
//   tidak bisa dibeli lagi. Baris dari view `v_receipt_progress` sudah
//   menyediakan qty_arrived; baris mentah `receiving_items` juga punya kolom
//   itu setelah migrasi 02.
// ============================================================

export const RETUR_NANTI = 'NANTI'       // tentukan nanti (default)
export const RETUR_SUPPLIER = 'SUPPLIER' // kembalikan ke supplier — MENUNGGU dikembalikan
export const RETUR_DIBUANG = 'DIBUANG'   // dibuang — butuh konfirmasi; foto opsional

const EPS = 1e-9

// Angka qty dari input teks. '' / null / undefined => 0. 'abc' => NaN.
export function toQty(v) {
  if (v === '' || v === null || v === undefined) return 0
  const n = Number(v)
  return isFinite(n) ? n : NaN
}

// Baris item untuk form: pesanan, kumulatif sudah DATANG, sisa.
// orderedFor(item) => number | null (null = tidak terhubung PR / qty tak diketahui)
export function buildRows(items, orderedFor) {
  return (items || []).map(it => {
    let ordered = null
    if (orderedFor) {
      const raw = orderedFor(it)
      const n = Number(raw)
      if (raw !== null && raw !== undefined && isFinite(n) && n > 0) ordered = n
    }
    // DATANG — bukan BELI. Lihat header.
    const arrivedRaw = toQty(it.qty_arrived)
    const prevCum = isFinite(arrivedRaw) && arrivedRaw > 0 ? arrivedRaw : 0
    const boughtRaw = toQty(it.quantity_received)
    return {
      id: it.id,
      prItemId: it.pr_item_id || null,
      item_name: it.item_name || '—',
      unit: it.unit || '',
      bought: isFinite(boughtRaw) ? boughtRaw : 0,
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
      // Foto bukti OPSIONAL — tidak memblokir transaksi. Konfirmasi TETAP wajib.
      if (!entry?.konfirmasiBuang) errs.konfirmasiBuang = 'Centang konfirmasi bahwa barang benar-benar dibuang.'
    }
  }
  return { errors: errs, computed: c, valid: Object.keys(errs).length === 0 }
}

// Ringkasan + validasi SELURUH form.
// `schemaBlocks` = dimensi yang dipilih user tapi belum bisa disimpan karena
// skema belum ada (mode LEGACY). Kosong = semua dimensi bisa disimpan.
export function validateForm(rows, entries, { ledgerReady = true } = {}) {
  const itemErrors = {}
  const globalErrors = []
  const schemaBlocks = []
  let hasQty = false
  for (const row of rows || []) {
    const entry = entries?.[row.id] || emptyEntry()
    const v = validateItem(row, entry)
    if (Object.keys(v.errors).length) itemErrors[row.id] = v.errors
    if (toQty(entry.datang) > EPS) hasQty = true
    if (!ledgerReady) {
      const r = toQty(entry.rusak)
      const ws = toQty(entry.ws)
      const tk = toQty(entry.tukang)
      if ((isFinite(r) && r > EPS) || (isFinite(ws) && ws > EPS) || (isFinite(tk) && tk > EPS)) {
        schemaBlocks.push(`"${row.item_name}" memakai kondisi/tujuan per barang yang belum punya tabel penyimpanan.`)
      }
    }
  }
  if (!hasQty && !schemaBlocks.length) {
    globalErrors.push('Isi minimal satu jumlah datang pada item yang benar-benar diterima.')
  }
  return {
    itemErrors,
    globalErrors,
    schemaBlocks,
    valid: globalErrors.length === 0 && Object.keys(itemErrors).length === 0
  }
}

// Rencana simpan per item: hanya baris dengan datang > 0.
export function buildSavePlan(rows, entries) {
  const out = []
  for (const row of rows || []) {
    const e = entries?.[row.id] || {}
    const d = toQty(e.datang)
    if (!isFinite(d) || d <= EPS) continue
    const r = toQty(e.rusak)
    const ws = toQty(e.ws)
    const tk = toQty(e.tukang)
    out.push({
      rowId: row.id,
      prItemId: row.prItemId,
      item_name: row.item_name,
      unit: row.unit,
      datang: d,
      rusak: isFinite(r) ? r : 0,
      ws: isFinite(ws) ? ws : 0,
      tukang: isFinite(tk) ? tk : 0,
      penerima: String(e.penerima || '').trim(),
      retur: e.retur || RETUR_NANTI,
      konfirmasiBuang: !!e.konfirmasiBuang,
      foto: e.foto || null
    })
  }
  return out
}

// Sisa pesanan per baris untuk validasi server-side (dipakai applyReceiptEvents).
export function sisaByIdOf(rows) {
  const out = {}
  for (const row of rows || []) {
    if (row.sisa !== null) out[row.id] = row.sisa
  }
  return out
}
