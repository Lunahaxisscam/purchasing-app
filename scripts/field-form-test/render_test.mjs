// render_test.mjs — UI Component Render & Interaction Tests for Form Lapangan
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const ModuleView = (await import(
  pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href
)).default

const CreateModal = (await import(
  pathToFileURL(path.join(SB, 'dist/components/CreateModal.mjs')).href
)).default

const FieldFormComponent = (await import(
  pathToFileURL(path.join(SB, 'dist/modules/requests/field-form/FieldFormComponent.mjs')).href
)).default

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`  ✓ ${message}`)
}

console.log('=== PENGUJIAN RENDER: ENTRY POINT & KOMPONEN UI FORM LAPANGAN ===\n')

const MOCK_MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek Polos 18mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 250000 },
  { id: 'm2', kode: 'BHP-0001', name: 'Sekrup 3 cm', category: 'Bahan Habis Pakai', satuan: 'Pcs', harga_acuan: 200 }
]

const MOCK_PROJECTS = [
  { id: 'p1', kode: '99', name: 'Baroni Living', status: 'ON_GOING' }
]

function freshDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  return dom
}

// 1. Entry point tests in ModuleView
console.log('1. Verifikasi Entry Point di ModuleView (requests):')
{
  const dom = freshDom()
  const root = createRoot(dom.window.document.getElementById('app'))
  flushSync(() => root.render(React.createElement(ModuleView, {
    page: 'requests',
    rows: [],
    allProjects: MOCK_PROJECTS,
    allMaterials: MOCK_MATERIALS,
    allPrItems: [],
    allReceivingItems: [],
    allRequests: [],
    allReceivings: [],
    allVendors: [],
    refresh: () => {}, say: () => {}, onDelete: () => {}, setPage: () => {}
  })))

  const btnFieldForm = dom.window.document.querySelector('.btn-field-form')
  assert(btnFieldForm !== null, 'Tombol "📋 Form Lapangan" ter-render di toolbar requests')
  assert(btnFieldForm.textContent.includes('Form Lapangan'), 'Label tombol memuat "Form Lapangan"')

  const btnCreateStandard = dom.window.document.querySelector('.btn-create-module')
  assert(btnCreateStandard !== null, 'Tombol "+ Tambah Purchase Request" standar tetap ter-render')

  const btnPrintTemplate = dom.window.document.querySelector('.btn-print-template')
  assert(btnPrintTemplate !== null, 'Tombol "Print Template Pengadaan" lama tetap ter-render utuh')
}

// 2. FieldFormComponent Render Tests
console.log('\n2. Verifikasi Komponen FieldFormComponent:')
{
  const dom = freshDom()
  const root = createRoot(dom.window.document.getElementById('app'))
  let reviewedSeed = null

  flushSync(() => root.render(React.createElement(FieldFormComponent, {
    allProjects: MOCK_PROJECTS,
    allMaterials: MOCK_MATERIALS,
    initialHeader: { project_id: 'p1', title: 'Meja Rias' },
    onCancel: () => {},
    onReviewPr: (seed) => { reviewedSeed = seed }
  })))

  const doc = dom.window.document
  const projectSelect = doc.querySelector('select[name="project_id"]')
  assert(projectSelect !== null, 'Dropdown Project ter-render')
  assert(projectSelect.value === 'p1', 'Project terpilih sesuai initialHeader')

  const titleInput = doc.querySelector('input[name="title"]')
  assert(titleInput !== null && titleInput.value === 'Meja Rias', 'Input Judul ter-render dan terisi')

  // Check section accordions
  const sectionHeaders = [...doc.querySelectorAll('.field-section-header')]
  assert(sectionHeaders.length === 4, '4 Accordion / tab kelompok besar ter-render')
  assert(sectionHeaders[0].textContent.includes('Kebutuhan Dasar'), 'Accordion 1: Kebutuhan Dasar')
  assert(sectionHeaders[1].textContent.includes('Kebutuhan Finishing'), 'Accordion 2: Kebutuhan Finishing')
  assert(sectionHeaders[2].textContent.includes('Kebutuhan Aksesoris'), 'Accordion 3: Kebutuhan Aksesoris')
  assert(sectionHeaders[3].textContent.includes('Kebutuhan Produksi'), 'Accordion 4: Kebutuhan Produksi')

  // Check rows rendered
  const tableRows = [...doc.querySelectorAll('.field-item-row')]
  assert(tableRows.length > 50, `Baris item ter-render di dalam form (aktual: ${tableRows.length})`)

  // Check action button
  const btnReview = doc.querySelector('.btn-review-pr')
  assert(btnReview !== null, 'Tombol "Tinjau sebagai PR" ter-render')
}

// 3. CreateModal Mode Switch Tests
console.log('\n3. Verifikasi Mode Switch di CreateModal:')
{
  const dom = freshDom()
  const root = createRoot(dom.window.document.getElementById('app'))

  flushSync(() => root.render(React.createElement(CreateModal, {
    page: 'requests',
    initialMode: 'field-form',
    allProjects: MOCK_PROJECTS,
    allMaterials: MOCK_MATERIALS,
    allVendors: [],
    existingRequests: [],
    allRequestsFull: [],
    close: () => {}, refresh: () => {}, say: () => {}
  })))

  const doc = dom.window.document
  assert(doc.querySelector('.field-form-container') !== null, 'CreateModal dalam mode field-form merender FieldFormComponent')

  const switchStandardBtn = doc.querySelector('.btn-switch-mode')
  assert(switchStandardBtn !== null, 'Tombol beralih ke form standard tersedia')
}

console.log('\n--- SEMUA PENGUJIAN RENDER LULUS ---')
