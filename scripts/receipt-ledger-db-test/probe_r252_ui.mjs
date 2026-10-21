// ============================================================
// probe_r252_ui.mjs — REVIEW run 251 / D1 di PERMUKAAN LAYAR, di atas PG NYATA
// ============================================================
// Probe r252_d1_fix membuktikan FUNGSI-nya benar. Probe ini membuktikan
// LAYARNYA: komponen produksi (`queue.jsx`, `confirmForm.jsx`, `view.jsx`)
// dirender di jsdom dengan `lib/supabaseClient` = adapter PostgreSQL NYATA.
//
// Yang diperiksa (skenario reviewer run 251, D1):
//   U1  Antrean: tombol "Tandai Diserahkan" NONAKTIF untuk penerimaan yang
//       seluruh barangnya ke gudang — dan alasannya TERTULIS di layar.
//   U2  Antrean: klik programatik tetap TIDAK membuka modal (pertahanan kedua).
//   U3  Modal konfirmasi: tombol "tanpa rincian" TIDAK dirender, sebabnya
//       dijelaskan (bukan teks SQL).
//   U4  Keadaan SAH: begitu ada barang ke tukang, tombol AKTIF dan modal
//       menampilkan baris prefill; konfirmasi menulis bukti NYATA ke database.
//   U5  Setelah konfirmasi, antrean menyatakan sisa 0 dan menutup tombol.
//   U6  D2: tidak ada teks SQL mentah (`physical_rpc_required`) yang bisa
//       dibaca admin di layar mana pun pada keadaan ini.
//
// Dijalankan sesudah run_r252.py (sandbox + DB siap).
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.env.SB || '/tmp/r252-app-pg'
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
const SBclient = await import(pathToFileURL(path.join(SB, 'lib', 'supabaseClient.mjs')).href)
const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const Q = await load('modules/handovers/queue.mjs')
const PM = await load('modules/handovers/physicalModal.mjs')
const CAP = await load('modules/receivings/receiptCapability.mjs')
const SAVE = await load('modules/receivings/receiptEventSave.mjs')

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

// Menunggu KONDISI, bukan jumlah tick. Capability probe melakukan 4 SELECT
// berurutan dan pembacaan rincian 2 SELECT lagi; jumlah tick yang cukup di
// satu mesin bisa kurang di mesin/waktu lain — dan probe yang bergantung pada
// jumlah tick akan LULUS/GAGAL secara acak (bukan menguji perilaku).
async function waitFor(fn, { tries = 400, label = 'kondisi' } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = fn()
    if (v) return v
    await tick()
  }
  console.log(`  (waitFor timeout: ${label})`)
  return null
}

// ---------- 3) Data NYATA dari database ----------
const admin = SBclient.supabase
const P1 = '11111111-1111-1111-1111-111111111111'
const MAT = 'aaaaaaaa-0000-0000-0000-000000000001'
const VEN = 'bbbbbbbb-0000-0000-0000-000000000001'

async function buy(tag, qty, itemName) {
  const { data, error } = await admin.rpc('purchase_save_atomic', {
    p_payload: {
      client_request_id: `ui-${tag}-request`, vendor_id: VEN, invoice_no: `UI/${tag}`,
      purchased_date: '2026-10-21', queue_handover: true,
      items: [{ material_id: MAT, project_id: P1, item_name: itemName, unit: 'sak', quantity_received: qty, unit_price: 50000 }]
    }
  })
  if (error || !data?.ok) throw new Error(`purchase ${tag}: ${JSON.stringify(error || data)}`)
  return data
}

async function receive(receivingId, itemId, tag, { datang, ws = 0, tukang = 0, penerima = null }) {
  const { data, error } = await admin.rpc('receipt_apply_events', {
    p_receiving_id: receivingId,
    p_events: [{
      client_event_id: `ui-${tag}`, receiving_item_id: itemId, item_name: 'Semen', unit: 'sak',
      qty_datang: datang, qty_rusak: 0, tujuan_ws: ws, tujuan_tukang: tukang,
      penerima_tukang: penerima, retur_status: 'NONE', retur_qty: 0, source: 'FORM'
    }],
    p_meta: {}
  })
  if (error || !data?.ok) throw new Error(`receipt ${tag}: ${JSON.stringify(error || data)}`)
  return data
}

// Baris DB → bentuk yang dipakai halaman (ctx.rows dst). Dibaca dari tabel
// sungguhan, bukan objek karangan.
async function loadCtx(receivingId) {
  const ho = (await admin.from('handovers').select('id, receiving_id, project_id, received_by, handover_date, status, diserahkan_at, note').eq('receiving_id', receivingId)).data || []
  const rec = (await admin.from('receivings').select('id, purchase_request_id, project_id, status, invoice_no, delivery_note, note, alokasi, masuk_gudang, tukang_at').eq('id', receivingId)).data?.[0] || null
  const items = (await admin.from('receiving_items').select('id, receiving_id, pr_item_id, item_name, unit, quantity_received, qty_arrived, qty_handed_over').eq('receiving_id', receivingId)).data || []
  const says = []
  const ctx = {
    rows: ho,
    allReceivings: rec ? [rec] : [],
    allReceivingItems: items,
    allRequests: [],
    H: {
      receivingItemsForReceiving: (id) => items.filter(i => i.receiving_id === id),
      prItemsForPr: () => []
    },
    say: (m) => says.push(m),
    refresh: () => {},
    onReceivingStatusChange: () => {}
  }
  return { ctx, ho, rec, items, says }
}

// ============================================================
head('U1/U2. Antrean — penerimaan 100% ke GUDANG (skenario reviewer D1)')
// ============================================================
const A = await buy('A', 10, 'Semen 50kg (gudang)')
const aItem = (await admin.from('receiving_items').select('id').eq('receiving_id', A.receiving_id)).data[0].id
await receive(A.receiving_id, aItem, 'A-ev', { datang: 10, ws: 10, tukang: 0 })

CAP.resetReceiptCapability()
const A1 = await loadCtx(A.receiving_id)
let doc = mount(Q.renderHandoverQueue(A1.ctx))
// Tunggu sampai SELURUH pemeriksaan selesai — tandanya alasan D1 yang
// sebenarnya muncul (bukan pesan sementara "masih diperiksa").
const reasonA = await waitFor(() => {
  const el = tid(doc, `queue-finish-reason-${A.handover_id}`)
  return el && /gudang|workshop/i.test(txt(el)) ? el : null
}, { label: 'alasan D1 (gudang)' })
await settle(6)

const finishA = tid(doc, `queue-act-terima-${A.handover_id}`)
ck('U1a tombol "Tandai Diserahkan" ada di antrean', !!finishA)
ck('U1b tombol NONAKTIF (bukan "aktif lalu gagal")', finishA?.disabled === true, `disabled=${finishA?.disabled}`)
ck('U1c alasan TERTULIS di layar (bukan hanya tooltip)', !!reasonA && txt(reasonA).length > 40, txt(reasonA).slice(0, 120))
ck('U1d alasan menyebut barang ke gudang/workshop', /gudang|workshop/i.test(txt(reasonA)), txt(reasonA).slice(0, 160))
ck('U1e alasan menyebut jalan keluar yang bisa dijalankan (Terima Barang / hapus)', /Terima Barang|hapus/i.test(txt(reasonA)), txt(reasonA).slice(0, 200))
ck('U1f tidak ada teks SQL mentah di layar', !/physical_rpc_required|empty_lines|23514|42501/.test(txt(doc.body)))
ck('U1g tombol "Periksa ulang rincian" tersedia (tanpa reload halaman)', !!tid(doc, `queue-finish-recheck-${A.handover_id}`))

// Pertahanan kedua: klik programatik tidak boleh membuka modal.
// Catatan jujur: React TIDAK memanggil onClick untuk elemen dengan prop
// `disabled`, bahkan bila atribut DOM-nya dihapus. Jadi uji ini membuktikan
// lapisan React (bukan lapisan `deliverState` di `run()`); lapisan `run()`
// diuji terpisah lewat keadaan BASI di U2c di bawah.
PM.resetPhysicalModal()
if (finishA) {
  finishA.disabled = false
  finishA.removeAttribute('disabled')
  click(finishA)
}
await settle(30)
const modalOpen = PM.__peekForTest ? PM.__peekForTest() : null
ck('U2a klik programatik TIDAK membuka modal konfirmasi', modalOpen === null, JSON.stringify(modalOpen?.kind || null))
ck('U2b tidak ada klaim sukses palsu ke admin', !A1.says.some(m => /tersimpan|berhasil|sudah diserahkan/i.test(String(m))),
  JSON.stringify(A1.says).slice(0, 300))

// U2c — lapisan KEDUA di `run()` diuji langsung lewat fungsi gerbang murni
// produksi (`finishGate`), dengan data NYATA dari database. Ini yang menahan
// pemanggilan programatik, karena tombol `disabled` saja bukan pengaman.
const gateNoTukang = Q.finishGate(true, await SAVE.loadDeliverability({ receivingId: A.receiving_id }), { hasReceiving: true })
ck('U2c gerbang tulis MENOLAK untuk penerimaan tanpa barang ke tukang',
  gateNoTukang.blocked === Q.NO_TUKANG_REASON, gateNoTukang.blocked.slice(0, 120))
const gateChecking = Q.finishGate(true, null, { hasReceiving: true })
ck('U2d gerbang tulis MENAHAN saat rincian belum terbaca (fail closed)',
  gateChecking.blocked === Q.DELIVER_CHECKING_REASON && gateChecking.checked === false, gateChecking.blocked.slice(0, 100))
const gateFailed = Q.finishGate(true, { ok: false, error: 'jaringan' }, { hasReceiving: true })
ck('U2e gerbang tulis MENOLAK saat pembacaan gagal (tidak menebak)',
  gateFailed.blocked === Q.DELIVER_CHECK_FAILED_REASON, gateFailed.blocked.slice(0, 100))
const gateLegacy = Q.finishGate(false, null, { hasReceiving: true })
ck('U2f gerbang LEGACY tetap terbuka (jalur header lama satu-satunya)', gateLegacy.blocked === '')
// REVIEW run 253 / D4 — assertion ini DULU berbunyi "dokumen TANPA penerimaan
// tetap boleh (data lama, tidak ada ledger)" dan mengunci premis yang SALAH:
// di bawah v1 trigger menolak SETIAP penulisan `diserahkan_at` oleh
// `authenticated` (tanpa melihat `receiving_id`) dan `handover_confirm`
// menjawab `handover_not_found`. Diuji di DB nyata oleh
// `probe_r254_d4_d5.mjs` blok A. Jadi gerbangnya sekarang MENOLAK.
const gateOrphan = Q.finishGate(true, null, { hasReceiving: false })
ck('U2g dokumen TANPA penerimaan DITOLAK saat ledger siap (dulu: diloloskan lalu gagal di DB)',
  gateOrphan.blocked === Q.ORPHAN_NO_RECEIVING_REASON, gateOrphan.blocked.slice(0, 120))
const gateOrphanLegacy = Q.finishGate(false, null, { hasReceiving: false })
ck('U2h dokumen TANPA penerimaan tetap boleh di LEGACY (jalur header satu-satunya)',
  gateOrphanLegacy.blocked === '', gateOrphanLegacy.blocked.slice(0, 80))

// ============================================================
head('U3. Modal konfirmasi — jalur tulis header TIDAK ditawarkan')
// ============================================================
const ConfirmForm = (await load('modules/handovers/confirmForm.mjs')).default
const capReady = { ready: true, returnReady: true, events: true, handoverItems: true, returnLines: true, progress: true, probeFailed: false, missing: [] }
const says3 = []
doc = mount(React.createElement(ConfirmForm, {
  handover: A1.ho[0], capability: capReady,
  say: (m) => says3.push(m), refresh: () => {}, close: () => {}
}))
await waitFor(() => tid(doc, 'handover-confirm-empty'), { label: 'panel tidak ada barang' })
await settle(6)
ck('U3a panel "tidak ada barang ke tukang" tampil', !!tid(doc, 'handover-confirm-empty'), txt(tid(doc, 'handover-confirm-empty')))
ck('U3b tombol "tanpa rincian" TIDAK dirender', !tid(doc, 'handover-confirm-headeronly'))
ck('U3c tombol submit utama NONAKTIF (tidak ada baris sah)', tid(doc, 'handover-confirm-submit')?.disabled === true)
ck('U3d penjelasan menyebut database menolak tanpa rincian', /menolak/i.test(txt(tid(doc, 'handover-confirm-empty'))), txt(tid(doc, 'handover-confirm-empty')).slice(0, 200))
ck('U3e penjelasan menawarkan catat tujuan di Terima Barang', /Terima Barang/i.test(txt(tid(doc, 'handover-confirm-empty'))))
ck('U3f tidak ada teks SQL mentah di modal', !/physical_rpc_required|empty_lines/.test(txt(doc.body)))

// ============================================================
head('U4/U5. Keadaan SAH — barang ke tukang: tombol aktif & bukti NYATA')
// ============================================================
const B = await buy('B', 6, 'Semen 50kg (tukang)')
const bItem = (await admin.from('receiving_items').select('id').eq('receiving_id', B.receiving_id)).data[0].id
await receive(B.receiving_id, bItem, 'B-ev', { datang: 6, ws: 0, tukang: 6, penerima: 'Pak Joko' })

CAP.resetReceiptCapability()
const B1 = await loadCtx(B.receiving_id)
doc = mount(Q.renderHandoverQueue(B1.ctx))
const progB = await waitFor(() => tid(doc, `queue-deliver-progress-${B.handover_id}`), { label: 'progres alokasi' })
await settle(6)

const finishB = tid(doc, `queue-act-terima-${B.handover_id}`)
ck('U4a tombol "Tandai Diserahkan" AKTIF', finishB?.disabled === false, `disabled=${finishB?.disabled}`)
ck('U4b progres alokasi/sisa tampil dari ledger', !!progB && /sisa/i.test(txt(progB)), txt(progB))
ck('U4c progres menyebut 6 unit dan sisa 6', /6/.test(txt(progB)) && /sisa\s*6/i.test(txt(progB)), txt(progB))

PM.resetPhysicalModal()
if (finishB) click(finishB)
await settle(14)
const openB = PM.__peekForTest ? PM.__peekForTest() : null
ck('U4d klik membuka modal konfirmasi per barang', openB?.kind === 'confirm', JSON.stringify(openB?.kind || null))

// Modal dirender oleh host produksi (PhysicalModalHost) — diuji lewat form
// yang sama, dengan data dokumen dari DB.
const evB = (await SAVE.loadReceivingEvents({ receivingId: B.receiving_id })).events || []
const delB = (await SAVE.loadDeliveredByEvent({ eventIds: evB.map(e => e.id) })).delivered || {}
ck('U4e (kontrol) belum ada yang diserahkan di DB', Object.keys(delB).length === 0, JSON.stringify(delB))

const says4 = []
doc = mount(React.createElement(ConfirmForm, {
  handover: B1.ho[0], capability: capReady,
  say: (m) => says4.push(m), refresh: () => {}, close: () => {}
}))
const qtyInput = await waitFor(() => tid(doc, `hc-qty-${evB[0].id}`), { label: 'baris prefill' })
await settle(6)
ck('U4f baris prefill tampil (bukan kosong)', !!qtyInput && Number(qtyInput.value) === 6, String(qtyInput?.value))
ck('U4g nama penerima terisi dari event', /Pak Joko/.test(tid(doc, `hc-penerima-${evB[0].id}`)?.value || ''),
  tid(doc, `hc-penerima-${evB[0].id}`)?.value)
ck('U4h tombol submit AKTIF', tid(doc, 'handover-confirm-submit')?.disabled === false)
click(tid(doc, 'handover-confirm-submit'))
await settle(20)
ck('U4i pesan sukses jujur (menyebut tersimpan)', says4.some(m => /Serah terima tersimpan/i.test(String(m))), JSON.stringify(says4))

const rowB = (await admin.from('handovers').select('diserahkan_at, status').eq('id', B.handover_id)).data?.[0]
ck('U4j bukti fisik TERCATAT di database (bukan klaim UI)', !!rowB?.diserahkan_at && rowB?.status === 'CONFIRMED', JSON.stringify(rowB))
const hiB = (await admin.from('handover_items').select('qty_diserahkan, penerima').eq('handover_id', B.handover_id)).data || []
ck('U4k rincian per barang tersimpan (6 unit, penerima Pak Joko)',
  hiB.length === 1 && Number(hiB[0].qty_diserahkan) === 6 && hiB[0].penerima === 'Pak Joko', JSON.stringify(hiB))

// U5 — antrean setelah konfirmasi: dokumen keluar dari antrean, sisa 0.
CAP.resetReceiptCapability()
const B2 = await loadCtx(B.receiving_id)
ck('U5a dokumen keluar dari antrean (sudah diserahkan)', (B2.ho[0]?.diserahkan_at ? true : false) === true, JSON.stringify(B2.ho[0]?.diserahkan_at))
const dB = await SAVE.loadDeliverability({ receivingId: B.receiving_id })
ck('U5b sisa 0 & allDelivered', dB.deliverability?.remaining === 0 && dB.deliverability?.allDelivered === true, JSON.stringify(dB.deliverability))

// ============================================================
head('U6. D2 — tidak ada teks SQL mentah yang bisa dibaca admin')
// ============================================================
// Diuji juga untuk jalur yang MASIH menulis kolom mentah (LEGACY): bila
// trigger v1 menolak, pesannya harus kalimat, bukan kode.
const ERRTXT = await load('modules/handovers/dbErrorText.mjs')
const conv = ERRTXT.dbErrorText('physical_rpc_required', { fallback: 'Gagal menyimpan.' })
ck('U6a konversi kode DB → kalimat (tanpa kode mentah di awal)', !/^physical_rpc_required/.test(conv.text), conv.text.slice(0, 80))
ck('U6b kode asli tetap tersedia untuk pelaporan', conv.code === 'physical_rpc_required')
// Pesan aplikasi sendiri tidak boleh ikut "diterjemahkan" menjadi aneh.
const own = ERRTXT.dbErrorText('Tidak ada barang yang bisa diserahkan.', { fallback: 'x' })
ck('U6c pesan aplikasi diteruskan apa adanya', own.text === 'Tidak ada barang yang bisa diserahkan.', own.text)

console.log(`\n=== HASIL PROBE r252 UI (D1/D2 di layar + PG NYATA): ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
await SBclient.__close?.()
process.exit(fail ? 1 : 0)
