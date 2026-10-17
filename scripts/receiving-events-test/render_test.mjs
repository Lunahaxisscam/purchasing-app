// ============================================================
// RENDER TEST — ModuleView + form asli (dist SWC) di jsdom INTERAKTIF
// Bagian E: integrasi UI untuk t_7bc6246b
//   E1 mode LEGACY (skema belum ada): banner jujur, TIDAK ada tombol Retur,
//      konfirmasi handover tetap jalur header (tanpa janji rincian).
//   E2 mode READY (skema ada): banner hijau, tombol Retur muncul, form retur
//      menampilkan baris dari event rusak tanpa mengetik ulang, konfirmasi
//      handover menampilkan prefill per barang + menulis lewat RPC sekali.
//   E3 tombol "Pecah per Vendor" muncul hanya untuk nota multi-vendor yang
//      belum bergerak; nota 1 vendor / sudah diterima tidak menampilkannya.
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

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default
const CAP = await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/receiptCapability.mjs')).href)
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick() }
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))
const typeInto = (doc, el, val) => {
  const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set
  flushSync(() => {
    setter.call(el, val)
    el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }))
  })
}

const noop = () => {}
const PROJECTS = [{ id: 'p1', kode: '99', code: '99', name: 'Baroni', status: 'ON_GOING', created_at: '2026-10-01T00:00:00Z' }]
const VENDORS = [{ id: 'v1', name: 'Toko A' }, { id: 'v2', name: 'Toko B' }]
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'ORDERED', vendor_id: 'v1' },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng', status: 'ORDERED', vendor_id: 'v2' }
]
const RECEIVINGS = [
  { id: 'rc1', purchase_request_id: 'pr1', project_id: 'p1', project_name: '[99] Baroni', status: 'NORMAL', received_date: null, delivery_note: 'SJ-1', invoice_no: 'INV-1', note: '', alokasi: null, masuk_gudang: false, tukang_at: null },
  { id: 'rc2', purchase_request_id: 'pr1', project_id: 'p1', project_name: '[99] Baroni', status: 'NORMAL', received_date: null, delivery_note: 'SJ-2', invoice_no: 'INV-2', note: '', alokasi: null, masuk_gudang: true, tukang_at: null }
]
const RECEIVING_ITEMS = [
  { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 0 },
  { id: 'ri2', receiving_id: 'rc1', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', quantity_received: 0 }
]
const HANDOVERS = [
  { id: 'h1', receiving_id: 'rc1', project_id: 'p1', project_name: '[99] Baroni', received_by: 'Pak Joko', handover_date: '2026-10-16', status: 'DRAFT', note: '', created_at: '2026-10-16T00:00:00Z', diserahkan_at: null }
]

function mount(page, rows, extra = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* read-only di Node 22 */ }
  const props = {
    page, rows,
    allProjects: PROJECTS, allMaterials: [], allPrItems: PR_ITEMS,
    allReceivingItems: RECEIVING_ITEMS, allRequests: [], allReceivings: rows, allVendors: VENDORS,
    refresh: noop, say: noop, onDelete: noop, setPage: noop, ...extra
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, root, document }
}

console.log('=== E. INTEGRASI UI LEDGER PER BARANG (ModuleView + form asli) ===\n')

// ---------- E1: mode LEGACY ----------
console.log('E1. Mode LEGACY (skema belum ada) — tidak menjanjikan yang tidak tersimpan')
{
  mock.__reset({ receivingItems: RECEIVING_ITEMS })
  CAP.resetReceiptCapability()
  const { document: doc } = mount('receivings', RECEIVINGS)
  await settle()
  const text = doc.body.textContent || ''
  check('E1a banner capability tampil di halaman', !!doc.querySelector('[data-testid="receipt-capability-banner"]'))
  check('E1a2 banner jujur menyebut belum aktif + tidak ditulis setengah', /belum aktif/.test(doc.querySelector('[data-testid="receipt-capability-banner"]')?.textContent || '') && /Tidak ada data yang ditulis setengah/.test(doc.querySelector('[data-testid="receipt-capability-banner"]')?.textContent || ''))
  check('E1b tombol "Retur Rusak" TIDAK ada (belum ada sumber data rusak)', !doc.querySelector('[data-testid="btn-retur-rc1"]'))
  check('E1c tombol Terima Barang tetap ada', !!doc.querySelector('[data-testid="btn-terima-rc1"]'))
  click(doc.querySelector('[data-testid="btn-terima-rc1"]'))
  await settle()
  const banner = doc.querySelector('[data-testid="receipt-capability"]').textContent
  check('E1d banner jujur: penyimpanan per barang belum aktif', /belum aktif/i.test(banner))
  check('E1e banner menyebut tidak ada data yang ditulis', /Tidak ada data yang ditulis/i.test(banner))
  check('E1f banner menyebut task migrasi (t_03b41644)', /t_03b41644/.test(banner))
  // isi rusak → gap note muncul, submit diblok dengan pesan (nol tulisan)
  typeInto(doc, doc.querySelector('[data-testid="datang-ri1"]'), '2')
  await settle()
  typeInto(doc, doc.querySelector('[data-testid="rusak-ri1"]'), '1')
  await settle()
  check('E1g panel gap skema tampil saat rusak diisi', !!doc.querySelector('[data-testid="schema-gap-note"]'))
  const f = doc.querySelector('[data-testid="receipt-form"]')
  flushSync(() => f.requestSubmit())
  await settle()
  check('E1h submit diblok dengan pesan gap', /Belum dapat disimpan/.test(doc.querySelector('[data-testid="receipt-error"]')?.textContent || ''))
  check('E1i NOL tulisan DB (tidak ada insert/update/rpc)', mock.__callsOf('insert').length === 0 && mock.__callsOf('update').length === 0 && mock.__rpcCalls().length === 0)
}

// ---------- E2: mode READY ----------
console.log('\nE2. Mode READY (skema ada) — retur & konfirmasi per barang aktif')
{
  mock.__reset({
    receivingItems: RECEIVING_ITEMS,
    tables: ['receiving_events', 'handover_items', 'v_receipt_progress', 'receiving_items', 'receivings', 'handovers'],
    events: [
      { id: 'e1', receiving_id: 'rc1', receiving_item_id: 'ri1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 5, qty_rusak: 2, tujuan_ws: 1, tujuan_tukang: 2, penerima_tukang: 'Pak Joko', retur_status: 'NONE', retur_qty: 0, created_at: '2026-10-17T01:00:00Z' }
    ],
    handoverItems: [],
    handovers: HANDOVERS
  })
  CAP.resetReceiptCapability()
  const { document: doc } = mount('receivings', RECEIVINGS)
  await settle(10)
  check('E2a banner hijau: penyimpanan per barang AKTIF', /aktif/i.test(doc.querySelector('[data-testid="receipt-capability-banner"]')?.textContent || ''))
  check('E2b tombol "Retur Rusak" muncul', !!doc.querySelector('[data-testid="btn-retur-rc1"]'))
  click(doc.querySelector('[data-testid="btn-retur-rc1"]'))
  await settle(10)
  const returForm = doc.querySelector('[data-testid="return-form"]')
  check('E2c form retur terbuka', !!returForm)
  const lines = returForm ? returForm.textContent : ''
  check('E2d baris rusak dari event (Triplek, tanpa ketik ulang)', /Triplek 9mm/.test(lines))
  check('E2e qty rusak & tindakan tampil', /rusak/.test(lines) && /Kembalikan ke supplier/.test(lines))
  check('E2f tidak ada input nama barang (hanya pilih baris)', !returForm?.querySelector('input[placeholder*="nama barang" i]'))
  check('E2g catatan anti double-cost tampil', /tidak mengurangi jumlah yang sudah diterima/.test(lines))
  const submit = doc.querySelector('[data-testid="return-submit"]')
  check('E2h submit aktif karena baris otomatis terpilih', submit && submit.disabled === false)
  flushSync(() => doc.querySelector('[data-testid="return-form"]').requestSubmit())
  await settle(10)
  check('E2i retur menulis lewat RPC return_create', mock.__rpcCalls('return_create').length === 1)
  check('E2j payload memakai receiving_event_id (bukan input ulang)', (() => { const a = mock.__rpcCalls('return_create')[0].args; return a.p_lines[0].receiving_event_id === 'e1' })())
}

console.log('\nE2b. Konfirmasi fisik Handover — prefill alokasi tukang')
{
  mock.__reset({
    tables: ['receiving_events', 'handover_items', 'v_receipt_progress', 'receiving_items', 'receivings', 'handovers'],
    events: [
      { id: 'e1', receiving_id: 'rc1', receiving_item_id: 'ri1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 5, qty_rusak: 0, tujuan_ws: 1, tujuan_tukang: 4, penerima_tukang: 'Pak Joko', retur_status: 'NONE', retur_qty: 0, created_at: '2026-10-17T01:00:00Z' }
    ],
    handoverItems: [],
    handovers: HANDOVERS
  })
  CAP.resetReceiptCapability()
  const { document: doc } = mount('handovers', HANDOVERS)
  await settle(10)
  check('E2b1 tombol konfirmasi ada', !!doc.querySelector('[data-testid="btn-deliver-h1"]'))
  click(doc.querySelector('[data-testid="btn-deliver-h1"]'))
  await settle(12)
  const cf = doc.querySelector('[data-testid="handover-confirm-form"]')
  check('E2b2 modal konfirmasi terbuka (bukan langsung menandai)', !!cf)
  check('E2b3 banner rincian per barang AKTIF', /AKTIF/.test(doc.querySelector('[data-testid="handover-confirm-capability"]')?.textContent || ''))
  check('E2b4 baris prefill dari alokasi tukang', /Triplek 9mm/.test(cf?.textContent || ''))
  const qtyInput = doc.querySelector('[data-testid="hc-qty-e1"]')
  check('E2b5 qty prefill = sisa alokasi (4)', qtyInput && qtyInput.value === '4')
  check('E2b6 penerima prefill dari event', (doc.querySelector('[data-testid="hc-penerima-e1"]')?.value || '') === 'Pak Joko')
  check('E2b7 NOL tulisan sebelum submit', mock.__callsOf('update').length === 0 && mock.__rpcCalls().length === 0)
  flushSync(() => cf.requestSubmit())
  await settle(12)
  check('E2b8 konfirmasi lewat RPC handover_confirm (sekali)', mock.__rpcCalls('handover_confirm').length === 1)
  check('E2b9 payload qty = 4 (tanpa ketik ulang)', mock.__rpcCalls('handover_confirm')[0].args.p_lines[0].qty_diserahkan === 4)
  check('E2b10 diserahkan_at tertulis', !!mock.__state.rows.get('handovers:h1')?.diserahkan_at)
  check('E2b11 handover_items tersimpan', mock.__state.handoverItems.length === 1)
}

console.log('\nE2c. Konfirmasi ulang tidak menggandakan (idempoten dari UI)')
{
  const { document: doc } = mount('handovers', [{ ...HANDOVERS[0], status: 'CONFIRMED', diserahkan_at: '2026-10-17T09:00:00Z' }])
  await settle(10)
  check('E2c1 handover yang sudah diserahkan tidak punya tombol', !doc.querySelector('[data-testid="btn-deliver-h1"]'))
  check('E2c2 tanda ✓ statis tampil', !!doc.querySelector('[data-testid="delivered-h1"]'))
}

console.log('\nE3. "Pecah per Vendor" hanya untuk nota multi-vendor yang belum bergerak')
{
  mock.__reset({ receivingItems: RECEIVING_ITEMS, tables: ['receiving_items', 'receivings'] })
  CAP.resetReceiptCapability()
  const { document: doc } = mount('receivings', RECEIVINGS)
  await settle(8)
  check('E3a nota multi-vendor belum bergerak → tombol muncul', !!doc.querySelector('[data-testid="btn-pecah-rc1"]'))
  check('E3b nota yang sudah masuk gudang → tombol tidak muncul', !doc.querySelector('[data-testid="btn-pecah-rc2"]'))
  const btn = doc.querySelector('[data-testid="btn-pecah-rc1"]')
  check('E3c label jelas "Pecah per Vendor"', /Pecah per Vendor/.test(btn?.textContent || ''))
}

console.log('\nE4. Mode READY: simpan penerimaan per barang lewat SATU RPC')
{
  mock.__reset({
    receivingItems: RECEIVING_ITEMS,
    tables: ['receiving_events', 'handover_items', 'v_receipt_progress', 'receiving_items', 'receivings', 'handovers']
  })
  CAP.resetReceiptCapability()
  const { document: doc } = mount('receivings', [RECEIVINGS[0]])
  await settle(10)
  click(doc.querySelector('[data-testid="btn-terima-rc1"]'))
  await settle(10)
  const setV = (tid, v) => typeInto(doc, doc.querySelector(`[data-testid="${tid}"]`), v)
  setV('datang-ri1', '6'); await settle()
  setV('rusak-ri1', '2'); await settle()
  setV('ws-ri1', '2'); await settle()
  setV('tukang-ri1', '2'); await settle()
  setV('penerima-ri1', 'Pak Joko'); await settle()
  check('E4a tidak ada panel gap skema di mode READY', !doc.querySelector('[data-testid="schema-gap-note"]'))
  const submit = doc.querySelector('[data-testid="receipt-submit"]')
  check('E4b submit aktif walau ada rusak/tujuan (bisa disimpan)', submit && submit.disabled === false)
  check('E4c NOL tulisan sebelum submit', mock.__rpcCalls().length === 0)
  flushSync(() => doc.querySelector('[data-testid="receipt-form"]').requestSubmit())
  await settle(12)
  check('E4d submit memanggil RPC receipt_apply_events', mock.__rpcCalls('receipt_apply_events').length === 1)
  const args = mock.__rpcCalls('receipt_apply_events')[0]?.args || {}
  check('E4e payload membawa dimensi rusak/tujuan/retur', (args.p_events || [])[0]?.qty_rusak === 2 && (args.p_events || [])[0]?.tujuan_tukang === 2)
  check('E4f quantity_received terisi dari Σ datang', mock.__state.rows.get('receiving_items:ri1')?.quantity_received === 6)
  check('E4g modal tertutup setelah sukses', !doc.querySelector('[data-testid="receipt-form"]'))
}

console.log('\n---------------------------------------------')
console.log(`render_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(', ') : ''}`)
if (fail) process.exit(1)
