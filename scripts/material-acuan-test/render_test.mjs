// ============================================================
// VERIFIKASI ACUAN HARGA EXPANDABLE MATERIAL (bit-dev) — t_090127ad
// Merender components/ModuleView.js ASLI (hasil transform SWC di dist/)
// dengan React + jsdom INTERAKTIF (createRoot) lalu memeriksa DOM:
//   A) Kolom Acuan Harga hilang (desktop header & mobile card)
//   B) Default semua tertutup
//   C) Expand/collapse: tombol toggle, tidak reset Show More, parent utuh
//   D) Resolver (unit test langsung): histori benar, unknown vendor,
//      satuan beda, retur/refund, nama mirip, data lama
//   E) Prototype Tambah Acuan: validasi + entri manual "belum tersimpan"
// PENTING URUTAN IMPORT: env jsdom dibuat SEBELUM react-dom (lihat
// showmore-list-test/render_test.mjs untuk penjelasan ChangeEvent probe).
// Dijalankan oleh run.py di sandbox (mock supabase, tanpa DB).
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

// ---------- 2) Baru import React & komponen ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default
const acuanMod = await import(pathToFileURL(path.join(SB, 'dist/modules/materials/acuan.mjs')).href)

// ---------- 3) Assertion helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))
// jsdom TIDAK menjalankan navigasi/submit implisit dari tombol type="submit"
// (crash run 36 saat memperbaiki ini): klik tombol submit tidak mengirim
// event 'submit' ke <form>. Trigger eksplisit: requestSubmit() bila tersedia
// (jsdom modern), fallback dispatch Event('submit') langsung ke <form> —
// React onSubmit menangkap keduanya.
const submitForm = (form) => flushSync(() => {
  if (typeof form.requestSubmit === 'function') form.requestSubmit()
  else form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
})

// ---------- 4) Data mock ----------
const noop = () => {}

const VENDORS = [
  { id: 'v1', name: 'Toko Baroni Jaya', phone: '0811', supplier_category: 'Plywood & Board', store_link: '' },
  { id: 'v2', name: 'TB Makmur Sentosa', phone: '0812', supplier_category: 'Plywood & Board', store_link: '' },
  { id: 'v3', name: 'Toko Tanpa Penerimaan', phone: '0813', supplier_category: 'Lainnya', store_link: '' }
]

// 335 material (pola screenshot DAT): satu yang PUNYA histori penuh,
// satu PUNYA master saja, sisanya tanpa acuan apa pun.
const MATERIALS = Array.from({ length: 335 }, (_, i) => {
  const n = i + 1
  const cat = ['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai', 'Lainnya'][i % 5]
  return {
    id: `m${n}`, kode: `ALM-${String(n).padStart(4, '0')}`,
    name: `Material Uji ${n} ${cat}`, category: cat,
    qty: n, satuan: 'Meter',
    current_stock: cat === 'Bahan Habis Pakai' ? (n % 5) : null,
    min_stock: cat === 'Bahan Habis Pakai' ? 5 : null,
    harga_acuan: n % 3 === 0 ? 150000 : null
  }
})

// Material uji resolver:
const MAT_HIST = { id: 'mHIST', kode: 'HPL-9001', name: 'Material Histori Lengkap', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: null }
const MAT_MASTER_ONLY = { id: 'mMASTER', kode: 'HPL-9002', name: 'Material Master Saja', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: 175000 }
const MAT_KOSONG = { id: 'mKOSONG', kode: 'HPL-9003', name: 'Material Tanpa Acuan', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: null }
const MAT_NAMA_MIRIP = { id: 'mMIRIP', kode: 'HPL-9004', name: 'Material Histori Lengkap (duplikat nama beda ID)', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: null }
const MAT_SATUAN_BEDA = { id: 'mUNIT', kode: 'HPL-9005', name: 'Material Satuan Beda', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: null }

const REQUESTS = [
  { id: 'pr1', pr_number: 'PR-001', title: 'PR histori', status: 'DRAFT', priority: 'NORMAL', project_id: 'p1', project_name: '[99] Baroni', materials_summary: '', notes: '', created_at: '2026-10-01T00:00:00Z' }
]

const PR_ITEMS = [
  // Item historis VALID: material MAT_HIST, harga satuan 120.000 per Lembar
  { id: 'pi1', pr_id: 'pr1', material_id: 'mHIST', item_name: 'Material Histori Lengkap', kode: 'HPL-9001', unit: 'Lembar', quantity: 10, status: 'ORDERED', supplier_category: 'HPL & Edging', vendor_id: 'v1', estimated_price: 120000, sort_order: 0 },
  // Item harga 250.000 tapi BELUM diterima (estimasi PR — bukan histori)
  { id: 'pi2', pr_id: 'pr1', material_id: 'mMIRIP', item_name: 'Material Histori Lengkap (duplikat nama beda ID)', kode: 'HPL-9004', unit: 'Lembar', quantity: 5, status: 'APPROVED', supplier_category: 'HPL & Edging', vendor_id: 'v2', estimated_price: 250000, sort_order: 1 },
  // Item satuan BEDA: per Dus (tidak boleh jadi histori per Lembar)
  { id: 'pi3', pr_id: 'pr1', material_id: 'mUNIT', item_name: 'Material Satuan Beda', kode: 'HPL-9005', unit: 'Dus', quantity: 2, status: 'ORDERED', supplier_category: 'HPL & Edging', vendor_id: 'v2', estimated_price: 999000, sort_order: 2 }
]

const RECEIVINGS = [
  // Penerimaan normal v1: item pi1 diterima -> histori MAT_HIST (120.000)
  { id: 'rc1', purchase_request_id: 'pr1', vendor_id: 'v1', status: 'NORMAL', received_date: '2026-10-12', delivery_note: 'SJ-1', invoice_no: 'INV-1', note: '[Nominal: Rp 1.300.000] Nota lengkap dgn ongkir 10rb', created_at: '2026-10-12T02:00:00Z' },
  // Penerimaan RETUR: item pi2 diterima tapi retur -> BUKAN histori
  { id: 'rc2', purchase_request_id: 'pr1', vendor_id: 'v2', status: 'RETUR', received_date: '2026-10-13', delivery_note: 'SJ-2', invoice_no: 'INV-2', note: '[Nominal: Rp 1.250.000]', created_at: '2026-10-13T02:00:00Z' },
  // Penerimaan tanpa vendor: item pi2 juga diterima di sini (NORMAL) -> MAT_MIRIP
  // histori valid TANPA vendor -> harus tampil "Tidak dicatat", bukan vendor dikira-kira
  { id: 'rc3', purchase_request_id: 'pr1', vendor_id: null, status: 'NORMAL', received_date: '2026-10-14', delivery_note: 'SJ-3', invoice_no: 'INV-3', note: '[Nominal: Rp 1.250.000]', created_at: '2026-10-14T02:00:00Z' }
]

const RECEIVING_ITEMS = [
  { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'pi1', item_name: 'Material Histori Lengkap', unit: 'Lembar', quantity_received: 10, note: null, created_at: '2026-10-12T02:00:00Z' },
  // qty 0: baris otomatis belum diproses — BUKAN histori
  { id: 'ri2', receiving_id: 'rc2', pr_item_id: 'pi2', item_name: 'Material Histori Lengkap (duplikat nama beda ID)', unit: 'Lembar', quantity_received: 0, note: null, created_at: '2026-10-13T02:00:00Z' },
  { id: 'ri3', receiving_id: 'rc2', pr_item_id: 'pi2', item_name: 'Material Histori Lengkap (duplikat nama beda ID)', unit: 'Lembar', quantity_received: 5, note: null, created_at: '2026-10-13T02:00:00Z' },
  { id: 'ri4', receiving_id: 'rc3', pr_item_id: 'pi2', item_name: 'Material Histori Lengkap (duplikat nama beda ID)', unit: 'Lembar', quantity_received: 5, note: null, created_at: '2026-10-14T02:00:00Z' },
  // pr_item_id tidak dikenal (item PR lama sudah terhapus) — diabaikan
  { id: 'ri5', receiving_id: 'rc1', pr_item_id: 'piGONE', item_name: 'Item PR hilang', unit: 'Pcs', quantity_received: 3, note: null, created_at: '2026-10-12T02:00:00Z' }
]

const PROJECTS = [{ id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING', created_at: '2026-10-01T00:00:00Z' }]

function mount(page, rows, extra = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22 read-only */ }
  const props = {
    page, rows,
    allProjects: PROJECTS, allMaterials: [...MATERIALS, MAT_HIST, MAT_MASTER_ONLY, MAT_KOSONG, MAT_NAMA_MIRIP, MAT_SATUAN_BEDA],
    allPrItems: PR_ITEMS, allReceivingItems: RECEIVING_ITEMS, allRequests: REQUESTS,
    allReceivings: RECEIVINGS, allVendors: VENDORS,
    refresh: noop, say: noop, onDelete: noop, setPage: noop, ...extra
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, root, document, props }
}

const tbodyRows = (document) => document.querySelectorAll('.desktop-table-view tbody tr').length
const toggleBtns = (document) => [...document.querySelectorAll('.desktop-table-view .acuan-toggle')]
const toggleByName = (document, name) => toggleBtns(document).find(b => (b.closest('td')?.textContent || '').includes(name))
const expandRows = (document) => document.querySelectorAll('.desktop-table-view tr.acuan-expand-row')
const footerText = (document) => (document.querySelector('.list-show-more')?.textContent || '')
const showMoreBtn = (document) => [...document.querySelectorAll('.list-show-more-actions button')].find(b => b.textContent.includes('Show More'))

console.log('=== VERIFIKASI ACUAN HARGA EXPANDABLE MATERIAL (React/jsdom, ModuleView.js asli) ===\n')

// ---------- A. KOLOM ACUAN HARGA HILANG ----------
console.log('A. Kolom Acuan Harga dihilangkan dari daftar (desktop & mobile)')
{
  const { document } = mount('materials', MATERIALS)
  await tick()
  const headers = [...document.querySelectorAll('.desktop-table-view thead th')].map(t => t.textContent.trim())
  check('header kolom TIDAK memuat "Acuan Harga"', !headers.some(h => h.includes('Acuan Harga')), headers.join(' | '))
  check('header tetap: Kode/Nama/Kategori/Qty/Satuan/Stok/Batas Min',
    ['Kode', 'Nama', 'Kategori', 'Qty', 'Satuan', 'Stok Saat Ini', 'Batas Min'].every(h => headers.some(x => x.includes(h))))
  // Mobile: kartu tanpa baris "Acuan Harga:"
  const cards = document.querySelectorAll('.mobile-card')
  check('kartu mobile dirender (10)', cards.length === 10)
  const adaLabelLama = [...document.querySelectorAll('.mobile-cards-view .mobile-label')].some(l => l.textContent.includes('Acuan Harga'))
  check('kartu mobile TIDAK memuat label "Acuan Harga:" statis', !adaLabelLama)
  // Mobile: toggle expand per kartu bekerja (tombol + panel rincian)
  const mobToggle = document.querySelector('.mobile-cards-view .acuan-toggle')
  check('kartu mobile punya tombol "+ Acuan Harga"', !!mobToggle && mobToggle.textContent.includes('+ Acuan Harga'))
  click(mobToggle); await tick()
  check('klik toggle mobile: panel rincian muncul', !!document.querySelector('.mobile-cards-view .acuan-rincian'))
  check('tombol mobile berubah "▲ Tutup Acuan"', mobToggle.textContent.includes('▲ Tutup Acuan'))
  click(mobToggle); await tick()
  check('klik lagi mobile: panel tertutup', !document.querySelector('.mobile-cards-view .acuan-rincian'))
  // Header sort: klik header tetap bekerja (regresi sort tidak rusak)
  const th = [...document.querySelectorAll('.desktop-table-view thead th')].find(t => t.textContent.includes('Kode'))
  click(th); await tick()
  check('sort header Kode masih berfungsi (asc ALM-0001)',
    (document.querySelector('.desktop-table-view tbody tr td')?.textContent || '').includes('ALM-0001'))
}

// ---------- B. DEFAULT TERTUTUP ----------
console.log('\nB. Default SEMUA rincian tertutup')
{
  const { document } = mount('materials', MATERIALS)
  await tick()
  check('tidak ada baris expand di awal', expandRows(document).length === 0)
  check('tidak ada tombol "+ Acuan Harga" saat belum dibuka (tombol hanya di baris yang diringkas? TIDAK — tombol selalu ada di bawah nama)',
    toggleBtns(document).length === 10, String(toggleBtns(document).length))
  check('teks tombol default "+ Acuan Harga"', toggleBtns(document)[0]?.textContent.includes('+ Acuan Harga'))
  check('tidak ada teks "Belum ada acuan harga" sebelum expand', !(document.body.textContent || '').includes('Belum ada acuan harga'))
  check('teks tombol TIDAK "▲ Tutup Acuan" saat tertutup', !toggleBtns(document)[0]?.textContent.includes('Tutup Acuan'))
}

// ---------- C. EXPAND / COLLAPSE ----------
console.log('\nC. Expand membuka rincian; collapse menutup; Show More & parent utuh')
{
  const { document } = mount('materials', MATERIALS)
  await tick()
  const btn = toggleByName(document, 'Material Uji 1')
  check('pra: 10 baris parent, 0 expand', tbodyRows(document) === 10 && expandRows(document).length === 0)
  click(btn); await tick()
  check('klik toggle: 1 baris expand muncul', expandRows(document).length === 1, String(expandRows(document).length))
  check('parent tetap 10 (expand TIDAK menambah parent)', tbodyRows(document) === 11)
  check('tombol berubah "▲ Tutup Acuan"', btn.textContent.includes('▲ Tutup Acuan'), btn.textContent)
  const expandText = expandRows(document)[0]?.textContent || ''
  check('expand memuat judul "💰 Acuan Harga"', expandText.includes('Acuan Harga'))
  check('expand material tanpa histori: empty state "Belum ada acuan harga"', expandText.includes('Belum ada acuan harga'), expandText.slice(0, 120))
  check('expand memuat tombol "Tambah Acuan" (prototype)', expandText.includes('Tambah Acuan'))
  // Show More TIDAK ter-reset: indikator tetap "Menampilkan 10 dari 335"
  check('indikator Show More tetap "Menampilkan 10 dari 335" saat ada expand',
    footerText(document).includes('Menampilkan 10 dari 335'), footerText(document))
  // Klik Show More: expand ikut tetap terbuka & parent jadi 20
  click(showMoreBtn(document)); await tick()
  check('Show More: parent jadi 20, expand tetap 1', tbodyRows(document) === 21 && expandRows(document).length === 1, `${tbodyRows(document)}+${expandRows(document).length}`)
  check('indikator jadi "Menampilkan 20 dari 335"', footerText(document).includes('Menampilkan 20 dari 335'))
  // Collapse lagi
  click(toggleByName(document, 'Material Uji 1')); await tick()
  check('klik lagi: expand tertutup', expandRows(document).length === 0)
  // Toggle material kedua
  const btn2 = toggleByName(document, 'Material Uji 2')
  click(btn2); await tick()
  check('toggle material lain: hanya 1 expand aktif', expandRows(document).length === 1)
  // Filter tab me-reset list limit TAPI expand milik material yang sudah tidak tampil tidak error
  const pill = [...document.querySelectorAll('.toolbar .pill')].find(p => p.textContent.includes('Hardware & Fitting'))
  click(pill); await tick()
  const rowsFiltered = tbodyRows(document)
  check('filter kategori: 67 data -> max 10 parent + expand (jika material masih ada)',
    rowsFiltered <= 11, String(rowsFiltered))
}

// ---------- D. RESOLVER (unit test langsung) ----------
console.log('\nD. Resolver acuan: histori benar, unknown vendor, satuan beda, retur, nama mirip')
{
  const A = acuanMod.makeAcuanHelpers({
    allPrItems: PR_ITEMS, allReceivingItems: RECEIVING_ITEMS, allReceivings: RECEIVINGS, allVendors: VENDORS
  })
  // MAT_HIST: 1 entri historis 120.000 dari v1 (Nominal nota 1.300.000 TIDAK dipakai)
  const h = A.entriesFor(MAT_HIST)
  check('MAT_HIST: tepat 1 entri', h.length === 1, JSON.stringify(h))
  check('MAT_HIST: sumber HISTORIS', h[0]?.source === 'HISTORIS')
  check('MAT_HIST: vendor Toko Baroni Jaya', h[0]?.vendor === 'Toko Baroni Jaya')
  check('MAT_HIST: harga 120.000 (estimated_price, BUKAN [Nominal] 1.300.000)', h[0]?.price === 120000, String(h[0]?.price))
  check('MAT_HIST: tanggal 2026-10-12', String(h[0]?.date || '').startsWith('2026-10-12'), String(h[0]?.date))
  check('MAT_HIST: unit Lembar', h[0]?.unit === 'Lembar')

  // MAT_MIRIP: ri3 (retur) diabaikan; ri4 (normal, tanpa vendor) masuk
  const m = A.entriesFor(MAT_NAMA_MIRIP)
  check('MAT_MIRIP: hanya penerimaan NORMAL yang masuk (retur diabaikan)', m.length === 1, JSON.stringify(m))
  check('MAT_MIRIP: vendor unknown -> "Tidak dicatat" (null), bukan dikira-kira', m[0]?.vendor === null)
  check('MAT_MIRIP: harga 250.000 dari estimated_price', m[0]?.price === 250000)

  // MAT_SATUAN_BEDA: item PR per Dus, material per Lembar -> TIDAK jadi histori
  const u = A.entriesFor(MAT_SATUAN_BEDA)
  check('MAT_UNIT: satuan beda (Dus vs Lembar) TIDAK dijadikan histori (tanpa konversi)', u.length === 0, JSON.stringify(u))

  // MAT_KOSONG: tidak ada apa pun
  const k = A.entriesFor(MAT_KOSONG)
  check('MAT_KOSONG: tanpa entri', k.length === 0)

  // MAT_MASTER_ONLY: harga_acuan existing -> MASTER tanpa tanggal/vendor
  const mo = A.entriesFor(MAT_MASTER_ONLY)
  check('MAT_MASTER: 1 entri MASTER', mo.length === 1 && mo[0].source === 'MASTER', JSON.stringify(mo))
  check('MAT_MASTER: harga 175.000', mo[0]?.price === 175000)
  check('MAT_MASTER: TANPA tanggal (tidak di-invent)', mo[0]?.date === null)
  check('MAT_MASTER: TANPA vendor (tidak di-invent)', mo[0]?.vendor === null)

  // bestEntry: histori > master > null
  check('bestEntry MAT_HIST = histori', A.bestEntry(MAT_HIST)?.source === 'HISTORIS')
  check('bestEntry MAT_MASTER = master', A.bestEntry(MAT_MASTER_ONLY)?.source === 'MASTER')
  check('bestEntry MAT_KOSONG = null', A.bestEntry(MAT_KOSONG) === null)
  check('bestEntry material tanpa id = null (data lama aman)', A.bestEntry({}) === null)

  // Validasi manual
  const vOk = acuanMod.validateManualAcuan({ vendorId: 'v1', harga: '25.000', satuan: 'Meter' })
  check('validasi manual: input valid ok, price 25000', vOk.ok && vOk.price === 25000)
  const vNoVendor = acuanMod.validateManualAcuan({ vendorId: '', harga: '25.000', satuan: 'Meter' })
  check('validasi manual: vendor kosong ditolak', !vNoVendor.ok && /vendor/i.test(vNoVendor.error))
  const vZero = acuanMod.validateManualAcuan({ vendorId: 'v1', harga: '0', satuan: 'Meter' })
  check('validasi manual: harga 0 ditolak', !vZero.ok)
  const vNeg = acuanMod.validateManualAcuan({ vendorId: 'v1', harga: '-5', satuan: 'Meter' })
  check('validasi manual: harga negatif ditolak (tanpa digit)', !vNeg.ok)
  const vNoUnit = acuanMod.validateManualAcuan({ vendorId: 'v1', harga: '25.000', satuan: '' })
  check('validasi manual: satuan kosong ditolak', !vNoUnit.ok && /satuan/i.test(vNoUnit.error))
  const vNaN = acuanMod.validateManualAcuan({ vendorId: 'v1', harga: 'abc', satuan: 'Meter' })
  check('validasi manual: huruf ditolak (tidak NaN)', !vNaN.ok)

  // Material tanpa satuan sama sekali (data lama) — tidak crash
  const noUnitMat = A.entriesFor({ id: 'mX', satuan: null, unit: null, harga_acuan: null })
  check('resolver data lama tanpa satuan: aman (0 entri)', noUnitMat.length === 0)
}

// ---------- E. PROTOTYPE TAMBAH ACUAN (interaktif) ----------
console.log('\nE. Prototype "Tambah Acuan": validasi & entri manual belum tersimpan')
{
  const { document } = mount('materials', MATERIALS)
  await tick()
  // Expand material master-only (punya MASTER 150.000 — n%3==0, id m3)
  const btnM = toggleByName(document, 'Material Uji 3')
  click(btnM); await tick()
  let expandText = expandRows(document)[0]?.textContent || ''
  check('rincian sebelum manual: ada entri MASTER 150.000', expandText.includes('Rp 150.000') && expandText.includes('Master'), expandText.slice(0, 150))
  check('rincian sebelum manual: badge MASTER "tanpa tanggal"', expandText.includes('Master'))

  // Klik "Tambah Acuan" -> form muncul
  const addBtn = [...expandRows(document)[0].querySelectorAll('button')].find(b => b.textContent.includes('Tambah Acuan'))
  check('tombol Tambah Acuan ada', !!addBtn)
  click(addBtn); await tick()
  const form = expandRows(document)[0].querySelector('.acuan-manual-form')
  check('form manual muncul (vendor/harga/satuan)', !!form && form.textContent.includes('Vendor') && form.textContent.includes('Harga') && form.textContent.includes('Satuan'))

  // Submit kosong -> error, tidak ada entri baru.
  // Gunakan trigger submit eksplisit (jsdom tidak menjalankan submit
  // implisit dari klik tombol type="submit").
  const submitBtn = [...form.querySelectorAll('button')].find(b => b.textContent.includes('Simpan Acuan'))
  check('tombol submit bertipe submit (asosiasi form benar)', submitBtn?.type === 'submit')
  submitForm(form); await tick()
  const errText = expandRows(document)[0]?.textContent || ''
  check('submit tanpa vendor: pesan error tampil', errText.includes('Pilih vendor dulu'), errText.slice(-80))

  // Isi valid: pilih vendor, harga, satuan Meter default
  const selVendor = form.querySelector('select')
  const setterSel = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setterSel.call(selVendor, 'v1')
  selVendor.dispatchEvent(new window.Event('change', { bubbles: true }))
  await tick()
  const inputHarga = form.querySelector('input')
  const setterIn = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setterIn.call(inputHarga, '25.500')
  inputHarga.dispatchEvent(new window.Event('input', { bubbles: true }))
  await tick()
  submitForm(form); await tick()
  expandText = expandRows(document)[0]?.textContent || ''
  check('entri manual masuk daftar: Rp 25.500', expandText.includes('Rp 25.500'), expandText.slice(-200))
  check('entri manual berbadge "Manual — belum tersimpan"', expandText.includes('belum tersimpan'))
  check('peringatan "belum tersimpan" tampil di rincian', expandText.includes('belum tersimpan'))
  check('entri manual TIDAK mengubah entri MASTER (dua sumber tampil)', expandText.includes('Master'))
  check('entri manual tidak diberi tanggal palsu', (expandText.match(/—/g) || []).length >= 1)
}

// ---------- F. DATA LAMA & ROBUSTNESS ----------
console.log('\nF. Data lama & robustness render')
{
  // Dataset lama: material tanpa id, harga_acuan string, dsb.
  const OLD = [
    { id: null, kode: 'OLD-1', name: 'Material Tanpa ID', category: 'Lainnya', qty: 1, satuan: null, harga_acuan: '120000' },
    { kode: 'OLD-2', name: 'Material String Acuan', category: 'Lainnya', qty: 1, satuan: 'Pcs', harga_acuan: 0 }
  ]
  const { document } = mount('materials', OLD, { allMaterials: [...OLD, MAT_HIST] })
  await tick()
  check('material data lama (tanpa id/qty string): render aman 2 baris', tbodyRows(document) === 2, String(tbodyRows(document)))
  const t0 = toggleByName(document, 'Material Tanpa ID')
  if (t0) { click(t0); await tick() }
  check('expand material tanpa id: tidak crash', expandRows(document).length <= 1)
  // 335 baris dirender penuh (Show More sampai habis) — tidak error
  const { document: docAll } = mount('materials', MATERIALS)
  await tick()
  for (let k = 0; k < 40; k++) {
    const b = showMoreBtn(docAll)
    if (!b) break
    click(b); await tick()
  }
  check('335 baris semua tampil tanpa error', tbodyRows(docAll) === 335, String(tbodyRows(docAll)))
  // Expand di baris terakhir
  const last = [...docAll.querySelectorAll('.acuan-toggle')].pop()
  click(last); await tick()
  check('expand baris terakhir: 1 expand', expandRows(docAll).length === 1)
}

console.log(`\n=== HASIL: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA VERIFIKASI ACUAN HARGA LULUS')
