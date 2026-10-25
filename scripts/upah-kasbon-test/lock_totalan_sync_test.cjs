// Test-first regression: final historical totals and their sources are immutable.
const assert = require('assert')
const path = require('path')
const sync = require(path.join(__dirname, '..', '..', 'public', 'upah-kasbon-sync.js'))
let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + ' — ' + e.message) }
}
function clone(v) { return JSON.parse(JSON.stringify(v)) }
function database() {
  return {
    tukangs: [{ id: 'tk-1', kode: 'pujon', nama: 'Pujon', unit_bisnis: 'Noir Living' }],
    projects: [{ id: 'p-closed', tukang_id: 'tk-1', project_name: 'Project Closed', status: 'SELESAI', arsip_manual: true, total_manual: 500000 }],
    items: [{ id: 'u-closed', project_id: 'p-closed', pekerjaan: 'Wardrobe', ukuran: 1, satuan_ukuran: 'unit', harga_satuan: 500000, upah_rincian: 500000, catatan: null }],
    kasbon: [{ id: 'k-closed', tukang_id: 'tk-1', tanggal: '2025-04-12', jenis: 'KASBON', deskripsi: 'Kasbon mingguan', metode: 'Transfer', nominal: 200000, bukti: null }],
    totalans: [{ id: 't-closed', tukang_id: 'tk-1', no_totalan: 'TOT-001', tanggal: '2025-04-30', seq: 1, pembayaran_aktual: 300000, total_upah: 500000, kasbon_dipotong: 200000, hak_bersih: 300000, saldo_akhir: 0, status: 'Lunas', final: true }],
    totalanProjects: [{ totalan_id: 't-closed', project_id: 'p-closed', sort_order: 0 }],
    totalanKasbon: [{ totalan_id: 't-closed', kasbon_id: 'k-closed', nominal: 200000 }]
  }
}
function stateOfDb(db) { return sync.stateFromDb(db) }
function persist(prev, next) { return sync.planPersist(prev, next, { snapshotTotalan: t => t.snapshot || {} }) }
function blocked(mutator) {
  const prev = stateOfDb(database()), next = clone(prev)
  mutator(next.tukangs[0], next)
  assert.throws(() => persist(prev, next), /final.*(kunci|lock|ubah|permanen)|(?:kunci|lock|ubah|permanen).*final/i)
}
console.log('Final totalan persistence protection:')
test('unchanged final records pass the persistence gate', () => {
  const prev = stateOfDb(database()), next = clone(prev)
  assert.doesNotThrow(() => persist(prev, next))
  const t = next.tukangs[0].totalans[0]
  assert.strictEqual(t.final, true)
  assert.deepStrictEqual(t.snapshot, { total_upah: 500000, kasbon_dipotong: 200000, hak_bersih: 300000, saldo_akhir: 0, status: 'Lunas' })
})
test('cannot change a project included in a final totalan', () => blocked(d => { d.projects[0].status = 'On Going' }))
test('cannot delete a project included in a final totalan', () => blocked(d => { d.projects = [] }))
test('cannot change or remove upah items under a final project', () => blocked(d => { d.upahItems[0].upahRincian = 700000 }))
test('cannot add upah items to a final project', () => blocked(d => { d.upahItems.push({ id: 'u-new', projectId: 'p-closed', pekerjaan: 'Extra', upahRincian: 1 }) }))
test('cannot change a kasbon included in a final totalan', () => blocked(d => { d.kasbon[0].nominal = 300000 }))
test('cannot delete a kasbon included in a final totalan', () => blocked(d => { d.kasbon = [] }))
test('cannot change a final totalan or its sheet snapshot', () => blocked(d => { d.totalans[0].pembayaranAktual = 0 }))
test('cannot delete a final totalan', () => blocked(d => { d.totalans = [] }))
test('cannot release project or kasbon junction links', () => blocked(d => { d.totalans[0].kasbonIds = [] }))
test('can add new project and weekly kasbon after closing', () => {
  const prev = stateOfDb(database()), next = clone(prev), d = next.tukangs[0]
  d.projects.push({ id: 'p-new', name: 'Project Baru', status: 'On Going' })
  d.kasbon.push({ id: 'k-new', tanggal: '2026-10-25', jenis: 'Kasbon', deskripsi: 'Kasbon mingguan', nominal: 100000 })
  const ops = persist(prev, next)
  assert(ops.some(o => o.kind === 'insert' && o.table === 'upah_projects'))
  assert(ops.some(o => o.kind === 'insert' && o.table === 'upah_kasbon'))
})
console.log(`\nHASIL: ${passed} lulus, ${failed} gagal`)
process.exit(failed ? 1 : 0)
