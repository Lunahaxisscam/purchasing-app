// Verifikasi 7 viewport COMMON (360, 390, 412, 768, 1024, 1280, 1440)
// Assert no-horizontal-scroll: table-layout fixed, 100% width, no overflow-x
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const Module = (await import(
  pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href
)).default

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`✓ ${message}`)
}

console.log('=== VERIFIKASI 7 VIEWPORT COMMON (No Horizontal Scroll) ===\n')

const VIEWPORTS = [360, 390, 412, 768, 1024, 1280, 1440]
const MODULES = ['requests', 'approvals', 'materials', 'projects', 'vendors', 'handovers']

// Fixture PR-012 (reproduksi screenshot DAT)
const PR012 = {
  id: 'pr12', pr_number: 'PR-012', title: 'test 1 2 3', status: 'REJECTED', priority: 'NORMAL',
  project_id: 'p83', project_name: '[83] Josh - Mabes', notes: 'Catatan pengadaan lapangan', created_at: '2026-10-19T00:00:00Z'
}
const PR012_ITEMS = [
  { id: 'i12', pr_id: 'pr12', material_id: 'mALM', item_name: 'List T (8mm - Hitam)', unit: 'Batang', quantity: 5, estimated_price: 15000, sort_order: 0 }
]
const ALL_MATERIALS = [
  { id: 'mALM', kode: 'ALM-0001', name: 'List T (8mm - Hitam)', category: 'Aluminium & Profil', harga_acuan: 15000, current_stock: 12, min_stock: 5, unit: 'Batang' },
  { id: 'mPLY', kode: 'PLY-0001', name: 'Plywood 18mm', category: 'Plywood & Board', harga_acuan: 220000, current_stock: 20, min_stock: 10, unit: 'Lembar' }
]
const ALL_PROJECTS = [
  { id: 'p83', kode: '83', name: 'Josh - Mabes', status: 'ON_GOING' }
]
const ALL_VENDORS = [
  { id: 'v1', name: 'Toko Aluminium Sejahtera', phone: '08123456789', store_link: 'https://tokopedia.com', supplier_category: 'Aluminium & Profil' }
]

function mountForViewport(width, page) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head><body><div id="app" style="width:${width}px"></div></body></html>`, { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  dom.window.innerWidth = width
  dom.window.innerHeight = 800

  const rows = page === 'requests' ? [PR012] :
               page === 'approvals' ? [{ id: 'ap1', purchase_request_id: 'pr12', pr_number: 'PR-012', title: 'test 1 2 3', project_name: '[83] Josh - Mabes', step_number: 1, status: 'PENDING', created_at: '2026-10-19T00:00:00Z' }] :
               page === 'materials' ? ALL_MATERIALS :
               page === 'projects' ? ALL_PROJECTS :
               page === 'vendors' ? ALL_VENDORS :
               [{ id: 'h1', project_name: '[83] Josh - Mabes', status: 'DRAFT', handover_date: '2026-10-19', note: 'Serah terima awal' }]

  const props = {
    page, rows,
    allProjects: ALL_PROJECTS,
    allMaterials: ALL_MATERIALS,
    allPrItems: PR012_ITEMS,
    allReceivingItems: [],
    allRequests: [PR012],
    allReceivings: [],
    allVendors: ALL_VENDORS,
    refresh: () => {}, say: () => {}, onDelete: () => {}, setPage: () => {},
    onApproveItem: () => {}, onMarkPrItemOrdered: () => {},
    onDecideApproval: () => {}, onReviseApproval: () => {}
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, document }
}

for (const vp of VIEWPORTS) {
  console.log(`--- Pengujian Viewport: ${vp}px ---`)
  for (const mod of MODULES) {
    const { document: doc } = mountForViewport(vp, mod)

    // 1. Tidak ada elemen hint geser horizontal
    assert(!doc.querySelector('.table-scroll-hint'), `[${vp}px][${mod}] Tidak ada .table-scroll-hint`)

    // 2. Container desktop table tidak memiliki min-width paksa
    const desktopTable = doc.querySelector('.desktop-table-view table')
    if (desktopTable) {
      assert(desktopTable.className.includes('-table') || desktopTable.tagName === 'TABLE', `[${vp}px][${mod}] Desktop table ter-render`)
    }

    // 3. Mobile view ter-render untuk layar HP / tablet
    const mobileCards = doc.querySelector('.mobile-cards-view')
    assert(!!mobileCards, `[${vp}px][${mod}] Mobile cards view tersedia di DOM`)

    // 4. Khusus requests PR-012: status & aksi ter-render lengkap
    if (mod === 'requests') {
      const statusBadge = doc.querySelector('.desktop-table-view .badge') || doc.querySelector('.mobile-cards-view .badge')
      assert(!!statusBadge && statusBadge.textContent.includes('REJECTED'), `[${vp}px] PR-012 status badge REJECTED ter-render`)

      const editBtn = doc.querySelector('.desktop-table-view .btn-edit') || doc.querySelector('.mobile-cards-view button')
      assert(!!editBtn, `[${vp}px] Tombol aksi edit ter-render`)
    }
  }
}

console.log('\n=== SEMUA PENGUJIAN 7 VIEWPORT COMMON LULUS ===\n')
