// ============================================================
// scripts/project-cost-link-test/breakdown_test.mjs
// Uji NYATA lib/projectCostBreakdown.js (Tahap B) — fixture sintetis labelled.
// ============================================================
// Yang dibuktikan:
//   K1 identitas proyek lewat NOMOR (bukan fuzzy nama)
//   K2 baris upah tanpa nomor/alias -> ember "belum terhubung", BUKAN proyek lain
//   K3 identitas konflik (kode vs code) -> ditahan, tidak menjadi biaya proyek
//   K4 satu nota lintas proyek dialokasikan per baris (bukan total header)
//   K5 baris nota tanpa proyek -> unassigned, tidak dibebankan
//   K6 baris nota tanpa harga -> tidak dihitung 0, dilaporkan
//   K7 upah = hak tercatat; kasbon/pelunasan tidak menambah biaya; saldo null
//   K8 PROJECT SUMMARY hanya pembanding, tidak menambah biaya
//   K9 tidak ada revenue/rasio/margin final (masih HOLD)
//
// Jalankan: node scripts/project-cost-link-test/breakdown_test.mjs <SANDBOX>
// (sandbox berisi lib/ salinan verbatim; lihat run.py)
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SANDBOX = process.argv[2] || process.cwd()
const mod = await import(pathToFileURL(path.join(SANDBOX, 'lib/projectCostBreakdown.mjs')).href)
const { buildCostBreakdown } = mod

let pass = 0
const fails = []
async function t(name, fn) {
  try {
    await fn()
    pass += 1
  } catch (e) {
    fails.push(`${name}: ${e.message}`)
  }
}

// ---------------- fixture SINTETIS (bukan transaksi nyata) ----------------
const PROJECTS = [
  { id: 'p-83', name: 'Sintetis Josh - Mabes', status: 'ON_GOING', kode: '83', code: '83' },
  { id: 'p-99', name: 'Sintetis Santi - Baroni', status: 'DONE', kode: '99', code: '99' },
  { id: 'p-55', name: 'Sintetis Konflik', status: 'ON_GOING', kode: '55', code: '56' }
]
const VENDORS = [{ id: 'v-1', name: 'Toko Uji A' }]
const RECEIVINGS = [
  { id: 'r-1', invoice_no: 'INV/001', vendor_id: 'v-1', received_date: '2026-10-01', project_id: 'p-83', note: '[Tahap: DIBELI]' },
  { id: 'r-2', invoice_no: 'INV/002', vendor_id: 'v-1', received_date: '2026-10-02', project_id: null, note: '[Tahap: DIBELI]' }
]
const RECEIVING_ITEMS = [
  // Satu nota (r-1) dipakai dua proyek — alokasi per baris.
  { id: 'ri-1', receiving_id: 'r-1', project_id: 'p-83', item_name: 'Semen', unit: 'sak', quantity_received: 2, note: '[Harga: 50000]' },
  { id: 'ri-2', receiving_id: 'r-1', project_id: 'p-99', item_name: 'Pasir', unit: 'm3', quantity_received: 1, note: '[Harga: 300000]' },
  // Baris tanpa proyek -> unassigned
  { id: 'ri-3', receiving_id: 'r-2', project_id: null, item_name: 'Lem', unit: 'pcs', quantity_received: 3, note: '[Harga: 20000]' },
  // Baris tanpa harga -> tidak dihitung 0
  { id: 'ri-4', receiving_id: 'r-2', project_id: 'p-83', item_name: 'Sekrup', unit: 'pcs', quantity_received: 10, note: '' }
]
const LABOR = [
  // Nomor benar walau nama tidak sama -> matched lewat nomor
  { tukang_key: 't-1', project_no: '83', project_name: 'nama sumber berbeda', total_upah: 1000000 },
  // Hanya nama mirip, tanpa nomor & tanpa alias -> TIDAK boleh masuk proyek
  { tukang_key: 't-2', project_name: 'Josh - Mabes', total_upah: 500000 },
  // Identitas konflik -> ditahan
  { tukang_key: 't-3', project_no: '55', total_upah: 750000 },
  // Operasional WS
  { tukang_key: 't-4', project_no: 'operasional ws', total_upah: 250000 }
]
const SUMMARY = [
  { project_no: '83', cumulative_cost: 1080000 },
  { project_no: '99', cumulative_cost: 300000 }
]

const bd = buildCostBreakdown({
  projects: PROJECTS,
  laborRows: LABOR,
  receivings: RECEIVINGS,
  receivingItems: RECEIVING_ITEMS,
  vendors: VENDORS,
  summaryRows: SUMMARY,
  aliasRows: []
})

await t('K1 upah: nomor proyek dipakai, nama yang berbeda tidak menghalangi', () => {
  const p83 = bd.forProject('83')
  assert.ok(p83, 'proyek 83 harus ada')
  assert.equal(p83.labor.entitlement, 1000000)
  assert.equal(p83.labor.rows, 1)
})

await t('K2 upah: baris tanpa nomor/alias tidak dibebankan ke proyek bernama mirip', () => {
  const p83 = bd.forProject('83')
  assert.equal(p83.labor.entitlement, 1000000, 'upah 500.000 tidak boleh ikut ke proyek 83')
  assert.equal(bd.unmappedLabor.total, 500000 + 250000, 'termasuk operasional ws')
  assert.ok(bd.unmappedLabor.rows.some(r => r.label === 'Josh - Mabes'))
  assert.ok(bd.gaps.some(g => g.code === 'labor_rows_without_project_number'))
})

await t('K3 identitas konflik ditahan, bukan jadi biaya proyek', () => {
  assert.equal(bd.forProject('55'), null, 'proyek konflik tidak boleh punya biaya')
  assert.equal(bd.unmappedLabor.identityConflict.length, 1)
  assert.equal(bd.unmappedLabor.identityConflict[0].amount, 750000)
})

await t('K4 satu nota lintas proyek dibagi per baris (bukan total header)', () => {
  const p83 = bd.forProject('83')
  const p99 = bd.forProject('99')
  assert.equal(p83.material.total, 100000, '2 sak x 50.000')
  assert.equal(p99.material.total, 300000, '1 m3 x 300.000')
  assert.notEqual(p83.material.total, 400000, 'total header TIDAK ditempel ke proyek')
  const note83 = p83.material.notes[0]
  assert.equal(note83.noteTotal, 400000, 'total nota tetap dilaporkan utuh')
  assert.equal(note83.allocated, 100000)
  assert.equal(note83.vendorName, 'Toko Uji A')
})

await t('K5 baris nota tanpa proyek masuk unassigned, bukan proyek pertama', () => {
  assert.equal(bd.unassignedMaterial.total, 60000, '3 x 20.000')
  assert.ok(bd.gaps.some(g => g.code === 'material_unassigned'))
  assert.equal(bd.forProject('83').material.total, 100000, 'unassigned tidak menambah proyek 83')
})

await t('K6 baris tanpa harga tidak dihitung 0 dan dilaporkan', () => {
  assert.ok(bd.gaps.some(g => g.code === 'material_without_price'))
  const p83 = bd.forProject('83')
  assert.equal(p83.material.total, 100000, 'baris tanpa harga tidak menambah apa pun')
})

await t('K7 upah: hak = basis biaya, pembayaran tidak menambah, saldo null', () => {
  const p83 = bd.forProject('83')
  const s = p83.labor.settlement
  assert.equal(s.costRecognized, 1000000)
  assert.equal(s.doubleCounted, false)
  assert.equal(s.outstanding, null, 'pembayaran per proyek belum tersedia -> null, bukan 0')
  assert.equal(p83.labor.completeness, 'entitlement_only')
  assert.ok(bd.gaps.some(g => g.code === 'labor_payments_not_per_project'))
})

await t('K8 PROJECT SUMMARY hanya pembanding, tidak menambah biaya', () => {
  const p83 = bd.forProject('83')
  assert.equal(p83.summaryCost, 1080000)
  assert.equal(p83.material.total, 100000, 'ringkasan tidak dijumlahkan ke material')
  assert.equal(p83.labor.entitlement, 1000000)
})

await t('K9 tidak ada revenue / rasio / margin final (masih HOLD)', () => {
  const p83 = bd.forProject('83')
  const text = JSON.stringify(p83)
  assert.equal(/revenue|margin|ratio/i.test(text), false, 'breakdown tidak boleh menghitung revenue/margin')
  assert.ok(bd.gaps.some(g => g.code === 'revenue_ratio_hold'))
})

await t('K10 proyek tanpa data tetap terdaftar dengan null, bukan 0', () => {
  const bd2 = buildCostBreakdown({ projects: PROJECTS })
  const p = bd2.forProject('99')
  // Tanpa baris apa pun, proyek belum masuk peta — pemanggil memakai
  // forProject() === null sebagai "belum ada data", bukan angka 0.
  assert.equal(p, null)
  assert.equal(bd2.unassignedMaterial.total, 0)
})

console.log(JSON.stringify({ pass, fail: fails.length, failures: fails }, null, 2))
if (fails.length) {
  console.error('\nFAILURES:\n' + fails.map(f => ' - ' + f).join('\n'))
  process.exit(1)
}
