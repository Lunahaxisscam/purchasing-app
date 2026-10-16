// ============================================================
// modules/materials/acuan.js — RESOLVER ACUAN HARGA MATERIAL
// ============================================================
// Arahan DAT (t_090127ad): tampilan kolom Acuan Harga dipindah menjadi
// rincian expandable di bawah nama material. Rincian berisi per vendor:
// Vendor | Harga per satuan | Tanggal | Sumber (Historis/Manual).
//
// SUMBER DATA (skema existing — TIDAK ada tabel ledger harga, migrasi DB
// dibekukan DAT):
//   1. HISTORIS  — harga TEREALISASI dari pembelian nyata:
//        receiving_items (quantity_received > 0)
//          → pr_items (material_id, vendor_id, estimated_price, unit)
//          → receivings (vendor_id, received_date, status)
//      HANYA item yang benar-benar diterima fisik (qty > 0) dan penerimaan
//      yang TIDAK Retur/Refund/Rusak. Harga = pr_items.estimated_price
//      (harga satuan murni material yang dicatat saat PR diorder) — BUKAN
//      [Nominal] di note receivings (itu total nota, bisa mengandung
//      ongkir/admin) dan BUKAN estimasi PR yang tidak pernah diterima.
//      Relasi memakai FK pr_item_id — BUKAN pencocokan nama, jadi produk
//      dengan nama mirip tidak mungkin tercampur.
//   2. MASTER    — materials.harga_acuan yang sudah ada (diisi lewat form
//      material). TANPA tanggal & tanpa vendor: nilai existing tidak boleh
//      diberi timestamp/sejarah palsu (arahan tegas DAT).
//   3. MANUAL    — entri "Tambah Acuan" adalah PROTOTYPE di memori sesi
//      (state komponen), TIDAK tersimpan ke DB (lihat docs/material-acuan-
//      policy.md) — komponen yang memakainya wajib menandai "belum tersimpan".
//
// ATURAN SATUAN: entri historis hanya dihitung bila unit pr_items SAMA
// (case-insensitive, trim) dengan satuan master material. Tidak ada konversi
// (per Dus vs per Pcs tidak boleh dibandingkan tanpa faktor valid).
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
   * Semua entri acuan utk satu material, urut TERBARU dulu (historis),
   * entri master (harga_acuan existing) ditaruh paling akhir karena
   * tidak bertanggal — ia referensi berdiri, bukan kejadian pembelian.
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
      // 5) Harga satuan murni material dari pr_items (tanpa ongkir/admin —
      //    [Nominal] note penerimaan sengaja TIDAK dipakai).
      const price = validPrice(prItem.estimated_price)
      if (price === null) continue
      // 6) Satuan PR harus SAMA dgn satuan master material (tanpa konversi).
      const prUnit = String(prItem.unit ?? '').trim()
      if (!mUnit || !prUnit || normUnit(prUnit) !== normUnit(mUnit)) continue
      // 7) Vendor dari penerimaan; tanpa vendor → entri tetap valid (pembelian
      //    nyata) tapi ditandai "tidak dicatat" — bukan dikira-kira.
      const vendor = rec.vendor_id ? (vendorById.get(rec.vendor_id)?.name || '') : ''
      out.push({
        key: `hist-${ri.id}`,
        vendor: vendor || null,
        price,
        unit: mUnit,
        date: entryDate(rec),
        source: 'HISTORIS'
      })
    }

    // Urutkan historis terbaru dulu (ISO date string bisa dibanding langsung:
    // 'YYYY-MM-DD' vs 'YYYY-MM-DDTHH:mm:ss' urut benar antar & dalam hari).
    out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))

    // Entri MASTER: harga_acuan existing — TANPA tanggal & vendor yang di-invent.
    const masterPrice = validPrice(material.harga_acuan)
    if (masterPrice !== null) {
      out.push({
        key: 'master',
        vendor: null,
        price: masterPrice,
        unit: mUnit,
        date: null,
        source: 'MASTER'
      })
    }
    return out
  }

  /**
   * Entri acuan "terbaik" utk pemakaian lain (mis. estimator PR t_ac0b39c0 —
   * WAJIB memakai resolver yang sama agar konsisten): histori terbaru yang
   * eligible; fallback ke acuan master; null bila tidak ada sama sekali.
   */
  function bestEntry(material) {
    const entries = entriesFor(material)
    return entries.find(e => e.source === 'HISTORIS') || entries.find(e => e.source === 'MASTER') || null
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
