// ============================================================
// modules/requests/estimator.js — ESTIMATOR HARGA PR (t_ac0b39c0)
// ============================================================
// Lanjutan parent t_090127ad: sumber harga di-resolve lewat resolver yang
// SAMA dgn modul Material (makeAcuanHelpers di modules/materials/acuan.js)
// agar angka acuan konsisten di seluruh aplikasi. Tidak ada sumber lain.
//
// SUMBER (skema existing — TANPA migrasi DB, freeze DAT tetap berlaku):
//   1. HISTORIS — harga beli AKTUAL TERVERIFIKASI (nota/purchase line
//      valid) dari receiving_items qty>0 → pr_items → receivings,
//      satuan sama, tanpa ongkir/admin. (P1 t_e88c28fb: kolom harga
//      aktual tidak ada di skema existing — kategori ini hanya terisi
//      begitu skema actual tersedia; TIDAK pernah memakai estimated_price.)
//   2. MASTER   — materials.harga_acuan existing (tanpa tanggal/vendor).
//   3. PR_ESTIMATE — harga dari estimasi PR terdahulu yang barangnya
//      sudah diterima. BUKAN harga pembelian aktual (t_e88c28fb):
//      barang diterima TIDAK membuktikan estimasi = harga beli, dan
//      vendor referensi PR bukan bukti actual supplier. HANYA dipakai
//      sbg fallback paling akhir & SELALU berlabel "Estimasi PR terdahulu".
//   4. MANUAL   — di konteks PR, "manual" = harga yang DIKETIK USER di form
//      (pr_items.estimated_price). Entri "Tambah Acuan" prototype modul
//      Material (memori sesi, belum tersimpan) SENGAJA tidak dipakai di sini
//      — estimator hanya memakai sumber yang benar-benar tersimpan.
//
// ATURAN ARAHAN DAT (steer t_ac0b39c0):
//   - Estimasi otomatis terisi SAAT item dipilih/ditambahkan; item tanpa
//     sumber valid dibiarkan kosong + label "Belum ada acuan" — TIDAK
//     PERNAH diisi 0 palsu.
//   - Vendor rencana beli dipilih → entri HISTORIS vendor itu (satuan sama)
//     diprioritaskan; jika vendor belum dipilih → acuan terbaru yang valid
//     + vendor sumber ditampilkan. Vendor referensi TIDAK otomatis menjadi
//     vendor pesanan. Prioritas vendor hanya menyaring kategori HISTORIS
//     (harga aktual) — TIDAK pernah mempromosikan estimasi PR sebagai
//     "pembelian dari vendor itu" (P1 t_e88c28fb).
//   - Input user (override) tidak pernah ditimpa diam-diam; ganti vendor
//     hanya menghitung ulang bila harga belum milik user.
//   - Satuan beda tidak dikonversi tanpa faktor valid (unit mismatch =
//     tidak mengisi otomatis).
//   - Snapshot: hanya pr_items.estimated_price yang tersimpan. Sumber/
//     vendor/tanggal acuan BELUM tersimpan ke DB (lihat
//     docs/pr-estimasi-policy.md) — reopening PR TIDAK menghitung ulang
//     dari histori terbaru; harga tersimpan dipertahankan apa adanya.
// ============================================================
import { makeAcuanHelpers, materialUnit, validPrice } from '../materials/acuan'

// Normalisasi kategori utk pencocokan eligibility: trim + lowercase.
const normCat = (s) => String(s ?? '').trim().toLowerCase()

// ============================================================
// ELIGIBILITY VENDOR (arahan bisnis DAT di task t_ac0b39c0 + steer multi-kategori)
// ============================================================
// Vendor eligible utk kategori material BILA kategori itu termasuk SALAH
// SATU kategori aktif vendor. Kategori vendor dibaca dari master Vendor:
//   - existing: vendors.supplier_category (scalar text) → 1 kategori.
//   - bila DAT menyetujui skema array (supplier_categories text[]) →
//     semua elemen array dihitung (kompatibel otomatis, tanpa ubah kode).
// Vendor TANPA kategori aktif TIDAK otomatis boleh (arahan: "missing ≠
// semua boleh"), dan material tanpa kategori juga tidak membuka semua
// vendor. Kategori pembanding SELALU kategori kanonik master material
// (materials.category) — bukan pilihan bebas user di form, agar izin tidak
// bisa "diakali" lewat dropdown.
export function vendorActiveCategories(vendor) {
  // Array (opsi skema mendatang) → salin string aktif
  if (Array.isArray(vendor?.supplier_categories)) {
    return vendor.supplier_categories.map(c => normCat(c)).filter(Boolean)
  }
  // JSON string array (bila disimpan jsonb string) — tahan data lama
  if (typeof vendor?.supplier_categories === 'string' && vendor.supplier_categories.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(vendor.supplier_categories)
      if (Array.isArray(arr)) return arr.map(c => normCat(c)).filter(Boolean)
    } catch { /* bukan JSON — abaikan */ }
  }
  // Scalar existing
  const one = normCat(vendor?.supplier_category)
  return one ? [one] : []
}

export function isVendorEligible(vendor, category) {
  const mc = normCat(category)
  if (!mc) return false
  return vendorActiveCategories(vendor).includes(mc)
}

export function eligibleVendors(allVendors = [], category = '') {
  return (allVendors || []).filter(v => isVendorEligible(v, category))
}

// ============================================================
// PARSE HARGA / TOTAL ESTIMASI
// ============================================================
// Nilai harga valid utk estimasi: nonnegative & finite. String berformat
// ("1.250.000") maupun number diterima. Tanda minus/parenthesis ditolak
// EKSPLISIT (jangan strip non-digit dulu — '-5' tidak boleh diam-diam
// jadi 5). Hasil null = tidak ada harga (BUKAN nol).
export function parsePriceValue(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? v : null
  const raw = String(v)
  if (/[-(]/.test(raw)) return null
  const digits = raw.replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

/**
 * Total estimasi satu PR dari daftar item form.
 * item: { qty, estimated_price } — estimated_price string berformat/number.
 * Return:
 *   total    — pembulatan rupiah dari Σ qty × harga satuan (item tanpa
 *              harga TIDAK dianggap 0 — ia dihitung terpisah).
 *   unknown  — jumlah item belum punya harga/acuan.
 *   hasItems — true bila ada item sama sekali.
 *   complete — true bila semua item punya harga.
 */
export function prEstimateTotals(items) {
  let total = 0
  let unknown = 0
  const list = items || []
  for (const it of list) {
    const price = parsePriceValue(it?.estimated_price)
    const qty = Number(it?.qty)
    // Harga ATAU qty tidak valid → item dianggap "belum lengkap" (bukan 0).
    if (price === null || !isFinite(qty) || qty <= 0) { unknown++; continue }
    total += qty * price
  }
  return {
    total: Math.round(total),
    unknown,
    hasItems: list.length > 0,
    complete: list.length > 0 && unknown === 0
  }
}

// ============================================================
// ESTIMATOR
// ============================================================
export function makePrEstimator({ allPrItems = [], allReceivingItems = [], allReceivings = [], allVendors = [] } = {}) {
  // Resolver satu sumber — SAMA dgn modul Material (t_090127ad).
  const A = makeAcuanHelpers({ allPrItems, allReceivingItems, allReceivings, allVendors })

  const NO_ENTRY = { status: 'NO_ENTRY', price: null, source: 'NONE', vendor: null, date: null, unit: '' }

  /**
   * Acuan terbaik utk satu material.
   * @param material  baris master material (butuh .id)
   * @param opts.vendorId  vendor rencana beli (opsional) — HISTORIS vendor
   *   itu diprioritaskan (material+unit sudah dijaga resolver). P1
   *   t_e88c28fb: prioritas vendor HANYA berlaku utk kategori HISTORIS
   *   (harga aktual) — estimasi PR tidak pernah mewakili "pembelian dari
   *   vendor itu".
   * Return { status, price, source, vendor, date, unit }:
   *   status 'OK'               — ada acuan (price bisa > 0)
   *   status 'NO_ENTRY'         — belum ada acuan (JANGAN dianggap 0)
   *   status 'UNKNOWN_MATERIAL' — material tidak ada di master (data lama)
   * source:
   *   'HISTORIS'    — harga beli AKTUAL terverifikasi (satu-satunya sumber
   *                    yang boleh berlabel "Historis/Terealisasi")
   *   'MASTER'      — acuan master material (tanpa tanggal/vendor)
   *   'PR_ESTIMATE' — harga estimasi PR terdahulu (fallback paling akhir;
   *                    WAJIB ditampilkan sbg estimasi, BUKAN harga beli)
   * price null pada NO_ENTRY/UNKNOWN_MATERIAL — penelepon wajib memperlakukan
   * null sebagai "Belum ada acuan", bukan 0.
   */
  function estimateFor(material, { vendorId = null } = {}) {
    if (!material?.id) return { ...NO_ENTRY, status: 'UNKNOWN_MATERIAL' }
    const unit = materialUnit(material)
    const entries = A.entriesFor(material)

    // 1) Prioritas: HISTORIS (harga aktual) dari vendor terpilih (satuan
    //    sama — dijaga resolver). P1 t_e88c28fb: vendor HANYA memfilter
    //    kategori aktual; estimasi PR tidak jadi "pembelian vendor itu".
    let pick = null
    if (vendorId) {
      const vName = A.vendorById.get(vendorId)?.name || null
      if (vName) pick = entries.find(e => e.source === 'HISTORIS' && e.vendor === vName) || null
    }
    // 2) Acuan terbaik yang valid: histori aktual terbaru → master →
    //    estimasi PR terdahulu (kategori paling akhir, diberi label jujur).
    if (!pick) pick = A.bestEntry(material)

    if (!pick || validPrice(pick.price) === null) return { ...NO_ENTRY, unit }
    return {
      status: 'OK',
      price: pick.price,
      source: pick.source,   // 'HISTORIS' | 'MASTER' | 'PR_ESTIMATE'
      vendor: pick.vendor,   // null utk MASTER / PR_ESTIMATE / histori tanpa vendor
      date: pick.date,
      unit: pick.unit || unit
    }
  }

  return { estimateFor, entriesFor: A.entriesFor, bestEntry: A.bestEntry, vendorById: A.vendorById }
}
