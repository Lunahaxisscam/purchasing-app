// ============================================================
// probe_run231_claim.mjs — REVIEW RUN 231, bagian 4
// ============================================================
// Klaim yang dibuat receiptForm saat `cap.ready = true`:
//
//   "Penyimpanan per barang AKTIF: kedatangan, kondisi rusak, tujuan,
//    dan retur tersimpan permanen."
//
// Padahal di keadaan ready=true / returnReady=false, tabel retur BELUM ADA
// (atau tak terbaca). Form itu sendiri masih menawarkan dropdown
// "Kembalikan ke supplier" / "Dibuang" — pilihan yang akan tersimpan sebagai
// `retur_status` di receiving_events, tetapi TIDAK akan pernah bisa
// ditindaklanjuti karena `return_lines` tidak ada.
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
const ReceiptForm = (await importDist('modules/handovers/receiptForm.mjs')).default

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
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

const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-BARU', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const RI = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 }]
const CAP_CORE_ONLY = {
  ready: true, returnReady: false,
  events: true, handoverItems: true, returnLines: false, progress: true,
  probeFailed: false, missing: ['retur: tabel return_lines belum ada'],
  checkedAt: '2026-10-21T00:00:00Z'
}

console.log('\n=== 1. receiptForm di keadaan ready / retur-belum ===\n')
{
  mock.__reset({ receivings: [REC], prItems: [], receivingItems: RI, handovers: [], ledger: null })
  const { document: doc } = mount(
    React.createElement(ReceiptForm, {
      receiving: REC, items: RI, orderedFor: () => 10, capability: CAP_CORE_ONLY,
      say: () => {}, refresh: () => {}, close: () => {}
    })
  )
  await tick(); await tick()
  const note = tid(doc, 'receipt-capability')
  const noteTxt = (note?.textContent || '').trim()
  console.log(`     panel (state=${note?.getAttribute('data-capability-state')}) = ${JSON.stringify(noteTxt)}`)
  check('1a TIDAK mengklaim "retur tersimpan permanen" saat return_lines tidak ada',
    !/retur tersimpan permanen/i.test(noteTxt), noteTxt)
  check('1b TIDAK mengklaim seluruh dimensi AKTIF saat satu dimensi tidak bisa ditulis',
    !/Penyimpanan per barang AKTIF/i.test(noteTxt), noteTxt)
  check('1c ada penjelasan yang bisa dibaca admin tentang retur', /retur/i.test(noteTxt) && noteTxt.length > 0, noteTxt)
  // Dropdown retur masih ditawarkan?
  const returSel = tid(doc, 'rc-retur-ri1')
  const opts = returSel ? [...returSel.querySelectorAll('option')].map(o => o.getAttribute('value')) : []
  console.log(`     dropdown retur: ada=${!!returSel} opsi=${JSON.stringify(opts)}`)
}

console.log(`\n=== HASIL PROBE RUN 231-CLAIM: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
