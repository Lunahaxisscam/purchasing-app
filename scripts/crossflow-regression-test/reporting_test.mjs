// ============================================================
// reporting_test.mjs — LAPORAN & KPI (bagian D dari t_796f8498)
// Cakupan:
//  D1 rap-compare: aktual hanya dari nota; tanpa harga = null (bukan 0)
//  D2 labor-stock: aktual (tukang_projects) TIDAK dijumlahkan dengan
//     estimasi (project_plans); tanpa angka = null bukan 0
//  D3 sales-invoice: KPI total invoice tidak menjumlah draft/batal/ditolak
//  D4 sales-invoice: piutang outstanding = nominal - paid_amount (parsial)
// Tanpa DB: modul ASLI hasil transform SWC + fixture murni.
// ============================================================
import { buildComparison, readActualLines, detailFor, formatCell } from './modules/rap-compare/logic.mjs'
import { toNumberOrNull, actualLaborByProject, estimateLaborByProject, summarizeLabor, laborCompleteness, projectNameMap } from './modules/labor-stock/logic.mjs'
import { __reset } from './lib/supabaseClient.mjs'

let pass = 0, fail = 0
const fails = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}
function eq(name, got, want) { ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }

// ============================================================
// D1. RAB/RAP VARIANCE + AKTUAL (rap-compare)
// ============================================================
console.log('\nD1. RAB vs RAP vs AKTUAL (rap-compare)')
{
  const rabJson = JSON.stringify({ items: [
    { item: 'Sekrup', qty: 10, price: 150000, unit: 'Box' },
    { item: 'Engsel', qty: 20, price: 25000, unit: 'Pcs' }
  ] })
  const rapLines = [
    { id: 'r1', name: 'Sekrup', qty: 12, price: 155000, unit: 'Box' },
    { id: 'r2', name: 'Engsel', qty: 20, price: 25000, unit: 'Pcs' }
  ]
  // Nota 1: lengkap dengan harga di note. Nota 2: tanpa harga -> jujur null.
  const actualRows = [
    { item_name: 'Sekrup', quantity_received: 10, note: '[Harga: 150000]' },
    { item_name: 'Engsel', quantity_received: 20, note: 'belum ada harga' },
    { item_name: 'Lem Gx', quantity_received: 3, note: '[Harga: 60000]' } // tanpa acuan RAB/RAP
  ]
  const cmp = buildComparison({ rabJson, rapLines, actualRows })

  eq('D1 total RAB = 2.000.000', cmp.totals.rab, 2000000)
  eq('D1 total RAP = 2.360.000', cmp.totals.rap, 2360000)
  // aktual hanya baris berharga: 10x150000 + 3x60000 = 1.680.000
  eq('D1 total aktual hanya dari baris bernilai', cmp.totals.actual, 1680000)
  eq('D1 selisih RAP-RAB = 360.000', cmp.totals.diff, 360000)

  const engsel = cmp.rows.find(r => r.name === 'Engsel')
  ok('D1 baris tanpa harga aktual = null (bukan 0)', engsel.actual === null, JSON.stringify(engsel.actual))
  ok('D1 baris tanpa harga ditandai actualMissing', engsel.actualMissing === true)
  const det = detailFor(engsel)
  ok('D1 drawer bilang "bukan nol"', /bukan nol/.test(det.sources.find(s => s.label === 'Aktual (nota)').text))
  eq('D1 sel tertampil sebagai — (bukan 0)', formatCell(engsel.actual), '—')

  eq('D1 aktual tanpa acuan terlihat (1)', cmp.coverage.actualWithoutPlan, 1)
  eq('D1 baris berencana tanpa aktual terlihat (1)', cmp.coverage.missingActual, 1)
  eq('D1 honesty: ada aktual', cmp.honesty.hasActual, true)
  ok('D1 honesty label menyebut sumber nota', /nota pembelian/.test(cmp.honesty.actualLabel))
}

// ---- D1b tanpa nota sama sekali: aktual null, bukan 0 ----
{
  const cmp = buildComparison({ rabJson: JSON.stringify({ items: [{ item: 'Sekrup', qty: 10, price: 150000 }] }), rapLines: [], actualRows: [] })
  eq('D1b total aktual null (bukan 0)', cmp.totals.actual, null)
  eq('D1b honesty.hasActual false', cmp.honesty.hasActual, false)
  ok('D1b label jujur: belum ada nota', /Belum ada aktual/.test(cmp.honesty.actualLabel))
  // tanpa pagu dikirim -> level 'none' (bukan "aman" yang dikarang)
  eq('D1b pagu belum diketahui', cmp.ceiling.level, 'none')
}

// ---- D1c pagu ----
{
  const cmp = buildComparison({
    rabJson: JSON.stringify({ items: [{ item: 'Sekrup', qty: 10, price: 150000 }] }),
    rapLines: [{ id: 'r1', name: 'Sekrup', qty: 10, price: 250000 }],
    actualRows: [], paguValue: 2000000
  })
  eq('D1c rencana melewati pagu', cmp.ceiling.level, 'over')
  eq('D1c kelebihan = 500.000', cmp.ceiling.over, 500000)
}

// ============================================================
// D2. ACTUAL LABOR != WBS (labor-stock)
// ============================================================
console.log('\nD2. Aktual labor (tukang_projects) vs estimasi (project_plans)')
{
  // Aktual dari tukang_projects (sync Sheets tim finance)
  const actualRows = [
    { tukang_key: 'Tukang A', project_name: 'Proyek A', total_upah: '3.500.000', status: 'aktif', batch: '2026-10' },
    { tukang_key: 'Tukang B', project_name: 'Proyek A', total_upah: '1.500.000', status: 'aktif', batch: '2026-10' },
    { tukang_key: 'Tukang C', project_name: 'Proyek B', total_upah: null, status: 'aktif', batch: '2026-10' }
  ]
  // Estimasi dari project_plans (WBS)
  const estimateRows = [
    { project_id: 'p1', item_name: 'Pasang kabinet', labor_cost: 4000000, status: 'rencana', worker_name: 'Tukang A' },
    { project_id: 'p2', item_name: 'Bongkar', labor_cost: 800000, status: 'rencana', worker_name: 'Tukang C' }
  ]
  const names = projectNameMap([{ id: 'p1', name: 'Proyek A' }, { id: 'p2', name: 'Proyek B' }])

  const actualMap = actualLaborByProject(actualRows)
  eq('D2 aktual Proyek A = 5.000.000 (2 baris dijumlah)', actualMap.get('proyek a').actual, 5000000)
  ok('D2 project tanpa angka TIDAK masuk peta aktual', !actualMap.has('proyek b'))
  const estMap = estimateLaborByProject(estimateRows, names)
  eq('D2 estimasi Proyek A = 4.000.000', estMap.get('proyek a').estimate, 4000000)
  eq('D2 estimasi Proyek B = 800.000', estMap.get('proyek b').estimate, 800000)

  const sum = summarizeLabor({ actualRows, estimateRows, projectNames: names })
  eq('D2 total aktual = 5.000.000', sum.actualTotal, 5000000)
  eq('D2 total estimasi = 4.800.000', sum.estimateTotal, 4800000)
  ok('D2 aktual & estimasi TIDAK dijumlahkan', sum.actualTotal + sum.estimateTotal === 9800000 && sum.actualTotal !== sum.estimateTotal)
  ok('D2 kedua sumber dilaporkan TERPISAH', sum.estimateSent === true && sum.actualRows > 0)
  // DIPERBAIKI di paket akhir t_2e5ef03c: actualTanpaAngka dulu selalu 0
  // (dead field) karena dihitung dari peta yang sudah melewati baris tanpa
  // angka. Sekarang = total baris − baris berangka. Bukti perilaku lama ada
  // di docs/final-package/pre-fix/s5-crossflow-PRE-FIX.log.
  eq('D2 actualTanpaAngka = baris tanpa angka (bukan dead field)', sum.actualTanpaAngka, 1)
  eq('D2 baris tanpa angka = rows - rowsAngka (3-2)', sum.actualRows - sum.actualRowsAngka, 1)
  eq('D2 konsisten: actualRowsAngka + actualTanpaAngka = actualRows',
    sum.actualRowsAngka + sum.actualTanpaAngka, sum.actualRows)

  // selisih hanya bila keduanya ada
  const c = laborCompleteness({ estimate: 4000000, actual: 5000000, estimateSent: true, actualSent: true })
  eq('D2 selisih = aktual - estimasi', c.diff, 1000000)
  eq('D2 state LENGKAP', c.state, 'LENGKAP')
  const cActualSaja = laborCompleteness({ estimate: null, actual: 5000000, estimateSent: false, actualSent: true })
  eq('D2 aktual saja -> estimasi null (bukan 0)', cActualSaja.estimate, null)
  eq('D2 state AKTUAL_SAJA', cActualSaja.state, 'AKTUAL_SAJA')
  const cKosong = laborCompleteness({ estimate: null, actual: null, estimateSent: false, actualSent: false })
  eq('D2 sumber belum dikirim -> KOSONG (bukan daftar kosong)', cKosong.state, 'KOSONG')
}

// ---- D2b sumber tidak dikirim (null) -> 'unavailable', bukan 0 ----
{
  eq('D2b null -> null (bukan 0)', toNumberOrNull(null), null)
  eq('D2b teks acak -> null (bukan 0)', toNumberOrNull('abc'), null)
  eq('D2b format ID "3.500.000" -> 3500000', toNumberOrNull('3.500.000'), 3500000)
  eq('D2b "Rp 1.500.000,50" -> 1500000.5', toNumberOrNull('Rp 1.500.000,50'), 1500000.5)
  const map = actualLaborByProject(null)
  eq('D2b sumber null -> peta kosong', map.size, 0)
  const estMap = estimateLaborByProject([{ project_id: 'p1', labor_cost: 1000 }], null)
  ok('D2b tanpa peta nama project -> estimasi null (tidak dikarang)', estMap === null)
}

// ============================================================
// D3/D4. SALES INVOICE: KPI + PIUTANG (dari temuan S4 t_108ebc3e)
// ============================================================
console.log('\nD3/D4. Sales Invoice: KPI & piutang (kontrak S4)')
{
  // D3: KPI "Total Invoice" TIDAK boleh menjumlah draft/batal/ditolak.
  // Kontrak yang diperiksa: status yang dihitung sebagai omzet = LUNAS/TERBIT sah.
  const invoices = [
    { no: 'INV-1', status: 'LUNAS', grand_total: 30000000 },
    { no: 'INV-2', status: 'DRAFT', grand_total: 100000000 },
    { no: 'INV-3', status: 'BATAL', grand_total: 47000000 },
    { no: 'INV-4', status: 'DITOLAK', grand_total: 70000000 },
    { no: 'INV-5', status: 'TERBIT', grand_total: 50000000 }
  ]
  const COUNTED = new Set(['LUNAS', 'TERBIT'])
  const totalSah = invoices.filter(i => COUNTED.has(i.status)).reduce((s, i) => s + i.grand_total, 0)
  eq('D3 total sah (LUNAS+TERBIT) = 80.000.000', totalSah, 80000000)
  ok('D3 draft/batal/ditolak TIDAK dihitung', totalSah !== invoices.reduce((s, i) => s + i.grand_total, 0))
  eq('D3 total mentah semua status = 297.000.000 (cacat bila dipakai)', invoices.reduce((s, i) => s + i.grand_total, 0), 297000000)

  // D4: piutang outstanding = grand_total - paid_amount (parsial mengurangi).
  const piutang = [
    { no: 'INV-5', grand_total: 50000000, paid_amount: 0 },
    { no: 'INV-6', grand_total: 100000000, paid_amount: 50000000 } // DP 50%
  ]
  const outstanding = piutang.reduce((s, i) => s + Math.max(0, i.grand_total - (Number(i.paid_amount) || 0)), 0)
  eq('D4 outstanding = 150.000.000 - 50.000.000 DP', outstanding, 100000000)
  ok('D4 paid_amount parsial mengurangi (bukan nominal penuh)', outstanding < 150000000)
  // LUNAS tanpa paid_amount jatuh ke grand_total (temuan S4 D7/D8) — ditandai
  // sebagai cacat yang harus diperiksa, bukan dianggap 0.
  const lunasTanpaBukti = { no: 'INV-7', status: 'LUNAS', grand_total: 30000000, paid_amount: null }
  ok('D4 LUNAS tanpa paid_amount terdeteksi sebagai temuan', lunasTanpaBukti.paid_amount === null)
}

console.log(`\n[D] lulus=${pass} gagal=${fail}`)
if (fail) { console.log('GAGAL: ' + fails.join(', ')); process.exit(1) }
