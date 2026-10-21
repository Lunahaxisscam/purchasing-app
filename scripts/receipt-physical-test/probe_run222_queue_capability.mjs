// ============================================================
// probe_run222_queue_capability.mjs — KUNCI PERBAIKAN REVIEW RUN 219
// ============================================================
// Review run 219 memblok task ini dengan 3 temuan yang semuanya bersumber dari
// SATU akar: `queue.jsx` memakai model keadaan DUA nilai (`!!cap?.ready` /
// `!!cap?.returnReady`) sementara banner di file yang sama sudah memakai TIGA.
//
//   S1 (MAJOR)  probe `null` / probe GAGAL → banner jujur ("memeriksa"/"GAGAL")
//               tetapi tombol borongan di bawahnya AKTIF dan MENULIS
//               `pr_items.status`, menimpa tujuan per barang; tombol penutup
//               membuka form header INLINE yang mengunci dokumen tanpa rincian.
//   S2 (MAJOR)  migrasi SEBAGIAN (events ada, view belum) disimpulkan `legacy`
//               → banner bilang "belum aktif" padahal tabelnya ADA dan berisi.
//   S3 (MEDIUM) `problemPlan(..., !!cap?.returnReady)` → panel Bermasalah
//               menawarkan jalur TULIS STATUS header di keadaan tidak diketahui.
//
// Probe ini menguji PERILAKU (bukan diff), dan mengunci yang TIDAK BOLEH
// berubah: LEGACY asli tetap satu-satunya jalur yang menulis.
//
// Dijalankan SESUDAH harness utama oleh run.py; exit code dilaporkan terpisah.
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
const CAP = await importDist('modules/receivings/receiptCapability.mjs')
const ConfirmForm = (await importDist('modules/handovers/confirmForm.mjs')).default
const ReceiptForm = (await importDist('modules/handovers/receiptForm.mjs')).default
const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
// `click` TIDAK melempar saat elemen hilang: di pohon pra-perbaikan kartu bisa
// sudah lenyap (dokumen terkunci oleh klik sebelumnya), dan probe RED harus
// melaporkan perilakunya — bukan crash di tengah jalan.
const click = (el) => {
  if (!el) return false
  flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })))
  return true
}
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
const roots = []
function mount(el) {
  for (const r of roots) { try { r.unmount() } catch (e) {} }
  roots.length = 0
  dom0.window.document.body.innerHTML = ''
  const host = dom0.window.document.createElement('div')
  dom0.window.document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(el))
  roots.push(root)
  return dom0.window.document
}

const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-BARU', delivery_note: 'Nota INV-BARU', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const RI = [
  { id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 },
  { id: 'ri2', receiving_id: 'rec1', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', quantity_received: 4 }
]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
const FRESH_PR = () => ([
  { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng', status: 'RECEIVED' }
])
// Nota SATU barang — dipakai untuk membuktikan jalur LEGACY (status header)
// memang masih hidup; jalur itu memang menolak nota multi-item (batas lama).
const RI1 = [RI[0]]
const PR1 = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' }]
// Tujuan BERBEDA per barang — inti S1/S2: satu klik borongan menghapusnya.
const LEDGER = {
  receivingEvents: [
    { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 10, qty_rusak: 0, tujuan_ws: 10, tujuan_tukang: 0, penerima_tukang: null, retur_status: 'NONE', retur_qty: 0, discard_confirmed: false },
    { id: 'ev2', receiving_id: 'rec1', receiving_item_id: 'ri2', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', qty_datang: 4, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 4, penerima_tukang: 'Pak Budi', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false }
  ],
  handoverItems: [], returnLines: [], returnCases: [], progress: []
}

let rerender = () => {}
function renderQueue(ledger, failProbe, { items = RI, prItems = FRESH_PR } = {}) {
  mock.__reset({ receivings: [{ ...REC }], prItems: prItems().map(p => ({ ...p })), receivingItems: items, handovers: [{ ...HO }], ledger })
  CAP.resetReceiptCapability()
  const says = []
  const ctx = {
    rows: [mock.__state.handovers.get('h1')].filter(Boolean),
    H: {
      receivingItemsForReceiving: (id) => items.filter(r => r.receiving_id === id),
      prItemsForPr: () => [...mock.__state.prItems.values()]
    },
    say: (m) => says.push(m),
    refresh: () => rerender(),
    allReceivings: [{ ...REC }], allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    allReceivingItems: items, allPrItems: [],
    onReceivingStatusChange: () => {}, onMarkHandoverDelivered: () => {}
  }
  const Wrapper = () => {
    const [, setT] = React.useState(0)
    rerender = () => setT(t => t + 1)
    return Q.renderHandoverQueue(ctx)
  }
  const doc = mount(React.createElement(Wrapper))
  return { doc, says }
}

// Menjalankan rantai lengkap: baca keadaan → klik apa pun yang masih aktif →
// laporkan apa yang benar-benar TERTULIS di mock.
async function chain(ledger, { failProbe = false, hangProbe = false, settle = 14, clickThrough = true, fixture = {} } = {}) {
  const origFrom = mock.supabase.from
  if (hangProbe) {
    // Probe TIDAK PERNAH selesai — meniru frame 'unknown' yang stabil, supaya
    // jalur tulis bisa dicoba (klik) tanpa probe berubah jadi READY di tengah.
    mock.supabase.from = (table) => {
      if (['receiving_events', 'handover_items', 'return_lines', 'v_receipt_progress'].includes(table)) {
        return { select() { return this }, limit() { return new Promise(() => {}) } }
      }
      return origFrom(table)
    }
  }
  if (failProbe) {
    mock.supabase.from = (table) => {
      if (table === 'v_receipt_progress') {
        return { select() { return this }, limit() { return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for view v_receipt_progress', details: null, hint: null } }) } }
      }
      return origFrom(table)
    }
  }
  const { doc, says } = renderQueue(ledger, failProbe, fixture)
  if (settle) for (let i = 0; i < settle; i++) await tick()
  const state = tid(doc, 'handover-capability')?.getAttribute('data-capability-state') ?? '(banner disembunyikan: READY)'
  const gudang = tid(doc, 'queue-act-gudang-h1')
  const tukang = tid(doc, 'queue-act-tukang-h1')
  const finish0 = tid(doc, 'queue-act-terima-h1')
  // FRAME PERTAMA: keadaan yang benar-benar dilihat admin sebelum probe
  // selesai. Disimpan terpisah karena rantai di bawah menunggu probe selesai
  // (dan di READY tombol penutup memang HARUS aktif).
  const firstFrame = {
    state,
    gudangDisabled: gudang?.disabled,
    tukangDisabled: tukang?.disabled,
    finishDisabled: finish0?.disabled,
    gudangTitle: gudang?.getAttribute('title') || ''
  }
  const gudangEnabledAfterBulk = !!gudang && gudang.disabled === false
  console.log(`  banner=${state} | gudang.disabled=${gudang?.disabled} | tukang.disabled=${tukang?.disabled} | penutup.disabled=${finish0?.disabled}`)
  if (!clickThrough) {
    mock.supabase.from = origFrom
    return { state, firstFrame, afterBulk: {}, inline: false, locked: false, status: HO.status, hi: 0, upd: [], says, doc }
  }
  if (gudang && !gudang.disabled) click(gudang)
  if (tukang && !tukang.disabled) click(tukang)
  for (let i = 0; i < 10; i++) await tick()
  const afterBulk = Object.fromEntries([...mock.__state.prItems].map(([k, v]) => [k, v.status]))
  const finish = tid(doc, 'queue-act-terima-h1')
  const finishEnabledAfterBulk = !!finish && finish.disabled === false
  let inline = false
  if (finish && !finish.disabled) {
    click(finish)
    await tick()
    inline = !!tid(doc, 'queue-terima-form-h1')
    const nama = tid(doc, 'queue-terima-nama-h1')
    if (nama) {
      type(nama, 'Pak Joko'); await tick()
      const ok = tid(doc, 'queue-terima-ok-h1')
      if (ok && !ok.disabled) click(ok)
      for (let i = 0; i < 10; i++) await tick()
    }
  }
  const row = mock.__state.handovers.get('h1') || {}
  const hi = mock.__callsOf('insert', 'handover_items').length
  const upd = mock.__callsOf('update').map(c => c.table)
  console.log(`  setelah klik: pr_items=${JSON.stringify(afterBulk)} | formInline=${inline} diserahkan_at=${row.diserahkan_at || 'NULL'} status=${row.status} handover_items=${hi} | update=${JSON.stringify(upd)}`)
  mock.supabase.from = origFrom
  return { state, firstFrame, afterBulk, inline, finishEnabledAfterBulk, gudangEnabledAfterBulk, locked: !!row.diserahkan_at, status: row.status, hi, upd, says, doc }
}
function type(el, v) {
  flushSync(() => {
    const setter = Object.getOwnPropertyDescriptor(dom0.window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new dom0.window.Event('input', { bubbles: true }))
  })
}

const S = (v) => JSON.stringify(v)
const NO_WRITE = (r) => r.afterBulk.pi1 === 'RECEIVED' && r.afterBulk.pi2 === 'RECEIVED' && !r.locked && r.upd.length === 0

// ============================================================
console.log('\n=== 1. MATRIKS GERBANG TULIS (fungsi murni, 5 keadaan × 3 aksi) ===\n')
// ============================================================
{
  // Kontrak: BOLEH hanya di keadaan yang memang punya jalur benar.
  const expect = {
    ready:   { gudang: false, tukang: false, terima: true },   // terima = modal per barang
    legacy:  { gudang: true,  tukang: true,  terima: true },   // satu-satunya jalur tulis lama
    unknown: { gudang: false, tukang: false, terima: false },  // probe belum selesai
    error:   { gudang: false, tukang: false, terima: false },  // probe gagal (RLS/jaringan)
    partial: { gudang: false, tukang: false, terima: false }   // migrasi belum lengkap
  }
  // `writeBlockReason` adalah fungsi BARU (run 222). Di pohon sebelum fix ia
  // tidak ada — probe harus melaporkannya sebagai RED, bukan crash, supaya
  // seluruh matriks perilaku di bawah tetap bisa dijalankan.
  const WBR = typeof Q.writeBlockReason === 'function'
    ? Q.writeBlockReason
    : () => '(fungsi gerbang tidak ada di pohon ini)'
  check('1.0 fungsi gerbang tulis tunggal tersedia (writeBlockReason)', typeof Q.writeBlockReason === 'function')
  for (const [st, exp] of Object.entries(expect)) {
    const g = WBR('gudang', st)
    const t = WBR('tukang', st)
    const m = WBR('terima', st)
    check(`1.${st}: gudang ${exp.gudang ? 'BOLEH' : 'TOLAK'}`, (g === '') === exp.gudang, S(g))
    check(`1.${st}: tukang ${exp.tukang ? 'BOLEH' : 'TOLAK'}`, (t === '') === exp.tukang, S(t))
    check(`1.${st}: terima ${exp.terima ? 'BOLEH' : 'TOLAK'}`, (m === '') === exp.terima, S(m))
  }
  // Setiap penolakan WAJIB punya alasan yang bisa dibaca (bukan tombol mati bisu).
  for (const st of ['ready', 'unknown', 'error', 'partial']) {
    for (const a of ['gudang', 'tukang', 'terima']) {
      const why = WBR(a, st)
      if (!why) continue
      check(`1.alasan ${st}/${a} terbaca (>= 40 char)`, why.length >= 40 && !/undefined|null/i.test(why), `${why.length} char`)
    }
  }
}

// ============================================================
console.log('\n=== 2. S1: probe BELUM SELESAI (frame pertama, useState(null)) ===\n')
// ============================================================
{
  // settle: 0 → frame PERTAMA (persis seperti yang dilihat admin saat probe
  // belum selesai). `hangProbe` membuat keadaan 'unknown' TETAP stabil supaya
  // rantai klik benar-benar mencoba jalur tulis (bukan menunggu jadi READY).
  const r = await chain(LEDGER, { settle: 0, hangProbe: true })
  check('2a banner menyatakan sedang memeriksa (bukan legacy)', r.firstFrame.state === 'unknown', r.firstFrame.state)
  check('2b tombol borongan gudang NONAKTIF', r.firstFrame.gudangDisabled === true, String(r.firstFrame.gudangDisabled))
  check('2c tombol borongan tukang NONAKTIF', r.firstFrame.tukangDisabled === true, String(r.firstFrame.tukangDisabled))
  check('2d tombol penutup NONAKTIF (tidak ada form header yang menulis)', r.firstFrame.finishDisabled === true, String(r.firstFrame.finishDisabled))
  check('2e NOL tulisan: pr_items utuh, dokumen tidak terkunci, nol update', NO_WRITE(r), S(r.afterBulk) + ` locked=${r.locked} upd=${S(r.upd)}`)
  check('2f tombol nonaktif punya alasan terbaca', r.firstFrame.gudangTitle.length > 40, `${r.firstFrame.gudangTitle.length} char`)
  check('2g klik penutup TIDAK membuka form header inline', r.inline === false)
}

// ============================================================
console.log('\n=== 3. S1: probe GAGAL (GRANT v_receipt_progress belum ada) ===\n')
// ============================================================
{
  const r = await chain(LEDGER, { failProbe: true })
  check('3a banner jujur menyatakan GAGAL', r.state === 'error', r.state)
  check('3b banner menyebut penyebabnya', /permission denied|v_receipt_progress/i.test(tid(r.doc, 'handover-capability')?.textContent || ''))
  check('3c tombol borongan NONAKTIF', tid(r.doc, 'queue-act-gudang-h1')?.disabled === true && tid(r.doc, 'queue-act-tukang-h1')?.disabled === true)
  check('3d tombol penutup NONAKTIF', tid(r.doc, 'queue-act-terima-h1')?.disabled === true)
  check('3e NOL tulisan (tujuan per barang ws=10/tukang=4 tetap utuh)', NO_WRITE(r), S(r.afterBulk) + ` locked=${r.locked} upd=${S(r.upd)}`)
  check('3f tidak ada klaim sukses palsu ke user', !r.says.some(m => /ditandai masuk gudang|dikirim ke tukang|sudah diserahkan/i.test(m)), S(r.says))
}

// ============================================================
console.log('\n=== 4. S2: migrasi SEBAGIAN (events + handover_items ADA, view BELUM) ===\n')
// ============================================================
{
  // `ledger: LEDGER` tapi view dipaksa "tabel belum ada" (PGRST205) — keadaan
  // nyata bila migrasi 02 jalan dan 03 belum.
  const origFrom = mock.supabase.from
  mock.supabase.from = (table) => {
    if (table === 'v_receipt_progress') {
      return { select() { return this }, limit() { return Promise.resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.v_receipt_progress' in the schema cache", details: null, hint: null } }) } }
    }
    return origFrom(table)
  }
  const r = await chain(LEDGER, {})
  mock.supabase.from = origFrom
  check('4a state dilaporkan `partial` (BUKAN legacy)', r.state === 'partial', r.state)
  check('4b banner TIDAK bilang "belum aktif" (datanya ADA)', (() => {
    const b = tid(r.doc, 'handover-capability')
    // Wajib ADA: kalau elemennya hilang, jangan lolos secara hampa.
    return !!b && !/belum aktif/i.test(b.textContent || '')
  })(), (tid(r.doc, 'handover-capability')?.textContent || '(banner tidak ada)').slice(0, 120))
  check('4c banner bilang migrasi BELUM LENGKAP + menyebut objek yang kurang', (() => {
    const t = tid(r.doc, 'handover-capability')?.textContent || ''
    return /belum lengkap/i.test(t) && /v_receipt_progress/i.test(t)
  })(), (tid(r.doc, 'handover-capability')?.textContent || '(banner tidak ada)').slice(0, 120))
  check('4d tombol borongan NONAKTIF (tidak menimpa tujuan per barang)', tid(r.doc, 'queue-act-gudang-h1')?.disabled === true && tid(r.doc, 'queue-act-tukang-h1')?.disabled === true)
  check('4e tombol penutup NONAKTIF', tid(r.doc, 'queue-act-terima-h1')?.disabled === true)
  check('4f NOL tulisan', NO_WRITE(r), S(r.afterBulk) + ` locked=${r.locked} upd=${S(r.upd)}`)
  check('4g ringkasan TIDAK menampilkan angka dari pr_items.status', !/\d+\s+dari\s+\d+\s+barang/i.test(tid(r.doc, 'queue-summary-h1')?.textContent || ''), tid(r.doc, 'queue-summary-h1')?.textContent)
  check('4h rincian barang jujur: data per barang ADA, belum bisa ditampilkan', (() => {
    // Di pohon pra-perbaikan kartu bisa SUDAH HILANG (dokumen terkunci lewat
    // klik borongan) — jangan crash, laporkan sebagai gagal.
    const toggle = tid(r.doc, 'queue-detail-h1')
    if (!toggle) return false
    click(toggle)
    return /sudah ada di database/i.test(tid(r.doc, 'queue-items-perline-partial-h1')?.textContent || '')
  })())
}

// ============================================================
console.log('\n=== 5. S3: panel Bermasalah di keadaan tidak diketahui ===\n')
// ============================================================
{
  // problemPlan murni: hanya 'ready' yang boleh menawarkan jalur per baris;
  // hanya 'legacy' yang boleh menawarkan jalur tulis STATUS. Di pohon
  // pra-perbaikan parameter ke-4 adalah boolean `ledgerReady`, jadi nilai
  // string apa pun selain 'ready' diperlakukan sebagai truthy → jalur per
  // baris. Itu justru defect yang diuji, jadi probe tetap memanggilnya.
  const rec = { id: 'rec1', status: 'NORMAL' }
  const ready = Q.problemPlan(rec, 1, true, 'ready')
  const legacy = Q.problemPlan(rec, 1, true, 'legacy')
  const unknown = Q.problemPlan(rec, 1, true, 'unknown')
  const error = Q.problemPlan(rec, 1, true, 'error')
  const partial = Q.problemPlan(rec, 1, true, 'partial')
  check('5a ready → jalur PER BARANG', ready.ok === true && ready.perLine === true, S(ready))
  check('5b legacy → jalur status header (perilaku lama, 1 item)', legacy.ok === true && !legacy.perLine, S(legacy))
  check('5c unknown → TOLAK dengan alasan', unknown.ok === false && unknown.reason.length > 40, S(unknown))
  check('5d error → TOLAK dengan alasan', error.ok === false && error.reason.length > 40, S(error))
  check('5e partial → TOLAK + menyebut data retur sudah ADA', partial.ok === false && /sudah ADA/i.test(partial.reason), S(partial))
  // Panel nyata: klik Bermasalah saat probe GAGAL tidak boleh menawarkan tombol
  // yang menulis status header.
  const r = await chain(LEDGER, { failProbe: true })
  click(tid(r.doc, 'queue-problem-h1'))
  await tick()
  check('5f probe GAGAL: panel menampilkan alasan (bukan tombol tulis)', !!tid(r.doc, 'queue-problem-blocked-h1'))
  check('5g probe GAGAL: TIDAK ada tombol Retur/Refund status header', !tid(r.doc, 'queue-problem-retur-h1') && !tid(r.doc, 'queue-problem-refund-h1'))
  check('5h probe GAGAL: TIDAK ada tombol form retur per baris', !tid(r.doc, 'queue-problem-retur-h1'))
  // LEGACY: tombol status header TETAP ada (jangan ikut dimatikan). Nota SATU
  // barang, karena jalur status header memang menolak nota multi-item (batas
  // lama yang dipertahankan). Hanya baca panel — dokumen tetap DRAFT.
  const l = await chain(null, { clickThrough: false, fixture: { items: RI1, prItems: () => PR1 } })
  const lBtn = tid(l.doc, 'queue-problem-h1')
  if (lBtn) click(lBtn)
  await tick()
  check('5i LEGACY: tombol Retur status header TETAP tersedia', !!tid(l.doc, 'queue-problem-retur-h1'))
}

// ============================================================
console.log('\n=== 6. READY asli: perilaku yang SUDAH benar tidak boleh rusak ===\n')
// ============================================================
{
  const r = await chain(LEDGER, {})
  check('6a banner disembunyikan saat READY', !tid(r.doc, 'handover-capability'))
  check('6b aksi borongan NONAKTIF di READY', tid(r.doc, 'queue-act-gudang-h1')?.disabled === true && tid(r.doc, 'queue-act-tukang-h1')?.disabled === true)
  check('6c tombol penutup AKTIF (buka modal per barang)', tid(r.doc, 'queue-act-terima-h1')?.disabled === false)
  check('6d NOL tulisan borongan; dokumen tidak terkunci', NO_WRITE(r), S(r.afterBulk) + ` locked=${r.locked}`)
  click(tid(r.doc, 'queue-act-terima-h1'))
  await tick(); await tick(); await tick()
  check('6e penutup membuka modal konfirmasi PER BARANG (bukan form header)', !!tid(r.doc, 'handover-confirm-form') && !tid(r.doc, 'queue-terima-form-h1'))
  check('6f modal konfirmasi melaporkan state READY', tid(r.doc, 'handover-confirm-capability')?.getAttribute('data-capability-state') === 'ready', tid(r.doc, 'handover-confirm-capability')?.getAttribute('data-capability-state'))
}

// ============================================================
console.log('\n=== 7. LEGACY asli: SATU-SATUNYA jalur tulis tetap utuh ===\n')
// ============================================================
{
  const r = await chain(null, {})
  check('7a banner menyatakan legacy', r.state === 'legacy', r.state)
  check('7b tombol borongan gudang AKTIF', r.firstFrame.gudangDisabled === false, String(r.firstFrame.gudangDisabled))
  check('7c klik borongan menulis pr_items.status = DI_GUDANG (perilaku lama)', r.afterBulk.pi1 === 'DI_GUDANG' && r.afterBulk.pi2 === 'DI_GUDANG', S(r.afterBulk))
  check('7d receivings.masuk_gudang = true (perilaku lama)', mock.__state.receivings.get('rec1')?.masuk_gudang === true)
  check('7e tombol penutup AKTIF setelah distribusi', r.finishEnabledAfterBulk === true, String(r.finishEnabledAfterBulk))
  check('7f klik penutup membuka form header INLINE (jalur lama)', r.inline === true)
  check('7g dokumen tercatat diserahkan lewat jalur lama', r.locked === true && r.status === 'CONFIRMED', `locked=${r.locked} status=${r.status}`)
  check('7h pesan stok jujur tetap ada (R3 tidak ikut berubah)', r.says.some(m => /TIDAK bertambah/i.test(m)), S(r.says))
}

// ============================================================
console.log('\n=== 8. TIGA FORM: `partial` tidak boleh menyamar sebagai LEGACY ===\n')
// ============================================================
{
  const partialCap = { ready: false, returnReady: false, events: true, handoverItems: true, returnLines: false, progress: false, probeFailed: false, missing: ['tabel v_receipt_progress belum ada'] }
  const legacyCap = { ready: false, returnReady: false, missing: ['tabel receiving_events belum ada'] }
  mock.__reset({ receivings: [{ ...REC }], prItems: FRESH_PR(), receivingItems: RI, handovers: [{ ...HO }], ledger: LEDGER })

  // confirmForm: `partial` harus MENGUNCI simpan (bukan menulis header).
  {
    const says = []
    const doc = mount(React.createElement(ConfirmForm, { handover: { ...HO }, capability: partialCap, say: (m) => says.push(m), refresh: () => {}, close: () => {} }))
    for (let i = 0; i < 6; i++) await tick()
    check('8a confirmForm partial: state ditandai `partial`', tid(doc, 'handover-confirm-capability')?.getAttribute('data-capability-state') === 'partial', tid(doc, 'handover-confirm-capability')?.getAttribute('data-capability-state'))
    check('8b confirmForm partial: TIDAK ada input nama header (jalur tulis LEGACY mati)', !tid(doc, 'hc-header-penerima'))
    check('8c confirmForm partial: tombol simpan NONAKTIF', tid(doc, 'handover-confirm-submit')?.disabled === true)
    check('8d confirmForm partial: pesan menyebut migrasi belum lengkap', /migrasi skema belum lengkap/i.test(tid(doc, 'handover-confirm-waiting')?.textContent || ''), (tid(doc, 'handover-confirm-waiting')?.textContent || '').slice(0, 90))
  }
  // Kontrol positif: LEGACY tetap punya jalur header.
  {
    const doc = mount(React.createElement(ConfirmForm, { handover: { ...HO }, capability: legacyCap, say: () => {}, refresh: () => {}, close: () => {} }))
    for (let i = 0; i < 6; i++) await tick()
    check('8e confirmForm legacy: input nama header TETAP ada', !!tid(doc, 'hc-header-penerima'))
    check('8f confirmForm legacy: tombol simpan AKTIF', tid(doc, 'handover-confirm-submit')?.disabled === false)
  }
  // receiptForm & returnForm: `partial` bukan "skema belum ada".
  {
    const doc = mount(React.createElement(ReceiptForm, { receiving: { ...REC }, items: RI, orderedFor: () => 10, capability: partialCap, say: () => {}, refresh: () => {}, close: () => {} }))
    await tick()
    check('8g receiptForm partial: state ditandai `partial`', tid(doc, 'receipt-capability')?.getAttribute('data-capability-state') === 'partial')
    check('8h receiptForm partial: pesan TIDAK bilang "belum aktif"', !/belum aktif/i.test(tid(doc, 'receipt-capability')?.textContent || ''), (tid(doc, 'receipt-capability')?.textContent || '').slice(0, 100))
    check('8i receiptForm partial: pesan menyebut data per barang SUDAH ADA', /sudah ada/i.test(tid(doc, 'receipt-capability')?.textContent || ''))
  }
  {
    const doc = mount(React.createElement(ReturnForm, { receiving: { ...REC }, capability: partialCap, say: () => {}, refresh: () => {}, close: () => {} }))
    await tick()
    check('8j returnForm partial: state ditandai `partial`', tid(doc, 'return-capability')?.getAttribute('data-capability-state') === 'partial')
    check('8k returnForm partial: pesan TIDAK bilang "belum aktif"', !/belum aktif/i.test(tid(doc, 'return-capability')?.textContent || ''), (tid(doc, 'return-capability')?.textContent || '').slice(0, 100))
  }
}

// ============================================================
console.log('\n=== 9. capabilityState(): 5 keadaan, bukan 2 ===\n')
// ============================================================
{
  check('9a null → unknown', CAP.capabilityState(null) === 'unknown')
  check('9b undefined → unknown', CAP.capabilityState(undefined) === 'unknown')
  check('9c probeFailed → error', CAP.capabilityState({ ready: false, probeFailed: true }) === 'error')
  check('9d ready → ready', CAP.capabilityState({ ready: true, returnReady: true }) === 'ready')
  check('9e tidak ada objek ledger → legacy', CAP.capabilityState({ ready: false, missing: ['tabel receiving_events belum ada'] }) === 'legacy')
  check('9f events terbaca tapi view belum → partial', CAP.capabilityState({ ready: false, events: true, handoverItems: true, progress: false, missing: ['tabel v_receipt_progress belum ada'] }) === 'partial')
  check('9g hanya progress terbaca → partial', CAP.capabilityState({ ready: false, progress: true }) === 'partial')
  check('9h probeFailed menang atas events (error, bukan partial)', CAP.capabilityState({ ready: false, probeFailed: true, events: true }) === 'error')
}

console.log(`\n=== HASIL PROBE RUN 222 (kunci review run 219): ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
