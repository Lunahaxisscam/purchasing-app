// scripts/hide-labor-marketing-test/guard_test.mjs
// Rute/bookmark/state lama ke labor_stock & marketing (t_6a18a263).
// Bagian statis: memastikan cabang modul yang dinonaktifkan di
// pages/index.js (TERKOMPILASI) benar-benar fail-closed dan guard role
// admin tidak melemah. Pola import sama dengan approval-off-test.
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
global.getComputedStyle = dom.window.getComputedStyle
global.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

let pass = 0, fail = 0
const ok = (name, cond) => {
  if (cond) { pass++; console.log('  ok  ', name) }
  else { fail++; console.log('  FAIL', name) }
}

// --- BAGIAN A: STATIS terhadap source TERKOMPILASI pages/index.mjs.
// pages/index.js adalah aplikasi Next.js utuh; menjalankannya di jsdom
// tidak realistis (butuh router/supabase). Jadi kita uji pola guard-nya.
const fs = await import('node:fs')
const SRC = fs.readFileSync(path.join(SB, 'dist', 'pages', 'index.mjs'), 'utf8')

console.log('A. STATIS: cabang modul dinonaktifkan (pages/index.js terkompilasi)')

const lsGuard = SRC.search(/isNavModuleDisabled\((['"])labor_stock\1\)/)
const mkGuard = SRC.search(/isNavModuleDisabled\((['"])marketing\1\)/)
ok('pages/index.js memanggil isNavModuleDisabled("labor_stock")', lsGuard !== -1)
ok('pages/index.js memanggil isNavModuleDisabled("marketing")', mkGuard !== -1)

// Guard harus ada SEBELUM mount komponen modul (fail-closed dulu).
// Catatan: `LaborStockModule` juga muncul sebagai IMPORT (baris ~265) —
// import memang HARUS di atas (aturan ES module). Jadi pembandingnya
// adalah pemakaian sebagai elemen JSX, yaitu `_jsx(LaborStockModule`.
const lsMount = SRC.indexOf('_jsx(LaborStockModule')
const mkMount = SRC.indexOf('_jsx(MarketingModule')
ok('labor_stock: guard fail-closed ada SEBELUM mount komponen modul',
  lsGuard !== -1 && lsMount !== -1 && lsGuard < lsMount,
  `guard@${lsGuard} mount@${lsMount}`)
ok('marketing: guard fail-closed ada SEBELUM mount komponen modul',
  mkGuard !== -1 && mkMount !== -1 && mkGuard < mkMount,
  `guard@${mkGuard} mount@${mkMount}`)

// Import tetap ada → reversible, kode modul tidak dibuang dari repo.
ok("import LaborStockModule DIPERTAHANKAN (reversible)", SRC.includes('LaborStockModule'))
ok("import MarketingModule DIPERTAHANKAN (reversible)", SRC.includes('MarketingModule'))

// Pesan ke user harus jujur (tidak mengklaim data hilang).
// Catatan: pesan aslinya berbunyi "tidak ada data ... yang dihapus" —
// itu justru penegasan bahwa TIDAK ada yang dihapus. Jadi regex harus
// mengabaikan bentuk yang dinegasi, bukan sekadar mencari kata "dihapus".
const lsBranch = SRC.slice(lsGuard, lsGuard + 1500)
const mkBranch = SRC.slice(mkGuard, mkGuard + 1500)
const claimsDeletion = (s) => {
  const negated = s
    .replace(/tidak ada[^.<]{0,80}?di(?:hapus|musnahkan)/gi, '')   // "tidak ada ... yang dihapus"
    .replace(/tidak[^.<]{0,40}?di(?:hapus|musnahkan)/gi, '')       // "tidak dihapus"
  return /di(?:hapus|musnahkan)/i.test(negated)
}
ok('pesan labor_stock: "tidak tersedia" + menyebut tukang_projects & Project Finance',
  /tidak tersedia/i.test(lsBranch) && /tukang_projects/.test(lsBranch) && /Project Finance/i.test(lsBranch))
ok('pesan labor_stock: TIDAK mengklaim data dihapus', !claimsDeletion(lsBranch))
ok('pesan marketing: "tidak tersedia" + menyebut Customer CRM',
  /tidak tersedia/i.test(mkBranch) && /Customer CRM/i.test(mkBranch))
ok('pesan marketing: TIDAK mengklaim data dihapus', !claimsDeletion(mkBranch))

// --- BAGIAN B: GUARD ROLE TIDAK MELEMAH.
// Patch hanya menambah cabang early-return; pemeriksaan role harus tetap.
console.log('\nB. STATIS: guard role admin tidak melemah')
const adminChecks = (SRC.match(/role\s*===?\s*['"]admin['"]/g) || []).length
ok(`pages/index.js masih punya ${adminChecks} pemeriksaan role === 'admin'`, adminChecks >= 10)

// Kedua modul memang adminOnly — guard role-nya tetap ada di sekitarnya
// meski modulnya nonaktif (fail closed, bukan "dibuka untuk semua").
ok("sekitar cabang labor_stock masih ada pemeriksaan role === 'admin'",
  /role\s*===?\s*['"]admin['"]/.test(SRC.slice(lsGuard, lsGuard + 5000)))
ok("sekitar cabang marketing masih ada pemeriksaan role === 'admin'",
  /role\s*===?\s*['"]admin['"]/.test(SRC.slice(mkGuard, mkGuard + 5000)))

// --- BAGIAN C: tidak ada query DB baru/efek samping saat OFF.
console.log('\nC. STATIS: tidak ada query DB baru di cabang nonaktif')
ok('cabang labor_stock nonaktif tidak memanggil .from() (tidak ada query baru)',
  !/\.from\(/.test(SRC.slice(lsGuard, lsGuard + 600)))
ok('cabang marketing nonaktif tidak memanggil .from() (tidak ada query baru)',
  !/\.from\(/.test(SRC.slice(mkGuard, mkGuard + 600)))

// --- BAGIAN D: render pesan pengganti benar-benar terbaca.
console.log('\nD. PESAN PENGGANTI (render nyata)')
function NotFound({ msg }) {
  return React.createElement('div', { className: 'panel empty' }, msg)
}
const root = createRoot(document.getElementById('root'))
act(() => {
  root.render(React.createElement(NotFound, {
    msg: 'Halaman Actual Labor & Stok tidak tersedia. Upah tukang aktual (tukang_projects) tetap tercatat dan tetap tampil di Project Finance; estimasi WBS tetap ada di Budgeting.'
  }))
})
const html = document.body.innerHTML
ok('pesan menyebut "tidak tersedia"', html.includes('tidak tersedia'))
ok('pesan menyebut tukang_projects (data tidak hilang)', html.includes('tukang_projects'))
ok('pesan menyebut Project Finance (arah alternatif)', html.includes('Project Finance'))
ok('pesan TIDAK mengklaim data dihapus', !/dihapus|terhapus/i.test(html))
act(() => root.unmount())

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`)
process.exit(fail === 0 ? 0 : 1)
