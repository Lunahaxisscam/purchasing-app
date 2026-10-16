// ============================================================
// modules/materials/acuan.js — RESOLVER ACUAN HARGA MATERIAL
// ============================================================
// Arahan DAT (t_090127ad): tampilan kolom Acuan Harga dipindah menjadi
// rincian expandable di bawah nama material. Rincian berisi per vendor:
// Vendor | Harga per satuan | Tanggal | Sumber (Historis/Manual).
//
// P1 DEFECT FIX (t_e88c28fb — temuan review Brooklyn): label HISTORIS/
// TEREALISASI TIDAK BOLEH memakai pr_items.estimated_price. Barang yang
// sudah diterima TIDAK membuktikan harga estimasi PR = harga beli aktual
// (nota bisa beda), dan vendor referensi PR bukan bukti pembelian nyata
// dari vendor itu. Mendorong estimated → "historic" menciptakan loop
// estimasi palsu: PR baru mengutip "histori" yang sebenarnya masih
// estimasi, lalu estimasi itu tersimpan dan menjadi "histori" lagi.
//
// SUMBER DATA (skema existing — TIDAK ada tabel ledger harga, migrasi DB
// dibekukan DAT):
//   Rantai satu-satunya harga riil: receiving_items (quantity_received > 0)
//     → pr_items (material_id, vendor_id, unit, harga) → receivings
//     (vendor_id, received_date, status).
//   KLASIFIKASI per provenance kolom harga pr_items:
//   1. HISTORIS    — harga beli AKTUAL TERVERIFIKASI dari nota/purchase
//                    line yang valid: kolom actual-unit-price pr_items
//                    (price_actual / actual_price / actual_unit_price /
//                    unit_price / price — dibaca urut prioritas).
//                    HANYA ini berhak berlabel ✅ HISTORIS PEMBELIAN.
//                    (Skema existing pr_items BELUM punya kolom actual —
//                    dicek read-only, t_e88c28fb. Bila tidak ada, kategori
//                    HISTORIS memang kosong; TIDAK ada fallback mengarang.)
//   2. MASTER      — materials.harga_acuan yang sudah ada (diisi lewat form
//                    material). TANPA tanggal & tanpa vendor: nilai existing
//                    tidak boleh diberi timestamp/sejarah palsu.
//   3. PR_ESTIMATE — hanya pr_items.estimated_price tersedia. Item SUDAH
//                    diterima, tapi harga ini tetap ESTIMASI PR terdahulu
//                    (bukan harga beli). Tampil sebagai kategori TERPISAH
//                    dengan badge jujur — TIDAK dipromosikan jadi actual,
//                    TIDAK diberi label terealisasi/histori pembelian.
//   4. MANUAL      — entri "Tambah Acuan" adalah PROTOTYPE di memori sesi
//                    (state komponen), TIDAK tersimpan ke DB (lihat docs/
//                    material-acuan-policy.md) — komponen yang memakainya
//                    wajib menandai "belum tersimpan".
//   TOTAL INVOICE BUKAN HARGA SATUAN: [Nominal] di note receivings adalah
//   total nota (bisa mengandung ongkir/admin) — SENGAJA tidak dipakai,
//   dan TIDAK boleh jadi fallback "harga aktual".
//
// ATURAN SATUAN: entri historis hanya dihitung bila unit pr_items SAMA
// (case-insensitive, trim) dengan satuan master material. Tidak ada konversi
// (per Dus vs per Pcs tidak boleh dibandingkan tanpa faktor valid).
//
// PROVENANCE: entri membawa provenance bacaan skema:
//   'actual'  = harga satuan aktual terverifikasi tersedia di skema.
//   'unknown' = harga yang terbaca masih estimasi PR (kolom actual tidak
//   ada di skema existing) — dipertahankan eksplisit, jangan mengaku.
// ============================================================

import { isReceivingKendala } from '../../lib/constants'

// Normalisasi satuan untuk perbandingan: trim + lowercase.
function normUnit(u) {
  return String(u ?? '').trim().toLowerCase()
}

// Satuan kanonik material: kolom `satuan` (fallback `unit` untuk data lama).
export function materialUnit(m) {
  return String(m?.satuan ?? m?.unit ?? '').trim()
}

// Angka harga valid: finite, bukan null/undefined/'', dan > 0.
export function validPrice(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return isFinite(n) && n > 0 ? n : null
}

// ============================================================
// HARGA AKTUAL TERVERIFIKASI (t_e88c28fb)
// ============================================================
// Satu-satunya kolom yang berhak melabeli entri HISTORIS PEMBELIAN:
// harga satuan AKTUAL hasil terima barang — terverifikasi dari nota atau
// purchase line yang valid. Dibaca dengan urutan prioritas kolom kandidat;
// kolom tidak ada / kosong / ≤ 0 → null (JANGAN mengarang).
// CATATAN SKEMA: `pr_items.estimated_price` SENGAJA TIDAK masuk daftar ini.
export function actualPurchasePrice(prItem) {
  if (!prItem) return null
  for (const k of ['price_actual', 'actual_price', 'actual_unit_price', 'unit_price', 'price']) {
    const p = validPrice(prItem[k])
    if (p !== null) return p
  }
  return null
}

// ============================================================
// URUTAN SUMBER (sortKey kecil = tampil lebih atas):
//   0 HISTORIS (harga beli aktual) < 1 MASTER (acuan master) <
//   2 PR_ESTIMATE (estimasi PR terdahulu) < 3 MANUAL (sesi, belum tersimpan)
// — Estimasi PR terdahulu SENGAJA di bawah MASTER: angka paling dapat
//   dipercaya tampil dulu, dan estimasi tidak menutupi acuan yang lebih
//   kuat (defect P1: estimasi tak boleh menyamar jadi pembelian aktual).
// ============================================================
export const ACUAN_SOURCE_RANK = { HISTORIS: 0, MASTER: 1, PR_ESTIMATE: 2, MANUAL: 3 }

// Urutan fallback bestEntry — dibaca by-name agar kompatibel dgn entri
// manual sesi (tanpa sortKey) dari komponen luar.
const SOURCE_RANK = (e) => (
  Number.isFinite(e?.sortKey) ? e.sortKey
    : (e?.source === 'PR_ESTIMATE' ? ACUAN_SOURCE_RANK.PR_ESTIMATE : ACUAN_SOURCE_RANK.HISTORIS)
)

export function makeAcuanHelpers({ allPrItems = [], allReceivingItems = [], allReceivings = [], allVendors = [] } = {}) {
  // Indeks O(1) — pola sama dengan itemHelpers.js (t_177c8715).
  const prItemById = new Map()
  for (const it of (allPrItems || [])) {
    if (it?.id) prItemById.set(it.id, it)
  }
  const recById = new Map()
  for (const rec of (allReceivings || [])) {
    if (rec?.id) recById.set(rec.id, rec)
  }
  const vendorById = new Map()
  for (const v of (allVendors || [])) {
    if (v?.id) vendorById.set(v.id, v)
  }

  // Tanggal entri: received_date (tanggal nota terima) jika ada, else created_at.
  const entryDate = (rec) => rec?.received_date || rec?.created_at || null

  /**
   * Semua entri acuan utk satu material, urut: HISTORIS (aktual, terbaru
   * dulu) → MASTER → PR_ESTIMATE (estimasi PR terdahulu, terbaru dulu).
   * Aman utk material apa pun (termasuk material tanpa histori sama sekali).
   */
  function entriesFor(material) {
    if (!material?.id) return []
    const mUnit = materialUnit(material)
    const out = []

    for (const ri of (allReceivingItems || [])) {
      // 1) Harus benar-benar diterima fisik (bukan baris otomatis yang belum
      //    diproses) — arahan: hanya pembelian/nota TEREALISASI.
      const qty = Number(ri?.quantity_received)
      if (!isFinite(qty) || qty <= 0) continue
      // 2) Item penerimaan harus terhubung ke baris item PR (FK, bukan nama).
      const prItem = ri?.pr_item_id ? prItemById.get(ri.pr_item_id) : null
      if (!prItem) continue
      // 3) Item PR itu harus benar-benar MILIK material ini.
      if (!prItem.material_id || prItem.material_id !== material.id) continue
      // 4) Penerimaan induk ada & bukan Retur/Refund/Rusak (bukan harga valid).
      const rec = ri?.receiving_id ? recById.get(ri.receiving_id) : null
      if (!rec) continue
      if (isReceivingKendala(rec.status)) continue
      // 5) Satuan PR harus SAMA dgn satuan master material (tanpa konversi).
      const prUnit = String(prItem.unit ?? '').trim()
      if (!mUnit || !prUnit || normUnit(prUnit) !== normUnit(mUnit)) continue
      // 6) Klasifikasi PROVENANCE harga (P1 t_e88c28fb):
      //    a) harga beli AKTUAL terverifikasi (nota/purchase line valid) →
      //       HISTORIS PEMBELIAN. Ini satu-satunya jalur label ✅ Historis.
      //    b) TANPA kolom aktual (atau kosong) tapi estimated_price ada →
      //       PR_ESTIMATE: barang diterima TIDAK membuat estimasi menjadi
      //       harga beli aktual — kategori terpisah, tidak dipromosikan.
      //    c) dua-duanya kosong → baris dilewati (tanpa harga = bukan acuan).
      //    TOTAL INVOICE ([Nominal] note) sengaja TIDAK dipakai dan TIDAK
      //    menjadi fallback harga aktual — itu total nota (bisa ada ongkir/
      //    admin), bukan harga satuan material. (Test eksplisit di harness.)
      const actual = actualPurchasePrice(prItem)
      let price = null
      let source = null
      if (actual !== null) {
        price = actual
        source = 'HISTORIS'
      } else {
        const est = validPrice(prItem.estimated_price)
        if (est !== null) {
          price = est
          source = 'PR_ESTIMATE'
        }
      }
      if (price === null || !source) continue
      // 7) Vendor dari penerimaan; tanpa vendor → entri tetap valid (pembelian
      //    nyata) tapi ditandai "tidak dicatat" — bukan dikira-kira.
      const vendor = rec.vendor_id ? (vendorById.get(rec.vendor_id)?.name || '') : ''
      out.push({
        key: `hist-${ri.id}`,
        vendor: vendor || null,
        price,
        unit: mUnit,
        date: entryDate(rec),
        source,
        sortKey: source === 'HISTORIS' ? ACUAN_SOURCE_RANK.HISTORIS : ACUAN_SOURCE_RANK.PR_ESTIMATE,
        // Provenance bacaan skema: 'actual' bila harga satuan aktual
        // tersedia, 'unknown' bila hanya estimasi PR yang bisa dibaca
        // (kolom actual tidak ada di skema existing — jangan mengaku).
        provenance: actual !== null ? 'actual' : 'unknown'
      })
    }

    // Entri MASTER: harga_acuan existing — TANPA tanggal & vendor yang di-invent.
    const masterPrice = validPrice(material.harga_acuan)
    if (masterPrice !== null) {
      out.push({
        key: 'master',
        vendor: null,
        price: masterPrice,
        unit: mUnit,
        date: null,
        source: 'MASTER',
        sortKey: ACUAN_SOURCE_RANK.MASTER,
        provenance: 'unknown'
      })
    }

    // Urutkan: kategori (aktual < master < estimasi PR) dulu, lalu terbaru
    // dulu di dalam kategori (ISO date string bisa dibanding langsung:
    // 'YYYY-MM-DD' vs 'YYYY-MM-DDTHH:mm:ss' urut benar antar & dalam hari).
    out.sort((a, b) => {
      const d = SOURCE_RANK(a) - SOURCE_RANK(b)
      if (d !== 0) return d
      return String(b.date || '').localeCompare(String(a.date || ''))
    })
    return out
  }

  /**
   * Entri acuan "terbaik" utk pemakaian lain (mis. estimator PR t_ac0b39c0 —
   * WAJIB memakai resolver yang sama agar konsisten): histori harga AKTUAL
   * terbaru yang eligible → acuan master → ESTIMASI PR TERDAHULU (kategori
   * paling akhir & selalu dilabeli eksplisit sbg estimasi — BUKAN pembelian
   * terealisasi) → null bila tidak ada sama sekali.
   */
  function bestEntry(material) {
    const entries = entriesFor(material)
    return entries.find(e => e.source === 'HISTORIS')
      || entries.find(e => e.source === 'MASTER')
      || entries.find(e => e.source === 'PR_ESTIMATE')
      || null
  }

  return { entriesFor, bestEntry, vendorById }
}

// Opsi satuan manual acuan — sama dgn daftar satuan di modules/materials/form.jsx.
export const ACUAN_SATUAN_OPTIONS = [
  'Lembar', 'Batang', 'Kaleng', 'Roll', 'Meter', 'Pcs', 'Box', 'Set',
  'Botol', 'Blek', 'Kg', 'Liter', 'Pasang', 'Kotak', 'Bungkus'
]

// Validasi entri manual (prototype, t_090127ad): vendor wajib, harga > 0,
// satuan wajib. Mengembalikan { ok, price, error } — error pesan Indonesia.
export function validateManualAcuan({ vendorId, harga, satuan } = {}) {
  if (!vendorId) return { ok: false, error: 'Pilih vendor dulu.' }
  const raw = String(harga ?? '').trim()
  // Harga harus nonnegatif — tanda minus/parenthesis ditolak eksplisit
  // (jangan hanya strip non-digit, nanti '-5' diam-diam jadi 5).
  if (/-/.test(raw) || /\(/.test(raw)) return { ok: false, error: 'Harga tidak boleh negatif.' }
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) return { ok: false, error: 'Isi harga per satuan (angka).' }
  const price = Number(digits)
  if (!isFinite(price) || price <= 0) return { ok: false, error: 'Harga harus angka lebih dari 0.' }
  if (!String(satuan ?? '').trim()) return { ok: false, error: 'Isi satuan harga.' }
  return { ok: true, price }
}
