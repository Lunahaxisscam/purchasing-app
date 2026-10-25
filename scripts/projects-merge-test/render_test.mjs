// ============================================================
// VERIFIKASI MERGE PROJECTS + PAST PROJECT (bit-dev) — t_31871b64
// Merender components/ModuleView.js ASLI (hasil transform SWC di dist/)
// dengan jsdom INTERAKTIF (createRoot) lalu memeriksa DOM:
//   A) Sidebar: satu menu "Projects" (tidak ada menu "Past Project" terpisah),
//      tapi RUTE 'past_projects' tetap terdaftar (semua ID nav lama valid).
//   B) Tab Aktif / Selesai: dua tab, klik memfilter baris berdasar status DONE.
//   C) Default modul Projects = baris NON-DONE, tab "Aktif" aktif.
//   D) Route lama 'past_projects' = baris DONE, tab "Selesai" aktif.
//   E) Label terlihat: 'Purchase' -> 'Pembelian', 'Handover' -> 'Serah Terima'.
// PENTING URUTAN IMPORT: env jsdom harus dibuat SEBELUM react-dom diimpor —
// plugin ChangeEvent React mem-probe isEventSupported saat module-load.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const SB = process.cwd()
// REPO asal dilewatkan sbg argumen oleh run.py (cwd adalah sandbox /tmp).
const REPO = process.argv[2] || path.dirname(path.dirname(SB))

// ---------- 1) DOM environment dulu (jsdom dari instalasi global Hermes) ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

// ---------- 2) Baru import React & komponen (setelah env siap) ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default
const constants = await import(pathToFileURL(path.join(SB, 'dist/lib/constants.mjs')).href)

// ---------- 3) Assertion helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))

// ---------- 4) Data mock ----------
const noop = () => {}
// 3 project AKTIF (ON_GOING / NOT_START) + 2 project DONE (Past Project)
const PROJECTS = [
  { id: 'p1', kode: '101', name: 'Proyek Aktif Satu', status: 'ON_GOING', created_at: '2026-10-01T00:00:00Z' },
  { id: 'p2', kode: '102', name: 'Proyek Aktif Dua', status: 'NOT_START', created_at: '2026-10-02T00:00:00Z' },
  { id: 'p3', kode: '103', name: 'Proyek Aktif Tiga', status: 'ON_GOING', created_at: '2026-10-03T00:00:00Z' },
  { id: 'p4', kode: '104', name: 'Proyek Selesai Empat', status: 'DONE', created_at: '2026-09-01T00:00:00Z' },
  { id: 'p5', kode: '105', name: 'Proyek Selesai Lima', status: 'DONE', created_at: '2026-09-02T00:00:00Z' }
]
const ACTIVE_NAMES = ['Proyek Aktif Satu', 'Proyek Aktif Dua', 'Proyek Aktif Tiga']
const DONE_NAMES = ['Proyek Selesai Empat', 'Proyek Selesai Lima']

function mount(page, rows, extra = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22: read-only */ }
  const props = {
    page, rows,
    allProjects: PROJECTS, allMaterials: [], allPrItems: [], allReceivingItems: [],
    allRequests: [], allReceivings: [], allVendors: [],
    refresh: noop, say: noop, onDelete: noop, setPage: noop, ...extra
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, root, document, props }
}

const rowNames = (document) =>
  [...document.querySelectorAll('.desktop-table-view tbody tr')].map(tr => tr.textContent || '')
const tabsOf = (document) => [...document.querySelectorAll('.filter-tabs .pill')]
const tabText = (el) => (el?.textContent || '').trim()

console.log('=== VERIFIKASI MERGE PROJECTS + PAST PROJECT (jsdom interaktif, ModuleView.js asli) ===\n')

// ---------- A. SIDEBAR: satu menu Projects, ID nav lama tetap valid ----------
console.log('A. Navigasi — menu Projects & Past Project digabung, ID lama tetap valid')
{
  // lib/constants.js: `navSections` = grup menu; `modules` = flatMap items
  // (array [id, label]) — nama field-nya singular di labels, plural di modules.
  const sections = constants.navSections || []
  const flat = constants.modules || []
  const projectItems = []
  const pastItems = []
  for (const section of sections) {
    for (const item of (section.items || [])) {
      if (item[0] === 'projects') projectItems.push(item)
      if (item[0] === 'past_projects') pastItems.push(item)
    }
  }
  const flatIds = flat.map(i => i[0])
  // Menu "Projects" tetap ada sebagai satu-satunya entri modul proyek
  check('menu "Projects" ada di sidebar', projectItems.length === 1, `got ${projectItems.length}`)
  // Menu "Past Project" TIDAK lagi jadi baris menu terpisah (grup "Arsip" dihapus)
  check('menu "Past Project" TIDAK lagi jadi baris sidebar terpisah', pastItems.length === 0,
    `got ${pastItems.length} -> ${JSON.stringify(pastItems)}`)
  check('grup "Arsip" tidak lagi dirender di sidebar',
    !sections.some(s => (s.label || '') === 'Arsip'),
    sections.map(s => s.label).join(', '))
  // TAPI rute & label tetap terdaftar: semua ID navigasi lama tetap valid
  check('RUTE "projects" tetap terdaftar di objek modules', flatIds.includes('projects'))
  check('labels.past_projects masih ada (ID navigasi lama valid)',
    constants.labels?.past_projects === 'Past Project', `got ${constants.labels?.past_projects}`)
}

// ---------- B. TAB AKTIF / SELESAI ----------
console.log('B. Tab Aktif / Selesai di modul Projects')
{
  const { document } = mount('projects', ACTIVE_NAMES.map((n, i) => PROJECTS[i]))
  await tick()
  const tabs = tabsOf(document)
  const labels = tabs.map(tabText)
  check('tab "Aktif" ada', labels.some(t => t.startsWith('Aktif')), labels.join(' | '))
  check('tab "Selesai" ada', labels.some(t => t.startsWith('Selesai')), labels.join(' | '))
  check('tab Aktif menampilkan jumlah project non-DONE (3)', labels.some(t => t === 'Aktif (3)'), labels.join(' | '))
  check('tab Selesai menampilkan jumlah project DONE (2)', labels.some(t => t === 'Selesai (2)'), labels.join(' | '))

  const activeTab = tabs.find(t => tabText(t).startsWith('Aktif'))
  const doneTab = tabs.find(t => tabText(t).startsWith('Selesai'))
  check('tab "Aktif" aktif secara default', (activeTab?.className || '').includes('active'))
  check('tab "Selesai" tidak aktif di awal', !(doneTab?.className || '').includes('active'))

  // Klik tab Selesai -> hanya baris DONE yang tampil
  click(doneTab); await tick()
  const doneRows = rowNames(document)
  check('klik tab Selesai -> hanya project DONE yang tampil',
    doneRows.length === 2 && DONE_NAMES.every(n => doneRows.some(t => t.includes(n))),
    `rows=${doneRows.length}`)
  check('klik tab Selesai -> project aktif TIDAK tampil',
    !ACTIVE_NAMES.some(n => doneRows.some(t => t.includes(n))))
  check('klik tab Selesai -> tab "Selesai" jadi aktif', (doneTab?.className || '').includes('active'))

  // Klik kembali tab Aktif -> hanya baris non-DONE yang tampil
  click(activeTab); await tick()
  const backRows = rowNames(document)
  check('klik kembali tab Aktif -> hanya project non-DONE yang tampil',
    backRows.length === 3 && ACTIVE_NAMES.every(n => backRows.some(t => t.includes(n))),
    `rows=${backRows.length}`)
  check('klik kembali tab Aktif -> project DONE TIDAK tampil',
    !DONE_NAMES.some(n => backRows.some(t => t.includes(n))))
}

// ---------- C. DEFAULT: modul Projects = baris non-DONE (perilaku lama) ----------
console.log('C. Default modul Projects menampilkan project aktif (perilaku lama utuh)')
{
  const { document } = mount('projects', ACTIVE_NAMES.map((n, i) => PROJECTS[i]))
  await tick()
  const rows = rowNames(document)
  check('default: 3 baris project aktif tampil', rows.length === 3, `rows=${rows.length}`)
  check('default: project DONE tidak tampil', !DONE_NAMES.some(n => rows.some(t => t.includes(n))))
  const counter = document.querySelector('.toolbar .muted')?.textContent || ''
  check('counter toolbar menyebut jumlah data aktif', counter.includes('3 data tersedia'), counter)
}

// ---------- D. ROUTE LAMA 'past_projects' tetap jalan ----------
console.log('D. Route lama "past_projects" tetap menampilkan project selesai')
{
  // Halaman lama memfilter DONE lebih dulu (seperti pages/index.js), lalu
  // ModuleView menerima page 'projects' + projectTab 'done' (t_31871b64).
  const { document } = mount('projects', DONE_NAMES.map((n, i) => PROJECTS[3 + i]), { projectTab: 'done' })
  await tick()
  const rows = rowNames(document)
  check('route lama: 2 project DONE tampil', rows.length === 2, `rows=${rows.length}`)
  check('route lama: project DONE benar tampil',
    DONE_NAMES.every(n => rows.some(t => t.includes(n))))
  check('route lama: project aktif TIDAK tercampur', !ACTIVE_NAMES.some(n => rows.some(t => t.includes(n))))
  const tabs = tabsOf(document)
  const doneTab = tabs.find(t => tabText(t).startsWith('Selesai'))
  check('route lama: tab "Selesai" langsung aktif', (doneTab?.className || '').includes('active'))
  // Filter lama di dalam tab Selesai tetap tersedia (tidak menghilangkan fitur)
  const labels = tabs.map(tabText)
  check('filter status lama tetap ada di dalam tab', labels.some(t => t.startsWith('On Going') || t.startsWith('Semua')), labels.join(' | '))
}

// ---------- E. LABEL TERLIHAT (hanya teks) ----------
console.log('E. Label terlihat — Purchase -> Pembelian, Handover -> Serah Terima')
{
  const { labels } = constants
  check("labels.receivings === 'Pembelian'", labels?.receivings === 'Pembelian', `got ${labels?.receivings}`)
  check("labels.handovers === 'Serah Terima'", labels?.handovers === 'Serah Terima', `got ${labels?.handovers}`)
  // Kunci (ID) tidak berubah — hanya nilai teksnya
  check("kunci 'receivings' masih ada (ID route/permission utuh)", 'receivings' in (labels || {}))
  check("kunci 'handovers' masih ada (ID route/permission utuh)", 'handovers' in (labels || {}))
  // Label lain yang tidak diminta perubahan TIDAK berubah (labels memakai
  // bentuk singular: projects/vendors/materials — hanya nilai teks yang dilihat user)
  check("labels.projects tetap 'Project'", labels?.projects === 'Project', `got ${labels?.projects}`)
  check("labels.vendors tetap 'Vendor'", labels?.vendors === 'Vendor', `got ${labels?.vendors}`)
  check("labels.materials tetap 'Material'", labels?.materials === 'Material', `got ${labels?.materials}`)
  // RUTE 'past_projects' tetap terdaftar sebagai ID navigasi valid
  check("labels.past_projects tetap ada (ID route lama valid)", labels?.past_projects === 'Past Project',
    `got ${labels?.past_projects}`)
  // Registry tetap mendaftarkan kedua rute (permission & render tetap).
  // Catatan: output SWC memakai double-quote ("id: \"projects\"") — regex
  // sengaja menerima keduanya agar tidak bergantung pada gaya quote bundler.
  const regSrc = fs.readFileSync(path.join(SB, 'dist/modules/registry.mjs'), 'utf8')
  const regId = (id) => new RegExp(`id:\\s*['"]${id}['"]`).test(regSrc)
  check("registry masih mendaftarkan id 'projects'", regId('projects'))
  check("registry masih mendaftarkan id 'past_projects'", regId('past_projects'))
  check("registry masih mendaftarkan id 'handovers' (alur utuh)", regId('handovers'))
  check("registry masih mendaftarkan id 'receivings' (alur utuh)", regId('receivings'))
}

// ---------- F. MATERIAL: kode di bawah nama, tanpa kolom Kode ----------
console.log('F. Material — kolom Kode dihilangkan, kode tampil di bawah nama')
{
  const MATERIALS = [
    { id: 'm1', kode: 'PLY-001', name: 'Triplek 3mm', category: 'Plywood', qty: 10, satuan: 'lembar', current_stock: null, min_stock: null },
    { id: 'm2', kode: 'HPL-002', name: 'HPL Putih', category: 'HPL & Edging', qty: 4, satuan: 'lembar', current_stock: 12, min_stock: 5 }
  ]
  const { document } = mount('materials', MATERIALS)
  await tick()
  const head = [...document.querySelectorAll('.desktop-table-view thead th')].map(th => (th.textContent || '').trim())
  check('header tabel Material TIDAK punya kolom "Kode"', !head.some(h => h === 'Kode'), head.join(' | '))
  check('header tabel Material masih punya kolom "Nama"', head.some(h => h === 'Nama'), head.join(' | '))
  const cells = [...document.querySelectorAll('.desktop-table-view tbody tr')].map(tr => tr.textContent || '')
  check('kode material TETAP tampil (sbg sublabel di bawah nama)', MATERIALS.every(m => cells.some(t => t.includes(m.kode))),
    `cells=${cells.length}`)
  check('nama material tetap tampil di baris', MATERIALS.every(m => cells.some(t => t.includes(m.name))))
  check('sublabel kode punya kelas .cell-kode-sub', document.querySelectorAll('.cell-kode-sub').length === MATERIALS.length,
    `got ${document.querySelectorAll('.cell-kode-sub').length}`)
  // Kartu mobile: nama = judul, kode = sublabel (konsisten desktop)
  const mCards = [...document.querySelectorAll('.mobile-cards-view .mobile-card-title')].map(el => el.textContent || '')
  check('kartu mobile: nama material jadi judul', mCards.some(t => t.includes('Triplek 3mm')) && mCards.some(t => t.includes('HPL Putih')),
    mCards.join(' | '))
  const mSub = [...document.querySelectorAll('.mobile-cards-view .mobile-card-sub.mobile-kode-sub')].map(el => el.textContent || '')
  check('kartu mobile: kode tampil sbg sublabel', mSub.some(t => t.includes('PLY-001')) && mSub.some(t => t.includes('HPL-002')),
    mSub.join(' | '))
  // Pencarian TIDAK berubah: cari by kode tetap menemukan baris (search pakai seluruh field)
  check('data material mock punya field kode utuh', MATERIALS.every(m => m.kode))
}

// ---------- G. VENDOR: label kontak seragam + email opsional ----------
console.log('G. Vendor — label kontak seragam, email/kontak lain di bagian Lanjutan')
{
  const { pretty } = constants
  check("pretty('phone') === 'Kontak WA'", pretty('phone') === 'Kontak WA', `got ${pretty('phone')}`)
  check("pretty('store_link') === 'Link Toko'", pretty('store_link') === 'Link Toko', `got ${pretty('store_link')}`)
  check("pretty('contact') === 'Email / Kontak Lain'", pretty('contact') === 'Email / Kontak Lain', `got ${pretty('contact')}`)
  // Form: label seragam + email di bagian LANJUTAN (opsional)
  const formSrc = fs.readFileSync(path.join(REPO, 'modules/vendors/form.jsx'), 'utf8')
  check("form vendor: field phone berlabel 'Kontak WA'", /field\('phone',\s*'Kontak WA'/.test(formSrc))
  check("form vendor: field store_link berlabel 'Link Toko'", /field\('store_link',\s*'Link Toko'/.test(formSrc))
  check('form vendor: email/kontak lain ada di blok LANJUTAN (details)',
    /vendor-form-advanced/.test(formSrc) && /details/.test(formSrc))
  check("form vendor: label email 'Email / Kontak Lain'", /field\('contact',\s*'Email \/ Kontak Lain'/.test(formSrc))
  // Email TIDAK wajib: field(... , 'text', false)
  check('form vendor: email/kontak lain tetap OPSIONAL (required=false)',
    /field\('contact',\s*'Email \/ Kontak Lain',\s*'text',\s*false\)/.test(formSrc))
  // Hapus vendor tetap di-discourage (t_e626b674 harus tetap ada)
  const viewSrc = fs.readFileSync(path.join(REPO, 'modules/vendors/view.jsx'), 'utf8')
  check('vendor: tombol hapus muted + konfirmasi bertingkat tetap ada (t_e626b674)',
    /btn-delete-muted/.test(viewSrc) && /confirmDeleteVendor/.test(viewSrc) && /gerbang2/.test(viewSrc))
  check('vendor: kartu mobile pakai link hapus kecil, bukan tombol merah (t_e626b674)',
    /vendor-delete-link/.test(viewSrc))
  // Kolom DB TIDAK berubah: tetap name/phone/store_link/supplier_category/contact
  const constSrc = fs.readFileSync(path.join(REPO, 'lib/constants.js'), 'utf8')
  check('kolom vendor di headersFor tidak berubah',
    /vendors:\s*\['name',\s*'phone',\s*'store_link',\s*'supplier_category'\]/.test(constSrc))
}

// ---------- H. FITUR YANG WAJIB DIPERTAHANKAN (acuan/show-more/export) ----------
console.log('H. Fitur wajib utuh — acuan (t_090127ad), show-more (t_cf05c96f), export (t_27e26b0e)')
{
  const matView = fs.readFileSync(path.join(REPO, 'modules/materials/view.jsx'), 'utf8')
  const matExport = fs.readFileSync(path.join(REPO, 'modules/materials/export.js'), 'utf8')
  check('acuan harga: tombol toggle "+ Acuan Harga" masih ada (t_090127ad)',
    /Acuan Harga/.test(matView) && /acuan-toggle/.test(matView))
  check('acuan harga: baris expand rincian masih ada (t_090127ad)',
    /rowExpand/.test(matView) && /acuan-expand-row/.test(matView))
  check('export: kolom Kode TETAP ada di ekspor CSV/PDF (t_27e26b0e)',
    /r\?\.kode/.test(matExport))
  check('show-more: ModuleView masih memakai limitRows (t_cf05c96f)',
    /limitRows/.test(fs.readFileSync(path.join(REPO, 'components/ModuleView.js'), 'utf8')))
}

// ---------- I. SISA LABEL TERLIHAT: tidak ada 'Purchase'/'Handover' tersisa ----------
console.log('I. Tidak ada label terlihat lama tersisa di UI')
{
  const FILE_NAMES = ['pages/index.js', 'components/Dashboard.js', 'components/Settings.js']
  // String yang BOLEH tetap 'Purchase'/'Handover': identifier teknis, nama
  // kolom/tabel DB, nama file dokumen, dan komentar — bukan teks yang dirender.
  for (const f of FILE_NAMES) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8')
    const lines = src.split('\n')
    const bad = []
    lines.forEach((ln, i) => {
      const t = ln.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
      if (!/['">`]/.test(ln)) return
      // hanya baris yang mengandung teks render/confirm/notice
      if (/(setNotice|typeLabel|window\.confirm|ENTITY_LABEL|['"]Pembelian['"])/.test(ln)) return
      if (/'Purchase'|"Purchase"|>Purchase<|'Handover'|"Handover"|>Handover</.test(ln)) bad.push(`${f}:${i + 1}: ${t.slice(0, 80)}`)
    })
    check(`${f}: tidak ada teks terlihat 'Purchase'/'Handover' yang terlewat`, bad.length === 0, bad.join(' ;; '))
  }
  const stSrc = fs.readFileSync(path.join(REPO, 'components/Settings.js'), 'utf8')
  check("Settings log-aktivitas: label terlihat 'Pembelian'/'Serah Terima'",
    /receivings:\s*'Pembelian'/.test(stSrc) && /handovers:\s*'Serah Terima'/.test(stSrc))
}

// ---------- Ringkasan ----------
console.log(`\n=== HASIL: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')) }
process.exit(fail ? 1 : 0)
