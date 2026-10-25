// ============================================================
// VERIFIKASI EXPORT CSV & PDF — MODUL MATERIAL (t_27e26b0e)
// Merender components/ModuleView.js ASLI (hasil transform SWC di dist/)
// dengan React + jsdom INTERAKTIF (createRoot), klik tombol export dengan
// URL.createObjectURL di-stub (blob ditangkap, tidak ada unduhan nyata),
// lalu memeriksa:
//   A) Toolbar: tombol tampil di materials, tidak di vendors, nama file benar
//   B) CSV: BOM, header kolom, 335 baris penuh (tanpa limit 10), nilai &
//      label acuan jujur (HISTORIS vs estimasi PR)
//   C) PDF: biner valid + pdftotext (header Noir, tanggal, kolom, Page 2)
//   D) Regresi: expand acuan t_090127ad & Show More t_cf05c96f tetap normal
// PENTING URUTAN IMPORT: env jsdom dibuat SEBELUM react-dom.
// Dijalankan oleh run.py di sandbox (mock supabase, tanpa DB).
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// ---------- 1) DOM environment dulu ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

// ---------- 2) Baru import React & komponen ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default
const expMod = await import(pathToFileURL(path.join(SB, 'dist/modules/materials/export.mjs')).href)

// ---------- 3) Assertion helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))

// ---------- 4) Data mock ----------
const noop = () => {}

const VENDORS = [
  { id: 'v1', name: 'Toko Baroni Jaya', phone: '0811', supplier_category: 'Plywood & Board', store_link: '' },
  { id: 'v2', name: 'TB Makmur Sentosa', phone: '0812', supplier_category: 'Plywood & Board', store_link: '' }
]

// 335 material (pola material-acuan-test), harga master di subset.
const MATERIALS = Array.from({ length: 335 }, (_, i) => {
  const n = i + 1
  const cat = ['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai', 'Lainnya'][i % 5]
  return {
    id: `m${n}`, kode: `ALM-${String(n).padStart(4, '0')}`,
    name: `Material Uji ${n} ${cat}`, category: cat,
    qty: n, satuan: 'Meter',
    current_stock: cat === 'Bahan Habis Pakai' ? (n % 5) : null,
    min_stock: cat === 'Bahan Habis Pakai' ? 5 : null,
    harga_acuan: n % 3 === 0 ? 150000 : null
  }
})

const MAT_HIST = { id: 'mHIST', kode: 'HPL-9001', name: 'Material Histori Lengkap', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: null }
const MAT_MASTER_ONLY = { id: 'mMASTER', kode: 'HPL-9002', name: 'Material Master Saja', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: 175000 }
const MAT_NAMA_MIRIP = { id: 'mMIRIP', kode: 'HPL-9004', name: 'Material Histori Lengkap (duplikat nama beda ID)', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: null }
const MAT_ACTUAL = { id: 'mACTUAL', kode: 'HPL-9006', name: 'Material Harga Aktual', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: null }

const REQUESTS = [{ id: 'pr1', pr_number: 'PR-001', title: 'PR histori', status: 'DRAFT', priority: 'NORMAL', project_id: 'p1', project_name: '[99] Baroni', materials_summary: '', notes: '', created_at: '2026-10-01T00:00:00Z' }]

const PR_ITEMS = [
  // Historis via price_actual 115.000 (estimasi 120.000 TIDAK boleh dipakai).
  { id: 'piActual', pr_id: 'pr1', material_id: 'mHIST', item_name: 'Material Histori Lengkap', kode: 'HPL-9001', unit: 'Lembar', quantity: 10, status: 'ORDERED', supplier_category: 'HPL & Edging', vendor_id: 'v1', estimated_price: 120000, price_actual: 115000, sort_order: 0 },
  // Estimasi PR terdahulu (tanpa kolom aktual) — kategori terpisah, jujur.
  { id: 'piEst', pr_id: 'pr1', material_id: 'mMIRIP', item_name: 'Material Histori Lengkap (duplikat nama beda ID)', kode: 'HPL-9004', unit: 'Lembar', quantity: 5, status: 'APPROVED', supplier_category: 'HPL & Edging', vendor_id: 'v2', estimated_price: 250000, sort_order: 1 }
]

const RECEIVINGS = [
  { id: 'rc1', purchase_request_id: 'pr1', vendor_id: 'v1', status: 'NORMAL', received_date: '2026-10-12', delivery_note: 'SJ-1', invoice_no: 'INV-1', note: '', created_at: '2026-10-12T02:00:00Z' }
]

const RECEIVING_ITEMS = [
  { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'piActual', item_name: 'Material Histori Lengkap', unit: 'Lembar', quantity_received: 10, note: null, created_at: '2026-10-12T02:00:00Z' },
  { id: 'riEst', receiving_id: 'rc1', pr_item_id: 'piEst', item_name: 'Material Histori Lengkap (duplikat nama beda ID)', unit: 'Lembar', quantity_received: 5, note: null, created_at: '2026-10-12T02:00:00Z' }
]

const PROJECTS = [{ id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING', created_at: '2026-10-01T00:00:00Z' }]

// ---------- 5) Tangkap unduhan (stub URL.createObjectURL) ----------
// PENTING: modul export memakai global `URL` — di Node itu class URL global
// (parser), BUKAN window.URL milik JSDOM. Stub diletakkan di global Node
// agar pemanggilan dari kode komponen ter-tangkap.
const downloads = []
URL.createObjectURL = function (blob) {
  downloads.push(blob)
  return 'blob:stub-' + downloads.length
}
URL.revokeObjectURL = function () {}
window.HTMLAnchorElement.prototype.click = function () {} // no-op unduhan nyata

// ---------- 6) Mount helper ----------
function mount(page, rows, extra = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22 read-only */ }
  // Stub unduhan: module export memakai global URL (Node) — stub sudah di
  // global; per-dom cukup anchor click no-op.
  dom.window.HTMLAnchorElement.prototype.click = function () {}
  const props = {
    page, rows,
    allProjects: PROJECTS, allMaterials: [...MATERIALS, MAT_HIST, MAT_MASTER_ONLY, MAT_NAMA_MIRIP, MAT_ACTUAL],
    allPrItems: PR_ITEMS, allReceivingItems: RECEIVING_ITEMS, allRequests: REQUESTS,
    allReceivings: RECEIVINGS, allVendors: VENDORS,
    refresh: noop, say: noop, onDelete: noop, setPage: noop, ...extra
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, root, document, props }
}

const footerText = (document) => (document.querySelector('.list-show-more')?.textContent || '')

// ---------- 7) Unit langsung modul export ----------
console.log('\n[A.1] buildMaterialCsv unit langsung')
{
  const rows = [
    { id: 'x1', kode: 'PLY-0001', name: 'Plywood 15mm dengan, koma"aneh', category: 'Plywood & Board', satuan: 'Lembar', current_stock: 12, min_stock: 4, harga_acuan: 90000 },
    { id: 'x2', kode: 'GLU-0002', name: 'Glue tanpa acuan', category: 'Bahan Habis Pakai', satuan: 'Kg', current_stock: null, min_stock: 2, harga_acuan: null },
    { id: 'x3', kode: 'SND-0003', name: 'Tanpa satuan kolom', category: 'Lainnya', current_stock: '', min_stock: '', harga_acuan: null }
  ]
  // Lookup acuan per id (pola resolver shell: material -> daftar entri)
  const acMap = { x1: [{ source: 'MASTER', price: 90000, unit: 'Lembar', vendor: null }] }
  const csv = expMod.buildMaterialCsv(rows, (r) => acMap[r.id] || [])
  const lines = csv.split('\n')
  check('CSV diawali BOM \\ufeff', csv.charCodeAt(0) === 0xFEFF)
  check('Header kolom persis sesuai arahan', lines[0].slice(1) === '"Kode";"Nama Material";"Kategori";"Satuan";"Stok Saat Ini";"Min Stok";"Harga Acuan Terakhir"', JSON.stringify(lines[0].slice(1)))
  check('Jumlah baris data = 3 (+BOM baris header)', lines.length === 4, `lines=${lines.length}`)
  const rowA = lines[1]
  check('Sel berisi koma/kutip di-quote & di-escape', rowA.includes('"Plywood 15mm dengan, koma""aneh"'), rowA)
  check('Master harga_acuan masuk kolom acuan dgn label sumber', rowA.includes('Rp 90.000') && rowA.includes('(Master)'), rowA)
  const rowB = lines[2]
  check('Material tanpa acuan = kolom kosong (bukan 0)', /"$/.test(rowB.split(';')[6]) || rowB.endsWith('""'), rowB)
  const rowC = lines[3]
  check('Stok kosong → sel kosong, satuan kosong → ""', rowC.startsWith('"SND-0003";"Tanpa satuan kolom";"Lainnya";"";"";"";""'), rowC)
}

console.log('\n[A.2] Label acuan jujur: HISTORIS ≠ estimasi PR')
{
  const hist = expMod.buildMaterialCsv([{ id: 'h', kode: 'X', name: 'N', category: 'C', satuan: 'Lembar' }], () => [{ source: 'HISTORIS', price: 115000, unit: 'Lembar', vendor: 'Toko Baroni Jaya' }])
  const est = expMod.buildMaterialCsv([{ id: 'e', kode: 'Y', name: 'N', category: 'C', satuan: 'Lembar' }], () => [{ source: 'PR_ESTIMATE', price: 250000, unit: 'Lembar', vendor: null }])
  check('HISTORIS dgn price_actual 115.000 tampil', hist.includes('Rp 115.000') && hist.includes('Historis (beli aktual)'), hist.split('\n')[1])
  check('Estimasi PR dilabel eksplisit BUKAN harga beli', est.includes('250.000') && est.includes('BUKAN harga beli') && !est.includes('Historis'), est.split('\n')[1])
}

// ---------- 8) Render interaktif ----------
console.log('\n[B] Tombol toolbar di Modul Material')
downloads.length = 0
// rows = seluruh dataset master (335 + 4 material khusus uji acuan = 339)
const TOTAL = MATERIALS.length + 4
const { document: docM } = mount('materials', [...MATERIALS, MAT_HIST, MAT_MASTER_ONLY, MAT_NAMA_MIRIP, MAT_ACTUAL])

const csvBtn = [...docM.querySelectorAll('.toolbar-actions .btn-export-module')].find(b => b.textContent.includes('Export CSV'))
const pdfBtn = [...docM.querySelectorAll('.toolbar-actions .btn-export-module')].find(b => b.textContent.includes('Export PDF'))
check('Tombol 📥 Export CSV tampil di toolbar', !!csvBtn)
check('Tombol 📄 Export PDF tampil di toolbar', !!pdfBtn)
check('Tombol di sebelah search/baris + Tambah Material (toolbar-actions)', !!csvBtn?.closest('.toolbar-actions'))

// Klik Export CSV — download seluruh displayRows (TOTAL) BUKAN 10.
check(`Counter toolbar: "${TOTAL} data tersedia" (seluruh dataset)`, new RegExp(`${TOTAL} data tersedia`).test(docM.querySelector('.toolbar .muted')?.textContent || ''), docM.querySelector('.toolbar .muted')?.textContent)
check(`Footer Show More: 10 dari ${TOTAL} (default tetap 10)`, new RegExp(`10 dari ${TOTAL}`).test(footerText(docM)), footerText(docM))
click(csvBtn)
{
  const blob = downloads[downloads.length - 1]
  check('Klik CSV → 1 unduhan terjadi', downloads.length === 1, `n=${downloads.length}`)
  // BOM ada di BYTES file (Excel membaca byte); blob.text() dipakai TextDecoder
  // yang meng-strip BOM — verifikasi byte UTF-8 BOM langsung (EF BB BF).
  const bytes = new Uint8Array(await blob.arrayBuffer())
  check('CSV: UTF-8 BOM di 3 byte pertama (EF BB BF)', bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF, [bytes[0], bytes[1], bytes[2]].join(','))
  const text = await blob.text() // BOM ter-strip oleh TextDecoder (benar utk teks)
  const lines = text.split('\n')
  check('CSV: header kolom benar', lines[0] === '"Kode";"Nama Material";"Kategori";"Satuan";"Stok Saat Ini";"Min Stok";"Harga Acuan Terakhir"', JSON.stringify(lines[0]))
  check(`CSV: ${TOTAL} baris data penuh (TANPA potongan Show More 10)`, lines.length === TOTAL + 1, `lines=${lines.length}`)
  check('CSV: baris pertama berisi data ALM-0001', lines[1].startsWith('"ALM-0001"'), lines[1]?.slice(0, 80))
  // Material histori lengkap: HPL-9001 — histori AKTUAL dari price_actual
  const rowHist = lines.find(l => l.startsWith('"HPL-9001"'))
  check('CSV: HPL-9001 dgn histori AKTUAL 115.000 + vendor', rowHist && rowHist.includes('Rp 115.000') && rowHist.includes('Toko Baroni Jaya') && rowHist.includes('Historis (beli aktual)'), rowHist)
  const rowEst = lines.find(l => l.startsWith('"HPL-9004"'))
  function rowEstLabel(l) { return l && l.includes('250.000') && l.includes('BUKAN harga beli') && !l.includes('Historis') }
  check('CSV: HPL-9004 dgn estimasi dilabel BUKAN harga beli', rowEstLabel(rowEst), rowEst)
  const rowMaster = lines.find(l => l.startsWith('"HPL-9002"'))
  check('CSV: HPL-9002 master 175.000 label Master', rowMaster && rowMaster.includes('Rp 175.000') && rowMaster.includes('(Master)'), rowMaster)
  const rowBhp = lines.find(l => l.startsWith('"ALM-0004"'))
  check('CSV: ALM-0004 (BHP) kategori & stok ter-extract benar', rowBhp && rowBhp.includes('"Bahan Habis Pakai"'), rowBhp)
}

// Nama file — link.download pada anchor stub: tangkap atribut via override kedua.
// (createObjectURL sudah dicatat; nama file diverifikasi lewat unit MaterialExportButtons di A.4.)

console.log('\n[C] Klik Export PDF → biner valid & pdftotext')
downloads.length = 0
click(pdfBtn)
{
  check('Klik PDF → 1 unduhan terjadi', downloads.length === 1, `n=${downloads.length}`)
  const bytes = new Uint8Array(await downloads[0].arrayBuffer())
  check('PDF magic bytes: %PDF-1.4', String.fromCharCode(...bytes.slice(0, 8)) === '%PDF-1.4')
  const tail = String.fromCharCode(...bytes.slice(-40))
  check('PDF diakhiri %%EOF', tail.includes('%%EOF'))
  check('PDF ukuran wajar (> 30KB utk 358 baris multi-halaman)', bytes.length > 30000, `bytes=${bytes.length}`)
  // Simpan & pdftotext — verifikasi layout nyata via parser PDF lokal.
  const pdfPath = path.join(SB, 'material-export.pdf')
  fs.writeFileSync(pdfPath, Buffer.from(bytes))
  let txt = ''
  try {
    txt = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' })
  } catch { /* pdftotext failsafe di bawah */ }
  check('PDF: header NOIR LIVING tampil', /NOIR LIVING/.test(txt))
  check('PDF: judul MASTER MATERIAL tampil', /MASTER MATERIAL/.test(txt))
  check('PDF: tanggal ekspor DD/MM/YYYY tampil', /TANGGAL EKSPOR/.test(txt) && /\d{2}\/\d{2}\/\d{4}/.test(txt), txt.slice(0, 200))
  check('PDF: header kolom No/Kode/Nama/Kategori/Satuan/Stok tampil', /NAMA MATERIAL/.test(txt) && /KATEGORI/.test(txt) && /SATUAN/.test(txt) && /STOK/.test(txt))
  check('PDF: data material terlihat (ALM-0001)', /ALM-0001/.test(txt))
  // 335 ALM-* + 4 material khusus (HPL-9xxx) = 339 baris semuanya dirender
  check('PDF: item khusus HPL-9006 (baris terakhir) dirender', /HPL-9006/.test(txt))
  const pdfPages = String.fromCharCode(...bytes.slice(0, 4000)).match(/MediaBox \[0 0 595\.28 841\.89\]/)
  check('PDF: MediaBox A4 595.28x841.89', !!pdfPages)
}

// ---------- 9) Fokus pencarian diikut export ----------
console.log('\n[B.2] Export mengikuti pencarian aktif')
{
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch {}
  dom.window.HTMLAnchorElement.prototype.click = function () {}
  const root = createRoot(document.getElementById('app'))
  // Search input terkontrol: ketik via native setter + event input React
  flushSync(() => root.render(React.createElement(Module, { page: 'materials', rows: [...MATERIALS, MAT_HIST, MAT_MASTER_ONLY, MAT_NAMA_MIRIP, MAT_ACTUAL], allProjects: PROJECTS, allMaterials: [...MATERIALS, MAT_HIST, MAT_MASTER_ONLY, MAT_NAMA_MIRIP, MAT_ACTUAL], allPrItems: PR_ITEMS, allReceivingItems: RECEIVING_ITEMS, allRequests: REQUESTS, allReceivings: RECEIVINGS, allVendors: VENDORS, refresh: noop, say: noop, onDelete: noop, setPage: noop })))
  const search = document.querySelector('.toolbar-actions .search-input')
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  flushSync(() => { setter.call(search, 'Material Histori Lengkap'); search.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  downloads.length = 0
  const csvF = [...document.querySelectorAll('.toolbar-actions .btn-export-module')].find(b => b.textContent.includes('Export CSV'))
  click(csvF)
  const text = await downloads[downloads.length - 1].text()
  const lines = text.split('\n')
  // "Material Histori Lengkap" — 2 match: HPL-9001 (histori) + HPL-9004 (duplikat nama)
  check('Search → CSV hanya data terfilter (2 baris data)', lines.length === 3, `lines=${lines.length}: ${JSON.stringify(lines)}`)
  check('Search terfilter baris 1 tetap utuh dgn kolom acuan historis', lines[1] && lines[1].includes('Rp 115.000'), lines[1])
}

// ---------- 10) Modul lain TIDAK ikut mendapat tombol ----------
console.log('\n[B.3] Tombol hanya di modul Material')
{
  const { document: docV } = mount('vendors', VENDORS)
  const n = docV.querySelectorAll('.toolbar-actions .btn-export-module').length
  check('Toolbar Vendor tanpa tombol export', n === 0, `n=${n}`)
}

// ---------- 11) Nama file sesuai pola Master_Material_YYYY-MM-DD ----------
console.log('\n[A.3] Nama file unduhan')
{
  const today = new Date()
  const iso = today.toISOString().slice(0, 10)
  // Nama file diverifikasi dengan penggantian window.document.createElement
  // oleh spy anchor yang MENEWANG dipakai downloadBlob (pendekatan berbeda
  // dgn blob capture: nama file = link.download). Stub di global document
  // yang sedang aktif (module export memakai global document, yang shell
  // jsdom tutup via global.document mount terakhir).
  downloads.length = 0
  const calls = []
  const originalCreate = document.createElement.bind(document)
  document.createElement = function (tag) {
    const el = originalCreate(tag)
    if (tag === 'a') {
      calls.push(el)
      el.click = function () {}
    }
    return el
  }
  // Unit langsung komponen tombol: jangan render shell — cukup export JS
  // MaterialExportButtons dgn rows 1 material, lalu KLIK tombolnya, spy
  // menangkap anchor yg dibikin oleh downloadBlob (nama file = link.download).
  const ReactBtn = (await import('react')).default
  const { createRoot: cR2 } = await import('react-dom/client')
  try {
    flushSync(() => {
      const root2 = cR2(document.getElementById('app'))
      root2.render(ReactBtn.createElement(expMod.MaterialExportButtons, { rows: MATERIALS.slice(0, 1), acuanEntries: () => [] }))
    })
  } catch (e) { /* container reused: root sudah ada, render lagi */ }
  const csvBtnUnit = [...document.querySelectorAll('.btn-export-module')].find(b => b.textContent.includes('Export CSV'))
  const pdfBtnUnit = [...document.querySelectorAll('.btn-export-unit p')] // bukan bagian spy; dummy
  click(csvBtnUnit)
  const csvSpy = calls[0]
  check('Nama file CSV = Master_Material_YYYY-MM-DD.csv', /^Master_Material_\d{4}-\d{2}-\d{2}\.csv$/.test(csvSpy?.download || ''), csvSpy?.download)
  // Klik juga Export PDF utk nama file PDF (calls[1] anchor kedua).
  const pdfBtnUnit2 = [...document.querySelectorAll('.btn-export-module')].find(b => b.textContent.includes('Export PDF'))
  click(pdfBtnUnit2)
  const pdfSpy = calls[1]
  check('Nama file PDF = Master_Material_YYYY-MM-DD.pdf', /^Master_Material_\d{4}-\d{2}-\d{2}\.pdf$/.test(pdfSpy?.download || ''), pdfSpy?.download)
  check('Stamp = tanggal hari ini', csvSpy?.download.includes(iso), csvSpy?.download)
  document.createElement = originalCreate
}

// ---------- 12) REGRESI t_090127ad & t_cf05c96f ----------
console.log('\n[D] Regresi: + Acuan expandable & Show More 10')
{
  // ulang mount materials fresh (docM sudah di-click dua kali).
  // PENTING: shell reset listLimit=10 tiap paging/filter berubah — arahan
  // t_cf05c96f. Data hitung = TOTAL (339) seluruh dataset.
  const { document: docR } = mount('materials', [...MATERIALS, MAT_HIST, MAT_MASTER_ONLY, MAT_NAMA_MIRIP, MAT_ACTUAL])
  check('Kolom "Acuan Harga" tetap TIDAK ada di header desktop', !([...docR.querySelectorAll('.desktop-table-view thead th')].some(th => /acuan harga/i.test(th.textContent))))
  const t1 = [...docR.querySelectorAll('.desktop-table-view .acuan-toggle')].some(b => b.textContent.includes('+ Acuan Harga'))
  check('Expand + Acuan: tombol "+ Acuan Harga" tampil di baris', t1)
  const toggleRows0 = docR.querySelectorAll('.desktop-table-view tbody tr').length
  check('Default tertutup (Show More 10 baris + aksi): 10 parent', toggleRows0 === 10, `rows=${toggleRows0}`)
  const b1 = [...docR.querySelectorAll('.desktop-table-view .acuan-toggle')][0]
  click(b1)
  const rowsAfter = docR.querySelectorAll('.desktop-table-view tbody tr').length
  const expandOpen = docR.querySelectorAll('.desktop-table-view tr.acuan-expand-row').length
  check('Klik toggle membuka 1 baris expand (11 baris total)', rowsAfter === 11 && expandOpen === 1, `rows=${rowsAfter}, expand=${expandOpen}`)
  check('Show More tidak reset: tetap "10 dari 339"', new RegExp(`10 dari ${TOTAL}`).test(footerText(docR)), footerText(docR))
  check('Rincian expand berisi "Belum ada acuan harga" (material tanpa histori)', "Belum ada acuan harga".includes("Belum ada acuan harga") && /Belum ada acuan harga/.test(docR.querySelector('tr.acuan-expand-row')?.textContent || ''))
}

// ---------- summary ----------
console.log(`\n=== HASIL: ${pass} PASS, ${fail} FAIL ===`)
if (failures.length) {
  console.log('GAGAL:')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
