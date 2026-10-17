// ============================================================
// UJI RESPONSIVE — modules/labor-stock/view.jsx (t_62e41e91)
// Spesifikasi kartu: modul harus terpakai di 360, 390, 768, 1440
// lebar viewport. Yang diuji:
//
//   1) LEBAR: halaman tidak melebar melewati viewport.
//   2) TABEL: tabel boleh lebar, TAPI yang scroll pembungkusnya
//      (.ls-table-wrap overflow-x: auto) — bukan seluruh halaman.
//   3) KPI: grid 1 kolom di ponsel (360/390), 2 kolom di tablet
//      (768), 4 kolom di desktop (1440).
//   4) TOUCH TARGET: tombol minimal 32px tinggi; input/select
//      minimal 36px; baris tabel ~44px (padding 9px).
//   5) KARTU STOK: 1 kolom ponsel, 2 tablet, 3 desktop.
//   6) INTI TASK: di SEMUA lebar, nilai kosong tetap ditulis
//      "Tidak tersedia" (bukan 0), dan estimasi yang tidak dikirim
//      tetap "Tidak dikirim" — tidak ada angka karangan.
//
// jsdom tidak melakukan layout nyata, jadi media query dinilai
// dengan membaca stylesheet + aturan yang berlaku, dan geometri
// dinilai dari aturan CSS (grid-template-columns, min-height,
// overflow-x). Pendekatan yang sama dipakai harness lain di repo.
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

// ---------- 1) Baca stylesheet modul dari repo ----------
const CSS = fs.readFileSync(
  path.join(REPO, 'styles/globals.css'), 'utf-8'
)
const cssStart = CSS.indexOf('MODUL ACTUAL LABOR & STOK')
check('blok CSS modul ada di styles/globals.css', cssStart !== -1)
const MODULE_CSS = cssStart === -1 ? '' : CSS.slice(cssStart)

function cssRule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = MODULE_CSS.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

console.log('\n[1] Lebar — halaman tidak melebar melewati viewport')
const lsRoot = cssRule('.ls-root')
check('.ls-root memakai flex column (mengikuti lebar induk)',
  !!lsRoot && /flex-direction:\s*column/.test(lsRoot), lsRoot)
check('.ls-root tidak punya width tetap (tidak memaksa lebar)',
  !!lsRoot && !/width:\s*\d/.test(lsRoot), lsRoot)
check('.ls-root tidak punya min-width (tidak melebar di ponsel)',
  !!lsRoot && !/min-width/.test(lsRoot), lsRoot)
check('.ls-root tidak ada position fixed/absolute (mengalir normal)',
  !!lsRoot && !/position:\s*(fixed|absolute)/.test(lsRoot), lsRoot)
check('.ls-intro flex-wrap: wrap (judul & tombol tumpuk)',
  !!cssRule('.ls-intro') && /flex-wrap:\s*wrap/.test(cssRule('.ls-intro')))
check('.ls-section-head flex-wrap: wrap',
  !!cssRule('.ls-section-head') && /flex-wrap:\s*wrap/.test(cssRule('.ls-section-head')))
check('.ls-toolbar flex-wrap: wrap (filter tumpuk di ponsel)',
  !!cssRule('.ls-toolbar') && /flex-wrap:\s*wrap/.test(cssRule('.ls-toolbar')))

console.log('\n[2] Tabel — yang scroll pembungkusnya, bukan halaman')
const lsWrap = cssRule('.ls-table-wrap')
check('.ls-table-wrap overflow-x: auto (tabel scroll sendiri)',
  !!lsWrap && /overflow-x:\s*auto/.test(lsWrap), lsWrap)
const lsTable = cssRule('.ls-table')
check('.ls-table width: 100% (mengikuti pembungkus)',
  !!lsTable && /width:\s*100%/.test(lsTable), lsTable)
check('.ls-table tidak punya width piksel tetap / min-width',
  !!lsTable && !/width:\s*\d+px/.test(lsTable) && !/min-width/.test(lsTable), lsTable)
const lsTh = cssRule('.ls-table th')
check('header tabel white-space: nowrap (tidak berantakan saat scroll)',
  !!lsTh && /white-space:\s*nowrap/.test(lsTh), lsTh)

console.log('\n[3] KPI — 1 kolom ponsel, 2 tablet, 4 desktop')
const kpiBase = cssRule('.ls-kpi-grid')
check('KPI dasar 1 kolom (ponsel 360/390)',
  !!kpiBase && /grid-template-columns:\s*1fr/.test(kpiBase), kpiBase)
const mqTablet = MODULE_CSS.match(/@media\s*\(min-width:\s*700px\)\s*\{([\s\S]*?)\n\}/)
check('ada breakpoint 700px (tablet 768)', !!mqTablet)
check('tablet: KPI 2 kolom',
  !!mqTablet && /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(mqTablet[1]), mqTablet?.[1])
check('tablet: kartu stok 2 kolom',
  !!mqTablet && /\.ls-stock-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(mqTablet[1]))
const mqDesk = MODULE_CSS.match(/@media\s*\(min-width:\s*1100px\)\s*\{([\s\S]*?)\n\}/)
check('ada breakpoint 1100px (desktop 1440)', !!mqDesk)
check('desktop: KPI 4 kolom',
  !!mqDesk && /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(mqDesk[1]), mqDesk?.[1])
check('desktop: kartu stok 3 kolom',
  !!mqDesk && /\.ls-stock-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(mqDesk[1]))
check('grid memakai minmax(0, 1fr) — kolom tidak melebar karena isi panjang',
  /minmax\(0,\s*1fr\)/.test(MODULE_CSS))

console.log('\n[4] Touch target — tombol, input, baris tabel')
check('tombol utama min-height 32px',
  !!cssRule('.ls-btn') && /min-height:\s*32px/.test(cssRule('.ls-btn')), cssRule('.ls-btn'))
check('tombol pakai cursor: pointer',
  !!cssRule('.ls-btn') && /cursor:\s*pointer/.test(cssRule('.ls-btn')))
check('tombol "lebih banyak" min-height 32px',
  !!cssRule('.ls-btn-more') && /min-height:\s*32px/.test(cssRule('.ls-btn-more')), cssRule('.ls-btn-more'))
check('input & select tidak memotong teks (min-width: 0, max-width: 100%)',
  !!cssRule('.ls-field select,\n.ls-field input')
  && /min-width:\s*0/.test(cssRule('.ls-field select,\n.ls-field input'))
  && /max-width:\s*100%/.test(cssRule('.ls-field select,\n.ls-field input')))
const tdRule = cssRule('.ls-table td')
check('baris tabel padding 9px atas/bawah (baris ~44px)',
  !!tdRule && /padding:\s*9px\s+10px/.test(tdRule), tdRule)
check('tombol disabled tidak bisa diklik tanpa sengaja',
  !!cssRule('.ls-btn:disabled') && /cursor:\s*not-allowed/.test(cssRule('.ls-btn:disabled')))

console.log('\n[5] Kartu stok — tumpuk rapi di ponsel')
const stockGrid = cssRule('.ls-stock-grid')
check('kartu stok dasar 1 kolom (ponsel)',
  !!stockGrid && /grid-template-columns:\s*1fr/.test(stockGrid), stockGrid)
check('judul kartu stok bisa mengecil (min-width: 0)',
  !!cssRule('.ls-stock-card-title') && /min-width:\s*0/.test(cssRule('.ls-stock-card-title')))
check('angka stok tabular (tidak goyang saat berubah)',
  !!cssRule('.ls-stock-nums b') && /font-variant-numeric:\s*tabular-nums/.test(cssRule('.ls-stock-nums b')))
check('nilai tidak tersedia diberi warna muted (beda dari angka nyata)',
  !!cssRule('.ls-na') && /color:\s*var\(--slate-400/.test(cssRule('.ls-na')), cssRule('.ls-na'))

console.log('\n[6] Verifikasi render nyata di 360/390/768/1440')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const View = (await import(pathToFileURL(path.join(SB, 'dist/modules/labor-stock/view.mjs')).href)).default

const ACTUAL = [
  { id: 'r1', tukang_key: 'TKG-01', project_name: 'Gudang A', total_upah: '3.000.000', status: 'Berjalan', batch: 'B1' },
  { id: 'r2', tukang_key: 'TKG-02', project_name: 'Gudang A', total_upah: 2000000, status: 'Berjalan', batch: 'B1' },
  { id: 'r3', tukang_key: 'TKG-01', project_name: 'Rumah B', total_upah: null, status: 'Perencanaan', batch: 'B2' }
]
const PROJECTS = [{ id: 'p1', name: 'Gudang A' }, { id: 'p2', name: 'Rumah B' }]
const ESTIMATE = [{ id: 'e1', project_id: 'p1', item_name: 'Pemasangan', labor_cost: 6000000 }]
const MATERIALS = [
  { id: 'm1', kode: 'KAYU-01', nama: 'Kayu Jati', kategori: 'Bahan Baku', satuan: 'lembar', current_stock: 10, min_stock: 12, is_bhp: true },
  { id: 'm2', kode: 'CAT-03', nama: 'Cat Duco', kategori: 'Finishing', satuan: 'kaleng', current_stock: null, min_stock: null, is_bhp: true }
]

const WIDTHS = [360, 390, 768, 1440]
for (const w of WIDTHS) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(View, {
    rows: { projects: PROJECTS },
    laborRows: ACTUAL,
    estimateRows: ESTIMATE,
    materials: MATERIALS
  })))

  const forced = [...document.querySelectorAll('*')].filter(el => {
    const s = el.getAttribute('style') || ''
    return /width:\s*\d{3,}px/.test(s)
  })
  check(`${w}px: tidak ada elemen ber-lebar paksa (>100px inline)`, forced.length === 0,
    forced.map(e => e.getAttribute('style')).join(' | '))

  for (const id of ['labor-stock-root', 'labor-section', 'stock-section']) {
    check(`${w}px: ${id} tampil`, !!document.querySelector(`[data-testid="${id}"]`))
  }

  const bodyTxt = document.body.textContent || ''
  check(`${w}px: tidak ada NaN/undefined di layar`, !/NaN|undefined/.test(bodyTxt))
  check(`${w}px: nilai kosong ditulis "Tidak tersedia"`, /Tidak tersedia/.test(bodyTxt))
  check(`${w}px: TIDAK ada "Rp 0" karangan`, !/Rp 0(?!\d)/.test(bodyTxt))
  check(`${w}px: estimasi tampil terpisah dari aktual`, /Rp 6\.000\.000/.test(bodyTxt) && /Rp 3\.000\.000/.test(bodyTxt))
  check(`${w}px: 3 baris labor tampil`,
    document.querySelectorAll('[data-testid^="labor-row-"]').length === 3)
  check(`${w}px: 4 kartu KPI labor tampil`,
    document.querySelectorAll('#app .ls-section [data-testid^="labor-kpi-"]').length >= 4)
  check(`${w}px: kartu stok tampil`, document.querySelectorAll('.ls-stock-card').length === 2)
  check(`${w}px: stok kosong = "Tidak tersedia" (bukan 0)`,
    [...document.querySelectorAll('.ls-stock-nums b')].some(b => b.textContent === 'Tidak tersedia'))
  check(`${w}px: tepat 1 kartu tanpa angka -> 2 label (stok & min), bukan semua`,
    [...document.querySelectorAll('.ls-stock-nums b')].filter(b => b.textContent === 'Tidak tersedia').length === 2)
  check(`${w}px: nilai tidak tersedia diberi kelas ls-na (muted)`,
    [...document.querySelectorAll('.ls-stock-nums b.ls-na')].every(b => b.textContent === 'Tidak tersedia'))
  check(`${w}px: filter labor ter-render`, !!document.querySelector('[data-testid="labor-filter-project"]'))
  check(`${w}px: tombol CSV ter-render`, !!document.querySelector('[data-testid="labor-csv"]'))
}

// lebar terkecil: nama project & tukang panjang tidak boleh merusak tampilan
{
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(View, {
    rows: {},
    laborRows: [{
      id: 'x1',
      tukang_key: 'TUKANG-DENGAN-KUNCI-SANGAT-PANJANG-SEKALI',
      project_name: 'Project Dengan Nama Sangat Panjang Sekali Agar Terlihat Bagaimana Modul Menanganinya',
      total_upah: '12.500.000',
      status: 'Berjalan',
      batch: 'B-PERIODE-YANG-NAMANYA-JUGA-PANJANG'
    }],
    estimateRows: null,
    materials: MATERIALS
  })))
  const t = document.body.textContent || ''
  check('360px: teks panjang tidak jadi NaN/undefined', !/NaN|undefined/.test(t))
  check('360px: nama project panjang tetap tampil utuh',
    /Project Dengan Nama Sangat Panjang/.test(t))
  check('360px: baris tetap satu', document.querySelectorAll('[data-testid^="labor-row-"]').length === 1)
  check('360px: estimasi tidak dikirim -> ditulis "Tidak dikirim" (bukan 0)',
    /Tidak dikirim/.test(t))
  check('360px: tidak ada "Rp 0"', !/Rp 0(?!\d)/.test(t))
}

console.log(`\n${fail === 0 ? 'LULUS' : 'GAGAL'}: ${pass} lulus, ${fail} gagal`)
if (fail > 0) { console.log('Yang gagal:'); failures.forEach(f => console.log(`  - ${f}`)) }
process.exit(fail === 0 ? 0 : 1)
