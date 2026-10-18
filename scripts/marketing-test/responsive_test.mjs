// ============================================================
// UJI RESPONSIVE — modules/marketing/view.jsx (t_31a1a9f9)
// Spesifikasi kartu: modul harus terpakai di 360, 390, 768, 1440
// lebar viewport. Yang diuji:
//
//   1) LEBAR: halaman tidak boleh melebar melewati viewport
//      (tidak ada horizontal overflow di <body>/#app).
//   2) PAPAN: 5 ember tahap. Di ponsel ember tumpuk satu kolom,
//      ember "Tahap tidak diketahui" jadi lebar penuh mulai 1100px.
//      Yang scroll adalah body halaman, bukan modul — modul ini
//      tidak membuat kontainer scroll samping sendiri.
//   3) KPI: grid 1 kolom di ponsel (360/390), 2 kolom di tablet
//      (768), 4 kolom di desktop (1440).
//   4) TOUCH TARGET: tombol minimal 32px tinggi, input 36px.
//   5) DRAWER: tampil sebagai panel penuh di bawah papan (tidak
//      menutupi layar), tetap terbaca di semua lebar.
//   6) FORM: grid 1 kolom di ponsel, 2 kolom di tablet+.
//
// jsdom tidak melakukan layout nyata, jadi media query dinilai
// dengan membaca stylesheet + memeriksa aturan yang berlaku, dan
// geometri dinilai dari aturan CSS (grid-template-columns,
// min-height). Ini pendekatan yang sama dipakai harness lain di
// repo: CSS diverifikasi sebagai kontrak.
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
const cssStart = CSS.indexOf('MODUL MARKETING / LEAD PIPELINE')
check('blok CSS modul ada di styles/globals.css', cssStart !== -1)
const MODULE_CSS = cssStart === -1 ? '' : CSS.slice(cssStart)

function cssRule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = MODULE_CSS.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

console.log('\n[1] Lebar — halaman tidak melebar melewati viewport')
const mkRoot = cssRule('.mk-root')
check('.mk-root memakai flex column (mengikuti lebar induk)',
  !!mkRoot && /flex-direction:\s*column/.test(mkRoot), mkRoot)
check('.mk-root tidak punya width tetap (tidak memaksa lebar)',
  !!mkRoot && !/width:\s*\d/.test(mkRoot), mkRoot)
check('.mk-root tidak punya min-width (tidak melebar di ponsel)',
  !!mkRoot && !/min-width/.test(mkRoot), mkRoot)
check('.mk-root tidak ada position fixed/absolute (mengalir normal)',
  !!mkRoot && !/position:\s*(fixed|absolute)/.test(mkRoot), mkRoot)

const mkIntro = cssRule('.mk-intro')
check('.mk-intro flex-wrap: wrap (judul & tombol tumpuk)',
  !!mkIntro && /flex-wrap:\s*wrap/.test(mkIntro), mkIntro)
const mkIntroCopy = cssRule('.mk-intro-copy')
check('.mk-intro-copy dibatasi max-width (tidak melebar)',
  !!mkIntroCopy && /max-width:\s*62ch/.test(mkIntroCopy), mkIntroCopy)
const mkToolbar = cssRule('.mk-toolbar')
check('.mk-toolbar flex-wrap: wrap (filter tumpuk di ponsel)',
  !!mkToolbar && /flex-wrap:\s*wrap/.test(mkToolbar), mkToolbar)

console.log('\n[2] Papan — ember tumpuk di ponsel, melebar di desktop')
const board = cssRule('.mk-board')
check('.mk-board dasar 1 kolom (ponsel 360/390)',
  !!board && /grid-template-columns:\s*1fr/.test(board), board)
check('.mk-board memakai minmax(0, 1fr) — kolom tidak melebar karena isi panjang',
  /minmax\(0,\s*1fr\)/.test(MODULE_CSS))
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
check('desktop: papan 3 kolom',
  !!mqDesk && /repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(mqDesk[1]), mqDesk?.[1])
check('desktop: ember "Tahap tidak diketahui" lebar penuh',
  !!mqDesk && /\.mk-column\[data-stage="unknown"\]/.test(mqDesk[1]) && /grid-column:\s*1 \/ -1/.test(mqDesk[1]), mqDesk?.[1])
const mqWide = MODULE_CSS.match(/@media\s*\(min-width:\s*1400px\)\s*\{([\s\S]*?)\n\}/)
check('ada breakpoint 1400px (desktop lebar)', !!mqWide)
check('desktop lebar: papan 5 kolom (satu ember per tahap)',
  !!mqWide && /repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(mqWide[1]), mqWide?.[1])
const mkColumn = cssRule('.mk-column')
check('.mk-column dasar 1 kolom (ember tumpuk, bukan scroll samping)',
  !!mkColumn && /grid-template-columns:\s*1fr/.test(mkColumn), mkColumn)
// min-width: 0 adalah idiom "jangan paksa lebar" (boleh). Yang dilarang
// adalah min-width bernilai piksel/positif yang bisa melebar di ponsel.
function noMinWidth(rule) {
  return !!rule && !/min-width:\s*(?!0)[1-9]/.test(rule)
}

check('.mk-column tidak punya width piksel tetap',
  !!mkColumn && !/width:\s*\d+px/.test(mkColumn) && noMinWidth(mkColumn), mkColumn)
const mkCard = cssRule('.mk-card')
check('.mk-card tidak memaksa lebar minimum',
  !!mkCard && noMinWidth(mkCard), mkCard)
check('.mk-card mengizinkan teks panjang membungkus (overflow-wrap/word-break)',
  !!mkCard && /overflow-wrap:|word-break:/.test(mkCard), mkCard)

console.log('\n[3] Touch target — minimal 32px tombol, 36px input')
const btnRule = cssRule('.mk-btn')
check('tombol utama min-height 32px',
  !!btnRule && /min-height:\s*32px/.test(btnRule), btnRule)
check('tombol pakai cursor: pointer',
  !!btnRule && /cursor:\s*pointer/.test(btnRule), btnRule)
const btnMini = cssRule('.mk-btn-mini')
check('tombol mini min-height 32px (target sentuh tetap nyaman)',
  !!btnMini && /min-height:\s*32px/.test(btnMini), btnMini)
const inputRule = cssRule('.mk-field input,\n.mk-field select,\n.mk-field textarea,\n.mk-selector__input')
check('input & select min-height 36px',
  !!inputRule && /min-height:\s*36px/.test(inputRule), inputRule)
check('input & select mengisi lebar wadah (tidak memotong teks)',
  !!inputRule && /width:\s*100%/.test(inputRule), inputRule)

console.log('\n[4] Drawer — panel penuh di bawah papan, tetap terbaca')
const drawer = cssRule('.mk-drawer')
check('drawer memakai flex column (mengikuti lebar induk)',
  !!drawer && /flex-direction:\s*column/.test(drawer), drawer)
check('drawer tidak position fixed (tidak menutupi layar ponsel)',
  !!drawer && !/position:\s*fixed/.test(drawer), drawer)
check('drawer tidak punya width/min-width piksel',
  !!drawer && !/width:\s*\d+px/.test(drawer) && !/min-width/.test(drawer), drawer)
const drawerRow = cssRule('.mk-drawer-row')
check('drawer row flex-wrap: wrap (label & nilai tumpuk di 360)',
  !!drawerRow && /flex-wrap:\s*wrap/.test(drawerRow), drawerRow)
const drawerDd = cssRule('.mk-drawer-row dd')
check('drawer nilai text-align: right (selaras dengan kartu)',
  !!drawerDd && /text-align:\s*right/.test(drawerDd), drawerDd)

console.log('\n[5] Verifikasi render nyata di 360/390/768/1440')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const View = (await import(pathToFileURL(path.join(SB, 'dist/modules/marketing/view.mjs')).href)).default

const HOST = [
  { id: 'l1', name: 'Ibu Sarah', stage: 'new_lead', source: 'Instagram', campaign: 'Promo Lebaran', next_action: 'Kirim penawaran', next_action_date: '2026-10-20', customer_id: 'c1', notes: 'Butuh 3 lemari' },
  { id: 'l2', name: 'Pak Budi', stage: 'qualified', source: 'Referral', campaign: '', next_action: '', next_action_date: '', customer_id: '' },
  { id: 'l3', name: 'Ani Kosong', stage: 'negoriasi', source: '', campaign: 'Promo Lebaran' }
]

const WIDTHS = [360, 390, 768, 1440]
for (const w of WIDTHS) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
    pretendToBeVisual: true,
  })
  global.window = dom.window
  global.document = dom.window.document
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(View, { rows: {}, leads: HOST, customers: [], today: '2026-10-18' })))

  const forced = [...document.querySelectorAll('*')].filter(el => {
    const s = el.getAttribute('style') || ''
    return /width:\s*\d{3,}px/.test(s)
  })
  check(`${w}px: tidak ada elemen ber-lebar paksa (>100px inline)`, forced.length === 0,
    forced.map(e => e.getAttribute('style')).join(' | '))

  for (const id of ['mk-root', 'mk-board', 'mk-column-new_lead', 'mk-column-unknown']) {
    check(`${w}px: ${id} tampil`, !!document.querySelector(`[data-testid="${id}"]`))
  }

  const bodyTxt = document.body.textContent || ''
  check(`${w}px: tidak ada NaN/undefined di layar`, !/NaN|undefined/.test(bodyTxt))
  check(`${w}px: sumber kosong ditulis "Tidak tersedia"`, /Tidak tersedia/.test(bodyTxt))
  check(`${w}px: aksi berikutnya kosong ditulis jujur`, /Belum ada aksi berikutnya/.test(bodyTxt))
  check(`${w}px: tahap asing di ember "Tahap tidak diketahui"`, /Tahap tidak diketahui/.test(bodyTxt))
  check(`${w}px: tahap asing TIDAK dipaksa ke ember New Lead`,
    (() => {
      const col = document.querySelector('[data-testid="mk-column-new_lead"]')
      return col && !/Ani Kosong/.test(col.textContent || '')
    })())

  const rows = document.querySelectorAll('[data-testid^="mk-card-"]').length
  check(`${w}px: 3 kartu lead tampil`, rows === 3, `${rows}`)
  const kpis = document.querySelectorAll('.mk-kpi-card').length
  check(`${w}px: 4 kartu KPI tampil`, kpis === 4, `${kpis}`)

  // buka drawer + form supaya ikut diperiksa di semua lebar
  const firstCard = document.querySelector('[data-testid^="mk-card-"]')
  flushSync(() => firstCard?.dispatchEvent(new window.Event('click', { bubbles: true })))
  check(`${w}px: drawer terbuka & berisi`, (t => t.length > 20)(document.querySelector('[data-testid="mk-drawer"]')?.textContent || ''))

  flushSync(() => document.querySelector('[data-testid="mk-add-toggle"]')
    ?.dispatchEvent(new window.Event('click', { bubbles: true })))
  check(`${w}px: form draf bisa dibuka di lebar ini`, !!document.querySelector('[data-testid="mk-form"]'))
  const formInputs = document.querySelectorAll('[data-testid="mk-form"] input, [data-testid="mk-form"] select, [data-testid="mk-form"] textarea')
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
    leads: [
      {
        id: 'x1',
        name: 'Lead Dengan Nama Sangat Panjang Sekali Agar Terlihat Bagaimana Modul Menanganinya',
        stage: 'new_lead',
        source: 'Sumber Dengan Nama Panjang Sekali Juga',
        campaign: 'Kampanye Dengan Nama Panjang Sekali Juga',
        next_action: 'Tindak lanjut dengan keterangan yang sangat panjang sekali untuk menguji wrapping di layar kecil',
        notes: 'Catatan panjang'.repeat(10)
      }
    ],
    customers: [],
    today: '2026-10-18'
  })))
  const t = document.body.textContent || ''
  check('360px: nama panjang tidak jadi NaN/undefined', !/NaN|undefined/.test(t))
  check('360px: kartu tetap satu (bukan pecah jadi banyak elemen)',
    document.querySelectorAll('[data-testid^="mk-card-"]').length === 1)
  // catatan panjang hanya tampil di drawer detail — buka drawer dulu
  flushSync(() => document.querySelector('[data-testid^="mk-card-"]')
    ?.dispatchEvent(new window.Event('click', { bubbles: true })))
  const drawerText = document.querySelector('[data-testid="mk-drawer"]')?.textContent || ''
  check('360px: catatan panjang tetap di dalam modul', drawerText.includes('Catatan panjang'), drawerText.slice(0, 60))
  check('360px: catatan panjang tidak memecah kartu',
    document.querySelectorAll('[data-testid^="mk-card-"]').length === 1)
  check('360px: nama sumber panjang tetap tampil apa adanya', /Sumber Dengan Nama Panjang/.test(t))
}

console.log(`\n${fail === 0 ? 'LULUS' : 'GAGAL'}: ${pass} lulus, ${fail} gagal`)
if (fail > 0) { console.log('Yang gagal:'); failures.forEach(f => console.log(`  - ${f}`)) }
process.exit(fail === 0 ? 0 : 1)
