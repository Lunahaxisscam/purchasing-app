// ============================================================
// UNIT TEST — logika murni RAP (modules/rap/model.js + budgetingBridge.js)
// t_71d95cfe (S3/7). Tanpa DOM, tanpa DB.
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

console.log('\n=== A. KONVERSI HARGA RAB (ribuan -> rupiah) ===')
{
  eq('A1 harga RAB 1500 (ribu) -> 1.500.000 rupiah', M.rabPriceToRupiah(1500), 1500000)
  eq('A2 harga RAB 0 tetap 0', M.rabPriceToRupiah(0), 0)
  eq('A3 harga RAB negatif diklem ke 0', M.rabPriceToRupiah(-500), 0)
  eq('A4 harga RAB bukan angka -> 0 (bukan NaN)', M.rabPriceToRupiah('abc'), 0)
  eq('A5 parseNumberInput "1.500.000" -> 1500000', M.parseNumberInput('1.500.000'), 1500000)
  eq('A6 parseNumberInput "-5" ditolak -> null', M.parseNumberInput('-5'), null)
  eq('A7 parseNumberInput "" -> null', M.parseNumberInput(''), null)
  eq('A8 parseNumberInput "2,5" -> 2.5', M.parseNumberInput('2,5'), 2.5)
  eq('A9 formatRupiah 3000000', M.formatRupiah(3000000).replace(/\u00a0/g, ' '), 'Rp 3.000.000')
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

  const totals = M.rapTotals({ lines: res.lines })
  eq('B8 total acuan RAB = 13.250.000', totals.rabTotal, 13250000)
  eq('B9 total rencana awal = acuan', totals.rapTotal, 13250000)
  eq('B10 selisih awal 0', totals.diffAmount, 0)

  const bad = B.rabLinesFromBoqPayload({ version: 5 })
  check('B11 payload tanpa items DITOLAK (bukan array kosong)', bad.ok === false && /items/.test(bad.problems.join(' ')), JSON.stringify(bad.problems))

  const unknown = B.rabLinesFromBoqPayload({ version: 99, items: [{ item: 'X', qty: 1, unit: 'unit', price: 1 }] })
  check('B12 versi tak dikenal ditolak dengan alasan', unknown.ok === false && /99/.test(unknown.problems.join(' ')), JSON.stringify(unknown.problems))

  const nullPayload = B.rabLinesFromBoqPayload(null)
  check('B13 payload null ditolak', nullPayload.ok === false)

  const legacy = B.rabLinesFromBoqPayload({ version: 1, items: [{ item: 'Meja', qty: 1, unit: 'unit', price: 1200 }] })
  check('B14 payload v1 (legacy) tetap dibaca', legacy.ok === true && legacy.lines[0].rab_unit_price === 1200000, JSON.stringify(legacy.lines))
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
  check('C4 ada peringatan "hanya upah"', res.warnings.some(w => /upah/i.test(w)), JSON.stringify(res.warnings))
  check('C5 ada peringatan harga 0 bukan nol sesungguhnya', res.warnings.some(w => /bukan nol sesungguhnya/i.test(w)), JSON.stringify(res.warnings))

  const empty = B.rabLinesFromWbsPlans([])
  check('C6 WBS kosong -> ok:false + alasan', empty.ok === false && empty.problems.length > 0)
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

  const cmp = M.compareRapToRab(over)
  eq('D14 perbandingan memuat 3 baris', cmp.rows.length, 3)
  eq('D15 tidak ada baris RAB yang hilang', cmp.summary.missingCount, 0)
  const kitchenRow = cmp.rows.find(r => r.item_name === 'Kitchen set')
  eq('D16 selisih baris kitchen set = +8.000.000', kitchenRow.diffAmount, 8000000)
  eq('D17 status baris OVER', kitchenRow.state, 'OVER')

  // baris RAP dihapus -> harus muncul sebagai baris RAB yang belum tercakup
  const withoutBackdrop = { ...draft, lines: draft.lines.filter(l => l.item_name !== 'Backdrop TV') }
  const cmp2 = M.compareRapToRab(withoutBackdrop)
  eq('D18 baris hilang terdeteksi', cmp2.summary.missingCount, 1)
  eq('D19 nama baris hilang benar', cmp2.missingInRap[0].item_name, 'Backdrop TV')
  eq('D20 acuan RAB TIDAK menyusut walau baris dihapus', cmp2.summary.rabTotal, 13250000)
  eq('D21 total RAP tanpa backdrop = 11.000.000', cmp2.summary.rapTotal, 11000000)
  eq('D22 selisih = -2.250.000', cmp2.summary.diffAmount, -2250000)

  // baris RAP tambahan di luar RAB
  const extra = {
    ...draft,
    lines: [...draft.lines, M.normalizeLine({ item_name: 'Kerja tambah', unit: 'ls', planned_qty: 1, planned_unit_price: 500000, rab_qty: 0, rab_unit_price: 0, price_source: 'MANUAL' })]
  }
  const cmp3 = M.compareRapToRab(extra)
  eq('D23 baris di luar RAB terdeteksi', cmp3.summary.extraCount, 1)
  eq('D24 total RAP termasuk baris tambahan', cmp3.summary.rapTotal, 13750000)

  // tanpa acuan RAB sama sekali -> persen null, bukan Infinity/NaN
  const noRab = M.createRapDraft({ project: { id: 'p1', name: 'X' }, lines: [M.normalizeLine({ item_name: 'A', unit: 'unit', planned_qty: 1, planned_unit_price: 1000, rab_qty: 0, rab_unit_price: 0 })] })
  const t3 = M.rapTotals(noRab)
  check('D25 tanpa acuan: diffPct null (bukan NaN/Infinity)', t3.diffPct === null, String(t3.diffPct))
  check('D26 tanpa acuan: tidak diklaim overBudget', t3.overBudget === false)
}

console.log('\n=== E. VALIDASI (penghalang vs peringatan) ===')
{
  const built = B.rabLinesFromBoqPayload(BOQ)
  const draft = M.createRapDraft({ project: { id: 'p1', name: 'EA Store', kode: '100' }, rab: built.ref, lines: B.rapLinesFromRab(built.lines), rabLines: built.lines })
  const v1 = M.validateRap(draft)
  check('E1 draft sehat tidak punya penghalang', v1.ok === true, JSON.stringify(v1.problems))
  eq('E2 tanpa peringatan', v1.warnings.length, 0)

  const noProject = M.validateRap({ ...draft, project_id: null, project_name: '' })
  check('E3 tanpa proyek -> penghalang', noProject.ok === false && /[Pp]royek/.test(noProject.problems.join(' ')))

  const noVersion = M.validateRap({ ...draft, version: '' })
  check('E4 tanpa label versi -> penghalang', noVersion.ok === false && /versi/i.test(noVersion.problems.join(' ')))

  const zeroQty = M.validateRap({ ...draft, lines: draft.lines.map(l => (l.item_name === 'Wardrobe' ? M.normalizeLine({ ...l, planned_qty: 0 }) : l)) })
  check('E5 qty 0 -> penghalang', zeroQty.ok === false && /Qty/.test(zeroQty.problems.join(' ')))

  const zeroPrice = M.validateRap({ ...draft, lines: draft.lines.map(l => (l.item_name === 'Wardrobe' ? M.normalizeLine({ ...l, planned_unit_price: 0 }) : l)) })
  check('E6 harga 0 -> PERINGATAN (boleh lanjut)', zeroPrice.ok === true && zeroPrice.warnings.some(w => /masih 0/.test(w)), JSON.stringify(zeroPrice.warnings))

  const dup = M.validateRap({ ...draft, lines: [...draft.lines, M.normalizeLine({ ...draft.lines[0], id: 'dup-1' })] })
  check('E7 baris dobel -> penghalang (anti dobel hitung)', dup.ok === false && /lebih dari sekali/.test(dup.problems.join(' ')), JSON.stringify(dup.problems))

  const over = M.validateRap({ ...draft, lines: draft.lines.map(l => (l.item_name === 'Kitchen set' ? M.normalizeLine({ ...l, planned_qty: 3 }) : l)) })
  check('E8 total melebihi RAB -> peringatan berisi angka', over.ok === true && over.warnings.some(w => /MELEBIHI/.test(w)), JSON.stringify(over.warnings))

  const empty = M.validateRap({ ...draft, lines: [] })
  check('E9 RAP tanpa baris -> penghalang', empty.ok === false && /baris/.test(empty.problems.join(' ')))

  const noRab = M.validateRap({ ...draft, rab_reff: '', rab_lines: [] })
  check('E10 tanpa acuan RAB -> peringatan (bukan klaim aman)', noRab.warnings.some(w => /Referensi RAB/.test(w)))
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

console.log('\n=== G. KONTRAK HANDOFF KE PURCHASE REQUEST ===')
{
  const built = B.rabLinesFromBoqPayload(BOQ)
  const draft = M.createRapDraft({ project: { id: 'p1', name: 'EA Store', kode: '100' }, rab: built.ref, lines: B.rapLinesFromRab(built.lines), rabLines: built.lines })
  const planned = {
    ...draft,
    lines: draft.lines.map(l => M.normalizeLine({ ...l, planned_qty: l.planned_qty, planned_unit_price: l.planned_unit_price }))
  }
  const h = M.buildPrHandoff(planned)
  check('G1 handoff berhasil disusun', h.ok === true, JSON.stringify(h.problems))
  eq('G2 satu item per baris RAP', h.items.length, 3)
  eq('G3 request.project_id ikut proyek', h.request.project_id, 'p1')
  eq('G4 request.status DRAFT (sama dgn jalur PR existing)', h.request.status, 'DRAFT')
  eq('G5 nomor PR TIDAK dibuat di sini', h.request.pr_number, null)
  check('G6 meta menyatakan nol penulisan', h.meta.writes === 0 && h.meta.delivered === false)

  const reqKeys = Object.keys(h.request).sort()
  eq('G7 field request = kontrak PR existing', reqKeys, M.PR_REQUEST_FIELDS.slice().sort())
  const itemKeys = Object.keys(h.items[0]).sort()
  eq('G8 field item = kontrak pr_items existing (tanpa pr_id: baru ada setelah PR disimpan)', itemKeys, M.PR_ITEM_PAYLOAD_FIELDS.slice().sort())
  check('G8b pr_id TIDAK dikarang di payload', !('pr_id' in h.items[0]) && M.PR_ITEM_FIELDS_FROM_TARGET.indexOf('pr_id') >= 0)
  eq('G9 item pertama: qty & harga rencana', [h.items[0].quantity, h.items[0].estimated_price], [2, 1500000])
  eq('G10 status item PENDING_APPROVAL (konvensi PR)', h.items[0].status, 'PENDING_APPROVAL')
  eq('G11 sort_order berurutan', h.items.map(i => i.sort_order), [0, 1, 2])
  check('G12 catatan menyebut RENCANA, bukan realisasi', /RENCANA/.test(h.request.notes) && !/realisasi/i.test(h.request.notes.replace('bukan realisasi', '')), h.request.notes)
  check('G13 ringkasan material terisi', h.request.materials_summary.length > 10)

  // pilih sebagian baris saja
  const onlyOne = M.buildPrHandoff(planned, { line_ids: [planned.lines[1].id] })
  eq('G14 hanya baris terpilih yang di-handoff', onlyOne.items.length, 1)
  eq('G15 baris terpilih benar', onlyOne.items[0].item_name, 'Kitchen set')

  // tanpa proyek -> ditolak
  const noProject = M.buildPrHandoff({ ...planned, project_id: null, project_name: '' })
  check('G16 tanpa proyek handoff DITOLAK', noProject.ok === false && /project_id/.test(noProject.problems.join(' ')))

  // qty invalid -> ditolak (tidak diam-diam jadi 1)
  const badQty = M.buildPrHandoff({ ...planned, lines: planned.lines.map(l => (l.item_name === 'Wardrobe' ? { ...l, planned_qty: 0 } : l)) })
  check('G17 qty 0 DITOLAK, tidak diubah jadi 1', badQty.ok === false && /Qty rencana/.test(badQty.problems.join(' ')), JSON.stringify(badQty.problems))

  // harga 0 -> peringatan, item tetap disusun
  const zeroPrice = M.buildPrHandoff({ ...planned, lines: planned.lines.map(l => (l.item_name === 'Wardrobe' ? { ...l, planned_unit_price: 0 } : l)) })
  check('G18 harga 0 -> peringatan tapi tetap disusun', zeroPrice.ok === true && zeroPrice.warnings.some(w => /tanpa estimasi harga/.test(w)))

  // tanpa material_id -> peringatan tautan kosong
  check('G19 tanpa material_id -> peringatan tautan', h.warnings.some(w => /master material/.test(w)))
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

  check('H8 JSON rusak ditolak', M.rapFromSnapshot('{bukan json').ok === false)
  check('H9 jenis berkas lain ditolak', M.rapFromSnapshot({ kind: 'boq-draft', rap: { lines: [] } }).ok === false)
  check('H10 tanpa daftar baris ditolak', M.rapFromSnapshot({ kind: 'rap-draft', rap: {} }).ok === false)

  const badStatus = M.rapFromSnapshot({ kind: 'rap-draft', rap: { ...draft, status: 'NGARANG' } })
  eq('H11 status asing dipulihkan sebagai DRAFT', badStatus.rap.status, 'DRAFT')
}

console.log('\n=== I. KAPABILITAS (dinyatakan, bukan disembunyikan) ===')
{
  check('I1 mode persistence DRAFT_ONLY', B.RAP_CAPABILITY.persistence === 'DRAFT_ONLY')
  check('I2 tidak ada tabel RAP', B.RAP_CAPABILITY.table === null)
  check('I3 canSave false', B.RAP_CAPABILITY.canSave === false)
  check('I4 alasan menyebut migrasi dibekukan', /dibekukan/i.test(B.RAP_CAPABILITY.reason), B.RAP_CAPABILITY.reason)
}

console.log(`\n=== HASIL UNIT: ${pass} lulus, ${fail} gagal ===`)
if (fail) {
  console.log('Gagal:')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
