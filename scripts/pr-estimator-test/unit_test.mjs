// ============================================================
// UNIT TEST ESTIMATOR PR (t_ac0b39c0) — modules/requests/estimator.js
// Data uji identik dgn material-acuan-test (sumber konsisten).
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const est = await import(pathToFileURL(path.join(SB, 'dist/modules/requests/estimator.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

console.log('=== UNIT: modules/requests/estimator.js ===\n')

const VENDORS = [
  { id: 'v1', name: 'Toko Baroni Jaya', supplier_category: 'HPL & Edging' },
  { id: 'v2', name: 'TB Makmur Sentosa', supplier_category: 'Plywood & Board' },
  { id: 'v3', name: 'Toko Kategori Lain', supplier_category: 'Bahan Habis Pakai' },
  { id: 'v4', name: 'Toko Tanpa Kategori', supplier_category: '' }
]
const MAT_HIST = { id: 'mHIST', kode: 'HPL-9001', name: 'Material Histori', category: 'HPL & Edging', satuan: 'Lembar', harga_acuan: null }
const MAT_MASTER = { id: 'mMASTER', kode: 'HPL-9002', name: 'Material Master', category: 'HPL & Edging', satuan: 'Lembar', harga_acuan: 175000 }
const MAT_KOSONG = { id: 'mKOSONG', kode: 'HPL-9003', name: 'Material Kosong', category: 'HPL & Edging', satuan: 'Lembar', harga_acuan: null }
const MAT_SATUAN = { id: 'mUNIT', kode: 'HPL-9004', name: 'Material Satuan Beda', category: 'HPL & Edging', satuan: 'Lembar', harga_acuan: null }
const MAT_HIST_V2 = { id: 'mH2', kode: 'HPL-9005', name: 'Histori dua vendor', category: 'HPL & Edging', satuan: 'Lembar', harga_acuan: null }

const PR_ITEMS = [
  { id: 'pi1', pr_id: 'prA', material_id: 'mHIST', unit: 'Lembar', quantity: 10, status: 'ORDERED', vendor_id: 'v1', estimated_price: 120000 },
  { id: 'pi2', pr_id: 'prA', material_id: 'mUNIT', unit: 'Dus', quantity: 2, status: 'ORDERED', vendor_id: 'v2', estimated_price: 999000 },
  { id: 'pi3', pr_id: 'prA', material_id: 'mH2', unit: 'Lembar', quantity: 4, status: 'ORDERED', vendor_id: 'v2', estimated_price: 200000, sort_order: 2 },
  { id: 'pi4', pr_id: 'prB', material_id: 'mH2', unit: 'Lembar', quantity: 6, status: 'ORDERED', vendor_id: 'v1', estimated_price: 150000, sort_order: 0 }
]
const RECEIVINGS = [
  { id: 'rc1', vendor_id: 'v1', status: 'NORMAL', received_date: '2026-10-12', created_at: '2026-10-12T02:00:00Z' },
  { id: 'rc2', vendor_id: 'v2', status: 'RETUR', received_date: '2026-10-13', created_at: '2026-10-13T02:00:00Z' },
  { id: 'rc3', vendor_id: 'v2', status: 'NORMAL', received_date: '2026-10-14', created_at: '2026-10-14T02:00:00Z' },
  { id: 'rc4', vendor_id: 'v1', status: 'NORMAL', received_date: '2026-10-15', created_at: '2026-10-15T02:00:00Z' }
]
const RECEIVING_ITEMS = [
  { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'pi1', quantity_received: 10 },
  { id: 'ri2', receiving_id: 'rc2', pr_item_id: 'pi2', quantity_received: 2 },
  { id: 'ri3', receiving_id: 'rc3', pr_item_id: 'pi3', quantity_received: 4 },
  { id: 'ri4', receiving_id: 'rc4', pr_item_id: 'pi4', quantity_received: 6 }
]

const E = est.makePrEstimator({ allPrItems: PR_ITEMS, allReceivingItems: RECEIVING_ITEMS, allReceivings: RECEIVINGS, allVendors: VENDORS })

// --- 1. estimateFor: histori > master > none; vendor diprioritaskan ---
console.log('1. estimateFor — histori terbaru, prioritas vendor, fallback master')
{
  const e1 = E.estimateFor(MAT_HIST)
  check('MAT_HIST: status OK, sumber HISTORIS', e1.status === 'OK' && e1.source === 'HISTORIS', JSON.stringify(e1))
  check('MAT_HIST: harga 120.000, vendor Toko Baroni Jaya, tgl 2026-10-12',
    e1.price === 120000 && e1.vendor === 'Toko Baroni Jaya' && String(e1.date).startsWith('2026-10-12'))
  check('MAT_HIST: unit mengikuti satuan material (Lembar)', e1.unit === 'Lembar')

  // Histori dua vendor: terbaru = v1 (2026-10-15, 150.000) → tanpa vendor pakai terbaru
  const latest = E.estimateFor(MAT_HIST_V2)
  check('MAT_H2 tanpa vendor: histori TERBARU (150.000 dari v1, 15 Okt)', latest.price === 150000 && latest.vendor === 'Toko Baroni Jaya')
  const byV2 = E.estimateFor(MAT_HIST_V2, { vendorId: 'v2' })
  check('MAT_H2 vendor v2: HISTORIS v2 (200.000, 14 Okt) diprioritaskan', byV2.price === 200000 && byV2.vendor === 'TB Makmur Sentosa')
  const byUnknown = E.estimateFor(MAT_HIST_V2, { vendorId: 'vNOPE' })
  check('MAT_H2 vendor tak dikenal: fallback histori terbaru (150.000)', byUnknown.price === 150000)

  const em = E.estimateFor(MAT_MASTER)
  check('MAT_MASTER: fallback MASTER 175.000 tanpa vendor/tanggal', em.status === 'OK' && em.source === 'MASTER' && em.price === 175000 && em.vendor === null && em.date === null)

  const ek = E.estimateFor(MAT_KOSONG)
  check('MAT_KOSONG: NO_ENTRY, price null (BUKAN 0)', ek.status === 'NO_ENTRY' && ek.price === null)
  const eu = E.estimateFor(MAT_SATUAN)
  check('MAT_UNIT: satuan PR (Dus) ≠ material (Lembar) → NO_ENTRY (tanpa konversi)', E.estimateFor(MAT_SATUAN).status === 'NO_ENTRY')
  const eX = E.estimateFor({})
  check('material tanpa id: UNKNOWN_MATERIAL aman', eX.status === 'UNKNOWN_MATERIAL' && eX.price === null)
}

// --- 2. Eligibility vendor ---
console.log('\n2. Eligibility — kategori kanonik master material vs master Vendor')
{
  check('v1 (HPL & Edging) eligible utk kategori HPL & Edging', est.isVendorEligible(VENDORS[0], 'HPL & Edging'))
  check('v1 TIDAK eligible utk Plywood & Board', !est.isVendorEligible(VENDORS[0], 'Plywood & Board'))
  check('vendor tanpa kategori TIDAK otomatis eligible', !est.isVendorEligible(VENDORS[3], 'HPL & Edging'))
  check('material tanpa kategori: tidak ada vendor eligible', !est.isVendorEligible(VENDORS[0], ''))
  check('cocok case-insensitive + trim', est.isVendorEligible({ supplier_category: ' hpl & edging ' }, 'HPL & Edging'))
  const elig = est.eligibleVendors(VENDORS, 'HPL & Edging')
  check('eligibleVendors: hanya v1', elig.length === 1 && elig[0].id === 'v1')
  // Kategori rencana beli (supplier_category item) TIDAK dipakai mengakali:
  // item ALM-0015 kategori rencana 'HPL & Edging' tapi master 'Aluminium & Profil'
  const matAlm = { id: 'mALM', category: 'Aluminium & Profil', satuan: 'Meter', harga_acuan: null }
  const eligAlm = est.eligibleVendors(VENDORS, matAlm.category)
  check('kategori pembanding = master material (Alm → bukan vendor HPL)', eligAlm.length === 0)
  void matAlm

  // Steer DAT terbaru: SATU VENDOR BISA MULTI KATEGORI — kategori vendor
  // scalar existing tetap didukung; array (bila skema disetujui) dihitung
  // keanggotaan (salah satu kategori aktif = eligible).
  const multi = { id: 'vMULTI', supplier_category: 'HPL & Edging', supplier_categories: ['HPL & Edging', 'Aluminium & Profil'] }
  check('multi-kategori: eligible di HPL & Edging', est.isVendorEligible(multi, 'HPL & Edging'))
  check('multi-kategori: eligible di Aluminium & Profil', est.isVendorEligible(multi, 'Aluminium & Profil'))
  check('multi-kategori: TIDAK eligible di Plywood & Board', !est.isVendorEligible(multi, 'Plywood & Board'))
  const multiList = est.eligibleVendors([...VENDORS, multi], 'Aluminium & Profil')
  check('eligibleVendors multi: hanya vendor array yang cocok', multiList.length === 1 && multiList[0].id === 'vMULTI')
  check('vendorActiveCategories scalar → [kategori]', JSON.stringify(est.vendorActiveCategories(VENDORS[0])) === '["hpl & edging"]')
  check('vendorActiveCategories tanpa kategori → []', est.vendorActiveCategories(VENDORS[3]).length === 0)
  const jsonVendor = { supplier_categories: '["HPL & Edging","Bahan Habis Pakai"]' }
  check('vendorActiveCategories terima JSON string array (tahan data lama)', est.isVendorEligible(jsonVendor, 'Bahan Habis Pakai') && !est.isVendorEligible(jsonVendor, 'Plywood & Board'))
  const badJson = { supplier_categories: '[rusak' }
  check('JSON string rusak → fallback scalar (kosong → tidak eligible)', !est.isVendorEligible(badJson, 'HPL & Edging'))
}

// --- 3. parsePriceValue & totals ---
console.log('\n3. parsePriceValue & prEstimateTotals — tanpa NaN/minus/0 palsu')
{
  check('"1.250.000" → 1250000', est.parsePriceValue('1.250.000') === 1250000)
  check('number 45000 → 45000', est.parsePriceValue(45000) === 45000)
  check('"" → null', est.parsePriceValue('') === null)
  check('"abc" → null', est.parsePriceValue('abc') === null)
  check('"-5" → null (minus ditolak eksplisit)', est.parsePriceValue('-5') === null)
  check('"(5)" → null (parenthesis ditolak)', est.parsePriceValue('(5)') === null)
  check('-5 number → null', est.parsePriceValue(-5) === null)
  check('NaN → null', est.parsePriceValue(NaN) === null)
  check('0 → 0 (harga 0 dari user diizinkan sbg input, total tetap jujur)', est.parsePriceValue(0) === 0)

  const items = [
    { qty: 2, estimated_price: '50.000' },   // 100.000
    { qty: 3, estimated_price: '10.000' },   // 30.000
    { qty: 1, estimated_price: '' },          // belum ada acuan
    { qty: 2, estimated_price: null }         // belum ada acuan
  ]
  const t = est.prEstimateTotals(items)
  check('total = 130.000 (item tanpa harga TIDAK dihitung 0)', t.total === 130000, JSON.stringify(t))
  check('unknown = 2, complete false', t.unknown === 2 && !t.complete)
  check('kosong: hasItems false, complete false', (() => { const z = est.prEstimateTotals([]); return !z.hasItems && !z.complete && z.total === 0 })())
  const tAll = est.prEstimateTotals([{ qty: 2, estimated_price: '50.000' }])
  check('semua berharga: complete true', tAll.complete && tAll.unknown === 0)
  const tBad = est.prEstimateTotals([{ qty: 'abc', estimated_price: '50.000' }])
  check('qty invalid → item dianggap belum lengkap (bukan 0)', !tBad.complete && tBad.unknown === 1 && tBad.total === 0)
  const tRound = est.prEstimateTotals([{ qty: 3, estimated_price: 10000.4 }])
  check('pembulatan rupiah (30001.2 → 30001)', tRound.total === 30001, String(tRound.total))
}

console.log(`\n=== HASIL UNIT: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA UNIT ESTIMATOR LULUS')
