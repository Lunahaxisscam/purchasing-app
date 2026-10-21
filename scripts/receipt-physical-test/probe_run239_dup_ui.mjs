// ============================================================
// probe_run239_dup_ui.mjs — PENJAGA DOKUMEN GANDA di UI (run 239)
// ============================================================
// LENSA: DUA DOKUMEN untuk SATU PENERIMAAN. 16 run sebelumnya (101..237)
// menguji simpan, tampil, kesiapan, retur, waktu, dan hapus — tidak satu pun
// menguji dua dokumen aktif pada penerimaan yang sama.
//
// Diuji pada modul VERBATIM (hasil transform SWC), React + jsdom:
//
//   D1  `handoverCreateGuard` MENOLAK pembuatan dokumen kedua saat sudah ada
//       dokumen aktif; KONTROL POSITIF: penerimaan tanpa dokumen tetap boleh.
//   D2  `confirmDuplicateGuard` menolak dokumen NON-kanonik dan mengizinkan
//       yang kanonik (dengan peringatan) — urutan kanonik deterministik.
//   D3  Antrean: tombol penutup dokumen duplikat NONAKTIF + badge jujur;
//       klik programatik TIDAK memanggil RPC (nol tulisan).
//   D4  Aksi baris desktop & kartu mobile: tombol ✓ NONAKTIF untuk dokumen
//       duplikat, dan klik TIDAK membuka modal konfirmasi.
//   D5  `physicalHost` (satu choke point): walau modal dibuka programatik,
//       yang dirender adalah penolakan — BUKAN form konfirmasi.
//   D6  KONTROL POSITIF: dokumen kanonik tetap bisa membuka konfirmasi, dan
//       dokumen SETELAH sebelumnya diserahkan (serah terima bertahap, H3)
//       tetap boleh — penjaga tidak boleh memblokir pekerjaan sah.
//   D7  `save.js` mode TAMBAH memeriksa DB lebih dulu (fail closed) dan
//       TIDAK memanggil insert saat dokumen aktif sudah ada.
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

// Modul penjaga hanya ada SESUDAH fix run 239. Di pohon SEBELUM fix, probe
// harus tetap jalan supaya RED-nya jujur (yang gagal = PERILAKU, bukan impor).
let G = null
try { G = await importDist('modules/handovers/duplicateGuard.mjs') } catch (e) {
  G = null
  console.log('  (modul duplicateGuard TIDAK ADA di pohon ini — penjaga belum dipasang)')
}
const MISSING = { ok: true, reason: 'PENJAGA TIDAK ADA', canonicalId: null, duplicate: false, activeCount: 0, isCanonical: true }
G = G || {
  handoverCreateGuard: () => MISSING,
  confirmDuplicateGuard: () => MISSING,
  duplicateInfoFor: () => ({ duplicate: false, activeCount: 1, canonicalId: null, isCanonical: true, others: [] }),
  activeDocumentsFor: () => [],
  canonicalDocumentId: () => null
}

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
// Fixture: SATU penerimaan, DUA dokumen aktif.
// `ho-old` dibuat lebih dulu (created_at paling awal) → KANONIK.
// ---------------------------------------------------------------------------
const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-1', delivery_note: 'Nota INV-1', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const RI = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Semen', unit: 'Sak', quantity_received: 10 }]
const PR_ITEMS = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Semen', quantity: 10, unit: 'Sak', status: 'DI_TUKANG' }]
const HO_OLD = { id: 'ho-old', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-20', created_at: '2026-10-20T01:00:00Z', diserahkan_at: null, note: '' }
const HO_NEW = { ...HO_OLD, id: 'ho-new', handover_date: '2026-10-21', created_at: '2026-10-21T01:00:00Z' }
const HO_ONLY = { ...HO_OLD, id: 'ho-only' }
// Serah terima BERTAHAP (H3): dokumen lama SUDAH diserahkan, dokumen baru sah.
const HO_DONE = { ...HO_OLD, id: 'ho-done', diserahkan_at: '2026-10-20T05:00:00Z', status: 'CONFIRMED' }

function makeCtx(rows, extra = {}) {
  return {
    rows,
    columns: ['items', 'received_by', 'status', 'handover_date'],
    expandedAcuan: null,
    H: {
      receivingItemsForReceiving: (id) => RI.filter(r => r.receiving_id === id),
      prItemsForPr: () => PR_ITEMS
    },
    say: () => {},
    refresh: () => {},
    allReceivings: [REC], allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    allReceivingItems: RI, allPrItems: PR_ITEMS, allVendors: [],
    onReceivingStatusChange: () => {}, onMarkHandoverDelivered: () => {},
    ...extra
  }
}

// ===========================================================================
console.log('\n=== D1. Pembuatan dokumen kedua DITOLAK (penjaga murni) ===')
const dupCreate = G.handoverCreateGuard({ receiving: { id: 'rec1' }, handovers: [HO_OLD, HO_NEW] })
check('D1a menolak membuat dokumen saat sudah ada dokumen AKTIF', dupCreate.ok === false, JSON.stringify(dupCreate).slice(0, 160))
check('D1b alasan menyebut dokumen yang sudah ada (bisa ditindaklanjuti)', /SUDAH punya dokumen Serah Terima/i.test(String(dupCreate.reason || '')), String(dupCreate.reason || '').slice(0, 120))
check('D1c menunjuk dokumen yang harus dibuka (existingId = dokumen paling awal)', dupCreate.existingId === 'ho-old', String(dupCreate.existingId))
const okCreate = G.handoverCreateGuard({ receiving: { id: 'rec1' }, handovers: [HO_DONE] })
check('D1d KONTROL POSITIF: dokumen yang SUDAH diserahkan tidak menghalangi dokumen baru (serah terima bertahap)', okCreate.ok === true, JSON.stringify(okCreate))
const okCreateEmpty = G.handoverCreateGuard({ receiving: { id: 'rec1' }, handovers: [] })
check('D1e KONTROL POSITIF: penerimaan tanpa dokumen tetap boleh', okCreateEmpty.ok === true, JSON.stringify(okCreateEmpty))
const noRec = G.handoverCreateGuard({ receiving: null, handovers: [] })
check('D1f penerimaan kosong tetap ditolak (tidak boleh orphan)', noRec.ok === false)

console.log('\n=== D2. Konfirmasi: hanya dokumen KANONIK yang boleh ===')
const gOld = G.confirmDuplicateGuard({ handover: HO_OLD, handovers: [HO_OLD, HO_NEW] })
const gNew = G.confirmDuplicateGuard({ handover: HO_NEW, handovers: [HO_NEW, HO_OLD] })
check('D2a dokumen paling awal (kanonik) DIIZINKAN', gOld.ok === true, JSON.stringify(gOld).slice(0, 140))
check('D2b dokumen duplikat DITOLAK', gNew.ok === false, JSON.stringify(gNew).slice(0, 140))
check('D2c hasil TIDAK bergantung urutan array masukan (deterministik)', gOld.canonicalId === 'ho-old' && gNew.canonicalId === 'ho-old',
  `${gOld.canonicalId} / ${gNew.canonicalId}`)
check('D2d dokumen kanonik diberi PERINGATAN ada duplikat', /dokumen Serah Terima LAIN/i.test(String(gOld.warn || '')), String(gOld.warn || '').slice(0, 120))
check('D2e alasan penolakan menjelaskan akibatnya (diserahkan dua kali / minus)',
  /dua kali|Dua kali|minus/i.test(String(gNew.reason || '')), String(gNew.reason || '').slice(0, 160))
const gSingle = G.confirmDuplicateGuard({ handover: HO_ONLY, handovers: [HO_ONLY] })
check('D2f KONTROL POSITIF: satu dokumen saja tidak diberi peringatan apa pun', gSingle.ok === true && !gSingle.warn, JSON.stringify(gSingle))
const gStaged = G.confirmDuplicateGuard({ handover: HO_NEW, handovers: [HO_DONE, HO_NEW] })
check('D2g KONTROL POSITIF: dokumen baru setelah yang lama DISERAHKAN tetap boleh', gStaged.ok === true, JSON.stringify(gStaged))

// ===========================================================================
console.log('\n=== D3. Antrean: tombol penutup dokumen DUPLIKAT nonaktif + nol tulisan ===')
async function renderQueue(rows) {
  mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: rows.map(h => ({ ...h })), ledger: null })
  const says = []
  let rerender = () => {}
  const ctx = makeCtx([...rows], { say: (m) => says.push(m), refresh: () => rerender() })
  const Wrapper = () => {
    const [, setT] = React.useState(0)
    rerender = () => setT(t => t + 1)
    return Q.renderHandoverQueue(ctx)
  }
  const doc = mount(React.createElement(Wrapper))
  await tick(30)   // capability probe (LEGACY) selesai
  return { doc, says }
}
const rq = await renderQueue([HO_OLD, HO_NEW])
const finNew = tid(rq.doc, 'queue-act-terima-ho-new')
const finOld = tid(rq.doc, 'queue-act-terima-ho-old')
check('D3a kartu dokumen DUPLIKAT menampilkan tombol penutup NONAKTIF', !!finNew && finNew.disabled === true, `ada=${!!finNew} disabled=${finNew?.disabled}`)
check('D3b sebabnya terbaca di title tombol', /DUPLIKAT/i.test(String(finNew?.getAttribute('title') || '')), String(finNew?.getAttribute('title') || '').slice(0, 120))
check('D3c badge peringatan dokumen ganda tampil di kartu duplikat', !!tid(rq.doc, 'queue-dup-badge-ho-new'))
check('D3d badge menyebut jumlah dokumen di kartu kanonik', /2 dokumen/i.test(String(tid(rq.doc, 'queue-dup-badge-ho-old')?.textContent || '')),
  String(tid(rq.doc, 'queue-dup-badge-ho-old')?.textContent || ''))
const callsBefore = mock.__state.calls.filter(c => c.op === 'rpc').length
click(finNew)
await tick(20)
const callsAfter = mock.__state.calls.filter(c => c.op === 'rpc').length
check('D3e klik pada tombol NONAKTIF tidak menulis apa pun (nol RPC)', callsAfter === callsBefore, `${callsBefore} → ${callsAfter}`)
check('D3f KONTROL POSITIF: tombol penutup dokumen KANONIK tetap aktif', !!finOld && finOld.disabled === false, `disabled=${finOld?.disabled}`)

// ===========================================================================
console.log('\n=== D4. Aksi baris: ✓ desktop & kartu mobile NONAKTIF untuk duplikat ===')
const ctxRow = makeCtx([HO_OLD, HO_NEW])
const docRowNew = mount(React.createElement('table', null, React.createElement('tbody', null, React.createElement('tr', null, V.rowActions(HO_NEW, ctxRow)))))
const btnNew = tid(docRowNew, 'btn-deliver-ho-new')
check('D4a tombol ✓ desktop dokumen duplikat NONAKTIF', !!btnNew && btnNew.disabled === true, `ada=${!!btnNew} disabled=${btnNew?.disabled}`)
check('D4b ikon berubah menjadi 🔒 (bukan ✓)', String(btnNew?.textContent || '').includes('🔒'), String(btnNew?.textContent || ''))
PM.resetPhysicalModal()
click(btnNew)
await tick(10)
check('D4c klik tidak membuka modal konfirmasi (store tetap kosong)', PM.__peekForTest() === null, JSON.stringify(PM.__peekForTest()))
const docRowOld = mount(React.createElement('table', null, React.createElement('tbody', null, React.createElement('tr', null, V.rowActions(HO_OLD, ctxRow)))))
check('D4d KONTROL POSITIF: ✓ dokumen kanonik tetap aktif', tid(docRowOld, 'btn-deliver-ho-old')?.disabled === false)

const docMobNew = mount(React.createElement('div', null, V.mobileCard(HO_NEW, ctxRow)))
const mobNew = tid(docMobNew, 'btn-deliver-mobile-ho-new')
check('D4e tombol ✓ kartu mobile dokumen duplikat NONAKTIF', !!mobNew && mobNew.disabled === true, `ada=${!!mobNew} disabled=${mobNew?.disabled}`)
PM.resetPhysicalModal()
click(mobNew)
await tick(10)
check('D4f klik kartu mobile tidak membuka modal', PM.__peekForTest() === null)
const docMobOld = mount(React.createElement('div', null, V.mobileCard(HO_OLD, ctxRow)))
check('D4g KONTROL POSITIF: kartu mobile dokumen kanonik tetap aktif', tid(docMobOld, 'btn-deliver-mobile-ho-old')?.disabled === false)

// ===========================================================================
console.log('\n=== D5. physicalHost: choke point menolak walau modal dibuka programatik ===')
PM.resetPhysicalModal()
mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO_OLD }, { ...HO_NEW }], ledger: null })
PM.openPhysicalModal({ kind: 'confirm', handover: { ...HO_NEW } })
const hostDoc = mount(React.createElement(PH.PhysicalModalHost, { ctx: makeCtx([HO_OLD, HO_NEW]) }))
await tick(30)
check('D5a yang dirender adalah PENOLAKAN, bukan form konfirmasi', !!tid(hostDoc, 'handover-confirm-dup-blocked'), `form=${!!tid(hostDoc, 'handover-confirm-form')}`)
check('D5b form konfirmasi TIDAK dirender sama sekali', !tid(hostDoc, 'handover-confirm-form'))
check('D5c sebab penolakan terbaca di layar', /DUPLIKAT|dua kali/i.test(String(tid(hostDoc, 'handover-confirm-dup-blocked')?.textContent || '')),
  String(tid(hostDoc, 'handover-confirm-dup-blocked')?.textContent || '').slice(0, 160))
const rpcHost = mock.__state.calls.filter(c => c.op === 'rpc').length
check('D5d nol RPC saat penolakan dirender', rpcHost === 0, String(rpcHost))

console.log('\n=== D5e. KONTROL POSITIF: dokumen KANONIK tetap membuka form konfirmasi ===')
PM.resetPhysicalModal()
mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO_OLD }, { ...HO_NEW }], ledger: null })
PM.openPhysicalModal({ kind: 'confirm', handover: { ...HO_OLD } })
const hostDoc2 = mount(React.createElement(PH.PhysicalModalHost, { ctx: makeCtx([HO_OLD, HO_NEW]) }))
await tick(30)
check('D5e dokumen kanonik merender form konfirmasi (bukan penolakan)', !!tid(hostDoc2, 'handover-confirm-form'), `blocked=${!!tid(hostDoc2, 'handover-confirm-dup-blocked')}`)

// ===========================================================================
console.log('\n=== D6. save.js mode TAMBAH: periksa DB dulu, JANGAN insert ===')
async function runSave(rows) {
  mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: rows.map(h => ({ ...h })), ledger: null })
  const says = []
  let closed = false
  const ctx = {
    form: { receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Joko', handover_date: '2026-10-21', notes: '' },
    isEdit: false, editRow: null,
    say: (m) => says.push(m), close: () => { closed = true }, refresh: () => {}, setSaving: () => {},
    page: 'handovers'
  }
  const before = mock.__state.handovers.size
  await SAVE.save(ctx)
  const after = mock.__state.handovers.size
  return { says, closed, inserted: after - before }
}
const sDup = await runSave([HO_OLD, HO_NEW])
check('D6a simpan DITOLAK saat sudah ada dokumen aktif (tidak ada baris baru)', sDup.inserted === 0, String(sDup.inserted))
check('D6b admin diberi alasan yang bisa dibaca', sDup.says.some(m => /SUDAH punya dokumen Serah Terima/i.test(String(m))), JSON.stringify(sDup.says).slice(0, 220))
check('D6c modal TIDAK ditutup (admin bisa memperbaiki pilihan)', sDup.closed === false)
const sOk = await runSave([HO_DONE])
check('D6d KONTROL POSITIF: dokumen baru setelah yang lama diserahkan TETAP tersimpan', sOk.inserted === 1, String(sOk.inserted))

// Fail closed: pembacaan DB gagal → jangan menulis.
mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [], ledger: null })
mock.__state.nextError = { code: '42501', message: 'permission denied for table handovers' }
const saysErr = []
const beforeErr = mock.__state.handovers.size
await SAVE.save({
  form: { receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Joko', handover_date: '2026-10-21', notes: '' },
  isEdit: false, editRow: null, say: (m) => saysErr.push(m), close: () => {}, refresh: () => {}, setSaving: () => {}, page: 'handovers'
})
check('D6e pembacaan gagal → TIDAK menulis (fail closed)', mock.__state.handovers.size === beforeErr, `${beforeErr} → ${mock.__state.handovers.size}`)
check('D6f …dan sebabnya menyebut pemeriksaan gagal, bukan sukses palsu',
  saysErr.some(m => /Tidak bisa memeriksa dokumen Serah Terima/i.test(String(m))), JSON.stringify(saysErr).slice(0, 200))

console.log(`\n=== HASIL PROBE 239: ${pass} PASS / ${fail} FAIL ===`)
if (failures.length) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
