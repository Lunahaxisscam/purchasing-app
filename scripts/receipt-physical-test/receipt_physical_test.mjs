// ============================================================
// TEST — Ledger FISIK per barang di UI NYATA (jsdom interaktif)
// t_7bc6246b · modul hasil transform SWC, mock supabase perekam, tanpa DB.
// PENTING URUTAN: env jsdom dibuat SEBELUM react-dom diimpor.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// ---------- 1) DOM environment dulu ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
global.HTMLElement = dom0.window.HTMLElement
global.HTMLInputElement = dom0.window.HTMLInputElement
global.HTMLSelectElement = dom0.window.HTMLSelectElement
global.Event = dom0.window.Event
global.FileReader = dom0.window.FileReader

// ---------- 2) React & komponen ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

const importDist = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)
const Q = await importDist('modules/handovers/queue.mjs')
const V = await importDist('modules/handovers/view.mjs')
const PM = await importDist('modules/handovers/physicalModal.mjs')
const RLOGIC = await importDist('modules/receivings/receiptLogic.mjs')
const ELOGIC = await importDist('modules/receivings/receiptEventLogic.mjs')
const CAP = await importDist('modules/receivings/receiptCapability.mjs')

// Capability probe punya cache TTL 60 detik (benar untuk produksi: tidak query
// tiap render). Di test, setiap skenario mengganti isi skema, jadi cache WAJIB
// dilupakan — kalau tidak, skenario kedua mewarisi hasil skenario pertama.
function resetCapability() { CAP.resetReceiptCapability() }

// ---------- 3) Helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })))
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)

function mount(el) {
  // Bersihkan root sebelumnya: semua mount memakai SATU document global, jadi
  // tanpa ini querySelector menemukan form LAMA (stale) dan test berbohong.
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
const mountedRoots = []

// Input terkontrol React: set .value lewat native setter lalu kirim event.
function typeInto(el, value) {
  const proto = el.tagName === 'SELECT' ? dom0.window.HTMLSelectElement.prototype : dom0.window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  flushSync(() => {
    setter.call(el, value)
    el.dispatchEvent(new dom0.window.Event('input', { bubbles: true }))
    el.dispatchEvent(new dom0.window.Event('change', { bubbles: true }))
  })
}

// ---------- 4) Fixture ----------
const REC = {
  id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1',
  status: 'NORMAL', invoice_no: 'INV-1', delivery_note: 'Nota INV-1',
  note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null
}
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar' },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng' }
]
// qty_arrived=0 padahal quantity_received (BELI) 10 → sisa HARUS 10, bukan 0.
const RI = [
  { id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10, qty_arrived: 0 },
  { id: 'ri2', receiving_id: 'rec1', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', quantity_received: 4, qty_arrived: 2 }
]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }

const LEDGER = {
  receivingEvents: [
    { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2, tujuan_ws: 3, tujuan_tukang: 1, penerima_tukang: 'Pak Joko', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false },
    { id: 'ev2', receiving_id: 'rec1', receiving_item_id: 'ri2', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', qty_datang: 2, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 2, penerima_tukang: 'Pak Budi', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false }
  ],
  handoverItems: [],
  returnLines: [],
  returnCases: [],
  progress: []
}

const noop = () => {}

// ============================================================
console.log('\n=== R. TERIMA BARANG per item (receiptForm.jsx) ===\n')
// ============================================================
{
  console.log('R1/R3. Satu form, dimensi terpisah, sisa dari qty_arrived')
  // R3 dibuktikan di logika murni: quantity_received 10 tapi qty_arrived 0.
  const rows = RLOGIC.buildRows(RI, (it) => (it.pr_item_id === 'pi1' ? 10 : 4))
  check('R3a sisa item1 = 10 (dari qty_arrived 0, BUKAN quantity_received 10)', rows[0].sisa === 10, String(rows[0].sisa))
  check('R3b sisa item2 = 2 (qty_arrived 2 dari pesanan 4)', rows[1].sisa === 2, String(rows[1].sisa))
  check('R3c qty BELI tetap terbaca terpisah (10)', rows[0].bought === 10, String(rows[0].bought))
  // Bila memakai quantity_received (bug lama), sisa item1 = 0 → terbukti beda.
  const buggy = RLOGIC.buildRows([{ ...RI[0], qty_arrived: undefined }], () => 10)
  check('R3d tanpa qty_arrived sisa = 10 (tidak jatuh ke qty BELI)', buggy[0].sisa === 10, String(buggy[0].sisa))

  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: null })
  PM.resetPhysicalModal(); resetCapability()
  const ReceiptForm = (await importDist('modules/handovers/receiptForm.mjs')).default
  const says = []
  const { document: doc } = mount(
    React.createElement(ReceiptForm, {
      receiving: REC, items: RI,
      orderedFor: (it) => (it.pr_item_id === 'pi1' ? 10 : 4),
      capability: { ready: false, missing: ['tabel receiving_events belum ada'] },
      say: (m) => says.push(m), refresh: noop, close: noop
    })
  )
  check('R1a form Terima Barang tampil', !!tid(doc, 'receipt-form'))
  check('R1b baris per barang tampil (2)', !!tid(doc, 'receipt-line-ri1') && !!tid(doc, 'receipt-line-ri2'))
  check('R1c input datang/rusak/ws/tukang ada per barang',
    !!tid(doc, 'rc-datang-ri1') && !!tid(doc, 'rc-rusak-ri1') && !!tid(doc, 'rc-ws-ri1') && !!tid(doc, 'rc-tukang-ri1'))
  check('R1d input retur & penerima ada', !!tid(doc, 'rc-retur-ri1') && !!tid(doc, 'rc-penerima-ri1'))
  check('R1e foto OPSIONAL (input file ada, bukan wajib)', !!tid(doc, 'rc-foto-ri1'))
  check('R1f label qty BELI vs DATANG dibedakan di baris',
    /dibeli/i.test(tid(doc, 'receipt-line-ri1').textContent) && /sudah datang/i.test(tid(doc, 'receipt-line-ri1').textContent))

  console.log('\nR4. Mode LEGACY: blokir dengan pesan gap, NOL tulisan')
  typeInto(tid(doc, 'rc-datang-ri1'), '6')
  await tick()
  click(tid(doc, 'receipt-submit'))
  await tick(); await tick()
  const err = tid(doc, 'receipt-error')
  check('R4a submit diblok dengan pesan gap', !!err && /belum aktif|belum ada/i.test(err.textContent), err?.textContent)
  check('R4b NOL panggilan RPC', mock.__callsOf('rpc').length === 0, JSON.stringify(mock.__callsOf('rpc')))
  check('R4c NOL insert/update', mock.__callsOf('insert').length === 0 && mock.__callsOf('update').length === 0)
  check('R4d tidak ada klaim tersimpan', says.length === 0, JSON.stringify(says))
}

// ============================================================
{
  console.log('\nR5/R6/R7. Mode READY: RPC nyata, sekali, validasi dulu')
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  PM.resetPhysicalModal(); resetCapability()
  const ReceiptForm = (await importDist('modules/handovers/receiptForm.mjs')).default
  const says = []
  let closed = 0
  const { document: doc } = mount(
    React.createElement(ReceiptForm, {
      receiving: REC, items: RI,
      orderedFor: (it) => (it.pr_item_id === 'pi1' ? 10 : 4),
      capability: { ready: true, returnReady: true, missing: [] },
      say: (m) => says.push(m), refresh: noop, close: () => { closed++ }
    })
  )
  check('R5a mode READY memberi tahu penyimpanan aktif', /AKTIF/i.test(tid(doc, 'receipt-capability')?.textContent || ''))

  // R7 lebih dulu: over-receipt (sisa item2 = 2, isi 5) → nol RPC.
  typeInto(tid(doc, 'rc-datang-ri2'), '5')
  await tick()
  click(tid(doc, 'receipt-submit'))
  await tick(); await tick()
  check('R7a over-receipt ditolak sebelum RPC', mock.__callsOf('rpc').length === 0, JSON.stringify(mock.__callsOf('rpc')))
  check('R7b pesan menyebut sisa pesanan', /sisa pesanan/i.test(tid(doc, 'receipt-error')?.textContent || ''), tid(doc, 'receipt-error')?.textContent)

  // Isi valid: item1 datang 6 rusak 2 ws 3 tukang 1 penerima; item2 datang 2.
  typeInto(tid(doc, 'rc-datang-ri2'), '2')
  typeInto(tid(doc, 'rc-datang-ri1'), '6')
  typeInto(tid(doc, 'rc-rusak-ri1'), '2')
  typeInto(tid(doc, 'rc-ws-ri1'), '3')
  typeInto(tid(doc, 'rc-tukang-ri1'), '1')
  typeInto(tid(doc, 'rc-penerima-ri1'), 'Pak Joko')
  await tick()
  check('R5b baik = datang − rusak ditampilkan (4)', /=\s*4/.test(tid(doc, 'rc-hitung-ri1')?.textContent || ''), tid(doc, 'rc-hitung-ri1')?.textContent)
  check('R5c belum ada tulisan sebelum submit', mock.__callsOf('rpc').length === 0)

  click(tid(doc, 'receipt-submit'))
  await tick(); await tick(); await tick()
  const rpcs = mock.__callsOf('rpc')
  check('R5d TEPAT satu panggilan RPC', rpcs.length === 1, String(rpcs.length))
  check('R5e RPC = receipt_apply_events', rpcs[0]?.fn === 'receipt_apply_events', rpcs[0]?.fn)
  check('R5f parameter p_receiving_id benar', rpcs[0]?.args?.p_receiving_id === 'rec1', JSON.stringify(rpcs[0]?.args?.p_receiving_id))
  const evs = rpcs[0]?.args?.p_events || []
  check('R5g dua event dikirim (satu per barang yang datang)', evs.length === 2, String(evs.length))
  check('R5h event memuat dimensi terpisah (datang/rusak/ws/tukang)',
    evs[0].qty_datang === 6 && evs[0].qty_rusak === 2 && evs[0].tujuan_ws === 3 && evs[0].tujuan_tukang === 1,
    JSON.stringify(evs[0]))
  check('R5i client_event_id deterministik ada', /^rcpt:rec1:ri1:0->6$/.test(evs[0].client_event_id), evs[0].client_event_id)
  check('R5j tidak mengirim field internal _computed', evs.every(e => !('_computed' in e)))
  check('R5k user diberi tahu hasil tersimpan', says.some(m => /Penerimaan tersimpan/i.test(m)), JSON.stringify(says))
  check('R5l modal ditutup setelah sukses', closed === 1, String(closed))
}

// ============================================================
{
  console.log('\nR6. Double submit → tetap satu panggilan RPC')
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  PM.resetPhysicalModal(); resetCapability()
  const ReceiptForm = (await importDist('modules/handovers/receiptForm.mjs')).default
  const { document: doc } = mount(
    React.createElement(ReceiptForm, {
      receiving: REC, items: RI,
      orderedFor: (it) => (it.pr_item_id === 'pi1' ? 10 : 4),
      capability: { ready: true, returnReady: true, missing: [] },
      say: noop, refresh: noop, close: noop
    })
  )
  typeInto(tid(doc, 'rc-datang-ri1'), '5')
  await tick()
  // Dua klik dalam frame yang sama — ref guard harus menahan yang kedua.
  flushSync(() => {
    tid(doc, 'receipt-submit').dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true }))
    tid(doc, 'receipt-submit').dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true }))
  })
  await tick(); await tick(); await tick()
  check('R6a hanya SATU panggilan RPC walau diklik dua kali', mock.__callsOf('rpc').length === 1, String(mock.__callsOf('rpc').length))
}

// ============================================================
console.log('\n=== C. KONFIRMASI FISIK per item (confirmForm.jsx) ===\n')
// ============================================================
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  PM.resetPhysicalModal(); resetCapability()
  const ConfirmForm = (await importDist('modules/handovers/confirmForm.mjs')).default
  const says = []
  const { document: doc } = mount(
    React.createElement(ConfirmForm, {
      handover: HO, capability: { ready: true, returnReady: true, missing: [] },
      say: (m) => says.push(m), refresh: noop, close: noop
    })
  )
  await tick(); await tick(); await tick()

  check('C1a baris prefill dari alokasi tukang tampil', !!tid(doc, 'handover-confirm-lines'))
  const q1 = tid(doc, 'hc-qty-ev1')
  const q2 = tid(doc, 'hc-qty-ev2')
  check('C1b qty prefill = alokasi tukang (ev1: 1)', String(q1?.value) === '1', q1?.value)
  check('C1c qty prefill = alokasi tukang (ev2: 2)', String(q2?.value) === '2', q2?.value)
  check('C1d penerima prefill dari penerimaan', /Pak Joko/.test(tid(doc, 'hc-penerima-ev1')?.value || ''), tid(doc, 'hc-penerima-ev1')?.value)
  check('C2a qty bisa dikoreksi (input editable, bukan teks mati)', !q1.disabled && q1.tagName === 'INPUT')
  check('C2b ringkasan menghitung total', /total diserahkan/i.test(tid(doc, 'handover-confirm-summary')?.textContent || ''))
  check('C1e tidak ada tulisan DB saat form dibuka', mock.__callsOf('rpc').length === 0)

  click(tid(doc, 'handover-confirm-submit'))
  await tick(); await tick(); await tick()
  const rpcs = mock.__callsOf('rpc')
  check('C3a memanggil RPC handover_confirm', rpcs.length === 1 && rpcs[0].fn === 'handover_confirm', JSON.stringify(rpcs.map(r => r.fn)))
  check('C3b p_handover_id benar', rpcs[0]?.args?.p_handover_id === 'h1')
  check('C3c baris dikirim dengan receiving_event_id (bukan ketik ulang)', (rpcs[0]?.args?.p_lines || []).every(l => !!l.receiving_event_id))
  check('C3d TIDAK memakai update header (jalur lama)', mock.__callsOf('update', 'handovers').length === 0)
  check('C3e user diberi tahu hasil', says.some(m => /Serah terima tersimpan/i.test(m)), JSON.stringify(says))
}

// ============================================================
{
  console.log('\nC4. Mode LEGACY: jatuh ke konfirmasi header, pesan jujur')
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [{ ...HO }], ledger: null })
  PM.resetPhysicalModal(); resetCapability()
  const ConfirmForm = (await importDist('modules/handovers/confirmForm.mjs')).default
  const says = []
  const { document: doc } = mount(
    React.createElement(ConfirmForm, {
      handover: { ...HO }, capability: { ready: false, missing: ['tabel handover_items belum ada'] },
      say: (m) => says.push(m), refresh: noop, close: noop
    })
  )
  await tick()
  check('C4a memberi tahu rincian per barang belum aktif', /belum aktif|belum ada/i.test(tid(doc, 'handover-confirm-capability')?.textContent || ''))
  check('C4b NOL panggilan RPC', mock.__callsOf('rpc').length === 0)
  click(tid(doc, 'handover-confirm-submit'))
  await tick(); await tick()
  check('C4c konfirmasi header tetap menulis diserahkan_at (CAS)', mock.__callsOf('update', 'handovers').length === 1)
  check('C4d pesan menyebut rincian belum tersimpan', says.some(m => /Rincian per barang belum tersimpan/i.test(m)), JSON.stringify(says))
}

// ============================================================
console.log('\n=== T. RETUR tanpa ketik ulang (returnForm.jsx) ===\n')
// ============================================================
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  PM.resetPhysicalModal(); resetCapability()
  const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default
  const says = []
  const { document: doc } = mount(
    React.createElement(ReturnForm, {
      receiving: REC, capability: { ready: true, returnReady: true, missing: [] },
      say: (m) => says.push(m), refresh: noop, close: noop
    })
  )
  await tick(); await tick(); await tick()
  check('T1a baris retur diambil dari event rusak (ev1)', !!tid(doc, 'return-line-ev1'))
  check('T1b hanya barang rusak yang ditawarkan (ev2 rusak 0 tidak muncul)', !tid(doc, 'return-line-ev2'))
  const lineTxt = tid(doc, 'return-line-ev1')?.textContent || ''
  check('T1c nama barang terisi otomatis', /Triplek 9mm/.test(lineTxt), lineTxt)
  check('T1d qty rusak terisi otomatis (2)', /rusak\s*2/.test(lineTxt), lineTxt)
  check('T1e tidak ada input qty manual (tidak mengetik ulang)', !tid(doc, 'return-qty-ev1'))

  click(tid(doc, 'return-submit'))
  await tick(); await tick(); await tick()
  const rpcs = mock.__callsOf('rpc')
  check('T4a memanggil RPC return_create', rpcs.length === 1 && rpcs[0].fn === 'return_create', JSON.stringify(rpcs.map(r => r.fn)))
  check('T4b baris memakai receiving_event_id + qty dari event',
    rpcs[0]?.args?.p_lines?.[0]?.receiving_event_id === 'ev1' && Number(rpcs[0]?.args?.p_lines?.[0]?.qty) === 2,
    JSON.stringify(rpcs[0]?.args?.p_lines))
  check('T4c resolusi diteruskan', rpcs[0]?.args?.p_resolution === 'RETURN', rpcs[0]?.args?.p_resolution)
  check('T4d user diberi tahu retur tercatat', says.some(m => /Retur tercatat/i.test(m)), JSON.stringify(says))
}

// ============================================================
{
  console.log('\nT2/T3. Anti double-retur & riwayat tak terbaca')
  // T2: return_lines sudah berisi 2 (seluruh qty rusak) → tidak ditawarkan lagi.
  const ledgerReturned = {
    ...LEDGER,
    returnLines: [{ id: 'rl1', return_case_id: 'rc0', receiving_event_id: 'ev1', qty: 2 }]
  }
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: ledgerReturned })
  PM.resetPhysicalModal(); resetCapability()
  const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default
  const { document: doc } = mount(
    React.createElement(ReturnForm, {
      receiving: REC, capability: { ready: true, returnReady: true, missing: [] },
      say: noop, refresh: noop, close: noop
    })
  )
  await tick(); await tick(); await tick()
  check('T2a event yang sudah diretur penuh TIDAK ditawarkan', !tid(doc, 'return-line-ev1'))
  check('T2b modal menyatakan tidak ada barang rusak tersisa', !!tid(doc, 'return-empty'))
  check('T2c tombol submit tidak aktif', tid(doc, 'return-submit')?.disabled === true)

  // T3: tabel return_lines TIDAK ADA → modal menolak, bukan mengarang.
  const ledgerNoReturns = { ...LEDGER }
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: ledgerNoReturns })
  // hapus return_lines dari ledger → PGRST205
  mock.__state.ledger.returnLines = null
  PM.resetPhysicalModal(); resetCapability()
  const { document: doc2 } = mount(
    React.createElement(ReturnForm, {
      receiving: REC, capability: { ready: true, returnReady: true, missing: [] },
      say: noop, refresh: noop, close: noop
    })
  )
  await tick(); await tick(); await tick()
  check('T3a riwayat retur tak terbaca → baris TIDAK ditawarkan', !tid(doc2, 'return-line-ev1'))
  check('T3b alasan ditampilkan (bukan diam)', /Gagal memuat|Tidak bisa memeriksa/i.test(doc2.body?.textContent || doc2.documentElement.textContent || ''))
  check('T3c NOL panggilan RPC saat ragu', mock.__callsOf('rpc').length === 0)
}

// ============================================================
console.log('\n=== P. PINTU MASUK di Handover + kontrak DAT ===\n')
// ============================================================
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: null })
  PM.resetPhysicalModal(); resetCapability()
  const ctx = {
    rows: [HO], allReceivings: [REC], allReceivingItems: RI, allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    H: { receivingItemsForReceiving: () => RI, prItemsForPr: () => PR_ITEMS },
    say: noop, refresh: noop, onReceivingStatusChange: noop
  }
  const { document: doc } = mount(Q.renderHandoverQueue(ctx))
  await tick(); await tick()
  check('P1a tombol Terima Barang ada di kartu antrean', !!tid(doc, 'queue-terima-barang-h1'))
  check('P1b Terima Barang berada di blok langkah tersendiri', !!tid(doc, 'queue-receipt-block-h1'))
  const primary = tid(doc, 'queue-primary-h1')
  check('P2a kontrak DAT utuh: tepat 3 tombol di baris aksi fisik', primary?.querySelectorAll('button').length === 3, String(primary?.querySelectorAll('button').length))
  const order = [...(primary?.querySelectorAll('button') || [])].map(b => b.getAttribute('data-testid').replace('queue-', '').replace('-h1', ''))
  check('P2b urutan aksi tetap gudang -> tukang -> problem', order.join(',') === 'act-gudang,act-tukang,problem', order.join(','))
  check('P2c Terima Barang TIDAK di dalam baris aksi fisik', !primary?.contains(tid(doc, 'queue-terima-barang-h1')))
  check('P3a capability banner jujur saat skema belum ada', !!tid(doc, 'handover-capability'))
  check('P3b banner menyebut penyimpanan per barang belum aktif', /belum aktif/i.test(tid(doc, 'handover-capability')?.textContent || ''))
  check('P3c banner menyebut tabel yang kurang', /receiving_events|handover_items/i.test(tid(doc, 'handover-capability')?.textContent || ''))
  check('P3d tidak mengklaim data per barang tersimpan', /tidak ada data per barang yang diklaim tersimpan/i.test(tid(doc, 'handover-capability')?.textContent || ''))
  check('P4a Bermasalah tetap bisa dibuka', !!tid(doc, 'queue-problem-h1'))
  click(tid(doc, 'queue-problem-h1'))
  await tick()
  check('P4b tanpa ledger: alasan jujur tampil', !!tid(doc, 'queue-problem-blocked-h1'))
  check('P4c tanpa ledger: tidak ada tombol form retur', !tid(doc, 'queue-problem-retur-h1'))
}

// ============================================================
{
  console.log('\nP4d. Dengan ledger siap: Bermasalah → form retur per barang')
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  PM.resetPhysicalModal(); resetCapability()
  const ctx = {
    rows: [HO], allReceivings: [REC], allReceivingItems: RI, allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    H: { receivingItemsForReceiving: () => RI, prItemsForPr: () => PR_ITEMS },
    say: noop, refresh: noop, onReceivingStatusChange: noop
  }
  const { document: doc } = mount(Q.renderHandoverQueue(ctx))
  await tick(); await tick(); await tick()
  check('P4d ledger siap → banner capability TIDAK tampil', !tid(doc, 'handover-capability'))
  click(tid(doc, 'queue-problem-h1'))
  await tick()
  const returBtn = tid(doc, 'queue-problem-retur-h1')
  check('P4e tombol form retur per barang tersedia', !!returBtn)
  click(returBtn)
  await tick(); await tick(); await tick()
  check('P4f form retur terbuka dari banner', !!tid(doc, 'return-form'))
  check('P4g baris retur terisi dari event rusak', !!tid(doc, 'return-line-ev1'))
}

// ============================================================
{
  console.log('\nP5. Tombol Terima Barang di aksi baris (view.jsx)')
  const ctx = { allReceivings: [REC], title: 'Serah Terima', page: 'handovers', setEditRow: noop, onMarkHandoverDelivered: noop, onDelete: noop }
  const cell = V.rowActions(HO, ctx)
  const { document: doc } = mount(cell)
  check('P5a tombol Terima Barang ada di aksi baris', !!tid(doc, 'btn-terima-h1'))
  check('P5b tombol aktif saat nota terhubung', tid(doc, 'btn-terima-h1')?.disabled === false)
  PM.resetPhysicalModal(); resetCapability()
  click(tid(doc, 'btn-terima-h1'))
  const target = PM.__peekForTest ? PM.__peekForTest() : null
  check('P5c klik membuka modal Terima Barang (store)', target?.kind === 'receipt' && target?.receiving?.id === 'rec1', JSON.stringify(target))
}

// ============================================================
console.log('\n=== Q. LOGIKA MURNI (tanpa UI) ===\n')
// ============================================================
{
  const rows = RLOGIC.buildRows(RI, (it) => (it.pr_item_id === 'pi1' ? 10 : 4))
  const entries = {
    ri1: { ...RLOGIC.emptyEntry(), datang: '6', rusak: '2', ws: '3', tukang: '1', penerima: 'Pak Joko', retur: RLOGIC.RETUR_SUPPLIER },
    ri2: { ...RLOGIC.emptyEntry(), datang: '2', rusak: '0' }
  }
  const v = RLOGIC.validateForm(rows, entries, { ledgerReady: true })
  check('Q1 form valid untuk isian wajar', v.valid === true, JSON.stringify(v.itemErrors))
  const drafts = ELOGIC.buildEventDrafts(rows, entries, { receivingId: 'rec1' })
  check('Q2 dua draft event', drafts.length === 2, String(drafts.length))
  check('Q3 retur supplier → PENDING + retur_qty = rusak', drafts[0].retur_status === 'PENDING' && drafts[0].retur_qty === 2)
  check('Q4 baik = datang − rusak', drafts[0]._computed.baik === 4, String(drafts[0]._computed.baik))

  // validasi mirror constraint DB
  const bad = ELOGIC.validateEventDrafts([{ ...drafts[0], qty_rusak: 99 }])
  check('Q5 rusak > datang ditolak', bad.ok === false && bad.errors.some(e => /rusak/i.test(e)), JSON.stringify(bad.errors))

  // tanpa foto tetap sah (foto OPSIONAL — arahan DAT)
  const noFoto = ELOGIC.buildEventDrafts(rows, { ri1: { ...RLOGIC.emptyEntry(), datang: '1' } }, { receivingId: 'rec1' })
  check('Q6 tanpa foto tetap menghasilkan event (foto opsional)', noFoto.length === 1 && noFoto[0].foto_ref === null)

  // LEGACY: dimensi rusak/tujuan memblokir
  const legacyV = RLOGIC.validateForm(rows, entries, { ledgerReady: false })
  check('Q7 mode LEGACY menandai schemaBlocks untuk dimensi per barang', legacyV.schemaBlocks.length > 0, JSON.stringify(legacyV.schemaBlocks))

  // prefill handover: alokasi − sudah diserahkan
  const evs = [
    { id: 'e1', tujuan_tukang: 5, item_name: 'A', unit: 'Pcs' },
    { id: 'e2', tujuan_tukang: 3, item_name: 'B', unit: 'Pcs' }
  ]
  const pf = ELOGIC.handoverLinesFromEvents(evs, { e1: 2 })
  check('Q8 prefill = sisa (e1: 5-2=3, e2: 3)', pf[0].qty_diserahkan === 3 && pf[1].qty_diserahkan === 3, JSON.stringify(pf.map(p => p.qty_diserahkan)))
  const hv = ELOGIC.validateHandoverLines([{ receiving_event_id: 'e1', qty_diserahkan: 99 }], pf)
  check('Q9 qty melebihi sisa alokasi ditolak', hv.ok === false, JSON.stringify(hv.errors))

  // retur: event yang sudah diretur tidak ditawarkan
  const returEvs = [{ id: 'e1', qty_rusak: 2, retur_status: 'PENDING', item_name: 'A' }]
  const offered = ELOGIC.returLinesFromEvents(returEvs, { alreadyReturned: { e1: 2 } })
  check('Q10 retur penuh tidak ditawarkan lagi', offered.length === 0, JSON.stringify(offered))
  const partial = ELOGIC.returLinesFromEvents(returEvs, { alreadyReturned: { e1: 1 } })
  check('Q11 retur sebagian menawarkan sisa', partial.length === 1 && partial[0].qty === 1, JSON.stringify(partial))
}

// ============================================================
console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
