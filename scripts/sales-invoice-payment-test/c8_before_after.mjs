// ============================================================
// Bukti BEFORE/AFTER assertion C8 (t_472efa7d)
// ============================================================
// Menjalankan dua versi assertion terhadap report yang SAMA, dengan
// `generated_at` dipaksa memuat :30 / :60 / :90 (pemicu flaky yang dilaporkan
// Brooklyn). BEFORE harus MERAH, AFTER harus HIJAU — tanpa bergantung jam dinding.
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.argv[2]
const R = await import(pathToFileURL(path.join(SB, 'scripts/reminders/rules.js')).href)

const ALL = ['purchase_requests', 'pr_items', 'approval_steps', 'receivings', 'receiving_items', 'handovers', 'projects', 'sales_invoices']
const sources = ALL.map(k => ({ key: k, table: k, available: true, row_count: 1, fetched: 1, truncated: false, columns: [], error_code: null, error_message: null }))
const ds = {
  sales_invoices: [
    { id: 'ag1', status: 'TERBIT', invoice_no: 'NL2610101', customer_name: 'A', grand_total: 1000, due_date: '2026-10-17', issue_date: '2026-10-01' },
    { id: 'ag2', status: 'TERBIT', invoice_no: 'NL2610102', customer_name: 'B', grand_total: 1000, due_date: '2026-09-01', issue_date: '2026-08-01' },
    { id: 'ag3', status: 'TERBIT', invoice_no: 'NL2610103', customer_name: 'C', grand_total: 1000, due_date: '2026-06-01', issue_date: '2026-05-01' }
  ]
}
const mk = generatedAt => R.buildReport({ dataset: ds, asOf: '2026-10-18', sources, thresholds: R.DEFAULT_THRESHOLDS, generatedAt })

// --- BEFORE: persis baris lama di piutang_test.mjs:100 ---
const OLD = /aging|30|60|90 hari/
function before(rep) {
  const text = JSON.stringify(rep)
  return !OLD.test(text)
}
// --- AFTER: hanya field yang menyatakan aging; timestamp dibuang ---
const BUCKET = /aging|bucket|(?:^|[^\d])(?:0|1)\s*[-\u2013]\s*30(?:[^\d]|$)|31\s*[-\u2013]\s*60|61\s*[-\u2013]\s*90|>\s*90(?:[^\d]|$)/i
function after(rep) {
  const deklarasi = {
    kinds: rep.kinds.map(k => ({ key: k.key, label: k.label, threshold_key: k.threshold_key })),
    summary: rep.summary,
    thresholds: rep.thresholds,
    notes: rep.notes,
    items: rep.items.map(i => ({ kind: i.kind, severity: i.severity, title: i.title, detail: i.detail })),
    generated_at: undefined
  }
  return !BUCKET.test(JSON.stringify(deklarasi))
}

const kasus = [
  ['2026-10-18T13:47:12.000Z', 'detik normal (:47)'],
  ['2026-10-18T13:30:12.000Z', 'DETIK :30 (pemicu flaky)'],
  ['2026-10-18T13:47:60.000Z', 'detik :60'],
  ['2026-10-18T13:30:60.090Z', 'detik :30 DAN :60'],
  ['2026-10-18T13:47:12.090Z', 'milidetik .090'],
  ['2026-10-18T13:30:12.000+07:00', 'offset +07:00 dengan :30']
]
let bad = 0
console.log('generated_at                     keterangan                 BEFORE  AFTER')
for (const [ts, ket] of kasus) {
  const rep = mk(ts)
  const b = before(rep)
  const a = after(rep)
  const okRow = (a === true)
  if (!okRow) bad++
  console.log(`${ts.padEnd(32)} ${ket.padEnd(26)} ${b ? 'HIJAU ' : 'MERAH '}   ${a ? 'HIJAU' : 'MERAH'}`)
}
// Kontrol: AFTER harus tetap MERAH bila aging benar-benar dideklarasikan.
const repAging = mk('2026-10-18T13:30:00.000Z')
repAging.kinds = [...repAging.kinds, { key: 'aging_0_30', label: '0-30 hari', threshold_key: null }]
const control = after(repAging)
console.log(`\nKONTROL POSITIF (aging_0_30 disuntik): AFTER = ${control ? 'HIJAU (SALAH!)' : 'MERAH (benar, assertion tidak vakum)'}`)
if (control) bad++
console.log(bad === 0 ? '\nHASIL: BEFORE flaky (MERAH saat menit/detik :30 atau :60 karena regex lama memuat alternasi `30` dan `60` telanjang), AFTER stabil HIJAU di semua timestamp; kontrol positif tetap MERAH.' : `\nHASIL: GAGAL (${bad})`)
process.exit(bad === 0 ? 0 : 1)
