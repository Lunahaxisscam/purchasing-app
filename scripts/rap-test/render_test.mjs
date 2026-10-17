// ============================================================
// RENDER TEST — modules/rap/view.jsx ASLI (hasil transform SWC) di jsdom
// t_71d95cfe (S3/7). Klik nyata: impor JSON RAB, edit qty/harga rencana,
// lihat selisih, ubah status, susun payload PR, pulihkan dari JSON.
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

const PROJECTS = [
  { id: 'p1', kode: '100', name: 'EA Store', status: 'ON_GOING' },
  { id: 'p2', kode: '101', name: 'Mabes', status: 'ON_GOING' }
]

// Nama pekerjaan ada di <input value>, bukan textContent — jadi pencarian
// baris harus lewat nilai input (bukan textContent).
function rows(doc) {
  return Array.from(doc.querySelectorAll('tr[data-testid^="rap-line-"]'))
}
function rowId(row) {
  return row.getAttribute('data-testid').replace('rap-line-', '')
}
function rowByName(doc, name) {
  return rows(doc).find(r => {
    const input = r.querySelector('input[data-testid^="rap-name-"]')
    return input && input.value === name
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
  mock.__reset({})
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
}

console.log('\n=== B. BUAT DRAFT DARI JSON RAB (acuan) ===\n')
let DOC
{
  mock.__reset({})
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
  check('C7 peringatan validasi menyebut MELEBIHI', /MELEBIHI/.test(text(DOC, 'rap-validation-warnings') || ''), text(DOC, 'rap-validation-warnings'))

  // qty 0 -> penghalang
  type(tid(DOC, `rap-qty-${kitchenId}`), '0')
  await tick()
  check('C8 qty 0 memunculkan penghalang', /lebih dari 0/.test(text(DOC, 'rap-validation-problems') || ''), text(DOC, 'rap-validation-problems'))

  // kembalikan
  type(tid(DOC, `rap-qty-${kitchenId}`), '1')
  type(tid(DOC, `rap-price-${wardrobeId}`), '1500000')
  await tick()
  eq('C9 total kembali = acuan', text(DOC, 'rap-kpi-rap'), 'Rp 11.000.000')

  // hapus baris -> acuan tetap, muncul peringatan baris RAB belum tercakup
  const kitchenRow2 = rowByName(DOC, 'Kitchen set')
  click(tid(DOC, `rap-del-${rowId(kitchenRow2)}`))
  await tick()
  eq('C10 setelah hapus: acuan RAB TETAP 11.000.000', text(DOC, 'rap-kpi-rab'), 'Rp 11.000.000')
  eq('C11 total RAP jadi 3.000.000', text(DOC, 'rap-kpi-rap'), 'Rp 3.000.000')
  check('C12 baris RAB yang hilang dilaporkan', /Kitchen set/.test(text(DOC, 'rap-missing') || ''), text(DOC, 'rap-missing'))
  check('C13 ringkasan menyebut 1 baris belum masuk RAP', /1 baris RAB belum masuk RAP/.test(DOC.body.textContent))
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
  check('D5 notice menegaskan status juga belum tersimpan', /BELUM tersimpan di server/i.test(text(DOC, 'rap-notice') || ''), text(DOC, 'rap-notice'))
}

console.log('\n=== E. HANDOFF PR: PAYLOAD SAJA, NOL PENULISAN ===\n')
{
  mock.__reset({})
  click(tid(DOC, 'rap-act-pr-preview'))
  await tick()
  const payloadText = text(DOC, 'rap-pr-payload')
  check('E1 payload PR tampil', !!payloadText)
  let payload = null
  try { payload = JSON.parse(payloadText) } catch (e) { /* gagal di bawah */ }
  check('E2 payload valid JSON', !!payload)
  if (payload) {
    eq('E3 request.status DRAFT', payload.request.status, 'DRAFT')
    eq('E4 nomor PR tidak dikarang', payload.request.pr_number, null)
    eq('E5 satu item tersisa (Kitchen set sudah dihapus di bagian C)', payload.items.length, 1)
    eq('E6 item qty = rencana', payload.items[0].quantity, 2)
    eq('E7 item harga = rencana (rupiah penuh)', payload.items[0].estimated_price, 1500000)
    check('E7b pr_id tidak dikarang', !('pr_id' in payload.items[0]))
  }
  check('E8 meta menyatakan nol penulisan', /penulisan DB: 0/.test(text(DOC, 'rap-pr-meta') || ''), text(DOC, 'rap-pr-meta'))
  check('E9 teks jujur: hanya menyusun payload', /hanya .*menyusun.* payload/i.test(text(DOC, 'rap-pr-honest') || ''), text(DOC, 'rap-pr-honest'))
  const writeOps = mock.__ops.filter(o => ['insert', 'update', 'delete', 'rpc'].includes(o.op))
  eq('E10 NOL operasi tulis ke database', writeOps.length, 0)
  const tables = mock.__ops.filter(o => o.op === 'select').map(o => o.table)
  check('E11 tidak ada select ke tabel RAP (tidak ada tabelnya)', !tables.some(t => /rap/i.test(t)), JSON.stringify(tables))
}

console.log('\n=== F. WBS BUDGETING: JUJUR SOAL UPAH ===\n')
{
  mock.__reset({ plans: [
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
  check('F5 hanya operasi baca ke project_plans', mock.__ops.every(o => o.op === 'select' || o.op === 'eq'), JSON.stringify(mock.__ops.map(o => o.op)))
  eq('F6 tidak ada tulisan DB', mock.__ops.filter(o => ['insert', 'update', 'delete', 'rpc'].includes(o.op)).length, 0)

  // error baca WBS tidak boleh menyamar sebagai "belum ada WBS"
  mock.__reset({ plansError: 'permission denied for table project_plans' })
  const { document: doc2 } = mount()
  await tick()
  click(tid(doc2, 'rap-act-pull-wbs'))
  await tick()
  await tick()
  check('F7 error WBS ditampilkan apa adanya', /permission denied/.test(text(doc2, 'rap-wbs-error') || ''), text(doc2, 'rap-wbs-error'))
  check('F8 tidak mengklaim "belum punya WBS"', !/belum punya baris WBS/.test(doc2.body.textContent))
}

console.log('\n=== G. PULIHKAN DARI JSON (draft tetap belum tersimpan) ===\n')
{
  mock.__reset({})
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
      { id: 'r1', item_name: 'Wardrobe', unit: 'unit', rab_qty: 2, rab_unit_price: 1500000, planned_qty: 2, planned_unit_price: 1500000, price_source: 'RAB' }
    ],
    lines: [
      { id: 'l1', item_name: 'Wardrobe', unit: 'unit', rab_qty: 2, rab_unit_price: 1500000, planned_qty: 2, planned_unit_price: 1300000, price_source: 'RAB' }
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
  eq('G1 versi hasil pulih benar', tid(doc, 'rap-version').value, 'RAP-05')
  eq('G2 status hasil pulih benar', text(doc, 'rap-status-badge'), 'Diajukan')
  eq('G3 total RAP hasil pulih', text(doc, 'rap-kpi-rap'), 'Rp 2.600.000')
  eq('G4 acuan RAB hasil pulih', text(doc, 'rap-kpi-rab'), 'Rp 3.000.000')
  check('G5 notice menegaskan tetap belum tersimpan', notices.some(n => /belum tersimpan di server/i.test(n)), JSON.stringify(notices))
  check('G6 tidak ada tulisan DB saat memulihkan', mock.__ops.filter(o => ['insert', 'update', 'delete', 'rpc'].includes(o.op)).length === 0)
}

console.log('\n=== H. TIDAK ADA KLAIM REALISASI / PERSISTENSI PALSU ===\n')
{
  mock.__reset({})
  const { document: doc } = mount()
  await tick()
  const body = doc.body.textContent
  check('H1 tidak ada kata "aktual" pada angka RAP', !/\baktual\b/i.test(body), (body.match(/.{0,40}aktual.{0,40}/i) || [])[0])
  check('H2 tidak ada klaim "tersimpan" tanpa kata belum', !/(?<!belum )(?<!tidak )tersimpan/i.test(body))
  check('H3 ada penanda "Draft saja"', /Draft saja/i.test(body))
  check('H4 tidak memakai localStorage sebagai DB', !/localStorage/.test(body))
  check('H5 tidak ada tombol yang mengaku menyimpan RAP ke server', !/Simpan RAP/i.test(body))
}

console.log(`\n=== HASIL RENDER: ${pass} lulus, ${fail} gagal ===`)
if (fail) {
  console.log('Gagal:')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
