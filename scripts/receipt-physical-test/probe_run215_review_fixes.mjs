// ============================================================
// probe_run215_review_fixes.mjs — KUNCI PERBAIKAN REVIEW RUN 212 (R1/R2/R3)
// ============================================================
// Review run 212 memblok task ini dengan 2 MAJOR + 1 MEDIUM yang HANYA aktif
// ketika mode READY menyala:
//
//   R1 capability `null` (probe belum selesai) diperlakukan sebagai LEGACY,
//      sehingga confirmForm MENULIS `status=CONFIRMED` + `diserahkan_at`
//      TANPA satu pun baris `handover_items`, lalu mengunci dokumen permanen
//      (CAS `diserahkan_at IS NULL`).
//   R2 ACT_GUDANG/ACT_TUKANG masih menulis `pr_items.status` untuk SEMUA baris
//      di mode READY → menimpa tujuan per barang dari ledger.
//   R3 label "Masuk Stok Gudang" mengklaim stok bertambah padahal aksi itu
//      tidak memanggil RPC `receive_to_warehouse`.
//
// Probe ini adalah pengunci RED→GREEN-nya. Dijalankan SESUDAH harness utama
// oleh run.py; exit code-nya dilaporkan terpisah.
//
// Yang diuji BUKAN "apakah kode berubah", tetapi PERILAKU:
//   A. capability null  → tombol tulis DISABLED + nol tulisan
//   B. probe gagal      → nol tulisan + pesan gagal (bukan "skema belum ada")
//   C. LEGACY asli      → perilaku lama TETAP (tidak boleh ikut dimatikan)
//   D. READY            → aksi borongan nonaktif + alasan terbaca + nol tulisan
//   E. LEGACY           → aksi borongan TETAP aktif (satu-satunya jalur)
//   F. pesan gudang     → TIDAK mengklaim stok bertambah
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
const PM = await importDist('modules/handovers/physicalModal.mjs')
const CAP = await importDist('modules/receivings/receiptCapability.mjs')
const ConfirmForm = (await importDist('modules/handovers/confirmForm.mjs')).default
const ACT = await importDist('modules/handovers/actions.mjs')

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })))
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
const mountedRoots = []
function mount(el) {
  for (const r of mountedRoots) { try { r.unmount() } catch (e) {} }
  mountedRoots.length = 0
  dom0.window.document.body.innerHTML = ''
  const host = dom0.window.document.createElement('div')
  dom0.window.document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(el))
  mountedRoots.push(root)
  return { root, host, document: dom0.window.document }
}

const REC = {
  id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL',
  invoice_no: 'INV-1', delivery_note: 'Nota INV-1', note: '',
  alokasi: null, masuk_gudang: false, tukang_at: null
}
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng', status: 'RECEIVED' }
]
const RI = [
  { id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 },
  { id: 'ri2', receiving_id: 'rec1', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', quantity_received: 4 }
]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }

// Ledger dengan TUJUAN BERBEDA per barang — inti R2.
const LEDGER = {
  receivingEvents: [
    { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 4, qty_rusak: 0, tujuan_ws: 4, tujuan_tukang: 0, penerima_tukang: null, retur_status: 'NONE', retur_qty: 0, discard_confirmed: false },
    { id: 'ev2', receiving_id: 'rec1', receiving_item_id: 'ri2', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', qty_datang: 2, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 2, penerima_tukang: 'Pak Budi', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false }
  ],
  handoverItems: [], returnLines: [], returnCases: [], progress: []
}
const noop = () => {}

function ctxFor(says, extra = {}) {
  return {
    rows: [{ ...HO }],
    H: {
      receivingItemsForReceiving: (id) => RI.filter(r => r.receiving_id === id),
      prItemsForPr: (id) => PR_ITEMS.filter(p => p.pr_id === id)
    },
    say: (m) => says.push(m), refresh: noop,
    allReceivings: [{ ...REC }], allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    allReceivingItems: RI, allPrItems: PR_ITEMS,
    onReceivingStatusChange: noop, onMarkHandoverDelivered: noop,
    ...extra
  }
}

// ============================================================
console.log('\n=== A. capability NULL (probe belum selesai) — R1 ===\n')
// ============================================================
// Keadaan nyata: physicalHost memberi `capability = null` pada frame pertama
// setiap modal dibuka. DB SUDAH dimigrasikan (probe akan menjawab ready:true).
{
  mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }], ledger: LEDGER })
  const says = []
  const { document: doc } = mount(
    React.createElement(ConfirmForm, {
      handover: { ...HO }, capability: null,
      say: (m) => says.push(m), refresh: noop, close: noop
    })
  )
  // Render PERTAMA, tanpa tick — persis seperti yang dilihat admin.
  const btn = tid(doc, 'handover-confirm-submit')
  check('A1 tombol tulis ADA (bukan form hilang)', !!btn)
  check('A2 tombol tulis DISABLED saat capability belum diketahui', btn?.disabled === true, `disabled=${btn?.disabled}`)
  check('A3 label tombol menyebut pemeriksaan skema', /memeriksa/i.test(btn?.textContent || ''), btn?.textContent)
  check('A4 TIDAK ada input jalur LEGACY (tidak ada jalur tulis tersembunyi)', !tid(doc, 'hc-header-penerima'))
  check('A5 panel "menunggu pemeriksaan" tampil', !!tid(doc, 'handover-confirm-waiting'))
  check('A6 state capability ditandai eksplisit di DOM', tid(doc, 'handover-confirm-capability')?.getAttribute('data-capability-state') === 'unknown',
    tid(doc, 'handover-confirm-capability')?.getAttribute('data-capability-state'))
  // Klik paksa (programatik) — submit() harus menolak, bukan menulis.
  if (btn) click(btn)
  await tick(); await tick(); await tick()
  check('A7 klik paksa TIDAK menulis handovers (dokumen tidak terkunci)', mock.__callsOf('update', 'handovers').length === 0,
    `updates=${mock.__callsOf('update', 'handovers').length}`)
  check('A8 klik paksa TIDAK memanggil RPC apa pun', mock.__callsOf('rpc').length === 0,
    JSON.stringify(mock.__callsOf('rpc').map(r => r.fn)))
  check('A9 TIDAK ada insert handover_items (tidak ada klaim rincian)', mock.__callsOf('insert', 'handover_items').length === 0)
  check('A10 state DB handover TETAP belum diserahkan', !mock.__state.handovers.get('h1')?.diserahkan_at,
    JSON.stringify(mock.__state.handovers.get('h1')))
  check('A11 tidak ada pesan sukses ke user', !says.some(m => /tersimpan|diserahkan/i.test(m)), JSON.stringify(says))
}

// ============================================================
console.log('\n=== B. PROBE GAGAL (RLS/jaringan) — R1 bagian kedua ===\n')
// ============================================================
// Dulu error yang BUKAN "tabel belum ada" (mis. permission denied pada view —
// persis blocker GRANT SELECT) disimpulkan sebagai LEGACY → jalur tulis aktif.
// Sekarang harus "tidak diketahui": nol tulisan + pesan gagal.
{
  const failedCap = { ready: false, returnReady: false, probeFailed: true, missing: ['v_receipt_progress: permission denied for view'] }
  mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }], ledger: LEDGER })
  const says = []
  const { document: doc } = mount(
    React.createElement(ConfirmForm, {
      handover: { ...HO }, capability: failedCap,
      say: (m) => says.push(m), refresh: noop, close: noop
    })
  )
  const btn = tid(doc, 'handover-confirm-submit')
  check('B1 probe gagal → tombol tulis DISABLED', btn?.disabled === true, `disabled=${btn?.disabled}`)
  check('B2 pesan menyebut pemeriksaan GAGAL + sebabnya', /GAGAL/i.test(tid(doc, 'handover-confirm-capability')?.textContent || '') &&
    /permission denied/i.test(tid(doc, 'handover-confirm-capability')?.textContent || ''),
    tid(doc, 'handover-confirm-capability')?.textContent)
  check('B3 TIDAK salah menyebut "skema belum tersedia"/"belum aktif"',
    !/belum aktif/i.test(tid(doc, 'handover-confirm-capability')?.textContent || ''))
  if (btn) click(btn)
  await tick(); await tick(); await tick()
  check('B4 nol tulisan handovers', mock.__callsOf('update', 'handovers').length === 0)
  check('B5 nol RPC', mock.__callsOf('rpc').length === 0)
}

// ============================================================
console.log('\n=== C. LEGACY ASLI (probe SELESAI, skema belum ada) — jangan dimatikan ===\n')
// ============================================================
{
  const legacyCap = { ready: false, returnReady: false, missing: ['tabel receiving_events belum ada'] }
  mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }], ledger: null })
  const says = []
  const { document: doc } = mount(
    React.createElement(ConfirmForm, {
      handover: { ...HO }, capability: legacyCap,
      say: (m) => says.push(m), refresh: noop, close: noop
    })
  )
  const btn = tid(doc, 'handover-confirm-submit')
  check('C1 LEGACY: input nama penerima tetap ada', !!tid(doc, 'hc-header-penerima'))
  check('C2 LEGACY: tombol tulis AKTIF (perilaku lama dipertahankan)', btn?.disabled === false, `disabled=${btn?.disabled}`)
  check('C3 LEGACY: state ditandai "legacy"', tid(doc, 'handover-confirm-capability')?.getAttribute('data-capability-state') === 'legacy')
  click(btn)
  await tick(); await tick(); await tick()
  check('C4 LEGACY: menulis header (CAS diserahkan_at) seperti sebelumnya',
    mock.__callsOf('update', 'handovers').length === 1 && !!mock.__state.handovers.get('h1')?.diserahkan_at,
    `updates=${mock.__callsOf('update', 'handovers').length}`)
  check('C5 LEGACY: pesan jujur rincian belum tersimpan', says.some(m => /Rincian per barang belum tersimpan/i.test(m)), JSON.stringify(says))
}

// ============================================================
console.log('\n=== D. READY: aksi BORONGAN gudang/tukang — R2 ===\n')
// ============================================================
{
  mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }], ledger: LEDGER })
  CAP.resetReceiptCapability()
  const says = []
  const { document: doc } = mount(Q.renderHandoverQueue(ctxFor(says)))
  for (let i = 0; i < 12; i++) await tick()
  const gudang = tid(doc, 'queue-act-gudang-h1')
  const tukang = tid(doc, 'queue-act-tukang-h1')
  check('D1 tombol gudang masih TERLIHAT di READY (bukan dihapus)', !!gudang)
  check('D2 tombol gudang NONAKTIF di READY', gudang?.disabled === true, `disabled=${gudang?.disabled}`)
  check('D3 tombol tukang NONAKTIF di READY', tukang?.disabled === true, `disabled=${tukang?.disabled}`)
  check('D4 alasan gudang terbaca & menyebut per barang', /PER BARANG/i.test(gudang?.getAttribute('title') || ''),
    gudang?.getAttribute('title'))
  check('D5 alasan tukang terbaca & menyebut per barang', /PER BARANG/i.test(tukang?.getAttribute('title') || ''),
    tukang?.getAttribute('title'))
  // Klik paksa (programatik) — handler harus menolak, bukan menulis.
  if (gudang) click(gudang)
  await tick(); await tick(); await tick()
  const st = { pi1: mock.__state.prItems.get('pi1')?.status, pi2: mock.__state.prItems.get('pi2')?.status }
  check('D6 pr_items TIDAK ditimpa jadi DI_GUDANG (tujuan per barang utuh)',
    st.pi1 === 'RECEIVED' && st.pi2 === 'RECEIVED', JSON.stringify(st))
  check('D7 receivings.masuk_gudang TIDAK diubah', mock.__state.receivings.get('rec1')?.masuk_gudang !== true,
    String(mock.__state.receivings.get('rec1')?.masuk_gudang))
  check('D8 nol update ke pr_items', mock.__callsOf('update', 'pr_items').length === 0,
    `updates=${mock.__callsOf('update', 'pr_items').length}`)
  // Tombol disabled memang tidak mengirim klik, jadi pesan handler tidak
  // muncul — yang penting TIDAK ADA klaim sukses palsu. Alasan bagi user ada
  // di title tombol (D4/D5) + panel capability.
  check('D9 tidak ada klaim sukses palsu ke user', !says.some(m => /ditandai masuk gudang|dikirim ke tukang/i.test(m)), JSON.stringify(says))
  // Lanjutan R2: ringkasan progres TIDAK boleh memakai dimensi pr_items yang
  // sudah tidak ditulis di READY (angkanya akan selalu 0 → menyesatkan).
  const sum = tid(doc, 'queue-summary-h1')?.textContent || ''
  check('D10 ringkasan READY tidak menampilkan angka dari pr_items.status',
    !/\d+\s+dari\s+\d+\s+barang/i.test(sum), sum)
  check('D11 ringkasan READY mengarahkan ke pencatatan per barang',
    /per barang/i.test(sum), sum)
}

// ============================================================
console.log('\n=== E. LEGACY: aksi borongan TETAP jalan (satu-satunya jalur) ===\n')
// ============================================================
{
  mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }], ledger: null })
  CAP.resetReceiptCapability()
  const says = []
  const { document: doc } = mount(Q.renderHandoverQueue(ctxFor(says)))
  for (let i = 0; i < 12; i++) await tick()
  const gudang = tid(doc, 'queue-act-gudang-h1')
  check('E1 LEGACY: tombol gudang AKTIF', gudang?.disabled === false, `disabled=${gudang?.disabled}`)
  click(gudang)
  await tick(); await tick(); await tick(); await tick()
  check('E2 LEGACY: pr_items.status jadi DI_GUDANG (perilaku lama utuh)',
    mock.__state.prItems.get('pi1')?.status === 'DI_GUDANG', String(mock.__state.prItems.get('pi1')?.status))
  check('E3 LEGACY: receivings.masuk_gudang jadi true', mock.__state.receivings.get('rec1')?.masuk_gudang === true)
}

// ============================================================
console.log('\n=== F. KEJUJURAN LABEL & PESAN GUDANG — R3 ===\n')
// ============================================================
{
  const plan = (await importDist('modules/handovers/logic.mjs')).actionPlan(
    { id: 'h', diserahkan_at: null }, { total: 10, done: 0, inWarehouse: 0, sentToTukang: 0 }, null, {}
  )
  const label = plan.find(a => a.key === 'gudang')?.label || ''
  check('F1 label aksi TIDAK mengklaim "stok" bertambah', !/stok/i.test(label), label)
  check('F2 label tetap menyebut gudang', /gudang/i.test(label), label)

  // Pesan sukses aksi (actions.js) — dijalankan langsung dengan mock perekam.
  mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI, handovers: [{ ...HO }], ledger: null })
  const res = await ACT.kirimKeGudang('h1')
  check('F3 aksi gudang berhasil (bukan error)', res.ok === true, res.message)
  check('F4 pesan TIDAK mengklaim stok bertambah', !/stok (material )?(bertambah|masuk)/i.test(res.message) || /TIDAK bertambah/i.test(res.message),
    res.message)
  check('F5 pesan MENYATAKAN stok tidak bertambah', /stok material TIDAK bertambah/i.test(res.message), res.message)
  check('F6 pesan memakai kata "DITANDAI", bukan "masuk stok"', /ditandai/i.test(res.message) && !/masuk stok/i.test(res.message), res.message)
}

console.log(`\n=== HASIL PROBE RUN 215: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
