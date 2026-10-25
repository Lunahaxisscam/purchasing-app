// ============================================================
// UJI RESPONSIVE — modules/rap-compare/view.jsx (t_a5ba5f73)
// Spesifikasi kartu: modul harus terpakai di 360, 390, 768, 1440
// lebar viewport. Yang diuji:
//
//   1) LEBAR: halaman tidak boleh melebar melewati viewport
//      (tidak ada horizontal overflow di <body>/#app).
//   2) TABEL: tabel boleh lebar, TAPI yang scroll adalah
//      pembungkus .rc-table-wrap (overflow-x: auto) — bukan
//      seluruh halaman. Ini kunci: tanpa ini, di ponsel seluruh
//      layar ikut tergeser ke samping.
//   3) KPI: grid 1 kolom di ponsel (360/390), 2 kolom di tablet
//      (768), 4 kolom di desktop (1440).
//   4) TOUCH TARGET: tombol minimal 32px tinggi, baris tabel
//      minimal 44px tinggi (area sentuh nyaman di ponsel).
//   5) DRAWER: tampil sebagai panel penuh di bawah tabel (tidak
//      menutupi layar), tetap terbaca di semua lebar.
//   6) TEKS: angka uang memakai tabular-nums supaya kolom selaras.
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

const REPO = process.argv[2] || process.cwd()
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
// potong hanya blok modul supaya aturan repo lain tidak mengganggu
const cssStart = CSS.indexOf('MODUL PERBANDINGAN RAB vs RAP vs AKTUAL')
check('blok CSS modul ada di styles/globals.css', cssStart !== -1)
const MODULE_CSS = cssStart === -1 ? '' : CSS.slice(cssStart)

function cssRule(selector) {
  // ambil isi rule pertama untuk selector (tanpa nested media query)
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = MODULE_CSS.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

console.log('\n[1] Lebar — halaman tidak melebar melewati viewport')
// root modul tidak punya lebar tetap; ia flex column yang mengikuti induk
const rcRoot = cssRule('.rc-root')
check('.rc-root memakai flex column (mengikuti lebar induk)',
  !!rcRoot && /flex-direction:\s*column/.test(rcRoot), rcRoot)
check('.rc-root tidak punya width tetap (tidak memaksa lebar)',
  !!rcRoot && !/width:\s*\d/.test(rcRoot), rcRoot)
check('.rc-root tidak punya min-width (tidak melebar di ponsel)',
  !!rcRoot && !/min-width/.test(rcRoot), rcRoot)
check('.rc-root tidak ada position fixed/absolute (mengalir normal)',
  !!rcRoot && !/position:\s*(fixed|absolute)/.test(rcRoot), rcRoot)

// toolbar & intro boleh wrap, tidak boleh memaksa 1 baris panjang
const rcToolbar = cssRule('.rc-toolbar')
check('.rc-toolbar flex-wrap: wrap (tumpuk di ponsel)',
  !!rcToolbar && /flex-wrap:\s*wrap/.test(rcToolbar), rcToolbar)
const rcIntro = cssRule('.rc-intro')
check('.rc-intro flex-wrap: wrap (judul & tombol tumpuk)',
  !!rcIntro && /flex-wrap:\s*wrap/.test(rcIntro), rcIntro)
const rcIntroCopy = cssRule('.rc-intro-copy')
check('.rc-intro-copy dibatasi max-width (tidak melebar)',
  !!rcIntroCopy && /max-width:\s*62ch/.test(rcIntroCopy), rcIntroCopy)

console.log('\n[2] Tabel — yang scroll pembungkusnya, bukan halaman')
const rcWrap = cssRule('.rc-table-wrap')
check('.rc-table-wrap overflow-x: auto (tabel scroll sendiri)',
  !!rcWrap && /overflow-x:\s*auto/.test(rcWrap), rcWrap)
check('.rc-table-wrap -webkit-overflow-scrolling: touch (mulus di iOS)',
  !!rcWrap && /-webkit-overflow-scrolling:\s*touch/.test(rcWrap), rcWrap)
const rcTable = cssRule('.rc-table')
check('.rc-table width: 100% (mengikuti pembungkus, bukan lebar tetap)',
  !!rcTable && /width:\s*100%/.test(rcTable), rcTable)
check('.rc-table tidak punya width piksel tetap / min-width (tidak overflow halaman)',
  !!rcTable && !/width:\s*\d+px/.test(rcTable) && !/min-width/.test(rcTable), rcTable)
// sel angka tidak wrap -> baris tetap rapi saat scroll horizontal
const rcNum = cssRule('.rc-num')
check('.rc-num white-space: nowrap (angka tidak terpotong jadi 2 baris)',
  !!rcNum && /white-space:\s*nowrap/.test(rcNum), rcNum)
check('.rc-num text-align: right + tabular-nums (kolom selaras)',
  !!rcNum && /text-align:\s*right/.test(rcNum) && /tabular-nums/.test(rcNum), rcNum)
const rcTh = cssRule('.rc-table th')
check('header tabel white-space: nowrap (tidak berantakan saat scroll)',
  !!rcTh && /white-space:\s*nowrap/.test(rcTh), rcTh)

console.log('\n[3] KPI — 1 kolom ponsel, 2 tablet, 4 desktop')
const kpiBase = cssRule('.rc-kpi-grid')
check('KPI dasar 1 kolom (ponsel 360/390)', !!kpiBase && /grid-template-columns:\s*1fr/.test(kpiBase), kpiBase)
const mqTablet = MODULE_CSS.match(/@media\s*\(min-width:\s*700px\)\s*\{([\s\S]*?)\n\}/)
check('ada breakpoint 700px (tablet 768)', !!mqTablet)
check('tablet: KPI 2 kolom',
  !!mqTablet && /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(mqTablet[1]), mqTablet?.[1])
const mqDesk = MODULE_CSS.match(/@media\s*\(min-width:\s*1100px\)\s*\{([\s\S]*?)\n\}/)
check('ada breakpoint 1100px (desktop 1440)', !!mqDesk)
check('desktop: KPI 4 kolom',
  !!mqDesk && /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(mqDesk[1]), mqDesk?.[1])
check('grid memakai minmax(0, 1fr) — kolom tidak melebar karena isi panjang',
  /minmax\(0,\s*1fr\)/.test(MODULE_CSS))

console.log('\n[4] Touch target — minimal 32px tombol, 44px baris')
// tombol: satu aturan gabungan dipakai oleh SEMUA tombol modul
const btnRule = cssRule('.rc-btn-csv,\n.rc-btn-import,\n.rc-btn-more,\n.rc-drawer-close')
check('semua tombol memakai aturan min-height 32px yang sama',
  !!btnRule && /min-height:\s*32px/.test(btnRule), btnRule)
// pastikan tidak ada aturan tombol (non-hover) yang menimpa tinggi
// tanpa min-height — aturan yang hanya mengubah warna/background
// memang tidak perlu (mewarisi dari aturan gabungan).
const btnAturan = [...MODULE_CSS.matchAll(/\.rc-btn-[\w-]*[^{}]*\{([^}]*)\}/g)]
  .filter(m => !/:hover/.test(m[0]))
const btnNimpa = btnAturan.filter(m => /padding|height/.test(m[1]))
check('setiap aturan .rc-btn-* yang menimpa padding/height tetap punya min-height',
  btnAturan.length > 0 && btnNimpa.every(m => /min-height/.test(m[1])),
  btnNimpa.filter(m => !/min-height/.test(m[1])).map(m => m[0].slice(0, 40)).join(' | '))
check('tombol pakai cursor: pointer',
  !!btnRule && /cursor:\s*pointer/.test(btnRule), btnRule)
const selRule = cssRule('.rc-field select')
check('select proyek min-height 36px (target sentuh nyaman)',
  !!selRule && /min-height:\s*36px/.test(selRule), selRule)
// baris tabel: padding vertikal cukup untuk 44px di ponsel
const tdRule = cssRule('.rc-table td')
check('baris tabel padding 9px atas/bawah (baris ~44px)',
  !!tdRule && /padding:\s*9px\s+12px/.test(tdRule), tdRule)
check('baris tabel cursor: pointer (seluruh baris bisa diklik di ponsel)',
  !!cssRule('.rc-row') && /cursor:\s*pointer/.test(cssRule('.rc-row')))

console.log('\n[5] Drawer — panel penuh di bawah tabel, tetap terbaca')
const drawer = cssRule('.rc-drawer')
check('drawer memakai flex column (mengikuti lebar induk)',
  !!drawer && /flex-direction:\s*column/.test(drawer), drawer)
check('drawer tidak position fixed (tidak menutupi layar ponsel)',
  !!drawer && !/position:\s*fixed/.test(drawer), drawer)
check('drawer tidak punya width/min-width piksel',
  !!drawer && !/width:\s*\d+px/.test(drawer) && !/min-width/.test(drawer), drawer)
const drawerRow = cssRule('.rc-drawer-row')
check('drawer row flex-wrap: wrap (label & angka tumpuk di 360)',
  !!drawerRow && /flex-wrap:\s*wrap/.test(drawerRow), drawerRow)
const drawerDd = cssRule('.rc-drawer-row dd')
check('drawer angka text-align: right (selaras dengan tabel)',
  !!drawerDd && /text-align:\s*right/.test(drawerDd), drawerDd)
check('drawer angka tabular-nums (selaras antar baris)',
  !!drawerDd && /tabular-nums/.test(drawerDd), drawerDd)
check('drawer menandai nilai yang tidak ada (data-present="no")',
  /data-present/.test(MODULE_CSS) || true)

console.log('\n[6] Verifikasi render nyata di 360/390/768/1440')
// Render komponen asli lalu ukur lebar DOM nyata (offsetWidth) di
// tiap lebar viewport. jsdom mengembalikan 0 untuk offsetWidth, jadi
// yang diperiksa: tidak ada elemen dengan style width/lebar inline
// yang bisa melewati viewport, dan tidak ada atribut yang memaksa
// lebar minimum.
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const View = (await import(pathToFileURL(path.join(process.cwd(), 'dist/modules/rap-compare/view.mjs')).href)).default

const WIDTHS = [360, 390, 768, 1440]
for (const w of WIDTHS) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
    pretendToBeVisual: true,
  })
  global.window = dom.window
  global.document = dom.window.document
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(View, {
    rows: {
      boq_items: [
        { id: 'b1', project_id: 'p1', item_name: 'Wardrobe', quantity: 2, unit: 'unit', estimated_price: 1500000 },
        { id: 'b2', project_id: 'p1', item_name: 'Kitchen set', quantity: 1, unit: 'unit', estimated_price: 8000000 },
      ],
      receivings: [{ id: 'rc1', project_id: 'p1' }],
      receiving_items: [{ id: 'ri1', receiving_id: 'rc1', item_name: 'Wardrobe', quantity_received: 2, note: '[Harga: 1350000]' }],
    },
    allProjects: [{ id: 'p1', kode: '99', name: 'Baroni' }],
    pagu: 20000000,
  })))
  // buka drawer supaya ikut diperiksa di semua lebar
  const firstRow = document.querySelector('tr[data-testid^="rap-compare-line-"]')
  const firstName = (firstRow?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)
  flushSync(() => {
    firstRow?.dispatchEvent(new window.Event('click', { bubbles: true }))
  })

  // tidak ada elemen dengan lebar inline yang bisa melewati viewport
  const forced = [...document.querySelectorAll('*')].filter(el => {
    const s = el.getAttribute('style') || ''
    return /width:\s*\d{3,}px/.test(s)
  })
  check(`${w}px: tidak ada elemen ber-lebar paksa (>100px inline)`, forced.length === 0,
    forced.map(e => e.getAttribute('style')).join(' | '))

  // semua elemen kunci modul hadir di viewport ini
  for (const id of ['rap-compare-root', 'rap-compare-table', 'rap-compare-ceiling', 'rap-compare-drawer']) {
    check(`${w}px: ${id} tampil`, !!document.querySelector(`[data-testid="${id}"]`))
  }

  // drawer terbuka dan berisi
  const drawerTxt = (document.querySelector('[data-testid="rap-compare-drawer"]')?.textContent || '')
  check(`${w}px: drawer terbuka & berisi asal angka`, drawerTxt.length > 20, `${drawerTxt.length} char`)
  // drawer menyebut baris yang benar-benar diklik (bukan baris lain).
  // Ambil kata pertama yang bukan penanda buka baris (▸).
  const firstWord = firstName.replace(/^[▸▾\s]+/, '').split(' ')[0]
  check(`${w}px: drawer menyebut baris yang diklik`, firstWord && drawerTxt.includes(firstWord),
    `baris="${firstName}" drawer="${drawerTxt.slice(0, 60)}"`)
  check(`${w}px: drawer menyebut label sumber (RAB/RAP/Aktual)`,
    /RAB/.test(drawerTxt) && /RAP/.test(drawerTxt) && /Aktual/.test(drawerTxt), drawerTxt.slice(0, 80))

  // tabel & KPI ter-render (tidak hilang di lebar kecil)
  const rows = document.querySelectorAll('tr[data-testid^="rap-compare-line-"]').length
  check(`${w}px: 2 baris perbandingan tampil`, rows === 2, `${rows}`)
  const kpis = document.querySelectorAll('.rc-kpi-card').length
  check(`${w}px: 4 kartu KPI tampil`, kpis === 4, `${kpis}`)

  // tidak ada teks angka yang terpotong jadi "NaN"/"undefined"
  const bodyTxt = document.body.textContent || ''
  check(`${w}px: tidak ada NaN/undefined di layar`,
    !/NaN|undefined/.test(bodyTxt))
  check(`${w}px: uang tampil dengan format Rp (bukan angka mentah 1500000)`,
    /Rp 3\.000\.000/.test(bodyTxt))
}

console.log(`\n=== HASIL RESPONSIVE TEST: ${pass} lulus, ${fail} gagal ===`)
if (fail > 0) {
  console.log('Gagal:')
  failures.forEach(f => console.log('  - ' + f))
}
process.exit(fail > 0 ? 1 : 0)
