// ============================================================
// probe_r219_j.mjs — REVIEW RUN 219: kontrol POSITIF
// ============================================================
// Sebelum menyatakan ada cacat, buktikan dulu bahwa perbaikan yang DIKLAIM
// memang bekerja di keadaan yang diuji run 215:
//   J1 READY asli (semua objek ada) → aksi borongan NONAKTIF, nol tulisan
//   J2 READY asli → tombol penutup membuka modal konfirmasi PER BARANG
//   J3 R3 label & pesan gudang jujur
//   J4 capabilityState() empat keadaan
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
const ACT = await importDist('modules/handovers/actions.mjs')

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

const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-1', delivery_note: 'Nota', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const PR = [
  { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng', status: 'RECEIVED' }
]
const RI = [
  { id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 },
  { id: 'ri2', receiving_id: 'rec1', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', quantity_received: 4 }
]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
const FULL = {
  receivingEvents: [
    { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 10, qty_rusak: 0, tujuan_ws: 10, tujuan_tukang: 0, penerima_tukang: null, retur_status: 'NONE', retur_qty: 0, discard_confirmed: false },
    { id: 'ev2', receiving_id: 'rec1', receiving_item_id: 'ri2', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', qty_datang: 4, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 4, penerima_tukang: 'Pak Budi', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false }
  ],
  handoverItems: [], returnLines: [], returnCases: [], progress: []
}

console.log('\n=== J1/J2. READY asli (semua objek ADA) ===\n')
{
  mock.__reset({ receivings: [{ ...REC }], prItems: PR.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }], ledger: FULL })
  CAP.resetReceiptCapability()
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
  const banner = tid(doc, 'handover-capability')
  const gudang = tid(doc, 'queue-act-gudang-h1')
  const tukang = tid(doc, 'queue-act-tukang-h1')
  const finish = tid(doc, 'queue-act-terima-h1')
  console.log(`     banner=${banner ? banner.getAttribute('data-capability-state') : '(disembunyikan = READY)'} gudang.disabled=${gudang?.disabled} tukang.disabled=${tukang?.disabled} penutup.disabled=${finish?.disabled}`)
  check('J1a READY: banner capability disembunyikan', !banner)
  check('J1b READY: tombol borongan gudang NONAKTIF', gudang?.disabled === true, `disabled=${gudang?.disabled}`)
  check('J1c READY: tombol borongan tukang NONAKTIF', tukang?.disabled === true, `disabled=${tukang?.disabled}`)
  if (gudang) click(gudang)
  for (let i = 0; i < 8; i++) await tick()
  const st = Object.fromEntries([...mock.__state.prItems].map(([k, v]) => [k, v.status]))
  check('J1d READY: nol update pr_items (tujuan per barang utuh)', mock.__callsOf('update', 'pr_items').length === 0, JSON.stringify(st))
  check('J2a READY: tombol penutup AKTIF', finish?.disabled === false, `disabled=${finish?.disabled}`)
  if (finish && !finish.disabled) click(finish)
  await tick()
  check('J2b READY: yang terbuka = modal konfirmasi per barang (bukan form header inline)', !!tid(doc, 'handover-confirm-form') && !tid(doc, 'queue-terima-form-h1'))
  const sum = tid(doc, 'queue-summary-h1')?.textContent || ''
  check('J2c READY: ringkasan tidak memakai angka pr_items.status', !/\d+\s+dari\s+\d+\s+barang/i.test(sum), sum)
  check('J2d READY: ringkasan mengarahkan ke pencatatan per barang', /per barang/i.test(sum), sum)
}

console.log('\n=== J3. R3 label & pesan ===\n')
{
  mock.__reset({ receivings: [{ ...REC }], prItems: PR.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }], ledger: null })
  const plan = Q.ACTIONS || []
  const label = (plan.find(a => a.key === 'gudang') || {}).label || ''
  console.log(`     label = "${label}"`)
  check('J3a label tidak mengklaim "stok"', !/stok/i.test(label), label)
  const res = await ACT.kirimKeGudang('h1')
  console.log(`     pesan = "${res.message}"`)
  check('J3b pesan menyatakan stok TIDAK bertambah', /stok material TIDAK bertambah/i.test(res.message), res.message)
}

console.log('\n=== J4. capabilityState() empat keadaan ===\n')
{
  const cases = [
    ['null → unknown', CAP.capabilityState(null), 'unknown'],
    ['undefined → unknown', CAP.capabilityState(undefined), 'unknown'],
    ['probeFailed → error', CAP.capabilityState({ ready: false, probeFailed: true }), 'error'],
    ['ready:false → legacy', CAP.capabilityState({ ready: false }), 'legacy'],
    ['ready:true → ready', CAP.capabilityState({ ready: true }), 'ready']
  ]
  for (const [n, got, want] of cases) check(`J4 ${n}`, got === want, `got=${got}`)
}

console.log(`\n=== HASIL PROBE J (kontrol positif): ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
