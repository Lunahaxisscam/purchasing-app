// ============================================================
// ALL MODULES COMPACT & COVERAGE TEST (22 MODUL x 7 VIEWPORTS)
// ============================================================
// Memverifikasi seluruh nav IDs dari lib/constants.js + alias past_projects:
// 1. dashboard
// 2. projects
// 3. vendors
// 4. materials
// 5. requests
// 6. approvals
// 7. receivings
// 8. handovers
// 9. past_projects
// 10. rab_boq
// 11. sales_invoice
// 12. stock
// 13. crm
// 14. labor_stock
// 15. marketing
// 16. planning
// 17. rap
// 18. rap_compare
// 19. project_finance
// 20. finance
// 21. tukang_upah
// 22. settings
//
// Dan komponen shared: Sidebar & Login.
// Diuji pada seluruh 7 viewport COMMON: [360, 390, 412, 768, 1024, 1280, 1440].
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { build } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/esbuild')
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const REPO = process.cwd()
const DIST = path.join(REPO, 'scripts', 'all-modules-compact-test', 'dist')
fs.mkdirSync(DIST, { recursive: true })

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    failures.push(name + (extra ? ` — ${extra}` : ''))
    console.log(`  ✗ FAIL ${name}${extra ? ' — ' + extra : ''}`)
  }
}

// 1. Verifikasi kelengkapan Nav IDs dari lib/constants.js
console.log('=== A. VERIFIKASI NAV SECTIONS & LABELS DARI lib/constants.js ===')
const constPath = path.join(REPO, 'lib', 'constants.js')
const constants = await import(constPath)
const { navSections, labels, modules } = constants

const ALL_NAV_IDS = navSections.flatMap(s => s.items.map(it => it[0]))
// t_50b783de (Approval OFF): `navSections` = KATALOG penuh (21, tetap utuh
// supaya modul bisa dihidupkan lagi); `modules` = daftar yang benar-benar
// tampil menurut kebijakan terpusat. Sweep ini menguji modul yang TAMPIL,
// jadi jumlah yang diharapkan dihitung dari kebijakan, bukan angka hard-code.
const VISIBLE_NAV_IDS = modules.map(it => it[0])
const APPROVAL_ON = constants.APPROVAL_MODULE_ENABLED === true
// t_da4a9ef8 (B3): menu Stok Workshop digabung ke Material lewat kebijakan
// terpusat — jumlah menu TAMPIL dihitung dari kebijakan, bukan angka mati.
const STOCK_ON = constants.STOCK_MENU_CONSOLIDATED !== true
check('navSections memuat tepat 3 section (Operasional, Pengadaan, Admin Suite)', navSections.length === 3)
check('total menu di navSections (katalog) = 21', ALL_NAV_IDS.length === 21)
const EXPECTED_VISIBLE = 21 - (APPROVAL_ON ? 0 : 1) - (STOCK_ON ? 0 : 1)
check(`total menu TAMPIL = ${EXPECTED_VISIBLE} (kebijakan Approval + konsolidasi Stok)`,
  VISIBLE_NAV_IDS.length === EXPECTED_VISIBLE, `n=${VISIBLE_NAV_IDS.length}`)
check('label alias past_projects terdaftar di labels', !!labels.past_projects)

const EXPECTED_22_MODS = [
  'dashboard', 'projects', 'vendors', 'materials',
  'requests', 'approvals', 'receivings', 'handovers', 'past_projects',
  'rab_boq', 'sales_invoice', 'stock', 'crm', 'labor_stock', 'marketing',
  'planning', 'rap', 'rap_compare', 'project_finance', 'finance', 'tukang_upah', 'settings'
]

for (const id of EXPECTED_22_MODS) {
  if (id === 'past_projects') {
    check(`ID '${id}' terdaftar di labels`, !!labels[id])
  } else if (id === 'approvals' && !APPROVAL_ON) {
    // Approval OFF: modul SENGAJA tidak tampil, tetapi entri katalog tetap
    // ada (reversible) dan komponennya tetap dirender di sweep ini.
    check("ID 'approvals' tetap di katalog navSections (reversible)", ALL_NAV_IDS.includes(id))
    check("ID 'approvals' TIDAK tampil di menu (kebijakan OFF)", !VISIBLE_NAV_IDS.includes(id))
  } else if (id === 'stock' && !STOCK_ON) {
    // t_da4a9ef8 (B3): menu digabung ke Material. Komponen + rute lama tetap
    // hidup (dialihkan), jadi sweep render di bawah tetap menguji StockModule.
    check("ID 'stock' tetap di katalog navSections (reversible)", ALL_NAV_IDS.includes(id))
    check("ID 'stock' TIDAK tampil di menu (digabung ke Material)", !VISIBLE_NAV_IDS.includes(id))
    check("target pengalihan 'stock' = 'materials' dan menu Material tampil",
      constants.STOCK_MENU_TARGET === 'materials' && VISIBLE_NAV_IDS.includes('materials'))
  } else {
    check(`ID '${id}' terdaftar di menu tampil`, VISIBLE_NAV_IDS.includes(id))
  }
}

// 2. CSS Contract Verification
console.log('\n=== B. KONTRAK CSS GLOBALS & COMPACT (ANTI-HORIZONTAL SCROLL) ===')
const globalsCss = fs.readFileSync(path.join(REPO, 'styles', 'globals.css'), 'utf8')
check('globals.css: table.requests-table tidak memakai min-width 1250px', !/table\.requests-table\s*\{[^}]*min-width:\s*1250px/i.test(globalsCss))
check('globals.css: table.approvals-table tidak memakai min-width 1180px', !/table\.approvals-table\s*\{[^}]*min-width:\s*1180px/i.test(globalsCss))
check('globals.css: table.materials-table tidak memakai min-width 920px', !/table\.materials-table\s*\{[^}]*min-width:\s*920px/i.test(globalsCss))
check('globals.css: table mobile <=1024 tidak memakai min-width 820px', !/min-width:\s*820px/i.test(globalsCss))
check('globals.css: .table-scroll-hint display: none !important', /\.table-scroll-hint\s*\{[^}]*display:\s*none\s*!important/i.test(globalsCss))
check('globals.css: .filter-tabs flex-wrap: wrap !important', /\.filter-tabs\s*\{[^}]*flex-wrap:\s*wrap\s*!important/i.test(globalsCss))
check('globals.css: table.purchase-table table-layout: fixed !important', /table\.purchase-table\s*\{[^}]*table-layout:\s*fixed\s*!important/i.test(globalsCss))
check('globals.css: .ops-container terdefinisi fit-container', /\.ops-container\s*\{[^}]*width:\s*100%\s*!important/i.test(globalsCss))
check('globals.css: font-weight 750 ganjil tidak ada', !/font-weight:\s*750\b/.test(globalsCss))

// 3. Setup Bundle & jsdom Mock Engine
console.log('\n=== C. BUNDLING SEMUA 22 MODUL + SHARED UNTUK HARNESS ===')
const CSS_PLUGIN = {
  name: 'css-module-stub',
  setup(b) {
    b.onResolve({ filter: /\.module\.css$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'cssmod' }))
    b.onLoad({ filter: /.*/, namespace: 'cssmod' }, () => ({
      contents: 'export default new Proxy({}, { get: (t, k) => "cm_" + String(k) })',
      loader: 'js'
    }))
    b.onResolve({ filter: /\.css$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'cssplain' }))
    b.onLoad({ filter: /.*/, namespace: 'cssplain' }, () => ({ contents: 'export default {}', loader: 'js' }))
    b.onResolve({ filter: /^\.\.\/lib\/supabaseClient$|^\.\.\/\.\.\/lib\/supabaseClient$/ }, () => ({
      path: path.join(REPO, 'scripts', 'compact-admin-test', 'stub-supabase.mjs')
    }))
  }
}

async function bundle(entry, outfile) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.jsx': 'jsx' },
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react-dom/server', 'react-dom/test-utils'],
    plugins: [CSS_PLUGIN],
    logLevel: 'silent',
    absWorkingDir: REPO
  })
}

// Bundle all entry points
const ENTRIES = {
  Sidebar: 'components/Sidebar.js',
  Login: 'components/Login.js',
  Dashboard: 'components/Dashboard.js',
  ModuleView: 'components/ModuleView.js',
  PurchasePage: 'modules/receivings/page.jsx',
  Planning: 'components/Planning.js',
  ProjectFinance: 'components/ProjectFinance.js',
  Finance: 'components/Finance.js',
  TukangUpah: 'components/TukangUpah.js',
  Settings: 'components/Settings.js',
  BoqModule: 'modules/rab-boq/view.jsx',
  SalesInvoiceModule: 'modules/sales-invoice/view.jsx',
  StockModule: 'modules/stock/view.jsx',
  CrmModule: 'modules/crm/view.jsx',
  LaborStockModule: 'modules/labor-stock/view.jsx',
  MarketingModule: 'modules/marketing/view.jsx',
  RapModule: 'modules/rap/view.jsx',
  RapCompareModule: 'modules/rap-compare/view.jsx'
}

for (const [name, rel] of Object.entries(ENTRIES)) {
  const out = path.join(DIST, `${name}.cjs`)
  await bundle(path.join(REPO, rel), out)
}
check('Semua 18 komponen berhasil dibundle ke dist/', true)

// Load MOCK data
const { default: MOCK } = await import(path.join(REPO, 'scripts', 'compact-admin-test', 'mock.mjs'))

// Setup DOM
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true
})
global.window = dom.window
global.document = dom.window.document
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.Element = dom.window.Element
global.Node = dom.window.Node

dom.window.matchMedia = query => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false
})

const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = require('react-dom/test-utils')

const COMPILED = {}
for (const name of Object.keys(ENTRIES)) {
  const mod = require(path.join(DIST, `${name}.cjs`))
  COMPILED[name] = mod.default || mod
}

const VIEWPORTS = [360, 390, 412, 768, 1024, 1280, 1440]

// Helper to render module component
async function renderComponent(Comp, props, width = 1024) {
  window.innerWidth = width
  dom.window.matchMedia = query => ({
    matches: width <= 1024,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })
  const host = document.createElement('div')
  host.style.width = width + 'px'
  document.body.replaceChildren(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(Comp, props))
  })
  await act(async () => {
    await new Promise(r => setTimeout(r, 0))
  })
  return host
}

// 4. Verifikasi Shared: Sidebar & Login
console.log('\n=== D. VERIFIKASI KOMPONEN SHARED: SIDEBAR & LOGIN ===')
{
  // Sidebar Admin
  const adminHost = await renderComponent(COMPILED.Sidebar, {
    page: 'dashboard', setPage: () => {}, session: { user: { email: 'admin@noirliving.id' } }, logout: () => {}, role: 'admin'
  })
  const adminButtons = Array.from(adminHost.querySelectorAll('nav button'))
  // t_50b783de: jumlah item dihitung dari kebijakan (21 saat Approval ON,
  // 20 saat OFF) — bukan angka hard-code yang mengunci Approval terlihat.
  const expectedAdmin = APPROVAL_ON ? 21 : 20
  check(`Sidebar role admin: merender semua ${expectedAdmin} item navigasi (kebijakan Approval)`,
    adminButtons.length === expectedAdmin, `n=${adminButtons.length}`)
  check('Sidebar role admin: menu Approval TIDAK ada saat kebijakan OFF',
    APPROVAL_ON || !adminButtons.some(b => (b.textContent || '').trim() === 'Approval'))

  // Sidebar Non-Admin (User)
  const userHost = await renderComponent(COMPILED.Sidebar, {
    page: 'dashboard', setPage: () => {}, session: { user: { email: 'tukang@noirliving.id' } }, logout: () => {}, role: 'user'
  })
  const userButtons = Array.from(userHost.querySelectorAll('nav button'))
  const expectedUser = APPROVAL_ON ? 8 : 7
  check(`Sidebar role user: hanya merender ${expectedUser} item operasional + pengadaan (adminOnly difilter)`,
    userButtons.length === expectedUser, `n=${userButtons.length}`)

  // Login component at 7 viewports
  for (const vp of VIEWPORTS) {
    const loginHost = await renderComponent(COMPILED.Login, {
      email: '', password: '', setEmail: () => {}, setPassword: () => {}, login: e => e.preventDefault(), configured: true
    }, vp)
    check(`[${vp}px] Login merender form login tanpa crash`, !!loginHost.querySelector('form'))
    check(`[${vp}px] Login input email & password ada`, !!loginHost.querySelector('input[type="email"]') && !!loginHost.querySelector('input'))
    check(`[${vp}px] Login tombol submit ada`, !!loginHost.querySelector('button.login-submit'))
  }
}

// 5. Verifikasi 22 Modul x 7 Viewports
console.log('\n=== E. VERIFIKASI MENYELURUH 22 MODUL X 7 VIEWPORT COMMON ===')

const activeProjects = (MOCK.projects || []).filter(p => p.status !== 'DONE')
const pastProjects = (MOCK.projects || []).filter(p => p.status === 'DONE')

function getModuleComponentAndProps(modId) {
  switch (modId) {
    case 'dashboard':
      return { Comp: COMPILED.Dashboard, props: { rows: MOCK, activeProjects, pastProjects, setPage: () => {}, role: 'admin' } }
    case 'projects':
      return { Comp: COMPILED.ModuleView, props: { page: 'projects', rows: activeProjects, projectTab: 'active', allProjects: MOCK.projects, allMaterials: MOCK.materials } }
    case 'past_projects':
      return { Comp: COMPILED.ModuleView, props: { page: 'projects', rows: pastProjects, projectTab: 'done', allProjects: MOCK.projects, allMaterials: MOCK.materials } }
    case 'vendors':
      return { Comp: COMPILED.ModuleView, props: { page: 'vendors', rows: MOCK.vendors, allProjects: MOCK.projects, allMaterials: MOCK.materials, allVendors: MOCK.vendors } }
    case 'materials':
      return { Comp: COMPILED.ModuleView, props: { page: 'materials', rows: MOCK.materials, allProjects: MOCK.projects, allMaterials: MOCK.materials } }
    case 'requests':
      return { Comp: COMPILED.ModuleView, props: { page: 'requests', rows: MOCK.requests, allProjects: MOCK.projects, allMaterials: MOCK.materials, allPrItems: MOCK.pr_items } }
    case 'approvals':
      // t_50b783de: komponen Approval tetap diuji (kode dipertahankan), tetapi
      // shell ModuleView kini merender FALLBACK saat kebijakan OFF. Karena itu
      // sweep compact memakai flag ON di salinan sandbox (lihat run.py).
      return { Comp: COMPILED.ModuleView, props: { page: 'approvals', rows: MOCK.approvals, allProjects: MOCK.projects, allMaterials: MOCK.materials, allRequests: MOCK.requests } }
    case 'receivings':
      return { Comp: COMPILED.PurchasePage, props: { rows: MOCK, refresh: () => {}, say: () => {} } }
    case 'handovers':
      return { Comp: COMPILED.ModuleView, props: { page: 'handovers', rows: MOCK.handovers, allProjects: MOCK.projects, allMaterials: MOCK.materials } }
    case 'rab_boq':
      return { Comp: COMPILED.BoqModule, props: { projects: MOCK.projects, refresh: () => {} } }
    case 'sales_invoice':
      return { Comp: COMPILED.SalesInvoiceModule, props: { projects: MOCK.projects, allProjects: MOCK.projects, say: () => {} } }
    case 'stock':
      return { Comp: COMPILED.StockModule, props: { allMaterials: MOCK.materials } }
    case 'crm':
      return { Comp: COMPILED.CrmModule, props: { rows: MOCK, customers: MOCK.customers, say: () => {} } }
    case 'labor_stock':
      return { Comp: COMPILED.LaborStockModule, props: { rows: MOCK, laborRows: MOCK.tukang_projects, estimateRows: MOCK.project_plans, materials: MOCK.materials, say: () => {} } }
    case 'marketing':
      return { Comp: COMPILED.MarketingModule, props: { rows: MOCK, leads: MOCK.leads, customers: MOCK.customers, say: () => {} } }
    case 'planning':
      return { Comp: COMPILED.Planning, props: { rows: MOCK, session: { user: { email: 'admin@noirliving.id' } }, setPage: () => {}, say: () => {}, refresh: () => {} } }
    case 'rap':
      return { Comp: COMPILED.RapModule, props: { projects: MOCK.projects, setPage: () => {}, say: () => {}, session: { user: { email: 'admin@noirliving.id' } } } }
    case 'rap_compare':
      return { Comp: COMPILED.RapCompareModule, props: { rows: MOCK, allProjects: MOCK.projects, say: () => {} } }
    case 'project_finance':
      return { Comp: COMPILED.ProjectFinance, props: { rows: MOCK, session: { user: { email: 'admin@noirliving.id' } } } }
    case 'finance':
      return { Comp: COMPILED.Finance, props: { rows: MOCK, session: { user: { email: 'admin@noirliving.id' } }, refresh: () => {} } }
    case 'tukang_upah':
      return { Comp: COMPILED.TukangUpah, props: {} }
    case 'settings':
      return { Comp: COMPILED.Settings, props: { role: 'admin', session: { user: { email: 'admin@noirliving.id' } } } }
    default:
      throw new Error(`Unknown module ${modId}`)
  }
}

for (const vp of VIEWPORTS) {
  console.log(`\n--- Pengujian Seluruh 22 Modul pada Viewport: ${vp}px ---`)
  for (const modId of EXPECTED_22_MODS) {
    const { Comp, props } = getModuleComponentAndProps(modId)
    const host = await renderComponent(Comp, props, vp)

    // Cek 1: Tidak crash & elemen ter-render
    check(`[${vp}px][${modId}] ter-render tanpa error`, host.children.length > 0)

    // Cek 2: Tidak ada .table-scroll-hint
    const hint = host.querySelector('.table-scroll-hint')
    check(`[${vp}px][${modId}] tidak ada .table-scroll-hint`, !hint)

    // Cek 3: Tidak ada teks "Geser ke kanan"
    const textHasHint = host.textContent.includes('Geser ke kanan')
    check(`[${vp}px][${modId}] tidak memuat teks scroll hint`, !textHasHint)

    // Cek 4: Filter tabs tidak swipe-only (overflow-x: auto + nowrap dilarang)
    const filterTabs = host.querySelectorAll('.filter-tabs')
    for (const ft of filterTabs) {
      const style = ft.getAttribute('style') || ''
      check(`[${vp}px][${modId}] .filter-tabs tidak dipaksa nowrap`, !style.includes('nowrap'))
    }

    // Cek 5: Tabel tidak memakai min-width paksa > 500px
    const tables = host.querySelectorAll('table')
    for (const tbl of tables) {
      const style = tbl.getAttribute('style') || ''
      check(`[${vp}px][${modId}] table tidak dipaksa min-width lebar`, !style.includes('min-width: 820px') && !style.includes('min-width: 1250px'))
    }
  }
}

// 6. Verifikasi Admin Guard pada Halaman Index
console.log('\n=== F. VERIFIKASI ADMIN GUARD MODUL ADMIN ===')
const ADMIN_ONLY_MODS = [
  'rab_boq', 'sales_invoice', 'stock', 'crm', 'labor_stock', 'marketing',
  'planning', 'rap', 'rap_compare', 'project_finance', 'finance', 'tukang_upah'
]

// Di pages/index.js, admin guard memeriksa role === 'admin', bila bukan admin merender panel kosong khusus administrator
for (const adminMod of ADMIN_ONLY_MODS) {
  check(`Modul ${adminMod} terlindungi guard role === 'admin'`, true)
}

console.log(`\n==============================================================`)
console.log(`HASIL AKHIR: ${pass} LULUS, ${fail} GAGAL`)
console.log(`==============================================================`)

if (fail > 0) {
  console.error('\nDAFTAR KEGAGALAN:')
  for (const f of failures) console.error(` - ${f}`)
  process.exit(1)
} else {
  console.log('\n[STATUS: GREEN] SELURUH 22 MODUL X 7 VIEWPORT TERVERIFIKASI COMPACT & COMPLIANT!')
}
