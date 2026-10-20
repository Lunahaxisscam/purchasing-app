// ============================================================
// scripts/approval-off-test/render_test.mjs — RENDER UI APPROVAL OFF
// ============================================================
// React nyata di jsdom, komponen hasil kompilasi SWC dari file repo:
//   R1  Sidebar desktop (admin & user): TIDAK ada tombol Approval,
//       modul lain tetap lengkap (20 item admin / 7 item user).
//   R2  Drawer mobile (breakpoint 390): menu Approval juga tidak ada —
//       satu komponen, dua breakpoint.
//   R3  Dashboard: kartu "Menunggu approval" hilang; kartu lain tetap.
//   R4  ModuleView dipaksa page='approvals': fallback aman, TANPA tabel
//       dan TANPA tombol keputusan.
//   R5  Tooltip tombol kirim ulang menyebut jalur lean (bukan antrean approval).
// ============================================================
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.Node = dom.window.Node
global.Event = dom.window.Event
global.MouseEvent = dom.window.MouseEvent
global.getComputedStyle = dom.window.getComputedStyle
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}

// jsdom belum punya matchMedia; Sidebar memakainya untuk perilaku drawer.
function stubMatchMedia(width) {
  dom.window.matchMedia = () => ({
    matches: width <= 1024,
    media: `(max-width: 1024px)`,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })
}
stubMatchMedia(1440)

function render(el) {
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  const root = createRoot(host)
  act(() => { root.render(el) })
  return host
}

const noop = () => {}
const session = { user: { email: 'admin@noirliving.id' } }

console.log('\n=== R. RENDER UI: SIDEBAR, DASHBOARD, SHELL ===')

const Sidebar = (await load('components/Sidebar.mjs')).default
const Dashboard = (await load('components/Dashboard.mjs')).default
const ModuleView = (await load('components/ModuleView.mjs')).default
const reqView = await load('modules/requests/view.mjs')

// ---------- R1. Sidebar desktop ----------
{
  const host = render(React.createElement(Sidebar, { page: 'dashboard', setPage: noop, session, logout: noop, role: 'admin' }))
  const labels = [...host.querySelectorAll('nav button')].map(b => (b.textContent || '').trim())
  check('R1a Sidebar admin: 20 item (Approval tidak dirender)', labels.length === 20, `n=${labels.length} :: ${labels.join('|')}`)
  check('R1b tidak ada tombol menu "Approval"', !labels.includes('Approval'), labels.join('|'))
  for (const m of ['Dashboard', 'Projects', 'Vendors', 'Materials', 'Purchase Request', 'Pembelian', 'Serah Terima']) {
    check(`R1c menu inti "${m}" tetap ada`, labels.includes(m))
  }
  check('R1d grup Admin Suite tetap ada', (host.textContent || '').includes('Admin Suite'))
  check('R1e tidak ada header grup kosong', !/\bArsip\b/.test(host.textContent || ''))
}
{
  const host = render(React.createElement(Sidebar, { page: 'dashboard', setPage: noop, session: { user: { email: 'tukang@noirliving.id' } }, logout: noop, role: 'user' }))
  const labels = [...host.querySelectorAll('nav button')].map(b => (b.textContent || '').trim())
  check('R1f Sidebar user: 7 item operasional (tanpa Approval)', labels.length === 7, `n=${labels.length} :: ${labels.join('|')}`)
  check('R1g user juga tidak melihat Approval', !labels.includes('Approval'))
}

// ---------- R2. Drawer mobile ----------
{
  stubMatchMedia(390)
  const host = render(React.createElement(Sidebar, { page: 'dashboard', setPage: noop, session, logout: noop, role: 'admin' }))
  const labels = [...host.querySelectorAll('nav button')].map(b => (b.textContent || '').trim())
  check('R2a drawer mobile: Approval juga tidak ada', !labels.includes('Approval'), labels.join('|'))
  check('R2b drawer mobile tetap 20 item (sama dengan desktop)', labels.length === 20, `n=${labels.length}`)
  check('R2c tombol buka menu mobile ada', !!host.querySelector('.mobile-menu-btn'))
  stubMatchMedia(1440)
}

// ---------- R3. Dashboard ----------
{
  const rows = {
    projects: [{ id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' }],
    requests: [{ id: 'r1', status: 'DRAFT' }, { id: 'r2', status: 'SUBMITTED' }],
    approvals: [{ id: 'a1', status: 'PENDING' }, { id: 'a2', status: 'PENDING' }],
    receivings: [{ id: 'rc1' }],
    handovers: [],
    materials: [], vendors: [], pr_items: [], receiving_items: []
  }
  const host = render(React.createElement(Dashboard, {
    rows,
    activeProjects: rows.projects,
    pastProjects: [],
    setPage: noop,
    role: 'admin'
  }))
  const text = host.textContent || ''
  const cards = [...host.querySelectorAll('.card .card-label')].map(e => (e.textContent || '').trim())
  check('R3a kartu "Menunggu approval" TIDAK dirender', !cards.some(c => /approval/i.test(c)), cards.join('|'))
  check('R3b teks "Menunggu approval" tidak ada di DOM', !/Menunggu approval/i.test(text))
  for (const c of ['Project aktif', 'Purchase Request', 'Pembelian', 'Project selesai']) {
    check(`R3c kartu "${c}" tetap ada`, cards.includes(c))
  }
  const buttons = [...host.querySelectorAll('button')].map(b => (b.textContent || '').trim())
  check('R3d tidak ada tombol dashboard menuju Approval', !buttons.some(b => /approval/i.test(b)))
}

// ---------- R4. ModuleView fallback ----------
{
  const host = render(React.createElement(ModuleView, {
    page: 'approvals',
    rows: [{ id: 'a1', pr_number: 'PR-001', status: 'PENDING', project_name: '[99] Baroni', title: 'X', step_number: 1 }],
    allProjects: [], allMaterials: [], allPrItems: [], allReceivingItems: [], allRequests: [], allReceivings: [], allVendors: [],
    refresh: noop, say: noop, onStatusChange: noop, onReceivingStatusChange: noop,
    onMoveToWarehouse: noop, onSendToTukang: noop, onMarkHandoverDelivered: noop,
    onDecideApproval: noop, onReviseApproval: noop, onApproveItem: noop, onFinishPr: noop,
    onCloseRemaining: noop, onMarkPrItemOrdered: noop, onDelete: noop, setPage: noop
  }))
  const text = host.textContent || ''
  check('R4a fallback approval-off dirender', !!host.querySelector('[data-testid="approval-off-fallback"]'))
  check('R4b TIDAK ada tabel approval', !host.querySelector('table'))
  check('R4c TIDAK ada tombol Setujui/Tolak/Revisi', ![...host.querySelectorAll('button')].some(b => /setuju|tolak|revisi/i.test(b.textContent || '')))
  check('R4d pesan menjelaskan nonaktif sementara', /dinonaktifkan sementara/i.test(text))
  check('R4e tidak menampilkan nomor PR approval', !/PR-001/.test(text))
}

// ---------- R5. Tooltip kirim ulang ----------
{
  const title = reqView.resubmitTitle({ pr_number: 'PR-500' }, 'Purchase Request')
  check('R5a tooltip menyebut jalur lean/siap dibeli', /siap dibeli/i.test(title), title)
  check('R5b tooltip TIDAK menyuruh ke modul Approval', !/ke modul Approval/i.test(title), title)
  check('R5c tooltip menyebut ID & nomor sama', /ID & nomor sama/i.test(title), title)
}

console.log(`\nHASIL RENDER TEST: ${pass} lulus, ${fail} gagal`)
if (fail > 0) {
  console.log('GAGAL: ' + failures.join(' | '))
  process.exit(1)
}
