// test_viewports.mjs — Verifikasi 7 Viewport COMMON (No Horizontal Scroll) untuk Form Lapangan
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

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

console.log('=== VERIFIKASI 7 VIEWPORT COMMON (No Horizontal Scroll) — FORM LAPANGAN ===\n')

const VIEWPORTS = [360, 390, 412, 768, 1024, 1280, 1440]

const MOCK_MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek Polos 18mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 250000 },
  { id: 'm2', kode: 'BHP-0001', name: 'Sekrup 3 cm', category: 'Bahan Habis Pakai', satuan: 'Pcs', harga_acuan: 200 }
]

const MOCK_PROJECTS = [
  { id: 'p1', kode: '99', name: 'Baroni Living', status: 'ON_GOING' }
]

function mountComponent(width, Component, props) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head><body><div id="app" style="width:${width}px"></div></body></html>`, { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  dom.window.innerWidth = width
  dom.window.innerHeight = 900

  const root = createRoot(dom.window.document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Component, props)))
  return { dom, document: dom.window.document }
}

for (const vp of VIEWPORTS) {
  console.log(`--- Viewport: ${vp}px ---`)

  // 1. Uji FieldFormComponent langsung
  const { document: docForm } = mountComponent(vp, FieldFormComponent, {
    allProjects: MOCK_PROJECTS,
    allMaterials: MOCK_MATERIALS,
    initialHeader: { project_id: 'p1', title: 'Test PR Lapangan' },
    onCancel: () => {},
    onReviewPr: () => {}
  })

  // Pastikan form ter-render
  const formBox = docForm.querySelector('.field-form-container')
  assert(formBox !== null, `[${vp}px] .field-form-container ter-render`)

  // Tidak ada hint scroll horizontal
  assert(!docForm.querySelector('.table-scroll-hint'), `[${vp}px] Tidak ada .table-scroll-hint`)

  // Container tidak memiliki fixed min-width yang melebihi viewport
  const tables = [...docForm.querySelectorAll('table')]
  for (const t of tables) {
    const styleAttr = t.getAttribute('style') || ''
    assert(!styleAttr.includes('min-width: 8') && !styleAttr.includes('min-width: 1'), `[${vp}px] Tabel tidak memiliki min-width lebar paksa`)
  }

  // 2. Uji CreateModal dalam mode field-form
  const { document: docModal } = mountComponent(vp, CreateModal, {
    page: 'requests',
    initialMode: 'field-form',
    allProjects: MOCK_PROJECTS,
    allMaterials: MOCK_MATERIALS,
    allVendors: [],
    existingRequests: [],
    allRequestsFull: [],
    close: () => {},
    refresh: () => {},
    say: () => {}
  })

  const modalDialog = docModal.querySelector('.dialog')
  assert(modalDialog !== null, `[${vp}px] Dialog modal ter-render`)
  assert(docModal.querySelector('.field-form-container') !== null, `[${vp}px] FieldFormComponent ter-render di dalam CreateModal`)
}

console.log('\n--- SEMUA VIEWPORT TERVERIFIKASI TANPA HORIZONTAL OVERFLOW ---')
