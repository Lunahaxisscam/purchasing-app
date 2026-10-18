// ============================================================
// E. REGRESI — menjaga klaim audit tidak merusak harness lain
// ============================================================
// Tujuan: membuktikan temuan di atas adalah KLIMITASI SKEMA, bukan regression
// dari audit ini. Harness S4 (sales-invoice-test) dan reminders-test harus
// tetap lulus. Di sini diuji subset assertion inti dari keduanya, apa adanya.
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const C = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/contract.js')).href)
const R = await import(pathToFileURL(path.join(SB, 'scripts/reminders/rules.js')).href)

let pass = 0, fail = 0
const failures = []
function check(no, name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  if (ok) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(no); console.log(`  FAIL ${no} ${name} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`) }
}
function ok(no, name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(no); console.log(`  FAIL ${no} ${name} ${extra}`) }
}

// --- kontrak S4 (transisi, bukti) masih utuh ---
check('E1', 'DRAFT→LUNAS tetap ditolak', 'INVALID_TRANSITION', C.checkTransition('DRAFT', 'LUNAS').code)
check('E2', 'LUNAS tetap final', 'TERMINAL_STATUS', C.checkTransition('LUNAS', 'BATAL').code)
check('E3', 'TERBIT→LUNAS diizinkan (bayar sebelum dicatat kirim)', true, C.checkTransition('TERBIT', 'LUNAS').ok)
{
  const n = C.normalizeTransition({ id: 'x', to: 'LUNAS', evidence: { paid_amount: 100, paid_at: '2026-10-10', payment_ref: '' } })
  ok('E4', 'LUNAS tanpa payment_ref tetap ditolak kontrak', n.ok === false)
  const okT = C.normalizeTransition({ id: 'x', to: 'LUNAS', evidence: { paid_amount: 100, paid_at: '2026-10-10', payment_ref: 'TRF' } })
  ok('E5', 'LUNAS dengan bukti lengkap lolos kontrak', okT.ok === true)
}
{
  const n = C.normalizeTransition({ id: 'x', to: 'LUNAS', evidence: { paid_amount: 100, paid_at: '2026-10-10', payment_ref: 'TRF', verified_by: 'PALSU' } })
  ok('E6', 'verified_by dari body TIDAK dipakai (diambil dari sesi)', !n.value.evidence.verified_by)
}

// --- reminders inti masih utuh ---
const ALL_SOURCES = ['purchase_requests', 'pr_items', 'approval_steps', 'receivings', 'receiving_items', 'handovers', 'projects', 'sales_invoices']
function src(key, available = true, rowCount = 1) {
  return { key, table: key, available, row_count: rowCount, fetched: rowCount, truncated: false, columns: [], error_code: available ? null : 'SCHEMA_UNAVAILABLE', error_message: available ? null : 'tidak ada' }
}
function sources(opts = {}) {
  return ALL_SOURCES.map(k => src(k, opts[k] !== false, opts[k] === false ? 0 : 1))
}
function report(ds, asOf, opts = {}) {
  return R.buildReport({ dataset: ds, asOf, sources: sources(opts), thresholds: R.DEFAULT_THRESHOLDS })
}
function itemsOf(rep, kind) {
  return rep.items.filter(i => i.kind === kind)
}
{
  const rep = report({ sales_invoices: [{ id: 'a', status: 'LUNAS', due_date: '2026-01-01', issue_date: '2026-01-01' }] }, '2026-10-18')
  check('E7', 'LUNAS tidak lagi ditagih', 0, itemsOf(rep, 'invoice_due').length)
  check('E8', 'laporan tetap read-only/dry_run', true, rep.dry_run === true && rep.read_only === true)
  check('E9', 'side_effects: nol pengiriman/pembayaran/tulisan', true,
    rep.side_effects.outbound_send === false && rep.side_effects.payment === false && rep.side_effects.write_queries === 0)
}
{
  const rep = report({}, '2026-10-18', { sales_invoices: false })
  const k = rep.kinds.find(x => x.key === 'invoice_due')
  ok('E10', 'sales_invoices tidak tersedia → BLOCKED (bukan "0 temuan")', k.blocked === true)
}
{
  const rep = report({ sales_invoices: [{ id: 'b', status: 'TERKIRIM', invoice_no: 'NL2610001', customer_name: 'A', grand_total: 1000, due_date: '2026-10-10', issue_date: '2026-10-01' }] }, '2026-10-18')
  const it = itemsOf(rep, 'invoice_due')
  check('E11', 'overdue 8 hari → critical', 'critical', it[0].severity)
  check('E12', 'overdue_days terisi', 8, it[0].overdue_days)
}

console.log(`\nE selesai: ${pass} ok, ${fail} fail (${failures.join(', ')})`)
process.exit(fail > 0 ? 1 : 0)
