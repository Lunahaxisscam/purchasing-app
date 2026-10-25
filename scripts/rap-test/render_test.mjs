// ============================================================
// RENDER TEST — modules/rap/view.jsx ASLI (hasil transform SWC) di jsdom
// t_71d95cfe (S3/7) + t_3b877fb5 (gerbang BOM & penolakan nilai negatif).
// Klik nyata: impor JSON RAB, edit qty/harga (termasuk nilai NEGATIF yang
// harus tetap negatif di layar & memblokir), tandai jenis baris, pilih
// material master, susun pratinjau PR (ditolak/diterima sesuai gerbang),
// ubah status, pulihkan dari JSON.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// ---------- 1) DOM environment (SATU jsdom untuk seluruh test) ----------
// PENTING: global.window harus dipasang SEBELUM react-dom di-import, dan
// tidak boleh diganti setelahnya — scheduler react-dom mengikat window saat
// modul dimuat. Karena itu mount() hanya mengganti container, bukan dokumen.
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
try { global.navigator = dom.window.navigator } catch { /* Node 22 read-only */ }
global.Blob = dom.window.Blob
global.File = dom.window.File
global.HTMLElement = dom.window.HTMLElement
global.HTMLInputElement = dom.window.HTMLInputElement
global.HTMLTextAreaElement = dom.window.HTMLTextAreaElement
global.Event = dom.window.Event
dom.window.URL.createObjectURL = () => 'blob:mock'
dom.window.URL.revokeObjectURL = () => {}

// ---------- 2) React & modul ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const Rap = (await import(pathToFileURL(path.join(SB, 'dist/modules/rap/view.mjs')).href)).default
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`)
}
const tick = () => new Promise(r => setTimeout(r, 0))
const tid = (doc, t) => doc.querySelector(`[data-testid="${t}"]`)
const text = (doc, t) => {
  const el = tid(doc, t)
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null
}
function click(el) {
  if (!el) throw new Error('elemen tidak ada')
  flushSync(() => el.dispatchEvent(new dom.window.Event('click', { bubbles: true })))
}
function type(el, value) {
  if (!el) throw new Error('input tidak ada')
  flushSync(() => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
function choose(el, value) {
  if (!el) throw new Error('select tidak ada')
  flushSync(() => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
}

const PROJECTS = [
  { id: 'p1', kode: '100', name: 'EA Store', status: 'ON_GOING' },
  { id: 'p2', kode: '101', name: 'Mabes', status: 'ON_GOING' }
]

// Katalog master material (READ-ONLY) untuk memverifikasi gerbang BOM.
const MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 120000 },
  { id: 'm2', kode: 'HPL-0002', name: 'HPL Putih', category: 'Finishing', satuan: 'Lembar', harga_acuan: 95000 }
]

// Nama pekerjaan ada di <input value> / <select value>, bukan textContent —
// jadi pencarian baris harus lewat nilai kontrol (bukan textContent).
function rows(doc) {
  return Array.from(doc.querySelectorAll('tr[data-testid^="rap-line-"]'))
}
function rowId(row) {
  return row.getAttribute('data-testid').replace('rap-line-', '')
}
function rowByName(doc, name) {
  return rows(doc).find(r => {
    const input = r.querySelector('input[data-testid^="rap-name-"]')
    if (input && input.value === name) return true
    const sel = r.querySelector('select[data-testid^="rap-material-"]')
    if (sel && sel.selectedOptions[0] && sel.selectedOptions[0].textContent.indexOf(name) >= 0) return true
    return false
  })
}

const BOQ = {
  version: 5,
  priceUnit: 'thousand IDR (000)',
  boqReff: 'BOQ-014',
  revisionNumber: 'REV02',
  projectName: 'EA Store',
  items: [
    { item: 'Wardrobe', qty: 2, unit: 'unit', price: 1500 },
    { item: 'Kitchen set', qty: 1, unit: 'unit', price: 8000 }
  ]
}

let rootCounter = 0
const mounted = []
function mount(extra = {}) {
  // Bersihkan mount sebelumnya supaya querySelector tidak menemukan elemen
  // dari komponen lama (dokumen & scheduler React tetap satu).
  while (mounted.length) {
    const prev = mounted.pop()
    try { flushSync(() => prev.root.unmount()) } catch (e) { /* noop */ }
    if (prev.holder && prev.holder.parentNode) prev.holder.parentNode.removeChild(prev.holder)
  }
  const holder = document.createElement('div')
  holder.id = 'app-' + (++rootCounter)
  document.body.appendChild(holder)
  const notices = []
  const props = {
    projects: PROJECTS,
    say: (m) => notices.push(m),
    setPage: null,
    session: { user: { email: 'admin@noir.test' } },
    ...extra
  }
  const root = createRoot(holder)
  flushSync(() => root.render(React.createElement(Rap, props)))
  mounted.push({ root, holder })
  return { root, document, notices, holder }
}

console.log('\n=== A. BANNER JUJUR & EMPTY STATE (draft-only) ===\n')
{
  mock.__reset({ materials: MATERIALS })
  const { document: doc } = mount()
  await tick()
  await tick()
  check('A1 halaman RAP ter-render', !!tid(doc, 'rap-root'))
  const banner = text(doc, 'rap-persistence-banner')
  check('A2 banner menyatakan BELUM tersimpan di server', /belum tersimpan di server/i.test(banner || ''), banner)
  check('A3 banner menyebut backup JSON', /Backup JSON/i.test(banner || ''))
  check('A4 empty state tampil sebelum ada draft', !!tid(doc, 'rap-empty'))
  check('A5 tidak ada tombol simpan/approve palsu', !/simpan ke server/i.test(doc.body.textContent))
  check('A6 proyek pertama terpilih otomatis', tid(doc, 'rap-project').getAttribute('data-project-resolved') === 'p1', tid(doc, 'rap-project').getAttribute('data-project-resolved'))
  check('A7 tombol backup nonaktif tanpa draft', tid(doc, 'rap-act-backup').disabled === true)
  check('A8 status diberi label "bukan persetujuan resmi"', /bukan persetujuan resmi/i.test(text(doc, 'rap-status-honest') || ''), text(doc, 'rap-status-honest'))
}

console.log('\n=== B. BUAT DRAFT DARI JSON RAB (acuan) ===\n')
let DOC
{
  mock.__reset({ materials: MATERIALS })
  const { document: doc, notices } = mount()
  DOC = doc
  await tick()
  type(tid(doc, 'rap-rab-json'), JSON.stringify(BOQ))
  click(tid(doc, 'rap-act-import-rab'))
  await tick()

  check('B1 draft terbentuk (empty state hilang)', !tid(doc, 'rap-empty') && !!tid(doc, 'rap-lines'))
  eq('B2 dua baris dari RAB', rows(doc).length, 2)
  eq('B3 versi otomatis RAP-01', tid(doc, 'rap-version').value, 'RAP-01')
  eq('B4 status awal Draft', text(doc, 'rap-status-badge'), 'Draft')
  eq('B5 total acuan RAB = 11.000.000', text(doc, 'rap-kpi-rab'), 'Rp 11.000.000')
  eq('B6 total rencana awal = acuan', text(doc, 'rap-kpi-rap'), 'Rp 11.000.000')
  check('B7 selisih awal nol', /Rp 0/.test(text(doc, 'rap-kpi-diff') || ''), text(doc, 'rap-kpi-diff'))
  check('B8 notice menyebut belum tersimpan', notices.some(n => /Belum tersimpan di server/i.test(n)), JSON.stringify(notices))
  check('B9 acuan menyebut BOQ-014 REV02', /BOQ-014/.test(doc.body.textContent) && /REV02/.test(doc.body.textContent))
  check('B10 harga RAB dikonversi ke rupiah penuh di tabel', /Rp 1\.500\.000/.test(text(doc, 'rap-lines') || ''), text(doc, 'rap-lines'))

  // ---- LABEL SUMBER ACUAN (temuan Brooklyn: jangan klaim apel-vs-apel) ----
  check('B11 label sumber acuan tampil', !!tid(doc, 'rap-baseline-label'), text(doc, 'rap-baseline-label'))
  check('B12 label menyebut HARGA JUAL (bukan biaya)', /HARGA JUAL/i.test(text(doc, 'rap-baseline-label') || ''), text(doc, 'rap-baseline-label'))
  check('B13 ada penanda eksplisit "apel-vs-apel: TIDAK"', /TIDAK/i.test(text(doc, 'rap-baseline-flag') || '') && /apel-vs-apel/i.test(text(doc, 'rap-baseline-flag') || ''), text(doc, 'rap-baseline-flag'))
  check('B14 catatan menyebut margin, bukan perbandingan biaya', /margin/i.test(text(doc, 'rap-baseline-note') || ''), text(doc, 'rap-baseline-note'))

  // ---- JENIS BARIS: BOQ = pekerjaan, TIDAK ditebak jadi material ----
  eq('B15 dua baris BOQ bertanda PEKERJAAN', rows(doc).map(r => r.getAttribute('data-line-kind')), ['WORK_ITEM', 'WORK_ITEM'])
  check('B16 penjelasan "jenis tidak ditebak dari nama" tampil', /TIDAK ditebak dari nama barang/i.test(text(doc, 'rap-kind-honest') || ''), text(doc, 'rap-kind-honest'))
  check('B17 katalog material termuat (2 item)', /Katalog material: 2 item/.test(text(doc, 'rap-kind-honest') || ''), text(doc, 'rap-kind-honest'))
}

console.log('\n=== C. EDIT QTY & HARGA RENCANA -> SELISIH HITUNG ULANG ===\n')
{
  const wardrobeRow = rowByName(DOC, 'Wardrobe')
  const kitchenRow = rowByName(DOC, 'Kitchen set')
  const wardrobeId = rowId(wardrobeRow)
  const kitchenId = rowId(kitchenRow)

  // harga rencana wardrobe turun 1.500.000 -> 1.400.000
  type(tid(DOC, `rap-price-${wardrobeId}`), '1400000')
  await tick()
  eq('C1 total RAP turun jadi 10.800.000', text(DOC, 'rap-kpi-rap'), 'Rp 10.800.000')
  eq('C2 acuan RAB tidak berubah', text(DOC, 'rap-kpi-rab'), 'Rp 11.000.000')
  check('C3 selisih jadi minus', /-Rp 200\.000|-200\.000/.test(text(DOC, 'rap-kpi-diff') || ''), text(DOC, 'rap-kpi-diff'))
  check('C4 baris menampilkan selisih negatif', /-Rp 200\.000|-200\.000/.test(text(DOC, `rap-diff-${wardrobeId}`) || ''), text(DOC, `rap-diff-${wardrobeId}`))

  // qty kitchen set naik 1 -> 2 (over budget)
  type(tid(DOC, `rap-qty-${kitchenId}`), '2')
  await tick()
  eq('C5 total RAP jadi 18.800.000', text(DOC, 'rap-kpi-rap'), 'Rp 18.800.000')
  check('C6 kartu selisih ditandai over budget', /MELEBIHI/.test(DOC.body.textContent))
  check('C7 peringatan validasi menyebut MELEBIHI + label sumber', /MELEBIHI/.test(text(DOC, 'rap-validation-warnings') || '') && /HARGA JUAL/i.test(text(DOC, 'rap-validation-warnings') || ''), text(DOC, 'rap-validation-warnings'))

  // qty 0 -> penghalang
  type(tid(DOC, `rap-qty-${kitchenId}`), '0')
  await tick()
  check('C8 qty 0 memunculkan penghalang', /lebih dari 0/.test(text(DOC, 'rap-validation-problems') || ''), text(DOC, 'rap-validation-problems'))

  // ---- HARGA NEGATIF: tetap negatif di layar & MEMBLOKIR (temuan Brooklyn)
  type(tid(DOC, `rap-price-${wardrobeId}`), '-100')
  await tick()
  eq('C9 input harga tetap menampilkan -100 (tidak berubah jadi 0)', tid(DOC, `rap-price-${wardrobeId}`).value, '-100')
  check('C10 ada hint "ditolak: -100 (negatif)"', /ditolak: -100/i.test(text(DOC, `rap-price-hint-${wardrobeId}`) || ''), text(DOC, `rap-price-hint-${wardrobeId}`))
  check('C11 validasi menyebut negatif DITOLAK', /negatif/i.test(text(DOC, 'rap-validation-problems') || '') && /DITOLAK/i.test(text(DOC, 'rap-validation-problems') || ''), text(DOC, 'rap-validation-problems'))
  check('C12 validasi TIDAK menyebut "masih 0" untuk nilai negatif', !/masih 0/.test(text(DOC, 'rap-validation-warnings') || ''), text(DOC, 'rap-validation-warnings'))
  check('C13 jumlah penghalang bertambah (bukan lolos)', /penghalang/.test(DOC.body.textContent))

  // ---- STATUS: draft berpenghalang TIDAK bisa diajukan ----
  click(tid(DOC, 'rap-act-ajukan'))
  await tick()
  eq('C14 draft berpenghalang tidak bisa Diajukan', text(DOC, 'rap-status-badge'), 'Draft')
  check('C15 alasan penolakan pengajuan terbaca (penghalang dulu)', /penghalang/i.test(text(DOC, 'rap-notice') || ''), text(DOC, 'rap-notice'))

  // kembalikan ke nilai sah
  type(tid(DOC, `rap-qty-${kitchenId}`), '1')
  type(tid(DOC, `rap-price-${wardrobeId}`), '1500000')
  await tick()
  eq('C16 total kembali = acuan', text(DOC, 'rap-kpi-rap'), 'Rp 11.000.000')
  check('C17 tidak ada penghalang lagi', !tid(DOC, 'rap-validation-problems'))

  // hapus baris -> acuan tetap, muncul peringatan baris RAB belum tercakup
  const kitchenRow2 = rowByName(DOC, 'Kitchen set')
  click(tid(DOC, `rap-del-${rowId(kitchenRow2)}`))
  await tick()
  eq('C18 setelah hapus: acuan RAB TETAP 11.000.000', text(DOC, 'rap-kpi-rab'), 'Rp 11.000.000')
  eq('C19 total RAP jadi 3.000.000', text(DOC, 'rap-kpi-rap'), 'Rp 3.000.000')
  check('C20 baris RAB yang hilang dilaporkan', /Kitchen set/.test(text(DOC, 'rap-missing') || ''), text(DOC, 'rap-missing'))
}

console.log('\n=== D. STATUS VERSI (transisi & penolakan) ===\n')
{
  click(tid(DOC, 'rap-act-setujui'))
  await tick()
  eq('D1 DRAFT tidak bisa langsung Disetujui', text(DOC, 'rap-status-badge'), 'Draft')
  check('D2 alasan penolakan terbaca di notice', /tidak bisa berpindah/i.test(text(DOC, 'rap-notice') || ''), text(DOC, 'rap-notice'))

  click(tid(DOC, 'rap-act-ajukan'))
  await tick()
  eq('D3 Draft -> Diajukan', text(DOC, 'rap-status-badge'), 'Diajukan')

  click(tid(DOC, 'rap-act-setujui'))
  await tick()
  eq('D4 Diajukan -> Disetujui', text(DOC, 'rap-status-badge'), 'Disetujui')
  check('D5 notice menegaskan status LOKAL & belum tersimpan', /BELUM tersimpan di server/i.test(text(DOC, 'rap-notice') || '') && /BUKAN persetujuan resmi/i.test(text(DOC, 'rap-notice') || ''), text(DOC, 'rap-notice'))
}

console.log('\n=== E. GERBANG BOM: BARIS PEKERJAAN DITOLAK DARI PR MATERIAL ===\n')
{
  mock.__reset({ materials: MATERIALS })
  click(tid(DOC, 'rap-act-pr-preview'))
  await tick()
  const payloadText = text(DOC, 'rap-pr-payload')
  check('E1 pratinjau tetap ditampilkan (transparan, bukan disembunyikan)', !!payloadText)
  let payload = null
  try { payload = JSON.parse(payloadText) } catch (e) { /* gagal di bawah */ }
  check('E2 payload valid JSON', !!payload)
  if (payload) {
    eq('E3 TIDAK ada item furniture masuk PR', payload.items.length, 0)
    eq('E4 payload TIDAK disusun saat gerbang menolak (request null)', payload.request, null)
  }
  check('E7 masalah gerbang ditampilkan (alasan + langkah perbaikan)', /MATERIAL BAKU|material baku/i.test(text(DOC, 'rap-pr-problems') || ''), text(DOC, 'rap-pr-problems'))
  check('E8 alasan menolak tebakan nama barang', /TIDAK dipakai untuk menebak|tidak menebak/i.test(text(DOC, 'rap-pr-problems') || ''), text(DOC, 'rap-pr-problems'))
  check('E9 gate: 0 terverifikasi / 1 ditolak (Kitchen set sudah dihapus)', /terverifikasi 0/.test(text(DOC, 'rap-pr-gate') || '') && /ditolak 1/.test(text(DOC, 'rap-pr-gate') || ''), text(DOC, 'rap-pr-gate'))
  check('E10 meta menyatakan penulisan DB: 0', /penulisan DB: 0/.test(text(DOC, 'rap-pr-meta') || ''), text(DOC, 'rap-pr-meta'))
  check('E11 meta menyatakan persetujuan TIDAK ADA (draft)', /TIDAK ADA/i.test(text(DOC, 'rap-pr-meta') || ''), text(DOC, 'rap-pr-meta'))
  check('E12 catatan approval: status RAP bukan persetujuan resmi', /BUKAN persetujuan resmi/i.test(text(DOC, 'rap-pr-approval-note') || ''), text(DOC, 'rap-pr-approval-note'))
  check('E13 teks jujur: hanya menyusun pratinjau', /menyusun/i.test(text(DOC, 'rap-pr-honest') || ''), text(DOC, 'rap-pr-honest'))
  check('E14 aturan gerbang BOM dijelaskan di UI', /Gerbang BOM/.test(text(DOC, 'rap-pr-gate-rule') || ''), text(DOC, 'rap-pr-gate-rule'))
  const writeOps = mock.__ops.filter(o => ['insert', 'update', 'delete', 'rpc'].includes(o.op))
  eq('E15 NOL operasi tulis ke database', writeOps.length, 0)
  const tables = mock.__ops.filter(o => o.op === 'select').map(o => o.table)
  check('E16 tidak ada select ke tabel RAP (tidak ada tabelnya)', !tables.some(t => /rap/i.test(t)), JSON.stringify(tables))
}

console.log('\n=== F. WBS BUDGETING: JUJUR SOAL UPAH ===\n')
{
  mock.__reset({ materials: MATERIALS, plans: [
    { id: 'w1', project_id: 'p1', area: 'Dapur', item_name: 'Kitchen set', volume: 2, unit: 'unit', labor_cost: 3000000, status: 'Perencanaan' },
    { id: 'w2', project_id: 'p1', area: 'Kamar', item_name: 'Wardrobe', volume: 1, unit: 'unit', labor_cost: 0, status: 'Perencanaan' }
  ] })
  const { document: doc } = mount()
  await tick()
  click(tid(doc, 'rap-act-pull-wbs'))
  await tick()
  await tick()
  eq('F1 dua baris dari WBS', rows(doc).length, 2)
  check('F2 peringatan "hanya upah" tampil', /hanya memuat estimasi UPAH/i.test(text(doc, 'rap-source-warnings') || ''), text(doc, 'rap-source-warnings'))
  check('F3 acuan diberi label WBS Budgeting (upah)', /WBS Budgeting \(upah\)/.test(doc.body.textContent))
  check('F4 baris tanpa upah ditandai', /WBS tanpa upah/.test(doc.body.textContent))
  check('F5 label sumber acuan = UPAH saja (bukan harga penuh)', /UPAH/i.test(text(doc, 'rap-baseline-label') || ''), text(doc, 'rap-baseline-label'))
  check('F6 hanya operasi baca ke project_plans/materials', mock.__ops.every(o => o.op === 'select' || o.op === 'eq'), JSON.stringify(mock.__ops.map(o => o.op)))
  eq('F7 tidak ada tulisan DB', mock.__ops.filter(o => ['insert', 'update', 'delete', 'rpc'].includes(o.op)).length, 0)

  // error baca WBS tidak boleh menyamar sebagai "belum ada WBS"
  mock.__reset({ materials: MATERIALS, plansError: 'permission denied for table project_plans' })
  const { document: doc2 } = mount()
  await tick()
  click(tid(doc2, 'rap-act-pull-wbs'))
  await tick()
  await tick()
  check('F8 error WBS ditampilkan apa adanya', /permission denied/.test(text(doc2, 'rap-wbs-error') || ''), text(doc2, 'rap-wbs-error'))
  check('F9 tidak mengklaim "belum punya WBS"', !/belum punya baris WBS/.test(doc2.body.textContent))
}

console.log('\n=== G. BARIS MATERIAL BAKU (BOM) -> PR MATERIAL DITERIMA ===\n')
{
  mock.__reset({ materials: MATERIALS })
  // Draft dengan acuan RAB (BOQ-011) + satu baris MATERIAL baku yang sudah
  // ditautkan ke master. Ini jalur POSITIF: gerbang harus MELOLOSKAN.
  const initialDraft = {
    id: 'rap-mat', version: 'RAP-01', status: 'DRAFT',
    project_id: 'p1', project_name: 'EA Store', project_kode: '100',
    rab_reff: 'BOQ-011', rab_revision: 'REV01', rab_source: 'RAB & BOQ (JSON)',
    rab_basis: 'RAB_SELL_PRICE',
    rab_lines: [{ id: 'rb1', item_name: 'Pekerjaan Kayu', unit: 'ls', line_kind: 'WORK_ITEM', rab_qty: 1, rab_unit_price: 5000000, planned_qty: 1, planned_unit_price: 5000000, price_source: 'RAB' }],
    lines: [{
      id: 'l-mat', item_name: 'Triplek 9mm', unit: 'Lembar', line_kind: 'MATERIAL',
      material_id: 'm1', kode: 'PLY-0001',
      rab_qty: 10, rab_unit_price: 120000, planned_qty: 4, planned_unit_price: 120000,
      price_source: 'MANUAL'
    }],
    history: [], created_at: '2026-10-18T00:00:00.000Z', updated_at: '2026-10-18T00:00:00.000Z'
  }
  const { document: doc, notices } = mount({ initialDraft })
  await tick()
  await tick()
  eq('G1 baris material bertanda MATERIAL', rows(doc).map(r => r.getAttribute('data-line-kind')), ['MATERIAL'])
  const id = rowId(rows(doc)[0])
  const sel = tid(doc, `rap-material-${id}`)
  check('G2 pemilih material tersedia (bukan input nama bebas)', !!sel)
  check('G3 satuan mengikuti master', tid(doc, `rap-unit-${id}`).value === 'Lembar', tid(doc, `rap-unit-${id}`).value)

  click(tid(doc, 'rap-act-pr-preview'))
  await tick()

  const gateText = text(doc, 'rap-pr-gate') || ''
  check('G4 baris material terverifikasi', /terverifikasi 1/.test(gateText), gateText)
  check('G5 tidak ada baris ditolak', /ditolak 0/.test(gateText), gateText)
  const payload2 = (() => { try { return JSON.parse(text(doc, 'rap-pr-payload')) } catch (e) { return null } })()
  check('G6 payload berisi TEPAT 1 item material', !!payload2 && payload2.items.length === 1, JSON.stringify(payload2 && payload2.items))
  if (payload2) {
    eq('G7 material_id benar', payload2.items[0].material_id, 'm1')
    eq('G8 qty & harga rencana', [payload2.items[0].quantity, payload2.items[0].estimated_price], [4, 120000])
    eq('G9 satuan dari master', payload2.items[0].unit, 'Lembar')
    eq('G10 kode dari master', payload2.items[0].kode, 'PLY-0001')
    check('G11 pr_id tidak dikarang', !('pr_id' in payload2.items[0]))
    eq('G12 status item PENDING_APPROVAL', payload2.items[0].status, 'PENDING_APPROVAL')
  }
  eq('G13 tetap nol tulisan DB', mock.__ops.filter(o => ['insert', 'update', 'delete', 'rpc'].includes(o.op)).length, 0)
  check('G14 notice menyebut BUKAN alokasi resmi', notices.some(n => /BUKAN alokasi resmi/i.test(n)), JSON.stringify(notices))

  // ---- satuan berbeda dari master -> DITOLAK ----
  type(tid(doc, `rap-unit-${id}`), 'm2')
  await tick()
  click(tid(doc, 'rap-act-pr-preview'))
  await tick()
  check('G15 satuan beda dengan master -> DITOLAK', /BEDA dengan satuan master/i.test(text(doc, 'rap-pr-problems') || ''), text(doc, 'rap-pr-problems'))
  const blocked = (() => { try { return JSON.parse(text(doc, 'rap-pr-payload')) } catch (e) { return null } })()
  eq('G15b payload TIDAK disusun saat ada penghalang (fail-closed)', blocked ? blocked.items.length : -1, 0)

  // ---- harga 1000x -> DITOLAK (salah skala) ----
  type(tid(doc, `rap-unit-${id}`), 'Lembar')
  type(tid(doc, `rap-price-${id}`), '120000000')
  await tick()
  click(tid(doc, 'rap-act-pr-preview'))
  await tick()
  check('G16 harga 1000x acuan master -> DITOLAK (salah skala)', /SALAH SKALA/i.test(text(doc, 'rap-pr-problems') || ''), text(doc, 'rap-pr-problems'))

  // ---- harga negatif pada baris material -> DITOLAK, tidak jadi 0 ----
  type(tid(doc, `rap-price-${id}`), '-100')
  await tick()
  click(tid(doc, 'rap-act-pr-preview'))
  await tick()
  check('G17 harga -100 pada material -> DITOLAK (bukan jadi 0)', /negatif/i.test(text(doc, 'rap-pr-problems') || ''), text(doc, 'rap-pr-problems'))
  const negPayload = (() => { try { return JSON.parse(text(doc, 'rap-pr-payload')) } catch (e) { return null } })()
  eq('G18 tidak ada item estimated_price 0 hasil koersi', negPayload ? negPayload.items.length : -1, 0)
}

console.log('\n=== G2. TANPA ACUAN RAB -> MATERIAL BAKU PUN DITOLAK ===\n')
{
  mock.__reset({ materials: MATERIALS })
  // Draft disuntik langsung tanpa rab_reff/rab_lines: meniru material di luar
  // RAB yang belum ditandai eksplisit. Gerbang harus MENOLAK.
  const initialDraft = {
    id: 'rap-norab', version: 'RAP-01', status: 'DRAFT',
    project_id: 'p1', project_name: 'EA Store', project_kode: '100',
    rab_reff: '', rab_revision: '', rab_source: '', rab_lines: [],
    lines: [{
      id: 'l-norab', item_name: 'Triplek 9mm', unit: 'Lembar', line_kind: 'MATERIAL',
      material_id: 'm1', kode: 'PLY-0001',
      rab_qty: 0, rab_unit_price: 0, planned_qty: 2, planned_unit_price: 120000,
      price_source: 'MANUAL'
    }],
    history: [], created_at: '2026-10-18T00:00:00.000Z', updated_at: '2026-10-18T00:00:00.000Z'
  }
  const { document: doc } = mount({ initialDraft })
  await tick()
  await tick()
  click(tid(doc, 'rap-act-pr-preview'))
  await tick()
  check('G2a tanpa acuan RAB -> pratinjau DITOLAK dengan penjelasan', /Acuan RAB yang disetujui belum ada/i.test(text(doc, 'rap-pr-problems') || ''), text(doc, 'rap-pr-problems'))
  const p = (() => { try { return JSON.parse(text(doc, 'rap-pr-payload')) } catch (e) { return null } })()
  eq('G2b tidak ada item lolos tanpa acuan RAB', p ? p.items.length : -1, 0)
}

console.log('\n=== H. PULIHKAN DARI JSON (draft tetap belum tersimpan) ===\n')
{
  mock.__reset({ materials: MATERIALS })
  const draft = {
    id: 'rap-restore-1',
    version: 'RAP-05',
    status: 'DIAJUKAN',
    project_id: 'p1',
    project_name: 'EA Store',
    project_kode: '100',
    rab_reff: 'BOQ-099',
    rab_revision: 'REV01',
    rab_source: 'RAB & BOQ (JSON)',
    rab_price_unit: 'thousand IDR (000)',
    rab_lines: [
      { id: 'r1', item_name: 'Wardrobe', unit: 'unit', rab_qty: 2, rab_unit_price: 1500000, planned_qty: 2, planned_unit_price: 1500000, price_source: 'RAB', line_kind: 'WORK_ITEM' }
    ],
    lines: [
      { id: 'l1', item_name: 'Wardrobe', unit: 'unit', rab_qty: 2, rab_unit_price: 1500000, planned_qty: 2, planned_unit_price: 1300000, price_source: 'RAB', line_kind: 'WORK_ITEM' }
    ],
    history: [],
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
    persisted: true, // sengaja salah: pemulihan harus mengembalikannya ke false
    persistence: 'SERVER'
  }
  const { document: doc, notices } = mount()
  await tick()
  const snapshot = { version: 1, kind: 'rap-draft', savedToServer: false, rap: draft }
  const file = new dom.window.File([JSON.stringify(snapshot)], 'rap.json', { type: 'application/json' })
  const input = tid(doc, 'rap-restore-file')
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  flushSync(() => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
  await tick()
  await tick()
  eq('H1 versi hasil pulih benar', tid(doc, 'rap-version').value, 'RAP-05')
  eq('H2 status hasil pulih benar', text(doc, 'rap-status-badge'), 'Diajukan')
  eq('H3 total RAP hasil pulih', text(doc, 'rap-kpi-rap'), 'Rp 2.600.000')
  eq('H4 acuan RAB hasil pulih', text(doc, 'rap-kpi-rab'), 'Rp 3.000.000')
  check('H5 notice menegaskan tetap belum tersimpan', notices.some(n => /belum tersimpan di server/i.test(n)), JSON.stringify(notices))
  check('H6 tidak ada tulisan DB saat memulihkan', mock.__ops.filter(o => ['insert', 'update', 'delete', 'rpc'].includes(o.op)).length === 0)

  // snapshot berisi harga negatif: tetap negatif & memblokir setelah pulih
  const negSnap = { version: 1, kind: 'rap-draft', savedToServer: false, rap: {
    ...draft,
    id: 'rap-restore-neg',
    lines: [{ id: 'n1', item_name: 'Wardrobe', unit: 'unit', rab_qty: 1, rab_unit_price: 1000, planned_qty: 1, planned_unit_price: -100, price_source: 'RAB' }]
  } }
  const { document: doc3 } = mount()
  await tick()
  const file2 = new dom.window.File([JSON.stringify(negSnap)], 'rap-neg.json', { type: 'application/json' })
  const input2 = tid(doc3, 'rap-restore-file')
  Object.defineProperty(input2, 'files', { value: [file2], configurable: true })
  flushSync(() => input2.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
  await tick()
  await tick()
  const negRow = rows(doc3)[0]
  const negId = rowId(negRow)
  eq('H7 harga negatif dari snapshot tetap -100 di layar', tid(doc3, `rap-price-${negId}`).value, '-100')
  check('H8 validasi menolak harga negatif hasil pulih', /negatif/i.test(text(doc3, 'rap-validation-problems') || ''), text(doc3, 'rap-validation-problems'))
}

console.log('\n=== I. TIDAK ADA KLAIM REALISASI / PERSISTENSI PALSU ===\n')
{
  mock.__reset({ materials: MATERIALS })
  const { document: doc } = mount()
  await tick()
  const body = doc.body.textContent
  check('I1 tidak ada kata "aktual" pada angka RAP', !/\baktual\b/i.test(body), (body.match(/.{0,40}aktual.{0,40}/i) || [])[0])
  check('I2 tidak ada klaim "tersimpan" tanpa kata belum', !/(?<!belum )(?<!tidak )tersimpan/i.test(body))
  check('I3 ada penanda "Draft saja"', /Draft saja/i.test(body))
  check('I4 tidak memakai localStorage sebagai DB', !/localStorage/.test(body))
  check('I5 tidak ada tombol yang mengaku menyimpan RAP ke server', !/Simpan RAP/i.test(body))
}

console.log(`\n=== HASIL RENDER: ${pass} lulus, ${fail} gagal ===`)
if (fail) {
  console.log('Gagal:')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
