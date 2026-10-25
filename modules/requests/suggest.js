// ============================================================
// modules/requests/suggest.js — SARAN VENDOR & AUTOFILL ESTIMASI (jalur lean)
// ============================================================
// Arahan DAT (kartu t_a5a73034, brief Tahap A poin 2):
//   "Autofill estimasi dan saran vendor dari resolver/master existing.
//    Unknown tampil 'Belum ada acuan', bukan 0 gratis. Vendor bukan wajib
//    tahap request; saran dapat diabaikan dan toko aktual dipilih saat
//    belanja. Tidak mengarang vendor/harga aktual atau mengubah master
//    diam-diam."
//
// ATURAN (semua murni, tanpa query DB — data datang dari halaman):
//   1. Harga  : SATU sumber, resolver existing `makePrEstimator`
//               (modules/requests/estimator.js → modules/materials/acuan.js).
//               Tidak ada angka karangan: tanpa entri valid → price null,
//               `status: 'NO_ENTRY'` dan label "Belum ada acuan".
//   2. Vendor : HANYA dari master vendor yang benar-benar eligible untuk
//               kategori KANONIK material (aturan bisnis DAT t_ac0b39c0),
//               plus vendor yang benar-benar muncul di histori pembelian
//               material itu (kalau ada). Tidak ada vendor rekaan, tidak ada
//               "vendor pertama" sebagai tebakan.
//   3. Saran BUKAN pilihan: `suggestVendorsFor()` hanya mengembalikan
//               kandidat + alasan; ia TIDAK menulis `vendor_id` dan TIDAK
//               menjadikan vendor wajib. Toko aktual tetap dicatat di
//               modul Purchase saat nota dibuat.
//   4. Tidak mengubah master: fungsi di sini read-only terhadap argumen.
// ============================================================
import { makePrEstimator, eligibleVendors, isVendorEligible } from './estimator'

/**
 * Autofill estimasi satu material.
 * @returns {{
 *   status: 'OK'|'NO_ENTRY'|'UNKNOWN_MATERIAL',
 *   price: number|null, source: 'HISTORIS'|'MASTER'|'PR_ESTIMATE'|'NONE',
 *   vendor: string|null, date: string|null, unit: string,
 *   label: string, editable: true
 * }}
 * `label` = teks siap tampil. Tanpa acuan → "Belum ada acuan" (BUKAN Rp 0).
 */
export function estimateForMaterial(material, { estimator = null, vendorId = null, allPrItems = [], allReceivingItems = [], allReceivings = [], allVendors = [] } = {}) {
  const Est = estimator || makePrEstimator({ allPrItems, allReceivingItems, allReceivings, allVendors })
  const est = Est.estimateFor(material, { vendorId: vendorId || null })
  if (est.status !== 'OK' || est.price === null || !isFinite(est.price)) {
    return {
      status: est.status === 'UNKNOWN_MATERIAL' ? 'UNKNOWN_MATERIAL' : 'NO_ENTRY',
      price: null,
      source: 'NONE',
      vendor: null,
      date: null,
      unit: est.unit || '',
      label: est.status === 'UNKNOWN_MATERIAL' ? 'Material belum ada di master' : 'Belum ada acuan',
      editable: true
    }
  }
  return {
    status: 'OK',
    price: est.price,
    source: est.source,
    vendor: est.vendor || null,
    date: est.date || null,
    unit: est.unit || '',
    label: sourceLabel(est.source),
    editable: true
  }
}

export function sourceLabel(source) {
  if (source === 'HISTORIS') return 'Historis (harga beli aktual)'
  if (source === 'MASTER') return 'Acuan master material'
  if (source === 'PR_ESTIMATE') return 'Estimasi PR terdahulu (bukan harga beli)'
  return 'Belum ada acuan'
}

/**
 * Saran vendor untuk satu material.
 * Urutan: (a) vendor histori pembelian material ini (kalau ada & eligible),
 *         (b) vendor master yang eligible untuk kategori material.
 * Tidak ada vendor eligible → array kosong (UI menampilkan "Belum ada saran
 * vendor" — bukan memaksa memilih).
 *
 * @returns {Array<{id, name, reason, fromHistory:boolean, price?:number|null}>}
 */
export function suggestVendorsFor(material, { allVendors = [], estimator = null, limit = 5, allPrItems = [], allReceivingItems = [], allReceivings = [] } = {}) {
  if (!material?.id) return []
  const cat = String(material.category || '').trim()
  const Est = estimator || makePrEstimator({ allPrItems, allReceivingItems, allReceivings, allVendors })
  const byName = new Map((allVendors || []).map(v => [String(v.name || '').trim().toLowerCase(), v]))
  const out = []
  const seen = new Set()

  // (a) histori pembelian material ini — hanya entri HISTORIS (harga aktual).
  let entries = []
  try { entries = Est.entriesFor(material) || [] } catch { entries = [] }
  for (const e of entries) {
    if (e.source !== 'HISTORIS' || !e.vendor) continue
    const v = byName.get(String(e.vendor).trim().toLowerCase())
    if (!v || seen.has(v.id)) continue
    // Vendor histori tetap disarankan walau kategorinya kini tidak aktif:
    // ia benar-benar pernah membeli barang ini. Ditandai jujur di reason.
    seen.add(v.id)
    out.push({
      id: v.id,
      name: v.name,
      reason: `Pernah membeli material ini${e.date ? ` (${String(e.date).slice(0, 10)})` : ''}${cat && !isVendorEligible(v, cat) ? ' — kategori vendor kini tidak aktif' : ''}`,
      fromHistory: true,
      price: e.price ?? null
    })
  }

  // (b) vendor master eligible untuk kategori kanonik material.
  if (cat) {
    for (const v of eligibleVendors(allVendors, cat)) {
      if (!v?.id || seen.has(v.id)) continue
      seen.add(v.id)
      out.push({
        id: v.id,
        name: v.name,
        reason: `Kategori vendor aktif: ${cat}`,
        fromHistory: false,
        price: null
      })
      if (out.length >= limit) break
    }
  }
  return out.slice(0, limit)
}

/**
 * Saran vendor untuk SATU baris item PR (memakai material_id item).
 * Return [] bila material tidak dikenal — jangan menebak dari nama.
 */
export function suggestVendorsForItem(item, opts = {}) {
  const { allMaterials = [] } = opts
  if (!item?.material_id) return []
  const mat = (allMaterials || []).find(m => m.id === item.material_id)
  if (!mat) return []
  return suggestVendorsFor(mat, opts)
}
