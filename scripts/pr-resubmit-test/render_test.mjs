// ============================================================
// UJI RENDER TOMBOL 'SUBMIT ULANG' PR REJECTED (t_3032ecb7)
// ============================================================
// Menguji tampilan tombol pada modul Request (view.jsx hasil kompilasi SWC):
// 1. desktopRow merender 'Submit Ulang' saat status REJECTED
// 2. rowActions merender 'Submit Ulang' saat status REJECTED
// 3. mobileCard merender 'Submit Ulang' saat status REJECTED
// 4. Klik tombol memanggil onFinishPr(r)
// 5. Status DRAFT & REVISI tetap menampilkan '✓ Selesai'
// 6. Status SUBMITTED, APPROVED, ORDERED tidak menampilkan tombol finish/resubmit
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const require = createRequire(import.meta.url)
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ✗ FAIL ${name} ${extra}`)
  }
}

// 1. DOM Global
const dom0 = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom0.window.navigator, configurable: true })
global.HTMLElement = dom0.window.HTMLElement
global.Node = dom0.window.Node
global.Event = dom0.window.Event
global.MouseEvent = dom0.window.MouseEvent
global.getComputedStyle = dom0.window.getComputedStyle
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const mod = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const reqView = await mod('modules/requests/view.mjs')
const { makeItemHelpers } = await mod('modules/shared/itemHelpers.mjs')

// 2. Fixtures PR
const MATERIALS = [
  { id: 'm1', kode: 'ALU-001', name: 'List T (8mm - Hitam)', category: 'Aluminium & Profil', satuan: 'Batang' }
]

const PR_ITEMS_012 = [
  { id: 'pi1', pr_id: 'pr-012', material_id: 'm1', kode: 'ALU-001', item_name: 'List T (8mm - Hitam)', quantity: 5, unit: 'Batang', estimated_price: 15000, status: 'REJECTED' }
]

const H = makeItemHelpers({
  allPrItems: PR_ITEMS_012,
  allVendors: [],
  allMaterials: MATERIALS,
  allReceivingItems: [],
  allRequests: []
})

const prRejected = {
  id: 'pr-012',
  pr_number: 'PR-012',
  project_name: '[83] Josh - Mabes',
  project_id: 'proj-83',
  title: 'test 1 2 3',
  priority: 'NORMAL',
  status: 'REJECTED',
  created_at: '2026-10-19T10:00:00Z',
  notes: 'Ditolak karena spesifikasi belum lengkap'
}

const prDraft = { ...prRejected, id: 'pr-draft', pr_number: 'PR-013', status: 'DRAFT' }
const prRevisi = { ...prRejected, id: 'pr-revisi', pr_number: 'PR-014', status: 'REVISI' }
const prSubmitted = { ...prRejected, id: 'pr-sub', pr_number: 'PR-015', status: 'SUBMITTED' }
const prApproved = { ...prRejected, id: 'pr-app', pr_number: 'PR-016', status: 'APPROVED' }
const prOrdered = { ...prRejected, id: 'pr-ord', pr_number: 'PR-017', status: 'ORDERED' }

function renderInto(jsx) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(jsx)
  })
  return {
    container,
    cleanup() {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
  }
}

console.log('=== PENGUJIAN RENDER: TOMBOL SUBMIT ULANG PR-012 REJECTED ===')

// Test 1: desktopRow renders Submit Ulang on REJECTED
{
  let calledPr = null
  const ctx = {
    H,
    title: 'Purchase Request',
    page: 'requests',
    setEditRow: () => {},
    onFinishPr: (r) => { calledPr = r },
    onDelete: () => {},
    openNoteId: null,
    setOpenNoteId: () => {},
    allMaterials: MATERIALS
  }

  const { container, cleanup } = renderInto(
    React.createElement('table', null, React.createElement('tbody', null, reqView.desktopRow(prRejected, ctx)))
  )

  const buttons = Array.from(container.querySelectorAll('button'))
  const resubmitBtn = buttons.find(b => b.textContent.includes('Submit Ulang'))
  check('desktopRow merender tombol Submit Ulang untuk PR REJECTED', !!resubmitBtn, `Ditemukan: ${buttons.map(b => b.textContent.trim()).join(', ')}`)

  if (resubmitBtn) {
    check('desktopRow tombol Submit Ulang memiliki class btn-finish', resubmitBtn.classList.contains('btn-finish'))
    act(() => {
      resubmitBtn.click()
    })
    check('desktopRow klik tombol Submit Ulang memanggil onFinishPr dengan PR-012', calledPr && calledPr.id === 'pr-012')
  } else {
    check('desktopRow tombol Submit Ulang memiliki class btn-finish', false, 'Tombol tidak ada')
    check('desktopRow klik tombol Submit Ulang memanggil onFinishPr dengan PR-012', false, 'Tombol tidak ada')
  }
  cleanup()
}

// Test 2: rowActions renders Submit Ulang on REJECTED
{
  let calledPr = null
  const ctx = {
    title: 'Purchase Request',
    page: 'requests',
    setEditRow: () => {},
    onFinishPr: (r) => { calledPr = r },
    onDelete: () => {}
  }

  const { container, cleanup } = renderInto(
    React.createElement('table', null, React.createElement('tbody', null, React.createElement('tr', null, reqView.rowActions(prRejected, ctx))))
  )

  const buttons = Array.from(container.querySelectorAll('button'))
  const resubmitBtn = buttons.find(b => b.textContent.includes('Submit Ulang'))
  check('rowActions merender tombol Submit Ulang untuk PR REJECTED', !!resubmitBtn, `Ditemukan: ${buttons.map(b => b.textContent.trim()).join(', ')}`)

  if (resubmitBtn) {
    act(() => {
      resubmitBtn.click()
    })
    check('rowActions klik tombol Submit Ulang memanggil onFinishPr', calledPr && calledPr.id === 'pr-012')
  } else {
    check('rowActions klik tombol Submit Ulang memanggil onFinishPr', false, 'Tombol tidak ada')
  }
  cleanup()
}

// Test 3: mobileCard renders Submit Ulang on REJECTED
{
  let calledPr = null
  const ctx = {
    H,
    page: 'requests',
    setEditRow: () => {},
    onFinishPr: (r) => { calledPr = r },
    onDelete: () => {},
    allMaterials: MATERIALS
  }

  const { container, cleanup } = renderInto(
    React.createElement('div', { className: 'mobile-card' }, reqView.mobileCard(prRejected, ctx))
  )

  const buttons = Array.from(container.querySelectorAll('button'))
  const resubmitBtn = buttons.find(b => b.textContent.includes('Submit Ulang'))
  check('mobileCard merender tombol Submit Ulang untuk PR REJECTED', !!resubmitBtn, `Ditemukan: ${buttons.map(b => b.textContent.trim()).join(', ')}`)

  if (resubmitBtn) {
    check('mobileCard tombol Submit Ulang memiliki class btn-finish', resubmitBtn.classList.contains('btn-finish'))
    act(() => {
      resubmitBtn.click()
    })
    check('mobileCard klik tombol Submit Ulang memanggil onFinishPr', calledPr && calledPr.id === 'pr-012')
  } else {
    check('mobileCard tombol Submit Ulang memiliki class btn-finish', false, 'Tombol tidak ada')
    check('mobileCard klik tombol Submit Ulang memanggil onFinishPr', false, 'Tombol tidak ada')
  }
  cleanup()
}

// Test 4: Existing DRAFT & REVISI tetap menampilkan ✓ Selesai
{
  const ctx = {
    H,
    title: 'Purchase Request',
    page: 'requests',
    setEditRow: () => {},
    onFinishPr: () => {},
    onDelete: () => {},
    openNoteId: null,
    setOpenNoteId: () => {},
    allMaterials: MATERIALS
  }

  const { container: cDraft, cleanup: clDraft } = renderInto(
    React.createElement('table', null, React.createElement('tbody', null, reqView.desktopRow(prDraft, ctx)))
  )
  const draftBtns = Array.from(cDraft.querySelectorAll('button'))
  check('PR DRAFT tetap merender tombol ✓ Selesai', draftBtns.some(b => b.textContent.includes('Selesai')))
  clDraft()

  const { container: cRevisi, cleanup: clRevisi } = renderInto(
    React.createElement('table', null, React.createElement('tbody', null, reqView.desktopRow(prRevisi, ctx)))
  )
  const revisiBtns = Array.from(cRevisi.querySelectorAll('button'))
  check('PR REVISI tetap merender tombol ✓ Selesai', revisiBtns.some(b => b.textContent.includes('Selesai')))
  clRevisi()
}

// Test 5: Status SUBMITTED, APPROVED, ORDERED TIDAK ditawari finish / resubmit
{
  const ctx = {
    H,
    title: 'Purchase Request',
    page: 'requests',
    setEditRow: () => {},
    onFinishPr: () => {},
    onDelete: () => {},
    openNoteId: null,
    setOpenNoteId: () => {},
    allMaterials: MATERIALS
  }

  for (const pr of [prSubmitted, prApproved, prOrdered]) {
    const { container, cleanup } = renderInto(
      React.createElement('table', null, React.createElement('tbody', null, reqView.desktopRow(pr, ctx)))
    )
    const btns = Array.from(container.querySelectorAll('button'))
    const hasFinishOrResubmit = btns.some(b => b.textContent.includes('Selesai') || b.textContent.includes('Submit Ulang'))
    check(`PR ${pr.status} TIDAK menampilkan tombol Selesai/Submit Ulang`, !hasFinishOrResubmit)
    cleanup()
  }
}

console.log(`\nHASIL RENDER TEST: ${pass} lulus, ${fail} gagal`)
if (fail > 0) {
  process.exit(1)
}
