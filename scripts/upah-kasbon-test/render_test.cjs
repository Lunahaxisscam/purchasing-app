// Uji REGRESI modul "Upah & Kasbon" (t_upah_kasbon, 24 Okt 2026).
//
// Membuktikan:
//   1) menu "Upah & Kasbon" muncul untuk ADMIN
//   2) mengklik menu tidak melempar exception (kelas bug ReferenceError
//      di cabang admin yang dulu bikin "Application error")
//   3) modul benar-benar terender: iframe prototipe + catatan penyimpanan master
//   4) non-admin TIDAK bisa membuka modul (guard render, bukan cuma menu)
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
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' })
global.IS_REACT_ACT_ENVIRONMENT = true
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
if (!dom.window.matchMedia) dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })

const ROLE = process.env.TEST_ROLE || 'admin'
const USER = { id: 'u-1', email: ROLE + '@noirliving.id', user_metadata: {}, app_metadata: {} }

function builder(table) {
  const result = { data: [], error: null }
  const api = {
    select() { return api }, eq() { return api }, in() { return api }, or() { return api },
    not() { return api }, is() { return api }, order() { return api }, limit() { return api },
    insert() { return api }, update() { return api }, delete() { return api },
    maybeSingle: async () => table === 'profiles' ? { data: { role: ROLE }, error: null } : { data: null, error: null },
    single: async () => table === 'profiles' ? { data: { role: ROLE }, error: null } : { data: null, error: null },
    then: (resolve) => Promise.resolve(result).then(resolve),
    catch: (reject) => Promise.resolve(result).catch(reject)
  }
  return api
}
const supabaseMock = {
  auth: {
    getSession: async () => ({ data: { session: { user: USER, access_token: 't', refresh_token: 'r' } }, error: null }),
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
console.error = (...a) => { errors.push(a.map(String).join(' ')) }

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
    process.exit(1)
  }

  const menu = [...el.querySelectorAll('button, a, li, span, div')]
    .filter((e) => /upah\s*&\s*kasbon/i.test((e.textContent || '').trim()) && (e.textContent || '').trim().length < 40)

  if (ROLE === 'admin') {
    check('menu "Upah & Kasbon" tampil untuk admin', menu.length > 0,
      'sidebar: ' + (el.textContent || '').replace(/\s+/g, ' ').slice(0, 200))
    // DAT: "jadi 1 saja" — modul upah_kasbon MENGGANTIKAN tukang_upah.
    const sidebar = [...el.querySelectorAll('aside button, aside a, nav button, nav a')]
      .map(x => (x.textContent || '').trim())
    const upahItems = sidebar.filter(t => /^upah/i.test(t))
    check('sidebar hanya punya SATU entri upah (konsolidasi)',
      upahItems.length === 1, 'entri upah: ' + JSON.stringify(upahItems))
    check('entri upah yang tampil = "Upah & Kasbon" (bukan yang lama)',
      upahItems.length === 1 && /kasbon/i.test(upahItems[0]), JSON.stringify(upahItems))
  } else {
    check('menu "Upah & Kasbon" TIDAK tampil untuk non-admin', menu.length === 0)
  }

  let clickErr = ''
  if (menu.length) {
    try {
      await act(async () => {
        menu[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      })
      await act(async () => { await new Promise(r => setTimeout(r, 600)) })
    } catch (e) { clickErr = e.message }
  }

  const bodyText = (el.textContent || '').replace(/\s+/g, ' ')
  const iframe = el.querySelector('iframe.upah-kasbon-frame')
  console.error = origError

  if (ROLE === 'admin') {
    check('membuka modul tidak melempar exception', !clickErr, clickErr)
    check('tidak muncul "Application error"', !/Application error/i.test(bodyText))
    check('iframe prototipe terender', !!iframe,
      'iframe: ' + (iframe ? iframe.getAttribute('src') : 'TIDAK ADA'))
    check('iframe menunjuk file prototipe yang benar',
      !!iframe && iframe.getAttribute('src') === '/upah-kasbon-prototype.html',
      iframe ? iframe.getAttribute('src') : '-')
    check('catatan penyimpanan master tampil', /Supabase|database\s+master/i.test(bodyText),
      bodyText.slice(0, 240))
    check('tidak ada ReferenceError di console',
      !errors.some(e => /ReferenceError/.test(e)),
      errors.filter(e => /ReferenceError/.test(e)).slice(0, 2).join(' | '))
  } else {
    // Menu tersembunyi = tidak ada yang bisa diklik, jadi panel guard tidak
    // bisa dipicu lewat UI. Yang WAJIB terbukti di sini: non-admin tidak
    // melihat menu DAN tidak melihat iframe. Guard render-nya sendiri
    // (role !== 'admin' -> panel "khusus administrator") dibuktikan lewat
    // pembacaan sumber di bawah, supaya klaimnya tidak kosong.
    check('non-admin TIDAK melihat iframe modul', !iframe)
    const src = fs.readFileSync(path.join(root, 'pages/index.js'), 'utf8')
    const guard = /page === 'upah_kasbon' \?[\s\S]{0,400}?khusus administrator/.test(src)
    check('guard render upah_kasbon ada di pages/index.js', guard)
  }

  console.log(`\nupah_kasbon_test (${ROLE}): ${pass}/${pass + fail} lulus${fail ? ' — GAGAL' : ''}`)
  process.exit(fail ? 1 : 0)
})()
