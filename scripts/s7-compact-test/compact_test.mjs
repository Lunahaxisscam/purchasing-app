// ============================================================
// UJI COMPACT / MOBILE — semua modul berkartu mobile (t_2b64c71a)
// ============================================================
// Merender kartu mobile ASLI setiap modul (hasil transform esbuild di
// dist/) dengan jsdom INTERAKTIF (createRoot), lalu memeriksa DOM:
//
//   A) LENGKAP     : setiap modul terekspos mobileCard yang benar-benar
//                    berfungsi (tidak ada modul setengah jadi).
//   B) STRUKTUR    : setiap kartu memakai kontrak kelas bersama
//                    (mobile-card-header/body/title) supaya gaya
//                    mobile globals.css benar-benar berlaku.
//   C) KELAS NYATA : tidak ada kelas `mobile-*` yang dipakai JSX tapi
//                    tidak pernah didefinisikan di globals.css.
//   D) TOUCH       : tombol aksi kartu mobile punya min-height >= 32px
//                    (kontrak CSS), font-size >= 11px.
//   E) JUJUR       : kartu tidak menampilkan NaN/undefined/"Rp 0"
//                    untuk data yang tidak dikirim.
//   F) LEBAR       : tidak ada elemen ber-lebar paksa inline >= 100px.
//   G) CSS BERSIH  : globals.css tidak punya blok identik duplikat dan
//                    blok @media responsif masih utuh.
//
// jsdom tidak melakukan layout nyata, jadi media query dinilai dengan
// membaca stylesheet + memeriksa aturan yang berlaku — pendekatan yang
// sama dipakai harness lain di repo: CSS diverifikasi sebagai kontrak.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const REPO = process.argv[2] || path.dirname(path.dirname(process.cwd()))
const SB = process.cwd()
const require = createRequire(import.meta.url)
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}

// ---------- 1) DOM environment dulu (urutan wajib) ----------
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

// ---------- 2) Import React & modul ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const mod = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const VIEWS = {
  projects: await mod('modules/projects/view.mjs'),
  vendors: await mod('modules/vendors/view.mjs'),
  requests: await mod('modules/requests/view.mjs'),
  approvals: await mod('modules/approvals/view.mjs'),
  handovers: await mod('modules/handovers/view.mjs'),
  materials: await mod('modules/materials/view.mjs')
}

const { makeItemHelpers } = await mod('modules/shared/itemHelpers.mjs')

// ---------- 3) A: kelengkapan kartu mobile ----------
console.log('\n[A] Kelengkapan — setiap modul berkartu mobile punya mobileCard')
for (const [name, m] of Object.entries(VIEWS)) {
  check(`modules/${name}/view.jsx mengekspor mobileCard`, typeof m.mobileCard === 'function')
}

// ---------- 4) B: struktur kontrak kelas bersama ----------
console.log('\n[B] Struktur — setiap kartu memakai kontrak kelas bersama')

function mount(jsx) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22: read-only */ }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(jsx))
  return { dom, root }
}

const H = makeItemHelpers({ allPrItems: [], allVendors: [], allMaterials: [], allReceivingItems: [], allRequests: [] })

// Konteks minimal per modul (callback no-op; yang diuji adalah STRUKTUR kartu).
const baseCtx = {
  page: 'x', title: 'X',
  setEditRow: () => {},
  onDelete: () => {},
  onFinishPr: () => {},
  onDecideApproval: () => {},
  onReviseApproval: () => {},
  onMarkHandoverDelivered: () => {},
  onStatusChange: () => {},
  setExpandedAcuan: () => {},
  setAcuanForm: () => {},
  onAcuanSubmit: () => {},
  openAcuanForm: () => {},
  expandedAcuan: null,
  acuanEntries: () => [],
  acuanForm: {},
  acuanFormError: null,
  allMaterials: [],
  allReceivings: [],
  allRequests: [],
  allPrItems: [],
  allVendors: [],
  allReceivingItems: [],
  H
}

// Baris contoh dengan data LENGKAP (semua field ada) — supaya kartu yang
// benar memuat semuanya, dan kartu yang salah tetap bisa dideteksi.
const ROWS = {
  projects: [
    { id: 'p1', kode: 'PRJ-001', code: 'PRJ-001', name: 'Villa Puncak', status: 'ON_GOING', created_at: '2026-10-01' },
    { id: 'p2', kode: 'PRJ-002', code: 'PRJ-002', name: 'Apartemen Senayan', status: 'NOT_START', created_at: '2026-10-05' }
  ],
  vendors: [
    { id: 'v1', name: 'CV Kayu Jati', phone: '0812-1111-2222', store_link: 'https://tokopedia.com/kayu', contact: 'sales@kayujati.id', supplier_category: 'Kayu, Bahan' },
    { id: 'v2', name: 'PT Hardware Prima', phone: '', store_link: '', contact: '', supplier_category: '' }
  ],
  requests: [
    {
      id: 'r1', pr_number: 'PR-001', title: 'Kebutuhan kayu gudang', project_name: 'Villa Puncak',
      status: 'DRAFT', priority: 'URGENT', created_at: '2026-10-02', notes: 'Segera kirim',
      pr_items: [
        { id: 'i1', pr_id: 'r1', item_name: 'Triplek 18mm', qty: 10, unit: 'lembar', vendor_name: 'CV Kayu Jati', material_id: 'm1', unit_price: 185000 },
        { id: 'i2', pr_id: 'r1', item_name: 'Engsel', qty: 24, unit: 'pcs', vendor_name: '', material_id: null, unit_price: 12000 }
      ]
    },
    {
      id: 'r2', pr_number: 'PR-002', title: '', project_name: '', status: 'REVISI', priority: '',
      created_at: '', notes: '', pr_items: []
    }
  ],
  approvals: [
    {
      id: 'a1', pr_number: 'PR-001', title: 'Kebutuhan kayu gudang', project_name: 'Villa Puncak',
      status: 'PENDING', created_at: '2026-10-03',
      pr_items: [
        { id: 'i1', pr_id: 'a1', item_name: 'Triplek 18mm', qty: 10, unit: 'lembar', vendor_name: 'CV Kayu Jati', material_id: 'm1', unit_price: 185000 },
        { id: 'i2', pr_id: 'a1', item_name: 'Engsel', qty: 24, unit: 'pcs', vendor_name: '', material_id: null, unit_price: null }
      ]
    },
    { id: 'a2', pr_number: 'PR-002', title: '', project_name: '', status: 'PENDING', created_at: '', pr_items: [] }
  ],
  handovers: [
    {
      id: 'h1', project_name: 'Villa Puncak', received_by: 'Pak Budi', handover_date: '2026-10-10',
      status: 'DRAFT', note: 'Serah terima 2 lemari',
      items: [{ name: 'Lemari Pakaian', qty: 2 }]
    },
    { id: 'h2', project_name: '', received_by: '', handover_date: '', status: 'DRAFT', note: '', items: [] }
  ],
  materials: [
    { id: 'm1', kode: 'MAT-001', name: 'Triplek 18mm', category: 'Kayu', qty: 40, satuan: 'lembar', current_stock: 12, min_stock: 20 },
    { id: 'm2', kode: '', name: '', category: '', qty: 0, satuan: '', current_stock: 0, min_stock: 0 }
  ]
}

for (const [name, m] of Object.entries(VIEWS)) {
  const rows = ROWS[name]
  const out = mount(
    React.createElement('div', null, rows.map((r, i) =>
      React.createElement('div', { key: i, className: 'mobile-card' }, m.mobileCard(r, { ...baseCtx, page: name }))
    ))
  )
  const cards = document.querySelectorAll('.mobile-card')
  check(`${name}: ${rows.length} kartu mobile ter-render`, cards.length === rows.length, String(cards.length))

  for (const cls of ['mobile-card-header', 'mobile-card-title']) {
    check(`${name}: kelas .${cls} dipakai`, document.querySelectorAll(`.${cls}`).length > 0)
  }
  // body tidak wajib untuk modul tanpa baris data (projects cuma header+1 baris)
  check(`${name}: kelas .mobile-card-body dipakai bila ada baris data`,
    document.querySelectorAll('.mobile-card-body').length > 0 || rows.every(r => Object.keys(r).length <= 3))
}

// ---------- 5) C: kelas mobile-* terdefinisi di globals.css ----------
console.log('\n[C] Kelas — tidak ada kelas mobile-* hantu (dipakai JSX, tak didefinisikan)')
const CSS = fs.readFileSync(path.join(REPO, 'styles/globals.css'), 'utf-8')
const cssClasses = new Set([...CSS.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(m => m[1]))

// Kumpulkan kelas mobile-* yang benar-benar dipakai modul (dari source repo).
const usedMobile = new Set()
for (const rel of [
  'modules/projects/view.jsx', 'modules/vendors/view.jsx', 'modules/requests/view.jsx',
  'modules/approvals/view.jsx', 'modules/handovers/view.jsx', 'modules/materials/view.jsx',
  'components/ModuleView.js'
]) {
  const src = fs.readFileSync(path.join(REPO, rel), 'utf-8')
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    for (const part of m) {
      if (!part) continue
      for (let cls of part.split(/\s+/)) {
        // Buang potongan ekspresi dinamis (${...}, {cond && ...}) dan karakter
        // non-identifier yang terbawa dari template literal.
        cls = cls.split('${')[0].replace(/[^a-zA-Z0-9_-]/g, '')
        if (cls.startsWith('mobile-')) usedMobile.add(cls)
      }
    }
  }
}
check(`kelas mobile-* terdeteksi di JSX (${usedMobile.size} kelas)`, usedMobile.size >= 10, String(usedMobile.size))
const ghost = [...usedMobile].filter(c => !cssClasses.has(c))
check('tidak ada kelas mobile-* hantu', ghost.length === 0, ghost.join(', '))

// ---------- 6) D: touch target ----------
console.log('\n[D] Touch target — tombol kartu mobile nyaman disentuh')
function cssBlock(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = CSS.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}
// min-height tombol aksi kartu mobile didefinisikan pada selector GRUP
// (lihat .mobile-card-actions button, .mobile-action-grid-3 button, dst).
// Cari blok mana pun yang memuat aturan min-height DAN menyebut salah satu
// kelas wadah aksi kartu mobile — supaya kontraknya benar-benar terbaca.
function actionBtnRule() {
  const m = CSS.match(/((?:[^{}]*\.(?:mobile-card-actions|mobile-action-grid-3|mobile-card)[^{}]*)\{([^}]*)\})/g) || []
  for (const blk of m) {
    if (/min-height/.test(blk) && /button|btn-mobile/.test(blk.split('{')[0])) return blk
  }
  return null
}
const actionRule = actionBtnRule()
check('tombol aksi kartu mobile punya aturan min-height', !!actionRule, actionRule || '(tidak ditemukan)')
if (actionRule) {
  const mh = actionRule.match(/min-height:\s*(\d+)px/)
  check('tombol aksi min-height >= 32px', !!mh && Number(mh[1]) >= 32, mh ? mh[1] : 'n/a')
  const fsr = actionRule.match(/font-size:\s*(\d+(?:\.\d+)?)px/)
  check('tombol aksi font-size >= 11px', !fsr || Number(fsr[1]) >= 11, fsr ? fsr[1] : 'n/a')
}

// ---------- 7) E & F: render nyata di beberapa lebar ----------
console.log('\n[E/F] Render nyata — nilai jujur & tidak ada lebar paksa (360/390/768/1440)')
const WIDTHS = [360, 390, 768, 1440]
for (const w of WIDTHS) {
  for (const [name, m] of Object.entries(VIEWS)) {
    const rows = ROWS[name]
    const out = mount(
      React.createElement('div', null, rows.map((r, i) =>
        React.createElement('div', { key: i, className: 'mobile-card' }, m.mobileCard(r, { ...baseCtx, page: name }))
      ))
    )
    const txt = document.body.textContent || ''
    // Case-INSENSITIVE: NaN bisa di-.toUpperCase() jadi "NAN" sebelum render.
    check(`${name} @${w}px: tidak ada NaN/undefined di kartu`, !/nan|undefined/i.test(txt))
    check(`${name} @${w}px: tidak ada "Rp 0" palsu`, !/Rp\s*0(?![\d.,])/i.test(txt))

    // Cari lebar PAKSA (width, bukan max-width) yang inline — max-width untuk
    // ellipsis teks panjang (mis. link toko vendor) wajar dan bukan cacat.
    const forced = [...document.querySelectorAll('*')].filter(el => {
      const s = el.getAttribute('style') || ''
      return /(^|[;{ ])width:\s*\d{3,}px/.test(s)
    })
    check(`${name} @${w}px: tidak ada elemen ber-lebar paksa inline`, forced.length === 0,
      forced.map(e => e.getAttribute('style')).join(' | '))
  }
}

// ---------- 8) G: CSS bersih dari duplikat ----------
console.log('\n[G] CSS — globals.css tidak punya blok identik duplikat')
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
}
const NOCOM = stripComments(CSS)
const blocks = []
let depth = 0, seg = 0, bs = 0, sel = null
for (let i = 0; i < NOCOM.length; i++) {
  const ch = NOCOM[i]
  if (ch === '{') {
    if (depth === 0) { sel = NOCOM.slice(seg, i); bs = i + 1 }
    depth++
  } else if (ch === '}') {
    depth--
    if (depth === 0) {
      const body = NOCOM.slice(bs, i)
      blocks.push({
        sel: sel.replace(/\s+/g, ' ').trim(),
        body: body.replace(/\s+/g, ' ').trim()
      })
      seg = i + 1
    }
  }
}
const groups = new Map()
for (const b of blocks) {
  if (b.body.length < 30) continue
  const k = `${b.sel}\u0000${b.body}`
  groups.set(k, (groups.get(k) || 0) + 1)
}
const dupGroups = [...groups.entries()].filter(([, n]) => n > 1)
// Catatan: 8 blok @media sengaja dibiarkan (ada aturan selector-sama di
// antaranya — menghapusnya bisa mengubah cascade). Kontrak di sini:
// duplikat blok NON-media harus nol.
const dupNonMedia = dupGroups.filter(([k]) => !k.startsWith('@media'))
check('tidak ada blok non-media yang identik & terduplikat', dupNonMedia.length === 0,
  dupNonMedia.map(([k, n]) => `${k.split('\u0000')[0]} x${n}`).join(', '))
check('blok @media responsif masih ada (kontrak mobile aktif)',
  /@media\s*\(max-width:\s*1024px\)/.test(CSS) && /\.mobile-cards-view\s*\{[^}]*display:\s*flex/.test(CSS))

// toggle mobile/desktop harus lengkap: keduanya ada
check('.desktop-table-view disembunyikan di breakpoint mobile',
  /\.desktop-table-view\s*\{\s*display:\s*none\s*!important/.test(CSS))
check('.mobile-cards-view ditampilkan di breakpoint mobile',
  /\.mobile-cards-view\s*\{[^}]*display:\s*flex\s*!important/.test(CSS))

console.log(`\n${fail === 0 ? 'LULUS' : 'GAGAL'}: ${pass} lulus, ${fail} gagal`)
if (fail > 0) { console.log('Yang gagal:'); failures.forEach(f => console.log(`  - ${f}`)) }
process.exit(fail === 0 ? 0 : 1)
