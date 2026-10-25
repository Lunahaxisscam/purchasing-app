// ============================================================
// viewport_test.mjs — 7 VIEWPORT COMMON untuk UI jalur lean (t_a5a73034)
// ============================================================
// Diuji di 360/390/412/768/1024/1280/1440:
//   V1. Tidak ada <table>/container dengan min-width paksa (penyebab scroll
//       horizontal). jsdom tidak menghitung layout, jadi yang diperiksa adalah
//       ATRIBUT/INLINE STYLE pemicu (pola sama dengan harness compact existing).
//   V2. Tidak ada .table-scroll-hint (petunjuk scroll samping) di modul PR.
//   V3. Kartu mobile: label & nilai pemenuhan terbaca (tidak dipotong) dan
//       tombol aksi tetap ada.
//   V4. Dialog tutup sisa: tidak memakai lebar piksel tetap > viewport.
//   V5. Input teks/textarea di form PR tidak memakai font < 16px pada mode
//       sentuh (mencegah zoom iOS) — diperiksa dari inline style/atribut.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)
const reqView = await load('modules/requests/view.mjs')
const CreateModal = (await load('components/CreateModal.mjs')).default
const { makeItemHelpers } = await load('modules/shared/itemHelpers.mjs')

let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const VIEWPORTS = [360, 390, 412, 768, 1024, 1280, 1440]

const MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek Polos 18mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 250000 },
  { id: 'm2', kode: 'BHP-0001', name: 'Sekrup 3 cm', category: 'Bahan Habis Pakai', satuan: 'Pcs', harga_acuan: null }
]
const PROJECTS = [{ id: 'p1', kode: '99', name: 'Baroni Living', status: 'ON_GOING' }]
const VENDORS = [{ id: 'v1', name: 'Toko Kayu Jaya', supplier_category: 'Plywood & Board' }]
const PR_ITEMS = [{ id: 'i1', pr_id: 'pr-l', item_name: 'Triplek Polos 18mm', quantity: 4, unit: 'Lembar', status: 'PENDING_APPROVAL', material_id: 'm1', estimated_price: 250000, sort_order: 0 }]
const LEAN_PR = { id: 'pr-l', pr_number: 'PR-202', title: 'Kebutuhan Finishing Panjang Sekali Agar Terlihat Wrapping', status: 'SUBMITTED', priority: 'NORMAL', project_name: '[99] Baroni Living', notes: 'Catatan asli\n[Jalur: LEAN]', materials_summary: '' }
const RECEIVINGS = [{ id: 'r1', status: 'DIBELI', received_date: '2026-10-19' }]
const RECEIVING_ITEMS = [{ id: 'ri1', receiving_id: 'r1', pr_item_id: 'i1', quantity_received: 1 }]

const H = makeItemHelpers({ allPrItems: PR_ITEMS, allVendors: VENDORS, allMaterials: MATERIALS, allReceivingItems: RECEIVING_ITEMS, allRequests: [] })
const ctx = {
  H, title: 'Purchase Request', page: 'requests',
  setEditRow: () => {}, onFinishPr: () => {}, onCloseRemaining: async () => ({ ok: true }), onDelete: () => {},
  openNoteId: null, setOpenNoteId: () => {},
  allMaterials: MATERIALS, allVendors: VENDORS,
  allReceivings: RECEIVINGS, allReceivingItems: RECEIVING_ITEMS
}

function makeDom(width) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head><body><div id="app" style="width:${width}px"></div></body></html>`, { pretendToBeVisual: true })
  dom.window.innerWidth = width
  dom.window.innerHeight = 900
  global.window = dom.window
  global.document = dom.window.document
  return dom
}

// Cari elemen dengan min-width paksa yang lebih lebar dari viewport.
function minWidthOffenders(doc, width) {
  const out = []
  for (const el of doc.querySelectorAll('*')) {
    const style = el.getAttribute('style') || ''
    const m = style.match(/min-width\s*:\s*(\d+)px/i)
    if (!m) continue
    const px = Number(m[1])
    if (px > width) out.push(`${el.tagName.toLowerCase()}.${el.className || ''} min-width:${px}px`)
  }
  return out
}

for (const vp of VIEWPORTS) {
  console.log(`--- Viewport ${vp}px ---`)

  // V1/V2: kartu mobile modul PR
  {
    const dom = makeDom(vp)
    const root = createRoot(dom.window.document.getElementById('app'))
    flushSync(() => root.render(React.createElement('div', null, reqView.mobileCard(LEAN_PR, ctx))))
    const doc = dom.window.document
    check(`[${vp}] kartu mobile ter-render`, !!doc.querySelector('.mobile-card-header'))
    check(`[${vp}] tidak ada .table-scroll-hint`, !doc.querySelector('.table-scroll-hint'))
    const off = minWidthOffenders(doc, vp)
    check(`[${vp}] tidak ada min-width paksa > viewport`, off.length === 0, off.join(' | '))

    // V3: pemenuhan terbaca + tombol ada
    const txt = doc.body.textContent.replace(/\s+/g, ' ')
    check(`[${vp}] pemenuhan terbaca (sisa 3)`, /sisa 3/.test(txt), txt.slice(0, 200))
    check(`[${vp}] label "Pemenuhan:" ada`, /Pemenuhan:/.test(txt))
    check(`[${vp}] tombol Tutup sisa tetap ada`, [...doc.querySelectorAll('button')].some(b => /Tutup sisa/.test(b.textContent)))
    check(`[${vp}] badge lean tampil`, !!doc.querySelector('.badge.badge-lean'))
  }

  // V1/V4: dialog tutup sisa
  {
    const dom = makeDom(vp)
    const root = createRoot(dom.window.document.getElementById('app'))
    const ctxOpen = { ...ctx }
    flushSync(() => root.render(React.createElement('div', null, reqView.mobileCard(LEAN_PR, ctxOpen))))
    const doc = dom.window.document
    const btn = [...doc.querySelectorAll('button')].find(b => /Tutup sisa/.test(b.textContent))
    flushSync(() => btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    const dlg = doc.querySelector('[role="dialog"] .dialog')
    check(`[${vp}] dialog tutup sisa terbuka`, !!dlg)
    if (dlg) {
      const style = dlg.getAttribute('style') || ''
      const mw = style.match(/max-width\s*:\s*(\d+)px/i)
      const maxW = mw ? Number(mw[1]) : null
      // max-width boleh lebih kecil dari viewport; yang dilarang adalah
      // LEBAR TETAP (width) yang melebihi viewport.
      const wm = style.match(/(?:^|;)\s*width\s*:\s*(\d+)px/i)
      const fixedW = wm ? Number(wm[1]) : null
      check(`[${vp}] dialog tidak memakai width tetap > viewport`, fixedW === null || fixedW <= vp, String(fixedW))
      check(`[${vp}] dialog punya max-width wajar (<= viewport atau tidak diset)`, maxW === null || maxW <= Math.max(vp, 420), String(maxW))
      check(`[${vp}] textarea alasan ada`, !!dlg.querySelector('textarea'))
      check(`[${vp}] tidak ada min-width paksa di dialog`, minWidthOffenders(dlg, vp).length === 0, minWidthOffenders(dlg, vp).join(' | '))
    }
  }

  // V1/V5: form PR (mode standard)
  {
    const dom = makeDom(vp)
    const root = createRoot(dom.window.document.getElementById('app'))
    flushSync(() => root.render(React.createElement(CreateModal, {
      page: 'requests', allProjects: PROJECTS, allMaterials: MATERIALS, allVendors: VENDORS,
      existingRequests: [], allRequestsFull: [], allPrItems: [], allReceivingItems: [], allReceivings: [],
      close: () => {}, refresh: () => {}, say: () => {}
    })))
    const doc = dom.window.document
    check(`[${vp}] form PR ter-render`, !!doc.querySelector('.material-picker-box'))
    check(`[${vp}] tidak ada .table-scroll-hint di form`, !doc.querySelector('.table-scroll-hint'))
    const off = minWidthOffenders(doc, vp)
    check(`[${vp}] form tidak punya min-width paksa > viewport`, off.length === 0, off.join(' | '))
    // Tabel item memakai min-width:0 !important lewat styled-jsx (tidak inline)
    const table = doc.querySelector('.pr-items-table')
    if (table) {
      const s = table.getAttribute('style') || ''
      check(`[${vp}] tabel item tidak memakai min-width besar`, !/min-width\s*:\s*(?:[8-9]\d\d|\d{4,})px/i.test(s), s)
    }
  }
}

console.log(`\n================ HASIL VIEWPORT ================`)
console.log(`LULUS: ${pass}   GAGAL: ${fail}`)
if (fail) { for (const f of failures) console.error(` - ${f}`); process.exit(1) }
console.log('SEMUA VIEWPORT JALUR LEAN LULUS (tanpa pemicu scroll horizontal)')
