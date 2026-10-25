// ============================================================
// RENDER TEST — ModuleView.js + modules/handovers/* ASLI (hasil SWC) di
// jsdom INTERAKTIF: klik nyata, ketik nyata, submit nyata.
// t_b418827b: daftar (kolom Barang, status bukti fisik, aksi tidak bertumpuk,
// detail expand + prototype), edit modal (tanpa dropdown sumber/status),
// form tambah (link wajib), konfirmasi fisik dari UI.
// Dijalankan oleh run.py di sandbox (mock supabase perekam, tanpa DB).
// PENTING URUTAN: env jsdom dibuat SEBELUM react-dom diimpor.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// ---------- 1) DOM environment dulu ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

// ---------- 2) React & komponen ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default
const Create = (await import(pathToFileURL(path.join(SB, 'dist/components/CreateModal.mjs')).href)).default
// PENTING: mock harus dari dist/ — komponen terkompilasi mengimpor dist/lib/…
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)
const { buildDistributionQueue } = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/logic.mjs')).href)

// ---------- 3) Helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))

// ---------- 4) Fixture data ----------
const noop = () => {}
const PROJECTS = [
  { id: 'p1', kode: '100', code: '100', name: 'EA Store - Ruko Crystal GS', status: 'ON_GOING', created_at: '2026-10-01T00:00:00Z' }
]
const REQUESTS = [
  { id: 'pr1', pr_number: 'PR-TEST-458648', title: 'Fitting & elektrik', project_id: 'p1' }
]
const RECEIVINGS = [
  { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', project_name: '[100] EA Store - Ruko Crystal GS', status: 'NORMAL', invoice_no: 'INV-PR-TEST-458648-3', delivery_note: 'SJ-PR-TEST-458648-3', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: '2026-10-15T00:00:00Z' }
]
const RECEIVING_ITEMS = [
  { id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Fitting engsel', unit: 'Pcs', quantity_received: 4 },
  { id: 'ri2', receiving_id: 'rec1', pr_item_id: 'pi2', item_name: 'Kabel NYM', unit: 'Meter', quantity_received: 10 }
]
// h1: data live — CONFIRMED tapi diserahkan_at NULL (bukan bukti fisik).
const HANDOVERS = [
  { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] EA Store - Ruko Crystal GS', received_by: 'Pak Joko (Mandor EA Store)', status: 'CONFIRMED', handover_date: '2026-10-15', diserahkan_at: null, note: 'Barang fitting & elektrik diterima langsung oleh Mandor di site ruko' },
  // h2: sudah benar-benar diserahkan (bukti fisik).
  { id: 'h2', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] EA Store - Ruko Crystal GS', received_by: 'Pak Andi', status: 'CONFIRMED', handover_date: '2026-10-14', diserahkan_at: '2026-10-14T08:00:00Z', note: '' }
]

function mountModule(rows, extra = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22 read-only */ }
  const props = {
    page: 'handovers',
    rows,
    allProjects: PROJECTS, allMaterials: [], allPrItems: [],
    allReceivingItems: RECEIVING_ITEMS, allRequests: REQUESTS, allReceivings: RECEIVINGS, allVendors: [],
    refresh: noop, say: noop, onDelete: noop, setPage: noop,
    onMarkHandoverDelivered: extra.onMarkHandoverDelivered || noop,
    ...extra
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, root, document }
}

function mountCreate(editRow, extra = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22 read-only */ }
  const props = {
    page: 'handovers', editRow,
    allProjects: PROJECTS, allMaterials: [], allVendors: [],
    existingRequests: [], allRequestsFull: REQUESTS, allReceivings: RECEIVINGS,
    close: noop, refresh: noop, say: noop, ...extra
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Create, props)))
  return { dom, root, document }
}

console.log('=== R1. DAFTAR HANDOVER (desktop): barang, status bukti fisik, aksi ringkas ===\n')

// ---------- R1: daftar ----------
{
  const { document: doc } = mountModule(HANDOVERS)
  await tick()
  const text = doc.body.textContent || ''
  // Kolom Barang
  check('R1a kolom "Barang" header ada', /Barang/.test(text))
  check('R1b data lama -> "Rincian barang belum tersedia"', /Rincian barang belum tersedia/.test(text))
  check('R1c TIDAK menampilkan angka tebakan qty dari Purchase', !/4 Pcs|10 Meter/.test(doc.querySelector('.desktop-table-view')?.textContent || ''))
  // Status = bukti fisik
  check('R1d h1 (CONFIRMED tanpa diserahkan_at) -> Belum Diserahkan', /Belum Diserahkan/.test(text))
  check('R1e catatan status lama tampil', /Status lama "CONFIRMED"/.test(text))
  check('R1f h2 (diserahkan_at ada) -> Sudah Diserahkan', /Sudah Diserahkan/.test(text))
  // Filter tabs dari bukti fisik: 1 sudah, 1 belum
  check('R1g tab "Sudah Diserahkan (1)"', /Sudah Diserahkan \(1\)/.test(text))
  check('R1h tab "Belum Diserahkan (1)"', /Belum Diserahkan \(1\)/.test(text))
  // Aksi tidak bertumpuk: satu baris inline
  const row1 = doc.querySelector('[data-testid="btn-deliver-h1"]')
  const edit1 = doc.querySelector('[data-testid="btn-edit-h1"]')
  const del1 = doc.querySelector('[data-testid="btn-hapus-h1"]')
  check('R1i tombol konfirmasi (✓) ada utk belum diserahkan', !!row1)
  check('R1j tombol edit & hapus ada', !!edit1 && !!del1)
  check('R1k h2 sudah diserahkan -> tanda ✓ statis, bukan tombol', !!doc.querySelector('[data-testid="delivered-h2"]') && !doc.querySelector('[data-testid="btn-deliver-h2"]'))
  // Tidak ada dropdown status handover di daftar
  check('R1l TIDAK ada dropdown status di daftar', !doc.querySelector('.desktop-table-view select'))
  // Tombol aksi tidak full-width bertumpuk (gaya lama width 120px kolom)
  const act = doc.querySelector('[data-testid="btn-edit-h1"]')?.parentElement
  check('R1m aksi berbentuk baris inline (display inline-flex)', /inline-flex/.test(act?.getAttribute('style') || ''))
}

// ---------- R2: konfirmasi fisik dari UI ----------
{
  mock.__reset({ handovers: [{ id: 'h1', status: 'CONFIRMED', diserahkan_at: null }] })
  let confirmed = null
  const { document: doc } = mountModule(HANDOVERS, { onMarkHandoverDelivered: (r) => { confirmed = r } })
  await tick()
  click(doc.querySelector('[data-testid="btn-deliver-h1"]'))
  await tick()
  check('R2a klik ✓ memanggil onMarkHandoverDelivered dgn baris benar', confirmed?.id === 'h1')
  // h2 (sudah diserahkan) tidak menawarkan tombol lagi
  check('R2b baris sudah diserahkan tidak punya tombol konfirmasi', !doc.querySelector('[data-testid="btn-deliver-h2"]'))
}

// ---------- R3: detail expand + prototype ----------
{
  const { document: doc } = mountModule(HANDOVERS)
  await tick()
  const btn = doc.querySelector('[data-testid="btn-detail-h1"]')
  check('R3a tombol "+ Detail" ada', !!btn && /\+ Detail/.test(btn.textContent))
  click(btn)
  await tick()
  const detail = doc.querySelector('[data-testid="handover-detail-h1"]')
  check('R3b detail terbuka', !!detail)
  const dt = detail?.textContent || ''
  check('R3c referensi Purchase asal tampil', /INV-PR-TEST-458648-3/.test(dt))
  check('R3d PR asal tampil', /PR-TEST-458648/.test(dt))
  check('R3e penerima tampil', /Pak Joko/.test(dt))
  check('R3f rincian label jujur', /Rincian barang belum tersedia/.test(dt))
  check('R3g status + catatan legacy di detail', /Belum Diserahkan/.test(dt) && /Status lama/.test(dt))
  // Prototype panel (karena receiving punya 2 item)
  const proto = doc.querySelector('[data-testid="prototype-panel-h1"]')
  check('R3h prototype panel tampil (2 item penerimaan)', !!proto)
  check('R3i panel menyatakan belum tersimpan', /belum tersimpan|TIDAK ditulis/i.test(proto?.textContent || ''))
  // Isi prototype: pilih item, qty 6 (> sisa 4) -> error; qty 4 -> tercatat
  const sel = doc.querySelector('[data-testid="proto-item-h1"]')
  const qty = doc.querySelector('[data-testid="proto-qty-h1"]')
  const setV = (el, val) => {
    const proto2 = el.tagName === 'SELECT' ? doc.defaultView.HTMLSelectElement.prototype : doc.defaultView.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto2, 'value').set
    flushSync(() => {
      setter.call(el, val)
      el.dispatchEvent(new doc.defaultView.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    })
  }
  setV(sel, 'ri1'); await tick()
  setV(qty, '6'); await tick()
  click(doc.querySelector('[data-testid="proto-add-h1"]'))
  await tick()
  check('R3j qty 6 > diterima 4 -> error tampil', /Melebihi sisa/.test(doc.querySelector('[data-testid="proto-error-h1"]')?.textContent || ''))
  setV(qty, '3'); await tick()
  click(doc.querySelector('[data-testid="proto-add-h1"]'))
  await tick()
  check('R3k qty 3 -> tercatat di sesi', /Triplek|Fitting engsel/.test(doc.querySelector('[data-testid="prototype-panel-h1"]')?.textContent || '') && /3/.test(doc.body.textContent))
  // Nol mutasi DB dari interaksi prototype
  check('R3l nol insert/update DB dari prototype', mock.__callsOf('insert').length === 0 && mock.__callsOf('update').length === 0)
  // Tutup detail
  click(doc.querySelector('[data-testid="btn-detail-h1"]'))
  await tick()
  check('R3m klik lagi menutup detail', !doc.querySelector('[data-testid="handover-detail-h1"]'))
}

// ---------- R4: modal EDIT tanpa dropdown sumber/status ----------
{
  const editRow = HANDOVERS[0]
  const { document: doc } = mountCreate(editRow)
  await tick()
  const form = doc.querySelector('form.dialog')
  const ft = form?.textContent || ''
  // t_31871b64 (Sprint 1, arahan DAT): label terlihat "Handover" diganti
  // "Serah Terima" di lib/constants.js, jadi judul modal ikut berubah.
  // Yang diperiksa tetap perilaku (tidak ada dropdown sumber/status).
  check('R4a judul "Edit Serah Terima"', /Edit Serah Terima/.test(ft))
  check('R4b TIDAK ada dropdown Penerimaan (Purchase) di edit', !/Penerimaan \(Purchase\)/.test(ft))
  check('R4c TIDAK ada dropdown Project di edit', !/Project \(otomatis dari penerimaan/.test(ft))
  check('R4d TIDAK ada dropdown Status Serah Terima di edit', !/Status Serah Terima/.test(ft))
  check('R4e ringkasan sumber read-only tampil', !!doc.querySelector('[data-testid="handover-source-summary"]'))
  check('R4f ringkasan memuat Purchase & PR asal', /INV-PR-TEST-458648-3/.test(doc.querySelector('[data-testid="handover-source-summary"]')?.textContent || '') && /PR-TEST-458648/.test(doc.querySelector('[data-testid="handover-source-summary"]')?.textContent || ''))
  check('R4g status read-only + catatan legacy', /Belum Diserahkan/.test(doc.querySelector('[data-testid="handover-source-summary"]')?.textContent || ''))
  check('R4h daftar rincian barang wajib terlihat di modal', !!doc.querySelector('[data-testid="handover-items-summary"]'))
  check('R4i label jujur di modal edit', /Rincian barang belum tersedia/.test(doc.querySelector('[data-testid="handover-rincian-unavailable"]')?.textContent || ''))
  // Field yang tetap ada
  check('R4j field Diterima Oleh ada + terisi', doc.querySelector('input[type="text"]')?.value === 'Pak Joko (Mandor EA Store)')
  check('R4k field Tanggal ada', !!doc.querySelector('input[type="date"]'))
  check('R4l field foto (opsional) ada', !!doc.querySelector('input[type="file"]'))
  // submit edit -> update metadata saja (FK/status tidak di payload)
  mock.__reset({ handovers: [{ id: 'h1', receiving_id: 'rec1', project_id: 'p1', status: 'CONFIRMED', diserahkan_at: null }] })
  const f = doc.querySelector('form.dialog')
  flushSync(() => f.requestSubmit())
  await tick(); await tick()
  const upd = mock.__callsOf('update', 'handovers')[0]
  check('R4m submit -> update handovers', !!upd)
  check('R4n payload edit tanpa receiving_id/status/diserahkan_at', upd && !('receiving_id' in upd.data) && !('status' in upd.data) && !('diserahkan_at' in upd.data))
}

// ---------- R5: modal TAMBAH tetap punya pemilihan sumber (link wajib) ----------
{
  const { document: doc } = mountCreate(null)
  await tick()
  const ft = doc.querySelector('form.dialog')?.textContent || ''
  // t_31871b64 (Sprint 1): label "Handover" -> "Serah Terima" (lihat R4a).
  check('R5a judul "Tambah Serah Terima"', /Tambah Serah Terima/.test(ft))
  check('R5b dropdown Penerimaan ada (link wajib)', /Penerimaan \(Purchase\)/.test(ft))
  const sel = [...doc.querySelectorAll('select')].find(s => /Pilih Penerimaan/.test(s.textContent))
  check('R5c dropdown penerimaan required', sel?.required === true)
  check('R5d TIDAK ada dropdown status (antrean otomatis DRAFT)', !/Status Serah Terima/.test(ft))
  check('R5e keterangan link wajib tampil', /harus terhubung ke penerimaan/.test(ft))
}

// ---------- R6: mobile card ----------
{
  const { document: doc } = mountModule(HANDOVERS)
  await tick()
  const cards = doc.querySelector('.mobile-cards-view')
  const ct = cards?.textContent || ''
  check('R6a kartu mobile menampilkan label rincian jujur', /Rincian barang belum tersedia/.test(ct))
  check('R6b tombol konfirmasi mobile ada utk h1', !!doc.querySelector('[data-testid="btn-deliver-mobile-h1"]'))
  check('R6c h2 sudah diserahkan -> teks statis', /✓ Sudah diserahkan/.test(ct))
  check('R6d tombol detail mobile ada', !!doc.querySelector('[data-testid="btn-detail-mobile-h1"]'))
}

// ---------- R7: banner antrean distribusi fisik (t_ca7ecb65) ----------
{
  const { document: doc } = mountModule(HANDOVERS)
  await tick()
  const banner = doc.querySelector('[data-testid="handover-queue-banner"]')
  check('R7a banner antrean muncul', !!banner)
  check('R7b hanya handover DRAFT yang masuk antrean', /1 handover menunggu/.test(banner?.textContent || ''))
  // h2 sudah diserahkan -> tidak boleh punya kartu antrean
  check('R7c handover terkonfirmasi tidak diantre', !doc.querySelector('[data-testid="queue-card-h2"]'))
  const card = doc.querySelector('[data-testid="queue-card-h1"]')
  check('R7d kartu aksi h1 tampil', !!card)
  check('R7e 3 tombol aksi tersedia', (card?.querySelectorAll('button[data-testid^="queue-act-"]') || []).length === 3)
  // rec1 belum punya barang terjual (allPrItems kosong) -> "Tandai diserahkan" harus nonaktif
  const terima = doc.querySelector('[data-testid="queue-act-terima-h1"]')
  check('R7f aksi terima nonaktif sebelum ada distribusi', terima?.disabled === true)
  check('R7g alasan terima tampil di title', /Belum ada barang/.test(terima?.getAttribute('title') || ''))
  // Fixture rec1: alokasi KE_TUKANG + tukang_at sudah terisi -> aksi tukang
  // nonaktif karena SUDAH dikirim (bukan karena alokasi).
  const tukang = doc.querySelector('[data-testid="queue-act-tukang-h1"]')
  check('R7h aksi tukang nonaktif (sudah dikirim)', tukang?.disabled === true)
  check('R7i alasan tukang tampil di title', /nota sudah ditandai dikirim/i.test(tukang?.getAttribute('title') || ''))
  const gudang = doc.querySelector('[data-testid="queue-act-gudang-h1"]')
  check('R7j aksi gudang aktif', gudang?.disabled === false)
}

// ---------- R7b: penjaga alokasi (gudang -> tukang dilarang) ----------
{
  mock.__reset({
    handovers: [{ id: 'h1', receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Andi', status: 'DRAFT', diserahkan_at: null }],
    receivings: [{ id: 'rec1', masuk_gudang: false, tukang_at: null, alokasi: 'KE_GUDANG' }],
    prItems: [{ id: 'p1', status: 'RECEIVED', quantity: 2 }],
    receivingItems: [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'p1' }]
  })
  const { document: doc } = mountModule(
    [{ id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] EA Store', received_by: 'Pak Andi', status: 'CONFIRMED', handover_date: '2026-10-15', diserahkan_at: null, note: '' }],
    { allReceivings: [{ id: 'rec1', purchase_request_id: 'pr1', masuk_gudang: false, tukang_at: null, alokasi: 'KE_GUDANG' }], allPrItems: [{ id: 'p1', pr_id: 'pr1', status: 'RECEIVED', quantity: 2 }], allReceivingItems: [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'p1' }] }
  )
  await tick()
  const tukang = doc.querySelector('[data-testid="queue-act-tukang-h1"]')
  check('R7k nota alokasi gudang -> tukang nonaktif', tukang?.disabled === true)
  check('R7l alasannya soal alokasi gudang', /gudang/i.test(tukang?.getAttribute('title') || ''))
  // dan ringkasan sudah benar menghitung 2 barang
  check('R7m ringkasan menghitung qty barang', /0 dari 2 barang/.test(doc.querySelector('[data-testid="queue-summary-h1"]')?.textContent || ''))
}

// ---------- R8: klik aksi "Kirim ke Gudang" dari UI nyata ----------
{
  const calls = []
  mock.__reset({
    handovers: [{ id: 'h1', receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Andi', status: 'DRAFT', diserahkan_at: null }],
    receivings: [{ id: 'rec1', masuk_gudang: false, tukang_at: null, alokasi: 'KE_GUDANG' }],
    prItems: [{ id: 'p1', status: 'RECEIVED', quantity: 2 }],
    receivingItems: [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'p1' }]
  })
  const { document: doc } = mountModule(
    [{ id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] EA Store', received_by: 'Pak Andi', status: 'CONFIRMED', handover_date: '2026-10-15', diserahkan_at: null, note: '' }],
    { say: (m) => calls.push(m), allReceivings: [{ id: 'rec1', masuk_gudang: false, tukang_at: null, alokasi: 'KE_GUDANG' }], allPrItems: [{ id: 'p1', pr_id: 'pr1', status: 'RECEIVED', quantity: 2 }], allReceivingItems: [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'p1' }] }
  )
  await tick()
  const gudang = doc.querySelector('[data-testid="queue-act-gudang-h1"]')
  check('R8a tombol gudang ada di UI', !!gudang)
  flushSync(() => { gudang.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })) })
  await tick(); await tick()
  check('R8b receivings.masuk_gudang jadi true', mock.__state.receivings.get('rec1').masuk_gudang === true)
  check('R8c pr_items.status jadi DI_GUDANG', mock.__state.prItems.get('p1').status === 'DI_GUDANG')
  check('R8d ada notifikasi sukses ke user', calls.some(c => /gudang/i.test(c)))
}

// ---------- R9: klik "Tandai Diserahkan" dari UI nyata ----------
{
  const calls = []
  mock.__reset({
    handovers: [{ id: 'h1', receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Andi', status: 'DRAFT', diserahkan_at: null }],
    receivings: [{ id: 'rec1', masuk_gudang: true, tukang_at: null, alokasi: 'KE_GUDANG' }],
    prItems: [{ id: 'p1', status: 'DI_GUDANG', quantity: 2 }],
    receivingItems: [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'p1' }]
  })
  const { document: doc } = mountModule(
    [{ id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] EA Store', received_by: 'Pak Andi', status: 'CONFIRMED', handover_date: '2026-10-15', diserahkan_at: null, note: '' }],
    { say: (m) => calls.push(m), allReceivings: [{ id: 'rec1', purchase_request_id: 'pr1', masuk_gudang: true, tukang_at: null, alokasi: 'KE_GUDANG' }], allPrItems: [{ id: 'p1', pr_id: 'pr1', status: 'DI_GUDANG', quantity: 2 }], allReceivingItems: [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'p1' }] }
  )
  await tick()
  const terima = doc.querySelector('[data-testid="queue-act-terima-h1"]')
  check('R9a aksi terima aktif setelah barang masuk gudang', terima?.disabled === false)
  flushSync(() => { terima.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })) })
  await tick(); await tick()
  check('R9b form nama penerima muncul', !!doc.querySelector('[data-testid="queue-terima-form-h1"]'))
  const nama = doc.querySelector('[data-testid="queue-terima-nama-h1"]')
  // input terkontrol React: set .value langsung tidak terdeteksi onChange,
  // jadi pakai native setter lalu kirim event input (pola standar React test).
  const setter = Object.getOwnPropertyDescriptor(dom0.window.HTMLInputElement.prototype, 'value').set
  setter.call(nama, 'Mandor A')
  nama.dispatchEvent(new dom0.window.Event('input', { bubbles: true }))
  const okBtn = doc.querySelector('[data-testid="queue-terima-ok-h1"]')
  flushSync(() => { okBtn.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true })) })
  await tick(); await tick()
  check('R9c diserahkan_at terisi', !!mock.__state.handovers.get('h1').diserahkan_at)
  check('R9d received_by tersimpan', mock.__state.handovers.get('h1').received_by === 'Mandor A')
  // refresh() di test adalah noop, jadi DOM belum berubah. Yang benar-benar
  // menentukan kartu hilang: buildDistributionQueue harus mengecualikan
  // handover yang sudah diserahkan_at. Itu yang diuji di sini.
  const stillQueued = buildDistributionQueue([
    { id: 'h1', receiving_id: 'rec1', diserahkan_at: mock.__state.handovers.get('h1').diserahkan_at },
    { id: 'h2', receiving_id: 'rec2', diserahkan_at: null }
  ]).map(h => h.id)
  check('R9e handover keluar dari antrean (sudah diserahkan)', stillQueued.join(',') === 'h2')
}

console.log(`\nrender_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
process.exit(fail ? 1 : 0)
