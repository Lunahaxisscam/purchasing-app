// ============================================================
// VERIFIKASI RENDER TOOLBAR VENDOR (bamboo-tech) — feedback DAT
// Merender components/ModuleView.js ASLI (hasil transform SWC di dist/)
// dengan React SSR di dalam jsdom, lalu memeriksa DOM hasil render:
//   A) vendors      -> toolbar BERSIH: tanpa "data tersedia", tanpa filter pills,
//                      tanpa container .filter-tabs; search + "+ Tambah Vendor" ada;
//                      SEMUA baris vendor tetap tampil (tidak terfilter).
//   B) materials    -> regresi: counter + filter pills TETAP ada.
//   C) projects     -> regresi: counter + filter pills TETAP ada.
//   D) past_projects-> regresi: counter + keterangan "(Project dengan status DONE)".
// Dijalankan oleh run.py di sandbox (mock supabase, tanpa DB).
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// ---------- 1) DOM environment (jsdom dari instalasi global Hermes) ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

// ---------- 2) Import hasil kompilasi ----------
const React = (await import('react')).default
const { renderToStaticMarkup } = await import('react-dom/server')
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default

// ---------- 3) Assertion helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

// ---------- 4) Data mock ----------
const noop = () => {}
const VENDORS = [
  { id: 'v1', name: 'TB Sumber Jaya', phone: '08123456789', contact: 'a@b.c', supplier_category: 'Plywood & Board', store_link: 'https://tokopedia.com/x' },
  { id: 'v2', name: 'Toko Tanpa Telepon', phone: '', contact: '', supplier_category: 'Hardware & Fitting', store_link: '' },
  { id: 'v3', name: 'CV Kontak Kosong', phone: '081999888777', contact: '', supplier_category: 'HPL & Edging', store_link: 'tokopedia.com/y' }
]
const MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', code: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', qty: 10, satuan: 'Lembar', current_stock: 2, min_stock: 5, harga_acuan: 120000 },
  { id: 'm2', kode: 'BHP-0001', name: 'Lem Fox', category: 'Bahan Habis Pakai', qty: 3, satuan: 'Kaleng', current_stock: 1, min_stock: 2, harga_acuan: 45000 }
]
const PROJECTS = [
  { id: 'p1', kode: '99', code: '99', name: 'Baroni', status: 'ON_GOING', created_at: '2026-10-01T00:00:00Z' },
  { id: 'p2', kode: '83', name: 'Mabes', status: 'DONE', created_at: '2026-09-01T00:00:00Z' }
]

function renderModule(page, rows) {
  const html = renderToStaticMarkup(
    React.createElement(Module, {
      page,
      rows,
      allProjects: PROJECTS,
      allMaterials: MATERIALS,
      allPrItems: [],
      allReceivingItems: [],
      allRequests: [],
      allReceivings: [],
      allVendors: VENDORS,
      refresh: noop,
      say: noop,
      onDelete: noop,
      setPage: noop
    })
  )
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
  return { html, document: dom.window.document }
}

console.log('=== VERIFIKASI TOOLBAR VENDOR (React SSR + jsdom, ModuleView.js asli) ===\n')

// ---------- SKENARIO A: halaman vendors — toolbar bersih ----------
console.log('A. Halaman Vendor — toolbar bersih (search + Tambah Vendor saja)')
{
  const { html, document } = renderModule('vendors', VENDORS)
  const toolbar = document.querySelector('.toolbar')
  const text = document.body.textContent || ''

  check('toolbar ter-render', !!toolbar)
  check('toolbar TIDAK memuat teks "data tersedia"', !text.includes('data tersedia'), toolbar ? toolbar.textContent : '')
  check('toolbar TIDAK merender container .filter-tabs', !document.querySelector('.toolbar .filter-tabs'))
  check('toolbar TIDAK merender pill filter', !document.querySelector('.toolbar .pill'))
  check('toolbar TIDAK memuat teks "Ada Telepon"', !text.includes('Ada Telepon'))
  check('toolbar TIDAK memuat teks "Ada Kontak/Email"', !text.includes('Ada Kontak/Email'))
  check('toolbar TIDAK memuat teks "Semua (" (pill) di area toolbar', !(toolbar && toolbar.textContent.includes('Semua (')))
  check('search bar tetap ada', !!document.querySelector('.toolbar .search-input'))
  check('placeholder search = "🔍 Cari..."', document.querySelector('.toolbar .search-input')?.getAttribute('placeholder') === '🔍 Cari...')
  check('tombol "+ Tambah Vendor" tetap ada', toolbar && toolbar.textContent.includes('+ Tambah Vendor'))
  check('toolbar hanya berisi 2 elemen (aksi saja, tanpa blok counter)', toolbar && toolbar.children.length === 1)
  check('toolbar aksi didorong ke kanan (justify-content: flex-end)', (toolbar?.getAttribute('style') || '').includes('justify-content:flex-end'))
  // Semua vendor tetap tampil (tidak ada filter tersembunyi yang menyaring data)
  check('vendor tanpa telepon/kontak TETAP tampil', text.includes('Toko Tanpa Telepon'))
  check('semua 3 vendor tampil di tabel', document.querySelectorAll('.desktop-table-view tbody tr').length === 3)
  check('kolom "Aksi" tetap ada', text.includes('Hapus'))
}

// ---------- SKENARIO B: materials — regresi counter + pills ----------
console.log('\nB. Halaman Material — counter + filter pills TETAP ada (regresi)')
{
  const { document } = renderModule('materials', MATERIALS)
  const toolbar = document.querySelector('.toolbar')
  const t = toolbar?.textContent || ''
  check('counter "2 data tersedia" tetap tampil', t.includes('2 data tersedia'))
  check('container .filter-tabs tetap ada', !!document.querySelector('.toolbar .filter-tabs'))
  check('pill "Semua (2)" tetap ada', t.includes('Semua (2)'))
  check('pill "Stok Menipis" tetap ada', t.includes('Stok Menipis'))
}

// ---------- SKENARIO C: projects — regresi counter + pills ----------
console.log('\nC. Halaman Project — counter + filter pills TETAP ada (regresi)')
{
  const { document } = renderModule('projects', PROJECTS)
  const toolbar = document.querySelector('.toolbar')
  const t = toolbar?.textContent || ''
  check('counter "data tersedia" tetap tampil', t.includes('data tersedia'))
  check('container .filter-tabs tetap ada', !!document.querySelector('.toolbar .filter-tabs'))
  check('pill "Aktif (1)" tetap ada', t.includes('Aktif (1)'))
  check('tombol "+ Tambah Project" tetap ada', t.includes('+ Tambah Project'))
}

// ---------- SKENARIO D: past_projects — keterangan khusus tetap tampil ----------
console.log('\nD. Halaman Past Project — keterangan "(Project dengan status DONE)" tetap ada (regresi)')
{
  const { document } = renderModule('past_projects', PROJECTS.filter(p => p.status === 'DONE'))
  const toolbar = document.querySelector('.toolbar')
  const t = toolbar?.textContent || ''
  check('counter + keterangan DONE tetap tampil', t.includes('data tersedia') && t.includes('(Project dengan status DONE)'))
  check('tombol "← Ke Project Aktif" tetap ada', t.includes('← Ke Project Aktif'))
}

console.log(`\n=== HASIL: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA VERIFIKASI TOOLBAR VENDOR LULUS')
