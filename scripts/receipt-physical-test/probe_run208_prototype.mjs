// ============================================================
// probe_run208_prototype.mjs — PENGUNCI temuan run 208 (kandidat c5781fc)
// ============================================================
// Temuan yang dikunci di sini: SETELAH fitur "rincian serah terima per barang"
// menjadi NYATA (handover_items + confirmForm + RPC handover_confirm), masih
// ada PERMUKAAN LAIN di layar yang menerima isian per barang tetapi TIDAK
// menyimpan apa pun, dan teks yang masih menyuruh admin "menunggu skema".
//
//   P  `PrototypePanel` (view.jsx) — panel kuning "🧪 Prototype: rencana
//      rincian penyerahan per item (belum tersimpan)". Menerima qty+penerima,
//      menampilkan "Rencana tercatat (sesi ini)" — konfirmasi visual bahwa
//      sesuatu tercatat — padahal NOL tulisan dan hilang saat reload.
//      Angka "Diterima" di dropdown-nya = `receiving_items.quantity_received`
//      (QTY BELI), bukan qty DATANG → semantik yang justru diperbaiki card ini.
//   Q  Di mode READY panel itu bersaing dengan jalur NYATA: dua form untuk satu
//      pekerjaan, yang satu membuang datanya.
//   R  `display.rincianInfo` memakai kalimat "belum aktif di versi ini
//      (menunggu persetujuan perbaikan skema)" untuk handover yang belum punya
//      baris — padahal skema & UI-nya SUDAH ada; yang belum hanya DATANYA.
//   S  Panel detail antrean (queue.jsx) selalu bilang "jumlah serah terima per
//      item belum tercatat terpisah" — benar di LEGACY, SALAH di READY.
//
// Dijalankan pada kode SEBELUM fix (c5781fc) → P/Q/R/S GAGAL (10 FAIL).
// Dijalankan pada kode SESUDAH fix → 0 FAIL.
//
// Jalankan di sandbox hasil scripts/receipt-physical-test/run.py:
//   node probe_run208_prototype.mjs
// Exit 0 selalu (probe pelaporan); lihat baris HASIL PROBE.
// ============================================================
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
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)
const importDist = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)
const V = await importDist('modules/handovers/view.mjs')
const Q = await importDist('modules/handovers/queue.mjs')
const D = await importDist('modules/handovers/display.mjs')
const CAP = await importDist('modules/receivings/receiptCapability.mjs')

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })))
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
const mountedRoots = []
function mount(el) {
  for (const r of mountedRoots) { try { r.unmount() } catch (e) {} }
  mountedRoots.length = 0
  dom0.window.document.body.innerHTML = ''
  const host = dom0.window.document.createElement('div')
  dom0.window.document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(el))
  mountedRoots.push(root)
  return { root, host, document: dom0.window.document }
}
function typeInto(el, value) {
  const proto = el.tagName === 'SELECT' ? dom0.window.HTMLSelectElement.prototype : dom0.window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  flushSync(() => {
    setter.call(el, value)
    el.dispatchEvent(new dom0.window.Event('input', { bubbles: true }))
    el.dispatchEvent(new dom0.window.Event('change', { bubbles: true }))
  })
}

// ---------- fixture: nota DIBELI 10, DATANG 6 (angka berbeda) ----------
const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-1', delivery_note: 'Nota INV-1', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const PR_ITEMS = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Semen', quantity: 10, unit: 'Sak', status: 'APPROVED' }]
const RI = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Semen', unit: 'Sak', quantity_received: 10, qty_arrived: 6 }]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
const HO_DONE = { ...HO, status: 'CONFIRMED', diserahkan_at: '2026-10-21T02:00:00Z', items: [{ id: 'hi1', handover_id: 'h1', receiving_event_id: 'ev1', item_name: 'Semen', qty_diserahkan: 5, satuan: 'Sak', penerima: 'Pak Joko' }] }
const LEDGER = {
  receivingEvents: [
    { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Semen', unit: 'Sak', qty_datang: 6, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 5, penerima_tukang: 'Pak Joko', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false }
  ],
  handoverItems: [], returnLines: [], returnCases: [], progress: []
}
const noop = () => {}

function makeCtx(extra = {}) {
  return {
    columns: ['items', 'received_by', 'status', 'handover_date'],
    expandedAcuan: 'h1',
    allReceivings: [REC],
    allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    H: { receivingItemsForReceiving: () => RI, prItemsForPr: () => PR_ITEMS },
    title: 'Serah Terima', page: 'handovers',
    setEditRow: noop, onDelete: noop, onMarkHandoverDelivered: noop,
    say: noop, refresh: noop,
    ...extra
  }
}

// ============================================================
console.log('\n=== P. Panel prototype (input per barang tanpa penyimpanan) ===\n')
// ============================================================
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO] })
  const { document: doc } = mount(React.createElement('table', null, React.createElement('tbody', null, V.rowExpand(HO, makeCtx()))))
  await tick()
  check('P1 panel prototype TIDAK dirender di detail handover', !tid(doc, 'prototype-panel-h1'),
    tid(doc, 'prototype-panel-h1') ? 'masih ada' : '')
  check('P2 tidak ada input qty per barang yang tidak menyimpan', !tid(doc, 'proto-qty-h1') && !tid(doc, 'proto-add-h1'))
  check('P3 tidak ada tombol "Catat (sesi)" (konfirmasi visual palsu)', !/Catat \(sesi\)/i.test(doc.body.textContent || ''))
  check('P4 tidak ada klaim "Rencana tercatat" di layar', !/Rencana tercatat/i.test(doc.body.textContent || ''))
}

// ============================================================
console.log('\n=== Q. Angka "diterima" dari qty BELI tidak lagi tampil sebagai rincian ===\n')
// ============================================================
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO] })
  const { document: doc } = mount(React.createElement('table', null, React.createElement('tbody', null, V.rowExpand(HO, makeCtx()))))
  await tick()
  const t = doc.body.textContent || ''
  check('Q1 detail TIDAK menampilkan "10 Sak diterima" (qty BELI sebagai diterima)', !/10\s*Sak\s*diterima/i.test(t))
  check('Q2 label jujur tetap ada saat rincian belum dicatat', /Rincian barang belum tersedia/.test(t))
}

// ============================================================
console.log('\n=== R. Notice tidak lagi menyuruh menunggu skema ===\n')
// ============================================================
{
  const infoNoItems = D.rincianInfo({ ...HO, items: undefined })
  check('R1 handover belum punya baris: notice menjelaskan CARA mencatat (konfirmasi fisik)',
    /konfirmasi fisik/i.test(infoNoItems.notice || ''), infoNoItems.notice)
  check('R2 notice TIDAK menyebut "menunggu persetujuan perbaikan skema"',
    !/menunggu persetujuan perbaikan skema|belum aktif di versi ini/i.test(infoNoItems.notice || ''), infoNoItems.notice)
  const infoNoRec = D.rincianInfo({ id: 'h9', receiving_id: null })
  check('R3 tanpa receiving: dijelaskan bahwa rincian butuh nota pembelian',
    /belum terhubung ke penerimaan/i.test(infoNoRec.notice || ''), infoNoRec.notice)
  check('R4 available tetap false & tanpa angka tebakan', infoNoItems.available === false && infoNoItems.rows.length === 0)
}

// ============================================================
console.log('\n=== S. Detail antrean: pesan per mode (LEGACY vs READY) ===\n')
// ============================================================
{
  // READY: rincian per barang BENAR-BENAR ditulis & dibaca → jangan bilang "belum ada".
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  CAP.resetReceiptCapability()
  const ctx = {
    rows: [HO], allReceivings: [REC], allReceivingItems: RI,
    allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    H: { receivingItemsForReceiving: () => RI, prItemsForPr: () => PR_ITEMS },
    say: noop, refresh: noop, onReceivingStatusChange: noop
  }
  const { document: doc } = mount(Q.renderHandoverQueue(ctx))
  await tick(); await tick(); await tick()
  click(tid(doc, 'queue-detail-h1'))
  await tick()
  const panel = tid(doc, 'queue-detail-panel-h1')?.textContent || ''
  check('S1 READY: pesan menyebut rincian dicatat lewat konfirmasi fisik per barang',
    /konfirmasi fisik per barang/i.test(panel), panel.slice(0, 260))
  check('S2 READY: TIDAK bilang "belum tercatat terpisah"',
    !/belum tercatat terpisah/i.test(panel))
  check('S3 READY: qty di daftar tetap diberi label "qty beli di nota"',
    /qty beli di nota/i.test(panel))
}

// ============================================================
console.log('\n=== T. LEGACY: pesan lama TETAP dipakai (tidak berbohong ke arah lain) ===\n')
// ============================================================
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: null })
  CAP.resetReceiptCapability()
  const ctx = {
    rows: [HO], allReceivings: [REC], allReceivingItems: RI,
    allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    H: { receivingItemsForReceiving: () => RI, prItemsForPr: () => PR_ITEMS },
    say: noop, refresh: noop, onReceivingStatusChange: noop
  }
  const { document: doc } = mount(Q.renderHandoverQueue(ctx))
  await tick(); await tick(); await tick()
  click(tid(doc, 'queue-detail-h1'))
  await tick()
  const panel = tid(doc, 'queue-detail-panel-h1')?.textContent || ''
  check('T1 LEGACY: pesan jujur "belum tercatat terpisah" dipertahankan',
    /belum tercatat terpisah/i.test(panel), panel.slice(0, 260))
  check('T2 LEGACY: TIDAK mengklaim rincian per barang aktif',
    !/konfirmasi fisik per barang/i.test(panel))
}

console.log(`\n=== HASIL PROBE: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('TEMUAN: ' + failures.join(' | '))
process.exit(0)
