// ============================================================
// probe_r219_final.mjs — REVIEW RUN 219 (independen): bukti deterministik
// ============================================================
// Tiga keadaan capability, tiga hasil berbeda. Yang diuji BUKAN "apakah kode
// berubah", tetapi: dalam keadaan itu, apakah satu klik admin bisa
// (a) menimpa tujuan per barang, dan (b) mengunci dokumen tanpa rincian.
//
//   K1  cap === null   (frame pertama banner — useState(null))
//   K2  probe GAGAL    (ledger ADA, GRANT v_receipt_progress belum ada)
//   K3  LEGACY asli    (probe selesai, skema belum ada) → perilaku lama WAJIB tetap
//
// `ledgerReady = !!cap?.ready` di queue.jsx. R1 memperbaiki TIGA keadaan di
// confirmForm; queue.jsx masih DUA keadaan.
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

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })))
const type = (el, v) => flushSync(() => {
  const setter = Object.getOwnPropertyDescriptor(dom0.window.HTMLInputElement.prototype, 'value').set
  setter.call(el, v)
  el.dispatchEvent(new dom0.window.Event('input', { bubbles: true }))
})
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

const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-BARU', delivery_note: 'Nota INV-BARU', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const RI = [
  { id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 },
  { id: 'ri2', receiving_id: 'rec1', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', quantity_received: 4 }
]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
// Tujuan BERBEDA per barang — inti BUG-R2.
const LEDGER = {
  receivingEvents: [
    { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 10, qty_rusak: 0, tujuan_ws: 10, tujuan_tukang: 0, penerima_tukang: null, retur_status: 'NONE', retur_qty: 0, discard_confirmed: false },
    { id: 'ev2', receiving_id: 'rec1', receiving_item_id: 'ri2', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', qty_datang: 4, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 4, penerima_tukang: 'Pak Budi', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false }
  ],
  handoverItems: [], returnLines: [], returnCases: [], progress: []
}
const FRESH_PR = () => ([
  { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng', status: 'RECEIVED' }
])

let rerender = () => {}
function render(ledger, failProbe) {
  mock.__reset({ receivings: [{ ...REC }], prItems: FRESH_PR(), receivingItems: RI, handovers: [{ ...HO }], ledger })
  CAP.resetReceiptCapability()
  const says = []
  const ctx = {
    rows: [mock.__state.handovers.get('h1')].filter(Boolean),
    H: {
      receivingItemsForReceiving: (id) => RI.filter(r => r.receiving_id === id),
      prItemsForPr: () => [...mock.__state.prItems.values()]   // mutable: mencerminkan DB
    },
    say: (m) => says.push(m),
    refresh: () => rerender(),
    allReceivings: [{ ...REC }], allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    allReceivingItems: RI, allPrItems: [],
    onReceivingStatusChange: () => {}, onMarkHandoverDelivered: () => {}
  }
  const Wrapper = () => {
    const [, setT] = React.useState(0)
    rerender = () => setT(t => t + 1)
    return Q.renderHandoverQueue(ctx)
  }
  const doc = mount(React.createElement(Wrapper))
  return { doc, says, failProbe }
}

async function chain(ledger, failProbe, waitProbe) {
  const { doc, says } = render(ledger, failProbe)
  if (waitProbe) for (let i = 0; i < 14; i++) await tick()
  const state = tid(doc, 'handover-capability')?.getAttribute('data-capability-state')
  const gudang = tid(doc, 'queue-act-gudang-h1')
  const tukang = tid(doc, 'queue-act-tukang-h1')
  const finish0 = tid(doc, 'queue-act-terima-h1')
  console.log(`  banner=${state ?? '(READY: banner disembunyikan)'} | gudang.disabled=${gudang?.disabled} | tukang.disabled=${tukang?.disabled} | penutup.disabled=${finish0?.disabled}`)
  if (gudang && !gudang.disabled) click(gudang)
  for (let i = 0; i < 10; i++) await tick()
  const afterBulk = Object.fromEntries([...mock.__state.prItems].map(([k, v]) => [k, v.status]))
  const finish = tid(doc, 'queue-act-terima-h1')
  console.log(`  setelah klik borongan: pr_items=${JSON.stringify(afterBulk)} | penutup.disabled=${finish?.disabled}`)
  let inline = false
  if (finish && !finish.disabled) {
    click(finish)
    await tick()
    inline = !!tid(doc, 'queue-terima-form-h1')
    const nama = tid(doc, 'queue-terima-nama-h1')
    if (nama) {
      type(nama, 'Pak Joko'); await tick()
      const ok = tid(doc, 'queue-terima-ok-h1')
      if (ok && !ok.disabled) click(ok)
      for (let i = 0; i < 10; i++) await tick()
    }
  }
  const row = mock.__state.handovers.get('h1') || {}
  const hi = mock.__callsOf('insert', 'handover_items').length
  console.log(`  setelah klik penutup: formInline=${inline} diserahkan_at=${row.diserahkan_at || 'NULL'} status=${row.status} handover_items=${hi}`)
  console.log(`  pesan ke user: ${JSON.stringify(says)}`)
  return { afterBulk, locked: !!row.diserahkan_at, status: row.status, hi, inline, says, state }
}

// ============================================================
console.log('\n=== K1. cap === null (frame PERTAMA banner; useState(null)) — DB SUDAH dimigrasikan ===\n')
{
  const r = await chain(LEDGER, false, false)   // TANPA tick: frame pertama
  check('K1a tombol borongan gudang NONAKTIF saat capability belum diketahui', tid(dom0.window.document, 'queue-act-gudang-h1') !== null && r.afterBulk.pi1 === 'RECEIVED', JSON.stringify(r.afterBulk))
  check('K1b tujuan per barang TIDAK ditimpa jadi DI_GUDANG', !(r.afterBulk.pi1 === 'DI_GUDANG' && r.afterBulk.pi2 === 'DI_GUDANG'), JSON.stringify(r.afterBulk))
  check('K1c dokumen TIDAK terkunci tanpa rincian', r.locked === false, `diserahkan_at=SET status=${r.status} items=${r.hi}`)
}

// ============================================================
console.log('\n=== K2. probe GAGAL (GRANT v_receipt_progress belum ada) ===\n')
// Keadaan ini dihasilkan skrip migrasi draft card ini sendiri: tabel ledger
// dibuat, view dibuat, TAPI grant untuk `authenticated` belum ada
// (probe_app_role: 13 PASS / 1 FAIL). `probeFailed:true` → banner bilang GAGAL.
{
  const origFrom = mock.supabase.from
  mock.supabase.from = (table) => {
    if (table === 'v_receipt_progress') {
      return { select() { return this }, limit() { return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for view v_receipt_progress', details: null, hint: null } }) } }
    }
    return origFrom(table)
  }
  const r = await chain(LEDGER, true, true)
  mock.supabase.from = origFrom
  check('K2a banner jujur menyatakan pemeriksaan GAGAL', r.state === 'error', r.state)
  check('K2b tombol borongan gudang NONAKTIF saat probe GAGAL', r.afterBulk.pi1 === 'RECEIVED', JSON.stringify(r.afterBulk))
  check('K2c tujuan per barang TIDAK ditimpa jadi DI_GUDANG', !(r.afterBulk.pi1 === 'DI_GUDANG' && r.afterBulk.pi2 === 'DI_GUDANG'), JSON.stringify(r.afterBulk))
  check('K2d dokumen TIDAK terkunci tanpa rincian', r.locked === false, `diserahkan_at=SET status=${r.status} items=${r.hi}`)
}

// ============================================================
console.log('\n=== K3. LEGACY asli (probe SELESAI, skema belum ada) — perilaku lama WAJIB tetap ===\n')
{
  const r = await chain(null, false, true)
  check('K3a LEGACY: tombol borongan tetap AKTIF (satu-satunya jalur)', r.afterBulk.pi1 === 'DI_GUDANG', JSON.stringify(r.afterBulk))
  check('K3b LEGACY: pesan jujur soal stok (R3 tetap)', r.says.some(m => /TIDAK bertambah/i.test(m)), JSON.stringify(r.says))
}

console.log(`\n=== HASIL PROBE FINAL REVIEW 219: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
