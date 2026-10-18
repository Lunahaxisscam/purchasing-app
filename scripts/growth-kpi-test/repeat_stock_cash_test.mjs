// F4 REPEAT ORDER + F6 STOCK TURNS + F7 OVERDUE CASH — t_13fd2d4a (Bit / Noir Living)
// Sumber ASLI: modules/crm/logic.js, modules/stock/logic.js,
//              modules/sales-invoice/contract.js, modules/labor-stock/logic.js
// Semua angka di bawah FIXTURE buatan harness, BUKAN data live.

import { strict as assert } from 'node:assert'
import {
  readCustomers,
  mergeCustomers,
  customerContact,
  customerSource,
  customerKey,
  normalizePhone,
  findDuplicate,
  validateCustomer,
  relationCount,
  relationText,
  summarizeCustomers,
  RELATION_UNKNOWN
} from './dist/modules/crm/logic.mjs'
import {
  stockStatus,
  summarizeStock,
  filterStockRows,
  toNumberOrNull,
  DATA_LIMITATIONS as STOCK_LIMITATIONS
} from './dist/modules/stock/logic.mjs'
import {
  STATUS_TRANSITIONS,
  TERMINAL_STATUSES,
  checkTransition,
  EVIDENCE_REQUIREMENTS,
  nextSequenceForFormat,
  parseAnyInvoiceNo,
  invoicePeriod,
  nextNumericProjectCode
} from './dist/modules/sales-invoice/contract.mjs'
import { summarizeLabor } from './dist/modules/labor-stock/logic.mjs'

let n = 0
const ok = (m) => { n++; console.log(`  ok ${n} — ${m}`) }

console.log('F4. REPEAT ORDER: customer berulang & integritas dedupe')

// Fixture: 3 customer host, satu order ulang (nomor beda format).
const HOST = [
  { id: 'c1', name: 'Ibu Sari', phone: '0812-1111-2222', source: 'Referral', address: 'Jl. Merdeka 1', created_at: '2025-03-01T00:00:00Z' },
  { id: 'c2', name: 'Pak Andi', phone: '081311112222', source: 'Instagram', address: '', created_at: '2026-01-15T00:00:00Z' },
  { id: 'c3', name: 'Tanpa Kontak', phone: '', email: '', source: '', address: '', created_at: null }
]
const custs = readCustomers(HOST)
assert.equal(custs.length, 3)
ok('readCustomers: 3 baris terbaca dari fixture host')

const byId = Object.fromEntries(custs.map(c => [c.id, c]))
assert.equal(customerContact(byId.c1), '0812-1111-2222')
assert.equal(customerContact(byId.c3), null)
ok('customerContact: WA dulu, email fallback, TIDAK ADA -> null (bukan string kosong)')

assert.equal(customerSource(byId.c1), 'Referral')
assert.equal(customerSource(byId.c3), null)
ok('customerSource: kosong -> null (UI bisa tulis "Tidak tersedia")')

// ---------- Dedupe repeat order: nomor sama, format beda ----------
assert.equal(normalizePhone('0812-1111-2222'), normalizePhone('6281211112222'))
ok('normalizePhone CRM: "0812-1111-2222" == "6281211112222" (lead berulang satu customer)')

const dup = findDuplicate(custs, { name: '', phone: '+62 812 1111 2222' }, null)
assert.ok(dup && dup.id === 'c1')
ok('findDuplicate: form dengan nomor beda format tetap cocok ke Ibu Sari (c1) — repeat order tak membuat customer kedua')

const vCust = validateCustomer({ name: 'Ibu Sari Baru', phone: '081211112222', email: '' }, { existing: custs })
assert.equal(vCust.ok, true)
assert.ok(vCust.warnings.length === 1 && vCust.duplicate)
ok('validateCustomer: nomor kembar -> WARNING (periksa dulu), bukan penolakan — dua customer boleh bernama sama')

const vBad = validateCustomer({ name: '', phone: '' }, { existing: custs })
assert.equal(vBad.ok, false)
assert.ok(vBad.errors.name)
ok('validateCustomer: tanpa nama ditolak (nama satu-satunya field wajib)')

// ---------- customerKey stabil ----------
assert.equal(customerKey({ name: 'Ibu Sari', id: 'c1' }), 'ibu-sari')
assert.equal(customerKey({ name: '', id: 'c1' }), 'c1')
assert.equal(customerKey({ name: '', id: '' }), 'x')
ok('customerKey: nama -> slug; tanpa nama -> id; tanpa keduanya -> "x" (key unik, tidak crash)')

// ---------- Relasi invoice: tidak dikirim != 0 ----------
assert.equal(relationCount('c1', null), null)
assert.equal(relationCount('c1', {}), null)
assert.equal(relationCount('c1', { c1: '' }), null)
assert.equal(relationCount('c1', { c1: 3 }), 3)
assert.equal(relationCount('c1', { c1: 0 }), 0)
ok('relationCount: tidak dikirim/"" -> null; 0 tetap 0 (bedanya: "belum dikirim" vs "tidak pernah")')

assert.equal(relationText('c1', null), RELATION_UNKNOWN)
assert.equal(relationText('c1', { c1: 3 }), 'Dirujuk di 3 invoice')
ok('relationText: null -> "Relasi invoice tidak dikirim ke halaman ini" (jujur, bukan 0)')

// ---------- Ringkasan ----------
const merged = mergeCustomers(custs, [{ name: 'Draf Baru', phone: '0812', origin: 'draft' }])
assert.equal(merged.length, 4)
const sum = summarizeCustomers(merged)
assert.equal(sum.total, 4)
assert.equal(sum.withContact, 3)  // "Tanpa Kontak" (c3) tetap tanpa kontak
assert.equal(sum.withoutContact, 1)
ok(`summarizeCustomers: total=${sum.total}, withContact=${sum.withContact}, sources=${sum.sources}, withAddress=${sum.withAddress} — 1 tanpa kontak tidak hilang`)

const sum2 = summarizeCustomers(custs)
assert.equal(sum2.withoutContact, 1)
ok(`summarizeCustomers: ${sum2.withoutContact} customer tanpa kontak tercatat eksplisit (tak disembunyikan)`)

console.log('\nF6. STOCK TURNS: kematangan data — apakah perputaran BISA dihitung jujur?')

// Fixture stok: campuran supaya status tiap cabang terlihat.
// NOTE: isBhp() TIDAK membaca flag is_bhp — BHP dikenali dari kode
// "BHP-<digit>" atau kategori "bahan habis pakai" (lihat stock/logic.js).
const MATS = [
  { id: 'm1', name: 'Sekrup 3inch', kode: 'BHP-001', category: 'Aksesoris', satuan: 'pak', current_stock: 12, min_stock: 5 },
  { id: 'm2', name: 'Lem Kayu', kode: 'BHP-002', category: 'Aksesoris', satuan: 'tube', current_stock: 3, min_stock: 10 },
  { id: 'm3', name: 'Cat Melamin', kode: 'BHP-003', category: 'Finishing', satuan: 'kaleng', current_stock: 40, min_stock: null },
  { id: 'm4', name: 'Kaca 5mm', kode: 'M-004', category: 'Kaca', satuan: 'lembar', current_stock: null, min_stock: 5 },
  { id: 'm5', name: 'Engsel Soft-close', kode: 'M-005', category: 'Aksesoris', satuan: 'pcs', current_stock: 8, min_stock: 4 }
]

assert.equal(stockStatus(MATS[0]).state, 'TIDAK_DIPANTAU')
ok('stok 12 vs min 5 (BHP, aman) -> TIDAK_DIPANTAU')

// TEMUAN AUDIT: stockStatus() tidak punya state positif "OK/aman".
// Cabangnya hanya: UNAVAILABLE -> MENIPIS -> TIDAK_DIPANTAU. Jadi material
// yang BHP + min aktif + stok di atas min JUSTRU berlabel "TIDAK_DIPANTAU"
// — bisa terbaca "tidak dipantau" padahal sebenarnya aman. KPI stok jangan
// memakai state ini sebagai "aman"; pakai stockStatus(M).state === 'MENIPIS'
// untuk yang benar-benar menipis.
const states = MATS.map(m => stockStatus(m).state)
assert.ok(!states.includes('OK'))
ok(`TEMUAN: tidak ada state "OK" di stockStatus (hasil fixture: ${states.join(', ')}) — "aman" harus dihitung sebagai bukan MENIPIS/UNAVAILABLE`)

assert.equal(stockStatus(MATS[1]).state, 'MENIPIS')
ok('stok 3 vs min 10 (BHP) -> MENIPIS')

assert.equal(stockStatus(MATS[3]).state, 'UNAVAILABLE')
ok('current_stock null -> UNAVAILABLE (bukan 0!)')

assert.equal(stockStatus(MATS[4]).state, 'TIDAK_DIPANTAU')
ok('stok 8 vs min 4 tapi bukan BHP -> TIDAK_DIPANTAU (min stok hanya berlaku untuk BHP)')

const ss = summarizeStock(MATS)
assert.equal(ss.total, 5)
assert.equal(ss.adaAngka, 4)
assert.equal(ss.menipis, 1)
assert.equal(ss.tanpaAngka, 1)
assert.equal(ss.bhp, 3)  // m1, m2, m3 berkode BHP-<digit>
ok(`summarizeStock: total=${ss.total}, adaAngka=${ss.adaAngka}, menipis=${ss.menipis}, tanpaAngka=${ss.tanpaAngka}, bhp=${ss.bhp}`)

// isBhp hanya true untuk kategori "bahan habis pakai" atau kode BHP-<digit>.
const bhpMats = [{ id: 'x', current_stock: 3, min_stock: 5, is_bhp: true, kode: 'BHP-0013' },
  { id: 'y', current_stock: 3, min_stock: 5, is_bhp: true, category: 'Bahan Habis Pakai' }]
const ss2 = summarizeStock(bhpMats)
assert.equal(ss2.bhp, 2)
ok('summarizeStock: BHP dikenali dari kode "BHP-0013" atau kategori "Bahan Habis Pakai" (bukan dari flag is_bhp)')

// ---------- F6 VERDICT: stock turns TIDAK BISA dihitung dari data sekarang ----------
assert.ok(STOCK_LIMITATIONS.some(t => t.includes('movement/ledger')))
assert.ok(STOCK_LIMITATIONS.some(t => t.includes('belum tercatat sebagai pengurang')))
assert.ok(STOCK_LIMITATIONS.some(t => t.includes('bertambah saat aksi')))
assert.ok(STOCK_LIMITATIONS.some(t => t.includes('katalog master global')))
ok('F6 temuan resmi: TIDAK ada movement/ledger, barang keluar belum jadi pengurang, materials = katalog global tanpa project_id')
ok('F6 VERDICT: "stock turnover" TIDAK BOLEH dilaporkan sebagai angka — ketersediaan datanya belum cukup')

const fs = filterStockRows({ materials: MATS, category: 'Finishing' })
assert.equal(fs.length, 1)
assert.equal(fs[0].name, 'Cat Melamin')
const fs2 = filterStockRows({ materials: MATS, query: 'sekrup' })
assert.equal(fs2.length, 1)
ok('filterStockRows: kategori & pencarian teks bekerja (filter saja — tidak mengarang angka)')

assert.equal(toNumberOrNull(''), null)
assert.equal(toNumberOrNull(0), 0)
ok('toNumberOrNull: "" -> null, 0 -> 0 (keduanya berbeda arti)')

console.log('\nF7. OVERDUE CASH: piutang jatuh tempo (fixture aritmetika verifikasi)')

// Status invoice & gerbang pembayaran.
assert.equal(checkTransition('DRAFT', 'LUNAS').ok, false)
ok('DRAFT -> LUNAS ditolak: dokumen yang belum terbit tidak boleh dianggap dibayar')

assert.equal(checkTransition('TERBIT', 'LUNAS').ok, true)
ok('TERBIT -> LUNAS diizinkan (klien bisa bayar sebelum pengiriman tercatat)')

assert.equal(checkTransition('LUNAS', 'BATAL').ok, false)
ok('LUNAS -> BATAL ditolak: status terminal, tidak bisa diubah')

assert.ok(TERMINAL_STATUSES.includes('LUNAS'))
assert.ok(EVIDENCE_REQUIREMENTS.LUNAS.includes('paid_amount'))
assert.ok(EVIDENCE_REQUIREMENTS.LUNAS.includes('paid_at'))
assert.ok(EVIDENCE_REQUIREMENTS.LUNAS.includes('payment_ref'))
assert.ok(EVIDENCE_REQUIREMENTS.LUNAS.includes('verified_by'))
ok('LUNAS wajib bukti: paid_amount + paid_at + payment_ref + verified_by (tanpa ini bukan "lunas")')

// F7 fixture piutang: tanggal jatuh tempo vs "hari H" 2026-10-18.
const TODAY = new Date('2026-10-18T00:00:00+07:00')
function daysOverdue(dueISO) {
  const due = new Date(`${dueISO}T00:00:00+07:00`)
  const d = Math.round((TODAY - due) / 86400000)
  return d > 0 ? d : 0
}
assert.equal(daysOverdue('2026-10-10'), 8)
assert.equal(daysOverdue('2026-10-18'), 0)
assert.equal(daysOverdue('2026-11-01'), 0)
ok('F7 fixture: jatuh tempo 2026-10-10 -> 8 hari terlambat; hari ini -> 0; belum jatuh tempo -> 0 (bukan negatif)')

const receivables = [
  { invoice_no: 'NL2610001', nominal: 50000000, due: '2026-10-10', status: 'TERKIRIM' },
  { invoice_no: 'NL2610002', nominal: 18500000, due: '2026-10-25', status: 'TERBIT' },
  { invoice_no: 'NL2610003', nominal: 9500000, due: '2026-09-30', status: 'DISETUJUI' }
]
const overdueRows = receivables
  .filter(r => r.status !== 'LUNAS' && r.status !== 'BATAL' && daysOverdue(r.due) > 0)
assert.equal(overdueRows.length, 2)
const overdueTotal = overdueRows.reduce((s, r) => s + r.nominal, 0)
assert.equal(overdueTotal, 59500000)
ok(`F7: ${overdueRows.length} invoice terlambat, total ${overdueTotal.toLocaleString('id-ID')} (LUNAS/BATAL tidak dihitung)`)

// Nomor invoice: urutan harus reset tahunan & tidak menabrak.
const existing = [{ invoice_no: 'NL2610001' }, { invoice_no: 'NL2610003' }, { invoice_no: 'NL2510002' }]
assert.equal(nextSequenceForFormat(existing, 'legacy-buku', '2026'), 4)
assert.equal(nextSequenceForFormat(existing, 'legacy-buku', '2025'), 3)
ok('nextSequenceForFormat: 2026 -> urut 4 (max 3 + 1); 2025 -> urut 3 (reset tahunan, nomor 2026 tidak menabrak)')

assert.equal(parseAnyInvoiceNo('NL2610003').period, '2026')
assert.equal(parseAnyInvoiceNo('NL2610003').seq, 3)
assert.equal(parseAnyInvoiceNo('INV/NL/2026/10/007').seq, 7)
ok('parseAnyInvoiceNo membaca kedua format yang beredar di lapangan')

assert.equal(invoicePeriod('2026-10-06'), '2026-10')
ok('invoicePeriod: 2026-10-06 -> "2026-10"')

assert.equal(nextNumericProjectCode([{ code: '1' }, { code: '7' }]), '8')
ok('nextNumericProjectCode: kode proyek numerik lanjut dari yang terbesar (dikembalikan sebagai string "8")')

// ---------- F4/F6/F7 tambahan: labor aktual vs estimasi tidak dijumlah ----------
const labSum = summarizeLabor({
  actualRows: [
    { project: 'Proyek A', total_upah: 5000000 },
    { project: 'Proyek A', total_upah: 3000000 },
    { project: 'Proyek B', total_upah: null }
  ],
  estimateRows: [{ project: 'Proyek A', labor_cost: 8000000 }],
  projectNames: null   // peta id->nama tidak dikirim host
})
assert.equal(labSum.actualProjects, 1)
assert.equal(labSum.actualTotal, 8000000)
assert.equal(labSum.estimateTotal, null)
assert.equal(labSum.estimateSent, false)
ok(`summarizeLabor: aktual=${labSum.actualTotal.toLocaleString('id-ID')} (1 proyek berangka), estimasi=${labSum.estimateTotal} — peta project_names tidak dikirim, estimasi TIDAK dikarang (null, bukan 0)`)

// Kalau peta id->nama DIKIRIM, estimasi baru tampil.
const nameMap = new Map([['proj-a', 'Proyek A']])
const labSum2 = summarizeLabor({
  actualRows: [{ project: 'Proyek A', total_upah: 5000000 }],
  estimateRows: [{ project_id: 'proj-a', labor_cost: 8000000 }],
  projectNames: nameMap
})
assert.equal(labSum2.estimateSent, true)
assert.equal(labSum2.estimateTotal, 8000000)
ok('summarizeLabor: peta project_names dikirim -> estimasi 8.000.000 tampil (join id->nama, bukan cocok nama keliru)')

console.log(`\nF4/F6/F7 LULUS: ${n} assertion`)
console.log('REPEAT_STOCK_CASH_TEST_OK')
