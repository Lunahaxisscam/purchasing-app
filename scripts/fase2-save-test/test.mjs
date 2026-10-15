// ============================================================
// TEST FASE 2 — eksekusi logika save per modul (mock Supabase, tanpa DB)
// Sandbox: /tmp/fase2-sandbox (file save di-COPY VERBATIM dari repo)
// Jalankan: node /tmp/fase2-sandbox/test.mjs
// ============================================================
import { __calls, __state } from './lib/supabaseClient.js'
import { dispatchSave } from './modules/shared/saveDispatcher.js'
import { save as requestsSave } from './modules/requests/save.js'

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}  ${extra}`) }
}
function reset() {
  __calls.length = 0
  __state.nextResult = null
  __state.failFirstInsert = false
  __state.insertCount = 0
}
function baseCtx(over = {}) {
  return {
    page: 'vendors',
    form: { name: 'TB Test', phone: '0812', store_link: '', supplier_category: 'Plywood & Board', contact: '' },
    isEdit: false, editRow: null, editItems: [], prItemsList: [],
    nextPrNum: 'PR-001', allMaterials: [], allVendors: [],
    say: (m) => __calls.push({ op: 'say', msg: m }),
    close: () => __calls.push({ op: 'close' }),
    refresh: () => __calls.push({ op: 'refresh' }),
    setSaving: (v) => __calls.push({ op: 'setSaving', v }),
    ...over
  }
}
const find = (op, table) => __calls.find(c => c.op === op && (table === undefined || c.table === table))

console.log('=== TEST FASE 2: logika save per modul (mock, tanpa DB) ===\n')

// 1. Dispatcher routing
console.log('1. Dispatcher routing')
reset()
const r1 = await dispatchSave('vendors', baseCtx())
check('dispatchSave vendors -> handled', r1.handled === true)
check('insert ke tabel vendors', !!find('insert', 'vendors'))
check('data vendor benar', find('insert', 'vendors')?.data?.name === 'TB Test')
check('pesan sukses', __calls.some(c => c.op === 'say' && /berhasil ditambahkan/.test(c.msg)))
check('close + refresh', !!__calls.find(c => c.op === 'close') && !!__calls.find(c => c.op === 'refresh'))
check('setSaving(false) di akhir', __calls.filter(c => c.op === 'setSaving').pop()?.v === false)

reset()
const r2 = await dispatchSave('halaman_ngawur', baseCtx())
check('page tak dikenal -> handled false', r2.handled === false)

// 2. Projects mapping
console.log('\n2. Projects data mapping')
reset()
await dispatchSave('projects', baseCtx({ page: 'projects', form: { kode: '99', name: 'Baroni', status: 'ON_GOING' } }))
const pD = find('insert', 'projects')?.data
check('kode + code dari form.kode', pD?.kode === '99' && pD?.code === '99')
check('status ikut', pD?.status === 'ON_GOING')

// 3. Receivings mapping
console.log('\n3. Receivings status & kendala')
reset()
await dispatchSave('receivings', baseCtx({
  page: 'receivings',
  form: { receiving_status: 'retur', pr_id: 'p1', project_id: 'pr1', delivery_note: 'SJ-1', invoice_no: 'INV-1', received_date: '2026-10-15', nominal: '450.000', nota_link: 'https://x', notes: 'ok' }
}))
const rcD = find('insert', 'receivings')?.data
check('status uppercase', rcD?.status === 'RETUR')
check('kendala = RETUR', rcD?.kendala === 'RETUR')
check('note dibangun', typeof rcD?.note === 'string' && rcD.note.length > 0)
check('purchase_request_id terisi', rcD?.purchase_request_id === 'p1')

// 4. Handovers mapping
console.log('\n4. Handovers mapping')
reset()
await dispatchSave('handovers', baseCtx({
  page: 'handovers',
  form: { receiving_id: 'r1', project_id: 'p1', received_by: 'Mandor Joko', handover_status: 'CONFIRMED', handover_date: '2026-10-15', notes: 'x' }
}))
const hD = find('insert', 'handovers')?.data
check('received_by terisi', hD?.received_by === 'Mandor Joko')
check('status CONFIRMED', hD?.status === 'CONFIRMED')
check('receiving_id terisi', hD?.receiving_id === 'r1')

// 5. Materials: RPC kode + parser + validasi
console.log('\n5. Materials alokasi kode & validasi')
reset()
__state.nextResult = { data: 'PLY-0007', error: null }
await dispatchSave('materials', baseCtx({
  page: 'materials',
  form: { category: 'Plywood & Board', name: 'Triplek 9mm', qty: '10', satuan: 'Lembar', harga_acuan: '120.000', current_stock: '5', min_stock: '2' }
}))
check('RPC next_material_kode_cat dipanggil', __calls.some(c => c.op === 'rpc' && c.fn === 'next_material_kode_cat'))
const mD = find('insert', 'materials')?.data
check('kode dari RPC', mD?.kode === 'PLY-0007' && mD?.code === 'PLY-0007')
check('harga_acuan integer 120000', mD?.harga_acuan === 120000)
check('current_stock = 5', mD?.current_stock === 5)
check('min_stock = 2', mD?.min_stock === 2)

reset()
await dispatchSave('materials', baseCtx({ page: 'materials', form: { name: 'X' } }))
check('kategori kosong -> TIDAK insert', !find('insert', 'materials'))
check('kategori kosong -> pesan error', __calls.some(c => c.op === 'say' && /Pilih Kategori/.test(c.msg)))

// 6. Materials EDIT
console.log('\n6. Materials mode EDIT (update, bukan insert)')
reset()
await dispatchSave('materials', baseCtx({
  page: 'materials', isEdit: true, editRow: { id: 'm1', kode: 'PLY-0001' },
  form: { category: 'Plywood & Board', name: 'Triplek 12mm', kode: 'PLY-0001', qty: '5', satuan: 'Lembar', harga_acuan: '150.000', current_stock: '3', min_stock: '1' }
}))
check('update materials', !!find('update', 'materials'))
check('TIDAK insert', !find('insert', 'materials'))
check('kode dipertahankan', find('update', 'materials')?.data?.kode === 'PLY-0001')
check('pesan "diperbarui"', __calls.some(c => c.op === 'say' && /berhasil diperbarui/.test(c.msg)))

// 7. Requests PR baru
console.log('\n7. Requests PR baru (DRAFT + items)')
reset()
__state.nextResult = { data: { id: 'pr-new' }, error: null }
await requestsSave(baseCtx({
  page: 'requests',
  form: { project_id: 'p1', title: 'Material dinding', pr_number: 'PR-001', priority: 'URGENT', notes: '' },
  prItemsList: [
    { material_id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', satuan: 'Lembar', qty: 4, supplier_category: '', vendor_id: '', estimated_price: '120.000' }
  ]
}))
const prD = find('insert', 'purchase_requests')?.data
check('status DRAFT', prD?.status === 'DRAFT')
check('priority URGENT', prD?.priority === 'URGENT')
check('materials_summary terbentuk', typeof prD?.materials_summary === 'string' && prD.materials_summary.includes('Triplek'))
const itemsD = find('insert', 'pr_items')?.data
check('pr_items ter-insert dgn pr_id baru', Array.isArray(itemsD) && itemsD[0]?.pr_id === 'pr-new')
check('estimated_price integer', itemsD?.[0]?.estimated_price === 120000)
check('item status PENDING_APPROVAL', itemsD?.[0]?.status === 'PENDING_APPROVAL')

// 8. Requests EDIT PR
console.log('\n8. Requests mode EDIT (update + sinkron item)')
reset()
__state.nextResult = { data: null, error: null }
await requestsSave(baseCtx({
  page: 'requests', isEdit: true, editRow: { id: 'pr-1' },
  editItems: [{ id: 'i1', status: 'ORDERED' }, { id: 'i2', status: 'PENDING_APPROVAL' }],
  form: { project_id: 'p1', title: 'Edit', pr_number: 'PR-001', priority: 'NORMAL', notes: 'n' },
  prItemsList: [{ id: 'i1', material_id: 'm1', name: 'A', satuan: 'Pcs', qty: 2, estimated_price: '10.000' }]
}))
check('PR di-update', !!find('update', 'purchase_requests'))
// delete untuk i2: urutan calls = delete -> eq(i2). Untuk i1 TIDAK boleh ada delete->eq(i1).
const delIdx = __calls.findIndex(c => c.op === 'delete' && c.table === 'pr_items')
const afterDel = delIdx >= 0 ? __calls.slice(delIdx + 1, delIdx + 3) : []
const delTargets = []
for (let i = 0; i < __calls.length; i++) {
  if (__calls[i].op === 'delete' && __calls[i].table === 'pr_items') {
    const eq = __calls.slice(i + 1).find(c => c.op === 'eq')
    if (eq) delTargets.push(eq.val)
  }
}
check('item i2 dihapus', delTargets.includes('i2'), `(delete targets: ${JSON.stringify(delTargets)})`)
check('item i1 (ORDERED) TIDAK dihapus', !delTargets.includes('i1'), `(delete targets: ${JSON.stringify(delTargets)})`)
check('item i1 di-update', !!find('update', 'pr_items'))
check('pesan "diperbarui" + item count', __calls.some(c => c.op === 'say' && /berhasil diperbarui \(1 item\)/.test(c.msg)))

// 9. Retry 23505
console.log('\n9. Retry unique-index 23505 (materials)')
reset()
__state.failFirstInsert = true
__state.nextResult = { data: 'PLY-0099', error: null }  // kode retry dari RPC
await dispatchSave('materials', baseCtx({
  page: 'materials',
  form: { category: 'Plywood & Board', name: 'Y', qty: '1', satuan: 'Lembar', harga_acuan: '', current_stock: '0', min_stock: '0' }
}))
const inserts = __calls.filter(c => c.op === 'insert' && c.table === 'materials')
check('insert dicoba 2x setelah 23505', inserts.length === 2, `(dapat ${inserts.length})`)
check('kode retry dari RPC dipakai', inserts[1]?.data?.kode === 'PLY-0099')
check('RPC retry dipanggil', __calls.some(c => c.op === 'rpc' && c.fn === 'next_material_kode_cat'))

// 10. Error handling: gagal insert -> pesan error, tidak close
console.log('\n10. Error handling insert gagal')
reset()
__state.nextResult = { data: null, error: { code: 'PGRST999', message: 'gagal simpan' } }
await dispatchSave('vendors', baseCtx())
check('pesan error ditampilkan', __calls.some(c => c.op === 'say' && c.msg === 'gagal simpan'))
check('close TIDAK dipanggil saat error', !__calls.find(c => c.op === 'close'))
check('setSaving(false) tetap dipanggil', __calls.filter(c => c.op === 'setSaving').pop()?.v === false)

console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`)
process.exit(fail ? 1 : 0)
