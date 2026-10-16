// ============================================================
// RENDER TEST — ModuleView.js + receiptForm.jsx ASLI (dist hasil SWC) di
// jsdom INTERAKTIF: klik nyata, ketik nyata, submit nyata.
// Bagian C: UI satu tombol "Terima Barang", legacy hilang, nol mutation saat
// mengetik, anti double-submit, validasi UI, gap skema diblok, ringkasan
// daftar, dan alur old-data (Muat item dari PR).
// Dijalankan oleh run.py di sandbox (mock supabase perekam, tanpa DB).
// PENTING URUTAN: env jsdom dibuat SEBELUM react-dom diimpor (probe event).
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
// PENTING: mock harus dari dist/ — komponen terkompilasi mengimpor dist/lib/…
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

// ---------- 3) Helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))
const typeInto = (doc, el, val) => {
  const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set
  flushSync(() => {
    setter.call(el, val)
    el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }))
  })
}

// ---------- 4) Fixture data ----------
const noop = () => {}
const PROJECTS = [{ id: 'p1', kode: '99', code: '99', name: 'Baroni', status: 'ON_GOING', created_at: '2026-10-01T00:00:00Z' }]
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', item_name: 'Thiner', quantity: 10, unit: 'Liter', status: 'ORDERED', material_id: 'm1', vendor_id: null, estimated_price: 20000 },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Sealant (Clear)', quantity: 1, unit: 'Botol', status: 'ORDERED', material_id: null, vendor_id: null, estimated_price: 35000 }
]
const RECEIVINGS = [
  // rc1: nota normal dengan 2 item, satu sudah parsial (2/4)
  { id: 'rc1', purchase_request_id: 'pr1', project_id: 'p1', project_name: '[99] Baroni', status: 'NORMAL', received_date: null, delivery_note: 'SJ-1', invoice_no: 'INV-1', note: '', alokasi: null, masuk_gudang: false, tukang_at: null },
  // rc2: nota LAMA tanpa item rows + alokasi asing LANGSUNG_LAPANGAN (old data contract)
  { id: 'rc2', purchase_request_id: 'pr1', project_id: 'p1', project_name: '[99] Baroni', status: 'NORMAL', received_date: '2026-10-14', delivery_note: 'SJ-2', invoice_no: 'INV-2', note: '[Nominal: Rp 865.000] Nota lama', alokasi: 'LANGSUNG_LAPANGAN', masuk_gudang: false, tukang_at: null },
  // rc3: nota tanpa PR & tanpa item (paling ekstrem)
  { id: 'rc3', purchase_request_id: null, project_id: null, project_name: 'Tanpa Project', status: 'NORMAL', received_date: '2026-10-15', delivery_note: null, invoice_no: null, note: '', alokasi: null, masuk_gudang: false, tukang_at: null }
]
const RECEIVING_ITEMS = [
  { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'pi1', item_name: 'Thiner', unit: 'Liter', quantity_received: 0 },
  { id: 'ri2', receiving_id: 'rc1', pr_item_id: 'pi2', item_name: 'Sealant (Clear)', unit: 'Botol', quantity_received: 0 }
]

function mount(rows, allReceivingItems, extra = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22 read-only */ }
  const props = {
    page: 'receivings',
    rows,
    allProjects: PROJECTS, allMaterials: [], allPrItems: PR_ITEMS,
    allReceivingItems, allRequests: [], allReceivings: rows, allVendors: [],
    refresh: noop, say: noop, onDelete: noop, setPage: noop, ...extra
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, root, document }
}

const btnTerima = (doc, id) => doc.querySelector(`[data-testid="btn-terima-${id}"]`)
const btnTerimaMobile = (doc, id) => doc.querySelector(`[data-testid="btn-terima-mobile-${id}"]`)
const form = (doc) => doc.querySelector('[data-testid="receipt-form"]')
const submitBtn = (doc) => doc.querySelector('[data-testid="receipt-submit"]')
const errText = (doc) => (doc.querySelector('[data-testid="receipt-error"]')?.textContent || '')

console.log('=== C. UI TERIMA BARANG (ModuleView + receiptForm asli, jsdom interaktif) ===\n')

// ---------- C1: satu tombol + modal terbuka ----------
console.log('C1. Satu tombol "Terima Barang" (desktop+mobile) membuka form per item')
{
  const { document: doc } = mount(RECEIVINGS, RECEIVING_ITEMS)
  await tick()
  check('C1a tombol desktop "Terima Barang" ada utk nota belum lengkap', !!btnTerima(doc, 'rc1') && /Terima Barang/.test(btnTerima(doc, 'rc1').textContent))
  check('C1b tombol mobile ada', !!btnTerimaMobile(doc, 'rc1'))
  check('C1c modal TERTUTUP awalnya', !form(doc))
  click(btnTerima(doc, 'rc1'))
  await tick()
  check('C1d klik -> modal form terbuka', !!form(doc))
  check('C1e judul "Terima Barang — INV-1"', /Terima Barang — INV-1/.test(form(doc).textContent))
  check('C1f 2 baris item tampil', doc.querySelectorAll('[data-testid^="receipt-item-"]').length === 2)
  check('C1g tiap item menampilkan Dipesan', (form(doc).textContent.match(/Dipesan:/g) || []).length === 2)
  check('C1h input datang/rusak/ws/tukang ada', !!doc.querySelector('[data-testid="datang-ri1"]') && !!doc.querySelector('[data-testid="rusak-ri1"]') && !!doc.querySelector('[data-testid="ws-ri1"]') && !!doc.querySelector('[data-testid="tukang-ri1"]'))
  check('C1i rusak default 0', doc.querySelector('[data-testid="rusak-ri1"]').value === '0')
  check('C1j ringkasan akhir tampil', !!doc.querySelector('[data-testid="receipt-summary"]'))
}

// ---------- C2: legacy hilang ----------
console.log('\nC2. Panel legacy Langkah 1 / Lihat X item HILANG (desktop+mobile)')
{
  const { document: doc } = mount(RECEIVINGS, RECEIVING_ITEMS)
  await tick()
  const text = doc.body.textContent || ''
  check('C2a tidak ada teks "Langkah 1"', !text.includes('Langkah 1'))
  check('C2b tidak ada "Cek Fisik"', !/Cek Fisik/.test(text))
  check('C2c tidak ada toggle "Lihat X item"', !/Lihat\s+\d+\s+item/.test(text) && !/Tutup item/.test(text))
  check('C2d tidak ada tombol lama "Update Terima"', !/Update Terima/.test(text))
  check('C2e tidak ada tombol lama "Cek Fisik" utk receiving', !/Cek Fisik/.test(doc.querySelector('.desktop-table-view')?.textContent || ''))
  // mobile juga
  check('C2f mobile: tidak ada "Cek Fisik" di kartu', !/Cek Fisik/.test(doc.querySelector('.mobile-cards-view')?.textContent || ''))
}

// ---------- C3: nol mutation saat mengetik ----------
console.log('\nC3. Input TIDAK menulis DB saat mengetik — hanya submit tunggal')
{
  mock.__reset({ rows: [
    { id: 'ri1', receiving_id: 'rc1', quantity_received: 0 },
    { id: 'ri2', receiving_id: 'rc1', quantity_received: 0 }
  ] })
  const { document: doc } = mount(RECEIVINGS, RECEIVING_ITEMS)
  await tick()
  click(btnTerima(doc, 'rc1'))
  await tick()
  // ketik beberapa kali
  typeInto(doc, doc.querySelector('[data-testid="datang-ri1"]'), '1')
  await tick()
  typeInto(doc, doc.querySelector('[data-testid="datang-ri1"]'), '12')
  await tick()
  check('C3a NOL operasi update/insert saat mengetik', mock.__callsOf('update').length === 0 && mock.__callsOf('insert').length === 0)
  check('C3b angka DB masih 0', mock.__state.rows.get('ri1').quantity_received === 0)
  check('C3c baik/belum dihitung live dari input (12-0=12 baik, belum 0)', doc.querySelector('[data-testid="baik-ri1"]').textContent === '12' && doc.querySelector('[data-testid="belum-ri1"]').textContent === '0')
  check('C3d tombol submit disabled utk over-receipt', submitBtn(doc).disabled === true)
  check('C3e pesan error over-receipt tampil', /Melebihi sisa pesanan/.test(form(doc).textContent))
  // koreksi jadi 1 -> valid
  typeInto(doc, doc.querySelector('[data-testid="datang-ri1"]'), '1')
  await tick()
  check('C3f tombol submit aktif setelah koreksi', submitBtn(doc).disabled === false)
  check('C3g masih NOL tulisan sebelum submit', mock.__callsOf('update').length === 0)
}

// ---------- C4: double submit ----------
console.log('\nC4. Double submit (requestSubmit 2x) -> satu tulisan')
{
  mock.__reset({ rows: [{ id: 'ri1', receiving_id: 'rc1', quantity_received: 0 }] })
  const { document: doc } = mount([RECEIVINGS[0]], RECEIVING_ITEMS.slice(0, 1))
  await tick()
  click(btnTerima(doc, 'rc1'))
  await tick()
  typeInto(doc, doc.querySelector('[data-testid="datang-ri1"]'), '1')
  await tick()
  const f = form(doc)
  flushSync(() => { f.requestSubmit(); f.requestSubmit() })
  await tick(); await tick(); await tick()
  const updates = mock.__callsOf('update', 'receiving_items')
  check('C4a hanya SATU update receiving_items', updates.length === 1, `got ${updates.length}`)
  check('C4b DB = 1 (bukan 2)', mock.__state.rows.get('ri1').quantity_received === 1)
}

// ---------- C5: validasi UI ----------
console.log('\nC5. Validasi UI: rusak>datang, tujuan>baik, tukang tanpa penerima')
{
  mock.__reset({ rows: [{ id: 'ri1', receiving_id: 'rc1', quantity_received: 0 }] })
  const { document: doc } = mount([RECEIVINGS[0]], RECEIVING_ITEMS.slice(0, 1))
  await tick()
  click(btnTerima(doc, 'rc1'))
  await tick()
  const setV = (tid, v) => typeInto(doc, doc.querySelector(`[data-testid="${tid}"]`), v)
  setV('datang-ri1', '3'); await tick()
  setV('rusak-ri1', '5'); await tick()
  check('C5a rusak>datang: submit disabled', submitBtn(doc).disabled === true)
  check('C5b pesan rusak tampil', /rusak tidak boleh lebih dari/i.test(form(doc).textContent))
  setV('rusak-ri1', '1'); await tick()
  setV('ws-ri1', '1'); setV('tukang-ri1', '1'); await tick()
  check('C5c tujuan 2 = baik 2 (pas): tidak ada error tujuan, hanya penerima wajib', !/melebihi jumlah baik/i.test(form(doc).textContent) && submitBtn(doc).disabled === true)
  setV('ws-ri1', '2'); await tick()
  check('C5d tujuan 3 > baik 2: submit disabled + pesan', submitBtn(doc).disabled === true && /melebihi jumlah baik/i.test(form(doc).textContent))
  setV('ws-ri1', '0'); setV('tukang-ri1', '2'); await tick()
  check('C5e tukang>0 tanpa penerima: submit disabled', submitBtn(doc).disabled === true)
  check('C5f field penerima muncul', !!doc.querySelector('[data-testid="penerima-ri1"]'))
  typeInto(doc, doc.querySelector('[data-testid="penerima-ri1"]'), 'Pak Joko'); await tick()
  check('C5g penerima diisi -> valid', submitBtn(doc).disabled === false, form(doc).textContent.slice(0, 220))
  check('C5h NOL tulisan sepanjang validasi', mock.__callsOf('update').length === 0)
}

// ---------- C6: gap skema diblok ----------
console.log('\nC6. Dimensi rusak/tujuan -> submit diblok + nol tulisan (bukan packing ke note)')
{
  mock.__reset({ rows: [{ id: 'ri1', receiving_id: 'rc1', quantity_received: 0 }] })
  const { document: doc } = mount([RECEIVINGS[0]], RECEIVING_ITEMS.slice(0, 1))
  await tick()
  click(btnTerima(doc, 'rc1'))
  await tick()
  typeInto(doc, doc.querySelector('[data-testid="datang-ri1"]'), '1'); await tick()
  typeInto(doc, doc.querySelector('[data-testid="rusak-ri1"]'), '1'); await tick()
  check('C6a panel gap skema tampil saat rusak diisi', !!doc.querySelector('[data-testid="schema-gap-note"]'))
  check('C6b teks gap menyebut receiving_events', /receiving_events/.test(doc.querySelector('[data-testid="schema-gap-note"]').textContent))
  check('C6c opsi retur nanti/supplier/dibuang tampil', /Tentukan nanti/.test(form(doc).textContent) && /Kembalikan ke Supplier/.test(form(doc).textContent) && /Dibuang/.test(form(doc).textContent))
  check('C6d label supplier = "menunggu dikembalikan" bukan sudah', /menunggu dikembalikan/.test(form(doc).textContent))
  // KOREKSI DAT: foto OPSIONAL + jujur belum tersimpan (Drive belum aktif)
  // Radio: pakai elemen.click() asli jsdom (React onChange utk radio dari click).
  flushSync(() => doc.querySelector(`[data-testid="retur-buang-ri1"]`).click())
  await tick()
  const fotoNote = doc.querySelector('[data-testid="foto-note-ri1"]')
  check('C6e foto dilabeli OPSIONAL', /Bukti foto \(opsional/.test(form(doc).textContent))
  check('C6f catatan jujur: arsip Drive belum aktif / belum tersimpan', !!fotoNote && /belum (tersimpan|aktif)/.test(fotoNote.textContent))
  // Centang konfirmasi buang (wajib) supaya form valid; foto tetap kosong (opsional).
  flushSync(() => {
    const cb = [...form(doc).querySelectorAll('input[type="checkbox"]')].find(x => !x.checked)
    cb.click() // click asli jsdom -> React onChange
  })
  await tick()
  check('C6g submit diblok dengan pesan gap', (() => { const f = form(doc); flushSync(() => f.requestSubmit()); return /Belum dapat disimpan/.test(errText(doc)) })(), 'err=' + errText(doc) + ' | submit-disabled=' + submitBtn(doc).disabled + ' | text=' + (form(doc).textContent.match(/Centang[^.]*/) || ['-'])[0])
  await tick()
  check('C6h NOL tulisan DB (tidak ada packing note)', mock.__callsOf('update').length === 0 && mock.__callsOf('insert').length === 0)
}

// ---------- C7: kolom ringkasan daftar ----------
console.log('\nC7. Daftar Purchase: ringkasan nama/jumlah item + tombol, bukan cuma invoice')
{
  const { document: doc } = mount(RECEIVINGS, RECEIVING_ITEMS)
  await tick()
  const text = doc.body.textContent || ''
  check('C7a kolom "Barang" header ada', text.includes('Barang'))
  check('C7b "2 item" ringkas utk rc1', /2 item/.test(text))
  check('C7c nama item tampil ringkas', /Thiner/.test(text) && /Sealant/.test(text))
  check('C7d nota tanpa item -> "Belum ada rincian"', /Belum ada rincian/.test(text))
  check('C7e alokasi asing tampil apa adanya (LANGSUNG_LAPANGAN)', /LANGSUNG_LAPANGAN/.test(text))
  check('C7f label "Lihat Barang" TIDAK muncul utk nota parsial', !/Lihat Barang/.test(text))
}

// ---------- C8: old-data (nota tanpa item / tanpa PR) ----------
console.log('\nC8. Old-data: nota tanpa item -> Muat item dari PR; tanpa PR -> pesan admin')
{
  mock.__reset({ rows: [] })
  const { document: doc } = mount([RECEIVINGS[1]], [])   // rc2: punya PR, tanpa item
  await tick()
  click(btnTerima(doc, 'rc2'))
  await tick()
  check('C8a pesan "belum punya rincian" tampil', /belum punya rincian barang/.test(form(doc).textContent))
  const loadBtn = doc.querySelector('[data-testid="btn-load-from-pr"]')
  check('C8b tombol "Muat item dari PR" ada', !!loadBtn)
  click(loadBtn)
  await tick(); await tick()
  const inserts = mock.__callsOf('insert', 'receiving_items')
  check('C8c klik -> insert 2 item PR qty 0', inserts.length === 2)
  check('C8d tiap insert qty 0 + receiving_id rc2', inserts.every(c => c.data.quantity_received === 0 && c.data.receiving_id === 'rc2'))
  check('C8e TIDAK ada update qty/note apa pun', mock.__callsOf('update').length === 0)

  // rc3: tanpa PR
  mock.__reset({ rows: [] })
  const { document: doc2 } = mount([RECEIVINGS[2]], [])
  await tick()
  click(btnTerima(doc2, 'rc3'))
  await tick()
  check('C8f tanpa PR -> pesan hubungi admin', /tidak terhubung ke PR/.test(form(doc2).textContent))
  check('C8g tanpa PR -> TIDAK ada tombol muat', !doc2.querySelector('[data-testid="btn-load-from-pr"]'))
}

// ---------- C9: parent summary READ-ONLY + gate bulk (DAT 16 Okt) ----------
console.log('\nC9. Daftar Purchase: ringkasan parent read-only (bukan dropdown Normal); bulk dilarang multi-item')
{
  // Nota 2 item qty 0 (kasus screenshot DAT): PARSIAL(0/2) lama -> sekarang
  // "Belum diterima (0/2)", tanpa dropdown status, tanpa tombol bulk.
  const R = [
    { id: 'rcm', purchase_request_id: 'pr1', project_id: 'p1', project_name: '[99] Baroni', status: 'NORMAL', received_date: null, delivery_note: 'SJ-M', invoice_no: 'INV-M', note: '', alokasi: null, masuk_gudang: false, tukang_at: null }
  ]
  const RI = [
    { id: 'm1', receiving_id: 'rcm', pr_item_id: 'pi1', item_name: 'Triplek (SF - 9mm)', unit: 'Lembar', quantity_received: 0 },
    { id: 'm2', receiving_id: 'rcm', pr_item_id: 'pi2', item_name: 'Triplek (Polos - 9mm - BBCC)', unit: 'Lembar', quantity_received: 0 }
  ]
  const { document: doc } = mount(R, RI)
  await tick()
  const text = doc.body.textContent || ''
  const dtab = doc.querySelector('.desktop-table-view')
  // Baris multi-item (rcm): semua pengecekan DAT di-scope ke baris ini.
  const rows = [...(dtab?.querySelectorAll('tbody tr') || [])]
  const rowMulti = rows.find(tr => /INV-M/.test(tr.textContent))
  const rt = rowMulti ? rowMulti.textContent : ''
  check('C9a baris multi-item: TIDAK ada dropdown status', !!rowMulti && !rowMulti.querySelector('select'))
  check('C9b ringkasan "Belum diterima (0/2)" tampil', /Belum diterima \(0\/2\)/.test(rt), rt.slice(0, 200))
  check('C9c TIDAK ada "PARSIAL (0/2)" menyesatkan', !/PARSIAL/.test(rt))
  check('C9d bulk Masuk Stok Gudang TIDAK tampil utk multi-item', !/Masuk Stok Gudang/.test(rt))
  check('C9e bulk Serah Terima ke Tukang TIDAK tampil utk multi-item', !/Serah Terima ke Tukang/.test(rt))
  check('C9f info tujuan per barang tampil', /per barang/.test(rt), rt.slice(0, 300))
  check('C9f2 info status nota read-only tampil utk multi-item', !!rowMulti?.querySelector('[data-testid="nota-info-rcm"]'))
  // tombol Terima Barang tetap ada (satu pintu input)
  check('C9g tombol Terima Barang tetap ada', !!btnTerima(doc, 'rcm'))

  // 1 item sudah diterima penuh -> bulk boleh (keterbatasan skema: hanya 1 item)
  const R1 = [{ ...R[0], id: 'rc1i', invoice_no: 'INV-1I' }]
  const RI1 = [{ id: 's1', receiving_id: 'rc1i', pr_item_id: 'pi1', item_name: 'Thiner', unit: 'Liter', quantity_received: 10 }]
  const { document: doc2 } = mount(R1, RI1)
  await tick()
  const t2 = doc2.querySelector('.desktop-table-view')?.textContent || ''
  check('C9h 1 item lengkap -> ringkasan LENGKAP', /Lengkap \(1\/1\)/.test(t2))
  check('C9i 1 item -> bulk boleh (Masuk Stok Gudang tampil)', /Masuk Stok Gudang/.test(t2))
  // 1 item: dropdown status NOTA tetap ada (dimensi nota terpisah, label jelas)
  check('C9j 1 item -> dropdown "Nota Normal" ada (bukan kondisi barang)', /Nota Normal/.test(t2))
}

console.log(`\nrender_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
process.exit(fail ? 1 : 0)
