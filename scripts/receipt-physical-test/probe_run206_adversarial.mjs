// ============================================================
// probe_run206_adversarial.mjs — REVIEW INDEPENDEN run 206 (kandidat dfa35c7)
// ============================================================
// Probe ini menguji RANTAI KEPUTUSAN pada keadaan lapangan yang belum pernah
// diuji harness sebelumnya. Defect yang ditemukan & diperbaiki di run 206;
// probe ini mengunci bukti RED-nya (dijalankan pada kode sebelum fix → FAIL).
//
//   A  Antrean READY: tombol penutup "Tandai Diserahkan" menilai distribusi
//      dari `pr_items.status` (dimensi LEGACY). Alokasi ke tukang sekarang
//      dicatat di `receiving_events.tujuan_tukang`, yang TIDAK mengubah
//      status pr_items → tombol mati, konfirmasi per barang mustahil dibuka.
//   B  Tombol ✓ di baris daftar memanggil handler header LANGSUNG, melewati
//      konfirmasi per barang dan mengunci dokumen (rincian tak bisa dicatat).
//   C  Modal retur: saat semua centang dilepas, panel diagnostik menuduh
//      "data tidak konsisten / mencampur barang dibuang".
//   D  Foto: nama berkas lokal dikirim sebagai `foto_ref` (referensi palsu) dan
//      UI tidak pernah menyatakan berkasnya tidak tersimpan.
//   E  `handover_items` tidak pernah dibaca halaman → rincian serah terima
//      mustahil tampil walau RPC sudah menulisnya.
//
// Jalankan di sandbox hasil `scripts/receipt-physical-test/run.py`:
//   node probe_run206_adversarial.mjs
// Exit 0 selalu (probe pelaporan); lihat baris HASIL PROBE.
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
const CAP = await importDist('modules/receivings/receiptCapability.mjs')

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
function typeInto(el, value) {
  const proto = el.tagName === 'SELECT' ? dom0.window.HTMLSelectElement.prototype : dom0.window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  flushSync(() => {
    setter.call(el, value)
    el.dispatchEvent(new dom0.window.Event('input', { bubbles: true }))
    el.dispatchEvent(new dom0.window.Event('change', { bubbles: true }))
  })
}

// ---------- fixture: keadaan lapangan yang memicu defect ----------
const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-1', delivery_note: 'Nota INV-1', note: '', alokasi: null, masuk_gudang: false, tukang_at: null }
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', item_name: 'Semen', quantity: 10, unit: 'Sak', status: 'APPROVED' },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Pasir', quantity: 4, unit: 'M3', status: 'APPROVED' }
]
const RI = [
  { id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Semen', unit: 'Sak', quantity_received: 10, qty_arrived: 6 },
  { id: 'ri2', receiving_id: 'rec1', pr_item_id: 'pi2', item_name: 'Pasir', unit: 'M3', quantity_received: 4, qty_arrived: 2 }
]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
// Barang SUDAH dialokasikan ke tukang lewat form Terima Barang (jalur baru);
// pr_items.status tetap APPROVED karena tidak ada aksi legacy "ke tukang".
const LEDGER = {
  receivingEvents: [
    { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Semen', unit: 'Sak', qty_datang: 6, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 5, penerima_tukang: 'Pak Joko', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false },
    { id: 'ev2', receiving_id: 'rec1', receiving_item_id: 'ri2', pr_item_id: 'pi2', item_name: 'Pasir', unit: 'M3', qty_datang: 2, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 2, penerima_tukang: 'Pak Joko', retur_status: 'NONE', retur_qty: 0, discard_confirmed: false }
  ],
  handoverItems: [], returnLines: [], returnCases: [], progress: []
}
const noop = () => {}

// ============================================================
console.log('\n=== A. ANTREAN READY: tombol penutup & konfirmasi per barang ===\n')
// ============================================================
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  PM.resetPhysicalModal(); CAP.resetReceiptCapability()
  const ctx = {
    rows: [HO], allReceivings: [REC], allReceivingItems: RI,
    allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    H: { receivingItemsForReceiving: () => RI, prItemsForPr: () => PR_ITEMS },
    say: noop, refresh: noop, onReceivingStatusChange: noop
  }
  const { document: doc } = mount(Q.renderHandoverQueue(ctx))
  await tick(); await tick(); await tick()
  const btn = tid(doc, 'queue-act-terima-h1')
  check('A1 READY: tombol penutup AKTIF walau pr_items belum DI_TUKANG',
    !!btn && btn.disabled === false,
    `disabled=${btn?.disabled} title=${btn?.getAttribute('title')}`)
  if (btn && !btn.disabled) {
    click(btn)
    await tick(); await tick(); await tick()
    check('A2 klik membuka konfirmasi per barang', !!tid(doc, 'handover-confirm-form'))
    check('A3 baris prefill dari alokasi tukang tampil', !!tid(doc, 'hc-qty-ev1'))
  }
}

// ============================================================
console.log('\n=== B. TOMBOL ✓ DI BARIS: tidak boleh melewati konfirmasi per barang ===\n')
// ============================================================
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  PM.resetPhysicalModal(); CAP.resetReceiptCapability()
  let legacyCalled = 0
  const ctx = {
    allReceivings: [REC], allReceivingItems: RI, title: 'Serah Terima', page: 'handovers',
    setEditRow: noop, onDelete: noop, onMarkHandoverDelivered: () => { legacyCalled++ }
  }
  const { document: doc } = mount(V.rowActions(HO, ctx))
  const btn = tid(doc, 'btn-deliver-h1')
  check('B1 tombol ✓ ada', !!btn)
  if (btn) {
    click(btn)
    await tick(); await tick(); await tick()
    const target = PM.__peekForTest ? PM.__peekForTest() : null
    check('B2 ✓ membuka modal konfirmasi (bukan tulis header langsung)',
      target?.kind === 'confirm' && target?.handover?.id === 'h1', JSON.stringify(target?.kind || null))
    check('B3 handler header TIDAK dipanggil (jalur per barang tidak dilewati)', legacyCalled === 0, String(legacyCalled))
  }
}

// ============================================================
console.log('\n=== C. MODAL RETUR: keadaan "belum memilih" ===\n')
// ============================================================
{
  const RET_LEDGER = {
    receivingEvents: [
      { id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Semen', unit: 'Sak', qty_datang: 6, qty_rusak: 2, tujuan_ws: 0, tujuan_tukang: 0, penerima_tukang: null, retur_status: 'PENDING', retur_qty: 2, discard_confirmed: false }
    ],
    handoverItems: [], returnLines: [], returnCases: [], progress: []
  }
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: RET_LEDGER })
  PM.resetPhysicalModal(); CAP.resetReceiptCapability()
  const ReturnForm = (await importDist('modules/handovers/returnForm.mjs')).default
  const { document: doc } = mount(React.createElement(ReturnForm, {
    receiving: REC, capability: { ready: true, returnReady: true, missing: [] },
    say: noop, refresh: noop, close: noop
  }))
  await tick(); await tick(); await tick()
  const box = doc.querySelector('[data-testid="return-lines"] input[type="checkbox"]')
  check('C1 baris retur tampil', !!box)
  if (box) {
    click(box)
    await tick()
    const diagnostic = tid(doc, 'return-no-common-action')?.textContent || ''
    const noneSel = tid(doc, 'return-none-selected')?.textContent || ''
    check('C2 tanpa baris dipilih TIDAK menuduh data tidak konsisten', !/tidak konsisten|mencampur/i.test(diagnostic), diagnostic)
    check('C3 dijelaskan apa adanya: belum ada barang dipilih', /belum ada barang yang dipilih/i.test(noneSel), noneSel)
  }
}

// ============================================================
console.log('\n=== D. FOTO: referensi palsu & kejujuran UI ===\n')
// ============================================================
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  PM.resetPhysicalModal(); CAP.resetReceiptCapability()
  const ReceiptForm = (await importDist('modules/handovers/receiptForm.mjs')).default
  const says = []
  const { document: doc } = mount(React.createElement(ReceiptForm, {
    receiving: REC, items: RI, orderedFor: (it) => (it.pr_item_id === 'pi1' ? 10 : 4),
    capability: { ready: true, returnReady: true, missing: [] },
    say: (m) => says.push(m), refresh: noop, close: noop
  }))
  typeInto(tid(doc, 'rc-datang-ri1'), '2')
  await tick()
  const fi = tid(doc, 'rc-foto-ri1')
  const file = new dom0.window.File(['x'], 'IMG_20261021_0912.jpg', { type: 'image/jpeg' })
  Object.defineProperty(fi, 'files', { value: [file], configurable: true })
  flushSync(() => fi.dispatchEvent(new dom0.window.Event('change', { bubbles: true })))
  await tick()
  check('D1 UI menyatakan berkas foto TIDAK ikut tersimpan',
    /tidak ikut tersimpan/i.test(tid(doc, 'rc-foto-jujur-ri1')?.textContent || ''),
    tid(doc, 'rc-foto-jujur-ri1')?.textContent)
  click(tid(doc, 'receipt-submit'))
  await tick(); await tick(); await tick()
  const payload = mock.__callsOf('rpc')[0]?.args?.p_events?.[0] || null
  check('D2 payload tidak mengirim nama berkas sebagai foto_ref',
    payload !== null && (payload.foto_ref === null || payload.foto_ref === undefined),
    JSON.stringify(payload?.foto_ref))
  check('D3 tidak ada pesan yang mengklaim foto tersimpan', !says.some(m => /foto/i.test(m)), JSON.stringify(says))
}

// ============================================================
console.log('\n=== E. RINCIAN SERAH TERIMA YANG SUDAH TERSIMPAN ===\n')
// ============================================================
{
  // Baris handover seperti hasil loadAll setelah fix: `items` ditempel dari
  // tabel handover_items (bukan ditebak dari Purchase).
  const HO_ITEMS = {
    ...HO, diserahkan_at: '2026-10-21T02:00:00Z', status: 'CONFIRMED',
    items: [{ id: 'hi1', handover_id: 'h1', receiving_event_id: 'ev1', item_name: 'Semen', qty_diserahkan: 5, satuan: 'Sak', penerima: 'Pak Joko' }]
  }
  const D = await importDist('modules/handovers/display.mjs')
  const rinc = D.rincianInfo(HO_ITEMS)
  check('E1 rincian tersimpan ditampilkan (bukan "belum tersedia")', rinc.available === true && rinc.source === 'HANDOVER', JSON.stringify(rinc))
  check('E2 qty yang tampil = qty DISERAHKAN, bukan qty beli',
    rinc.rows?.[0]?.qty === 5 && /diserahkan/.test(rinc.rows?.[0]?.qtyLabel || ''), JSON.stringify(rinc.rows))
  const cell = D.rincianCell(HO_ITEMS)
  check('E3 sel daftar menyebut jumlah barang diserahkan', cell.unavailable === false && cell.count === 1, JSON.stringify(cell))
  const none = D.rincianInfo({ ...HO, items: [] })
  check('E4 tanpa baris tetap label jujur', none.available === false && /belum tersedia/i.test(none.label))
}

console.log(`\n=== HASIL PROBE: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('TEMUAN: ' + failures.join(' | '))
process.exit(0)
