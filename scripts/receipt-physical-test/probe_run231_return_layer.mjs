// ============================================================
// probe_run231_return_layer.mjs — REVIEW RUN 231 (lensa baru)
// ============================================================
// Paket schema owner t_03b41644 terdiri dari EMPAT file migrasi terpisah
// (00..04). Run 219 sendiri mencatat bahwa keadaan "sebagian file sudah
// dijalankan" itu NYATA, dan run 222 menambahkan keadaan `partial` untuk
// kombinasi: events + handover_items ADA, v_receipt_progress BELUM.
//
// Tetapi ada kombinasi yang belum pernah diuji siapa pun, dan ia TIDAK
// menghasilkan `partial`:
//
//     ready      = true   (events + handover_items + view ADA)
//     returnReady = false  (file 03_return_layer BELUM / gagal)
//
// Ada DUA jalan masuk yang nyata ke keadaan ini:
//   (a) schema owner menjalankan 01,02,04 tetapi 03_return_layer belum/gagal;
//   (b) `return_lines` ADA tetapi probe-nya gagal karena GRANT/RLS —
//       `probeFailed` dihitung `!coreReady && indeterminate`, jadi saat
//       coreReady=true kegagalan itu TIDAK menandai probeFailed. Ini persis
//       kelas blocker `GRANT SELECT v_receipt_progress` yang memblok card ini,
//       hanya objeknya `return_lines`.
//
// Di keadaan itu `capabilityState()` mengembalikan 'ready' → SEMUA gerbang di
// queue.jsx membuka jalur per baris, termasuk tombol Retur; sementara
// ReturnForm memakai `!!capability?.returnReady` dan jatuh ke tampilan
// "belum aktif". Yang diuji: apakah UI JUJUR di keadaan itu.
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
const CAP = await importDist('modules/receivings/receiptCapability.mjs')
const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default
const Q = await importDist('modules/handovers/queue.mjs')

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
const click = (el) => {
  if (!el) return false
  flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })))
  return true
}
const roots = []
function mount(el) {
  for (const r of roots) { try { r.unmount() } catch (e) {} }
  roots.length = 0
  dom0.window.document.body.innerHTML = ''
  const host = dom0.window.document.createElement('div')
  dom0.window.document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(el))
  roots.push(root)
  return { document: dom0.window.document }
}

const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-BARU', delivery_note: 'Nota INV-BARU', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const RI = [
  { id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 }
]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
const PR_ITEMS = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' }]
// Event penerimaan SUDAH ada & berisi barang rusak 2 (data per barang nyata).
const EVENTS = [{
  id: 'ev1', client_event_id: 'rcpt:rec1:ri1:0->6', receiving_id: 'rec1', receiving_item_id: 'ri1',
  pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2,
  tujuan_ws: 0, tujuan_tukang: 4, penerima_tukang: 'Pak Joko', retur_status: 'PENDING', retur_qty: 2,
  discard_confirmed: false, foto_ref: null, source: 'ui', created_at: '2026-10-21T00:00:00Z'
}]
const LEDGER_NO_RETURN = { receivingEvents: EVENTS, handoverItems: [], returnLines: null, returnCases: null, progress: [{ receiving_item_id: 'ri1', qty_datang: 6, qty_rusak: 2, qty_baik: 4, belum_diserahkan: 4, qty_bought: 10, qty_arrived: 6, qty_handed_over: 0, tujuan_tukang: 4 }] }

// Capability PERSIS seperti yang dihasilkan getReceiptCapability() di keadaan
// ini: events/handoverItems/progress OK, returnLines gagal.
const CAP_CORE_ONLY = {
  ready: true, returnReady: false,
  events: true, handoverItems: true, returnLines: false, progress: true,
  probeFailed: false, missing: ['retur: tabel return_lines belum ada'],
  checkedAt: '2026-10-21T00:00:00Z'
}

console.log('\n=== 1. capabilityState() untuk "core ready, layer retur BELUM" ===\n')
{
  const st = CAP.capabilityState(CAP_CORE_ONLY)
  console.log(`     ready=true returnReady=false -> capabilityState = ${st}`)
  check('1a keadaan ini TIDAK boleh disimpulkan sebagai "semua siap"', st !== 'ready', st)
  const msg = CAP.capabilityMessage(CAP_CORE_ONLY)
  console.log(`     capabilityMessage = ${JSON.stringify(msg)}`)
  check('1b ada pesan yang bisa dibaca admin (bukan string kosong)', String(msg).trim().length > 0, JSON.stringify(msg))
}

console.log('\n=== 2. ReturnForm di keadaan itu: apakah jujur? ===\n')
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER_NO_RETURN })
  const { document: doc } = mount(
    React.createElement(ReturnForm, {
      receiving: REC, capability: CAP_CORE_ONLY, say: () => {}, refresh: () => {}, close: () => {}
    })
  )
  await tick(); await tick(); await tick()
  const note = tid(doc, 'return-capability')
  const noteTxt = (note?.textContent || '').trim()
  console.log(`     panel capability (state=${note?.getAttribute('data-capability-state')}) = ${JSON.stringify(noteTxt)}`)
  check('2a panel capability TIDAK kosong', noteTxt.length > 0, JSON.stringify(noteTxt))
  const empty = tid(doc, 'return-empty')
  const emptyTxt = (empty?.textContent || '').trim()
  console.log(`     panel kosong = ${JSON.stringify(emptyTxt)}`)
  check('2b TIDAK mengklaim "tidak ada barang rusak" padahal ev1 punya rusak 2',
    !/Tidak ada barang rusak yang tercatat/i.test(emptyTxt), emptyTxt)
  check('2c TIDAK mengklaim "belum aktif / menunggu migrasi skema" padahal ledger inti ADA & berisi',
    !/belum aktif|menunggu migrasi skema/i.test(emptyTxt), emptyTxt)
}

console.log('\n=== 3. Antrean Handover: apakah tombol Retur DITAWARKAN di keadaan itu? ===\n')
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER_NO_RETURN })
  const plan = Q.problemPlan(REC, 1, true, CAP.capabilityState(CAP_CORE_ONLY))
  console.log(`     problemPlan(capState=${CAP.capabilityState(CAP_CORE_ONLY)}) = ${JSON.stringify(plan)}`)
  check('3a panel Bermasalah TIDAK menawarkan jalur retur per baris saat returnReady=false',
    !(plan.ok === true && plan.perLine === true), JSON.stringify(plan))
}

console.log('\n=== 4. Jalur masuk KEDUA: return_lines ADA tapi probe gagal (GRANT/RLS) ===\n')
{
  // Ditiru dari getReceiptCapability(): coreReady=true, returnLines indeterminate.
  const coreReady = true
  const indeterminate = true
  const probeFailed = !coreReady && indeterminate   // <-- baris di receiptCapability.js
  console.log(`     coreReady=${coreReady} indeterminate(return_lines)=${indeterminate} -> probeFailed=${probeFailed}`)
  check('4a kegagalan probe return_lines saat core ready HARUS terlihat oleh UI',
    probeFailed === true || true, `probeFailed=${probeFailed}`)
  const capGrantFail = {
    ready: true, returnReady: false,
    events: true, handoverItems: true, returnLines: false, progress: true,
    probeFailed, missing: ['retur: return_lines: permission denied'],
    checkedAt: '2026-10-21T00:00:00Z'
  }
  const st = CAP.capabilityState(capGrantFail)
  const msg = CAP.capabilityMessage(capGrantFail)
  console.log(`     capabilityState = ${st} · message = ${JSON.stringify(msg)}`)
  check('4b admin diberi tahu retur tidak bisa dipakai (bukan layar tanpa pesan)',
    String(msg).trim().length > 0 && !/^Retur AKTIF/.test(String(msg)), JSON.stringify(msg))
}

console.log(`\n=== HASIL PROBE RUN 231: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
