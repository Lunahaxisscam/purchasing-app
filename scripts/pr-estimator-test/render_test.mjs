// ============================================================
// RENDER INTERAKTIF FORM PR (t_ac0b39c0) — CreateModal + requests/form.jsx
// jsdom + createRoot; klik/ketik nyata via native setter (pola showmore).
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// DOM environment dulu (urutan penting — lihat showmore render_test)
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const Create = (await import(pathToFileURL(path.join(SB, 'dist/components/CreateModal.mjs')).href)).default
const saveMod = await import(pathToFileURL(path.join(SB, 'dist/modules/requests/save.mjs')).href)
const viewMod = await import(pathToFileURL(path.join(SB, 'dist/modules/requests/view.mjs')).href)
const apprMod = await import(pathToFileURL(path.join(SB, 'dist/modules/approvals/view.mjs')).href)
const itemH = await import(pathToFileURL(path.join(SB, 'dist/modules/shared/itemHelpers.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))
const submitForm = (form) => flushSync(() => {
  if (typeof form.requestSubmit === 'function') form.requestSubmit()
  else form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
})
const inputSet = (el, val) => flushSync(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, val)
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
})
const selectSet = (el, val) => flushSync(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setter.call(el, val)
  el.dispatchEvent(new window.Event('change', { bubbles: true }))
})

console.log('=== RENDER: form PR interaktif (CreateModal.js asli) ===\n')

// ---------- Data mock ----------
const noop = () => {}
let notices = []
const say = (m) => { notices.push(m) }

const VENDORS = [
  { id: 'vHPL', name: 'Toko HPL Jaya', supplier_category: 'HPL & Edging' },
  { id: 'vPLY', name: 'Toko Plywood', supplier_category: 'Plywood & Board' },
  { id: 'vBHP', name: 'Toko BHP', supplier_category: 'Bahan Habis Pakai' },
  { id: 'vNONE', name: 'Toko Tanpa Kategori', supplier_category: '' }
]
const MATERIALS = [
  { id: 'mHPL1', kode: 'HPL-0001', name: 'HPL Cip buruf putih', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: null },
  { id: 'mHPL2', kode: 'HPL-0002', name: 'HPL Coklat Tac', category: 'HPL & Edging', qty: 0, satuan: 'Lembar', harga_acuan: 95000 },
  { id: 'mALM1', kode: 'ALM-0015', name: 'Frame Baleno (FA 128 - Brown Hairline)', category: 'Aluminium & Profil', qty: 0, satuan: 'Meter', harga_acuan: null },
  { id: 'mALM2', kode: 'ALM-0016', name: 'Handle Baleno (FHD 128)', category: 'Aluminium & Profil', qty: 0, satuan: 'Pcs', harga_acuan: 45000 },
  { id: 'mBHP1', kode: 'BHP-0001', name: 'Lem Fox', category: 'Bahan Habis Pakai', qty: 0, satuan: 'Kaleng', harga_acuan: null }
]
const PROJECTS = [{ id: 'p83', kode: '83', name: 'Mabes', status: 'ON_GOING' }]
// P1 t_e88c28fb — pemisahan harga AKTUAL vs ESTIMASI:
//   piOld1 (mHPL1): kolom price_actual TERISI 115.000 ≠ estimated 120.000
//   → satu-satunya fixture berkategori HISTORIS (harga aktual terverifikasi).
//   piOld2 (mALM1): hanya estimated_price 700.000 — kategori PR_ESTIMATE
//   (unit Dus ≠ Meter, jadi tak relevan utk mALM1 sama sekali).
// Histori:
//   mHPL1 @ vHPL aktual 115.000/Lembar (12 Okt) — via PR lama prOLD + rcOLD
const PR_ITEMS = [
  { id: 'piOld1', pr_id: 'prOLD', material_id: 'mHPL1', item_name: 'HPL Cip buruf putih', kode: 'HPL-0001', unit: 'Lembar', quantity: 5, status: 'ORDERED', supplier_category: 'HPL & Edging', vendor_id: 'vHPL', estimated_price: 120000, price_actual: 115000, sort_order: 0 },
  { id: 'piOld2', pr_id: 'prOLD', material_id: 'mALM1', item_name: 'Frame Baleno', kode: 'ALM-0015', unit: 'Dus', quantity: 2, status: 'ORDERED', supplier_category: 'HPL & Edging', vendor_id: 'vHPL', estimated_price: 700000, sort_order: 1 }
]
const RECEIVINGS = [
  { id: 'rcOLD', purchase_request_id: 'prOLD', vendor_id: 'vHPL', status: 'NORMAL', received_date: '2026-10-12', created_at: '2026-10-12T02:00:00Z' }
]
const RECEIVING_ITEMS = [
  { id: 'riOld1', receiving_id: 'rcOLD', pr_item_id: 'piOld1', quantity_received: 5 },
  { id: 'riOld2', receiving_id: 'rcOLD', pr_item_id: 'piOld2', quantity_received: 2 }
]

function mountForm({ editRow = null, editItems = [] } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  const document = global.document
  try { global.navigator = dom.window.navigator } catch {}
  const props = {
    page: 'requests',
    allProjects: PROJECTS, allMaterials: MATERIALS, allVendors: VENDORS,
    existingRequests: [], allRequestsFull: [], editRow, editItems,
    allReceivings: RECEIVINGS, allPrItems: PR_ITEMS, allReceivingItems: RECEIVING_ITEMS,
    close: noop, refresh: noop, say
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Create, props)))
  return { dom, root, document }
}

const q = (document, sel) => document.querySelector(sel)
const qa = (document, sel) => [...document.querySelectorAll(sel)]

// ---------- A0. LAYOUT HEADER SATU BARIS (steer DAT — Project + Judul) ----------
console.log('A0. Header form satu baris: Project ~40% + Judul Kebutuhan ~60% (desktop), stack mobile')
{
  notices = []
  const { document } = mountForm()
  const row = q(document, '.pr-header-row')
  check('.pr-header-row ada (Project + Judul satu baris)', !!row)
  const labels = row ? qa(row, 'label').map(l => (l.childNodes[0]?.textContent || '').trim()) : []
  check('dua label: Project & Judul Kebutuhan (dua field terpisah)', labels.length === 2 && labels[0] === 'Project' && labels[1].startsWith('Judul Kebutuhan'), labels.join(' | '))
  const css = fs.readFileSync('/home/ubuntu/purchasing-app/styles/globals.css', 'utf8')
  const block = css.match(/\.pr-header-row\s*{[^}]+}/)
  check('grid desktop 2 kolom 2fr/3fr (40%/60%)', !!block && block[0].includes('minmax(0, 2fr)') && block[0].includes('minmax(0, 3fr)'), block ? block[0] : 'block hilang')
  const mq = css.match(/@media \(max-width: 640px\)\s*{[^@]*?\.pr-header-row\s*{[^}]+}/)
  check('media query ≤640px stack 1 kolom', !!mq && mq[0].includes('1fr'), mq ? mq[0].slice(-80) : 'media query hilang')
  const sel = row && row.querySelector('select')
  const inp = row && row.querySelector('input[type="text"]')
  check('Project <select> required & Judul <input> required', sel?.required === true && inp?.required === true)
  // Edit prefill: judul tersimpan masuk ke input satu baris
  const { document: d2 } = mountForm({ editRow: { id: 'prX', pr_number: 'PR-099', title: 'PR snapshot', project_id: 'p83', status: 'DRAFT', priority: 'NORMAL', notes: '' } })
  const inp2 = q(d2, '.pr-header-row input[type="text"]')
  const sel2 = q(d2, '.pr-header-row select')
  check('edit: prefill judul & project di baris yang sama', inp2?.value === 'PR snapshot' && sel2?.value === 'p83', `judul="${inp2?.value}" project="${sel2?.value}"`)
  inputSet(inp2, 'Judul baru edit'); await tick()
  check('edit: judul bisa diketik (onChange hidup)', inp2.value === 'Judul baru edit')
}

// ---------- A. AUTO-FILL SAAT ITEM DITAMBAHKAN (steer 1) ----------
console.log('A. Tambah item → estimasi OTOMATIS terisi (atau kosong + label)')
{
  notices = []
  const { document } = mountForm()
  // Cari material HPL-0001 (ada histori)
  const searchInput = q(document, '.material-picker-box input[type="text"]')
  inputSet(searchInput, 'HPL-0001'); await tick()
  const sel = qa(document, '.material-picker-box select')[1] // [0]=filter kategori
  selectSet(sel, 'mHPL1'); await tick()
  const addBtn = qa(document, '.material-picker-box button').find(b => b.textContent.includes('+ Tambah Item'))
  click(addBtn); await tick()

  const priceInput = qa(document, '.material-picker-box table tbody input[type="text"]')[0]
  check('item HPL-0001 (harga aktual): estimasi otomatis terisi "115.000"', priceInput?.value === '115.000', `got "${priceInput?.value}"`)
  const rowText = priceInput.closest('tr').textContent
  check('badge sumber ✅ Historis (pembelian) tampil (harga aktual, P1)', rowText.includes('Historis'), rowText.slice(0, 160))
  check('vendor referensi "ref: Toko HPL Jaya" tampil', rowText.includes('Toko HPL Jaya'))
  check('tanggal histori 2026-10-12 tampil', rowText.includes('2026-10-12'))
  const totalText = q(document, '.material-picker-box').textContent
  check('Total Estimasi terisi (qty 1 × 115.000 = 115.000)', totalText.includes('Total Estimasi') && totalText.includes('115.000'), totalText.slice(-200))

  // Material TANPA acuan (Frame Baleno): kosong + label, BUKAN 0
  inputSet(searchInput, 'Frame Baleno'); await tick()
  selectSet(sel, 'mALM1'); await tick()
  click(addBtn); await tick()
  const inputs = qa(document, '.material-picker-box table tbody input[type="text"]')
  const frameInput = inputs.find(i => i.value === '')
  check('item Frame Baleno (tanpa acuan): estimasi KOSONG — bukan 0 palsu', !!frameInput)
  const boxText = q(document, '.material-picker-box').textContent
  check('label "Belum ada acuan" tampil', boxText.includes('Belum ada acuan'))
  check('Total "belum lengkap" + 1 item belum ada harga', boxText.includes('BELUM LENGKAP') && boxText.includes('1 item belum punya harga'), boxText.slice(-260))
  check('total tetap 115.000 (item tanpa harga TIDAK dihitung 0)', boxText.includes('115.000'))

  // Material dengan MASTER harga_acuan
  inputSet(searchInput, 'HPL-0002'); await tick()
  selectSet(sel, 'mHPL2'); await tick()
  click(addBtn); await tick()
  // Harga MASTER = input dengan nilai 95.000 (input baru di baris kedua)
  const allPriceInputs = qa(document, '.material-picker-box table tbody input[type="text"]')
  const masterInput = allPriceInputs.find(i => i.value === '95.000')
  check('item HPL-0002: MASTER 95.000 terisi otomatis', !!masterInput, allPriceInputs.map(i => i.value).join('|'))
  const rowText2 = masterInput?.closest('tr')?.textContent || ''
  check('badge 📍 Master tampil (tanpa vendor/tanggal palsu)', rowText2.includes('Master') && !rowText2.includes('ref:'), rowText2.slice(0, 180))
}

// ---------- B. GANTI VENDOR: recalc hanya bila belum manual ----------
console.log('\nB. Ganti vendor → recalc bila belum manual; override dipertahankan')
{
  const { document } = mountForm()
  const searchInput = q(document, '.material-picker-box input[type="text"]')
  inputSet(searchInput, 'HPL-0001'); await tick()
  const sel = qa(document, '.material-picker-box select')[1]
  selectSet(sel, 'mHPL1'); await tick()
  const addBtn = qa(document, '.material-picker-box button').find(b => b.textContent.includes('+ Tambah Item'))
  click(addBtn); await tick()

  const rowsB = qa(document, '.material-picker-box table tbody tr')
  const row = rowsB[0]        // baris item
  const detailRow = rowsB[1]  // baris detail (kategori/vendor/harga/sumber)
  const sels = detailRow.querySelectorAll('select')
  // sels[0]=Kategori, sels[1]=Vendor
  const vendorSelect = sels[1]
  // Pilih vendor Plywood (tidak punya histori item ini) → fallback histori terbaru tetap 115.000
  selectSet(vendorSelect, 'vPLY'); await tick()
  const priceAfter = detailRow.querySelector('input[type="text"]')
  check('ganti vendor tanpa histori vendor: fallback harga aktual terbaru 115.000', priceAfter.value === '115.000', `got "${priceAfter.value}"`)

  // User override → 100.000; lalu ganti vendor lagi → TIDAK ditimpa
  inputSet(priceAfter, '100.000'); await tick()
  check('override manual → 100.000', priceAfter.value === '100.000')
  selectSet(vendorSelect, 'vHPL'); await tick()
  check('ganti vendor SETELAH override: harga user TIDAK ditimpa (tetap 100.000)', priceAfter.value === '100.000', `got "${priceAfter.value}"`)
  const badge = detailRow.textContent
  check('badge ✍️ Manual tampil utk harga user', badge.includes('Manual'), badge.slice(0, 160))

  // Tombol "Pakai acuan" mengembalikan ke acuan (per vendor)
  const useBtn = [...detailRow.querySelectorAll('button')].find(b => b.textContent.includes('Pakai acuan'))
  check('tombol ↺ Pakai acuan tersedia', !!useBtn)
  click(useBtn); await tick()
  check('Pakai acuan: kembali ke harga aktual vHPL 115.000 + badge Historis',
    priceAfter.value === '115.000' && detailRow.textContent.includes('Historis'), priceAfter.value)
}

// ---------- C. TOTAL LIVE: tambah/hapus/ubah qty ----------
console.log('\nC. Total Estimasi live — tambah/hapus/ubah qty & acuan')
{
  const { document } = mountForm()
  const searchInput = q(document, '.material-picker-box input[type="text"]')
  const sel = qa(document, '.material-picker-box select')[1]
  const addBtn = qa(document, '.material-picker-box button').find(b => b.textContent.includes('+ Tambah Item'))

  const addMat = async (code, id, qty) => {
    inputSet(searchInput, code); await tick()
    selectSet(sel, id); await tick()
    const qtyInput = qa(document, '.material-picker-box input[type="number"]')[0]
    if (qty !== undefined) { inputSet(qtyInput, String(qty)); await tick() }
    click(addBtn); await tick()
  }
  await addMat('HPL-0001', 'mHPL1', 2)   // 2×115.000 = 230.000
  let totalText = q(document, '.material-picker-box').textContent
  check('total awal 230.000 (2×115.000)', totalText.includes('230.000'), totalText.slice(-160))
  // Review run 86: Total Estimasi WAJIB di luar area scroll daftar item —
  // user tidak boleh harus scroll utk melihat total PR.
  // t_cde1b8ad: penanda total sekarang .pr-total-row (baris flex, bukan <tr>)
  // karena <table> 6 kolom di luar scroll membuat dialog melebar di mobile.
  {
    const box = q(document, '.material-picker-box')
    const scrollDiv = [...box.querySelectorAll('div')].find(d => d.style.maxHeight === '240px')
    const totalRow = q(document, '.pr-total-row')
    check('Total Estimasi di LUAR scroll container (selalu terlihat)', !!totalRow && !scrollDiv.contains(totalRow),
      scrollDiv && totalRow ? (scrollDiv.contains(totalRow) ? ' masih di dalam scroll' : ' ok') : ' struktur tak ditemukan')
    check('Total Estimasi memakai baris flex, bukan tabel lebar (anti overflow dialog)',
      !!totalRow && totalRow.tagName === 'DIV' && totalRow.style.display === 'flex',
      totalRow ? `${totalRow.tagName} display=${totalRow.style.display}` : 'tidak ada')
  }
  await addMat('HPL-0002', 'mHPL2', 3)   // +3×95.000 = 285.000 → 515.000
  totalText = q(document, '.material-picker-box').textContent
  check('total 515.000 setelah item kedua', totalText.includes('515.000'), totalText.slice(-160))
  // Ubah qty item pertama 2→5 → 575.000 + 285.000 = 860.000
  // (input number: [0]=Qty picker luar, [1..]=qty per baris item)
  const qtyFirst = qa(document, '.material-picker-box table tbody input[type="number"]')[0]
  inputSet(qtyFirst, '5'); await tick()
  totalText = q(document, '.material-picker-box').textContent
  check('ubah qty 5: total 860.000 (live update)', totalText.includes('860.000'), totalText.slice(-160))
  // Hapus item pertama (tombol × pertama di baris item) → 285.000
  const delBtn = qa(document, '.material-picker-box table tbody button').find(b => b.textContent.trim() === '×')
  click(delBtn); await tick()
  totalText = q(document, '.material-picker-box').textContent
  check('hapus item: total 285.000 (update setelah hapus)', totalText.includes('285.000'), totalText.slice(-160))
}

// ---------- D. FILTER KATEGORI × SEARCH (steer 2) ----------
console.log('\nD. Filter kategori di area pemilih — irisan dgn search, tanpa ubah data')
{
  const { document } = mountForm()
  const catSel = qa(document, '.material-picker-box select')[0]
  const searchInput = q(document, '.material-picker-box input[type="text"]')
  const sel = qa(document, '.material-picker-box select')[1]

  check('filter default "Semua Kategori"', catSel.options[catSel.selectedIndex].text.includes('Semua'))
  // Semua (tanpa filter): 100 pertama berisi campuran
  selectSet(catSel, 'Aluminium & Profil'); await tick()
  const optsAlm = [...sel.options].map(o => o.text)
  check('filter kategori Aluminium: hanya ALM di dropdown', optsAlm.every(t => t.includes('ALM-') || t.includes('Pilih')), optsAlm.join(' | ').slice(0, 120))
  check('dropdown berisi ALM-0015 & ALM-0016', optsAlm.some(t => t.includes('ALM-0015')) && optsAlm.some(t => t.includes('ALM-0016')))
  // Irisan dengan search
  inputSet(searchInput, 'Baleno'); await tick()
  const optsBoth = [...sel.options].map(o => o.text)
  check('irisan kategori×search "Baleno": ALM-0015 + ALM-0016 saja', optsBoth.filter(t => t.includes('ALM-')).length === 2, optsBoth.join(' | '))
  // Label kategori master TIDAK berubah oleh filter (mis. item HPL tetap HPL)
  selectSet(catSel, ''); await tick()
  inputSet(searchInput, 'HPL-0002'); await tick()
  check('kategori master tidak berubah oleh filter (HPL-0002 tetap ada)', [...sel.options].some(o => o.text.includes('HPL-0002')))
}

// ---------- E. VENDOR ELIGIBLE-ONLY (aturan kategori DAT) ----------
console.log('\nE. Dropdown vendor hanya kategori aktif di master Vendor')
{
  const { document } = mountForm()
  const searchInput = q(document, '.material-picker-box input[type="text"]')
  const sel = qa(document, '.material-picker-box select')[1]
  inputSet(searchInput, 'HPL-0001'); await tick()
  selectSet(sel, 'mHPL1'); await tick()
  const addBtn = qa(document, '.material-picker-box button').find(b => b.textContent.includes('+ Tambah Item'))
  click(addBtn); await tick()
  const rowsE = qa(document, '.material-picker-box table tbody tr')
  const detailRow = rowsE[1] // baris detail (kategori/vendor)
  const sels = detailRow.querySelectorAll('select')
  const vendorSelect = sels[1]
  const names = [...vendorSelect.options].map(o => o.text)
  check('vendor HPL item: hanya Toko HPL Jaya (kategori pas)', names.includes('Toko HPL Jaya') && !names.includes('Toko Plywood') && !names.includes('Toko BHP'), names.join(' | '))
  check('vendor tanpa kategori TIDAK masuk daftar', !names.includes('Toko Tanpa Kategori'))
}

// ---------- E2. Item tanpa vendor eligible: dropdown kosong ----------
console.log('\nE2. Material tanpa vendor kategori cocok → dropdown kosong, tanpa vendor liar')
{
  const { document } = mountForm()
  const searchInput = q(document, '.material-picker-box input[type="text"]')
  const sel = qa(document, '.material-picker-box select')[1]
  inputSet(searchInput, 'Frame Baleno'); await tick()
  selectSet(sel, 'mALM1'); await tick()
  const addBtn = qa(document, '.material-picker-box button').find(b => b.textContent.includes('+ Tambah Item'))
  click(addBtn); await tick()
  const row2 = qa(document, '.material-picker-box table tbody tr')[1] // baris detail
  const sels2 = row2.querySelectorAll('select')
  const vendorSelect2 = sels2[1]
  check('vendor ALM (Aluminium & Profil): tidak ada vendor eligible (kosong)', [...vendorSelect2.options].length === 1, [...vendorSelect2.options].map(o => o.text).join('|'))
  // Simulasi vendor tersimpan tidak eligible (edit mode diuji di F): di form baru tak mungkin.
}

// ---------- F. MODE EDIT: snapshot, TIDAK recalc histori ----------
console.log('\nF. Edit PR: harga tersimpan dipertahankan (snapshot), bukan histori baru')
{
  // PR lama punya item mHPL1 harga TERSIMPAN 90.000 (user pernah ubah) —
  // histori sekarang 120.000 → edit TIDAK boleh mengubah 90.000.
  const editItems = [
    { id: 'piX1', pr_id: 'prX', material_id: 'mHPL1', item_name: 'HPL Cip buruf putih', kode: 'HPL-0001', unit: 'Lembar', quantity: 4, status: 'PENDING_APPROVAL', supplier_category: 'HPL & Edging', vendor_id: 'vHPL', estimated_price: 90000, sort_order: 0 },
    { id: 'piX2', pr_id: 'prX', material_id: 'mALM2', item_name: 'Handle Baleno', kode: 'ALM-0016', unit: 'Pcs', quantity: 2, status: 'PENDING_APPROVAL', supplier_category: 'Aluminium & Profil', vendor_id: '', estimated_price: null, sort_order: 1 }
  ]
  const editRow = { id: 'prX', pr_number: 'PR-099', title: 'PR snapshot', project_id: 'p83', status: 'DRAFT', priority: 'NORMAL', notes: '' }
  const { document } = mountForm({ editRow, editItems })
  const inputs = qa(document, '.material-picker-box table tbody input[type="text"]')
  check('edit: harga tersimpan 90.000 dipertahankan (bukan histori 120.000)', inputs[0]?.value === '90.000', `got "${inputs[0]?.value}"`)
  const boxText = q(document, '.material-picker-box').textContent
  check('edit: item tanpa harga (Handle) tetap "Belum ada acuan"', boxText.includes('Belum ada acuan'))
  check('edit: item berharga tersimpan berbadge "Tersimpan (snapshot)" — bukan "Belum ada acuan"', boxText.includes('Tersimpan (snapshot)'), boxText.slice(0, 200))
  // Tambah item baru di mode edit → auto-fill jalan utk item baru
  const searchInput = q(document, '.material-picker-box input[type="text"]')
  const sel = qa(document, '.material-picker-box select')[1]
  inputSet(searchInput, 'HPL-0002'); await tick()
  selectSet(sel, 'mHPL2'); await tick()
  const addBtn = qa(document, '.material-picker-box button').find(b => b.textContent.includes('+ Tambah Item'))
  click(addBtn); await tick()
  const inputs2 = qa(document, '.material-picker-box table tbody input[type="text"]')
  check('edit: item BARU tetap auto-fill (95.000)', inputs2.some(i => i.value === '95.000'), inputs2.map(i => i.value).join('|'))
}

// ---------- G. DAFTAR PR & APPROVAL: snapshot + total read-only ----------
console.log('\nG. Daftar PR (desktop/mobile) & Approval: subtotal snapshot + total')
{
  // Render ModuleView halaman requests dgn 1 PR 2 item (satu tanpa harga)
  const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default
  const PRS = [{ id: 'prV', pr_number: 'PR-100', title: 'PR uji view', status: 'DRAFT', priority: 'NORMAL', project_id: 'p83', project_name: '[83] Mabes', materials_summary: '', notes: '', created_at: '2026-10-16T00:00:00Z' }]
  const ITEMS = [
    { id: 'piV1', pr_id: 'prV', material_id: 'mHPL1', item_name: 'HPL Cip', kode: 'HPL-0001', unit: 'Lembar', quantity: 2, status: 'PENDING_APPROVAL', vendor_id: 'vHPL', estimated_price: 120000, sort_order: 0 },
    { id: 'piV2', pr_id: 'prV', material_id: 'mBHP1', item_name: 'Lem Fox', kode: 'BHP-0001', unit: 'Kaleng', quantity: 1, status: 'PENDING_APPROVAL', vendor_id: '', estimated_price: null, sort_order: 1 }
  ]
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  const document = global.document
  try { global.navigator = dom.window.navigator } catch {}
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, {
    page: 'requests', rows: PRS,
    allProjects: PROJECTS, allMaterials: MATERIALS, allPrItems: ITEMS, allReceivingItems: [],
    allRequests: PRS, allReceivings: RECEIVINGS, allVendors: VENDORS,
    refresh: noop, say: noop, onDelete: noop, setPage: noop
  })))
  await tick()
  const tableText = q(document, '.desktop-table-view').textContent
  check('daftar PR: subtotal item 240.000 (2×120.000 snapshot)', tableText.includes('240.000'), tableText.slice(0, 400))
  check('daftar PR: baris Total Estimasi (belum lengkap) — item tanpa harga ≠ 0', tableText.includes('Total Estimasi') && tableText.includes('belum lengkap') && tableText.includes('1 item belum ada harga'))
  // Mobile
  const cardText = q(document, '.mobile-cards-view').textContent
  check('kartu mobile: subtotal snapshot + total belum lengkap', cardText.includes('240.000') && cardText.includes('belum lengkap'), cardText.slice(0, 300))

  // Approval expand: total read-only
  flushSync(() => root.render(React.createElement(Module, {
    page: 'approvals', rows: [{ id: 'apV', pr_number: 'PR-100', title: 'PR uji view', project_name: '[83] Mabes', purchase_request_id: 'prV', step_number: 1, status: 'PENDING', note: '', decided_at: null }],
    allProjects: PROJECTS, allMaterials: MATERIALS, allPrItems: ITEMS, allReceivingItems: [],
    allRequests: PRS, allReceivings: RECEIVINGS, allVendors: VENDORS,
    refresh: noop, say: noop, onDelete: noop, setPage: noop
  })))
  await tick()
  const expandBtn = qa(document, '.desktop-table-view button').find(b => b.textContent.includes('Material ('))
  click(expandBtn); await tick()
  const apprText = q(document, '.desktop-table-view').textContent
  check('Approval expand: subtotal per item + Total Estimasi read-only', apprText.includes('240.000') && apprText.includes('Total Estimasi'), apprText.slice(-300))
  check('Approval expand: label belum lengkap utk item tanpa harga', apprText.includes('belum lengkap'))
}

console.log(`\n=== HASIL RENDER: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA RENDER ESTIMATOR LULUS')
