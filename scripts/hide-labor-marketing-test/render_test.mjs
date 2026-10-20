// scripts/hide-labor-marketing-test/render_test.mjs
// Render NYATA Sidebar + Dashboard (t_6a18a263) di jsdom dengan React.
// Membaca komponen TERKOMPILASI dari sandbox/dist (sumber repo), bukan mock.
// Pola import sama dengan scripts/approval-off-test/render_test.mjs.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const SB = process.cwd()
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.Node = dom.window.Node
global.Event = dom.window.Event
global.MouseEvent = dom.window.MouseEvent
global.getComputedStyle = dom.window.getComputedStyle
global.IS_REACT_ACT_ENVIRONMENT = true

// React dari instalasi Hermes (precedence approval-off-test): VPS ~2GB RAM.
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

// Komponen asli hasil kompilasi SWC dari source repo.
const Sidebar = (await import(pathToFileURL(path.join(SB, 'dist', 'components', 'Sidebar.mjs')).href)).default
const Dashboard = (await import(pathToFileURL(path.join(SB, 'dist', 'components', 'Dashboard.mjs')).href)).default

// jsdom belum punya matchMedia; Sidebar memakainya untuk perilaku drawer.
function stubMatchMedia(width) {
  dom.window.matchMedia = () => ({ matches: width <= 1024, addEventListener() {}, removeEventListener() {} })
}

let pass = 0, fail = 0
const ok = (name, cond) => {
  if (cond) { pass++; console.log('  ok  ', name) }
  else { fail++; console.log('  FAIL', name) }
}

function render(el) {
  const root = createRoot(document.getElementById('root'))
  act(() => { root.render(el) })
  return root
}
// textContent agar '&' tidak jadi '&amp;' seperti pada innerHTML.
const text = () => document.getElementById('root').textContent || ''

const HIDDEN = [
  ['Actual Labor', 'Actual Labor & Stok'],
  ['Marketing / Lead Pipeline', 'Marketing / Lead Pipeline'],
]
const VISIBLE = [
  'Dashboard',
  'Projects',
  'Vendors',
  'Materials',
  'Purchase Request',
  'Customer CRM',
  'Project Finance',
  'Upah Tukang',
]
// Penting: pakai textContent, bukan innerHTML — innerHTML mengubah '&'
// jadi '&amp;' sehingga pencarian teks jadi gagal palsu (false negative).
// Catatan: daftar di atas khusus SIDEBAR (kartu dashboard diuji terpisah
// di bawah, karena kartu admin memang hanya tampil untuk role admin).
const session = { user: { email: 'bit@noirliving.id' } }
const noop = () => {}
const rows = []

console.log('RENDER NYATA SIDEBAR (desktop & mobile, admin & non-admin)')

for (const width of [1440, 390]) {
  stubMatchMedia(width)
  for (const role of ['admin', 'staff']) {
    const root = render(
      React.createElement(Sidebar, { session, role, page: 'dashboard', setPage: noop, onLogout: noop, signOut: noop })
    )
    const html = text()
    for (const [needle, label] of HIDDEN) {
      ok(`sidebar ${width}px(${role}): "${label}" TIDAK dirender`, !html.includes(needle))
    }
    ok(`sidebar ${width}px(${role}): menu Dashboard tetap ada`, html.includes('Dashboard'))
    ok(`sidebar ${width}px(${role}): menu Purchase Request tetap ada`, html.includes('Purchase'))
    ok(`sidebar ${width}px(${role}): tidak ada tombol hantu labor_stock`, !html.includes('labor_stock'))
    ok(`sidebar ${width}px(${role}): tidak ada tombol hantu marketing`, !html.includes('marketing'))
    act(() => root.unmount())
  }
}

// Sanity penting: kalau sidebar gagal render, tes "tidak ada" jadi bohong.
{
  stubMatchMedia(1440)
  const root = render(
    React.createElement(Sidebar, { session, role: 'admin', page: 'dashboard', setPage: noop, onLogout: noop, signOut: noop })
  )
  const buttons = document.querySelectorAll('button')
  ok(`sidebar(admin) benar-benar merender ${buttons.length} tombol (bukan halaman kosong)`, buttons.length > 5)
  ok('sidebar(admin) punya semua menu penting lain yang terlihat', VISIBLE.every(v => text().includes(v)))
  act(() => root.unmount())
}

console.log('\nRENDER NYATA DASHBOARD (kartu pintasan)')
const dashProps = { rows, activeProjects: [], pastProjects: [], setPage: noop, role: 'admin' }
for (const role of ['admin', 'staff']) {
  const root = render(
    React.createElement(Dashboard, { ...dashProps, role })
  )
  const html = text()
  for (const [needle, label] of HIDDEN) {
    ok(`dashboard(${role}): kartu "${label}" TIDAK dirender`, !html.includes(needle))
  }
  // Kartu dasar (non-admin) harus tetap ada untuk SEMUA role.
  ok(`dashboard(${role}): kartu Purchase Request tetap dirender`, html.includes('Purchase Request'))
  ok(`dashboard(${role}): dashboard benar-benar terisi (bukan kosong)`, html.includes('Project aktif'))
  // Kartu khusus admin memang hanya untuk admin — itu perilaku benar,
  // bukan regresi. Yang penting: saat admin, kartunya ADA.
  if (role === 'admin') {
    ok('dashboard(admin): kartu Customer CRM tetap dirender', html.includes('Customer CRM'))
    ok('dashboard(admin): kartu RAB & BOQ tetap dirender', html.includes('RAB & BOQ'))
  } else {
    ok('dashboard(staff): kartu admin memang tidak dirender (perilaku benar, bukan regresi)',
      !html.includes('Customer CRM') && !html.includes('RAB & BOQ'))
  }
  act(() => root.unmount())
}

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`)
process.exit(fail === 0 ? 0 : 1)
