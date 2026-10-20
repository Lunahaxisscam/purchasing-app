// ============================================================
// scripts/project-data-map-test/regression_integrator.mjs
// REGRESI VERIFICATION_A (dikerjakan lane integrasi Tahap B, t_da4a9ef8)
// ============================================================
// Brooklyn mereproduksi TIGA kegagalan pada helper Tahap A. File ini mengunci
// perbaikannya supaya tidak kembali:
//   R1. costNoteKey('A-12') === costNoteKey('A1-2') -> kunci fuzzy BUKAN
//       identitas; identitas wajib literal mentah + namespace kanal/vendor.
//   R2. reconcileCostSources membuang alokasi proyek kedua saat dua appNotes
//       punya kunci sama -> SEMUA alokasi harus tetap ada / konflik ditandai.
//   R3. master kode 83 / code 99 punya konflik, tetapi resolveProject('83')
//       tetap 'matched' -> resolver WAJIB fail closed.
//
// Fixture di bawah SINTETIS dan anonim (bukan transaksi nyata).
// Jalankan: node regression_integrator.mjs <REPO>
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = process.argv[2] || process.cwd()
const LIB = path.join(REPO, 'lib/projectCrosswalk.js')
const lib = await import(pathToFileURL(LIB).href)

const {
  buildProjectIndex,
  buildAliasIndex,
  resolveProject,
  costNoteKey,
  noteIdentity,
  noteCandidateMatches,
  reconcileCostSources
} = lib

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

// ------------------------------------------------------------------ R1
await t('R1a: costNoteKey tetap menabrak A-12 vs A1-2 (dokumentasi bahaya)', () => {
  assert.equal(costNoteKey('A-12'), costNoteKey('A1-2'))
  assert.equal(costNoteKey('A-12'), 'A12')
})

await t('R1b: noteIdentity mempertahankan literal mentah (bukan fuzzy)', () => {
  const a = noteIdentity({ rawRef: 'A-12', channel: 'telegram', vendorId: 'v1' })
  const b = noteIdentity({ rawRef: 'A1-2', channel: 'telegram', vendorId: 'v1' })
  assert.ok(a.ok && b.ok)
  assert.notEqual(a.exactKey, b.exactKey, 'literal berbeda tidak boleh punya identitas sama')
  assert.equal(a.raw, 'A-12')
  assert.equal(b.raw, 'A1-2')
})

await t('R1c: namespace vendor/kanal memisahkan nota bernomor sama', () => {
  const tg = noteIdentity({ rawRef: 'INV/9', channel: 'telegram', vendorId: 'vA' })
  const wa = noteIdentity({ rawRef: 'INV/9', channel: 'whatsapp', vendorId: 'vA' })
  const adm = noteIdentity({ rawRef: 'INV/9', channel: 'admin', vendorId: 'vA' })
  const otherVendor = noteIdentity({ rawRef: 'INV/9', channel: 'telegram', vendorId: 'vB' })
  const all = new Set([tg.exactKey, wa.exactKey, adm.exactKey, otherVendor.exactKey])
  assert.equal(all.size, 4, 'kanal/vendor berbeda harus jadi identitas berbeda')
})

await t('R1d: kandidat fuzzy dilaporkan sebagai fuzzy_only, bukan digabung', () => {
  const m = noteCandidateMatches(
    { rawRef: 'A-12', channel: 'telegram' },
    { rawRef: 'A1-2', channel: 'whatsapp' }
  )
  assert.equal(m.candidate, true)
  assert.equal(m.same, 'fuzzy_only')
  assert.ok(/bukti tambahan/.test(m.reason))
})

await t('R1e: nota tanpa referensi tidak diberi identitas', () => {
  const n = noteIdentity({ rawRef: '   ' })
  assert.equal(n.ok, false)
  assert.equal(n.exactKey, null)
  assert.equal(n.reason, 'NO_REFERENCE')
})

// ------------------------------------------------------------------ R2
await t('R2a: dua appNotes kunci fuzzy sama -> SEMUA alokasi proyek dipertahankan', () => {
  const r = reconcileCostSources({
    appNotes: [
      { key: 'A-12', channel: 'telegram', project_no: '83', total: 100 },
      { key: 'A1-2', channel: 'whatsapp', project_no: '99', total: 200 }
    ],
    sheetItems: [],
    summaryRows: []
  })
  assert.equal(r.events, 2, 'dua literal berbeda = dua event, tidak dimerge')
  assert.equal(r.byProject.get('83'), 100, 'alokasi proyek 83 hilang')
  assert.equal(r.byProject.get('99'), 200, 'alokasi proyek 99 hilang')
  assert.ok(r.warnings.some(w => w.type === 'note_key_collision'), 'tabrakan kunci harus ditandai')
})

await t('R2b: appNote dengan rincian allocations lintas proyek tidak kehilangan salah satu', () => {
  const r = reconcileCostSources({
    appNotes: [{
      key: 'INV/77', channel: 'admin', total: 300,
      allocations: [{ project_no: '83', total: 100 }, { project_no: '99', total: 200 }]
    }],
    sheetItems: [{ cost_id: 'C1', doc_ref: 'INV/77', project_no: '83', total: 100 },
      { cost_id: 'C2', doc_ref: 'INV/77', project_no: '99', total: 200 }],
    summaryRows: []
  })
  assert.equal(r.events, 1)
  assert.equal(r.byProject.get('83'), 100)
  assert.equal(r.byProject.get('99'), 200)
})

await t('R2c: total header != jumlah alokasi ditandai, alokasi tetap utuh', () => {
  const r = reconcileCostSources({
    appNotes: [{
      key: 'INV/88', channel: 'admin', total: 999,
      allocations: [{ project_no: '83', total: 100 }, { project_no: '99', total: 200 }]
    }],
    sheetItems: [],
    summaryRows: []
  })
  assert.equal(r.byProject.get('83'), 100)
  assert.equal(r.byProject.get('99'), 200)
  assert.ok(r.warnings.some(w => w.type === 'app_note_allocation_mismatch'))
})

await t('R2d: referensi yang hanya mirip antar-kanal TIDAK digabung diam-diam', () => {
  const r = reconcileCostSources({
    appNotes: [{ key: 'A-12', channel: 'telegram', project_no: '83', total: 100 }],
    sheetItems: [{ cost_id: 'C1', doc_ref: 'A1-2', project_no: '83', total: 100 }],
    summaryRows: []
  })
  assert.equal(r.events, 2, 'literal beda tidak boleh dianggap satu nota')
  assert.equal(r.byProject.get('83'), 200, 'biaya tidak boleh digabung/hilang')
  assert.ok(r.warnings.some(w => w.type === 'fuzzy_ref_only'))
})

await t('R2e: nota identik lintas app & sheet tetap satu event (tidak dobel)', () => {
  const r = reconcileCostSources({
    appNotes: [{ key: 'INV/001', channel: 'admin', source: 'app', project_no: '101', total: 750 }],
    sheetItems: [{ cost_id: 'C1', doc_ref: 'INV/001', project_no: '101', total: 750 }],
    summaryRows: []
  })
  assert.equal(r.events, 1)
  assert.equal(r.byProject.get('101'), 750)
  assert.deepEqual(r.matched, ['INV/001'])
})

await t('R2f: alokasi proyek yang hanya ada di sheet dipertahankan + ditandai', () => {
  const r = reconcileCostSources({
    appNotes: [{ key: 'INV/5', channel: 'admin', total: 100, allocations: [{ project_no: '83', total: 100 }] }],
    sheetItems: [
      { cost_id: 'C1', doc_ref: 'INV/5', project_no: '83', total: 100 },
      { cost_id: 'C2', doc_ref: 'INV/5', project_no: '99', total: 50 }
    ],
    summaryRows: []
  })
  assert.equal(r.byProject.get('83'), 100)
  assert.equal(r.byProject.get('99'), 50, 'alokasi tambahan dari sheet tidak boleh dibuang')
  assert.ok(r.warnings.some(w => w.type === 'allocation_only_in_sheet'))
})

// ------------------------------------------------------------------ R3
await t('R3a: konflik kode vs code -> resolver FAIL CLOSED (bukan matched)', () => {
  const idx = buildProjectIndex([
    { id: 'id-83', name: 'Sintetis 83', status: 'ON_GOING', kode: '83', code: '99' }
  ])
  const r = resolveProject({ sourceRow: { project_no: '83' }, index: idx, aliases: buildAliasIndex([]) })
  assert.equal(r.state, 'identity_conflict')
  assert.equal(r.projectId, null, 'identitas konflik tidak boleh menghasilkan projectId')
  assert.ok(r.conflicts.some(c => c.type === 'kode_code_conflict'))
})

await t('R3b: nomor duplikat tetap ambiguous, bukan dipilih', () => {
  const idx = buildProjectIndex([
    { id: 'a', name: 'Satu', kode: '77', code: '77' },
    { id: 'b', name: 'Dua', kode: '077', code: '77' }
  ])
  const r = resolveProject({ sourceRow: { project_no: '77' }, index: idx, aliases: buildAliasIndex([]) })
  assert.equal(r.state, 'ambiguous')
  assert.equal(r.projectId, null)
  assert.equal(r.candidates.length, 2)
})

await t('R3c: alias yang menunjuk identitas konflik juga fail closed', () => {
  const idx = buildProjectIndex([
    { id: 'id-55', name: 'Konflik', kode: '55', code: '56' }
  ])
  const aliases = buildAliasIndex([{ project_no: '55', aliases: 'Konflik' }])
  const r = resolveProject({ sourceRow: { project_name: 'Konflik' }, index: idx, aliases })
  assert.equal(r.state, 'identity_conflict')
  assert.equal(r.projectId, null)
})

await t('R3d: master bersih tetap matched (tidak ada regresi kegagalan palsu)', () => {
  const idx = buildProjectIndex([
    { id: 'id-101', name: 'Bersih', kode: '101', code: '101' }
  ])
  const r = resolveProject({ sourceRow: { project_no: '101' }, index: idx, aliases: buildAliasIndex([]) })
  assert.equal(r.state, 'matched')
  assert.equal(r.projectId, 'id-101')
})

console.log(JSON.stringify({ pass, fail: fails.length, failures: fails }, null, 2))
if (fails.length) {
  console.error('\nFAILURES:\n' + fails.map(f => ' - ' + f).join('\n'))
  process.exit(1)
}
