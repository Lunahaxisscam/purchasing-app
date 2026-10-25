// Test sinkronisasi estimasi harga PR & Approval (t_d0cc2c16 — arahan DAT)
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// Setup jsdom environment
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const { effectiveEstimatePriceOf, prEstimateRows, materialMapFrom } = await import(
  pathToFileURL(path.join(SB, 'dist/modules/requests/view.mjs')).href
)
const { makeItemHelpers } = await import(
  pathToFileURL(path.join(SB, 'dist/modules/shared/itemHelpers.mjs')).href
)
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

console.log('=== UNIT & REGRESSION: Estimasi Harga PR (Fixture PR-002 & Edge Cases) ===\n')

// 1. Fixture PR-002 DAT: qty 1: 55.500, qty 1: unknown, qty 1: 75.000
const mat1 = { id: 'm1', name: 'DTSM DoubleTrack (50cm - Huben)', harga_acuan: 55500, category: 'Hardware & Fitting' }
const mat2 = { id: 'm2', name: 'Rak Sendok (Uk. Pintu 70cm - Abu)', harga_acuan: null, category: 'Hardware & Fitting' }
const mat3 = { id: 'm3', name: 'Trafo (5A - Yamasaki)', harga_acuan: 75000, category: 'Kelistrikan & Lampu' }
const allMaterials = [mat1, mat2, mat3]
const matMap = materialMapFrom(allMaterials)

const pr002Items = [
  { id: 'i1', pr_id: 'pr2', material_id: 'm1', quantity: 1, estimated_price: null, item_name: mat1.name, unit: 'Pasang' },
  { id: 'i2', pr_id: 'pr2', material_id: 'm2', quantity: 1, estimated_price: null, item_name: mat2.name, unit: 'Pcs' },
  { id: 'i3', pr_id: 'pr2', material_id: 'm3', quantity: 1, estimated_price: null, item_name: mat3.name, unit: 'Pcs' }
]

const est002 = prEstimateRows(pr002Items, matMap)
assert(est002.total === 130500, `PR-002 total = 130.500 (dapat: ${est002.total})`)
assert(est002.unknown === 1, `PR-002 unknown count = 1 (dapat: ${est002.unknown})`)
assert(!est002.complete, 'PR-002 complete = false (karena 1 item belum ada harga)')
assert(est002.hasItems, 'PR-002 hasItems = true')

// 2. Periksa effectiveEstimatePriceOf per item
assert(effectiveEstimatePriceOf(pr002Items[0], matMap) === 55500, 'Item 1 harga acuan master dipakai jika snapshot null')
assert(effectiveEstimatePriceOf(pr002Items[1], matMap) === null, 'Item 2 tanpa snapshot & tanpa master harga_acuan = null (bukan 0)')
assert(effectiveEstimatePriceOf(pr002Items[2], matMap) === 75000, 'Item 3 harga acuan master dipakai jika snapshot null')

// 3. Saved snapshot takes precedence over master (saved snapshot valid jangan ditimpa masterlatest)
const itemSaved = { id: 'i4', material_id: 'm1', quantity: 2, estimated_price: 60000 }
assert(effectiveEstimatePriceOf(itemSaved, matMap) === 60000, 'Saved snapshot 60.000 tidak ditimpa master 55.500')

// 4. Test Qty > 1: subtotal = unit_price * qty
const prMultiQty = [
  { id: 'i1', material_id: 'm1', quantity: 3, estimated_price: 55500 }, // 3 * 55500 = 166500
  { id: 'i2', material_id: 'm3', quantity: 2, estimated_price: 75000 }  // 2 * 75000 = 150000
]
const estMulti = prEstimateRows(prMultiQty, matMap)
assert(estMulti.total === 316500, `Multi qty total = 316.500 (dapat: ${estMulti.total})`)
assert(estMulti.unknown === 0, 'Multi qty unknown = 0')
assert(estMulti.complete === true, 'Multi qty complete = true')

// 5. Test decimal qty (mis. 1.5 Lembar)
const prDecimalQty = [
  { id: 'i1', material_id: 'm1', quantity: 1.5, estimated_price: 50000 }
]
const estDecimal = prEstimateRows(prDecimalQty, matMap)
assert(estDecimal.total === 75000, `Decimal qty 1.5 * 50.000 = 75.000 (dapat: ${estDecimal.total})`)

// 6. Test negative / nonnumeric / null price & qty: NOT 0, counted as unknown
const prInvalid = [
  { id: 'inv1', material_id: 'm1', quantity: 1, estimated_price: -5000 },
  { id: 'inv2', material_id: 'm1', quantity: 1, estimated_price: 'bukan-angka' },
  { id: 'inv3', material_id: 'm1', quantity: -2, estimated_price: 55500 },
  { id: 'inv4', material_id: 'm1', quantity: 0, estimated_price: 55500 },
  { id: 'inv5', material_id: 'm1', quantity: null, estimated_price: 55500 }
]
const estInvalid = prEstimateRows(prInvalid, matMap)
assert(estInvalid.total === 0, 'Invalid items total = 0')
assert(estInvalid.unknown === 5, `Semua 5 invalid items dihitung unknown (dapat: ${estInvalid.unknown})`)

// 7. Make sure makeItemHelpers requestItemRows also calculates matching subtotal & estPrice
const H = makeItemHelpers({
  allPrItems: pr002Items,
  allMaterials
})
const rows002 = H.requestItemRows({ id: 'pr2' })
assert(rows002.length === 3, 'H.requestItemRows menghasilkan 3 baris')
assert(rows002[0].estPrice === 55500 && rows002[0].savedSubtotal === 55500, 'Row 0: estPrice 55.500, subtotal 55.500')
assert(rows002[1].estPrice === null && rows002[1].savedSubtotal === null, 'Row 1: estPrice null, subtotal null')
assert(rows002[2].estPrice === 75000 && rows002[2].savedSubtotal === 75000, 'Row 2: estPrice 75.000, subtotal 75.000')

console.log('\n=== RENDER TEST: PR-002 Desktop & Mobile UI (ModuleView Asli) ===\n')

const PR002_ROW = {
  id: 'pr2', pr_number: 'PR-002', title: 'Kitchen Set', status: 'DRAFT', priority: 'NORMAL',
  project_id: 'p103', project_name: '[103] Susy - Verdi Barat', notes: '', created_at: '2026-10-12T00:00:00Z'
}
const PROJECTS = [{ id: 'p103', kode: '103', name: 'Susy - Verdi Barat', status: 'ON_GOING' }]

function mount(page, rows, extra = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch {}

  const props = {
    page, rows,
    allProjects: PROJECTS, allMaterials,
    allPrItems: extra.prItems || pr002Items,
    allReceivingItems: [],
    allRequests: rows,
    allReceivings: [], allVendors: [],
    refresh: () => {}, say: () => {}, onDelete: () => {}, setPage: () => {},
    onApproveItem: () => {}, onMarkPrItemOrdered: () => {},
    onDecideApproval: () => {}, onReviseApproval: () => {}
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, root, document }
}

const { document: docPr } = mount('requests', [PR002_ROW])

// A. Desktop Table PR-002 verification
const desktopTable = docPr.querySelector('.desktop-table-view')
assert(!!desktopTable, 'Desktop table view PR ter-render')

// Verify line items
const itemPrices = [...docPr.querySelectorAll('.desktop-table-view td.pr-item-price')].map(td => td.textContent.trim())
assert(itemPrices.length === 3, `Ada 3 baris harga item (dapat: ${itemPrices.length})`)
assert(itemPrices[0].includes('55.500'), `Item 1 harga 55.500 tampil (dapat: ${itemPrices[0]})`)
assert(itemPrices[1] === '—', `Item 2 tanpa harga tampil dash (dapat: ${itemPrices[1]})`)
assert(itemPrices[2].includes('75.000'), `Item 3 harga 75.000 tampil (dapat: ${itemPrices[2]})`)

// Verify footer summary: Total 130.500, unknown 1 (BUKAN Rp 0 dan 3 item unknown!)
const totalText = docPr.querySelector('tr.pr-est-total-row')?.textContent || ''
assert(totalText.includes('130.500'), `Footer Total Estimasi memuat 130.500 (dapat: ${totalText})`)
assert(totalText.includes('1 item belum ada harga'), `Footer memuat "1 item belum ada harga" (dapat: ${totalText})`)
assert(!totalText.includes('Rp 0'), 'Footer TIDAK memuat Rp 0 bug lama')

// B. Mobile Card PR-002 verification
const mobileView = docPr.querySelector('.mobile-cards-view')
assert(!!mobileView, 'Mobile cards view PR ter-render')
const mobileCardText = mobileView.textContent
assert(mobileCardText.includes('55.500'), 'Mobile card memuat 55.500')
assert(mobileCardText.includes('belum ada harga'), 'Mobile card memuat "belum ada harga"')
assert(mobileCardText.includes('75.000'), 'Mobile card memuat 75.000')
assert(mobileCardText.includes('130.500'), 'Mobile card footer memuat 130.500')
assert(mobileCardText.includes('1 item belum ada harga'), 'Mobile card footer memuat "1 item belum ada harga"')

console.log('\n=== RENDER TEST: Approval Centered Dialog & Escape/Backdrop ===\n')

const APPROVAL_ROW = {
  id: 'ap1', purchase_request_id: 'pr2', pr_number: 'PR-002', title: 'Kitchen Set',
  project_name: '[103] Susy - Verdi Barat', step_number: 1, status: 'PENDING',
  created_at: '2026-10-12T00:00:00Z'
}

const { document: docAp } = mount('approvals', [APPROVAL_ROW], { requests: [PR002_ROW] })

// Click "≡ Rincian" to open dialog
const rincianBtn = docAp.querySelector('button.btn-edit') || [...docAp.querySelectorAll('button')].find(b => b.textContent.includes('Rincian'))
assert(!!rincianBtn, 'Tombol ≡ Rincian ada di baris Approval')

flushSync(() => {
  rincianBtn.click()
})

const dialog = docAp.querySelector('div[role="dialog"]')
assert(!!dialog, 'Dialog detail approval berhasil terbuka')

// Check dialog parent overlay (centered positioning, NOT flex-end)
const overlay = dialog.parentElement
assert(overlay.style.justifyContent === 'center', `Overlay justifyContent = center (dapat: ${overlay.style.justifyContent})`)
assert(overlay.style.alignItems === 'center', `Overlay alignItems = center (dapat: ${overlay.style.alignItems})`)
assert(dialog.style.overflowY === 'auto', 'Dialog overflowY = auto (vertical scroll internal)')
assert(dialog.style.overflowX === 'hidden', 'Dialog overflowX = hidden (anti horizontal scroll)')

// Verify dialog contents
const dialogText = dialog.textContent
assert(dialogText.includes('PR-002'), 'Dialog memuat PR-002')
assert(dialogText.includes('130.500'), `Dialog memuat Total Estimasi 130.500 (dapat: ${dialogText.match(/Total Estimasi[^)]+\)/)?.[0] || 'tidak ketemu'})`)
assert(dialogText.includes('1 item belum ada harga'), 'Dialog memuat "1 item belum ada harga"')

// Test Escape key closes dialog
const escEvent = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
flushSync(() => {
  window.dispatchEvent(escEvent)
})
assert(!docAp.querySelector('div[role="dialog"]'), 'Menekan tombol Escape berhasil menutup dialog')

console.log('\n=== SEMUA 27 ASSERTION REGRESI PR-002 & APPROVAL DIALOG LULUS ===\n')
