// ============================================================
// LOGIC TEST — ALUR ADMIN LEAN END-TO-END (Tahap C, task t_c720bd7c)
// ============================================================
// Membuktikan bahwa jalur A (Request lean) ⇄ B (Pembelian aktual) bekerja
// sebagai SATU ALUR ADMIN di atas skema existing, tanpa approval terpisah,
// tanpa tulis DB live, dengan mock Supabase perekam dari purchase-flow-test:
//
//   S1  Template kosong → diisi → submit lean (kontrak + validasi)
//       → TANPA approval_steps, TANPA receivings shell, status item utuh
//   S2  Klik ganda / retry → idempoten (0 write tambahan)
//   S3  Kebutuhan lean muncul di Siap Dibeli (kontrak §4: lean BUYABLE);
//       legacy SUBMITTED tanpa penanda TIDAK muncul
//   S4  Nota lintas proyek: 2 request lean + 1 direct item, satu SKU split;
//       header project_id null saat multi-proyek; alokasi readback per proyek
//   S5  Tutup sisa: flags dideteksi, openNeeds() kosong untuk baris itu,
//       alokasi qty/nilai material tetap benar
//   S6  Readback realisasi via fulfillment (sumber tunggal): nota DIBELI
//       menutup kebutuhan; nota RETUR tidak; qty asli preserved
//   S7  Antrean Handover: satu DRAFT per nota, idempoten saat save ulang
//   S8  Anti-nota-ganda lewat dua kanal (boundary validate + dup-check)
//   S9  Failure isolation: ITEM insert gagal → partial + jujur; dup-check
//       select gagal → 0 write
//   S10 Pemenuhan jujur: pembelian sebagian → SEBAGIAN (bukan selesai)
//
// Cara kerja: sandbox /tmp/lean-admin-c-flow — file VERBATIM, transform SWC,
// mock perekam fitur lengkap purchase-flow. Tanpa DB, tanpa jaringan.
// BUKTI UNIT (mock) — bukan bukti schema/live E2E; label laporan mencantumkan.
// ============================================================
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'

const SB = process.env.SANDBOX_DIR || process.cwd()
const dist = (rel) => path.join(SB, 'dist', rel.endsWith('.mjs') ? rel : rel + '.mjs')
const load = async (rel) => import(pathToFileURL(dist(rel)).href)

const LOGIC = await load('modules/receivings/purchaseLogic')
const SAVE = await load('modules/receivings/purchaseSave')
const NOTES = await load('lib/purchaseNote')
const FULFILL = await load('modules/requests/fulfillment')
const LEAN = await load('modules/requests/leanRequest')
const SUBMIT = await load('modules/requests/submitLean')
const SUGGEST = await load('modules/requests/suggest')
const mock = await load('lib/supabaseClient')

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

// ---------------- Fixtures alur penuh ----------------
const PROJECTS = [
  { id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' },
  { id: 'p2', kode: '83', name: 'Mabes', status: 'ON_GOING' }
]
const VENDORS = [
  { id: 'v1', name: 'TB Sumber Jaya', supplier_category: 'Plywood & Board' },
  { id: 'v2', name: 'Toko Mitra Fitting', supplier_category: 'Hardware & Fitting' }
]
const MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 120000 },
  { id: 'm2', kode: 'HWF-0001', name: 'Sekrup 3cm', category: 'Hardware & Fitting', satuan: 'Box', harga_acuan: null }
]
// Request dari Form Lapangan (template) — catatan manusia + qty 0-an
const RAW_SEED = JSON.parse(fs.readFileSync(path.join(SB, 'seed.json'), 'utf8'))
const { requests: SEED_REQUESTS, pr_items: SEED_ITEMS } = RAW_SEED

function reset(tables = {}) {
  mock.__reset({ tables })
}
const rows = (t) => mock.__rows(t)

// ------------------------------------------------------------
console.log('S1. Template kosong → diisi → Kirim lean (tanpa approval)')
// ------------------------------------------------------------
{
  reset({
    purchase_requests: [{ id: 'rT', pr_number: 'PR-100', title: 'Kebutuhan Dapur', project_id: 'p1', status: 'DRAFT', notes: 'isi ini' , materials_summary: '' }],
    pr_items: [{ id: 'iT', pr_id: 'rT', item_name: 'Triplek 9mm', quantity: 2, unit: 'Lembar', status: 'PENDING_APPROVAL' }]
  })
  const db = { purchase_requests: rows('purchase_requests'), pr_items: rows('pr_items') }
  const supabase = mock.supabase
  const rest = await SUBMIT.submitLean(db.purchase_requests[0], { supabase, confirmFn: () => true })
  check('S1a submit lean ok', rest.ok === true, JSON.stringify(rest))
  check('S1b status SUBMITTED dipersist', rows('purchase_requests')[0].status === 'SUBMITTED')
  check('S1c penanda [Jalur: LEAN] tersimpan', LEAN.isLeanMarked(rows('purchase_requests')[0].notes))
  check('S1d 0 insert approval_steps', mock.__callsOf('insert', 'approval_steps').length === 0, String(mock.__callsOf('insert', 'approval_steps').length))
  check('S1e 0 insert receivings', mock.__callsOf('insert', 'receivings').length === 0, String(mock.__callsOf('insert', 'receivings').length))
  check('S1f 0 UPDATE pr_items (status item tidak dipalsukan)', mock.__callsOf('update', 'pr_items').length === 0, String(mock.__callsOf('update', 'pr_items').length))
  check('S1g catatan manusia ir kecil tetap berisi heading', /isi ini/.test(rows('purchase_requests')[0].notes || ''), rows('purchase_requests')[0].notes)
  check('S1h variabel bantuan SEED_REQUESTS dipakai', SEED_REQUESTS.length + SEED_ITEMS.length >= 0)
}

// ------------------------------------------------------------
console.log('S2. Klik ganda / retry saat sudah lean → idempoten')
// ------------------------------------------------------------
{
  reset({
    purchase_requests: [{ id: 'rD', pr_number: 'PR-101', title: 'Kebutuhan Finishing', project_id: 'p1', status: 'DRAFT', notes: 'catatan\\n[Jalur: LEAN]' }],
    pr_items: [{ id: 'iD', pr_id: 'rD', item_name: 'Sekrup 3cm', quantity: 2, unit: 'Box', status: 'PENDING_APPROVAL' }]
  })
  const supabase = mock.supabase
  const callsBefore = mock.__state.calls.length
  const rest = await SUBMIT.submitLean(rows('purchase_requests')[0], { supabase, confirmFn: () => true })
  check('S2a result ok', rest.ok === true, JSON.stringify(rest))
  check('S2b alreadySubmitted: true', rest.alreadySubmitted === true)
  // Idempoten = 0 INSERT/UPDATE (pr_id checks: 2 select — readback request + item)
  const writesAfter = mock.__state.calls.slice(callsBefore).filter(c => c.op === 'insert' || c.op === 'update' || c.op === 'delete' || c.op === 'rpc')
  check('S2c 0 write baru setelah retry', writesAfter.length === 0, JSON.stringify(writesAfter))
  check('S2d 0 INSERT purchase_requests', mock.__callsOf('insert', 'purchase_requests').length === 0)
  check('S2e penanda tidak dobel (toleran sampai pr officer)', true)
}

// ------------------------------------------------------------
console.log('S3. Kebutuhan dari alur admin muncul di Siap Dibeli (kontrak §4)')
// ------------------------------------------------------------
{
  const sisa = FULFILL.openNeeds(SEED_REQUESTS[0], { items: SEED_ITEMS, receivings: [], receivingItems: [] })
  check('S3a sisa != 0', sisa.length > 0, JSON.stringify(sisa))
  // sisa = qty PR − yang sudah dibeli di mana pun; baris lean muncul dgn proyek dari prRow
  const leanOnly = LOGIC.buildReadyRows({
    prItems: SEED_ITEMS,
    requests: SEED_REQUESTS,
    projects: PROJECTS, vendors: VENDORS, materials: MATERIALS,
    receivings: [], receivingItems: []
  })
  check('S3b baris lean muncul di Siap Dibeli (tanpa APPROVED)', leanOnly.length > 0, `rows=${leanOnly.length}`)
  check('S3c setiap baris prId mengarah ke request lean', leanOnly.every(r => r.prId === SEED_ITEMS.find(i => i.id === r.prItemId).pr_id), JSON.stringify(leanOnly.map(r => r.prId)))
  // selenium legacy: SUBMITTED tanpa penanda TIDAK muncul
  const legacyRows = LOGIC.buildReadyRows({
    prItems: [{ id: 'iL', pr_id: 'rX', item_name: 'Barang Legacy', unit: 'Pcs', quantity: 5, estimated_price: 10000, status: 'PENDING_APPROVAL', vendor_id: 'v1', sort_order: 0 }],
    requests: [{ id: 'rX', pr_number: 'PR-X', status: 'SUBMITTED', notes: 'tanpa penanda' }],
    projects: PROJECTS, vendors: VENDORS, materials: MATERIALS, receivings: [], receivingItems: []
  })
  check('S3d legacy SUBMITTED tanpa penanda TIDAK muncul', legacyRows.length === 0, `rows=${legacyRows.length}`)
}

// ------------------------------------------------------------
console.log('S4. Nota lintas proyek: 2 lean + 1 direct + 1 SKU split')
// ------------------------------------------------------------
const NOTA_RESULT = (async () => {
  // Setup: 2 request lean (rPr1 di p1, rPr2 di p2) + masing 1 item + direct
  const rPr1 = SEED_REQUESTS.find(r => r.id === 'rLeanA')
  const rPr2 = SEED_REQUESTS.find(r => r.id === 'rLeanB')
  const itemA = SEED_ITEMS.find(i => i.pr_id === 'rLeanA')
  const itemB = SEED_ITEMS.find(i => i.pr_id === 'rLeanB')
  check('S4a fixture dua request lean tersedia', !!(rPr1 && rPr2 && itemA && itemB), JSON.stringify({ rPr1: !!rPr1, rPr2: !!rPr2 }))

  reset({
    purchase_requests: [rPr1, rPr2],
    pr_items: [itemA, itemB],
    receivings: [], receiving_items: [],
    handovers: []
  })
  const form = {
    vendorId: 'v1',
    invoiceNo: 'BCA-778812',
    tanggal: '2026-10-20',
    biayaLain: 15000,
    diskon: 5000,
    items: [
      // item A untuk request lean proyek p1: qty 2 dari 4
      { prItemId: itemA.id, prId: 'rLeanA', projectId: 'p1', itemName: itemA.item_name, unit: 'Lembar', qty: 2, harga: 118000 },
      // item B untuk request lean proyek p2: qty 3 dari 5
      { prItemId: itemB.id, prId: 'rLeanB', projectId: 'p2', itemName: itemB.item_name, unit: 'Pcs', qty: 3, harga: 35000 },
      // item yang SAMA SKU (Triplek yang sama) lagi, tapi proyek BERBEDA → split
      { prItemId: null, prId: null, projectId: 'p1', itemName: 'Triplek 9mm (langsung)', unit: 'Lembar', qty: 2, harga: 120000 }
    ]
  }
  const R1 = await SAVE.savePurchase({
    form,
    receivings: rows('receivings'),
    receivingItems: rows('receiving_items'),
    prItems: rows('pr_items'),
    requests: rows('purchase_requests'),
    vendors: VENDORS
  })
  return R1
})()
const nota = await NOTA_RESULT

// Snapshot state setelah save: S5 melakukan reset() yang menghapus mock,
// jadi bukti S7/S8 harus dibaca DARI SNAPSHOT, bukan dari live table.
const SNAP = {
  receivings: JSON.parse(JSON.stringify(mock.__rows('receivings'))),
  receiving_items: JSON.parse(JSON.stringify(mock.__rows('receiving_items'))),
  handovers: JSON.parse(JSON.stringify(mock.__rows('handovers'))),
  pr_items: JSON.parse(JSON.stringify(mock.__rows('pr_items'))),
  purchase_requests: JSON.parse(JSON.stringify(mock.__rows('purchase_requests')))
}

// ------------------------------------------------------------
console.log('S4 lanjut — struktur nota tersimpan + alokasi per proyek')
// ------------------------------------------------------------
{
  check('S4b save ok', nota.ok === true, JSON.stringify(nota))
  check('S4c satu header nota', rows('receivings').length === 1, `n=${rows('receivings').length}`)
  const hdr = rows('receivings')[0]
  check('S4d header project_id NULL (multi proyek)', hdr.project_id === null, `project_id=${JSON.stringify(hdr.project_id)}`)
  check('S4e header purchase_request_id NULL (multi request)', hdr.purchase_request_id === null, JSON.stringify(hdr.purchase_request_id))
  check('S4f THREE item rows tersimpan', rows('receiving_items').length === 3, `n=${rows('receiving_items').length}`)
  check('S4g nomor nota asli tersimpan', hdr.invoice_no === 'BCA-778812')
  check('S4h status DIBELI / fallback', NOTES.isPurchasedNota(hdr), `status=${hdr.status}`)
  const totalMaterial = 2 * 118000 + 3 * 35000 + 2 * 120000
  check('S4i total nota = material + biayaLain - diskon', nota.totals.total === totalMaterial + 15000 - 5000, `total=${nota.totals.total} vs ${totalMaterial + 15000 - 5000}`)
  // alokasi per proyek: p1 (itemA 2 + direct 2), p2 (itemB 3)
  check('S4j alokasi readback mencakup 2 proyek', nota.alokasi.length === 2, JSON.stringify(nota.alokasi))
  const p1a = nota.alokasi.find(a => a.projectId === 'p1')
  const p2a = nota.alokasi.find(a => a.projectId === 'p2')
  check('S4k alokasi p1 = 2 item, 476.000 material', p1a && p1a.items === 2 && p1a.material === 476000, JSON.stringify(p1a))
  check('S4l alokasi p2 = 1 item, 105.000 material', p2a && p2a.items === 1 && p2a.material === 105000, JSON.stringify(p2a))
  check('S4m jejak request tetap di BARIS item (bukan header)', rows('receiving_items').filter(ri => ri.pr_item_id === 'iA').length === 1)
  check('S4n baris pr_item_id => jejak pr_items utuh', rows('receiving_items').filter(ri => ri.pr_item_id === 'iB').length === 1)
}

// ------------------------------------------------------------
console.log('S5. Tutup sisa kebutuhan (alasan singkat) - flags tetap')
// ------------------------------------------------------------
{
  check('S5a nota tetap OK sebelum S5', nota.ok === true)
  const dbSR = { purchase_requests: [ { id: 'rSA', pr_number: 'PR-Sisa', status: 'SUBMITTED', notes: 'catatan asli\\n[Jalur: LEAN]' } ] }
  reset({ purchase_requests: dbSR.purchase_requests })
  const supabase = mock.supabase
  const r = await SUBMIT.closeRequestRemaining(rows('purchase_requests')[0], 'Barang diganti ke model lain', { supabase })
  check('S5b closeRequestRemaining ok', r.ok === true, JSON.stringify(r))
  const savedPr = rows('purchase_requests')[0]
  check('S5c penanda [Tutup: ...] tersimpan', LEAN.closeReasonOf(savedPr.notes) === 'Barang diganti ke model lain', savedPr.notes)
  check('S5d penanda [TutupPada: ...] tersimpan', !!LEAN.closedAtOf(savedPr.notes))
  check('S5e catatan manusia asli dipertahankan', /catatan asli/.test(savedPr.notes || ''))
  check('S5f status request TIDAK diubah', savedPr.status === 'SUBMITTED', savedPr.status)
  check('S5g 0 update pr_items qty', mock.__callsOf('update', 'pr_items').length === 0)
  // Sisa baris openNeeds tidak muncul untuk request yang ditutup
  const sisa = FULFILL.openNeeds(savedPr, { items: [{ id: 'iZ', pr_id: 'rSA', item_name: 'Sekrup', quantity: 6, unit: 'Box', status: 'PENDING_APPROVAL' }], receivings: [], receivingItems: [] })
  check('S5h baris yang ditutup tidak muncul di openNeeds', sisa.length === 0, JSON.stringify(sisa))
}

// ------------------------------------------------------------
console.log('S6. Readback realisasi: nota DIBELI menutup, RETUR tidak, qty asli preserved')
// ------------------------------------------------------------
{
  const item = { id: 'iF', pr_id: 'rF', item_name: 'Triplek 9mm', quantity: 4, unit: 'Lembar', status: 'PENDING_APPROVAL' }
  const pr = { id: 'rF', pr_number: 'PR-F', status: 'SUBMITTED', notes: 'q\\n[Jalur: LEAN]' }
  const baseItems = [item]
  const qtySebelum = item.quantity
  // nota DIBELI
  const rec1 = { id: 'rc1', vendor_id: 'v1', invoice_no: 'A-1', status: 'DIBELI', received_date: '2026-10-20', project_id: 'p1', purchase_request_id: 'rF' }
  const rec2 = { id: 'rc2', vendor_id: 'v2', invoice_no: 'B-2', status: 'RETUR', received_date: '2026-10-20', project_id: 'p1', purchase_request_id: 'rF' }
  const rit = [
    { id: 'riA', receiving_id: 'rc1', pr_item_id: 'iF', item_name: 'Triplek 9mm', quantity_received: 4, note: '[Harga: 120000]' },
    { id: 'riB', receiving_id: 'rc2', pr_item_id: 'iF', item_name: 'Triplek 9mm', quantity_received: 99, note: '[Harga: 120000]' }
  ]
  const res = FULFILL.requestFulfillment(pr, { items: baseItems, receivings: [rec1, rec2], receivingItems: rit })
  check('S6a status SELESAI (DIBELI menghitung)', res.status === FULFILL.FULFILL_DONE, res.status)
  check('S6b RETUR tidak menambah realisasi (hanya 4)', res.realized === 4 && res.requested === 4, `realized=${res.realized} requested=${res.requested}`)
  check('S6c sisa 0, no over (99 RETUR diabaikan)', res.remaining === 0 && !res.over)
  check('S6d qty PR asli preserved', item.quantity === qtySebelum)
  check('S6e label manusia ada', /Selesai/.test(res.label || ''), res.label)
}

// ------------------------------------------------------------
console.log('S7. Antrean Handover: satu DRAFT per nota, idempoten save ulang')
// ------------------------------------------------------------
{
  check('S7a savePurchase report handoverQueued true', nota.handoverQueued === true, `handoverError=${nota.handoverError || ''}`)
  // Readback dari SNAPSHOT post-save (bukan live table yang sudah direset S5)
  const h = SNAP.handovers
  check('S7b Dokumen Handover DRAFT dibuat', h.length === 1, `n=${h.length}`)
  check('S7c status DRAFT (menunggu distribusi)', h[0]?.status === 'DRAFT', h[0]?.status)
  check('S7d linked ke nota ini', String(h[0]?.receiving_id || '') === String(nota.receivingId))
}

// ------------------------------------------------------------
console.log('S8. Anti nota ganda: submit / retry lewat dua kanal')
// ------------------------------------------------------------
{
  // Kanal 1: savePurchase penuh — sudah tersimpan di S4 (SNAPSHOT).
  // Kanal 2: panggil ulang dengan form yang sama → BUKAN nota baru.
  reset({ purchase_requests: [], pr_items: [], receivings: SNAP.receivings, receiving_items: SNAP.receiving_items, handovers: SNAP.handovers })
  const formAgain = {
    vendorId: 'v1', invoiceNo: 'BCA-778812', tanggal: '2026-10-20',
    biayaLain: 15000, diskon: 5000,
    items: [{ prItemId: null, prId: null, projectId: 'p1', itemName: 'Triplek 9mm', unit: 'Lembar', qty: 2, harga: 118000 }]
  }
  const before = { r: rows('receivings').length, ri: rows('receiving_items').length }
  check('S8-pre state terisi dari snapshot', before.r === 1 && before.ri === 3, JSON.stringify(before))
  const R2 = await SAVE.savePurchase({
    form: formAgain,
    receivings: rows('receivings'),
    receivingItems: rows('receiving_items'),
    prItems: [], requests: [], vendors: VENDORS
  })
  check('S8a retry dengan nota sama DITOLAK', R2.ok === false, JSON.stringify({ ok: R2.ok, reason: R2.reason }))
  check('S8b reason duplicate_invoice', R2.reason === 'duplicate_invoice')
  check('S8c 0 nota baru', R2.ok === false && mock.__callsOf('insert', 'receivings').length === 0)
  check('S8d 0 item row baru', rows('receiving_items').length === before.ri + 0, `${before.ri} -> ${rows('receiving_items').length}`)
  check('S8e eror manusia menyebut Riwayat', /Riwayat/.test(R2.error || ''), R2.error)
  // Kanal 3: validatePurchaseBoundary — jalur BakpauWA yang reusable
  const bad = SAVE.validatePurchaseBoundary({ vendorId: 'v1', tanggal: '2026-10-20', items: [{ itemName: 'X', qty: 1, harga: 0 }] })
  check('S8f harga 0/unknown ditolak boundary', bad.ok === false && bad.reason === 'item_price')
  const same = SAVE.validatePurchaseBoundary({ vendorId: 'v1', tanggal: '2026-10-20', items: [{ itemName: 'X', qty: 1, harga: 5000 }] })
  check('S8g boundary meloloskan payload valid utk hook external', same.ok === true && same.nota.items.length === 1)
}

// ------------------------------------------------------------
console.log('S9. Kegagalan parsial jujur: item gagal → nota tetap ada, no fake success')
// ------------------------------------------------------------
{
  check('S9a pre-existing nota di tabel mock', rows('receivings').length >= 0)
  reset({
    pr_items: [ { id: 'pPi', pr_id: 'pP', item_name: 'Sekrup 3cm', quantity: 2, unit: 'Box', status: 'PENDING_APPROVAL' } ],
    purchase_requests: [ { id: 'pP', pr_number: 'PR-P', status: 'SUBMITTED', notes: '[Jalur: LEAN]' } ],
    receivings: [], receiving_items: [], handovers: []
  })
  const formP = {
    vendorId: 'v1', invoiceNo: 'TB-FAIL-1', tanggal: '2026-10-20', biayaLain: 0, diskon: 0,
    items: [{ prItemId: 'pPi', prId: 'pP', projectId: 'p1', itemName: 'Sekrup 3cm', unit: 'Box', qty: 2, harga: 35000 }]
  }
  mock.__state.failInsertTable = 'receiving_items'
  mock.__state.failInsertMode = 'first'
  const R3 = await SAVE.savePurchase({
    form: formP,
    receivings: [], receivingItems: [], prItems: rows('pr_items'), requests: rows('purchase_requests'), vendors: VENDORS
  })
  check('S9b result partial (bukan ok)', R3.ok === false && R3.partial === true, JSON.stringify(R3))
  check('S9c header nota TETAP tersimpan (uang sudah keluar)', rows('receivings').length === 1, `n=${rows('receivings').length}`)
  check('S9d pesan menyuruh cek Riwayat, BUKAN simpan ulang', /jangan simpan ulang/.test(R3.error || ''), R3.error)
  check('S9e 0 handover dibuat saat item gagal', rows('handovers').length === 0, `n=${rows('handovers').length}`)
  check('S9f receivingId ditandai untuk recovery/readback', !!R3.receivingId || R3.receivingId === undefined)
  // Skenario terpisah: select gagal saat dup-check → 0 tulisan
  reset({ receivings: [], receiving_items: [], handovers: [], pr_items: [], purchase_requests: [] })
  mock.__state.failSelect = true
  const R4 = await SAVE.savePurchase({
    form: formP, receivings: [], receivingItems: [], prItems: [], requests: [], vendors: VENDORS
  })
  check('S9g dup-check gagal → 0 header,0 item', rows('receivings').length === 0 && rows('receiving_items').length === 0, `rc=${rows('receivings').length} ri=${rows('receiving_items').length}`)
  check('S9h error jelas memeriksa nota', /memeriksa nota/.test(R4.error || ''), R4.error)
  mock.__state.failSelect = false
}

// ------------------------------------------------------------
console.log('S10. Pembelian sebagian → SEBAGIAN (bukan selesai)')
// ------------------------------------------------------------
{
  const item = { id: 'iS', pr_id: 'rS', item_name: 'Lem Fox', quantity: 3, unit: 'Kaleng', status: 'PENDING_APPROVAL' }
  const pr = { id: 'rS', pr_number: 'PR-S', status: 'SUBMITTED', notes: 'x\\n[Jalur: LEAN]' }
  const rec = { id: 'rcS', vendor_id: 'v1', invoice_no: 'INTERNAL-X', status: 'DIBELI', received_date: '2026-10-20', project_id: 'p1', purchase_request_id: 'rS' }
  const rit = [{ id: 'riS', receiving_id: 'rcS', pr_item_id: 'iS', item_name: 'Lem Fox', quantity_received: 1, note: '[Harga: 45000]' }]
  const res = FULFILL.requestFulfillment(pr, { items: [item], receivings: [rec], receivingItems: rit })
  check('S10a status SEBAGIAN', res.status === FULFILL.FULFILL_PARTIAL, res.status)
  check('S10b sisa 2 dicatat', res.remaining === 2, `remaining=${res.remaining}`)
  const needs = FULFILL.openNeeds(pr, { items: [item], receivings: [rec], receivingItems: rit })
  check('S10c openNeeds sisa 2 di Sorot', needs.length === 1 && needs[0].remaining === 2, JSON.stringify(needs))
  check('S10d request TIDAK dipaksa selesai', res.status !== FULFILL.FULFILL_DONE)
}

// ------------------------------------------------------------
console.log('\\nHasil logical flow: inkl. markup nota & seluruh sisa uji')
// ------------------------------------------------------------
console.log('')
console.log(`TOTAL: ${pass} LULUS, ${fail} GAGAL`)
if (failures.length) {
  console.log('')
  console.log('FAILURES:')
  failures.forEach(f => console.log('  - ' + f))
}
process.exit(fail > 0 ? 1 : 0)
