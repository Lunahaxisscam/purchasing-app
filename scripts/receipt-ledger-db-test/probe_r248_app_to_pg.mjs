// ============================================================
// probe_r248_app_to_pg.mjs — PAYLOAD APLIKASI → RPC NYATA (PG16)
// ============================================================
// Menutup pertanyaan yang tidak bisa dijawab mock: apakah payload yang
// BENAR-BENAR dibentuk modul produksi diterima RPC kontrak v1 (t_2b8dcab3)?
//
// Yang diuji (modul VERBATIM hasil transform SWC):
//   A1  split 1 baris → 2 proyek (12/8 @95000): tersimpan, amount per porsi
//       = qty*unit_price (1140000 / 760000), header proyek NULL.
//   A2  retry dengan client_request_id SAMA → already:true dan
//       items[]/allocations[] PENUH dari tabel (bukan kosong/echo).
//   A3  kunci sama + isi BEDA → ok:false reason idempotency_conflict
//       (BUKAN sukses, BUKAN nota kedua).
//   A4  nonadmin → {ok:false,reason:'forbidden'}; capability TIDAK boleh
//       menyimpulkan READY dari jawaban itu (catatan Bandeng).
//   A5  split tidak pas (12/7) → ditolak SEBELUM menulis (boundary aplikasi),
//       dan RPC juga menolak bila dipaksa.
//   A6  createActiveHandover: RPC → satu dokumen aktif; panggilan kedua
//       already:true; setelah dikonfirmasi dokumen baru sah.
//   A7  capability unknown/error → createActiveHandover MENOLAK menulis.
//
// Jalankan: PGURL=... node probe_r248_app_to_pg.mjs
// ============================================================
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const { Client } = require(path.join(SB, 'node_modules', 'pg'))
const PGURL = process.env.PGURL
if (!PGURL) { console.error('PGURL wajib'); process.exit(2) }

const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

let pass = 0, fail = 0
const failures = []
function ck(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`) }
}
const head = (t) => console.log(`\n=== ${t} ===`)

// ---- klien yang MENDELEGASI ke PostgreSQL nyata ---------------------------
// `rpc(nama, params)` dipetakan ke `select public.<nama>(p_x => $1::jsonb)` —
// padanan PostgREST: nama parameter & tipe benar-benar diuji.
//
// `from(tabel).select(kolom).limit(1)` juga dijalankan ke PG nyata, sehingga
// probe capability diuji terhadap skema SUNGGUHAN (kolom hilang → 42703,
// tabel hilang → 42P01, grant ditolak → 42501), bukan terhadap mock.
function makeClient(role, uid) {
  const c = new Client({ connectionString: PGURL })
  let ready = null
  async function conn() {
    if (!ready) ready = c.connect()
    await ready
    if (role) {
      await c.query(`set role ${role}`)
      await c.query(`select set_config('request.jwt.claim.sub',$1,false)`, [uid || ''])
    }
    return c
  }
  function builder(table, cols) {
    const st = { table, cols }
    const api = {
      select(columns) { if (typeof columns === 'string') st.cols = columns; return api },
      limit() { return api },
      eq() { return api },
      is() { return api },
      order() { return api },
      then(resolve, reject) { return Promise.resolve(runSelect(st)).then(resolve, reject) },
      catch(reject) { return Promise.resolve(runSelect(st)).catch(reject) }
    }
    return api
  }
  async function runSelect(st) {
    const db = await conn()
    const cols = String(st.cols || '*').split(',').map(x => x.trim()).filter(Boolean).join(', ')
    try {
      await db.query(`select ${cols} from public.${st.table} limit 1`)
      return { data: [], error: null }
    } catch (e) {
      const code = e.code === '42P01' ? 'PGRST205' : e.code === '42703' ? 'PGRST204' : e.code
      return { data: null, error: { code, message: e.message } }
    }
  }
  return {
    from(table) { return builder(table, '*') },
    async rpc(fn, params) {
      const db = await conn()
      const keys = Object.keys(params || {})
      const args = keys.map((k, i) => `${k} => $${i + 1}${params[k] !== null && typeof params[k] === 'object' ? '::jsonb' : ''}`)
      const vals = keys.map(k => (params[k] !== null && typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]))
      try {
        const { rows } = await db.query(`select public.${fn}(${args.join(', ')}) as out`, vals)
        return { data: rows[0]?.out ?? null, error: null }
      } catch (e) {
        return { data: null, error: { code: e.code, message: e.message } }
      }
    },
    async raw(sql, args = []) {
      const db = await conn()
      const { rows } = await db.query(sql, args)
      return rows
    },
    async close() { try { await c.end() } catch (e) { /* abaikan */ } }
  }
}

const ADMIN = '90000000-0000-0000-0000-000000000001'
const MEMBER = '90000000-0000-0000-0000-000000000002'
const P1 = '11111111-1111-1111-1111-111111111111'
const P2 = '22222222-2222-2222-2222-222222222222'
const MAT = 'aaaaaaaa-0000-0000-0000-000000000001'
const VEN = 'bbbbbbbb-0000-0000-0000-000000000001'
const PRITEM = 'dddddddd-0000-0000-0000-0000000000aa'

const projects = [
  { id: P1, kode: '83', name: 'Mabes' },
  { id: P2, kode: 'PS 1', name: 'Cendana Breeze' }
]
const vendors = [{ id: VEN, name: 'TB Makmur Jaya' }]
const materials = [{ id: MAT, kode: 'M001', name: 'Triplek 9mm', satuan: 'Lembar' }]

function formSplit({ qty = '20', a = '12', b = '8', invoice = '' } = {}) {
  return {
    vendorId: VEN,
    tanggal: '2026-10-21',
    invoiceNo: invoice,
    biayaLain: '15000',
    diskon: '5000',
    notaUrl: '', buktiNota: '', buktiTransfer: '', catatan: 'uji r248',
    items: [{
      prItemId: PRITEM, prId: 'cccccccc-0000-0000-0000-000000000001',
      formKey: 'f1', itemName: 'Triplek 9mm', unit: 'Lembar', qtyPr: 10,
      qty, harga: '95000', materialId: MAT, projectId: P1,
      allocations: [
        { key: 'a1', projectId: P1, qty: a },
        { key: 'a2', projectId: P2, qty: b }
      ]
    }]
  }
}

const { validatePurchaseForm, buildSavePlan } = await load('modules/receivings/purchaseLogic.mjs')
const { savePurchaseWithClient } = await load('modules/receivings/purchaseSave.mjs')
const { validateSplit, normalizeAllocations, suggestSplit } = await load('modules/receivings/allocationLogic.mjs')
const { getPurchaseCapability, resetPurchaseCapability } = await load('modules/receivings/purchaseCapability.mjs')
const { createActiveHandover } = await load('modules/handovers/createHandover.mjs')
const { getCreateCapability, resetCreateCapability } = await load('modules/handovers/createCapability.mjs')

const admin = makeClient('authenticated', ADMIN)
const member = makeClient('authenticated', MEMBER)

// ---------------------------------------------------------------------------
head('A0. Modul murni: aturan split sama dengan yang ditegakkan DB')
const vOk = validatePurchaseForm(formSplit(), { vendors })
ck('A0a form split 12/8 dinyatakan valid', vOk.valid === true, JSON.stringify(vOk.errors))
const vBad = validatePurchaseForm(formSplit({ b: '7' }), { vendors })
ck('A0b split 12/7 DITOLAK di form (bukan menunggu server)', vBad.valid === false &&
  Object.values(vBad.itemErrors).some(e => e.split), JSON.stringify(vBad.itemErrors))
const vOne = validatePurchaseForm(formSplit({ a: '20', b: '0' }), { vendors })
ck('A0c satu proyek saja (20/0) DITOLAK (butuh >=2 proyek)', vOne.valid === false)
const plan = buildSavePlan(formSplit())
ck('A0d buildSavePlan meneruskan allocations (bukan membuang)', Array.isArray(plan.items[0].allocations) &&
  plan.items[0].allocations.length === 2, JSON.stringify(plan.items[0].allocations))
ck('A0e suggestSplit total PERSIS = qty (tanpa sisa pembulatan)',
  (() => { const r = suggestSplit('10', [P1, P2]); return r.length === 2 && r[0].qty + r[1].qty === 10 })())

// ---------------------------------------------------------------------------
head('A1. Simpan split lewat jalur ATOMIK aplikasi → RPC NYATA')
resetPurchaseCapability()
const capAdmin = await getPurchaseCapability({ force: true, client: admin })
ck('A1a capability admin = READY', capAdmin.state === 'ready', JSON.stringify(capAdmin))
const res1 = await savePurchaseWithClient({
  client: admin, form: formSplit({ invoice: 'R248-APP-1' }), receivings: [], receivingItems: [],
  prItems: [{ id: PRITEM, pr_id: 'cccccccc-0000-0000-0000-000000000001', material_id: MAT }],
  requests: [], vendors, clientRequestId: 'req-r248-app-0001', capability: capAdmin
})
ck('A1b simpan sukses', res1.ok === true, JSON.stringify(res1).slice(0, 300))
ck('A1c allocationPersisted true', res1.allocationPersisted === true)
const byProj = Object.fromEntries((res1.alokasi || []).map(a => [a.projectId, a.material]))
ck('A1d amount per porsi = qty*unit_price (1140000 / 760000)',
  byProj[P1] === 1140000 && byProj[P2] === 760000, JSON.stringify(byProj))
ck('A1e items[] dibaca dari DB (ada id baris)', Array.isArray(res1.items) && res1.items.length === 1 && !!res1.items[0].id)
ck('A1f header proyek NULL untuk split', res1.items[0].projectId === null, String(res1.items[0].projectId))

const dbRows = await admin.raw(
  `select r.project_id, ri.project_id as item_project, a.project_id as alloc_project, a.qty, a.amount
   from public.receivings r join public.receiving_items ri on ri.receiving_id=r.id
   left join public.receiving_item_allocations a on a.receiving_item_id=ri.id
   where r.invoice_no=$1 order by a.qty desc`, ['R248-APP-1'])
ck('A1g DB: header & baris proyek NULL, 2 baris alokasi', dbRows.length === 2 &&
  dbRows.every(x => x.project_id === null && x.item_project === null), JSON.stringify(dbRows))
ck('A1h DB: total alokasi = qty beli (12+8=20)', dbRows.reduce((s, x) => s + Number(x.qty), 0) === 20)

// ---------------------------------------------------------------------------
head('A2. RETRY kunci sama → already:true + items/allocations PENUH')
const res2 = await savePurchaseWithClient({
  client: admin, form: formSplit({ invoice: 'R248-APP-1' }), receivings: [], receivingItems: [],
  prItems: [{ id: PRITEM, pr_id: 'cccccccc-0000-0000-0000-000000000001', material_id: MAT }],
  requests: [], vendors, clientRequestId: 'req-r248-app-0001', capability: capAdmin
})
ck('A2a retry → ok + already:true', res2.ok === true && res2.already === true, JSON.stringify(res2).slice(0, 200))
ck('A2b retry mengembalikan items[] PENUH', Array.isArray(res2.items) && res2.items.length === 1)
ck('A2c retry mengembalikan allocations[] PENUH (2 baris)', Array.isArray(res2.allocations) && res2.allocations.length === 2,
  String(res2.allocations?.length))
const cnt1 = await admin.raw(`select count(*)::int n from public.receivings where invoice_no=$1`, ['R248-APP-1'])
ck('A2d retry TIDAK membuat nota kedua', cnt1[0].n === 1, String(cnt1[0].n))

// ---------------------------------------------------------------------------
head('A3. Kunci sama + isi BEDA → idempotency_conflict (bukan sukses)')
const res3 = await savePurchaseWithClient({
  client: admin, form: formSplit({ qty: '20', a: '12', b: '8', invoice: 'R248-APP-1' }), receivings: [], receivingItems: [],
  prItems: [{ id: PRITEM, pr_id: 'cccccccc-0000-0000-0000-000000000001', material_id: MAT }],
  requests: [], vendors, clientRequestId: 'req-r248-app-0001', capability: capAdmin,
  headerNoteSuffix: 'ISI BERBEDA'
})
ck('A3a ditolak dengan reason idempotency_conflict', res3.ok === false && res3.reason === 'idempotency_conflict',
  JSON.stringify(res3).slice(0, 200))
const cnt2 = await admin.raw(`select count(*)::int n from public.receivings where invoice_no=$1`, ['R248-APP-1'])
ck('A3b tetap satu nota', cnt2[0].n === 1, String(cnt2[0].n))

// ---------------------------------------------------------------------------
head('A4. Nonadmin: RPC forbidden → capability TIDAK boleh READY')
resetPurchaseCapability()
const capMember = await getPurchaseCapability({ force: true, client: member })
ck('A4a capability nonadmin BUKAN ready', capMember.state !== 'ready', JSON.stringify(capMember))
ck('A4b sebabnya menyebut forbidden/akses', /forbidden|akses|ditolak/i.test((capMember.missing || []).join(' ')) ||
  /forbidden/i.test(String(capMember.missing)), JSON.stringify(capMember.missing))
const resM = await savePurchaseWithClient({
  client: member, form: formSplit({ invoice: 'R248-APP-NONADMIN' }), receivings: [], receivingItems: [],
  prItems: [], requests: [], vendors, clientRequestId: 'req-r248-app-member', capability: capMember
})
const cntM = await admin.raw(`select count(*)::int n from public.receivings where invoice_no=$1`, ['R248-APP-NONADMIN'])
ck('A4c nonadmin TIDAK menulis nota', cntM[0].n === 0 && resM.ok === false, JSON.stringify(resM).slice(0, 160))

// ---------------------------------------------------------------------------
head('A5. Split tidak pas: boundary aplikasi menolak SEBELUM menulis')
const res5 = await savePurchaseWithClient({
  client: admin, form: formSplit({ b: '7', invoice: 'R248-APP-BAD' }), receivings: [], receivingItems: [],
  prItems: [], requests: [], vendors, clientRequestId: 'req-r248-app-bad', capability: capAdmin
})
const cnt5 = await admin.raw(`select count(*)::int n from public.receivings where invoice_no=$1`, ['R248-APP-BAD'])
ck('A5a ditolak boundary (allocation_not_exact)', res5.ok === false && res5.reason === 'allocation_not_exact',
  JSON.stringify(res5).slice(0, 200))
ck('A5b nol tulisan', cnt5[0].n === 0, String(cnt5[0].n))

// ---------------------------------------------------------------------------
head('A6. createActiveHandover: RPC → satu dokumen aktif, retry, lalu bertahap')
resetCreateCapability()
const capCreate = await getCreateCapability({ force: true, client: admin })
ck('A6a capability create = READY (RPC ada & menjawab kontrak)', capCreate.state === 'ready', JSON.stringify(capCreate))
const rec = await admin.raw(`select id from public.receivings where invoice_no=$1`, ['R248-APP-1'])
const recId = rec[0].id
// Nota tadi sudah membuat antrean lewat purchase_save_atomic → dokumen aktif ada.
const existing = await admin.raw(`select id from public.handovers where receiving_id=$1 and diserahkan_at is null`, [recId])
const h1 = await createActiveHandover({ data: { receiving_id: recId, received_by: 'Belum ditentukan', handover_date: '2026-10-21' }, client: admin, capability: capCreate })
ck('A6b panggilan saat sudah ada dokumen → ok + already (bukan dokumen kedua)', h1.ok === true && h1.already === true,
  JSON.stringify(h1).slice(0, 200))
ck('A6c via rpc', h1.via === 'rpc', String(h1.via))
const active1 = await admin.raw(`select count(*)::int n from public.handovers where receiving_id=$1 and diserahkan_at is null`, [recId])
ck('A6d tetap SATU dokumen aktif', active1[0].n === 1, String(active1[0].n))
ck('A6e handover_id = dokumen yang sudah ada', String(h1.id) === String(existing[0].id), `${h1.id} vs ${existing[0].id}`)

// Konfirmasi dokumen (RPC) lalu buat lagi → dokumen BARU sah (bertahap).
// CATATAN PENTING (acceptance 1): nota beli TIDAK otomatis berarti barang
// datang. Jadi event kedatangan dibuat EKSPLISIT lewat RPC — kalau tidak,
// `handover_confirm` memang harus menolak (tidak ada yang bisa diserahkan).
const itemRow = await admin.raw(`select id from public.receiving_items where receiving_id=$1`, [recId])
const applyRes = await admin.rpc('receipt_apply_events', {
  p_receiving_id: recId,
  p_events: itemRow.map(r => ({
    client_event_id: `evt-r248-${r.id}`,
    receiving_item_id: r.id,
    qty_datang: 20, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 20,
    penerima_tukang: 'Tukang Uji', retur_status: 'NONE', retur_qty: 0,
    discard_confirmed: false, source: 'FORM'
  })),
  p_meta: {}
})
ck('A6f0 event kedatangan dicatat lewat RPC (beli ≠ datang)', applyRes.data?.ok === true, JSON.stringify(applyRes).slice(0, 160))
const ev = await admin.raw(`select id, tujuan_tukang from public.receiving_events where receiving_id=$1`, [recId])
if (ev.length) {
  const conf = await admin.rpc('handover_confirm', {
    p_handover_id: existing[0].id,
    p_lines: ev.map(e => ({ receiving_event_id: e.id, qty_diserahkan: Number(e.tujuan_tukang), penerima: 'Tukang Uji' }))
  })
  ck('A6f konfirmasi dokumen lewat RPC berhasil', conf.data?.ok === true, JSON.stringify(conf).slice(0, 160))
  const h2 = await createActiveHandover({ data: { receiving_id: recId, handover_date: '2026-10-21' }, client: admin, capability: capCreate })
  ck('A6g setelah dikonfirmasi, dokumen BARU sah (already:false)', h2.ok === true && h2.already === false, JSON.stringify(h2).slice(0, 200))
  ck('A6h dokumen baru berbeda id', String(h2.id) !== String(h1.id))
} else {
  ck('A6f prasyarat event ada (nota ini belum punya event)', false, 'tidak ada receiving_events')
}

// ---------------------------------------------------------------------------
head('A7. capability unknown/error → createActiveHandover MENOLAK menulis')
const beforeCnt = await admin.raw(`select count(*)::int n from public.handovers`)
const blocked = await createActiveHandover({
  data: { receiving_id: recId, handover_date: '2026-10-21' }, client: admin,
  capability: { state: 'error', reason: 'probe gagal: permission denied' }
})
const afterCnt = await admin.raw(`select count(*)::int n from public.handovers`)
ck('A7a ditolak (blocked) dengan sebab terbaca', blocked.ok === false && blocked.blocked === true && /belum bisa dipastikan/i.test(blocked.reason),
  JSON.stringify(blocked).slice(0, 200))
ck('A7b NOL tulisan handovers', beforeCnt[0].n === afterCnt[0].n, `${beforeCnt[0].n} → ${afterCnt[0].n}`)
const unknownRes = await createActiveHandover({
  data: { receiving_id: recId, handover_date: '2026-10-21' }, client: admin,
  capability: { state: 'unknown' }
})
ck('A7c state unknown juga ditolak', unknownRes.ok === false && unknownRes.blocked === true)

// ---------------------------------------------------------------------------
head('A8. LEGACY: RPC tidak ada → jalur slot dipakai (bukan ditolak)')
// Klien yang meniru database BELUM dimigrasi: PGRST202 untuk RPC kontrak v1.
const legacyClient = {
  async rpc() { return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.handover_create_atomic' } } }
}
const legacyCap = await getCreateCapability({ force: true, client: legacyClient })
ck('A8a capability = legacy', legacyCap.state === 'legacy', JSON.stringify(legacyCap))
const legacyCall = await createActiveHandover({
  data: { receiving_id: 'rec-legacy-1', handover_date: '2026-10-21' }, client: legacyClient, capability: legacyCap
})
ck('A8b jalur LEGACY dipakai (via slot), bukan RPC', legacyCall.via === 'slot', JSON.stringify(legacyCall).slice(0, 160))
const unknownClient = { async rpc() { return { data: null, error: null } } }
const unknownCap = await getCreateCapability({ force: true, client: unknownClient })
ck('A8c data:null tanpa error BUKAN legacy (tidak bisa disimpulkan)', unknownCap.state === 'error', JSON.stringify(unknownCap))

// ---------------------------------------------------------------------------
console.log(`\n=== HASIL PROBE 248 (APP→PG): ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
await admin.close()
await member.close()
process.exit(fail ? 1 : 0)
