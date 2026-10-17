// ============================================================
// scripts/reminders-test/rules_test.mjs — A. MESIN ATURAN (MURNI)
// ============================================================
// Membuktikan:
//   * setiap jenis reminder punya kasus positif & negatif;
//   * ambang dihormati (tepat di ambang vs di bawah ambang);
//   * input tidak dimutasi (read-only);
//   * sumber yang tidak tersedia → BLOCKED, bukan "0 temuan";
//   * status/severity benar (mis. invoice lewat jatuh tempo = critical).
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const REM = path.resolve(HERE, '..', 'reminders')
const R = await import(pathToFileURL(path.join(REM, 'rules.js')).href)

let pass = 0
let fail = 0
const failures = []
function ok(no, name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(`${no} ${name}`); console.log(`  FAIL ${no} ${name} ${extra}`) }
}
function eq(no, name, expected, actual) {
  const a = JSON.stringify(expected)
  const b = JSON.stringify(actual)
  ok(no, name, a === b, `| expected=${a} actual=${b}`)
}

// ---------- helper bangun dataset ----------
function src(key, available = true, rowCount = 1) {
  return { key, table: key, available, row_count: rowCount, fetched: rowCount, truncated: false, columns: [], error_code: available ? null : 'SCHEMA_UNAVAILABLE', error_message: available ? null : 'tidak ada' }
}
const ALL_SOURCES = ['purchase_requests', 'pr_items', 'approval_steps', 'receivings', 'receiving_items', 'handovers', 'projects', 'sales_invoices']
function sources(opts = {}) {
  return ALL_SOURCES.map(k => src(k, opts[k] !== false, opts[k] === false ? 0 : 1))
}
function report(dataset, { asOf = '2026-10-18', thresholds = null, srcOpts = {} } = {}) {
  return R.buildReport({
    dataset,
    sources: sources(srcOpts),
    thresholds: thresholds || R.DEFAULT_THRESHOLDS,
    asOf
  })
}
function itemsOf(rep, kind) {
  return rep.items.filter(i => i.kind === kind)
}

console.log('\n=== A. MESIN ATURAN REMINDER (MURNI) ===')

// ---------- A1. Katalog ----------
ok('A1a', 'katalog punya 7 jenis reminder', R.KINDS.length === 7, `actual=${R.KINDS.length}`)
ok('A1b', 'setiap jenis punya label & severity valid',
  R.KINDS.every(k => k.label && R.SEVERITIES.includes(k.severity)))
ok('A1c', 'setiap ambang punya default angka',
  R.KINDS.filter(k => k.threshold).every(k => typeof R.DEFAULT_THRESHOLDS[k.threshold] === 'number'))
ok('A1d', 'jenis dengan required_sources hanya menyebut sumber yang dikenal',
  R.KINDS.every(k => k.required.every(s => ALL_SOURCES.includes(s))))

// ---------- A2. Ambang: default / env / query / ditolak ----------
{
  const r = R.resolveThresholds({ query: {}, env: {} })
  eq('A2a', 'tanpa override → semua default', R.DEFAULT_THRESHOLDS, r.values)
  ok('A2b', 'sumber semua "default"', Object.values(r.sources).every(v => v === 'default'))
}
{
  const r = R.resolveThresholds({ query: {}, env: { REMINDER_PR_OVERDUE_DAYS: '10' } })
  eq('A2c', 'env menimpa default', 10, r.values.pr_overdue_days)
  eq('A2d', 'sumber tercatat "env"', 'env', r.sources.pr_overdue_days)
}
{
  const r = R.resolveThresholds({ query: { pr_overdue_days: '1' }, env: { REMINDER_PR_OVERDUE_DAYS: '10' } })
  eq('A2e', 'query menang atas env', 1, r.values.pr_overdue_days)
  eq('A2f', 'sumber tercatat "query"', 'query', r.sources.pr_overdue_days)
}
{
  const r = R.resolveThresholds({ query: { pr_overdue_days: '999', draft_stale_days: 'abc' }, env: {} })
  eq('A2g', 'nilai di luar 0..365 ditolak (tetap default)', R.DEFAULT_THRESHOLDS.pr_overdue_days, r.values.pr_overdue_days)
  eq('A2h', 'nilai bukan angka ditolak (tetap default)', R.DEFAULT_THRESHOLDS.draft_stale_days, r.values.draft_stale_days)
  ok('A2i', 'penolakan dilaporkan, bukan disembunyikan', r.rejected.length === 2, JSON.stringify(r.rejected))
  eq('A2j', '0 hari diterima', 0, R.resolveThresholds({ query: { pr_overdue_days: '0' } }).values.pr_overdue_days)
}

// ---------- A3. Util tanggal ----------
{
  eq('A3a', 'toDateOnly memotong timestamp', '2026-10-08', R.toDateOnly('2026-10-08T04:28:52Z'))
  eq('A3b', 'toDateOnly null → null', null, R.toDateOnly(null))
  eq('A3c', 'daysBetween 10 hari', 10, R.daysBetween('2026-10-08', '2026-10-18'))
  eq('A3d', 'daysBetween negatif bila tanggal di masa depan', -3, R.daysBetween('2026-10-21', '2026-10-18'))
  eq('A3e', 'isPastDue benar', true, R.isPastDue('2026-10-17', '2026-10-18'))
  eq('A3f', 'isPastDue salah pada hari H', false, R.isPastDue('2026-10-18', '2026-10-18'))
}

// ---------- A4. pr_overdue_approval ----------
{
  const ds = {
    purchase_requests: [{ id: 'pr1', pr_number: 'PR-001', status: 'SUBMITTED', created_at: '2026-10-08T00:00:00Z' }],
    approval_steps: [{ id: 's1', purchase_request_id: 'pr1', status: 'PENDING', created_at: '2026-10-08T00:00:00Z' }]
  }
  const rep = report(ds)
  const it = itemsOf(rep, 'pr_overdue_approval')
  ok('A4a', 'PR SUBMITTED 10 hari → 1 reminder', it.length === 1, `actual=${it.length}`)
  eq('A4b', 'umur dihitung dari langkah approval PENDING', 10, it[0].age_days)
  eq('A4c', 'severity critical (>2× ambang)', 'critical', it[0].severity)
  ok('A4d', 'action hint ada', !!it[0].action_hint)
}
{
  const ds = {
    purchase_requests: [{ id: 'pr1', pr_number: 'PR-001', status: 'SUBMITTED', created_at: '2026-10-16T00:00:00Z' }],
    approval_steps: [{ id: 's1', purchase_request_id: 'pr1', status: 'PENDING', created_at: '2026-10-16T00:00:00Z' }]
  }
  eq('A4e', 'PR 2 hari (di bawah ambang 3) → tidak ada reminder', 0, itemsOf(report(ds), 'pr_overdue_approval').length)
}
{
  // tepat di ambang: 3 hari → harus muncul
  const ds = {
    purchase_requests: [{ id: 'pr1', pr_number: 'PR-001', status: 'SUBMITTED', created_at: '2026-10-15T00:00:00Z' }],
    approval_steps: []
  }
  const it = itemsOf(report(ds), 'pr_overdue_approval')
  ok('A4f', 'tepat di ambang (3 hari) tetap dilaporkan', it.length === 1)
  eq('A4g', 'tanpa jejak approval → bukti approval_steps dicatat kurang', ['approval_steps'], it[0].evidence_missing)
  eq('A4h', 'severity warning pada ambang', 'warning', it[0].severity)
}
{
  const ds = { purchase_requests: [{ id: 'pr1', status: 'DRAFT', created_at: '2026-01-01T00:00:00Z' }] }
  eq('A4i', 'PR DRAFT tidak masuk pr_overdue_approval', 0, itemsOf(report(ds), 'pr_overdue_approval').length)
}
{
  const ds = {
    purchase_requests: [{ id: 'pr1', pr_number: 'PR-001', status: 'SUBMITTED', created_at: '2026-09-01T00:00:00Z' }],
    approval_steps: [{ id: 's1', purchase_request_id: 'pr1', status: 'APPROVED', decided_at: '2026-09-02T00:00:00Z', created_at: '2026-09-01T00:00:00Z' }]
  }
  // status PR masih SUBMITTED tapi langkahnya sudah APPROVED → tetap menunggu
  // putusan akhir, umur dari created_at PR karena tidak ada langkah PENDING.
  const it = itemsOf(report(ds), 'pr_overdue_approval')
  ok('A4j', 'status PR SUBMITTED tanpa langkah PENDING tetap dilaporkan', it.length === 1)
  eq('A4k', 'umur jatuh ke created_at PR', 47, it[0].age_days)
}

// ---------- A5. pr_draft_stale ----------
{
  const ds = { purchase_requests: [{ id: 'pr1', pr_number: 'PR-003', status: 'DRAFT', created_at: '2026-10-01T00:00:00Z' }] }
  const it = itemsOf(report(ds), 'pr_draft_stale')
  ok('A5a', 'draft 17 hari → 1 reminder', it.length === 1)
  eq('A5b', 'severity info', 'info', it[0].severity)
  eq('A5c', 'umur benar', 17, it[0].age_days)
}
{
  const ds = { purchase_requests: [{ id: 'pr1', status: 'DRAFT', created_at: '2026-10-16T00:00:00Z' }] }
  eq('A5d', 'draft 2 hari → tidak ada', 0, itemsOf(report(ds), 'pr_draft_stale').length)
}
{
  const ds = { purchase_requests: [{ id: 'pr1', status: 'APPROVED', created_at: '2026-01-01T00:00:00Z' }] }
  eq('A5e', 'status non-DRAFT tidak masuk', 0, itemsOf(report(ds), 'pr_draft_stale').length)
}

// ---------- A6. purchase_pending_delivery ----------
{
  const ds = {
    purchase_requests: [{ id: 'pr1', pr_number: 'PR-002', status: 'APPROVED', project_id: 'p1', created_at: '2026-09-01T00:00:00Z' }],
    approval_steps: [{ id: 's1', purchase_request_id: 'pr1', status: 'APPROVED', decided_at: '2026-10-01T00:00:00Z' }],
    pr_items: [{ id: 'i1', pr_id: 'pr1', status: 'APPROVED', item_name: 'Lem Fox', quantity: 2, estimated_price: 45000 }],
    receiving_items: [],
    receivings: [],
    projects: [{ id: 'p1', name: 'Baroni' }]
  }
  const it = itemsOf(report(ds), 'purchase_pending_delivery')
  ok('A6a', 'item APPROVED belum dibeli 17 hari → 1 reminder', it.length === 1, `actual=${it.length}`)
  eq('A6b', 'umur dihitung dari decided_at approval', 17, it[0].age_days)
  eq('A6c', 'estimasi dijumlahkan qty × harga', 90000, it[0].meta.estimated_total)
  ok('A6d', 'nama proyek ikut di rincian', it[0].detail.includes('Baroni'), it[0].detail)
}
{
  const ds = {
    purchase_requests: [{ id: 'pr1', status: 'APPROVED', created_at: '2026-09-01T00:00:00Z' }],
    pr_items: [{ id: 'i1', pr_id: 'pr1', status: 'APPROVED', quantity: 2, estimated_price: 1000 }],
    receiving_items: [{ id: 'ri1', receiving_id: 'rc1', pr_item_id: 'i1', quantity_received: 2 }],
    receivings: [{ id: 'rc1', invoice_no: 'TB-1', received_date: '2026-10-01', note: '[Nominal: Rp 2.000]' }]
  }
  eq('A6e', 'item sudah dibeli penuh → tidak ada reminder', 0, itemsOf(report(ds), 'purchase_pending_delivery').length)
}
{
  const ds = {
    purchase_requests: [{ id: 'pr1', status: 'DRAFT', created_at: '2026-01-01T00:00:00Z' }],
    pr_items: [{ id: 'i1', pr_id: 'pr1', status: 'PENDING_APPROVAL', quantity: 1, estimated_price: 1000 }]
  }
  eq('A6f', 'item milik PR DRAFT tidak dianggap urusan pembelian', 0, itemsOf(report(ds), 'purchase_pending_delivery').length)
}
{
  const ds = {
    purchase_requests: [],
    pr_items: [],
    receivings: [{ id: 'rc2', invoice_no: null, received_date: null, delivery_note: 'PO PR-001 - Lemari', note: 'Dibuat otomatis dari PR (barang disetujui).', created_at: '2026-10-08T00:00:00Z' }],
    receiving_items: []
  }
  const it = itemsOf(report(ds), 'purchase_pending_delivery')
  ok('A6g', 'cangkang nota tanpa nomor/tanggal 10 hari → 1 reminder', it.length === 1, `actual=${it.length}`)
  eq('A6h', 'ditandai sebagai sub "shell"', 'shell', it[0].meta ? (it[0].id.includes(':shell:') ? 'shell' : 'x') : 'x')
  eq('A6i', 'bukti yang kurang dicatat', ['invoice_no', 'received_date', 'nominal'], it[0].evidence_missing)
}
{
  const ds = {
    purchase_requests: [],
    pr_items: [],
    receivings: [{ id: 'rc3', invoice_no: null, received_date: '2026-10-08', delivery_note: 'x', note: '[Nominal: Rp 1.000]', created_at: '2026-10-01T00:00:00Z' }],
    receiving_items: []
  }
  eq('A6j', 'nota bernominal bukan cangkang', 0, itemsOf(report(ds), 'purchase_pending_delivery').length)
}

// ---------- A7. handover_pending ----------
{
  const ds = {
    handovers: [{ id: 'h1', receiving_id: 'rc1', project_id: 'p1', received_by: 'Pak Joko', handover_date: '2026-10-06', status: 'CONFIRMED', diserahkan_at: null }],
    receivings: [{ id: 'rc1', invoice_no: 'TB-88912' }],
    projects: [{ id: 'p1', name: 'Baroni' }]
  }
  const it = itemsOf(report(ds), 'handover_pending')
  ok('A7a', 'handover belum diserahkan 12 hari → 1 reminder', it.length === 1)
  eq('A7b', 'umur dari handover_date', 12, it[0].age_days)
  ok('A7c', 'nomor nota ikut', it[0].detail.includes('TB-88912'), it[0].detail)
}
{
  const ds = { handovers: [{ id: 'h1', handover_date: '2026-10-06', diserahkan_at: '2026-10-07T00:00:00Z' }] }
  eq('A7d', 'sudah diserahkan → tidak ada', 0, itemsOf(report(ds), 'handover_pending').length)
}
{
  const ds = { handovers: [{ id: 'h1', handover_date: '2026-10-17', diserahkan_at: null }] }
  eq('A7e', '1 hari (di bawah ambang 3) → tidak ada', 0, itemsOf(report(ds), 'handover_pending').length)
}
{
  const ds = { handovers: [{ id: 'h1', handover_date: null, created_at: '2026-10-01T00:00:00Z', diserahkan_at: null }] }
  const it = itemsOf(report(ds), 'handover_pending')
  ok('A7f', 'handover_date kosong → jatuh ke created_at', it.length === 1 && it[0].age_days === 17, JSON.stringify(it[0] && it[0].age_days))
}

// ---------- A8. invoice_due ----------
{
  const ds = { sales_invoices: [{ id: 'inv1', invoice_no: 'INV/NL/2026/10/001', status: 'TERKIRIM', customer_name: 'Jessica', grand_total: 94350000, issue_date: '2026-10-01', due_date: '2026-10-10' }] }
  const it = itemsOf(report(ds), 'invoice_due')
  ok('A8a', 'invoice lewat jatuh tempo 8 hari → 1 reminder', it.length === 1)
  eq('A8b', 'severity critical', 'critical', it[0].severity)
  eq('A8c', 'overdue_days terisi', 8, it[0].overdue_days)
}
{
  const ds = { sales_invoices: [{ id: 'inv1', invoice_no: 'INV/NL/2026/10/002', status: 'TERBIT', customer_name: 'A', grand_total: 1000, issue_date: '2026-10-01', due_date: '2026-10-21' }] }
  const it = itemsOf(report(ds), 'invoice_due')
  ok('A8d', 'jatuh tempo 3 hari lagi → 1 reminder', it.length === 1)
  eq('A8e', 'severity warning', 'warning', it[0].severity)
  ok('A8f', 'sub "due_soon"', it[0].id.includes(':due_soon:'), it[0].id)
}
{
  const ds = { sales_invoices: [{ id: 'inv1', status: 'TERBIT', due_date: '2026-12-31', issue_date: '2026-10-01' }] }
  eq('A8g', 'jatuh tempo jauh → tidak ada', 0, itemsOf(report(ds), 'invoice_due').length)
}
{
  const ds = { sales_invoices: [{ id: 'inv1', status: 'LUNAS', due_date: '2026-01-01', issue_date: '2026-01-01' }] }
  eq('A8h', 'LUNAS tidak ditagih lagi', 0, itemsOf(report(ds), 'invoice_due').length)
  const ds2 = { sales_invoices: [{ id: 'inv2', status: 'DRAFT', due_date: '2026-01-01' }] }
  eq('A8i', 'DRAFT tidak masuk invoice_due', 0, itemsOf(report(ds2), 'invoice_due').length)
  const ds3 = { sales_invoices: [{ id: 'inv3', status: 'BATAL', due_date: '2026-01-01' }] }
  eq('A8j', 'BATAL tidak masuk invoice_due', 0, itemsOf(report(ds3), 'invoice_due').length)
}
{
  const ds = { sales_invoices: [{ id: 'inv1', invoice_no: 'INV/NL/2026/10/003', status: 'TERBIT', issue_date: '2026-10-01', due_date: null }] }
  const it = itemsOf(report(ds), 'invoice_due')
  ok('A8k', 'outstanding tanpa due_date tetap dilaporkan', it.length === 1)
  ok('A8l', 'sub "no_due_date" + bukti kurang due_date',
    it[0].id.includes(':no_due_date:') && it[0].evidence_missing.includes('due_date'))
}
{
  // outstanding dihitung dari STATUS, bukan dari paid_amount
  const ds = { sales_invoices: [{ id: 'inv1', status: 'DISETUJUI', due_date: '2026-10-05', issue_date: '2026-10-01', paid_amount: 500 }] }
  eq('A8m', 'DISETUJUI dengan paid_amount parsial tetap outstanding', 1, itemsOf(report(ds), 'invoice_due').length)
}
{
  const ds = { sales_invoices: [{ id: 'inv1', status: 'DRAFT', created_at: '2026-10-10T00:00:00Z', customer_name: 'Budi' }] }
  const it = itemsOf(report(ds), 'invoice_draft_stale')
  ok('A8n', 'draft invoice 8 hari → reminder', it.length === 1)
  eq('A8o', 'severity info', 'info', it[0].severity)
}

// ---------- A9. missing_evidence ----------
{
  const ds = {
    handovers: [
      { id: 'h1', status: 'CONFIRMED', diserahkan_at: null, received_by: 'Pak Joko' },
      { id: 'h2', status: 'CONFIRMED', diserahkan_at: '2026-10-10T00:00:00Z', received_by: 'Belum ditentukan' },
      { id: 'h3', status: 'DRAFT', diserahkan_at: null, received_by: '' }
    ],
    receivings: [],
    receiving_items: [],
    purchase_requests: [],
    approval_steps: [],
    sales_invoices: []
  }
  const it = itemsOf(report(ds), 'missing_evidence')
  const subs = it.map(i => i.id.split(':')[1])
  ok('A9a', 'handover CONFIRMED tanpa diserahkan_at = critical', it.some(i => i.id.includes('handover_confirmed_no_timestamp') && i.severity === 'critical'))
  ok('A9b', 'handover tanpa penerima = warning', it.some(i => i.id.includes('handover_no_receiver') && i.severity === 'warning'))
  ok('A9c', 'handover DRAFT tidak dilaporkan', !it.some(i => i.entity.id === 'h3'), JSON.stringify(subs))
}
{
  const ds = {
    receivings: [
      { id: 'rc1', invoice_no: 'TB-1', received_date: '2026-10-01', note: '[Nominal: Rp 5.000]', delivery_note: 'x' },
      { id: 'rc2', invoice_no: 'TB-2', received_date: null, note: '[Nominal: Rp 5.000] [BuktiNota: data:image/png;base64,AA] [BuktiTransfer: data:image/png;base64,BB]' }
    ],
    receiving_items: [{ id: 'ri1', receiving_id: 'rc1', quantity_received: 1 }],
    handovers: [],
    purchase_requests: [],
    approval_steps: [],
    sales_invoices: []
  }
  const it = itemsOf(report(ds), 'missing_evidence')
  ok('A9d', 'nota tanpa bukti nota & transfer dilaporkan info', it.some(i => i.id.includes('nota_no_proof') && i.entity.id === 'rc1' && i.severity === 'info'))
  ok('A9e', 'nota tanpa tanggal dilaporkan', it.some(i => i.id.includes('nota_no_date') && i.entity.id === 'rc2'))
  ok('A9f', 'nota dengan bukti lengkap tidak dilaporkan proof', !it.some(i => i.id.includes('nota_no_proof') && i.entity.id === 'rc2'))
  ok('A9g', 'nota tanpa rincian barang dilaporkan', it.some(i => i.id.includes('nota_no_items') && i.entity.id === 'rc2'))
  ok('A9h', 'nota dengan rincian tidak dilaporkan no_items', !it.some(i => i.id.includes('nota_no_items') && i.entity.id === 'rc1'))
}
{
  const ds = {
    purchase_requests: [
      { id: 'pr1', pr_number: 'PR-001', status: 'APPROVED' }, // lengkap
      { id: 'pr2', pr_number: 'PR-002', status: 'APPROVED' }, // ada item, TANPA langkah approval
      { id: 'pr3', pr_number: 'PR-003', status: 'APPROVED' }  // ada langkah approval, TANPA item
    ],
    approval_steps: [
      { id: 's1', purchase_request_id: 'pr1', status: 'APPROVED' },
      { id: 's3', purchase_request_id: 'pr3', status: 'APPROVED' }
    ],
    pr_items: [{ id: 'i1', pr_id: 'pr1', status: 'APPROVED' }, { id: 'i2', pr_id: 'pr2', status: 'APPROVED' }],
    handovers: [], receivings: [], receiving_items: [], sales_invoices: []
  }
  const it = itemsOf(report(ds), 'missing_evidence')
  const noStep = it.filter(i => i.id.includes('pr_approved_no_step'))
  ok('A9i', 'PR APPROVED tanpa langkah approval dilaporkan', noStep.length === 1 && noStep[0].entity.id === 'pr2',
    JSON.stringify(noStep.map(i => i.entity.id)))
  const noItems = it.filter(i => i.id.includes('pr_approved_no_items'))
  ok('A9i2', 'PR APPROVED tanpa item sama sekali dilaporkan', noItems.length === 1 && noItems[0].entity.id === 'pr3',
    JSON.stringify(noItems.map(i => i.entity.id)))
  ok('A9i3', 'PR yang lengkap (approval + item) tidak dilaporkan', !it.some(i => i.entity.id === 'pr1'))
}
{
  // PR APPROVED tanpa item tapi pr_items tidak tersedia → jangan dilaporkan
  // (tidak boleh menuduh kekurangan data yang sumbernya memang tidak dibaca).
  const ds = { purchase_requests: [{ id: 'pr1', pr_number: 'PR-001', status: 'APPROVED' }], approval_steps: [] }
  const rep = report(ds, { srcOpts: { pr_items: false } })
  ok('A9i4', 'tanpa sumber pr_items, pemeriksaan "tanpa item" dilewati',
    !rep.items.some(i => i.id.includes('pr_approved_no_items')))
}
{
  const ds = {
    sales_invoices: [
      { id: 'inv1', invoice_no: 'INV/1', status: 'LUNAS', paid_at: null, payment_ref: '', payment_verified_by: null },
      { id: 'inv2', invoice_no: 'INV/2', status: 'LUNAS', paid_at: '2026-10-01', payment_ref: 'TRX-1', payment_verified_by: 'u1' },
      { id: 'inv3', invoice_no: 'INV/3', status: 'TERKIRIM', sent_channel: '' }
    ],
    handovers: [], receivings: [], receiving_items: [], purchase_requests: [], approval_steps: []
  }
  const it = itemsOf(report(ds), 'missing_evidence')
  ok('A9j', 'LUNAS tanpa bukti = critical', it.some(i => i.id.includes('invoice_paid_no_proof') && i.entity.id === 'inv1' && i.severity === 'critical'))
  ok('A9k', 'LUNAS dengan bukti lengkap tidak dilaporkan', !it.some(i => i.entity.id === 'inv2' && i.kind === 'missing_evidence'))
  ok('A9l', 'TERKIRIM tanpa kanal dilaporkan', it.some(i => i.id.includes('invoice_sent_no_channel') && i.entity.id === 'inv3'))
}

// ---------- A10. Sumber tidak tersedia → BLOCKED ----------
{
  const rep = report({ purchase_requests: [] }, { srcOpts: { sales_invoices: false } })
  const blocked = rep.blocked.map(b => b.kind)
  ok('A10a', 'invoice_due BLOCKED saat sales_invoices tidak ada', blocked.includes('invoice_due'))
  ok('A10b', 'invoice_draft_stale BLOCKED', blocked.includes('invoice_draft_stale'))
  ok('A10c', 'jenis lain tetap dievaluasi', !blocked.includes('pr_overdue_approval'))
  eq('A10d', 'status laporan degraded', 'degraded', rep.status)
  eq('A10e', 'data_ready false', false, rep.data_ready)
  ok('A10f', 'alasan BLOCKED menyebut "bukan berarti bersih"', rep.blocked[0].reason.includes('bukan berarti bersih'))
  ok('A10g', 'catatan menyebut sumber yang hilang', rep.notes.some(n => n.includes('sales_invoices')))
}
{
  const rep = report({ purchase_requests: [] }, { srcOpts: { handovers: false } })
  ok('A10h', 'handover_pending BLOCKED saat handovers tidak ada', rep.blocked.some(b => b.kind === 'handover_pending'))
  ok('A10i', 'missing_evidence tetap jalan & melaporkan pemeriksaan yang dilewati',
    rep.kinds.some(k => k.key === 'missing_evidence' && !k.blocked) && rep.notes.some(n => n.includes('dilewati')))
}
{
  const allDown = Object.fromEntries(ALL_SOURCES.map(k => [k, false]))
  const rep = report({}, { srcOpts: allDown })
  eq('A10j', 'semua sumber hilang → status unavailable', 'unavailable', rep.status)
  eq('A10k', 'tidak ada item karangan', 0, rep.items.length)
  eq('A10l', 'semua jenis yang butuh data dilaporkan BLOCKED',
    R.KINDS.filter(k => k.required.length).length, rep.blocked.length)
}

// ---------- A11. Read-only: dataset tidak dimutasi ----------
{
  const ds = {
    purchase_requests: [{ id: 'pr1', pr_number: 'PR-001', status: 'SUBMITTED', created_at: '2026-10-01T00:00:00Z' }],
    approval_steps: [{ id: 's1', purchase_request_id: 'pr1', status: 'PENDING', created_at: '2026-10-01T00:00:00Z' }],
    pr_items: [{ id: 'i1', pr_id: 'pr1', status: 'APPROVED', quantity: 1, estimated_price: 1000 }],
    receivings: [{ id: 'rc1', invoice_no: null, note: 'x', created_at: '2026-10-01T00:00:00Z' }],
    receiving_items: [],
    handovers: [{ id: 'h1', status: 'CONFIRMED', diserahkan_at: null }],
    projects: [{ id: 'p1', name: 'X' }],
    sales_invoices: [{ id: 'inv1', status: 'TERBIT', due_date: '2026-10-01', issue_date: '2026-10-01' }]
  }
  const before = JSON.stringify(ds)
  report(ds)
  eq('A11a', 'buildReport tidak mengubah dataset masukan', before, JSON.stringify(ds))
}
{
  const rep = report({})
  eq('A11b', 'laporan selalu dry_run', true, rep.dry_run)
  eq('A11c', 'laporan selalu read_only', true, rep.read_only)
  eq('A11d', 'side_effects: tidak ada pengiriman keluar', false, rep.side_effects.outbound_send)
  eq('A11e', 'side_effects: tidak ada pembayaran', false, rep.side_effects.payment)
  eq('A11f', 'side_effects: tidak ada mutasi cron', false, rep.side_effects.cron_mutation)
  eq('A11g', 'side_effects: 0 query tulis', 0, rep.side_effects.write_queries)
  eq('A11h', 'side_effects: 0 perubahan status', 0, rep.side_effects.status_changes)
}

// ---------- A12. Ambang kustom mengubah hasil ----------
{
  const ds = { purchase_requests: [{ id: 'pr1', status: 'DRAFT', created_at: '2026-10-16T00:00:00Z' }] }
  eq('A12a', 'ambang default 7 hari → draft 2 hari tidak muncul', 0, itemsOf(report(ds), 'pr_draft_stale').length)
  const rep2 = report(ds, { thresholds: { ...R.DEFAULT_THRESHOLDS, draft_stale_days: 1 } })
  eq('A12b', 'ambang 1 hari → draft 2 hari muncul', 1, itemsOf(rep2, 'pr_draft_stale').length)
  eq('A12c', 'threshold_days pada item mengikuti ambang yang dipakai', 1, itemsOf(rep2, 'pr_draft_stale')[0].threshold_days)
}

// ---------- A13. Urutan & ringkasan ----------
{
  const ds = {
    handovers: [{ id: 'h1', status: 'CONFIRMED', diserahkan_at: null }],
    purchase_requests: [{ id: 'pr1', pr_number: 'PR-001', status: 'DRAFT', created_at: '2026-10-01T00:00:00Z' }],
    sales_invoices: [{ id: 'inv1', invoice_no: 'INV/1', status: 'TERBIT', due_date: '2026-10-10', issue_date: '2026-10-01' }],
    receivings: [], receiving_items: [], approval_steps: []
  }
  const rep = report(ds)
  const sev = rep.items.map(i => i.severity)
  const rank = { critical: 0, warning: 1, info: 2 }
  ok('A13a', 'item diurutkan critical → warning → info',
    sev.every((s, i) => i === 0 || rank[sev[i - 1]] <= rank[s]), JSON.stringify(sev))
  eq('A13b', 'ringkasan total = panjang item', rep.items.length, rep.summary.total)
  eq('A13c', 'by_severity menjumlah sama', rep.items.length,
    rep.summary.by_severity.critical + rep.summary.by_severity.warning + rep.summary.by_severity.info)
  ok('A13d', 'oldest_age_days = umur terbesar', rep.summary.oldest_age_days >= 8, String(rep.summary.oldest_age_days))
}

// ---------- A14. kinds filter ----------
{
  const ds = {
    handovers: [{ id: 'h1', status: 'CONFIRMED', diserahkan_at: null }],
    purchase_requests: [{ id: 'pr1', status: 'DRAFT', created_at: '2026-10-01T00:00:00Z' }],
    receivings: [], receiving_items: [], approval_steps: [], sales_invoices: []
  }
  const rep = R.buildReport({ dataset: ds, sources: sources(), thresholds: R.DEFAULT_THRESHOLDS, asOf: '2026-10-18', kinds: ['pr_draft_stale'] })
  eq('A14a', 'kinds membatasi jenis', ['pr_draft_stale'], rep.kinds.map(k => k.key))
  ok('A14b', 'hanya item jenis itu', rep.items.every(i => i.kind === 'pr_draft_stale'))
  const rep2 = R.buildReport({ dataset: ds, sources: sources(), thresholds: R.DEFAULT_THRESHOLDS, asOf: '2026-10-18', kinds: ['ngawur'] })
  eq('A14c', 'jenis tak dikenal → 0 item', 0, rep2.items.length)
  ok('A14d', 'jenis tak dikenal dilaporkan di catatan', rep2.notes.some(n => n.includes('ngawur')))
}

// ---------- A15. Render teks ----------
{
  const rep = report({
    handovers: [{ id: 'h1', status: 'CONFIRMED', diserahkan_at: null, received_by: 'Pak Joko' }],
    purchase_requests: [], receivings: [], receiving_items: [], approval_steps: [], sales_invoices: []
  })
  const txt = R.renderText(rep)
  ok('A15a', 'judul menyatakan DRY-RUN & READ-ONLY', txt.includes('DRY-RUN') && txt.includes('READ-ONLY'))
  ok('A15b', 'menyatakan tidak ada pengiriman/pembayaran/cron', /tidak ada pesan yang dikirim/i.test(txt))
  ok('A15c', 'mencetak ambang yang dipakai', txt.includes('pr_overdue_days'))
  ok('A15d', 'mencetak status sumber data', txt.includes('SUMBER DATA'))
  ok('A15e', 'mencetak rincian temuan', txt.includes('CRITICAL'))
  const rep2 = report({}, { srcOpts: { sales_invoices: false } })
  ok('A15f', 'BLOCKED dicetak di teks', R.renderText(rep2).includes('BLOCKED'))
}

// ---------- A16. readNoteMarkers paritas pola ----------
{
  eq('A16a', 'nominal bertitik dibaca benar', 1250000, R.readNoteMarkers('[Nominal: Rp 1.250.000] x').material)
  eq('A16b', 'tanpa penanda → null', null, R.readNoteMarkers('catatan biasa').material)
  eq('A16c', 'bukti nota terbaca', 'data:image/png;base64,AA', R.readNoteMarkers('[BuktiNota: data:image/png;base64,AA]').buktiNota)
  eq('A16d', 'note null aman', null, R.readNoteMarkers(null).material)
}

console.log(`\n  HASIL A: ${pass} LULUS, ${fail} GAGAL`)
if (fail) console.log('  gagal: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
