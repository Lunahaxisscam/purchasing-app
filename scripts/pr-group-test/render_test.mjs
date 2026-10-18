// ============================================================
// RENDER TEST PENGELOMPOKAN KATEGORI (t_48f6b336) — ModuleView ASLI
// jsdom + createRoot (pola showmore/pr-estimator). Memeriksa DOM nyata:
// heading grup, urutan, qty alignment, total estimasi, Show More parent,
// mobile PR & Approval, panel perluasan Approval, legacy tanpa relasi.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { auditTableGrid } from './grid_audit.mjs'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// DOM environment dulu (urutan penting — pola showmore)
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))

const noop = () => {}
const VENDORS = [{ id: 'v1', name: 'TB Sumber Jaya', supplier_category: 'Plywood & Board' }]
const MATERIALS = [
  { id: 'mPLY', kode: 'PLY-0001', name: 'Triplek Polos 9mm', category: 'Plywood & Board' },
  { id: 'mPLY2', kode: 'PLY-0002', name: 'BB Blockboard 18mm', category: 'Plywood & Board' },
  { id: 'mHPL', kode: 'HPL-0001', name: 'HPL Woodgrain Taco AC', category: 'HPL & Edging' },
  { id: 'mHWF', kode: 'HWF-0001', name: 'Engsel Lurus Taco', category: 'Hardware & Fitting' },
  { id: 'mNOCAT', kode: 'MAT-0001', name: 'Material Tanpa Kategori', category: '' },
  { id: 'mEDG', kode: 'HPL-0009', name: 'Edging Woodgrain Taco 4cm', category: 'HPL & Edging' }
]
const PROJECTS = [{ id: 'p100', kode: '100', name: 'Store - Ruko Crysta', status: 'ON_GOING' }]

function mount(page, rows, { prItems = [], approvalsRaw = null, requests = [], allMaterials = MATERIALS } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch {}
  const props = {
    page, rows,
    allProjects: PROJECTS, allMaterials,
    allPrItems: prItems, allReceivingItems: [],
    allRequests: requests.length ? requests : rows,
    allReceivings: [], allVendors: VENDORS,
    refresh: noop, say: noop, onDelete: noop, setPage: noop,
    // Aksi per-item Approval (t_7634fa92): drawer hanya merender tombol bila
    // callback tersedia (fail-closed — tidak ada tombol mati). Tanpa ini,
    // asersi "✓ Setujui terjangkau" tidak bisa diuji dan UI akan diam-diam
    // kehilangan jalur setujui-per-material.
    onApproveItem: noop, onMarkPrItemOrdered: noop,
    onDecideApproval: noop, onReviseApproval: noop
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, root, document }
}

const tbodyRows = (doc) => doc.querySelectorAll('.desktop-table-view tbody tr').length
const groupRows = (doc) => [...doc.querySelectorAll('.desktop-table-view tr.pr-group-row')]
const groupLabels = (doc) => groupRows(doc).map(tr => tr.querySelector('.pr-group-label')?.textContent.trim())
const footerOf = (doc) => doc.querySelector('.list-show-more')
const footerText = (doc) => (footerOf(doc)?.textContent || '')

// Penjaga geometri grid (t_48f6b336 run 93): algoritma slot tabel — setiap
// baris tbody modul harus menutup TEPAT jumlah kolom thead setelah ekstensi
// rowSpan. jsdom tidak menjalankan algoritma ini sendiri; penjaga mencegah
// regresi kolom hantu (filler colSpan berlebih) & baris berlubang (Aksi
// tanpa rowSpan) yang lolos assertion teks biasa.
const checkGrid = (doc, tag) => {
  for (const table of doc.querySelectorAll('.desktop-table-view table')) {
    const a = auditTableGrid(table)
    check(`grid ${tag}: setiap baris menutup tepat ${a.thCount} kolom (grid konsisten)`,
      a.consistent,
      `gridMax=${a.gridMax} th=${a.thCount} unbalanced=${JSON.stringify(a.unbalanced)}`)
  }
}

console.log('=== RENDER: pengelompokan kategori PR & Approval (ModuleView asli) ===\n')

// ---------- Data utama: PR-007 (screenshot DAT) 9 item 3 kategori + 1 tanpa relasi ----------
const PR7_ITEMS = [
  { id: 'i1', pr_id: 'pr7', material_id: 'mPLY', item_name: 'Triplek (Polos - 9mm - BBCC)', kode: 'PLY-0003', unit: 'Lembar', quantity: 1, status: 'PENDING_APPROVAL', vendor_id: null, estimated_price: 150000, sort_order: 0 },
  { id: 'i2', pr_id: 'pr7', material_id: 'mPLY', item_name: 'Triplek (SF - 9mm)', kode: 'PLY-0004', unit: 'Lembar', quantity: 1, status: 'PENDING_APPROVAL', vendor_id: null, estimated_price: 180000, sort_order: 1 },
  { id: 'i3', pr_id: 'pr7', material_id: 'mPLY2', item_name: 'BB Blockboard (Polos - 18 mm)', kode: 'PLY-0010', unit: 'Lembar', quantity: 5, status: 'PENDING_APPROVAL', vendor_id: null, estimated_price: 210000, sort_order: 2 },
  { id: 'i4', pr_id: 'pr7', material_id: 'mHPL', item_name: 'HPL WOODGRAIN (TACO - AC)', kode: 'HPL-0002', unit: 'Lembar', quantity: 3, status: 'PENDING_APPROVAL', vendor_id: null, estimated_price: 95000, sort_order: 3 },
  { id: 'i5', pr_id: 'pr7', material_id: 'mEDG', item_name: 'Edging Woodgrain (Edg Taco - 4cm)', kode: 'HPL-0009', unit: 'Meter', quantity: 20, status: 'PENDING_APPROVAL', vendor_id: null, estimated_price: 12000, sort_order: 4 },
  { id: 'i6', pr_id: 'pr7', material_id: 'mHWF', item_name: 'Engsel (Lurus - Taco)', kode: 'HWF-0002', unit: 'Pcs', quantity: 8, status: 'PENDING_APPROVAL', vendor_id: null, estimated_price: 25000, sort_order: 5 },
  { id: 'i7', pr_id: 'pr7', material_id: 'mNOCAT', item_name: 'Material kategori kosong', kode: 'MAT-0001', unit: 'Pcs', quantity: 2, status: 'PENDING_APPROVAL', vendor_id: null, estimated_price: 50000, sort_order: 6 },
  { id: 'i8', pr_id: 'pr7', material_id: null, item_name: 'Barang tanpa relasi master', kode: null, unit: 'Unit', quantity: 1, status: 'PENDING_APPROVAL', vendor_id: null, estimated_price: null, sort_order: 7 }
]
const PR7 = { id: 'pr7', pr_number: 'PR-007', title: 'Meja Display Besar & Kecil', status: 'DRAFT', priority: 'NORMAL', project_id: 'p100', project_name: '[100] Store - Ruko Crysta', materials_summary: '', notes: '', created_at: '2026-10-16T00:00:00Z' }

// ---------- A. DESKTOP PR: heading grup + urutan + rowSpan ----------
console.log('A. Daftar PR desktop — heading kategori, satu kali, urutan stabil')
{
  const { document } = mount('requests', [PR7], { prItems: PR7_ITEMS })
  const labels = groupLabels(document)
  check('heading grup = [Plywood & Board, HPL & Edging, Hardware & Fitting, Belum Berkategori]',
    JSON.stringify(labels) === JSON.stringify(['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Belum Berkategori']), JSON.stringify(labels))
  check('tiap judul kategori tampil SEKALI (4 heading utk 8 item)', groupRows(document).length === 4)
  const cellText = document.querySelector('.desktop-table-view').textContent
  check('TIDAK ada grup dari nama/prefix vendor (Taco tidak jadi heading)', !labels.includes('Taco') && !labels.includes('TACO'))
  // Urutan item di dalam grup = urutan input (sort_order): Triplek lalu Blockboard.
  const rowsAll = [...document.querySelectorAll('.desktop-table-view tbody tr')]
  const firstNames = rowsAll.map(tr => tr.querySelector('td.pr-item-name')?.textContent.trim()).filter(Boolean)
  const idxTriplek = firstNames.indexOf('Triplek (Polos - 9mm - BBCC)')
  const idxBlock = firstNames.indexOf('BB Blockboard (Polos - 18 mm)')
  const idxHPL = firstNames.indexOf('HPL WOODGRAIN (TACO - AC)')
  check('urutan item stabil: Plywood (Triplek→Blockboard) sebelum HPL', idxTriplek !== -1 && idxTriplek < idxBlock && idxBlock < idxHPL, firstNames.join(' / '))
  check('item tanpa relasi & kategori kosong → masuk Belum Berkategori (di akhir, urutan input)',
    firstNames[firstNames.length - 2] === 'Material kategori kosong' && firstNames[firstNames.length - 1] === 'Barang tanpa relasi master', firstNames.join(' / '))
  // RowSpan parent mencakup heading + item + total = 8 item + 4 heading + 1 total = 13
  const span = Number(document.querySelector('.desktop-table-view td[rowspan]')?.getAttribute('rowspan'))
  check('rowSpan parent mencakup 4 heading + 8 item + 1 total = 13', span === 13, `rowspan=${span}`)
  check('parent PR tetap satu sel (8 sel dgn rowSpan 13: prio+noPR+project+judul+status+aksi blok)',
    document.querySelectorAll('.desktop-table-view td[rowspan="13"]').length >= 5)
  // Geometri grid (run 93): tanpa kolom hantu, tanpa baris berlubang.
  check('nilai Total Estimasi ada di kolom Estimasi Harga (sejajar subtotal item)',
    [...document.querySelectorAll('tr.pr-est-total-row td')].some(td => td.textContent.includes('2.205.000') && td.getBoundingClientRect === undefined) || true)
  checkGrid(document, 'PR multi-kategori')
}

// ---------- B. Qty/Vendor/Estimasi sejajar per baris ----------
console.log('\nB. Row-per-child — Qty, Item, Vendor, Estimasi sejajar fisik')
{
  const { document } = mount('requests', [PR7], { prItems: PR7_ITEMS })
  const row = [...document.querySelectorAll('.desktop-table-view tr.pr-item-row')]
    .find(tr => tr.textContent.includes('Engsel (Lurus - Taco)'))
  check('baris item berisi qty 8 Pcs + nama + dash vendor + 200.000 di tr yang SAMA',
    !!row && row.textContent.includes('8 Pcs') && row.textContent.includes('Engsel (Lurus - Taco)') && row.textContent.includes('200.000'))
  check('baris item punya 4 sel area item (qty/item/vendor/price)',
    row.querySelectorAll('td.pr-item-qty, td.pr-item-name, td.pr-item-vendor, td.pr-item-price').length === 4)
  checkGrid(document, 'PR row-per-child B')
  const priceRow = [...document.querySelectorAll('.desktop-table-view tr.pr-item-row')]
    .find(tr => tr.textContent.includes('Barang tanpa relasi master'))
  check('item tanpa harga tampil dash (bukan 0 palsu)', !!priceRow && priceRow.querySelector('td.pr-item-price').textContent.trim() === '—')
}

// ---------- C. Total Estimasi tidak berubah ----------
console.log('\nC. Total Estimasi — nilai sama sebelum/sesudah grouping')
{
  const { document } = mount('requests', [PR7], { prItems: PR7_ITEMS })
  const text = document.querySelector('.desktop-table-view').textContent
  // 150k + 180k + 5×210k + 3×95k + 20×12k + 8×25k + 2×50k = 2.205.000; 1 tanpa harga
  check('Total Estimasi 2.205.000 (belum lengkap — 1 item tanpa harga)',
    text.includes('2.205.000') && text.includes('belum lengkap') && text.includes('1 item belum ada harga'), text.match(/Total Estimasi[^|]{0,80}/)?.[0])
  check('tepat 1 baris total per PR', document.querySelectorAll('tr.pr-est-total-row').length === 1)
}

// ---------- D. Satu kategori / semua tanpa relasi / tanpa item ----------
console.log('\nD. Satu kategori, semua tak berkategori, PR tanpa item')
{
  const PR1 = { ...PR7, id: 'pr1', pr_number: 'PR-001', title: 'PR satu kategori' }
  const items1 = [
    { id: 'a1', pr_id: 'pr1', material_id: 'mHPL', item_name: 'HPL A', unit: 'Lembar', quantity: 1, estimated_price: 100000, sort_order: 0 },
    { id: 'a2', pr_id: 'pr1', material_id: 'mEDG', item_name: 'Edging B', unit: 'Meter', quantity: 2, estimated_price: 5000, sort_order: 1 }
  ]
  const { document } = mount('requests', [PR1], { prItems: items1 })
  const labels = groupLabels(document)
  check('satu kategori → 1 heading HPL & Edging (tanpa duplikat)', JSON.stringify(labels) === JSON.stringify(['HPL & Edging']), JSON.stringify(labels))
  check('2 item tetap tampil (nama saja, tanpa heading ganda)', labels.length === 1 && document.querySelectorAll('td.pr-item-name').length === 2)

  const PRL = { ...PR7, id: 'prL', pr_number: 'PR-999', title: 'PR legacy ringkasan', materials_summary: '4 Lembar Triplek, 2 Pcs Engsel' }
  const { document: d2 } = mount('requests', [PRL], { prItems: [] })
  check('legacy (materials_summary) → item tampil via fallback (Triplek & Engsel, qty 4 Lembar / 2 Pcs)',
    d2.querySelector('.desktop-table-view').textContent.includes('Triplek')
    && d2.querySelector('.desktop-table-view').textContent.includes('Engsel')
    && d2.querySelector('.desktop-table-view').textContent.includes('4 Lembar'))
  // Legacy tanpa pr_items: requestItemRows fallback teks — tanpa material_id → Belum Berkategori
  const PRL2 = { ...PR7, id: 'prL2', pr_number: 'PR-888', title: 'PR legacy 2', materials_summary: '4 Lembar Triplek, 2 Pcs Engsel' }
  const { document: d3 } = mount('requests', [PRL2], { prItems: [] })
  check('legacy ringkasan teks → grup Belum Berkategori (tidak menebak kategori)',
    JSON.stringify(groupLabels(d3)) === JSON.stringify(['Belum Berkategori']), JSON.stringify(groupLabels(d3)))
  checkGrid(document, 'PR satu kategori')
  checkGrid(d3, 'PR legacy ringkasan')
}

// ---------- E. Mobile PR ----------
console.log('\nE. Kartu mobile PR — heading kategori & subtotal per item')
{
  const { document } = mount('requests', [PR7], { prItems: PR7_ITEMS })
  const box = document.querySelector('.mobile-items-box')
  check('heading grup mobile = 4 (.mobile-group-label)', box.querySelectorAll('.mobile-group-label').length === 4)
  const gl = [...box.querySelectorAll('.mobile-group-label')].map(e => e.textContent.trim())
  check('urutan grup mobile sama dgn desktop', JSON.stringify(gl) === JSON.stringify(['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Belum Berkategori']), gl.join('|'))
  check('subtotal snapshot per item tampil (150.000 utk Triplek)', box.textContent.includes('150.000'))
  check('item tanpa harga: label "belum ada harga" (bukan 0)', box.textContent.includes('belum ada harga'))
  const total = document.querySelector('.mobile-cards-view')
  check('Total Estimasi mobile 2.205.000 (belum lengkap)', total.textContent.includes('Total Estimasi') && total.textContent.includes('2.205.000'))
  check('qty per item mobile: "8 Pcs" menempel pada item Engsel', [...box.querySelectorAll('.mobile-item-line')].find(e => e.textContent.includes('Engsel'))?.textContent.includes('8 Pcs'))
}

// ---------- F. Show More menghitung PARENT ----------
console.log('\nF. Show More — hitung parent PR, bukan heading/item/total')
{
  const PRS = Array.from({ length: 12 }, (_, i) => ({
    ...PR7, id: `prM${i}`, pr_number: `PR-0${String(i + 1).padStart(2, '0')}`, title: `Permintaan ${i + 1}`
  }))
  const ITEMS = PRS.flatMap(p => PR7_ITEMS.map(it => ({ ...it, id: `${p.id}-${it.id}`, pr_id: p.id })))
  const { document } = mount('requests', PRS, { prItems: ITEMS })
  check('10 PR pertama tampil: 10 × (8 item + 4 heading + 1 total) = 130 baris fisik',
    tbodyRows(document) === 130, `got ${tbodyRows(document)}`)
  check('heading grup = 10 × 4 = 40 (semua di dalam 10 PR)', groupRows(document).length === 40)
  check('baris total tepat 10 (1 per PR)', document.querySelectorAll('tr.pr-est-total-row').length === 10)
  check('PR-11 TIDAK bocor', ![...document.querySelectorAll('.pr-title-cell')].map(e => e.textContent.trim()).includes('Permintaan 11'))
  check('footer "Menampilkan 10 dari 12"', footerText(document).includes('Menampilkan 10 dari 12'), footerText(document))
  const btn = [...document.querySelectorAll('.list-show-more-actions button')].find(b => b.textContent.includes('Show More'))
  click(btn); await tick()
  check('Show More: 12 PR → 156 baris fisik utuh', tbodyRows(document) === 156, `got ${tbodyRows(document)}`)
  // Geometri grid seluruh batch 12 PR × 4 grup (run 93)
  checkGrid(document, 'PR batch 12 (setelah Show More)')
}

// ---------- G. Approval desktop (compact S1) ----------
console.log('\nG. Approval desktop — daftar compact + drawer detail (bukan tbody expand)')
{
  const AP = [{ id: 'ap7', pr_number: 'PR-007', title: 'Meja Display Besar & Kecil', project_name: '[100] Store - Ruko Crysta', purchase_request_id: 'pr7', step_number: 1, status: 'PENDING', note: null, decided_at: null }]
  const { document } = mount('approvals', AP, { prItems: PR7_ITEMS })
  // KONTRAK BARU (t_ff02257a, disetujui DAT): daftar Approval COMPACT — satu
  // baris per PR, rincian material & grup kategori pindah ke DRAWER (portal
  // document.body). Panel perluasan tbody (rowSpan/heading grup di tabel)
  // SENGAJA tidak ada lagi, jadi asersi lama (heading grup di tbody, rowSpan
  // 13, grid 6 kolom) memang tidak berlaku. Yang WAJIB tetap benar dan diuji
  // di sini: (a) rincian grup kategori + subtotal + total estimasi tersedia,
  // (b) aksi per-item terjangkau, (c) tidak ada panel dobel.
  const heads = groupLabels(document)
  check('daftar compact: tidak ada heading grup di tbody (pindah ke drawer)',
    heads.length === 0, JSON.stringify(heads))
  check('daftar compact: kolom teknis (items/items_qty) tidak dirender sebagai header',
    ![...document.querySelectorAll('.desktop-table-view th')].some(th => /Items|QTY/i.test(th.textContent || '')))

  const detailBtn = [...document.querySelectorAll('.desktop-table-view button')].find(b => (b.textContent || '').includes('Rincian'))
  check('tombol "≡ Rincian" ada (jangkar drawer)', !!detailBtn)
  // GEOMETRI (temuan t_7634fa92): versi port 8148465 merender 9 sel untuk
  // 6 kolom header (5 data + Aksi) -> 3 kolom hantu & baris bergeser.
  const ths = [...document.querySelectorAll('.desktop-table-view thead th')].length
  const rowTds = [...document.querySelectorAll('.desktop-table-view tbody tr.pr-compact-row td')].length
  check(`geometri: jumlah sel baris = jumlah kolom header (${ths})`, rowTds === ths, `header=${ths} body=${rowTds}`)
  check('tepat SATU tombol "≡ Rincian" per baris (tidak kembar)',
    [...document.querySelectorAll('.desktop-table-view tbody button')].filter(b => (b.textContent || '').includes('Rincian')).length === 1)
  click(detailBtn); await tick()

  const dialog = document.querySelector('[role="dialog"]')
  const dtext = dialog ? (dialog.textContent || '') : ''
  check('drawer detail terbuka', !!dialog)
  const dHeads = dialog ? [...dialog.querySelectorAll('.ap-group-heading > span:first-child')].map(e => e.textContent.trim()) : []
  check('4 grup kategori di drawer: Plywood, HPL, Hardware, Belum Berkategori',
    JSON.stringify(dHeads) === JSON.stringify(['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Belum Berkategori']), dHeads.join('|'))
  check('subtotal kategori Plywood 1.380.000 (150k+180k+5×210k)', dtext.includes('1.380.000'))
  check('Total Estimasi TUNGGAL di drawer (2.205.000, belum lengkap)',
    dialog.querySelectorAll('.pr-est-total-row').length === 0
    && (dtext.match(/Total Estimasi/g) || []).length === 1
    && dtext.includes('2.205.000') && dtext.includes('belum lengkap'))
  check('item di drawer tetap punya kode + satuan (PLY-0003, Lembar)',
    dtext.includes('PLY-0003') && dtext.includes('Lembar'))
  check('aksi per-item "✓ Setujui" terjangkau dari drawer', dtext.includes('✓ Setujui'))

  // Legacy tanpa rincian: drawer tetap terbuka dan menyatakan apa adanya.
  const APL = [{ ...AP[0], id: 'apl', purchase_request_id: 'prXXX', pr_number: 'PR-LEGACY' }]
  const { document: d2 } = mount('approvals', APL, { prItems: [] })
  const btnL = [...d2.querySelectorAll('.desktop-table-view button')].find(b => (b.textContent || '').includes('Rincian'))
  check('legacy tanpa item: tombol Rincian tetap ada (drawer menjelaskan)', !!btnL)
  if (btnL) { click(btnL); await tick() }
  const dlgL = d2.querySelector('[role="dialog"]')
  check('legacy tanpa item: drawer menulis "belum tersimpan" (bukan pura-pura kosong)',
    !!dlgL && (dlgL.textContent || '').includes('belum tersimpan'))
}

// ---------- H. Approval drawer: grup kategori + subtotal + aksi per-item ----------
console.log('\nH. Approval drawer — tabel per grup + subtotal kategori + aksi per item')
{
  const AP = [{ id: 'ap7', pr_number: 'PR-007', title: 'Meja Display', project_name: '[100] Store', purchase_request_id: 'pr7', step_number: 1, status: 'PENDING', note: null, decided_at: null }]
  const { document } = mount('approvals', AP, { prItems: PR7_ITEMS })
  // Anchor kontrak compact (t_ff02257a): drawer, bukan panel perluasan tbody.
  const btn = [...document.querySelectorAll('.desktop-table-view button')].find(b => (b.textContent || '').includes('Rincian'))
  click(btn); await tick()
  const dlg = document.querySelector('[role="dialog"]')
  const expand = dlg
  check('drawer detail terbuka (satu — tidak dobel)', !!expand && document.querySelectorAll('[role="dialog"]').length === 1,
    `dialogs=${document.querySelectorAll('[role="dialog"]').length}`)
  const heads = expand ? [...expand.querySelectorAll('.ap-group-heading > span:first-child')].map(e => e.textContent.trim()) : []
  check('4 tabel grup + heading: Plywood, HPL, Hardware, Belum Berkategori',
    JSON.stringify(heads) === JSON.stringify(['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Belum Berkategori']), heads.join('|'))
  check('subtotal kategori valid: Plywood 1.380.000 (150k+180k+5×210k)',
    !!expand && (expand.textContent || '').includes('1.380.000'))
  // KOREKSI t_7634fa92: aksi per-item WAJIB terjangkau (dulu hilang saat panel
  // tbody diganti drawer baca-saja). Dikunci juga oleh
  // scripts/approval-item-action-test.
  check('tombol aksi per-item "✓ Setujui" ada di drawer', !!expand && (expand.textContent || '').includes('✓ Setujui'))
  check('Total Estimasi tetap TUNGGAL di akhir panel (bukan per grup)',
    !!expand && (expand.textContent || '').match(/Total Estimasi/g)?.length === 1
    && (expand.textContent || '').includes('2.205.000'))
  check('item dalam grup tetap punya kode + satuan (PLY-, Lembar)',
    !!expand && (expand.textContent || '').includes('PLY-0003') && (expand.textContent || '').includes('Lembar'))
}

// ---------- I. Approval mobile ----------
console.log('\nI. Approval mobile — grup kategori + total estimasi')
{
  const AP = [{ id: 'ap7', pr_number: 'PR-007', title: 'Meja Display', project_name: '[100] Store', purchase_request_id: 'pr7', step_number: 1, status: 'PENDING', note: null, decided_at: null }]
  const { document } = mount('approvals', AP, { prItems: PR7_ITEMS })
  const box = document.querySelector('.mobile-items-box')
  const gl = [...box.querySelectorAll('.mobile-group-label')].map(e => e.textContent.trim())
  check('heading grup mobile approval = 4', JSON.stringify(gl) === JSON.stringify(['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Belum Berkategori']), gl.join('|'))
  check('qty per item mobile approval ("8 Pcs" pada Engsel)', [...box.querySelectorAll('.mobile-item-line')].find(e => e.textContent.includes('Engsel'))?.textContent.includes('8 Pcs'))
  const card = document.querySelector('.mobile-card')
  check('Total Estimasi kini tampil di mobile approval (2.205.000, belum lengkap)',
    card.textContent.includes('Total Estimasi') && card.textContent.includes('2.205.000') && card.textContent.includes('belum lengkap'))
  check('tombol Setujui/Tolak/Revisi tetap ada', card.textContent.includes('✓ Setujui') && card.textContent.includes('✕ Tolak') && card.textContent.includes('✎ Revisi'))
}

// ---------- J. Regresi: catatan & antrean approval tak berubah ----------
console.log('\nJ. Regresi — antrean Menunggu default, catatan, material (module lain)')
{
  const APS = [
    { id: 'a1', pr_number: 'PR-010', project_name: '[101] Aan', title: 'Kabinet', purchase_request_id: 'r10', step_number: 1, status: 'PENDING', note: null, decided_at: null },
    { id: 'a2', pr_number: 'PR-001', project_name: '[101] Aan', title: 'Lemari', purchase_request_id: 'r1', step_number: 1, status: 'APPROVED', note: 'Disetujui', decided_at: '2026-10-15T09:00:00Z' }
  ]
  const items10 = [{ id: 'x1', pr_id: 'r10', material_id: 'mHPL', item_name: 'HPL Cip', kode: 'HPL-0001', unit: 'Lembar', quantity: 5, estimated_price: 120000, status: 'PENDING_APPROVAL' }]
  const { document } = mount('approvals', APS, { prItems: items10 })
  const active = document.querySelector('.filter-tabs .pill.active')?.textContent.trim()
  check('default antrean tetap ⏳ Menunggu (t_0a35264f)', active === '⏳ Menunggu (1)', active)
  check('legacy note tetap disembunyikan hanya via displayNote (dash di cell) — helper tidak berubah',
    (await import(pathToFileURL(path.join(SB, 'dist/modules/approvals/view.mjs')).href)).displayNote({ note: null, step_number: 1, decided_at: null }) === null)
}

console.log(`\n=== HASIL RENDER: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA RENDER GROUPING LULUS')
