// ============================================================
// S3-RECOVERY — Bit (t_18652eb1) — FIXTURE NEGATIF TAMBAHAN
// Base: integration HEAD 1d364e7 (worktree wt-s3-rap-recovery)
//
// TUJUAN: (a) menguji kas tepi yang BELUM diuji WIP bandeng, dan
// (b) menguji ULANG klaim temuan WIP terhadap kode asli di base
// integrasi (bukan base lama main@18fb594).
//
// SEMANTIK LAPOR (preserve test intent):
//   kind = 'expect_ok'  → assertion harus BENAR. Jika false = bug
//        yang membuat kapabilitas hilang → dicatat sebagai temuan.
//   kind = 'expect_defect' → assertion membuktikan cacat ADA.
//        Jika assertion benar = cacat TERKONFIRMASI → dicatat
//        sebagai temuan. Jika assertion salah = cacat TIDAK ada.
//
//   "expected missing capability" != "passed business acceptance":
//   probe expect_defect yang lulus BUKAN bukti sistem sehat; itu
//   justru bukti ada celah. Skrip exit 0 saat semua probe
//   dieksekusi sampai selesai — temuan dilaporkan, bukan
//   disembunyikan dengan exit code.
// ============================================================
import fs from 'node:fs'

const WT = process.env.S3_WT || '/home/ubuntu/dev-workspaces/wt-s3-rap-recovery'

const results = []
const confirmed = []   // cacat yang assertion-nya TERBUKTI
const unmet = []       // kapabilitas yang seharusnya ada tapi tidak

function rec(id, name, kind, ok, detail, math) {
  results.push({ id, name, kind, ok: !!ok, detail, math })
  const mark = ok ? '✓' : '✗'
  const tag = kind === 'expect_defect'
    ? (ok ? 'CACAT-TERKONFIRMASI' : 'cacat-tidak-terbukti')
    : (ok ? 'terpenuhi' : 'KAPABILITAS-HILANG')
  console.log(`  ${mark} ${id} [${tag}] — ${detail}`)
  if (kind === 'expect_defect' && ok) confirmed.push({ id, name, detail, math })
  if (kind === 'expect_ok' && !ok) unmet.push({ id, name, detail, math })
}

console.log('[S3-NEG] Fixture negatif tambahan — base integration HEAD 1d364e7')
console.log('[S3-NEG] Membaca kode asli dari:', WT)

const PROD = {
  planning: fs.readFileSync(`${WT}/components/Planning.js`, 'utf8'),
  projectFinance: fs.readFileSync(`${WT}/components/ProjectFinance.js`, 'utf8'),
  finance: fs.readFileSync(`${WT}/components/Finance.js`, 'utf8')
}

// ============================================================
// N1 — GUARD INFINITY: klaim WIP FN-INF_GUARD diverifikasi
//      terhadap IDIOM NYATA di base integrasi.
//      WIP menyebut 3 file memakai `!isNaN(v) && v > 0`.
// ============================================================
console.log('\n[N1] Guard Infinity — verifikasi klaim FN-INF_GUARD')

// Idiom 1 — Planning.js L253/277/280/283 (diverifikasi via grep)
const guardPlanning = (v) => {
  const n = Number(v)
  return !isNaN(n) && n > 0 ? n : 0
}
// Idiom 2 — ProjectFinance.js L150-152 / Finance.js L470-472 (diverifikasi via grep)
const guardOrZero = (v) => Number(v) || 0

rec('N1.1', 'Planning.js idiom !isNaN&&>0 TIDAK menahan Infinity', 'expect_defect',
  guardPlanning('1e999') === Infinity,
  `guardPlanning("1e999")=Infinity — !isNaN(Infinity)===true dan Infinity>0===true → lolos guard`,
  'FN-INF_GUARD TERKONFIRMASI untuk Planning.js saja (4 lokasi: L253, L277, L280, L283)')

rec('N1.2', 'ProjectFinance/Finance idiom Number(x)||0 JUGA tidak menahan Infinity', 'expect_defect',
  guardOrZero('1e999') === Infinity,
  `guardOrZero("1e999")=Infinity — Infinity truthy → lolos || 0`,
  'FN-INF_GUARD berlaku untuk 3 file, TAPI idiom-nya beda dari klaim WIP')

const pfUsesIsnan = /!isNaN\([^)]*\)\s*&&\s*\w+\s*>\s*0\s*\?/.test(PROD.projectFinance)
const finUsesIsnan = /!isNaN\([^)]*\)\s*&&\s*\w+\s*>\s*0\s*\?/.test(PROD.finance)
rec('N1.3', 'Klaim WIP "ProjectFinance/Finance pakai !isNaN(v)&&v>0" — akurasi file citation', 'expect_ok',
  pfUsesIsnan === false && finUsesIsnan === false,
  `ProjectFinance memakai !isNaN&&>0: ${pfUsesIsnan}; Finance: ${finUsesIsnan} — keduanya false`,
  'KOREKSI temuan WIP: citation FN-INF_GUARD harus menyebut Number(x)||0 untuk ProjectFinance L150-152 & Finance L470-472, bukan !isNaN&&>0')

// ============================================================
// N2 — DAMPAK Infinity ke margin: bisakah angka tak-finite
//      benar-benar mencapai layar? (uji, bukan asumsi)
// ============================================================
console.log('\n[N2] Dampak Infinity ke perhitungan margin')

const revenue = 100000000
const marginPlanning = revenue - (guardPlanning('1e999') + 0 + 0)
const marginPf = revenue - (guardOrZero('1e999') + 0)

rec('N2.1', 'Infinity pada realisasi material → margin −Infinity (Planning & ProjectFinance)', 'expect_defect',
  marginPlanning === -Infinity && marginPf === -Infinity,
  `margin Planning=${marginPlanning}; margin ProjectFinance=${marginPf}`,
  'Konsekuensi FN-INF_GUARD: margin negatif tak-finite; tampilan bergantung format')

const rupiahUses = /toLocaleString\('id-ID'/.test(PROD.finance)
rec('N2.2', 'Fakta pemformatan: Finance memakai toLocaleString("id-ID") untuk rupiah', 'expect_ok',
  rupiahUses === true,
  `toLocaleString("id-ID") ditemukan di Finance.js: ${rupiahUses}`,
  'Infinity.toLocaleString("id-ID") = "∞" — karakter non-angka bisa masuk kolom uang dokumen closing')

// ============================================================
// N3 — NEGATIF: revenue Infinity (kas tepi WIP belum menguji)
// ============================================================
console.log('\n[N3] Revenue Infinity — kas tepi yang belum diuji WIP')

const revInf = guardPlanning('1e999')
const budgetMatFromInf = Math.round(revInf * (50 / 100))
rec('N3.1', 'Revenue Infinity → pagu material Infinity → isMaterialOver SELALU false', 'expect_defect',
  budgetMatFromInf === Infinity,
  `budgetMaterial=Math.round(Infinity*0.5)=${budgetMatFromInf}; real(finite) > Infinity = false`,
  'Kas tepi BARU: revenue tak-finite mematikan SELURUH deteksi over-budget secara senyap (false negative)')

// ============================================================
// N4 — NEGATIF: string nominal gaya lokal id-ID
//      (WIP menguji "35,5" untuk PERSEN; belum untuk RUPIAH)
// ============================================================
console.log('\n[N4] Nominal rupiah bergaya Sheets/lokal')

// FAKTA EKSEKUSI (diverifikasi): Number("1.250.000") = NaN (dua titik),
// BUKAN 1.25. Satu titik ("1.250") = 1.25. Keduanya salah baca.
const parsedTwoDots = Number('1.250.000')
const parsedOneDot = Number('1.250')
rec('N4.1', 'Nominal "1.250.000" → Number() = NaN (guard menyink jadi 0)', 'expect_defect',
  Number.isNaN(parsedTwoDots),
  `Number("1.250.000")=${parsedTwoDots} — 2 titik ditolak JS; guard → 0`,
  'Kas tepi BARU (FN-RUPIAH_LOCALE): realisasi Rp 1.250.000 tampil sebagai Rp 0')

rec('N4.1b', 'Nominal "1.250" → Number() = 1,25 (3 orde magnitudo hilang, tanpa error)', 'expect_defect',
  parsedOneDot === 1.25,
  `Number("1.250")=${parsedOneDot} — desimal JS vs maksud ribuan id-ID`,
  'FN-RUPIAH_LOCALE lanjutan: satu titik dibaca desimal; penulis id-ID maksud ribuan')

// Repo sudah punya idiom strip-digit yang benar — tapi tidak dipakai di guard realisasi
const digitsOnly = (v) => {
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d ? Number(d) : 0
}
rec('N4.2', 'Idiom digitsOnly (strip non-digit) membacanya benar 1.250.000', 'expect_ok',
  digitsOnly('1.250.000') === 1250000,
  `digitsOnly("1.250.000")=${digitsOnly('1.250.000')}`,
  'Repo sudah punya idiom benar (Planning digitsOnly L76-79, Finance parseNominalFromNote L190-196) tapi TIDAK dipakai untuk guard realisasi Planning L253/277/280/283')

// ============================================================
// N5 — NEGATIF: whitespace/string pada guard
// ============================================================
console.log('\n[N5] Normalisasi string pada guard realisasi')

const strCases = ['  0  ', '', '0', ' ', 'null', 'undefined']
for (const raw of strCases) {
  console.log(`      ${JSON.stringify(raw).padEnd(12)} → Planning=${guardPlanning(raw)} | ProjFin/Finance=${guardOrZero(raw)}`)
}
rec('N5.1', 'String kosong/spasi/"null"/"undefined" → kedua guard sama-sama 0 (aman)', 'expect_ok',
  strCases.every(c => guardPlanning(c) === 0 && guardOrZero(c) === 0),
  'tidak ada NaN lolos dari keenam kasus',
  'target no-NaN terpenuhi di kedua idiom')

// ============================================================
// N6 — NEGATIF: custom draft TIPE salah (WIP hanya string)
// ============================================================
console.log('\n[N6] validatePercentDraft dengan tipe non-string')

// ekstrak validatePercentDraft asli (verbatim Planning L56-86) via rapMoney.js
const { validatePercentDraft, computeBudget } = await import('./rapMoney.js')

const n6 = validatePercentDraft({ material: 50, manpower: 25, operasional: 10, margin: 15 })
rec('N6.1', 'Draft angka (bukan string) 50/25/10/15 tetap VALID', 'expect_ok',
  n6.valid === true && n6.total === 100,
  `total=${n6.total} valid=${n6.valid} — String(raw) menormalkan angka`,
  'kontrak tipe longgar; tidak menghasilkan bug')

const n6b = validatePercentDraft({ material: null, manpower: undefined, operasional: '10', margin: 15 })
rec('N6.2', 'Draft null/undefined → INVALID (aman, tidak jadi 0 senyap)', 'expect_ok',
  n6b.valid === false,
  `fieldsOk=${n6b.fieldsOk} valid=${n6b.valid} — raw ?? '' → Number('') = NaN`,
  'aman: draft kosong ditolak, bukan diterapkan sebagai 0%')

rec('N6.3', 'Draft null (seluruh objek) → INVALID, tidak crash', 'expect_ok',
  validatePercentDraft(null).valid === false,
  `valid=${validatePercentDraft(null).valid}`,
  'null-safe (draft ? draft[f.key] : "")')

// ============================================================
// N7 — NEGATIF: custom mode dengan appliedPercentages rusak
//      (pagu Infinity/NaN dari snapshot sendiri)
// ============================================================
console.log('\n[N7] Mode custom dengan appliedPercentages tak-finite')

const n7 = computeBudget({ revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }, 20000000, 'custom', { material: Infinity, manpower: 25, operasional: 10, margin: 15 }, { valid: true }, '')
rec('N7.1', 'appliedPercentages.material=Infinity → budgetMaterial Infinity, real 45jt TIDAK over', 'expect_defect',
  n7.budgetMaterial === Infinity && n7.isMaterialOver === false,
  `budgetMaterial=${n7.budgetMaterial} isMaterialOver=${n7.isMaterialOver}`,
  'Kas tepi BARU: snapshot custom rusak mematikan deteksi over (45jt seharusnya > pagu 50jt → false negative)')

const n7b = computeBudget({ revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }, 20000000, 'custom', { material: NaN, manpower: 25, operasional: 10, margin: 15 }, { valid: true }, '')
rec('N7.2', 'appliedPercentages.material=NaN → budgetMaterial NaN, SEMUA flag false', 'expect_defect',
  Number.isNaN(n7b.budgetMaterial) && n7b.isMaterialOver === false && n7b.hasAnomaly === false,
  `budgetMaterial=${n7b.budgetMaterial} hasAnomaly=${n7b.hasAnomaly}`,
  'Kas tepi BARU: NaN pagu membuat SEMUA deteksi anomali mati — dashboard tampak "sehat" palsu')

// ============================================================
// N8 — NEGATIF: angka string persen dengan spasi/plus/sains
// ============================================================
console.log('\n[N8] Persen string dengan spasi, plus, notasi ilmiah')

rec('N8.1', '" 50 " (spasi) → VALID (trim diterapkan)', 'expect_ok',
  validatePercentDraft({ material: ' 50 ', manpower: '25', operasional: '10', margin: '15' }).valid === true,
  `total=${validatePercentDraft({ material: ' 50 ', manpower: '25', operasional: '10', margin: '15' }).total}`,
  'trim() ada di sumber — aman')

rec('N8.2', '"+50" (plus eksplisit) → VALID (Number menerima prefix +)', 'expect_defect',
  validatePercentDraft({ material: '+50', manpower: '25', operasional: '10', margin: '15' }).valid === true,
  `Number("+50")=${Number('+50')}`,
  'Rendah: variasi penulisan diterima; tidak ada batasan format di UI')

rec('N8.3', '"5e1" (notasi ilmiah) → dibaca 50 → VALID', 'expect_defect',
  (() => { const r = validatePercentDraft({ material: '5e1', manpower: '25', operasional: '10', margin: '15' }); return r.valid === true && r.total === 100 })(),
  `Number("5e1")=${Number('5e1')} total=100`,
  'Rendah: notasi ilmiah diterima sebagai persen; tidak ada batasan format di UI')

// ============================================================
// N9 — JEMBATAN: apakah klaim WIP FN-EST_LABEL masih berlaku
//      di base integrasi (bukan base lama)?
// ============================================================
console.log('\n[N9] Re-check klaim WIP terhadap base integrasi')

const pfActualTukang = PROD.projectFinance.indexOf('Actual Tukang')
rec('N9.1', 'FN-EST_LABEL masih berlaku: ProjectFinance "Actual Tukang" ada di base integrasi', 'expect_defect',
  pfActualTukang > 0,
  `ditemukan di char ${pfActualTukang} — ProjectFinance.js L228, title kartu "Total estimasi upah tukang dari modul Budgeting"`,
  'FN-EST_LABEL TERKONFIRMASI di base integrasi (belum diperbaiki)')

const planningRiil = PROD.planning.indexOf('Pengeluaran Riil (WBS)')
rec('N9.2', 'FN-EST_LABEL masih berlaku: Planning "Pengeluaran Riil (WBS)" ada di base integrasi', 'expect_defect',
  planningRiil > 0,
  `ditemukan di char ${planningRiil} — Planning.js L1066`,
  'FN-EST_LABEL TERKONFIRMASI di base integrasi (belum diperbaiki)')

const printRef = PROD.finance.indexOf('GROSS MARGIN / KEUNTUNGAN KOTOR (1 − 5)')
rec('N9.3', 'FN-PRINTREF masih berlaku: label "(1 − 5)" ada di base integrasi', 'expect_defect',
  printRef > 0,
  `ditemukan di char ${printRef} — Finance.js L1526`,
  'FN-PRINTREF TERKONFIRMASI di base integrasi (belum diperbaiki)')

const t70pf = PROD.projectFinance.indexOf('Math.round(revenue * 70) / 100')
rec('N9.4', 'FN-TARGET70-DECIMAL masih berlaku: Math.round(revenue*70)/100 ada di base integrasi', 'expect_defect',
  t70pf > 0,
  `ditemukan di char ${t70pf} — ProjectFinance.js L156 (identik Finance.js L478)`,
  'FN-TARGET70-DECIMAL TERKONFIRMASI di base integrasi (belum diperbaiki)')

// ============================================================
// RINGKASAN
// ============================================================
console.log('\n===== RINGKASAN FIXTURE NEGATIF S3 =====')
const total = results.length
const clean = results.filter(r => r.ok).length
console.log(`Total probe           : ${total}`)
console.log(`Assertion terpenuhi   : ${clean}`)
console.log(`Assertion tidak terpenuhi: ${total - clean}`)
console.log(`Cacat TERKONFIRMASI   : ${confirmed.length}`)
console.log(`Kapabilitas HILANG    : ${unmet.length}`)
console.log('\nCacat terkonfirmasi:')
for (const c of confirmed) console.log(`  - ${c.id} — ${c.name}`)

const summary = {
  waktu: new Date().toISOString(),
  base_commit: '1d364e7 (integration HEAD) — audit S3 read-only',
  worktree: WT,
  catatan_tata_kelola: 'S3 proposal-only; TIDAK mengubah kode aplikasi; TIDAK menyentuh DB/SQL produksi',
  cara_baca_hasil: 'expect_defect yang lulus = cacat TERBUKTI ADA (bukan sistem sehat). expect_ok yang gagal = kapabilitas hilang. Skrip exit 0 karena semua probe dieksekusi penuh; temuan dilaporkan di sini, bukan disembunyikan lewat exit code.',
  total_probe: total,
  assertion_terpenuhi: clean,
  assertion_tidak_terpenuhi: total - clean,
  cacat_terkonfirmasi: confirmed.map(c => c.id),
  kapabilitas_hilang: unmet.map(c => c.id),
  temuan: [
    ...confirmed.map(c => ({ id: c.id, nama: c.name, detail: c.detail, math: c.math })),
    ...unmet.map(c => ({ id: c.id, nama: c.name, detail: c.detail, math: c.math }))
  ],
  klaim_wip_diverifikasi: {
    FN_INF_GUARD: 'TERKONFIRMASI di 3 file; citation & idiom WIP perlu dikoreksi (ProjectFinance/Finance pakai Number(x)||0, bukan !isNaN&&>0) — lihat N1.1-N1.3',
    FN_EST_LABEL: 'TERKONFIRMASI masih berlaku di base integrasi — lihat N9.1, N9.2',
    FN_PRINTREF: 'TERKONFIRMASI masih berlaku di base integrasi — lihat N9.3',
    FN_TARGET70_DECIMAL: 'TERKONFIRMASI masih berlaku di base integrasi — lihat N9.4',
    FN_PCT_LOCALE: 'diuji ulang di harness utama R2 (dokumentasi perilaku, bukan crash)'
  },
  temuan_baru_beyond_wip: [
    'N3.1 — revenue tak-finite mematikan semua deteksi over-budget (false negative)',
    'N7.1 — appliedPercentages Infinity → pagu Infinity → deteksi over mati',
    'N7.2 — appliedPercentages NaN → SEMUA deteksi anomali mati, dashboard "sehat" palsu',
    'N4.1/N4.1b — nominal bergaya id-ID ("1.250.000"/"1.250") salah baca (0 / 1,25)',
    'N8.3 — notasi ilmiah "5e1" diterima sebagai persen'
  ],
  batasan_reachability: [
    'Reachability Infinity/NaN dari DB numeric BELUM terbukti: kolom numeric Postgres tidak menyimpan Infinity. Jalur nyata paling mungkin = payload JSON ekstrem atau nilai dari Sheets sebelum masuk DB. Tidak ada probe live DB di audit ini (read-only, tanpa kredensial).',
    'Reachability FN-RUPIAH_LOCALE BELUM terbukti: realisasi Planning berasal dari kolom numeric DB (drive?.cumulative_cost), bukan string. Kasus string baru nyata jika ada importer/parser lokal mengisi string bergaya id-ID.',
    'Audit ini statik + eksekusi fungsi ekstraksi; TIDAK melakukan render UI, TIDAK menyentuh DB, TIDAK mengubah kode aplikasi.'
  ]
}
fs.writeFileSync(`${WT}/scripts/rap-audit/negative-fixture-result.json`, JSON.stringify(summary, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(summary, null, 2))
console.log('JSON → scripts/rap-audit/negative-fixture-result.json')

// Sengaja exit 0: semua probe dieksekusi penuh; temuan sudah tercatat.
process.exit(0)
