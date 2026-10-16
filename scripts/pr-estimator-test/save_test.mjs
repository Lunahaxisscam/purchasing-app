// ============================================================
// SAVE BOUNDARY PR (t_ac0b39c0) — modules/requests/save.js
// Mock supabase; verifikasi gate validasi & nilai tersimpan.
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const saveMod = await import(pathToFileURL(path.join(SB, 'dist/modules/requests/save.mjs')).href)
// PENTING: mock dipakai save.mjs via dist/lib (sandbox compile menyalin lib
// ke dist) — import instance YANG SAMA supaya rekaman __ops sinkron.
const supa = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const flush = () => new Promise(r => setTimeout(r, 0))

console.log('=== SAVE BOUNDARY: modules/requests/save.js ===\n')

const VENDORS = [
  { id: 'vHPL', name: 'Toko HPL Jaya', supplier_category: 'HPL & Edging' },
  { id: 'vPLY', name: 'Toko Plywood', supplier_category: 'Plywood & Board' }
]
const MATERIALS = [
  { id: 'mHPL1', kode: 'HPL-0001', name: 'HPL Cip', category: 'HPL & Edging', satuan: 'Lembar' },
  { id: 'mALM1', kode: 'ALM-0015', name: 'Frame Baleno', category: 'Aluminium & Profil', satuan: 'Meter' }
]

function makeCtx(prItemsList, overrides = {}) {
  return {
    page: 'requests',
    form: { project_id: 'p83', title: 'PR uji', pr_number: 'PR-001', priority: 'NORMAL', notes: '' },
    isEdit: false, editRow: null, editItems: [],
    prItemsList, nextPrNum: 'PR-001',
    allMaterials: MATERIALS, allVendors: VENDORS,
    allPrItems: [], allReceivingItems: [], allReceivings: [],
    say: (m) => notices.push(m), close: () => { closed = true }, refresh: () => { refreshed = true },
    setSaving: () => {},
    ...overrides
  }
}
let notices = []
let closed = false
let refreshed = false

function reset() { notices = []; closed = false; refreshed = false; supa.__reset() }
// --- 1. Gate validasi ---
console.log('1. Gate: qty/harga nonnegatif-finite & vendor eligible')
{
  reset()
  await saveMod.save(makeCtx([{ material_id: 'mHPL1', name: 'HPL', kode: 'HPL-0001', satuan: 'Lembar', qty: 0, estimated_price: '50.000', vendor_id: '' }]))
  await flush()
  check('qty 0 ditolak (pesan per item)', notices[0]?.includes('Qty') && notices[0]?.includes('harus angka lebih dari 0'), notices[0])
  check('tidak ada INSERT PR saat ditolak', supa.__opsView().every(o => o.op !== 'insert' || o.table !== 'purchase_requests'))

  reset()
  await saveMod.save(makeCtx([{ material_id: 'mHPL1', name: 'HPL', kode: 'HPL-0001', satuan: 'Lembar', qty: 2, estimated_price: '-5', vendor_id: '' }]))
  await flush()
  check('harga negatif ("-5") ditolak eksplisit', notices[0]?.includes('tidak valid') || notices[0]?.includes('negatif'), notices[0])

  reset()
  await saveMod.save(makeCtx([{ material_id: 'mHPL1', name: 'HPL', kode: 'HPL-0001', satuan: 'Lembar', qty: 2, estimated_price: 'abc', vendor_id: '' }]))
  await flush()
  // "abc" tanpa digit = tidak ada harga → diparse null (kosong), item tetap
  // boleh disimpan sbg "belum ada acuan" (bukan NaN, bukan 0). Yang DITOLAK
  // adalah negatif; kekosongan harga valid (estimasi boleh belum lengkap).
  const insAfter = supa.__opsView().filter(o => o.op === 'insert' && o.table === 'pr_items')
  check('harga "abc" (tanpa digit) → tersimpan sbg null (belum ada acuan), bukan NaN/0',
    notices[0]?.includes('berhasil dibuat') && insAfter[0]?.rows?.[0]?.estimated_price === null,
    JSON.stringify({ notice: notices[0], row: insAfter[0]?.rows?.[0] }))

  reset()
  // Vendor Plywood utk material HPL → tidak eligible
  await saveMod.save(makeCtx([{ material_id: 'mHPL1', name: 'HPL', kode: 'HPL-0001', satuan: 'Lembar', qty: 2, estimated_price: '50.000', vendor_id: 'vPLY' }]))
  await flush()
  check('vendor tidak eligible ditolak dgn pesan kategori', notices[0]?.includes('tidak aktif pada kategori') && notices[0]?.includes('HPL & Edging'), notices[0])
  check('pesan menyuruh aktifkan di modul Vendor / pilih vendor lain', notices[0]?.includes('Vendor'))

  reset()
  await saveMod.save(makeCtx([{ material_id: 'mHPL1', name: 'HPL', kode: 'HPL-0001', satuan: 'Lembar', qty: 2, estimated_price: '50.000', vendor_id: 'vHPL' }]))
  await flush()
  check('vendor eligible → save jalan (PR dibuat)', notices[0]?.includes('berhasil dibuat'), notices[0])
}

// --- 2. Nilai tersimpan ---
console.log('\n2. Nilai tersimpan: harga integer rupiah & tanpa metadata acuan liar')
{
  reset()
  await saveMod.save(makeCtx([
    { material_id: 'mHPL1', name: 'HPL', kode: 'HPL-0001', satuan: 'Lembar', qty: 3, estimated_price: '1.250.000', vendor_id: 'vHPL', supplier_category: 'HPL & Edging', est_source: 'HISTORIS', est_vendor: 'Toko HPL Jaya', est_date: '2026-10-12' },
    { material_id: 'mALM1', name: 'Frame', kode: 'ALM-0015', satuan: 'Meter', qty: 1, estimated_price: '', vendor_id: '' }
  ]))
  await flush()
  const itemIns = supa.__opsView().filter(o => o.op === 'insert' && o.table === 'pr_items')
  check('2 item diinsert', itemIns.length === 1 && itemIns[0].rows?.length === 2, JSON.stringify(supa.__opsView()))
  const rows = itemIns[0]?.rows || []
  check('harga "1.250.000" → 1250000 integer', rows[0]?.estimated_price === 1250000, String(rows[0]?.estimated_price))
  check('item tanpa harga → estimated_price null (bukan 0)', rows[1]?.estimated_price === null, String(rows[1]?.estimated_price))
  const keys = Object.keys(rows[0] || {})
  check('TIDAK ada kolom est_* liar (skema existing dijaga)', !keys.some(k => k.startsWith('est_')), keys.join(','))
  check('kolom sesuai skema: vendor_id & supplier_category tersimpan', 'vendor_id' in rows[0] && 'supplier_category' in rows[0])
}

// --- 3. Mode edit: snapshot dipertahankan ---
console.log('\n3. Mode edit: update item memakai harga tersimpan apa adanya')
{
  reset()
  const ctx = makeCtx([
    { id: 'piX', material_id: 'mHPL1', name: 'HPL', kode: 'HPL-0001', satuan: 'Lembar', qty: 4, estimated_price: '90.000', vendor_id: 'vHPL' }
  ], { isEdit: true, editRow: { id: 'prX', pr_number: 'PR-099' }, editItems: [{ id: 'piX', status: 'PENDING_APPROVAL' }] })
  await saveMod.save(ctx)
  await flush()
  const ups = supa.__opsView().filter(o => o.op === 'update' && o.table === 'pr_items')
  check('edit: update pr_items berjalan', ups.length === 1)
  check('edit: harga 90.000 tersimpan apa adanya (snapshot)', ups[0]?.row?.estimated_price === 90000, JSON.stringify(ups[0]?.row))
}

console.log(`\n=== HASIL SAVE: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA SAVE BOUNDARY LULUS')
