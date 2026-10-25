// ============================================================
// scripts/approval-off-test/logic_test.mjs — UJI KEBİJAKAN APPROVAL OFF
// ============================================================
// Membuktikan (mock berlabel, tanpa DB/jaringan):
//   L1  Satu kebijakan: flag di lib/constants.js == salinan di scripts/reminders
//   L2  Navigasi: approval hilang dari nav; modul lain tetap ada
//   L3  Handler keputusan/approve/order/alert FAIL CLOSED (0 write/0 rpc)
//   L4  Submit legacy (handleFinishPr) fail closed: 0 SELECT, 0 write, 0 alert
//   L5  Request baru lewat jalur lean: status SUBMITTED + [Jalur: LEAN],
//       0 approval_steps, 0 receivings, item TIDAK diubah
//   L6  Kirim ulang PR REJECTED: ID & nomor SAMA, 0 approval_steps,
//       penanda [KirimUlang], riwayat (catatan penolakan) tetap ada
//   L7  Double submit / stale: klik ganda & status tidak eligible ditolak
//       tanpa write tambahan
//   L8  Legacy pending tidak otomatis jadi lean/buyable
//   L9  Reminder: approval_steps tidak dibaca, pr_overdue_approval disabled,
//       reminder operasional lain tetap jalan
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMockSupabase, __reset, __ops, db, opsOn, writeOps } from './mock-supabase.mjs'

const SB = process.cwd()
const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}
function eq(name, expected, actual) {
  const a = JSON.stringify(expected)
  const b = JSON.stringify(actual)
  check(name, a === b, `expected=${a} actual=${b}`)
}

console.log('\n=== L. KEBIJAKAN APPROVAL OFF (mock berlabel) ===')

const constants = await load('lib/constants.mjs')
const lean = await load('modules/requests/leanRequest.mjs')
const submitLeanMod = await load('modules/requests/submitLean.mjs')
const submitMod = await load('modules/requests/submit.mjs')
const alertMod = await load('lib/telegramAlert.mjs')
const rulesMod = await load('scripts/reminders/rules.mjs')

// ---------- L1. Satu kebijakan ----------
console.log('\nL1. Satu kebijakan terpusat')
eq('L1a flag lib/constants = false (Approval OFF)', false, constants.APPROVAL_MODULE_ENABLED)
eq('L1b salinan flag di scripts/reminders/rules.js sama', constants.APPROVAL_MODULE_ENABLED, rulesMod.APPROVAL_MODULE_ENABLED)
eq('L1c isApprovalEnabled() mengikuti flag', false, constants.isApprovalEnabled())
eq('L1d kode guard tunggal', 'APPROVAL_OFF', constants.APPROVAL_OFF_CODE)
check('L1e guard mengembalikan fail closed + pesan', (() => {
  const g = constants.approvalGuard('decide')
  return g.ok === false && g.disabled === true && typeof g.error === 'string' && g.error.length > 20
})())

// ---------- L2. Navigasi ----------
console.log('\nL2. Navigasi & modul')
const navIds = constants.modules.map(m => m[0])
check('L2a approval TIDAK ada di daftar modul tampil', !navIds.includes('approvals'), navIds.join(','))
check('L2b katalog penuh masih menyimpan approval (reversible)', constants.allModules.some(m => m[0] === 'approvals'))
check('L2c labels.approvals tetap ada (judul/back-compat)', constants.labels.approvals === 'Approval')
for (const id of ['dashboard', 'projects', 'vendors', 'materials', 'requests', 'receivings', 'handovers']) {
  check(`L2d modul inti '${id}' tetap terlihat`, navIds.includes(id))
}
const secIds = constants.visibleNavSections.flatMap(s => s.items.map(i => i[0]))
check('L2e visibleNavSections tidak memuat approval', !secIds.includes('approvals'))
check('L2f tidak ada grup menu kosong', constants.visibleNavSections.every(s => s.items.length > 0))
// t_da4a9ef8: menu Stok Workshop digabung ke Material -> jumlah tampil ikut
// kebijakan (bukan angka mati), supaya tes tidak mengunci menu duplikat.
// t_6a18a263: Actual Labor & Stok & Marketing/Lead Pipeline juga ikut
// kebijakan (LABOR_STOCK_MODULE_ENABLED / MARKETING_MODULE_ENABLED).
const EXPECTED_MENU = 21 - (constants.APPROVAL_MODULE_ENABLED === true ? 0 : 1)
  - (constants.STOCK_MENU_CONSOLIDATED === true ? 1 : 0)
  - (constants.LABOR_STOCK_MODULE_ENABLED === true ? 0 : 1)
  - (constants.MARKETING_MODULE_ENABLED === true ? 0 : 1)
eq(`L2g total menu tampil = ${EXPECTED_MENU} (21 - approval - stok-digabung - labor/stok - marketing)`, EXPECTED_MENU, navIds.length)
eq('L2h isModuleVisible(approvals) false', false, constants.isModuleVisible('approvals'))
eq('L2i isModuleVisible(requests) true', true, constants.isModuleVisible('requests'))
eq('L2j isModuleVisible(labor_stock) false', false, constants.isModuleVisible('labor_stock'))
eq('L2k isModuleVisible(marketing) false', false, constants.isModuleVisible('marketing'))

// ---------- L3. Handler keputusan / alert fail closed ----------
console.log('\nL3. Handler approval fail closed (0 write, 0 rpc)')
{
  __reset({ approval_steps: [{ id: 'as-1', purchase_request_id: 'pr-1', status: 'PENDING', step_number: 1 }], purchase_requests: [{ id: 'pr-1', status: 'SUBMITTED' }], pr_items: [{ id: 'pi-1', pr_id: 'pr-1', status: 'PENDING_APPROVAL' }] })
  const supabase = createMockSupabase()
  const res = await alertMod.sendPrAlert(supabase, 'pr-1')
  eq('L3a sendPrAlert tidak mengirim (disabled)', true, res.disabled === true)
  eq('L3b tidak ada rpc telegram sama sekali', 0, __ops.filter(o => o.op === 'rpc').length)
  eq('L3c tidak ada operasi apa pun ke DB', 0, __ops.length)
}
{
  // Handler legacy submit harus berhenti SEBELUM baca status PR.
  __reset({ purchase_requests: [{ id: 'pr-9', pr_number: 'PR-009', status: 'DRAFT', title: 'X' }], pr_items: [{ id: 'pi-9', pr_id: 'pr-9', item_name: 'Plywood', quantity: 2, status: 'PENDING_APPROVAL' }] })
  const supabase = createMockSupabase()
  let notice = ''
  const res = await submitMod.handleFinishPr({ id: 'pr-9', pr_number: 'PR-009', status: 'DRAFT' }, {
    supabase,
    confirmFn: () => true,
    setNotice: m => { notice = m },
    loadAll: () => {}
  })
  eq('L3d handleFinishPr disabled', true, res.disabled === true)
  eq('L3e kode APPROVAL_OFF', 'APPROVAL_OFF', res.code)
  eq('L3f 0 operasi DB (tidak ada SELECT approval_steps)', 0, __ops.length)
  check('L3g pesan penolakan diberikan ke UI', notice.includes('dinonaktifkan'))
}

// ---------- L5. Request baru lewat jalur lean ----------
console.log('\nL5. Request baru (DRAFT) -> jalur lean, tanpa approval_steps')
{
  __reset({
    purchase_requests: [{ id: 'pr-new', pr_number: 'PR-100', status: 'DRAFT', title: 'Kebutuhan Tukang', notes: 'catatan manusia', project_id: 'p1' }],
    pr_items: [
      { id: 'pi-a', pr_id: 'pr-new', item_name: 'Triplek 9mm', quantity: 4, unit: 'Lembar', status: 'PENDING_APPROVAL' },
      { id: 'pi-b', pr_id: 'pr-new', item_name: 'Sekrup', quantity: 10, unit: 'Pcs', status: 'PENDING_APPROVAL' }
    ],
    approval_steps: [],
    receivings: []
  })
  const supabase = createMockSupabase()
  let notice = ''
  const res = await submitLeanMod.submitLean({ id: 'pr-new', pr_number: 'PR-100', status: 'DRAFT' }, {
    supabase, confirmFn: () => true, setNotice: m => { notice = m }, loadAll: () => {}
  })
  eq('L5a submit lean sukses', true, res.ok)
  const pr = db.purchase_requests.find(r => r.id === 'pr-new')
  eq('L5b status existing SUBMITTED (bukan APPROVED palsu)', 'SUBMITTED', pr.status)
  check('L5c penanda [Jalur: LEAN] tersimpan', lean.isLeanMarked(pr.notes))
  check('L5d catatan manusia dipertahankan', pr.notes.includes('catatan manusia'))
  eq('L5e 0 approval_steps dibuat', 0, (db.approval_steps || []).length)
  eq('L5f 0 baris receivings (bukan cangkang nota)', 0, (db.receivings || []).length)
  eq('L5g 0 SELECT/INSERT/UPDATE ke approval_steps', 0, opsOn('approval_steps').length)
  const items = db.pr_items
  check('L5h status item TIDAK diubah jadi APPROVED', items.every(i => i.status === 'PENDING_APPROVAL'))
  check('L5i notice menyebut siap ditindaklanjuti', notice.includes('siap ditindaklanjuti'))
  check('L5j klasifikasi = LEAN (bukan legacy)', lean.classifyRequest(pr).key === 'LEAN')
}

// ---------- L6. Kirim ulang PR REJECTED (ID sama) ----------
console.log('\nL6. Kirim ulang PR REJECTED — ID & nomor sama, riwayat tetap')
{
  __reset({
    purchase_requests: [{
      id: 'pr-rej', pr_number: 'PR-200', status: 'REJECTED', title: 'Perbaikan',
      notes: 'Ditolak: harga terlalu tinggi', project_id: 'p1'
    }],
    pr_items: [{ id: 'pi-r', pr_id: 'pr-rej', item_name: 'HPL', quantity: 3, unit: 'Lembar', status: 'REJECTED' }],
    approval_steps: [{ id: 'as-rej', purchase_request_id: 'pr-rej', step_number: 1, status: 'REJECTED', note: 'harga terlalu tinggi', decided_at: '2026-10-10T00:00:00Z' }]
  })
  const supabase = createMockSupabase()
  let confirmMsg = ''
  const res = await submitLeanMod.submitLean({ id: 'pr-rej', pr_number: 'PR-200', status: 'REJECTED' }, {
    supabase, confirmFn: m => { confirmMsg = m; return true }, setNotice: () => {}, loadAll: () => {}
  })
  eq('L6a kirim ulang sukses', true, res.ok)
  eq('L6b ditandai resubmitted', true, res.resubmitted)
  eq('L6c pr_id SAMA (tidak membuat PR baru)', 'pr-rej', res.pr_id)
  eq('L6d pr_number SAMA', 'PR-200', res.pr_number)
  eq('L6e jumlah purchase_requests tetap 1', 1, db.purchase_requests.length)
  const pr = db.purchase_requests[0]
  eq('L6f status jadi SUBMITTED', 'SUBMITTED', pr.status)
  check('L6g penanda lean ada', lean.isLeanMarked(pr.notes))
  check('L6h penanda [KirimUlang: …] ada (jejak aksi)', !!lean.resubmittedAtOf(pr.notes))
  check('L6i catatan penolakan lama tetap tersimpan', pr.notes.includes('Ditolak: harga terlalu tinggi'))
  eq('L6j baris approval_steps TIDAK diubah/dihapus', 1, db.approval_steps.length)
  eq('L6k status approval_steps lama tetap REJECTED', 'REJECTED', db.approval_steps[0].status)
  eq('L6l note penolakan lama tetap ada', 'harga terlalu tinggi', db.approval_steps[0].note)
  eq('L6m 0 INSERT/UPDATE/DELETE approval_steps', 0, __ops.filter(o => o.table === 'approval_steps' && o.op !== 'select').length)
  check('L6n konfirmasi menyebut riwayat tetap tersimpan', confirmMsg.includes('Riwayat penolakan lama TETAP tersimpan'))
}

// ---------- L6b. Setelah kirim ulang, item BISA dibeli lewat jalur lean ----------
{
  __reset({
    purchase_requests: [{ id: 'pr-rej2', pr_number: 'PR-201', status: 'REJECTED', title: 'Perbaikan', notes: 'Ditolak: qty salah', project_id: 'p1' }],
    pr_items: [{ id: 'pi-r2', pr_id: 'pr-rej2', item_name: 'HPL', quantity: 2, unit: 'Lembar', status: 'REJECTED', estimated_price: 100000 }],
    approval_steps: [{ id: 'as-2', purchase_request_id: 'pr-rej2', step_number: 1, status: 'REJECTED', note: 'qty salah' }],
    receivings: [], receiving_items: [],
    projects: [{ id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' }],
    materials: [], vendors: []
  })
  const supabase = createMockSupabase()
  const purchaseLogic = await load('modules/receivings/purchaseLogic.mjs')
  const before = purchaseLogic.buildReadyRows({
    prItems: db.pr_items, requests: db.purchase_requests, projects: db.projects,
    vendors: [], materials: [], receivings: [], receivingItems: []
  })
  eq('L6b-1 REJECTED belum masuk Siap Dibeli sebelum aksi admin', 0, before.length)
  const res = await submitLeanMod.submitLean({ id: 'pr-rej2', status: 'REJECTED' }, {
    supabase, confirmFn: () => true, setNotice: () => {}, loadAll: () => {}
  })
  eq('L6b-2 kirim ulang sukses', true, res.ok)
  const after = purchaseLogic.buildReadyRows({
    prItems: db.pr_items, requests: db.purchase_requests, projects: db.projects,
    vendors: [], materials: [], receivings: [], receivingItems: []
  })
  eq('L6b-3 setelah kirim ulang sah → item masuk Siap Dibeli (jalur lean)', 1, after.length)
  eq('L6b-4 item tetap TIDAK berstatus APPROVED (tidak memalsukan approval)', 'REJECTED', db.pr_items[0].status)
  eq('L6b-5 0 approval_steps baru', 1, db.approval_steps.length)
}

// ---------- L7. Double submit & stale ----------
console.log('\nL7. Klik ganda & status tidak eligible')
{
  __reset({
    purchase_requests: [{ id: 'pr-d', pr_number: 'PR-300', status: 'DRAFT', notes: '' }],
    pr_items: [{ id: 'pi-d', pr_id: 'pr-d', item_name: 'Kayu', quantity: 1, status: 'PENDING_APPROVAL' }]
  })
  const supabase = createMockSupabase()
  const first = await submitLeanMod.submitLean({ id: 'pr-d', status: 'DRAFT' }, { supabase, confirmFn: () => true, setNotice: () => {}, loadAll: () => {} })
  const writesAfterFirst = writeOps().length
  const second = await submitLeanMod.submitLean({ id: 'pr-d', status: 'DRAFT' }, { supabase, confirmFn: () => true, setNotice: () => {}, loadAll: () => {} })
  eq('L7a submit pertama sukses', true, first.ok)
  eq('L7b submit kedua idempoten (alreadySubmitted)', true, second.alreadySubmitted)
  eq('L7c tidak ada write tambahan pada submit kedua', writesAfterFirst, writeOps().length)
  eq('L7d penanda lean tidak dobel', 1, (db.purchase_requests[0].notes.match(/\[Jalur: LEAN\]/gi) || []).length)
}
{
  __reset({
    purchase_requests: [{ id: 'pr-sub', pr_number: 'PR-301', status: 'SUBMITTED', notes: 'legacy tanpa penanda' }],
    pr_items: [{ id: 'pi-s', pr_id: 'pr-sub', item_name: 'Kayu', quantity: 1, status: 'PENDING_APPROVAL' }]
  })
  const supabase = createMockSupabase()
  const res = await submitLeanMod.submitLean({ id: 'pr-sub', status: 'SUBMITTED' }, { supabase, confirmFn: () => true, setNotice: () => {}, loadAll: () => {} })
  eq('L7e SUBMITTED legacy ditolak (tidak dianggap lean)', false, res.ok)
  eq('L7f 0 write saat ditolak', 0, writeOps().length)
  eq('L7g catatan legacy tidak diubah', 'legacy tanpa penanda', db.purchase_requests[0].notes)
}
{
  // Stale: objek UI bilang DRAFT, DB ternyata APPROVED → harus ditolak.
  __reset({
    purchase_requests: [{ id: 'pr-st', pr_number: 'PR-302', status: 'APPROVED', notes: '' }],
    pr_items: [{ id: 'pi-st', pr_id: 'pr-st', item_name: 'Kayu', quantity: 1, status: 'APPROVED' }]
  })
  const supabase = createMockSupabase()
  const res = await submitLeanMod.submitLean({ id: 'pr-st', status: 'DRAFT' }, { supabase, confirmFn: () => true, setNotice: () => {}, loadAll: () => {} })
  eq('L7h stale status ditolak (verifikasi DB)', false, res.ok)
  eq('L7i 0 write saat stale', 0, writeOps().length)
}
{
  __reset({ purchase_requests: [{ id: 'pr-e', pr_number: 'PR-303', status: 'DRAFT', notes: '' }], pr_items: [] })
  const supabase = createMockSupabase()
  const res = await submitLeanMod.submitLean({ id: 'pr-e', status: 'DRAFT' }, { supabase, confirmFn: () => true, setNotice: () => {}, loadAll: () => {} })
  eq('L7j PR tanpa item ditolak', false, res.ok)
  eq('L7k 0 write saat PR kosong', 0, writeOps().length)
}
{
  __reset({ purchase_requests: [{ id: 'pr-c', pr_number: 'PR-304', status: 'DRAFT', notes: '' }], pr_items: [{ id: 'pi-c', pr_id: 'pr-c', item_name: 'Kayu', quantity: 2, status: 'PENDING_APPROVAL' }] })
  const supabase = createMockSupabase()
  const res = await submitLeanMod.submitLean({ id: 'pr-c', status: 'DRAFT' }, { supabase, confirmFn: () => false, setNotice: () => {}, loadAll: () => {} })
  eq('L7l batal konfirmasi → cancelled', 'cancelled', res.reason)
  eq('L7m batal → 0 write', 0, writeOps().length)
}
{
  // Klik ganda bersamaan (lock ref) — hanya satu yang menulis.
  __reset({ purchase_requests: [{ id: 'pr-l', pr_number: 'PR-305', status: 'DRAFT', notes: '' }], pr_items: [{ id: 'pi-l', pr_id: 'pr-l', item_name: 'Kayu', quantity: 2, status: 'PENDING_APPROVAL' }] })
  const supabase = createMockSupabase()
  const lockRef = { current: false }
  const opts = { supabase, confirmFn: () => true, setNotice: () => {}, loadAll: () => {}, lockRef }
  const [a, b] = await Promise.all([
    submitLeanMod.submitLean({ id: 'pr-l', status: 'DRAFT' }, opts),
    submitLeanMod.submitLean({ id: 'pr-l', status: 'DRAFT' }, opts)
  ])
  const okCount = [a, b].filter(r => r.ok).length
  eq('L7n dua klik bersamaan → hanya 1 sukses', 1, okCount)
  eq('L7o hanya 1 UPDATE purchase_requests', 1, __ops.filter(o => o.table === 'purchase_requests' && o.op === 'update').length)
}

// ---------- L8. Legacy pending tidak otomatis lean ----------
console.log('\nL8. Legacy pending TIDAK otomatis dianggap siap belanja')
{
  const legacyNoMarker = { id: 'pr-x', pr_number: 'PR-400', status: 'SUBMITTED', notes: '' }
  eq('L8a SUBMITTED tanpa penanda = LEGACY_UNKNOWN', 'LEGACY_UNKNOWN', lean.classifyRequest(legacyNoMarker).key)
  eq('L8b bukan actionable', false, lean.isActionable(legacyNoMarker))
  const legacyApproved = { id: 'pr-y', status: 'APPROVED', notes: '' }
  eq('L8c APPROVED lama tetap APPROVED (tidak diubah)', 'APPROVED', lean.classifyRequest(legacyApproved).key)
  const rejected = { id: 'pr-z', status: 'REJECTED', notes: '' }
  eq('L8d REJECTED historis tidak otomatis dibuka', 'REJECTED', lean.classifyRequest(rejected).key)
  eq('L8e REJECTED bukan actionable sebelum aksi admin', false, lean.isActionable(rejected))
}

// ---------- L9. Reminder ----------
console.log('\nL9. Reminder: approval_steps tidak dibaca, jenis approval disabled')
{
  const report = rulesMod.buildReport({
    dataset: {
      purchase_requests: [
        { id: 'pr-1', pr_number: 'PR-001', status: 'SUBMITTED', created_at: '2026-10-01T00:00:00Z' },
        { id: 'pr-2', pr_number: 'PR-002', status: 'DRAFT', created_at: '2026-09-01T00:00:00Z' }
      ],
      pr_items: [],
      approval_steps: [],
      receivings: [],
      receiving_items: [],
      handovers: [],
      projects: [],
      sales_invoices: null
    },
    sources: [
      { key: 'purchase_requests', table: 'purchase_requests', available: true, row_count: 2, fetched: 2, truncated: false, columns: [], error_code: null, error_message: null },
      { key: 'pr_items', table: 'pr_items', available: true, row_count: 0, fetched: 0, truncated: false, columns: [], error_code: null, error_message: null },
      { key: 'approval_steps', table: 'approval_steps', available: false, skipped_by_policy: true, row_count: 0, fetched: 0, truncated: false, columns: [], error_code: null, error_message: null },
      { key: 'receivings', table: 'receivings', available: true, row_count: 0, fetched: 0, truncated: false, columns: [], error_code: null, error_message: null },
      { key: 'receiving_items', table: 'receiving_items', available: true, row_count: 0, fetched: 0, truncated: false, columns: [], error_code: null, error_message: null },
      { key: 'handovers', table: 'handovers', available: true, row_count: 0, fetched: 0, truncated: false, columns: [], error_code: null, error_message: null },
      { key: 'projects', table: 'projects', available: true, row_count: 0, fetched: 0, truncated: false, columns: [], error_code: null, error_message: null },
      { key: 'sales_invoices', table: 'sales_invoices', available: false, row_count: 0, fetched: 0, truncated: false, columns: [], error_code: 'SCHEMA_UNAVAILABLE', error_message: 'tabel tidak ada' }
    ],
    asOf: '2026-10-18'
  })
  const blockedKinds = report.blocked.map(b => b.kind)
  check('L9a pr_overdue_approval DISABLED (bukan 0 temuan)', blockedKinds.includes('pr_overdue_approval'))
  const b = report.blocked.find(x => x.kind === 'pr_overdue_approval')
  eq('L9b alasan menyebut dinonaktifkan', true, /dinonaktifkan/.test(b.reason))
  eq('L9c ditandai disabled_by_policy', true, b.disabled_by_policy === true)
  check('L9d tidak ada item pr_overdue_approval', !report.items.some(i => i.kind === 'pr_overdue_approval'))
  check('L9e pr_draft_stale TETAP dievaluasi', report.items.some(i => i.kind === 'pr_draft_stale'))
  check('L9f approval_steps TIDAK dianggap sumber gagal (bukan degraded karena itu)', !report.notes.some(n => n.includes('Sumber data tidak tersedia: approval_steps')))
  check('L9g catatan menyebut sumber dilewati kebijakan', report.notes.some(n => n.includes('Sumber dilewati karena kebijakan Approval OFF')))
  eq('L9h kinds_available tidak memuat pr_overdue_approval', false, report.kinds.filter(k => !k.blocked).some(k => k.key === 'pr_overdue_approval'))
}

console.log(`\nHASIL LOGIC TEST: ${pass} lulus, ${fail} gagal`)
if (fail > 0) {
  console.log('GAGAL: ' + failures.join(' | '))
  process.exit(1)
}
