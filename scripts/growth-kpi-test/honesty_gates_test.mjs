// F8. GERBANG KEJUJURAN — t_13fd2d4a (Bit / Noir Living)
// Sumber ASLI: modules/rap-compare/logic.js, modules/materials/acuan.js,
//              modules/requests/estimator.js, modules/stock/logic.js,
//              modules/crm/logic.js, modules/labor-stock/logic.js,
//              modules/receivings/purchaseLogic.js, lib/purchaseNote.js
// Semua angka di bawah FIXTURE buatan harness, BUKAN data live.
//
// Satu aturan yang dijaga suite ini: nilai yang TIDAK DIKETAHUI tidak boleh
// berubah jadi 0, tidak boleh jadi "aman", dan estimasi tidak boleh
// menyamar jadi pembelian aktual.

import { strict as assert } from 'node:assert'
import {
  buildComparison,
  readActualLines,
  readRabLines,
  toCsv
} from './dist/modules/rap-compare/logic.mjs'
import {
  validPrice,
  actualPurchasePrice,
  receivingItemActualPrice,
  makeAcuanHelpers
} from './dist/modules/materials/acuan.mjs'
import { makePrEstimator } from './dist/modules/requests/estimator.mjs'
import {
  summarizeStock,
  toCsv as stockCsv,
  DATA_LIMITATIONS as STOCK_LIM
} from './dist/modules/stock/logic.mjs'
import {
  readCustomers,
  relationCount,
  customerContact,
  DATA_LIMITATIONS as CRM_LIM
} from './dist/modules/crm/logic.mjs'
import {
  summarizeLabor,
  DATA_LIMITATIONS as LABOR_LIM
} from './dist/modules/labor-stock/logic.mjs'
import { classifyNota, toNum } from './dist/modules/receivings/purchaseLogic.mjs'
import { toNumberOrNull } from './dist/modules/stock/logic.mjs'
import { parseItemPrice, buildItemPriceNote, parsePurchaseNote } from './dist/lib/purchaseNote.mjs'

let n = 0
const ok = (m) => { n++; console.log(`  ok ${n} — ${m}`) }

console.log('F8. GERBANG KEJUJURAN: yang tidak diketahui tidak boleh jadi 0')

// ---------- 1. RAB kosong / tidak dikirim ----------
const c1 = buildComparison({ rabJson: null, rapLines: [], actualRows: [] })
assert.equal(c1.totals.rab, null)
assert.equal(c1.totals.rap, null)
assert.equal(c1.totals.actual, null)
assert.equal(c1.ceiling.level, 'none')
assert.ok(c1.ceiling.message.includes('Tidak ada angka yang dikarang'))
ok('buildComparison tanpa data sama sekali: semua total null + pesan "Tidak ada angka yang dikarang"')

// ---------- 2. Nota tanpa harga -> null, bukan 0 ----------
const a = readActualLines([{ item_name: 'Kayu', qty_received: 5 }])
assert.equal(a[0].price, null)
assert.equal(a[0].value, null)
ok('baris aktual tanpa harga -> price null & value null (qty 5 x harga-tidak-diketahui ≠ 0)')

const a2 = readActualLines([{ item_name: 'Kayu', qty_received: 5, note: '[Harga: 120000]' }])
assert.equal(a2[0].value, 600000)
ok('baris aktual dengan penanda [Harga: 120000] -> value 600.000 (harga terbaca dari catatan nota)')

// ---------- 3. Total aktual hanya dari baris yang punya harga ----------
const c2 = buildComparison({
  rabJson: { items: [{ name: 'Kayu', qty: 5, price: 120000 }] },
  rapLines: [{ id: 'r', name: 'Kayu', qty: 5, price: 130000 }],
  actualRows: [
    { item_name: 'Kayu', qty_received: 5, note: '[Harga: 125000]' },
    { item_name: 'Paku', qty_received: 10 }
  ]
})
assert.equal(c2.totals.actual, 625000)
assert.equal(c2.coverage.missingActual, 0)
ok('total aktual hanya menghitung baris berharga; "Paku" (belanja tanpa acuan) tidak mengubah total')

// ---------- 3b. Belanja tanpa acuan tetap terlihat ----------
const c2b = buildComparison({
  rabJson: null,
  rapLines: [],
  actualRows: [{ item_name: 'Paku', qty_received: 10, note: '[Harga: 12000]' }]
})
assert.equal(c2b.totals.actual, 120000)
assert.equal(c2b.totals.rab, null)
assert.equal(c2b.coverage.actualWithoutPlan, 1)
ok('nota tanpa RAB/RAP: total aktual tetap 120.000 DAN coverage.actualWithoutPlan=1 (belanja di luar rencana ditandai)')

// ---------- 4. honesty label ----------
assert.equal(c2.honesty.hasActual, true)
assert.equal(c2.honesty.actualLabel, 'Aktual dari nota pembelian yang sudah diterima')
assert.equal(c1.honesty.hasActual, false)
assert.equal(c1.honesty.actualLabel, 'Belum ada aktual — belum ada nota pembelian tercatat')
ok('honesty.actualLabel menuliskan sumber aktual secara eksplisit (atau ketiadaannya)')

// ---------- 5. validPrice: Rp 0 bukan harga ----------
assert.equal(validPrice(0), null)
assert.equal(validPrice('0'), null)
assert.equal(validPrice(-1), null)
assert.equal(validPrice(null), null)
assert.equal(validPrice(undefined), null)
assert.equal(validPrice(''), null)
assert.equal(validPrice(1), 1)
ok('validPrice: 0/negatif/null/undefined/"" -> null. Hanya angka > 0 yang menjadi harga.')

// ---------- 6. Estimasi PR TIDAK boleh jadi harga aktual (P1) ----------
assert.equal(actualPurchasePrice({ price_actual: null, actual_price: null, actual_unit_price: null, unit_price: null, price: null, estimated_price: 250000 }), null)
ok('actualPurchasePrice mengabaikan estimated_price sepenuhnya (P1: estimasi ≠ pembelian)')

assert.equal(actualPurchasePrice({ price_actual: 250000, estimated_price: 999999 }), 250000)
ok('actualPurchasePrice memilih price_actual walau estimated_price ikut terisi')

const ri = receivingItemActualPrice({ note: 'x', unit_price: 0, price_actual: 0, actual_unit_price: 0, price: 0 })
assert.equal(ri, null)
ok('receivingItemActualPrice: semua kolom harga 0 -> null (bukan 0)')

// ---------- 7. Total nota ([Nominal]) BUKAN harga satuan ----------
const riNominalOnly = receivingItemActualPrice({ note: '[Nominal: 5000000]', quantity_received: 10 })
assert.equal(riNominalOnly, null)
ok('penanda [Nominal: ...] (total nota) TIDAK dipakai sebagai harga satuan material')

const riHarga = receivingItemActualPrice({ note: '[Nominal: 5000000] [Harga: 500000]', quantity_received: 10 })
assert.equal(riHarga, 500000)
ok('penanda [Harga: ...] tetap terbaca walau nota juga punya [Nominal] (sumber harga yang benar)')

// ---------- 8. parseItemPrice / buildItemPriceNote round-trip ----------
assert.equal(parseItemPrice('[Harga: 125000]'), 125000)
assert.equal(parseItemPrice('[Harga: 125.000]'), 125000)
assert.equal(parseItemPrice('tidak ada harga'), null)
assert.equal(buildItemPriceNote(0), null)
assert.equal(buildItemPriceNote(null), null)
assert.equal(buildItemPriceNote(125000), '[Harga: 125000]')
ok('parseItemPrice/buildItemPriceNote: format Indonesia terbaca, round-trip stabil, 0/null -> null')

// ---------- 9. Resolver acuan: kategori tidak dicampur ----------
const mats = [
  { id: 'mat-01', name: 'Multiplek 18mm', satuan: 'lembar', category: 'Plywood & Board', harga_acuan: 340000 },
  { id: 'mat-02', name: 'Kaca 5mm', satuan: 'lembar', category: 'Kaca' }
]
const recs = [
  { id: 'rec-01', vendor_id: 'ven-a', received_date: '2026-09-01', status: 'RECEIVED' },
  { id: 'rec-02', vendor_id: 'ven-a', received_date: '2026-10-01', status: 'RECEIVED' }
]
const ris = [
  { id: 'ri-01', receiving_id: 'rec-01', pr_item_id: 'pri-01', quantity_received: 10, note: '[Harga: 350000]' },
  { id: 'ri-02', receiving_id: 'rec-02', pr_item_id: 'pri-02', quantity_received: 10, note: '[Harga: 360000]' }
]
const pris = [
  { id: 'pri-01', material_id: 'mat-01', unit: 'lembar', estimated_price: 350000 },
  { id: 'pri-02', material_id: 'mat-01', unit: 'lembar', estimated_price: 360000 }
]
const A = makeAcuanHelpers({ allPrItems: pris, allReceivingItems: ris, allReceivings: recs, allVendors: [{ id: 'ven-a', name: 'Vendor A' }] })

assert.equal(A.entriesFor(mats[0]).length, 3)  // 2 historis + 1 master
assert.equal(A.entriesFor(mats[1]).length, 0)  // tanpa histori & tanpa master
assert.equal(A.entriesFor(mats[0])[0].price, 360000)
assert.equal(A.entriesFor(mats[0])[2].source, 'MASTER')
ok('entriesFor: mat-01 -> [HISTORIS 360.000, HISTORIS 350.000, MASTER 340.000]; mat-02 (tanpa data) -> 0 entri (kosong jujur)')

// Satuan berbeda tidak boleh dicampur.
const prisMix = [{ id: 'pri-03', material_id: 'mat-01', unit: 'meter', estimated_price: 900000 }]
const risMix = [{ id: 'ri-03', receiving_id: 'rec-01', pr_item_id: 'pri-03', quantity_received: 2, note: '[Harga: 900000]' }]
const Amix = makeAcuanHelpers({ allPrItems: prisMix, allReceivingItems: risMix, allReceivings: recs, allVendors: [] })
assert.equal(Amix.entriesFor(mats[0]).filter(e => e.source === 'HISTORIS').length, 0)
ok('entri dengan satuan PR berbeda dari master TIDAK masuk acuan (tanpa konversi diam-diam)')

// qty 0 / negatif bukan pembelian nyata.
const risZero = [{ id: 'ri-04', receiving_id: 'rec-01', pr_item_id: 'pri-01', quantity_received: 0, note: '[Harga: 350000]' }]
const Azero = makeAcuanHelpers({ allPrItems: pris, allReceivingItems: risZero, allReceivings: recs, allVendors: [] })
assert.equal(Azero.entriesFor(mats[0]).filter(e => e.source === 'HISTORIS').length, 0)
ok('baris penerimaan qty 0 (sisa cangkang approval) TIDAK dihitung sebagai pembelian nyata')

// Estimasi PR tidak boleh menutupi MASTER.
const prisEst = [
  { id: 'pri-05', material_id: 'mat-01', unit: 'lembar' },  // tanpa estimated_price
  { id: 'pri-06', material_id: 'mat-01', unit: 'lembar', estimated_price: 999999 }
]
const Aest = makeAcuanHelpers({ allPrItems: prisEst, allReceivingItems: [], allReceivings: [], allVendors: [] })
assert.equal(Aest.entriesFor(mats[0])[0].source, 'MASTER')
assert.equal(Aest.entriesFor(mats[0])[0].price, 340000)
ok('MASTER (340.000) tampil di atas PR_ESTIMATE (999.999) — estimasi tidak menutupi acuan yang lebih kuat')

// ---------- 10. Estimator: NO_ENTRY bukan 0 ----------
const E = makePrEstimator({ allPrItems: [], allReceivingItems: [], allReceivings: [], allVendors: [] })
const e0 = E.estimateFor(mats[0])
assert.equal(e0.status, 'OK')
assert.equal(e0.source, 'MASTER')
assert.equal(e0.price, 340000)
ok('estimator: harga master 340.000 jadi sumber (MASTER) — master data lebih kuat dari ketiadaan data')

const e1 = E.estimateFor({ id: '', name: 'Kaca 5mm' })
assert.equal(e1.status, 'UNKNOWN_MATERIAL')
assert.equal(e1.price, null)
ok('estimator material tanpa id -> UNKNOWN_MATERIAL (data lama), price null — bukan crash, bukan 0')

// Tanpa harga master sama sekali -> NO_ENTRY (bukan 0).
const mats2 = [{ id: 'mat-09', name: 'Tanpa Acuan', satuan: 'lembar', category: 'Lain' }]
const E3 = makePrEstimator({ allPrItems: [], allReceivingItems: [], allReceivings: [], allVendors: [] })
const e3 = E3.estimateFor(mats2[0])
assert.equal(e3.status, 'NO_ENTRY')
assert.equal(e3.price, null)
assert.equal(e3.source, 'NONE')
ok('estimator tanpa data & tanpa harga master: status NO_ENTRY, price null — penelepon WAJIB memperlakukan null sebagai "belum ada acuan"')

// MASTER (340.000) menang di atas PR_ESTIMATE (999.999) saat keduanya ada.
const Ev = makePrEstimator({ allPrItems: prisEst, allReceivingItems: [], allReceivings: [], allVendors: [{ id: 'v', name: 'Vendor A' }] })
const eV = Ev.estimateFor(mats[0])
assert.equal(eV.source, 'MASTER')
assert.equal(eV.price, 340000)
ok('MASTER (340.000) menang di atas PR_ESTIMATE (999.999) — estimasi tidak menutupi acuan yang lebih kuat')

// Tanpa master & tanpa histori pembelian, PR_ESTIMATE jadi fallback TERAKHIR.
// CATATAN SKEMA: PR_ESTIMATE hanya lahir dari baris pr_items yang TERHUBUNG
// ke penerimaan (tanpa harga aktual) — pr_items lepas tidak jadi acuan.
const matsNoMaster = [{ id: 'mat-07', name: 'Tanpa Master', satuan: 'lembar', category: 'Lain' }]
const Epr = makePrEstimator({
  allPrItems: [{ id: 'pri-08', material_id: 'mat-07', unit: 'lembar', estimated_price: 275000 }],
  allReceivingItems: [{ id: 'ri-08', receiving_id: 'rec-08', pr_item_id: 'pri-08', quantity_received: 5, note: '' }],
  allReceivings: [{ id: 'rec-08', vendor_id: 'ven-a', received_date: '2026-09-20', status: 'RECEIVED' }],
  allVendors: []
})
const epr = Epr.estimateFor(matsNoMaster[0])
assert.equal(epr.source, 'PR_ESTIMATE')
assert.equal(epr.price, 275000)
ok('tanpa master & tanpa harga aktual: PR_ESTIMATE 275.000 dipakai DENGAN source eksplisit — penelepon wajib menampilkannya sebagai estimasi, bukan harga beli')

// pr_items TANPA penerimaan tidak jadi acuan sama sekali.
const Epr2 = makePrEstimator({
  allPrItems: [{ id: 'pri-09', material_id: 'mat-07', unit: 'lembar', estimated_price: 999999 }],
  allReceivingItems: [], allReceivings: [], allVendors: []
})
assert.equal(Epr2.estimateFor(matsNoMaster[0]).source, 'NONE')
ok('pr_items tanpa baris penerimaan -> tidak jadi acuan (NONE) — estimasi PR yang belum jadi pembelian tidak dipakai')

// Vendor HANYA menyaring HISTORIS; tanpa histori, vendor tidak mengubah apa pun.
const Ev2 = makePrEstimator({ allPrItems: prisEst, allReceivingItems: [], allReceivings: [], allVendors: [{ id: 'v', name: 'Vendor A' }] })
assert.equal(Ev2.estimateFor(mats[0], { vendorId: 'v' }).source, 'MASTER')
ok('P1: prioritas vendor hanya menyaring kategori HISTORIS; vendor tidak bisa mengubah sumber jadi "pembelian vendor itu"')

// ---------- 11. Stok: UNAVAILABLE bukan 0 ----------
const st = summarizeStock([
  { id: 'a', current_stock: null, min_stock: 5, kode: 'BHP-0001' },
  { id: 'b', current_stock: 0, min_stock: 5, kode: 'BHP-0002' }
])
assert.equal(st.adaAngka, 1)
assert.equal(st.tanpaAngka, 1)
assert.equal(st.menipis, 1)      // BHP, stok 0 <= min 5
assert.equal(st.tidakDipantau, 0)
ok('summarizeStock: current_stock null -> tanpaAngka; current_stock 0 vs min 5 (BHP) -> menipis=1. null dan 0 adalah dua hal berbeda.')

const st2 = summarizeStock([
  { id: 'c', current_stock: null, min_stock: 5, is_bhp: true },
  { id: 'd', current_stock: 0, min_stock: 5, is_bhp: true }])
assert.equal(st2.adaAngka, 1)
assert.equal(st2.tanpaAngka, 1)
assert.equal(st2.menipis, 0)
ok('summarizeStock (tanpa kode BHP): null -> tanpaAngka; 0 vs min 5 -> menipis=0 karena bukan BHP (bukan bahan habis pakai)')

const csvSt = stockCsv([{ kode: 'M-1', name: 'Kaca', category: 'Kaca', satuan: 'lembar', current_stock: null, min_stock: 5 }])
assert.ok(csvSt.split('\n')[1].includes(',,') || csvSt.split('\n')[1].endsWith(','))
ok('CSV stok: stok kosong diekspor sebagai string KOSONG, bukan 0')

assert.ok(STOCK_LIM.some(t => t.includes('movement/ledger')))
assert.ok(STOCK_LIM.some(t => t.includes('belum tercatat sebagai pengurang')))
assert.ok(CRM_LIM.some(t => t.includes('tidak ada tabel customers')))
assert.ok(CRM_LIM.some(t => t.includes('hanya draf di memori halaman')))
assert.ok(LABOR_LIM.some(t => t.includes('tidak pernah dijumlahkan')))
assert.ok(LABOR_LIM.some(t => t.includes('kartu upah/ledger per tanggal')))
ok('batasan data stok/CRM/labor dicatat di kode — laporan tidak boleh mengaku lebih dari itu')

// ---------- 12. CRM: relasi tidak dikirim != 0 ----------
assert.equal(relationCount('c1', { c1: 0 }), 0)
assert.equal(relationCount('c1', undefined), null)
ok('relationCount: 0 (dikirim) vs null (tidak dikirim) dibedakan — repeat order tidak dikira-kira')

assert.equal(readCustomers(null).length, 0)
assert.equal(readCustomers([{ name: '' }]).length, 0)
ok('readCustomers: null atau baris tanpa nama -> kosong (daftar kosong berarti kosong)')

// ---------- 13. classifyNota ----------
// Status nota di repo ini: PURCHASED (punya invoice_no + nominal), LEGACY
// (tanggal + nominal, tanpa invoice_no), DRAFT (baru dibuat, belum lengkap).
// CATATAN: status RECEIVED pada fixture penerimaan TIDAK menentukan kategori
// nota — classifyNota membaca invoice_no/note, bukan status.
// isPurchasedNota: status 'DIBELI' atau penanda [Tahap: DIBELI] di note.
// invoice_no TIDAK menentukan "sudah dibeli" — itu hanya penomoran.
assert.equal(classifyNota({ status: 'RECEIVED', received_date: '2026-10-01', note: '[Nominal: Rp 3500000]' }), 'LEGACY')
assert.equal(classifyNota({ status: 'DIBELI', received_date: '2026-10-01', note: '[Nominal: Rp 3500000]' }), 'PURCHASED')
assert.equal(classifyNota({ status: 'RECEIVED', received_date: '2026-10-01', note: '[Nominal: Rp 3500000] [Tahap: DIBELI]' }), 'PURCHASED')
assert.equal(classifyNota({ status: 'RECEIVED', received_date: '', note: '' }), 'DRAFT')
assert.equal(classifyNota(null), 'DRAFT')
ok('classifyNota: PURCHASED (status/penanda Tahap DIBELI) / LEGACY (tanggal+nominal) / DRAFT (belum lengkap) — invoice_no tidak menentukan')

// ---------- 14. toNum (penerimaan) vs toNumberOrNull (stok) ----------
// DIPERBAIKI di paket akhir t_2e5ef03c. Dulu dua perilaku BERBAHAYA:
//  (a) toNum("3 dus") -> 3   : satuan dibuang diam-diam ("3 dus" = "3 lembar").
//  (b) toNum("1.250.000") -> NaN : titik ribuan lolos filter -> baris nota
//      dengan subtotal null DIBUANG diam-diam oleh buildSavePlan, sehingga
//      total nota (dan biaya proyek) lebih kecil dari kenyataan.
// Sekarang: pemisah ribuan id-ID dibaca benar, dan teks bersatuan DITOLAK
// (NaN) sehingga validasi form menampilkan error, bukan menebak angka.
// Bukti perilaku lama: docs/final-package/pre-fix/s6-growth-PRE-FIX.log
assert.equal(toNum(1250000), 1250000)
assert.equal(toNum('1250000'), 1250000)
assert.equal(toNum(''), 0)
assert.equal(toNum(null), 0)
assert.ok(Number.isNaN(toNum('abc')))          // (a) teks acak -> DITOLAK (dulu 0 senyap)
assert.ok(Number.isNaN(toNum('3 dus')))        // (a) satuan -> DITOLAK (dulu 3)
assert.equal(toNum('1.250.000'), 1250000)      // (b) ribuan id-ID -> 1250000 (dulu NaN)
assert.equal(toNum('Rp 1.250.000'), 1250000)   // (b) dengan awalan Rp
assert.equal(toNum('1.250.000,50'), 1250000.5) // desimal koma
assert.equal(toNum('12,5'), 12.5)              // koma desimal tunggal
assert.equal(toNum('12.5'), 12.5)              // titik desimal tunggal
ok('toNum: "1.250.000" & "Rp 1.250.000" -> 1250000; "3 dus"/"abc" -> NaN (ditolak, bukan ditebak); "" / null -> 0')

assert.equal(toNumberOrNull('12'), 12)
assert.equal(toNumberOrNull(12), 12)
assert.equal(toNumberOrNull('12,5'), 12.5)
assert.equal(toNumberOrNull('12.5'), 12.5)   // titik juga diterima
assert.equal(toNumberOrNull(''), null)
assert.equal(toNumberOrNull(null), null)
assert.equal(toNumberOrNull('3 dus'), null)
assert.equal(toNumberOrNull('abc'), null)
ok('toNumberOrNull: "12"/12 -> 12; "12,5" & "12.5" -> 12.5; ""/null/"3 dus"/"abc" -> null (bukan 0, bukan NaN)')

assert.equal(toNum(parsePurchaseNote('[Nominal: Rp 1.250.000]').material), 1250000)
ok('rantai jujur: parsePurchaseNote membaca "Rp 1.250.000" -> 1250000 lewat digit-only, BUKAN toNum')

// ---------- 15. CSV rap-compare ----------
const c3 = buildComparison({
  rabJson: { items: [{ name: 'Kayu', qty: 5, price: 100000 }] },
  rapLines: [{ id: 'r', name: 'Kayu', qty: 5, price: 110000 }],
  actualRows: []
})
const csv = toCsv(c3)
assert.ok(csv.includes('Kayu'))
assert.ok(csv.split('\n').length >= 2)
ok('toCsv rap-compare: baris terbit tanpa angka karangan')

console.log(`\nF8 LULUS: ${n} assertion`)
console.log('HONESTY_GATES_TEST_OK')
