// ============================================================
// real_db_test.mjs — CREATE API Bakpau terhadap PostgreSQL NYATA
// ============================================================
// Memakai handler PRODUKSI (createBakpauCreateHandler) dengan klien `pg`
// (bukan mock) + fungsi SQL `bakpau_save_purchase_atomic` yang benar-benar
// di-apply ke database terisolasi. Semua angka dibaca dari database setelah
// request.
//
// Fixture: baseline live-like t_03b41644 + migrasi ledger Bakpau + fungsi
// atomik DRAFT. Tidak ada data nyata, tidak ada jaringan, tidak ada Supabase.
//
// FOKUS (regresi review Brooklyn): transaksi tunggal.
//   * sukses -> 1 header + N baris + 2 baris ledger 'recorded' (satu commit)
//   * duplikat event / bukti / nota lintas kanal -> 0 baris baru DAN tidak
//     ada klaim ledger yang tertinggal (rollback total)
//   * FAULT INJECTION nyata: trigger yang melempar error di tengah insert
//     baris -> header TIDAK tertinggal, klaim ledger TIDAK tertinggal
//   * RPC belum di-apply -> fail closed 503, 0 baris
//   * readback ketat dari DB
// ============================================================

import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createPgClient } from './pgSupabaseShim.mjs'

const SB = process.cwd()
const load = rel => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const H = await load('lib/bakpau/apiHandler.mjs')
const A = await load('lib/bakpau/apiAuth.mjs')

const PGURL = process.env.PGURL
if (!PGURL) { console.error('PGURL wajib'); process.exit(1) }
const client = createPgClient({ connectionString: PGURL })

let pass = 0, fail = 0
const failures = []
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`) }
}
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want }) }
function group(t) { console.log(`\n=== ${t} ===`) }

// --- Token uji (runtime, hanya hash masuk env) ---
const KEY_ID = 'realpg01'
const SECRET = crypto.randomBytes(32).toString('base64url')
const TOKEN = `bpk.${KEY_ID}.${SECRET}`
const HASH = crypto.createHash('sha256').update(SECRET, 'utf8').digest('hex')
const ENV = {
  BAKPAU_API_TOKENS: `${KEY_ID}:${HASH}:purchasing:read+purchasing:create`,
  // DB uji terisolasi: saklar tulis dinyalakan HANYA di sini, bukan produksi.
  BAKPAU_API_CREATE_ENABLED: 'true',
  BAKPAU_NOTIFY_ENABLED: '1'
}

function makeRes() {
  return {
    statusCode: null, headers: {}, body: null,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v },
    status(c) { this.statusCode = c; return this },
    json(p) { this.body = p; return this }
  }
}
function makeReq({ method = 'POST', body = {}, headers = {} } = {}) {
  return { method, headers, body, query: {} }
}

async function q(sql, params = []) {
  const r = await client.__query(sql, params)
  // Samakan dengan perilaku PostgREST: DATE -> "YYYY-MM-DD", timestamp -> ISO.
  return r.rows.map(row => {
    const out = { ...row }
    for (const f of r.fields) {
      const v = out[f.name]
      if (!(v instanceof Date)) continue
      if (f.dataTypeID === 1082) {
        out[f.name] = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
      } else {
        out[f.name] = v.toISOString()
      }
    }
    return out
  })
}

// --- Master NYATA dibaca dari DB (bukan hard-coded) ---
const projects = await q('select id, kode, code, name, status from projects order by kode')
const vendors = await q('select id, name from vendors order by name')
const prs = await q('select id, pr_number, project_id from purchase_requests order by pr_number')
const prItems = await q('select id, pr_id, item_name, quantity, unit from pr_items order by item_name')

console.log(`Master DB uji: projects=${projects.length} vendors=${vendors.length} pr=${prs.length} pr_items=${prItems.length}`)
ok('R1 master DB uji terbaca', projects.length > 0 && vendors.length > 0, { projects: projects.length, vendors: vendors.length })

// --- Fungsi atomik harus SUDAH di-apply (dilakukan run_real_db.py) ---
const fnRow = await q(`select p.oid::regprocedure::text as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'bakpau_save_purchase_atomic'`)
eq('R2 fungsi atomik ter-apply tepat satu signature', fnRow.length, 1)
ok('R3 signature jsonb', /jsonb/.test(String(fnRow[0]?.sig || '')), fnRow[0]?.sig)

function fakeTransport({ failTimes = 0 } = {}) {
  const sent = []
  let n = 0
  return {
    sent,
    async send(target, text) {
      n++
      if (n <= failTimes) return { ok: false, error: 'simulasi telegram gagal' }
      sent.push({ target: { ...target }, text })
      return { ok: true, messageId: `m-${n}` }
    }
  }
}

async function callCreate({ body, transport = null } = {}) {
  const handler = H.createBakpauCreateHandler({
    env: ENV,
    createClient: () => client,
    loadMasters: async () => ({
      ok: true,
      masters: {
        projects, vendors, requests: prs, prItems,
        receivingItems: await q('select id, receiving_id, pr_item_id, item_name, quantity_received from receiving_items')
      }
    }),
    transport: transport || fakeTransport(),
    rateLimiter: A.createRateLimiter({ perMinute: 1000 })
  })
  const res = makeRes()
  await handler(makeReq({ body, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } }), res)
  return res
}

function payload(overrides = {}) {
  const vendorId = vendors[0].id
  const projectId = projects[0].id
  const inv = `REALPG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
  return {
    idempotencyKey: `realpg-nota-${crypto.randomBytes(4).toString('hex')}`,
    provenance: { sourceType: 'foto_nota', sourceRef: 'realpg/file-001.jpg', extractedBy: 'harness realpg' },
    purchase: {
      vendorId,
      date: '2026-10-20',
      invoiceNo: inv,
      projectId,
      biayaLain: 0,
      diskon: 0,
      statedTotal: 240000,
      items: [{ itemName: 'Triplek 9mm UJI', qty: 2, harga: 120000, unit: 'Lembar', projectId }]
    },
    ...overrides
  }
}

async function counts() {
  const [r] = await q('select count(*)::int as n from receivings')
  const [i] = await q('select count(*)::int as n from receiving_items')
  let events = -1
  try {
    const [e] = await q('select count(*)::int as n from bakpau_events')
    events = e.n
  } catch {
    events = -1
  }
  return { receivings: r.n, items: i.n, events }
}

// ============================================================
group('S. SUKSES NYATA -> SATU TRANSAKSI, baris DB benar-benar ada')
// ============================================================
let S1_PAYLOAD = null
{
  const before = await counts()
  S1_PAYLOAD = payload()
  const res = await callCreate({ body: S1_PAYLOAD })
  eq('S1 HTTP 201', res.statusCode, 201)
  eq('S2 status tercatat', res.body.status, 'tercatat')
  ok('S3 receivingId UUID', /^[0-9a-f-]{36}$/i.test(String(res.body.receivingId || '')))

  const after = await counts()
  eq('S4 tepat +1 receivings', after.receivings - before.receivings, 1)
  eq('S5 tepat +1 receiving_items', after.items - before.items, 1)
  eq('S6 ledger +2 (event+bukti)', after.events - before.events, 2)

  const rows = await q('select * from receivings where id = $1', [res.body.receivingId])
  eq('S7 header ada di DB', rows.length, 1)
  const h = rows[0]
  eq('S8 status DIBELI', String(h.status).toUpperCase(), 'DIBELI')
  eq('S9 invoice_no tersimpan', h.invoice_no, S1_PAYLOAD.purchase.invoiceNo)
  eq('S10 received_date tersimpan', String(h.received_date).slice(0, 10), '2026-10-20')
  eq('S11 vendor_id tersimpan', String(h.vendor_id), String(vendors[0].id))
  eq('S12 project_id tersimpan', String(h.project_id), String(projects[0].id))
  ok('S13 marker event BakpauEvent ada', /BakpauEvent/.test(String(h.note || '')))
  ok('S14 marker BuktiHash ada', /BuktiHash/.test(String(h.note || '')))
  ok('S15 marker Kanal bakpau-api', /\[Kanal:\s*bakpau-api\]/.test(String(h.note || '')))
  ok('S16 tidak ada purchase_request_id fiktif', h.purchase_request_id === null)

  const items = await q('select * from receiving_items where receiving_id = $1', [res.body.receivingId])
  eq('S17 satu baris item', items.length, 1)
  eq('S18 qty tersimpan', Number(items[0].quantity_received), 2)
  eq('S19 harga tersimpan di note', /120000/.test(String(items[0].note || '')), true)
  ok('S20 marker proyek per baris', new RegExp(String(projects[0].id)).test(String(items[0].note || '')))
  eq('S21 pr_item_id null (tanpa PR)', items[0].pr_item_id, null)

  // ledger benar-benar 'recorded' + menunjuk nota
  const evs = await q('select dedup_key, kind, status, receiving_id from bakpau_events order by kind')
  eq('S22 dua baris ledger', evs.length, 2)
  ok('S23 keduanya recorded', evs.every(e => e.status === 'recorded'), evs.map(e => e.status))
  ok('S24 keduanya menunjuk receiving_id yang sama', evs.every(e => String(e.receiving_id) === String(res.body.receivingId)))

  // tidak ada dokumen lain yang ikut dibuat
  const [hv] = await q('select count(*)::int as n from handovers')
  eq('S25 tidak ada handover dibuat', hv.n, 0)
  const [prc] = await q('select count(*)::int as n from purchase_requests')
  eq('S26 jumlah PR tidak berubah', prc.n, prs.length)
}

// ============================================================
group('I. IDEMPOTENSI NYATA (UNIQUE dedup_key, satu transaksi)')
// ============================================================
{
  const before = await counts()
  // Kunci + payload SAMA PERSIS dengan S1 -> duplicate event.
  const res = await callCreate({ body: S1_PAYLOAD })
  eq('I1 kunci sama -> 200', res.statusCode, 200)
  eq('I2 status ignored_duplicate_event', res.body.status, 'ignored_duplicate_event')
  const after = await counts()
  eq('I3 nol receivings baru', after.receivings, before.receivings)
  eq('I4 nol items baru', after.items, before.items)
  eq('I5 nol baris ledger baru', after.events, before.events)

  // bukti sama, kunci beda -> duplicate (BK002) DAN klaim event di-rollback.
  const dup = await callCreate({ body: { ...S1_PAYLOAD, idempotencyKey: S1_PAYLOAD.idempotencyKey + '-B' } })
  eq('I6 bukti sama kunci beda -> duplicate', dup.body.status, 'duplicate')
  const after2 = await counts()
  eq('I7 tetap nol tulisan', after2.receivings, before.receivings)
  eq('I8 klaim event percobaan gagal TIDAK tertinggal', after2.events, before.events)
  const [stray] = await q('select count(*)::int as n from bakpau_events where dedup_key = $1',
    [`evt:bakpau-api:${S1_PAYLOAD.idempotencyKey}-B`])
  eq('I9 tidak ada baris evt: yatim', stray.n, 0)
}

// ============================================================
group('R. RACE — dua create bersamaan dengan kunci sama')
// ============================================================
{
  const before = await counts()
  const body = payload({ idempotencyKey: 'realpg-race-001' })
  const [a, b] = await Promise.all([callCreate({ body }), callCreate({ body })])
  const after = await counts()
  const created = [a, b].filter(r => r.body.status === 'tercatat').length
  const ignored = [a, b].filter(r => r.body.status === 'ignored_duplicate_event').length
  eq('R4 tepat satu create menang', created, 1)
  eq('R5 yang kalah dianggap duplicate event', ignored, 1)
  eq('R6 hanya +1 receivings', after.receivings - before.receivings, 1)
  eq('R7 hanya +1 items', after.items - before.items, 1)
  eq('R8 hanya +2 ledger', after.events - before.events, 2)
}

// ============================================================
group('V. VALIDASI -> NOL TULISAN DI DB NYATA')
// ============================================================
{
  const cases = [
    ['V1 tanpa provenance', (() => { const p = payload({ idempotencyKey: 'realpg-v1' }); delete p.provenance; return p })()],
    ['V2 tanpa idempotencyKey', (() => { const p = payload(); delete p.idempotencyKey; return p })()],
    ['V3 qty hilang', (() => { const p = payload({ idempotencyKey: 'realpg-v3' }); delete p.purchase.items[0].qty; return p })()],
    ['V4 harga 0', (() => { const p = payload({ idempotencyKey: 'realpg-v4' }); p.purchase.items[0].harga = 0; return p })()],
    ['V5 tanggal non-ISO', (() => { const p = payload({ idempotencyKey: 'realpg-v5' }); p.purchase.date = '20/10/2026'; return p })()],
    ['V6 baris ambigu', (() => { const p = payload({ idempotencyKey: 'realpg-v6' }); p.purchase.items[0].ambiguous = true; p.purchase.items[0].ambiguousFields = ['qty']; return p })()],
    ['V7 total mismatch', (() => { const p = payload({ idempotencyKey: 'realpg-v7' }); p.purchase.statedTotal = 1; return p })()],
    ['V8 vendor tak dikenal', (() => { const p = payload({ idempotencyKey: 'realpg-v8' }); p.purchase.vendorId = '00000000-0000-4000-8000-000000000000'; return p })()],
  ]
  const before = await counts()
  for (const [name, body] of cases) {
    const res = await callCreate({ body })
    ok(`${name} -> 422`, res.statusCode === 422, { status: res.statusCode, code: res.body.code })
  }
  const after = await counts()
  eq('V9 nol receivings dari 8 payload invalid', after.receivings, before.receivings)
  eq('V10 nol items dari 8 payload invalid', after.items, before.items)
  eq('V11 nol baris ledger dari 8 payload invalid', after.events, before.events)
}

// ============================================================
group('N. NOTIFIKASI GAGAL -> TIDAK MENULIS ULANG')
// ============================================================
{
  const before = await counts()
  const failing = fakeTransport({ failTimes: 99 })
  const res = await callCreate({ body: payload({ idempotencyKey: 'realpg-notif-gagal' }), transport: failing })
  eq('N1 create tetap 201', res.statusCode, 201)
  eq('N2 notifikasi dilaporkan gagal', res.body.notification.sent, false)
  const after = await counts()
  eq('N3 tepat +1 nota (tidak ada tulisan ulang)', after.receivings - before.receivings, 1)
}

// ============================================================
group('L. RPC BELUM DI-APPLY -> FAIL CLOSED (0 baris)')
// ============================================================
{
  await q('alter function public.bakpau_save_purchase_atomic(jsonb) rename to bakpau_atomic_hidden')
  const before = await counts()
  const res = await callCreate({ body: payload({ idempotencyKey: 'realpg-rpc-missing' }) })
  const after = await counts()
  eq('L1 HTTP 503', res.statusCode, 503)
  eq('L2 kode atomic_rpc_unavailable', res.body.code, 'atomic_rpc_unavailable')
  eq('L3 nol receivings', after.receivings, before.receivings)
  eq('L4 nol items', after.items, before.items)
  eq('L5 nol klaim ledger', after.events, before.events)
  await q('alter function public.bakpau_atomic_hidden(jsonb) rename to bakpau_save_purchase_atomic')
}

// ============================================================
group('X. FAULT INJECTION NYATA — gagal di tengah transaksi')
// ============================================================
{
  // Trigger yang menolak SATU nama barang. Header + baris pertama sudah
  // ditulis di dalam transaksi ketika ini melempar -> PostgreSQL WAJIB
  // me-rollback header, baris, DAN klaim ledger.
  await q(`create or replace function public.__boom() returns trigger language plpgsql as $$
    begin
      if new.item_name = 'BOOM UJI' then
        raise exception 'fault injection: baris ditolak' using errcode = '23514';
      end if;
      return new;
    end $$;`)
  await q('drop trigger if exists __boom_trg on public.receiving_items')
  await q('create trigger __boom_trg before insert on public.receiving_items for each row execute function public.__boom()')

  const before = await counts()
  const body = payload({ idempotencyKey: 'realpg-fault-001' })
  body.purchase.invoiceNo = 'REALPG-FAULT-001'
  body.purchase.statedTotal = 240000
  body.purchase.items = [
    { itemName: 'Triplek 9mm UJI', qty: 1, harga: 120000, unit: 'Lembar', projectId: projects[0].id },
    { itemName: 'BOOM UJI', qty: 1, harga: 120000, unit: 'Lembar', projectId: projects[0].id }
  ]
  const res = await callCreate({ body })
  const after = await counts()

  ok('X1 create gagal (bukan 201)', res.statusCode !== 201, `status=${res.statusCode} code=${res.body.code}`)
  eq('X2 NOL header tertinggal (rollback)', after.receivings, before.receivings)
  eq('X3 NOL baris tertinggal', after.items, before.items)
  eq('X4 NOL klaim ledger tertinggal', after.events, before.events)

  // Kunci yang sama HARUS bisa dipakai lagi setelah rollback (tidak "terbakar").
  await q('drop trigger if exists __boom_trg on public.receiving_items')
  const retry = await callCreate({ body })
  eq('X5 retry setelah rollback -> 201', retry.statusCode, 201)
  const [cnt] = await q('select count(*)::int as n from receiving_items where receiving_id = $1', [retry.body.receivingId])
  eq('X6 retry menulis 2 baris', cnt.n, 2)
}

// ============================================================
group('P. PR LINK NYATA (pr_item_id benar-benar tertaut)')
// ============================================================
{
  const prItem = prItems[0]
  const pr = prs.find(p => String(p.id) === String(prItem.pr_id))
  const before = await counts()
  const body = payload({ idempotencyKey: 'realpg-pr-link' })
  body.purchase.invoiceNo = 'REALPG-PR-LINK'
  body.purchase.statedTotal = 1000
  body.purchase.projectId = pr ? pr.project_id : projects[0].id
  body.purchase.items = [{
    itemName: prItem.item_name, qty: 1, harga: 1000, unit: prItem.unit || 'Pcs',
    prNumber: pr.pr_number
  }]
  const res = await callCreate({ body })
  eq('P1 create dengan prNumber -> 201', res.statusCode, 201)
  const items = await q('select pr_item_id from receiving_items where receiving_id = $1', [res.body.receivingId])
  eq('P2 pr_item_id tertaut ke item PR nyata', String(items[0]?.pr_item_id || ''), String(prItem.id))
  const [cnt] = await q('select count(*)::int as n from receiving_items where receiving_id = $1', [res.body.receivingId])
  eq('P3 satu baris item', cnt.n, 1)
  const after = await counts()
  eq('P4 tepat +1 header (tidak memakai ulang header admin)', after.receivings - before.receivings, 1)
  const [hv] = await q('select count(*)::int as n from handovers')
  eq('P5 tidak ada handover', hv.n, 0)
}

// ============================================================
group('Q. READBACK DARI DB + LINTAS KANAL (admin vs API)')
// ============================================================
{
  const res = await callCreate({ body: payload({ idempotencyKey: 'realpg-readback' }) })
  const id = res.body.receivingId
  const [h] = await q('select invoice_no, status, note from receivings where id = $1', [id])
  const items = await q('select item_name, quantity_received, unit from receiving_items where receiving_id = $1', [id])
  eq('Q1 invoice di DB = respons', h.invoice_no, res.body.invoiceNo)
  eq('Q2 item di DB = 1', items.length, 1)
  eq('Q3 qty di DB = 2', Number(items[0].quantity_received), 2)
  eq('Q4 nama barang di DB', items[0].item_name, 'Triplek 9mm UJI')

  // Nota "dibuat admin" (jalur lama, tanpa ledger) dengan vendor+nomor sama
  // -> API HARUS menolak. Inilah idempotensi lintas kanal yang diminta review.
  const adminInv = 'REALPG-ADMIN-001'
  await q(`insert into receivings (vendor_id, invoice_no, status, received_date, note, delivery_note)
           values ($1, $2, 'DIBELI', '2026-10-19', '[Nominal: Rp 1000] [Tahap: DIBELI]', 'Nota admin')`,
    [vendors[0].id, adminInv])
  const before = await counts()
  const clash = payload({ idempotencyKey: 'realpg-admin-clash' })
  clash.purchase.invoiceNo = adminInv
  clash.purchase.statedTotal = 1000
  clash.purchase.items = [{ itemName: 'Barang', qty: 1, harga: 1000, unit: 'Pcs', projectId: projects[0].id }]
  const clashRes = await callCreate({ body: clash })
  const after = await counts()
  eq('Q5 nota admin dengan nomor sama -> 200 duplicate', clashRes.statusCode, 200)
  eq('Q6 status duplicate', clashRes.body.status, 'duplicate')
  eq('Q7 nol header baru', after.receivings, before.receivings)
  eq('Q8 nol klaim ledger tertinggal', after.events, before.events)
}

// ============================================================
group('Z. BATAS SQL LANGSUNG (fungsi menolak sendiri, bukan hanya app)')
// ============================================================
{
  // Panggil RPC langsung tanpa lapisan aplikasi: fungsi harus tetap menolak.
  const base = {
    contract_version: 1,
    event_key: 'direct-test-1',
    evidence_hash: 'b'.repeat(64),
    channel: 'direct',
    idempotency_key: 'direct-test-1',
    header: {
      vendor_id: vendors[0].id, invoice_no: 'DIRECT-1', received_date: '2026-10-20',
      note: 'x', status: 'DIBELI', material: 1000, biaya_lain: 0, diskon: 0, total: 1000
    },
    items: [{ item_name: 'X', unit: 'Pcs', quantity_received: 1, subtotal: 1000, note: '[Harga: 1000]' }]
  }
  const before = await counts()

  const noPrice = await client.rpc('bakpau_save_purchase_atomic', { p_payload: { ...base, items: [{ ...base.items[0], note: null }] } })
  eq('Z1 baris tanpa penanda harga ditolak', noPrice.data?.code, 'invalid_payload')

  const badTotal = await client.rpc('bakpau_save_purchase_atomic', { p_payload: { ...base, header: { ...base.header, total: 999 } } })
  eq('Z2 total tidak konsisten ditolak', badTotal.data?.code, 'invalid_payload')

  const badSum = await client.rpc('bakpau_save_purchase_atomic', { p_payload: { ...base, items: [{ ...base.items[0], subtotal: 500 }] } })
  eq('Z3 subtotal tidak sama material ditolak', badSum.data?.code, 'invalid_payload')

  const zeroQty = await client.rpc('bakpau_save_purchase_atomic', { p_payload: { ...base, items: [{ ...base.items[0], quantity_received: 0 }] } })
  eq('Z4 qty 0 ditolak', zeroQty.data?.code, 'invalid_payload')

  const badContract = await client.rpc('bakpau_save_purchase_atomic', { p_payload: { ...base, contract_version: 9 } })
  eq('Z5 contract_version asing ditolak', badContract.data?.code, 'invalid_payload')

  const after = await counts()
  eq('Z6 nol tulisan dari 5 panggilan RPC langsung yang ditolak', after.receivings, before.receivings)
  eq('Z7 nol klaim ledger dari panggilan ditolak', after.events, before.events)

  // Panggilan sah langsung -> sukses, satu transaksi.
  const good = await client.rpc('bakpau_save_purchase_atomic', {
    p_payload: {
      ...base,
      event_key: 'direct-ok-1',
      evidence_hash: 'c'.repeat(64),
      header: { ...base.header, invoice_no: 'DIRECT-OK' }
    }
  })
  eq('Z8 panggilan sah langsung -> ok', good.data?.ok, true)
  const after2 = await counts()
  eq('Z9 +1 header', after2.receivings - after.receivings, 1)
  eq('Z10 +2 ledger', after2.events - after.events, 2)
}

// ============================================================
group('Y. HAK AKSES FUNGSI (anon/authenticated tidak boleh EXECUTE)')
// ============================================================
{
  const acl = await q(`select has_function_privilege('anon', 'public.bakpau_save_purchase_atomic(jsonb)', 'EXECUTE') as anon_ok,
                              has_function_privilege('authenticated', 'public.bakpau_save_purchase_atomic(jsonb)', 'EXECUTE') as auth_ok,
                              has_function_privilege('service_role', 'public.bakpau_save_purchase_atomic(jsonb)', 'EXECUTE') as svc_ok`)
  eq('Y1 anon TIDAK boleh execute', acl[0].anon_ok, false)
  eq('Y2 authenticated TIDAK boleh execute', acl[0].auth_ok, false)
  eq('Y3 service_role boleh execute', acl[0].svc_ok, true)
}

await client.__end()

console.log(`\n=== RINGKASAN REAL-DB ===`)
console.log(`PASS: ${pass}  FAIL: ${fail}`)
if (failures.length) {
  for (const f of failures) console.log(` - ${f.name}: ${JSON.stringify(f.detail)}`)
  process.exit(1)
}
console.log('SEMUA TES CREATE API TERHADAP POSTGRES NYATA HIJAU')
