// ============================================================
// scripts/project-data-map/dryrun.mjs — DRY-RUN kontrak Tahap A
// ============================================================
// Menjalankan lib/projectCrosswalk.js terhadap SNAPSHOT SUMBER NYATA
// (read-only, snapshot privat di /home/ubuntu/agents/bamboo/...) lalu
// menghitung: matched / alias / ambiguous / not_found / non_project /
// format_invalid, bukti satuan, settlement upah, dan rekonsiliasi material.
//
// Output:
//   <out-private>.json : lengkap (boleh berisi angka) — TIDAK masuk git
//   <out-git>.json     : anonim (hanya status/jumlah, tanpa nominal) — masuk git
//
// Tidak menulis DB/Drive, tidak memanggil jaringan.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [cwPath, snapPath, closingPath, detailPath, outPrivate, outGit] = process.argv.slice(2)
for (const [i, p] of [cwPath, snapPath, closingPath, detailPath, outPrivate, outGit].entries()) {
  if (!p) { console.error('argumen kurang: index', i); process.exit(2) }
}
const LIB = process.env.CW_LIB
if (!LIB) { console.error('CW_LIB belum diisi'); process.exit(2) }

const C = await import(pathToFileURL(LIB).href)
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))

const cw = read(cwPath)
const snap = read(snapPath)
const closing = read(closingPath)
const detail = read(detailPath)

const projects = cw.projects || []
const index = C.buildProjectIndex(projects)
const aliases = C.buildAliasIndex(cw.drive_project_master || [])

const tally = { matched: 0, ambiguous: 0, not_found: 0, non_project: 0, format_invalid: 0, blank: 0 }
const perSource = {}
function record(source, row, rowLabel) {
  const r = C.resolveProject({ sourceRow: row, index, aliases })
  tally[r.state] = (tally[r.state] || 0) + 1
  perSource[source] = perSource[source] || []
  perSource[source].push({
    label: rowLabel,
    state: r.state,
    method: r.evidence && r.evidence.method,
    kode: r.kode,
    projectId: r.projectId,
    projectStatus: r.projectStatus,
    reason: r.reason
  })
  return r
}

// 1) master Drive
for (const m of cw.drive_project_master || []) {
  record('rekap_cost.project_master', { project_no: m.project_no, project_name: m.project_name }, m.project_no || m.project_name)
}
// 2) List Proyek upah
for (const [src, rows] of Object.entries(cw.upah_list_proyek || {})) {
  for (const r of rows) record(`upah.${src}.list_proyek`, { project_no: r.no, project_name: r.name }, r.no || r.name)
}
// 3) tab CLOSING (hanya punya nama tab)
for (const tab of snap.closing_tabs || []) {
  record('closing.tab', { project_name: tab }, tab)
}

// 4) satuan — pastikan tidak ada perkalian
const unitChecks = []
const samples = [
  ['upah_list_proyek.total_upah', cw.upah_list_proyek && cw.upah_list_proyek.upah_pujon && cw.upah_list_proyek.upah_pujon[0] && cw.upah_list_proyek.upah_pujon[0].total_upah_raw],
  ['upah_dashboard.hak_upah', (detail['dashboard:pujon:FORMATTED_VALUE'] || [])[4]?.[1]],
  ['rekap_cost.cost_items.total_biaya', (cw.cost_items || [])[0]?.total],
  ['rekap_cost.project_summary.cumulative_cost', (snap.ranges['rekap_cost:PROJECT SUMMARY!A1:N400'] || [])[1]?.[4]]
]
for (const [key, raw] of samples) {
  const parsed = C.parseSourceAmount(raw)
  const conv = C.toIdr({ amount: parsed.amount, sourceKey: key })
  unitChecks.push({
    sourceKey: key, raw, parsedAmount: parsed.amount, format: parsed.format,
    ambiguous: parsed.ambiguous, scale: conv.scale, idr: conv.idr, reason: conv.reason,
    evidenceCount: (conv.evidence || []).length
  })
}
const unitUnverified = unitChecks.filter(u => u.reason !== 'VERIFIED').length

// 5) settlement upah per tukang + cek formula saldo
const settlements = []
for (const src of ['asep', 'pujon']) {
  const v = (detail[`dashboard:${src}:UNFORMATTED_VALUE`] || [])[4] || []
  const s = C.laborSettlement({ hak: v[1], kasbon: v[4], pelunasan: v[7] })
  const chk = C.checkSaldoFormula({ hak: v[1], kasbon: v[4], pelunasan: v[7], saldo: v[9] })
  settlements.push({
    tukang: src, completeness: s.completeness, outstanding: s.outstanding,
    paidToDate: s.paidToDate, costRecognized: s.costRecognized,
    saldoFormulaOk: chk.ok, saldoExpected: chk.expected, saldoSource: chk.actual,
    doubleCounted: s.doubleCounted
  })
}

// 6) material: event vs agregat, plus alokasi per nota
const sheetItems = (cw.cost_items || []).filter(c => (c.status || '').toUpperCase() === 'CONFIRMED')
const summaryRows = (snap.ranges['rekap_cost:PROJECT SUMMARY!A1:N400'] || []).slice(1)
  .filter(r => r && r[0])
  .map(r => ({ project_no: r[0], cumulative_cost: r[4] }))
const recon = C.reconcileCostSources({ appNotes: [], sheetItems, summaryRows })

// nota yang mencakup >1 proyek (alokasi wajib per item, bukan header)
const noteProjects = new Map()
for (const c of sheetItems) {
  const k = C.costNoteKey(c.purchase_id)
  if (!noteProjects.has(k)) noteProjects.set(k, new Set())
  noteProjects.get(k).add(String(c.project_no).trim())
}
const multiProjectNotes = [...noteProjects.entries()].filter(([, v]) => v.size > 1).map(([k, v]) => ({ key: k, projects: [...v] }))

// alokasi contoh nota pertama yang multi-proyek (kalau ada) + cek semua nota
let allocationDemo = null
const bucketOf = raw => {
  const n = C.normalizeProjectNo(raw)
  if (n.kind === C.NUMBER) return 'project'
  if (n.kind === C.NON_PROJECT) return 'overhead'
  return 'blank'
}
const itemBuckets = sheetItems.map(c => ({
  note: C.costNoteKey(c.purchase_id) || ('ITEM:' + C.costEventKey(c.cost_id)),
  bucket: bucketOf(c.project_no),
  amount: C.parseSourceAmount(c.total).amount || 0
}))
const noteAgg = new Map()
for (const it of itemBuckets) {
  const a = noteAgg.get(it.note) || { project: 0, overhead: 0, blank: 0 }
  a[it.bucket] += it.amount
  noteAgg.set(it.note, a)
}
let notesBalanced = 0
let notesUnbalanced = 0
let notesWithBlankProject = 0
let overheadAmount = 0
let overheadItems = 0
let blankAmount = 0
let blankItems = 0
for (const [, a] of noteAgg.entries()) {
  if (a.blank === 0) notesBalanced += 1
  else { notesUnbalanced += 1; notesWithBlankProject += 1 }
}
for (const it of itemBuckets) {
  if (it.bucket === 'overhead') { overheadItems += 1; overheadAmount += it.amount }
  if (it.bucket === 'blank') { blankItems += 1; blankAmount += it.amount }
}
for (const [key, projSet] of noteProjects.entries()) {
  if (allocationDemo) break
  if (projSet.size <= 1) continue
  const items = sheetItems.filter(c => C.costNoteKey(c.purchase_id) === key)
    .map(c => ({ project_no: c.project_no, total: C.parseSourceAmount(c.total).amount }))
  const header = items.reduce((a, it) => a + (it.total || 0), 0)
  const alloc = C.allocateNoteByItems({ headerTotal: header, items })
  allocationDemo = {
    noteKey: key, itemCount: items.length,
    projects: [...alloc.byProject.keys()], balanced: alloc.balanced,
    unallocated: alloc.unallocated, unassigned: alloc.unassigned
  }
}

// 7) kandidat nama (contoh nyata: baris upah tanpa nomor)
const nameOnly = []
for (const [src, rows] of Object.entries(cw.upah_list_proyek || {})) {
  for (const r of rows) {
    if (C.normalizeProjectNo(r.no).kind === C.NUMBER) continue
    nameOnly.push({
      source: src, name: r.name,
      candidates: C.suggestCandidates(r.name, projects).map(c => ({ kode: c.kode, score: c.score }))
    })
  }
}

const evidence = {
  generatedAt: new Date().toISOString(),
  helper: 'lib/projectCrosswalk.js',
  inputs: { crosswalkAudit: path.basename(cwPath), sourceSnapshot: path.basename(snapPath) },
  master: {
    projectsRows: projects.length,
    uniqueKode: index.byKode.size,
    issues: index.issues
  },
  tally,
  perSourceCounts: Object.fromEntries(Object.entries(perSource).map(([k, v]) => [k, v.length])),
  unitChecks,
  unitUnverified,
  settlements,
  material: {
    events: recon.events,
    matchedNotes: recon.matched.length,
    onlyApp: recon.onlyApp.length,
    onlySheet: recon.onlySheet.length,
    aggregateCountedAsEvent: recon.aggregateCountedAsEvent,
    summaryRows: summaryRows.length,
    warnings: recon.warnings,
    perProject: [...new Set([
      ...recon.byProject.keys(),
      ...summaryRows.map(r => C.normalizeProjectNo(r.project_no)).filter(n => n.kind === C.NUMBER).map(n => n.canonical)
    ])].sort().map(kode => {
      const ev = recon.byProject.get(kode) || null
      const sum = summaryRows
        .filter(r => C.normalizeProjectNo(r.project_no).canonical === kode)
        .map(r => C.parseSourceAmount(r.cumulative_cost).amount)[0]
      return { kode, events: ev, summary: sum === undefined ? null : sum,
        equal: Math.round(ev || 0) === Math.round(sum || 0) }
    }),
    multiProjectNotes: multiProjectNotes.length,
    nonNumericProjectNo: [...new Set(sheetItems.map(c => String(c.project_no || '').trim()))]
      .filter(v => C.normalizeProjectNo(v).kind !== C.NUMBER)
      .map(v => ({ value: v === '' ? '(kosong)' : v, count: sheetItems.filter(c => String(c.project_no || '').trim() === v).length })),
    notesBalanced,
    notesUnbalanced,
    notesWithBlankProject,
    overheadItems,
    overheadAmount,
    blankItems,
    blankAmount,
    notesWithoutKey: recon.notesWithoutKey,
    allocationDemo
  },
  nameOnlyRows: nameOnly.length,
  nameOnlySample: nameOnly.slice(0, 5)
}

fs.mkdirSync(path.dirname(outPrivate), { recursive: true })
fs.writeFileSync(outPrivate, JSON.stringify({ ...evidence, perSource }, null, 1))

// ---- versi git: tanpa nominal, tanpa nama proyek/tukang nyata ----
const sanitized = {
  generatedAt: evidence.generatedAt,
  helper: evidence.helper,
  note: 'Angka nominal & nama proyek asli tidak disimpan di git; snapshot lengkap ada di folder audit privat.',
  master: {
    projectsRows: evidence.master.projectsRows,
    uniqueKode: evidence.master.uniqueKode,
    issueTypes: [...new Set(evidence.master.issues.map(i => i.type))],
    issueCount: evidence.master.issues.length
  },
  tally: evidence.tally,
  perSourceCounts: evidence.perSourceCounts,
  unitChecks: evidence.unitChecks.map(u => ({
    sourceKey: u.sourceKey, format: u.format, ambiguous: u.ambiguous, scale: u.scale,
    reason: u.reason, evidenceCount: u.evidenceCount
  })),
  unitUnverified: evidence.unitUnverified,
  settlements: evidence.settlements.map(s => ({
    tukang: s.tukang, completeness: s.completeness, saldoFormulaOk: s.saldoFormulaOk,
    doubleCounted: s.doubleCounted, outstandingIsNull: s.outstanding === null
  })),
  material: {
    events: evidence.material.events,
    matchedNotes: evidence.material.matchedNotes,
    onlyApp: evidence.material.onlyApp,
    onlySheet: evidence.material.onlySheet,
    aggregateCountedAsEvent: evidence.material.aggregateCountedAsEvent,
    summaryRows: evidence.material.summaryRows,
    warningTypes: evidence.material.warnings.map(w => w.type),
    multiProjectNotes: evidence.material.multiProjectNotes,
    notesBalanced: evidence.material.notesBalanced,
    notesUnbalanced: evidence.material.notesUnbalanced,
    notesWithBlankProject: evidence.material.notesWithBlankProject,
    overheadItems: evidence.material.overheadItems,
    blankItems: evidence.material.blankItems,
    notesWithoutKey: evidence.material.notesWithoutKey.length,
    perProjectEqual: evidence.material.perProject.filter(p => p.equal).length,
    perProjectRows: evidence.material.perProject.length,
    allocationDemo: evidence.material.allocationDemo
      ? { itemCount: evidence.material.allocationDemo.itemCount, balanced: evidence.material.allocationDemo.balanced,
          unallocated: evidence.material.allocationDemo.unallocated, projects: evidence.material.allocationDemo.projects }
      : null
  },
  nameOnlyRows: evidence.nameOnlyRows,
  nameOnlyWithCandidate: evidence.nameOnlySample.filter(n => n.candidates.length).length
}
fs.mkdirSync(path.dirname(outGit), { recursive: true })
fs.writeFileSync(outGit, JSON.stringify(sanitized, null, 2))

console.log(JSON.stringify({
  ok: true,
  tally,
  perSourceCounts: sanitized.perSourceCounts,
  unitUnverified: evidence.unitUnverified,
  settlements: evidence.settlements,
  material: sanitized.material,
  nameOnlyRows: evidence.nameOnlyRows,
  masterIssues: evidence.master.issues.map(i => i.type)
}, null, 2))
