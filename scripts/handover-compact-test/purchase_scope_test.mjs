// ============================================================
// PURCHASE SCOPE TEST — modules/receivings/page.jsx ASLI (dist SWC) di jsdom.
// t_b03c5228 (S2/7): membuktikan Purchase BERHENTI di "barang dibeli" —
// tidak ada satu pun kontrol distribusi fisik, tidak ada field fisik ganda,
// dan status/kendala nota tidak tampil. Plus pemeriksaan statis: jalur simpan
// Purchase tidak menulis kolom distribusi fisik.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
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
const tid = (doc, t) => doc.querySelector(`[data-testid="${t}"]`)
const noop = () => {}

// ---------- 4) Fixture ----------
const PROJECTS = [{ id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' }]
const VENDORS = [{ id: 'v1', name: 'TB Sumber Jaya' }]
const MATERIALS = [{ id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 120000 }]
const REQUESTS = [{ id: 'pr1', pr_number: 'PR-001', title: 'Material dinding', project_id: 'p1', status: 'APPROVED' }]
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 4, estimated_price: 120000, status: 'APPROVED', vendor_id: 'v1', sort_order: 0 },
  { id: 'pi2', pr_id: 'pr1', material_id: 'm1', item_name: 'Sekrup 3cm', kode: 'HWF-0001', unit: 'Box', quantity: 2, estimated_price: 35000, status: 'APPROVED', vendor_id: 'v1', sort_order: 1 }
]
// Nota selesai dibeli — status RETUR + kendala sengaja diisi untuk membuktikan
// UI Purchase TIDAK menampilkannya.
const RECEIVINGS = [
  {
    id: 'rc1', vendor_id: 'v1', invoice_no: 'TB-88912', status: 'RETUR', kendala: 'RETUR', received_date: '2026-10-16',
    note: '[Nominal: Rp 542.000] [Tahap: DIBELI]', project_id: 'p1', purchase_request_id: 'pr1',
    alokasi: 'KE_TUKANG', masuk_gudang: true, tukang_at: '2026-10-16T03:00:00Z'
  },
  {
    id: 'rc2', vendor_id: 'v1', invoice_no: 'INV-LAMA-1', status: 'NORMAL', kendala: null, received_date: '2026-10-10',
    note: '[Nominal: Rp 120.000] Nota lama', project_id: 'p1', purchase_request_id: 'pr1',
    alokasi: null, masuk_gudang: false, tukang_at: null
  }
]
const RECEIVING_ITEMS = [
  { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'piOld1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 4, note: '[Harga: 118000]' },
  { id: 'ri2', receiving_id: 'rc1', pr_item_id: 'piOld2', item_name: 'Sekrup 3cm', unit: 'Box', quantity_received: 2, note: '[Harga: 35000]' },
  { id: 'ri9', receiving_id: 'rc2', pr_item_id: 'piOld3', item_name: 'Triplek 12mm', unit: 'Lembar', quantity_received: 1, note: null }
]

function mount(extraRows = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* read-only */ }
  const rows = {
    receivings: RECEIVINGS, receiving_items: RECEIVING_ITEMS, pr_items: PR_ITEMS,
    requests: REQUESTS, projects: PROJECTS, vendors: VENDORS, materials: MATERIALS,
    ...extraRows
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(PurchasePage, { rows, refresh: noop, say: noop })))
  return { dom, root, document }
}

console.log('=== B1. PURCHASE TIDAK PUNYA KONTROL DISTRIBUSI FISIK ===\n')
{
  mock.__reset({ tables: { receivings: RECEIVINGS, receiving_items: RECEIVING_ITEMS, handovers: [] } })
  const { document: doc } = mount()
  await tick()
  const readyText = doc.body.textContent || ''
  const forbidden = [
    ['Masuk Stok Gudang', /Masuk Stok Gudang/i],
    ['Ke Gudang', /Ke Gudang/i],
    ['Serah Terima ke Tukang', /Serah Terima ke Tukang/i],
    ['Ke Tukang', /Ke Tukang/i],
    ['Retur', /Retur/i],
    ['Refund', /Refund/i],
    ['Bermasalah', /Bermasalah/i]
  ]
  for (const [name, re] of forbidden) {
    check(`B1 tab Siap Dibeli: tidak ada "${name}"`, !re.test(readyText))
  }
  // Pindah ke Riwayat — sama saja
  click(tid(doc, 'tab-history')); await tick()
  const histText = doc.body.textContent || ''
  for (const [name, re] of forbidden) {
    check(`B1 tab Riwayat: tidak ada "${name}"`, !re.test(histText))
  }
  // Rincian nota dibuka: tetap tidak ada kontrol fisik
  const detailBtn = tid(doc, 'detail-rc1')
  check('B1 tombol rincian nota ada (informasi tidak hilang)', !!detailBtn)
  click(detailBtn); await tick()
  const afterDetail = doc.body.textContent || ''
  for (const [name, re] of forbidden) {
    check(`B1 rincian terbuka: tidak ada "${name}"`, !re.test(afterDetail))
  }
  // Tidak ada select/checkbox untuk alokasi/status nota
  const selects = [...doc.querySelectorAll('select')].map(s => (s.getAttribute('data-testid') || '') + '|' + s.textContent.slice(0, 60))
  check('B1 tidak ada dropdown status nota/alokasi', !selects.some(s => /status|alokasi|gudang|tukang|retur/i.test(s)), selects.join(' ;; '))
}

console.log('\n=== B2. STATUS & KENDALA NOTA TIDAK DITAMPILKAN ===\n')
{
  const { document: doc } = mount()
  await tick()
  click(tid(doc, 'tab-history')); await tick()
  const text = doc.body.textContent || ''
  check('B2a nota RETUR tetap tampil sebagai nota (data tidak disembunyikan)', !!tid(doc, 'history-row-rc1'))
  check('B2b kode status RETUR tidak tampil', !/RETUR/.test(text))
  check('B2c label "⚠️ Retur" tidak tampil', !/Retur/.test(text))
  check('B2d label "Refund" tidak tampil', !/Refund/i.test(text))
  check('B2e nominal nota RETUR tetap terbaca', /542\.000/.test(text), '')
  check('B2f kendala tidak muncul sebagai kolom/teks', !/kendala/i.test(text))
}

console.log('\n=== B3. TIDAK ADA FIELD FISIK DI TEKS UI PURCHASE ===\n')
{
  const { document: doc } = mount()
  await tick()
  const readyText = doc.body.textContent || ''
  click(tid(doc, 'tab-history')); await tick()
  const histText = doc.body.textContent || ''
  const all = readyText + '\n' + histText
  for (const token of ['masuk_gudang', 'tukang_at', 'alokasi', 'kendala', 'diserahkan_at', 'KE_GUDANG', 'KE_TUKANG', 'DI_GUDANG', 'DI_TUKANG']) {
    check(`B3 kolom fisik "${token}" tidak bocor ke UI`, !all.includes(token))
  }
}

console.log('\n=== B4. JALUR SIMPAN PURCHASE TIDAK MENULIS KOLOM FISIK ===\n')
{
  // Pemeriksaan statis pada sumber asli (bukan hasil kompilasi) — memastikan
  // Purchase tidak pernah meng-update kolom distribusi fisik pada nota yang
  // sudah ada. Satu-satunya nilai fisik di purchaseSave.js adalah inisialisasi
  // header BARU (alokasi: null, masuk_gudang: false) — bukan penulisan status.
  const saveSrc = fs.readFileSync(path.join(SB, 'dist/modules/receivings/purchaseSave.mjs'), 'utf8')
  const updates = [...saveSrc.matchAll(/\.update\(\{([^}]*)\}/gs)].map(m => m[1])
  const physical = ['masuk_gudang', 'tukang_at', 'alokasi', 'diserahkan_at']
  const offenders = updates.filter(u => physical.some(k => new RegExp(`\\b${k}\\s*:`).test(u)))
  check('B4a update() nota tidak pernah menulis kolom fisik', offenders.length === 0, offenders.join(' || '))
  // Inisialisasi header baru boleh menyetel nilai awal — dipastikan memang di
  // objek `row` yang di-INSERT, BUKAN di `baseHeader`/`patch` yang dipakai UPDATE.
  const baseHeaderBlock = (saveSrc.match(/baseHeader\s*=\s*\{([\s\S]*?)\n\s*\};/) || [])[1] || ''
  check('B4b baseHeader (dipakai UPDATE) tidak memuat kolom fisik',
    baseHeaderBlock.length > 0 && !/masuk_gudang|tukang_at|alokasi|diserahkan_at/.test(baseHeaderBlock), baseHeaderBlock.slice(0, 200))
  // B4c/B4c2 — PERILAKU, bukan grep nama variabel. Versi lama mencocokkan
  // `.insert(row)` pada HASIL KOMPILASI SWC; SWC menamai ulang variabel
  // (`row` -> `row1`), jadi test merah padahal perilakunya benar — dan
  // sebaliknya bisa hijau saat perilaku berubah. Sekarang jalur simpan
  // BENAR-BENAR DIJALANKAN pada mock perekam, lalu payload yang dikirim ke
  // DB diperiksa apa adanya.
  const { savePurchaseWithClient } = await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/purchaseSave.mjs')).href)
  mock.__reset({})
  const notaForm = {
    vendorId: 'v1', tanggal: '2026-10-23', invoiceNo: 'TB-B4-1',
    items: [{ itemName: 'Triplek 9mm', unit: 'Lembar', qty: 2, harga: 100000, projectId: 'p1' }]
  }
  const savedNota = await savePurchaseWithClient({
    client: mock.supabase, form: notaForm, vendors: [{ id: 'v1', name: 'TB Sumber Jaya' }]
  })
  const headerRow = (mock.__callsOf('insert', 'receivings')[0] || {}).data
  check('B4c header BARU ditulis dengan alokasi=null & masuk_gudang=false',
    !!headerRow && headerRow.alokasi === null && headerRow.masuk_gudang === false,
    headerRow ? JSON.stringify(headerRow).slice(0, 240) : 'tidak ada insert receivings')
  check('B4c2 header itu benar-benar dipakai membuat nota (insert jalan, receivingId kembali)',
    savedNota?.ok === true && !!savedNota?.receivingId,
    JSON.stringify(savedNota).slice(0, 240))
  const physicalUpdates = mock.__callsOf('update', 'receivings')
    .filter(c => ['masuk_gudang', 'tukang_at', 'alokasi', 'diserahkan_at'].some(k => k in (c.data || {})))
  check('B4c3 jalur simpan tidak menulis kolom fisik lewat UPDATE',
    physicalUpdates.length === 0, JSON.stringify(physicalUpdates).slice(0, 240))
  // Status nota hanya ditulis sebagai penanda "sudah dibeli" — bukan retur/refund.
  const statusWrites = [...saveSrc.matchAll(/status\s*:\s*'([A-Z_]+)'/g)].map(m => m[1])
  check('B4d Purchase tidak pernah menulis status RETUR/REFUND/RUSAK',
    !statusWrites.some(s => ['RETUR', 'REFUND', 'RUSAK'].includes(s)), statusWrites.join(','))
  // Kendala selalu dikosongkan saat membuat nota (bukan menandai masalah).
  const kendalaWrites = [...saveSrc.matchAll(/kendala\s*:\s*([^,\n}]+)/g)].map(m => m[1].trim())
  check('B4e kendala hanya di-set null saat membuat nota', kendalaWrites.every(v => v === 'null'), kendalaWrites.join(','))
}

console.log('\n=== B5. HANDOVER = SATU-SATUNYA TEMPAT AKSI FISIK ===\n')
{
  const queueSrc = fs.readFileSync(path.join(SB, 'dist/modules/handovers/queue.mjs'), 'utf8')
  check('B5a aksi gudang ada di Handover (bukan Purchase)', /ACT_GUDANG/.test(queueSrc) && /runHandoverAction/.test(queueSrc))
  check('B5b aksi tukang ada di Handover', /ACT_TUKANG/.test(queueSrc))
  check('B5c aksi bermasalah ada di Handover', /PROBLEM_OPTIONS/.test(queueSrc))
  check('B5d Handover tidak menulis DB sendiri untuk bermasalah', !/supabase/.test(queueSrc))
  check('B5e Handover memakai actions.js (kontrak penulis tunggal)', /from ['"]\.\/actions/.test(queueSrc))
  check('B5f Handover memakai logic.js (kontrak aturan tunggal)', /from ['"]\.\/logic/.test(queueSrc))
  // Kontrak yang diminta kartu: actions.js & logic.js TIDAK diubah isinya.
  const actionsSrc = fs.readFileSync(path.join(SB, 'dist/modules/handovers/actions.mjs'), 'utf8')
  check('B5g actions.js tetap punya 3 runner aksi (tidak diubah)', /RUNNERS/.test(actionsSrc) && /tandaiDiserahkan/.test(actionsSrc))
  const logicSrc = fs.readFileSync(path.join(SB, 'dist/modules/handovers/logic.mjs'), 'utf8')
  check('B5h logic.js tetap mengekspor actionPlan', /export function actionPlan/.test(logicSrc) || /actionPlan/.test(logicSrc))
}

console.log(`\npurchase_scope_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
process.exit(fail ? 1 : 0)
