const assert = require('assert')
const sync = require('../../public/upah-kasbon-sync.js')

function from(row, extra = {}) {
  return sync.stateFromDb({
    tukangs: [row], projects: [], items: [], kasbon: [], totalans: [],
    totalanProjects: [], totalanKasbon: [], ...extra
  }).tukangs[0]
}

assert.strictEqual(from({ id: 't1', kode: 'pujon', nama: '  Pujon  ' }).name, 'Pujon')
assert.strictEqual(from({ id: 't1', kode: 'pujon', nama: '   ' }).name, 'Pujon')
assert.strictEqual(from({ id: 't1', kode: 'pujon', nama: '' }).name, 'Pujon')
assert.strictEqual(from({ id: 't1', kode: 'pujon', nama: null }).name, 'Pujon')
assert.strictEqual(from({ id: 't1', kode: ' pujon ', nama: ' ' }).name, 'Pujon')
assert.strictEqual(from({ id: 't1', kode: '', nama: '' }).name, 'Tukang')
assert.strictEqual(from({ id: 't1', kode: null, nama: null }).name, 'Tukang')

const data = sync.stateFromDb({
  tukangs: [{ id: 't1', kode: 'pujon', nama: '' }],
  projects: [{ id: 'p1', tukang_id: 't1', project_name: 'Project A', status: 'ON_GOING' }],
  items: [],
  kasbon: [{ id: 'k1', tukang_id: 't1', tanggal: '2026-10-01', jenis: 'KASBON', nominal: 1000000 }],
  totalans: [{ id: 'tt1', tukang_id: 't1', no_totalan: 'TOT-001', tanggal: '2026-10-02', seq: 1, pembayaran_aktual: 800000 }],
  totalanProjects: [{ totalan_id: 'tt1', project_id: 'p1', sort_order: 0 }],
  totalanKasbon: [{ totalan_id: 'tt1', kasbon_id: 'k1', nominal: 1000000 }]
}).tukangs[0]
assert.strictEqual(data.key, 'pujon', 'identity key must remain byte-for-byte unchanged')
assert.strictEqual(data.projects[0].name, 'Project A')
assert.strictEqual(data.kasbon[0].nominal, 1000000)
assert.deepStrictEqual(data.totalans[0].projectIds, ['p1'])
assert.deepStrictEqual(data.totalans[0].kasbonIds, ['k1'])
assert.strictEqual(data.totalans[0].pembayaranAktual, 800000)
console.log('tukang_name_test: 13 assertions passed')
