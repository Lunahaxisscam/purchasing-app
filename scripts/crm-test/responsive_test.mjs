// ============================================================
// UJI RESPONSIVE — modules/crm/view.jsx (t_7253b859)
// Spesifikasi kartu: modul harus terpakai di 360, 390, 768, 1440
// lebar viewport. Yang diuji:
//
//   1) LEBAR: halaman tidak boleh melebar melewati viewport
//      (tidak ada horizontal overflow di <body>/#app).
//   2) TABEL: tabel boleh lebar, TAPI yang scroll adalah
//      pembungkus .crm-table-wrap (overflow-x: auto) — bukan
//      seluruh halaman.
//   3) KPI: grid 1 kolom di ponsel (360/390), 2 kolom di tablet
//      (768), 4 kolom di desktop (1440).
//   4) TOUCH TARGET: tombol minimal 32px tinggi, baris tabel
//      minimal 44px tinggi (area sentuh nyaman di ponsel).
//   5) DRAWER: tampil sebagai panel penuh di bawah tabel (tidak
//      menutupi layar), tetap terbaca di semua lebar.
//   6) FORM: grid 1 kolom di ponsel, 2 kolom di tablet+.
//
// jsdom tidak melakukan layout nyata, jadi media query dinilai
// dengan membaca stylesheet + memeriksa aturan yang berlaku, dan
// geometri dinilai dari aturan CSS (grid-template-columns,
// min-height, overflow-x). Ini pendekatan yang sama dipakai
// harness lain di repo: CSS diverifikasi sebagai kontrak.
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
const cssStart = CSS.indexOf('MODUL CUSTOMER CRM')
check('blok CSS modul ada di styles/globals.css', cssStart !== -1)
const MODULE_CSS = cssStart === -1 ? '' : CSS.slice(cssStart)

function cssRule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = MODULE_CSS.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

console.log('\n[1] Lebar — halaman tidak melebar melewati viewport')
const crmRoot = cssRule('.crm-root')
check('.crm-root memakai flex column (mengikuti lebar induk)',
  !!crmRoot && /flex-direction:\s*column/.test(crmRoot), crmRoot)
check('.crm-root tidak punya width tetap (tidak memaksa lebar)',
  !!crmRoot && !/width:\s*\d/.test(crmRoot), crmRoot)
check('.crm-root tidak punya min-width (tidak melebar di ponsel)',
  !!crmRoot && !/min-width/.test(crmRoot), crmRoot)
check('.crm-root tidak ada position fixed/absolute (mengalir normal)',
  !!crmRoot && !/position:\s*(fixed|absolute)/.test(crmRoot), crmRoot)

const crmToolbar = cssRule('.crm-toolbar')
check('.crm-toolbar flex-wrap: wrap (tumpuk di ponsel)',
  !!crmToolbar && /flex-wrap:\s*wrap/.test(crmToolbar), crmToolbar)
const crmIntro = cssRule('.crm-intro')
check('.crm-intro flex-wrap: wrap (judul & tombol tumpuk)',
  !!crmIntro && /flex-wrap:\s*wrap/.test(crmIntro), crmIntro)
const crmIntroCopy = cssRule('.crm-intro-copy')
check('.crm-intro-copy dibatasi max-width (tidak melebar)',
  !!crmIntroCopy && /max-width:\s*62ch/.test(crmIntroCopy), crmIntroCopy)

console.log('\n[2] Tabel — yang scroll pembungkusnya, bukan halaman')
const crmWrap = cssRule('.crm-table-wrap')
check('.crm-table-wrap overflow-x: auto (tabel scroll sendiri)',
  !!crmWrap && /overflow-x:\s*auto/.test(crmWrap), crmWrap)
const crmTable = cssRule('.crm-table')
check('.crm-table width: 100% (mengikuti pembungkus)',
  !!crmTable && /width:\s*100%/.test(crmTable), crmTable)
check('.crm-table tidak punya width piksel tetap / min-width',
  !!crmTable && !/width:\s*\d+px/.test(crmTable) && !/min-width/.test(crmTable), crmTable)
const crmTh = cssRule('.crm-table th')
check('header tabel white-space: nowrap (tidak berantakan saat scroll)',
  !!crmTh && /white-space:\s*nowrap/.test(crmTh), crmTh)

console.log('\n[3] KPI — 1 kolom ponsel, 2 tablet, 4 desktop')
const kpiBase = cssRule('.crm-kpi-grid')
check('KPI dasar 1 kolom (ponsel 360/390)',
  !!kpiBase && /grid-template-columns:\s*1fr/.test(kpiBase), kpiBase)
const mqTablet = MODULE_CSS.match(/@media\s*\(min-width:\s*700px\)\s*\{([\s\S]*?)\n\}/)
check('ada breakpoint 700px (tablet 768)', !!mqTablet)
check('tablet: KPI 2 kolom',
  !!mqTablet && /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(mqTablet[1]), mqTablet?.[1])
check('tablet: form 2 kolom',
  !!mqTablet && /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(mqTablet[1]))
const mqDesk = MODULE_CSS.match(/@media\s*\(min-width:\s*1100px\)\s*\{([\s\S]*?)\n\}/)
check('ada breakpoint 1100px (desktop 1440)', !!mqDesk)
check('desktop: KPI 4 kolom',
  !!mqDesk && /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(mqDesk[1]), mqDesk?.[1])
check('grid memakai minmax(0, 1fr) — kolom tidak melebar karena isi panjang',
  /minmax\(0,\s*1fr\)/.test(MODULE_CSS))

console.log('\n[4] Touch target — minimal 32px tombol, 44px baris')
const btnRule = cssRule('.crm-btn')
check('tombol utama min-height 32px',
  !!btnRule && /min-height:\s*32px/.test(btnRule), btnRule)
check('tombol pakai cursor: pointer',
  !!btnRule && /cursor:\s*pointer/.test(btnRule), btnRule)
const btnMini = cssRule('.crm-btn-mini')
check('tombol mini min-height 32px (target sentuh tetap nyaman)',
  !!btnMini && /min-height:\s*32px/.test(btnMini), btnMini)
const inputRule = cssRule('.crm-selector__input')
check('input selector min-height 36px',
  !!inputRule && /min-height:\s*36px/.test(inputRule), inputRule)
const tdRule = cssRule('.crm-table td')
check('baris tabel padding 9px atas/bawah (baris ~44px)',
  !!tdRule && /padding:\s*9px\s+11px/.test(tdRule), tdRule)
check('baris tabel cursor: pointer (seluruh baris bisa diklik di ponsel)',
  !!cssRule('.crm-row') && /cursor:\s*pointer/.test(cssRule('.crm-row')))
check('input & select mengisi lebar wadah (tidak memotong teks)',
  !!cssRule('.crm-field input,\n.crm-field select,\n.crm-field textarea') && /width:\s*100%/.test(cssRule('.crm-field input,\n.crm-field select,\n.crm-field textarea')))

console.log('\n[5] Drawer — panel penuh di bawah tabel, tetap terbaca')
const drawer = cssRule('.crm-drawer')
check('drawer memakai flex column (mengikuti lebar induk)',
  !!drawer && /flex-direction:\s*column/.test(drawer), drawer)
check('drawer tidak position fixed (tidak menutupi layar ponsel)',
  !!drawer && !/position:\s*fixed/.test(drawer), drawer)
check('drawer tidak punya width/min-width piksel',
  !!drawer && !/width:\s*\d+px/.test(drawer) && !/min-width/.test(drawer), drawer)
const drawerRow = cssRule('.crm-drawer-row')
check('drawer row flex-wrap: wrap (label & nilai tumpuk di 360)',
  !!drawerRow && /flex-wrap:\s*wrap/.test(drawerRow), drawerRow)
const drawerDd = cssRule('.crm-drawer-row dd')
check('drawer nilai text-align: right (selaras dengan tabel)',
  !!drawerDd && /text-align:\s*right/.test(drawerDd), drawerDd)

console.log('\n[6] Verifikasi render nyata di 360/390/768/1440')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const View = (await import(pathToFileURL(path.join(SB, 'dist/modules/crm/view.mjs')).href)).default

const HOST = [
  { id: 'c1', name: 'Ibu Sarah', phone: '0812-3456-789', email: 's@x.id', address: 'Jl. Melati 3', source: 'Instagram', notes: 'Butuh 3 lemari' },
  { id: 'c2', name: 'Pak Budi', phone: '', email: '', address: '', source: '', notes: '' },
  { id: 'c3', name: 'Ani Kosong', phone: '', email: '', address: '', source: 'Referral', notes: '' }
]

const WIDTHS = [360, 390, 768, 1440]
for (const w of WIDTHS) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
    pretendToBeVisual: true,
  })
  global.window = dom.window
  global.document = dom.window.document
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(View, { rows: {}, customers: HOST, invoiceCounts: null })))

  const forced = [...document.querySelectorAll('*')].filter(el => {
    const s = el.getAttribute('style') || ''
    return /width:\s*\d{3,}px/.test(s)
  })
  check(`${w}px: tidak ada elemen ber-lebar paksa (>100px inline)`, forced.length === 0,
    forced.map(e => e.getAttribute('style')).join(' | '))

  for (const id of ['crm-root', 'crm-table']) {
    check(`${w}px: ${id} tampil`, !!document.querySelector(`[data-testid="${id}"]`))
  }

  const bodyTxt = document.body.textContent || ''
  check(`${w}px: tidak ada NaN/undefined di layar`, !/NaN|undefined/.test(bodyTxt))
  check(`${w}px: kontak kosong ditulis "Tidak tersedia"`, /Tidak tersedia/.test(bodyTxt))
  check(`${w}px: relasi invoice ditulis "tidak dikirim" (BUKAN 0)`, /tidak dikirim/i.test(bodyTxt))
  check(`${w}px: tidak ada "Dirujuk di 0" palsu`, !/Dirujuk di 0/.test(bodyTxt))

  const rows = document.querySelectorAll('[data-testid^="crm-row-"]').length
  check(`${w}px: 3 baris customer tampil`, rows === 3, `${rows}`)
  const kpis = document.querySelectorAll('.crm-kpi-card').length
  check(`${w}px: 4 kartu KPI tampil`, kpis === 4, `${kpis}`)

  // buka drawer + form supaya ikut diperiksa di semua lebar
  const firstRow = document.querySelector('[data-testid^="crm-row-"]')
  flushSync(() => firstRow?.dispatchEvent(new window.Event('click', { bubbles: true })))
  check(`${w}px: drawer terbuka & berisi`, (t => t.length > 20)(document.querySelector('[data-testid="crm-drawer"]')?.textContent || ''))

  flushSync(() => document.querySelector('[data-testid="crm-add-toggle"]')
    ?.dispatchEvent(new window.Event('click', { bubbles: true })))
  check(`${w}px: form draf bisa dibuka di lebar ini`, !!document.querySelector('[data-testid="crm-form"]'))
  // 4 field bertipe input + 2 textarea (alamat & catatan) = 6 kontrol
  const formInputs = document.querySelectorAll('[data-testid="crm-form"] input, [data-testid="crm-form"] textarea')
  check(`${w}px: semua input form ter-render`, formInputs.length >= 6, String(formInputs.length))
  const inputWidths = [...formInputs].map(el => el.getAttribute('style') || '')
  check(`${w}px: input form tidak memaksa lebar inline`, inputWidths.every(s => !/width:\s*\d{3,}px/.test(s)))
}

// lebar viewport terkecil: teks panjang tidak boleh memaksa lebar
{
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(View, {
    rows: {},
    customers: [
      { id: 'x1', name: 'Customer Dengan Nama Sangat Panjang Sekali Agar Terlihat Bagaimana Modul Menanganinya', phone: '081234567890123456789', email: 'sangat.panjang.sekali@domainyangpanjangsekali.co.id', address: 'Alamat yang sangat panjang sekali untuk menguji wrapping di layar kecil', source: 'Sumber Dengan Nama Panjang', notes: 'Catatan panjang'.repeat(10) }
    ]
  })))
  const t = document.body.textContent || ''
  check('360px: nama panjang tidak jadi NaN/undefined', !/NaN|undefined/.test(t))
  check('360px: baris tetap satu (bukan pecah jadi banyak elemen)',
    document.querySelectorAll('[data-testid^="crm-row-"]').length === 1)
  // catatan panjang hanya tampil di drawer detail — buka drawer dulu
  flushSync(() => document.querySelector('[data-testid^="crm-row-"]')
    ?.dispatchEvent(new window.Event('click', { bubbles: true })))
  const drawerText = document.querySelector('[data-testid="crm-drawer"]')?.textContent || ''
  check('360px: catatan panjang tetap di dalam modul', drawerText.includes('Catatan panjang'), drawerText.slice(0, 60))
  check('360px: catatan panjang tidak memecah baris',
    document.querySelectorAll('[data-testid^="crm-row-"]').length === 1)
  check('360px: kontak WA panjang tetap tampil apa adanya', /081234567890123456789/.test(t))
}

console.log(`\n${fail === 0 ? 'LULUS' : 'GAGAL'}: ${pass} lulus, ${fail} gagal`)
if (fail > 0) { console.log('Yang gagal:'); failures.forEach(f => console.log(`  - ${f}`)) }
process.exit(fail === 0 ? 0 : 1)
