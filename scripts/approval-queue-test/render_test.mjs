// ============================================================
// VERIFIKASI ANTREAN APPROVAL (bit-dev) — arahan DAT t_0a35264f
// Merender components/ModuleView.js ASLI (hasil transform SWC di dist/)
// dengan React CLIENT-SIDE di dalam jsdom — sehingga state + klik tab
// bisa diuji (bukan hanya SSR statis):
//   A) Default antrean Menunggu (tab pertama aktif, hanya PENDING tampil)
//   B) Zero pending -> empty state tegas, TIDAK fallback APPROVED
//   C) Tab riwayat Disetujui/Revisi/Ditolak/Semua tetap bisa dibuka eksplisit
//   D) Masuk ulang modul -> reset ke Menunggu
//   E) Perbarui (re-render data baru) -> filter aktif dipertahankan
//   F) Keputusan approval -> baris keluar dari antrean, hitungan konsisten
//   G) Regresi modul lain (filter default & empty state generik)
// Dijalankan oleh run.py di sandbox (mock supabase, tanpa DB).
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// ---------- 1) DOM environment (jsdom dari instalasi global Hermes) ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
// Node 22: globalThis.navigator punya getter-only (NodeDOMException) —
// definisikan lewat defineProperty alih-alih assignment langsung.
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true })
global.HTMLElement = dom.window.HTMLElement
global.SVGElement = dom.window.SVGElement
global.Element = dom.window.Element
global.Node = dom.window.Node
global.Text = dom.window.Text
global.CustomEvent = dom.window.CustomEvent
global.getComputedStyle = dom.window.getComputedStyle
global.requestAnimationFrame = cb => setTimeout(cb, 0)
global.cancelAnimationFrame = id => clearTimeout(id)
// React 18: tandai lingkungan test agar act(...) tidak memunculkan warning
global.IS_REACT_ACT_ENVIRONMENT = true

// ---------- 2) Import hasil kompilasi (React 18: act tersedia) ----------
const React = (await import('react')).default
const { act } = await import('react-dom/test-utils')
const { createRoot } = await import('react-dom/client')
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default

// ---------- 3) Assertion helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

// ---------- 4) Data mock (pola sama dengan pages/__smoke.js) ----------
const noop = () => {}
const noopProps = {
  allProjects: [], allMaterials: [], allPrItems: [], allReceivingItems: [],
  allRequests: [], allReceivings: [], allVendors: [],
  refresh: noop, say: noop, onStatusChange: noop, onReceivingStatusChange: noop,
  onMoveToWarehouse: noop, onSendToTukang: noop, onMarkHandoverDelivered: noop,
  onDecideApproval: noop, onReviseApproval: noop, onApproveItem: noop,
  onFinishPr: noop, onMarkPrItemOrdered: noop, onMarkReceivingItemReceived: noop,
  onUpdateReceivingQty: noop, onDelete: noop, setPage: noop
}

// 3 approval: 1 PENDING + 1 APPROVED + 1 REJECTED (mixed statuses)
const APPROVALS = [
  { id: 'a1', pr_number: 'PR-010', project_name: '[101] Aan - BSD', title: 'Kabinet Atas & Meja Rias', purchase_request_id: 'r10', step_number: 1, status: 'PENDING', note: 'Menunggu persetujuan Direksi / PM untuk PR-010', decided_at: null },
  { id: 'a2', pr_number: 'PR-001', project_name: '[101] Aan - BSD', title: 'Lemari & Credenza', purchase_request_id: 'r1', step_number: 1, status: 'APPROVED', note: 'Disetujui oleh Direksi / PM', decided_at: '2026-10-15T09:00:00Z' },
  { id: 'a3', pr_number: 'PR-005', project_name: '[83] Mabes', title: 'Finishing dapur', purchase_request_id: 'r5', step_number: 1, status: 'REJECTED', note: 'Harga vendor terlalu tinggi', decided_at: '2026-10-14T08:00:00Z' }
]
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'r10', item_name: 'Sealant (Clear)', kode: 'SEA-0001', unit: 'Botol', quantity: 1, status: 'PENDING_APPROVAL' },
  { id: 'pi2', pr_id: 'r10', item_name: 'Thiner', kode: 'THN-0001', unit: 'Liter', quantity: 1, status: 'PENDING_APPROVAL' }
]

function mount(page, rows, extra = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root
  act(() => { root = createRoot(container) })
  function renderWith(props) {
    act(() => { root.render(React.createElement(Module, { page, rows, ...noopProps, ...props })) })
  }
  renderWith(extra)
  return {
    container,
    rerender(next = {}) { renderWith(next) },
    unmount() { act(() => { root.unmount() }); container.remove() }
  }
}

function pillLabels(doc) {
  return Array.from(doc.querySelectorAll('.toolbar .filter-tabs .pill')).map(p => p.textContent.trim())
}
function activePill(doc) {
  return doc.querySelector('.toolbar .filter-tabs .pill.active')?.textContent.trim() || null
}
function bodyText(doc) {
  return doc.body.textContent || ''
}
function desktopRows(doc) {
  return Array.from(doc.querySelectorAll('.desktop-table-view tbody tr')).filter(tr => !tr.querySelector('td.empty'))
}

console.log('=== VERIFIKASI ANTREAN APPROVAL (React client + jsdom, ModuleView.js asli) ===\n')

// ---------- SKENARIO A: default antrean Menunggu ----------
console.log('A. Default antrean — tab pertama "⏳ Menunggu" aktif, riwayat tidak bocor')
{
  const ui = mount('approvals', APPROVALS, { allPrItems: PR_ITEMS, allRequests: [] })
  const doc = document
  const pills = pillLabels(doc)
  check('tab pertama = "⏳ Menunggu (1)"', pills[0] === '⏳ Menunggu (1)', JSON.stringify(pills))
  check('tab aktif = "⏳ Menunggu (1)"', activePill(doc) === '⏳ Menunggu (1)', activePill(doc) || '')
  check('urutan tab: Menunggu → Disetujui → Revisi → Ditolak → Semua',
    pills.join(' | ') === '⏳ Menunggu (1) | ✓ Disetujui (1) | ✎ Revisi (0) | ✕ Ditolak (1) | Semua (3)', JSON.stringify(pills))
  const rows = desktopRows(doc)
  check('hanya 1 baris (PENDING) tampil di default', rows.length === 1, `rows=${rows.length}`)
  check('baris yang tampil = PR-010 (bukan riwayat APPROVED)', bodyText(doc).includes('PR-010') && !rows.some(r => r.textContent.includes('PR-001') || r.textContent.includes('PR-005')), rows.map(r => r.textContent.slice(0, 40)).join(' ;; '))
  check('tombol aksi Setujui/Tolak/Revisi tersedia di antrean', bodyText(doc).includes('✓ Setujui') && bodyText(doc).includes('✕ Tolak') && bodyText(doc).includes('✎ Revisi'))
  check('counter "1 data tersedia" konsisten', bodyText(doc).includes('1 data tersedia'))
  ui.unmount()
}

// ---------- SKENARIO B: zero pending -> empty state tegas ----------
console.log('\nB. Zero pending — empty state tegas, TIDAK fallback ke APPROVED')
{
  const ui = mount('approvals', APPROVALS.filter(a => a.status !== 'PENDING'), { allPrItems: [], allRequests: [] })
  const doc = document
  check('tab "⏳ Menunggu (0)" aktif', activePill(doc) === '⏳ Menunggu (0)', activePill(doc) || '')
  check('empty state "Tidak ada pengajuan yang perlu disetujui." tampil', bodyText(doc).includes('Tidak ada pengajuan yang perlu disetujui.'))
  check('empty state juga tampil di kartu mobile (.mobile-cards-view .empty)', doc.querySelector('.mobile-cards-view .empty')?.textContent.trim() === 'Tidak ada pengajuan yang perlu disetujui.', doc.querySelector('.mobile-cards-view .empty')?.textContent.trim() || 'tidak ada')
  const rows = desktopRows(doc)
  check('TIDAK ada baris riwayat APPROVED/REJECTED bocor ke antrean', rows.length === 0, `rows=${rows.length}`)
  check('counter "0 data tersedia"', bodyText(doc).includes('0 data tersedia'))
  check('badge APPROVED tidak muncul di default', !bodyText(doc).includes('APPROVED'))
  ui.unmount()
}

// ---------- SKENARIO C: tab riwayat tetap bisa dibuka eksplisit ----------
console.log('\nC. Riwayat Disetujui/Revisi/Ditolak/Semua tetap bisa diakses eksplisit')
{
  const ui = mount('approvals', APPROVALS, { allPrItems: PR_ITEMS, allRequests: [] })
  const doc = document
  const clickPill = (label) => {
    const pill = Array.from(doc.querySelectorAll('.toolbar .filter-tabs .pill')).find(p => p.textContent.trim().startsWith(label))
    act(() => { pill.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  }
  clickPill('✓ Disetujui')
  check('tab "✓ Disetujui" jadi aktif setelah diklik', activePill(doc)?.startsWith('✓ Disetujui'), activePill(doc) || '')
  check('riwayat APPROVED tampil utuh saat tab dibuka', desktopRows(doc).some(r => r.textContent.includes('PR-001')))
  check('riwayat PENDING TIDAK tampil di tab Disetujui', !desktopRows(doc).some(r => r.textContent.includes('PR-010')))
  clickPill('✕ Ditolak')
  check('tab "✕ Ditolak" menampilkan PR-005', desktopRows(doc).some(r => r.textContent.includes('PR-005')))
  clickPill('Semua')
  check('tab "Semua" menampilkan 3 baris (tidak ada data terhapus)', desktopRows(doc).length === 3, `rows=${desktopRows(doc).length}`)
  check('tab "Semua" aktif di posisi terakhir', pillLabels(doc)[4] === 'Semua (3)' && activePill(doc) === 'Semua (3)')
  clickPill('⏳ Menunggu')
  check('kembali ke antrean: hanya PENDING tampil', desktopRows(doc).length === 1 && bodyText(doc).includes('PR-010'))
  ui.unmount()
}

// ---------- SKENARIO D: masuk ulang modul -> reset ke Menunggu ----------
console.log('\nD. Masuk ulang modul — antrean reset ke Menunggu')
{
  // Mount permanen dengan page yang bisa berganti (meniru Shell di pages/index.js:
  // ModuleView TIDAK di-unmount saat pindah modul, hanya prop page berubah)
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root
  act(() => { root = createRoot(container) })
  const renderPage = (page, rows) => act(() => { root.render(React.createElement(Module, { page, rows, ...noopProps })) })
  renderPage('approvals', APPROVALS)
  const pill = () => Array.from(document.querySelectorAll('.toolbar .filter-tabs .pill')).find(p => p.textContent.trim().startsWith('✓ Disetujui'))
  act(() => { pill().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  check('pra-syarat: user memilih tab "✓ Disetujui"', activePill(document)?.startsWith('✓ Disetujui'))
  // Pindah ke modul lain lalu masuk Approval lagi
  renderPage('vendors', [{ id: 'v1', name: 'TB Sumber Jaya', phone: '0812', contact: 'x', supplier_category: 'Plywood & Board', store_link: '' }])
  renderPage('approvals', APPROVALS)
  check('setelah masuk ulang, tab aktif kembali "⏳ Menunggu (1)"', activePill(document) === '⏳ Menunggu (1)', activePill(document) || '')
  check('antrean Menunggu tampil (bukan riwayat)', desktopRows(document).length === 1 && bodyText(document).includes('PR-010'))
  // Modul lain juga reset saat dibuka ulang (perilaku lama tetap)
  renderPage('vendors', [{ id: 'v1', name: 'TB Sumber Jaya', phone: '0812', contact: 'x', supplier_category: 'Plywood & Board', store_link: '' }])
  check('modul lain (vendors) tidak terpengaruh perubahan Approval', pillLabels(document).length === 0 || !bodyText(document).includes('⏳ Menunggu'))
  act(() => { root.unmount() }); container.remove()
}

// ---------- SKENARIO E: Perbarui mempertahankan filter aktif ----------
console.log('\nE. Perbarui (data baru via props) — filter aktif dipertahankan')
{
  const ui = mount('approvals', APPROVALS, { allPrItems: PR_ITEMS, allRequests: [] })
  const doc = document
  // User di tab Semua, lalu tombol "↻ Perbarui" di header memuat ulang data (loadAll)
  const semua = Array.from(doc.querySelectorAll('.toolbar .filter-tabs .pill')).find(p => p.textContent.trim() === 'Semua (3)')
  act(() => { semua.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  check('pra-syarat: tab "Semua" aktif', activePill(doc) === 'Semua (3)')
  // loadAll() selesai -> setRows dengan data refresh (status sama + 1 pengajuan baru)
  const refreshed = [...APPROVALS, { id: 'a4', pr_number: 'PR-011', project_name: '[83] Mabes', title: 'Meja kerja', purchase_request_id: 'r11', step_number: 1, status: 'PENDING', note: null, decided_at: null }]
  ui.rerender({ rows: refreshed })
  check('setelah refresh, tab tetap "Semua (4)" (filter dipertahankan)', activePill(doc) === 'Semua (4)', activePill(doc) || '')
  check('data hasil refresh tampil (4 baris)', desktopRows(doc).length === 4, `rows=${desktopRows(doc).length}`)
  // Sama untuk tab antrean: refresh tidak melempar user kembali/default lain
  ui.rerender({ rows: APPROVALS, allPrItems: PR_ITEMS })
  const menunggu = Array.from(doc.querySelectorAll('.toolbar .filter-tabs .pill')).find(p => p.textContent.trim().startsWith('⏳ Menunggu'))
  act(() => { menunggu.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  ui.rerender({ rows: refreshed, allPrItems: PR_ITEMS })
  check('refresh saat di antrean: tetap di "⏳ Menunggu (2)"', activePill(doc) === '⏳ Menunggu (2)', activePill(doc) || '')
  check('2 PENDING tampil setelah refresh', desktopRows(doc).length === 2)
  ui.unmount()
}

// ---------- SKENARIO F: keputusan -> baris keluar dari antrean ----------
console.log('\nF. Keputusan approval — baris keluar dari antrean, hitungan konsisten')
{
  const ui = mount('approvals', APPROVALS, { allPrItems: PR_ITEMS, allRequests: [] })
  const doc = document
  // Direksi menyetujui PR-010 via onDecideApproval -> executeDecision -> loadAll()
  // -> setRows: approval_steps PR-010 jadi APPROVED (baris keluar dari antrean)
  const decided = APPROVALS.map(a => a.id === 'a1' ? { ...a, status: 'APPROVED', decided_at: '2026-10-16T10:00:00Z' } : a)
  ui.rerender({ rows: decided })
  check('tab antrean jadi "⏳ Menunggu (0)"', activePill(doc) === '⏳ Menunggu (0)', activePill(doc) || '')
  check('baris PR-010 keluar dari antrean', desktopRows(doc).length === 0)
  check('empty state tegas muncul (bukan fallback riwayat)', bodyText(doc).includes('Tidak ada pengajuan yang perlu disetujui.'))
  check('hitungan Disetujui naik jadi 2', pillLabels(doc).some(p => p === '✓ Disetujui (2)'), JSON.stringify(pillLabels(doc)))
  check('riwayat masih utuh di tab Disetujui (2 baris)', (() => {
    const pill = Array.from(doc.querySelectorAll('.toolbar .filter-tabs .pill')).find(p => p.textContent.trim() === '✓ Disetujui (2)')
    act(() => { pill.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    return desktopRows(doc).length === 2
  })())
  ui.unmount()
}

// ---------- SKENARIO G: regresi modul lain ----------
console.log('\nG. Regresi modul lain — default filter & empty state tidak berubah')
{
  // Requests: default 'all' tetap menyembunyikan APPROVED (perilaku t_c0a0c3e5)
  const REQUESTS = [
    { id: 'r1', pr_number: 'PR-020', title: 'Material dinding', status: 'DRAFT', priority: 'NORMAL' },
    { id: 'r2', pr_number: 'PR-001', title: 'Lemari & Credenza', status: 'APPROVED', priority: 'NORMAL' }
  ]
  const uiReq = mount('requests', REQUESTS)
  check('requests: default tetap "Semua Aktif"', activePill(document)?.startsWith('Semua Aktif'), activePill(document) || '')
  check('requests: PR APPROVED tetap tersembunyi di default', !desktopRows(document).some(r => r.textContent.includes('PR-001')) && bodyText(document).includes('PR-020'))
  uiReq.unmount()
  // Modul tanpa data: empty state generik tetap "Belum ada data."
  const uiVen = mount('vendors', [])
  check('vendors kosong: empty state generik "Belum ada data." tetap', bodyText(document).includes('Belum ada data.') && !bodyText(document).includes('Tidak ada pengajuan yang perlu disetujui.'))
  uiVen.unmount()
  // Approvals di tab Semua (bukan antrean): empty state generik
  const uiApp = mount('approvals', [])
  const semua = Array.from(document.querySelectorAll('.toolbar .filter-tabs .pill')).find(p => p.textContent.trim() === 'Semua (0)')
  act(() => { semua.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  check('approvals tab Semua kosong: "Belum ada data." (bukan pesan antrean)', bodyText(document).includes('Belum ada data.'))
  uiApp.unmount()
}

console.log(`\n=== HASIL: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA VERIFIKASI ANTREAN APPROVAL LULUS')
