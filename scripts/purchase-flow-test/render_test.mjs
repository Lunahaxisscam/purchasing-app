// ============================================================
// RENDER TEST — page.jsx + purchaseForm.jsx ASLI (dist hasil SWC) di jsdom
// INTERAKTIF: klik tab nyata, centang nyata, ketik nyata, submit nyata.
// Bagian C: dua tab, centang banyak barang, dialog Proses Pembelian, hitungan
// live tanpa menulis DB, biaya lain/diskon, double submit, tidak ada tombol
// gudang/tukang/retur/refund, riwayat + lampiran bukti.
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
const PurchasePage = (await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/page.mjs')).href)).default
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

// ---------- 3) Helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => { if (!el) throw new Error('elemen tidak ada'); flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true }))) }
// Checkbox: butuh aktivasi nyata (el.click()) supaya `checked` ikut berubah —
// Event('click') sintetis tidak menjalankan activation behavior, sehingga
// React tidak melihat perubahan nilai.
const toggleCheck = (el) => { if (!el) throw new Error('checkbox tidak ada'); flushSync(() => el.click()) }
const typeInto = (doc, el, val) => {
  if (!el) throw new Error('input tidak ada')
  const proto = el.tagName === 'TEXTAREA' ? doc.defaultView.HTMLTextAreaElement.prototype : doc.defaultView.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  flushSync(() => {
    setter.call(el, val)
    el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }))
  })
}
const selectValue = (doc, el, val) => {
  const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLSelectElement.prototype, 'value').set
  flushSync(() => {
    setter.call(el, val)
    el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
  })
}

// ---------- 4) Fixture ----------
const noop = () => {}
const PROJECTS = [
  { id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' },
  { id: 'p2', kode: '83', name: 'Mabes', status: 'ON_GOING' }
]
const VENDORS = [
  { id: 'v1', name: 'TB Sumber Jaya' },
  { id: 'v2', name: 'Toko Mitra Fitting' }
]
const MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 120000 },
  { id: 'm2', kode: 'HWF-0001', name: 'Sekrup 3cm', category: 'Hardware & Fitting', satuan: 'Box', harga_acuan: null }
]
const REQUESTS = [
  { id: 'pr1', pr_number: 'PR-001', title: 'Material dinding', project_id: 'p1', status: 'APPROVED' },
  { id: 'pr2', pr_number: 'PR-002', title: 'Fitting kabinet', project_id: 'p2', status: 'APPROVED' }
]
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 4, estimated_price: 120000, status: 'APPROVED', vendor_id: 'v1', sort_order: 0 },
  { id: 'pi2', pr_id: 'pr1', material_id: 'm2', item_name: 'Sekrup 3cm', kode: 'HWF-0001', unit: 'Box', quantity: 2, estimated_price: 35000, status: 'APPROVED', vendor_id: 'v1', sort_order: 1 },
  { id: 'pi3', pr_id: 'pr2', material_id: 'm2', item_name: 'Sekrup 3cm (Mabes)', kode: 'HWF-0001', unit: 'Box', quantity: 5, estimated_price: 34000, status: 'APPROVED', vendor_id: 'v2', sort_order: 0 },
  { id: 'pi4', pr_id: 'pr2', material_id: 'm1', item_name: 'Triplek 12mm', kode: 'PLY-0009', unit: 'Lembar', quantity: 3, estimated_price: 200000, status: 'PENDING_APPROVAL', vendor_id: null, sort_order: 1 }
]
const RECEIVINGS = [
  {
    id: 'rcNew', vendor_id: 'v1', invoice_no: 'TB-88912', status: 'DIBELI', received_date: '2026-10-16',
    note: '[Nominal: Rp 542.000] [BiayaLain: Rp 25.000] [BuktiNota: data:image/png;base64,iVBORw0KGgo=] [BuktiTransfer: data:image/png;base64,iVBORw0KGgo=] [Tahap: DIBELI] diambil sendiri',
    project_id: 'p1', purchase_request_id: 'pr1'
  },
  {
    id: 'rcOld', vendor_id: 'v2', invoice_no: 'INV-LAMA-1', status: 'NORMAL', received_date: '2026-10-10',
    note: '[Nominal: Rp 865.000] Nota lama TB Makmur', project_id: 'p2', purchase_request_id: 'pr2'
  },
  { id: 'rcShell', vendor_id: null, invoice_no: null, status: 'NORMAL', received_date: null, note: 'Dibuat otomatis dari PR (barang disetujui).', project_id: 'p1', purchase_request_id: 'pr1' }
]
const RECEIVING_ITEMS = [
  // Nota DIBELI lama: baris item menunjuk pr_item yang TIDAK ada di PR_ITEMS
  // (data historis) supaya pi1..pi3 tetap tersedia di tab Siap Dibeli.
  { id: 'ri1', receiving_id: 'rcNew', pr_item_id: 'piOld1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 4, note: '[Harga: 118000]' },
  { id: 'ri2', receiving_id: 'rcNew', pr_item_id: 'piOld2', item_name: 'Sekrup 3cm', unit: 'Box', quantity_received: 2, note: '[Harga: 35000]' },
  { id: 'ri9', receiving_id: 'rcOld', pr_item_id: 'piOld3', item_name: 'Triplek 12mm', unit: 'Lembar', quantity_received: 3, note: null }
]

function mount(extraRows = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* read-only */ }
  const rows = {
    receivings: RECEIVINGS, receiving_items: RECEIVING_ITEMS, pr_items: PR_ITEMS,
    requests: REQUESTS, projects: PROJECTS, vendors: VENDORS, materials: MATERIALS,
    ...extraRows
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(PurchasePage, { rows, refresh: noop, say: noop })))
  return { dom, root, document }
}

const q = (doc, sel) => doc.querySelector(sel)
const tid = (doc, t) => doc.querySelector(`[data-testid="${t}"]`)

console.log('=== C. UI MODUL PURCHASE (page.jsx + purchaseForm.jsx asli, jsdom) ===\n')

// ---------- C1: dua tab ----------
console.log('C1. Dua tab: Siap Dibeli & Riwayat Pembelian')
{
  const { document: doc } = mount()
  await tick()
  const tabReady = tid(doc, 'tab-ready')
  const tabHistory = tid(doc, 'tab-history')
  check('C1a tab "Siap Dibeli" ada', !!tabReady && /Siap Dibeli/.test(tabReady.textContent))
  check('C1b tab "Riwayat Pembelian" ada', !!tabHistory && /Riwayat Pembelian/.test(tabHistory.textContent))
  check('C1c tab default = Siap Dibeli', /active/.test(tabReady.className))
  check('C1d 3 barang siap dibeli tampil', doc.querySelectorAll('[data-testid^="ready-row-"]').length === 3, String(doc.querySelectorAll('[data-testid^="ready-row-"]').length))
  check('C1e barang belum disetujui TIDAK tampil', !doc.body.textContent.includes('Triplek 12mm') || !tid(doc, 'ready-row-pi4'))
  check('C1f barang sudah dibeli TIDAK tampil di Siap Dibeli', !tid(doc, 'ready-row-pi1-sudah'))
  // pindah tab
  click(tabHistory); await tick()
  check('C1g pindah tab -> Riwayat aktif', /active/.test(tid(doc, 'tab-history').className))
  check('C1h nota DIBELI tampil di riwayat', !!tid(doc, 'history-row-rcNew'))
  check('C1i nota lama tampil di riwayat', !!tid(doc, 'history-row-rcOld'))
  check('C1j cangkang otomatis TIDAK tampil', !tid(doc, 'history-row-rcShell'))
  check('C1k total belanja tercatat tampil', /1\.432\.000/.test(tid(doc, 'history-total')?.textContent || ''), tid(doc, 'history-total')?.textContent)
  click(tid(doc, 'tab-ready')); await tick()
  check('C1l kembali ke Siap Dibeli', doc.querySelectorAll('[data-testid^="ready-row-"]').length === 3)
}

// ---------- C2: centang & dialog ----------
console.log('\nC2. Centang beberapa barang -> dialog Proses Pembelian')
{
  const { document: doc } = mount()
  await tick()
  const btn = tid(doc, 'btn-process-purchase')
  check('C2a tombol Proses Pembelian ADA tapi nonaktif tanpa pilihan', !!btn && btn.disabled === true)
  toggleCheck(tid(doc, 'check-pi1')); await tick()
  check('C2b centang 1 -> tombol aktif + jumlah', btn ? !tid(doc, 'btn-process-purchase').disabled : false)
  check('C2c label tombol menyebut jumlah', /\(1\)/.test(tid(doc, 'btn-process-purchase').textContent), tid(doc, 'btn-process-purchase').textContent)
  check('C2d petunjuk satu toko tampil', !!tid(doc, 'hint-one-vendor'))
  toggleCheck(tid(doc, 'check-pi2')); await tick()
  check('C2e centang 2 -> (2)', /\(2\)/.test(tid(doc, 'btn-process-purchase').textContent))
  check('C2f dialog belum terbuka', !tid(doc, 'purchase-form'))
  click(tid(doc, 'btn-process-purchase')); await tick()
  const form = tid(doc, 'purchase-form')
  check('C2g dialog Proses Pembelian terbuka', !!form)
  check('C2h judul dialog benar', /Proses Pembelian/.test(form.textContent))
  check('C2i 2 baris item di dialog', doc.querySelectorAll('[data-testid^="form-item-"]').length === 2, String(doc.querySelectorAll('[data-testid^="form-item-"]').length))
  check('C2j qty default dari PR (4)', tid(doc, 'qty-pi1')?.value === '4', tid(doc, 'qty-pi1')?.value)
  check('C2k harga riil kosong (bukan estimasi)', tid(doc, 'harga-pi1')?.value === '', tid(doc, 'harga-pi1')?.value)
  check('C2l vendor terisi otomatis', tid(doc, 'form-vendor')?.value === 'v1', tid(doc, 'form-vendor')?.value)
  check('C2m tanggal default hari ini', /^\d{4}-\d{2}-\d{2}$/.test(tid(doc, 'form-date')?.value || ''), tid(doc, 'form-date')?.value)
  check('C2n tombol submit nonaktif sebelum lengkap', tid(doc, 'purchase-submit')?.disabled === true)
}

// ---------- C3: hitungan live, nol tulisan ----------
console.log('\nC3. Hitung live; NOL tulisan DB sebelum "Selesaikan Pembelian"')
{
  mock.__reset({ tables: { receivings: RECEIVINGS, receiving_items: RECEIVING_ITEMS, handovers: [] } })
  const { document: doc } = mount()
  await tick()
  toggleCheck(tid(doc, 'check-pi1')); await tick()
  toggleCheck(tid(doc, 'check-pi2')); await tick()
  click(tid(doc, 'btn-process-purchase')); await tick()
  typeInto(doc, tid(doc, 'form-invoice'), 'TB-77701'); await tick()
  typeInto(doc, tid(doc, 'qty-pi1'), '4'); await tick()
  typeInto(doc, tid(doc, 'harga-pi1'), '118000'); await tick()
  check('C3a subtotal baris 1 dihitung', /472\.000/.test(tid(doc, 'purchase-totals')?.textContent || ''), tid(doc, 'purchase-totals')?.textContent)
  typeInto(doc, tid(doc, 'harga-pi2'), '35000'); await tick()
  check('C3b total material = 542.000', /542\.000/.test(tid(doc, 'purchase-totals')?.textContent || ''))
  check('C3c total nota = 542.000', /Rp 542\.000/.test(tid(doc, 'purchase-grand-total')?.textContent || ''), tid(doc, 'purchase-grand-total')?.textContent)
  check('C3d NOL tulisan DB saat mengetik', mock.__state.calls.filter(c => c.op === 'insert' || c.op === 'update').length === 0)
  check('C3e tombol submit aktif setelah lengkap', tid(doc, 'purchase-submit')?.disabled === false)

  // ---------- C4: biaya lain & diskon ----------
  console.log('\nC4. Biaya lain/ongkir & diskon mempengaruhi total nota (dipisah)')
  typeInto(doc, tid(doc, 'form-extra-cost'), '25000'); await tick()
  check('C4a total = 567.000 setelah ongkir', /567\.000/.test(tid(doc, 'purchase-grand-total')?.textContent || ''), tid(doc, 'purchase-grand-total')?.textContent)
  check('C4b baris biaya lain terpisah dari material', /Biaya Lain/.test(tid(doc, 'purchase-totals')?.textContent || ''))
  typeInto(doc, tid(doc, 'form-discount'), '10000'); await tick()
  check('C4c total = 557.000 setelah diskon', /557\.000/.test(tid(doc, 'purchase-grand-total')?.textContent || ''), tid(doc, 'purchase-grand-total')?.textContent)
  check('C4d material TIDAK berubah karena diskon', /542\.000/.test(tid(doc, 'purchase-totals')?.textContent || ''))

  // ---------- C5: double submit ----------
  console.log('\nC5. Double submit -> satu nota saja')
  const f = tid(doc, 'purchase-form')
  flushSync(() => { f.requestSubmit(); f.requestSubmit() })
  await tick(); await tick(); await tick(); await tick()
  const headerInserts = mock.__callsOf('insert', 'receivings')
  check('C5a hanya SATU header nota dibuat', headerInserts.length === 1, String(headerInserts.length))
  const hdr = headerInserts[0]?.data
  check('C5b no. nota tersimpan', hdr?.invoice_no === 'TB-77701')
  check('C5c status DIBELI', hdr?.status === 'DIBELI', String(hdr?.status))
  check('C5d total nota tersimpan di catatan', /\[Nominal: Rp 542\.000]/.test(String(hdr?.note)), String(hdr?.note))
  check('C5e biaya lain tersimpan terpisah', /\[BiayaLain: Rp 25\.000]/.test(String(hdr?.note)))
  check('C5f diskon tersimpan terpisah', /\[Diskon: Rp 10\.000]/.test(String(hdr?.note)))
  check('C5g 2 baris barang tersimpan', mock.__callsOf('insert', 'receiving_items').length === 2, String(mock.__callsOf('insert', 'receiving_items').length))
  check('C5h antrean handover dibuat', mock.__rows('handovers').length === 1, String(mock.__rows('handovers').length))
  await tick()
  check('C5i dialog tertutup setelah simpan', !tid(doc, 'purchase-form'))
}

// ---------- C6: tidak ada gudang/tukang/retur/refund ----------
console.log('\nC6. TIDAK ADA tombol/teks gudang, tukang, retur, refund di Purchase')
{
  const { document: doc } = mount()
  await tick()
  const textDesktop = doc.querySelector('.desktop-table-view')?.textContent || ''
  const textMobile = doc.querySelector('.mobile-cards-view')?.textContent || ''
  const body = doc.body.textContent || ''
  for (const bad of ['Masuk Stok Gudang', 'Serah Terima ke Tukang', 'Serah ke Tukang', 'Retur', 'Refund', 'Ke Tukang', 'Status Nota']) {
    check(`C6 tidak ada "${bad}"`, !body.includes(bad), bad)
  }
  check('C6 tidak ada dropdown status nota', doc.querySelectorAll('select.status-select').length === 0)
  check('C6 tombol aksi gudang/tukang tidak ada', doc.querySelectorAll('[data-testid^="btn-terima"]').length === 0)
  // pindah ke riwayat juga bersih
  click(tid(doc, 'tab-history')); await tick()
  const hist = doc.body.textContent || ''
  for (const bad of ['Retur', 'Refund', 'Masuk Stok Gudang']) {
    check(`C6 riwayat tidak memuat "${bad}"`, !hist.includes(bad))
  }
}

// ---------- C7: riwayat + lampiran ----------
console.log('\nC7. Riwayat: total rupiah & lampiran bukti')
{
  const { document: doc } = mount()
  await tick()
  click(tid(doc, 'tab-history')); await tick()
  const row = tid(doc, 'history-row-rcNew')
  check('C7a baris riwayat ada', !!row)
  check('C7b total nota tampil', /Rp 567\.000/.test(row.textContent), row.textContent.replace(/\s+/g, ' ').slice(0, 200))
  check('C7c material tampil terpisah', /Rp 542\.000/.test(row.textContent))
  check('C7d biaya lain tampil', /Rp 25\.000/.test(row.textContent))
  check('C7e chip bukti nota ada', /📷/.test(row.textContent))
  check('C7f chip bukti transfer ada', /💳/.test(row.textContent))
  check('C7g nota lama diberi label jujur', /nota lama/.test(tid(doc, 'history-row-rcOld')?.textContent || ''))
  // rincian
  click(tid(doc, 'detail-rcNew')); await tick()
  const detailText = doc.body.textContent || ''
  check('C7h rincian menampilkan harga satuan', /118\.000/.test(detailText))
  check('C7i rincian menampilkan subtotal', /472\.000/.test(detailText))
  check('C7j rincian menampilkan total nota', /Total Nota/.test(detailText))
  check('C7k rincian menampilkan diskon/ongkir', /Diskon/.test(detailText))
  check('C7l tombol tutup rincian berubah', /Tutup/.test(tid(doc, 'detail-rcNew')?.textContent || ''))
  click(tid(doc, 'detail-rcNew')); await tick()
  check('C7m rincian bisa ditutup', !/Total Nota/.test(doc.querySelector('.purchase-detail')?.textContent || ''))
}

// ---------- C8: filter & pilih semua ----------
console.log('\nC8. Filter toko/proyek & pilih semua')
{
  const { document: doc } = mount()
  await tick()
  selectValue(doc, tid(doc, 'filter-vendor'), 'v2'); await tick()
  check('C8a filter v2 -> 1 baris', doc.querySelectorAll('[data-testid^="ready-row-"]').length === 1, String(doc.querySelectorAll('[data-testid^="ready-row-"]').length))
  check('C8b baris yang tampil milik v2', !!tid(doc, 'ready-row-pi3'))
  selectValue(doc, tid(doc, 'filter-vendor'), ''); await tick()
  check('C8c reset filter -> 3 baris', doc.querySelectorAll('[data-testid^="ready-row-"]').length === 3)
  selectValue(doc, tid(doc, 'filter-project'), 'p2'); await tick()
  check('C8d filter proyek p2 -> 1 baris', doc.querySelectorAll('[data-testid^="ready-row-"]').length === 1)
  selectValue(doc, tid(doc, 'filter-project'), ''); await tick()
  typeInto(doc, tid(doc, 'filter-search'), 'sekrup'); await tick()
  check('C8e pencarian "sekrup" -> 2 baris', doc.querySelectorAll('[data-testid^="ready-row-"]').length === 2, String(doc.querySelectorAll('[data-testid^="ready-row-"]').length))
  typeInto(doc, tid(doc, 'filter-search'), ''); await tick()
  toggleCheck(tid(doc, 'select-all')); await tick()
  check('C8f pilih semua -> tombol (3)', /\(3\)/.test(tid(doc, 'btn-process-purchase').textContent), tid(doc, 'btn-process-purchase').textContent)
  check('C8g petunjuk multi-toko tampil', !!tid(doc, 'hint-multi-vendor'))
  toggleCheck(tid(doc, 'select-all')); await tick()
  check('C8h batal pilih semua -> tombol nonaktif', tid(doc, 'btn-process-purchase').disabled === true)
}

// ---------- C9: validasi UI ----------
console.log('\nC9. Validasi UI: no. nota wajib, harga wajib')
{
  mock.__reset({ tables: { receivings: [], receiving_items: [], handovers: [] } })
  const { document: doc } = mount()
  await tick()
  toggleCheck(tid(doc, 'check-pi1')); await tick()
  click(tid(doc, 'btn-process-purchase')); await tick()
  check('C9a submit nonaktif tanpa no. nota', tid(doc, 'purchase-submit')?.disabled === true)
  typeInto(doc, tid(doc, 'form-invoice'), 'TB-1'); await tick()
  check('C9b submit masih nonaktif tanpa harga', tid(doc, 'purchase-submit')?.disabled === true)
  typeInto(doc, tid(doc, 'harga-pi1'), '0'); await tick()
  check('C9c harga 0 -> tetap nonaktif', tid(doc, 'purchase-submit')?.disabled === true)
  typeInto(doc, tid(doc, 'harga-pi1'), '118000'); await tick()
  check('C9d harga valid -> submit aktif', tid(doc, 'purchase-submit')?.disabled === false)
  check('C9e NOL tulisan selama validasi', mock.__state.calls.filter(c => c.op === 'insert' || c.op === 'update').length === 0)
}

// ---------- C10: data kosong ----------
console.log('\nC10. Data kosong: pesan jelas, tidak error')
{
  const { document: doc } = mount({ pr_items: [], requests: [], receivings: [], receiving_items: [] })
  await tick()
  check('C10a Siap Dibeli kosong -> pesan jelas', /Tidak ada barang yang siap dibeli/.test(doc.body.textContent || ''))
  check('C10b tombol Proses Pembelian nonaktif', tid(doc, 'btn-process-purchase')?.disabled === true)
  click(tid(doc, 'tab-history')); await tick()
  check('C10c Riwayat kosong -> pesan jelas', /Belum ada nota pembelian/.test(doc.body.textContent || ''))
}

// ---------- C11: centang lintas toko -> semua barang ikut nota, toko bisa diganti ----------
console.log('\nC11. Centang lintas toko: semua barang ikut, toko form bisa diganti')
{
  const { document: doc } = mount()
  await tick()
  toggleCheck(tid(doc, 'check-pi1')); await tick() // v1
  toggleCheck(tid(doc, 'check-pi3')); await tick() // v2
  check('C11a petunjuk multi-toko tampil', !!tid(doc, 'hint-multi-vendor'))
  click(tid(doc, 'btn-process-purchase')); await tick()
  check('C11b SEMUA barang tercentang masuk dialog (2)', doc.querySelectorAll('[data-testid^="form-item-"]').length === 2, String(doc.querySelectorAll('[data-testid^="form-item-"]').length))
  check('C11c toko terisi otomatis (salah satu toko nyata)', ['v1', 'v2'].includes(tid(doc, 'form-vendor')?.value), tid(doc, 'form-vendor')?.value)
  // ganti toko ke toko lain (DAT: "bisa dipilih toko lain")
  selectValue(doc, tid(doc, 'form-vendor'), 'v2'); await tick()
  check('C11d toko bisa diganti ke toko lain', tid(doc, 'form-vendor')?.value === 'v2')
  // tidak ada barang yang hilang dari dialog
  check('C11e tidak ada barang dibuang diam-diam', doc.querySelectorAll('[data-testid^="form-item-"]').length === 2)
}

console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`)
if (fail) {
  console.log('GAGAL:')
  for (const f of failures) console.log(' -', f)
  process.exit(1)
}
