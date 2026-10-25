// ============================================================
// UJI RENDER — modules/labor-stock/view.jsx (t_62e41e91)
// Merender komponen ASLI (hasil esbuild di dist/) dengan jsdom
// INTERAKTIF (createRoot), lalu memeriksa DOM:
//   A) Sumber aktual tidak dikirim -> panel "belum tersedia",
//      BUKAN daftar kosong, BUKAN angka 0.
//   B) Sumber aktual [] -> "Belum ada catatan upah".
//   C) Data tampil: aktual dari total_upah; baris tanpa angka =
//      "Tidak tersedia" (bukan sel kosong, bukan "0").
//   D) ESTIMASI tidak dikirim -> kolom estimasi "Tidak dikirim",
//      BUKAN angka; aktual TIDAK terisi dari estimasi.
//   E) Estimasi dikirim -> kolom estimasi terisi; selisih hanya
//      pada baris yang punya keduanya (LENGKAP).
//   F) Status kelengkapan: LENGKAP / AKTUAL_SAJA / ESTIMASI_SAJA.
//   G) Workshop Stock: material tanpa current_stock = "Tidak
//      tersedia", bukan 0; tidak ada stok yang dikarang dari status.
//   H) Tidak ada penulisan DB: tidak ada fetch/XHR/localStorage.
//   I) CSV bisa diunduh (anchor dibuat & diklik).
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const REPO = process.argv[2] || path.dirname(path.dirname(SB))

// ---------- 1) DOM environment dulu (urutan wajib) ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

// ---------- 2) Baru import React & komponen ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const LaborStockModule = (await import(pathToFileURL(path.join(SB, 'dist/modules/labor-stock/view.mjs')).href)).default

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}

function mount(props = {}) {
  // url wajib: tanpa itu jsdom memakai origin opaque dan localStorage
  // melempar SecurityError.
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/'
  })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22: read-only */ }
  // URL.createObjectURL tidak ada di jsdom — modul memakai fallback data:.
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(LaborStockModule, props)))
  return { dom, root }
}

const t = (doc, id) => {
  const el = doc.querySelector(`[data-testid="${id}"]`)
  return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null
}
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event("click", { bubbles: true })))

function type(el, value) {
  const proto = window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, value)
  flushSync(() => el.dispatchEvent(new window.Event('input', { bubbles: true })))
}

// ---------- data fixture (skema asli) ----------
const ACTUAL = [
  { id: 'r1', tukang_key: 'TKG-01', project_name: 'Gudang A', total_upah: '3.000.000', status: 'Berjalan', batch: 'B1' },
  { id: 'r2', tukang_key: 'TKG-02', project_name: 'Gudang A', total_upah: 2000000, status: 'Berjalan', batch: 'B1' },
  { id: 'r3', tukang_key: 'TKG-01', project_name: 'Rumah B', total_upah: null, status: 'Perencanaan', batch: 'B2' }
]
const PROJECTS = [{ id: 'p1', name: 'Gudang A' }, { id: 'p2', name: 'Rumah B' }]
const ESTIMATE = [
  { id: 'e1', project_id: 'p1', item_name: 'Pemasangan', labor_cost: 6000000 },
  { id: 'e2', project_id: 'p1', item_name: 'Finishing', labor_cost: 4000000 }
]
const MATERIALS = [
  { id: 'm1', kode: 'BHP-0013', nama: 'Kayu Jati', kategori: 'Bahan Baku', satuan: 'lembar', current_stock: 10, min_stock: 12 },
  { id: 'm2', kode: 'BHP-0014', nama: 'Plywood 9mm', kategori: 'Bahan Baku', satuan: 'lembar', current_stock: 5, min_stock: 2 },
  { id: 'm3', kode: 'CAT-03', nama: 'Cat Duco', kategori: 'Finishing', satuan: 'kaleng', current_stock: null, min_stock: null }
]

// ---------- A: sumber aktual tidak dikirim ----------
console.log('\n[A] Sumber aktual tidak dikirim -> panel kemampuan, bukan angka 0')
{
  const { dom } = mount({ rows: { projects: PROJECTS }, laborRows: undefined, estimateRows: null, materials: MATERIALS })
  const doc = dom.window.document
  check('root tampil', !!doc.querySelector('[data-testid="labor-stock-root"]'))
  check('capability = unavailable', doc.querySelector('[data-testid="labor-stock-root"]').getAttribute('data-capability') === 'unavailable')
  check('panel kemampuan labor tampil', !!doc.querySelector('[data-testid="labor-capability"]'))
  check('judul menyebut sumber belum dikirim', /belum dikirim/i.test(t(doc, 'labor-capability-title') || ''))
  check('KPI project = 0 hitungan baris (bukan Rp 0)', t(doc, 'labor-kpi-projects') === '0')
  check('KPI total aktual = Tidak tersedia', t(doc, 'labor-kpi-actual') === 'Tidak tersedia')
  check('tidak ada tabel labor', !doc.querySelector('[data-testid="labor-table"]'))
  check('empty menyebut sumber belum tersedia', /sumber upah tukang belum tersedia/i.test(t(doc, 'labor-empty') || ''))
  check('tidak ada "Rp 0" di seluruh halaman', !/Rp 0(?!\d)/.test(doc.body.textContent || ''))
  check('batasan tampilan terdokumentasi', !!doc.querySelector('[data-testid="labor-stock-limitations"]'))
}

// ---------- B: sumber aktual [] ----------
console.log('\n[B] Sumber aktual dikirim tapi kosong -> empty state, bukan 0')
{
  const { dom } = mount({ rows: {}, laborRows: [], estimateRows: [], materials: [] })
  const doc = dom.window.document
  check('capability = empty', doc.querySelector('[data-testid="labor-stock-root"]').getAttribute('data-capability') === 'empty')
  check('empty menyebut belum ada catatan', /belum ada catatan upah/i.test(t(doc, 'labor-empty') || ''))
  check('stok: capability empty', doc.querySelector('[data-testid="stock-section"]').getAttribute('data-capability') === 'empty')
  check('stok: empty menyebut belum ada material', /belum ada material terdata/i.test(t(doc, 'stock-empty') || ''))
  check('tidak ada "Rp 0"', !/Rp 0(?!\d)/.test(doc.body.textContent || ''))
}

// ---------- C: data tampil, aktual jujur ----------
console.log('\n[C] Data tampil: aktual dari total_upah; nilai kosong = Tidak tersedia')
{
  const { dom } = mount({ rows: {}, laborRows: ACTUAL, estimateRows: null, materials: MATERIALS })
  const doc = dom.window.document
  check('tabel labor tampil', !!doc.querySelector('[data-testid="labor-table"]'))
  check('3 baris ter-render', doc.querySelectorAll('[data-testid^="labor-row-"]').length === 3)
  check('KPI project beraktual = 1', t(doc, 'labor-kpi-projects') === '1')
  check('KPI total aktual = Rp 5.000.000', t(doc, 'labor-kpi-actual') === 'Rp 5.000.000')
  check('KPI estimasi = Tidak dikirim', t(doc, 'labor-kpi-estimate') === 'Tidak dikirim')
  const rowA = doc.querySelector('[data-testid="labor-row-gudang a"]')
  const rowB = doc.querySelector('[data-testid="labor-row-rumah b"]')
  check('baris Gudang A ada', !!rowA)
  check('baris Rumah B ada', !!rowB)
  const actA = rowA ? rowA.querySelector('[data-testid="labor-act"]').textContent.trim() : ''
  check('aktual Gudang A = Rp 3.000.000', actA === 'Rp 3.000.000')
  const actB = rowB ? rowB.querySelector('[data-testid="labor-act"]').textContent.trim() : ''
  check('aktual Rumah B (kosong) = Tidak tersedia', actB === 'Tidak tersedia')
  check('BUKAN 0 untuk nilai kosong', actB !== '0' && !/Rp 0(?!\d)/.test(actB))
  const diffB = rowB ? rowB.querySelector('[data-testid="labor-diff"]').textContent.trim() : ''
  check('selisih tanpa estimasi = Tidak tersedia', diffB === 'Tidak tersedia')
  const compB = rowB ? rowB.querySelector('[data-testid="labor-completeness"]') : null
  check('status kelengkapan = KOSONG (belum ada angka aktual maupun estimasi)',
    compB && compB.getAttribute('data-state') === 'KOSONG')
  check('label KOSONG = "Angka belum tercatat"',
    compB && /angka belum tercatat/i.test(compB.textContent || ''))
}

// ---------- D+E: estimasi dikirim ----------
console.log('\n[D+E] Estimasi dikirim -> kolom terpisah, selisih hanya bila keduanya ada')
{
  const { dom } = mount({ rows: { projects: PROJECTS }, laborRows: ACTUAL, estimateRows: ESTIMATE, materials: MATERIALS })
  const doc = dom.window.document
  check('KPI estimasi terisi (Rp 10.000.000)', t(doc, 'labor-kpi-estimate') === 'Rp 10.000.000')
  const rowA = doc.querySelector('[data-testid="labor-row-gudang a"]')
  check('baris Gudang A ada', !!rowA)
  if (rowA) {
    const est = rowA.querySelector('[data-testid="labor-est"]').textContent.trim()
    const act = rowA.querySelector('[data-testid="labor-act"]').textContent.trim()
    const diff = rowA.querySelector('[data-testid="labor-diff"]').textContent.trim()
    const comp = rowA.querySelector('[data-testid="labor-completeness"]')
    check('estimasi Gudang A = Rp 10.000.000', est === 'Rp 10.000.000')
    check('aktual Gudang A tetap Rp 3.000.000 (bukan estimasi)', act === 'Rp 3.000.000')
    check('selisih = -Rp 7.000.000', diff === '-Rp 7.000.000')
    check('status kelengkapan = LENGKAP', comp.getAttribute('data-state') === 'LENGKAP')
  }
  const rowB = doc.querySelector('[data-testid="labor-row-rumah b"]')
  if (rowB) {
    const estB = rowB.querySelector('[data-testid="labor-est"]').textContent.trim()
    check('Rumah B tanpa estimasi -> Tidak tersedia', estB === 'Tidak tersedia')
    check('Rumah B status = KOSONG (aktual belum tercatat)',
      rowB.querySelector('[data-testid="labor-completeness"]').getAttribute('data-state') === 'KOSONG')
  }
  check('tidak ada "Rp 0" di halaman', !/Rp 0(?!\d)/.test(doc.body.textContent || ''))
}

// ---------- E2: estimasi tanpa aktual -> ESTIMASI_SAJA ----------
console.log('\n[E2] Estimasi ada, aktual tidak tercatat -> ESTIMASI_SAJA (bukan 0)')
{
  const { dom } = mount({
    rows: { projects: [{ id: 'p9', name: 'Vila C' }] },
    laborRows: [{ id: 'r9', tukang_key: 'TKG-09', project_name: 'Vila C', total_upah: null, status: 'Perencanaan', batch: 'B3' }],
    estimateRows: [{ id: 'e9', project_id: 'p9', item_name: 'Dasar', labor_cost: 2500000 }],
    materials: MATERIALS
  })
  const doc = dom.window.document
  const row = doc.querySelector('[data-testid="labor-row-vila c"]')
  check('baris Vila C ada', !!row)
  if (row) {
    const est = row.querySelector('[data-testid="labor-est"]').textContent.trim()
    const act = row.querySelector('[data-testid="labor-act"]').textContent.trim()
    const comp = row.querySelector('[data-testid="labor-completeness"]')
    check('estimasi terisi Rp 2.500.000', est === 'Rp 2.500.000')
    check('aktual = Tidak tersedia (estimasi TIDAK dipakai mengisi)', act === 'Tidak tersedia')
    check('status = ESTIMASI_SAJA', comp.getAttribute('data-state') === 'ESTIMASI_SAJA')
  }
}

// ---------- F: filter ----------
console.log('\n[F] Filter project / periode / pencarian')
{
  const { dom } = mount({ rows: {}, laborRows: ACTUAL, estimateRows: null, materials: MATERIALS })
  const doc = dom.window.document
  const before = doc.querySelectorAll('[data-testid^="labor-row-"]').length
  check('3 baris sebelum filter', before === 3)

  const sel = doc.querySelector('[data-testid="labor-filter-project"]')
  const setSel = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setSel.call(sel, 'Rumah B')
  flushSync(() => sel.dispatchEvent(new window.Event('change', { bubbles: true })))
  check('filter project Rumah B -> 1 baris', doc.querySelectorAll('[data-testid^="labor-row-"]').length === 1)

  setSel.call(sel, 'all')
  flushSync(() => sel.dispatchEvent(new window.Event('change', { bubbles: true })))
  const per = doc.querySelector('[data-testid="labor-filter-period"]')
  setSel.call(per, 'B1')
  flushSync(() => per.dispatchEvent(new window.Event('change', { bubbles: true })))
  check('filter periode B1 -> 2 baris', doc.querySelectorAll('[data-testid^="labor-row-"]').length === 2)

  setSel.call(per, 'all')
  flushSync(() => per.dispatchEvent(new window.Event('change', { bubbles: true })))
  const q = doc.querySelector('[data-testid="labor-search"]')
  type(q, 'tkg-02')
  check('pencarian tkg-02 -> 1 baris', doc.querySelectorAll('[data-testid^="labor-row-"]').length === 1)

  type(q, 'zzz')
  check('pencarian tanpa hasil -> empty state', /tidak ada baris yang cocok/i.test(t(doc, 'labor-empty') || ''))
}

// ---------- G: Workshop Stock ----------
console.log('\n[G] Workshop Stock: nilai kosong = Tidak tersedia, bukan 0')
{
  const { dom } = mount({ rows: {}, laborRows: ACTUAL, estimateRows: null, materials: MATERIALS })
  const doc = dom.window.document
  check('grid stok tampil', !!doc.querySelector('[data-testid="stock-grid"]'))
  check('3 kartu material', doc.querySelectorAll('.ls-stock-card').length === 3)
  check('KPI total = 3', t(doc, 'stock-kpi-total') === '3')
  check('KPI ada angka = 2', t(doc, 'stock-kpi-ada') === '2')
  check('KPI menipis = 1 (Kayu Jati 10 <= min 12, kode BHP)', t(doc, 'stock-kpi-menipis') === '1')
  check('KPI tanpa angka = 1', t(doc, 'stock-kpi-tanpa') === '1')
  const cat = doc.querySelector('[data-testid="stock-filter-category"]')
  const opts = [...cat.options].map(o => o.value)
  check('opsi kategori hanya dari data', opts.includes('Bahan Baku') && opts.includes('Finishing') && opts.includes('all'))
  const q = doc.querySelector('[data-testid="stock-search"]')
  type(q, 'plywood')
  check('pencarian material bekerja', doc.querySelectorAll('.ls-stock-card').length === 1)
}

// ---------- H: read-only ----------
console.log('\n[H] Read-only: tidak ada penulisan DB')
{
  const { dom } = mount({ rows: {}, laborRows: ACTUAL, estimateRows: ESTIMATE, materials: MATERIALS })
  const doc = dom.window.document
  const ls = dom.window.localStorage
  const before = ls.length
  click(doc.querySelector('[data-testid="labor-csv"]'))
  check('tidak ada fetch/XHR', typeof global.fetch !== 'function' || !/fetch\(/.test(doc.body.innerHTML || ''))
  check('modul TIDAK menulis ke localStorage', ls.length === before,
    `localStorage bertambah dari ${before} ke ${ls.length}`)
  check('badge baca tampil', /baca — tidak ada penulisan/i.test(doc.body.textContent || ''))
}

// ---------- I: CSV ----------
console.log('\n[I] CSV bisa diunduh')
{
  const { dom } = mount({ rows: {}, laborRows: ACTUAL, estimateRows: ESTIMATE, materials: MATERIALS })
  const doc = dom.window.document
  let clicked = null
  const origClick = dom.window.HTMLAnchorElement.prototype.click
  dom.window.HTMLAnchorElement.prototype.click = function () { clicked = this }
  try {
    click(doc.querySelector('[data-testid="labor-csv"]'))
  } finally {
    dom.window.HTMLAnchorElement.prototype.click = origClick
  }
  check('anchor unduh dibuat', !!clicked)
  check('nama file actual-labor.csv', clicked && clicked.getAttribute('download') === 'actual-labor.csv')
  check('stok CSV juga ada', !!doc.querySelector('[data-testid="stock-csv"]'))
}

console.log(`\nrender_test.mjs: ${pass} LULUS, ${fail} GAGAL`)
if (fail > 0) {
  console.log('Kegagalan:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
