// ============================================================
// probe_run234_stale_capability.mjs — KUNCI PERBAIKAN REVIEW RUN 234
// ============================================================
// Review run 234 (lensa WAKTU) memblok task ini dengan satu temuan:
//
//   BUG-U1 (MAJOR) — capability adalah SNAPSHOT tetapi dipakai sebagai
//   kebenaran yang berlaku terus. `queue.jsx` memanggil
//   `getReceiptCapability()` SEKALI saat mount (`useEffect(..., [])`) dan
//   TANPA `force` → cache modul 60 detik. Urutan aktivasi DAT
//   (`docs/receiving-events-contract.md` §7) menjalankan migrasi TANPA
//   deploy, yaitu SAAT aplikasi sedang dipakai. Layar yang sudah terbuka
//   tetap memegang snapshot LEGACY — dan LEGACY satu-satunya keadaan yang
//   MASIH menulis jalur lama:
//     · aksi borongan  → menimpa `pr_items.status` (BUG-R2 hidup lagi)
//     · tombol penutup → form header → `diserahkan_at` SET tanpa rincian →
//                        dokumen TERKUNCI PERMANEN (CAS, BUG-R1/S1 hidup lagi)
//
// Probe ini mengunci PERBAIKANNYA, dan yang lebih penting: menguji hal yang
// tidak diuji harness mana pun sebelumnya —
//   (a) apakah jalur tulis lama benar-benar NOL tulisan saat snapshot basi
//       (bukan hanya tombolnya terlihat mati),
//   (b) apakah pemeriksaan ulang terjadi TEPAT SEBELUM menulis (form yang
//       sudah terbuka pun ditolak), bukan hanya saat form dibuka,
//   (c) apakah LEGACY yang SAH tetap bisa menulis — fix tidak boleh mematikan
//       satu-satunya jalur yang tersisa sebelum migrasi.
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
const PM = await importDist('modules/handovers/physicalModal.mjs')

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
const click = (el) => {
  if (!el) return false
  flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })))
  return true
}
const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
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
// Tunggu sampai semua rantai async (probe + aksi) selesai. 24 putaran cukup
// untuk: probe force (4 SELECT) → setState → render → aksi → refresh.
const settle = async (n = 24) => { for (let i = 0; i < n; i++) await tick() }

const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-BARU', delivery_note: 'Nota INV-BARU', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const RI = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 }]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
const PR_ITEMS = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' }]
// Keadaan SESUDAH migrasi + sesudah Novi mencatat barang per barang:
// datang 6, rusak 2, tujuan tukang 4.
const EVENTS = [{
  id: 'ev1', client_event_id: 'rcpt:rec1:ri1:0->6', receiving_id: 'rec1', receiving_item_id: 'ri1',
  pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2,
  tujuan_ws: 0, tujuan_tukang: 4, penerima_tukang: 'Pak Joko', retur_status: 'PENDING', retur_qty: 2,
  discard_confirmed: false, foto_ref: null, source: 'ui', created_at: '2026-10-21T00:00:00Z'
}]
const PROGRESS = [{ receiving_item_id: 'ri1', qty_datang: 6, qty_rusak: 2, qty_baik: 4, belum_diserahkan: 4, qty_bought: 10, qty_arrived: 6, qty_handed_over: 0, tujuan_tukang: 4 }]

function ledgerLive() {
  return {
    receivingEvents: EVENTS.map(e => ({ ...e })),
    handoverItems: [],
    returnLines: [],
    returnCases: [],
    progress: PROGRESS.map(p => ({ ...p }))
  }
}

// Builder error untuk meniru PostgREST/Supabase (PGRST205 / 42501).
function errorBuilder(err) {
  const api = {
    select() { return api },
    limit() { return Promise.resolve({ data: null, error: err }) },
    maybeSingle() { return Promise.resolve({ data: null, error: err }) },
    eq() { return api },
    then(resolve) { return Promise.resolve({ data: null, error: err }).then(resolve) }
  }
  return api
}

const realFrom = mock.supabase.from
// Override probe per-tabel: dipakai untuk meniru migrasi SEBAGIAN dan
// kegagalan GRANT/RLS (kelas blocker yang sama dengan v_receipt_progress).
function stubTable(table, err) {
  mock.supabase.from = (t) => (t === table ? errorBuilder(err) : realFrom(t))
}
function restoreTables() { mock.supabase.from = realFrom }

function renderQueue({ ledger = null, prStatus = null, keepCache = false } = {}) {
  const prSeed = PR_ITEMS.map(p => ({ ...p, status: prStatus || p.status }))
  mock.__reset({ receivings: [{ ...REC }], prItems: prSeed, receivingItems: RI.map(r => ({ ...r })), handovers: [{ ...HO }], ledger })
  PM.resetPhysicalModal()
  if (!keepCache) CAP.resetReceiptCapability()
  const says = []
  let rerender = () => {}
  const ctx = {
    rows: [mock.__state.handovers.get('h1')].filter(Boolean),
    H: {
      receivingItemsForReceiving: (id) => [...mock.__state.receivingItems.values()].filter(r => r.receiving_id === id),
      prItemsForPr: () => [...mock.__state.prItems.values()]
    },
    say: (m) => says.push(m),
    refresh: () => rerender(),
    allReceivings: [{ ...REC }], allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    allReceivingItems: RI, allPrItems: [],
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

const writes = () => [...mock.__callsOf('update'), ...mock.__callsOf('insert')]
const writeTables = () => writes().map(c => `${c.op}:${c.table}`)
const bannerState = (doc) => tid(doc, 'handover-capability')?.getAttribute('data-capability-state') || null

// ============================================================
console.log('\n=== 0. AKAR: probe non-force memang menyajikan snapshot basi (modul) ===\n')
// ============================================================
{
  mock.__reset({ receivings: [{ ...REC }], prItems: PR_ITEMS.map(p => ({ ...p })), receivingItems: RI.map(r => ({ ...r })), handovers: [{ ...HO }], ledger: null })
  CAP.resetReceiptCapability()
  const before = await CAP.getReceiptCapability()
  mock.__state.ledger = ledgerLive()
  const cached = await CAP.getReceiptCapability()
  const forced = await CAP.getReceiptCapability({ force: true })
  console.log(`     sebelum=${CAP.capabilityState(before)} · non-force=${CAP.capabilityState(cached)} · force=${CAP.capabilityState(forced)}`)
  check('0a sebelum migrasi: state = legacy (benar pada saat itu)', CAP.capabilityState(before) === 'legacy')
  check('0b probe non-force MASIH menyajikan LEGACY sesudah migrasi (akar BUG-U1 nyata)', CAP.capabilityState(cached) === 'legacy')
  check('0c probe force melihat READY — dua jawaban berbeda tentang DB yang sama', CAP.capabilityState(forced) === 'ready')
  check('0d selisihnya bukan salah baca: objek ledger benar-benar ada', forced.ready === true && forced.returnReady === true)
}

// ============================================================
console.log('\n=== 1. KLIK BORONGAN di snapshot LEGACY basi → NOL tulisan ===\n')
// ============================================================
{
  const { doc, says } = renderQueue({ ledger: null })
  await settle()
  console.log(`     awal: banner=${bannerState(doc)} · gudang disabled=${tid(doc, 'queue-act-gudang-h1')?.disabled}`)
  check('1a awal (belum migrasi): banner legacy, borongan AKTIF — perilaku yang benar saat itu',
    bannerState(doc) === 'legacy' && tid(doc, 'queue-act-gudang-h1')?.disabled === false)

  // ---- MIGRASI DIJALANKAN SAAT HALAMAN TERBUKA (urutan §7 DAT) ----
  mock.__state.ledger = ledgerLive()
  const before = mock.__state.prItems.get('pi1').status

  click(tid(doc, 'queue-act-gudang-h1'))
  await settle()

  const after = mock.__state.prItems.get('pi1').status
  const ev = mock.__state.ledger.receivingEvents[0]
  console.log(`     pr_items.status: ${before} → ${after} · writes=${JSON.stringify(writeTables())} · tujuan_tukang=${ev.tujuan_tukang}`)
  check('1b pr_items.status TIDAK ditimpa (BUG-R2 lewat pintu waktu DITUTUP)', after === 'RECEIVED', String(after))
  check('1c NOL tulisan DB sama sekali dari klik borongan', writes().length === 0, JSON.stringify(writeTables()))
  check('1d ledger per barang utuh (tujuan_tukang tetap 4)', ev.tujuan_tukang === 4 && ev.tujuan_ws === 0)
  check('1e admin diberi sebab yang bisa dibaca (bukan tombol diam)', /BERUBAH|AKTIF/i.test(says.join(' | ')), says.join(' | ').slice(0, 160))
  console.log(`     sesudah pemeriksaan segar: banner=${bannerState(doc)} · gudang disabled=${tid(doc, 'queue-act-gudang-h1')?.disabled}`)
  check('1f banner langsung memakai kebenaran SEGAR (tidak menunggu TTL/reload)', bannerState(doc) === null,
    String(bannerState(doc)))
  check('1g borongan sekarang NONAKTIF (tujuan per barang aman)', tid(doc, 'queue-act-gudang-h1')?.disabled === true)
}

// ============================================================
console.log('\n=== 2. TOMBOL PENUTUP di snapshot LEGACY basi → dokumen TIDAK terkunci ===\n')
// ============================================================
{
  const { doc, says } = renderQueue({ ledger: null, prStatus: 'DI_GUDANG' })
  await settle()
  check('2a prasyarat: antrean masih LEGACY', bannerState(doc) === 'legacy', String(bannerState(doc)))
  check('2b tombol penutup AKTIF di snapshot basi', tid(doc, 'queue-act-terima-h1')?.disabled === false)

  mock.__state.ledger = ledgerLive()   // migrasi dijalankan
  click(tid(doc, 'queue-act-terima-h1'))
  await settle()

  const ho = mock.__state.handovers.get('h1')
  const inline = tid(doc, 'queue-terima-form-h1')
  console.log(`     form header inline terbuka=${!!inline} · diserahkan_at=${ho.diserahkan_at} · writes=${JSON.stringify(writeTables())}`)
  check('2c form header LEGACY TIDAK dibuka (jalur tulis lama ditolak)', !inline)
  check('2d diserahkan_at TETAP NULL (dokumen tidak terkunci permanen)', !ho.diserahkan_at, String(ho.diserahkan_at))
  check('2e status TIDAK berubah jadi CONFIRMED', String(ho.status) === 'DRAFT', String(ho.status))
  check('2f NOL tulisan DB', writes().length === 0, JSON.stringify(writeTables()))
  check('2g admin diberi sebab', /BERUBAH|AKTIF/i.test(says.join(' | ')), says.join(' | ').slice(0, 160))
}

// ============================================================
console.log('\n=== 3. FORM SUDAH TERBUKA, migrasi menyusul, lalu KONFIRMASI → ditolak ===\n')
// ============================================================
{
  // Jalur paling berbahaya: admin sudah membuka form header SEBELUM migrasi
  // (sah saat itu), lalu migrasi dijalankan orang lain, lalu admin menekan
  // Konfirmasi. Kalau pemeriksaan hanya dilakukan saat form DIBUKA, dokumen
  // terkunci tanpa rincian.
  //
  // `prStatus: 'DI_GUDANG'` WAJIB: `actionPlan` (logic.js) hanya mengaktifkan
  // tombol penutup bila `summary.done > 0`, dan di era LEGACY angka itu datang
  // dari `pr_items.status` sesudah aksi borongan dipakai — persis keadaan nyata
  // di lapangan saat migrasi menyusul.
  const { doc, says } = renderQueue({ ledger: null, prStatus: 'DI_GUDANG' })
  await settle()
  click(tid(doc, 'queue-act-terima-h1'))
  await settle(6)
  const inline = tid(doc, 'queue-terima-form-h1')
  check('3a form header terbuka saat skema memang BELUM ada (jalur sah)', !!inline)

  const input = tid(doc, 'queue-terima-nama-h1')
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(dom0.window.HTMLInputElement.prototype, 'value').set
    flushSync(() => { setter.call(input, 'Pak Joko'); input.dispatchEvent(new dom0.window.Event('input', { bubbles: true })) })
  }
  await settle(4)

  mock.__state.ledger = ledgerLive()   // migrasi dijalankan SESUDAH form terbuka
  click(tid(doc, 'queue-terima-ok-h1'))
  await settle()

  const ho = mock.__state.handovers.get('h1')
  console.log(`     diserahkan_at=${ho.diserahkan_at} · handover_items=${mock.__state.ledger.handoverItems.length} · writes=${JSON.stringify(writeTables())}`)
  check('3b Konfirmasi DITOLAK: diserahkan_at tetap NULL', !ho.diserahkan_at, String(ho.diserahkan_at))
  check('3c status tetap DRAFT (tidak terkunci)', String(ho.status) === 'DRAFT', String(ho.status))
  check('3d NOL tulisan DB', writes().length === 0, JSON.stringify(writeTables()))
  check('3e form ditutup supaya admin tidak menekan ulang', !tid(doc, 'queue-terima-form-h1'))
  check('3f admin diberi sebab', /BERUBAH|AKTIF/i.test(says.join(' | ')), says.join(' | ').slice(0, 160))
}

// ============================================================
console.log('\n=== 4. MIGRASI SEBAGIAN (events ada, view belum) → NOL tulisan ===\n')
// ============================================================
{
  const { doc, says } = renderQueue({ ledger: null })
  await settle()
  mock.__state.ledger = ledgerLive()
  // View read-model belum dibuat — persis keadaan "01,02,04 jalan, 03/05 belum".
  stubTable('v_receipt_progress', { code: 'PGRST205', message: "Could not find the table 'public.v_receipt_progress' in the schema cache" })
  click(tid(doc, 'queue-act-gudang-h1'))
  await settle()
  restoreTables()

  const after = mock.__state.prItems.get('pi1').status
  console.log(`     pr_items.status=${after} · writes=${JSON.stringify(writeTables())} · says=${says.join(' | ').slice(0, 90)}`)
  check('4a pr_items.status TIDAK ditimpa saat migrasi sebagian', after === 'RECEIVED', String(after))
  check('4b NOL tulisan DB', writes().length === 0, JSON.stringify(writeTables()))
  check('4c layar menyatakan migrasi BELUM LENGKAP (bukan "belum aktif")',
    /BELUM LENGKAP|BERUBAH|migrasi/i.test(says.join(' | ')), says.join(' | ').slice(0, 160))
}

// ============================================================
console.log('\n=== 5. PEMERIKSAAN SEGAR GAGAL (42501) → NOL tulisan ===\n')
// ============================================================
{
  const { doc, says } = renderQueue({ ledger: null })
  await settle()
  mock.__state.ledger = ledgerLive()
  stubTable('v_receipt_progress', { code: '42501', message: 'permission denied for view v_receipt_progress' })
  click(tid(doc, 'queue-act-gudang-h1'))
  await settle()
  restoreTables()
  check('5a klik borongan saat pemeriksaan gagal → NOL tulisan', writes().length === 0, JSON.stringify(writeTables()))
  check('5b pr_items.status utuh', mock.__state.prItems.get('pi1').status === 'RECEIVED')
  check('5c sebabnya disebut (hak akses / tidak bisa dipastikan)',
    /TIDAK BISA DIPASTIKAN|hak akses|permission|GAGAL/i.test(says.join(' | ')), says.join(' | ').slice(0, 160))
}

// ============================================================
console.log('\n=== 6. REMOUNT DALAM TTL 60 DETIK → langsung benar (cache tidak dipakai) ===\n')
// ============================================================
{
  const first = renderQueue({ ledger: null })
  await settle()
  check('6a mount pertama: legacy', bannerState(first.doc) === 'legacy', String(bannerState(first.doc)))
  mock.__state.ledger = ledgerLive()   // migrasi dijalankan

  // Pindah modul = banner unmount; kembali = mount baru. Cache modul SENGAJA
  // TIDAK dilupakan (`keepCache:true`) — persis seperti produksi.
  const second = renderQueue({ ledger: ledgerLive(), keepCache: true })
  await settle()
  console.log(`     sesudah pindah-kembali (masih dalam 60 dtk): banner=${bannerState(second.doc)} · gudang disabled=${tid(second.doc, 'queue-act-gudang-h1')?.disabled}`)
  check('6b banner hasil mount ULANG sudah READY (bukan LEGACY basi)', bannerState(second.doc) === null,
    String(bannerState(second.doc)))
  check('6c borongan NONAKTIF sesudah remount', tid(second.doc, 'queue-act-gudang-h1')?.disabled === true)
}

// ============================================================
console.log('\n=== 7. JALAN KELUAR EKSPLISIT: tombol "Periksa ulang" & window focus ===\n')
// ============================================================
{
  const { doc } = renderQueue({ ledger: null })
  await settle()
  mock.__state.ledger = ledgerLive()
  const btn = tid(doc, 'handover-capability-recheck')
  check('7a tombol "Periksa ulang kesiapan skema" TERSEDIA di banner', !!btn)
  click(btn)
  await settle()
  check('7b klik tombol → banner hilang (state ready) tanpa reload', bannerState(doc) === null, String(bannerState(doc)))
  check('7c borongan NONAKTIF sesudah pemeriksaan ulang', tid(doc, 'queue-act-gudang-h1')?.disabled === true)
}
{
  const { doc } = renderQueue({ ledger: null })
  await settle()
  check('7d prasyarat: legacy', bannerState(doc) === 'legacy', String(bannerState(doc)))
  mock.__state.ledger = ledgerLive()
  console.log(`     visibilityState=${dom0.window.document.visibilityState}`)
  flushSync(() => dom0.window.dispatchEvent(new dom0.window.Event('focus')))
  await settle()
  check('7e window focus → probe ulang → banner hilang (state ready)', bannerState(doc) === null, String(bannerState(doc)))
  check('7f borongan NONAKTIF sesudah focus', tid(doc, 'queue-act-gudang-h1')?.disabled === true)
}

// ============================================================
console.log('\n=== 8. KONTROL POSITIF: LEGACY yang SAH tetap boleh menulis ===\n')
// ============================================================
{
  // Fix TIDAK boleh mematikan satu-satunya jalur yang tersisa sebelum migrasi.
  const { doc, says } = renderQueue({ ledger: null })
  await settle()
  click(tid(doc, 'queue-act-gudang-h1'))
  await settle()
  console.log(`     LEGACY sah: pr_items.status=${mock.__state.prItems.get('pi1').status} · writes=${JSON.stringify(writeTables())}`)
  check('8a LEGACY sah: borongan TETAP menulis (pr_items → DI_GUDANG)', mock.__state.prItems.get('pi1').status === 'DI_GUDANG',
    String(mock.__state.prItems.get('pi1').status))
  check('8b LEGACY sah: tepat SATU update pr_items', mock.__callsOf('update', 'pr_items').length === 1,
    String(mock.__callsOf('update', 'pr_items').length))
  check('8c tidak ada penolakan palsu (pesan sukses, bukan sebab blokir)',
    !/BERUBAH|TIDAK BISA DIPASTIKAN/i.test(says.join(' | ')), says.join(' | ').slice(0, 120))
}
{
  // Penutup di LEGACY sah: form header HARUS terbuka dan Konfirmasi menulis.
  // `prStatus: 'DI_GUDANG'` — lihat catatan di blok 3 (gerbang `summary.done`).
  const { doc } = renderQueue({ ledger: null, prStatus: 'DI_GUDANG' })
  await settle()
  click(tid(doc, 'queue-act-terima-h1'))
  await settle(6)
  check('8d LEGACY sah: form header terbuka', !!tid(doc, 'queue-terima-form-h1'))
  const input = tid(doc, 'queue-terima-nama-h1')
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(dom0.window.HTMLInputElement.prototype, 'value').set
    flushSync(() => { setter.call(input, 'Pak Joko'); input.dispatchEvent(new dom0.window.Event('input', { bubbles: true })) })
  }
  await settle(4)
  click(tid(doc, 'queue-terima-ok-h1'))
  await settle()
  const ho = mock.__state.handovers.get('h1')
  console.log(`     LEGACY sah: diserahkan_at=${ho.diserahkan_at} · status=${ho.status}`)
  check('8e LEGACY sah: Konfirmasi MENULIS diserahkan_at', !!ho.diserahkan_at, String(ho.diserahkan_at))
  check('8f LEGACY sah: status CONFIRMED', String(ho.status) === 'CONFIRMED', String(ho.status))
  check('8g LEGACY sah: penerima tersimpan', String(ho.received_by || '') === 'Pak Joko', String(ho.received_by))
}

// ============================================================
console.log('\n=== 9. READY SEJATI tidak berubah perilakunya ===\n')
// ============================================================
{
  const { doc } = renderQueue({ ledger: ledgerLive() })
  await settle()
  check('9a banner capability TIDAK dirender (state ready)', bannerState(doc) === null, String(bannerState(doc)))
  check('9b borongan NONAKTIF (tujuan per barang aman)', tid(doc, 'queue-act-gudang-h1')?.disabled === true)
  check('9c tombol penutup AKTIF', tid(doc, 'queue-act-terima-h1')?.disabled === false)
  click(tid(doc, 'queue-act-terima-h1'))
  await settle()
  check('9d penutup membuka modal konfirmasi per barang (bukan form header)',
    !tid(doc, 'queue-terima-form-h1') && !!tid(doc, 'handover-confirm-form'))
  check('9e NOL tulisan DB dari membuka modal', writes().length === 0, JSON.stringify(writeTables()))
}

// ============================================================
console.log('\n=== 10. Kontrak dokumen: §7 menyebut pemeriksaan segar ===\n')
// ============================================================
{
  const fs = await import('node:fs')
  const docPath = path.join(SB, 'receiving-events-contract.md')
  const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : ''
  check('10a §7 menyebut halaman TIDAK perlu di-reload / pemeriksaan segar',
    /pemeriksaan segar|probe ulang|tanpa reload|Periksa ulang/i.test(doc), `len=${doc.length}`)
}

console.log(`\n=== HASIL PROBE RUN 234: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
