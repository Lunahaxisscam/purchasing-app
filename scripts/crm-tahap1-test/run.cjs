// Uji CRM Tahap 1 (modules/crm/customerPage.jsx) dengan mock Supabase.
// Yang dibuktikan:
//   1) validasi nama wajib & duplikat nama ditolak
//   2) normalisasi WA (62 -> 0, buang tanda baca)
//   3) tambah customer -> INSERT ke tabel customers dengan payload benar
//   4) ubah status -> UPDATE status (Prospek <-> Customer)
//   5) 1 customer banyak project: projectsOf memfilter pakai customer_id
//   6) tautkan project -> UPDATE projects.customer_id
//   7) lepas project -> UPDATE projects.customer_id = null (project tetap ada)
//   8) hapus customer -> DELETE customers (project tidak dihapus)
const fs = require('fs')
const path = require('path')
const SB = process.cwd()

const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true
})
for (const k of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'Node']) global[k] = dom.window[k]
try { global.localStorage = dom.window.localStorage } catch { /* opaque */ }
global.IS_REACT_ACT_ENVIRONMENT = true
global.IS_REACT_ACT_ENVIRONMENT = true
// jsdom punya confirm() tapi 'not implemented' -> selalu undefined.
// Di browser sungguhan ini dialog konfirmasi; di uji kita anggap disetujui.
dom.window.confirm = () => true

// ---------- mock supabase (perekam) ----------
const DB = { customers: [], projects: [] }
const calls = []
function rowsOf(table) { return table === 'customers' ? DB.customers : table === 'projects' ? DB.projects : [] }
function builder(table) {
  const st = { table, op: 'select', payload: null, filters: [] }
  const api = {
    select() { return api },
    order() { return api },
    limit() { return api },
    eq(col, val) { st.filters.push([col, val]); return api },
    insert(p) { st.op = 'insert'; st.payload = p; return api },
    update(p) { st.op = 'update'; st.payload = p; return api },
    delete() { st.op = 'delete'; return api },
    then(resolve) {
      calls.push({ table, op: st.op, payload: st.payload, filters: st.filters })
      let data = null
      if (st.op === 'select') data = rowsOf(table).map((r) => ({ ...r }))
      else if (st.op === 'insert') {
        const row = { id: `c${DB.customers.length + 1}`, created_at: new Date().toISOString(), ...st.payload }
        DB.customers.push(row); data = [row]
      } else if (st.op === 'update') {
        const [col, val] = st.filters.find((f) => f[0] === 'id') || []
        const list = rowsOf(table)
        const target = list.find((r) => String(r.id) === String(val))
        if (target) Object.assign(target, st.payload)
        data = target ? [target] : []
      } else if (st.op === 'delete') {
        const [col, val] = st.filters.find((f) => f[0] === 'id') || []
        const i = DB.customers.findIndex((r) => String(r.id) === String(val))
        if (i >= 0) DB.customers.splice(i, 1)
        data = []
      }
      return Promise.resolve({ data, error: null }).then(resolve)
    },
    catch() { return api }
  }
  return api
}
const supabaseMock = { from: builder, rpc: async () => ({ data: null, error: { message: 'probe' } }) }

// stub lib/supabaseClient untuk modul asli
const stubPath = path.join(SB, 'lib/supabaseClient.js')
const origJs = require.extensions['.js']
const swc = require('next/dist/build/swc')
for (const ext of ['.js', '.jsx']) {
  require.extensions[ext] = function (mod, file) {
    if (!file.startsWith(SB + '/') || file.includes('/node_modules/')) return origJs(mod, file)
    if (file === stubPath) { mod.exports = { supabase: supabaseMock }; return }
    if (file.endsWith('.css')) { mod.exports = {}; return }
    const code = swc.transformSync(fs.readFileSync(file, 'utf8'), {
      filename: file,
      jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
      module: { type: 'commonjs' }
    }).code
    mod._compile(code, file)
  }
}

const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = require('react-dom/test-utils')

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')) }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

const mod = require(path.join(SB, 'modules/crm/customerPage.jsx'))

// ---------- 1-2) fungsi murni ----------
console.log('\n=== A. VALIDASI & NORMALISASI ===')
check('nama kosong ditolak', !mod.validateCustomer({ nama: '  ', status: 'PROSPEK' }).ok)
check('nama duplikat ditolak', !mod.validateCustomer(
  { nama: 'Bu Santi', status: 'PROSPEK' },
  { existing: [{ id: 'x', nama: 'Bu Santi' }] }
).ok)
check('nama duplikat saat EDIT dirinya sendiri tidak ditolak', mod.validateCustomer(
  { nama: 'Bu Santi', status: 'PROSPEK' },
  { existing: [{ id: 'x', nama: 'Bu Santi' }], editingId: 'x' }
).ok)
check('status tak dikenal ditolak', !mod.validateCustomer({ nama: 'A', status: 'ENTAH' }).ok)
check('WA "62812-3456-7890" -> "081234567890"', mod.normalizeWa('62812-3456-7890') === '081234567890',
  mod.normalizeWa('62812-3456-7890'))
check('WA "+62 812 3456 7890" dinormalkan sama', mod.normalizeWa('+62 812 3456 7890') === '081234567890',
  mod.normalizeWa('+62 812 3456 7890'))
check('WA kosong tetap kosong', mod.normalizeWa('') === '')

// ---------- 3-8) perilaku halaman ----------
console.log('\n=== B. HALAMAN CRM (render + tulis DB) ===')
const el = document.getElementById('app')
const app = createRoot(el)

function findButton(text) {
  return [...el.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === text)
}
function setInput(testid, value) {
  const input = el.querySelector(`[data-testid="${testid}"]`)
  if (!input) throw new Error(`input ${testid} tidak ada`)
  const setter = Object.getOwnPropertyDescriptor(
    input.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype, 'value'
  ).set
  setter.call(input, value)
  input.dispatchEvent(new dom.window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  return input
}

;(async () => {
  // project contoh: 2 untuk customer yang sama + 1 belum tertaut
  DB.projects.push(
    { id: 'p1', name: 'Baroni Utara', kode: '99', status: 'ON_GOING', customer_id: null },
    { id: 'p2', name: 'Kitchen Set Santi', kode: '104', status: 'ON_GOING', customer_id: null },
    { id: 'p3', name: 'Josh Mabes', kode: '83', status: 'DONE', customer_id: null }
  )

  await act(async () => { app.render(React.createElement(mod.default, { rows: { projects: DB.projects }, refresh: () => {}, say: () => {} })) })
  await act(async () => { await tick() })

  check('halaman terender (judul CRM)', /Customer CRM/.test(el.textContent || ''))
  check('kondisi kosong dijelaskan', /Belum ada customer/.test(el.textContent || ''))

  // tambah customer
  await act(async () => { findButton('+ Tambah Customer').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await tick() })
  await act(async () => { setInput('crm-input-nama', 'Bu Santi') })
  await act(async () => { setInput('crm-input-wa', '62812-3456-7890') })
  await act(async () => { setInput('crm-input-status', 'PROSPEK') })
  await act(async () => {
    el.querySelector('[data-testid="crm-form"]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await act(async () => { await tick() })

  const ins = calls.filter((c) => c.table === 'customers' && c.op === 'insert')
  check('customer baru di-INSERT ke tabel customers', ins.length === 1, JSON.stringify(ins[0] || {}))
  check('payload INSERT berisi nama, wa, status', !!ins[0] &&
    ins[0].payload.nama === 'Bu Santi' && ins[0].payload.wa === '62812-3456-7890' && ins[0].payload.status === 'PROSPEK',
    JSON.stringify(ins[0]?.payload))
  check('customer tampil setelah simpan', /Bu Santi/.test(el.textContent || ''))
  check('badge status Prospek tampil', /Prospek/.test(el.textContent || ''))

  const santi = DB.customers[0]

  // ubah status -> Customer
  const toggleBtn = [...el.querySelectorAll('button')].find((b) => (b.textContent || '').includes('→ Customer'))
  check('tombol ubah status tersedia', !!toggleBtn)
  await act(async () => { toggleBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await tick() })
  const upd = calls.filter((c) => c.table === 'customers' && c.op === 'update')
  check('status di-UPDATE menjadi CUSTOMER', upd.length >= 1 && upd[upd.length - 1].payload.status === 'CUSTOMER',
    JSON.stringify(upd[upd.length - 1]?.payload))

  // tautkan 2 project ke customer yang sama
  for (const pid of ['p1', 'p2']) {
    await act(async () => {
      const expand = el.querySelector(`[data-testid="crm-expand-${santi.id}"]`)
      if (expand && !el.querySelector(`[data-testid="crm-link-select-${santi.id}"]`)) {
        expand.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      }
    })
    await act(async () => { await tick() })
    await act(async () => { setInput(`crm-link-select-${santi.id}`, pid) })
    await act(async () => {
      el.querySelector(`[data-testid="crm-link-btn-${santi.id}"]`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
    await act(async () => { await tick() })
  }
  const linked = DB.projects.filter((p) => String(p.customer_id) === String(santi.id))
  check('2 project tertaut ke SATU akun customer', linked.length === 2, JSON.stringify(linked.map((p) => p.name)))
  check('penautan lewat projects.customer_id (bukan kolom di customer)',
    calls.some((c) => c.table === 'projects' && c.op === 'update' && 'customer_id' in (c.payload || {})))

  // lepas satu project
  await act(async () => {
    const btn = el.querySelector('[data-testid="crm-unlink-p1"]')
    if (btn) btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => { await tick() })
  check('project dilepas tanpa menghapus project', DB.projects.some((p) => p.id === 'p1') &&
    DB.projects.find((p) => p.id === 'p1').customer_id === null)

  // hapus customer
  await act(async () => {
    const del = el.querySelector(`[data-testid="crm-delete-${santi.id}"]`)
    if (del) del.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => { await tick() })
  check('customer terhapus dari DB', DB.customers.length === 0, JSON.stringify(DB.customers))
  check('project TIDAK ikut terhapus saat customer dihapus', DB.projects.length === 3, String(DB.projects.length))

  // ---- ALAMAT (impor data lama) ----
  await act(async () => { findButton('+ Tambah Customer').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await act(async () => { await tick() })
  await act(async () => { setInput('crm-input-nama', 'Pak Alamat') })
  await act(async () => { setInput('crm-input-alamat', 'Cluster Dakota 8 No. 3, Tangerang') })
  await act(async () => {
    el.querySelector('[data-testid="crm-form"]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await act(async () => { await tick() })
  const insAlamat = calls.filter((c) => c.table === 'customers' && c.op === 'insert').pop()
  check('alamat ikut tersimpan saat tambah customer',
    !!insAlamat && insAlamat.payload.alamat === 'Cluster Dakota 8 No. 3, Tangerang',
    JSON.stringify(insAlamat?.payload))
  check('alamat tampil di daftar', /Cluster Dakota 8 No\. 3/.test(el.textContent || ''))

  console.log(`\ncrm_tahap1_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL' : ''}`)
  process.exit(fail ? 1 : 0)
})().catch((e) => {
  console.log('THROW:', e.message)
  console.log((e.stack || '').split('\n').slice(0, 8).join('\n'))
  process.exit(1)
})
