// ============================================================
// UJI FUNGSI MURNI — modules/rap-compare/logic.js (t_a5ba5f73)
// Fokus: kejujuran angka. Yang tidak ada harus null, bukan 0.
// ============================================================
import {
  toRupiah,
  toQty,
  lineValue,
  readRabLines,
  readRapLines,
  readActualLines,
  buildComparison,
  toCsv
} from './modules/rap-compare/logic.mjs'

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}

console.log('\n[1] Konversi harga & qty — null, bukan 0')
check("1500000 -> 1500000", toRupiah(1500000) === 1500000)
check("'1.500.000' -> 1500000", toRupiah('1.500.000') === 1500000)
check("'Rp 1.500.000' -> 1500000", toRupiah('Rp 1.500.000') === 1500000)
check("null -> null (BUKAN 0)", toRupiah(null) === null)
check("'' -> null", toRupiah('') === null)
check("-5 -> null (negatif ditolak)", toRupiah(-5) === null)
check("'abc' -> null", toRupiah('abc') === null)
check("0 -> 0 (nol yang sah tetap 0)", toRupiah(0) === 0)
check("qty 2 -> 2", toQty(2) === 2)
check("qty 0 -> null (tidak dipaksa 1)", toQty(0) === null)
check("qty -3 -> null", toQty(-3) === null)
check("qty '' -> null", toQty('') === null)
check("qty '2.5' -> 2.5", toQty('2.5') === 2.5)
check("lineValue(2, 1500000) = 3000000", lineValue(2, 1500000) === 3000000)
check("lineValue(null, 1500000) = null", lineValue(null, 1500000) === null)
check("lineValue(2, null) = null", lineValue(2, null) === null)

console.log('\n[2] Baca baris RAB (beberapa bentuk field)')
const rab1 = readRabLines({ items: [
  { item: 'Wardrobe', qty: 2, unit: 'unit', price: 1500000 },
  { item: 'Kitchen set', qty: 1, unit: 'unit', price: 8000000 },
  { qty: 1, price: 500000 },              // tanpa nama -> dibuang
  { item: 'Tanpa harga', qty: 1 }         // harga null -> value null
] })
check("3 baris bernama (tanpa nama dibuang)", rab1.length === 3, String(rab1.length))
check("baris 1 value = 3.000.000", rab1[0].value === 3000000)
check("baris 2 value = 8.000.000", rab1[1].value === 8000000)
check("baris tanpa harga -> value null (jujur)", rab1[2].value === null)
const rab2 = readRabLines(JSON.stringify({ version: 5, boqReff: 'BOQ-014', items: [
  { item_name: 'Lemari', quantity: 3, estimated_price: 500000 }
] }))
check("bentuk JSON string + item_name/quantity/estimated_price", rab2.length === 1 && rab2[0].value === 1500000, JSON.stringify(rab2))
check("JSON rusak -> [] (tidak melempar)", readRabLines('{bukan json').length === 0)
check("array polos diterima", readRabLines([{ item: 'X', qty: 1, price: 1000 }]).length === 1)

console.log('\n[3] Baca baris RAP (draft)')
const rap1 = readRapLines([
  { id: 'r1', name: 'Wardrobe', qty: 2, price: 1400000, unit: 'unit' },
  { id: 'r2', name: 'Lemari', quantity: 3, harga_satuan: 500000 }
])
check("2 baris RAP", rap1.length === 2)
check("RAP baris 1 value = 2.800.000", rap1[0].value === 2800000)
check("RAP bentuk quantity/harga_satuan", rap1[1].value === 1500000)
check("RAP non-array -> []", readRapLines(null).length === 0)
check("RAP nama kosong dibuang", readRapLines([{ id: 'x', name: '  ', qty: 1, price: 100 }]).length === 0)

console.log('\n[4] Baca baris AKTUAL (nota) — null, bukan 0')
const act1 = readActualLines([
  { item_name: 'Wardrobe', qty_received: 2, unit: 'unit', note: '[Harga: 1350000]' },
  { item_name: 'Kitchen set', quantity_received: 1, price: 7900000 },
  { item_name: 'Sekrup', qty_received: 3, note: null }   // tanpa harga -> value null
])
check("3 baris aktual", act1.length === 3)
check("aktual 1 (harga dari note) = 2.700.000", act1[0].value === 2700000, String(act1[0].value))
check("aktual 2 (price langsung) = 7.900.000", act1[1].value === 7900000)
check("aktual tanpa harga -> value null", act1[2].value === null)
check("aktual tanpa qty -> value null", readActualLines([{ item_name: 'X', price: 100 }])[0].value === null)

console.log('\n[5] buildComparison — inti perbandingan')
const cmp = buildComparison({
  rabJson: { items: [
    { item: 'Wardrobe', qty: 2, unit: 'unit', price: 1500000 },
    { item: 'Kitchen set', qty: 1, unit: 'unit', price: 8000000 },
    { item: 'Meja', qty: 1, unit: 'unit', price: 2500000 },
    { item: 'Baris Rusak', qty: 1, unit: 'unit' }   // tanpa harga -> value null
  ] },
  rapLines: [
    { id: 'r1', name: 'Wardrobe', qty: 2, price: 1400000 },
    { id: 'r2', name: 'Kitchen set', qty: 1, price: 8000000 },
    { id: 'r3', name: 'Rak Buku', qty: 2, price: 750000 }   // di luar acuan RAB
  ],
  actualRows: [
    { item_name: 'Wardrobe', qty_received: 2, note: '[Harga: 1350000]' },
    { item_name: 'Baut', qty_received: 10, price: 5000 }    // tanpa acuan
  ]
})
check("6 baris di tabel", cmp.rows.length === 6, String(cmp.rows.length))
const rowWardrobe = cmp.rows.find(r => r.name === 'Wardrobe')
check("Wardrobe: RAB 3.000.000", rowWardrobe.rab === 3000000)
check("Wardrobe: RAP 2.800.000", rowWardrobe.rap === 2800000)
check("Wardrobe: aktual 2.700.000", rowWardrobe.actual === 2700000)
check("Wardrobe: selisih = RAP - RAB = -200.000", rowWardrobe.diff === -200000, String(rowWardrobe.diff))
check("Wardrobe: status under (di bawah acuan)", rowWardrobe.diffStatus === 'under')

const rowMeja = cmp.rows.find(r => r.name === 'Meja')
check("Meja: RAB ada, RAP belum -> rapMissing", rowMeja.rapMissing === true)
check("Meja: diff null (bukan 0)", rowMeja.diff === null)
check("Meja: aktual missing -> 'Belum ada aktual' di UI", rowMeja.actualMissing === true)

const rowRak = cmp.rows.find(r => r.name === 'Rak Buku')
check("Rak Buku: RAP tanpa acuan RAB -> rabMissing", rowRak.rabMissing === true)
check("Rak Buku: diff null", rowRak.diff === null)

const rowBaut = cmp.rows.find(r => r.name === 'Baut')
check("Baut: aktual tanpa RAB/RAP", rowBaut.actual === 50000 && rowBaut.rabMissing && rowBaut.rapMissing)

check("total RAB = 13.500.000", cmp.totals.rab === 13500000, String(cmp.totals.rab))
check("total RAP = 12.300.000 (2,8 + 8 + 1,5 juta)", cmp.totals.rap === 12300000, String(cmp.totals.rap))
check("total aktual = 2.750.000", cmp.totals.actual === 2750000, String(cmp.totals.actual))
check("total selisih = RAP - RAB = -1.200.000", cmp.totals.diff === -1200000, String(cmp.totals.diff))

// Baris RAB tanpa harga: tetap tampil, nilainya null (jujur "—"),
// dan TIDAK ikut mengubah total RAB.
const rowRusak = cmp.rows.find(r => r.name === 'Baris Rusak')
check("baris RAB tanpa harga tetap tampil", !!rowRusak)
check("baris RAB tanpa harga -> rab null", rowRusak && rowRusak.rab === null)
check("total RAB tidak termasuk baris tanpa harga (13,5 juta)", cmp.totals.rab === 13500000)

console.log('\n[6] Coverage & honesty')
check("rabOnly (RAB belum masuk RAP) = 1 (Meja)", cmp.coverage.rabOnly === 1, String(cmp.coverage.rabOnly))
check("rapOnly (RAP di luar acuan) = 1 (Rak Buku)", cmp.coverage.rapOnly === 1, String(cmp.coverage.rapOnly))
check("actualWithoutPlan = 1 (Baut)", cmp.coverage.actualWithoutPlan === 1, String(cmp.coverage.actualWithoutPlan))
check("missingActual = 3 (Meja, Rak Buku, Kitchen set)", cmp.coverage.missingActual === 3, String(cmp.coverage.missingActual))
check("hasActual true (ada nota)", cmp.honesty.hasActual === true)
check("label aktual menyebut nota pembelian", /nota pembelian/.test(cmp.honesty.actualLabel))

console.log('\n[7] Tanpa aktual sama sekali -> jujur "belum ada"')
const cmp2 = buildComparison({
  rabJson: { items: [{ item: 'Wardrobe', qty: 2, price: 1500000 }] },
  rapLines: [{ id: 'r1', name: 'Wardrobe', qty: 2, price: 1500000 }]
})
check("total aktual null (BUKAN 0)", cmp2.totals.actual === null, String(cmp2.totals.actual))
check("hasActual false", cmp2.honesty.hasActual === false)
check("label menyebut 'Belum ada aktual'", /Belum ada aktual/.test(cmp2.honesty.actualLabel))
check("diff null karena aktual tidak dipakai di selisih", cmp2.totals.diff === 0)

console.log('\n[8] Nama dicocokkan longgar (case & spasi)')
const cmp3 = buildComparison({
  rabJson: { items: [{ item: '  Lemari   Kayu ', qty: 1, price: 1000000 }] },
  rapLines: [{ id: 'r1', name: 'lemari kayu', qty: 1, price: 1200000 }]
})
check("1 baris (bukan 2)", cmp3.rows.length === 1, String(cmp3.rows.length))
check("selisih +200.000", cmp3.rows[0].diff === 200000)
check("status over (melebihi acuan)", cmp3.rows[0].diffStatus === 'over')

console.log('\n[9] Dua baris RAB nama sama -> dijumlah, bukan menimpa')
const cmp4 = buildComparison({
  rabJson: { items: [
    { item: 'Cat', qty: 1, price: 500000 },
    { item: 'Cat', qty: 2, price: 500000 }
  ] },
  rapLines: []
})
check("1 baris", cmp4.rows.length === 1)
check("nilai dijumlah = 1.500.000", cmp4.rows[0].rab === 1500000, String(cmp4.rows[0].rab))

console.log('\n[10] CSV')
const csv = toCsv(cmp)
const lines = csv.split('\n')
check("header 7 kolom", lines[0].split(',').length === 7, lines[0])
check("6 baris data + header = 7 baris", lines.length === 7, String(lines.length))
check("CSV berisi nama Wardrobe", /Wardrobe/.test(csv))
// baris yang nilainya tidak lengkap ditandai dengan status, bukan 0
check("CSV menandai status unknown untuk baris tanpa RAP", /"unknown"/.test(csv), csv.split('\n').slice(1).join(' | '))
check("CSV menandai status over/under sesuai selisih", /"under"/.test(csv) || /"over"/.test(csv))
// baris tanpa harga sama sekali (ketiga sumber kosong) -> 'tidak lengkap'
const csvEmpty = toCsv(buildComparison({ rabJson: { items: [{ item: 'Kosong', qty: 1 }] } }))
check("CSV baris tanpa angka -> 'tidak lengkap'", /tidak lengkap/.test(csvEmpty), csvEmpty)

console.log(`\n=== HASIL LOGIC TEST: ${pass} lulus, ${fail} gagal ===`)
if (fail) {
  console.log('Gagal:')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
