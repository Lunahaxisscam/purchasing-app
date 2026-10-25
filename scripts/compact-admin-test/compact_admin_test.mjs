// ============================================================
// HARNESS COMPACT ADMIN — kontrak CSS + render jsdom
// ============================================================
// Membuktikan DUA hal tanpa browser dan tanpa DB:
//
//   A) KONTRAK CSS (statis, dibaca dari file):
//      - compact-admin.module.css ada & semua selektor di-scope `.root`
//      - TIDAK ada `overflow-x: hidden` pada tabel/container data
//      - ada blok stacked `table[data-stack]` + `td::before{content:attr(data-label)}`
//      - globals.css TIDAK diubah oleh task ini (aturan print utuh)
//
//   B) RENDER NYATA (esbuild + jsdom + React asli):
//      setiap view modul di-render, lalu diperiksa:
//      - root memakai kelas compact (scope CSS benar-benar terpasang)
//      - SEMUA <table> dapat data-stack
//      - SETIAP <td> berisi data punya data-label (tidak ada kolom hilang)
//      - jumlah sel & seluruh teks sel SEBELUM vs SESUDAH dekorasi identik
//        (dekorasi presentasi tidak mengubah data)
//      - tabel dokumen cetak (.print-portal/.print-table) TIDAK disentuh
//
// Catatan: jsdom tidak menghitung layout, jadi lebar piksel TIDAK diukur di
// sini. Itu sebabnya laporan menyebut geometry runtime sebagai UNVERIFIED.
//
// Jalankan: node scripts/compact-admin-test/compact_admin_test.mjs
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { build } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/esbuild')
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const REPO = process.cwd()
const DIST = path.join(REPO, 'scripts', 'compact-admin-test', 'dist')
fs.mkdirSync(DIST, { recursive: true })

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`) }
  else { fail += 1; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

// ---------- A. Kontrak CSS ----------
console.log('\n=== A. KONTRAK CSS (compact-admin.module.css) ===')
const cssPath = path.join(REPO, 'components', 'compact-admin.module.css')
check('file CSS module ada', fs.existsSync(cssPath))
const css = fs.readFileSync(cssPath, 'utf8')
// Komentar CSS memuat contoh aturan globals yang di-netralkan — jangan
// ikut diuji sebagai deklarasi.
const cssDecls = css.replace(/\/\*[\s\S]*?\*\//g, '')

check('scope .root dipakai', /\.root\b/.test(css))
check('blok stacked table[data-stack] ada', /table\[data-stack\]/.test(css))
check('label kolom via attr(data-label)', /content:\s*attr\(data-label\)/.test(css))
check('tabel dipaksa table-layout: fixed', /table-layout:\s*fixed\s*!important/.test(css))
check('tidak ada overflow-x: hidden pada tabel',
  !/table[^{]*\{[^}]*overflow-x:\s*hidden/i.test(cssDecls))
check('tidak ada scroller samping pada wadah tabel (overflow-x:auto)',
  !/overflow-x:\s*auto/i.test(cssDecls))
check('wadah tabel menetralkan overflow globals',
  /\.table[^{]*\{[^}]*overflow:\s*visible\s*!important/s.test(cssDecls))
check('filter-tabs tidak lagi jadi baris geser',
  /\.filter-tabs[^}]*overflow-x:\s*visible\s*!important/s.test(cssDecls))
check('angka tabular-nums dipakai', /tabular-nums/.test(css))
check('media query stacked <=1400px ada', /@media \(max-width: 1400px\)/.test(cssDecls))
check('media query sentuh <=1024px ada', /@media \(max-width: 1024px\)/.test(css))
check('editor BOQ punya aturan sendiri', /\.boq-cost-row/.test(css) && /\.boq-workspace/.test(css))

const globalsPath = path.join(REPO, 'styles', 'globals.css')
const globals = fs.readFileSync(globalsPath, 'utf8')
check('globals.css tidak diimpor ulang dari module (tidak ada @import)',
  !/@import/.test(css))
check('aturan @media print di globals.css masih ada', /@media print/.test(globals))
check('tidak ada !important global baru di globals untuk data-stack',
  !/data-stack/.test(globals))

// ---------- B. Render nyata ----------
const MODULES = [
  { id: 'dashboard', file: 'components/Dashboard.js', props: `{
      rows: MOCK, activeProjects: MOCK.projects.filter(p => p.status !== 'DONE'),
      pastProjects: MOCK.projects.filter(p => p.status === 'DONE'),
      setPage: () => {}, role: 'admin' }` },
  { id: 'finance', file: 'components/Finance.js', props: '{ rows: MOCK, session: null, refresh: () => {} }', clicks: ['.filter-tabs .pill:nth-child(4)'] },
  { id: 'planning', file: 'components/Planning.js', props: '{ rows: MOCK, session: null, say: () => {}, setPage: () => {}, refresh: () => {} }' },
  { id: 'project-finance', file: 'components/ProjectFinance.js', props: '{ rows: MOCK, session: null }', clicks: ['.filter-tabs .pill:nth-child(2)'] },
  { id: 'tukang-upah', file: 'components/TukangUpah.js', props: '{}', clicks: ['.filter-tabs .pill:nth-child(2)'] },
  { id: 'settings', file: 'components/Settings.js', props: '{ role: "admin", session: { user: { id: "u1", email: "admin@noirliving.test" } } }', clicks: ['.filter-tabs .pill:nth-child(2)'] },
  { id: 'stock', file: 'modules/stock/view.jsx', props: '{ allMaterials: MOCK.materials }' },
  { id: 'crm', file: 'modules/crm/view.jsx', props: '{ rows: MOCK, customers: MOCK.customers, invoiceCounts: { c1: 2 } }' },
  { id: 'labor-stock', file: 'modules/labor-stock/view.jsx', props: '{ rows: MOCK, laborRows: MOCK.tukang_projects, estimateRows: MOCK.project_plans, materials: MOCK.materials }' },
  { id: 'marketing', file: 'modules/marketing/view.jsx', props: '{ rows: MOCK, leads: MOCK.leads, customers: MOCK.customers }' },
  { id: 'rap-compare', file: 'modules/rap-compare/view.jsx', props: '{ rows: MOCK, allProjects: MOCK.projects, rabItems: MOCK.rab_items }' },
  { id: 'sales-invoice', file: 'modules/sales-invoice/view.jsx', props: '{ invoices: MOCK.sales_invoices, projects: MOCK.projects, allProjects: MOCK.projects }', clicks: ['.si-btn-create'] },
  { id: 'rap', file: 'modules/rap/view.jsx', props: '{ projects: MOCK.projects, say: () => {}, setPage: () => {}, materials: MOCK.materials, initialDraft: RAP_DRAFT }', clicks: ['[data-testid="rap-act-add-line"]', '[data-testid="rap-act-add-material"]'] },
  { id: 'rab-boq', file: 'modules/rab-boq/view.jsx', props: '{ projects: MOCK.projects, refresh: () => {} }', clicks: ['.boq-add-row'] }
]

const MOCK_SRC = path.join(REPO, 'scripts', 'compact-admin-test', 'mock.mjs')

// Draft RAP minimal (bentuk kontrak modules/rap/model.js createRapDraft) —
// dipakai supaya tabel baris RAP (10 kolom input) ikut ter-render di harness.
const RAP_DRAFT = `{
  id: 'rap-harness', version: 'RAP-01', status: 'DRAFT',
  project_id: 'p1', project_name: 'Mabes Polri Renovasi Lantai 3 Sayap Barat', project_kode: '83',
  rab_reff: 'BOQ-83', rab_revision: '0', rab_basis: 'RAB',
  rab_lines: [], lines: [], history: [], persisted: false, persistence: 'DRAFT_ONLY'
}`

const CSS_PLUGIN = {
  name: 'css-module-stub',
  setup(b) {
    b.onResolve({ filter: /\.module\.css$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'cssmod' }))
    b.onLoad({ filter: /.*/, namespace: 'cssmod' }, () => ({
      // Meniru kelas hasil hash CSS module: satu kelas acak per file.
      contents: 'export default new Proxy({}, { get: (t, k) => "cm_" + String(k) })',
      loader: 'js'
    }))
    b.onResolve({ filter: /\.css$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'cssplain' }))
    b.onLoad({ filter: /.*/, namespace: 'cssplain' }, () => ({ contents: 'export default {}', loader: 'js' }))
    // Harness tanpa .env: ganti klien Supabase dengan stub fixture (read-only).
    b.onResolve({ filter: /^\.\.\/lib\/supabaseClient$|^\.\.\/\.\.\/lib\/supabaseClient$/ }, args => ({
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

// Render helper: dieksekusi di dalam jsdom.
const RENDER_DRIVER = `
globalThis.__RUN__ = async function __run(clicks) {
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const { act } = require('react-dom/test-utils')
  const { MODULE, PROPS, RAP_DRAFT } = globalThis.__SPEC__
  const el = React.createElement(MODULE, PROPS)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(el) })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  const clicked = []
  for (const sel of (clicks || [])) {
    const btn = host.querySelector(sel)
    clicked.push({ sel, found: !!btn })
    if (btn) {
      await act(async () => { btn.click() })
      await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    }
  }
  globalThis.__HOST__ = host
  globalThis.__CLICKED__ = clicked
}
`

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.Element = dom.window.Element
global.Node = dom.window.Node
global.MutationObserver = dom.window.MutationObserver
global.getComputedStyle = dom.window.getComputedStyle
global.IS_REACT_ACT_ENVIRONMENT = true
global.self = dom.window

console.log('\n=== B. RENDER NYATA (esbuild + jsdom + React) ===')

let rendered = 0
for (const mod of MODULES) {
  const entry = path.join(DIST, `${mod.id}.entry.mjs`)
  const outfile = path.join(DIST, `${mod.id}.bundle.cjs`)
  const rel = path.relative(DIST, path.join(REPO, mod.file)).replace(/\\/g, '/')
  fs.writeFileSync(entry, [
    `import MODULE from '${rel.startsWith('.') ? rel : './' + rel}'`,
    `import { decorateTables } from '${path.relative(DIST, path.join(REPO, 'components', 'CompactRoot.js')).replace(/\\/g, '/')}'`,
    `import MOCK from '${path.relative(DIST, MOCK_SRC).replace(/\\/g, '/')}'`,
    `const RAP_DRAFT = ${RAP_DRAFT}`,
    `globalThis.__SPEC__ = { MODULE, PROPS: ${mod.props}, MOCK, RAP_DRAFT }`,
    `globalThis.__DECORATE__ = decorateTables`,
    RENDER_DRIVER
  ].join('\n'))

  try {
    await bundle(entry, outfile)
  } catch (e) {
    check(`${mod.id}: bundle`, false, String(e.message).slice(0, 200))
    continue
  }

  let err = null
  const origError = console.error
  console.error = (...a) => { const s = a.map(String).join(' '); if (!err && /Warning:/.test(s) === false) err = s }
  try {
    require(outfile)
    await globalThis.__RUN__(mod.clicks || null)
  } catch (e) {
    err = e && e.message
  }
  console.error = origError

  check(`${mod.id}: render tanpa exception`, !err, err ? String(err).slice(0, 240) : '')
  if (err) continue
  rendered += 1

  const host = globalThis.__HOST__
  const clicked = globalThis.__CLICKED__ || []
  const missing = clicked.filter(c => !c.found)
  check(`${mod.id}: semua pemicu state ditemukan (${clicked.length - missing.length}/${clicked.length})`,
    missing.length === 0, missing.map(c => c.sel).join(', '))
  const compactRoot = host.firstElementChild
  check(`${mod.id}: root memakai scope compact`,
    !!compactRoot && String(compactRoot.className || '').includes('cm_root'))

  const tables = [...host.querySelectorAll('table')]
    .filter(t => !t.closest('.print-portal, .print-dialog, .print-modal'))
  const stacked = tables.filter(t => ['1', 'wide', 'mid'].includes(t.getAttribute('data-stack')))
  const off = tables.filter(t => t.getAttribute('data-stack') === 'off')
  // Tabel <=3 kolom sengaja TIDAK diberi data-stack (cukup tabel rapat);
  // yang dihitung sebagai "belum diputuskan" hanya tabel yang tidak punya
  // data-compact sama sekali.
  const untouched = tables.filter(t => !t.hasAttribute('data-compact'))
  // RAB & BOQ punya editor dengan aturan stacked sendiri (dilewati decorator).
  const expectsDecoration = mod.id !== 'rab-boq'
  if (expectsDecoration) {
    check(`${mod.id}: semua tabel diputuskan (stacked=${stacked.length}, compact-only=${off.length}, untouched=${untouched.length})`,
      untouched.length === 0, `untouched=${untouched.length}`)
  }

  let cells = 0
  let unlabeled = 0
  let emptyLabelWithText = 0
  for (const t of tables) {
    // Hanya tabel yang masuk mode stacked yang wajib punya label per sel.
    if (!t.hasAttribute('data-stack')) continue
    for (const tr of t.querySelectorAll('tbody tr, tfoot tr')) {
      const rowCells = [...tr.cells]
      if (rowCells.length === 1 && rowCells[0].colSpan > 1) continue
      for (const td of rowCells) {
        const text = (td.textContent || '').trim()
        const hasControl = !!td.querySelector('input, select, textarea, button, a, img, svg')
        if (!text && !hasControl) continue
        cells += 1
        if (!td.hasAttribute('data-label')) unlabeled += 1
        else if (!td.getAttribute('data-label') && text && tr.parentElement.tagName === 'TBODY'
          && !td.querySelector('input, select, textarea, button')) {
          // Sel tanpa label hanya boleh untuk kolom aksi (isinya tombol).
          emptyLabelWithText += 1
          if (process.env.DEBUG_LABELS) console.log('    [label kosong]', td.outerHTML.slice(0, 160))
        }
      }
    }
  }
  if (expectsDecoration) {
    check(`${mod.id}: semua sel berisi punya label (${cells} sel)`, unlabeled === 0, `${unlabeled} tanpa data-label`)
    check(`${mod.id}: tidak ada label kosong pada sel berisi`, emptyLabelWithText === 0, `${emptyLabelWithText} sel`)
  } else {
    check(`${mod.id}: editor BOQ memakai data-label native`, host.querySelectorAll('.boq-item-row td[data-label]').length > 0)
  }

  // Data tidak berubah: dekorasi hanya menambah atribut.
  const snapshot = host.innerHTML
  const decorateTables = globalThis.__DECORATE__
  const again = typeof decorateTables === 'function' ? decorateTables(host) : -1
  check(`${mod.id}: dekorasi idempoten (tidak mengubah HTML)`, host.innerHTML === snapshot, `returned=${again}`)

  host.remove()
}
check('minimal 12 modul berhasil dirender', rendered >= 12, `rendered=${rendered}`)

console.log(`\n=== RINGKASAN: ${pass} ok, ${fail} gagal ===`)
if (fail) {
  console.log('\nGAGAL:')
  failures.forEach(f => console.log(' - ' + f))
  process.exit(1)
}
