// ============================================================
// VERIFIKASI DAFTAR RINGKAS + SHOW MORE (bit-dev) — t_cf05c96f
// Merender components/ModuleView.js ASLI (hasil transform SWC di dist/)
// dengan React SSR + jsdom INTERAKTIF (createRoot) lalu memeriksa DOM:
//   A) Material 335 rows -> 10 baris + footer Show More + indikator
//   B) Search menemukan item DI LUAR batch awal; tab count full dataset
//   C) Reset limit 10 saat pindah filter tab / sort (klik nyata via jsdom)
//   D) PR master-detail utuh (10 PR pertama, rowSpan tidak terpotong)
//   E) Empty state; <=10 rows tanpa footer; vendor juga ringkas
// Catatan timing: useEffect (passive) di React 18 di-flush sebelum event
// berikutnya di browser nyata — harness meng-await satu tick setiap
// interaksi supaya perilakunya sama seperti browser.
// PENTING URUTAN IMPORT: env jsdom harus dibuat SEBELUM react-dom diimpor —
// plugin ChangeEvent React mem-probe isEventSupported saat module-load; bila
// diimpor lebih dulu (Node global), probe gagal & onChange tidak pernah
// menyala di harness (di app Next.js asli selalu ada DOM browser — aman).
// Dijalankan oleh run.py di sandbox (mock supabase, tanpa DB).
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// ---------- 1) DOM environment dulu (jsdom dari instalasi global Hermes) ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

// ---------- 2) Baru import React & komponen (setelah env siap) ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default

// ---------- 3) Assertion helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

// Satu tick: React 18 mem-flush passive effects (useEffect) di antara task,
// sama seperti urutan event pengguna nyata di browser.
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))

// ---------- 4) Data mock ----------
const noop = () => {}
// 335 material — pola sama dgn screenshot DAT (ALM-… dst), BHP stok menipis
const CATEGORIES = ['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai', 'Lainnya']
const MATERIALS = Array.from({ length: 335 }, (_, i) => {
  const n = i + 1
  const cat = CATEGORIES[i % CATEGORIES.length]
  const isBhp = cat === 'Bahan Habis Pakai'
  return {
    id: `m${n}`, kode: `ALM-${String(n).padStart(4, '0')}`,
    name: `Material Uji ${n} ${cat}`, category: cat,
    qty: n, satuan: 'Meter',
    // BHP: stok 0..4 dari batas min 5 -> sebagian menipis utk banner
    current_stock: isBhp ? (n % 5) : null,
    min_stock: isBhp ? 5 : null,
    harga_acuan: n % 3 === 0 ? 150000 : null
  }
})
// Item pencarian khusus: hanya ada di luar 10 baris pertama (indeks 320)
MATERIALS[320].name = 'ZEBRA-UNIK-DILUAR-BATCH-AWAL Plywood kayu hitam'
const VENDORS = Array.from({ length: 23 }, (_, i) => ({
  id: `v${i + 1}`, name: `Vendor Uji ${i + 1}`, phone: '08123', supplier_category: 'Plywood & Board', store_link: ''
}))
// 17 PR, masing-masing 3 item (master-detail desktop = 3 baris fisik per PR);
// PR-16 sudah APPROVED ( disembunyikan tab default 'all' — perilaku t_c0a0c3e5)
const PR_ITEMS = []
const REQUESTS = Array.from({ length: 17 }, (_, i) => {
  const id = `pr${i + 1}`
  for (let j = 0; j < 3; j++) {
    PR_ITEMS.push({ id: `it${i + 1}-${j}`, pr_id: id, item_name: `Item ${i + 1}.${j + 1}`, quantity: j + 1, unit: 'Lbr', status: 'PENDING', vendor_id: null, material_id: null, estimated_price: null })
  }
  return { id, pr_number: `PR-${String(i + 1).padStart(3, '0')}`, title: `Permintaan ${i + 1}`, status: i === 15 ? 'APPROVED' : 'DRAFT', priority: 'NORMAL', project_id: 'p1', project_name: '[99] Baroni', materials_summary: '', notes: '', created_at: '2026-10-01T00:00:00Z' }
})
const PROJECTS = [{ id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING', created_at: '2026-10-01T00:00:00Z' }]
// 12 approval PENDING utk uji perluasan material tidak terpotong
const APPROVALS = Array.from({ length: 12 }, (_, i) => ({
  id: `pr${i + 1}`, pr_number: `PR-${String(i + 1).padStart(3, '0')}`, title: `Permintaan ${i + 1}`,
  status: 'PENDING', priority: 'NORMAL', project_id: 'p1', project_name: '[99] Baroni',
  purchase_request_id: `pr${i + 1}`, note: '', decided_at: null
}))

function mount(page, rows, extra = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22: global navigator read-only */ }
  const props = {
    page, rows,
    allProjects: PROJECTS, allMaterials: MATERIALS,
    allPrItems: PR_ITEMS, allReceivingItems: [], allRequests: REQUESTS,
    allReceivings: [], allVendors: VENDORS,
    refresh: noop, say: noop, onDelete: noop, setPage: noop,
    // Aksi per-item Approval (t_7634fa92): drawer hanya merender tombol bila
    // callback tersedia (fail-closed). Lihat catatan di blok D.
    onApproveItem: noop, onMarkPrItemOrdered: noop,
    onDecideApproval: noop, onReviseApproval: noop, ...extra
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, root, document, props }
}

const tbodyRows = (document) => document.querySelectorAll('.desktop-table-view tbody tr').length
const footerOf = (document) => document.querySelector('.list-show-more')
const footerText = (document) => (footerOf(document)?.textContent || '')
const showMoreBtn = (document) => [...document.querySelectorAll('.list-show-more-actions button')].find(b => b.textContent.includes('Show More'))
const ringkasBtn = (document) => [...document.querySelectorAll('.list-show-more-actions button')].find(b => b.textContent.includes('Ringkas'))
const typeSearch = (document, q) => {
  const input = document.querySelector('.toolbar .search-input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, q)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
}

console.log('=== VERIFIKASI DAFTAR RINGKAS + SHOW MORE (React SSR/jsdom interaktif, ModuleView.js asli) ===\n')

// ---------- A. MATERIAL 335 ROWS (screenshot DAT) ----------
console.log('A. Material 335 data — default ringkas 10 + Show More')
{
  const { document } = mount('materials', MATERIALS)
  await tick()
  check('tabel hanya merender 10 baris (bukan 335)', tbodyRows(document) === 10, `got ${tbodyRows(document)}`)
  check('kartu mobile juga 10', document.querySelectorAll('.mobile-card').length === 10)
  check('footer .list-show-more ada', !!footerOf(document))
  check('indikator "Menampilkan 10 dari 335"', footerText(document).includes('Menampilkan 10 dari 335'), footerText(document))
  check('tombol "Show More / Tampilkan Lebih Banyak" ada', !!showMoreBtn(document))
  check('tombol "Ringkas" TIDAK ada di awal (masih di batch pertama)', !ringkasBtn(document))
  check('baris ke-11 TIDAK dirender', !(document.body.textContent || '').includes('Material Uji 11 '))
  check('data baris ke-10 ada', (document.body.textContent || '').includes('Material Uji 10 '))
  // Counter & tab & banner pakai dataset PENUH
  const toolbarText = document.querySelector('.toolbar')?.textContent || ''
  check('counter "335 data tersedia" memakai dataset penuh', toolbarText.includes('335 data tersedia'))
  check('tab "Semua (335)" memakai dataset penuh', toolbarText.includes('Semua (335)'))
  // Banner stok menipis dihitung dari seluruh BHP dataset penuh (bukan 10 teratas)
  const bhpMenipis = MATERIALS.filter(m => m.category === 'Bahan Habis Pakai' && m.current_stock <= m.min_stock).length
  check(`banner stok menipis dari dataset penuh (${bhpMenipis})`, (document.body.textContent || '').includes(`${bhpMenipis} bahan habis pakai`))
}

// ---------- A2. INTERAKSI Show More & Ringkas ----------
console.log('\nA2. Klik Show More (+10) lalu Ringkas (klik nyata via jsdom)')
{
  const { document } = mount('materials', MATERIALS)
  await tick()
  check('awal: 10 baris', tbodyRows(document) === 10)
  click(showMoreBtn(document))
  await tick()
  check('klik 1: 20 baris', tbodyRows(document) === 20, `got ${tbodyRows(document)}`)
  check('indikator jadi "Menampilkan 20 dari 335"', footerText(document).includes('Menampilkan 20 dari 335'), footerText(document))
  check('tombol "Ringkas" muncul setelah expand', !!ringkasBtn(document))
  click(showMoreBtn(document))
  await tick()
  check('klik 2: 30 baris', tbodyRows(document) === 30, `got ${tbodyRows(document)}`)
  // Klik sampai habis: 335 -> footer HILANG saat semua tampil
  for (let k = 0; k < 40; k++) {
    const b = showMoreBtn(document)
    if (!b) break
    click(b)
    await tick()
  }
  check('klik berulang sampai habis: 335 baris semua tampil', tbodyRows(document) === 335, `got ${tbodyRows(document)}`)
  check('footer Show More HILANG saat semua data tampil', !footerOf(document))
  // Ringkas kembali ke 10
  const { document: doc2 } = mount('materials', MATERIALS)
  await tick()
  click(showMoreBtn(doc2)); await tick()
  click(ringkasBtn(doc2)); await tick()
  check('"Ringkas" kembali ke 10 baris', tbodyRows(doc2) === 10, `got ${tbodyRows(doc2)}`)
  check('indikator kembali "Menampilkan 10 dari 335"', footerText(doc2).includes('Menampilkan 10 dari 335'), footerText(doc2))
}

// ---------- B. SEARCH DI LUAR BATCH AWAL ----------
console.log('\nB. Search menemukan item DI LUAR 10 baris pertama (filter di seluruh dataset)')
{
  const { document } = mount('materials', MATERIALS)
  await tick()
  typeSearch(document, 'ZEBRA-UNIK-DILUAR-BATCH-AWAL')
  await tick()
  const rows = tbodyRows(document)
  const text = document.body.textContent || ''
  check('item di luar batch awal DITEMUKAN (1 baris muncul)', rows === 1 && text.includes('ZEBRA-UNIK-DILUAR-BATCH-AWAL'), `rows=${rows}`)
  check('tanpa footer Show More saat hasil <= 10', !footerOf(document))
  check('counter hasil pencarian "1 data tersedia"', (document.querySelector('.toolbar')?.textContent || '').includes('1 data tersedia'))
}

// ---------- C. RESET LIMIT SAAT FILTER / SORT BERUBAH ----------
console.log('\nC. Reset ke 10 saat pindah filter tab & saat sort (klik nyata)')
{
  const { document } = mount('materials', MATERIALS)
  await tick()
  // Expand dulu sampai 30
  click(showMoreBtn(document)); await tick()
  click(showMoreBtn(document)); await tick()
  check('pra-uji: 30 baris setelah 2x Show More', tbodyRows(document) === 30, `got ${tbodyRows(document)}`)
  // Klik pill "Hardware & Fitting" (filter kategori)
  const pill = [...document.querySelectorAll('.toolbar .pill')].find(p => p.textContent.includes('Hardware & Fitting'))
  click(pill); await tick()
  check('ganti filter: baris kembali ke 10', tbodyRows(document) === 10, `got ${tbodyRows(document)}`)
  check('filter kategori: 67 data (335/5 kategori)', (document.querySelector('.toolbar')?.textContent || '').includes('67 data tersedia'), document.querySelector('.toolbar')?.textContent)
  check('tab count kategori memakai dataset penuh: "Hardware & Fitting (67)"', (document.querySelector('.toolbar')?.textContent || '').includes('Hardware & Fitting (67)'))
  check('footer muncul lagi setelah reset (67 > 10)', !!footerOf(document))
  // Sort reset
  click(showMoreBtn(document)); await tick()
  check('pra-uji sort: 20 baris', tbodyRows(document) === 20, `got ${tbodyRows(document)}`)
  // Sort reset: kolom "Kode" sudah digabung ke sublabel (t_31871b64) —
  // urut-by-kode sekarang lewat tombol .cell-kode-sub, bukan header.
  const kodeBtn = document.querySelector('.desktop-table-view .cell-kode-sub')
  click(kodeBtn); await tick()
  check('klik urut kode: limit kembali 10', tbodyRows(document) === 10, `got ${tbodyRows(document)}`)
  // Sort KODE asc di atas list hasil filter kategori = ALM-0003, 0008, … (bukan ALM-0001
  // yg kategorinya lain) — bukti sortir dijalankan di SELURUH list hasil filter.
  check('sort kode asc: baris pertama "ALM-0003" (list hasil filter)', (document.querySelector('.desktop-table-view tbody tr td')?.textContent || '').includes('ALM-0003'), document.querySelector('.desktop-table-view tbody tr td')?.textContent)
  check('footer tetap ada setelah sort (67 data, tampil 10)', footerText(document).includes('Menampilkan 10 dari 67'), footerText(document))
}

// ---------- D. PARENT-CHILD TIDAK TERPOTONG (PR & APPROVAL) ----------
console.log('\nD. PR master-detail & perluasan Approval tetap utuh')
{
  // CATATAN t_ac0b39c0 (estimator PR): setiap PR kini punya +1 baris fisik
  // "Total Estimasi" (tr.pr-est-total-row) di bawah item-nya — SNAPSHOT harga
  // tersimpan. Parent tetap 10 PR (Show More tetap memotong per parent, tidak
  // di tengah PR); jumlah fisik = 10×(3 item + 1 total) = 40. Panel perluasan
  // Approval juga +1 baris total di dalam nested table (3 item + 1 total = 4).
  // CATATAN t_48f6b336 (grouping kategori): item mock TANPA material_id →
  // masing-masing PR punya 1 heading "Belum Berkategori" → fisik = 10×(3 item
  // + 1 heading + 1 total) = 50. Kontrak Show More tetap: potong per PARENT.
  const { document } = mount('requests', REQUESTS)
  await tick()
  // Tab default 'all' menyembunyikan PR-16 (APPROVED) -> 16 PR terfilter;
  // tampil 10 PR pertama x (3 item + 1 heading + 1 total) = 50 baris fisik utuh
  check('10 PR pertama tampil utuh (50 baris fisik = 10×(3 item+1 heading+1 total))', tbodyRows(document) === 50, `got ${tbodyRows(document)}`)
  check('baris total estimasi tepat 10 (1 per PR, tidak bocor ke PR-11)',
    document.querySelectorAll('tr.pr-est-total-row').length === 10,
    String(document.querySelectorAll('tr.pr-est-total-row').length))
  check('PR-11 tidak tampil (judul 10 PR pertama lengkap, tanpa PR-11)',
    (document.body.textContent || '').includes('Permintaan 10')
    && ![...document.querySelectorAll('.pr-title-cell')].map(e => e.textContent.trim()).includes('Permintaan 11'))
  check('indikator "Menampilkan 10 dari 16" (1 PR approved disembunyikan filter)', footerText(document).includes('Menampilkan 10 dari 16'), footerText(document))
  check('tab "Semua Aktif (16)" memakai dataset penuh', (document.querySelector('.toolbar')?.textContent || '').includes('Semua Aktif (16)'), document.querySelector('.toolbar')?.textContent || '')

  const { document: docA } = mount('approvals', APPROVALS, { allRequests: APPROVALS })
  await tick()
  // Rincian material Approval dibuka lewat DRAWER (kontrak compact S1,
  // t_ff02257a) — bukan panel perluasan tbody. PR ke-5 di dalam batch 10
  // pertama tetap bisa dibuka, dan baris TABEL UTAMA tidak bertambah sama
  // sekali (drawer = portal di document.body), jadi hitungan baris 10 PR
  // tidak boleh terpengaruh.
  const detailBtns = [...docA.querySelectorAll('.desktop-table-view button')].filter(b => (b.textContent || '').includes('Rincian'))
  // Hanya desktop-table-view yang dihitung: kartu mobile punya tombol
  // "≡ Rincian" sendiri (jumlah total = 10 desktop + 10 mobile).
  check('setiap baris Approval desktop punya jangkar "≡ Rincian" (10 batch pertama)', detailBtns.length === 10, `n=${detailBtns.length}`)
  const expandBtn = detailBtns[4]
  click(expandBtn); await tick()
  const dlg = docA.querySelector('[role="dialog"]')
  check('rincian material approval tetap bisa dibuka di dalam batch 10',
    !!dlg && (dlg.textContent || '').includes('RINCIAN MATERIAL'))
  check('aksi per-item tetap terjangkau dari drawer',
    !!dlg && (dlg.textContent || '').includes('✓ Setujui'))
  // Baris tabel utama = 10 PR compact (1 baris per PR). Drawer TIDAK menambah
  // baris karena portal berada di document.body, bukan di tbody.
  const allTr = [...docA.querySelectorAll('.desktop-table-view table tbody tr')]
  const topTr = allTr.filter(tr => !tr.closest('table table')).length
  check('baris tabel utama = 10 (compact 1 baris/PR; drawer tidak menambah baris)', topTr === 10, `got ${topTr}`)
  // Grup kategori + subtotal + Total Estimasi hidup di drawer.
  check('drawer memuat grup kategori + Total Estimasi (bukan hilang bersama panel lama)',
    !!dlg && (dlg.textContent || '').includes('Total Estimasi') && docA.querySelectorAll('.ap-group-heading').length > 0)
  check('footer approval dari hasil filter penuh: "Menampilkan 10 dari 12"', footerText(docA).includes('Menampilkan 10 dari 12'), footerText(docA))
  check('tab approval dari dataset penuh: "⏳ Menunggu (12)"', (docA.querySelector('.toolbar')?.textContent || '').includes('Menunggu (12)'), docA.querySelector('.toolbar')?.textContent || '')
}

// ---------- E. EMPTY STATE, <=10 TANPA FOOTER, VENDOR ----------
console.log('\nE. Empty state, daftar pendek tanpa footer, vendor juga ringkas')
{
  const { document } = mount('materials', MATERIALS)
  await tick()
  typeSearch(document, 'TIDAK-ADA-GINIINIH-XYZ')
  await tick()
  check('empty state tetap tampil saat search tanpa hasil', (document.body.textContent || '').includes('Belum ada data.'))
  check('empty state: TANPA footer Show More', !footerOf(document))

  const { document: docV } = mount('vendors', VENDORS)
  await tick()
  check('vendor 23 data -> 10 baris + footer', tbodyRows(docV) === 10 && footerText(docV).includes('Menampilkan 10 dari 23'), `rows=${tbodyRows(docV)}`)
  check('vendor: toolbar tetap tanpa counter/pill (regresi vendors-toolbar)', !(docV.querySelector('.toolbar')?.textContent || '').includes('data tersedia') && !docV.querySelector('.toolbar .pill'))

  // 10 data persis -> TANPA footer
  const EXACT10 = VENDORS.slice(0, 10)
  const { document: doc10 } = mount('vendors', EXACT10)
  await tick()
  check('tepat 10 data: semua tampil TANPA footer', tbodyRows(doc10) === 10 && !footerOf(doc10))

  // 0 data -> tanpa footer + empty state (empty state tabel = td.empty di dalam tr,
  // kartu mobile = .panel.empty — cek keduanya sesuai mode tampilan)
  const { document: doc0 } = mount('vendors', [])
  await tick()
  const emptyTd = doc0.querySelector('.desktop-table-view tbody td.empty')
  const emptyPanel = doc0.querySelector('.mobile-cards-view .panel.empty')
  check('0 data: empty state desktop & mobile, tanpa footer', !!emptyTd && !!emptyPanel && !footerOf(doc0) && (emptyTd.textContent || '').includes('Belum ada data.'))
}

console.log(`\n=== HASIL: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA VERIFIKASI SHOW MORE LULUS')
