// ============================================================
// probe_run243_dupfresh.mjs — PENJAGA DOKUMEN GANDA MEMBACA DATABASE
//                              (pengunci perbaikan review run 242)
// ============================================================
// Review run 242 menemukan empat hal di pohon `323bfed`:
//
//   V1  `confirmDuplicateGuard` dipanggil dengan `ctx.rows` (memori halaman)
//       di 8 titik → dokumen yang dibuat admin lain SESUDAH halaman dimuat
//       tidak terlihat, dan dokumen duplikat bisa dikonfirmasi.
//   V2  Penjaga CREATE = SELECT-lalu-INSERT tanpa kunci → dua sesi bersamaan
//       sama-sama lolos (PostgreSQL nyata: 2 dokumen aktif, nol error).
//   V3  Rantai: dua dokumen aktif → KEDUA `handover_confirm` diterima.
//   V4  Form Tambah menawarkan penerimaan yang PASTI ditolak.
//
// Probe ini menguji PERILAKU yang dituntut perbaikan, bukan menambah
// assertion di jalur yang sudah "benar". Setiap check punya pasangan RED di
// pohon `323bfed` (lihat kolom "RED" di FINDINGS run 243).
//
//   F1  guardConfirmFresh: DB punya 2 dokumen, memori hanya 1 → DITOLAK
//   F2  guardConfirmFresh: baca DB GAGAL → fail closed (ok:false, failed)
//   F3  KONTROL POSITIF: satu dokumen → diizinkan, tanpa peringatan
//   F4  physicalHost dengan `ctx.rows` BASI → panel "dokumen duplikat",
//       BUKAN form konfirmasi
//   F5  physicalHost saat baca DB gagal → panel "pemeriksaan gagal" +
//       tombol "Periksa ulang" (bukan form, bukan jalan buntu tanpa sebab)
//   F6  antrean dengan `ctx.rows` BASI → tombol penutup boleh terlihat aktif
//       (tampilan), tetapi klik TIDAK menulis apa pun dan sebabnya terbaca
//   F7  view.jsx tombol ✓ dengan `ctx.rows` basi → modal konfirmasi TIDAK
//       dibuka (keputusan dari DB)
//   F8  insertUniqueActiveHandover: sudah ada dokumen aktif → NOL insert
//   F9  BALAPAN: sesi lain commit di antara SELECT dan INSERT kita →
//       dokumen kita DITARIK SENDIRI, hanya SATU dokumen aktif tersisa
//   F10 BALAPAN dengan created_at SAMA → tetap satu yang bertahan
//   F11 verifikasi sesudah insert GAGAL → `needsReview`, TIDAK diklaim sukses
//   F12 form Tambah: pilihan penerimaan yang sudah punya dokumen aktif
//       DINONAKTIFKAN + diberi label
//   F13 KONTROL POSITIF: penerimaan tanpa dokumen aktif tetap bisa dipilih
//   F14 KONTROL POSITIF: save.js tetap menyimpan saat tidak ada dokumen aktif
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
global.HTMLElement = dom0.window.HTMLElement
global.HTMLInputElement = dom0.window.HTMLInputElement
global.HTMLSelectElement = dom0.window.HTMLSelectElement
global.Event = dom0.window.Event
global.FileReader = dom0.window.FileReader

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)
const importDist = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const Q = await importDist('modules/handovers/queue.mjs')
const V = await importDist('modules/handovers/view.mjs')
const PM = await importDist('modules/handovers/physicalModal.mjs')
const PH = await importDist('modules/handovers/physicalHost.mjs')
const SAVE = await importDist('modules/handovers/save.mjs')
const FORM = await importDist('modules/handovers/form.mjs')

// Modul baru hanya ada SESUDAH fix run 243. Di pohon SEBELUM fix probe tetap
// jalan supaya RED-nya jujur (yang gagal = PERILAKU, bukan impor).
let DB = null
try { DB = await importDist('modules/handovers/duplicateGuardDb.mjs') } catch (e) {
  DB = null
  console.log('  (modul duplicateGuardDb TIDAK ADA di pohon ini — penjaga berbasis DB belum dipasang)')
}
const MISSING = {
  loadActiveHandovers: async () => ({ ok: false, rows: [], error: 'PENJAGA TIDAK ADA' }),
  guardConfirmFresh: async () => ({ ok: true, reason: '', canonicalId: null, fresh: true }),
  guardCreateFresh: async () => ({ ok: true, reason: '' }),
  insertUniqueActiveHandover: async () => ({ ok: true, row: { id: 'x' } }),
  loadActiveReceivingIds: async () => ({ ok: true, ids: {}, error: null })
}
DB = DB || MISSING

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const click = (el) => {
  if (!el) return false
  flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })))
  return true
}
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)

let roots = []
function mount(el) {
  for (const r of roots) { try { r.unmount() } catch (e) {} }
  roots = []
  dom0.window.document.body.innerHTML = ''
  const host = dom0.window.document.createElement('div')
  dom0.window.document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(el))
  roots.push(root)
  return dom0.window.document
}

// ---------------------------------------------------------------------------
// Fixture: SATU penerimaan, DUA dokumen aktif. `ho-old` kanonik.
// ---------------------------------------------------------------------------
const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-1', delivery_note: 'Nota INV-1', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const RI = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Semen', unit: 'Sak', quantity_received: 10 }]
const PR_ITEMS = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Semen', quantity: 10, unit: 'Sak', status: 'DI_TUKANG' }]
const HO_OLD = { id: 'ho-old', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-20', created_at: '2026-10-20T01:00:00Z', diserahkan_at: null, note: '' }
const HO_NEW = { ...HO_OLD, id: 'ho-new', handover_date: '2026-10-21', created_at: '2026-10-21T01:00:00Z' }
const HO_ONLY = { ...HO_OLD, id: 'ho-only' }

function resetDb({ handovers = [], nextError = null, nextErrorTable = null } = {}) {
  mock.__reset({
    receivings: [{ ...REC }],
    prItems: PR_ITEMS.map(p => ({ ...p })),
    receivingItems: RI.map(r => ({ ...r })),
    handovers: handovers.map(h => ({ ...h })),
    ledger: null
  })
  mock.__state.nextError = nextError
  mock.__state.nextErrorTable = nextErrorTable
}

function makeCtx(rows, extra = {}) {
  return {
    rows,
    columns: ['items', 'received_by', 'status', 'handover_date'],
    expandedAcuan: null,
    H: {
      receivingItemsForReceiving: (id) => RI.filter(r => r.receiving_id === id),
      prItemsForPr: () => PR_ITEMS
    },
    say: () => {}, refresh: () => {},
    allReceivings: [REC], allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    allReceivingItems: RI, allPrItems: PR_ITEMS, allVendors: [],
    onReceivingStatusChange: () => {}, onMarkHandoverDelivered: () => {},
    ...extra
  }
}

// ===========================================================================
console.log('\n=== F1. guardConfirmFresh — DB punya 2 dokumen, memori hanya 1 ===')
resetDb({ handovers: [HO_OLD, HO_NEW] })
const f1 = await DB.guardConfirmFresh({ handover: { ...HO_NEW } })
check('F1a dokumen duplikat DITOLAK walau ctx.rows tidak memuatnya', f1.ok === false, JSON.stringify(f1).slice(0, 200))
check('F1b sebabnya menyebut penyerahan dua kali / minus', /dua kali|minus/i.test(String(f1.reason || '')), String(f1.reason || '').slice(0, 160))
check('F1c keputusan menunjuk dokumen KANONIK dari DB', f1.canonicalId === 'ho-old', String(f1.canonicalId))
check('F1d ditandai fresh (bukan hasil memori)', f1.fresh === true, JSON.stringify(f1.fresh))
const f1b = await DB.guardConfirmFresh({ handover: { ...HO_OLD } })
check('F1e KONTROL POSITIF: dokumen kanonik tetap boleh + diberi peringatan', f1b.ok === true && !!f1b.warn, JSON.stringify(f1b).slice(0, 160))

console.log('\n=== F2. guardConfirmFresh — baca DB GAGAL → fail closed ===')
resetDb({ handovers: [HO_ONLY], nextError: { code: '42501', message: 'permission denied for table handovers' }, nextErrorTable: 'handovers' })
const f2 = await DB.guardConfirmFresh({ handover: { ...HO_ONLY } })
check('F2a gagal baca = TIDAK mengizinkan (ok:false)', f2.ok === false, JSON.stringify(f2).slice(0, 200))
check('F2b ditandai failed (UI bisa membedakan dari "duplikat")', f2.failed === true, JSON.stringify(f2.failed))
check('F2c sebabnya menyebut pemeriksaan tidak bisa dilakukan', /Tidak bisa memeriksa/i.test(String(f2.reason || '')), String(f2.reason || '').slice(0, 140))

console.log('\n=== F3. KONTROL POSITIF — satu dokumen, tanpa peringatan ===')
resetDb({ handovers: [HO_ONLY] })
const f3 = await DB.guardConfirmFresh({ handover: { ...HO_ONLY } })
check('F3a dokumen tunggal diizinkan', f3.ok === true, JSON.stringify(f3).slice(0, 160))
check('F3b tanpa peringatan palsu', !f3.warn, String(f3.warn || ''))

// ===========================================================================
console.log('\n=== F4. physicalHost — ctx.rows BASI, DB punya duplikat ===')
resetDb({ handovers: [HO_OLD, HO_NEW] })
PM.resetPhysicalModal()
PM.openPhysicalModal({ kind: 'confirm', handover: { ...HO_NEW } })
const doc4 = mount(React.createElement(PH.PhysicalModalHost, { ctx: makeCtx([{ ...HO_NEW }]) }))
await tick(60)
check('F4a panel "dokumen duplikat" muncul', !!tid(doc4, 'handover-confirm-dup-blocked'), `form=${!!tid(doc4, 'handover-confirm-form')}`)
check('F4b form konfirmasi TIDAK dirender', !tid(doc4, 'handover-confirm-form'))
check('F4c sebab penolakan terbaca di layar', /DUPLIKAT|dua kali/i.test(String(tid(doc4, 'handover-confirm-dup-blocked')?.textContent || '')),
  String(tid(doc4, 'handover-confirm-dup-blocked')?.textContent || '').slice(0, 160))
check('F4d nol RPC saat penolakan dirender', mock.__state.calls.filter(c => c.op === 'rpc').length === 0)

console.log('\n=== F5. physicalHost — baca DB gagal → panel "pemeriksaan gagal" ===')
resetDb({ handovers: [HO_ONLY], nextError: { code: '42501', message: 'permission denied for table handovers' }, nextErrorTable: 'handovers' })
PM.resetPhysicalModal()
PM.openPhysicalModal({ kind: 'confirm', handover: { ...HO_ONLY } })
const doc5 = mount(React.createElement(PH.PhysicalModalHost, { ctx: makeCtx([{ ...HO_ONLY }]) }))
await tick(60)
check('F5a panel "pemeriksaan gagal" muncul', !!tid(doc5, 'handover-confirm-dup-check-failed'), `form=${!!tid(doc5, 'handover-confirm-form')}`)
check('F5b form konfirmasi TIDAK dirender (fail closed)', !tid(doc5, 'handover-confirm-form'))
check('F5c sebabnya terbaca (bukan jalan buntu tanpa penjelasan)', /permission denied|Tidak bisa memeriksa/i.test(String(tid(doc5, 'handover-confirm-dup-check-failed')?.textContent || '')),
  String(tid(doc5, 'handover-confirm-dup-check-failed')?.textContent || '').slice(0, 160))
const retryBtn = [...doc5.querySelectorAll('button')].find(b => /Periksa ulang/i.test(b.textContent || ''))
check('F5d ada tombol "Periksa ulang" (tidak memaksa reload halaman)', !!retryBtn)
// Periksa ulang setelah DB pulih → form dirender.
mock.__state.nextError = null
if (retryBtn) click(retryBtn)
await tick(80)
check('F5e setelah "Periksa ulang" dan DB pulih, form konfirmasi dirender', !!tid(doc5, 'handover-confirm-form'),
  `blocked=${!!tid(doc5, 'handover-confirm-dup-check-failed')}`)

// ===========================================================================
console.log('\n=== F6. Antrean — ctx.rows BASI: klik penutup TIDAK menulis ===')
resetDb({ handovers: [HO_OLD, HO_NEW] })
PM.resetPhysicalModal()
const said6 = []
let rerender6 = () => {}
const ctx6 = makeCtx([{ ...HO_NEW }], { say: (m) => said6.push(String(m)), refresh: () => rerender6() })
const Wrapper6 = () => {
  const [, setT] = React.useState(0)
  rerender6 = () => setT(t => t + 1)
  return Q.renderHandoverQueue(ctx6)
}
const doc6 = mount(React.createElement(Wrapper6))
await tick(60)
const fin6 = tid(doc6, 'queue-act-terima-ho-new')
check('F6a tombol penutup ada (tampilan masih memakai memori — boleh)', !!fin6, `ada=${!!fin6}`)
const rpcBefore6 = mock.__state.calls.filter(c => c.op === 'rpc').length
click(fin6)
await tick(120)
const rpcAfter6 = mock.__state.calls.filter(c => c.op === 'rpc').length
check('F6b klik TIDAK menulis apa pun (nol RPC)', rpcAfter6 === rpcBefore6, `${rpcBefore6} → ${rpcAfter6}`)
check('F6c modal konfirmasi TIDAK dibuka', PM.__peekForTest() === null, JSON.stringify(PM.__peekForTest()))
check('F6d admin diberi sebab yang bisa dibaca', said6.some(m => /DUPLIKAT|dua kali|dokumen Serah Terima LAIN/i.test(m)), JSON.stringify(said6).slice(0, 260))

// ===========================================================================
console.log('\n=== F7. view.jsx tombol ✓ — ctx.rows BASI: modal TIDAK dibuka ===')
resetDb({ handovers: [HO_OLD, HO_NEW] })
PM.resetPhysicalModal()
const said7 = []
const ctx7 = makeCtx([{ ...HO_NEW }], { say: (m) => said7.push(String(m)) })
const doc7 = mount(React.createElement('table', null, React.createElement('tbody', null, React.createElement('tr', null, V.rowActions({ ...HO_NEW }, ctx7)))))
const btn7 = tid(doc7, 'btn-deliver-ho-new')
check('F7a tombol ✓ tampil aktif (tampilan memakai memori)', !!btn7 && btn7.disabled === false, `disabled=${btn7?.disabled}`)
click(btn7)
await tick(120)
check('F7b klik TIDAK membuka modal konfirmasi', PM.__peekForTest() === null, JSON.stringify(PM.__peekForTest()))
check('F7c sebabnya diberitahukan ke admin', said7.some(m => /DUPLIKAT|dua kali|dokumen Serah Terima LAIN/i.test(m)), JSON.stringify(said7).slice(0, 220))

// ===========================================================================
console.log('\n=== F8. insertUniqueActiveHandover — sudah ada dokumen aktif ===')
resetDb({ handovers: [HO_OLD] })
const before8 = mock.__state.handovers.size
const f8 = await DB.insertUniqueActiveHandover({
  data: { receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', note: '' }
})
const after8 = mock.__state.handovers.size
check('F8a simpan DITOLAK', f8.ok === false, JSON.stringify(f8).slice(0, 200))
check('F8b NOL baris baru dibuat (tidak insert lalu hapus)', after8 === before8, `${before8} → ${after8}`)
check('F8c alasan menyebut dokumen yang sudah ada', /SUDAH punya dokumen Serah Terima/i.test(String(f8.reason || '')), String(f8.reason || '').slice(0, 160))

console.log('\n=== F9. BALAPAN — sesi lain commit antara SELECT dan INSERT kita ===')
resetDb({ handovers: [] })
mock.__state.insertStamp = '2026-10-22T09:00:00Z'   // dokumen KITA (lebih akhir)
mock.__state.beforeInsert = () => {
  // Sesi lain menang lebih dulu: created_at LEBIH AWAL.
  mock.__state.handovers.set('ho-other', {
    ...HO_OLD, id: 'ho-other', created_at: '2026-10-22T08:59:59Z'
  })
}
const f9 = await DB.insertUniqueActiveHandover({
  data: { receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-22', note: '' }
})
const active9 = [...mock.__state.handovers.values()].filter(h => !h.diserahkan_at && h.receiving_id === 'rec1')
check('F9a simpan DITOLAK (kalah balapan)', f9.ok === false, JSON.stringify(f9).slice(0, 200))
check('F9b dokumen yang baru dibuat DITARIK SENDIRI', f9.withdrawn === true, JSON.stringify({ withdrawn: f9.withdrawn, reason: f9.reason }).slice(0, 200))
check('F9c hanya SATU dokumen aktif tersisa', active9.length === 1, `jumlah=${active9.length} → ${active9.map(h => h.id).join(',')}`)
check('F9d yang bertahan adalah dokumen yang LEBIH AWAL', active9[0]?.id === 'ho-other', String(active9[0]?.id))
check('F9e alasan menjelaskan dokumen dibatalkan otomatis', /DIBATALKAN otomatis/i.test(String(f9.reason || '')), String(f9.reason || '').slice(0, 200))

console.log('\n=== F10. BALAPAN dengan created_at SAMA → tetap satu yang bertahan ===')
resetDb({ handovers: [] })
mock.__state.insertStamp = '2026-10-22T10:00:00Z'
mock.__state.beforeInsert = () => {
  mock.__state.handovers.set('ho-twin', { ...HO_OLD, id: 'ho-twin', created_at: '2026-10-22T10:00:00Z' })
}
const f10 = await DB.insertUniqueActiveHandover({
  data: { receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-22', note: '' }
})
const active10 = [...mock.__state.handovers.values()].filter(h => !h.diserahkan_at && h.receiving_id === 'rec1')
check('F10a hasilnya DETERMINISTIK: satu dokumen bertahan', active10.length === 1, `jumlah=${active10.length} → ${active10.map(h => h.id).join(',')}`)
check('F10b penulis yang kalah tahu dirinya kalah', f10.ok === false, JSON.stringify(f10).slice(0, 160))

console.log('\n=== F11. Verifikasi sesudah insert GAGAL → needsReview, bukan klaim sukses ===')
resetDb({ handovers: [] })
let selectCount11 = 0
// Baca pertama (pre-check) sukses; baca kedua (verifikasi) gagal.
const origFrom = mock.supabase.from
mock.supabase.from = (table) => {
  if (table === 'handovers') {
    selectCount11 += 1
    // panggilan ke-3 = verifikasi (1: pre-check, 2: insert, 3: verifikasi)
  }
  const api = origFrom(table)
  return api
}
// Lebih presisi: pasang error HANYA untuk SELECT handovers kedua.
const origSelect = mock.__state
resetDb({ handovers: [] })
let selects11 = 0
const realFrom = mock.supabase.from
mock.supabase.from = (table) => {
  const api = realFrom(table)
  if (table !== 'handovers') return api
  const wrapped = {
    select(...args) {
      const b = api.select(...args)
      const origThen = b.then.bind(b)
      b.then = (res, rej) => {
        selects11 += 1
        if (selects11 === 2) {
          return Promise.resolve({ data: null, error: { code: '08006', message: 'connection failure' } }).then(res, rej)
        }
        return origThen(res, rej)
      }
      return b
    },
    insert: (...a) => api.insert(...a),
    update: (...a) => api.update(...a),
    delete: (...a) => api.delete(...a)
  }
  return wrapped
}
const f11 = await DB.insertUniqueActiveHandover({
  data: { receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-22', note: '' }
})
mock.supabase.from = realFrom
check('F11a hasil TIDAK diklaim sukses', f11.ok === false, JSON.stringify(f11).slice(0, 200))
check('F11b ditandai needsReview (dokumen mungkin sudah ada di DB)', f11.needsReview === true, JSON.stringify(f11.needsReview))
check('F11c alasan menyuruh memeriksa daftar sebelum mengulang', /periksa|pastikan|periksa ulang/i.test(String(f11.reason || '')), String(f11.reason || '').slice(0, 200))

// ===========================================================================
console.log('\n=== F12. Form Tambah — pilihan yang pasti ditolak DINONAKTIFKAN ===')
resetDb({ handovers: [HO_OLD] })
const REC2 = { ...REC, id: 'rec2', invoice_no: 'INV-2', project_name: '[200] Gudang' }
const formCtx = {
  form: { receiving_id: '', project_id: '', received_by: '', handover_date: '', notes: '' },
  setForm: () => {}, field: () => null, isEdit: false, editRow: null,
  allReceivings: [{ ...REC }, REC2],
  allRequestsFull: [{ id: 'pr1', pr_number: 'PR-1' }]
}
const doc12 = mount(React.createElement('div', null, FORM.formBody(formCtx)))
await tick(80)
const opt1 = tid(doc12, 'handover-receiving-option-rec1')
const opt2 = tid(doc12, 'handover-receiving-option-rec2')
check('F12a penerimaan yang SUDAH punya dokumen aktif dinonaktifkan', !!opt1 && opt1.disabled === true, `ada=${!!opt1} disabled=${opt1?.disabled}`)
check('F12b labelnya menjelaskan sebab (bukan sekadar abu-abu)', /sudah ada Serah Terima aktif/i.test(String(opt1?.textContent || '')), String(opt1?.textContent || '').slice(0, 120))
check('F12c ditandai di DOM untuk diuji/dibaca', opt1?.getAttribute('data-has-active') === '1', String(opt1?.getAttribute('data-has-active')))
check('F12d KONTROL POSITIF: penerimaan tanpa dokumen aktif tetap bisa dipilih', !!opt2 && opt2.disabled === false, `ada=${!!opt2} disabled=${opt2?.disabled}`)

// ===========================================================================
console.log('\n=== F13. save.js tetap menyimpan saat tidak ada dokumen aktif ===')
resetDb({ handovers: [] })
const says13 = []
let closed13 = false
await SAVE.save({
  form: { receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Joko', handover_date: '2026-10-22', notes: '' },
  isEdit: false, editRow: null,
  say: (m) => says13.push(String(m)), close: () => { closed13 = true }, refresh: () => {}, setSaving: () => {},
  page: 'handovers'
})
const active13 = [...mock.__state.handovers.values()].filter(h => !h.diserahkan_at && h.receiving_id === 'rec1')
check('F13a dokumen BARU tersimpan (1 baris)', active13.length === 1, `jumlah=${active13.length}`)
check('F13b modal ditutup setelah simpan berhasil', closed13 === true)
check('F13c pesan sukses yang sama seperti sebelumnya', says13.some(m => /berhasil ditambahkan/i.test(m)), JSON.stringify(says13).slice(0, 200))
check('F13d status awal DRAFT (bukan CONFIRMED — konfirmasi fisik terpisah)', active13[0]?.status === 'DRAFT', String(active13[0]?.status))

console.log(`\n=== HASIL PROBE RUN 243: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
