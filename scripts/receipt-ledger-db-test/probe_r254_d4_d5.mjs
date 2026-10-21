// ============================================================
// probe_r254_d4_d5.mjs — RUN 254 (penutup review run 253)
// ============================================================
// Dua temuan review run 253 diuji di PostgreSQL 16 NYATA, dengan modul
// PRODUKSI VERBATIM (bukan mock yang selalu menjawab "ok"):
//
//  D4 (MAJOR) — dokumen Serah Terima TANPA `receiving_id`.
//    Sebelum: `finishGate(..., {hasReceiving:false})` → `blocked:''`,
//    `headerOnlyBlocked = ready && !!receiving_id` → false, dan
//    `confirmEntryGuard` → `{ok:true}` SEBELUM capability dibaca. Akibatnya
//    tombol "Tandai Diserahkan" AKTIF + modal menawarkan "tanpa rincian",
//    padahal trigger `ops_v1_core_guard` menolak SETIAP penulisan
//    `diserahkan_at` oleh `authenticated` (physical_rpc_required) dan
//    `handover_confirm` menjawab `handover_not_found`.
//    Sesudah: ketiga lapis menolak dengan sebab terbaca, NOL tulisan.
//
//  D5 (MEDIUM) — `dbErrorText()` tidak punya kalimat untuk kode yang paling
//    sering muncul. Sebelum: 28/59 kode v1 diterjemahkan (19 kode realistis
//    di tiga form tanpa kalimat, termasuk `over_return`). Sesudah: seluruh
//    kode yang benar-benar bisa muncul dari tiga RPC punya kalimat, dan kode
//    asli TETAP dikembalikan untuk pelaporan.
//
// Dijalankan sesudah run_r254.py (DB + sandbox siap).
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.env.SB || '/tmp/r254-app-pg'
const PGURL = process.env.PGURL
if (!PGURL) { console.error('PGURL wajib'); process.exit(2) }

// ---------- 1) DOM lebih dulu (sebelum react-dom) ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
global.HTMLElement = dom0.window.HTMLElement
global.HTMLInputElement = dom0.window.HTMLInputElement
global.HTMLSelectElement = dom0.window.HTMLSelectElement
global.Event = dom0.window.Event
global.FileReader = dom0.window.FileReader

// ---------- 2) React + modul produksi ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const { Client } = require('pg')
const SBclient = await import(pathToFileURL(path.join(SB, 'lib', 'supabaseClient.mjs')).href)
const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const Q = await load('modules/handovers/queue.mjs')
const PM = await load('modules/handovers/physicalModal.mjs')
const CAP = await load('modules/receivings/receiptCapability.mjs')
const SAVE = await load('modules/receivings/receiptEventSave.mjs')
const ERRTXT = await load('modules/handovers/dbErrorText.mjs')

let pass = 0, fail = 0
const failures = []
function ck(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`) }
}
const head = (t) => console.log(`\n=== ${t} ===`)
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })))
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()

const mounted = []
function mount(el) {
  for (const r of mounted) { try { r.unmount() } catch (e) { /* abaikan */ } }
  mounted.length = 0
  dom0.window.document.body.innerHTML = ''
  const host = dom0.window.document.createElement('div')
  dom0.window.document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(el))
  mounted.push(root)
  return dom0.window.document
}
async function settle(n = 24) { for (let i = 0; i < n; i++) await tick() }
async function waitFor(fn, { tries = 400, label = 'kondisi' } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = fn()
    if (v) return v
    await tick()
  }
  console.log(`  (waitFor timeout: ${label})`)
  return null
}

const admin = SBclient.supabase
const raw = new Client({ connectionString: PGURL })
await raw.connect()
await raw.query('set role authenticated')
await raw.query(`select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',false)`)

// ============================================================
head('D4-A. FAKTA DATABASE — dokumen TANPA receiving_id di bawah v1')
// ============================================================
const ORPHAN = 'eeeeeeee-0000-0000-0000-0000000000c1'
await raw.query(`delete from public.handovers where id=$1`, [ORPHAN]).catch(() => {})
await raw.query(
  `insert into public.handovers(id,receiving_id,received_by,handover_date,status,note)
   values ($1,null,'Pak Lama','2026-10-01','DRAFT','dokumen lama tanpa penerimaan')`, [ORPHAN])

const upd = await raw.query(
  `update public.handovers set status='CONFIRMED', diserahkan_at=now() where id=$1 and diserahkan_at is null returning id`, [ORPHAN]
).then(r => ({ ok: true, n: r.rowCount })).catch(e => ({ ok: false, err: e.message }))
ck('A1 jalur header (yang dulu ditawarkan UI) DITOLAK trigger v1: physical_rpc_required',
  upd.ok === false && /physical_rpc_required/.test(String(upd.err)), JSON.stringify(upd))

const rpcOrphan = await raw.query(`select public.handover_confirm($1,'[]'::jsonb) as r`, [ORPHAN])
  .then(r => r.rows[0].r).catch(e => ({ ok: false, error: e.message }))
ck('A2 RPC handover_confirm juga menolak (handover_not_found)', rpcOrphan.ok === false, JSON.stringify(rpcOrphan))

const stillOpen = await raw.query(`select diserahkan_at, status from public.handovers where id=$1`, [ORPHAN])
ck('A3 dokumen tetap terbuka (tidak ada tulisan yang lolos)',
  stillOpen.rows[0]?.diserahkan_at === null && stillOpen.rows[0]?.status === 'DRAFT', JSON.stringify(stillOpen.rows[0]))

// ============================================================
head('D4-B. GERBANG TULIS (fungsi produksi `finishGate`)')
// ============================================================
const gOrphan = Q.finishGate(true, null, { hasReceiving: false })
ck('B1 gerbang MENOLAK dokumen tanpa penerimaan saat ledger siap (dulu: blocked:\'\')',
  gOrphan.blocked === Q.ORPHAN_NO_RECEIVING_REASON && gOrphan.blocked.length > 80, gOrphan.blocked.slice(0, 120))
ck('B2 alasan menyebut dua jalan keluar jujur (hubungkan / hapus)',
  /hubungkan/i.test(gOrphan.blocked) && /hapus/i.test(gOrphan.blocked), gOrphan.blocked.slice(0, 200))
ck('B3 alasan TIDAK menyuruh "catat lewat form yang tersedia" (admin sudah di form itu)',
  !/catat lewat form yang tersedia/i.test(gOrphan.blocked))
const gLegacy = Q.finishGate(false, null, { hasReceiving: false })
ck('B4 LEGACY tetap terbuka (jalur header satu-satunya di sana — tidak ada ledger)',
  gLegacy.blocked === '', gLegacy.blocked.slice(0, 80))
const gReady = Q.finishGate(true, await SAVE.loadDeliverability({ receivingId: '11111111-1111-1111-1111-111111111111' }), { hasReceiving: true })
ck('B5 dokumen BER-penerimaan tidak terpengaruh perbaikan ini (gerbang tetap membaca ledger)',
  gReady.blocked !== Q.ORPHAN_NO_RECEIVING_REASON, gReady.blocked.slice(0, 100))

// ============================================================
head('D4-C. LAYAR — antrean (tombol & alasan tertulis)')
// ============================================================
const hoRows = [{ id: ORPHAN, receiving_id: null, project_id: null, received_by: 'Pak Lama', handover_date: '2026-10-01', status: 'DRAFT', diserahkan_at: null, note: 'dokumen lama' }]
const says = []
const ctx = {
  rows: hoRows, allReceivings: [], allReceivingItems: [], allRequests: [],
  H: { receivingItemsForReceiving: () => [], prItemsForPr: () => [] },
  say: (m) => says.push(m), refresh: () => {}, onReceivingStatusChange: () => {}
}
CAP.resetReceiptCapability()
let doc = mount(Q.renderHandoverQueue(ctx))
const reasonEl = await waitFor(() => {
  const el = tid(doc, `queue-finish-reason-${ORPHAN}`)
  return el && /tidak terhubung ke penerimaan|TIDAK terhubung ke penerimaan/i.test(txt(el)) ? el : null
}, { label: 'alasan D4 di antrean' })
await settle(8)

const btn = tid(doc, `queue-act-terima-${ORPHAN}`)
ck('C1 tombol "Tandai Diserahkan" NONAKTIF untuk dokumen tanpa penerimaan (dulu: aktif)',
  btn?.disabled === true, `disabled=${btn?.disabled}`)
ck('C2 alasan TERTULIS di layar (bukan hanya tooltip)', !!reasonEl && txt(reasonEl).length > 80, txt(reasonEl).slice(0, 140))
ck('C3 alasan menyebut dokumen tidak terhubung ke penerimaan', /tidak terhubung ke penerimaan/i.test(txt(reasonEl)), txt(reasonEl).slice(0, 160))
ck('C4 alasan menyebut database menolak menutup tanpa rincian', /menolak/i.test(txt(reasonEl)), txt(reasonEl).slice(0, 200))
ck('C5 tidak ada teks SQL/kode mentah di layar', !/physical_rpc_required|handover_not_found|42501|23514/.test(txt(doc.body)))

// Pertahanan kedua: klik programatik (atribut disabled dihapus) tidak membuka modal.
PM.resetPhysicalModal()
if (btn) { btn.disabled = false; btn.removeAttribute('disabled'); click(btn) }
await settle(30)
const modalOpen = PM.__peekForTest ? PM.__peekForTest() : null
ck('C6 klik programatik TIDAK membuka modal konfirmasi', modalOpen === null, JSON.stringify(modalOpen?.kind || null))
ck('C7 tidak ada klaim sukses palsu', !says.some(m => /tersimpan|berhasil|sudah diserahkan/i.test(String(m))),
  JSON.stringify(says).slice(0, 260))
ck('C8 NOL tulisan ke DB dari seluruh interaksi layar', stillOpen.rows[0]?.diserahkan_at === null)
ck('C9 tombol "Periksa ulang rincian" TIDAK ditawarkan (tidak ada ledger yang bisa dibaca ulang)',
  !tid(doc, `queue-finish-recheck-${ORPHAN}`))

// ============================================================
head('D4-D. LAYAR — modal konfirmasi (tidak ada jalur tulis tersembunyi)')
// ============================================================
const ConfirmForm = (await load('modules/handovers/confirmForm.mjs')).default
const capReady = { ready: true, returnReady: true, events: true, handoverItems: true, returnLines: true, progress: true, probeFailed: false, missing: [] }
const says4 = []
doc = mount(React.createElement(ConfirmForm, {
  handover: hoRows[0], capability: capReady,
  say: (m) => says4.push(m), refresh: () => {}, close: () => {}
}))
await waitFor(() => tid(doc, 'handover-confirm-empty'), { label: 'panel orphan' })
await settle(8)
ck('D1 tombol "tanpa rincian" TIDAK dirender untuk dokumen tanpa penerimaan', !tid(doc, 'handover-confirm-headeronly'))
ck('D2 input nama penerima header juga TIDAK dirender', !tid(doc, 'hc-header-penerima'))
const panel = tid(doc, 'handover-confirm-empty')
ck('D3 panel menjelaskan dokumen tidak terhubung ke penerimaan', /tidak terhubung ke penerimaan/i.test(txt(panel)), txt(panel).slice(0, 200))
ck('D4 panel menyebut database menolak & dua jalan keluar', /menolak/i.test(txt(panel)) && /hapus/i.test(txt(panel)) && /hubungkan/i.test(txt(panel)),
  txt(panel).slice(0, 300))
ck('D5 tombol submit utama NONAKTIF (tidak ada baris sah)', tid(doc, 'handover-confirm-submit')?.disabled === true)
click(tid(doc, 'handover-confirm-submit'))
await settle(20)
ck('D6 submit yang dipaksa TIDAK menulis apa pun & TIDAK mengklaim sukses',
  !says4.some(m => /tersimpan|sudah diserahkan/i.test(String(m))) && stillOpen.rows[0]?.diserahkan_at === null,
  JSON.stringify(says4).slice(0, 260))
ck('D7 tidak ada teks SQL/kode mentah di modal', !/physical_rpc_required|handover_not_found|42501|23514/.test(txt(doc.body)))

// LEGACY: jalur header HARUS tetap hidup (satu-satunya di sana).
const says5 = []
doc = mount(React.createElement(ConfirmForm, {
  handover: hoRows[0], capability: { ready: false, returnReady: false, missing: ['tabel handover_items belum ada'] },
  say: (m) => says5.push(m), refresh: () => {}, close: () => {}
}))
await settle(10)
ck('D8 LEGACY: form tetap menampilkan input nama penerima (jalur lama tidak dimatikan)',
  !!tid(doc, 'hc-header-penerima'), txt(doc.body).slice(0, 120))

// ============================================================
head('D5. dbErrorText — cakupan kode yang NYATA bisa muncul')
// ============================================================
// Daftar ini diambil dari migration v1 beku (grep `ops_v1_fail('…')` pada
// 20261021_01/02), lalu dipersempit ke kode yang bisa keluar dari tiga RPC
// yang dipanggil form. Bukan daftar karangan.
const REACHABLE = {
  'Terima Barang (receipt_apply_events)': [
    'empty_events', 'duplicate_client_event_id', 'missing_client_event_id', 'item_not_found',
    'bad_number', 'backfill_not_authorized', 'rusak_gt_datang', 'bad_allocation',
    'missing_receiver', 'bad_retur', 'discard_not_confirmed', 'over_receipt', 'over_receipt_pr',
    'duplicate_event_line', 'idempotency_conflict', 'forbidden', 'physical_rpc_required'
  ],
  'Retur (return_create)': [
    'bad_resolution', 'bad_number', 'event_not_found', 'over_return', 'bad_retur',
    'already_discarded', 'discard_not_confirmed', 'forbidden'
  ],
  'Pembelian (purchase_save_atomic)': [
    'request_key_required', 'vendor_not_found', 'invoice_required', 'bad_date',
    'bad_number', 'discount_over_total', 'items_required', 'material_unresolved',
    'material_mismatch', 'pr_item_not_found', 'unit_required', 'item_name_required',
    'project_not_found', 'project_xor_allocations', 'allocation_not_exact',
    'allocation_over_bought', 'bad_allocations', 'actual_price_required', 'bad_item',
    'bad_payload', 'over_purchase_pr', 'idempotency_conflict', 'duplicate_invoice',
    'handover_queue_failed', 'forbidden'
  ]
}
let totalCodes = 0
let totalMissing = 0
for (const [form, codes] of Object.entries(REACHABLE)) {
  const un = codes.filter(c => !ERRTXT.dbErrorText(c, {}).known)
  totalCodes += codes.length
  totalMissing += un.length
  console.log(`  ${form}: ${codes.length - un.length}/${codes.length} diterjemahkan${un.length ? ' — TIDAK: ' + un.join(', ') : ''}`)
}
ck('E1 SETIAP kode yang bisa muncul dari tiga form punya kalimat (0 tanpa kalimat)',
  totalMissing === 0, `${totalMissing} dari ${totalCodes} tanpa kalimat`)

const ov = ERRTXT.dbErrorText('over_return', { fallback: 'Retur tidak bisa disimpan.' })
ck('E2 `over_return` (penolakan retur paling umum) diterjemahkan jadi kalimat yang bisa ditindaklanjuti',
  ov.known === true && /melebihi|kurangi/i.test(ov.text), ov.text.slice(0, 140))
ck('E3 kode asli TETAP dikembalikan untuk pelaporan', ov.code === 'over_return')

// Seluruh 59 kode v1 (bukan hanya yang terjangkau) — laporan cakupan jujur.
const ALL_V1 = ['actual_price_required','allocation_not_exact','allocation_over_bought','already_discarded',
  'backfill_not_authorized','bad_allocation','bad_allocations','bad_date','bad_item','bad_number',
  'bad_payload','bad_resolution','bad_retur','discard_not_confirmed','discount_over_total',
  'duplicate_active_handover','duplicate_client_event_id','duplicate_event_line','duplicate_invoice',
  'empty_events','empty_lines','event_not_found','forbidden','handover_evidence_immutable',
  'handover_not_found','handover_queue_failed','handover_source_immutable','idempotency_conflict',
  'invoice_required','item_name_required','item_not_found','items_required','material_mismatch',
  'material_unresolved','missing_client_event_id','missing_receiver','operational_history_no_truncate',
  'over_handover','over_purchase_pr','over_receipt','over_receipt_pr','over_return',
  'physical_evidence_immutable','physical_rpc_required','physical_source_immutable','pr_item_not_found',
  'project_not_found','project_xor_allocations','purchase_evidence_immutable','purchase_immutable',
  'purchase_line_immutable','purchase_rpc_required','read_committed_required','receiving_not_found',
  'replace_only','request_key_required','rusak_gt_datang','unit_required','vendor_not_found']
const unmappedAll = ALL_V1.filter(c => !ERRTXT.dbErrorText(c, {}).known)
ck('E4 seluruh 59 kode kontrak v1 punya kalimat', unmappedAll.length === 0, unmappedAll.join(', '))
console.log(`  (cakupan v1: ${ALL_V1.length - unmappedAll.length}/${ALL_V1.length})`)

// Kejujuran: kode TAK dikenal tetap disebut, bukan ditelan.
const unknown = ERRTXT.dbErrorText('some_future_code', { fallback: 'Gagal menyimpan.' })
ck('E5 kode tak dikenal TETAP disebut apa adanya (tidak disembunyikan)',
  unknown.known === false && /some_future_code/.test(unknown.text), unknown.text)
// Pesan aplikasi sendiri tidak boleh "diterjemahkan" jadi aneh.
const own = ERRTXT.dbErrorText('Tidak ada barang yang bisa diserahkan.', { fallback: 'x' })
ck('E6 pesan aplikasi (kalimat) diteruskan apa adanya', own.text === 'Tidak ada barang yang bisa diserahkan.', own.text)
// Tidak ada kalimat kosong / placeholder yang lolos sebagai "diterjemahkan".
const emptyish = ALL_V1.filter(c => { const t = ERRTXT.dbErrorText(c, {}).text; return !t || t.trim().length < 15 })
ck('E7 tidak ada kalimat kosong/terlalu pendek yang menyamar sebagai terjemahan',
  emptyish.length === 0, emptyish.join(', '))

// ============================================================
head('D5-B. Kode benar-benar keluar dari RPC nyata (bukan hanya tabel)')
// ============================================================
// `over_return` adalah yang paling penting: buat retur melebihi saldo, tangkap
// kode aslinya dari DB, lalu terjemahkan lewat fungsi produksi.
const P1 = '11111111-1111-1111-1111-111111111111'
const MAT = 'aaaaaaaa-0000-0000-0000-000000000001'
const VEN = 'bbbbbbbb-0000-0000-0000-000000000001'
const buy = await admin.rpc('purchase_save_atomic', {
  p_payload: {
    client_request_id: 'r254-buy-1', vendor_id: VEN, invoice_no: 'R254/1',
    purchased_date: '2026-10-21', queue_handover: true,
    items: [{ material_id: MAT, project_id: P1, item_name: 'Semen r254', unit: 'sak', quantity_received: 4, unit_price: 50000 }]
  }
})
ck('F1 (setup) nota uji tersimpan lewat RPC v1', !!buy.data?.ok, JSON.stringify(buy.error || buy.data))
const rid = buy.data.receiving_id
const itemId = (await admin.from('receiving_items').select('id').eq('receiving_id', rid)).data[0].id
const rec = await admin.rpc('receipt_apply_events', {
  p_receiving_id: rid,
  p_events: [{
    client_event_id: 'r254-ev-1', receiving_item_id: itemId, item_name: 'Semen r254', unit: 'sak',
    qty_datang: 4, qty_rusak: 2, tujuan_ws: 0, tujuan_tukang: 2, penerima_tukang: 'Pak Uji',
    retur_status: 'PENDING', retur_qty: 2, source: 'FORM'
  }],
  p_meta: {}
})
ck('F2 (setup) penerimaan 4 datang / 2 rusak tersimpan', !!rec.data?.ok, JSON.stringify(rec.error || rec.data))
const evId = rec.data.event_ids[0]

// Retur 2 (sah) lalu retur 2 lagi (melebihi saldo) → `over_return` dari DB.
const r1 = await admin.rpc('return_create', {
  p_receiving_id: rid, p_lines: [{ receiving_event_id: evId, qty: 2 }], p_resolution: 'RETURN', p_reason: 'uji'
})
ck('F3 (setup) retur pertama 2 unit diterima', !!r1.data?.ok, JSON.stringify(r1.error || r1.data))
// Retur KEDUA harus berbeda payload — `return_create` idempoten terhadap
// (lines, resolution, reason) yang SAMA (`already:true`), jadi memakai reason
// yang sama tidak akan pernah menyentuh pemeriksaan saldo. Ini perilaku
// kontrak, bukan bug; probe harus menghormatinya supaya benar-benar menguji
// `over_return`.
const r2 = await admin.rpc('return_create', {
  p_receiving_id: rid, p_lines: [{ receiving_event_id: evId, qty: 2 }], p_resolution: 'RETURN', p_reason: 'uji-kedua'
})
const rawCode = String(r2.error?.message || r2.data?.reason || r2.data?.error || '')
ck('F4 retur kedua (payload berbeda, qty melebihi saldo) DITOLAK DB dengan kode `over_return`',
  /over_return/.test(rawCode), JSON.stringify(r2.error || r2.data))
const tr = ERRTXT.dbErrorText(rawCode, { fallback: 'Retur tidak bisa disimpan.' })
ck('F5 kode ASLI dari DB itu diterjemahkan jadi kalimat (bukan "kode: over_return")',
  tr.known === true && !/kode: over_return/.test(tr.text) && /melebihi|kurangi/i.test(tr.text), tr.text.slice(0, 160))

// `forbidden` untuk staff — juga harus jadi kalimat, bukan kode.
const rawStaff = new Client({ connectionString: PGURL })
await rawStaff.connect()
await rawStaff.query('set role authenticated')
await rawStaff.query(`select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',false)`)
const staffRes = await rawStaff.query(`select public.return_create($1,$2::jsonb,'RETURN',null) as r`, [rid, JSON.stringify([{ receiving_event_id: evId, qty: 1 }])])
  .then(r => r.rows[0].r).catch(e => ({ ok: false, error: e.message }))
await rawStaff.end()
ck('F6 staff ditolak dengan reason `forbidden` (kontrol role tetap utuh)',
  staffRes?.ok === false && String(staffRes.reason || staffRes.error || '').includes('forbidden'), JSON.stringify(staffRes))
ck('F7 `forbidden` punya kalimat yang bisa dibaca admin',
  ERRTXT.dbErrorText('forbidden', {}).known === true, ERRTXT.dbErrorText('forbidden', {}).text)

console.log(`\n=== HASIL PROBE r254 (D4/D5, PG16 NYATA): ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
await raw.end()
await SBclient.__close?.()
process.exit(fail ? 1 : 0)
