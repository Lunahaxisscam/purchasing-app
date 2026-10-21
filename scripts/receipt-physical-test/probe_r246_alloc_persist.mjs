// ============================================================
// probe_r246_alloc_persist.mjs — APAKAH ALOKASI PER BARIS BENAR-BENAR
// TERSIMPAN, atau hanya hidup di state UI?
// ============================================================
// Acceptance Paket 1 butir 4 (OPERATIONAL_BATCH_1.md):
//   "Material ID, project ID, kuantitas, satuan, dan harga beli riil/alokasinya
//    tersimpan secara terstruktur dan terbaca ulang. Berlaku bagi pembelian
//    dari PR maupun langsung tanpa PR, termasuk nota lintas proyek dan
//    pembagian satu baris ke beberapa proyek. Jangan hanya menyimpan alokasi
//    pada header atau state UI."
//
// DUA jalur diuji, karena keduanya harus JUJUR:
//
//   L (LEGACY) — skema alokasi belum ada. Nota tetap tersimpan; alokasi TIDAK.
//                Yang diuji: aplikasi TIDAK BOLEH mengklaim alokasi tersimpan,
//                dan setelah reload biaya muncul sebagai `unassigned`
//                (bukan ditebak ke proyek).
//   A (ATOMIC) — RPC `purchase_save_atomic` ada. Yang diuji: payload memuat
//                material_id/project_id/unit_price/allocations, lalu baris DB
//                hasil readback benar-benar mengalokasikan biaya ke proyek
//                yang tepat setelah RELOAD (dibaca `projectCostBreakdown`).
//
// Modul dijalankan VERBATIM hasil transform SWC (dist/), bukan salinan.
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const mock = await load('lib/supabaseClient.mjs')
const { __state, __reset, __rows, __callsOf } = mock
const { savePurchaseWithClient } = await load('modules/receivings/purchaseSave.mjs')
const { PURCHASE_CAP } = await load('modules/receivings/purchaseCapability.mjs')
const breakdownMod = await load('lib/projectCostBreakdown.mjs')
const buildCostBreakdown = breakdownMod.buildCostBreakdown || breakdownMod.default

let pass = 0, fail = 0
function ck(id, name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${id}  ${name}`) }
  else { fail++; console.log(`  FAIL ${id}  ${name}${detail ? ' :: ' + detail : ''}`) }
}
function head(t) { console.log(`\n=== ${t} ===`) }

const PROJ_A = '11111111-1111-4111-8111-111111111111'
const PROJ_B = '22222222-2222-4222-8222-222222222222'
const VENDOR = '33333333-3333-4333-8333-333333333333'
const MAT_CAT = '44444444-4444-4444-8444-444444444444'
const MAT_PASIR = '77777777-7777-4777-8777-777777777777'

const projects = [
  { id: PROJ_A, kode: '61', name: 'Sunter Hijau' },
  { id: PROJ_B, kode: '62', name: 'Pujon' }
]
const vendors = [{ id: VENDOR, name: 'Toko Bangunan Jaya' }]
const materials = [
  { id: MAT_CAT, name: 'Cat tembok', harga_acuan: 120000 },
  { id: MAT_PASIR, name: 'Pasir cor', harga_acuan: 300000 }
]

function baseTables() {
  return { projects, vendors, materials, receivings: [], receiving_items: [], handovers: [], pr_items: [], purchase_requests: [] }
}

// ------------------------------------------------------------------
// Mock RPC purchase_save_atomic — MENIRU kontrak Bandeng v1.
// Menyimpan baris typed + allocations ke "tabel" supaya bisa dibaca ulang
// persis seperti sesudah reload.
// ------------------------------------------------------------------
function installAtomicRpc() {
  const store = new Map()
  mock.supabase.rpc = async (fn, args) => {
    __state.calls.push({ op: 'rpc', fn, args })
    if (fn !== 'purchase_save_atomic') {
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function ${fn}` } }
    }
    const p = args?.p_payload || {}
    const key = String(p.client_request_id || '')
    const fp = JSON.stringify(p)
    if (store.has(key)) {
      const prev = store.get(key)
      if (prev.fp !== fp) return { data: { ok: false, reason: 'idempotency_conflict', error: 'payload berbeda' }, error: null }
      return { data: { ...prev.result, already: true }, error: null }
    }
    const recId = `rec-atomic-${store.size + 1}`
    // Pastikan tabel ada (mock __reset hanya membuat tabel yang disebut).
    for (const t of ['receiving_items', 'receiving_item_allocations', 'receivings']) {
      if (!__state.tables.has(t)) __state.tables.set(t, new Map())
    }
    const itemsTable = __state.tables.get('receiving_items')
    const allocTable = __state.tables.get('receiving_item_allocations')
    const items = []
    const allocations = []
    for (const [i, it] of (p.items || []).entries()) {
      const rowId = `ri-atomic-${store.size + 1}-${i}`
      const row = {
        id: rowId, receiving_id: recId, pr_item_id: it.pr_item_id || null,
        material_id: it.material_id || null, project_id: it.project_id || null,
        item_name: it.item_name, unit: it.unit,
        quantity_received: it.quantity_received, unit_price: it.unit_price,
        note: it.note || null
      }
      itemsTable.set(rowId, row)
      items.push(row)
      for (const a of (it.allocations || [])) {
        const aid = `al-${rowId}-${a.project_id}`
        const arow = {
          id: aid, receiving_item_id: rowId, project_id: a.project_id,
          qty: a.qty, amount: Math.round(a.qty * it.unit_price)
        }
        allocTable.set(aid, arow)
        allocations.push(arow)
      }
    }
    const material = items.reduce((s, it) => s + Math.round(it.quantity_received * it.unit_price), 0)
    const result = {
      ok: true, already: false, receiving_id: recId, invoice_no: p.invoice_no,
      items, allocations, material,
      extra_cost: p.extra_cost || 0, discount: p.discount || 0,
      total: Math.max(0, material + (p.extra_cost || 0) - (p.discount || 0)),
      handover_id: p.queue_handover ? `ho-atomic-${store.size + 1}` : null
    }
    // Header juga ditulis supaya projectCostBreakdown bisa menemukan notanya.
    __state.tables.get('receivings').set(recId, {
      id: recId, vendor_id: p.vendor_id, invoice_no: p.invoice_no,
      received_date: p.purchased_date, project_id: null, purchase_request_id: null,
      status: 'DIBELI', note: p.note, delivery_note: `Nota ${p.invoice_no}`
    })
    store.set(key, { fp, result })
    return { data: result, error: null }
  }
  return store
}

const capReady = { state: PURCHASE_CAP.READY, allocationPersisted: true, typed: true, allocations: true, atomic: true }
const capLegacy = { state: PURCHASE_CAP.LEGACY, allocationPersisted: false, typed: false, allocations: false, atomic: false }

// ------------------------------------------------------------------
// L — JALUR LAMA: jujur TIDAK mengklaim alokasi
// ------------------------------------------------------------------
head('L jalur lama — nota lintas proyek, skema alokasi belum ada')
__reset({ tables: baseTables() })
const formL = {
  vendorId: VENDOR, tanggal: '2026-10-21', invoiceNo: 'INV-LINTAS-1', biayaLain: '25000',
  items: [
    { prItemId: null, itemName: 'Cat tembok', unit: 'kaleng', qty: '10', harga: '65000', projectId: PROJ_A, materialId: MAT_CAT, isDirect: true },
    { prItemId: null, itemName: 'Pasir cor', unit: 'm3', qty: '2', harga: '300000', projectId: PROJ_B, materialId: MAT_PASIR, isDirect: true }
  ]
}
const rL = await savePurchaseWithClient({ client: mock.supabase, form: formL, clientRequestId: 'legacy-1', capability: capLegacy, ...baseTables() })
console.log('  hasil:', JSON.stringify({ ok: rL.ok, atomic: rL.atomic, allocationPersisted: rL.allocationPersisted, alokasi: rL.alokasi }))

ck('L1', 'nota tetap tersimpan (uang sudah keluar)', rL.ok === true, rL.error)
ck('L2', 'TIDAK mengklaim alokasi tersimpan', rL.allocationPersisted === false, String(rL.allocationPersisted))
ck('L3', 'TIDAK mengembalikan angka alokasi palsu', Array.isArray(rL.alokasi) && rL.alokasi.length === 0, JSON.stringify(rL.alokasi))

const reloadL = buildCostBreakdown({
  receivings: __rows('receivings'), receivingItems: __rows('receiving_items'), projects, vendors
})
const assignedL = [...(reloadL?.perProject instanceof Map ? reloadL.perProject.entries() : Object.entries(reloadL?.perProject || {}))]
  .reduce((s, [, v]) => s + (Number(v?.material?.total) || 0), 0)
console.log('  setelah reload — assigned:', assignedL, 'unassigned:', reloadL?.unassignedMaterial?.total)
ck('L4', 'setelah reload, biaya muncul sebagai unassigned (tidak ditebak ke proyek)',
  assignedL === 0 && (reloadL?.unassignedMaterial?.total || 0) === 1250000,
  `assigned=${assignedL} unassigned=${reloadL?.unassignedMaterial?.total}`)

// ------------------------------------------------------------------
// A — JALUR ATOMIK: alokasi BENAR-BENAR tersimpan & terbaca ulang
// ------------------------------------------------------------------
head('A jalur atomik — nota lintas proyek')
__reset({ tables: baseTables() })
installAtomicRpc()
const rA = await savePurchaseWithClient({ client: mock.supabase, form: formL, clientRequestId: 'atomic-1', capability: capReady, ...baseTables() })
console.log('  hasil:', JSON.stringify({ ok: rA.ok, atomic: rA.atomic, allocationPersisted: rA.allocationPersisted, items: rA.items, alokasi: rA.alokasi }))

ck('A1', 'RPC atomik dipakai', rA.atomic === true, JSON.stringify({ atomic: rA.atomic }))
ck('A2', 'klaim alokasi tersimpan (dari baris DB)', rA.allocationPersisted === true)

const sentA = __callsOf('rpc', undefined).filter(c => c.fn === 'purchase_save_atomic').pop()?.args?.p_payload
console.log('  payload items:', JSON.stringify(sentA?.items))
ck('A3', 'payload memuat material_id per baris', (sentA?.items || []).every(it => it.material_id),
  JSON.stringify((sentA?.items || []).map(it => it.material_id)))
ck('A4', 'payload memuat project_id per baris', (sentA?.items || []).every(it => it.project_id),
  JSON.stringify((sentA?.items || []).map(it => it.project_id)))
ck('A5', 'payload memuat unit_price per baris', (sentA?.items || []).every(it => it.unit_price > 0),
  JSON.stringify((sentA?.items || []).map(it => it.unit_price)))

const reloadA = buildCostBreakdown({
  receivings: __rows('receivings'), receivingItems: __rows('receiving_items'), projects, vendors
})
const ppA = reloadA?.perProject instanceof Map ? [...reloadA.perProject.entries()] : Object.entries(reloadA?.perProject || {})
console.log('  setelah reload — perProject:', JSON.stringify(ppA.map(([k, v]) => [k, v?.material?.total])), 'unassigned:', reloadA?.unassignedMaterial?.total)
ck('A6', 'setelah RELOAD, proyek 61 menerima 650.000',
  (ppA.find(([k]) => String(k) === '61')?.[1]?.material?.total || 0) === 650000,
  JSON.stringify(ppA.map(([k, v]) => [k, v?.material?.total])))
ck('A7', 'setelah RELOAD, proyek 62 menerima 600.000',
  (ppA.find(([k]) => String(k) === '62')?.[1]?.material?.total || 0) === 600000,
  JSON.stringify(ppA.map(([k, v]) => [k, v?.material?.total])))
ck('A8', 'tidak ada biaya yang jatuh ke unassigned',
  (reloadA?.unassignedMaterial?.total || 0) === 0,
  String(reloadA?.unassignedMaterial?.total))

// ------------------------------------------------------------------
// B — SPLIT satu baris ke dua proyek, terbaca ulang
// ------------------------------------------------------------------
head('B split satu baris ke dua proyek — terbaca ulang')
__reset({ tables: baseTables() })
installAtomicRpc()
const formB = {
  vendorId: VENDOR, tanggal: '2026-10-21', invoiceNo: 'INV-SPLIT',
  items: [{
    prItemId: null, itemName: 'Besi 10mm', unit: 'btg', qty: '20', harga: '95000', materialId: MAT_CAT,
    allocations: [{ projectId: PROJ_A, qty: 12 }, { projectId: PROJ_B, qty: 8 }], isDirect: true
  }]
}
const rB = await savePurchaseWithClient({ client: mock.supabase, form: formB, clientRequestId: 'atomic-split', capability: capReady, ...baseTables() })
console.log("  hasil:", JSON.stringify({ ok: rB.ok, reason: rB.reason, error: rB.error, allocations: rB.allocations, alokasi: rB.alokasi }))
ck('B1', 'dua baris alokasi tersimpan', (rB.allocations || []).length === 2, JSON.stringify(rB.allocations))
ck('B2', 'qty split literal 12 & 8', JSON.stringify((rB.allocations || []).map(a => a.qty)) === JSON.stringify([12, 8]),
  JSON.stringify((rB.allocations || []).map(a => a.qty)))

const reloadB = buildCostBreakdown({
  receivings: __rows('receivings'), receivingItems: __rows('receiving_items'),
  receivingItemAllocations: __rows('receiving_item_allocations'), projects, vendors
})
const ppB = reloadB?.perProject instanceof Map ? [...reloadB.perProject.entries()] : Object.entries(reloadB?.perProject || {})
console.log('  setelah reload — perProject:', JSON.stringify(ppB.map(([k, v]) => [k, v?.material?.total])), 'unassigned:', reloadB?.unassignedMaterial?.total)
// Pembaca HARUS membaca receiving_item_allocations (bukan hanya project_id).
// Baris split punya project_id NULL, jadi tanpa pembacaan alokasi seluruh
// biaya jatuh ke unassigned walau pembagiannya TERSIMPAN di DB.
const totalB = 20 * 95000
const sumB = ppB.reduce((s, [, v]) => s + (Number(v?.material?.total) || 0), 0) + (reloadB?.unassignedMaterial?.total || 0)
ck('B3', 'total biaya split tidak hilang dan tidak digandakan', sumB === totalB, `sum=${sumB} expected=${totalB}`)
ck('B4', 'porsi 12 btg (1.140.000) masuk proyek 61',
  (ppB.find(([k]) => String(k) === '61')?.[1]?.material?.total || 0) === 1140000,
  JSON.stringify(ppB.map(([k, v]) => [k, v?.material?.total])))
ck('B5', 'porsi 8 btg (760.000) masuk proyek 62',
  (ppB.find(([k]) => String(k) === '62')?.[1]?.material?.total || 0) === 760000,
  JSON.stringify(ppB.map(([k, v]) => [k, v?.material?.total])))
ck('B6', 'tidak ada biaya split yang jatuh ke unassigned',
  (reloadB?.unassignedMaterial?.total || 0) === 0, String(reloadB?.unassignedMaterial?.total))

console.log(`\n===== TOTAL: ${pass} PASS / ${fail} FAIL =====`)
process.exit(fail ? 1 : 0)
