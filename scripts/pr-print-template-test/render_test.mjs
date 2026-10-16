// ============================================================
// VERIFIKASI TOMBOL "Print Template Pengadaan" (bamboo-tech, task t_bb0929f6)
// Merender components/ModuleView.js ASLI (hasil transform SWC di dist/)
// dengan React SSR di dalam jsdom, lalu memeriksa DOM hasil render:
//   A) requests -> baris .print-template-row ADA, rata kanan, link
//                  "Print Template Pengadaan" di dalamnya, href benar,
//                  target _blank, <a> bukan <button> (tanpa submit/trigger PR),
//                  muncul TEPAT SEBELUM baris toolbar (search + Tambah PR) —
//                  posisi sesuai anotasi screenshot DAT (dekat Perbarui).
//   B) vendors       -> link TIDAK muncul (regresi scope).
//   C) materials     -> link TIDAK muncul (regresi scope).
//   D) past_projects -> link TIDAK muncul (regresi scope).
// Dijalankan oleh run.py di sandbox (mock supabase, tanpa DB).
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const React = (await import('react')).default
const { renderToStaticMarkup } = await import('react-dom/server')
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const noop = () => {}
const PROJECTS = [
  { id: 'p1', kode: '99', code: '99', name: 'Baroni', status: 'ON_GOING', created_at: '2026-10-01T00:00:00Z' }
]
const VENDORS = [
  { id: 'v1', name: 'TB Sumber Jaya', phone: '08123456789', contact: '', supplier_category: 'Plywood & Board', store_link: '' }
]
const MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', code: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', qty: 10, satuan: 'Lembar', current_stock: 2, min_stock: 5, harga_acuan: 120000 }
]

function renderModule(page, rows, extra = {}) {
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
      setPage: noop,
      ...extra
    })
  )
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
  return { html, document: dom.window.document }
}

console.log('=== VERIFIKASI TOMBOL PRINT TEMPLATE PENGADAAN (React SSR + jsdom, ModuleView.js asli) ===\n')

// ---------- SKENARIO A: halaman requests ----------
console.log('A. Halaman Purchase Request — tombol Print Template Pengadaan ada & benar')
{
  const { document, html } = renderModule('requests', [])
  const row = document.querySelector('.print-template-row')
  const link = row ? row.querySelector('a[href$=".pdf"]') : null
  const toolbar = document.querySelector('.toolbar')
  const toolbarText = toolbar ? toolbar.textContent : ''

  check('baris .print-template-row ter-render', !!row)
  check('link print template ADA di baris print-template-row', !!link, html.slice(0, 400))
  check('teks tombol PERSIS "Print Template Pengadaan"', !!link && link.textContent.trim() === 'Print Template Pengadaan', link ? JSON.stringify(link.textContent) : '')
  check('href = /print/form-pengadaan-lapangan-template.pdf', !!link && link.getAttribute('href') === '/print/form-pengadaan-lapangan-template.pdf', link && link.getAttribute('href'))
  check('buka di tab baru (target=_blank)', !!link && link.getAttribute('target') === '_blank')
  check('rel noopener noreferrer (aman)', !!link && (link.getAttribute('rel') || '').includes('noopener') && (link.getAttribute('rel') || '').includes('noreferrer'))
  check('berupa LINK (tanpa submit/form side-effect), bukan <button>', !!link && link.tagName === 'A')
  check('tidak ada <button> di dalam baris print (bukan trigger PR)', !!row && row.querySelectorAll('button').length === 0)

  // Posisi: baris print TEPAT SEBELUM .toolbar (search + Tambah PR) — area anotasi DAT
  check('baris print berada TEPAT SEBELUM .toolbar', !!row && !!toolbar && row.nextElementSibling === toolbar)

  // Toolbar tetap utuh
  check('toolbar tetap punya search bar', !!document.querySelector('.toolbar .search-input'))
  check('tombol "+ Tambah Purchase Request" tetap ada di toolbar', toolbarText.includes('+ Tambah Purchase Request'))
  check('tombol print TIDAK menumpuk di toolbar-actions', !document.querySelector('.toolbar-actions a[href$=".pdf"]'))
}

// ---------- SKENARIO B: vendors — scope ----------
console.log('\nB. Halaman Vendor — tombol template TIDAK muncul (regresi scope)')
{
  const { document } = renderModule('vendors', VENDORS)
  check('tidak ada .print-template-row', !document.querySelector('.print-template-row'))
  check('tidak ada link *.pdf', !document.querySelector('a[href$=".pdf"]'))
  check('toolbar vendor tetap bersih (tanpa counter)', !(document.body.textContent || '').includes('data tersedia'))
}

// ---------- SKENARIO C: materials — scope ----------
console.log('\nC. Halaman Material — tombol template TIDAK muncul (regresi scope)')
{
  const { document } = renderModule('materials', MATERIALS)
  check('tidak ada .print-template-row', !document.querySelector('.print-template-row'))
  check('tidak ada link *.pdf', !document.querySelector('a[href$=".pdf"]'))
  check('counter material tetap ada', (document.body.textContent || '').includes('data tersedia'))
}

// ---------- SKENARIO D: past_projects — scope ----------
console.log('\nD. Halaman Past Project — tombol template TIDAK muncul (regresi scope)')
{
  const { document } = renderModule('past_projects', [])
  check('tidak ada .print-template-row', !document.querySelector('.print-template-row'))
  check('tombol "← Ke Project Aktif" tetap ada', (document.body.textContent || '').includes('Ke Project Aktif'))
}

console.log(`\n=== HASIL: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA VERIFIKASI TOMBOL PRINT TEMPLATE PENGADAAN LULUS')
