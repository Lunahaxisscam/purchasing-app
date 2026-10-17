// ============================================================
// UNIT TEST — logika murni RAP (modules/rap/model.js + budgetingBridge.js)
// t_71d95cfe (S3/7) + t_3b877fb5 (temuan Brooklyn P1: gerbang BOM & nilai
// negatif). Tanpa DOM, tanpa DB.
//
// BAGIAN PENTING: seluruh fixture negatif di sini diambil PERSIS dari laporan
// review Brooklyn S3 (bukan fixture yang dibuat agar kode lulus):
//   - baris barang jadi {item_name:'Wardrobe barang jadi',material_id:null,
//     unit:'unit',planned_qty:1,planned_unit_price:5000000} -> handoff WAJIB
//     ditolak (sebelumnya ok:true + pr_items berisi furniture).
//   - planned_unit_price -100 -> WAJIB ditolak & TIDAK menjadi 0
//     (sebelumnya ok:true, estimated_price 0, validateRap true).
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const M = await import(pathToFileURL(path.join(SB, 'dist/modules/rap/model.mjs')).href)
const B = await import(pathToFileURL(path.join(SB, 'dist/modules/rap/budgetingBridge.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`)
}

// ------------------------------------------------------------
// Fixture: payload RAB & BOQ version 5 (harga RIBUAN rupiah)
// ------------------------------------------------------------
const BOQ = {
  version: 5,
  priceUnit: 'thousand IDR (000)',
  boqReff: 'BOQ-014',
  revisionNumber: 'REV02',
  projectName: 'EA Store',
  items: [
    { item: 'Wardrobe', area: 'Kamar Utama', specs: 'HPL putih', qty: 2, unit: 'unit', price: 1500 },   // 2 x 1.500.000 = 3.000.000
    { item: 'Kitchen set', area: 'Dapur', specs: '', qty: 1, unit: 'unit', price: 8000 },               // 1 x 8.000.000 = 8.000.000
    { item: 'Backdrop TV', area: 'Ruang Tamu', specs: '', qty: 3, unit: 'm2', price: 750 }              // 3 x 750.000   = 2.250.000
  ]
}

// Katalog master material (READ-ONLY) — sumber verifikasi material_id,
// satuan, dan skala harga. Bentuk mengikuti tabel `materials` existing.
const MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 120000 },
  { id: 'm2', kode: 'HPL-0002', name: 'HPL Putih', category: 'Finishing', satuan: 'Lembar', harga_acuan: 95000 },
  { id: 'm3', kode: 'HWF-0003', name: 'Engsel Soft Close', category: 'Hardware', satuan: 'Pcs', harga_acuan: 25000 },
  { id: 'm4', kode: 'BHP-0004', name: 'Lem Fox', category: 'Bahan Habis Pakai', satuan: 'Kaleng', harga_acuan: 45000 }
]

// Helper: draft material baku yang BENAR (positif) — dipakai berulang.
function materialDraft(overrides = {}) {
  const line = M.normalizeLine({
    id: 'l-m1',
    item_name: 'Triplek 9mm',
    unit: 'Lembar',
    line_kind: 'MATERIAL',
    material_id: 'm1',
    kode: 'PLY-0001',
    rab_qty: 10,
    rab_unit_price: 120000,
    planned_qty: 12,
    planned_unit_price: 125000,
    price_source: 'MANUAL',
    ...overrides
  })
  return M.createRapDraft({
    project: { id: 'p1', name: 'EA Store', kode: '100' },
    rab: { reff: 'BOQ-014', revision: 'REV02' },
    rab_source: 'RAB & BOQ (JSON)',
    lines: [line],
    rabLines: [M.normalizeLine({ item_name: 'Pekerjaan Kayu', unit: 'ls', rab_qty: 1, rab_unit_price: 5000000, price_source: 'RAB' })],
    now: '2026-10-18T00:00:00.000Z'
  })
}

console.log('\n=== A. KONVERSI HARGA RAB (ribuan -> rupiah), TANPA KOERSI DIAM-DIAM ===')
{
  eq('A1 harga RAB 1500 (ribu) -> 1.500.000 rupiah', M.rabPriceToRupiah(1500), 1500000)
  eq('A2 harga RAB 0 tetap 0 (nol yang sah)', M.rabPriceToRupiah(0), 0)
  eq('A3 harga RAB NEGATIF -> null (BUKAN 0)', M.rabPriceToRupiah(-500), null)
  eq('A4 harga RAB bukan angka -> null (BUKAN 0, BUKAN NaN)', M.rabPriceToRupiah('abc'), null)
  eq('A5 harga RAB kosong -> null (BUKAN 0)', M.rabPriceToRupiah(''), null)
  eq('A6 parseNumberInput "1.500.000" -> 1500000', M.parseNumberInput('1.500.000'), 1500000)
  eq('A7 parseNumberInput "-5" ditolak -> null', M.parseNumberInput('-5'), null)
  eq('A8 parseNumberInput "" -> null', M.parseNumberInput(''), null)
  eq('A9 parseNumberInput "2,5" -> 2.5', M.parseNumberInput('2,5'), 2.5)
  eq('A10 formatRupiah 3000000', M.formatRupiah(3000000).replace(/\u00a0/g, ' '), 'Rp 3.000.000')

  // inspectNumber: state eksplisit, bukan nilai palsu
  eq('A11 inspectNumber(-100) state NEGATIVE', M.inspectNumber(-100).state, 'NEGATIVE')
  eq('A12 inspectNumber(-100).value null (tidak dipakai menghitung)', M.inspectNumber(-100).value, null)
  eq('A13 inspectNumber("-100") string juga NEGATIVE', M.inspectNumber('-100').state, 'NEGATIVE')
  eq('A14 inspectNumber(null) state MISSING (bukan ZERO)', M.inspectNumber(null).state, 'MISSING')
  eq('A15 inspectNumber(0) state ZERO', M.inspectNumber(0).state, 'ZERO')
  eq('A16 inspectNumber(NaN) state NOT_NUMBER', M.inspectNumber(NaN).state, 'NOT_NUMBER')
  eq('A17 inspectNumber("abc") state NOT_NUMBER', M.inspectNumber('abc').state, 'NOT_NUMBER')
  eq('A18 inspectNumber(Infinity) state NOT_NUMBER', M.inspectNumber(Infinity).state, 'NOT_NUMBER')
}

console.log('\n=== B. BRIDGE RAB & BOQ -> BARIS ACUAN ===')
{
  const res = B.rabLinesFromBoqPayload(BOQ)
  check('B1 payload v5 diterima', res.ok === true, JSON.stringify(res.problems))
  eq('B2 tiga baris terbaca', res.lines.length, 3)
  eq('B3 reff & revisi ikut', [res.ref.reff, res.ref.revision], ['BOQ-014', 'REV02'])
  eq('B4 harga baris 1 dikonversi ke rupiah', res.lines[0].rab_unit_price, 1500000)
  eq('B5 qty RAB ikut', res.lines[0].rab_qty, 2)
  eq('B6 rencana awal = RAB (belum diedit)', [res.lines[0].planned_qty, res.lines[0].planned_unit_price], [2, 1500000])
  eq('B7 sumber harga ditandai RAB', res.lines[0].price_source, 'RAB')
  eq('B8 basis harga = HARGA JUAL RAB (bukan biaya)', res.lines[0].price_basis, 'RAB_SELL_PRICE')
  eq('B9 baris BOQ bertipe PEKERJAAN (bukan material baku)', res.lines[0].line_kind, 'WORK_ITEM')
  check('B10 ada peringatan "harga jual vs biaya" (tidak klaim apel-vs-apel)', res.warnings.some(w => /HARGA JUAL/i.test(w) && /apel-vs-apel/i.test(w)), JSON.stringify(res.warnings))

  const totals = M.rapTotals({ lines: res.lines })
  eq('B11 total acuan RAB = 13.250.000', totals.rabTotal, 13250000)
  eq('B12 total rencana awal = acuan', totals.rapTotal, 13250000)
  eq('B13 selisih awal 0', totals.diffAmount, 0)
  eq('B14 baseline kind = harga jual RAB', totals.baseline.kind, 'RAB_SELL_PRICE')
  eq('B15 baseline TIDAK diklaim sebanding dengan biaya RAP', totals.baseline.comparable_with_rap_cost, false)
  check('B16 label baseline menyebut HARGA JUAL', /HARGA JUAL/i.test(totals.baseline.label), totals.baseline.label)

  const bad = B.rabLinesFromBoqPayload({ version: 5 })
  check('B17 payload tanpa items DITOLAK (bukan array kosong)', bad.ok === false && /items/.test(bad.problems.join(' ')), JSON.stringify(bad.problems))

  const unknown = B.rabLinesFromBoqPayload({ version: 99, items: [{ item: 'X', qty: 1, unit: 'unit', price: 1 }] })
  check('B18 versi tak dikenal ditolak dengan alasan', unknown.ok === false && /99/.test(unknown.problems.join(' ')), JSON.stringify(unknown.problems))

  const nullPayload = B.rabLinesFromBoqPayload(null)
  check('B19 payload null ditolak', nullPayload.ok === false)

  const legacy = B.rabLinesFromBoqPayload({ version: 1, items: [{ item: 'Meja', qty: 1, unit: 'unit', price: 1200 }] })
  check('B20 payload v1 (legacy) tetap dibaca', legacy.ok === true && legacy.lines[0].rab_unit_price === 1200000, JSON.stringify(legacy.lines))

  // --- NEGATIF: harga/qty RAB tidak valid DITOLAK, bukan jadi 0 ---
  const negPrice = B.rabLinesFromBoqPayload({ version: 5, items: [{ item: 'Wardrobe', qty: 1, unit: 'unit', price: -1500 }] })
  check('B21 harga RAB negatif DITOLAK (bukan diklem 0)', negPrice.ok === false && /negatif/i.test(negPrice.problems.join(' ')), JSON.stringify(negPrice.problems))
  eq('B22 baris harga negatif tidak menghasilkan baris', negPrice.lines.length, 0)

  const nanPrice = B.rabLinesFromBoqPayload({ version: 5, items: [{ item: 'Wardrobe', qty: 1, unit: 'unit', price: 'abc' }] })
  check('B23 harga RAB bukan angka DITOLAK', nanPrice.ok === false && /bukan angka/i.test(nanPrice.problems.join(' ')), JSON.stringify(nanPrice.problems))

  const negQty = B.rabLinesFromBoqPayload({ version: 5, items: [{ item: 'Wardrobe', qty: -2, unit: 'unit', price: 1500 }] })
  check('B24 qty RAB negatif DITOLAK (bukan dijadikan 0)', negQty.ok === false && /qty tidak valid/i.test(negQty.problems.join(' ')), JSON.stringify(negQty.problems))
}

console.log('\n=== C. BRIDGE WBS BUDGETING (JUJUR: UPAH SAJA) ===')
{
  const plans = [
    { id: 'w1', area: 'Dapur', item_name: 'Kitchen set', volume: 2, unit: 'unit', labor_cost: 3000000, status: 'Perencanaan' },
    { id: 'w2', area: 'Kamar', item_name: 'Wardrobe', volume: 1, unit: 'unit', labor_cost: 0 }
  ]
  const res = B.rabLinesFromWbsPlans(plans)
  check('C1 WBS terbaca', res.ok === true)
  eq('C2 harga satuan turunan = upah / volume', res.lines[0].rab_unit_price, 1500000)
  eq('C3 baris tanpa upah ditandai jujur', res.lines[1].price_source, 'WBS_TANPA_UPAH')
  eq('C4 basis = UPAH SAJA (bukan harga penuh)', res.lines[0].price_basis, 'WBS_LABOR_ONLY')
  check('C5 ada peringatan "hanya upah"', res.warnings.some(w => /upah/i.test(w)), JSON.stringify(res.warnings))
  check('C6 ada peringatan harga tidak tersedia (bukan nol sesungguhnya)', res.warnings.some(w => /TIDAK TERSEDIA/i.test(w)), JSON.stringify(res.warnings))

  const empty = B.rabLinesFromWbsPlans([])
  check('C7 WBS kosong -> ok:false + alasan', empty.ok === false && empty.problems.length > 0)

  const negLabor = B.rabLinesFromWbsPlans([{ id: 'x', item_name: 'Ganti Kusen', volume: 1, unit: 'unit', labor_cost: -500000 }])
  check('C8 labor_cost negatif DITOLAK (bukan jadi 0)', negLabor.ok === false && /labor_cost tidak valid/i.test(negLabor.problems.join(' ')), JSON.stringify(negLabor.problems))

  const negVolume = B.rabLinesFromWbsPlans([{ id: 'y', item_name: 'Pasang Atap', volume: -2, unit: 'm2', labor_cost: 1000000 }])
  check('C9 volume negatif DITOLAK (bukan jadi 1)', negVolume.ok === false && /volume tidak valid/i.test(negVolume.problems.join(' ')), JSON.stringify(negVolume.problems))
}

console.log('\n=== D. SELISIH RAB vs RAP (inti kartu) ===')
{
  const built = B.rabLinesFromBoqPayload(BOQ)
  const draft = M.createRapDraft({
    project: { id: 'p1', name: 'EA Store', kode: '100' },
    rab: built.ref,
    lines: B.rapLinesFromRab(built.lines),
    rabLines: built.lines,
    now: '2026-10-18T00:00:00.000Z'
  })
  eq('D1 draft berstatus DRAFT', draft.status, 'DRAFT')
  eq('D2 draft bertanda belum tersimpan', [draft.persisted, draft.persistence], [false, 'DRAFT_ONLY'])
  eq('D3 snapshot RAB disimpan terpisah', draft.rab_lines.length, 3)
  eq('D4 acuan reff ikut ke dokumen', draft.rab_reff, 'BOQ-014')

  // edit rencana: wardrobe 2 -> 2 dengan harga lebih murah (1.400.000)
  const edited = {
    ...draft,
    lines: draft.lines.map(l => (l.item_name === 'Wardrobe'
      ? M.normalizeLine({ ...l, planned_qty: 2, planned_unit_price: 1400000 })
      : l))
  }
  const t1 = M.rapTotals(edited)
  eq('D5 total RAP turun jadi 13.050.000', t1.rapTotal, 13050000)
  eq('D6 acuan RAB TETAP 13.250.000', t1.rabTotal, 13250000)
  eq('D7 selisih = -200.000', t1.diffAmount, -200000)
  eq('D8 selisih persen dibulatkan 1 desimal', t1.diffPct, -1.5)
  check('D9 tidak over budget', t1.overBudget === false)

  // edit qty naik -> over budget
  const over = {
    ...draft,
    lines: draft.lines.map(l => (l.item_name === 'Kitchen set'
      ? M.normalizeLine({ ...l, planned_qty: 2 })
      : l))
  }
  const t2 = M.rapTotals(over)
  eq('D10 qty 2x kitchen set -> total 21.250.000', t2.rapTotal, 21250000)
  eq('D11 selisih +8.000.000', t2.diffAmount, 8000000)
  check('D12 ditandai overBudget', t2.overBudget === true)
  eq('D13 satu baris dihitung "lebih"', t2.overCount, 1)
  check('D14 overBudget diberi makna "margin habis", bukan klaim biaya', /margin/i.test(t2.overBudgetMeaning), t2.overBudgetMeaning)

  const cmp = M.compareRapToRab(over)
  eq('D15 perbandingan memuat 3 baris', cmp.rows.length, 3)
  eq('D16 tidak ada baris RAB yang hilang', cmp.summary.missingCount, 0)
  const kitchenRow = cmp.rows.find(r => r.item_name === 'Kitchen set')
  eq('D17 selisih baris kitchen set = +8.000.000', kitchenRow.diffAmount, 8000000)
  eq('D18 status baris OVER', kitchenRow.state, 'OVER')
  eq('D19 ringkasan membawa label sumber acuan', cmp.summary.baselineKind, 'RAB_SELL_PRICE')
  eq('D20 baseline TIDAK diklaim apel-vs-apel', cmp.baseline.comparable_with_rap_cost, false)

  // baris RAP dihapus -> harus muncul sebagai baris RAB yang belum tercakup
  const withoutBackdrop = { ...draft, lines: draft.lines.filter(l => l.item_name !== 'Backdrop TV') }
  const cmp2 = M.compareRapToRab(withoutBackdrop)
  eq('D21 baris hilang terdeteksi', cmp2.summary.missingCount, 1)
  eq('D22 nama baris hilang benar', cmp2.missingInRap[0].item_name, 'Backdrop TV')
  eq('D23 acuan RAB TIDAK menyusut walau baris dihapus', cmp2.summary.rabTotal, 13250000)
  eq('D24 total RAP tanpa backdrop = 11.000.000', cmp2.summary.rapTotal, 11000000)
  eq('D25 selisih = -2.250.000', cmp2.summary.diffAmount, -2250000)

  // baris RAP tambahan di luar RAB
  const extra = {
    ...draft,
    lines: [...draft.lines, M.normalizeLine({ item_name: 'Kerja tambah', unit: 'ls', planned_qty: 1, planned_unit_price: 500000, rab_qty: 0, rab_unit_price: 0, price_source: 'MANUAL' })]
  }
  const cmp3 = M.compareRapToRab(extra)
  eq('D26 baris di luar RAB terdeteksi', cmp3.summary.extraCount, 1)
  eq('D27 total RAP termasuk baris tambahan', cmp3.summary.rapTotal, 13750000)

  // tanpa acuan RAB sama sekali -> persen null, bukan Infinity/NaN
  const noRab = M.createRapDraft({ project: { id: 'p1', name: 'X' }, lines: [M.normalizeLine({ item_name: 'A', unit: 'unit', planned_qty: 1, planned_unit_price: 1000, rab_qty: 0, rab_unit_price: 0 })] })
  const t3 = M.rapTotals(noRab)
  check('D28 tanpa acuan: diffPct null (bukan NaN/Infinity)', t3.diffPct === null, String(t3.diffPct))
  check('D29 tanpa acuan: tidak diklaim overBudget', t3.overBudget === false)
  eq('D30 tanpa acuan: baseline kind NONE', t3.baseline.kind, 'NONE')
  check('D31 tanpa acuan: baseline menyatakan selisih TIDAK DIKETAHUI', /TIDAK DIKETAHUI/i.test(t3.baseline.note), t3.baseline.note)
}

console.log('\n=== E. VALIDASI (penghalang vs peringatan) ===')
{
  const built = B.rabLinesFromBoqPayload(BOQ)
  const draft = M.createRapDraft({ project: { id: 'p1', name: 'EA Store', kode: '100' }, rab: built.ref, lines: B.rapLinesFromRab(built.lines), rabLines: built.lines })
  const v1 = M.validateRap(draft)
  check('E1 draft sehat tidak punya penghalang', v1.ok === true, JSON.stringify(v1.problems))

  const noProject = M.validateRap({ ...draft, project_id: null, project_name: '' })
  check('E2 tanpa proyek -> penghalang', noProject.ok === false && /[Pp]royek/.test(noProject.problems.join(' ')))

  const noVersion = M.validateRap({ ...draft, version: '' })
  check('E3 tanpa label versi -> penghalang', noVersion.ok === false && /versi/i.test(noVersion.problems.join(' ')))

  const zeroQty = M.validateRap({ ...draft, lines: draft.lines.map(l => (l.item_name === 'Wardrobe' ? M.normalizeLine({ ...l, planned_qty: 0 }) : l)) })
  check('E4 qty 0 -> penghalang', zeroQty.ok === false && /Qty/.test(zeroQty.problems.join(' ')))

  const zeroPrice = M.validateRap({ ...draft, lines: draft.lines.map(l => (l.item_name === 'Wardrobe' ? M.normalizeLine({ ...l, planned_unit_price: 0 }) : l)) })
  check('E5 harga 0 yang DIKETIK -> PERINGATAN (boleh lanjut, ditandai belum lengkap)', zeroPrice.ok === true && zeroPrice.warnings.some(w => /masih 0/.test(w)), JSON.stringify(zeroPrice.warnings))

  const dup = M.validateRap({ ...draft, lines: [...draft.lines, M.normalizeLine({ ...draft.lines[0], id: 'dup-1' })] })
  check('E6 baris dobel -> penghalang (anti dobel hitung)', dup.ok === false && /lebih dari sekali/.test(dup.problems.join(' ')), JSON.stringify(dup.problems))

  const over = M.validateRap({ ...draft, lines: draft.lines.map(l => (l.item_name === 'Kitchen set' ? M.normalizeLine({ ...l, planned_qty: 3 }) : l)) })
  check('E7 total melebihi RAB -> peringatan berisi angka & label sumber', over.ok === true && over.warnings.some(w => /MELEBIHI/.test(w) && /HARGA JUAL/i.test(w)), JSON.stringify(over.warnings))

  const empty = M.validateRap({ ...draft, lines: [] })
  check('E8 RAP tanpa baris -> penghalang', empty.ok === false && /baris/.test(empty.problems.join(' ')))

  const noRab = M.validateRap({ ...draft, rab_reff: '', rab_lines: [] })
  check('E9 tanpa acuan RAB -> peringatan (bukan klaim aman)', noRab.warnings.some(w => /Referensi RAB/.test(w)))

  // --- INTI TEMUAN BROOKLYN: harga -100 TIDAK boleh lolos ---
  const negPriceLine = { item_name: 'Wardrobe barang jadi', material_id: null, unit: 'unit', planned_qty: 1, planned_unit_price: -100 }
  const negPrice = M.validateRap({ ...draft, lines: [negPriceLine] })
  check('E10 harga -100 -> validateRap FALSE (sebelumnya true)', negPrice.ok === false, JSON.stringify(negPrice.problems))
  check('E11 alasan menyebut negatif & DITOLAK (bukan jadi 0)', /negatif/i.test(negPrice.problems.join(' ')) && /DITOLAK/i.test(negPrice.problems.join(' ')), JSON.stringify(negPrice.problems))
  check('E12 tidak ada peringatan "masih 0" untuk nilai negatif (tidak dikoersi)', !negPrice.warnings.some(w => /masih 0/.test(w)), JSON.stringify(negPrice.warnings))
  eq('E13 total RAP tidak menghitung harga negatif sebagai 0 lalu lolos', M.rapTotals({ lines: [M.normalizeLine(negPriceLine)] }).rapTotal, 0)
  eq('E14 state harga baris = NEGATIVE (bukan ZERO)', M.normalizeLine(negPriceLine).planned_unit_price_state, 'NEGATIVE')
  eq('E15 nilai mentah negatif tetap tersimpan apa adanya', String(M.normalizeLine(negPriceLine).planned_unit_price_raw), '-100')

  // harga kosong / bukan angka juga penghalang, bukan 0
  const missingPrice = M.validateRap({ ...draft, lines: [{ item_name: 'Wardrobe', unit: 'unit', planned_qty: 1, planned_unit_price: '' }] })
  check('E16 harga kosong -> penghalang (kosong BUKAN nol)', missingPrice.ok === false && /kosong/i.test(missingPrice.problems.join(' ')), JSON.stringify(missingPrice.problems))

  const nanPrice = M.validateRap({ ...draft, lines: [{ item_name: 'Wardrobe', unit: 'unit', planned_qty: 1, planned_unit_price: 'abc' }] })
  check('E17 harga bukan angka -> penghalang', nanPrice.ok === false && /bukan angka/i.test(nanPrice.problems.join(' ')), JSON.stringify(nanPrice.problems))

  const negQty = M.validateRap({ ...draft, lines: [{ item_name: 'Wardrobe', unit: 'unit', planned_qty: -2, planned_unit_price: 1000 }] })
  check('E18 qty negatif -> penghalang (bukan 0)', negQty.ok === false && /negatif/i.test(negQty.problems.join(' ')), JSON.stringify(negQty.problems))

  // kesiapan material dilaporkan jujur
  const readiness = M.validateRap(draft).material
  eq('E19 baris BOQ dihitung sebagai pekerjaan, bukan material', readiness.work_item, 3)
  eq('E20 belum ada baris material baku', readiness.material, 0)
  check('E21 catatan menyebut baris tidak dipecah otomatis', /tidak dipecah otomatis|BUKAN material baku/i.test(readiness.note), readiness.note)
}

console.log('\n=== F. STATUS VERSI (transisi eksplisit) ===')
{
  const built = B.rabLinesFromBoqPayload(BOQ)
  let d = M.createRapDraft({ project: { id: 'p1', name: 'EA Store', kode: '100' }, rab: built.ref, lines: B.rapLinesFromRab(built.lines), rabLines: built.lines })
  check('F1 DRAFT tidak bisa langsung DISETUJUI', M.canTransition('DRAFT', 'DISETUJUI') === false)
  check('F2 alasan penolakan transisi terbaca', /tidak bisa berpindah/.test(M.transitionProblem('DRAFT', 'DISETUJUI') || ''))

  let r = M.setRapStatus(d, 'DIAJUKAN', { by: 'admin@noir.test', now: '2026-10-18T01:00:00.000Z' })
  check('F3 DRAFT -> DIAJUKAN diterima', r.ok === true, r.problem)
  eq('F4 status jadi DIAJUKAN', r.rap.status, 'DIAJUKAN')
  eq('F5 riwayat bertambah', r.rap.history.length, 2)
  eq('F6 riwayat mencatat pelaku', r.rap.history[1].by, 'admin@noir.test')

  r = M.setRapStatus(r.rap, 'DISETUJUI', { now: '2026-10-18T02:00:00.000Z' })
  check('F7 DIAJUKAN -> DISETUJUI diterima', r.ok === true, r.problem)

  const blocked = M.setRapStatus(r.rap, 'DRAFT')
  check('F8 DISETUJUI tidak bisa balik ke DRAFT', blocked.ok === false && /tidak bisa berpindah/.test(blocked.problem))

  const superseded = M.setRapStatus(r.rap, 'DIGANTIKAN')
  check('F9 DISETUJUI -> DIGANTIKAN (versi baru) diterima', superseded.ok === true, superseded.problem)

  const reject = M.setRapStatus(M.setRapStatus(d, 'DIAJUKAN').rap, 'DITOLAK')
  check('F10 DIAJUKAN -> DITOLAK diterima', reject.ok === true)
  const backToDraft = M.setRapStatus(reject.rap, 'DRAFT')
  check('F11 DITOLAK -> DRAFT (revisi) diterima', backToDraft.ok === true)

  const unknown = M.setRapStatus(d, 'NGARANG')
  check('F12 status tak dikenal ditolak', unknown.ok === false)

  eq('F13 label versi berikutnya dari kosong', M.nextVersionLabel([]), 'RAP-01')
  eq('F14 label versi berikutnya dari RAP-01', M.nextVersionLabel(['RAP-01']), 'RAP-02')
  eq('F15 label versi lompat ke maksimum + 1', M.nextVersionLabel(['RAP-01', 'RAP-07', 'lain']), 'RAP-08')
}

console.log('\n=== G. GERBANG BOM PADA HANDOFF PR (temuan Brooklyn S3) ===')
{
  // ---------- G.A FIXTURE PERSIS BROOKLYN: barang jadi tidak boleh masuk PR
  const jadiLine = { item_name: 'Wardrobe barang jadi', material_id: null, unit: 'unit', planned_qty: 1, planned_unit_price: 5000000 }
  const jadiRap = M.createRapDraft({
    project: { id: 'p1', name: 'EA Store', kode: '100' },
    rab: { reff: 'BOQ-014', revision: 'REV02' },
    rab_source: 'RAB & BOQ (JSON)',
    lines: [jadiLine],
    rabLines: [M.normalizeLine({ item_name: 'Wardrobe barang jadi', unit: 'unit', rab_qty: 1, rab_unit_price: 5000000, price_source: 'RAB' })]
  })
  const jadi = M.buildPrHandoff(jadiRap, { materials: MATERIALS })
  check('G1 FIXTURE BROOKLYN: handoff barang jadi DITOLAK (sebelumnya ok:true)', jadi.ok === false, JSON.stringify(jadi.problems))
  eq('G2 FIXTURE BROOKLYN: TIDAK ada pr_items berisi furniture', jadi.items.length, 0)
  check('G3 alasan menyebut jenis baris & material baku', /BUKAN|bertipe|MATERIAL BAKU/i.test(jadi.problems.join(' ')), JSON.stringify(jadi.problems))
  check('G4 alasan memberi langkah perbaikan (BOM/gambar kerja), bukan tebakan nama', /material_id|BOM|gambar kerja/i.test(jadi.problems.join(' ')), JSON.stringify(jadi.problems))
  eq('G5 gate mencatat 1 baris ditolak', jadi.gate.rejected, 1)
  eq('G6 gate mencatat 0 baris terverifikasi', jadi.gate.verified, 0)

  // ---------- G.B FIXTURE PERSIS BROOKLYN: harga -100 ----------
  const negLine = { item_name: 'Triplek 9mm', material_id: 'm1', unit: 'Lembar', planned_qty: 1, planned_unit_price: -100, line_kind: 'MATERIAL' }
  const negRap = M.createRapDraft({
    project: { id: 'p1', name: 'EA Store', kode: '100' },
    rab: { reff: 'BOQ-014', revision: 'REV02' },
    rab_source: 'RAB & BOQ (JSON)',
    lines: [negLine],
    rabLines: [M.normalizeLine({ item_name: 'Triplek 9mm', unit: 'Lembar', rab_qty: 1, rab_unit_price: 120000, price_source: 'RAB' })]
  })
  const neg = M.buildPrHandoff(negRap, { materials: MATERIALS })
  check('G7 FIXTURE BROOKLYN: harga -100 handoff DITOLAK (sebelumnya ok:true)', neg.ok === false, JSON.stringify(neg.problems))
  eq('G8 FIXTURE BROOKLYN: TIDAK ada item estimated_price 0 hasil koersi', neg.items.length, 0)
  check('G9 alasan menyebut negatif & tidak dijadikan 0', /negatif/i.test(neg.problems.join(' ')) && /TIDAK dijadikan 0|DITOLAK/i.test(neg.problems.join(' ')), JSON.stringify(neg.problems))
  check('G10 validateRap juga FALSE untuk fixture -100', M.validateRap(negRap).ok === false)

  // ---------- G.C POSITIF: baris material BOM yang benar DITERIMA ----------
  const okDraft = materialDraft()
  const ok = M.buildPrHandoff(okDraft, { materials: MATERIALS })
  check('G11 POSITIF: material BOM valid -> handoff ok', ok.ok === true, JSON.stringify(ok.problems))
  eq('G12 POSITIF: satu item material', ok.items.length, 1)
  eq('G13 POSITIF: material_id diteruskan', ok.items[0].material_id, 'm1')
  eq('G14 POSITIF: qty & harga rencana', [ok.items[0].quantity, ok.items[0].estimated_price], [12, 125000])
  eq('G15 POSITIF: satuan dari master', ok.items[0].unit, 'Lembar')
  eq('G16 POSITIF: kode dari master', ok.items[0].kode, 'PLY-0001')
  eq('G17 POSITIF: nama memakai nama master', ok.items[0].item_name, 'Triplek 9mm')
  eq('G18 POSITIF: status item PENDING_APPROVAL', ok.items[0].status, 'PENDING_APPROVAL')
  eq('G19 POSITIF: nol penulisan DB', ok.meta.writes, 0)
  eq('G20 POSITIF: TIDAK ada approval (draft bukan alokasi resmi)', ok.meta.approval, 'NONE')
  eq('G21 POSITIF: rap_status_official false', ok.meta.rap_status_official, false)
  check('G22 POSITIF: catatan menyebut PRATINJAU & bukan alokasi resmi', /PRATINJAU/i.test(ok.request.notes) && /BUKAN alokasi resmi/i.test(ok.request.notes), ok.request.notes)

  // ---------- G.D NEGATIF: satuan berbeda dari master ----------
  const unitMismatch = M.buildPrHandoff(materialDraft({ unit: 'm2' }), { materials: MATERIALS })
  check('G23 satuan beda dengan master DITOLAK (tanpa konversi karangan)', unitMismatch.ok === false && /BEDA dengan satuan master/i.test(unitMismatch.problems.join(' ')), JSON.stringify(unitMismatch.problems))
  eq('G24 tidak ada item dari baris satuan salah', unitMismatch.items.length, 0)

  // ---------- G.E NEGATIF: salah skala 1000x ----------
  const scale1000 = M.buildPrHandoff(materialDraft({ planned_unit_price: 120000000 }), { materials: MATERIALS })
  check('G25 harga ~1000x acuan master DITOLAK (indikasi ribuan vs rupiah)', scale1000.ok === false && /SALAH SKALA/i.test(scale1000.problems.join(' ')), JSON.stringify(scale1000.problems))
  eq('G26 tidak ada item dari baris salah skala', scale1000.items.length, 0)

  const scale10 = M.buildPrHandoff(materialDraft({ planned_unit_price: 1250000 }), { materials: MATERIALS })
  check('G27 harga ~10x acuan master -> PERINGATAN tapi tetap disusun', scale10.ok === true && scale10.warnings.some(w => /skala harga/i.test(w)), JSON.stringify(scale10.warnings))

  // ---------- G.F NEGATIF: acuan RAB yang disetujui tidak ada ----------
  const noRabDraft = { ...materialDraft(), rab_reff: '', rab_revision: '', rab_lines: [], rab_source: '' }
  const noRab = M.buildPrHandoff(noRabDraft, { materials: MATERIALS })
  check('G28 tanpa acuan RAB disetujui -> handoff DITOLAK', noRab.ok === false && /Acuan RAB yang disetujui belum ada/i.test(noRab.problems.join(' ')), JSON.stringify(noRab.problems))

  const manualNoRab = M.buildPrHandoff({ ...noRabDraft, rab_basis: 'MANUAL_NO_RAB' }, { materials: MATERIALS })
  check('G29 tanda eksplisit MANUAL_NO_RAB -> boleh, dengan peringatan jujur', manualNoRab.ok === true && manualNoRab.warnings.some(w => /TANPA ACUAN RAB/i.test(w)), JSON.stringify(manualNoRab.problems))

  // ---------- G.G NEGATIF: katalog material belum dimuat ----------
  const noCatalog = M.buildPrHandoff(okDraft)
  check('G30 tanpa katalog material -> handoff DITOLAK (tidak menebak)', noCatalog.ok === false && /Katalog master material belum dimuat/i.test(noCatalog.problems.join(' ')), JSON.stringify(noCatalog.problems))
  eq('G31 tanpa katalog: tidak ada item lolos', noCatalog.items.length, 0)

  // ---------- G.H NEGATIF: material_id tidak ada di master ----------
  const ghost = M.buildPrHandoff(materialDraft({ material_id: 'm-ghost' }), { materials: MATERIALS })
  check('G32 material_id asing DITOLAK (tautan tidak terverifikasi)', ghost.ok === false && /tidak ditemukan di master material/i.test(ghost.problems.join(' ')), JSON.stringify(ghost.problems))

  // ---------- G.I NEGATIF: material_id kosong walau jenis material ----------
  const noId = M.buildPrHandoff(materialDraft({ material_id: null }), { materials: MATERIALS })
  check('G33 material_id kosong DITOLAK (nama tidak dipakai menebak)', noId.ok === false && /belum tertaut master material/i.test(noId.problems.join(' ')), JSON.stringify(noId.problems))

  // ---------- G.J NEGATIF: belum ditandai jenisnya ----------
  const unmarked = M.buildPrHandoff(materialDraft({ line_kind: 'UNSPECIFIED' }), { materials: MATERIALS })
  check('G34 jenis baris belum ditandai -> DITOLAK (tidak ada heuristik nama)', unmarked.ok === false && /Belum ditandai/i.test(unmarked.problems.join(' ')), JSON.stringify(unmarked.problems))

  // ---------- G.K qty & harga invalid tidak dikoersi ----------
  const zeroQty = M.buildPrHandoff(materialDraft({ planned_qty: 0 }), { materials: MATERIALS })
  check('G35 qty 0 DITOLAK, tidak diubah jadi 1', zeroQty.ok === false && /Qty rencana/.test(zeroQty.problems.join(' ')), JSON.stringify(zeroQty.problems))

  const negQty = M.buildPrHandoff(materialDraft({ planned_qty: -3 }), { materials: MATERIALS })
  check('G36 qty negatif DITOLAK (bukan jadi 1)', negQty.ok === false && /tidak valid/i.test(negQty.problems.join(' ')), JSON.stringify(negQty.problems))

  const zeroPrice = M.buildPrHandoff(materialDraft({ planned_unit_price: 0 }), { materials: MATERIALS })
  check('G37 harga 0 yang diketik -> PERINGATAN belum lengkap, item tetap disusun', zeroPrice.ok === true && zeroPrice.warnings.some(w => /BELUM LENGKAP/.test(w)), JSON.stringify(zeroPrice.warnings))
  eq('G38 harga 0 tetap 0 (tidak diubah)', zeroPrice.items[0].estimated_price, 0)

  const missingPrice = M.buildPrHandoff(materialDraft({ planned_unit_price: '' }), { materials: MATERIALS })
  check('G39 harga kosong DITOLAK (kosong BUKAN nol)', missingPrice.ok === false && /kosong BUKAN nol/i.test(missingPrice.problems.join(' ')), JSON.stringify(missingPrice.problems))

  // ---------- G.L campuran: 1 valid + 1 barang jadi -> hanya yang valid masuk
  const mixed = M.createRapDraft({
    project: { id: 'p1', name: 'EA Store', kode: '100' },
    rab: { reff: 'BOQ-014', revision: 'REV02' },
    rab_source: 'RAB & BOQ (JSON)',
    lines: [
      { item_name: 'Wardrobe barang jadi', material_id: null, unit: 'unit', planned_qty: 1, planned_unit_price: 5000000 },
      { item_name: 'Triplek 9mm', material_id: 'm1', unit: 'Lembar', planned_qty: 4, planned_unit_price: 120000, line_kind: 'MATERIAL' }
    ],
    rabLines: [M.normalizeLine({ item_name: 'Wardrobe barang jadi', unit: 'unit', rab_qty: 1, rab_unit_price: 5000000, price_source: 'RAB' })]
  })
  const mix = M.buildPrHandoff(mixed, { materials: MATERIALS })
  check('G40 campuran: handoff DITOLAK karena ada baris bukan material', mix.ok === false)
  eq('G41 campuran (FAIL-CLOSED): payload TIDAK disusun sama sekali', mix.items.length, 0)
  eq('G42 campuran: baris yang lolos gerbang tetap dilaporkan untuk pratinjau', mix.gate.verified_items.length, 1)
  eq('G43 campuran: item yang lolos = material baku', mix.gate.verified_items[0].material_id, 'm1')
  eq('G44 campuran: gate rejected=1 verified=1 blocked=true', [mix.gate.rejected, mix.gate.verified, mix.gate.blocked], [1, 1, true])
  eq('G45 campuran: request null (tidak ada payload setengah jadi)', mix.request, null)

  // ---------- G.M kontrak payload tetap sama dengan jalur PR existing ----
  const reqKeys = Object.keys(ok.request).sort()
  eq('G44 field request = kontrak PR existing', reqKeys, M.PR_REQUEST_FIELDS.slice().sort())
  const itemKeys = Object.keys(ok.items[0]).sort()
  eq('G45 field item = kontrak pr_items existing (tanpa pr_id)', itemKeys, M.PR_ITEM_PAYLOAD_FIELDS.slice().sort())
  check('G46 pr_id TIDAK dikarang di payload', !('pr_id' in ok.items[0]))
  eq('G47 nomor PR TIDAK dibuat di sini', ok.request.pr_number, null)
  eq('G48 request.status DRAFT', ok.request.status, 'DRAFT')
  eq('G49 sort_order berurutan', ok.items.map(i => i.sort_order), [0])
  check('G50 basis acuan dilaporkan jujur (bukan apel-vs-apel)', ok.meta.rab_comparable_with_rap_cost === false && ok.meta.approval === 'NONE')
  eq('G51 label pratinjau eksplisit', M.PR_HANDOFF_LABEL, 'Pratinjau payload — DRAFT, BUKAN alokasi resmi, 0 tulisan DB')
}

console.log('\n=== H. SNAPSHOT JSON (backup manual, bukan persistence) ===')
{
  const built = B.rabLinesFromBoqPayload(BOQ)
  const draft = M.createRapDraft({ project: { id: 'p1', name: 'EA Store', kode: '100' }, rab: built.ref, lines: B.rapLinesFromRab(built.lines), rabLines: built.lines })
  const snap = M.rapToSnapshot(draft)
  eq('H1 snapshot menandai tidak tersimpan', snap.savedToServer, false)
  eq('H2 jenis berkas rap-draft', snap.kind, 'rap-draft')

  const round = M.rapFromSnapshot(JSON.stringify(snap))
  check('H3 snapshot bisa dipulihkan', round.ok === true, round.problem)
  eq('H4 jumlah baris sama', round.rap.lines.length, 3)
  eq('H5 harga rencana utuh', round.rap.lines[0].planned_unit_price, 1500000)
  eq('H6 setelah dipulihkan TETAP bertanda belum tersimpan', [round.rap.persisted, round.rap.persistence], [false, 'DRAFT_ONLY'])
  eq('H7 snapshot RAB ikut dipulihkan', round.rap.rab_lines.length, 3)
  eq('H8 jenis baris ikut dipulihkan', round.rap.lines[0].line_kind, 'WORK_ITEM')

  check('H9 JSON rusak ditolak', M.rapFromSnapshot('{bukan json').ok === false)
  check('H10 jenis berkas lain ditolak', M.rapFromSnapshot({ kind: 'boq-draft', rap: { lines: [] } }).ok === false)
  check('H11 tanpa daftar baris ditolak', M.rapFromSnapshot({ kind: 'rap-draft', rap: {} }).ok === false)

  const badStatus = M.rapFromSnapshot({ kind: 'rap-draft', rap: { ...draft, status: 'NGARANG' } })
  eq('H12 status asing dipulihkan sebagai DRAFT', badStatus.rap.status, 'DRAFT')

  // nilai negatif TIDAK "hilang" setelah round-trip snapshot
  const negDraft = M.createRapDraft({ project: { id: 'p1', name: 'X' }, lines: [{ item_name: 'A', unit: 'unit', planned_qty: 1, planned_unit_price: -100 }] })
  const negRound = M.rapFromSnapshot(JSON.stringify(M.rapToSnapshot(negDraft)))
  eq('H13 harga negatif tetap negatif setelah round-trip (tidak jadi 0)', negRound.rap.lines[0].planned_unit_price_state, 'NEGATIVE')
  check('H14 validateRap setelah round-trip tetap menolak', M.validateRap(negRound.rap).ok === false)
}

console.log('\n=== I. KAPABILITAS (dinyatakan, bukan disembunyikan) ===')
{
  check('I1 mode persistence DRAFT_ONLY', B.RAP_CAPABILITY.persistence === 'DRAFT_ONLY')
  check('I2 tidak ada tabel RAP', B.RAP_CAPABILITY.table === null)
  check('I3 canSave false', B.RAP_CAPABILITY.canSave === false)
  check('I4 canApprove false (draft bukan approval)', B.RAP_CAPABILITY.canApprove === false)
  check('I5 alasan menyebut migrasi dibekukan', /dibekukan/i.test(B.RAP_CAPABILITY.reason), B.RAP_CAPABILITY.reason)
  check('I6 kapabilitas menyatakan gerbang BOM', /MATERIAL BAKU/i.test(B.RAP_CAPABILITY.bomGate), B.RAP_CAPABILITY.bomGate)
  check('I7 kapabilitas menyatakan harga RAB = harga jual', /HARGA JUAL|harga JUAL/i.test(B.RAP_CAPABILITY.warning), B.RAP_CAPABILITY.warning)
}

console.log('\n=== J. LABEL SUMBER ACUAN (tidak ada klaim apel-vs-apel) ===')
{
  const boqDraft = (() => {
    const built = B.rabLinesFromBoqPayload(BOQ)
    return M.createRapDraft({ project: { id: 'p1', name: 'EA' }, rab: built.ref, rab_source: 'RAB & BOQ (JSON)', lines: B.rapLinesFromRab(built.lines), rabLines: built.lines })
  })()
  const b1 = M.describeRabBaseline(boqDraft)
  eq('J1 acuan JSON RAB -> kind RAB_SELL_PRICE', b1.kind, 'RAB_SELL_PRICE')
  check('J2 label menyebut HARGA JUAL', /HARGA JUAL/.test(b1.label), b1.label)
  eq('J3 tidak diklaim sebanding dengan biaya RAP', b1.comparable_with_rap_cost, false)
  check('J4 catatan menyebut "bukan apel-vs-apel"', /bukan apel-vs-apel/i.test(b1.note), b1.note)

  const wbs = B.rabLinesFromWbsPlans([{ id: 'w1', item_name: 'Kitchen set', volume: 2, unit: 'unit', labor_cost: 3000000 }])
  const wbsDraft = M.createRapDraft({ project: { id: 'p1', name: 'EA' }, rab: wbs.ref, rab_source: 'WBS Budgeting (upah)', lines: wbs.lines, rabLines: wbs.lines })
  const b2 = M.describeRabBaseline(wbsDraft)
  eq('J5 acuan WBS -> kind WBS_LABOR_ONLY', b2.kind, 'WBS_LABOR_ONLY')
  check('J6 label menyebut UPAH', /UPAH/i.test(b2.label), b2.label)
  eq('J7 tidak diklaim sebanding', b2.comparable_with_rap_cost, false)

  const mixedDraft = M.createRapDraft({
    project: { id: 'p1', name: 'EA' },
    lines: [],
    rabLines: [
      M.normalizeLine({ item_name: 'A', unit: 'unit', rab_qty: 1, rab_unit_price: 1000, price_source: 'RAB' }),
      M.normalizeLine({ item_name: 'B', unit: 'unit', rab_qty: 1, rab_unit_price: 500, price_source: 'WBS_UPAH' })
    ]
  })
  const b3 = M.describeRabBaseline(mixedDraft)
  eq('J8 acuan campuran -> kind MIXED (jujur, tidak dirata-ratakan)', b3.kind, 'MIXED')
  check('J9 catatan campuran menyebut tidak sebanding', /TIDAK sebanding/i.test(b3.note), b3.note)
}

console.log('\n=== K. STORE SESI (DRAFT_ONLY, status bergerbang, nol tulisan) ===')
{
  const S = await import(pathToFileURL(path.join(SB, 'dist/modules/rap/store.mjs')).href)
  const store = S.createRapStore({ now: () => '2026-10-18T00:00:00.000Z' })
  const built = B.rabLinesFromBoqPayload(BOQ)
  const draft = store.createDraft({
    project: { id: 'p1', name: 'EA Store', kode: '100' },
    rab: built.ref,
    rab_source: 'RAB & BOQ (JSON)',
    lines: B.rapLinesFromRab(built.lines),
    rabLines: built.lines
  })
  eq('K1 mode store DRAFT_ONLY', store.mode, 'DRAFT_ONLY')
  eq('K2 draft baru berstatus DRAFT', draft.status, 'DRAFT')
  eq('K3 belum tersimpan', draft.persisted, false)
  eq('K4 belum ada tulisan DB', store.writes.length, 0)

  // status sah: DIAJUKAN (draft sehat) -> official false
  const r1 = store.changeStatus('DIAJUKAN', { by: 'admin@noir.test' })
  check('K5 DIAJUKAN diterima untuk draft sehat', r1.ok === true, r1.problem)
  eq('K6 status BUKAN approval resmi', r1.official, false)
  eq('K7 status tetap belum tersimpan', r1.persisted, false)
  eq('K8 tetap nol tulisan DB', store.writes.length, 0)

  // draft berpenghalang: harga negatif -> TIDAK boleh diajukan/disetujui
  const store2 = S.createRapStore({ now: () => '2026-10-18T00:00:00.000Z' })
  store2.createDraft({
    project: { id: 'p1', name: 'EA Store' },
    rab: { reff: 'BOQ-014' },
    lines: [{ item_name: 'Wardrobe barang jadi', material_id: null, unit: 'unit', planned_qty: 1, planned_unit_price: -100 }],
    rabLines: [{ item_name: 'Wardrobe barang jadi', unit: 'unit', rab_qty: 1, rab_unit_price: 5000000, price_source: 'RAB' }]
  })
  const blocked = store2.changeStatus('DIAJUKAN')
  check('K9 draft berpenghalang TIDAK bisa diajukan', blocked.ok === false, JSON.stringify(blocked))
  check('K10 alasan menyebut penghalang + penyebab pertama', /penghalang/i.test(blocked.problem || '') && /negatif/i.test(blocked.problem || ''), blocked.problem)
  eq('K11 status tetap DRAFT setelah penolakan', store2.snapshot().active.status, 'DRAFT')
  eq('K12 tetap nol tulisan DB', store2.writes.length, 0)

  // menyetujui juga bergerbang
  const store3 = S.createRapStore()
  store3.createDraft({ project: { id: 'p1', name: 'X' }, lines: [{ item_name: 'A', unit: 'unit', planned_qty: 0, planned_unit_price: 0 }] })
  check('K13 draft dengan qty 0 tidak bisa DISETUJUI', store3.changeStatus('DISETUJUI').ok === false)
}

console.log(`\n=== HASIL UNIT: ${pass} lulus, ${fail} gagal ===`)
if (fail) {
  console.log('Gagal:')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
