// ============================================================
// LOGIC TEST — receiptEventLogic.js / receiptCapability.js /
// receiptEventSave.js / receiptSplit.js (verbatim hasil SWC)
// Bagian A–D. Dijalankan oleh run.py di sandbox (tanpa DB/jaringan).
// ============================================================
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const SB = process.cwd()
const importDist = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const L = await importDist('modules/receivings/receiptEventLogic.mjs')
const CAP = await importDist('modules/receivings/receiptCapability.mjs')
const SAVE = await importDist('modules/receivings/receiptEventSave.mjs')
const SPLIT = await importDist('modules/receivings/receiptSplit.mjs')
const RLOGIC = await importDist('modules/receivings/receiptLogic.mjs')
// mock dari dist/ — modul terkompilasi mengimpor dist/lib/…
const mock = await importDist('lib/supabaseClient.mjs')

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const RECEIVING = { id: 'rc1', purchase_request_id: 'pr1', project_id: 'pj1', status: 'NORMAL', received_date: null, delivery_note: 'SJ-1', invoice_no: 'INV-1', note: '', alokasi: null, masuk_gudang: false, tukang_at: null }
const ITEMS = [
  { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 0 },
  { id: 'ri2', receiving_id: 'rc1', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', quantity_received: 0 }
]
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', vendor_id: 'v1' },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng', vendor_id: 'v2' }
]
const prItemById = new Map(PR_ITEMS.map(p => [p.id, p]))
const orderedFor = (it) => prItemById.get(it.pr_item_id)?.quantity ?? null

console.log('=== A. LOGIKA LEDGER PER BARANG (receiptEventLogic.js verbatim) ===\n')

console.log('A1. Dimensi terpisah: datang ≠ rusak ≠ tujuan ≠ retur')
{
  const rows = RLOGIC.buildRows(ITEMS, orderedFor)
  const entries = {
    ri1: { ...RLOGIC.emptyEntry(), datang: '6', rusak: '2', ws: '3', tukang: '1', penerima: 'Pak Joko', retur: RLOGIC.RETUR_SUPPLIER },
    ri2: { ...RLOGIC.emptyEntry(), datang: '4', rusak: '0', ws: '0', tukang: '4', penerima: 'Pak Budi' }
  }
  const drafts = L.buildEventDrafts(rows, entries, { receivingId: 'rc1' })
  check('A1a dua event dibuat (satu per item yang menerima)', drafts.length === 2)
  const d1 = drafts[0]
  check('A1b qty_datang/rusak terpisah', d1.qty_datang === 6 && d1.qty_rusak === 2)
  check('A1c baik = datang - rusak (4)', d1._computed.baik === 4)
  check('A1d tujuan ws/tukang tersimpan sendiri', d1.tujuan_ws === 3 && d1.tujuan_tukang === 1)
  check('A1e retur supplier → status PENDING (bukan RETURNED)', d1.retur_status === 'PENDING')
  check('A1f retur_qty = qty_rusak', d1.retur_qty === 2)
  check('A1g item tanpa rusak → retur_status NONE', drafts[1].retur_status === 'NONE' && drafts[1].retur_qty === 0)
  check('A1h penerima tukang tersimpan per baris', drafts[1].penerima_tukang === 'Pak Budi')
  // datang 0 → tidak ada event (tidak ada barang = tidak ada kejadian)
  const none = L.buildEventDrafts(rows, { ri1: { ...RLOGIC.emptyEntry(), datang: '0' } }, { receivingId: 'rc1' })
  check('A1i baris datang 0 tidak membuat event', none.length === 0)
}

console.log('\nA2. Idempotency key deterministik (retry tidak menggandakan)')
{
  const a = L.clientEventId('rc1', 'ri1', 0, 6)
  const b = L.clientEventId('rc1', 'ri1', 0, 6)
  const c = L.clientEventId('rc1', 'ri1', 0, 7)
  check('A2a isian sama → id sama', a === b)
  check('A2b isian beda → id beda', a !== c)
  check('A2c id memuat receiving & item & rentang', a === 'rcpt:rc1:ri1:0->6')
  // event kedua untuk item yang sama setelah penerimaan pertama (kumulatif naik)
  const d2 = L.clientEventId('rc1', 'ri1', 6, 4)
  check('A2d penerimaan lanjutan punya id berbeda', d2 !== a && d2 === 'rcpt:rc1:ri1:6->10')
}

console.log('\nA3. Validasi mirror constraint DB')
{
  const base = (o) => ({
    client_event_id: 'x', receiving_item_id: 'ri1', item_name: 'Triplek 9mm',
    qty_datang: 5, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 0,
    penerima_tukang: null, retur_status: 'NONE', retur_qty: 0, discard_confirmed: false, ...o
  })
  check('A3a valid dasar lolos', L.validateEventDrafts([base({})]).ok)
  check('A3b rusak > datang ditolak', !L.validateEventDrafts([base({ qty_rusak: 6 })]).ok)
  check('A3c tujuan > baik ditolak', !L.validateEventDrafts([base({ qty_rusak: 2, tujuan_ws: 4 })]).ok)
  check('A3d tukang tanpa penerima ditolak', !L.validateEventDrafts([base({ tujuan_tukang: 2 })]).ok)
  check('A3e tukang + penerima lolos', L.validateEventDrafts([base({ tujuan_tukang: 2, penerima_tukang: 'Pak Joko' })]).ok)
  check('A3f buang tanpa konfirmasi ditolak', !L.validateEventDrafts([base({ qty_rusak: 1, retur_status: 'DISCARDED', retur_qty: 1, discard_confirmed: false })]).ok)
  check('A3g buang + konfirmasi lolos', L.validateEventDrafts([base({ qty_rusak: 1, retur_status: 'DISCARDED', retur_qty: 1, discard_confirmed: true })]).ok)
  check('A3h over-receipt (sisa) ditolak', !L.validateEventDrafts([base({ qty_datang: 11 })], { sisaById: { ri1: 10 } }).ok)
  check('A3i retur_qty ≠ rusak ditolak', !L.validateEventDrafts([base({ qty_rusak: 2, retur_status: 'PENDING', retur_qty: 1 })]).ok)
  const dup = [base({}), base({})]
  check('A3j dua baris id sama ditolak', !L.validateEventDrafts(dup).ok)
}

console.log('\nA4. eventTotals: rusak NULL = tidak diketahui (bukan 0 palsu)')
{
  const events = [
    { id: 'e1', receiving_item_id: 'ri1', item_name: 'Triplek', unit: 'Lembar', qty_datang: 5, qty_rusak: 1, tujuan_ws: 2, tujuan_tukang: 2, retur_status: 'PENDING', retur_qty: 1 },
    { id: 'e2', receiving_item_id: 'ri1', item_name: 'Triplek', unit: 'Lembar', qty_datang: 3, qty_rusak: null, tujuan_ws: 3, tujuan_tukang: 0, retur_status: 'NONE', retur_qty: 0 }
  ]
  const t = L.eventTotals(events)
  check('A4a satu baris agregat per item', t.length === 1)
  check('A4b datang dijumlah (8)', t[0].datang === 8)
  check('A4c rusak hanya dari yang diketahui (1)', t[0].rusak === 1)
  check('A4d ditandai rusakUnknown', t[0].rusakUnknown === true)
  check('A4e baik = datang - rusak diketahui', t[0].baik === 7)
  check('A4f returPending terakumulasi', t[0].returPending === 1)
  check('A4g jumlah event tercatat', t[0].events === 2)
}

console.log('\nA5. Retur tanpa ketik ulang (baris dari event rusak)')
{
  const events = [
    { id: 'e1', receiving_item_id: 'ri1', item_name: 'Triplek', unit: 'Lembar', qty_rusak: 3, retur_status: 'NONE' },
    { id: 'e2', receiving_item_id: 'ri2', item_name: 'Cat', unit: 'Kaleng', qty_rusak: 0, retur_status: 'NONE' },
    { id: 'e3', receiving_item_id: 'ri3', item_name: 'Paku', unit: 'Kg', qty_rusak: 2, retur_status: 'PENDING' }
  ]
  const lines = L.returLinesFromEvents(events)
  // e2 rusak 0 → tidak ada retur. e3 sudah berstatus PENDING → SUDAH diretur,
  // tidak boleh ditawarkan lagi (temuan review: dulu ikut ditawarkan sehingga
  // retur yang sama bisa dicatat dua kali).
  check('A5a hanya event rusak > 0 dan BELUM diretur', lines.length === 1 && lines[0].receiving_event_id === 'e1', JSON.stringify(lines.map(l => l.receiving_event_id)))
  check('A5b qty & satuan ikut event (tanpa input ulang)', lines[0].qty === 3 && lines[0].satuan === 'Lembar')
  check('A5c event berstatus PENDING tidak ditawarkan lagi', !lines.some(l => l.receiving_event_id === 'e3'))
  // sebagian sudah diretur → sisa
  const partial = L.returLinesFromEvents(events, { alreadyReturned: { e1: 1 } })
  check('A5d qty sisa setelah retur sebagian', partial.find(l => l.receiving_event_id === 'e1').qty === 2)
  const full = L.returLinesFromEvents(events, { alreadyReturned: { e1: 3 } })
  check('A5e baris yang sudah diretur penuh tidak muncul', !full.some(l => l.receiving_event_id === 'e1'))
}

console.log('\nA6. Handover prefill: alokasi tukang − yang sudah diserahkan')
{
  const events = [
    { id: 'e1', receiving_item_id: 'ri1', item_name: 'Triplek', unit: 'Lembar', tujuan_tukang: 4, penerima_tukang: 'Pak Joko' },
    { id: 'e2', receiving_item_id: 'ri2', item_name: 'Cat', unit: 'Kaleng', tujuan_tukang: 0 },
    { id: 'e3', receiving_item_id: 'ri3', item_name: 'Paku', unit: 'Kg', tujuan_tukang: 2, penerima_tukang: 'Pak Budi' }
  ]
  const pf = L.handoverLinesFromEvents(events, { e1: 1 })
  check('A6a hanya event dengan alokasi tukang', pf.length === 2)
  check('A6b qty prefill = sisa (4-1=3)', pf[0].qty_diserahkan === 3)
  check('A6c alokasi & riwayat diserahkan ikut tampil', pf[0].qty_alokasi === 4 && pf[0].qty_sudah_diserahkan === 1)
  check('A6d penerima default dari event', pf[0].penerima === 'Pak Joko')
  const done = L.handoverLinesFromEvents(events, { e1: 4, e3: 2 })
  check('A6e yang sudah diserahkan penuh tidak muncul', done.length === 0)
}

console.log('\nA7. Pemecahan PR multi-vendor (grouping + guard histori)')
{
  const items = [
    { id: 'x1', pr_item_id: 'pi1', item_name: 'Triplek', quantity_received: 0 },
    { id: 'x2', pr_item_id: 'pi2', item_name: 'Cat', quantity_received: 0 }
  ]
  const vendorOf = (it) => prItemById.get(it.pr_item_id)?.vendor_id
  const groups = L.groupItemsByVendor(items, vendorOf)
  check('A7a dua grup vendor', groups.length === 2)
  check('A7b grup pertama vendor v1', groups[0].vendorId === 'v1' && groups[0].items.length === 1)
  check('A7c needsVendorSplit true utk 2 vendor nyata', L.needsVendorSplit(['v1', 'v2']))
  check('A7d needsVendorSplit false utk 1 vendor', !L.needsVendorSplit(['v1', 'v1', null]))
  check('A7e nota belum bergerak boleh dipecah', L.splitBlockReason(RECEIVING, items) === '')
  check('A7f sudah masuk gudang ditolak', /stok gudang/.test(L.splitBlockReason({ ...RECEIVING, masuk_gudang: true }, items)))
  check('A7g sudah ke tukang ditolak', /tukang/.test(L.splitBlockReason({ ...RECEIVING, alokasi: 'KE_TUKANG' }, items)))
  check('A7h sudah ada qty diterima ditolak', /Sudah ada jumlah diterima/.test(L.splitBlockReason(RECEIVING, [{ ...items[0], quantity_received: 2 }])))
  const noVendor = L.groupItemsByVendor([{ id: 'x3', pr_item_id: null }], () => null)
  check('A7i item tanpa vendor → grup "belum ditentukan" di akhir', noVendor.length === 1 && noVendor[0].vendorId === null)
}

console.log('\nA8. Validasi konfirmasi fisik (qty ≤ sisa, penerima wajib)')
{
  const prefill = [
    { receiving_event_id: 'e1', receiving_item_id: 'ri1', item_name: 'Triplek', satuan: 'Lembar', qty_alokasi: 4, qty_sudah_diserahkan: 1, penerima: 'Pak Joko' }
  ]
  check('A8a qty melebihi sisa ditolak', !L.validateHandoverLines([{ receiving_event_id: 'e1', qty_diserahkan: 4 }], prefill).ok)
  check('A8b qty pas sisa lolos', L.validateHandoverLines([{ receiving_event_id: 'e1', qty_diserahkan: 3 }], prefill).ok)
  check('A8c qty 0 ditolak', !L.validateHandoverLines([{ receiving_event_id: 'e1', qty_diserahkan: 0 }], prefill).ok)
  check('A8d penerima kosong (tanpa default) ditolak', !L.validateHandoverLines([{ receiving_event_id: 'e1', qty_diserahkan: 1, penerima: ' ' }], [{ ...prefill[0], penerima: '' }]).ok)
  check('A8e baris bukan dari penerimaan ini ditolak', !L.validateHandoverLines([{ receiving_event_id: 'zzz', qty_diserahkan: 1 }], prefill).ok)
  check('A8f tanpa baris → error jelas', !L.validateHandoverLines([], prefill).ok)
}

console.log('\n=== B. CAPABILITY PROBE (read-only) ===\n')
{
  mock.__reset({ tables: [] })
  CAP.resetReceiptCapability()
  const cap1 = await CAP.getReceiptCapability({ force: true })
  check('B1a skema belum ada → ready=false', cap1.ready === false)
  check('B1b missing menyebut receiving_events', cap1.missing.some(m => /receiving_events/.test(m)))
  check('B1c pesan jujur menyebut belum aktif + tidak menulis', /belum aktif/i.test(CAP.capabilityMessage(cap1)) && /Tidak ada data yang ditulis/.test(CAP.capabilityMessage(cap1)))
  check('B3a probe tidak menulis (nol insert/update/rpc)', mock.__callsOf('insert').length === 0 && mock.__callsOf('update').length === 0 && mock.__rpcCalls().length === 0)

  mock.__reset({ tables: ['receiving_events', 'handover_items', 'v_receipt_progress'] })
  CAP.resetReceiptCapability()
  const cap2 = await CAP.getReceiptCapability({ force: true })
  check('B2a semua tabel ada → ready=true', cap2.ready === true && cap2.events === true && cap2.handoverItems === true)
  check('B2b pesan kosong saat siap', CAP.capabilityMessage(cap2) === '')

  // cache: panggilan kedua tanpa force tidak menambah query
  const before = mock.__callsOf('select').length
  await CAP.getReceiptCapability()
  check('B4a cache: probe kedua tidak query ulang', mock.__callsOf('select').length === before)
  await CAP.getReceiptCapability({ force: true })
  check('B4b force=true query ulang', mock.__callsOf('select').length > before)

  // tabel ada tapi kolom kurang → dianggap belum siap (bukan optimistis)
  mock.__reset({ tables: ['receiving_events'] })
  CAP.resetReceiptCapability()
  const cap3 = await CAP.getReceiptCapability({ force: true })
  check('B2c handover_items hilang → ready=false', cap3.ready === false && cap3.missing.some(m => /handover_items/.test(m)))
}

console.log('\n=== C. SIMPAN VIA RPC (receiptEventSave.js + mock) ===\n')
{
  mock.__reset({ tables: ['receiving_events', 'handover_items'], receivingItems: ITEMS })
  const rows = RLOGIC.buildRows(ITEMS, orderedFor)
  const entries = {
    ri1: { ...RLOGIC.emptyEntry(), datang: '6', rusak: '2', ws: '2', tukang: '2', penerima: 'Pak Joko', retur: RLOGIC.RETUR_SUPPLIER },
    ri2: { ...RLOGIC.emptyEntry(), datang: '4', tukang: '4', penerima: 'Pak Budi' }
  }
  const drafts = L.buildEventDrafts(rows, entries, { receivingId: 'rc1' })
  const sisaById = { ri1: 10, ri2: 4 }
  const res1 = await SAVE.applyReceiptEvents({ receiving: RECEIVING, drafts, sisaById })
  check('C1a RPC dipanggil sekali', mock.__rpcCalls('receipt_apply_events').length === 1)
  check('C1b dua event tersimpan', res1.ok && res1.applied === 2)
  check('C1c quantity_received = Σ datang (item1=6)', mock.__state.rows.get('receiving_items:ri1').quantity_received === 6)
  check('C1d quantity_received item2=4', mock.__state.rows.get('receiving_items:ri2').quantity_received === 4)
  check('C1e payload memuat dimensi per barang', (() => { const p = mock.__rpcCalls('receipt_apply_events')[0].args.p_events; return p[0].qty_rusak === 2 && p[0].tujuan_tukang === 2 && p[0].retur_status === 'PENDING' })())
  check('C1f field internal _computed TIDAK dikirim ke DB', (() => { const p = mock.__rpcCalls('receipt_apply_events')[0].args.p_events; return p.every(x => !('_computed' in x)) })())

  // C2: submit ganda (retry) → tidak menggandakan
  const res2 = await SAVE.applyReceiptEvents({ receiving: RECEIVING, drafts, sisaById })
  check('C2a retry tetap ok', res2.ok === true)
  check('C2b retry melaporkan already_applied', res2.alreadyApplied === 2 && res2.applied === 0)
  check('C2c qty TIDAK bertambah dua kali (masih 6)', mock.__state.rows.get('receiving_items:ri1').quantity_received === 6)
  check('C2d jumlah event di DB tetap 2', mock.__state.events.length === 2)

  // C3: validasi gagal → nol RPC
  mock.__reset({ tables: ['receiving_events', 'handover_items'], receivingItems: ITEMS })
  const badDrafts = [{ ...drafts[0], qty_rusak: 99 }]
  const res3 = await SAVE.applyReceiptEvents({ receiving: RECEIVING, drafts: badDrafts, sisaById })
  check('C3a draft invalid ditolak sebelum RPC', res3.ok === false && /rusak/i.test(res3.error))
  check('C3b NOL panggilan RPC', mock.__rpcCalls().length === 0)

  // C4: error RPC diteruskan
  mock.__reset({ tables: ['receiving_events'], receivingItems: ITEMS, rpcResult: { data: null, error: { message: 'over_receipt: melebihi pesanan', code: 'P0001' } } })
  const res4 = await SAVE.applyReceiptEvents({ receiving: RECEIVING, drafts, sisaById })
  check('C4a error RPC tidak ditelan', res4.ok === false && /over_receipt/.test(res4.error))

  // C5: handover_confirm idempoten
  mock.__reset({
    tables: ['handover_items'],
    handovers: [{ id: 'h1', receiving_id: 'rc1', status: 'DRAFT', diserahkan_at: null, received_by: 'Pak Joko' }]
  })
  const lines = [{ receiving_event_id: 'e1', receiving_item_id: 'ri1', item_name: 'Triplek', satuan: 'Lembar', qty_diserahkan: 2, penerima: 'Pak Joko' }]
  const h1 = await SAVE.confirmHandoverLines({ handover: { id: 'h1' }, lines })
  check('C5a konfirmasi menulis diserahkan_at', h1.ok && !!mock.__state.rows.get('handovers:h1').diserahkan_at)
  check('C5b status jadi CONFIRMED', mock.__state.rows.get('handovers:h1').status === 'CONFIRMED')
  check('C5c handover_items tersimpan', mock.__state.handoverItems.length === 1)
  const h2 = await SAVE.confirmHandoverLines({ handover: { id: 'h1' }, lines })
  check('C5d konfirmasi ulang → already (tidak dobel)', h2.ok && h2.already === true)
  check('C5e handover_items TIDAK bertambah', mock.__state.handoverItems.length === 1)

  // C6: retur dari event
  mock.__reset({ tables: ['return_cases', 'return_lines'], events: [{ id: 'e1', receiving_item_id: 'ri1', item_name: 'Triplek', qty_datang: 5, qty_rusak: 2, retur_status: 'NONE' }] })
  const rres = await SAVE.createReturnCase({ receiving: RECEIVING, lines: [{ receiving_event_id: 'e1', qty: 2 }], resolution: 'RETURN', reason: 'penyok' })
  check('C6a return_cases dibuat', rres.ok && mock.__state.returnCases.length === 1)
  check('C6b return_lines merujuk event (bukan ketik ulang)', mock.__state.returnLines.length === 1 && mock.__state.returnLines[0].receiving_event_id === 'e1')
  check('C6c status event jadi PENDING', mock.__state.events[0].retur_status === 'PENDING')
  check('C6d tidak ada qty diterima yang berubah (nol update receiving_items)', mock.__callsOf('update', 'receiving_items').length === 0)

  // C7 (temuan review): retur yang SAMA tidak boleh ditawarkan/dicatat dua kali.
  // Dulu returnForm memanggil returLinesFromEvents TANPA riwayat retur, jadi
  // membuka modal dua kali mencatat qty rusak 2 menjadi 4.
  const eventsAfter = [{ id: 'e1', receiving_item_id: 'ri1', item_name: 'Triplek', qty_datang: 5, qty_rusak: 2, retur_status: 'PENDING' }]
  check('C7a event berstatus retur tidak ditawarkan lagi (tanpa riwayat)', L.returLinesFromEvents(eventsAfter).length === 0)
  const half = L.returLinesFromEvents(eventsAfter, { alreadyReturned: { e1: 1 } })
  check('C7b retur sebagian → sisa 1 (dari riwayat return_lines)', half.length === 1 && half[0].qty === 1)
  check('C7c retur penuh → tidak ada baris', L.returLinesFromEvents(eventsAfter, { alreadyReturned: { e1: 2 } }).length === 0)
  // Sumber qty retur dibaca dari DB, bukan diasumsikan
  mock.__reset({ tables: ['return_lines'], events: [] })
  mock.__state.rows.set('return_lines:rl1', { id: 'rl1', return_case_id: 'rc1', receiving_event_id: 'e1', qty: 1 })
  const lr = await SAVE.loadReturnedByEvent({ eventIds: ['e1'] })
  check('C7d loadReturnedByEvent menjumlah qty dari return_lines', lr.ok && lr.returned.e1 === 1)
  const lrMissing = await (async () => { mock.__reset({ tables: [] }); return SAVE.loadReturnedByEvent({ eventIds: ['e1'] }) })()
  check('C7e return_lines belum ada → ok=false (modal menolak, bukan mengarang)', lrMissing.ok === false)
}

console.log('\n=== D. PEMECAHAN NOTA MULTI-VENDOR (receiptSplit.js + mock) ===\n')
{
  const items = [
    { id: 'x1', receiving_id: 'rc1', pr_item_id: 'pi1', item_name: 'Triplek', unit: 'Lembar', quantity_received: 0 },
    { id: 'x2', receiving_id: 'rc1', pr_item_id: 'pi2', item_name: 'Cat', unit: 'Kaleng', quantity_received: 0 }
  ]
  const vendors = [{ id: 'v1', name: 'Toko A' }, { id: 'v2', name: 'Toko B' }]
  const plan = SPLIT.buildSplitPlan({ receiving: RECEIVING, items, prItems: PR_ITEMS, vendors })
  check('D1a rencana dua grup vendor', plan.ok && plan.plan.length === 2)
  check('D1b nota pertama memakai nota yang ada', plan.plan[0].existingReceivingId === 'rc1')
  check('D1c nota kedua dibuat baru', plan.plan[1].existingReceivingId === null)
  check('D1d label nota memuat nama vendor', /Toko A/.test(plan.plan[0].deliveryNote) && /Toko B/.test(plan.plan[1].deliveryNote))
  check('D1e jejak PR tetap dijelaskan', /purchase_request_id/.test(plan.plan[0].note))

  const blocked = SPLIT.buildSplitPlan({ receiving: { ...RECEIVING, masuk_gudang: true }, items, prItems: PR_ITEMS, vendors })
  check('D2a nota sudah masuk gudang → tolak', blocked.ok === false && /stok gudang/.test(blocked.reason))
  const oneVendor = SPLIT.buildSplitPlan({ receiving: RECEIVING, items: [items[0]], prItems: PR_ITEMS, vendors })
  check('D2b satu vendor → tidak perlu dipecah', oneVendor.ok === false && /satu vendor/.test(oneVendor.reason))

  // D2c/D2d (temuan review): barang TANPA vendor tidak boleh membuat nota
  // dilabeli vendor lain. Dulu grup "belum ditentukan" ikut dihitung sebagai
  // grup ke-2 → tombol muncul, nota asal dilabeli, dan item yatim tertinggal.
  const prItemsWithOrphan = [
    { id: 'pi1', vendor_id: 'v1', quantity: 2 },
    { id: 'pi2', vendor_id: null, quantity: 1 }
  ]
  const orphan = SPLIT.buildSplitPlan({ receiving: RECEIVING, items, prItems: prItemsWithOrphan, vendors })
  check('D2c barang tanpa vendor → pemecahan DITOLAK (bukan dilabeli)', orphan.ok === false && /belum punya vendor/.test(orphan.reason), JSON.stringify(orphan.reason))
  const onlyOneReal = SPLIT.buildSplitPlan({ receiving: RECEIVING, items, prItems: [{ id: 'pi1', vendor_id: 'v1' }, { id: 'pi2', vendor_id: 'v1' }], vendors })
  check('D2d satu vendor nyata + tanpa vendor → tetap tidak perlu dipecah', onlyOneReal.ok === false)

  // D2e (temuan review): nota yang SUDAH berlabel vendor tidak boleh diganti
  // vendor_id-nya diam-diam. Nota asal harus memakai grup vendor yang sama.
  const prItemsAB = [{ id: 'pi1', vendor_id: 'v1', quantity: 2 }, { id: 'pi2', vendor_id: 'v2', quantity: 1 }]
  const labeledB = SPLIT.buildSplitPlan({ receiving: { ...RECEIVING, vendor_id: 'v2' }, items, prItems: prItemsAB, vendors })
  check('D2e nota sudah berlabel v2 → nota asal memakai v2', labeledB.ok && labeledB.plan[0].vendorId === 'v2' && labeledB.plan[0].existingReceivingId === 'rc1')
  const mismatched = SPLIT.buildSplitPlan({ receiving: { ...RECEIVING, vendor_id: 'v9' }, items, prItems: prItemsAB, vendors })
  check('D2f label vendor tak cocok dengan isi → ditolak', mismatched.ok === false && /tidak ada pada barang/.test(mismatched.reason))

  // D3: eksekusi
  mock.__reset({
    tables: ['receivings', 'receiving_items'],
    receivingItems: items
  })
  // nota rc1 sebagai baris receivings yang sudah ada (dipakai ulang)
  mock.__state.rows.set('receivings:rc1', { ...RECEIVING })
  const res = await SPLIT.applySplitPlan({ receiving: RECEIVING, plan: plan.plan, existingReceivings: [RECEIVING] })
  check('D3a eksekusi sukses', res.ok === true, res.error || '')
  const movedItem = mock.__state.rows.get('receiving_items:x2')
  check('D3b item vendor kedua pindah ke nota baru', movedItem.receiving_id !== 'rc1')
  check('D3c nota baru berisi vendor_id', (() => { const r = mock.__state.rows.get('receivings:' + movedItem.receiving_id); return r && r.vendor_id === 'v2' })())
  check('D3d nota asal diberi vendor pertama', mock.__state.rows.get('receivings:rc1').vendor_id === 'v1')
  check('D3e readback dilaporkan (tidak klaim tanpa verifikasi)', res.ok === true && Array.isArray(res.done))

  // D4: idempoten — nota (PR, vendor) sudah ada → tidak bikin nota baru
  const before = [...mock.__state.rows.keys()].filter(k => k.startsWith('receivings:')).length
  const existing = [
    { ...RECEIVING },
    { id: 'rec-v2', purchase_request_id: 'pr1', vendor_id: 'v2' }
  ]
  const res2 = await SPLIT.applySplitPlan({ receiving: RECEIVING, plan: plan.plan, existingReceivings: existing })
  const after = [...mock.__state.rows.keys()].filter(k => k.startsWith('receivings:')).length
  check('D4a nota vendor yang sudah ada dipakai ulang', res2.ok === true && after === before, `${before} -> ${after}`)
}

console.log('\n---------------------------------------------')
console.log(`TOTAL: ${pass} lulus, ${fail} gagal`)
if (fail) {
  console.log('GAGAL:')
  for (const f of failures) console.log(' - ' + f)
  process.exit(1)
}
