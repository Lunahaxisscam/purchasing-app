// ============================================================
// TEST FASE 2 — verifikasi logika save per modul dengan mock Supabase
// Jalankan: node scripts/test-save-fase2.js
// ============================================================
// Test ini TIDAK menyentuh database — semua panggilan supabase di-mock.
// Tujuan: memastikan dispatcher memanggil modul yang benar, bentuk data
// yang dikirim sama seperti sebelum refactor, dan jalur edit/retry bekerja.

const path = require('path')
const Module = require('module')

// --- Mock modul supabaseClient ---
const calls = []
const mockResult = { data: null, error: null }
let nextResult = null
const setResult = (r) => { nextResult = r }

function chain(table) {
  const api = {
    insert(d) { calls.push({ op: 'insert', table, data: d }); return { ...api, then: undefined, select: () => api, single: async () => (nextResult || mockResult) } },
    update(d) { calls.push({ op: 'update', table, data: d }); return { ...api, eq: (col, val) => { calls.push({ op: 'eq', table, col, val }); return Promise.resolve(nextResult || mockResult) } } },
    delete() { calls.push({ op: 'delete', table }); return { ...api, eq: (col, val) => { calls.push({ op: 'eq', table, col, val }); return Promise.resolve(nextResult || mockResult) } } },
    select() { calls.push({ op: 'select', table }); return { ...api, eq: () => api, order: () => Promise.resolve(nextResult || mockResult) } },
    eq(col, val) { calls.push({ op: 'eq', table, col, val }); return Promise.resolve(nextResult || mockResult) }
  }
  return api
}

const mockSupabase = {
  from: (table) => chain(table),
  rpc: async (fn, args) => { calls.push({ op: 'rpc', fn, args }); return nextResult || { data: null, error: null } }
}

// Intercept require untuk '../lib/supabaseClient' dan '../../lib/supabaseClient'
const origResolve = Module._resolveFilename
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request.endsWith('supabaseClient')) return { supabase: mockSupabase }
  return origLoad.apply(this, arguments)
}

// Transpile JSX/ESM on the fly via next's babel — simplest: use @babel/register if available,
// else fall back to require after manual transform. Next has babel but not registered; use
// a lightweight ESM->CJS via esbuild if present, else do a naive transform.
let register = null
try { register = require('@babel/register') } catch (e) { register = null }

if (register) {
  register({ presets: [['next/babel', { 'preset-react': { runtime: 'classic' } }]], extensions: ['.js', '.jsx'], ignore: [/node_modules/] })
} else {
  console.error('PERLU @babel/register untuk menjalankan test ini.')
  process.exit(2)
}

const { dispatchSave } = require(path.join(__dirname, '..', 'modules', 'shared', 'saveDispatcher.js'))
const { save: requestsSave } = require(path.join(__dirname, '..', 'modules', 'requests', 'save.js'))
const { save: materialsSave } = require(path.join(__dirname, '..', 'modules', 'materials', 'save.js'))

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

function baseCtx(over = {}) {
  return {
    page: 'vendors',
    form: { name: 'TB Test', phone: '0812', store_link: '', supplier_category: 'Plywood & Board', contact: '' },
    isEdit: false,
    editRow: null,
    editItems: [],
    prItemsList: [],
    nextPrNum: 'PR-001',
    allMaterials: [],
    allVendors: [],
    say: (m) => calls.push({ op: 'say', msg: m }),
    close: () => calls.push({ op: 'close' }),
    refresh: () => calls.push({ op: 'refresh' }),
    setSaving: (v) => calls.push({ op: 'setSaving', v }),
    ...over
  }
}

async function run() {
  console.log('=== TEST FASE 2: logika save per modul (mock, tanpa DB) ===\n')

  // --- 1. Dispatcher memanggil modul yang benar ---
  console.log('1. Dispatcher routing')
  calls.length = 0
  const r1 = await dispatchSave('vendors', baseCtx())
  check('dispatchSave vendors -> handled', r1.handled === true)
  check('insert ke tabel vendors', calls.some(c => c.op === 'insert' && c.table === 'vendors'))
  check('data vendor sesuai', calls.find(c => c.op === 'insert')?.data?.name === 'TB Test')
  check('say sukses dipanggil', calls.some(c => c.op === 'say' && /berhasil ditambahkan/.test(c.msg)))
  check('close + refresh dipanggil', calls.some(c => c.op === 'close') && calls.some(c => c.op === 'refresh'))

  const r2 = await dispatchSave('nonexistent_page', baseCtx())
  check('page tak dikenal -> handled false', r2.handled === false)

  // --- 2. Projects: mapping kode/code ---
  console.log('\n2. Projects data mapping')
  calls.length = 0
  await dispatchSave('projects', baseCtx({ page: 'projects', form: { kode: '99', name: 'Baroni', status: 'ON_GOING' } }))
  const pData = calls.find(c => c.op === 'insert' && c.table === 'projects')?.data
  check('kode + code terisi dari form.kode', pData?.kode === '99' && pData?.code === '99')
  check('status ikut', pData?.status === 'ON_GOING')

  // --- 3. Receivings: status & kendala mapping ---
  console.log('\n3. Receivings status mapping')
  calls.length = 0
  await dispatchSave('receivings', baseCtx({
    page: 'receivings',
    form: { receiving_status: 'retur', pr_id: 'p1', project_id: 'pr1', delivery_note: 'SJ-1', invoice_no: 'INV-1', received_date: '2026-10-15', nominal: '450.000', nota_link: 'https://x', notes: 'ok' }
  }))
  const rcData = calls.find(c => c.op === 'insert' && c.table === 'receivings')?.data
  check('status uppercase', rcData?.status === 'RETUR')
  check('kendala = RETUR', rcData?.kendala === 'RETUR')
  check('note dibangun (buildReceivingNote)', typeof rcData?.note === 'string' && rcData.note.length > 0)

  // --- 4. Handovers ---
  console.log('\n4. Handovers data mapping')
  calls.length = 0
  await dispatchSave('handovers', baseCtx({
    page: 'handovers',
    form: { receiving_id: 'r1', project_id: 'p1', received_by: 'Mandor Joko', handover_status: 'CONFIRMED', handover_date: '2026-10-15', notes: 'x' }
  }))
  const hData = calls.find(c => c.op === 'insert' && c.table === 'handovers')?.data
  check('received_by terisi', hData?.received_by === 'Mandor Joko')
  check('status default CONFIRMED', hData?.status === 'CONFIRMED')

  // --- 5. Materials: alokasi kode via RPC + validasi kategori ---
  console.log('\n5. Materials alokasi kode & validasi')
  calls.length = 0
  nextResult = { data: 'PLY-0007', error: null }
  await dispatchSave('materials', baseCtx({
    page: 'materials',
    form: { category: 'Plywood & Board', name: 'Triplek 9mm', qty: '10', satuan: 'Lembar', harga_acuan: '120.000', current_stock: '5', min_stock: '2' }
  }))
  check('RPC next_material_kode_cat dipanggil', calls.some(c => c.op === 'rpc' && c.fn === 'next_material_kode_cat'))
  const mData = calls.find(c => c.op === 'insert' && c.table === 'materials')?.data
  check('kode dari RPC dipakai', mData?.kode === 'PLY-0007' && mData?.code === 'PLY-0007')
  check('harga_acuan jadi integer', mData?.harga_acuan === 120000)
  check('stok parser: current_stock=5', mData?.current_stock === 5)
  nextResult = null

  // Kategori kosong -> ditolak
  calls.length = 0
  await dispatchSave('materials', baseCtx({ page: 'materials', form: { name: 'X' } }))
  check('kategori kosong -> tidak insert', !calls.some(c => c.op === 'insert'))
  check('kategori kosong -> pesan error', calls.some(c => c.op === 'say' && /Pilih Kategori/.test(c.msg)))

  // --- 6. Materials EDIT: update, bukan insert ---
  console.log('\n6. Materials mode EDIT')
  calls.length = 0
  await dispatchSave('materials', baseCtx({
    page: 'materials', isEdit: true, editRow: { id: 'm1', kode: 'PLY-0001' },
    form: { category: 'Plywood & Board', name: 'Triplek 12mm', kode: 'PLY-0001', qty: '5', satuan: 'Lembar', harga_acuan: '150.000', current_stock: '3', min_stock: '1' }
  }))
  check('mode edit -> update materials', calls.some(c => c.op === 'update' && c.table === 'materials'))
  check('mode edit -> TIDAK insert', !calls.some(c => c.op === 'insert'))
  check('kode dipertahankan', calls.find(c => c.op === 'update')?.data?.kode === 'PLY-0001')

  // --- 7. Requests: jalur PR baru (DRAFT + item) ---
  console.log('\n7. Requests PR baru')
  calls.length = 0
  nextResult = { data: { id: 'pr-new' }, error: null }   // untuk insert().select().single()
  const ctxReq = baseCtx({
    page: 'requests',
    form: { project_id: 'p1', title: 'Material dinding', pr_number: 'PR-001', priority: 'URGENT', notes: '' },
    prItemsList: [
      { material_id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', satuan: 'Lembar', qty: 4, supplier_category: '', vendor_id: '', estimated_price: '120.000' }
    ]
  })
  await requestsSave(ctxReq)
  const prData = calls.find(c => c.op === 'insert' && c.table === 'purchase_requests')?.data
  check('PR baru berstatus DRAFT', prData?.status === 'DRAFT')
  check('priority URGENT ikut', prData?.priority === 'URGENT')
  check('materials_summary terbentuk', typeof prData?.materials_summary === 'string' && prData.materials_summary.includes('Triplek'))
  const itemsData = calls.find(c => c.op === 'insert' && c.table === 'pr_items')?.data
  check('pr_items ter-insert dgn pr_id baru', Array.isArray(itemsData) && itemsData[0]?.pr_id === 'pr-new')
  check('estimated_price jadi integer', itemsData?.[0]?.estimated_price === 120000)
  nextResult = null

  // --- 8. Requests: jalur EDIT PR (update + sinkron item) ---
  console.log('\n8. Requests mode EDIT')
  calls.length = 0
  const ctxEdit = baseCtx({
    page: 'requests', isEdit: true, editRow: { id: 'pr-1' },
    editItems: [{ id: 'i1', status: 'ORDERED' }, { id: 'i2', status: 'PENDING_APPROVAL' }],
    form: { project_id: 'p1', title: 'Edit', pr_number: 'PR-001', priority: 'NORMAL', notes: 'n' },
    prItemsList: [{ id: 'i1', material_id: 'm1', name: 'A', satuan: 'Pcs', qty: 2, estimated_price: '10.000' }]
  })
  await requestsSave(ctxEdit)
  check('PR di-update (bukan insert)', calls.some(c => c.op === 'update' && c.table === 'purchase_requests'))
  check('item i2 (tidak dipertahankan) dihapus', calls.some(c => c.op === 'delete' && c.table === 'pr_items'))
  check('item i1 (ORDERED) TIDAK dihapus', !calls.some(c => c.op === 'delete' && c.val === 'i1'))
  check('item i1 di-update', calls.some(c => c.op === 'update' && c.table === 'pr_items'))

  // --- 9. Retry unique-index (23505) ---
  console.log('\n9. Retry 23505 (materials)')
  calls.length = 0
  let insertCount = 0
  const origFrom = mockSupabase.from
  mockSupabase.from = (table) => {
    const api = origFrom(table)
    if (table === 'materials') {
      const origInsert = api.insert
      api.insert = (d) => {
        insertCount++
        calls.push({ op: 'insert', table, data: d })
        if (insertCount === 1) {
          // insert pertama gagal 23505
          return { ...api, select: () => api, single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) }
        }
        return { ...api, select: () => api, single: async () => ({ data: null, error: null }) }
      }
    }
    return api
  }
  nextResult = { data: 'PLY-0099', error: null }  // RPC retry
  await dispatchSave('materials', baseCtx({
    page: 'materials',
    form: { category: 'Plywood & Board', name: 'Y', qty: '1', satuan: 'Lembar', harga_acuan: '', current_stock: '0', min_stock: '0' }
  }))
  check('insert dicoba 2x setelah 23505', insertCount === 2)
  const retryData = calls.filter(c => c.op === 'insert')[1]?.data
  check('kode retry dari RPC dipakai', retryData?.kode === 'PLY-0099')
  mockSupabase.from = origFrom
  nextResult = null

  console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`)
  process.exit(fail ? 1 : 0)
}

run().catch(e => { console.error('TEST ERROR:', e); process.exit(3) })
