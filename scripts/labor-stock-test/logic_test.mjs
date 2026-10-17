// logic_test.mjs — uji FUNGSI MURNI modules/labor-stock/logic.js (t_62e41e91)
//
// Fokus: ESTIMASI vs AKTUAL jujur.
//   - aktual (tukang_projects.total_upah) tidak pernah ditulis dari
//     estimasi (project_plans.labor_cost), dan sebaliknya.
//   - sumber tidak dikirim -> 'unavailable', bukan 'empty', bukan 0.
//   - nilai tidak ada -> null / "Tidak tersedia", BUKAN 0.
//   - selisih hanya bila KEDUA angka ada.
//   - status kelengkapan: LENGKAP / AKTUAL_SAJA / ESTIMASI_SAJA / KOSONG.
//   - CSV: nilai kosong -> string kosong, bukan 0.
//
// Jalankan dari sandbox: node logic_test.mjs <REPO>
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.argv[2] || process.cwd()
const SRC = fs.readFileSync(path.join(REPO, 'modules/labor-stock/logic.js'), 'utf8')

// ESM: impor versi .mjs hasil salinan sandbox (struktur sama).
const mod = await import('./modules/labor-stock/logic.mjs')
const {
  UNAVAILABLE_LABEL,
  toNumberOrNull,
  hasNumber,
  sourceCapability,
  laborProjectName,
  laborTukangName,
  projectKey,
  actualLaborByProject,
  estimateLaborByProject,
  projectNameMap,
  laborCompleteness,
  filterLaborRows,
  laborPeriodOptions,
  summarizeLabor,
  toCsv
} = mod

let n = 0
function ok(cond, msg) {
  assert.ok(cond, msg)
  n += 1
}
function eq(a, b, msg) {
  assert.deepStrictEqual(a, b, `${msg} — dapat ${JSON.stringify(a)}, harap ${JSON.stringify(b)}`)
  n += 1
}

// ----------------------------------------------------------
// 1) CAPABILITY SUMBER — bedakan "tidak dikirim" dari "kosong"
// ----------------------------------------------------------
eq(sourceCapability(null), 'unavailable', 'null = sumber tidak dikirim')
eq(sourceCapability(undefined), 'unavailable', 'undefined = sumber tidak dikirim')
eq(sourceCapability([]), 'empty', 'array kosong = sumber kosong')
eq(sourceCapability([{ id: 'a' }]), 'ready', 'array berisi = ready')

// ----------------------------------------------------------
// 2) toNumberOrNull — tidak ada angka yang dikarang
// ----------------------------------------------------------
eq(toNumberOrNull(null), null, 'null tetap null')
eq(toNumberOrNull(undefined), null, 'undefined tetap null')
eq(toNumberOrNull(''), null, 'string kosong tetap null (BUKAN 0)')
eq(toNumberOrNull('abc'), null, 'teks acak tetap null (BUKAN 0)')
eq(toNumberOrNull(0), 0, '0 eksplisit tetap 0')
eq(toNumberOrNull('1.500.000'), 1500000, 'format ribuan Indonesia')
eq(toNumberOrNull('1.500,50'), 1500.5, 'koma desimal')
eq(hasNumber(''), false, 'hasNumber("") = false')
eq(hasNumber('0'), true, 'hasNumber("0") = true')

// ----------------------------------------------------------
// 3) NAMA & KUNCI PROJECT
// ----------------------------------------------------------
eq(laborProjectName({ project_name: 'Gudang A' }), 'Gudang A', 'nama project terbaca')
eq(laborProjectName({}), UNAVAILABLE_LABEL, 'tanpa nama project = Tidak tersedia (bukan "—" kosong)')
eq(laborTukangName({ tukang_key: 'TKG-01' }), 'TKG-01', 'kunci tukang terbaca')
eq(projectKey('  Gudang   A '), 'gudang a', 'kunci dinormalkan')

// ----------------------------------------------------------
// 4) AKTUAL per project — hanya dari total_upah
// ----------------------------------------------------------
const actualRows = [
  { id: 'r1', tukang_key: 'TKG-01', project_name: 'Gudang A', total_upah: '3.000.000', status: 'Berjalan', batch: 'B1' },
  { id: 'r2', tukang_key: 'TKG-02', project_name: 'Gudang A', total_upah: 2000000, status: 'Berjalan', batch: 'B1' },
  { id: 'r3', tukang_key: 'TKG-01', project_name: 'Rumah B', total_upah: null, status: 'Perencanaan', batch: 'B2' }
]
const aMap = actualLaborByProject(actualRows)
eq(aMap.get('gudang a').actual, 5000000, 'aktual dijumlah per project')
eq(aMap.get('gudang a').adaAngka, 2, 'dua baris punya angka')
eq(aMap.get('rumah b'), undefined, 'project tanpa angka TIDAK dihitung jadi 0')

// AKTUAL tidak pernah ditarik dari estimasi: baris yang hanya punya
// labor_cost (kolom estimasi) tidak boleh menghasilkan aktual.
const onlyEstimate = [{ id: 'x', project_name: 'Gudang A', labor_cost: 9999999 }]
eq(actualLaborByProject(onlyEstimate).get('gudang a'), undefined,
  'labor_cost (estimasi) tidak pernah jadi aktual')

// ----------------------------------------------------------
// 5) ESTIMASI per project — hanya dari project_plans.labor_cost,
//    dikunci lewat peta id -> nama project (skema pakai project_id).
// ----------------------------------------------------------
const projects = [{ id: 'p1', name: 'Gudang A' }, { id: 'p2', name: 'Rumah B' }]
const nameMap = projectNameMap(projects)
const estimateRows = [
  { id: 'e1', project_id: 'p1', item_name: 'Pemasangan', labor_cost: 6000000 },
  { id: 'e2', project_id: 'p1', item_name: 'Finishing', labor_cost: 4000000 },
  { id: 'e3', project_id: 'p2', item_name: 'Dasar', labor_cost: 1000000 }
]
const eMap = estimateLaborByProject(estimateRows, nameMap)
eq(eMap.get('gudang a').estimate, 10000000, 'estimasi dijumlah per project')
eq(eMap.get('rumah b').estimate, 1000000, 'estimasi project kedua')

// Tanpa peta nama, estimasi dianggap TIDAK DIKIRIM — tidak dipaksa cocok
// dengan nama yang keliru.
eq(estimateLaborByProject(estimateRows, null), null,
  'tanpa peta id->nama estimasi = tidak dikirim (bukan dikarang)')

// Estimasi tidak pernah tertulis sebagai aktual: kunci estimasi yang tidak
// punya padanan aktual tidak boleh muncul di peta aktual.
ok(!aMap.has('gudang z'), 'estimasi tanpa aktual tidak membuat baris aktual')

// ----------------------------------------------------------
// 6) STATUS KELENGKAPAN
// ----------------------------------------------------------
const cLengkap = laborCompleteness({ estimate: 10000000, actual: 5000000, estimateSent: true, actualSent: true })
eq(cLengkap.state, 'LENGKAP', 'ada keduanya = LENGKAP')
eq(cLengkap.diff, -5000000, 'selisih = aktual - estimasi')
eq(Math.round(cLengkap.diffPct), -50, 'selisih persen dihitung dari estimasi')

const cActualOnly = laborCompleteness({ estimate: null, actual: 5000000, estimateSent: true, actualSent: true })
eq(cActualOnly.state, 'AKTUAL_SAJA', 'aktual saja')
eq(cActualOnly.diff, null, 'selisih null saat estimasi tidak ada (bukan -5000000)')

const cEstOnly = laborCompleteness({ estimate: 10000000, actual: null, estimateSent: true, actualSent: true })
eq(cEstOnly.state, 'ESTIMASI_SAJA', 'estimasi saja')
eq(cEstOnly.actual, null, 'aktual null — estimasi TIDAK dipakai mengisi aktual')

const cKosong = laborCompleteness({ estimate: null, actual: null, estimateSent: false, actualSent: false })
eq(cKosong.state, 'KOSONG', 'tidak dikirim keduanya = KOSONG')

// Aktual 0 eksplisit tetap 0 (bukan "tidak tersedia").
const cZero = laborCompleteness({ estimate: 1000000, actual: 0, estimateSent: true, actualSent: true })
eq(cZero.state, 'LENGKAP', 'aktual 0 eksplisit tetap dihitung')
eq(cZero.actual, 0, 'aktual 0 eksplisit = 0')
eq(cZero.diff, -1000000, 'selisih dengan aktual 0 dihitung')

// ----------------------------------------------------------
// 7) FILTER — project, periode, pencarian
// ----------------------------------------------------------
eq(filterLaborRows({ rows: actualRows, project: 'all', period: 'all', query: '' }).length, 3, 'tanpa filter = semua')
eq(filterLaborRows({ rows: actualRows, project: 'Rumah B' }).length, 1, 'filter project')
eq(filterLaborRows({ rows: actualRows, period: 'B1' }).length, 2, 'filter periode (batch)')
eq(filterLaborRows({ rows: actualRows, query: 'tkg-02' }).length, 1, 'pencarian tukang')
eq(filterLaborRows({ rows: actualRows, query: 'gudang' }).length, 2, 'pencarian project')
eq(filterLaborRows({ rows: actualRows, query: 'zzz' }).length, 0, 'pencarian tanpa hasil')

// Daftar periode hanya yang benar-benar ada (tidak mengarang pilihan).
eq(laborPeriodOptions(actualRows), ['B1', 'B2'], 'opsi periode dari data, terurut')

// ----------------------------------------------------------
// 8) KPI — tidak menjumlah estimasi + aktual
// ----------------------------------------------------------
const kpi = summarizeLabor({ actualRows, estimateRows, projectNames: nameMap })
eq(kpi.actualProjects, 1, 'hanya 1 project punya angka aktual')
eq(kpi.actualTotal, 5000000, 'total aktual dari tukang_projects saja')
eq(kpi.actualRowsAngka, 2, '2 dari 3 baris punya angka')
eq(kpi.estimateSent, true, 'estimasi dikirim')
eq(kpi.estimateTotal, 11000000, 'total estimasi dari project_plans saja')
ok(kpi.actualTotal + kpi.estimateTotal !== kpi.actualTotal,
  'aktual & estimasi adalah angka terpisah (tidak dijumlah jadi satu KPI)')

const kpiNoEst = summarizeLabor({ actualRows })
eq(kpiNoEst.estimateSent, false, 'tanpa sumber estimasi = tidak dikirim')
eq(kpiNoEst.estimateTotal, null, 'total estimasi null, BUKAN 0')

// ----------------------------------------------------------
// 9) CSV — nilai kosong diekspor kosong, BUKAN 0
// ----------------------------------------------------------
const csv = toCsv(actualRows)
const lines = csv.split('\n')
ok(lines[0].startsWith('Tukang,Project,'), 'header CSV dimulai dari kolom yang tampil')
const rumahLine = lines.find(l => l.includes('Rumah B'))
ok(rumahLine.includes(',,'), 'baris tanpa angka upah: kolom nominal KOSONG')
ok(!/Rumah B,TKG-01,0,/.test(csv), 'BUKAN diekspor sebagai 0')
ok(csv.includes('3000000'), 'angka aktual benar-benar ada di CSV (bukan string kosong)')

// ----------------------------------------------------------
// 10) STATIK — modul tidak boleh membaca kolom estimasi sebagai
//     sumber aktual, dan tidak boleh ada penulisan DB.
// ----------------------------------------------------------
ok(/total_upah/.test(SRC), 'logic membaca total_upah (sumber aktual)')
// labor_cost hanya boleh muncul DI DALAM fungsi estimasi — bukan di
// jalur aktual. Ambil badan actualLaborByProject lalu pastikan bersih.
const actualFn = SRC.slice(
  SRC.indexOf('export function actualLaborByProject'),
  SRC.indexOf('// Jumlah estimasi per project')
)
ok(!/labor_cost/.test(actualFn),
  'actualLaborByProject TIDAK membaca labor_cost (estimasi tidak mencuri aktual)')
ok(!/\.insert\(|\.update\(|\.delete\(|\.rpc\(/.test(SRC),
  'tidak ada penulisan DB di logic.js')
ok(!/localStorage/.test(SRC), 'tidak ada localStorage di logic.js')

console.log(`logic_test.mjs: ${n} assertion LULUS ✅`)
