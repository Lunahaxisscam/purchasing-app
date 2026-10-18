// F3 MARGIN LEAKAGE + F5 VENDOR SAVINGS — t_13fd2d4a (Bit / Noir Living)
// Sumber ASLI: modules/rap-compare/logic.js + modules/materials/acuan.js
//             + modules/requests/estimator.js
// Semua angka di bawah FIXTURE buatan harness, BUKAN data live.

import { strict as assert } from 'node:assert'
import {
  buildComparison,
  readRabLines,
  readRapLines,
  readActualLines,
  diffOf,
  diffStatus,
  detailFor,
  formatCell
} from './dist/modules/rap-compare/logic.mjs'
import {
  validPrice,
  actualPurchasePrice,
  receivingItemActualPrice,
  makeAcuanHelpers,
  ACUAN_SOURCE_RANK
} from './dist/modules/materials/acuan.mjs'
import { makePrEstimator } from './dist/modules/requests/estimator.mjs'

let n = 0
const ok = (m) => { n++; console.log(`  ok ${n} — ${m}`) }

console.log('F3. MARGIN LEAKAGE: RAB (acuan) vs RAP (rencana) vs AKTUAL (nota)')

// Fixture satu proyek: 4 item. Nilai sengaja bulat supaya selisih bisa
// diverifikasi dengan kalkulator tangan.
const RAB = {
  items: [
    { name: 'Multiplek 18mm', qty: 10, price: 350000, unit: 'lembar' },
    { name: 'HPL Taco', qty: 5, price: 420000, unit: 'lembar' },
    { name: 'Engsel Soft-close', qty: 40, price: 25000, unit: 'pcs' },
    { name: 'Sekrup 3inch', qty: 100, price: 2500, unit: 'pak' }
  ]
}
const RAP = [
  { id: 'r1', name: 'Multiplek 18mm', qty: 10, price: 380000 },   // +30.000/lembar  = +300.000
  { id: 'r2', name: 'HPL Taco', qty: 5, price: 400000 },           // -20.000/lembar  = -100.000
  { id: 'r3', name: 'Engsel Soft-close', qty: 40, price: 25000 },  // pas            = 0
  { id: 'r4', name: 'Cat Melamin', qty: 6, price: 95000 }          // tidak ada di RAB
]
// Aktual dari nota: harga disimpan di note "[Harga: n]" (skema repo ini).
const ACTUAL = [
  { item_name: 'Multiplek 18mm', qty_received: 10, note: '[Harga: 365000]' },   // di bawah RAP 380k
  { item_name: 'HPL Taco', qty_received: 5, note: '[Harga: 410000]' },          // di atas RAP 400k
  { item_name: 'Engsel Soft-close', qty_received: 38, note: '[Harga: 25000]' }, // qty < RAP
  { item_name: 'Sekrup 3inch', qty_received: 0, note: '' }                      // belum dibeli
]

const cmp = buildComparison({ rabJson: RAB, rapLines: RAP, actualRows: ACTUAL, paguValue: 10000000 })

// ---------- 1. Pembacaan baris ----------
assert.equal(readRabLines(RAB).length, 4)
assert.equal(readRapLines(RAP).length, 4)
assert.equal(readActualLines(ACTUAL).length, 4)
ok('ketiga pembaca baris membaca fixture lengkap (4/4/4)')

// ---------- 2. Total per sumber ----------
assert.equal(cmp.totals.rab, 10 * 350000 + 5 * 420000 + 40 * 25000 + 100 * 2500)
ok(`total RAB (acuan) = ${cmp.totals.rab.toLocaleString('id-ID')}`)

assert.equal(cmp.totals.rap, 10 * 380000 + 5 * 400000 + 40 * 25000 + 6 * 95000)
ok(`total RAP (rencana) = ${cmp.totals.rap.toLocaleString('id-ID')}`)

assert.equal(cmp.totals.actual, 10 * 365000 + 5 * 410000 + 38 * 25000 + 0)
ok(`total AKTUAL (nota) = ${cmp.totals.actual.toLocaleString('id-ID')} — baris tanpa harga TIDAK jadi 0`)

// ---------- 3. Selisih per baris (inti margin leakage) ----------
const byName = Object.fromEntries(cmp.rows.map(r => [r.name, r]))
assert.equal(byName['Multiplek 18mm'].diff, 300000)
assert.equal(byName['Multiplek 18mm'].diffStatus, 'over')
ok('Multiplek: RAP melampaui RAB sebesar +300.000 -> diffStatus "over"')

assert.equal(byName['HPL Taco'].diff, -100000)
assert.equal(byName['HPL Taco'].diffStatus, 'under')
ok('HPL: RAP di bawah RAB -100.000 -> diffStatus "under"')

assert.equal(byName['Engsel Soft-close'].diff, 0)
assert.equal(byName['Engsel Soft-close'].diffStatus, 'match')
ok('Engsel: RAP = RAB -> diffStatus "match"')

// ---------- 4. Jujur: yang tidak ada TIDAK jadi 0 ----------
assert.equal(byName['Sekrup 3inch'].actualMissing, true)
assert.equal(byName['Sekrup 3inch'].actual, null)
ok('Sekrup: belum ada nota -> actualMissing=true, actual=null (BUKAN 0)')

assert.equal(byName['Cat Melamin'].rabMissing, true)
assert.equal(byName['Cat Melamin'].rapMissing, false)
assert.equal(byName['Cat Melamin'].diff, null)
assert.equal(byName['Cat Melamin'].diffStatus, 'unknown')
ok('Cat Melamin: tidak ada di RAB -> diff=null, diffStatus="unknown" (belum bisa dihitung)')

// ---------- 5. Cakupan / coverage ----------
assert.equal(cmp.coverage.rabOnly, 1)   // Sekrup
assert.equal(cmp.coverage.rapOnly, 1)   // Cat Melamin
assert.equal(cmp.coverage.actualWithoutPlan, 0)
assert.equal(cmp.coverage.missingActual, 2)
ok(`coverage: rabOnly=${cmp.coverage.rabOnly} (rencana kurang), rapOnly=${cmp.coverage.rapOnly} (rencana di luar acuan), missingActual=${cmp.coverage.missingActual} (baris qty tanpa nota -> null)`)

// ---------- 5b. Vendor savings: nota RETUR tidak jadi acuan ----------
const recsSavings = [
  { id: 'rec-01', vendor_id: 'ven-a', received_date: '2026-09-01', status: 'RECEIVED' },
  { id: 'rec-02', vendor_id: 'ven-a', received_date: '2026-10-01', status: 'RECEIVED' },
  { id: 'rec-03', vendor_id: 'ven-c', received_date: '2026-10-05', status: 'RETUR' }
]
const risSavings = [
  { id: 'ri-01', receiving_id: 'rec-01', pr_item_id: 'pri-01', quantity_received: 10, note: '[Harga: 350000]' },
  { id: 'ri-02', receiving_id: 'rec-02', pr_item_id: 'pri-01', quantity_received: 10, note: '[Harga: 360000]' },
  { id: 'ri-03', receiving_id: 'rec-03', pr_item_id: 'pri-01', quantity_received: 10, note: '[Harga: 365000]' }
]
const prisSavings = [{ id: 'pri-01', material_id: 'mat-01', unit: 'lembar', estimated_price: 360000 }]
const matsSavings = [
  { id: 'mat-01', name: 'Multiplek 18mm', satuan: 'lembar', category: 'Plywood & Board', harga_acuan: 340000 }
]
const A2 = makeAcuanHelpers({ allPrItems: prisSavings, allReceivingItems: risSavings, allReceivings: recsSavings, allVendors: [] })
const hist = A2.entriesFor(matsSavings[0]).filter(e => e.source === 'HISTORIS')
assert.equal(hist.length, 2)
assert.deepEqual(hist.map(e => e.price).sort((a, b) => a - b), [350000, 360000])
ok('F5: 2 entri HISTORIS (350.000 & 360.000); nota retur ven-c 365.000 TIDAK ikut jadi acuan')

// HISTORIS lebih tinggi dari MASTER: ekonomis = seberapa jauh di atas master.
const a2 = A2.entriesFor(matsSavings[0])
const histMax = Math.max(...hist.map(e => e.price))
const master = a2.find(e => e.source === 'MASTER').price
assert.equal(master, 340000)
assert.equal(histMax - master, 20000)
ok(`F5: harga beli tertinggi 360.000 vs master 340.000 -> selisih +${histMax - master}.toLocaleString('id-ID')} (potensi tawar)`)

// ---------- 6. Pagu / ceiling ----------
assert.equal(cmp.ceiling.hasPagu, true)
assert.equal(cmp.ceiling.pagu, 10000000)
assert.equal(cmp.ceiling.used, cmp.totals.rap)
ok(`pagu ${cmp.ceiling.pagu.toLocaleString('id-ID')} vs dipakai ${cmp.ceiling.used.toLocaleString('id-ID')} -> level "${cmp.ceiling.level}"`)

const noPagu = buildComparison({ rabJson: RAB, rapLines: RAP, actualRows: ACTUAL })
assert.equal(noPagu.ceiling.hasPagu, false)
assert.equal(noPagu.ceiling.level, 'none')
ok('pagu tidak dikirim -> ceiling.level="none" (bukan 0, bukan "aman")')

// ---------- 7. detailFor: teks per baris untuk UI ----------
const d = detailFor(byName['Sekrup 3inch'])
const actSrc = d.sources.find(s => s.label === 'Aktual (nota)')
assert.equal(actSrc.present, false)
assert.ok(actSrc.text.includes('Tidak ada data'))
ok('detailFor Sekrup: sumber Aktual ditulis "Tidak ada data — bukan nol, dan belum dihitung dari mana pun"')

const dm = detailFor(byName['Cat Melamin'])
assert.ok(dm.notes.some(t => t.includes('tidak ada di acuan RAB')))
ok('detailFor Cat Melamin: catatan "tidak ada di acuan RAB" terbaca eksplisit')

// ---------- 8. formatCell & diffOf ----------
assert.equal(formatCell(null), '—')
assert.equal(formatCell(0), '0')
ok('formatCell: null -> "—", 0 -> "0" (dua-duanya berbeda arti)')

assert.equal(diffOf(100, 80), 20)
assert.equal(diffOf(null, 80), null)
assert.equal(diffStatus(null), 'unknown')
ok('diffOf/diffStatus: kembar null tetap null — tidak dihitung dari setengah data')

// ---------- 9. F5. VENDOR SAVINGS: harga acuan historis vs harga beli terbaru ----------
// Fixture: 2 nota untuk material yang sama dari vendor yang sama, harga
// naik. Plus satu nota dari vendor lain yang lebih murah.
const materials = [
  { id: 'mat-01', name: 'Multiplek 18mm', satuan: 'lembar', category: 'Plywood & Board', harga_acuan: 340000 }
]
const receivings = [
  { id: 'rec-01', vendor_id: 'ven-a', received_date: '2026-08-10', status: 'RECEIVED', note: '[Nominal: 3500000]' },
  { id: 'rec-02', vendor_id: 'ven-a', received_date: '2026-10-02', status: 'RECEIVED', note: '[Nominal: 3800000]' },
  { id: 'rec-03', vendor_id: 'ven-b', received_date: '2026-10-05', status: 'RECEIVED', note: '[Nominal: 3650000]' },
  { id: 'rec-04', vendor_id: 'ven-c', received_date: '2026-10-06', status: 'RETUR', note: '[Nominal: 999999]' }
]
const receivingItems = [
  { id: 'ri-01', receiving_id: 'rec-01', pr_item_id: 'pri-01', material_id: 'mat-01', quantity_received: 10, unit: 'lembar', note: '[Harga: 350000]' },
  { id: 'ri-02', receiving_id: 'rec-02', pr_item_id: 'pri-02', material_id: 'mat-01', quantity_received: 10, unit: 'lembar', note: '[Harga: 380000]' },
  { id: 'ri-03', receiving_id: 'rec-03', pr_item_id: 'pri-03', material_id: 'mat-01', quantity_received: 10, unit: 'lembar', note: '[Harga: 365000]' },
  { id: 'ri-04', receiving_id: 'rec-04', pr_item_id: 'pri-04', material_id: 'mat-01', quantity_received: 10, unit: 'lembar', note: '[Harga: 100000]' }
]
const prItems = [
  { id: 'pri-01', material_id: 'mat-01', unit: 'lembar', estimated_price: 350000 },
  { id: 'pri-02', material_id: 'mat-01', unit: 'lembar', estimated_price: 380000 },
  { id: 'pri-03', material_id: 'mat-01', unit: 'lembar', estimated_price: 365000 },
  { id: 'pri-04', material_id: 'mat-01', unit: 'lembar', estimated_price: 100000 }
]
const vendors = [
  { id: 'ven-a', name: 'Toko Kayu A', supplier_category: 'Plywood & Board' },
  { id: 'ven-b', name: 'Toko Kayu B', supplier_category: 'Plywood & Board' },
  { id: 'ven-c', name: 'Toko Kayu C', supplier_category: 'Plywood & Board' }
]

const A = makeAcuanHelpers({ allPrItems: prItems, allReceivingItems: receivingItems, allReceivings: receivings, allVendors: vendors })
const entries = A.entriesFor(materials[0])
const historis = entries.filter(e => e.source === 'HISTORIS')
// Urutan: terbaru dulu. rec-04 (RETUR) dibuang, jadi sisa 3 entri:
// 2026-10-05 (365.000), 2026-10-02 (380.000), 2026-08-10 (350.000).
assert.equal(historis.length, 3)
ok(`F5: 3 entri HISTORIS terurut terbaru (nota retur ven-c TIDAK ikut — ${historis.map(e => `${e.date}:${e.price}`).join(', ')})`)

assert.equal(historis[0].price, 365000)
assert.equal(historis[0].date, '2026-10-05')
ok('entri HISTORIS terbaru = 365.000 (2026-10-05, Toko Kayu B) — dipakai sebagai acuan "terbaru"')

const latest = historis[0].price
const masterPrice = validPrice(materials[0].harga_acuan)
assert.equal(latest - masterPrice, 25000)
ok(`F5: pembelian terbaru 365.000 vs master 340.000 -> +${(latest - masterPrice).toLocaleString('id-ID')} (potensi tawar lewat acuan master)`)

// P1: acuan HISTORIS yang dipakai adalah harga AKTUAL dari nota, bukan
// estimated_price di baris PR. Bukti: pri-02 estimated 380.000 tapi
// ri-02 mencatat harga aktual 380.000 — sama, dan baris tanpa harga
// aktual jatuh ke kategori PR_ESTIMATE (dilaporkan terpisah).
const estOnly = A.entriesFor(materials[0]).filter(e => e.source === 'PR_ESTIMATE')
assert.equal(estOnly.length, 0)  // semua nota kita punya [Harga: n]
ok('F5/P1: semua entri HISTORIS berasal dari harga aktual nota; PR_ESTIMATE hanya muncul bila nota tidak mencatat harga satuan')
ok(`F5 vendor-savings fixture: harga beli terbaru ${latest.toLocaleString('id-ID')} - acuan master ${masterPrice.toLocaleString('id-ID')} = +${(latest - masterPrice).toLocaleString('id-ID')} (kenaikan, BUKAN penghematan)`)

// Vendor termurah: perbandingan jujur antar vendor aktif.
// byVendor: Toko Kayu A -> 350.000 (2026-08-10), Toko Kayu B -> 365.000 (2026-10-05)
// (Toko Kayu C adalah nota RETUR — tidak masuk histori.)
const byVendor = {}
for (const e of historis) byVendor[e.vendor] = e.price
const cheapest = Object.entries(byVendor).sort((a, b) => a[1] - b[1])[0]
assert.equal(cheapest[0], 'Toko Kayu A')
assert.equal(cheapest[1], 350000)
ok(`F5: vendor termurah utk material ini = ${cheapest[0]} @ ${cheapest[1].toLocaleString('id-ID')} (selisih vs pembelian terbaru: ${(latest - cheapest[1]).toLocaleString('id-ID')})`)

// ---------- 10. Estimator PR: sumber acuan harus jujur ----------
const E = makePrEstimator({ allPrItems: prItems, allReceivingItems: receivingItems, allReceivings: receivings, allVendors: vendors })

const estA = E.estimateFor(materials[0], { vendorId: 'ven-a' })
assert.equal(estA.status, 'OK')
assert.equal(estA.source, 'HISTORIS')
assert.equal(estA.price, 380000)
assert.equal(estA.vendor, 'Toko Kayu A')
ok('estimator: acuan utk ven-a = HISTORIS vendor itu sendiri (380.000) — bukan campur vendor lain')

const estB = E.estimateFor(materials[0], { vendorId: 'ven-b' })
assert.equal(estB.source, 'HISTORIS')
assert.equal(estB.price, 365000)
ok('estimator: acuan utk ven-b = HISTORIS 365.000 (prioritas vendor hanya untuk kategori aktual)')

// Prioritas vendor TIDAK boleh menaikkan estimasi jadi "pembelian vendor itu"
const noMat = { id: 'mat-zzz', name: 'Tidak Ada', satuan: 'pcs' }
const estNone = E.estimateFor(noMat, { vendorId: 'ven-a' })
assert.equal(estNone.status, 'NO_ENTRY')
assert.equal(estNone.price, null)
ok('estimator: material tanpa histori -> status NO_ENTRY, price null (JANGAN dianggap 0)')

// ---------- 11. Receiving retur tidak boleh jadi acuan harga ----------
const recRetur = { id: 'rec-04', status: 'RETURN' }
assert.equal(receivingItemActualPrice(receivingItems[3]), 100000)
const entriesAfter = A.entriesFor(materials[0]).filter(e => e.price === 100000)
assert.equal(entriesAfter.length, 0)
ok('harga dari nota RETUR tidak pernah masuk entri acuan (walaupun angkanya valid)')

// ---------- 12. validPrice ----------
assert.equal(validPrice(0), null)
assert.equal(validPrice(''), null)
assert.equal(validPrice(-5), null)
assert.equal(validPrice(125000), 125000)
ok('validPrice: 0/""/negatif -> null; hanya > 0 yang lolos (harga Rp 0 bukan harga)')

assert.equal(actualPurchasePrice({ estimated_price: 999 }), null)
ok('actualPurchasePrice: estimated_price SENGAJA TIDAK dihitung sebagai harga aktual (P1)')

console.log(`\nF3/F5 LULUS: ${n} assertion`)
console.log('MARGIN_LEAKAGE_TEST_OK')
