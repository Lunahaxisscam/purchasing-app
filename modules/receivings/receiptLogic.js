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
//
// BATAS ATAS KEDATANGAN = QTY BELI BARIS INI (`quantity_received`), BUKAN qty
// pesanan PR (defect run 199):
//   1) Baris cangkang Approval ber-qty BELI 0 = barang BELUM DIBELI. Menawarkan
//      baris itu membuat admin mencatat kedatangan barang yang tidak pernah
//      dibeli (di data live 6 dari 6 baris ber-qty 0). Baris seperti ini
//      ditandai `notBought` dan TIDAK boleh diisi.
//   2) Nota yang membeli 3 dari pesanan 5 hanya boleh menerima 3. Memakai qty
//      pesanan membuat DATANG (5) > BELI (3) lolos ke RPC.
//   3) Baris beli langsung tanpa PR (`pr_item_id` null) tidak punya pesanan;
//      tanpa batas BELI, over-receipt sama sekali tidak dicek.
// Bila `quantity_received` NULL (baris lama yang qty belinya tidak tercatat),
// batas memakai qty pesanan dan baris diberi `boughtKnown:false` supaya UI bisa
// mengatakannya apa adanya — bukan menebak 0 (yang akan menyembunyikan barang).
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
    const rawBought = it.quantity_received
    const boughtKnown = rawBought !== null && rawBought !== undefined && rawBought !== ''
    const boughtRaw = toQty(rawBought)
    const bought = boughtKnown && isFinite(boughtRaw) ? boughtRaw : null
    const notBought = boughtKnown && isFinite(boughtRaw) && boughtRaw <= EPS
    // Batas atas = BELI (kalau diketahui), selain itu qty pesanan.
    const basis = boughtKnown && isFinite(boughtRaw) ? boughtRaw : ordered
    return {
      id: it.id,
      prItemId: it.pr_item_id || null,
      item_name: it.item_name || '—',
      unit: it.unit || '',
      bought,
      boughtKnown,
      notBought,
      ordered,
      prevCum,
      basis,
      sisa: basis === null ? null : Math.max(0, basis - prevCum)
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
  // Sisa dihitung dari BASIS baris (qty BELI bila diketahui, selain itu qty
  // pesanan) — bukan selalu qty pesanan (defect run 199).
  const basis = row.basis !== undefined ? row.basis : row.ordered
  const belum = basis === null || basis === undefined ? null : Math.max(0, basis - row.prevCum - datangN)
  const tujuan = (isFinite(ws) ? ws : 0) + (isFinite(tk) ? tk : 0)
  return { d, r, ws, tk, baik, belum, tujuan }
}

// Validasi satu item. Mengembalikan { errors, computed, valid }.
export function validateItem(row, entry) {
  const c = computeItem(row, entry)
  const errs = {}
  const d = c.d
  const r = c.r
  // Barang yang BELUM DIBELI tidak boleh dicatat datang (defect run 199):
  // baris cangkang Approval ber-qty BELI 0 tampil di form dengan sisa = qty
  // pesanan, dan RPC menerima kedatangannya → DATANG tanpa BELI.
  if (row.notBought && isFinite(d) && d > EPS) {
    errs.datang = 'Barang ini belum dibeli pada nota mana pun (qty beli 0). Catat pembeliannya dulu di modul Pembelian — kedatangan tidak boleh mendahului pembelian.'
    return { errors: errs, computed: c, valid: false }
  }
  if (!isFinite(d) || d < 0) errs.datang = 'Jumlah datang harus angka ≥ 0.'
  if (!isFinite(r) || r < 0) errs.rusak = 'Jumlah rusak harus angka ≥ 0.'
  if (!errs.datang && !errs.rusak && r > d + EPS) {
    errs.rusak = `Jumlah rusak tidak boleh lebih dari jumlah datang (${r} > ${d}).`
  }
  if (!errs.datang && row.sisa !== null && isFinite(d) && d > row.sisa + EPS) {
    errs.datang = row.boughtKnown
      ? `Melebihi jumlah yang dibeli pada nota ini (sisa ${row.sisa}${row.unit ? ' ' + row.unit : ''}). Kedatangan tidak boleh melebihi pembelian.`
      : `Melebihi sisa pesanan (sisa ${row.sisa}${row.unit ? ' ' + row.unit : ''}). Over-receipt belum diizinkan — periksa jumlah.`
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
  } else if (!errs.rusak && isFinite(r) && r <= EPS) {
    // DEFECT run 199: pilihan retur untuk barang dengan rusak 0 membuat event
    // terkirim `PENDING/DISCARDED` dengan `retur_qty 0` → RPC
    // `receipt_apply_events` MENOLAK `retur_without_qty`. Admin melihat tombol
    // Simpan aktif lalu selalu gagal. Ditolak di sini dengan instruksi jelas.
    const retur = entry?.retur || RETUR_NANTI
    if (retur !== RETUR_NANTI) {
      errs.retur = 'Tidak ada jumlah rusak yang diisi, jadi tidak ada barang untuk diretur/dibuang. Isi jumlah rusak, atau pilih "Tentukan nanti".'
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
    // Baris yang belum dibeli tidak pernah masuk rencana simpan (defect run
    // 199) — pengaman kedua setelah validateItem, supaya pemanggil yang lupa
    // memeriksa `valid` tetap tidak bisa mengirimnya.
    if (row.notBought) continue
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
