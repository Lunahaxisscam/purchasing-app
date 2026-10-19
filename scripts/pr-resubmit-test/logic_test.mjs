// ============================================================
// UJI LOGIKA SUBMIT / RESUBMIT PR (t_3032ecb7)
// ============================================================
// Menguji service boundary submit & resubmit PR:
// 1. cancel0writes: pembatalan konfirmasi menghasilkan 0 penulisan DB
// 2. sameID/no preserved: PR ID dan pr_number tetap sama, tidak buat PR baru
// 3. pending approval reuse/no duplicate: approval_step lama diaktifkan kembali tanpa step ganda
// 4. doubleclick1request: klik ganda hanya memicu 1 permintaan penulisan
// 5. stale/ineligible denied: status non-eligible (SUBMITTED/APPROVED/ORDERED/stale) ditolak aman
// 6. errors no false success: kegagalan DB dilaporkan jujur tanpa klaim sukses
// 7. old rejectionnote preserved: catatan penolakan lama pada approval step tidak dihapus
// 8. ORDERED unchanged: item yang sudah ORDERED tidak di-reset ke PENDING_APPROVAL
// 9. empty invalidqty denied: PR kosong atau qty <= 0 / NaN ditolak tanpa tulis DB
// 10. old DRAFT/REVISI compatible: alur DRAFT dan REVISI tetap berfungsi normal
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMockSupabase, __reset, __setInjectedError, __ops, db } from './mock-supabaseClient.mjs'

const SB = process.cwd()
const mod = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ✗ FAIL ${name} ${extra}`)
  }
}

// Import modul submit (hasil kompilasi SWC)
let handleFinishPr = null
try {
  const submitMod = await mod('modules/requests/submit.mjs')
  handleFinishPr = submitMod.handleFinishPr
} catch (e) {
  // Jika modul belum dibuat / belum diekspor, tandai untuk pengujian RED awal
  console.log('Catatan: modules/requests/submit.mjs belum tersedia (RED phase sebelum implementasi). Error:', e.message)
}

console.log('=== PENGUJIAN LOGIKA: SERVICE BOUNDARY SUBMIT / RESUBMIT PR ===')

// Test 1: cancel0writes
{
  __reset({
    purchase_requests: [{ id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED', title: 'Test 1' }],
    pr_items: [{ id: 'pi-1', pr_id: 'pr-012', item_name: 'Plywood', quantity: 2, status: 'REJECTED' }],
    approval_steps: [{ id: 'as-1', purchase_request_id: 'pr-012', step_number: 1, status: 'REJECTED', note: 'Harga kemahalan' }]
  })
  const supabase = createMockSupabase()
  let noticeMsg = ''
  let loadAllCalled = false

  if (handleFinishPr) {
    const res = await handleFinishPr(
      { id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED' },
      {
        supabase,
        confirmFn: () => false, // User klik Batal
        setNotice: (m) => { noticeMsg = m },
        loadAll: () => { loadAllCalled = true }
      }
    )
    const writeOps = __ops.filter(o => ['insert', 'update', 'delete'].includes(o.op))
    check('cancel0writes: pembatalan konfirmasi menghasilkan 0 penulisan DB', writeOps.length === 0, `Operasi tulis: ${writeOps.length}`)
  } else {
    check('cancel0writes: pembatalan konfirmasi menghasilkan 0 penulisan DB', false, 'handleFinishPr belum tersedia')
  }
}

// Test 2: sameID/no preserved
{
  __reset({
    purchase_requests: [{ id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED', title: 'Test 1', project_id: 'p1', notes: 'Catatan asli' }],
    pr_items: [{ id: 'pi-1', pr_id: 'pr-012', item_name: 'Plywood', quantity: 2, status: 'REJECTED' }],
    approval_steps: [{ id: 'as-1', purchase_request_id: 'pr-012', step_number: 1, status: 'REJECTED', note: 'Revisi spesifikasi' }]
  })
  const supabase = createMockSupabase()
  let noticeMsg = ''
  let loadAllCalled = false

  if (handleFinishPr) {
    await handleFinishPr(
      { id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED' },
      {
        supabase,
        confirmFn: () => true,
        setNotice: (m) => { noticeMsg = m },
        loadAll: () => { loadAllCalled = true }
      }
    )
    const prInDb = db.purchase_requests.find(p => p.id === 'pr-012')
    const insertPrOps = __ops.filter(o => o.op === 'insert' && o.table === 'purchase_requests')
    check('sameID/no preserved: tidak ada insert purchase_requests baru', insertPrOps.length === 0)
    check('sameID/no preserved: ID tetap pr-012', prInDb && prInDb.id === 'pr-012')
    check('sameID/no preserved: pr_number tetap PR-012', prInDb && prInDb.pr_number === 'PR-012')
    check('sameID/no preserved: status berubah menjadi SUBMITTED', prInDb && prInDb.status === 'SUBMITTED')
    check('sameID/no preserved: title dan project_id tidak hilang', prInDb && prInDb.title === 'Test 1' && prInDb.project_id === 'p1')
  } else {
    check('sameID/no preserved: tidak ada insert purchase_requests baru', false, 'handleFinishPr belum ada')
    check('sameID/no preserved: ID tetap pr-012', false, 'handleFinishPr belum ada')
    check('sameID/no preserved: pr_number tetap PR-012', false, 'handleFinishPr belum ada')
    check('sameID/no preserved: status berubah menjadi SUBMITTED', false, 'handleFinishPr belum ada')
    check('sameID/no preserved: title dan project_id tidak hilang', false, 'handleFinishPr belum ada')
  }
}

// Test 3: pending approval reuse/no duplicate
{
  __reset({
    purchase_requests: [{ id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED', title: 'Test 1' }],
    pr_items: [{ id: 'pi-1', pr_id: 'pr-012', item_name: 'Plywood', quantity: 2, status: 'REJECTED' }],
    approval_steps: [
      { id: 'as-1', purchase_request_id: 'pr-012', step_number: 1, status: 'REJECTED', note: 'Catatan penolakan', decided_at: '2026-10-18T10:00:00Z' }
    ]
  })
  const supabase = createMockSupabase()

  if (handleFinishPr) {
    await handleFinishPr(
      { id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED' },
      {
        supabase,
        confirmFn: () => true,
        setNotice: () => {},
        loadAll: () => {}
      }
    )
    const steps = db.approval_steps.filter(s => s.purchase_request_id === 'pr-012')
    const insertStepOps = __ops.filter(o => o.op === 'insert' && o.table === 'approval_steps')
    check('pending approval reuse: tidak ada insert approval_steps baru', insertStepOps.length === 0, `Ada insert: ${insertStepOps.length}`)
    check('pending approval reuse: jumlah step approval tetap 1 (tidak duplikat)', steps.length === 1, `Jumlah step: ${steps.length}`)
    check('pending approval reuse: status step menjadi PENDING', steps[0] && steps[0].status === 'PENDING')
    check('pending approval reuse: decided_at di-reset ke null', steps[0] && steps[0].decided_at === null)
  } else {
    check('pending approval reuse: tidak ada insert approval_steps baru', false, 'handleFinishPr belum ada')
    check('pending approval reuse: jumlah step approval tetap 1', false, 'handleFinishPr belum ada')
    check('pending approval reuse: status step menjadi PENDING', false, 'handleFinishPr belum ada')
    check('pending approval reuse: decided_at di-reset ke null', false, 'handleFinishPr belum ada')
  }
}

// Test 4: doubleclick1request
{
  __reset({
    purchase_requests: [{ id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED', title: 'Test 1' }],
    pr_items: [{ id: 'pi-1', pr_id: 'pr-012', item_name: 'Plywood', quantity: 2, status: 'REJECTED' }],
    approval_steps: [{ id: 'as-1', purchase_request_id: 'pr-012', step_number: 1, status: 'REJECTED' }]
  })
  const supabase = createMockSupabase()
  let actionBusy = false
  const lockRef = { current: false }

  if (handleFinishPr) {
    // Simulasi dua klik beruntun sebelum state update selesai
    const p1 = handleFinishPr(
      { id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED' },
      {
        supabase,
        confirmFn: () => true,
        setNotice: () => {},
        loadAll: () => {},
        actionBusy,
        setActionBusy: (b) => { actionBusy = b },
        lockRef
      }
    )
    const p2 = handleFinishPr(
      { id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED' },
      {
        supabase,
        confirmFn: () => true,
        setNotice: () => {},
        loadAll: () => {},
        actionBusy,
        setActionBusy: (b) => { actionBusy = b },
        lockRef
      }
    )
    await Promise.all([p1, p2])
    const prUpdateOps = __ops.filter(o => o.op === 'update' && o.table === 'purchase_requests')
    check('doubleclick1request: klik ganda hanya memicu 1 kali update status PR', prUpdateOps.length === 1, `Jumlah update: ${prUpdateOps.length}`)
  } else {
    check('doubleclick1request: klik ganda hanya memicu 1 kali update status PR', false, 'handleFinishPr belum ada')
  }
}

// Test 5: stale/ineligible denied
{
  const supabase = createMockSupabase()
  let noticeMsg = ''

  if (handleFinishPr) {
    for (const status of ['SUBMITTED', 'APPROVED', 'ORDERED']) {
      __reset({
        purchase_requests: [{ id: `pr-${status}`, pr_number: `PR-${status}`, status, title: 'Test' }],
        pr_items: [{ id: 'pi-1', pr_id: `pr-${status}`, item_name: 'Plywood', quantity: 2, status }],
        approval_steps: [{ id: 'as-1', purchase_request_id: `pr-${status}`, step_number: 1, status }]
      })
      noticeMsg = ''
      await handleFinishPr(
        { id: `pr-${status}`, pr_number: `PR-${status}`, status },
        {
          supabase,
          confirmFn: () => true,
          setNotice: (m) => { noticeMsg = m },
          loadAll: () => {}
        }
      )
      const writeOps = __ops.filter(o => ['insert', 'update', 'delete'].includes(o.op))
      check(`stale/ineligible denied: status ${status} ditolak dan 0 operasi tulis`, writeOps.length === 0)
      check(`stale/ineligible denied: pesan penolakan informatif untuk ${status}`, noticeMsg.toLowerCase().includes('tidak dapat') || noticeMsg.toLowerCase().includes('status'))
    }
  } else {
    check('stale/ineligible denied: status non-eligible ditolak', false, 'handleFinishPr belum ada')
  }
}

// Test 6: errors no false success
{
  __reset({
    purchase_requests: [{ id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED', title: 'Test 1' }],
    pr_items: [{ id: 'pi-1', pr_id: 'pr-012', item_name: 'Plywood', quantity: 2, status: 'REJECTED' }],
    approval_steps: [{ id: 'as-1', purchase_request_id: 'pr-012', step_number: 1, status: 'REJECTED' }]
  })
  __setInjectedError('approval_steps.update', 'Simulated database deadlock')
  const supabase = createMockSupabase()
  let noticeMsg = ''

  if (handleFinishPr) {
    await handleFinishPr(
      { id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED' },
      {
        supabase,
        confirmFn: () => true,
        setNotice: (m) => { noticeMsg = m },
        loadAll: () => {}
      }
    )
    const prInDb = db.purchase_requests.find(p => p.id === 'pr-012')
    check('errors no false success: pesan notice memuat keterangan error', noticeMsg.includes('Gagal') || noticeMsg.includes('error') || noticeMsg.includes('deadlock'), `Notice: ${noticeMsg}`)
    check('errors no false success: tidak mengklaim berhasil masuk approval', !noticeMsg.toLowerCase().includes('berhasil'))
    check('errors no false success: status PR tidak diubah bila approval gagal', prInDb.status === 'REJECTED')
  } else {
    check('errors no false success: kegagalan DB dilaporkan jujur', false, 'handleFinishPr belum ada')
  }
}

// Test 7: old rejectionnote preserved
{
  const oldNote = 'Spesifikasi salah, harap ganti ke profil 8mm hitam'
  __reset({
    purchase_requests: [{ id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED', title: 'Test 1' }],
    pr_items: [{ id: 'pi-1', pr_id: 'pr-012', item_name: 'Plywood', quantity: 2, status: 'REJECTED' }],
    approval_steps: [{ id: 'as-1', purchase_request_id: 'pr-012', step_number: 1, status: 'REJECTED', note: oldNote }]
  })
  const supabase = createMockSupabase()

  if (handleFinishPr) {
    await handleFinishPr(
      { id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED' },
      {
        supabase,
        confirmFn: () => true,
        setNotice: () => {},
        loadAll: () => {}
      }
    )
    const stepInDb = db.approval_steps.find(s => s.id === 'as-1')
    check('old rejectionnote preserved: catatan penolakan lama tidak terhapus', stepInDb && stepInDb.note === oldNote, `Catatan saat ini: ${stepInDb?.note}`)
  } else {
    check('old rejectionnote preserved: catatan penolakan lama tidak terhapus', false, 'handleFinishPr belum ada')
  }
}

// Test 8: ORDERED unchanged
{
  __reset({
    purchase_requests: [{ id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED', title: 'Test 1' }],
    pr_items: [
      { id: 'pi-1', pr_id: 'pr-012', item_name: 'List T (8mm)', quantity: 5, status: 'ORDERED' },
      { id: 'pi-2', pr_id: 'pr-012', item_name: 'Sekrup 2 inch', quantity: 10, status: 'REJECTED' }
    ],
    approval_steps: [{ id: 'as-1', purchase_request_id: 'pr-012', step_number: 1, status: 'REJECTED' }]
  })
  const supabase = createMockSupabase()

  if (handleFinishPr) {
    await handleFinishPr(
      { id: 'pr-012', pr_number: 'PR-012', status: 'REJECTED' },
      {
        supabase,
        confirmFn: () => true,
        setNotice: () => {},
        loadAll: () => {}
      }
    )
    const item1 = db.pr_items.find(i => i.id === 'pi-1')
    const item2 = db.pr_items.find(i => i.id === 'pi-2')
    check('ORDERED unchanged: item berstatus ORDERED tidak di-reset ke PENDING_APPROVAL', item1 && item1.status === 'ORDERED', `Status item 1: ${item1?.status}`)
    check('ORDERED unchanged: item REJECTED diperbarui ke PENDING_APPROVAL', item2 && item2.status === 'PENDING_APPROVAL', `Status item 2: ${item2?.status}`)
  } else {
    check('ORDERED unchanged: item berstatus ORDERED tidak di-reset', false, 'handleFinishPr belum ada')
  }
}

// Test 9: empty invalidqty denied
{
  const supabase = createMockSupabase()

  if (handleFinishPr) {
    // Kasus 9a: 0 items
    __reset({
      purchase_requests: [{ id: 'pr-empty', pr_number: 'PR-EMPTY', status: 'REJECTED', title: 'No items' }],
      pr_items: [],
      approval_steps: [{ id: 'as-1', purchase_request_id: 'pr-empty', step_number: 1, status: 'REJECTED' }]
    })
    let notice9a = ''
    await handleFinishPr(
      { id: 'pr-empty', pr_number: 'PR-EMPTY', status: 'REJECTED' },
      {
        supabase,
        confirmFn: () => true,
        setNotice: (m) => { notice9a = m },
        loadAll: () => {}
      }
    )
    const writeOps9a = __ops.filter(o => ['insert', 'update', 'delete'].includes(o.op))
    check('empty invalidqty denied: PR tanpa item ditolak 0 writes', writeOps9a.length === 0)
    check('empty invalidqty denied: notice menyatakan item kosong', notice9a.toLowerCase().includes('item') || notice9a.toLowerCase().includes('kosong'))

    // Kasus 9b: Qty <= 0
    __reset({
      purchase_requests: [{ id: 'pr-badqty', pr_number: 'PR-BADQTY', status: 'REJECTED', title: 'Bad qty' }],
      pr_items: [{ id: 'pi-1', pr_id: 'pr-badqty', item_name: 'Plywood', quantity: 0, status: 'REJECTED' }],
      approval_steps: [{ id: 'as-1', purchase_request_id: 'pr-badqty', step_number: 1, status: 'REJECTED' }]
    })
    let notice9b = ''
    await handleFinishPr(
      { id: 'pr-badqty', pr_number: 'PR-BADQTY', status: 'REJECTED' },
      {
        supabase,
        confirmFn: () => true,
        setNotice: (m) => { notice9b = m },
        loadAll: () => {}
      }
    )
    const writeOps9b = __ops.filter(o => ['insert', 'update', 'delete'].includes(o.op))
    check('empty invalidqty denied: PR dengan qty <= 0 ditolak 0 writes', writeOps9b.length === 0)
    check('empty invalidqty denied: notice menyatakan quantity tidak valid', notice9b.toLowerCase().includes('quantity') || notice9b.toLowerCase().includes('tidak valid'))
  } else {
    check('empty invalidqty denied: PR tanpa item / invalid qty ditolak', false, 'handleFinishPr belum ada')
  }
}

// Test 10: old DRAFT/REVISI compatible
{
  __reset({
    purchase_requests: [{ id: 'pr-draft', pr_number: 'PR-DRAFT', status: 'DRAFT', title: 'New PR' }],
    pr_items: [{ id: 'pi-1', pr_id: 'pr-draft', item_name: 'Semen', quantity: 10, status: 'PENDING_APPROVAL' }],
    approval_steps: [],
    profiles: [{ id: 'prof-admin', role: 'admin' }]
  })
  const supabase = createMockSupabase()
  let noticeMsg = ''
  let loadAllCalled = false

  if (handleFinishPr) {
    await handleFinishPr(
      { id: 'pr-draft', pr_number: 'PR-DRAFT', status: 'DRAFT' },
      {
        supabase,
        session: { user: { id: 'user-1' } },
        confirmFn: () => true,
        setNotice: (m) => { noticeMsg = m },
        loadAll: () => { loadAllCalled = true }
      }
    )
    const prInDb = db.purchase_requests.find(p => p.id === 'pr-draft')
    const stepInDb = db.approval_steps.find(s => s.purchase_request_id === 'pr-draft')
    check('old DRAFT compatible: PR DRAFT berhasil disubmit ke SUBMITTED', prInDb && prInDb.status === 'SUBMITTED')
    check('old DRAFT compatible: approval step dibuat untuk PR baru', !!stepInDb && stepInDb.status === 'PENDING')
    check('old DRAFT compatible: loadAll terpanggil', loadAllCalled)
    check('old DRAFT compatible: notice mengonfirmasi berhasil masuk modul Approval', noticeMsg.includes('Approval') || noticeMsg.includes('selesai'))
  } else {
    check('old DRAFT compatible: PR DRAFT kompatibel', false, 'handleFinishPr belum ada')
  }
}

console.log(`\nHASIL LOGIKA TEST: ${pass} lulus, ${fail} gagal`)
if (fail > 0) {
  process.exit(1)
}
