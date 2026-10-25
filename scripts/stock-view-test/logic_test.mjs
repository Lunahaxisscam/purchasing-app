// ============================================================
// logic_test.mjs — uji FUNGSI MURNI modules/stock/logic.js
// ============================================================
// Fokus: kejujuran angka. Angka yang tidak ada HARUS terbaca null
// ("Tidak tersedia"), bukan 0. Tidak ada penyimpangan dari status
// dokumen (PR / receiving / handover) ke angka stok.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SB = process.cwd()
const REPO = process.argv[2] || SB

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else {
    fail++; failures.push(name)
    console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`)
  }
}

const logic = await import('./dist/modules/stock/logic.mjs')

// ------------------------------------------------------------
console.log('\n[A] toNumberOrNull — angka hilang TIDAK jadi 0')
// ------------------------------------------------------------
check("null -> null", logic.toNumberOrNull(null) === null)
check("undefined -> null", logic.toNumberOrNull(undefined) === null)
check("'' -> null", logic.toNumberOrNull('') === null)
check("'   ' -> null", logic.toNumberOrNull('   ') === null)
check("'abc' -> null (bukan 0)", logic.toNumberOrNull('abc') === null)
check("'3 dus' -> null (teks dengan satuan)", logic.toNumberOrNull('3 dus') === null)
check("'12,5 pcs' -> null", logic.toNumberOrNull('12,5 pcs') === null)
check("'0' -> 0 (nol eksplisit sah)", logic.toNumberOrNull('0') === 0)
check("0 -> 0", logic.toNumberOrNull(0) === 0)
check("'7' -> 7", logic.toNumberOrNull('7') === 7)
check("7 -> 7", logic.toNumberOrNull(7) === 7)
check("'12,5' -> 12.5 (koma desimal)", logic.toNumberOrNull('12,5') === 12.5)
check("hasNumber('') false", logic.hasNumber('') === false)
check("hasNumber('0') true (eksplisit)", logic.hasNumber('0') === true)

// ------------------------------------------------------------
console.log('\n[B] stockStatus — kejujuran per material')
// ------------------------------------------------------------
const tanpaAngka = { id: 'm1', name: 'Sekrup 3 inch', category: 'Hardware & Fitting', current_stock: null }
const st1 = logic.stockStatus(tanpaAngka)
check("tanpa angka -> state UNAVAILABLE", st1.state === 'UNAVAILABLE')
check("tanpa angka -> current null (BUKAN 0)", st1.current === null)
check("hasNumber(current_stock) false", logic.hasNumber(tanpaAngka.current_stock) === false)

const kosongStr = { id: 'm2', name: 'Engsel', category: 'Hardware & Fitting', current_stock: '' }
check("current_stock '' -> UNAVAILABLE", logic.stockStatus(kosongStr).state === 'UNAVAILABLE')

const nolEksplisit = { id: 'm3', name: 'Bor', category: 'Hardware & Fitting', current_stock: 0 }
const st3 = logic.stockStatus(nolEksplisit)
check("current_stock 0 EKSPLISIT -> bukan UNAVAILABLE", st3.state !== 'UNAVAILABLE')
check("current_stock 0 EKSPLISIT -> current 0", st3.current === 0)

const bhpAman = { id: 'm4', name: 'Lem Fox', category: 'Bahan Habis Pakai', kode: 'BHP-0001', current_stock: 20, min_stock: 5 }
const st4 = logic.stockStatus(bhpAman)
check("BHP di atas min -> TIDAK_DIPANTAU (bukan MENIPIS)", st4.state === 'TIDAK_DIPANTAU')

const bhpTipis = { id: 'm5', name: 'Lem Fox', category: 'Bahan Habis Pakai', kode: 'BHP-0002', current_stock: 3, min_stock: 5 }
const st5 = logic.stockStatus(bhpTipis)
check("BHP <= min -> MENIPIS", st5.state === 'MENIPIS')

const bhpPas = { id: 'm6', name: 'Lem Fox', category: 'Bahan Habis Pakai', kode: 'BHP-0003', current_stock: 5, min_stock: 5 }
check("BHP current == min -> MENIPIS (batas inklusif)", logic.stockStatus(bhpPas).state === 'MENIPIS')

const bhpMinNol = { id: 'm7', name: 'Lem Fox', category: 'Bahan Habis Pakai', kode: 'BHP-0004', current_stock: 0, min_stock: 0 }
check("min_stock 0 = pemantauan nonaktif -> bukan MENIPIS", logic.stockStatus(bhpMinNol).state !== 'MENIPIS')

const nonBhp = { id: 'm8', name: 'Plywood 18mm', category: 'Plywood & Board', current_stock: 1, min_stock: 10 }
check("non-BHP di bawah min -> BUKAN MENIPIS (hanya BHP dipantau)", logic.stockStatus(nonBhp).state !== 'MENIPIS')

const kodeBhpSaja = { id: 'm9', name: 'Amplas', category: 'Lainnya', kode: 'BHP-0010', current_stock: 2, min_stock: 4 }
check("kode BHP-0010 terdeteksi BHP walau kategori lain", logic.stockStatus(kodeBhpSaja).state === 'MENIPIS')

const bhpPalsu = { id: 'm10', name: 'Bracket BHPX', category: 'Lainnya', kode: 'BHPX-1', current_stock: 1, min_stock: 9 }
check("kode 'BHPX-1' BUKAN BHP (harus '-' + digit)", logic.stockStatus(bhpPalsu).state !== 'MENIPIS')

const bhpTanpaMin = { id: 'm11', name: 'Lem', category: 'Bahan Habis Pakai', kode: 'BHP-0011', current_stock: 2, min_stock: null }
check("BHP tanpa min_stock -> bukan MENIPIS (tak ada ambang)", logic.stockStatus(bhpTanpaMin).state !== 'MENIPIS')

// ------------------------------------------------------------
console.log('\n[C] summarizeStock — KPI hitungan baris saja')
// ------------------------------------------------------------
const mix = [tanpaAngka, kosongStr, bhpAman, bhpTipis, nonBhp]
const kpi = logic.summarizeStock(mix)
check("total = jumlah baris", kpi.total === 5, `dapat ${kpi.total}`)
check("adaAngka = 3", kpi.adaAngka === 3, `dapat ${kpi.adaAngka}`)
check("tanpaAngka = 2", kpi.tanpaAngka === 2, `dapat ${kpi.tanpaAngka}`)
check("menipis = 1", kpi.menipis === 1, `dapat ${kpi.menipis}`)
check("bhp = 2", kpi.bhp === 2, `dapat ${kpi.bhp}`)
check("TIDAK ada KPI total stok / nilai persediaan (anti fabrikasi)",
  !('totalStok' in kpi) && !('nilaiPersediaan' in kpi) && !('totalQty' in kpi))
check("summarizeStock([]) aman", (() => {
  const e = logic.summarizeStock([])
  return e.total === 0 && e.adaAngka === 0 && e.tanpaAngka === 0
})())

// ------------------------------------------------------------
console.log('\n[D] buildCategoryOptions & filterStockRows')
// ------------------------------------------------------------
const cats = logic.buildCategoryOptions(mix)
check("kategori hanya yang ADA di data", cats.length === 3, `dapat ${JSON.stringify(cats)}`)
check("kategori terurut abjad", cats[0] === 'Bahan Habis Pakai' && cats[1] === 'Hardware & Fitting' && cats[2] === 'Plywood & Board',
  JSON.stringify(cats))
check("kategori '' tidak dimasukkan", !cats.includes(''))

check("filter kategori 'Bahan Habis Pakai' -> 2 baris",
  logic.filterStockRows({ materials: mix, category: 'Bahan Habis Pakai' }).length === 2)
check("filter kategori tidak case-sensitive",
  logic.filterStockRows({ materials: mix, category: 'bahan habis pakai' }).length === 2)
check("filter 'all' -> semua", logic.filterStockRows({ materials: mix, category: 'all' }).length === 5)
check("filter kategori kosong (tidak ada datanya) -> 0 baris",
  logic.filterStockRows({ materials: mix, category: 'Kategori Yang Tidak Ada' }).length === 0)
check("pencarian 'ply' cocok Plywood",
  logic.filterStockRows({ materials: mix, query: 'ply' }).length === 1)
check("pencarian kode 'BHP-0002' cocok",
  logic.filterStockRows({ materials: mix, query: 'BHP-0002' }).length === 1)
check("pencarian '' -> semua", logic.filterStockRows({ materials: mix, query: '' }).length === 5)
check("kombinasi kategori + pencarian",
  logic.filterStockRows({ materials: mix, category: 'Bahan Habis Pakai', query: 'fox' }).length === 2)

// ------------------------------------------------------------
console.log('\n[E] toCsv — angka kosong = kosong, BUKAN 0')
// ------------------------------------------------------------
const csv = logic.toCsv([tanpaAngka, bhpTipis])
const lines = csv.split('\n')
check("CSV punya header", lines[0] === 'Kode,Nama,Kategori,Satuan,Stok,Min Stok,Status', lines[0])
const rowTanpa = lines[1].split(',')
check("baris tanpa angka: kolom Stok kosong (bukan 0)", rowTanpa[4] === '', JSON.stringify(rowTanpa))
check("baris tanpa angka: kolom Min Stok kosong (bukan 0)", rowTanpa[5] === '', JSON.stringify(rowTanpa))
check("baris tanpa angka: status UNAVAILABLE", rowTanpa[6] === 'UNAVAILABLE')
const rowTipis = lines[2].split(',')
check("baris menipis: stok 3", rowTipis[4] === '3', JSON.stringify(rowTipis))
check("baris menipis: min 5", rowTipis[5] === '5', JSON.stringify(rowTipis))
check("baris menipis: status MENIPIS", rowTipis[6] === 'MENIPIS')
check("toCsv([]) tetap punya header saja", logic.toCsv([]).split('\n').length === 1)

// CSV dengan koma di nama -> harus dikutip
const csvQuote = logic.toCsv([{ name: 'Plywood, lapis 3', current_stock: null }])
check("nama berkoma dikutip", csvQuote.includes('"Plywood, lapis 3"'), csvQuote)

// ------------------------------------------------------------
console.log('\n[F] ANTI-STATUS-DOKUMEN & READ-ONLY (pemeriksaan statis sumber)')
// ------------------------------------------------------------
const srcLogic = fs.readFileSync(path.join(REPO, 'modules/stock/logic.js'), 'utf8')
const srcView = fs.readFileSync(path.join(REPO, 'modules/stock/view.jsx'), 'utf8')
const srcStock = srcLogic + '\n' + srcView

// Tidak ada pembacaan field status dokumen.
const statusField = /\b(pr_status|status)\b\s*(===|!==|==|!=|\.toUpperCase)/
check("logic.js TIDAK membandingkan field status dokumen", !statusField.test(srcLogic))
check("view.jsx TIDAK membandingkan field status dokumen", !statusField.test(srcView))
// Tidak ada nama tabel dokumen yang dibaca.
// CATATAN: komentar di logic.js MENYEBUT pr_items/receiving_items untuk
// mendokumentasikan keterbatasan data — itu prosa, bukan pembacaan tabel.
// Jadi komentar di-strip dulu sebelum pemeriksaan.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
const srcLogicCode = stripComments(srcLogic)
const srcViewCode = stripComments(srcView)
const srcStockCode = srcLogicCode + '\n' + srcViewCode
for (const tbl of ['purchase_requests', 'pr_items', 'receivings', 'receiving_items', 'handovers', 'approval_steps']) {
  check(`tidak membaca tabel '${tbl}'`, !srcStockCode.includes(tbl))
}
// Tidak ada penulisan DB.
for (const mut of ['.insert(', '.update(', '.delete(', '.rpc(', 'supabase.from(']) {
  check(`tidak ada operasi tulis: ${mut}`, !srcStock.includes(mut))
}
// Tidak ada import supabaseClient sama sekali.
check("tidak mengimpor supabaseClient", !srcStock.includes('supabaseClient'))

// Keterbatasan data terdokumentasikan & tidak kosong.
check("DATA_LIMITATIONS terisi", Array.isArray(logic.DATA_LIMITATIONS) && logic.DATA_LIMITATIONS.length >= 3)
check("DATA_LIMITATIONS menyebut ledger/movement",
  logic.DATA_LIMITATIONS.some(t => /ledger|movement/i.test(t)))
check("label UNAVAILABLE eksplisit", logic.UNAVAILABLE_LABEL === 'Tidak tersedia')

// ------------------------------------------------------------
console.log('\n[G] BARANG KELUAR TIDAK DIKURANGI (batasan yang diakui)')
// ------------------------------------------------------------
// Modul tidak boleh punya fungsi yang mengurangi stok karena belum ada
// pencatatan pengurangan — memastikan tidak ada semacam deductStock/keluar.
for (const bad of ['deductStock', 'kurangiStok', 'stockOut', 'barangKeluar']) {
  check(`tidak ada logika pengurangan: ${bad}`, !srcStock.includes(bad))
}

// ------------------------------------------------------------
const total = pass + fail
console.log(`\n${'='.repeat(60)}`)
console.log(`HASIL LOGIC TEST: ${pass}/${total} lulus`)
if (fail > 0) {
  console.log(`GAGAL (${fail}):`)
  for (const f of failures) console.log(`  - ${f}`)
}
console.log('='.repeat(60))
process.exit(fail > 0 ? 1 : 0)
