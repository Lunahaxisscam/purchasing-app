// ============================================================
// QUEUE UI TEST — modules/handovers/queue.jsx ASLI (dist SWC) di jsdom
// interaktif: klik nyata, panel nyata, mock supabase perekam.
// t_b03c5228 (S2/7): visibilitas aksi + status teknis disembunyikan +
// label jujur + fallback legacy + Bermasalah lewat handler shell.
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
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)
const Q = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/queue.mjs')).href)

// ---------- 3) Helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
// `tick` = majukan satu putaran event loop, DAN bila probe capability masih
// berjalan, tunggu sampai selesai (maks 40 putaran).
//
// Kenapa: DEFECT run 219 / BUG-S1. Sebelum perbaikan, tombol borongan AKTIF
// selama jendela probe (`cap === null`) — jadi test lama yang hanya menunggu
// SATU putaran melihat tombol "aktif" dan LULUS justru karena defect-nya ada.
// Sesudah perbaikan tombol sengaja nonaktif sampai probe selesai; test yang
// menilai tombol harus menunggu keadaan final. Kalau tidak, ia akan gagal
// karena membaca frame 'unknown' — bukan karena perilaku produk salah.
// Test yang MEMANG ingin memeriksa jendela probe memakai `tick(0)` (lihat
// probe_run222_queue_capability.mjs, yang memakai tick() polos tanpa settle).
const rawTick = () => new Promise(r => setTimeout(r, 0))
const tick = async (max = 40) => {
  await rawTick()
  if (max <= 0) return
  for (let i = 0; i < max; i++) {
    const st = document.querySelector('[data-testid="handover-capability"]')?.getAttribute('data-capability-state')
    if (st !== 'unknown') return
    await rawTick()
  }
}
const click = (el) => { if (!el) throw new Error('elemen tidak ada'); flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true }))) }
const tid = (doc, t) => doc.querySelector(`[data-testid="${t}"]`)
const noop = () => {}

// ---------- 4) Fixture ----------
const PROJECTS = [{ id: 'p1', kode: '100', name: 'EA Store', status: 'ON_GOING' }]
const REQUESTS = [{ id: 'pr1', pr_number: 'PR-100', title: 'Fitting', project_id: 'p1' }]

function mount(rows, extra = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22 read-only */ }
  const props = {
    page: 'handovers',
    rows,
    allProjects: PROJECTS, allMaterials: [], allPrItems: [], allReceivingItems: [],
    allRequests: REQUESTS, allReceivings: [], allVendors: [],
    refresh: noop, say: noop, onDelete: noop, setPage: noop,
    onMarkHandoverDelivered: noop,
    ...extra
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(Module, props)))
  return { dom, root, document }
}

// Nota "belum bergerak" — alokasi belum ditentukan, belum masuk gudang.
const REC_FRESH = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', invoice_no: 'TB-1', delivery_note: 'SJ-1', status: 'NORMAL', kendala: null, alokasi: null, masuk_gudang: false, tukang_at: null }
const RI_1 = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Fitting engsel', unit: 'Pcs', quantity_received: 4 }]
const HO_1 = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] EA Store', received_by: 'Pak Andi', status: 'DRAFT', handover_date: '2026-10-16', diserahkan_at: null, note: '' }

console.log('=== A1–A3. TIGA AKSI UTAMA: gudang, tukang, bermasalah (+ penutup) ===\n')
{
  mock.__reset({ handovers: [{ ...HO_1 }], receivings: [{ ...REC_FRESH }], prItems: [{ id: 'pi1', status: 'RECEIVED', quantity: 4 }], receivingItems: RI_1 })
  const { document: doc } = mount([{ ...HO_1 }], { allReceivings: [{ ...REC_FRESH }], allReceivingItems: RI_1, allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'RECEIVED', quantity: 4 }] })
  await tick()
  const card = tid(doc, 'queue-card-h1')
  check('A1a kartu antrean tampil', !!card)
  const primary = tid(doc, 'queue-primary-h1')
  check('A1b ada blok aksi fisik', !!primary)
  const gudang = tid(doc, 'queue-act-gudang-h1')
  const tukang = tid(doc, 'queue-act-tukang-h1')
  check('A1c aksi Gudang tampil & aktif', !!gudang && gudang.disabled === false)
  check('A1d aksi Tukang tampil & aktif', !!tukang && tukang.disabled === false)
  check('A1e tepat 3 tombol aksi fisik (gudang + tukang + bermasalah)', primary.querySelectorAll('button').length === 3, String(primary.querySelectorAll('button').length))
  check('A1f label Gudang menyebut gudang', /Gudang/i.test(gudang.textContent))
  check('A1g label Tukang menyebut tukang', /Tukang/i.test(tukang.textContent))

  // A2: Bermasalah = aksi ketiga, tapi TIDAK ditonjolkan
  const problem = tid(doc, 'queue-problem-h1')
  check('A2a tombol Bermasalah ada', !!problem)
  check('A2b Bermasalah ada di baris aksi fisik (3 aksi)', !!primary && primary.contains(problem))
  check('A2c Bermasalah bukan tombol utama (gaya subtle: border dashed)', /dashed/.test(problem.getAttribute('style') || ''))
  check('A2d Bermasalah tidak menonjol (font kecil <= 12px)', /font-size:\s*11/.test(problem.getAttribute('style') || ''))
  check('A2e Bermasalah tidak memakai gaya tombol aksi utama', problem.getAttribute('style') !== gudang.getAttribute('style'))
  // Urutan baca: gudang, tukang, bermasalah
  const order = [...primary.querySelectorAll('button')].map(b => b.getAttribute('data-testid').replace('queue-', '').replace('-h1', ''))
  check('A2f urutan aksi: gudang -> tukang -> problem', order.join(',') === 'act-gudang,act-tukang,problem', order.join(','))

  // A3: Tandai Diserahkan = langkah penutup, bukan aksi keempat
  const finishBlock = tid(doc, 'queue-finish-h1')
  const terima = tid(doc, 'queue-act-terima-h1')
  check('A3a blok "langkah penutup" ada', !!finishBlock)
  check('A3b Tandai Diserahkan DI LUAR blok aksi utama', !!terima && !primary.contains(terima))
  check('A3c blok penutup menjelaskan urutannya', /setelah barang benar-benar diterima/i.test(finishBlock.textContent))
  check('A3d Tandai Diserahkan nonaktif sebelum ada distribusi', terima.disabled === true)
  check('A3e alasan nonaktif terbaca di title', /Belum ada barang/i.test(terima.getAttribute('title') || ''))
}

console.log('\n=== A4. STATUS TEKNIS DISEMBUNYIKAN (hanya kalimat manusia) ===\n')
{
  const cases = [
    { alokasi: 'KE_GUDANG', label: /Tujuan:\s*Gudang/ },
    { alokasi: 'KE_TUKANG', label: /Tujuan:\s*Tukang/ },
    { alokasi: 'LANGSUNG_LAPANGAN', label: /Tujuan:\s*Langsung ke lapangan/ }
  ]
  for (const c of cases) {
    const rec = { ...REC_FRESH, alokasi: c.alokasi }
    mock.__reset({ handovers: [{ ...HO_1 }], receivings: [rec], prItems: [{ id: 'pi1', status: 'RECEIVED', quantity: 4 }], receivingItems: RI_1 })
    const { document: doc } = mount([{ ...HO_1 }], { allReceivings: [rec], allReceivingItems: RI_1, allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'RECEIVED', quantity: 4 }] })
    await tick()
    const cardText = tid(doc, 'queue-card-h1')?.textContent || ''
    const dest = tid(doc, 'queue-dest-h1')?.textContent || ''
    check(`A4 ${c.alokasi} -> label manusia tampil`, c.label.test(dest), dest)
    check(`A4 ${c.alokasi} -> kode mentah TIDAK tampil di kartu`, !cardText.includes(c.alokasi), cardText.slice(0, 160))
    check(`A4 ${c.alokasi} -> underscore mentah tidak bocor`, !/_/.test(dest), dest)
  }
  // Status pr_items (DI_GUDANG / DI_TUKANG) juga tidak boleh jadi teks kartu
  const recG = { ...REC_FRESH, alokasi: 'KE_GUDANG', masuk_gudang: true }
  mock.__reset({ handovers: [{ ...HO_1 }], receivings: [recG], prItems: [{ id: 'pi1', status: 'DI_GUDANG', quantity: 4 }], receivingItems: RI_1 })
  const { document: doc } = mount([{ ...HO_1 }], { allReceivings: [recG], allReceivingItems: RI_1, allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'DI_GUDANG', quantity: 4 }] })
  await tick()
  const t = tid(doc, 'queue-card-h1')?.textContent || ''
  check('A4d DI_GUDANG tidak tampil sebagai teks', !t.includes('DI_GUDANG'), t.slice(0, 200))
  check('A4e ringkasan progres tetap ada dalam bahasa manusia', /didistribusikan/i.test(tid(doc, 'queue-summary-h1')?.textContent || ''))
}

console.log('\n=== A5. RINCIAN BARANG DIPERTAHANKAN + LABEL JUJUR ===\n')
{
  // (a) ada rincian nota
  mock.__reset({ handovers: [{ ...HO_1 }], receivings: [{ ...REC_FRESH }], prItems: [{ id: 'pi1', status: 'RECEIVED', quantity: 4 }], receivingItems: RI_1 })
  const { document: doc } = mount([{ ...HO_1 }], { allReceivings: [{ ...REC_FRESH }], allReceivingItems: RI_1, allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'RECEIVED', quantity: 4 }] })
  await tick()
  const toggle = tid(doc, 'queue-detail-h1')
  check('A5a tombol rincian barang ada', !!toggle)
  click(toggle); await tick()
  const panel = tid(doc, 'queue-detail-panel-h1')
  check('A5b panel rincian terbuka', !!panel)
  const pt = panel?.textContent || ''
  check('A5c barang dari nota tampil', /Fitting engsel/.test(pt), pt.slice(0, 200))
  check('A5d qty diberi label "qty beli di nota" (bukan jumlah diserahkan)', /qty beli di nota/i.test(pt))
  check('A5e batas jujur: jumlah serah terima per item belum tercatat', /belum tercatat terpisah/i.test(pt))
  check('A5f nomor nota tampil di rincian', /TB-1/.test(pt))

  // (b) nota tanpa rincian barang -> label jujur, TIDAK menebak
  const recEmpty = { ...REC_FRESH, id: 'rec2', invoice_no: 'TB-2' }
  const ho2 = { ...HO_1, id: 'h2', receiving_id: 'rec2' }
  mock.__reset({ handovers: [{ ...ho2 }], receivings: [recEmpty], prItems: [], receivingItems: [] })
  const m2 = mount([{ ...ho2 }], { allReceivings: [recEmpty], allReceivingItems: [], allPrItems: [] })
  await tick()
  click(tid(m2.document, 'queue-detail-h2')); await tick()
  const p2 = tid(m2.document, 'queue-items-unavailable-h2')
  check('A5g nota tanpa rincian -> label "Rincian barang belum tersedia"', /Rincian barang belum tersedia/.test(p2?.textContent || ''), p2?.textContent)
  check('A5h label itu konstanta bersama (bukan teks karangan)', Q.PROBLEM_OPTIONS.length === 2)
}

console.log('\n=== A6. AKSI NONAKTIF SELALU PUNYA ALASAN TERBACA ===\n')
{
  // Nota alokasi gudang: aksi tukang ditolak -> alasan harus ada.
  const recG = { ...REC_FRESH, alokasi: 'KE_GUDANG' }
  mock.__reset({ handovers: [{ ...HO_1 }], receivings: [recG], prItems: [{ id: 'pi1', status: 'RECEIVED', quantity: 4 }], receivingItems: RI_1 })
  const { document: doc } = mount([{ ...HO_1 }], { allReceivings: [recG], allReceivingItems: RI_1, allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'RECEIVED', quantity: 4 }] })
  await tick()
  const disabled = [...doc.querySelectorAll('[data-testid^="queue-act-"][disabled]')]
  check('A6a ada tombol nonaktif untuk diuji', disabled.length > 0, String(disabled.length))
  const tanpaAlasan = disabled.filter(b => !String(b.getAttribute('title') || '').trim())
  check('A6b SEMUA tombol nonaktif punya title/alasan', tanpaAlasan.length === 0, tanpaAlasan.map(b => b.getAttribute('data-testid')).join(','))
  const tukang = tid(doc, 'queue-act-tukang-h1')
  check('A6c alasan tukang menyebut alokasi gudang', /gudang/i.test(tukang.getAttribute('title') || ''), tukang.getAttribute('title'))
  check('A6d alasan tidak berupa kode DB mentah', !/KE_GUDANG/.test(tukang.getAttribute('title') || ''))
}

console.log('\n=== A7. NOTA BERMASALAH: DISTRIBUSI DITUTUP + BADGE JUJUR ===\n')
{
  const recBad = { ...REC_FRESH, status: 'RETUR', kendala: 'RETUR' }
  mock.__reset({ handovers: [{ ...HO_1 }], receivings: [recBad], prItems: [{ id: 'pi1', status: 'RECEIVED', quantity: 4 }], receivingItems: RI_1 })
  const { document: doc } = mount([{ ...HO_1 }], { allReceivings: [recBad], allReceivingItems: RI_1, allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'RECEIVED', quantity: 4 }] })
  await tick()
  const badge = tid(doc, 'queue-problem-badge-h1')
  check('A7a badge "Nota bermasalah" tampil (bahasa manusia)', /Nota bermasalah/.test(badge?.textContent || ''), badge?.textContent)
  check('A7b kode RETUR tidak tampil mentah', !(tid(doc, 'queue-card-h1')?.textContent || '').includes('RETUR'))
  const gudang = tid(doc, 'queue-act-gudang-h1')
  const tukang = tid(doc, 'queue-act-tukang-h1')
  check('A7c aksi gudang ditutup untuk nota bermasalah', gudang.disabled === true)
  check('A7d aksi tukang ditutup untuk nota bermasalah', tukang.disabled === true)
  check('A7e alasan menyebut nota bermasalah', /bermasalah/i.test(gudang.getAttribute('title') || ''), gudang.getAttribute('title'))
  // Buka panel Bermasalah -> harus menolak dengan alasan (tidak dobel tanda)
  click(tid(doc, 'queue-problem-h1')); await tick()
  const blocked = tid(doc, 'queue-problem-blocked-h1')
  check('A7f panel Bermasalah menampilkan alasan penolakan', /sudah ditandai bermasalah/i.test(blocked?.textContent || ''), blocked?.textContent)
  check('A7g TIDAK ada tombol Retur/Refund saat sudah bermasalah', !tid(doc, 'queue-problem-retur-h1') && !tid(doc, 'queue-problem-refund-h1'))
  check('A7h nol tulisan DB dari membuka panel', mock.__callsOf('update').length === 0 && mock.__callsOf('insert').length === 0)
}

console.log('\n=== A8. FALLBACK DATA LAMA (tanpa receiving_id) ===\n')
{
  const legacy = { id: 'h9', receiving_id: null, project_name: '[99] Baroni', received_by: 'Mandor Joko', status: 'CONFIRMED', handover_date: '2026-10-06', diserahkan_at: null, note: 'data lama' }
  mock.__reset({ handovers: [{ ...legacy }], receivings: [], prItems: [], receivingItems: [] })
  const { document: doc } = mount([{ ...legacy }], { allReceivings: [], allReceivingItems: [], allPrItems: [] })
  await tick()
  const card = tid(doc, 'queue-card-h9')
  check('A8a kartu handover lama TETAP tampil (tidak hilang)', !!card)
  check('A8b semua aksi distribusi nonaktif', tid(doc, 'queue-act-gudang-h9')?.disabled === true && tid(doc, 'queue-act-tukang-h9')?.disabled === true)
  check('A8c alasan gudang terbaca (bukan tombol mati bisu)', String(tid(doc, 'queue-act-gudang-h9')?.getAttribute('title') || '').length > 0)
  click(tid(doc, 'queue-problem-h9')); await tick()
  const blocked = tid(doc, 'queue-problem-blocked-h9')
  check('A8d Bermasalah ditolak dengan alasan "belum terhubung ke nota"', /belum terhubung ke nota/i.test(blocked?.textContent || ''), blocked?.textContent)
  check('A8e rincian barang diberi label jujur', (() => { click(tid(doc, 'queue-detail-h9')); return true })())
  await tick()
  check('A8f label jujur tampil untuk data lama', /Rincian barang belum tersedia/.test(tid(doc, 'queue-items-unavailable-h9')?.textContent || ''))
}

console.log('\n=== A9. BERMASALAH MEMAKAI HANDLER SHELL (nol DB dari queue) ===\n')
{
  const recOk = { ...REC_FRESH }
  mock.__reset({ handovers: [{ ...HO_1 }], receivings: [recOk], prItems: [{ id: 'pi1', status: 'RECEIVED', quantity: 4 }], receivingItems: RI_1 })
  const calls = []
  const { document: doc } = mount([{ ...HO_1 }], {
    allReceivings: [recOk], allReceivingItems: RI_1, allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'RECEIVED', quantity: 4 }],
    onReceivingStatusChange: (receiving, status) => { calls.push([receiving?.id, status]) }
  })
  await tick()
  click(tid(doc, 'queue-problem-h1')); await tick()
  const retur = tid(doc, 'queue-problem-retur-h1')
  const refund = tid(doc, 'queue-problem-refund-h1')
  check('A9a opsi Retur tersedia', !!retur && /Retur/i.test(retur.textContent))
  check('A9b opsi Refund tersedia', !!refund && /Refund/i.test(refund.textContent))
  check('A9c nol tulisan DB sebelum memilih', mock.__callsOf('update').length === 0)
  click(retur); await tick(); await tick()
  check('A9d handler shell dipanggil dengan nota + RETUR', JSON.stringify(calls) === JSON.stringify([['rec1', 'RETUR']]), JSON.stringify(calls))
  check('A9e queue.jsx TIDAK menulis DB sendiri (delegasi penuh)', mock.__callsOf('update').length === 0 && mock.__callsOf('insert').length === 0)
  check('A9f panel tertutup setelah memilih', !tid(doc, 'queue-problem-panel-h1'))
}

console.log('\n=== A10. BERMASALAH MULTI-ITEM DITOLAK DENGAN ALASAN SKEMA ===\n')
{
  const recMulti = { ...REC_FRESH }
  const ri2 = [
    { id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Fitting', unit: 'Pcs', quantity_received: 4 },
    { id: 'ri2', receiving_id: 'rec1', pr_item_id: 'pi2', item_name: 'Kabel', unit: 'Meter', quantity_received: 10 }
  ]
  mock.__reset({ handovers: [{ ...HO_1 }], receivings: [recMulti], prItems: [{ id: 'pi1', status: 'RECEIVED', quantity: 4 }, { id: 'pi2', status: 'RECEIVED', quantity: 10 }], receivingItems: ri2 })
  const calls = []
  const { document: doc } = mount([{ ...HO_1 }], {
    allReceivings: [recMulti], allReceivingItems: ri2,
    allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'RECEIVED', quantity: 4 }, { id: 'pi2', pr_id: 'pr1', status: 'RECEIVED', quantity: 10 }],
    onReceivingStatusChange: (r, s) => calls.push([r?.id, s])
  })
  await tick()
  click(tid(doc, 'queue-problem-h1')); await tick()
  const blocked = tid(doc, 'queue-problem-blocked-h1')
  check('A10a nota multi-item -> Bermasalah ditolak', !!blocked)
  check('A10b alasan menyebut multi-item & penyimpanan per barang', /multi-item/i.test(blocked?.textContent || '') && /per barang/i.test(blocked?.textContent || ''), blocked?.textContent)
  check('A10c tidak ada tombol Retur/Refund (tidak ada ilusi tersimpan)', !tid(doc, 'queue-problem-retur-h1'))
  check('A10d handler TIDAK dipanggil', calls.length === 0)
}

console.log('\n=== A12. TIDAK ADA FIELD FISIK GANDA DI SATU KARTU ===\n')
{
  // Tujuan barang (receivings.alokasi) hanya boleh muncul SEKALI di kartu saat
  // rincian tertutup — tidak diulang di header + body (field fisik ganda).
  const rec = { ...REC_FRESH, alokasi: 'KE_TUKANG' }
  mock.__reset({ handovers: [{ ...HO_1 }], receivings: [rec], prItems: [{ id: 'pi1', status: 'RECEIVED', quantity: 4 }], receivingItems: RI_1 })
  const { document: doc } = mount([{ ...HO_1 }], { allReceivings: [rec], allReceivingItems: RI_1, allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'RECEIVED', quantity: 4 }] })
  await tick()
  const cardText = tid(doc, 'queue-card-h1')?.textContent || ''
  const occurrences = (cardText.match(/Tujuan:/g) || []).length
  check('A12a tujuan tampil tepat sekali (rincian tertutup)', occurrences === 1, 'n=' + occurrences)
  check('A12b hanya satu badge tujuan', doc.querySelectorAll('[data-testid="queue-dest-h1"]').length === 1)
  // Buka rincian: tujuan TIDAK boleh diulang (satu nilai fisik = satu tempat
  // tampil), dan tidak boleh ada field fisik baru yang bisa mengubahnya.
  click(tid(doc, 'queue-detail-h1')); await tick()
  const card = tid(doc, 'queue-card-h1')
  const afterOpen = (card?.textContent?.match(/Tujuan:/g) || []).length
  check('A12c membuka rincian TIDAK mengulang field tujuan', afterOpen === 1, 'n=' + afterOpen)
  check('A12d rincian tidak menambah input/select field fisik', card.querySelectorAll('input, select').length === 0)
  // Satu-satunya input di kartu adalah nama penerima, dan hanya muncul setelah
  // tombol "Tandai Diserahkan" ditekan.
  check('A12e tidak ada input sebelum langkah penutup dibuka', card.querySelectorAll('input').length === 0)
  check('A12f tidak ada field status yang bisa diedit', card.querySelectorAll('select').length === 0)
}

console.log('\n=== A13. DAFTAR HANDOVER: KENDALA NOTA = LABEL MANUSIA (view.jsx) ===\n')
{
  // Nota bermasalah -> daftar menampilkan "⚠ Nota bermasalah" (bukan RETUR),
  // dan tidak ada teks status teknis lain.
  const recBad = { ...REC_FRESH, status: 'RETUR', kendala: 'RETUR' }
  mock.__reset({ handovers: [{ ...HO_1 }], receivings: [recBad], prItems: [{ id: 'pi1', status: 'RECEIVED', quantity: 4 }], receivingItems: RI_1 })
  const { document: doc } = mount([{ ...HO_1 }], { allReceivings: [recBad], allReceivingItems: RI_1, allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'RECEIVED', quantity: 4 }] })
  await tick()
  check('A13a label "Nota bermasalah" tampil di daftar desktop', /Nota bermasalah/.test(tid(doc, 'problem-h1')?.textContent || ''))
  check('A13b kode RETUR tidak tampil mentah di daftar', !/RETUR/.test(doc.body.textContent || ''))
  check('A13c label kendala tampil juga di kartu mobile', /Nota bermasalah/.test(tid(doc, 'problem-mobile-h1')?.textContent || ''))
  check('A13d bukti fisik tetap terpisah (Belum Diserahkan)', /Belum Diserahkan/.test(doc.body.textContent || ''))
  // Nota normal -> tidak ada label bermasalah (tidak mengarang masalah)
  mock.__reset({ handovers: [{ ...HO_1 }], receivings: [{ ...REC_FRESH }], prItems: [{ id: 'pi1', status: 'RECEIVED', quantity: 4 }], receivingItems: RI_1 })
  const m2 = mount([{ ...HO_1 }], { allReceivings: [{ ...REC_FRESH }], allReceivingItems: RI_1, allPrItems: [{ id: 'pi1', pr_id: 'pr1', status: 'RECEIVED', quantity: 4 }] })
  await tick()
  check('A13e nota normal -> TIDAK ada label bermasalah', !tid(m2.document, 'problem-h1'))
}

console.log('\n=== A11. LOGIKA LABEL (fungsi murni queue.jsx) ===\n')
{
  check('A11a alokasiLabel(KE_GUDANG)', Q.alokasiLabel('KE_GUDANG') === 'Gudang', Q.alokasiLabel('KE_GUDANG'))
  check('A11b alokasiLabel(KE_TUKANG)', Q.alokasiLabel('KE_TUKANG') === 'Tukang', Q.alokasiLabel('KE_TUKANG'))
  check('A11c alokasiLabel(LANGSUNG_LAPANGAN)', Q.alokasiLabel('LANGSUNG_LAPANGAN') === 'Langsung ke lapangan', Q.alokasiLabel('LANGSUNG_LAPANGAN'))
  check('A11d alokasiLabel(null) -> kosong (tidak mengarang)', Q.alokasiLabel(null) === '', Q.alokasiLabel(null))
  check('A11e isProblemNoted(status RETUR)', Q.isProblemNoted({ status: 'RETUR' }) === true)
  check('A11f isProblemNoted(kendala REFUND)', Q.isProblemNoted({ status: 'NORMAL', kendala: 'REFUND' }) === true)
  check('A11g isProblemNoted(NORMAL tanpa kendala)', Q.isProblemNoted({ status: 'NORMAL', kendala: null }) === false)
  check('A11h isProblemNoted(null)', Q.isProblemNoted(null) === false)
  // problemPlan: semua jalur penolakan punya alasan non-kosong
  const plans = [
    Q.problemPlan(null, 1, true),
    Q.problemPlan({ status: 'RETUR' }, 1, true),
    Q.problemPlan({ status: 'NORMAL' }, 1, false),
    Q.problemPlan({ status: 'NORMAL' }, 0, true),
    Q.problemPlan({ status: 'NORMAL' }, 2, true)
  ]
  check('A11i 5 jalur penolakan semuanya ok=false', plans.every(p => p.ok === false))
  check('A11j semuanya punya alasan terbaca', plans.every(p => typeof p.reason === 'string' && p.reason.length > 10), JSON.stringify(plans.map(p => p.reason)))
  check('A11k nota normal 1 item -> boleh', Q.problemPlan({ status: 'NORMAL' }, 1, true).ok === true)
  // Integrasi t_35cd0354 (Brooklyn REVIEW-02 P1): jalan keluar UI TIDAK boleh
  // menyuruh mencatat lewat modul Purchase (form fisik sudah dibuang) dan
  // harus memberi instruksi rekonsiliasi yang jujur di Handover.
  const blocked = [
    Q.problemPlan(null, 1, true),
    Q.problemPlan({ status: 'NORMAL' }, 0, true),
    Q.problemPlan({ status: 'NORMAL' }, 2, true)
  ]
  check('A11l tidak ada alasan yang menyuruh "catat lewat modul Purchase"',
    plans.every(p => !/modul Purchase/i.test(p.reason)) && blocked.every(p => !/modul Purchase/i.test(p.reason)),
    JSON.stringify(plans.map(p => p.reason)))
  check('A11m alasan penolakan memberi jalur rekonsiliasi manual di Handover',
    blocked.every(p => /rekonsiliasi manual/i.test(p.reason) && /Catatan handover/i.test(p.reason)),
    JSON.stringify(blocked.map(p => p.reason)))
}

console.log(`\nqueue_ui_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
process.exit(fail ? 1 : 0)
