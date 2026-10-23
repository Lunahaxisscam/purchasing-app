// Uji REGRESI: halaman utama (pages/index.js ASLI) dirender sebagai ADMIN,
// lalu modul "Invoice Penjualan" dibuka dari sidebar.
//
// Kenapa ada test ini: dulu baris `<SalesInvoiceModule allProjects={allProjects}>`
// memakai identifier yang TIDAK PERNAH didefinisikan di pages/index.js.
// ReferenceError itu hanya terpicu saat role admin membuka modul tersebut,
// sehingga halaman jatuh ke "Application error: a client-side exception".
// Test ini menangkap kelas bug itu (identifier liar di cabang admin), bukan
// hanya memperbaiki satu baris tanpa penjaga.
const fs = require('fs')
const Module = require('module')
const path = require('path')

const root = process.cwd()
const swc = require('next/dist/build/swc')
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true
})
for (const k of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'Node']) global[k] = dom.window[k]
try { global.localStorage = dom.window.localStorage } catch { /* opaque */ }
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, invoices: [] }), text: async () => '' })
global.IS_REACT_ACT_ENVIRONMENT = true
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
if (!dom.window.matchMedia) dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })

// ---- mock supabase: admin login, tabel kosong ----
const ADMIN = { id: 'admin-1', email: 'admin@noirliving.id', user_metadata: {}, app_metadata: {} }
function builder(table) {
  const result = { data: [], error: null }
  const api = {
    select() { return api },
    eq() { return api },
    in() { return api },
    or() { return api },
    not() { return api },
    is() { return api },
    order() { return api },
    limit() { return api },
    insert() { return api },
    update() { return api },
    delete() { return api },
    maybeSingle: async () => table === 'profiles' ? { data: { role: 'admin' }, error: null } : { data: null, error: null },
    single: async () => table === 'profiles' ? { data: { role: 'admin' }, error: null } : { data: null, error: null },
    then: (resolve) => Promise.resolve(result).then(resolve),
    catch: (reject) => Promise.resolve(result).catch(reject)
  }
  return api
}
const supabaseMock = {
  auth: {
    getSession: async () => ({ data: { session: { user: ADMIN, access_token: 't', refresh_token: 'r' } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null })
  },
  from: builder,
  rpc: async () => ({ data: null, error: { message: 'probe' } }),
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  removeChannel() {}
}

const stubPath = path.join(root, 'lib/supabaseClient.js')
const origJs = Module._extensions['.js']
for (const ext of ['.js', '.jsx']) {
  Module._extensions[ext] = function (mod, file) {
    if (!file.startsWith(root + '/') || file.includes('/node_modules/')) return origJs(mod, file)
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

const errors = []
const origError = console.error
console.error = (...a) => { errors.push(a.map(String).join(' ')); }

;(async () => {
  const App = require(path.join(root, 'pages/index.js')).default
  const el = document.getElementById('app')
  const app = createRoot(el)

  try {
    await act(async () => { app.render(React.createElement(App)) })
    await act(async () => { await new Promise(r => setTimeout(r, 400)) })
  } catch (e) {
    console.error = origError
    console.log('RENDER APP THROW:', e.message)
    console.log((e.stack || '').split('\n').slice(0, 8).join('\n'))
    process.exit(1)
  }

  const menu = [...el.querySelectorAll('button, a, li, span, div')]
    .filter((e) => /invoice penjualan/i.test((e.textContent || '').trim()) && (e.textContent || '').trim().length < 40)

  check('menu "Invoice Penjualan" tampil untuk admin', menu.length > 0,
    'teks sidebar: ' + (el.textContent || '').replace(/\s+/g, ' ').slice(0, 160))

  let clickErr = ''
  if (menu.length) {
    try {
      await act(async () => {
        menu[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      await act(async () => { await new Promise(r => setTimeout(r, 500)) })
    } catch (e) { clickErr = e.message }
  }

  const bodyText = (el.textContent || '').replace(/\s+/g, ' ')
  console.error = origError

  check('membuka modul tidak melempar exception', !clickErr, clickErr)
  check('tidak muncul "Application error"', !/Application error/i.test(bodyText))
  check('isi modul Invoice Penjualan terender', /Alur bisnis: CRM|Buat Invoice Penjualan/i.test(bodyText),
    bodyText.slice(0, 220))
  check('tidak ada ReferenceError di console', !errors.some(e => /ReferenceError/.test(e)),
    errors.filter(e => /ReferenceError/.test(e)).slice(0, 2).join(' | '))

  console.log(`\nhalaman_admin_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL' : ''}`)
  process.exit(fail ? 1 : 0)
})()
