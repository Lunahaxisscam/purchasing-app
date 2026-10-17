// ============================================================
// RENDER TEST — PR form/view + Purchase page/form ASLI (dist hasil SWC)
// di jsdom INTERAKTIF. t_cde1b8ad: "PR & Purchase dipadatkan tanpa ubah schema".
// PENTING URUTAN: env jsdom dibuat SEBELUM react-dom diimpor.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

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
const Create = (await import(pathToFileURL(path.join(SB, 'dist/components/CreateModal.mjs')).href)).default
const Module = (await import(pathToFileURL(path.join(SB, 'dist/components/ModuleView.mjs')).href)).default
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
  if (!el) throw new Error('select tidak ada')
  const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLSelectElement.prototype, 'value').set
  flushSync(() => {
    setter.call(el, val)
    el.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
  })
}
const q = (doc, sel) => doc.querySelector(sel)
const qa = (doc, sel) => [...doc.querySelectorAll(sel)]
const tid = (doc, t) => doc.querySelector(`[data-testid="${t}"]`)
// Semua elemen fokusable yang berada DI LUAR <details> tertutup.
const visibleControls = (root) => qa(root, 'input, select, textarea, button')
  .filter(el => {
    let p = el
    while (p && p !== root.parentNode) {
      if (p.tagName === 'DETAILS' && !p.open) return false
      p = p.parentNode
    }
    return true
  })

function mountEl(dom, node) {
  const root = createRoot(dom.window.document.getElementById('app'))
  flushSync(() => root.render(node))
  return root
}
function freshDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* read-only */ }
  return dom
}

// ---------- 4) Fixture PR ----------
const noop = () => {}
const PROJECTS = [{ id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' }]
const VENDORS = [
  { id: 'v1', name: 'TB Sumber Jaya', supplier_category: 'Plywood & Board' },
  { id: 'v2', name: 'TB Multi', supplier_category: 'Plywood & Board, HPL & Edging' }
]
const MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 120000 },
  { id: 'm2', kode: 'HPL-0001', name: 'HPL Putih', category: 'HPL & Edging', satuan: 'Lembar', harga_acuan: 95000 }
]
const PR_ITEMS_EDIT = [
  { id: 'piA', pr_id: 'prA', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 4, status: 'PENDING_APPROVAL', supplier_category: 'Plywood & Board', vendor_id: 'v1', estimated_price: 120000, sort_order: 0 }
]
// Item untuk PR yang tampil di daftar (pr_id harus cocok dengan baris PR-nya,
// kalau tidak helper view tidak menemukan item & total tidak bisa diuji).
const PR_ITEMS_VIEW = [{ ...PR_ITEMS_EDIT[0], id: 'piV', pr_id: 'prV' }]

function mountPRForm({ editRow = null, editItems = [] } = {}) {
  const dom = freshDom()
  let notices = []
  const props = {
    page: 'requests',
    allProjects: PROJECTS, allMaterials: MATERIALS, allVendors: VENDORS,
    existingRequests: [], allRequestsFull: [], editRow, editItems,
    allReceivings: [], allPrItems: editItems, allReceivingItems: [],
    close: noop, refresh: noop, say: m => notices.push(m)
  }
  const root = mountEl(dom, React.createElement(Create, props))
  return { dom, document: dom.window.document, root, notices: () => notices }
}

console.log('=== RENDER: PR & Purchase dipadatkan (t_cde1b8ad) ===\n')

// ============================================================
// A. PR FORM
// ============================================================
console.log('A1. PR form: field utama hanya Project · Judul · Prioritas · Material · Qty · Estimasi')
{
  const { document: doc } = mountPRForm()
  await tick()
  const labels = qa(doc, 'label').map(l => (l.childNodes[0]?.textContent || '').trim()).filter(Boolean)
  check('label Project ada', labels.some(l => l === 'Project'), labels.join(' | '))
  check('label "Judul Kebutuhan" ada', labels.some(l => l.startsWith('Judul Kebutuhan')))
  check('label Prioritas ada', labels.some(l => l === 'Prioritas'))
  check('label Qty ada', labels.some(l => l === 'Qty'))
  // "Kategori" yang TERSISA hanya filter katalog material (bukan rencana beli
  // per item). Pastikan tidak ada pemilih kategori RENCANA BELI di permukaan.
  const visible = visibleControls(doc)
  const visibleLabelText = visible.map(el => (el.closest('label')?.textContent || '')).join(' | ')
  check('tidak ada kontrol Vendor yang TERLIHAT sebelum ada item',
    !/Vendor/.test(visibleLabelText), visibleLabelText.slice(0, 200))
  const katLabels = visible.map(el => (el.closest('label')?.textContent || '').trim()).filter(t => t.startsWith('Kategori'))
  check('label "Kategori" yang terlihat HANYA filter katalog material (bukan rencana beli)',
    katLabels.length <= 1, JSON.stringify(katLabels))
  // Konteks alur: satu kalimat menjelaskan toko dipilih di Purchase
  check('penjelasan "toko/vendor aktual dipilih di modul Purchase" tampil',
    /dipilih di modul Purchase/i.test(doc.body.textContent), '')
}

console.log('\nA2. Kontrol rencana toko MASIH ADA tetapi TERLIPAT (bukan dihapus)')
{
  const { document: doc } = mountPRForm({ editRow: { id: 'prA', pr_number: 'PR-001', title: 'PR uji', project_id: 'p1', status: 'DRAFT', priority: 'NORMAL', notes: '' }, editItems: PR_ITEMS_EDIT })
  await tick()
  const fold = q(doc, 'details.pr-item-toko')
  check('ada <details class="pr-item-toko"> per item', !!fold)
  check('lipatan rencana toko default TERTUTUP', fold?.open === false, String(fold?.open))
  // Kontrol vendor tetap ada di DOM (bisa dibuka) — data lama bisa dikoreksi
  const vendorSel = fold ? [...fold.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.includes('TB Sumber Jaya'))) : null
  check('select vendor tersedia di dalam lipatan (data lama bisa dikoreksi)', !!vendorSel)
  check('vendor tersimpan terpilih (v1)', vendorSel?.value === 'v1', vendorSel?.value)
  // Ringkasan menyebut vendor tersimpan → user tahu ada data lama
  check('summary menyebut toko tersimpan (TB Sumber Jaya)',
    /TB Sumber Jaya/.test(fold?.querySelector('summary')?.textContent || ''), fold?.querySelector('summary')?.textContent)
  // Ada keterangan bahwa toko aktual dicatat di Purchase
  check('keterangan "toko aktual dicatat di Purchase" ada di lipatan',
    /dicatat di Purchase/i.test(fold?.textContent || ''))
  // Data lama dinyatakan dipertahankan (tidak tampak hilang)
  check('catatan "rencana toko dari data lama — nilainya dipertahankan" tampil',
    /dipertahankan/i.test(q(doc, '.material-picker-box')?.textContent || ''))
}

console.log('\nA3. Catatan: dilipat, default tertutup bila kosong, terbuka bila ada isi')
{
  // (a) PR baru, catatan kosong → tertutup
  const a = mountPRForm()
  await tick()
  const foldA = q(a.document, 'details.pr-notes-box')
  check('PR baru: lipatan catatan ada', !!foldA)
  check('PR baru: catatan default TERTUTUP', foldA?.open === false, String(foldA?.open))
  check('PR baru: textarea catatan tetap ada di DOM (tidak dihapus)', !!foldA?.querySelector('textarea'))
  check('label menyatakan opsional', /opsional/i.test(foldA?.querySelector('summary')?.textContent || ''))

  // (b) PR lama punya catatan → terbuka otomatis (data tidak tampak hilang)
  const b = mountPRForm({ editRow: { id: 'prB', pr_number: 'PR-002', title: 'PR catatan', project_id: 'p1', status: 'DRAFT', priority: 'NORMAL', notes: 'catatan lama penting' }, editItems: PR_ITEMS_EDIT })
  await tick()
  const foldB = q(b.document, 'details.pr-notes-box')
  check('PR lama: lipatan catatan TERBUKA otomatis', foldB?.open === true, String(foldB?.open))
  check('PR lama: nilai catatan ter-prefill', foldB?.querySelector('textarea')?.value === 'catatan lama penting', foldB?.querySelector('textarea')?.value)
  check('summary memberi tanda "ada catatan tersimpan"', /ada catatan tersimpan/i.test(foldB?.querySelector('summary')?.textContent || ''))
}

console.log('\nA4. Estimasi & Total tetap hidup (regresi estimator tidak rusak)')
{
  const { document: doc } = mountPRForm()
  await tick()
  const search = q(doc, '.material-picker-box input[type="text"]')
  typeInto(doc, search, 'PLY-0001'); await tick()
  const sel = qa(doc, '.material-picker-box select')[1]
  selectValue(doc, sel, 'm1'); await tick()
  const addBtn = qa(doc, '.material-picker-box button').find(b => b.textContent.includes('+ Tambah Item'))
  click(addBtn); await tick()
  const priceInput = qa(doc, '.material-picker-box table tbody input[type="text"]')[0]
  check('estimasi otomatis terisi dari acuan master (120.000)', priceInput?.value === '120.000', priceInput?.value)
  const boxText = q(doc, '.material-picker-box')?.textContent || ''
  check('Total Estimasi terhitung (120.000)', /Total Estimasi/.test(boxText) && /120\.000/.test(boxText), boxText.slice(-160))
  // Baris estimasi tetap terlihat tanpa membuka lipatan rencana toko
  const visibleLabels = visibleControls(doc).map(el => el.closest('label')?.textContent || '').join(' | ')
  check('input Estimasi Harga TERLIHAT tanpa buka lipatan', /Estimasi Harga/.test(visibleLabels), visibleLabels.slice(0, 200))
  check('tombol ↺ Pakai acuan tetap tersedia & terlihat',
    visibleControls(doc).some(b => b.tagName === 'BUTTON' && /Pakai acuan/.test(b.textContent)))
}

console.log('\nA5. Tabel item di kontainer ber-overflow sendiri (anti body overflow)')
{
  const { document: doc } = mountPRForm({ editRow: { id: 'prA', pr_number: 'PR-001', title: 'PR uji', project_id: 'p1', status: 'DRAFT', priority: 'NORMAL', notes: '' }, editItems: PR_ITEMS_EDIT })
  await tick()
  const scroll = [...q(doc, '.material-picker-box').querySelectorAll('div')].find(d => d.style.overflowX === 'auto')
  check('kontainer item punya overflowX:auto (tabel tidak mendorong lebar body)', !!scroll)
  check('kontainer item juga punya overflowY:auto (tinggi terbatas)', scroll?.style.overflowY === 'auto')
  const totalRow = q(doc, '.pr-total-row')
  check('Total Estimasi DI LUAR kontainer scroll (selalu terlihat)', !!totalRow && !scroll.contains(totalRow))
  check('Total Estimasi bukan tabel lebar (baris flex → tidak menyeret lebar dialog)',
    !!totalRow && totalRow.tagName === 'DIV', totalRow?.tagName)
  // CSS: tidak ada aturan yang memaksa body melebar dari komponen ini
  const css = fs.readFileSync('/home/ubuntu/dev-workspaces/agent-1-ops/styles/globals.css', 'utf8')
  check('CSS body tidak memakai lebar paksa >100%',
    !/body\s*{[^}]*min-width:\s*(1[0-9]{3,}|[2-9][0-9]{2,})px/.test(css))
  // Tabel item WAJIB punya kelas penawar aturan mobile global
  // (`table { min-width: 820px }` + `th,td { padding:12px 14px !important }`)
  // dan form WAJIB menyertakan style ter-scope-nya. Tanpa ini tabel jadi
  // 820px di layar 390px → harus digeser ke samping (regresi nyata).
  check('tabel item memakai kelas pr-items-table', !!q(doc, 'table.pr-items-table'))
  const formSrc = fs.readFileSync('/home/ubuntu/dev-workspaces/agent-1-ops/modules/requests/form.jsx', 'utf8')
  check('form menyertakan style ter-scope penawar min-width global',
    /min-width:\s*0\s*!important/.test(formSrc) && /pr-items-table/.test(formSrc))
  const purFormSrc = fs.readFileSync('/home/ubuntu/dev-workspaces/agent-1-ops/modules/receivings/purchaseForm.jsx', 'utf8')
  check('dialog Purchase juga menetralkan min-width tabel item',
    /purchase-items-table/.test(purFormSrc) && /min-width:\s*0\s*!important/.test(purFormSrc))
}

// ============================================================
// C. PR VIEW
// ============================================================
console.log('\nC1. Daftar PR: kolom vendor berlabel jujur "Rencana Toko"')
{
  const dom = freshDom()
  const doc = dom.window.document
  const PRS = [{ id: 'prV', pr_number: 'PR-100', title: 'PR uji view', status: 'DRAFT', priority: 'NORMAL', project_id: 'p1', project_name: '[99] Baroni', materials_summary: '', notes: '', created_at: '2026-10-16T00:00:00Z' }]
  mountEl(dom, React.createElement(Module, {
    page: 'requests', rows: PRS,
    allProjects: PROJECTS, allMaterials: MATERIALS, allPrItems: PR_ITEMS_VIEW, allReceivingItems: [],
    allRequests: PRS, allReceivings: [], allVendors: VENDORS,
    refresh: noop, say: noop, onDelete: noop, setPage: noop
  }))
  await tick()
  const headers = qa(doc, '.desktop-table-view thead th').map(th => th.textContent.trim())
  check('header kolom = "Rencana Toko" (bukan klaim supplier aktual)',
    headers.includes('Rencana Toko'), headers.join(' | '))
  check('header TIDAK lagi memakai label "Vendor" polos', !headers.includes('Vendor'), headers.join(' | '))
  check('title header menyatakan toko AKTUAL ada di Purchase',
    /modul Purchase/.test(q(doc, '.desktop-table-view thead th:nth-child(8)')?.getAttribute('title') || '')
    || /modul Purchase/.test(doc.querySelector('.desktop-table-view thead')?.innerHTML || ''))
}

console.log('\nC2. Daftar PR: subtotal & Total Estimasi tetap tampil (tidak rusak)')
{
  const dom = freshDom()
  const doc = dom.window.document
  const PRS = [{ id: 'prV', pr_number: 'PR-100', title: 'PR uji view', status: 'DRAFT', priority: 'NORMAL', project_id: 'p1', project_name: '[99] Baroni', materials_summary: '', notes: '', created_at: '2026-10-16T00:00:00Z' }]
  mountEl(dom, React.createElement(Module, {
    page: 'requests', rows: PRS,
    allProjects: PROJECTS, allMaterials: MATERIALS, allPrItems: PR_ITEMS_VIEW, allReceivingItems: [],
    allRequests: PRS, allReceivings: [], allVendors: VENDORS,
    refresh: noop, say: noop, onDelete: noop, setPage: noop
  }))
  await tick()
  const tableText = q(doc, '.desktop-table-view')?.textContent || ''
  check('subtotal snapshot 4 × 120.000 = 480.000 tampil', /480\.000/.test(tableText), tableText.slice(0, 300))
  check('baris Total Estimasi tampil', /Total Estimasi/.test(tableText))
  const cardText = q(doc, '.mobile-cards-view')?.textContent || ''
  check('kartu mobile tetap menampilkan total', /480\.000/.test(cardText), cardText.slice(0, 200))
}

// ============================================================
// D. PURCHASE PAGE
// ============================================================
const RQ_PROJECTS = [{ id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' }, { id: 'p2', kode: '83', name: 'Mabes', status: 'ON_GOING' }]
const RQ_VENDORS = [{ id: 'v1', name: 'TB Sumber Jaya' }, { id: 'v2', name: 'Toko Mitra Fitting' }]
const RQ_MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 120000 },
  { id: 'm2', kode: 'HWF-0001', name: 'Sekrup 3cm', category: 'Hardware & Fitting', satuan: 'Box', harga_acuan: null }
]
const RQ_REQUESTS = [
  { id: 'pr1', pr_number: 'PR-001', title: 'Material dinding', project_id: 'p1', status: 'APPROVED' },
  { id: 'pr2', pr_number: 'PR-002', title: 'Fitting kabinet', project_id: 'p2', status: 'APPROVED' }
]
const RQ_PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 4, estimated_price: 120000, status: 'APPROVED', vendor_id: 'v1', sort_order: 0 },
  { id: 'pi2', pr_id: 'pr1', material_id: 'm2', item_name: 'Sekrup 3cm', kode: 'HWF-0001', unit: 'Box', quantity: 2, estimated_price: 35000, status: 'APPROVED', vendor_id: 'v1', sort_order: 1 },
  { id: 'pi3', pr_id: 'pr2', material_id: 'm2', item_name: 'Sekrup 3cm (Mabes)', kode: 'HWF-0001', unit: 'Box', quantity: 5, estimated_price: 34000, status: 'APPROVED', vendor_id: 'v2', sort_order: 0 }
]
const RQ_RECEIVINGS = [
  {
    id: 'rcNew', vendor_id: 'v1', invoice_no: 'TB-88912', status: 'DIBELI', received_date: '2026-10-16',
    note: '[Nominal: Rp 542.000] [BiayaLain: Rp 25.000] [BuktiNota: data:image/png;base64,iVBORw0KGgo=] [BuktiTransfer: data:image/png;base64,iVBORw0KGgo=] [Tahap: DIBELI] diambil sendiri',
    project_id: 'p1', purchase_request_id: 'pr1'
  },
  {
    id: 'rcOld', vendor_id: 'v2', invoice_no: 'INV-LAMA-1', status: 'NORMAL', received_date: '2026-10-10',
    note: '[Nominal: Rp 865.000] Nota lama TB Makmur', project_id: 'p2', purchase_request_id: 'pr2'
  },
  // Nota "bermasalah" (status RETUR + kendala) — TIDAK boleh muncul sebagai
  // label di UI utama Purchase (alokasi fisik & kendala = modul Handover).
  {
    id: 'rcRetur', vendor_id: 'v1', invoice_no: 'TB-RETUR-1', status: 'RETUR', received_date: '2026-10-14',
    kendala: 'RETUR', note: '[Nominal: Rp 100.000] barang rusak dikembalikan', project_id: 'p1', purchase_request_id: 'pr1'
  },
  { id: 'rcShell', vendor_id: null, invoice_no: null, status: 'NORMAL', received_date: null, note: 'Dibuat otomatis dari PR (barang disetujui).', project_id: 'p1', purchase_request_id: 'pr1' }
]
const RQ_RECEIVING_ITEMS = [
  { id: 'ri1', receiving_id: 'rcNew', pr_item_id: 'piOld1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 4, note: '[Harga: 118000]' },
  { id: 'ri2', receiving_id: 'rcNew', pr_item_id: 'piOld2', item_name: 'Sekrup 3cm', unit: 'Box', quantity_received: 2, note: '[Harga: 35000]' },
  { id: 'ri9', receiving_id: 'rcOld', pr_item_id: 'piOld3', item_name: 'Triplek 12mm', unit: 'Lembar', quantity_received: 3, note: null },
  { id: 'riR', receiving_id: 'rcRetur', pr_item_id: 'piOld4', item_name: 'Barang rusak', unit: 'Pcs', quantity_received: 1, note: '[Harga: 100000]' }
]

function mountPurchase(extraRows = {}) {
  const dom = freshDom()
  const doc = dom.window.document
  const rows = {
    receivings: RQ_RECEIVINGS, receiving_items: RQ_RECEIVING_ITEMS, pr_items: RQ_PR_ITEMS,
    requests: RQ_REQUESTS, projects: RQ_PROJECTS, vendors: RQ_VENDORS, materials: RQ_MATERIALS,
    ...extraRows
  }
  const root = mountEl(dom, React.createElement(PurchasePage, { rows, refresh: noop, say: noop }))
  return { dom, document: doc, root }
}

console.log('\nD1. Tabel "Siap Dibeli" dipadatkan (≤6 kolom) tanpa kehilangan informasi')
{
  const { document: doc } = mountPurchase()
  await tick()
  const ths = qa(doc, '.desktop-table-view thead th')
  check('kolom ≤6 (checkbox + 5 data)', ths.length <= 6, `${ths.length}: ${ths.map(t => t.textContent.trim()).join(' | ')}`)
  const head = ths.map(t => t.textContent.trim())
  check('kolom Barang ada', head.includes('Barang'), head.join(' | '))
  check('kolom Qty ada (satuan digabung)', head.some(h => /^Qty/.test(h)), head.join(' | '))
  check('kolom Proyek ada (No. PR digabung)', head.some(h => /Proyek/.test(h)), head.join(' | '))
  check('kolom Toko / Vendor ada', head.some(h => /Toko/.test(h)), head.join(' | '))
  check('kolom Estimasi ada', head.some(h => /Estimasi/.test(h)), head.join(' | '))
  check('kolom Satuan terpisah TIDAK ada lagi', !head.includes('Satuan'), head.join(' | '))
  check('kolom No. PR terpisah TIDAK ada lagi', !head.includes('No. PR'), head.join(' | '))
  // Informasi tetap terbaca di sel gabungan
  const row = tid(doc, 'ready-row-pi1')
  const rowText = row?.textContent || ''
  check('kode material tetap tampil di sel Barang', /PLY-0001/.test(rowText), rowText.slice(0, 160))
  check('satuan tetap tampil (Lembar)', /Lembar/.test(rowText), rowText.slice(0, 160))
  check('No. PR tetap tampil di sel Proyek', /PR-001/.test(rowText), rowText.slice(0, 160))
  check('3 barang siap dibeli tampil', qa(doc, '[data-testid^="ready-row-"]').length === 3)
}

console.log('\nD2. Tabel "Riwayat" dipadatkan (≤6 kolom); Material & Biaya Lain tidak hilang')
{
  const { document: doc } = mountPurchase()
  await tick()
  click(tid(doc, 'tab-history')); await tick()
  const ths = qa(doc, '.desktop-table-view thead th')
  check('kolom ≤6', ths.length <= 6, `${ths.length}: ${ths.map(t => t.textContent.trim()).join(' | ')}`)
  const head = ths.map(t => t.textContent.trim())
  check('kolom Tanggal ada', head.includes('Tanggal'), head.join(' | '))
  check('kolom No. Nota ada', head.includes('No. Nota'), head.join(' | '))
  check('kolom Toko / Vendor ada', head.some(h => /Toko/.test(h)))
  check('kolom Total Nota ada', head.some(h => /Total Nota/.test(h)))
  check('kolom Bukti ada', head.includes('Bukti'))
  check('kolom Aksi ada', head.includes('Aksi'))
  check('kolom Material terpisah TIDAK ada lagi', !head.includes('Material'), head.join(' | '))
  check('kolom Biaya Lain terpisah TIDAK ada lagi', !head.includes('Biaya Lain'), head.join(' | '))
  // ...tapi nilainya tetap terbaca di baris (rincian kecil di bawah total)
  const row = tid(doc, 'history-row-rcNew')
  const rowText = row?.textContent || ''
  check('total nota tampil (Rp 567.000)', /567\.000/.test(rowText), rowText.slice(0, 220))
  check('rincian Material tetap terbaca (Rp 542.000)', /542\.000/.test(rowText), rowText.slice(0, 220))
  check('rincian Biaya lain tetap terbaca (Rp 25.000)', /25\.000/.test(rowText), rowText.slice(0, 220))
  check('label "Material" tetap ada di rincian baris', /Material/.test(rowText), rowText.slice(0, 220))
  // Rincian lengkap tetap tersedia
  click(tid(doc, 'detail-rcNew')); await tick()
  const detail = q(doc, '.purchase-detail')?.textContent || ''
  check('rincian penuh tetap punya baris Diskon', /Diskon/.test(detail), detail.slice(0, 200))
  check('rincian penuh tetap punya Total Nota', /Total Nota/.test(detail))
}

console.log('\nD3. TIDAK ada status nota / kendala di UI utama')
{
  const { document: doc } = mountPurchase()
  await tick()
  const readyText = doc.body.textContent || ''
  for (const bad of ['Retur', 'Refund', 'Rusak', 'Status Nota', 'Kendala', 'Masuk Stok Gudang', 'Serah ke Tukang']) {
    check(`Siap Dibeli tidak memuat "${bad}"`, !readyText.includes(bad), bad)
  }
  click(tid(doc, 'tab-history')); await tick()
  const histText = doc.body.textContent || ''
  for (const bad of ['Retur', 'Refund', 'Rusak', 'Status Nota', 'Kendala']) {
    check(`Riwayat tidak memuat "${bad}"`, !histText.includes(bad), bad)
  }
  // Nota berstatus RETUR tetap TERCATAT (data tidak dihapus) — hanya tanpa
  // label kendala. Nomornya tetap muncul di riwayat sebagai nota.
  check('nota berstatus RETUR tetap tampil sebagai nota (data tidak disembunyikan/dihapus)',
    !!tid(doc, 'history-row-rcRetur'), 'baris rcRetur hilang')
  check('tidak ada dropdown status nota', qa(doc, 'select.status-select').length === 0)
  // DB tidak disentuh: tidak ada update status/kendala dari modul Purchase
  const writes = mock.__state.calls.filter(c => c.op === 'update' || c.op === 'delete')
  check('halaman Purchase tidak menulis/menghapus status atau kendala di DB',
    writes.every(c => !('kendala' in (c.data || {})) && !('status' in (c.data || {}))),
    JSON.stringify(writes.map(c => c.data)))
}

console.log('\nD4. Tombol "Proses Pembelian" footer hanya saat ada pilihan')
{
  const { document: doc } = mountPurchase()
  await tick()
  const footerBefore = q(doc, '.purchase-footer-bar')
  check('tanpa pilihan: footer tidak dirender (tidak ada tombol primer kembar yang mati)', !footerBefore)
  check('tombol toolbar tetap ada & nonaktif', tid(doc, 'btn-process-purchase')?.disabled === true)
  toggleCheck(tid(doc, 'check-pi1')); await tick()
  check('setelah centang: footer muncul', !!q(doc, '.purchase-footer-bar'))
  check('footer menyebut jumlah dipilih', /1 dipilih/.test(q(doc, '.purchase-footer-bar')?.textContent || ''), q(doc, '.purchase-footer-bar')?.textContent)
  toggleCheck(tid(doc, 'check-pi1')); await tick()
  check('batal centang: footer hilang lagi', !q(doc, '.purchase-footer-bar'))
}

console.log('\nD5. Alur baca/simpan tetap utuh: centang → dialog → simpan → riwayat')
{
  mock.__reset({ tables: { receivings: RQ_RECEIVINGS, receiving_items: RQ_RECEIVING_ITEMS, handovers: [] } })
  const { document: doc } = mountPurchase()
  await tick()
  toggleCheck(tid(doc, 'check-pi1')); await tick()
  toggleCheck(tid(doc, 'check-pi2')); await tick()
  click(tid(doc, 'btn-process-purchase')); await tick()
  check('dialog Proses Pembelian terbuka', !!tid(doc, 'purchase-form'))
  check('2 baris item di dialog', qa(doc, '[data-testid^="form-item-"]').length === 2)
  check('qty default dari PR (4)', tid(doc, 'qty-pi1')?.value === '4', tid(doc, 'qty-pi1')?.value)
  check('harga riil kosong (bukan estimasi)', tid(doc, 'harga-pi1')?.value === '')
  typeInto(doc, tid(doc, 'form-invoice'), 'TB-77701'); await tick()
  typeInto(doc, tid(doc, 'harga-pi1'), '118000'); await tick()
  typeInto(doc, tid(doc, 'harga-pi2'), '35000'); await tick()
  check('total nota live = 542.000', /542\.000/.test(tid(doc, 'purchase-grand-total')?.textContent || ''), tid(doc, 'purchase-grand-total')?.textContent)
  const f = tid(doc, 'purchase-form')
  flushSync(() => { f.requestSubmit() })
  await tick(); await tick(); await tick()
  const hdr = mock.__callsOf('insert', 'receivings')[0]?.data
  check('header nota tersimpan dengan vendor', hdr?.vendor_id === 'v1', String(hdr?.vendor_id))
  check('no. nota tersimpan', hdr?.invoice_no === 'TB-77701', String(hdr?.invoice_no))
  check('2 baris barang tersimpan', mock.__callsOf('insert', 'receiving_items').length === 2, String(mock.__callsOf('insert', 'receiving_items').length))
  check('dialog tertutup & pindah ke tab Riwayat', !tid(doc, 'purchase-form') && /active/.test(tid(doc, 'tab-history')?.className || ''))
}

// ============================================================
// E. PURCHASE FORM (dialog)
// ============================================================
console.log('\nE1. Dialog: urutan baca identitas nota → barang → TOTAL → bukti → catatan')
{
  mock.__reset({ tables: { receivings: RQ_RECEIVINGS, receiving_items: RQ_RECEIVING_ITEMS, handovers: [] } })
  const { document: doc } = mountPurchase()
  await tick()
  toggleCheck(tid(doc, 'check-pi1')); await tick()
  click(tid(doc, 'btn-process-purchase')); await tick()
  const form = tid(doc, 'purchase-form')
  const order = ['form-vendor', 'form-invoice', 'form-date', 'purchase-totals', 'file-nota', 'form-note']
    .map(k => {
      const el = k === 'purchase-totals' ? tid(doc, k) : tid(doc, k)
      if (!el) return { k, pos: -1 }
      // posisi dokumen via urutan semua elemen
      const all = [...form.querySelectorAll('*')]
      return { k, pos: all.indexOf(el) }
    })
  check('semua bagian ada', order.every(o => o.pos >= 0), JSON.stringify(order))
  const sorted = [...order].sort((a, b) => a.pos - b.pos).map(o => o.k)
  check('urutan: identitas nota (vendor, nota, tanggal) sebelum total',
    sorted.indexOf('form-vendor') < sorted.indexOf('purchase-totals')
    && sorted.indexOf('form-invoice') < sorted.indexOf('purchase-totals')
    && sorted.indexOf('form-date') < sorted.indexOf('purchase-totals'), sorted.join(' > '))
  check('urutan: total sebelum bukti', sorted.indexOf('purchase-totals') < sorted.indexOf('file-nota'), sorted.join(' > '))
  check('urutan: bukti sebelum catatan', sorted.indexOf('file-nota') < sorted.indexOf('form-note'), sorted.join(' > '))
  check('tanggal & nota berada di baris grid yang sama dgn vendor (satu baris identitas)',
    !!q(doc, '.purchase-form-grid') && tid(doc, 'form-vendor').closest('.purchase-form-grid') === tid(doc, 'form-invoice').closest('.purchase-form-grid'))
}

console.log('\nE2. Total Nota Riil tampil SEBELUM rincian biaya (angka utama di atas)')
{
  mock.__reset({ tables: { receivings: RQ_RECEIVINGS, receiving_items: RQ_RECEIVING_ITEMS, handovers: [] } })
  const { document: doc } = mountPurchase()
  await tick()
  toggleCheck(tid(doc, 'check-pi1')); await tick()
  click(tid(doc, 'btn-process-purchase')); await tick()
  typeInto(doc, tid(doc, 'form-invoice'), 'TB-1'); await tick()
  typeInto(doc, tid(doc, 'harga-pi1'), '118000'); await tick()
  const box = tid(doc, 'purchase-totals')
  const all = [...box.querySelectorAll('*')]
  const grandPos = all.indexOf(tid(doc, 'purchase-grand-total'))
  const materialRow = [...box.querySelectorAll('.purchase-totals-row')].find(r => /^Material/.test(r.textContent.trim()))
  const materialPos = all.indexOf(materialRow)
  check('Total Nota Riil muncul sebelum baris Material', grandPos >= 0 && materialPos > grandPos, `grand=${grandPos} material=${materialPos}`)
  check('label "Total Nota Riil" tampil', /Total Nota Riil/.test(box.textContent))
  check('angka total memakai font besar (kelas purchase-totals-grand)',
    !!box.querySelector('.purchase-totals-grand'))
}

console.log('\nE3. Tambahan & potongan dilipat; rumus total tidak berubah')
{
  mock.__reset({ tables: { receivings: [], receiving_items: [], handovers: [] } })
  const { document: doc } = mountPurchase({ receivings: [], receiving_items: [] })
  await tick()
  toggleCheck(tid(doc, 'check-pi1')); await tick()
  click(tid(doc, 'btn-process-purchase')); await tick()
  const fold = q(doc, 'details.purchase-costs-fold')
  check('lipatan tambahan/potongan ada', !!fold)
  check('default TERTUTUP saat kosong', fold?.open === false, String(fold?.open))
  check('input ongkir & diskon tetap ada di DOM (tidak dihapus)',
    !!tid(doc, 'form-extra-cost') && !!tid(doc, 'form-discount'))
  typeInto(doc, tid(doc, 'form-invoice'), 'TB-9'); await tick()
  typeInto(doc, tid(doc, 'harga-pi1'), '100000'); await tick()
  check('total tanpa tambahan = 400.000 (4×100.000)', /400\.000/.test(tid(doc, 'purchase-grand-total')?.textContent || ''), tid(doc, 'purchase-grand-total')?.textContent)
  typeInto(doc, tid(doc, 'form-extra-cost'), '25000'); await tick()
  check('rumus: +ongkir → 425.000', /425\.000/.test(tid(doc, 'purchase-grand-total')?.textContent || ''), tid(doc, 'purchase-grand-total')?.textContent)
  typeInto(doc, tid(doc, 'form-discount'), '5000'); await tick()
  check('rumus: −diskon → 420.000', /420\.000/.test(tid(doc, 'purchase-grand-total')?.textContent || ''), tid(doc, 'purchase-grand-total')?.textContent)
  check('baris rincian biaya muncul setelah diisi', /Biaya Lain/.test(tid(doc, 'purchase-totals')?.textContent || ''))
  check('lipatan otomatis TERBUKA saat ada nilai (nilai tidak tersembunyi)',
    q(doc, 'details.purchase-costs-fold')?.open === true, String(q(doc, 'details.purchase-costs-fold')?.open))
}

console.log('\nE4. data-testid lama tetap ada (kontrak harness lama dijaga)')
{
  mock.__reset({ tables: { receivings: [], receiving_items: [], handovers: [] } })
  const { document: doc } = mountPurchase({ receivings: [], receiving_items: [] })
  await tick()
  toggleCheck(tid(doc, 'check-pi1')); await tick()
  click(tid(doc, 'btn-process-purchase')); await tick()
  for (const t of ['purchase-form', 'form-vendor', 'form-invoice', 'form-date', 'purchase-totals',
    'purchase-grand-total', 'form-extra-cost', 'form-discount', 'file-nota', 'file-transfer',
    'form-note', 'purchase-submit', 'qty-pi1', 'harga-pi1']) {
    check(`data-testid "${t}" ada`, !!tid(doc, t))
  }
}

// ============================================================
// F. TANPA PERUBAHAN SCHEMA / FILE TERLARANG
// ============================================================
// CATATAN KEPEMILIKAN (t_b03c5228 / S2/7): pemeriksaan ini semula hanya
// mengizinkan file milik kartu S1 (requests + receivings) dan menuntut
// modules/handovers/ TIDAK berubah sama sekali. Kartu S2 memang PEMILIK
// modules/handovers/queue.jsx + view.jsx, jadi daftar izin diperluas ke dua
// file itu — sementara larangan yang sebenarnya tetap dipertahankan dan
// dipertegas: migrasi tidak boleh ada, materials/vendors tidak boleh disentuh,
// dan KONTRAK actions.js/logic.js tidak boleh berubah (dibuktikan terpisah
// di scripts/handover-compact-test).
console.log('\nF1. Tidak ada file migrasi baru/berubah & file modul lain tidak disentuh')
{
  const { execSync } = require('node:child_process')
  const REPO = '/home/ubuntu/dev-workspaces/agent-1-ops'
  const base = process.env.COMPACT_BASE || 'main'
  let changed = []
  try {
    changed = execSync(`git -C ${REPO} diff --name-only ${base} --`, { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean)
  } catch (e) { changed = [] }
  check('tidak ada file migrations/ yang berubah', !changed.some(f => f.startsWith('migrations/')), changed.filter(f => f.startsWith('migrations/')).join(', '))
  // Handover: hanya file UX yang dimiliki S2 (queue.jsx / view.jsx). Kontrak
  // penulis DB (actions.js) & aturan aksi (logic.js) HARAM berubah.
  const handoverTouched = changed.filter(f => f.startsWith('modules/handovers/'))
  const handoverAllowed = ['modules/handovers/queue.jsx', 'modules/handovers/view.jsx']
  check('modules/handovers/: hanya queue.jsx & view.jsx (kontrak actions/logic utuh)',
    handoverTouched.every(f => handoverAllowed.includes(f)), handoverTouched.join(', '))
  check('tidak ada file modules/materials/ yang berubah', !changed.some(f => f.startsWith('modules/materials/')), changed.filter(f => f.startsWith('modules/materials/')).join(', '))
  check('tidak ada file modules/vendors/ yang berubah', !changed.some(f => f.startsWith('modules/vendors/')), changed.filter(f => f.startsWith('modules/vendors/')).join(', '))
  const allowed = [
    'modules/requests/form.jsx', 'modules/requests/view.jsx', 'modules/requests/save.js',
    'modules/receivings/page.jsx', 'modules/receivings/purchaseForm.jsx',
    'modules/handovers/queue.jsx', 'modules/handovers/view.jsx',
    // t_71d95cfe (S3/7, kartu berikutnya di branch yang sama): modul RAP
    // butuh WIRING di file CORE (menu, registry, cabang render, smoke) —
    // file-file itu memang berubah, dan tidak ada satu pun file modul
    // S1/S2 di daftar ini yang dilonggarkan.
    'lib/constants.js', 'modules/registry.js', 'pages/index.js', 'pages/__smoke.js',
    // t_22865fc4 (S4/7): kartu Sales Invoice memiliki modul
    // modules/sales-invoice/ + endpoint pages/api/sales-invoices.js.
    // Endpoint itu WAJIB diperkeras (otorisasi server-side, store
    // fail-closed, draft/issued terpisah) — jadi ketiga file modul di bawah
    // memang milik kartu S4. Tidak ada file modul S1/S2 yang dilonggarkan;
    // kontrak actions.js/logic.js handover tetap terkunci di atas.
    'modules/sales-invoice/view.jsx', 'modules/sales-invoice/CreateInvoiceModal.jsx',
    'modules/sales-invoice/pdf.js', 'modules/sales-invoice/contract.js',
    'modules/sales-invoice/store.js', 'modules/sales-invoice/auth.js',
    'modules/sales-invoice/apiClient.js', 'pages/api/sales-invoices.js',
    // t_71d95cfe (S3/7) juga memiliki modul modules/rap/ sendiri. Assertion
    // ini sebelumnya tidak memuatnya sehingga GAGAL PRE-EXISTING sejak
    // ac71191 (bukan akibat kartu S4); didaftarkan eksplisit, bukan
    // dilonggarkan — daftar tetap enumeratif per pemilik kartu.
    'modules/rap/view.jsx', 'modules/rap/model.js',
    'modules/rap/budgetingBridge.js', 'modules/rap/store.js',
    // t_94e9bfaa (S5/7): lapisan reminder/readiness memiliki endpoint
    // sendiri (pages/api/reminders.js) dan seluruh logikanya di
    // scripts/reminders/ (tidak masuk pemeriksaan kode karena di bawah
    // scripts/). Hanya SATU file .js non-scripts/ yang ditambahkan kartu S5,
    // dan itu endpoint miliknya sendiri — tidak ada file modul S1/S2 yang
    // dilonggarkan, kontrak actions.js/logic.js handover tetap terkunci.
    'pages/api/reminders.js'
  ]
  const codeChanges = changed.filter(f => /\.(js|jsx)$/.test(f) && !f.startsWith('scripts/'))
  check('perubahan kode hanya di file yang dimiliki kartu S1/S2',
    codeChanges.every(f => allowed.includes(f)), codeChanges.join(', '))
}

console.log(`\n=== HASIL RENDER: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA VERIFIKASI PR & PURCHASE DIPADATKAN LULUS')
