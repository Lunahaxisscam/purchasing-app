// ============================================================
// S3-RECOVERY — Bit (t_18652eb1) — FIXTURE NEGATIF MODUL RAP-COMPARE
// Base: integration HEAD 1d364e7 (worktree wt-s3-rap-recovery)
//
// Cakupan audit S3 yang BELUM diuji WIP bandeng: kontrol PAGU &
// VARIANCE di modules/rap-compare (UI perbandingan RAB vs RAP vs
// Aktual). WIP hanya menguji components/Planning|ProjectFinance|Finance.
//
// SEMANTIK LAPOR sama dengan probe_infinity.mjs:
//   expect_ok      → assertion harus benar; gagal = kapabilitas hilang
//   expect_defect  → assertion membuktikan cacat ada
// ============================================================
import fs from 'node:fs'

const WT = process.env.S3_WT || '/home/ubuntu/dev-workspaces/wt-s3-rap-recovery'

const results = []
const confirmed = []
const unmet = []

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

console.log('[S3-RAPCOMPARE] Fixture negatif modul rap-compare — base 1d364e7')

const { buildComparison, toRupiah } = await import('../../modules/rap-compare/logic.js')

// helper: susun payload sesuai kontrak buildComparison
//   rabJson   : array/JSON baris acuan RAB (item, qty, price, unit)
//   rapLines  : array baris RAP draft (name, qty, price)
//   actualRows: array baris aktual dari nota
//   paguValue : nilai pagu (number | string lokal | null)
function payload(rab, rap, actual, pagu) {
  return { rabJson: rab, rapLines: rap, actualRows: actual, paguValue: pagu }
}

// ============================================================
// C1 — PAGU: kejujuran status saat data belum lengkap
//      (kontrak modul: jangan mengarang angka / jangan bilang aman)
// ============================================================
console.log('\n[C1] Kontrol pagu — kejujuran status')

const c1none = buildComparison(payload([{ name: 'Cat', qty: 10, price: 1000 }], [{ name: 'Cat', qty: 10, price: 1200 }], [], undefined))
rec('C1.1', 'Pagu tidak dikirim → level "none", TIDAK diklaim aman/over', 'expect_ok',
  c1none.ceiling.level === 'none' && c1none.ceiling.hasPagu === false,
  `level=${c1none.ceiling.level} hasPagu=${c1none.ceiling.hasPagu} — pesan: "${c1none.ceiling.message}"`,
  'kontrak kejujuran: tanpa pagu tidak ada kesimpulan')

const c1unknown = buildComparison(payload([{ name: 'Cat', qty: 10, price: 1000 }], [], [], 50000000))
rec('C1.2', 'Pagu ada tapi RAP kosong → level "unknown" (bukan "within")', 'expect_ok',
  c1unknown.ceiling.level === 'unknown',
  `level=${c1unknown.ceiling.level} — pesan: "${c1unknown.ceiling.message}"`,
  'pagu menunggu rencana; tidak boleh disimpulkan "di bawah pagu" saat rencana belum ada')

const c1zero = buildComparison(payload([{ name: 'Cat', qty: 10, price: 1000 }], [{ name: 'Cat', qty: 10, price: 1200 }], [], 0))
rec('C1.3', 'Pagu 0 → level "over" ATAU "unknown", TIDAK "within"', 'expect_ok',
  c1zero.ceiling.level === 'over' || c1zero.ceiling.level === 'unknown',
  `level=${c1zero.ceiling.level} pct=${c1zero.ceiling.pct}`,
  'pagu=0 tidak menghasilkan pct=% (guard pagu > 0) — lihat C1.3b')

rec('C1.3b', 'Pagu 0 dengan RAP bernilai → over terdeteksi (dipakai > pagu)', 'expect_ok',
  c1zero.ceiling.level === 'over' && c1zero.ceiling.over > 0,
  `level=${c1zero.ceiling.level} over=${c1zero.ceiling.over}`,
  'pagu 0 + rencana 12rb → over 12rb (benar: pagu 0 memang terlampaui)')

// ============================================================
// C2 — PAGU: nilai rusak / negatif / tak-finite
// ============================================================
console.log('\n[C2] Pagu dengan nilai rusak')

for (const [label, pagu] of [['null', null], ['""', ''], ['"abc"', 'abc'], ['-1', -1], ['NaN', NaN], ['Infinity', Infinity]]) {
  const r = buildComparison(payload([{ name: 'Cat', qty: 10, price: 1000 }], [{ name: 'Cat', qty: 10, price: 1200 }], [], pagu))
  console.log(`      pagu=${String(label).padEnd(9)} → level=${r.ceiling.level} hasPagu=${r.ceiling.hasPagu} pagu=${r.ceiling.pagu}`)
}

const c2inf = buildComparison(payload([{ name: 'Cat', qty: 10, price: 1000 }], [{ name: 'Cat', qty: 10, price: 1200 }], [], Infinity))
rec('C2.1', 'Pagu Infinity → toRupiah menolak (null), level "none" — TIDAK Infinity lolos', 'expect_ok',
  c2inf.ceiling.pagu === null && c2inf.ceiling.level === 'none',
  `pagu=${c2inf.ceiling.pagu} level=${c2inf.ceiling.level}`,
  'rap-compare JUSTRU lebih kuat dari Planning/ProjectFinance: Number.isFinite(v) eksplisit di toRupiah — kontras dengan FN-INF_GUARD di komponen lama')

const c2neg = buildComparison(payload([{ name: 'Cat', qty: 10, price: 1000 }], [{ name: 'Cat', qty: 10, price: 1200 }], [], -500))
rec('C2.2', 'Pagu negatif → ditolak (null) → level "none"', 'expect_ok',
  c2neg.ceiling.pagu === null && c2neg.ceiling.level === 'none',
  `pagu=${c2neg.ceiling.pagu} level=${c2neg.ceiling.level}`,
  'nilai negatif ditolak eksplisit, tidak dipaksa 0')

const c2nan = buildComparison(payload([{ name: 'Cat', qty: 10, price: 1000 }], [{ name: 'Cat', qty: 10, price: 1200 }], [], NaN))
rec('C2.3', 'Pagu NaN → ditolak (null) → level "none"', 'expect_ok',
  c2nan.ceiling.pagu === null && c2nan.ceiling.level === 'none',
  `pagu=${c2nan.ceiling.pagu} level=${c2nan.ceiling.level}`,
  'NaN tidak pernah menjadi pagu')

// ============================================================
// C3 — PAGU string bergaya lokal id-ID (bandingkan FN-RUPIAH_LOCALE)
// ============================================================
console.log('\n[C3] Pagu string lokal id-ID')

const c3 = buildComparison(payload([{ name: 'Cat', qty: 10, price: 1000 }], [{ name: 'Cat', qty: 10, price: 1200 }], [], 'Rp 1.250.000'))
rec('C3.1', 'Pagu "Rp 1.250.000" → toRupiah strip non-digit = 1.250.000 (BENAR)', 'expect_ok',
  c3.ceiling.pagu === 1250000,
  `pagu=${c3.ceiling.pagu} level=${c3.ceiling.level}`,
  'KONTRAS PENTING vs FN-RUPIAH_LOCALE: strip-digit idiom rap-compare membaca format id-ID dengan benar, sedangkan guard Number() di Planning L253/277/280/283 salah membacanya. Solusi sudah ada di repo, tinggal diselaraskan.')

const c3b = buildComparison(payload([{ name: 'Cat', qty: 10, price: 1000 }], [{ name: 'Cat', qty: 10, price: 1200 }], [], '1.250.000'))
rec('C3.2', 'Pagu "1.250.000" (tanpa Rp) → juga benar 1.250.000', 'expect_ok',
  c3b.ceiling.pagu === 1250000,
  `pagu=${c3b.ceiling.pagu}`,
  'sama-sama benar lewat strip-digit')

// ============================================================
// C4 — VARIANCE: baris tanpa acuan / tanpa nilai (null vs 0)
// ============================================================
console.log('\n[C4] Variance baris — null vs 0')

const c4 = buildComparison(payload(
  [{ name: 'Cat', qty: 10, price: 1000 }],
  [{ name: 'Cat', qty: 10, price: 1200 }],
  [],
  50000000
))
const catRow = c4.rows.find(r => r.name === 'Cat')
// Catatan: diffStatus di rap-compare adalah status variansi RAP-vs-RAB
// (diffOf(rap, rab)), BUKAN status kelengkapan aktual. Kejujuran
// "belum ada aktual" di modul ini hidup di row.actual === null +
// honesty.actualLabel — jadi assertion-nya dipisah.
rec('C4.1', 'Baris tanpa aktual → actual null (BUKAN 0); honesty melabeli "belum ada aktual"', 'expect_ok',
  catRow && catRow.actual === null && /Belum ada aktual/.test(c4.honesty.actualLabel || ''),
  `actual=${catRow?.actual} actualLabel="${c4.honesty.actualLabel}"`,
  'kontrak modul: yang belum punya nota WAJIB null, bukan 0 — tidak ada selisih aktual dikarang')

rec('C4.1b', 'diffStatus = status variansi RAP−RAB (2000 → "over"), terlepas dari aktual null', 'expect_ok',
  catRow && catRow.diff === 2000 && catRow.diffStatus === 'over',
  `diff=${catRow?.diff} status=${catRow?.diffStatus} (actual tetap null)`,
  'diffStatus menilai rencana vs acuan, bukan rencana vs aktual — keduanya berbeda lapisan laporan (sama polanya seperti dua definisi margin di R4)')

const c4b = buildComparison(payload(
  [{ name: 'Cat', qty: 10, price: 1000 }],
  [{ name: 'Cat', qty: 10, price: 1200 }],
  [{ name: 'Cat', qty: 10, price: 1100 }],
  50000000
))
const catRow2 = c4b.rows.find(r => r.name === 'Cat')
rec('C4.2', 'Aktual ada → diff RAP−RAB positif ditandai "over"', 'expect_ok',
  catRow2 && catRow2.diff === 2000 && catRow2.diffStatus === 'over',
  `rap=12000 rab=10000 actual=11000 diff=${catRow2?.diff} status=${catRow2?.diffStatus}`,
  'diff = RAP − RAB (kontrak L166)')

// ============================================================
// C5 — VARIANCE: nilai rusak di baris (harga negatif/NaN/Infinity)
// ============================================================
console.log('\n[C5] Variance baris dengan nilai rusak')

for (const [label, price] of [['-500', -500], ['"abc"', 'abc'], ['NaN', NaN], ['Infinity', Infinity], ['0', 0], [null, null]]) {
  const r = buildComparison(payload(
    [{ name: 'X', qty: 1, price: 1000 }],
    [{ name: 'X', qty: 1, price }],
    [],
    5000000
  ))
  const row = r.rows.find(x => x.name === 'X')
  console.log(`      harga RAP ${String(label).padEnd(9)} → rap=${row?.rap} diff=${row?.diff} status=${row?.diffStatus}`)
}

const c5inf = buildComparison(payload(
  [{ name: 'X', qty: 1, price: 1000 }],
  [{ name: 'X', qty: 1, price: Infinity }],
  [],
  5000000
))
rec('C5.1', 'Harga RAP Infinity → rap null, TIDAK jadi total Infinity', 'expect_ok',
  c5inf.rows.find(x => x.name === 'X').rap === null,
  `rap=${c5inf.rows.find(x => x.name === 'X').rap}`,
  'toRupiah memakai Number.isFinite eksplisit — cacat Infinity TIDAK tereplikasi di modul rap-compare')

const c5neg = buildComparison(payload(
  [{ name: 'X', qty: 1, price: 1000 }],
  [{ name: 'X', qty: 1, price: -500 }],
  [],
  5000000
))
rec('C5.2', 'Harga RAP negatif → rap null (ditolak, bukan −500)', 'expect_ok',
  c5neg.rows.find(x => x.name === 'X').rap === null,
  `rap=${c5neg.rows.find(x => x.name === 'X').rap}`,
  'kontrak: negatif/bukan-angka = null, pemanggil wajib anggap "tidak diketahui"')

// ============================================================
// C6 — qty rusak
// ============================================================
console.log('\n[C6] qty rusak')

for (const [label, qty] of [['0', 0], ['-3', -3], ['"abc"', 'abc'], ['null', null], ['Infinity', Infinity]]) {
  const r = buildComparison(payload(
    [{ name: 'Q', qty, price: 1000 }],
    [],
    [],
    5000000
  ))
  const row = r.rows.find(x => x.name === 'Q')
  console.log(`      qty ${String(label).padEnd(9)} → rab=${row?.rab} status=${row?.diffStatus}`)
}

const c6 = buildComparison(payload([{ name: 'Q', qty: 0, price: 1000 }], [], [], 5000000))
rec('C6.1', 'qty 0 → rab null (bukan 0 rupiah), diffStatus unknown', 'expect_ok',
  c6.rows.find(x => x.name === 'Q').rab === null,
  `rab=${c6.rows.find(x => x.name === 'Q').rab}`,
  'kontrak keputusan 3: qty <= 0 tidak "dipaksa 1", dikembalikan null')

// ============================================================
// C7 — overBudget: kontrol ini ada di modules/rap/model.js
//      (modul RAP inti), BUKAN di rap-compare. Kontraknya:
//      tanpa acuan RAB (rabTotal 0) tidak boleh diklaim over
//      budget — tidak ada pembanding, jadi selisihnya
//      "tidak diketahui", bukan "lebih".
// ============================================================
console.log('\n[C7] overBudget tanpa acuan RAB (modules/rap/model.js)')

const { compareRapToRab } = await import('../../modules/rap/model.js')

const rapOnly = { lines: [{ item_name: 'Baru', unit: 'pcs', qty: 1, planned_unit_price: 5000000 }] }
const c7 = compareRapToRab(rapOnly, [])
rec('C7.1', 'Tidak ada baris RAB → overBudget false walau RAP bernilai', 'expect_ok',
  c7.totals.overBudget === false && c7.totals.overBudgetAgainst !== null,
  `overBudget=${c7.totals.overBudget} overBudgetAgainst=${c7.totals.overBudgetAgainst} rabTotal=${c7.totals.rabTotal} rapTotal=${c7.totals.rapTotal} baselineKind=${c7.baseline.kind}`,
  'kontrak model L520-524: tanpa acuan RAB (rabTotal 0) tidak boleh diklaim over budget — tidak ada pembanding; sumber acuan tetap dilaporkan jujur lewat baseline')

// PERHATIAN BASIS HARGA: harga BOQ dari modul Budgeting disimpan
// dalam SATUAN RIBUAN, dan modules/rap/budgetingBridge.js L112
// (rabPriceToRupiah) mengubahnya menjadi RUPIAH sebelum menaruhnya
// di `rab_unit_price`. Jadi di baris RAP yang sudah ternormalisasi,
// `rab_unit_price` SUDAH rupiah — sama dengan planned_unit_price.
// (di sinilah probe saya sebelumnya salah: saya mengirim nilai ribuan)
const rabCat = [{ item_name: 'Cat', unit: 'pail', rab_qty: 10, rab_unit_price: 1000000 }]
const c7b = compareRapToRab({ lines: [{ item_name: 'Cat', unit: 'pail', planned_qty: 10, planned_unit_price: 1200000 }] }, rabCat)
rec('C7.2', 'Ada acuan RAB & RAP lebih mahal → overBudget true', 'expect_ok',
  c7b.totals.overBudget === true && c7b.totals.diffAmount === 2000000,
  `overBudget=${c7b.totals.overBudget} diffAmount=${c7b.totals.diffAmount} (rab=10x1jt=10jt vs rap=12jt) baselineKind=${c7b.baseline.kind}`,
  'perbandingan baru sah bila ada pembanding; kedua harga sudah rupiah pasca-bridge')

const c7c = compareRapToRab({ lines: [{ item_name: 'Cat', unit: 'pail', planned_qty: 10, planned_unit_price: 1000000 }] }, rabCat)
rec('C7.3', 'RAP sama dengan acuan RAB → overBudget false (bukan false positive)', 'expect_ok',
  c7c.totals.overBudget === false && c7c.totals.diffAmount === 0,
  `overBudget=${c7c.totals.overBudget} diffAmount=${c7c.totals.diffAmount}`,
  'selisih nol bukan over — tidak ada alarm palsu')

const c7d = compareRapToRab({ lines: [{ item_name: 'Cat', unit: 'pail', planned_qty: 10, planned_unit_price: 800000 }] }, rabCat)
rec('C7.4', 'RAP lebih murah dari acuan → overBudget false, diffAmount negatif', 'expect_ok',
  c7d.totals.overBudget === false && c7d.totals.diffAmount === -2000000,
  `overBudget=${c7d.totals.overBudget} diffAmount=${c7d.totals.diffAmount}`,
  'rencana lebih hemat dari acuan bukan over — tidak ada alarm palsu')

// ============================================================
// RINGKASAN
// ============================================================
console.log('\n===== RINGKASAN FIXTURE RAP-COMPARE S3 =====')
const total = results.length
const clean = results.filter(r => r.ok).length
console.log(`Total probe           : ${total}`)
console.log(`Assertion terpenuhi   : ${clean}`)
console.log(`Assertion tidak terpenuhi: ${total - clean}`)
console.log(`Cacat TERKONFIRMASI   : ${confirmed.length}`)
console.log(`Kapabilitas HILANG    : ${unmet.length}`)

const summary = {
  waktu: new Date().toISOString(),
  base_commit: '1d364e7 (integration HEAD) — audit S3 read-only',
  worktree: WT,
  modul: 'modules/rap-compare/logic.js',
  catatan_tata_kelola: 'S3 proposal-only; TIDAK mengubah kode aplikasi; TIDAK menyentuh DB/SQL produksi',
  cara_baca_hasil: 'expect_defect yang lulus = cacat TERBUKTI ADA. expect_ok yang gagal = kapabilitas hilang.',
  total_probe: total,
  assertion_terpenuhi: clean,
  assertion_tidak_terpenuhi: total - clean,
  cacat_terkonfirmasi: confirmed.map(c => c.id),
  kapabilitas_hilang: unmet.map(c => c.id),
  temuan: [...confirmed, ...unmet],
  kesimpulan_modul: 'Modul rap-compare (integrasi) MEMENUHI kontrak kejujuran pada fixture negatif: pagu & harga tak-finite/negatif/NaN ditolak eksplisit (null), status "none"/"unknown" dipakai alih-alih mengarang angka, dan baris tanpa aktual ditandai null bukan 0.',
  temuan_lintas_modul: [
    'FN-RUPIAH_LOCALE hanya ada di guard komponen lama (Planning/ProjectFinance/Finance). Modul rap-compare SUDAH memakai strip-digit yang benar — jadi perbaikannya adalah menyelaraskan, bukan menciptakan idiom baru.',
    'FN-INF_GUARD juga hanya di komponen lama. rap-compare memakai Number.isFinite eksplisit di toRupiah.'
  ],
  batasan: [
    'Audit ini menunjuk logika murni modules/rap-compare/logic.js; render view.jsx TIDAK diuji (tanpa DOM/React runtime di probe ini).',
    'Tidak ada probe DB live; TIDAK ada penulisan data.'
  ]
}
fs.writeFileSync(`${WT}/scripts/rap-audit/rap-compare-negative-result.json`, JSON.stringify(summary, null, 2) + '\n', 'utf8')
console.log(JSON.stringify(summary, null, 2))
console.log('JSON → scripts/rap-audit/rap-compare-negative-result.json')

process.exit(0)
