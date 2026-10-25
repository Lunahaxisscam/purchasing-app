// ============================================================
// scripts/project-data-map-test/crosswalk_test.mjs — RED dulu, GREEN setelah helper
// ============================================================
// Menguji KONTRAK Tahap A pada lib/projectCrosswalk.js:
//   - nomor proyek sumber -> projects.kode -> projects.id (bukan fuzzy nama)
//   - ambigu / konflik kode-code / legacy tanpa nomor / non-proyek
//   - satuan: rupiah vs ribuan TIDAK boleh ditebak
//   - hak upah vs kasbon vs pelunasan (tidak boleh double count)
//   - alokasi nota lintas proyek per item/qty, bukan total header
//   - ringkasan agregat bukan event biaya baru
//   - modul murni: tanpa import/jaringan/DB
//
// Jalankan: node crosswalk_test.mjs <REPO>
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = process.argv[2] || process.cwd()
const LIB = path.join(REPO, 'lib/projectCrosswalk.js')

let pass = 0
const fails = []
async function t(name, fn) {
  try {
    await fn()
    pass += 1
  } catch (e) {
    fails.push(`${name}: ${e.message}`)
  }
}

// ---------- fixture SINTETIS (bukan transaksi nyata) ----------
const PROJECTS = [
  { id: 'id-101', name: 'Aan - BSD', status: 'ON_GOING', kode: '101', code: '101' },
  { id: 'id-83', name: 'Josh - Mabes', status: 'ON_GOING', kode: '83', code: '83' },
  { id: 'id-61', name: 'Eric - Sunter Hijau', status: 'DONE', kode: '61', code: '61' },
  { id: 'id-99', name: 'Santi - Baroni Utara 1/87', status: 'DONE', kode: '99', code: '99' },
  { id: 'id-dup', name: 'Duplikat Kode', status: 'ON_GOING', kode: '77', code: '77' },
  { id: 'id-dup2', name: 'Duplikat Kode Lain', status: 'DONE', kode: '077', code: '77' },
  { id: 'id-conflict', name: 'Kode Code Beda', status: 'ON_GOING', kode: '55', code: '56' },
  { id: 'id-nokode', name: 'Tanpa Kode', status: 'ON_GOING', kode: null, code: null }
]

const ALIAS_ROWS = [
  { project_no: '99', aliases: 'Baroni' },
  { project_no: '83', aliases: 'pangjay mabes, Mabes' },
  { project_no: '61', aliases: '' }
]

const lib = await import(pathToFileURL(LIB).href)
const {
  BLANK,
  normalizeProjectNo,
  buildProjectIndex,
  buildAliasIndex,
  resolveProject,
  suggestCandidates,
  parseSourceAmount,
  toIdr,
  UNIT_CONTRACT,
  laborSettlement,
  allocateNoteByItems,
  costEventKey,
  costNoteKey,
  reconcileCostSources
} = lib

// ---------------------------------------------------------------- identitas
await t('nomor proyek: string angka dinormalisasi, leading zero dicatat', () => {
  const n = normalizeProjectNo('083')
  assert.equal(n.kind, 'number')
  assert.equal(n.canonical, '83')
  assert.ok(n.formatIssues.includes('leading_zero'))
})

await t('nomor proyek: kosong/blank bukan 0', () => {
  for (const v of ['', '   ', null, undefined]) {
    const n = normalizeProjectNo(v)
    assert.equal(n.kind, BLANK)
    assert.equal(n.canonical, null)
  }
})

await t('nomor proyek: teks non-proyek (operasional ws) tidak jadi nomor', () => {
  const n = normalizeProjectNo('operasional ws')
  assert.equal(n.kind, 'non_project')
  assert.equal(n.canonical, null)
  assert.equal(n.text, 'operasional ws')
})

await t('index proyek menandai konflik kode vs code', () => {
  const idx = buildProjectIndex(PROJECTS)
  const issues = idx.issues.map(i => i.type)
  assert.ok(issues.includes('kode_code_conflict'))
  const c = idx.issues.find(i => i.type === 'kode_code_conflict')
  assert.equal(c.kode, '55')
  assert.equal(c.code, '56')
})

await t('index proyek menandai nomor duplikat sebagai ambiguous', () => {
  const idx = buildProjectIndex(PROJECTS)
  const r = resolveProject({ sourceRow: { project_no: '77' }, index: idx, aliases: buildAliasIndex([]) })
  assert.equal(r.state, 'ambiguous')
  assert.equal(r.candidates.length, 2)
})

await t('index proyek: baris tanpa kode dilaporkan, tidak dibuang diam-diam', () => {
  const idx = buildProjectIndex(PROJECTS)
  assert.ok(idx.issues.some(i => i.type === 'missing_kode' && i.projectId === 'id-nokode'))
})

// ------------------------------------------------------------ resolver inti
const idx = buildProjectIndex(PROJECTS)
const aliases = buildAliasIndex(ALIAS_ROWS)

await t('resolve: nomor cocok -> id stabil (bukan nama)', () => {
  const r = resolveProject({ sourceRow: { project_no: '101', project_name: 'apapun' }, index: idx, aliases })
  assert.equal(r.state, 'matched')
  assert.equal(r.projectId, 'id-101')
  assert.equal(r.kode, '101')
  assert.equal(r.evidence.method, 'project_no')
})

await t('resolve: nomor dengan leading zero tetap cocok dan dicatat formatnya', () => {
  const r = resolveProject({ sourceRow: { project_no: '083' }, index: idx, aliases })
  assert.equal(r.state, 'matched')
  assert.equal(r.projectId, 'id-83')
  assert.ok(r.evidence.formatIssues.includes('leading_zero'))
})

await t('resolve: alias terkonfirmasi sumber boleh, ditandai method alias', () => {
  const r = resolveProject({ sourceRow: { project_name: 'Baroni' }, index: idx, aliases })
  assert.equal(r.state, 'matched')
  assert.equal(r.projectId, 'id-99')
  assert.equal(r.evidence.method, 'alias')
})

await t('resolve: nama mirip TANPA alias konfirmasi TIDAK dijadikan relasi', () => {
  // "Proyek Sunter Hijau - Eric" mirip "Eric - Sunter Hijau" tapi tidak persis
  const r = resolveProject({ sourceRow: { project_name: 'Proyek Sunter Hijau 8' }, index: idx, aliases })
  assert.equal(r.state, 'not_found')
  assert.equal(r.projectId, null)
})

await t('resolve: nomor tidak dikenal -> not_found, bukan proyek pertama', () => {
  const r = resolveProject({ sourceRow: { project_no: '49', project_name: 'Project Intercon' }, index: idx, aliases })
  assert.equal(r.state, 'not_found')
  assert.equal(r.projectId, null)
  assert.equal(r.kode, '49')
})

await t('resolve: baris non-proyek (operasional ws) -> non_project', () => {
  const r = resolveProject({ sourceRow: { project_no: 'operasional ws' }, index: idx, aliases })
  assert.equal(r.state, 'non_project')
})

await t('resolve: proyek archived (DONE) tetap bisa dipetakan, status dilaporkan', () => {
  const r = resolveProject({ sourceRow: { project_no: '61' }, index: idx, aliases })
  assert.equal(r.state, 'matched')
  assert.equal(r.projectStatus, 'DONE')
})

await t('suggestCandidates: nama hanya kandidat, tidak pernah matched', () => {
  const c = suggestCandidates('Proyek Sunter Hijau - Eric', PROJECTS)
  assert.ok(c.length >= 1)
  assert.ok(c.every(x => x.reason === 'name_similarity'))
  assert.equal(c.some(x => x.state === 'matched'), false)
})

// --------------------------------------------------------------- angka/satuan
await t('parse: format Indonesia & US dua-duanya benar', () => {
  assert.equal(parseSourceAmount('15.000,76').amount, 15000.76)
  assert.equal(parseSourceAmount('15,000.76').amount, 15000.76)
  assert.equal(parseSourceAmount('12,5').amount, 12.5)
  assert.equal(parseSourceAmount('12.5').amount, 12.5)
})

await t('parse: "Rp 10,345,000" -> 10345000 tanpa dikali 1000', () => {
  const p = parseSourceAmount('Rp 10,345,000')
  assert.equal(p.amount, 10345000)
  assert.equal(p.format, 'id')
})

await t('parse: strip "-" / "(-Rp 9,500)" bukan nol', () => {
  assert.equal(parseSourceAmount('-').amount, null)
  assert.equal(parseSourceAmount('-').format, 'blank')
  assert.equal(parseSourceAmount('(-Rp 9,500)').amount, -9500)
})

await t('parse: teks acak -> null, bukan 0', () => {
  assert.equal(parseSourceAmount('n/a').amount, null)
  assert.equal(parseSourceAmount('').amount, null)
})

await t('parse: satu pemisah 3 digit ditandai ambigu, tidak dikali 1000', () => {
  const p = parseSourceAmount('1.500')
  assert.equal(p.amount, 1500)
  assert.equal(p.ambiguous, true)
})

await t('satuan: sumber terverifikasi rupiah -> scale 1', () => {
  const r = toIdr({ amount: 10345000, sourceKey: 'upah_list_proyek.total_upah' })
  assert.equal(r.idr, 10345000)
  assert.equal(r.scale, 1)
  assert.ok(r.evidence.length > 0)
})

await t('satuan: sumber TIDAK terverifikasi -> null, bukan dikali 1000', () => {
  const r = toIdr({ amount: 5000, sourceKey: 'sumber.tidak.dikenal' })
  assert.equal(r.idr, null)
  assert.equal(r.reason, 'UNIT_UNVERIFIED')
})

await t('satuan: konversi hanya sekali (idempotent, tidak ada double scale)', () => {
  const once = toIdr({ amount: 1000, sourceKey: 'upah_dashboard.hak_upah' })
  const again = toIdr({ amount: once.idr, sourceKey: 'upah_dashboard.hak_upah', alreadyIdr: true })
  assert.equal(again.idr, 1000)
  assert.equal(again.reason, 'ALREADY_IDR')
})

await t('registry satuan: setiap entri punya bukti, bukan asumsi', () => {
  for (const [k, v] of Object.entries(UNIT_CONTRACT)) {
    assert.equal(v.scale, 1, `${k} scale harus 1 (rupiah)`)
    assert.ok(Array.isArray(v.evidence) && v.evidence.length > 0, `${k} perlu evidence`)
    assert.ok(v.verified === true, `${k} harus verified`)
  }
})

// ------------------------------------------------------------- upah/settlement
await t('upah: costRecognized = hak, kasbon+pelunasan pembayaran (tidak dobel)', () => {
  const s = laborSettlement({ hak: 507538700, kasbon: 422172000, pelunasan: 78411000 })
  assert.equal(s.costRecognized, 507538700)
  assert.equal(s.paidToDate, 500583000)
  assert.equal(s.outstanding, 6955700)
  assert.equal(s.doubleCounted, false)
  assert.equal(
    s.components.reduce((a, c) => a + (c.countedAsSeparateCost ? c.amount : 0), 0),
    0,
    'tidak ada komponen yang dihitung sebagai biaya tambahan'
  )
})

await t('upah: selisih saldo mengikuti formula sumber (hak - kasbon - pelunasan)', () => {
  // Sumber menulis "-" untuk pelunasan kosong; lapisan data boleh mengisi 0
  // HANYA bila sumber menegaskan nilai, di sini kita beri 0 eksplisit.
  const s = laborSettlement({ hak: 10345000, kasbon: 9500000, pelunasan: 0 })
  assert.equal(s.outstanding, 845000)
  assert.equal(s.paidToDate, 9500000)
  assert.equal(s.formula, 'hak - kasbon - pelunasan')
})

await t('upah: pelunasan belum tercatat -> saldo null, bukan dianggap 0', () => {
  const s = laborSettlement({ hak: 10345000, kasbon: 9500000, pelunasan: null })
  assert.equal(s.outstanding, null)
  assert.equal(s.completeness, 'partial')
  assert.equal(s.paidToDate, 9500000)
})

await t('upah: angka tidak lengkap -> null, bukan 0', () => {
  const s = laborSettlement({ hak: 1000, kasbon: null, pelunasan: null })
  assert.equal(s.outstanding, null)
  assert.equal(s.paidToDate, null)
  assert.equal(s.costRecognized, 1000)
  assert.equal(s.completeness, 'partial')
})

await t('upah: formula app lama (hak - kasbon + pelunasan) ditolak oleh validator', () => {
  const { checkSaldoFormula } = lib
  const bad = checkSaldoFormula({ hak: 507538700, kasbon: 422172000, pelunasan: 78411000, saldo: 507538700 - 422172000 + 78411000 })
  assert.equal(bad.ok, false)
  const good = checkSaldoFormula({ hak: 507538700, kasbon: 422172000, pelunasan: 78411000, saldo: 6955700 })
  assert.equal(good.ok, true)
})

// ------------------------------------------------------- alokasi nota & dedupe
await t('alokasi: satu nota lintas proyek dibagi per item/qty, bukan total header', () => {
  const r = allocateNoteByItems({
    headerTotal: 1000000,
    items: [
      { project_no: '101', qty: 2, unitPrice: 250000 },
      { project_no: '83', qty: 1, unitPrice: 500000 }
    ]
  })
  assert.equal(r.byProject.get('101'), 500000)
  assert.equal(r.byProject.get('83'), 500000)
  assert.equal(r.allocated, 1000000)
  assert.equal(r.unallocated, 0)
  assert.equal(r.balanced, true)
  // total header TIDAK ditaruh utuh di setiap proyek
  assert.ok(r.byProject.get('101') !== r.headerTotal)
})

await t('alokasi: selisih header vs item dilaporkan, bukan dirapatkan diam-diam', () => {
  const r = allocateNoteByItems({
    headerTotal: 1000000,
    items: [{ project_no: '101', qty: 1, unitPrice: 400000 }]
  })
  assert.equal(r.allocated, 400000)
  assert.equal(r.unallocated, 600000)
  assert.equal(r.balanced, false)
  assert.ok(r.issues.some(i => i.type === 'unallocated_amount'))
})

await t('alokasi: item tanpa proyek -> unassigned, tidak ditebak', () => {
  const r = allocateNoteByItems({
    headerTotal: 500000,
    items: [{ project_no: '', qty: 1, unitPrice: 500000 }]
  })
  assert.equal(r.byProject.size, 0)
  assert.equal(r.unassigned, 500000)
  assert.equal(r.balanced, false)
})

await t('dedupe: kunci item (cost id) dan kunci nota (invoice/doc) dibedakan', () => {
  assert.equal(costEventKey(' COST-0001 '), 'COST0001')
  assert.equal(costNoteKey('DOC-0001'), 'DOC0001')
  assert.equal(costNoteKey('PUR-0001'), 'PUR0001')
  assert.notEqual(costEventKey('COST-0001'), costNoteKey('DOC-0001'))
})

await t('reconcile: nota yang sama di app & sheet tidak dihitung dua kali', () => {
  const r = reconcileCostSources({
    appNotes: [
      { key: 'INV/001', project_no: '101', total: 750000 },
      { key: 'INV/002', project_no: '83', total: 250000 }
    ],
    sheetItems: [
      { cost_id: 'COST-1', doc_ref: 'INV/001', project_no: '101', total: 750000 },
      { cost_id: 'COST-2', doc_ref: 'INV/003', project_no: '99', total: 100000 }
    ],
    summaryRows: [
      { project_no: '101', cumulative_cost: 750000 },
      { project_no: '83', cumulative_cost: 250000 },
      { project_no: '99', cumulative_cost: 100000 }
    ]
  })
  assert.equal(r.events, 3, 'INV/001 hanya satu event walau muncul di app & sheet')
  assert.equal(r.aggregateCountedAsEvent, false)
  assert.deepEqual(r.matched.sort(), ['INV/001'])
  assert.deepEqual(r.onlyApp.sort(), ['INV/002'])
  assert.deepEqual(r.onlySheet.sort(), ['INV/003'])
  assert.equal(r.byProject.get('101'), 750000)
})

await t('reconcile: ringkasan agregat TIDAK boleh menambah event', () => {
  const r = reconcileCostSources({
    appNotes: [],
    sheetItems: [{ cost_id: 'COST-9', doc_ref: 'INV/9', project_no: '99', total: 400000 }],
    summaryRows: [{ project_no: '99', cumulative_cost: 400000 }, { project_no: '99', cumulative_cost: 400000 }]
  })
  assert.equal(r.events, 1)
  assert.equal(r.byProject.get('99'), 400000)
  assert.ok(r.warnings.some(w => w.type === 'summary_equals_events'))
})

await t('reconcile: baris tanpa referensi nota tetap dihitung & dilaporkan', () => {
  const r = reconcileCostSources({
    appNotes: [],
    sheetItems: [
      { cost_id: 'COST-1', doc_ref: 'INV/1', project_no: '99', total: 100 },
      { cost_id: 'COST-2', doc_ref: '', project_no: '99', total: 50 }
    ],
    summaryRows: []
  })
  assert.equal(r.events, 2)
  assert.deepEqual(r.notesWithoutKey, ['COST2'])
  assert.equal(r.byProject.get('99'), 150)
})

// ------------------------------------------------------------------ kemurnian
await t('modul murni: tanpa import, tanpa jaringan/DB, tanpa tulis', () => {
  const src = fs.readFileSync(LIB, 'utf8')
  assert.equal(/^\s*import\s/m.test(src), false, 'tidak boleh ada import')
  assert.equal(/\bfetch\s*\(/.test(src), false, 'tidak boleh fetch')
  assert.equal(/supabase/i.test(src), false, 'tidak boleh supabase')
  assert.equal(/\b(localStorage|window|document)\b/.test(src), false, 'harus bebas DOM')
})

// -------------------------------------------------------------------- laporan
console.log(JSON.stringify({ pass, fail: fails.length, failures: fails }, null, 2))
if (fails.length) {
  console.error('\nFAILURES:\n' + fails.map(f => ' - ' + f).join('\n'))
  process.exit(1)
}
