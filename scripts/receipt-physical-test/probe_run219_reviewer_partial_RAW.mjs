// ============================================================
// probe_r219_i.mjs — REVIEW RUN 219: migrasi SEBAGIAN dilaporkan "LEGACY"
// ============================================================
// `capabilityState()` membedakan unknown/error/legacy/ready. Tapi `legacy`
// diturunkan dari `!cap.ready`, BUKAN dari "tidak ada objek ledger sama sekali".
//
// Akibatnya, keadaan migrasi SEBAGIAN:
//   receiving_events  ADA (berisi tujuan_ws / tujuan_tukang per barang)
//   handover_items    ADA
//   v_receipt_progress BELUM ADA (PGRST205, bukan permission denied)
// → `ready:false`, `probeFailed:false` → capabilityState = 'legacy'
// → banner berkata "penyimpanan per barang BELUM AKTIF" (padahal tabelnya ADA
//   dan sudah berisi data per barang)
// → aksi borongan AKTIF dan menimpa tujuan per barang yang SUDAH tercatat
//
// Ini bukan hipotesis: paket migrasi schema owner terdiri dari 4 file
// terpisah (01..04). Bila 02 berhasil dan view gagal dibuat (atau 03 belum
// dijalankan), keadaan ini persis terjadi.
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
// MIGRASI SEBAGIAN: events + handover_items ADA dan BERISI, view BELUM ADA.
const PARTIAL = {
  receivingEvents: [
    { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 10, qty_rusak: 0, tujuan_ws: 10, tujuan_tukang: 0, penerima_tukang: null, retur_status: 'NONE', retur_qty: 0, discard_confirmed: false },
    { id: 'ev2', receiving_id: 'rec1', receiving_item_id: 'ri2', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', qty_datang: 4, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 4, penerima_tukang: 'Pak Budi', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false }
  ],
  handoverItems: [], returnLines: [], returnCases: [], progress: []   // view disimulasikan di bawah
}
// Mock `__reset` mengubah `progress: null` menjadi `[]` (tabel "ada tapi kosong"),
// jadi keadaan "view BELUM ADA" tidak bisa dinyatakan lewat data. Kita paksa
// lewat klien: v_receipt_progress menjawab PGRST205 (persis seperti PostgREST).
function withMissingView(fn) {
  const orig = mock.supabase.from
  mock.supabase.from = (table) => {
    if (table === 'v_receipt_progress') {
      return {
        select() { return this },
        limit() {
          return Promise.resolve({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.v_receipt_progress' in the schema cache`, details: null, hint: null } })
        }
      }
    }
    return orig(table)
  }
  return () => { mock.supabase.from = orig }
}

console.log('\n=== I1. capabilityState untuk migrasi SEBAGIAN ===\n')
{
  mock.__reset({ receivings: [{ ...REC }], prItems: [
    { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' },
    { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng', status: 'RECEIVED' }
  ], receivingItems: RI, handovers: [{ ...HO }], ledger: PARTIAL })
  CAP.resetReceiptCapability()
  const restore = withMissingView()
  const cap = await CAP.getReceiptCapability({ force: true })
  restore()
  console.log(`     cap = ${JSON.stringify({ ready: cap.ready, probeFailed: cap.probeFailed, events: cap.events, handoverItems: cap.handoverItems, progress: cap.progress, missing: cap.missing })}`)
  console.log(`     capabilityState = ${CAP.capabilityState(cap)}`)
  check('I1a events + handover_items terbaca (data per barang ADA di DB)', cap.events === true && cap.handoverItems === true, JSON.stringify(cap))
  check('I1b state yang dilaporkan = legacy (bukan unknown/error)', CAP.capabilityState(cap) === 'legacy', CAP.capabilityState(cap))
}

console.log('\n=== I2. konsekuensi: aksi borongan menimpa tujuan per barang yang SUDAH tercatat ===\n')
{
  mock.__reset({ receivings: [{ ...REC }], prItems: [
    { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' },
    { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng', status: 'RECEIVED' }
  ], receivingItems: RI, handovers: [{ ...HO }], ledger: PARTIAL })
  CAP.resetReceiptCapability()
  const restore = withMissingView()
  let rerender = () => {}
  const says = []
  const ctx = {
    rows: [mock.__state.handovers.get('h1')].filter(Boolean),
    H: { receivingItemsForReceiving: (id) => RI.filter(r => r.receiving_id === id), prItemsForPr: () => [...mock.__state.prItems.values()] },
    say: (m) => says.push(m), refresh: () => rerender(),
    allReceivings: [{ ...REC }], allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    allReceivingItems: RI, allPrItems: [],
    onReceivingStatusChange: () => {}, onMarkHandoverDelivered: () => {}
  }
  const Wrapper = () => { const [, setT] = React.useState(0); rerender = () => setT(t => t + 1); return Q.renderHandoverQueue(ctx) }
  const doc = mount(React.createElement(Wrapper))
  for (let i = 0; i < 14; i++) await tick()
  restore()
  const state = tid(doc, 'handover-capability')?.getAttribute('data-capability-state')
  const bannerText = tid(doc, 'handover-capability')?.textContent || ''
  const gudang = tid(doc, 'queue-act-gudang-h1')
  console.log(`     banner state=${state}`)
  console.log(`     banner text =${bannerText.slice(0, 150)}`)
  console.log(`     gudang.disabled=${gudang?.disabled}`)
  check('I2a banner mengklaim "belum aktif" padahal receiving_events ADA dan berisi', /belum aktif/i.test(bannerText), bannerText.slice(0, 120))
  check('I2b tombol borongan AKTIF di keadaan migrasi sebagian', gudang?.disabled === false, `disabled=${gudang?.disabled}`)
  if (gudang && !gudang.disabled) click(gudang)
  for (let i = 0; i < 10; i++) await tick()
  const st = Object.fromEntries([...mock.__state.prItems].map(([k, v]) => [k, v.status]))
  console.log(`     setelah klik: pr_items=${JSON.stringify(st)} | ledger tujuan tetap ws=10/tukang=4`)
  check('I2c tujuan per barang (ws=10, tukang=4) TIDAK ditimpa jadi DI_GUDANG semua',
    !(st.pi1 === 'DI_GUDANG' && st.pi2 === 'DI_GUDANG'), JSON.stringify(st))
  // dan jalur penutup
  const finish = tid(doc, 'queue-act-terima-h1')
  let inline = false
  if (finish && !finish.disabled) {
    click(finish); await tick()
    inline = !!tid(doc, 'queue-terima-form-h1')
    const nama = tid(doc, 'queue-terima-nama-h1')
    if (nama) { type(nama, 'Pak Joko'); await tick(); const ok = tid(doc, 'queue-terima-ok-h1'); if (ok && !ok.disabled) click(ok); for (let i = 0; i < 10; i++) await tick() }
  }
  const row = mock.__state.handovers.get('h1') || {}
  console.log(`     penutup: formInline=${inline} diserahkan_at=${row.diserahkan_at || 'NULL'} handover_items=${mock.__callsOf('insert', 'handover_items').length}`)
  check('I2d dokumen TIDAK terkunci tanpa rincian (rincian akan hilang permanen via CAS)', !row.diserahkan_at, `diserahkan_at=SET status=${row.status}`)
}

console.log(`\n=== HASIL PROBE I: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
