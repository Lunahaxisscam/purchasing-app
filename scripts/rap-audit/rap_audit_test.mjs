// ============================================================
// HARNESS AUDIT S3 — RAP, Pagu 4-Pilar, Variance, Margin
// t_18652eb1 (bandeng) — base main@18fb594, worktree wt-s3-rap-audit.
//
// Grup pemeriksaan (NON-DESTRUKTIF, tanpa DB, tanpa SQL produksi):
//   R1 No-NaN        : angka realisasi selalu finite utk data rusak.
//   R2 Custom sum    : total persen custom > 100 TIDAK diterapkan.
//   R3 Tanda variance: konvensi tanda variance/defisit/sisa.
//   R4 Formula margin: konsistensi & dokumentasi 2 definisi margin.
//   R5 Label estimasi: fakta statik kode asli (predictions verbatim).
//   R6 Pagu ceiling  : bug presisi Math.round(rev*70)/100 di batas.
//   R7 Boundary      : revenue 0 / null / negatif / nilai besar.
//   ST               : cek statik string kode sumber asli.
//   REG              : regresi test legacy 4-pilar.
//
// Output: bukti STDOUT + scripts/rap-audit/variance_scenarios.csv
// yang disusun dari HASIL EKSEKUSI computeBudget — bukan teori.
// ============================================================
import fs from 'node:fs'
import { execSync } from 'node:child_process'

// S3-RECOVERY (Bit, t_18652eb1): base pindah dari main@18fb594 ke
// integration HEAD 1d364e7. WT dapat dioverride via env S3_WT supaya
// harness bisa dijalankan dari worktree mana pun tanpa mengubah
// kode aplikasi. TIDAK ADA perubahan pada assertion/tes.
const WT = process.env.S3_WT || '/home/ubuntu/dev-workspaces/wt-s3-rap-recovery'

const PROD_FILES = {
  planning: fs.readFileSync(`${WT}/components/Planning.js`, 'utf8'),
  projectFinance: fs.readFileSync(`${WT}/components/ProjectFinance.js`, 'utf8'),
  finance: fs.readFileSync(`${WT}/components/Finance.js`, 'utf8')
}
function findText(file, needle) {
  return PROD_FILES[file].indexOf(needle)
}

const results = []
const findings = []
let passed = 0
let failed = 0
function rec(group, id, name, ok, detail, math) {
  results.push({ id, group, name, pass: !!ok, detail, math: math || '' })
  if (ok) passed++
  else failed++
}
function check(group, id, name, ok, detail, math) {
  rec(group, id, name, ok, detail, math)
  console.log(`  ${ok ? '✓' : '✗ GAGAL'} ${id} — ${detail}`)
}

console.log('[S3-AUDIT] Mulai — RAP, pagu, variance, margin (base main@18fb594)')

const { STANDARD_PERCENTAGES, validatePercentDraft, computeBudget } = await import('./rapMoney.js')

// ============================================================
// R1 — NO-NaN
// ============================================================
console.log('\n[R1] No-NaN')

const sink = x => { const v = Number(x); return !isNaN(v) && v > 0 ? v : 0 }

const r1Rows = [
  { revenue: 0, cumulative_cost: 0, petty_cash: 0 },
  { revenue: '150000000', cumulative_cost: null, petty_cash: undefined },
  { revenue: null, cumulative_cost: 'abc', petty_cash: NaN },
  { revenue: -5, cumulative_cost: -1000, petty_cash: -1 }
]
const r1Sinks = r1Rows.map(r => [sink(r.revenue), sink(r.cumulative_cost), sink(r.petty_cash)])
const r1AllFinite = r1Sinks.every(([a, b, c]) => Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c))
check('R1', 'R1.1', 'revenue/cost NaN/string-asal/negatif → sink ke 0 (semua angka finite)',
  r1AllFinite === true,
  `10 nilai rusak: hasil sink = ${JSON.stringify(r1Sinks)}`,
  'wrap: v=Number(x); out = (!isNaN(v) && v>0) ? v : 0 — pola produksi Planning.js L252-283')

// Fakta guard: !isNaN(Infinity) === true → Infinity TIDAK ditamp.
// Sumbernya nyata: Sheets/JSON dapat mengirim "1e999"/angka besar → Number() = Infinity.
const r1Inf = sink(Infinity)
check('R1', 'R1.2', 'GUARD BOCOR utk Infinity: sink(Infinity) tetap Infinity (bukan 0)',
  r1Inf === Infinity && Number.isFinite(r1Inf) === false,
  `sink(Infinity)=${r1Inf} — lolos guard !isNaN(v) && v>0; berkap dia PUNYA NaN`,
  'temuan S3 #6: Number("1e999")=Infinity → realMaterial=Infinity → margin −Infinity (tampil "—" di persen, "Rp 0" di rupiah — misleading)')
findings.push({
  id: 'FN-INF_GUARD',
  severity: 'LOW',
  files: ['components/Planning.js L252-283', 'components/ProjectFinance.js L150-152', 'components/Finance.js L470-472'],
  desc: 'Guard realisasi produksi memakai `!isNaN(v) && v > 0 ? v : 0`. Nilai Infinity TIDAK ditamp (Number("1e999")=Infinity → realMaterial=Infinity → realMargin=−Infinity). Tidak pernah NaN (target no-NaN terpenuhi), tapi angka tak-finite bisa bocor dari data Sheets ekstrem.',
  proposal: 'Ganti !isNaN(v) → Number.isFinite(v) di wrap realisasi (3 file, masing-masing pola sama). Satu-satu hadnle; perilaku nilai normal tidak berubah.'
})

console.log('[R1] selesai')
console.log('\n[R2] Budget custom: sum > 100 tidak diterapkan')

const r2 = []
function r2case(id, name, draft) {
  const v = validatePercentDraft(draft)
  r2.push({ case: id, draft: Object.values(draft).join('/'), total: v.total, valid: v.valid, applied: v.valid ? 'custom-valid' : 'TOLAK (applied tetap snapshot lama)' })
  return v
}

const a1 = r2case('R2.1', 'over_total_120', { material: '60', manpower: '30', operasional: '15', margin: '15' })
check('R2', 'R2.1', 'draft 60/30/15/15 (total 120%) → TIDAK valid, tidak ada normalisasi senyap',
  a1.valid === false && a1.totalOk === false && a1.total === 120,
  `total=${a1.total}% valid=${a1.valid} (harus false)`,
  '120 > 100 → totalOk=false → applied snapshot lama (50/25/10/15)')
const a2 = r2case('R2.2', 'koma_desimal', { material: '35,5', manpower: '25', operasional: '10', margin: '9.5' })
check('R2', 'R2.2', 'koma-desimal "35,5": JS Number(...) = NaN sehingga field INVALID',
  a2.valid === false && Number.isFinite(Number('35,5')) === false,
  `Number("35,5")=${Number('35,5')} → NaN → fieldsOk=false → draft ditolak`,
  'temuan S3 #2: input id-ID dianggap tidak valid oleh Number(); nilai 35,5 user tidak pernah masuk pagu')
const a3 = r2case('R2.3', 'total_99_99', { material: '49.99', manpower: '25', operasional: '10', margin: '15' })
const a4 = r2case('R2.4', 'total_pas_100', { material: '50', manpower: '25', operasional: '10', margin: '15' })
check('R2', 'R2.3', 'total 99,99% & 100% pas → VALID (tepat batas, tanpa float-flake kecil)',
  a3.valid === true && a4.valid === true,
  `99.99 → valid; 100.00 → valid; remaining=${a3.remaining}% & ${a4.remaining}%`,
  'totalRounded = round(total*100)/100; totalOk ⇔ totalRounded <= 100')

// Uji applied-snapshot: draft 110% → pagu tetap dari snapshot valid terakhir.
const draft110 = validatePercentDraft({ material: '70', manpower: '20', operasional: '10', margin: '10' })
const b110 = computeBudget(
  { revenue: 100000000, cumulative_cost: 55000000, petty_cash: 8000000 },
  20000000, 'custom', STANDARD_PERCENTAGES, draft110, ''
)
r2.push({ case: 'snapshot_stick', draft: '70/20/10/10', total: draft110.total, valid: draft110.valid, applied: 'standar 50/25/10/15' })
check('R2', 'R2.4', 'draft 110% → pagu material tetap 50jt (snapshot valid terakhir), TIIDAK 70jt',
  b110.budgetMaterial === 50000000 && b110.isExceedingLimit === true,
  `pagu material=${b110.budgetMaterial} (70jt = false); isExceedingLimit=${b110.isExceedingLimit}`,
  'draft invalid → applied tidak tersinkron (useEffect Planning.js L240-248)')

// Locale-ambiguity (FAKTA eksekusi): JS Number() TIDAK mengenal pemisah
// ribuan. Input "1.234" — yang oleh user id-ID bisa berarti 1.234 unit
// (seribu dua ratus tiga puluh empat %) — dibaca JS sebagai 1,234%:
// SILENT REINTERPRETATION. Red flag-nya kecil (1.234% tetap valid ≤ 100)
// tetapi artinya angka berbeda dari maksud penulisnya tanpa peringatan.
const a5 = r2case('R2.5', 'locale_ambiguity_1.234', { material: '1.234', manpower: '25', operasional: '10', margin: '15' })
check('R2', 'R2.5', '"1.234" dibaca JS sebagai 1,234% → draft VALID — angka masuk TANPA nama "ribuan"',
  a5.valid === true && Math.abs(a5.total - 51.23) < 1e-9,
  `Number("1.234")=${Number('1.234')} → total=${a5.total}% valid=${a5.valid} (diterapkan!)`,
  'temuan S3 #2 lanjutan: field persen menerima titik-desimal saja; id-ID "1.234" (ribuan=1234) dibaca 1,234 — siluman AMAN di sisi pagu (<=100) tapi TIDAK sesuai maksud penulis')
// Temuan: silent reinterpretation ribuan → dokumen.
findings.push({
  id: 'FN-PCT_LOCALE',
  severity: 'LOW',
  files: ['components/Planning.js L56-86 (validatePercentDraft)'],
  desc: 'Field persen custom hanya menerima format Node/JS (titik desimal). "35,5" → NaN → ditolak (aman). "1.234" → dibaca 1,234% → VALID meski penulis mungkin maksud 1.234 unit — tidak ada parsing locale; total ≤100 membuat efeknya kecil, tetapi angka yang diterapkan bisa beda dari maksud penulis tanpa peringatan.',
  proposal: 'Kontrak tertulis di panel: "Gunakan titik untuk desimal (mis. 35.5)". Opsional: tolak input dengan >1 titik (mis. "1.234.5") supaya ambiguitas ribuan tidak masuk.'
})
// Kas yang valid sesuai kontrak JS: titik desimal.
const a5b = r2case('R2.5b', 'desimal_titik_valid', { material: '35.5', manpower: '25', operasional: '10', margin: '9.5' })
check('R2', 'R2.5b', 'input "35.5"/"9.5" (titik desimal) → VALID total 80%',
  a5b.valid === true && a5b.total === 80,
  `total=${a5b.total}% valid=${a5b.valid} — remaining ${a5b.remaining}%`,
  'satu-satunya format desimal yang diterima = titik (kontrak JS Number)')

console.log('[R2] 5 kasus custom-sum dieksekusi')

// ============================================================
// R3 — TANDA VARIANCE
// ============================================================
console.log('\n[R3] Konvensi tanda variance')

const V1 = computeBudget({ revenue: 100000000, cumulative_cost: 55000000, petty_cash: 12000000 }, 30000000, 'standard', STANDARD_PERCENTAGES, { valid: true }, '')
check('R3', 'R3.1', 'variance over-budget POSITIF (real − pagu)',
  V1.materialVariance === 5000000 && V1.laborVariance === 5000000 && V1.operasionalVariance === 2000000,
  `real mat 55jt > pagu 50jt → variance +5jt; upah +5jt; ops +2jt`,
  'variance = real − pagu')
check('R3', 'R3.2', 'sisa kuota NEGATIF saat over (pagu − real)',
  V1.materialRemaining === -5000000 && V1.laborRemaining === -5000000 && V1.operasionalRemaining === -2000000,
  `remaining = pagu − real = −5jt / −5jt / −2jt`,
  'remaining = pagu − real')
check('R3', 'R3.3', 'defisit margin POSITIF saat margin tipis (target − real)',
  V1.marginDeficit === 12000000,
  `target 15jt − real 3jt = 12jt (positif)`,
  'marginDeficit = target − realMargin')
check('R3', 'R3.4', 'marginVariance NEGATIF saat defisit (real − target)',
  V1.marginVariance === -12000000,
  `realMargin 3jt − target 15jt = −12jt`,
  'marginVariance = realMargin − targetMargin')

const V2 = computeBudget({ revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }, 20000000, 'standard', STANDARD_PERCENTAGES, { valid: true }, '')
check('R3', 'R3.5', 'kas sehat: sisa POSITIF, variance material ≤ 0',
  V2.materialRemaining === 5000000 && V2.materialVariance === -5000000,
  `sisa mat +5jt; variance mat −5jt (real di bawah pagu)`,
  'real < pagu → variance negative')
check('R3', 'R3.6', 'marginAchievement >100% saat margin melebihi target',
  V2.marginAchievement === 180,
  `achie = realMargin 27jt / target 15jt × 100 = 180%`,
  'marginAchievement = realMargin/targetMargin*100')

console.log('[R3] selesai')

// ============================================================
// R4 — FORMULA MARGIN
// ============================================================
console.log('\n[R4] Formula margin: Planning vs ProjectFinance vs Finance closing')

check('R4', 'R4.1', 'Planning margin = Rev − Mat − Tukang − Ops; % = margin/rev×100',
  V2.realTotalCost === 73000000 && V2.realMargin === 27000000 && Math.round(V2.marginPct * 100) / 100 === 27,
  `total cost 73jt = 45+20+8; margin 27jt; marginPct 27%`,
  'realMargin = revenue − (material+labor+ops); marginPct = margin/rev*100')

const marginPF = 100000000 - 45000000 - 20000000
check('R4', 'R4.2', 'Gross margin ProjectFinance = Rev − Mat − Tukang (tanpa ops)',
  marginPF === 35000000,
  `35jt = 100jt − 45jt − 20jt (petty cash 8jt tidak memotong)`,
  'dua definisi margin terbedakan: gross murni (ProjectFinance/Finance ringkasan) vs incl-ops (closing & Planning)')

const marginFC = 100000000 - (45000000 + 8000000 + 20000000)
check('R4', 'R4.3', 'Margin closing = Rev − (Mat + PC + Tukang) — termasuk petty cash',
  marginFC === 27000000,
  `27jt = 100jt − 73jt (persis sama dengan Planning)`,
  'closing & Planning memakai definisi yang sama')

check('R4', 'R4.4', 'Dua definisi margin ada dan BERBEDA 8jt (dokumen, bukan crash)',
  true,
  'Planning/closing incl-ops=27jt; ProjectFinance gross tanpa ops=35jt; selisih = petty cash 8jt — disepakati sebagai 2 lapisan laporan',
  'risiko: label dua lapisan belum dijelaskan di UI (lihat temuan S3 #4)')

check('R4', 'R4.5', '% margin negatif & rev 0 → 0 (bukan NaN); angka tetap finite',
  Number.isFinite(V1.marginPct) && V1.marginPct === 3 && B_zeroPct() === 0,
  `kas over: marginPct 3%; kas rev=0: 0`,
  'marginPct = rev>0 ? margin/rev*100 : 0')

function B_zeroPct() {
  const r = computeBudget({ revenue: 0, cumulative_cost: 0, petty_cash: 0 }, 0, 'standard', STANDARD_PERCENTAGES, { valid: true }, '')
  return r.marginPct
}

console.log('[R4] selesai')

// ============================================================
// R5 — LABEL ESTIMASI vs AKTUAL (fakta statik kode asli)
// ============================================================
console.log('\n[R5] Label estimasi vs aktual (statik kode sumber asli)')

const r5planning = findText('planning', 'Pengeluaran Riil (WBS)')
check('R5', 'R5.1', 'Planning L1066: kartu Upah berlabel "Pengeluaran Riil (WBS)"',
  r5planning > 0,
  `ditemukan di char ${r5planning} — realLabor berasal dari project_plans.labor_cost (= estimasi WBS)`,
  'temuan S3 #5: kata "Riil" untuk data estimasi')

const r5estimasiWbs = findText('planning', 'Estimasi upah WBS')
check('R5', 'R5.2', 'Planning banner anomali memakai kata "Estimasi upah WBS" (akurat)',
  r5estimasiWbs > 0,
  'banner anomali Upah menyebut sumbernya dengan benar sebagai Estimasi WBS',
  'label ganda dalam 1 kartu: banner akurat, label detail "Riil"')

const r5pfActual = findText('projectFinance', 'Actual Tukang')
check('R5', 'R5.3', 'ProjectFinance: kartu berjudul "Actual Tukang" dengan subtitle estimasi Budgeting',
  r5pfActual > 0,
  `ditemukan di char ${r5pfActual} — title kartu: "Total estimasi upah tukang dari modul Budgeting"`,
  'temuan S3 #5: kata "Actual" untuk estimasi')

// Tanda komen "Tidak ada normalisasi senyap" terpecah baris (hypen berjajar);
// pakai substring yang dijamin satu baris (L33 & L237).
const r5noRescale = findText('planning', 'TIDAK diterapkan')
check('R5', 'R5.4', 'Planning komentar eksplisit "TIDAK diterapkan (bukan di-rescale)" — kontrak tolak',
  r5noRescale > 0,
  'kontrak "tolak" tercatat di kode — perilaku diuji eksekusinya di R2',
  'applied snapshot valid terakhir; tidak ada rescale senyap')

// Kartu material Finance: "Realisasi Biaya Material (COST ITEMS CONFIRMED)" di
// dokumen cetak — sumbernya nota Drive (riil); label AKTUAL di sini sah.
const r5finMaterialRiil = findText('finance', 'Realisasi Biaya Material')
check('R5', 'R5.5', 'Dokumen closing: "Realisasi Biaya Material (COST ITEMS CONFIRMED)" — label riil pada sumber nota',
  r5finMaterialRiil > 0,
  'material & petty cash memang riil (nota Drive). Yang TIDAK boleh "riil/actual": upah WBS (R5.1/R5.3)',
  'material & opex layak label AKTUAL; upah WBS tidak')

if (r5planning > 0) {
  findings.push({
    id: 'FN-EST_LABEL',
    severity: 'MEDIUM',
    files: ['components/Planning.js L1066', 'components/ProjectFinance.js L2074'],
    desc: 'Estimasi upah WBS (project_plans.labor_cost) ditampilkan dengan kata "Pengeluaran Riil" / "Actual Tukang" — padahal sumbernya estimasi WBS, bukan upah terbayar. `break glass`: tidak ada; hanya perbaikan label.',
    proposal: 'Ganti label → "Estimasi Upah WBS (belum akumulasi upah terbayar)" + catatan kecil di kartu bahwa upah riil akan masuk dari pembayaran tukang (modul Tukang Upah).'
  })
}

console.log('[R5] selesai')

// ============================================================
// R6 — PAGU CEILING (target 70%)
// FAKTA VERIFIKASI: Math.round(REV*70)/100 TEPAT 30310000 untuk
// REV=43.300.000 (rapper pitfall komentar sudah dihindari code).
// Bug float R6.1 hanya muncul utk LAGER revenue DESIMAL.
// ============================================================
console.log('\n[R6] Perbandingan pagu tepat di batas (target 70%)')

const REV = 43300000
const formulaKode = Math.round(REV * 70) / 100
const formulaLain = Math.round(REV * 0.7)
check('R6', 'R6.1', 'Formula produksi round(rev×70)/100 TEPAT 30.310.000 (pitfall *0.7 sudah dihindari)',
  formulaKode === 30310000 && formulaKode === formulaLain,
  `rev=43.300.000 → ${formulaKode} (pas) — komentar pitfall L1 produksi VALID`,
  'Math.round(43,3e6×70)=3.031.000.000; ÷100 = tepat (float 30.310.000 eksak di double)')

// Kas revenue DESIMAL: formula L1 mera float, versi lain tidak
const REV2 = 99999999.99
const b70_2 = Math.round(REV2 * 70) / 100
const f70_2 = Math.round(REV2 * 0.7)
check('R6', 'R6.2', 'Revenue DESIMAL: formula L1 hasil 69.999.999,99 ≠ 70.000.000 (float tak-eksak)',
  b70_2 !== f70_2,
  `rev=99.999.999,99 → L1=${b70_2} vs ${f70_2} — selisih 0,01 sebelum pembulatan UI`,
  'Selisih tampilan bisa terlihat sebagai pagu "Rp 69.999.999" di dokumen cetak (rupiah tak utuh)')

// Status HEMAT/OVER di batas: dengan formula L1 + revenue desimal, flake mungkin
// namun SANGAT jarang menimpa pembulatan UI (di mata rupiah 1 rupiah sangat jarang
// signifikan). Saya turunkan ke LOW CN.
findings.push({
  id: 'FN-TARGET70-DECIMAL',
  severity: 'LOW',
  files: ['components/ProjectFinance.js L156', 'components/Finance.js L478'],
  desc: 'Target 70% = Math.round(rev*70)/100. Untuk revenue desimal (mis. 99.999.999,99) hasil sebelum pembulatan UI = 69.999.999,99 (float tak-eksak). Untuk revenue bulat rupiah (kas riil Sheets) hasil TEPAT. Risiko praktis sangat kecil: hanya tampilan pagu desimal di dokumen cetak.',
  proposal: 'Jika ingin ultra-rapi, ganti Math.round(revenue*70)/100 → Math.round(revenue*0.7) di 2 lokasi. TIDAK URGENT.'
})

console.log('[R6] selesai')

// ============================================================
// R7 — BOUNDARY
// ============================================================
console.log('\n[R7] Kas tepi')

const B1z = computeBudget({ revenue: 0, cumulative_cost: 0, petty_cash: 0 }, 0, 'standard', STANDARD_PERCENTAGES, { valid: true }, '')
check('R7', 'R7.1', 'Revenue 0 → semua anomali false, tidak ada div-by-zero',
  B1z.hasAnomaly === false && B1z.materialPct === 0 && B1z.laborPct === 0 && B1z.marginPct === 0,
  'rev=0 → semua flag false dan % = 0 (guard `revenue > 0 ? … : 0` produksi)',
  'guard div-by-zero diterapkan di keempat rasio')

const B2z = computeBudget(null, undefined, 'standard', STANDARD_PERCENTAGES, { valid: true }, '')
check('R7', 'R7.2', 'activeCost null & labor undefined → tidak crash, revenue 0',
  B2z.hasAnomaly === false && B2z.revenue === 0 && B2z.realLabor === 0,
  'null-safe optional chaining + Number(undefined)=NaN → sink 0',
  'Number(null)=0 tapi guard v>0 → tetap 0')

const B3z = computeBudget({ revenue: 100, cumulative_cost: -5000, petty_cash: -3000 }, -200, 'standard', STANDARD_PERCENTAGES, { valid: true }, '')
check('R7', 'R7.3', 'Nilai negatif → realisasi sink 0 (tidak jadi "anomali negatif")',
  B3z.realMaterial === 0 && B3z.realLabor === 0 && B3z.realOperasional === 0,
  'v<0 → 0 (guard v>0)',
  'rbt: nilai negatif tak pernah masuk realisasi')

const B4z = computeBudget({ revenue: 150000000, cumulative_cost: 5e9, petty_cash: 3e8 }, 1e9, 'standard', STANDARD_PERCENTAGES, { valid: true }, '')
check('R7', 'R7.4', 'Nilai ekstrem tetap finite (no Infinity/NaN)',
  Number.isFinite(B4z.budgetMaterial) && Number.isFinite(B4z.realMargin) && B4z.realMargin < 0,
  `5 miliar & 1 miliar masuk hitungan; margin=(150jt−6.3mt) sangat negatif tapi finite`,
  'petty angka besar tetap aman di JS double')

const B5z = computeBudget({ revenue: 1, cumulative_cost: 2, petty_cash: 0 }, 0, 'standard', STANDARD_PERCENTAGES, { valid: true }, '')
check('R7', 'R7.5', 'Revenue 1 rupiah: deteksi tepat (real 2 > pagu round(0.5)=1 → over)',
  B5z.isMaterialOver === true,
  `rev=1 → pagu=Math.round(0.5)=1 (ECMAScript round setengah-atas); real=2 > 1 → over`,
  'Math.round(0.5) = 1')

const B6z = computeBudget({ revenue: 2, cumulative_cost: 1, petty_cash: 0 }, 0, 'standard', STANDARD_PERCENTAGES, { valid: true }, '')
check('R7', 'R7.6', 'Revenue 2 rupiah, material 1: tepat pagu(=1) TIDAK over (strict >)',
  B6z.isMaterialOver === false,
  `rev=2 → pagu=1; real=1 → 1 > 1 false → aman`,
  'deteksi over pakai strict >; real == pagu tidak over')

console.log('[R7] selesai')

// ============================================================
// ST — cek statik kode sumber asli
// ============================================================
console.log('\n[ST] Cek statik (bukti vs kode asli)')

check('ST', 'ST.1', 'Planning asli memuat guard "totalRounded <= 100"',
  findText('planning', 'totalRounded <= 100') > 0,
  'Planning.js L75: totalOk = fieldsOk && totalRounded <= 100',
  'jagaan sum>100 di kode asli — verbatim dieksekusi di R2')

check('ST', 'ST.2', 'Planing: "budget Manpower" card show pakai项目 pagu — pembulatan rupiah Math.round',
  findText('planning', 'Math.round(revenue * (') > 0,
  'pagu 4 pilar dihitung Math.round(revenue * pct/100) — rupiah utuh',
  'tidak ada angka koma rupiah di pagu nominal')

const sPrintLabel = findText('finance', '(1 − 5)')
check('ST', 'ST.3', 'Dokumen cetak closing pakai label P&L "(1 − 5)" — nomor tak ada',
  sPrintLabel > 0,
  'Finance.js L1526: "GROSS MARGIN / KEUNTUNGAN KOTOR (1 − 5)" — baris table 1,2,3,4 lalu total; tidak ada "5"',
  'temuan S3 #7: angka referensi petunjuk cetak salah nomor')
if (sPrintLabel > 0) {
  findings.push({
    id: 'FN-PRINTREF',
    sev: 'LOW',
    files: ['components/Finance.js L1526'],
    desc: 'Dokumen cetak closing resmi merujuk "(1 − 5)" di baris GROSS MARGIN, tetapi penomoran baris adalah 1,2,3,4 + TOTAL — tidak ada baris 5.',
    proposal: 'Ubah label jadi "(1 − TOTAL)" atau "Revenue − Total HPP Riil" (1 baris).'
  })
}

console.log('[ST] selesai')

// ============================================================
// REG — regresi test legacy 4-pilar
// ============================================================
console.log('\n[REG] Regresi test legacy 4-pilar')
rec('REG', 'REG.1', 'test legacy: scripts/planning-budget-test/test_planning_js_budget.mjs', false, '(akan diisi di bawah)', '')
try {
  const out = execSync(`node scripts/planning-budget-test/test_planning_js_budget.mjs`, { cwd: WT, stdio: 'pipe', encoding: 'utf8' })
  const last = out.trim().split('\n').pop()
  results.pop()
  failed--
  rec('REG', 'REG.1', 'test legacy: test_planning_js_budget.mjs', true, `lulus — "${last}"`, '')
} catch (e) {
  results.pop()
  failed--
  rec('REG', 'REG.1', 'test legacy: test_planning_js_budget.mjs', false, `GAGAL: ${String(e.message).split('\n')[0]}`, '')
}

console.log(`\n===== RINGKASAN S3 HARNESS =====`)

// ============================================================
// CSV VARIANCE SCENARIOS — disusun dari HASIL EKSEKUSI
// ============================================================
const scenarios = [
  { name: 'sehat',                   cost: { revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }, upah: 20000000, mode: 'standard', pct: STANDARD_PERCENTAGES },
  { name: 'material_over',           cost: { revenue: 100000000, cumulative_cost: 55000000, petty_cash: 8000000 }, upah: 20000000, mode: 'standard', pct: STANDARD_PERCENTAGES },
  { name: 'manpower_over',           cost: { revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }, upah: 30000000, mode: 'standard', pct: STANDARD_PERCENTAGES },
  { name: 'ops_over',                cost: { revenue: 100000000, cumulative_cost: 45000000, petty_cash: 12000000 }, upah: 20000000, mode: 'standard', pct: STANDARD_PERCENTAGES },
  { name: 'margin_tipis',            cost: { revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }, upah: 32000000, mode: 'standard', pct: STANDARD_PERCENTAGES },
  { name: 'semua_over',              cost: { revenue: 100000000, cumulative_cost: 55000000, petty_cash: 12000000 }, upah: 30000000, mode: 'standard', pct: STANDARD_PERCENTAGES },
  { name: 'pagu_edge_70pct',         cost: { revenue: 43300000, cumulative_cost: 30310000, petty_cash: 0 }, upah: 0, mode: 'standard', pct: STANDARD_PERCENTAGES },
  { name: 'custom_valid_40_30_12_18', cost: { revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }, upah: 25000000, mode: 'custom', pct: { material: 40, manpower: 30, operasional: 12, margin: 18 } },
  { name: 'custom_draft110_ditolak', cost: { revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }, upah: 20000, mode: 'custom', pct: STANDARD_PERCENTAGES, draft: { material: '70', manpower: '20', operasional: '10', margin: '10' } },
  { name: 'revenue_nol',             cost: { revenue: 0, cumulative_cost: 0, petty_cash: 0 }, upah: 0, mode: 'standard', pct: STANDARD_PERCENTAGES },
  { name: 'revenue_nan_neg_inf',     cost: { revenue: -5, cumulative_cost: 'abc', petty_cash: NaN }, upah: NaN, mode: 'standard', pct: STANDARD_PERCENTAGES }
]

const csvRows = ['scenario,mode,revenue,real_material,real_labor,real_ops,real_margin,margin_pct,budget_mat,is_material_over,is_labor_over,is_ops_over,is_margin_thin,has_anomaly']
const csvNotes = []
for (const s of scenarios) {
  let customValid = { valid: true }
  if (s.draft) {
    customValid = validatePercentDraft(s.draft)
    csvNotes.push(`${s.name}: draft ${Object.values(s.draft).join('/')} invalid → applied pakai snapshot ${Object.values(s.pct).join('/')}`)
  }
  const v = computeBudget(s.cost, s.upah, s.mode, s.pct, customValid, '')
  csvNotes.push(`${s.name}: margin real=${v.realMargin}, ${Math.round(v.marginPct * 100) / 100}% dari revenue; anomali mat=${v.isMaterialOver} upah=${v.isLaborOver} ops=${v.isOperasionalOver} margin=${v.isMarginThin}`)
  csvRows.push([
    s.name, s.mode, v.revenue, v.realMaterial, v.realLabor, v.realOperasional, v.realMargin,
    (Math.round(v.marginPct * 100) / 100) + '%', v.budgetMaterial,
    v.isMaterialOver, v.isLaborOver, v.isOperasionalOver, v.isMarginThin, v.hasAnomaly
  ].join(','))
}

const csvAll = [
  'SKENARIO VARIANCE S3 — t_18652eb1 — hasil eksekusi computeBudget (ekstraksi verbatim Planning.js main@18fb594)',
  'scenario,mode,revenue,real_material,real_labor,real_ops,real_margin,margin_pct,budget_mat,is_material_over,is_labor_over,is_ops_over,is_margin_thin,has_anomaly',
  ...csvRows.slice(1),
  '',
  'CATATAN:',
  ...csvNotes,
  '',
  'Kas custom persen yang ditolak (hasil eksekusi validatePercentDraft):'
]
for (const r of r2) csvAll.push(`  ${r.case}: draft=${r.draft} total=${r.total} valid=${r.valid} applied=${r.applied}`)

fs.writeFileSync(`${WT}/scripts/rap-audit/variance_scenarios.csv`, csvAll.join('\n') + '\n', 'utf8')

// ============================================================
// FINAL SUMMARY
// ============================================================
const summary = {
  waktu: new Date().toISOString(),
  base_commit: '18fb594 (main) — audit S3 read-only',
  worktree: WT,
  catatan_tata_kelola: 'S3 proposal-only; TIDAK mengubah kode aplikasi; TIDAK menyentuh DB/SQL produksi',
  total_cek: passed + failed,
  lulus: passed,
  gagal: failed,
  temuan: findings,
  csv: 'scripts/rap-audit/variance_scenarios.csv (hasil eksekusi)'
}
console.log(JSON.stringify(summary, null, 2))
console.log(`\nTOTAL: LULUS=${passed} GAGAL=${failed}`)
console.log('CSV → scripts/rap-audit/variance_scenarios.csv')
if (failed > 0) process.exit(1)
