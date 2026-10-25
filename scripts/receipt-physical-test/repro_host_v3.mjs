// ============================================================
// REPRO REVIEW (t_7bc6246b run 188) — BUG tombol 📥 mati saat antrean kosong
// ============================================================
// KLAIM KODE (physicalModal.js / queue.jsx): "modal dirender SEKALI (di
// banner) supaya tidak dobel". Masalahnya: banner `return null` lebih awal
// bila antrean distribusi KOSONG, sehingga <PhysicalModalHost> ikut tidak
// dirender. Tombol 📥 di aksi baris (view.jsx) tetap aktif dan mengisi store,
// tetapi tidak ada host yang merender form → klik tidak berefek apa pun.
//
// Skenario nyata: semua handover sudah `diserahkan_at` (pekerjaan selesai),
// lalu admin ingin mencatat/mengoreksi kedatangan barang dari tabel Handover.
//
// Jalankan dari root sandbox receipt-physical-verify:
//   node repro_host_v3.mjs
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
global.HTMLElement = dom0.window.HTMLElement
global.HTMLInputElement = dom0.window.HTMLInputElement
global.HTMLSelectElement = dom0.window.HTMLSelectElement
global.Event = dom0.window.Event
global.FileReader = dom0.window.FileReader

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const importDist = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)
const Q = await importDist('modules/handovers/queue.mjs')
const V = await importDist('modules/handovers/view.mjs')
const PM = await importDist('modules/handovers/physicalModal.mjs')

const tick = () => new Promise(r => setTimeout(r, 0))
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
let pass = 0, fail = 0
const check = (n, c, extra = '') => { if (c) { pass++; console.log(`  ✓ ${n}`) } else { fail++; console.log(`  ✗ ${n}  ${extra}`) } }

function mount(el) {
  dom0.window.document.body.innerHTML = ''
  const host = dom0.window.document.createElement('div')
  dom0.window.document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(el))
  return { doc: dom0.window.document, root }
}

const receiving = { id: 'rec1', invoice_no: 'INV-1', purchase_request_id: 'pr1', status: 'NORMAL' }
const baseHo = {
  id: 'h1', receiving_id: 'rec1', project_id: 'p1', status: 'CONFIRMED',
  handover_date: '2026-10-20', received_by: 'Mandor', note: null
}
const ctxFor = (ho) => ({
  rows: [ho],
  allReceivings: [receiving],
  H: {
    receivingItemsForReceiving: () => [{ id: 'ri1', receiving_id: 'rec1', item_name: 'Triplek', unit: 'Lembar', quantity_received: 10, qty_arrived: 0 }],
    prItemsForPr: () => []
  },
  say: () => {}, refresh: () => {}
})

// Komposisi persis ModuleView: banner modul di atas, tabel di bawah.
const page = (ho) => React.createElement('div', null,
  Q.renderHandoverQueue(ctxFor(ho)),
  React.createElement('table', null, React.createElement('tbody', null,
    React.createElement('tr', null, V.rowActions(ho, ctxFor(ho)))
  ))
)

console.log('A. SEMUA handover sudah diserahkan (antrean distribusi kosong)')
const delivered = { ...baseHo, diserahkan_at: '2026-10-20T10:00:00Z' }
PM.resetPhysicalModal()
const { doc } = mount(page(delivered))
await tick()
check('A1 banner antrean tidak dirender (memang kosong)', !tid(doc, 'handover-queue-banner'))
const btn = tid(doc, 'btn-terima-h1')
check('A2 tombol 📥 tetap ada di aksi baris', !!btn)
check('A3 tombol 📥 TIDAK disabled (mengundang klik)', btn && btn.disabled === false, String(btn?.disabled))
flushSync(() => btn.click())
await tick()
check('A4 store menerima permintaan buka form', PM.__peekForTest()?.kind === 'receipt')
check('A5 form Terima Barang benar-benar muncul', !!tid(doc, 'receipt-form'), '← klik tidak berefek: host modal tidak ter-mount')
check('A6 judul form tampil di layar', /Terima Barang —/.test(doc.body.textContent || ''))

console.log('\nB. KONTROL: ada handover DRAFT (antrean tidak kosong) → form muncul')
const draft = { ...baseHo, status: 'DRAFT', diserahkan_at: null }
PM.resetPhysicalModal()
const { doc: d2 } = mount(page(draft))
await tick()
check('B1 banner antrean dirender', !!tid(d2, 'handover-queue-banner'))
flushSync(() => tid(d2, 'btn-terima-h1').click())
await tick()
check('B2 form Terima Barang muncul', !!tid(d2, 'receipt-form'))

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
