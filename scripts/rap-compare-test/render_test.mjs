// ============================================================
// UJI RENDER — modules/rap-compare/view.jsx (t_a5ba5f73)
// Merender komponen ASLI (hasil transform SWC di dist/) dengan
// jsdom INTERAKTIF (createRoot), lalu memeriksa DOM:
//   A) KPI: RAB / RAP / Aktual / Selisih tampil; tanpa aktual ->
//      "Belum ada aktual" BUKAN "Rp 0".
//   B) Tabel perbandingan: tiap baris punya RAB, RAP, Aktual, Selisih.
//   C) Baris tanpa RAP -> selisih "—" (bukan 0).
//   D) Tombol impor membuat draft RAP di memori -> total RAP berubah.
//   E) Coverage ("yang belum lengkap") menampilkan hitungan.
//   F) Panel batasan tampil (kejujuran soal draft/aktual).
//   G) Tidak ada aksi tulis DB: tidak ada tombol simpan/ubah/hapus.
//   H) CSV bisa diunduh (Blob + URL.createObjectURL dipanggil).
//   I) Status pagu: tanpa pagu -> "belum diketahui" (BUKAN "aman");
//      rencana melewati pagu -> peringatan + selisih melebihi.
//   J) Drawer ringkas: klik baris -> asal tiap angka + catatan jujur;
//      baris tanpa aktual ditulis "tidak ada data", bukan 0.
//   K) Proyek tanpa data -> empty state (tidak mengarang angka).
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
const RapCompareModule = (await import(pathToFileURL(path.join(SB, 'dist/modules/rap-compare/view.mjs')).href)).default

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))

// ---------- 3) Data mock ----------
const PROJECTS = [
  { id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' },
  { id: 'p2', kode: '83', name: 'Mabes', status: 'DONE' }
]
const BOQ_ITEMS = [
  { id: 'b1', project_id: 'p1', item_name: 'Wardrobe', quantity: 2, unit: 'unit', estimated_price: 1500000 },
  { id: 'b2', project_id: 'p1', item_name: 'Kitchen set', quantity: 1, unit: 'unit', estimated_price: 8000000 },
  { id: 'b3', project_id: 'p1', item_name: 'Meja Tamu', quantity: 1, unit: 'unit', estimated_price: 2500000 },
  { id: 'b4', project_id: 'p2', item_name: 'Proyek lain', quantity: 1, unit: 'unit', estimated_price: 100000 }
]
const RECEIVINGS = [
  { id: 'rc1', project_id: 'p1', invoice_no: 'TB-1', status: 'DIBELI' }
]
const RECEIVING_ITEMS = [
  { id: 'ri1', receiving_id: 'rc1', item_name: 'Wardrobe', quantity_received: 2, note: '[Harga: 1350000]' }
]

function mount(props = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22: read-only */ }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(RapCompareModule, {
    rows: { boq_items: BOQ_ITEMS, receivings: RECEIVINGS, receiving_items: RECEIVING_ITEMS },
    allProjects: PROJECTS,
    ...props
  })))
  return { dom, root }
}

const t = (doc, id) => {
  const el = doc.querySelector(`[data-testid="${id}"]`)
  return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null
}

// ---------- 4) Render awal ----------
console.log('\n[A] Render awal — KPI jujur')
const { dom } = mount()
const doc = dom.window.document

check('root modul tampil', !!doc.querySelector('[data-testid="rap-compare-root"]'))
check('badge draft "belum tersimpan di server" tampil',
  /belum tersimpan di server/.test(t(doc, 'rap-compare-root') || ''))
check('tabel perbandingan tampil', !!doc.querySelector('[data-testid="rap-compare-table"]'))

check('KPI RAB = Rp 13.500.000 (3 baris p1 saja)', t(doc, 'rap-compare-kpi-rab') === 'Rp 13.500.000', t(doc, 'rap-compare-kpi-rab'))
check('KPI RAP "—" sebelum draft (BUKAN Rp 0)', t(doc, 'rap-compare-kpi-rap') === '—', t(doc, 'rap-compare-kpi-rap'))
check('KPI Aktual = Rp 2.700.000 (dari nota)', t(doc, 'rap-compare-kpi-actual') === 'Rp 2.700.000', t(doc, 'rap-compare-kpi-actual'))
check('catatan aktual menyebut nota pembelian', /nota pembelian/.test(t(doc, 'rap-compare-actual-note') || ''))
check('KPI Selisih "—" (RAP belum ada)', t(doc, 'rap-compare-kpi-diff') === '—', t(doc, 'rap-compare-kpi-diff'))

console.log('\n[B] Tabel per baris')
const rows = [...doc.querySelectorAll('tr[data-testid^="rap-compare-line-"]')]
check('3 baris proyek p1 (proyek p2 tidak ikut)', rows.length === 3, String(rows.length))
const rowText = rows.map(r => (r.textContent || '').replace(/\s+/g, ' ').trim())
check('baris Wardrobe ada', rowText.some(x => x.includes('Wardrobe')))
const wardrobe = rowText.find(x => x.includes('Wardrobe'))
check('Wardrobe RAB Rp 3.000.000', wardrobe.includes('Rp 3.000.000'), wardrobe)
check('Wardrobe RAP "—" (belum draft)', /—/.test(wardrobe), wardrobe)
check('Wardrobe Aktual Rp 2.700.000', wardrobe.includes('Rp 2.700.000'), wardrobe)
check('Wardrobe Selisih "—" bukan Rp 0', /Rp 0\b/.test(wardrobe) === false, wardrobe)
check('Wardrobe status "Tidak bisa dihitung"', wardrobe.includes('Tidak bisa dihitung'), wardrobe)

console.log('\n[C] Coverage "yang belum lengkap"')
check('rabOnly = 3 (belum ada draft)', t(doc, 'rap-compare-cov-rabonly') === '3 baris RAB belum masuk rencana RAP.', t(doc, 'rap-compare-cov-rabonly'))
check('rapOnly = 0', t(doc, 'rap-compare-cov-raponly') === '0 baris RAP di luar acuan RAB.', t(doc, 'rap-compare-cov-raponly'))
check('actualWithoutPlan = 0', t(doc, 'rap-compare-cov-actual') === '0 belanja nyata tanpa acuan RAB maupun RAP.', t(doc, 'rap-compare-cov-actual'))
check('missingActual = 2 (Kitchen set & Meja Tamu)', t(doc, 'rap-compare-cov-missing') === '2 baris berencana belum ada aktualnya.', t(doc, 'rap-compare-cov-missing'))

console.log('\n[D] Impor RAB -> draft RAP (di memori)')
click(doc.querySelector('[data-testid="rap-compare-import"]'))
check('meta draft tampil (RAP-01 · Draft · 3 baris)', /RAP-01/.test(t(doc, 'rap-compare-draft-meta') || '') && /3 baris/.test(t(doc, 'rap-compare-draft-meta') || ''), t(doc, 'rap-compare-draft-meta'))
check('KPI RAP jadi Rp 13.500.000 (salin acuan)', t(doc, 'rap-compare-kpi-rap') === 'Rp 13.500.000', t(doc, 'rap-compare-kpi-rap'))
check('KPI Selisih jadi Rp 0 (sama dengan acuan)', t(doc, 'rap-compare-kpi-diff') === 'Rp 0', t(doc, 'rap-compare-kpi-diff'))
const rows2 = [...dom.window.document.querySelectorAll('tr[data-testid^="rap-compare-line-"]')]
const wd2 = rows2.map(r => (r.textContent || '').replace(/\s+/g, ' ').trim()).find(x => x.includes('Wardrobe'))
check('Wardrobe RAP jadi Rp 3.000.000', wd2.includes('Rp 3.000.000'), wd2)
check('Wardrobe status "Sesuai acuan"', wd2.includes('Sesuai acuan'), wd2)
check('coverage rabOnly turun ke 0', t(dom.window.document, 'rap-compare-cov-rabonly') === '0 baris RAB belum masuk rencana RAP.', t(dom.window.document, 'rap-compare-cov-rabonly'))

console.log('\n[E] Ganti proyek -> draft direset (tidak bocor antar proyek)')
const sel = dom.window.document.querySelector('[data-testid="rap-compare-project"]')
const setterSel = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set
setterSel.call(sel, 'p2')
sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
check('pindah ke p2: RAB = Rp 100.000', t(dom.window.document, 'rap-compare-kpi-rab') === 'Rp 100.000', t(dom.window.document, 'rap-compare-kpi-rab'))
check('pindah ke p2: RAP kembali "—" (draft direset)', t(dom.window.document, 'rap-compare-kpi-rap') === '—', t(dom.window.document, 'rap-compare-kpi-rap'))
check('pindah ke p2: Aktual "Belum ada aktual" (bukan Rp 0)', t(dom.window.document, 'rap-compare-kpi-actual') === 'Belum ada aktual', t(dom.window.document, 'rap-compare-kpi-actual'))
check('catatan aktual menyebut "Belum ada aktual"', /Belum ada aktual/.test(t(dom.window.document, 'rap-compare-actual-note') || ''))

console.log('\n[F] Proyek tanpa data -> empty state')
const { dom: dom2 } = mount({
  rows: { boq_items: [], receivings: [], receiving_items: [] },
  allProjects: [{ id: 'p9', kode: '77', name: 'Kosong' }]
})
check('empty state tampil', !!dom2.window.document.querySelector('[data-testid="rap-compare-empty"]'))
check('tabel tidak dirender', !dom2.window.document.querySelector('[data-testid="rap-compare-table"]'))
check('KPI RAB "—"', t(dom2.window.document, 'rap-compare-kpi-rab') === '—')
click(dom2.window.document.querySelector('[data-testid="rap-compare-import"]'))
check('impor tanpa data -> draft tidak dibuat', !dom2.window.document.querySelector('[data-testid="rap-compare-draft-meta"]'))

console.log('\n[G] Read-only: tidak ada aksi tulis DB')
const { dom: dom3 } = mount()
const btnTexts = [...dom3.window.document.querySelectorAll('button')].map(b => (b.textContent || '').trim())
check('hanya 2 tombol di toolbar (Unduh CSV + Buat draft)', btnTexts.length === 2, JSON.stringify(btnTexts))
check('tidak ada tombol "Simpan"', !btnTexts.some(x => /simpan/i.test(x)))
check('tidak ada tombol "Tambah"', !btnTexts.some(x => /tambah/i.test(x)))
check('tidak ada tombol "Hapus"', !btnTexts.some(x => /hapus/i.test(x)))
check('tidak ada input teks bebas (hanya select proyek)',
  dom3.window.document.querySelectorAll('input[type="text"], textarea').length === 0)
check('tidak ada elemen <form> (tidak ada submit ke mana pun)',
  dom3.window.document.querySelectorAll('form').length === 0)
check('tidak ada atribut onSubmit',
  dom3.window.document.querySelectorAll('[onsubmit]').length === 0)

console.log('\n[H] Ekspor CSV')
// Blob/URL di-resolve sebagai global Node (bukan window), sama seperti
// harness stock-view-test.
let blobMade = null, clicked = null
global.Blob = class { constructor(parts, opts) { blobMade = { parts, opts } } }
global.URL.createObjectURL = () => 'blob:mock'
global.URL.revokeObjectURL = () => {}
const origCreate = dom3.window.document.createElement.bind(dom3.window.document)
dom3.window.document.createElement = (tag) => {
  const el = origCreate(tag)
  if (tag === 'a') { el.click = () => { clicked = el } }
  return el
}
click(dom3.window.document.querySelector('.rc-btn-csv'))
check('Blob CSV dibuat', !!blobMade, blobMade ? '' : 'Blob tidak dipanggil')
check('nama file menyebut perbandingan + kode proyek', clicked?.download === 'perbandingan-rab-rap-99.csv', clicked?.download)
const csvText = blobMade ? blobMade.parts[0] : ''
check('CSV punya header 7 kolom', csvText.split('\n')[0].split(',').length === 7, csvText.split('\n')[0])
check('CSV berisi Wardrobe', /Wardrobe/.test(csvText))

console.log('\n[I] Panel batasan tampil (edukasi)')
const rootText = dom3.window.document.querySelector('[data-testid="rap-compare-root"]').textContent
check('menyebut draft hanya di memori', /hanya hidup di memori/.test(rootText))
check('menyebut "Belum ada aktual" bukan Rp 0', /Belum ada aktual/.test(rootText))
check('menyebut markup/PPN tidak ikut dibandingkan', /markup/.test(rootText))
check('menyebut localStorage tidak dipakai', /localStorage/.test(rootText))

console.log('\n[I] Status pagu (peringatan rencana melewati batas)')
// Tanpa pagu -> "belum diketahui". Ini inti kejujuran: modul TIDAK
// boleh bilang "aman" hanya karena tidak ada angka pagu.
check('tanpa pagu -> status "Pagu belum diketahui"',
  t(dom3.window.document, 'rap-compare-ceiling-label') === 'Pagu belum diketahui',
  t(dom3.window.document, 'rap-compare-ceiling-label'))
check('level = none (bukan within/aman)',
  dom3.window.document.querySelector('[data-testid="rap-compare-ceiling"]')?.getAttribute('data-level') === 'none')
check('tidak ada klaim "aman" saat pagu tidak diketahui',
  !/\baman\b/i.test((t(dom3.window.document, 'rap-compare-ceiling-msg') || '') + (t(dom3.window.document, 'rap-compare-ceiling-label') || '')),
  t(dom3.window.document, 'rap-compare-ceiling-msg'))
check('angka pagu tidak dikarang (tidak ada teks Rp pada nums)',
  !dom3.window.document.querySelector('.rc-ceiling-nums'))

// Dengan pagu: RAP draft (13,5 juta) > pagu 10 juta -> peringatan.
const { dom: dom4 } = mount({ pagu: 10000000 })
click(dom4.window.document.querySelector('[data-testid="rap-compare-import"]'))
const ceil4 = dom4.window.document.querySelector('[data-testid="rap-compare-ceiling"]')
check('rencana melewati pagu -> level "over"', ceil4?.getAttribute('data-level') === 'over', ceil4?.getAttribute('data-level'))
check('peringatan memakai role="alert"', ceil4?.getAttribute('role') === 'alert')
check('label "Rencana melewati pagu"',
  t(dom4.window.document, 'rap-compare-ceiling-label') === 'Rencana melewati pagu',
  t(dom4.window.document, 'rap-compare-ceiling-label'))
check('angka pagu tampil', /Rp 10\.000\.000/.test(t(dom4.window.document, 'rap-compare-ceiling') || ''),
  t(dom4.window.document, 'rap-compare-ceiling'))
check('seberapa melewati tampil (Rp 3.500.000)', /Rp 3\.500\.000/.test(t(dom4.window.document, 'rap-compare-ceiling') || ''))

// Pagu besar -> "di bawah pagu"
const { dom: dom5 } = mount({ pagu: 50000000 })
click(dom5.window.document.querySelector('[data-testid="rap-compare-import"]'))
check('rencana di bawah pagu -> level "within"',
  dom5.window.document.querySelector('[data-testid="rap-compare-ceiling"]')?.getAttribute('data-level') === 'within')
check('label "Rencana di bawah pagu"',
  t(dom5.window.document, 'rap-compare-ceiling-label') === 'Rencana di bawah pagu')
check('persentase terpakai tampil (27%)', /27%/.test(t(dom5.window.document, 'rap-compare-ceiling') || ''))

// Pagu ada tapi belum ada draft -> "menunggu rencana", bukan "aman"
const { dom: dom6 } = mount({ pagu: 50000000 })
check('pagu ada, draft belum -> level "unknown"',
  dom6.window.document.querySelector('[data-testid="rap-compare-ceiling"]')?.getAttribute('data-level') === 'unknown')
check('label "Pagu menunggu rencana"',
  t(dom6.window.document, 'rap-compare-ceiling-label') === 'Pagu menunggu rencana')

console.log('\n[J] Drawer ringkas (asal tiap angka)')
// drawer tertutup saat awal
check('drawer tertutup sebelum baris diklik',
  !dom4.window.document.querySelector('[data-testid="rap-compare-drawer"]'))
// Kitchen set: ada RAB & RAP, TIDAK ada aktual -> baris inilah yang
// membuktikan "tidak ada data" bukan "0".
const rowKs = dom4.window.document.querySelector('tr[data-testid="rap-compare-line-kitchen set"]')
check('baris Kitchen set ada di tabel', !!rowKs)
click(rowKs)
const drawer = dom4.window.document.querySelector('[data-testid="rap-compare-drawer"]')
check('drawer terbuka setelah baris diklik', !!drawer)
check('drawer menyebut nama baris', /Kitchen set/.test(drawer?.textContent || ''))
const dds = [...(drawer?.querySelectorAll('dd') || [])].map(d => (d.textContent || '').trim())
check('drawer menampilkan 3 sumber + selisih', dds.length === 4, JSON.stringify(dds))
check('drawer: RAB & RAP ada angkanya', dds.filter(x => x === '8000000').length === 2, JSON.stringify(dds))
check('drawer: aktual tidak ada -> ditulis "tidak ada data", BUKAN 0',
  dds.some(x => /Tidak ada data/.test(x)), JSON.stringify(dds))
// "0" hanya sah untuk SELISIH saat kedua sisi ADA dan nilainya sama
// (RAP = RAB). Yang tidak boleh: sumber hilang jadi angka 0.
check('drawer: angka "0" hanya muncul sebagai selisih, bukan sumber',
  dds.filter(x => x === '0').length <= 1, JSON.stringify(dds))
check('drawer: sumber yang hilang tidak pernah jadi "0"',
  dds.slice(0, 3).every(x => x !== '0'), JSON.stringify(dds))
check('drawer punya catatan "belum ada nota"', /belum ada nota/i.test(t(dom4.window.document, 'rap-compare-drawer-notes') || ''),
  t(dom4.window.document, 'rap-compare-drawer-notes'))
// baris yang memang punya aktual (Wardrobe) -> angka nyata, bukan "tidak ada data"
click(dom4.window.document.querySelector('[data-testid="rap-compare-drawer-close"]'))
click(dom4.window.document.querySelector('tr[data-testid="rap-compare-line-wardrobe"]'))
const ddsW = [...(dom4.window.document.querySelectorAll('[data-testid="rap-compare-drawer"] dd') || [])]
  .map(d => (d.textContent || '').trim())
check('drawer Wardrobe: aktual nyata Rp 2.700.000 (bukan "tidak ada data")',
  ddsW.some(x => x === '2700000'), JSON.stringify(ddsW))
check('drawer Wardrobe: tidak ada "tidak ada data" (ketiga sumber ada)',
  !ddsW.some(x => /Tidak ada data/.test(x)), JSON.stringify(ddsW))
click(dom4.window.document.querySelector('[data-testid="rap-compare-drawer-close"]'))
check('tombol tutup menutup drawer',
  !dom4.window.document.querySelector('[data-testid="rap-compare-drawer"]'))

console.log(`\n=== HASIL RENDER TEST: ${pass} lulus, ${fail} gagal ===`)
if (fail) {
  console.log('Gagal:')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
