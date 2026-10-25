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
//   H) CATATAN (t_1fe52e80): approval baru tanpa note, legacy auto-seed
//      exact-pattern tampil dash, catatan pengguna TIDAK pernah disembunyikan
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

// 4 approval: 1 PENDING baru (tanpa note) + 1 PENDING legacy (auto-seed) +
// 1 APPROVED + 1 REJECTED (mixed statuses). t_1fe52e80: approval baru dibuat
// TANPA note (null) — teks "Menunggu persetujuan..." hanya ada di data legacy.
// t_48f6b336: desktop Approval kini row-per-child (master-detail dgn grup
// kategori) — hitungan ASSERTION pakai PR unik (noPR), bukan baris fisik.
const APPROVALS = [
  { id: 'a1', pr_number: 'PR-010', project_name: '[101] Aan - BSD', title: 'Kabinet Atas & Meja Rias', purchase_request_id: 'r10', step_number: 1, status: 'PENDING', note: null, decided_at: null },
  { id: 'a4', pr_number: 'PR-012', project_name: '[55] Gudang Lama', title: 'Pintu & Kusen', purchase_request_id: 'r12', step_number: 1, status: 'PENDING', note: 'Menunggu persetujuan Direksi / PM untuk PR-012', decided_at: null },
  { id: 'a2', pr_number: 'PR-001', project_name: '[101] Aan - BSD', title: 'Lemari & Credenza', purchase_request_id: 'r1', step_number: 1, status: 'APPROVED', note: 'Disetujui oleh Direksi / PM', decided_at: '2026-10-15T09:00:00Z' },
  { id: 'a3', pr_number: 'PR-005', project_name: '[83] Mabes', title: 'Finishing dapur', purchase_request_id: 'r5', step_number: 1, status: 'REJECTED', note: 'Harga vendor terlalu tinggi', decided_at: '2026-10-14T08:00:00Z' }
]
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'r10', item_name: 'Sealant (Clear)', kode: 'SEA-0001', unit: 'Botol', quantity: 1, status: 'PENDING_APPROVAL' },
  { id: 'pi2', pr_id: 'r10', item_name: 'Thiner', kode: 'THN-0001', unit: 'Liter', quantity: 1, status: 'PENDING_APPROVAL' },
  // H.3/H.4 (drawer detail compact S1): riwayat PR-001/PR-005 butuh item tampil
  // di drawer (jangkar "≡ Rincian" hanya dirender bila item > 0). Harga
  // snapshot diisi agar subtotal & Total Estimasi drawer punya nilai valid.
  { id: 'pi3', pr_id: 'r1', item_name: 'Lemari papan', kode: 'PLY-0001', unit: 'Lbr', quantity: 2, estimated_price: 450000, status: 'APPROVED' },
  { id: 'pi4', pr_id: 'r5', item_name: 'Cat duco putih', kode: 'PNT-0001', unit: 'Kaleng', quantity: 3, estimated_price: 120000, status: 'REJECTED' }
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
// t_48f6b336: hitung PR UNIK — bukan baris fisik (kini 1 PR = beberapa baris:
// heading grup + item + total). PR dgn rincian = sel parent rowSpan; PR legacy
// tanpa rincian = baris tunggal (kolom pertama berisi No.PR).
function parentPRs(doc) {
  const prs = new Set()
  for (const tr of doc.querySelectorAll('.desktop-table-view tbody tr')) {
    if (tr.querySelector('td.empty')) continue
    const spanned = [...tr.querySelectorAll('td[rowspan]')].map(td => td.textContent.trim()).find(t => /^PR-/.test(t))
    if (spanned) { prs.add(spanned); continue }
    const first = tr.querySelector('td')?.textContent.trim()
    if (first && /^PR-/.test(first)) prs.add(first)
  }
  return prs
}

console.log('=== VERIFIKASI ANTREAN APPROVAL (React client + jsdom, ModuleView.js asli) ===\n')

// ---------- SKENARIO A: default antrean Menunggu ----------
console.log('A. Default antrean — tab pertama "⏳ Menunggu" aktif, riwayat tidak bocor')
{
  const ui = mount('approvals', APPROVALS, { allPrItems: PR_ITEMS, allRequests: [] })
  const doc = document
  const pills = pillLabels(doc)
  check('tab pertama = "⏳ Menunggu (2)"', pills[0] === '⏳ Menunggu (2)', JSON.stringify(pills))
  check('tab aktif = "⏳ Menunggu (2)"', activePill(doc) === '⏳ Menunggu (2)', activePill(doc) || '')
  check('urutan tab: Menunggu → Disetujui → Revisi → Ditolak → Semua',
    pills.join(' | ') === '⏳ Menunggu (2) | ✓ Disetujui (1) | ✎ Revisi (0) | ✕ Ditolak (1) | Semua (4)', JSON.stringify(pills))
  const rows = desktopRows(doc)
  check('hanya 2 PR (PENDING) tampil di default', parentPRs(doc).size === 2 && [...parentPRs(doc)].join('|').includes('PR-010'), `rows=${rows.length} prs=${[...parentPRs(doc)].join('|')}`)
  // NEGATIF (t_ff02257a S1): Total Estimasi snapshot PR-010 = 2 item TANPA
  // harga → total 0 HARUS dilabel "belum lengkap", BUKAN diklaim lengkap.
  const rowEst = desktopRows(doc).find(r => r.textContent.includes('PR-010'))
  check('negatif: total parsial TIDAK diklaim lengkap (baris desktop compact)',
    !!rowEst && rowEst.textContent.includes('belum lengkap') && rowEst.textContent.includes('2 item belum ada harga'),
    rowEst ? rowEst.textContent.slice(0, 90) : 'baris PR-010 tidak ketemu')
  check('baris yang tampil = PR-010 & PR-012 (bukan riwayat APPROVED)', bodyText(doc).includes('PR-010') && bodyText(doc).includes('PR-012') && !rows.some(r => r.textContent.includes('PR-001') || r.textContent.includes('PR-005')), rows.map(r => r.textContent.slice(0, 40)).join(' ;; '))
  check('tombol aksi Setujui/Tolak/Revisi tersedia di antrean', bodyText(doc).includes('✓ Setujui') && bodyText(doc).includes('✕ Tolak') && bodyText(doc).includes('✎ Revisi'))
  check('counter "2 data tersedia" konsisten', bodyText(doc).includes('2 data tersedia'))
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
  check('tab "Semua" menampilkan 4 PR (tidak ada data terhapus)', parentPRs(doc).size === 4, `prs=${[...parentPRs(doc)].join('|')}`)
  check('tab "Semua" aktif di posisi terakhir', pillLabels(doc)[4] === 'Semua (4)' && activePill(doc) === 'Semua (4)')
  clickPill('⏳ Menunggu')
  check('kembali ke antrean: hanya PENDING tampil', parentPRs(doc).size === 2 && bodyText(doc).includes('PR-010'))
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
  check('setelah masuk ulang, tab aktif kembali "⏳ Menunggu (2)"', activePill(document) === '⏳ Menunggu (2)', activePill(document) || '')
  check('antrean Menunggu tampil (bukan riwayat)', parentPRs(document).size === 2 && bodyText(document).includes('PR-010'))
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
  const semua = Array.from(doc.querySelectorAll('.toolbar .filter-tabs .pill')).find(p => p.textContent.trim() === 'Semua (4)')
  act(() => { semua.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  check('pra-syarat: tab "Semua" aktif', activePill(doc) === 'Semua (4)')
  // loadAll() selesai -> setRows dengan data refresh (status sama + 1 pengajuan baru)
  const refreshed = [...APPROVALS, { id: 'a5', pr_number: 'PR-011', project_name: '[83] Mabes', title: 'Meja kerja', purchase_request_id: 'r11', step_number: 1, status: 'PENDING', note: null, decided_at: null }]
  ui.rerender({ rows: refreshed })
  check('setelah refresh, tab tetap "Semua (5)" (filter dipertahankan)', activePill(doc) === 'Semua (5)', activePill(doc) || '')
  check('data hasil refresh tampil (5 PR)', parentPRs(doc).size === 5, `prs=${[...parentPRs(doc)].join('|')}`)
  // Sama untuk tab antrean: refresh tidak melempar user kembali/default lain
  ui.rerender({ rows: APPROVALS, allPrItems: PR_ITEMS })
  const menunggu = Array.from(doc.querySelectorAll('.toolbar .filter-tabs .pill')).find(p => p.textContent.trim().startsWith('⏳ Menunggu'))
  act(() => { menunggu.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  ui.rerender({ rows: refreshed, allPrItems: PR_ITEMS })
  check('refresh saat di antrean: tetap di "⏳ Menunggu (3)"', activePill(doc) === '⏳ Menunggu (3)', activePill(doc) || '')
  check('3 PENDING tampil setelah refresh', parentPRs(doc).size === 3)
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
  check('tab antrean jadi "⏳ Menunggu (1)"', activePill(doc) === '⏳ Menunggu (1)', activePill(doc) || '')
  check('baris PR-010 keluar dari antrean', !desktopRows(doc).some(r => r.textContent.includes('PR-010')))
  check('PR-012 masih di antrean (data legacy tidak dihapus)', desktopRows(doc).some(r => r.textContent.includes('PR-012')))
  check('empty state TIDAK muncul (masih ada 1 pending)', !bodyText(doc).includes('Tidak ada pengajuan yang perlu disetujui.'))
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

// ---------- SKENARIO H: catatan — t_1fe52e80 ----------
console.log('\nH. CATATAN — approval baru null, legacy auto-seed dash, catatan pengguna utuh')
{
  const ui = mount('approvals', APPROVALS, { allPrItems: PR_ITEMS, allRequests: [] })
  const doc = document
  const clickPill = (label) => {
    const pill = Array.from(doc.querySelectorAll('.toolbar .filter-tabs .pill')).find(p => p.textContent.trim().startsWith(label))
    act(() => { pill.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  }

  // H.1 — Approval baru (a1, note null): daftar COMPACT tidak punya kolom
  //       Catatan (catatan keputusan dibaca di drawer detail). Yang WAJIB
  //       benar: teks auto "Menunggu persetujuan…" TIDAK muncul di antrean,
  //       dan drawer menampilkan dash untuk catatan kosong.
  //       CATATAN t_7634fa92: asersi lama (ada <td> berisi "—") lolos SECARA
  //       KEBETULAN karena baris compact versi port punya kolom hantu
  //       (decided_at = "—"). Setelah kolom hantu dihapus, asersi itu diuji
  //       ulang ke kontrak sebenarnya (drawer), bukan dilonggarkan.
  const rowBaru = desktopRows(doc).find(r => r.textContent.includes('PR-010'))
  check('H.1a baris approval baru ada di antrean', !!rowBaru)
  check('H.1b teks auto "Menunggu persetujuan" TIDAK tampil di antrean', !bodyText(doc).includes('Menunggu persetujuan Direksi'))
  check('H.1c daftar compact TIDAK memuat kolom Catatan (pindah ke drawer)',
    ![...doc.querySelectorAll('.desktop-table-view thead th')].some(th => /catatan/i.test(th.textContent || '')),
    JSON.stringify([...doc.querySelectorAll('.desktop-table-view thead th')].map(t => (t.textContent || '').trim())))

  // H.2 — Legacy auto-seed (a4): teks exact-pattern tampil dash, baris tetap ada.
  const rowLegacy = desktopRows(doc).find(r => r.textContent.includes('PR-012'))
  check('H.2a baris legacy PR-012 TETAP tampil di antrean (tidak ada penghapusan data)', !!rowLegacy)
  check('H.2b teks auto legacy TIDAK bocor ke daftar (tetap disembunyikan)',
    !bodyText(doc).includes('Menunggu persetujuan Direksi'))

  // H.3 — Catatan keputusan pengguna tetap tersedia. KONTRAK COMPACT S1
  //       (t_ff02257a): kolom teknis (note) tidak lagi di tabel daftar —
  //       catatan keputusan dibaca lewat DRAWER DETAIL (portal document.body)
  //       yang dibuka dari jangkar "≡ Rincian" di baris.
  clickPill('✓ Disetujui')
  const rowSetuju = desktopRows(doc).find(r => r.textContent.includes('PR-001'))
  const rincianSetuju = rowSetuju && Array.from(rowSetuju.querySelectorAll('button')).find(b => b.textContent.includes('Rincian'))
  act(() => { rincianSetuju.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  const drawerSetuju = Array.from(document.querySelectorAll('[role="dialog"]')).find(d => d.textContent.includes('PR-001'))
  check('H.3 catatan keputusan pengguna tersedia utuh di drawer detail (compact S1)', !!drawerSetuju && drawerSetuju.textContent.includes('Disetujui oleh Direksi / PM'), drawerSetuju ? drawerSetuju.textContent.slice(0, 120) : 'drawer tidak terbuka')
  act(() => { Array.from(drawerSetuju.querySelectorAll('button')).find(b => b.textContent.includes('Tutup')).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  check('H.3c drawer tertutup tombol ✕ Tutup', !Array.from(document.querySelectorAll('[role="dialog"]')).some(d => d.textContent.includes('PR-001')), 'drawer masih terbuka')

  // H.4 — Catatan penolakan (REJECTED, punya decided_at) tetap terbuka meski
  //       teksnya mengandung kata "Menunggu" — kata saja TIDAK menyembunyikan
  //       catatan pengguna; hanya exact-pattern auto-seed pending yang diganti
  //       dash (isLegacyAutoNote, H.6). Akses via drawer (kontrak compact S1).
  clickPill('✕ Ditolak')
  const rowTolak = desktopRows(doc).find(r => r.textContent.includes('PR-005'))
  const rincianTolak = rowTolak && Array.from(rowTolak.querySelectorAll('button')).find(b => b.textContent.includes('Rincian'))
  act(() => { rincianTolak.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  const drawerTolak = Array.from(document.querySelectorAll('[role="dialog"]')).find(d => d.textContent.includes('PR-005'))
  check('H.4 catatan pengguna yg mengandung kata \"Menunggu\" TIDAK disembunyikan (drawer detail)', !!drawerTolak && drawerTolak.textContent.includes('Harga vendor terlalu tinggi'), drawerTolak ? drawerTolak.textContent.slice(0, 120) : 'drawer tidak terbuka')
  act(() => { Array.from(drawerTolak.querySelectorAll('button')).find(b => b.textContent.includes('Tutup')).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  check('H.4b drawer Ditolak tertutup', !Array.from(document.querySelectorAll('[role="dialog"]')).some(d => d.textContent.includes('PR-005')), 'drawer masih terbuka')

  // H.5 — Kartu mobile: approval baru & legacy pending = TANPA blok Catatan
  //       (desain antrean mobile BitDev: blok dash hanya untuk riwayat);
  //       keduanya harus tampil IDENTIK — legacy tidak diistimewakan.
  clickPill('⏳ Menunggu')
  const cards = Array.from(doc.querySelectorAll('.mobile-cards-view .mobile-card'))
  const cardBaru = cards.find(c => c.textContent.includes('PR-010'))
  const cardLegacy = cards.find(c => c.textContent.includes('PR-012'))
  const catatanBaru = cardBaru?.querySelector('.mobile-card-note')
  const catatanLegacy = cardLegacy?.querySelector('.mobile-card-note')
  check('H.5a kartu mobile approval baru TIDAK punya blok Catatan', !!cardBaru && !catatanBaru, catatanBaru ? catatanBaru.textContent : 'ok')
  check('H.5b kartu mobile legacy pending = persis seperti approval baru (tanpa blok Catatan, bukan teks auto)', !!cardLegacy && !catatanLegacy, catatanLegacy ? catatanLegacy.textContent : 'ok')

  // H.5c — Riwayat (sudah diputuskan) tanpa catatan TETAP tampil dash di mobile
  //        (perilaku lama dipertahankan; hanya pending yang sengaja polos).
  ui.unmount()
  const ui2 = mount('approvals', [{ ...APPROVALS.find(a => a.id === 'a2'), note: null }], { allPrItems: [], allRequests: [] })
  clickPill('✓ Disetujui')
  const cardRiwayat = Array.from(doc.querySelectorAll('.mobile-cards-view .mobile-card'))[0]
  const blokRiwayat = cardRiwayat?.querySelector('.mobile-card-note')
  check('H.5c kartu mobile riwayat tanpa catatan = blok dash "—" (perilaku lama utuh)', !!blokRiwayat && blokRiwayat.textContent.includes('—'), blokRiwayat ? blokRiwayat.textContent : 'tidak ada blok')
  ui2.unmount()

  // H.6 — Helper deteksi legacy (unit langsung dari modules/approvals/view).
  const { isLegacyAutoNote, displayNote } = await import(pathToFileURL(path.join(SB, 'dist/modules/approvals/view.mjs')).href)
  check('H.6a isLegacyAutoNote: legacy exact-pattern = true', isLegacyAutoNote({ note: 'Menunggu persetujuan Direksi / PM untuk PR-012', step_number: 1, decided_at: null }) === true)
  check('H.6b isLegacyAutoNote: catatan pengguna mengandung frasa = false (jangan sembunyikan)', isLegacyAutoNote({ note: 'Masih Menunggu persetujuan Direksi / PM untuk PR-012, mohon cepat', step_number: 1, decided_at: null }) === false)
  check('H.6c isLegacyAutoNote: exact match tapi sudah diputuskan (decided_at) = false', isLegacyAutoNote({ note: 'Menunggu persetujuan Direksi / PM untuk PR-001', step_number: 1, decided_at: '2026-10-15T09:00:00Z' }) === false)
  check('H.6d isLegacyAutoNote: exact match tapi step_number != 1 = false', isLegacyAutoNote({ note: 'Menunggu persetujuan Direksi / PM untuk PR-002', step_number: 2, decided_at: null }) === false)
  check('H.6e displayNote: approval baru null -> null (dash)', displayNote({ note: null, step_number: 1, decided_at: null }) === null)
  check('H.6f displayNote: catatan pengguna -> utuh apa adanya', displayNote({ note: 'Tolong cek ulang qty', step_number: 1, decided_at: null }) === 'Tolong cek ulang qty')
  check('H.6g isLegacyAutoNote: whitespace berbeda pada pola sama (trim) = true', isLegacyAutoNote({ note: '  Menunggu persetujuan Direksi / PM untuk PR-003  ', step_number: 1, decided_at: null }) === true)
  check('H.6h isLegacyAutoNote: "PR" tanpa nomor (fallback template lama) = true', isLegacyAutoNote({ note: 'Menunggu persetujuan Direksi / PM untuk PR', step_number: 1, decided_at: null }) === true)

  ui.unmount()
}

console.log(`\n=== HASIL: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA VERIFIKASI ANTREAN APPROVAL LULUS')
