// ============================================================
// probe_r219_h.mjs — REVIEW RUN 219: jalur ketiga (panel Bermasalah)
// ============================================================
// `problemPlan(receiving, items.length, hasHandler, returnReady)` dipanggil
// dengan `returnReady = !!cap?.returnReady`. Di jendela probe / probe gagal,
// returnReady=false → panel jatuh ke jalur LEGACY: tombol "Retur ke Supplier"
// / "Refund" menulis `receivings.status`. Di mode READY dimensi itu sudah
// tidak dipakai (retur dicatat per baris di return_cases/return_lines).
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
const Q = await importDist('modules/handovers/queue.mjs')
const CAP = await importDist('modules/receivings/receiptCapability.mjs')
const QU = Q

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })))
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
let root = null
function mount(el) {
  if (root) { try { root.unmount() } catch (e) {} }
  dom0.window.document.body.innerHTML = ''
  const host = dom0.window.document.createElement('div')
  dom0.window.document.body.appendChild(host)
  root = createRoot(host)
  flushSync(() => root.render(el))
  return dom0.window.document
}

// ---- Bagian 1: problemPlan() murni, tiga keadaan ------------------------
console.log('\n=== H1. problemPlan() dengan returnReady dari `!!cap?.returnReady` ===\n')
{
  const rec = { id: 'rec1', status: 'NORMAL' }
  // 1 barang (jalur LEGACY diizinkan), ledger ADA, tapi probe gagal
  const legacy = QU.problemPlan(rec, 1, true, false)   // returnReady=false
  const ready = QU.problemPlan(rec, 1, true, true)     // returnReady=true
  console.log(`     returnReady=false → ${JSON.stringify(legacy)}`)
  console.log(`     returnReady=true  → ${JSON.stringify(ready)}`)
  check('H1a returnReady=false menawarkan jalur tulis STATUS (LEGACY)', legacy.ok === true && !legacy.perLine, JSON.stringify(legacy))
  check('H1b returnReady=true menawarkan jalur PER BARANG', ready.ok === true && ready.perLine === true, JSON.stringify(ready))
}

// ---- Bagian 2: panel Bermasalah di jendela probe -------------------------
console.log('\n=== H2. panel Bermasalah saat probe GAGAL (ledger ADA) ===\n')
{
  const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-1', delivery_note: 'Nota', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
  const RI = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek', unit: 'Lembar', quantity_received: 10 }]
  const PR = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Triplek', quantity: 10, unit: 'Lembar', status: 'RECEIVED' }]
  const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
  const LEDGER = { receivingEvents: [], handoverItems: [], returnLines: [], returnCases: [], progress: [] }
  mock.__reset({ receivings: [{ ...REC }], prItems: PR.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }], ledger: LEDGER })
  CAP.resetReceiptCapability()
  const origFrom = mock.supabase.from
  mock.supabase.from = (table) => {
    if (table === 'v_receipt_progress') {
      return { select() { return this }, limit() { return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for view v_receipt_progress', details: null, hint: null } }) } }
    }
    return origFrom(table)
  }
  const says = []
  const ctx = {
    rows: [{ ...HO }],
    H: { receivingItemsForReceiving: () => RI, prItemsForPr: () => PR },
    say: (m) => says.push(m), refresh: () => {},
    allReceivings: [{ ...REC }], allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    allReceivingItems: RI, allPrItems: [],
    onReceivingStatusChange: (r, key) => { says.push(`STATUS_WRITE:${key}`) },
    onMarkHandoverDelivered: () => {}
  }
  const doc = mount(Q.renderHandoverQueue(ctx))
  for (let i = 0; i < 14; i++) await tick()
  const state = tid(doc, 'handover-capability')?.getAttribute('data-capability-state')
  console.log(`     banner state = ${state}`)
  const problemBtn = tid(doc, 'queue-problem-h1')
  if (problemBtn) click(problemBtn)
  await tick()
  const panel = tid(doc, 'queue-problem-panel-h1')
  const returBtn = tid(doc, 'queue-problem-retur-h1')
  const legacyRetur = tid(doc, 'queue-problem-retur-h1')
  console.log(`     panel ada=${!!panel} teks=${(panel?.textContent || '').slice(0, 120)}`)
  check('H2a probe GAGAL: panel Bermasalah TIDAK menawarkan jalur per baris (padahal ledger ADA)', !!tid(doc, 'queue-problem-retur-h1'),
    'jalur per-baris tidak tersedia; jatuh ke status header')
  mock.supabase.from = origFrom
}

console.log(`\n=== HASIL PROBE H: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
