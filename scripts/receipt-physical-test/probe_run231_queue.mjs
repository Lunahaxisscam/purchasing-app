// ============================================================
// probe_run231_queue.mjs — REVIEW RUN 231, bagian 2 (presisi)
// ============================================================
// Keadaan yang diuji: `ready = true` tetapi `returnReady = false`.
// Dua jalan masuk yang NYATA:
//   (a) migrasi 01,02,04 dijalankan tetapi 03_return_layer BELUM;
//   (b) file 03 ADA tetapi probe `return_lines` gagal (GRANT/RLS).
//
// Yang diperiksa BUKAN testid (tombol legacy "Retur ke Supplier" dan tombol
// per-baris sama-sama berakhiran -retur), melainkan TEKS yang dibaca admin:
//   per-baris : "↩ Buka Form Retur (per barang)"  → membuka ReturnForm
//   legacy    : "↩ Retur ke Supplier" / "💸 Refund" → menulis receivings.status
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
const PM = await importDist('modules/handovers/physicalModal.mjs')
const CAP = await importDist('modules/receivings/receiptCapability.mjs')

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
const RI = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 }]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
const PR_ITEMS = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' }]
const EVENTS = [{
  id: 'ev1', client_event_id: 'rcpt:rec1:ri1:0->6', receiving_id: 'rec1', receiving_item_id: 'ri1',
  pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2,
  tujuan_ws: 0, tujuan_tukang: 4, penerima_tukang: 'Pak Joko', retur_status: 'PENDING', retur_qty: 2,
  discard_confirmed: false, foto_ref: null, source: 'ui', created_at: '2026-10-21T00:00:00Z'
}]
const LEDGER_NO_RETURN = { receivingEvents: EVENTS, handoverItems: [], returnLines: null, returnCases: null, progress: [{ receiving_item_id: 'ri1', qty_datang: 6, qty_rusak: 2, qty_baik: 4, belum_diserahkan: 4, qty_bought: 10, qty_arrived: 6, qty_handed_over: 0, tujuan_tukang: 4 }] }

function renderQueueWithReturnMissing() {
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER_NO_RETURN })
  PM.resetPhysicalModal()
  CAP.resetReceiptCapability()
  const origFrom = mock.supabase.from
  mock.supabase.from = (table) => {
    if (table === 'return_lines') {
      const err = { code: 'PGRST205', message: "Could not find the table 'public.return_lines' in the schema cache", details: null, hint: null }
      return {
        select() { return this },
        limit() { return Promise.resolve({ data: null, error: err }) },
        in() { return this },
        then(res) { return Promise.resolve({ data: null, error: err }).then(res) }
      }
    }
    return origFrom(table)
  }
  const ctx = {
    rows: [{ ...HO }],
    H: {
      receivingItemsForReceiving: (id) => RI.filter(r => r.receiving_id === id),
      prItemsForPr: () => PR_ITEMS
    },
    say: () => {}, refresh: () => {},
    allReceivings: [{ ...REC }], allRequests: [{ id: 'pr1', pr_number: 'PR-1' }],
    allReceivingItems: RI, allPrItems: [],
    onReceivingStatusChange: () => {}, onMarkHandoverDelivered: () => {}
  }
  const { document: doc } = mount(React.createElement(() => Q.renderHandoverQueue(ctx)))
  return { doc, restore: () => { mock.supabase.from = origFrom } }
}

console.log('\n=== A. problemPlan() dipanggil seperti queue memanggilnya ===\n')
{
  // Ditiru: apa yang dikirim queue utk cap {ready:true, returnReady:false}
  const cap = { ready: true, returnReady: false, events: true, handoverItems: true, returnLines: false, progress: true, probeFailed: false, missing: ['retur: tabel return_lines belum ada'] }
  const capState = CAP.capabilityState(cap)
  console.log(`     capabilityState(cap) = ${capState}`)
  // Panggilan yang SAMA dengan queue.jsx (argumen ke-4 = keadaan capability)
  const plan = Q.problemPlan(REC, 1, true, capState)
  console.log(`     problemPlan(..., '${capState}') = ${JSON.stringify(plan)}`)
  check('A1 tidak menawarkan jalur retur per baris saat tabel retur tidak ada',
    !(plan.ok === true && plan.perLine === true), JSON.stringify(plan))
}

console.log('\n=== B. Antrean nyata: teks yang dibaca admin ===\n')
{
  const { doc, restore } = renderQueueWithReturnMissing()
  for (let i = 0; i < 14; i++) await tick()
  const banner = tid(doc, 'handover-capability')
  console.log(`     banner = ${banner?.getAttribute('data-capability-state') ?? '(tersembunyi: READY)'}`)
  click(tid(doc, 'queue-problem-h1'))
  for (let i = 0; i < 4; i++) await tick()
  const panelTxt = (tid(doc, 'queue-problem-panel-h1')?.textContent || '').trim()
  console.log(`     panel  = ${JSON.stringify(panelTxt.slice(0, 240))}`)
  const perLine = /Buka Form Retur \(per barang\)/i.test(panelTxt)
  const legacy = /Retur ke Supplier|Refund/i.test(panelTxt)
  console.log(`     jalur per-baris=${perLine} · jalur status-header=${legacy}`)
  check('B1 TIDAK menawarkan form retur per baris saat return_lines tidak terbaca', !perLine,
    perLine ? 'menawarkan "Buka Form Retur (per barang)"' : '')
  check('B2 TIDAK menawarkan jalur tulis STATUS header (Retur/Refund) saat ledger inti AKTIF',
    !legacy, legacy ? 'menawarkan status header — akan menimpa riwayat retur per barang' : '')

  if (perLine) {
    const btn = [...doc.querySelectorAll('button')].find(b => /Buka Form Retur \(per barang\)/i.test(b.textContent || ''))
    click(btn)
    for (let i = 0; i < 10; i++) await tick()
    const cap = doc.querySelector('[data-testid="return-capability"]')
    const empty = doc.querySelector('[data-testid="return-empty"]')
    console.log(`     form retur terbuka · panel state=${cap?.getAttribute('data-capability-state')} text=${JSON.stringify((cap?.textContent || '').trim().slice(0, 160))}`)
    console.log(`     panel kosong = ${JSON.stringify((empty?.textContent || '').trim().slice(0, 200))}`)
    check('B3 form retur TIDAK berkata "tidak ada barang rusak" padahal rusak 2',
      !/Tidak ada barang rusak yang tercatat/i.test(empty?.textContent || ''),
      (empty?.textContent || '').slice(0, 120))
  }
  restore()
}

console.log(`\n=== HASIL PROBE RUN 231-QUEUE: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
