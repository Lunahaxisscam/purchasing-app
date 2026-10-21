// ============================================================
// probe_run237_delete_ui.mjs — PENJAGA HAPUS di UI (run 237, t_7bc6246b)
// ============================================================
// LENSA: tombol 🗑️ Hapus. Tiga belas run sebelumnya menguji SIMPAN, TAMPIL,
// dan KESIAPAN — tidak satu pun menyentuh jalur hapus, padahal tombolnya ada
// di SETIAP baris tanpa syarat.
//
// Diuji pada modul VERBATIM (hasil transform SWC), React + jsdom:
//
//   K1  Dokumen yang sudah punya bukti penyerahan → tombol hapus desktop
//       NONAKTIF, ikon 🔒, dan klik TIDAK memanggil onDelete (nol tulisan).
//   K2  Kartu mobile: tombol "Hapus" juga nonaktif + sebabnya terbaca.
//   K3  DRAFT tanpa bukti → tombol hapus TETAP aktif (kontrol positif;
//       jangan sampai penjaga memblokir pekerjaan yang sah).
//   K4  Bukti fisik dihitung dari RINCIAN (`items`), bukan hanya
//       `diserahkan_at` — dokumen dengan rincian tetapi waktu kosong (data
//       lama / migrasi) tetap terkunci.
//   K5  Status CONFIRMED/SELESAI tanpa `diserahkan_at` dan tanpa rincian
//       ikut terkunci (pagar riwayat), sedangkan status lain tidak.
//   K6  `deleteDecision` untuk handovers = satu pintu yang sama dengan UI.
//   K7  `deleteDecision` untuk NOTA (receivings) menolak bila ada serah
//       terima berbekas, dan MENGIZINKAN bila belum ada (kontrol positif).
//   K8  Jenis lain (vendors/materials/...) tidak terpengaruh.
//
// Sebelum fix (fe91076) K1/K2/K4/K5/K6/K7 GAGAL karena tombol aktif di semua
// baris dan tidak ada penjaga sama sekali.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
global.HTMLElement = dom0.window.HTMLElement
global.HTMLInputElement = dom0.window.HTMLInputElement
global.HTMLSelectElement = dom0.window.HTMLSelectElement
global.Event = dom0.window.Event
global.FileReader = dom0.window.FileReader

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const importDist = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)
const V = await importDist('modules/handovers/view.mjs')
// Penjaga hapus hanya ada SESUDAH fix run 237. Di pohon SEBELUM fix modul ini
// tidak ada — probe harus tetap berjalan (bukan mati di impor) supaya hasil
// RED-nya jujur: yang gagal adalah PERILAKU tombolnya, bukan sekadar impor.
let G = null
try {
  G = await importDist('modules/handovers/deleteGuard.mjs')
} catch (e) {
  G = null
  console.log('  (modul deleteGuard TIDAK ADA di pohon ini — penjaga hapus belum dipasang)')
}
const guardMissing = { ok: true, reason: 'PENJAGA TIDAK ADA' }
// Akses aman: bila modul tidak ada, semua pemeriksaan memakai objek netral yang
// MENYATAKAN penjaga tidak ada — sehingga assertion "harus menolak" GAGAL
// (RED yang benar), bukan probe mati karena TypeError.
G = G || {
  handoverDeleteGuard: () => guardMissing,
  handoverProof: () => ({ locked: false, itemCount: 0, delivered: false, confirmed: false, diserahkanAt: null, staleStatus: false }),
  deleteDecision: () => guardMissing
}

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => { if (!el) return false; flushSync(() => el.dispatchEvent(new dom0.window.MouseEvent('click', { bubbles: true }))); return true }
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
// Pohon SEBELUM fix tidak punya data-testid di tombol mobile. Cari lewat teks
// supaya RED datang dari assertion ("masih aktif"), bukan dari null.
function buttonByText(doc, re) {
  return Array.from(doc.querySelectorAll('button')).find(b => re.test(b.textContent || '')) || null
}

let roots = []
function mount(el) {
  for (const r of roots) { try { r.unmount() } catch (e) {} }
  roots = []
  dom0.window.document.body.innerHTML = ''
  const host = dom0.window.document.createElement('div')
  dom0.window.document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(el))
  roots.push(root)
  return { root, host, document: dom0.window.document }
}

const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-1', delivery_note: 'Nota INV-1', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const PR_ITEMS = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Semen', quantity: 10, unit: 'Sak', status: 'APPROVED' }]
const RI = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Semen', unit: 'Sak', quantity_received: 10, qty_arrived: 6 }]
const HO_DRAFT = { id: 'h-draft', receiving_id: 'rec1', project_id: 'p1', project_name: '[100] Ruko', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
const HO_PROOF = {
  ...HO_DRAFT, id: 'h-proof', status: 'CONFIRMED', diserahkan_at: '2026-10-21T02:00:00Z',
  items: [{ id: 'hi1', handover_id: 'h-proof', receiving_event_id: 'ev1', item_name: 'Semen', qty_diserahkan: 5, satuan: 'Sak', penerima: 'Pak Joko' }]
}
// Data lama: rincian ADA tetapi waktu penyerahan kosong (mis. hasil backfill /
// migrasi). Bukti fisik tetap ada → hapus harus tetap terkunci.
const HO_ITEMS_NO_TIME = {
  ...HO_DRAFT, id: 'h-items-only', status: 'DRAFT', diserahkan_at: null,
  items: [{ id: 'hi2', handover_id: 'h-items-only', receiving_event_id: 'ev1', item_name: 'Semen', qty_diserahkan: 2, satuan: 'Sak', penerima: 'Pak Joko' }]
}
// Status lama CONFIRMED tanpa diserahkan_at & tanpa rincian (bukti live A3).
const HO_LEGACY_CONFIRMED = { ...HO_DRAFT, id: 'h-legacy', status: 'CONFIRMED', diserahkan_at: null }
const noop = () => {}

function makeCtx(extra = {}) {
  return {
    columns: ['items', 'received_by', 'status', 'handover_date'],
    expandedAcuan: null,
    allReceivings: [REC],
    allRequests: [{ id: 'pr1', pr_number: 'PR-1', title: 'x' }],
    H: { receivingItemsForReceiving: () => RI, prItemsForPr: () => PR_ITEMS },
    title: 'Serah Terima', page: 'handovers',
    setEditRow: noop, onDelete: noop, onMarkHandoverDelivered: noop,
    say: noop, refresh: noop,
    ...extra
  }
}

// ============================================================
console.log('\n=== K1. Tombol hapus DESKTOP pada dokumen berbekti ===\n')
// ============================================================
{
  let deleted = 0
  const ctx = makeCtx({ onDelete: () => { deleted++ } })
  const { document: doc } = mount(React.createElement('table', null, React.createElement('tbody', null,
    React.createElement('tr', null, V.rowActions(HO_PROOF, ctx)))))
  await tick()
  const btn = tid(doc, 'btn-hapus-h-proof')
  check('K1a tombol hapus ada di baris (dikenali lewat data-testid)', !!btn)
  check('K1b tombol NONAKTIF (disabled)', btn?.disabled === true, `disabled=${btn?.disabled}`)
  check('K1c ikon berubah jadi 🔒 (bukan 🗑️)', /🔒/.test(btn?.textContent || ''), btn?.textContent)
  check('K1d sebabnya terbaca di title (bukan tooltip "Hapus")',
    /TIDAK bisa dihapus/i.test(btn?.getAttribute('title') || '') && !/^Hapus /.test(btn?.getAttribute('title') || ''),
    btn?.getAttribute('title'))
  click(btn)
  await tick()
  check('K1e klik TIDAK memanggil onDelete (nol tulisan)', deleted === 0, `dipanggil ${deleted}×`)
}

// ============================================================
console.log('\n=== K2. Kartu MOBILE ===\n')
// ============================================================
{
  let deleted = 0
  const ctx = makeCtx({ onDelete: () => { deleted++ } })
  const { document: doc } = mount(React.createElement('div', null, V.mobileCard(HO_PROOF, ctx)))
  await tick()
  const btn = tid(doc, 'btn-hapus-mobile-h-proof') || buttonByText(doc, /Hapus|Tidak bisa dihapus/i)
  check('K2a tombol hapus mobile ada & NONAKTIF', !!btn && btn.disabled === true, `disabled=${btn?.disabled}`)
  check('K2b label menjelaskan alasan (bukan "Hapus Serah Terima")',
    /Tidak bisa dihapus/i.test(btn?.textContent || ''), btn?.textContent)
  click(btn)
  await tick()
  check('K2c klik TIDAK memanggil onDelete', deleted === 0, `dipanggil ${deleted}×`)
}

// ============================================================
console.log('\n=== K3. Kontrol positif: DRAFT tanpa bukti tetap bisa dihapus ===\n')
// ============================================================
{
  let deleted = 0
  const ctx = makeCtx({ onDelete: () => { deleted++ } })
  const { document: doc } = mount(React.createElement('table', null, React.createElement('tbody', null,
    React.createElement('tr', null, V.rowActions(HO_DRAFT, ctx)))))
  await tick()
  const btn = tid(doc, 'btn-hapus-h-draft')
  check('K3a tombol hapus AKTIF untuk DRAFT tanpa rincian', btn?.disabled === false, `disabled=${btn?.disabled}`)
  check('K3b ikon tetap 🗑️', /🗑️/.test(btn?.textContent || ''), btn?.textContent)
  click(btn)
  await tick()
  check('K3c klik MEMANGGIL onDelete (pekerjaan sah tidak diblokir)', deleted === 1, `dipanggil ${deleted}×`)
}

// ============================================================
console.log('\n=== K4. Bukti dihitung dari RINCIAN, bukan hanya diserahkan_at ===\n')
// ============================================================
{
  const g = G.handoverDeleteGuard(HO_ITEMS_NO_TIME)
  check('K4a rincian ADA + diserahkan_at kosong → HAPUS DITOLAK', g.ok === false, JSON.stringify(g).slice(0, 200))
  check('K4b alasan menyebut bukti penyerahan', /bukti penyerahan/i.test(g.reason || ''), g.reason)
  let deleted = 0
  const ctx = makeCtx({ onDelete: () => { deleted++ } })
  const { document: doc } = mount(React.createElement('table', null, React.createElement('tbody', null,
    React.createElement('tr', null, V.rowActions(HO_ITEMS_NO_TIME, ctx)))))
  await tick()
  const btn = tid(doc, 'btn-hapus-h-items-only')
  check('K4c UI: tombol NONAKTIF untuk dokumen ini', btn?.disabled === true, `disabled=${btn?.disabled}`)
  click(btn); await tick()
  check('K4d UI: klik tidak menulis', deleted === 0)
}

// ============================================================
console.log('\n=== K5. Status CONFIRMED lama (tanpa waktu & tanpa rincian) ===\n')
// ============================================================
{
  const g = G.handoverDeleteGuard(HO_LEGACY_CONFIRMED)
  check('K5a CONFIRMED tanpa bukti TIDAK mengunci (kontrak display.js: bukan "Sudah Diserahkan")',
    g.ok === true, JSON.stringify(g).slice(0, 200))
  check('K5a2 …tetapi diberi PERINGATAN status basi (bukan dihapus diam-diam)',
    !!g.warn && /BUKAN bukti penyerahan/i.test(g.warn), g.warn)
  const gDraft = G.handoverDeleteGuard({ ...HO_DRAFT, status: 'DRAFT' })
  check('K5b DRAFT tanpa bukti BOLEH dihapus tanpa peringatan', gDraft.ok === true && !gDraft.warn, JSON.stringify(gDraft).slice(0, 200))
  const gSelesai = G.handoverDeleteGuard({ ...HO_DRAFT, id: 'x', status: 'SELESAI' })
  check('K5c SELESAI tanpa bukti: boleh + peringatan (kelas sama)', gSelesai.ok === true && !!gSelesai.warn)
  const gNoId = G.handoverDeleteGuard(null)
  check('K5d data tidak dikenal ditolak (tidak melempar)', gNoId.ok === false && /tidak dikenal/i.test(gNoId.reason || ''), gNoId.reason)
  // Yang WAJIB mengunci tetap mengunci, apa pun statusnya.
  const gProofDraft = G.handoverDeleteGuard({ ...HO_DRAFT, status: 'DRAFT', diserahkan_at: '2026-10-21T01:00:00Z' })
  check('K5e DRAFT tetapi punya diserahkan_at → TERKUNCI (bukti nyata menang atas status)',
    gProofDraft.ok === false, JSON.stringify(gProofDraft).slice(0, 200))
}

// ============================================================
console.log('\n=== K6. deleteDecision — satu pintu untuk SEMUA jalur hapus ===\n')
// ============================================================
{
  check('K6a handovers + bukti → tolak', G.deleteDecision('handovers', HO_PROOF).ok === false)
  check('K6b handovers + DRAFT → izinkan', G.deleteDecision('handovers', HO_DRAFT).ok === true)
  check('K6c handovers + rincian tanpa waktu → tolak', G.deleteDecision('handovers', HO_ITEMS_NO_TIME).ok === false)
}

// ============================================================
console.log('\n=== K7. Hapus NOTA (Pembelian) yang punya serah terima berbekas ===\n')
// ============================================================
{
  const d1 = G.deleteDecision('receivings', REC, { handovers: [HO_PROOF] })
  check('K7a nota dengan serah terima berbekti → TOLAK', d1.ok === false, JSON.stringify(d1).slice(0, 250))
  check('K7b alasan menyebut bukti penyerahan & akibatnya', /bukti penyerahan/i.test(d1.reason || ''), d1.reason)
  const d2 = G.deleteDecision('receivings', REC, { handovers: [HO_DRAFT] })
  check('K7c nota dengan serah terima DRAFT → TOLAK juga (FK DB tidak cascade, diverifikasi nyata)', d2.ok === false, JSON.stringify(d2).slice(0, 200))
  check('K7c2 alasan menyebut langkah yang bisa dilakukan (hapus dokumen ST dulu)',
    /Hapus dokumen Serah Terima/i.test(d2.reason || ''), d2.reason)
  const d3 = G.deleteDecision('receivings', REC, { handovers: [] })
  check('K7d nota tanpa serah terima → IZINKAN', d3.ok === true)
  // Serah terima milik nota LAIN tidak boleh ikut memblokir.
  const other = { ...HO_PROOF, id: 'h-other', receiving_id: 'rec-other' }
  const d4 = G.deleteDecision('receivings', REC, { handovers: [other] })
  check('K7e serah terima nota lain TIDAK memblokir nota ini', d4.ok === true, JSON.stringify(d4).slice(0, 200))
}

// ============================================================
console.log('\n=== K8. Jenis data lain tidak terpengaruh ===\n')
// ============================================================
{
  for (const t of ['vendors', 'materials', 'requests', 'projects', 'approvals']) {
    check(`K8 ${t} tetap boleh dihapus (penjaga tidak melebar)`, G.deleteDecision(t, { id: 'x' }).ok === true)
  }
}

console.log(`\n=== HASIL PROBE RUN 237 (HAPUS): ${pass} PASS / ${fail} FAIL ===`)
if (failures.length) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
