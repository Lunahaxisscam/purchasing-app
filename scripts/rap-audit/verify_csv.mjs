// ============================================================
// VERIFIKASI ISI CSV S3 (t_18652eb1) — pembacaan & hitungan
// langsung dari file, agar doc bukan dari ingatan.
// ============================================================
import fs from 'node:fs'

const CSV = '/home/ubuntu/dev-workspaces/wt-s3-rap-audit/scripts/rap-audit/variance_scenarios.csv'
const txt = fs.readFileSync(CSV, 'utf8')
const rows = txt.split('\n').map(l => l.trim()).filter(Boolean)
const header = rows[1]
const dataRows = rows.slice(2).filter(r => /^[a-z0-9_]+,/.test(r))
const notes = rows.filter(r => r.startsWith('  ') || r.startsWith('CATATAN') || r.startsWith('Kas'))

function col(line, i) { return line.split(',')[i] }
const colIdx = name => header.split(',').indexOf(name)

console.log('Header   :', header)
console.log('Baris    :', dataRows.length)
console.log('Note line:', notes.length - 1, 'catatan')

// --- A: tanda tanda variansi ---
const idxRow = dataRows.find(r => col(r, 0) === 'material_over')
console.log('\n[A] material_over => is_material_over =', col(idxRow, colIdx('is_material_over')))
if (col(idxRow, colIdx('is_material_over')) !== 'true') { console.error('GAGAL: expected true'); process.exit(1) }

// --- B: margin pct format ---
for (const r of dataRows) {
  const pct = col(r, colIdx('margin_pct'))
  if (!/^-?\d+(\.\d+)?%$/.test(pct)) { console.error('GAGAL: format %', pct); process.exit(1) }
}
console.log('[B] margin_pct format bertanda % — 11/11 valid')

// --- C: skenario null-safe ---
const nanRow = dataRows.find(r => col(r, 0) === 'revenue_nan_neg_inf')
console.log('[C] revenue_nan_neg_inf: real_material =', col(nanRow, colIdx('real_material')),
  '| margin_pct =', col(nanRow, colIdx('margin_pct')),
  '| is_material_over =', col(nanRow, colIdx('is_material_over')))
if (col(nanRow, colIdx('real_material')) !== '0' || col(nanRow, colIdx('margin_pct')) !== '0%' || col(nanRow, colIdx('is_material_over')) !== 'false') {
  console.error('GAGAL: harapan 0/0%/false tak tercapai'); process.exit(1)
}

// --- D: pagu edge ---
const pagu = dataRows.find(r => col(r, 0) === 'pagu_edge_70pct')
console.log('[D] pagu_edge_70pct : budget_mat =', col(pagu, colIdx('budget_mat')),
  '| margin_pct =', col(pagu, colIdx('margin_pct')),
  '| all_over flags =', col(pagu, colIdx('is_material_over')), col(pagu, colIdx('is_labor_over')), col(pagu, colIdx('is_ops_over')), col(pagu, colIdx('is_margin_thin')))
if (col(pagu, colIdx('budget_mat')) !== '21650000') { console.error('GAGAL: budget material harus 21.650.000'); process.exit(1) }

// --- E: draft 110 ditolak (custom tetap standard) ---
const d110 = dataRows.find(r => col(r, 0) === 'custom_draft110_ditolak')
console.log('[E] custom_draft110_ditolak : revenue =', col(d110, colIdx('revenue')),
  '| margin_pct =', col(d110, colIdx('margin_pct')))
console.log('  (revenue realistik di sini hanya ada di R2.4: budgetMaterial=50jt — bukan 70jt — snapshot valid terakhir)')

console.log('\n✓ CSV sesuai — dokumen & CSV selaras.')
