// ============================================================
// UJI CAPABILITY APPROVAL PER-ITEM (t_7634fa92)
// ============================================================
// Merender modul Approval ASLI (hasil kompilasi SWC) dengan React nyata di
// jsdom, membuka drawer detail, lalu memeriksa bahwa aksi per-item yang
// dulu hidup di panel perluasan tbody MASIH TERJANGKAU:
//
//   approveItem(prItem)       -> ✓ Setujui   (item PENDING)
//   markPrItemOrdered(prItem) -> 🛒 Sudah Order (item APPROVED, PR APPROVED)
//
// Klik tombol harus memanggil callback dengan ITEM YANG BENAR, dan gerbang
// izin tidak boleh longgar (PR REJECTED / item ORDERED tidak menampilkan
// tombol). Drawer juga tidak boleh menambah keputusan tingkat PR.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const REPO = process.argv[2] || path.dirname(path.dirname(process.cwd()))
const SB = process.cwd()
const require = createRequire(import.meta.url)
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}

// ---------- 1) DOM global ----------
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom0.window.navigator, configurable: true })
global.HTMLElement = dom0.window.HTMLElement
global.Node = dom0.window.Node
global.Event = dom0.window.Event
global.MouseEvent = dom0.window.MouseEvent
global.getComputedStyle = dom0.window.getComputedStyle
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// ---------- 2) Import ----------
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const mod = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const approvalsView = await mod('modules/approvals/view.mjs')
const { makeItemHelpers } = await mod('modules/shared/itemHelpers.mjs')

// ---------- 3) Data uji ----------
const MATERIALS = [
  { id: 'mPly', kode: 'PLY-0003', name: 'Plywood 18mm', category: 'Plywood & Board', satuan: 'Lembar' },
  { id: 'mHpl', kode: 'HPL-0001', name: 'HPL Cip', category: 'HPL & Edging', satuan: 'Lembar' }
]
const ITEMS_PENDING = [
  { id: 'i1', pr_id: 'pr7', material_id: 'mPly', kode: 'PLY-0003', item_name: 'Plywood 18mm', quantity: 5, unit: 'Lembar', estimated_price: 210000, status: 'PENDING_APPROVAL' },
  { id: 'i2', pr_id: 'pr7', material_id: 'mHpl', kode: 'HPL-0001', item_name: 'HPL Cip', quantity: 8, unit: 'Lembar', estimated_price: 120000, status: 'PENDING_APPROVAL' }
]
const ITEMS_APPROVED = ITEMS_PENDING.map(it => ({ ...it, status: 'APPROVED' }))

const H = makeItemHelpers({
  allPrItems: ITEMS_PENDING, allVendors: [], allMaterials: MATERIALS,
  allReceivingItems: [], allRequests: []
})
const H2 = makeItemHelpers({
  allPrItems: ITEMS_APPROVED, allVendors: [], allMaterials: MATERIALS,
  allReceivingItems: [], allRequests: []
})

function mount(jsx) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  global.HTMLElement = dom.window.HTMLElement
  global.Node = dom.window.Node
  global.Event = dom.window.Event
  global.MouseEvent = dom.window.MouseEvent
  global.getComputedStyle = dom.window.getComputedStyle
  const root = createRoot(document.getElementById('app'))
  // Render HARUS terjadi di sini (setelah document diganti ke dom baru),
  // karena createPortal menempel ke document.body saat render.
  act(() => { root.render(jsx) })
  return { dom, root }
}

const ctxBase = (over = {}) => ({
  page: 'approvals',
  title: 'Approval',
  setEditRow: () => {},
  onDelete: () => {},
  onDecideApproval: () => {},
  onReviseApproval: () => {},
  onApproveItem: () => {},
  onMarkPrItemOrdered: () => {},
  setExpandedAcuan: () => {},
  setAcuanForm: () => {},
  onAcuanSubmit: () => {},
  openAcuanForm: () => {},
  expandedAcuan: null,
  acuanEntries: () => [],
  acuanForm: {},
  acuanFormError: null,
  allMaterials: MATERIALS,
  allReceivings: [],
  allRequests: [],
  allPrItems: ITEMS_PENDING,
  allVendors: [],
  allReceivingItems: [],
  H,
  ...over
})

// Render modul lengkap (desktop + drawer) untuk satu baris approval.
async function renderApproval({ status = 'PENDING', H: Hh = H, items = ITEMS_PENDING, over = {} } = {}) {
  const row = {
    id: 'ap7', pr_number: 'PR-007', title: 'Meja Display', project_name: '[100] Store',
    purchase_request_id: 'pr7', step_number: 1, status, note: null, decided_at: null
  }
  const calls = { approve: [], order: [], decide: [], revise: [] }
  const ctx = ctxBase({
    rows: [row],
    H: Hh,
    allPrItems: items,
    approvalDetailId: 'ap7',                 // drawer langsung terbuka
    setApprovalDetailId: () => {},
    onApproveItem: (it) => calls.approve.push(it),
    onMarkPrItemOrdered: (it) => calls.order.push(it),
    onDecideApproval: (r, d) => calls.decide.push(d),
    onReviseApproval: () => calls.revise.push(1),
    ...over
  })
  // desktopRow memberi kolom; gunakan jumlah kolom compact (5) + Aksi.
  const columns = ['pr_number', 'project_name', 'title', 'step_number', 'status']
  const fullCtx = { ...ctx, columns, H: Hh }
  // PENTING: receiptForm() memanggil createPortal(..., document.body), jadi ia
  // HARUS dievaluasi SAAT RENDER (di dalam komponen), bukan saat menyusun
  // element tree — kalau tidak, portal menempel ke document sebelum jsdom
  // diganti oleh mount() dan drawer tidak akan pernah muncul.
  function Harness() {
    return React.createElement('div', null,
      React.createElement('div', { className: 'desktop-table-view' },
        React.createElement('table', null,
          React.createElement('tbody', null, approvalsView.desktopRow(row, fullCtx))
        )
      ),
      approvalsView.receiptForm(fullCtx)
    )
  }
  const { dom, root } = mount(React.createElement(Harness))
  await act(async () => {})
  return { dom, root, calls }
}

// ============================================================
// A. Item PENDING -> tombol "✓ Setujui" ada & memanggil callback
// ============================================================
console.log('\nA. Item PENDING — tombol "✓ Setujui" terjangkau dari drawer')
{
  const { dom, root, calls } = await renderApproval({ status: 'PENDING' })
  const dialog = dom.window.document.querySelector('[role="dialog"]')
  check('drawer detail terbuka (role=dialog)', !!dialog)
  const txt = dialog ? (dialog.textContent || '') : ''
  check('drawer memuat rincian material (PLY-0003 & HPL-0001)',
    txt.includes('PLY-0003') && txt.includes('HPL-0001'), txt.slice(0, 160))

  const approveBtns = dialog
    ? [...dialog.querySelectorAll('button')].filter(b => (b.textContent || '').includes('Setujui'))
    : []
  check('tombol per-item "✓ Setujui" ADA di drawer (2 item PENDING)', approveBtns.length === 2, `n=${approveBtns.length}`)

  if (approveBtns.length) {
    await act(async () => {
      approveBtns[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }
  check('klik memanggil onApproveItem tepat 1x', calls.approve.length === 1, `n=${calls.approve.length}`)
  const sent = calls.approve[0]
  check('payload item utuh (id/kode/nama/quantity)',
    !!sent && sent.id === 'i1' && sent.kode === 'PLY-0003' && sent.item_name === 'Plywood 18mm' && Number(sent.quantity) === 5,
    JSON.stringify(sent || null))
  check('drawer TIDAK menambah keputusan tingkat PR (Setujui/Tolak/Revisi PR tidak dipanggil)',
    calls.decide.length === 0 && calls.revise.length === 0)
  check('drawer tidak menampilkan tombol Tolak/Revisi tingkat PR',
    !txt.includes('✕ Tolak') && !txt.includes('✎ Revisi'))

  await act(async () => { root.unmount() })
}

// ============================================================
// B. Item APPROVED + PR APPROVED -> tombol "🛒 Sudah Order"
// ============================================================
console.log('\nB. Item APPROVED & PR APPROVED — tombol "🛒 Sudah Order" terjangkau')
{
  const { dom, root, calls } = await renderApproval({
    status: 'APPROVED', H: H2, items: ITEMS_APPROVED
  })
  const dialog = dom.window.document.querySelector('[role="dialog"]')
  const txt = dialog ? (dialog.textContent || '') : ''
  const orderBtns = dialog
    ? [...dialog.querySelectorAll('button')].filter(b => (b.textContent || '').includes('Sudah Order'))
    : []
  check('tombol "🛒 Sudah Order" ADA (2 item APPROVED)', orderBtns.length === 2, `n=${orderBtns.length}`)
  check('tombol "✓ Setujui" TIDAK tampil lagi (item sudah APPROVED)', !txt.includes('✓ Setujui'))

  if (orderBtns.length) {
    await act(async () => {
      orderBtns[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    })
  }
  check('klik memanggil onMarkPrItemOrdered tepat 1x', calls.order.length === 1, `n=${calls.order.length}`)
  check('payload item kedua yang dikirim (HPL-0001)',
    !!calls.order[0] && calls.order[0].id === 'i2' && calls.order[0].kode === 'HPL-0001',
    JSON.stringify(calls.order[0] || null))

  await act(async () => { root.unmount() })
}

// ============================================================
// C. Gerbang izin TIDAK longgar
// ============================================================
console.log('\nC. Gerbang izin — PR REJECTED tidak boleh menampilkan aksi item')
{
  const { dom, root, calls } = await renderApproval({ status: 'REJECTED' })
  const dialog = dom.window.document.querySelector('[role="dialog"]')
  const txt = dialog ? (dialog.textContent || '') : ''
  const btns = dialog
    ? [...dialog.querySelectorAll('button')].filter(b =>
      (b.textContent || '').includes('Setujui') || (b.textContent || '').includes('Sudah Order'))
    : []
  check('PR REJECTED: nol tombol aksi per-item', btns.length === 0, `n=${btns.length}`)
  check('rincian item tetap bisa dibaca (tidak menyembunyikan data)',
    txt.includes('PLY-0003') && txt.includes('HPL-0001'))
  await act(async () => { root.unmount() })
}
{
  // Item ORDERED -> tampil sebagai status, bukan tombol yang bisa diklik lagi.
  const itemsOrdered = ITEMS_APPROVED.map(it => ({ ...it, status: 'ORDERED' }))
  const H3 = makeItemHelpers({
    allPrItems: itemsOrdered, allVendors: [], allMaterials: MATERIALS,
    allReceivingItems: [], allRequests: []
  })
  const { dom, root } = await renderApproval({ status: 'APPROVED', H: H3, items: itemsOrdered })
  const dialog = dom.window.document.querySelector('[role="dialog"]')
  const btns = dialog
    ? [...dialog.querySelectorAll('button')].filter(b => (b.textContent || '').includes('Sudah Order'))
    : []
  check('item ORDERED: tidak ada tombol "Sudah Order" lagi', btns.length === 0, `n=${btns.length}`)
  check('item ORDERED tetap menampilkan status "✓ Sudah Order"',
    !!dialog && (dialog.textContent || '').includes('✓ Sudah Order'))
  await act(async () => { root.unmount() })
}

// ============================================================
// D. Panel lama rowExpand tidak lagi jalur utama — tapi tetap konsisten
// ============================================================
console.log('\nD. Satu jangkar saja — tidak ada panel dobel')
{
  const { dom, root } = await renderApproval({ status: 'PENDING' })
  const doc = dom.window.document
  const dialog = doc.querySelector('[role="dialog"]')
  // Drawer memakai .ap-group-heading per kategori (bukan .ap-group-block —
  // kelas itu milik panel perluasan tbody yang kini tidak dirender).
  const heads = dialog ? dialog.querySelectorAll('.ap-group-heading').length : 0
  check('grup material di drawer dirender SEKALI per kategori (2)', heads === 2, `n=${heads}`)
  check('hanya SATU drawer terbuka', doc.querySelectorAll('[role="dialog"]').length === 1)
  // Panel perluasan tbody lama tidak boleh ikut dirender (satu jangkar saja).
  check('panel perluasan tbody lama TIDAK dirender (tidak ada panel dobel)',
    doc.querySelectorAll('.ap-group-block').length === 0,
    `n=${doc.querySelectorAll('.ap-group-block').length}`)
  await act(async () => { root.unmount() })
}

console.log(`\n=== HASIL: ${pass} ok, ${fail} FAIL ===`)
if (failures.length) console.log('GAGAL: ' + failures.join(' ; '))
process.exit(fail ? 1 : 0)
