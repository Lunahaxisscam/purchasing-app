// ============================================================
// probe_r246_retry.mjs — RETRY / DOUBLE-SUBMIT pada boundary simpan nota
// ============================================================
// Acceptance Paket 1 butir 3 (OPERATIONAL_BATCH_1.md):
//   "Dua permintaan bersamaan/retry tidak menghasilkan dokumen aktif atau
//    konfirmasi kuantitas ganda untuk pekerjaan yang sama."
//
// Dua jalur diuji terpisah:
//   A. Jalur LAMA (legacy) — nota tanpa nomor vendor, dengan
//      `clientRequestId` STABIL seperti yang sekarang dikirim form.
//   B. Jalur ATOMIK — RPC `purchase_save_atomic` (mock mengikuti kontrak
//      Bandeng: client_request_id sebagai kunci idempotensi).
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)
const mock = await load('lib/supabaseClient.mjs')
const { __reset, __rows, __callsOf, __state } = mock
const { savePurchaseWithClient } = await load('modules/receivings/purchaseSave.mjs')
const { PURCHASE_CAP } = await load('modules/receivings/purchaseCapability.mjs')

let pass = 0, fail = 0
const ck = (id, name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${id}  ${name}`) }
  else { fail++; console.log(`  FAIL ${id}  ${name}${detail ? ' :: ' + detail : ''}`) }
}
const head = (t) => console.log(`\n=== ${t} ===`)

const VENDOR = '33333333-3333-4333-8333-333333333333'
const PROJ = '11111111-1111-4111-8111-111111111111'
const MAT = '44444444-4444-4444-8444-444444444444'
const vendors = [{ id: VENDOR, name: 'Toko Jaya' }]
const projects = [{ id: PROJ, kode: '61', name: 'Sunter' }]
const materials = [{ id: MAT, name: 'Semen', harga_acuan: 60000 }]
const base = () => ({ projects, vendors, materials, receivings: [], receiving_items: [], handovers: [] })

const formWithInvoice = {
  vendorId: VENDOR, tanggal: '2026-10-21', invoiceNo: 'INV-777',
  items: [{ prItemId: null, itemName: 'Semen', unit: 'sak', qty: '5', harga: '60000', projectId: PROJ, materialId: MAT, isDirect: true }]
}
const formNoInvoice = { ...formWithInvoice, invoiceNo: '' }

// ------------------------------------------------------------
// A1 — RETRY nota BER-NOMOR (dua submit identik, kunci sama)
// ------------------------------------------------------------
head('A1 retry nota ber-nomor (kunci sama)')
__reset({ tables: base() })
const reqA = 'req-fixed-0001'
const a = await savePurchaseWithClient({ client: mock.supabase, form: formWithInvoice, clientRequestId: reqA, ...base() })
const b = await savePurchaseWithClient({ client: mock.supabase, form: formWithInvoice, clientRequestId: reqA, ...base() })
console.log('  submit1:', JSON.stringify({ ok: a.ok, reason: a.reason }))
console.log('  submit2:', JSON.stringify({ ok: b.ok, already: b.already, reason: b.reason }))
const notes1 = __rows('receivings')
const items1 = __rows('receiving_items')
ck('A1a', 'nota ber-nomor TIDAK terduplikasi', notes1.length === 1, `n=${notes1.length}`)
ck('A1b', 'baris barang TIDAK terduplikasi', items1.length === 1, `n=${items1.length}`)
ck('A1c', 'submit kedua ditolak duplicate_invoice', b.ok === false && b.reason === 'duplicate_invoice', String(b.reason))

// ------------------------------------------------------------
// A2 — RETRY nota TANPA nomor, kunci STABIL (seperti yang dikirim form)
// ------------------------------------------------------------
head('A2 retry nota tanpa nomor — clientRequestId STABIL')
__reset({ tables: base() })
const reqB = 'req-fixed-0002'
const c = await savePurchaseWithClient({ client: mock.supabase, form: formNoInvoice, clientRequestId: reqB, ...base() })
const d = await savePurchaseWithClient({ client: mock.supabase, form: formNoInvoice, clientRequestId: reqB, ...base() })
console.log('  submit1:', JSON.stringify({ ok: c.ok, invoiceNo: c.invoiceNo, internalRefId: c.internalRefId }))
console.log('  submit2:', JSON.stringify({ ok: d.ok, already: d.already, reason: d.reason, invoiceNo: d.invoiceNo }))
const notes2 = __rows('receivings')
const items2 = __rows('receiving_items')
console.log('  nota tersimpan:', JSON.stringify(notes2.map(n => ({ id: n.id, invoice_no: n.invoice_no }))))
ck('A2a', 'retry nota tanpa nomor TIDAK membuat nota kedua', notes2.length === 1,
  `n=${notes2.length} → ${JSON.stringify(notes2.map(n => n.invoice_no))}`)
ck('A2b', 'baris barang TIDAK terduplikasi', items2.length === 1, `n=${items2.length}`)
ck('A2c', 'referensi internal STABIL antar retry',
  c.invoiceNo === d.invoiceNo, `${c.invoiceNo} vs ${d.invoiceNo}`)
ck('A2d', 'retry dilaporkan sebagai `already`, bukan "buka nota lain"',
  d.ok === false && d.already === true, JSON.stringify({ ok: d.ok, already: d.already, reason: d.reason }))

// ------------------------------------------------------------
// A3 — kunci BERBEDA + nota tanpa nomor → memang nota baru (bukan bug)
// ------------------------------------------------------------
head('A3 kunci berbeda → nota baru (memang begitu)')
__reset({ tables: base() })
const e1 = await savePurchaseWithClient({ client: mock.supabase, form: formNoInvoice, clientRequestId: 'req-aaa', ...base() })
const e2 = await savePurchaseWithClient({ client: mock.supabase, form: formNoInvoice, clientRequestId: 'req-bbb', ...base() })
ck('A3a', 'dua percobaan BERBEDA menghasilkan dua nota (bukan retry)', __rows('receivings').length === 2,
  `n=${__rows('receivings').length}`)
ck('A3b', 'referensi internal berbeda untuk percobaan berbeda', e1.invoiceNo !== e2.invoiceNo,
  `${e1.invoiceNo} vs ${e2.invoiceNo}`)

// ------------------------------------------------------------
// A4 — jalur LAMA tidak mengklaim alokasi tersimpan
// ------------------------------------------------------------
head('A4 jalur lama — klaim alokasi jujur')
__reset({ tables: base() })
const f = await savePurchaseWithClient({ client: mock.supabase, form: formWithInvoice, clientRequestId: 'req-legacy-1', ...base() })
console.log('  hasil:', JSON.stringify({ ok: f.ok, atomic: f.atomic, allocationPersisted: f.allocationPersisted, alokasi: f.alokasi, warning: f.allocationWarning }))
ck('A4a', 'jalur lama menandai allocationPersisted:false', f.ok === true && f.allocationPersisted === false, String(f.allocationPersisted))
ck('A4b', 'jalur lama TIDAK mengembalikan angka alokasi palsu',
  Array.isArray(f.alokasi) && f.alokasi.length === 0, JSON.stringify(f.alokasi))
ck('A4c', 'jalur lama memberi peringatan yang bisa dibaca admin',
  typeof f.allocationWarning === 'string' && f.allocationWarning.length > 0, String(f.allocationWarning))

// ------------------------------------------------------------
// B — JALUR ATOMIK: RPC idempoten (kontrak Bandeng)
// ------------------------------------------------------------
head('B jalur atomik — purchase_save_atomic idempoten')

// Mock RPC yang MENIRU kontrak: kunci idempotensi + tolak kunci sama payload beda.
const rpcStore = new Map()
mock.supabase.rpc = async (fn, args) => {
  __state.calls.push({ op: 'rpc', fn, args })
  if (fn !== 'purchase_save_atomic') return { data: null, error: { code: 'PGRST202', message: `Could not find the function ${fn}` } }
  const p = args?.p_payload || {}
  const key = String(p.client_request_id || '')
  const fingerprint = JSON.stringify(p)
  if (rpcStore.has(key)) {
    const prev = rpcStore.get(key)
    if (prev.fingerprint !== fingerprint) {
      return { data: { ok: false, reason: 'idempotency_conflict', error: 'payload berbeda' }, error: null }
    }
    return { data: { ...prev.result, already: true }, error: null }
  }
  const recId = `rec-atomic-${rpcStore.size + 1}`
  const items = (p.items || []).map((it, i) => ({
    id: `ri-atomic-${rpcStore.size + 1}-${i}`, receiving_id: recId,
    pr_item_id: it.pr_item_id || null, material_id: it.material_id || null,
    project_id: it.project_id || null, item_name: it.item_name, unit: it.unit,
    quantity_received: it.quantity_received, unit_price: it.unit_price, note: it.note || null
  }))
  const allocations = []
  for (const [i, it] of (p.items || []).entries()) {
    for (const a of (it.allocations || [])) {
      allocations.push({ id: `al-${i}-${a.project_id}`, receiving_item_id: items[i].id, project_id: a.project_id, qty: a.qty, amount: Math.round(a.qty * it.unit_price) })
    }
  }
  const material = (p.items || []).reduce((s, it) => s + Math.round(it.quantity_received * it.unit_price), 0)
  const result = {
    ok: true, already: false, receiving_id: recId, invoice_no: p.invoice_no,
    items, allocations, material,
    extra_cost: p.extra_cost || 0, discount: p.discount || 0,
    total: Math.max(0, material + (p.extra_cost || 0) - (p.discount || 0)),
    handover_id: p.queue_handover ? `ho-atomic-${rpcStore.size + 1}` : null
  }
  rpcStore.set(key, { fingerprint, result })
  return { data: result, error: null }
}

const capReady = { state: PURCHASE_CAP.READY, allocationPersisted: true, typed: true, allocations: true, atomic: true }

__reset({ tables: base() })
const g1 = await savePurchaseWithClient({ client: mock.supabase, form: formWithInvoice, clientRequestId: 'atomic-1', capability: capReady, ...base() })
const g2 = await savePurchaseWithClient({ client: mock.supabase, form: formWithInvoice, clientRequestId: 'atomic-1', capability: capReady, ...base() })
console.log('  submit1:', JSON.stringify({ ok: g1.ok, atomic: g1.atomic, receivingId: g1.receivingId, allocationPersisted: g1.allocationPersisted, items: g1.items?.length }))
console.log('  submit2:', JSON.stringify({ ok: g2.ok, already: g2.already, receivingId: g2.receivingId }))
ck('B1a', 'RPC dipanggil (bukan jalur lama)', __callsOf('rpc', undefined).some(c => c.fn === 'purchase_save_atomic'))
ck('B1b', 'submit pertama ok + atomic', g1.ok === true && g1.atomic === true)
ck('B1c', 'readback items dari DB (bukan echo)', Array.isArray(g1.items) && g1.items.length === 1 && g1.items[0].id === 'ri-atomic-1-0',
  JSON.stringify(g1.items))
ck('B1d', 'alokasi dilaporkan tersimpan', g1.allocationPersisted === true && Array.isArray(g1.alokasi) && g1.alokasi.length === 1,
  JSON.stringify(g1.alokasi))
ck('B1e', 'retry dengan kunci sama → already:true, id SAMA',
  g2.ok === true && g2.already === true && g2.receivingId === g1.receivingId,
  JSON.stringify({ ok: g2.ok, already: g2.already, a: g1.receivingId, b: g2.receivingId }))
ck('B1f', 'hanya SATU panggilan RPC yang benar-benar menulis (idempoten)',
  rpcStore.size === 1, `n=${rpcStore.size}`)

// B2 — kunci sama, payload BERBEDA → conflict, bukan tulisan kedua
head('B2 kunci sama + isi berbeda → idempotency_conflict')
const formChanged = { ...formWithInvoice, items: [{ ...formWithInvoice.items[0], qty: '9' }] }
const g3 = await savePurchaseWithClient({ client: mock.supabase, form: formChanged, clientRequestId: 'atomic-1', capability: capReady, ...base() })
console.log('  hasil:', JSON.stringify({ ok: g3.ok, reason: g3.reason, error: g3.error }))
ck('B2a', 'perubahan isi dengan kunci sama DITOLAK', g3.ok === false && g3.reason === 'idempotency_conflict',
  JSON.stringify(g3.reason))
ck('B2b', 'tidak ada nota kedua', rpcStore.size === 1, `n=${rpcStore.size}`)

// B3 — split satu baris ke dua proyek (acceptance 4)
head('B3 split satu baris ke dua proyek')
__reset({ tables: base() })
const PROJ_B = '22222222-2222-4222-8222-222222222222'
const formSplit = {
  vendorId: VENDOR, tanggal: '2026-10-21', invoiceNo: 'INV-SPLIT',
  items: [{
    prItemId: null, itemName: 'Besi 10mm', unit: 'btg', qty: '20', harga: '95000', materialId: MAT,
    allocations: [{ projectId: PROJ, qty: 12 }, { projectId: PROJ_B, qty: 8 }], isDirect: true
  }]
}
const h = await savePurchaseWithClient({ client: mock.supabase, form: formSplit, clientRequestId: 'atomic-split', capability: capReady, ...base() })
console.log('  hasil:', JSON.stringify({ ok: h.ok, items: h.items, allocations: h.allocations, alokasi: h.alokasi }))
const sent = __state.calls.filter(c => c.op === 'rpc' && c.fn === 'purchase_save_atomic').pop()
console.log('  payload dikirim:', JSON.stringify(sent?.args?.p_payload?.items))
ck('B3a', 'payload memuat allocations dua proyek', Array.isArray(sent?.args?.p_payload?.items?.[0]?.allocations) && sent.args.p_payload.items[0].allocations.length === 2,
  JSON.stringify(sent?.args?.p_payload?.items?.[0]?.allocations))
ck('B3b', 'project_id tunggal NULL saat split (tidak menebak)',
  sent?.args?.p_payload?.items?.[0]?.project_id === null,
  String(sent?.args?.p_payload?.items?.[0]?.project_id))
ck('B3c', 'qty split dipakai LITERAL (12 & 8), bukan dibagi rata',
  JSON.stringify(h.allocations.map(a => a.qty)) === JSON.stringify([12, 8]),
  JSON.stringify(h.allocations.map(a => a.qty)))
ck('B3d', 'amount dihitung DB qty*unit_price',
  h.allocations.every(a => a.amount === Math.round(a.qty * 95000)),
  JSON.stringify(h.allocations.map(a => a.amount)))

console.log(`\n===== TOTAL: ${pass} PASS / ${fail} FAIL =====`)
process.exit(fail ? 1 : 0)
