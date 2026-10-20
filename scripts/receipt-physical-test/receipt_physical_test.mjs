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
    // ev1: rusak 2 DAN sudah diputuskan "Kembalikan ke supplier" → retur_qty 2.
    // (Fixture run <190 memakai retur_qty 0 dengan rusak 2 — keadaan yang oleh
    // RPC `return_create` DITOLAK `no_retur_balance`. Harness jadi hijau untuk
    // alur yang di produksi berakhir dengan penolakan server; itu bug, bukan
    // fixture. Kasus retur_qty 0 diuji terpisah di T5.)
    { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2, tujuan_ws: 3, tujuan_tukang: 1, penerima_tukang: 'Pak Joko', retur_status: 'PENDING', retur_qty: 2, discard_confirmed: false },
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
  // Tanpa `qty_arrived` (data lama), prevCum = 0 → sisa = batas BELI, BUKAN 0.
  // Yang diuji: `quantity_received` tidak pernah dibaca sebagai "sudah datang".
  const buggy = RLOGIC.buildRows([{ ...RI[0], qty_arrived: undefined }], () => 10)
  check('R3d tanpa qty_arrived prevCum = 0 (tidak jatuh ke qty BELI sebagai "sudah datang")',
    buggy[0].prevCum === 0 && buggy[0].sisa === 10, `prevCum=${buggy[0].prevCum} sisa=${buggy[0].sisa}`)

  console.log('\nR8. Batas kedatangan = QTY BELI baris (defect run 199)')
  // Nota membeli 3 dari pesanan 5 → hanya 3 yang boleh datang.
  const partial = RLOGIC.buildRows([{ id: 'ri3', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Beli Sebagian', unit: 'Pcs', quantity_received: 3, qty_arrived: 0 }], () => 5)
  check('R8a sisa = 3 (qty BELI), bukan 5 (qty pesanan PR)', partial[0].sisa === 3, String(partial[0].sisa))
  const v8 = RLOGIC.validateItem(partial[0], { ...RLOGIC.emptyEntry(), datang: '5' })
  check('R8b datang 5 ditolak sebelum RPC', v8.valid === false && /dibeli/i.test(Object.values(v8.errors)[0] || ''), JSON.stringify(v8.errors))
  // Baris cangkang Approval: BELI 0 → barang belum dibeli, tidak boleh diterima.
  const shell = RLOGIC.buildRows([{ id: 'ri4', receiving_id: 'rec1', pr_item_id: 'pi2', item_name: 'Belum Dibeli', unit: 'Pcs', quantity_received: 0, qty_arrived: 0 }], () => 5)
  check('R8c baris qty BELI 0 ditandai notBought', shell[0].notBought === true, JSON.stringify(shell[0]))
  const v8c = RLOGIC.validateItem(shell[0], { ...RLOGIC.emptyEntry(), datang: '5' })
  check('R8d barang belum dibeli TIDAK bisa dicatat datang', v8c.valid === false && /belum dibeli/i.test(Object.values(v8c.errors)[0] || ''), JSON.stringify(v8c.errors))
  const plan8 = RLOGIC.buildSavePlan(shell, { ri4: { ...RLOGIC.emptyEntry(), datang: '5' } })
  check('R8e pengaman kedua: baris belum dibeli tidak masuk rencana simpan', plan8.length === 0, JSON.stringify(plan8))
  // Baris beli langsung tanpa PR: batas tetap ada (dari qty BELI).
  const direct = RLOGIC.buildRows([{ id: 'ri5', receiving_id: 'rec1', pr_item_id: null, item_name: 'Beli Langsung', unit: 'Pcs', quantity_received: 2, qty_arrived: 0 }], () => null)
  check('R8f beli langsung tanpa PR tetap punya batas (sisa 2, bukan null)', direct[0].sisa === 2, String(direct[0].sisa))

  console.log('\nR9. Pilihan retur saat rusak = 0 tidak dikirim ke RPC (defect run 199)')
  const rowR9 = RLOGIC.buildRows(RI, (it) => (it.pr_item_id === 'pi1' ? 10 : 4))[0]
  const v9a = RLOGIC.validateItem(rowR9, { ...RLOGIC.emptyEntry(), datang: '2', rusak: '0', retur: RLOGIC.RETUR_SUPPLIER })
  check('R9a rusak 0 + "Kembalikan ke supplier" ditolak dengan penjelasan',
    v9a.valid === false && /tidak ada jumlah rusak/i.test(Object.values(v9a.errors)[0] || ''), JSON.stringify(v9a.errors))
  const v9b = RLOGIC.validateItem(rowR9, { ...RLOGIC.emptyEntry(), datang: '2', rusak: '0', retur: RLOGIC.RETUR_DIBUANG, konfirmasiBuang: true })
  check('R9b rusak 0 + "Dibuang" juga ditolak', v9b.valid === false, JSON.stringify(v9b.errors))
  const v9c = RLOGIC.validateItem(rowR9, { ...RLOGIC.emptyEntry(), datang: '2', rusak: '0', retur: RLOGIC.RETUR_NANTI })
  check('R9c rusak 0 + "Tentukan nanti" tetap boleh', v9c.valid === true, JSON.stringify(v9c.errors))
  const drafts9 = ELOGIC.buildEventDrafts([rowR9], { ri1: { ...RLOGIC.emptyEntry(), datang: '2', rusak: '0', retur: RLOGIC.RETUR_SUPPLIER } }, { receivingId: 'rec1' })
  check('R9d draft menormalkan retur_status ke NONE saat rusak 0',
    drafts9[0].retur_status === 'NONE' && drafts9[0].retur_qty === 0, JSON.stringify(drafts9[0]))

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
  // Pesan menyebut batas yang dilanggar + sisa. Sejak run 199 batasnya QTY BELI
  // nota ini (bukan qty pesanan PR), jadi teksnya "jumlah yang dibeli pada nota
  // ini" — assertion tetap ketat pada angka & konsep sisa.
  check('R7b pesan menyebut sisa yang boleh diterima + angkanya',
    /sisa\s*2/i.test(tid(doc, 'receipt-error')?.textContent || '') && /dibeli|pesanan/i.test(tid(doc, 'receipt-error')?.textContent || ''),
    tid(doc, 'receipt-error')?.textContent)

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

  // ===== C6 (run 202): BARIS BOLEH DILEWATI ==========================
  // Defect: satu barang yang belum tiba memblokir SELURUH submit (qty 0 =
  // error), sehingga barang lain yang SUDAH diterima tidak bisa dicatat dan
  // admin terdorong mengisi angka palsu. Sekarang qty kosong = dilewati.
  typeInto(q2, '')
  await tick()
  check('C6a baris kosong TIDAK memblokir submit', tid(doc, 'handover-confirm-submit')?.disabled === false)
  check('C6b peringatan sisa tampil SEBELUM simpan', !!tid(doc, 'handover-confirm-remainder'))
  check('C6c peringatan menyebut barang yang dilewati + sisanya',
    /Cat Duco/.test(tid(doc, 'handover-confirm-remainder')?.textContent || '') &&
    /sisa\s*2/i.test(tid(doc, 'handover-confirm-remainder')?.textContent || ''),
    tid(doc, 'handover-confirm-remainder')?.textContent)
  check('C6d peringatan menyebut dokumen terkunci + dokumen baru',
    /terkunci/i.test(tid(doc, 'handover-confirm-remainder')?.textContent || '') &&
    /dokumen Serah Terima baru/i.test(tid(doc, 'handover-confirm-remainder')?.textContent || ''),
    tid(doc, 'handover-confirm-remainder')?.textContent)
  check('C6e ringkasan menyebut unit yang belum diserahkan',
    /2 unit belum diserahkan/i.test(tid(doc, 'handover-confirm-summary')?.textContent || ''),
    tid(doc, 'handover-confirm-summary')?.textContent)

  // Semua baris dikosongkan → tetap ditolak (tidak ada yang diserahkan).
  typeInto(q1, '')
  await tick()
  check('C6f semua baris kosong → submit ditolak (tidak ada yang diserahkan)',
    tid(doc, 'handover-confirm-submit')?.disabled === true)

  // Kembalikan ke isian normal untuk C3 di bawah.
  typeInto(q1, '1')
  typeInto(q2, '2')
  await tick()

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
console.log('\nC5. READY tanpa baris alokasi → tetap BISA dikonfirmasi (defect run 190)')
// ============================================================
// Defect: di mode READY dengan 0 baris, satu-satunya tombol submit membaca
// `validation.ok` yang selalu false → tombol mati, tidak ada input header,
// padahal teks di form menyuruh "konfirmasi header saja". Handover tanpa
// alokasi tukang (termasuk data lama tanpa receiving_id) jadi MUSTAHIL
// dikonfirmasi — padahal mode LEGACY bisa. Dua kasus nyata di bawah.
{
  const ConfirmForm = (await importDist('modules/handovers/confirmForm.mjs')).default

  // C5a-C5d: handover TANPA receiving_id (data lama / orphan).
  mock.__reset({ receivings: [], prItems: [], receivingItems: [], handovers: [{ ...HO, id: 'h-orphan', receiving_id: null }], ledger: LEDGER })
  PM.resetPhysicalModal(); resetCapability()
  const says1 = []
  const { document: doc } = mount(
    React.createElement(ConfirmForm, {
      handover: { ...HO, id: 'h-orphan', receiving_id: null }, capability: { ready: true, returnReady: true, missing: [] },
      say: (m) => says1.push(m), refresh: noop, close: noop
    })
  )
  await tick(); await tick(); await tick()
  check('C5a jalur konfirmasi tanpa rincian tersedia', !!tid(doc, 'handover-confirm-headeronly'))
  check('C5b input nama penerima ada (wajib)', !!tid(doc, 'hc-header-penerima'))
  // Nama penerima di-prefill dari dokumen (received_by) — bukan kosong.
  check('C5b2 nama penerima terisi otomatis dari dokumen', /Pak Joko/.test(tid(doc, 'hc-header-penerima')?.value || ''), tid(doc, 'hc-header-penerima')?.value)
  // Dikosongkan → tombol wajib nonaktif (nama penerima tidak boleh kosong).
  typeInto(tid(doc, 'hc-header-penerima'), '')
  await tick()
  const btn = tid(doc, 'handover-confirm-headeronly-submit')
  check('C5c tombol nonaktif saat nama kosong', btn?.disabled === true)
  const inp = tid(doc, 'hc-header-penerima')
  typeInto(inp, 'Pak Joko (Mandor)')
  await tick()
  check('C5d tombol aktif setelah nama diisi', tid(doc, 'handover-confirm-headeronly-submit')?.disabled === false)
  click(tid(doc, 'handover-confirm-headeronly-submit'))
  await tick(); await tick(); await tick()
  const upd = mock.__callsOf('update', 'handovers')
  check('C5e menulis header (CAS diserahkan_at), BUKAN RPC', upd.length === 1 && mock.__callsOf('rpc').length === 0, JSON.stringify({ upd: upd.length, rpc: mock.__callsOf('rpc').length }))
  check('C5f nama penerima IKUT tersimpan (bukan field hiasan)', upd[0]?.data?.received_by === 'Pak Joko (Mandor)', JSON.stringify(upd[0]?.data))
  check('C5g diserahkan_at + status CONFIRMED ditulis', !!upd[0]?.data?.diserahkan_at && upd[0]?.data?.status === 'CONFIRMED', JSON.stringify(upd[0]?.data))
  check('C5h pesan jujur: rincian TIDAK ditulis', says1.some(m => /Rincian per barang tidak ditulis/i.test(m)), JSON.stringify(says1))
}

// C5i-C5j: handover dengan receiving, tapi tak ada event bertujuan_tukang.
{
  const ConfirmForm = (await importDist('modules/handovers/confirmForm.mjs')).default
  mock.__reset({
    receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [{ ...HO }],
    ledger: { ...LEDGER, receivingEvents: [{ ...LEDGER.receivingEvents[0], tujuan_tukang: 0, tujuan_ws: 4 }] }
  })
  PM.resetPhysicalModal(); resetCapability()
  const { document: doc } = mount(
    React.createElement(ConfirmForm, {
      handover: { ...HO }, capability: { ready: true, returnReady: true, missing: [] },
      say: noop, refresh: noop, close: noop
    })
  )
  await tick(); await tick(); await tick()
  check('C5i panel "tidak ada alokasi tukang" tampil', /Tidak ada barang berstatus/i.test(tid(doc, 'handover-confirm-empty')?.textContent || ''))
  check('C5j jalur keluar header-only tersedia (bukan jalan buntu)', !!tid(doc, 'handover-confirm-headeronly'))
}

// ============================================================
console.log('\n=== S. REPLAY vs KOREKSI (defect run 199) ===\n')
// ============================================================
// `client_event_id` deterministik: submit ulang dengan qty datang sama tetapi
// kondisi/tujuan berbeda menghasilkan id yang SAMA. RPC menjawab
// applied=0/already_applied=1 dan perubahan TIDAK tersimpan — kalau UI tidak
// membandingkan isian, admin mengira koreksinya masuk.
{
  const ReceiptForm = (await importDist('modules/handovers/receiptForm.mjs')).default
  const stored = {
    id: 'evA', client_event_id: 'rcpt:rec1:ri1:0->2', receiving_id: 'rec1', receiving_item_id: 'ri1',
    pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 2, qty_rusak: 0,
    tujuan_ws: 2, tujuan_tukang: 0, penerima_tukang: null, retur_status: 'NONE', retur_qty: 0,
    discard_confirmed: false, foto_ref: null
  }
  // (a) KOREKSI: isian berbeda (rusak 1, tujuan berubah) → DITOLAK dengan pesan
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: { ...LEDGER, receivingEvents: [{ ...stored }] } })
  PM.resetPhysicalModal(); resetCapability()
  const says1 = []
  let closed1 = 0
  let doc1 = mount(
    React.createElement(ReceiptForm, {
      receiving: REC, items: RI, orderedFor: (it) => (it.pr_item_id === 'pi1' ? 10 : 4),
      capability: { ready: true, returnReady: true, missing: [] },
      say: (m) => says1.push(m), refresh: noop, close: () => { closed1++ }
    })
  ).document
  typeInto(tid(doc1, 'rc-datang-ri1'), '2')
  typeInto(tid(doc1, 'rc-rusak-ri1'), '1')
  typeInto(tid(doc1, 'rc-ws-ri1'), '1')
  await tick()
  click(tid(doc1, 'receipt-submit'))
  await tick(); await tick(); await tick()
  const err1 = tid(doc1, 'receipt-error')?.textContent || ''
  check('S1a koreksi yang berbeda DITOLAK (bukan diam-diam diabaikan)', /berbeda dari catatan yang sudah tersimpan/i.test(err1), err1)
  check('S1b pesan menyebut kolom yang berbeda', /rusak|tujuan/i.test(err1), err1)
  check('S1c pesan menyatakan perubahan TIDAK ditulis', /tidak ditulis/i.test(err1), err1)
  check('S1d TIDAK memanggil RPC (nol tulisan)', mock.__callsOf('rpc').length === 0, JSON.stringify(mock.__callsOf('rpc').map(c => c.fn)))
  check('S1e tidak ada klaim tersimpan + modal tidak ditutup', says1.length === 0 && closed1 === 0, `${JSON.stringify(says1)} closed=${closed1}`)

  // (b) REPLAY: isian identik → aman, RPC dipanggil, server menjawab already
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: { ...LEDGER, receivingEvents: [{ ...stored }] } })
  mock.__state.replayReceipt = true
  PM.resetPhysicalModal(); resetCapability()
  const says2 = []
  let doc2 = mount(
    React.createElement(ReceiptForm, {
      receiving: REC, items: RI, orderedFor: (it) => (it.pr_item_id === 'pi1' ? 10 : 4),
      capability: { ready: true, returnReady: true, missing: [] },
      say: (m) => says2.push(m), refresh: noop, close: noop
    })
  ).document
  typeInto(tid(doc2, 'rc-datang-ri1'), '2')
  typeInto(tid(doc2, 'rc-ws-ri1'), '2')
  await tick()
  click(tid(doc2, 'receipt-submit'))
  await tick(); await tick(); await tick()
  check('S2a replay isian identik tetap boleh (RPC dipanggil)', mock.__callsOf('rpc').length === 1, String(mock.__callsOf('rpc').length))
  check('S2b pesan replay menyebut tidak digandakan', says2.some(m => /tidak digandakan/i.test(m)), JSON.stringify(says2))
  check('S2c tidak ada error koreksi palsu', !tid(doc2, 'receipt-error'), tid(doc2, 'receipt-error')?.textContent)

  // (c) FOTO pada kedatangan yang sama.
  // RUN 206: kontrak foto diperketat. `foto_ref` di schema = path/ID arsip,
  // BUKAN nama berkas lokal. Dulu `file.name` dikirim apa adanya, sehingga
  // (i) baris DB tampak punya bukti foto padahal berkas tidak pernah diunggah,
  // dan (ii) submit ulang dengan foto baru terdeteksi sebagai "konflik" —
  // satu-satunya saat aplikasi menyebut foto. Untuk kedatangan PERTAMA tidak
  // ada peringatan sama sekali. Sekarang: foto TIDAK PERNAH dikirim sebagai
  // referensi palsu, dan UI menyatakannya SEBELUM simpan (bukan sesudah).
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: { ...LEDGER, receivingEvents: [{ ...stored }] } })
  PM.resetPhysicalModal(); resetCapability()
  const says3 = []
  let doc3 = mount(
    React.createElement(ReceiptForm, {
      receiving: REC, items: RI, orderedFor: (it) => (it.pr_item_id === 'pi1' ? 10 : 4),
      capability: { ready: true, returnReady: true, missing: [] },
      say: (m) => says3.push(m), refresh: noop, close: noop
    })
  ).document
  typeInto(tid(doc3, 'rc-datang-ri1'), '2')
  typeInto(tid(doc3, 'rc-ws-ri1'), '2')
  const fileInput = tid(doc3, 'rc-foto-ri1')
  const file = new dom0.window.File(['x'], 'bukti-baru.jpg', { type: 'image/jpeg' })
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
  flushSync(() => fileInput.dispatchEvent(new dom0.window.Event('change', { bubbles: true })))
  await tick()
  check('S3a UI menyatakan berkas foto TIDAK ikut tersimpan (sebelum simpan)',
    /tidak ikut tersimpan/i.test(tid(doc3, 'rc-foto-jujur-ri1')?.textContent || ''),
    tid(doc3, 'rc-foto-jujur-ri1')?.textContent)
  click(tid(doc3, 'receipt-submit'))
  await tick(); await tick(); await tick()
  const payload3 = mock.__callsOf('rpc')[0]?.args?.p_events?.[0] || null
  check('S3b payload tidak membawa nama berkas sebagai foto_ref (bukan referensi palsu)',
    payload3 !== null && (payload3.foto_ref === null || payload3.foto_ref === undefined),
    JSON.stringify(payload3?.foto_ref))
  check('S3c tidak ada pesan yang mengklaim foto tersimpan', !says3.some(m => /foto/i.test(m)), JSON.stringify(says3))
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
console.log('\nT5. SALDO RETUR = retur_qty, bukan qty_rusak (defect run 190)')
// ============================================================
// Defect: modal menawarkan qty_rusak walaupun retur_qty 0 → RPC
// `return_create` menolak `no_retur_balance`; admin melihat tombol aktif,
// menekan Simpan, lalu gagal. Test di bawah mengunci DUA sisi:
//   (a) baris tanpa saldo TIDAK ditawarkan, tetapi DILAPORKAN
//   (b) baris dengan saldo < qty_rusak ditawarkan sebesar SALDO
{
  const ledgerNoSaldo = {
    ...LEDGER,
    receivingEvents: [
      { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2, tujuan_ws: 3, tujuan_tukang: 1, penerima_tukang: 'Pak Joko', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false },
      LEDGER.receivingEvents[1]
    ]
  }
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: ledgerNoSaldo })
  PM.resetPhysicalModal(); resetCapability()
  const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default
  const { document: doc } = mount(
    React.createElement(ReturnForm, {
      receiving: REC, capability: { ready: true, returnReady: true, missing: [] },
      say: noop, refresh: noop, close: noop
    })
  )
  await tick(); await tick(); await tick()
  check('T5a rusak tanpa saldo retur (retur_qty 0) TIDAK ditawarkan', !tid(doc, 'return-line-ev1'))
  check('T5b barangnya tetap DILAPORKAN (bukan hilang diam-diam)', !!tid(doc, 'return-blocked-ev1'))
  check('T5c pesan menyebut belum ditandai retur/dibuang', /belum ditandai retur/i.test(tid(doc, 'return-blocked')?.textContent || ''))
  check('T5d tombol Simpan Retur tidak aktif', tid(doc, 'return-submit')?.disabled === true)

  // ===== T5l (run 202): INSTRUKSI LAMA ADALAH JANJI PALSU ==============
  // Dulu panel ini menyuruh admin "buka Terima Barang dan pilih Kembalikan ke
  // supplier — setelah itu barisnya muncul di sini". Itu mustahil: event
  // penerimaan tidak bisa dikoreksi (client_event_id deterministik → RPC
  // already_applied; aplikasi menolak CORRECTION_UNSUPPORTED) dan tidak ada
  // RPC reversal. Diuji di PostgreSQL nyata oleh probe_retur_deadend.mjs.
  const blockedTxt = tid(doc, 'return-blocked')?.textContent || ''
  check('T5l panel TIDAK menyuruh mengubah catatan yang tidak bisa diubah',
    !/buka Terima Barang untuk barang yang sama/i.test(blockedTxt), blockedTxt)
  check('T5m panel menjelaskan keputusan retur tidak bisa diubah lagi',
    /tidak bisa diubah lagi/i.test(tid(doc, 'return-blocked-why')?.textContent || ''),
    tid(doc, 'return-blocked-why')?.textContent)
  check('T5n panel menyebut koreksi penerimaan belum didukung',
    /koreksi penerimaan belum didukung/i.test(tid(doc, 'return-blocked-why')?.textContent || ''),
    tid(doc, 'return-blocked-why')?.textContent)
  check('T5o panel tetap menyarankan pilihan yang benar untuk kedatangan berikutnya',
    /Kembalikan ke supplier/i.test(tid(doc, 'return-blocked-why')?.textContent || ''))
}

// Saldo lebih kecil dari qty_rusak (kontrak mengizinkan retur sebagian).
{
  const ledgerPartial = {
    ...LEDGER,
    receivingEvents: [
      { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 4, tujuan_ws: 2, tujuan_tukang: 0, retur_status: 'PENDING', retur_qty: 1, discard_confirmed: false },
      LEDGER.receivingEvents[1]
    ]
  }
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: ledgerPartial })
  PM.resetPhysicalModal(); resetCapability()
  const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default
  const { document: doc } = mount(
    React.createElement(ReturnForm, {
      receiving: REC, capability: { ready: true, returnReady: true, missing: [] },
      say: noop, refresh: noop, close: noop
    })
  )
  await tick(); await tick(); await tick()
  const lineTxt = tid(doc, 'return-line-ev1')?.textContent || ''
  check('T5e saldo 1 dari rusak 4 → ditawarkan 1 (bukan 4)', /akan diretur\s*1/.test(lineTxt), lineTxt)
  check('T5f saldo retur ikut ditampilkan', /saldo retur\s*1/.test(lineTxt), lineTxt)
}

// Logika murni: returPlan memisahkan lines vs blocked.
{
  const plan = ELOGIC.returPlan([
    { id: 'a', qty_rusak: 2, retur_qty: 0, retur_status: 'NONE', item_name: 'A' },
    { id: 'b', qty_rusak: 3, retur_qty: 3, retur_status: 'PENDING', item_name: 'B' },
    { id: 'c', qty_rusak: 2, retur_qty: 2, retur_status: 'PENDING', item_name: 'C' }
  ], { alreadyReturned: { c: 2 } })
  check('T5g returPlan: tanpa saldo masuk blocked', plan.blocked.length === 1 && plan.blocked[0].receiving_event_id === 'a', JSON.stringify(plan.blocked))
  check('T5h returPlan: bersaldo masuk lines', plan.lines.length === 1 && plan.lines[0].receiving_event_id === 'b', JSON.stringify(plan.lines))
  check('T5i returPlan: yang sudah diretur penuh tidak muncul di keduanya', !plan.lines.some(l => l.receiving_event_id === 'c') && !plan.blocked.some(b => b.receiving_event_id === 'c'))
  check('T5j returPlan: qty = saldo − sudah diretur', ELOGIC.returPlan([{ id: 'd', qty_rusak: 5, retur_qty: 5 }], { alreadyReturned: { d: 3 } }).lines[0].qty === 2)
  // Data lama tanpa kolom retur_qty: fallback ke qty_rusak (tidak hilang).
  check('T5k data tanpa retur_qty → fallback qty_rusak', ELOGIC.returPlan([{ id: 'e', qty_rusak: 4 }]).lines[0].qty === 4)
}

// ============================================================
console.log('\nT6. TINDAKAN RETUR yang ditawarkan = yang diterima RPC (defect run 195)')
// ============================================================
// Defect: dropdown "Tindakan" selalu berisi 4 pilihan untuk semua baris.
//   - event PENDING + "Dibuang"  → RPC menolak `discard_not_confirmed`
//   - event DISCARDED + "Kembalikan ke supplier" → diterima, status berubah
//     jadi PENDING (barang yang sudah dibuang "hidup" lagi)
// Test ini mengunci: pilihan yang tampil HANYA yang sah, yang tidak sah
// DIJELASKAN, dan kombinasi campuran tidak bisa disimpan.
{
  // (a) Event PENDING → hanya 3 tindakan non-discard.
  const ledgerPending = {
    ...LEDGER,
    receivingEvents: [
      { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2, tujuan_ws: 3, tujuan_tukang: 1, penerima_tukang: 'Pak Joko', retur_status: 'PENDING', retur_qty: 2, discard_confirmed: false }
    ]
  }
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: ledgerPending })
  PM.resetPhysicalModal(); resetCapability()
  const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default
  const { document: doc } = mount(
    React.createElement(ReturnForm, {
      receiving: REC, capability: { ready: true, returnReady: true, missing: [] },
      say: noop, refresh: noop, close: noop
    })
  )
  await tick(); await tick(); await tick()
  const sel = tid(doc, 'return-resolution')
  const opts = Array.from(sel?.options || []).map(o => o.value)
  check('T6a event PENDING: "Dibuang" TIDAK ditawarkan', !opts.includes('DISCARD'), JSON.stringify(opts))
  check('T6b event PENDING: RETURN/REPLACE/REFUND ditawarkan', ['RETURN', 'REPLACE', 'REFUND'].every(v => opts.includes(v)), JSON.stringify(opts))
  check('T6c tindakan yang tidak sah DIJELASKAN, bukan disembunyikan', /Dibuang/i.test(tid(doc, 'return-blocked-actions')?.textContent || ''), tid(doc, 'return-blocked-actions')?.textContent)
  check('T6d tombol Simpan tetap aktif untuk pilihan yang sah', tid(doc, 'return-submit')?.disabled === false)
}

// (b) Event DISCARDED → hanya DISCARD.
{
  const ledgerDiscard = {
    ...LEDGER,
    receivingEvents: [
      { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2, tujuan_ws: 3, tujuan_tukang: 1, penerima_tukang: 'Pak Joko', retur_status: 'DISCARDED', retur_qty: 2, discard_confirmed: true }
    ]
  }
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: ledgerDiscard })
  PM.resetPhysicalModal(); resetCapability()
  const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default
  const { document: doc } = mount(
    React.createElement(ReturnForm, {
      receiving: REC, capability: { ready: true, returnReady: true, missing: [] },
      say: noop, refresh: noop, close: noop
    })
  )
  await tick(); await tick(); await tick()
  const opts = Array.from(tid(doc, 'return-resolution')?.options || []).map(o => o.value)
  check('T6e event DISCARDED: hanya DISCARD ditawarkan', opts.length === 1 && opts[0] === 'DISCARD', JSON.stringify(opts))
  check('T6f event DISCARDED: "Kembalikan ke supplier" tidak ditawarkan', !opts.includes('RETURN'), JSON.stringify(opts))
  check('T6g status baris disebut apa adanya', /sudah dibuang/i.test(tid(doc, 'return-line-ev1')?.textContent || ''), tid(doc, 'return-line-ev1')?.textContent)
}

// (c) Logika: irisan tindakan untuk baris campuran kosong → UI memisahkan.
{
  const pending = { id: 'p', qty_rusak: 2, retur_qty: 2, retur_status: 'PENDING', item_name: 'P' }
  const discard = { id: 'd', qty_rusak: 2, retur_qty: 2, retur_status: 'DISCARDED', discard_confirmed: true, item_name: 'D' }
  const plan = ELOGIC.returPlan([pending, discard])
  const common = ELOGIC.commonResolutions(plan.lines)
  check('T6h allowed per baris: PENDING tanpa DISCARD', !plan.lines[0].allowed_resolutions.includes('DISCARD'), JSON.stringify(plan.lines[0].allowed_resolutions))
  check('T6i allowed per baris: DISCARDED hanya DISCARD', plan.lines[1].allowed_resolutions.join(',') === 'DISCARD', JSON.stringify(plan.lines[1].allowed_resolutions))
  check('T6j irisan campuran kosong (tidak ada tindakan sah)', common.length === 0, JSON.stringify(common))
  check('T6k irisan satu kelompok tetap sah', ELOGIC.commonResolutions([plan.lines[0]]).includes('RETURN'))
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

console.log('\n=== X. DEFECT RUN 206 — 4 temuan yang dikunci ===\n')
// ============================================================
{
  // ---- X1: tombol penutup (Tandai Diserahkan) di antrean READY ----
  // Alokasi tukang dicatat lewat event penerimaan; pr_items.status TIDAK
  // berubah. Sebelum fix, actionPlan menilai "belum ada distribusi" dan
  // tombol penutup mati → konfirmasi per barang mustahil dibuka dari antrean.
  const ctx = {
    rows: [HO], allReceivings: [REC], allReceivingItems: RI,
    allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    H: { receivingItemsForReceiving: () => RI, prItemsForPr: () => PR_ITEMS },
    say: noop, refresh: noop, onReceivingStatusChange: noop
  }
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  PM.resetPhysicalModal(); resetCapability()
  const { document: doc } = mount(Q.renderHandoverQueue(ctx))
  await tick(); await tick(); await tick()
  const finishBtn = tid(doc, 'queue-act-terima-h1')
  check('X1a READY: tombol penutup AKTIF walau pr_items belum DI_TUKANG',
    !!finishBtn && finishBtn.disabled === false,
    `disabled=${finishBtn?.disabled} title=${finishBtn?.getAttribute('title')}`)
  if (finishBtn && !finishBtn.disabled) {
    click(finishBtn)
    await tick(); await tick(); await tick()
    check('X1b klik membuka konfirmasi per barang', !!tid(doc, 'handover-confirm-form'))
    check('X1c baris prefill alokasi tukang tampil', !!tid(doc, 'hc-qty-ev1'))
  }

  // ---- X2: pesan "belum ada yang dipilih" di modal retur ----
  const RET_LEDGER = {
    receivingEvents: [
      { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2, tujuan_ws: 0, tujuan_tukang: 0, penerima_tukang: null, retur_status: 'PENDING', retur_qty: 2, discard_confirmed: false }
    ],
    handoverItems: [], returnLines: [], returnCases: [], progress: []
  }
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: RET_LEDGER })
  PM.resetPhysicalModal(); resetCapability()
  const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default
  const m2 = mount(React.createElement(ReturnForm, {
    receiving: REC, capability: { ready: true, returnReady: true, missing: [] },
    say: noop, refresh: noop, close: noop
  }))
  await tick(); await tick(); await tick()
  const box = m2.document.querySelector('[data-testid="return-lines"] input[type="checkbox"]')
  check('X2a baris retur tampil', !!box)
  if (box) {
    click(box) // lepas centang satu-satunya baris
    await tick()
    const diagnostic = tid(m2.document, 'return-no-common-action')?.textContent || ''
    const noneSel = tid(m2.document, 'return-none-selected')?.textContent || ''
    check('X2b tanpa baris dipilih TIDAK muncul tuduhan data tidak konsisten',
      !/tidak konsisten|mencampur/i.test(diagnostic), diagnostic)
    check('X2c dijelaskan apa adanya: belum ada barang dipilih', /belum ada barang yang dipilih/i.test(noneSel), noneSel)
  }

  // ---- X3: foto yang dipilih tidak boleh dikirim sebagai referensi palsu ----
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  PM.resetPhysicalModal(); resetCapability()
  const ReceiptForm = (await importDist('modules/handovers/receiptForm.mjs')).default
  const says3 = []
  const m3 = mount(React.createElement(ReceiptForm, {
    receiving: REC, items: RI, orderedFor: (it) => (it.pr_item_id === 'pi1' ? 10 : 4),
    capability: { ready: true, returnReady: true, missing: [] },
    say: (m) => says3.push(m), refresh: noop, close: noop
  }))
  typeInto(tid(m3.document, 'rc-datang-ri1'), '2')
  await tick()
  const fi = tid(m3.document, 'rc-foto-ri1')
  const file = new dom0.window.File(['x'], 'IMG_20261021_0912.jpg', { type: 'image/jpeg' })
  Object.defineProperty(fi, 'files', { value: [file], configurable: true })
  flushSync(() => fi.dispatchEvent(new dom0.window.Event('change', { bubbles: true })))
  await tick()
  check('X3a UI menyatakan berkas foto TIDAK ikut tersimpan',
    /tidak ikut tersimpan/i.test(tid(m3.document, 'rc-foto-jujur-ri1')?.textContent || ''),
    tid(m3.document, 'rc-foto-jujur-ri1')?.textContent)
  click(tid(m3.document, 'receipt-submit'))
  await tick(); await tick(); await tick()
  const payload3 = mock.__callsOf('rpc')[0]?.args?.p_events?.[0] || null
  check('X3b payload TIDAK mengirim nama berkas sebagai foto_ref',
    payload3 !== null && (payload3.foto_ref === null || payload3.foto_ref === undefined),
    JSON.stringify(payload3?.foto_ref))
  check('X3c pesan sukses tidak mengklaim foto tersimpan', !/foto/i.test(says3[0] || ''), JSON.stringify(says3[0]))

  // ---- X4: rincian handover_items yang SUDAH tersimpan harus tampil ----
  // Baris handover seperti hasil loadAll SETELAH fix: `items` ditempel dari
  // tabel handover_items (bukan dari Purchase).
  const HO_ITEMS = {
    ...HO,
    diserahkan_at: '2026-10-21T02:00:00Z',
    status: 'CONFIRMED',
    items: [
      { id: 'hi1', handover_id: 'h1', receiving_event_id: 'ev1', item_name: 'Triplek 9mm', qty_diserahkan: 5, satuan: 'Lembar', penerima: 'Pak Joko' }
    ]
  }
  const D = await importDist('modules/handovers/display.mjs')
  const rinc = D.rincianInfo(HO_ITEMS)
  check('X4a rincian tersimpan ditampilkan (bukan "belum tersedia")', rinc.available === true && rinc.source === 'HANDOVER', JSON.stringify(rinc))
  check('X4b qty yang tampil = qty DISERAHKAN, bukan qty beli',
    rinc.rows?.[0]?.qty === 5 && /diserahkan/.test(rinc.rows?.[0]?.qtyLabel || ''), JSON.stringify(rinc.rows))
  const cellR = D.rincianCell(HO_ITEMS)
  check('X4c sel daftar menyebut jumlah barang diserahkan', cellR.unavailable === false && cellR.count === 1, JSON.stringify(cellR))
  // Tanpa baris → tetap label jujur (tidak mengarang dari Purchase)
  const rincEmpty = D.rincianInfo({ ...HO, items: [] })
  check('X4d tanpa baris tetap label jujur', rincEmpty.available === false && /belum tersedia/i.test(rincEmpty.label))
}

// ============================================================
console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
