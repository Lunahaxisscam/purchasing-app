// ============================================================
// probe_run233_return_layer_state.mjs — KUNCI PERBAIKAN REVIEW RUN 231
// ============================================================
// Review run 231 memblok task ini dengan satu akar: keadaan "ledger INTI siap,
// layer RETUR belum" (`ready:true`, `returnReady:false`) tidak punya nama.
// Akibatnya `capabilityState()` menjawab 'ready', `capabilityMessage()` kosong,
// dan tiga layar berbohong sekaligus:
//
//   T1 (MAJOR)  panel Bermasalah menawarkan "Buka Form Retur (per barang)",
//               lalu ReturnForm berkata "tidak ada barang rusak" untuk
//               penerimaan yang punya rusak 2.
//   T2 (MAJOR)  receiptForm mengklaim "retur tersimpan permanen" padahal
//               `return_lines` tidak ada → dropdown retur buntu.
//   T3 (MAJOR)  probe `return_lines` gagal (GRANT/RLS 42501) = SENYAP, karena
//               `probeFailed` dihitung `!coreReady && indeterminate`.
//
// Probe ini mengunci PERILAKU yang benar, dan yang lebih penting: menguji
// PERMUKAAN yang tidak diuji reviewer —
//   (a) apakah jalur read-only benar-benar BISA DICAPAI dari antrean,
//   (b) apakah di keadaan itu penulisan tetap NOL (bukan cuma tombolnya mati),
//   (c) apakah keadaan `ready` sejati TIDAK ikut berubah perilakunya.
//
// Dijalankan SESUDAH harness utama oleh run.py; exit code dilaporkan terpisah.
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
const PM = await importDist('modules/handovers/physicalModal.mjs')
const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default
const ReceiptForm = (await importDist('modules/handovers/receiptForm.mjs')).default
const ConfirmForm = (await importDist('modules/handovers/confirmForm.mjs')).default

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
const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
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
  return dom0.window.document
}

const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-BARU', delivery_note: 'Nota INV-BARU', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const RI = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 }]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
const PR_ITEMS = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' }]
// Barang rusak 2 SUDAH tercatat, tujuan tukang 4 — data per barang nyata.
const EVENTS = [{
  id: 'ev1', client_event_id: 'rcpt:rec1:ri1:0->6', receiving_id: 'rec1', receiving_item_id: 'ri1',
  pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2,
  tujuan_ws: 0, tujuan_tukang: 4, penerima_tukang: 'Pak Joko', retur_status: 'PENDING', retur_qty: 2,
  discard_confirmed: false, foto_ref: null, source: 'ui', created_at: '2026-10-21T00:00:00Z'
}]
const PROGRESS = [{ receiving_item_id: 'ri1', qty_datang: 6, qty_rusak: 2, qty_baik: 4, belum_diserahkan: 4, qty_bought: 10, qty_arrived: 6, qty_handed_over: 0, tujuan_tukang: 4 }]

// Dua jalan masuk NYATA ke keadaan yang diuji:
//   (a) file 03_return_layer.sql belum dijalankan → PGRST205
//   (b) file 03 ADA tetapi SELECT ditolak → 42501 (GRANT/RLS)
const RETURN_MISSING = { code: 'PGRST205', message: "Could not find the table 'public.return_lines' in the schema cache", details: null, hint: null }
const RETURN_DENIED = { code: '42501', message: 'permission denied for table return_lines', details: null, hint: null }

function renderQueue({ returnErr = RETURN_MISSING, ledger = null } = {}) {
  const L = ledger || {
    receivingEvents: EVENTS, handoverItems: [], returnLines: null, returnCases: null, progress: PROGRESS
  }
  mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }], ledger: L })
  PM.resetPhysicalModal()
  CAP.resetReceiptCapability()
  const origFrom = mock.supabase.from
  if (returnErr) {
    mock.supabase.from = (table) => {
      if (table === 'return_lines') {
        return {
          select() { return this },
          limit() { return Promise.resolve({ data: null, error: returnErr }) },
          in() { return this },
          then(res) { return Promise.resolve({ data: null, error: returnErr }).then(res) }
        }
      }
      return origFrom(table)
    }
  }
  const says = []
  let rerender = () => {}
  const ctx = {
    rows: [mock.__state.handovers.get('h1')].filter(Boolean),
    H: { receivingItemsForReceiving: (id) => RI.filter(r => r.receiving_id === id), prItemsForPr: () => PR_ITEMS },
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
  return { doc, says, restore: () => { mock.supabase.from = origFrom } }
}

// ============================================================
console.log('\n=== 1. capabilityState(): keadaan KEENAM punya nama sendiri ===\n')
// ============================================================
{
  const coreOnly = { ready: true, returnReady: false, events: true, handoverItems: true, returnLines: false, progress: true, probeFailed: false, missing: ['retur: tabel return_lines belum ada'] }
  const st = CAP.capabilityState(coreOnly)
  console.log(`     ready=true returnReady=false → ${st}`)
  check('1a BUKAN "ready" (dulu disimpulkan semua siap)', st !== 'ready', st)
  check('1b BUKAN "legacy"/"partial" (ledger inti SUDAH terbaca)', st !== 'legacy' && st !== 'partial', st)
  check('1c nama keadaan = ready_no_return', st === 'ready_no_return', st)
  // Kontrak pembeda yang dipakai semua layar. Di pohon PRA-perbaikan fungsi ini
  // belum ada — probe harus MELAPORKAN itu, bukan crash (supaya profil RED
  // lengkap terbaca).
  const hasHelpers = typeof CAP.coreLedgerReady === 'function' && typeof CAP.returnLayerReady === 'function'
  check('1d coreLedgerReady() tersedia', hasHelpers)
  check('1e coreLedgerReady() TRUE (penerimaan/serah terima tetap boleh)', hasHelpers && CAP.coreLedgerReady(coreOnly) === true)
  check('1f returnLayerReady() FALSE (retur belum boleh)', hasHelpers && CAP.returnLayerReady(coreOnly) === false)
  // Pesan tidak boleh kosong dan harus menyebut retur.
  const msg = CAP.capabilityMessage(coreOnly)
  check('1g ada pesan yang bisa dibaca admin (bukan string kosong)', String(msg).trim().length > 40, JSON.stringify(msg))
  check('1h pesan menyebut retur belum bisa dipakai', /retur/i.test(msg) && /BELUM/i.test(msg), JSON.stringify(msg).slice(0, 160))
  check('1i pesan TIDAK menyebut "belum aktif" untuk keseluruhan fitur', !/Penyimpanan per barang.*belum aktif/i.test(msg), JSON.stringify(msg).slice(0, 120))
  // READY sejati tidak boleh ikut berubah.
  const full = { ready: true, returnReady: true, events: true, handoverItems: true, returnLines: true, progress: true, probeFailed: false, missing: [] }
  check('1j READY sejati tetap "ready"', CAP.capabilityState(full) === 'ready')
  check('1k READY sejati tetap tanpa pesan', CAP.capabilityMessage(full) === '')
  check('1l READY sejati: returnLayerReady() TRUE', hasHelpers ? CAP.returnLayerReady(full) === true : CAP.capabilityState(full) === 'ready')
}

// ============================================================
console.log('\n=== 2. Probe `return_lines` GAGAL (42501) tidak boleh SENYAP ===\n')
// ============================================================
{
  const { restore } = renderQueue({ returnErr: RETURN_DENIED })
  const cap = await CAP.getReceiptCapability({ force: true })
  restore()
  console.log(`     cap = ready:${cap.ready} returnReady:${cap.returnReady} probeFailed:${cap.probeFailed} returnProbeFailed:${cap.returnProbeFailed}`)
  check('2a ledger inti tetap dinilai siap (ready=true)', cap.ready === true)
  check('2b returnReady=false', cap.returnReady === false)
  check('2c probeFailed=TRUE (kegagalan RLS terlihat, bukan disimpulkan "tidak ada")', cap.probeFailed === true, String(cap.probeFailed))
  check('2d returnProbeFailed=TRUE (sebabnya hak akses, bukan "belum dimigrasi")', cap.returnProbeFailed === true, String(cap.returnProbeFailed))
  const st = CAP.capabilityState(cap)
  const msg = CAP.capabilityMessage(cap)
  check('2e state = ready_no_return', st === 'ready_no_return', st)
  check('2f pesan menyebut sebabnya hak akses/RLS, bukan "belum ada"', /hak akses|RLS/i.test(msg), JSON.stringify(msg).slice(0, 200))
}

// ============================================================
console.log('\n=== 3. Antrean: banner jujur + NOL jalur tulis retur ===\n')
// ============================================================
{
  const { doc, restore } = renderQueue({ returnErr: RETURN_MISSING })
  for (let i = 0; i < 14; i++) await tick()
  const banner = tid(doc, 'handover-capability')
  console.log(`     banner state = ${banner?.getAttribute('data-capability-state')}`)
  check('3a banner TAMPIL (dulu disembunyikan karena cap.ready=true)', !!banner)
  check('3b banner state = ready_no_return', banner?.getAttribute('data-capability-state') === 'ready_no_return',
    banner?.getAttribute('data-capability-state'))
  const bannerTxt = txt(banner)
  check('3c banner menyatakan penerimaan/serah terima AKTIF', /AKTIF/i.test(bannerTxt), bannerTxt.slice(0, 140))
  check('3d banner menyatakan RETUR belum siap', /retur/i.test(bannerTxt) && /belum/i.test(bannerTxt), bannerTxt.slice(0, 200))

  // Panel Bermasalah
  click(tid(doc, 'queue-problem-h1'))
  for (let i = 0; i < 4; i++) await tick()
  const panel = tid(doc, 'queue-problem-panel-h1')
  const panelTxt = txt(panel)
  console.log(`     panel = ${JSON.stringify(panelTxt.slice(0, 200))}`)
  check('3e panel Bermasalah TIDAK menawarkan form retur per baris', !/Buka Form Retur \(per barang\)/i.test(panelTxt))
  check('3f panel Bermasalah TIDAK menawarkan status header (Retur ke Supplier/Refund)',
    !/Retur ke Supplier|💸 Refund/i.test(panelTxt))
  check('3g panel menjelaskan retur belum bisa dicatat', /retur/i.test(panelTxt) && /BELUM/i.test(panelTxt))
  check('3h panel menawarkan jalan READ-ONLY untuk MELIHAT barang rusak',
    !!tid(doc, 'queue-problem-view-h1'), 'tombol lihat tidak ada')

  // Aksi borongan & penutup: borongan harus mati, penutup boleh (ledger inti siap).
  check('3i aksi borongan Gudang NONAKTIF (tujuan per barang utuh)', tid(doc, 'queue-act-gudang-h1')?.disabled === true)
  check('3j aksi borongan Tukang NONAKTIF', tid(doc, 'queue-act-tukang-h1')?.disabled === true)
  check('3k tombol penutup Serah Terima AKTIF (tidak butuh tabel retur)', tid(doc, 'queue-act-terima-h1')?.disabled === false,
    `disabled=${tid(doc, 'queue-act-terima-h1')?.disabled}`)
  restore()
}

// ============================================================
console.log('\n=== 4. Jalan READ-ONLY: data rusak TERLIHAT, tapi NOL tulisan ===\n')
// ============================================================
{
  const { doc, restore } = renderQueue({ returnErr: RETURN_MISSING })
  for (let i = 0; i < 14; i++) await tick()
  click(tid(doc, 'queue-problem-h1'))
  await tick()
  const ok = click(tid(doc, 'queue-problem-view-h1'))
  check('4a tombol "Lihat barang rusak" bisa diklik', ok === true)
  for (let i = 0; i < 10; i++) await tick()
  const form = tid(doc, 'return-form')
  check('4b form retur terbuka (read-only)', !!form)
  const capPanel = tid(doc, 'return-capability')
  console.log(`     panel state = ${capPanel?.getAttribute('data-capability-state')}`)
  check('4c panel capability state = ready_no_return', capPanel?.getAttribute('data-capability-state') === 'ready_no_return')
  const capTxt = txt(capPanel)
  check('4d panel TIDAK kosong', capTxt.length > 40, JSON.stringify(capTxt))
  // INTI T1: barang rusak yang ADA harus terlihat.
  const blocked = tid(doc, 'return-blocked')
  const blockedTxt = txt(blocked)
  console.log(`     daftar barang = ${JSON.stringify(blockedTxt.slice(0, 200))}`)
  check('4e barang rusak YANG ADA ditampilkan (bukan "tidak ada")', !!blocked && /Triplek 9mm/.test(blockedTxt), blockedTxt.slice(0, 120))
  check('4f qty rusak 2 terlihat', /rusak\s*2/.test(blockedTxt), blockedTxt.slice(0, 120))
  check('4g panel kosong TIDAK berkata "tidak ada barang rusak"',
    !/Tidak ada barang rusak yang tercatat/i.test(txt(tid(doc, 'return-empty'))))
  check('4h TIDAK berkata "menunggu migrasi skema" (data sudah ADA)',
    !/menunggu migrasi skema/i.test(txt(form)))
  check('4i TIDAK ada checkbox baris retur (tidak bisa dipilih)', doc.querySelectorAll('[data-testid^="return-line-"]').length === 0,
    `ada ${doc.querySelectorAll('[data-testid^="return-line-"]').length} baris`)
  check('4j TIDAK ada tombol Simpan Retur', !tid(doc, 'return-submit'))
  check('4k NOL panggilan RPC dari seluruh alur', mock.__callsOf('rpc').length === 0, JSON.stringify(mock.__callsOf('rpc').map(r => r.fn)))
  check('4l NOL tulisan ke tabel mana pun', mock.__callsOf('update').length + mock.__callsOf('insert').length === 0,
    JSON.stringify([...mock.__callsOf('update'), ...mock.__callsOf('insert')].map(c => c.table)))
  restore()
}

// ============================================================
console.log('\n=== 5. receiptForm: klaim "retur tersimpan permanen" HANYA bila returnReady ===\n')
// ============================================================
{
  const coreOnly = { ready: true, returnReady: false, events: true, handoverItems: true, returnLines: false, progress: true, probeFailed: false, missing: ['retur: tabel return_lines belum ada'] }
  mock.__reset({ receivings: [{ ...REC }], prItems: [], receivingItems: RI, handovers: [], ledger: null })
  const doc = mount(React.createElement(ReceiptForm, {
    receiving: REC, items: RI, orderedFor: () => 10, capability: coreOnly,
    say: () => {}, refresh: () => {}, close: () => {}
  }))
  await tick(); await tick()
  const panelTxt = txt(tid(doc, 'receipt-capability'))
  console.log(`     panel = ${JSON.stringify(panelTxt.slice(0, 200))}`)
  check('5a TIDAK mengklaim "retur tersimpan permanen"', !/retur tersimpan permanen/i.test(panelTxt))
  check('5b TIDAK mengklaim "Penyimpanan per barang AKTIF" (menyiratkan semua dimensi)', !/Penyimpanan per barang AKTIF/i.test(panelTxt))
  check('5c menyatakan kedatangan/rusak/tujuan TETAP tersimpan', /tersimpan permanen/i.test(panelTxt))
  check('5d menyatakan retur BELUM bisa ditindaklanjuti', /retur belum bisa ditindaklanjuti/i.test(panelTxt), panelTxt.slice(0, 200))
  // Form tetap bisa menyimpan kedatangan (ledger inti siap) — jangan ikut mati.
  check('5e form penerimaan TETAP bisa dipakai (baris input ada)', !!tid(doc, 'rc-datang-ri1'))
}

// ============================================================
console.log('\n=== 6. confirmForm: serah terima TIDAK ikut mati karena retur belum siap ===\n')
// ============================================================
{
  const coreOnly = { ready: true, returnReady: false, events: true, handoverItems: true, returnLines: false, progress: true, probeFailed: false, missing: ['retur: tabel return_lines belum ada'] }
  mock.__reset({
    receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }],
    ledger: { receivingEvents: EVENTS, handoverItems: [], returnLines: null, returnCases: null, progress: PROGRESS }
  })
  const doc = mount(React.createElement(ConfirmForm, {
    handover: HO, capability: coreOnly, say: () => {}, refresh: () => {}, close: () => {}
  }))
  for (let i = 0; i < 10; i++) await tick()
  const cap = tid(doc, 'handover-confirm-capability')
  console.log(`     state = ${cap?.getAttribute('data-capability-state')}`)
  check('6a state = ready_no_return (bukan "ready")', cap?.getAttribute('data-capability-state') === 'ready_no_return')
  const capTxt = txt(cap)
  check('6b rincian per barang dinyatakan AKTIF', /Rincian per barang AKTIF/i.test(capTxt), capTxt.slice(0, 120))
  check('6c disebutkan bahwa retur belum aktif', /retur/i.test(capTxt) && /belum/i.test(capTxt), capTxt.slice(0, 240))
  // Baris prefill harus benar-benar dimuat (bukan panel kosong karena 'pending').
  const line = doc.querySelector('[data-testid="handover-confirm-lines"]')
  check('6d baris prefill dari alokasi tukang tetap dimuat', !!line && !!tid(doc, 'hc-qty-ev1'), 'tidak ada baris prefill')
  check('6e TIDAK jatuh ke jalur header-only (panel "tidak ada alokasi" tidak muncul)', !tid(doc, 'handover-confirm-empty'))
}

// ============================================================
console.log('\n=== 7. READY sejati: tidak ada regresi perilaku ===\n')
// ============================================================
{
  const fullLedger = { receivingEvents: EVENTS, handoverItems: [], returnLines: [], returnCases: [], progress: PROGRESS }
  const { doc, restore } = renderQueue({ returnErr: null, ledger: fullLedger })
  for (let i = 0; i < 14; i++) await tick()
  check('7a READY: banner capability disembunyikan', !tid(doc, 'handover-capability'))
  click(tid(doc, 'queue-problem-h1'))
  await tick()
  const panelTxt = txt(tid(doc, 'queue-problem-panel-h1'))
  check('7b READY: panel Bermasalah menawarkan form retur per baris', /Buka Form Retur \(per barang\)/i.test(panelTxt), panelTxt.slice(0, 120))
  check('7c READY: TIDAK ada tombol read-only', !tid(doc, 'queue-problem-view-h1'))
  restore()
}

console.log(`\n=== HASIL PROBE RUN 233: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
