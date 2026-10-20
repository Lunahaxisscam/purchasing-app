// ============================================================
// api_test.mjs — HARNESS API BAKPAU (handler ASLI, tanpa server)
// ============================================================
// Memanggil createBakpauReadHandler / createBakpauCreateHandler dengan req/res
// tiruan. Membuktikan:
//   * auth ditolak SEBELUM satu pun query DB (dihitung dari mock.calls)
//   * scope ditegakkan server-side (bukan label nama token)
//   * read hanya resource/kolom/filter daftar putih + pagination nyata
//   * create: payload invalid/ambigu -> 0 tulisan; valid -> 1 nota + readback
//   * duplikat event/bukti -> tidak ada tulisan kedua
//   * notifikasi gagal -> pembelian TIDAK ditulis ulang
//   * tidak ada token/key/SQL/stack di respons
// ============================================================

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const load = rel => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const H = await load('lib/bakpau/apiHandler.mjs')
const A = await load('lib/bakpau/apiAuth.mjs')
const R = await load('lib/bakpau/apiRead.mjs')
const C = await load('lib/bakpau/apiCreate.mjs')
const L = await load('lib/bakpau/ledger.mjs')
const mock = await load('lib/supabaseClient.mjs')
const F = await import(pathToFileURL(path.join(SB, 'api_fixtures.mjs')).href)

let pass = 0, fail = 0
const failures = []
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}
function group(t) { console.log(`\n=== ${t} ===`) }

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
}
function makeReq({ method = 'POST', body = {}, headers = {}, raw = null } = {}) {
  return { method, headers, body: raw !== null ? raw : body, query: {} }
}

function tables() {
  return {
    projects: F.PROJECTS.map(p => ({ ...p })),
    materials: F.MATERIALS.map(m => ({ ...m })),
    vendors: F.VENDORS.map(v => ({ ...v })),
    purchase_requests: F.REQUESTS.map(r => ({ ...r })),
    pr_items: F.PR_ITEMS.map(i => ({ ...i })),
    receiving_items: F.RECEIVING_ITEMS_SEED.map(i => ({ ...i })),
    receivings: [],
    handovers: [],
    bakpau_events: []
  }
}

// Hitung query DB nyata (select/insert/update/delete/rpc) — dipakai untuk
// membuktikan "nol aktivitas DB" pada permintaan yang ditolak.
function dbCalls() {
  return mock.__state.calls.filter(c => ['select', 'insert', 'update', 'delete', 'rpc'].includes(c.op))
}

function fakeTransport({ failTimes = 0 } = {}) {
  const sent = []
  let n = 0
  return {
    sent,
    async send(target, text) {
      n++
      if (n <= failTimes) return { ok: false, error: 'simulasi: telegram gagal' }
      sent.push({ target: { ...target }, text })
      return { ok: true, messageId: `m-${n}` }
    }
  }
}

async function callRead({ body, headers = F.authHeaders(), env = F.ENV, client = mock.supabase } = {}) {
  const handler = H.createBakpauReadHandler({
    env,
    createReadClient: () => client,
    rateLimiter: A.createRateLimiter({ perMinute: 1000 })
  })
  const res = makeRes()
  await handler(makeReq({ body, headers }), res)
  return res
}

async function callCreate({ body, headers = F.authHeaders(), env = F.ENV, client = mock.supabase, transport = null, ledger = null, useDbLedger = false } = {}) {
  const handler = H.createBakpauCreateHandler({
    env,
    createClient: () => client,
    loadMasters: async () => ({ ok: true, masters: F.MASTERS }),
    // `useDbLedger` sengaja TIDAK menyuntikkan ledger supaya handler memakai
    // createDbLedger asli (yang fail closed bila tabel ledger tidak ada).
    ...(useDbLedger ? {} : { ledger: ledger || L.createMemoryLedger() }),
    transport: transport || fakeTransport(),
    rateLimiter: A.createRateLimiter({ perMinute: 1000 })
  })
  const res = makeRes()
  await handler(makeReq({ body, headers }), res)
  return res
}

// ============================================================
group('A. KONFIGURASI TOKEN (fail closed)')
// ============================================================
{
  const empty = A.parseTokenConfig({})
  eq('A1 env kosong -> configured=false', empty.configured, false)

  const junk = A.parseTokenConfig({ BAKPAU_API_TOKENS: 'bukanformat' })
  eq('A2 entri rusak -> configured=false', junk.configured, false)

  const badScope = A.parseTokenConfig({ BAKPAU_API_TOKENS: `${F.TEST_KEY_ID}:${F.TEST_HASH}:purchasing:admin` })
  eq('A3 scope liar -> ditolak', badScope.configured, false)

  const badHash = A.parseTokenConfig({ BAKPAU_API_TOKENS: `${F.TEST_KEY_ID}:deadbeef:purchasing:read` })
  eq('A4 hash bukan sha256 -> ditolak', badHash.configured, false)

  const good = A.parseTokenConfig({ BAKPAU_API_TOKENS: F.ENV.BAKPAU_API_TOKENS })
  eq('A5 konfigurasi sah -> 2 kunci', good.entries.size, 2)
  eq('A6 scope kunci utama', good.entries.get(F.TEST_KEY_ID).scopes, ['purchasing:read', 'purchasing:create'])
  eq('A7 scope kunci read-only', good.entries.get(F.TEST_KEY_ID_RO).scopes, ['purchasing:read'])

  // Duplikat keyId harus ditolak (mencegah "kunci kedua menimpa").
  const dup = A.parseTokenConfig({
    BAKPAU_API_TOKENS: `${F.TEST_KEY_ID}:${F.TEST_HASH}:purchasing:read,${F.TEST_KEY_ID}:${F.TEST_HASH}:purchasing:create`
  })
  eq('A8 keyId ganda -> entri kedua dibuang', dup.entries.get(F.TEST_KEY_ID).scopes, ['purchasing:read'])
}

// ============================================================
group('B. AUTENTIKASI & SCOPE — DITOLAK SEBELUM DB')
// ============================================================
{
  // Tanpa env token sama sekali.
  mock.__reset({ tables: tables() })
  const noCfg = await callRead({ body: { resource: 'masters/projects' }, env: {} })
  eq('B1 env token kosong -> 503', noCfg.statusCode, 503)
  eq('B2 kode api_not_configured', noCfg.body.code, 'api_not_configured')
  eq('B3 nol query DB saat belum dikonfigurasi', dbCalls().length, 0)

  // Tanpa header.
  mock.__reset({ tables: tables() })
  const noAuth = await callRead({ body: { resource: 'masters/projects' }, headers: {} })
  eq('B4 tanpa Authorization -> 401', noAuth.statusCode, 401)
  eq('B5 kode missing_token', noAuth.body.code, 'missing_token')
  eq('B6 nol query DB tanpa token', dbCalls().length, 0)

  // Token salah (secret beda, keyId sah).
  mock.__reset({ tables: tables() })
  const wrong = await callRead({
    body: { resource: 'masters/projects' },
    headers: F.authHeaders(`bpk.${F.TEST_KEY_ID}.${'x'.repeat(43)}`)
  })
  eq('B7 secret salah -> 401', wrong.statusCode, 401)
  eq('B8 kode invalid_token', wrong.body.code, 'invalid_token')
  eq('B9 nol query DB saat token salah', dbCalls().length, 0)

  // keyId tidak dikenal.
  mock.__reset({ tables: tables() })
  const unknownKey = await callRead({
    body: { resource: 'masters/projects' },
    headers: F.authHeaders(`bpk.tidakada1.${'y'.repeat(43)}`)
  })
  eq('B10 keyId tak dikenal -> 401', unknownKey.statusCode, 401)
  eq('B11 nol query DB', dbCalls().length, 0)

  // Format salah.
  mock.__reset({ tables: tables() })
  const badFmt = await callRead({ body: { resource: 'masters/projects' }, headers: { authorization: 'Basic abc' } })
  eq('B12 format Authorization salah -> 401', badFmt.statusCode, 401)
  eq('B13 kode malformed_token', badFmt.body.code, 'malformed_token')

  // Token dicabut.
  mock.__reset({ tables: tables() })
  const revoked = await callRead({
    body: { resource: 'masters/projects' },
    env: { ...F.ENV, BAKPAU_API_REVOKED: F.TEST_KEY_ID }
  })
  eq('B14 token dicabut -> 401', revoked.statusCode, 401)
  eq('B15 kode token_revoked', revoked.body.code, 'token_revoked')
  eq('B16 nol query DB saat token dicabut', dbCalls().length, 0)

  // Token read-only mencoba create -> 403 SEBELUM DB.
  mock.__reset({ tables: tables() })
  const noScope = await callCreate({
    body: F.validCreatePayload(),
    headers: F.authHeaders(F.TEST_TOKEN_RO)
  })
  eq('B17 scope kurang -> 403', noScope.statusCode, 403)
  eq('B18 kode insufficient_scope', noScope.body.code, 'insufficient_scope')
  eq('B19 nol query DB saat scope kurang', dbCalls().length, 0)

  // Metode selain POST.
  mock.__reset({ tables: tables() })
  const handler = H.createBakpauReadHandler({ env: F.ENV, createReadClient: () => mock.supabase, rateLimiter: A.createRateLimiter({ perMinute: 1000 }) })
  const res = makeRes()
  await handler(makeReq({ method: 'GET', headers: F.authHeaders() }), res)
  eq('B20 GET -> 405', res.statusCode, 405)
  eq('B21 nol query DB pada GET', dbCalls().length, 0)

  // Body terlalu besar.
  mock.__reset({ tables: tables() })
  const huge = await callRead({ body: { resource: 'masters/projects', pad: 'x'.repeat(300 * 1024) } })
  eq('B22 body > batas -> 413', huge.statusCode, 413)
  eq('B23 nol query DB saat body besar', dbCalls().length, 0)

  // Rate limit.
  mock.__reset({ tables: tables() })
  const tight = A.createRateLimiter({ perMinute: 1, now: () => 1000 })
  const h2 = H.createBakpauReadHandler({ env: F.ENV, createReadClient: () => mock.supabase, rateLimiter: tight })
  const r1 = makeRes(); await h2(makeReq({ body: { resource: 'masters/projects' }, headers: F.authHeaders() }), r1)
  const r2 = makeRes(); await h2(makeReq({ body: { resource: 'masters/projects' }, headers: F.authHeaders() }), r2)
  eq('B24 permintaan pertama lolos', r1.statusCode, 200)
  eq('B25 permintaan kedua kena rate limit -> 429', r2.statusCode, 429)
  ok('B26 header Retry-After ada', !!r2.headers['retry-after'])
}

// ============================================================
group('C. READ — DAFTAR PUTIH, PAGINATION, TANPA SQL')
// ============================================================
{
  mock.__reset({ tables: tables() })
  const projects = await callRead({ body: { resource: 'masters/projects' } })
  eq('C1 baca projects -> 200', projects.statusCode, 200)
  eq('C2 jumlah baris', projects.body.data.length, 2)
  eq('C3 kolom dikembalikan sesuai daftar putih', Object.keys(projects.body.data[0]).sort(),
    ['code', 'created_at', 'id', 'kode', 'name', 'status'].filter(k => k in projects.body.data[0]).sort())
  ok('C4 tidak ada kolom di luar daftar putih', !('_synthetic' in projects.body.data[0]))

  // Filter literal: 'A-12' TIDAK boleh cocok ke 'A12'.
  mock.__reset({ tables: tables() })
  const v = await callRead({ body: { resource: 'masters/vendors', query: { name: 'SINTETIS Toko A-12' } } })
  eq('C5 filter nama literal -> 1 baris', v.body.data.length, 1)
  eq('C6 yang cocok benar A-12', v.body.data[0].name, 'SINTETIS Toko A-12')

  // Wildcard di nilai filter harus diperlakukan sebagai teks, bukan pola.
  mock.__reset({ tables: tables() })
  const wild = await callRead({ body: { resource: 'masters/vendors', query: { name: '%' } } })
  eq('C7 "%" tidak menjadi wildcard -> 0 baris', wild.body.data.length, 0)

  // Pagination.
  mock.__reset({ tables: tables() })
  const p1 = await callRead({ body: { resource: 'masters/materials', query: { limit: 1, offset: 0 } } })
  eq('C8 limit dihormati', p1.body.data.length, 1)
  eq('C9 total dilaporkan', p1.body.page.total, 1)
  eq('C10 offset dilaporkan', p1.body.page.offset, 0)

  // limit di atas batas dipotong (bukan error, tapi tidak boleh > MAX).
  mock.__reset({ tables: tables() })
  const big = await callRead({ body: { resource: 'masters/projects', query: { limit: 99999 } } })
  eq('C11 limit dipotong ke MAX_PAGE_SIZE', big.body.page.limit, A.API_LIMITS.MAX_PAGE_SIZE)

  // Parameter asing -> 400 (bukan diabaikan diam-diam).
  mock.__reset({ tables: tables() })
  const foreign = await callRead({ body: { resource: 'masters/projects', query: { sql: 'select * from users' } } })
  eq('C12 parameter asing -> 400', foreign.statusCode, 400)
  eq('C13 kode unknown_parameter', foreign.body.code, 'unknown_parameter')
  eq('C14 nol query DB saat parameter asing', dbCalls().length, 0)

  // Resource sensitif / tidak ada -> 400.
  for (const bad of ['users', 'profiles', 'private_secrets', 'invoices', 'purchase_payments', 'bakpau_events']) {
    mock.__reset({ tables: tables() })
    const r = await callRead({ body: { resource: bad } })
    ok(`C15.${bad} resource terlarang ditolak`, r.statusCode === 400 && r.body.code === 'unknown_resource')
  }

  // Order hanya kolom daftar putih.
  mock.__reset({ tables: tables() })
  const badOrder = await callRead({ body: { resource: 'masters/projects', query: { order: 'password.desc' } } })
  eq('C16 order kolom asing -> 400', badOrder.statusCode, 400)

  // Order sah.
  mock.__reset({ tables: tables() })
  const order = await callRead({ body: { resource: 'masters/projects', query: { order: 'kode.desc' } } })
  eq('C17 order sah diterima', order.statusCode, 200)
  eq('C18 urutan menurun', order.body.data.map(r => r.kode), ['83', '101'])

  // Resource purchases + physical-status bisa dibaca.
  mock.__reset({ tables: tables() })
  for (const res of ['purchase-requests', 'purchase-request-items', 'purchases', 'purchase-items', 'physical-status', 'masters/vendors', 'masters/materials']) {
    const r = await callRead({ body: { resource: res } })
    ok(`C19.${res} dapat dibaca`, r.statusCode === 200 && r.body.ok === true, `status=${r.statusCode}`)
  }

  // Token read-only BOLEH baca.
  mock.__reset({ tables: tables() })
  const ro = await callRead({ body: { resource: 'masters/projects' }, headers: F.authHeaders(F.TEST_TOKEN_RO) })
  eq('C20 token read-only boleh baca', ro.statusCode, 200)

  // Tanpa kredensial server (token sah, tapi service key tidak ada) -> 503,
  // bukan 200 kosong.
  mock.__reset({ tables: tables() })
  const noSvc = await callRead({ body: { resource: 'masters/projects' }, client: null })
  eq('C21 tanpa klien server -> 503', noSvc.statusCode, 503)
}

// ============================================================
group('D. CREATE — VALIDASI SEBELUM DB')
// ============================================================
{
  // Payload tanpa provenance.
  mock.__reset({ tables: tables() })
  const noProv = F.validCreatePayload()
  delete noProv.provenance
  const r1 = await callCreate({ body: noProv })
  eq('D1 tanpa provenance -> 422', r1.statusCode, 422)
  eq('D2 nol query DB', dbCalls().length, 0)

  // Tanpa idempotencyKey.
  mock.__reset({ tables: tables() })
  const noIdem = F.validCreatePayload()
  delete noIdem.idempotencyKey
  const r2 = await callCreate({ body: noIdem })
  eq('D3 tanpa idempotencyKey -> 422', r2.statusCode, 422)
  eq('D4 nol query DB', dbCalls().length, 0)

  // Qty tidak ada (jangan default 1).
  mock.__reset({ tables: tables() })
  const noQty = F.validCreatePayload()
  delete noQty.purchase.items[0].qty
  const r3 = await callCreate({ body: noQty })
  eq('D5 qty hilang -> 422', r3.statusCode, 422)
  ok('D6 alasan menyebut qty', JSON.stringify(r3.body.problems).includes('qty'))
  eq('D7 nol query DB', dbCalls().length, 0)

  // Harga 0.
  mock.__reset({ tables: tables() })
  const zero = F.validCreatePayload()
  zero.purchase.items[0].harga = 0
  const r4 = await callCreate({ body: zero })
  eq('D8 harga 0 -> 422', r4.statusCode, 422)
  eq('D9 nol query DB', dbCalls().length, 0)

  // Tanggal bukan ISO.
  mock.__reset({ tables: tables() })
  const badDate = F.validCreatePayload()
  badDate.purchase.date = '20/10/2026'
  const r5 = await callCreate({ body: badDate })
  eq('D10 tanggal non-ISO -> 422', r5.statusCode, 422)

  // Baris ambigu -> 422 dengan kode ambiguous_extraction.
  mock.__reset({ tables: tables() })
  const amb = F.validCreatePayload()
  amb.purchase.items[0].ambiguous = true
  amb.purchase.items[0].ambiguousFields = ['qty', 'harga']
  const r6 = await callCreate({ body: amb })
  eq('D11 baris ambigu -> 422', r6.statusCode, 422)
  eq('D12 kode ambiguous_extraction', r6.body.code, 'ambiguous_extraction')
  eq('D13 nol query DB', dbCalls().length, 0)

  // Total tertulis tidak cocok rincian -> 422 (bukan menebak).
  mock.__reset({ tables: tables() })
  const mismatch = F.validCreatePayload()
  mismatch.purchase.statedTotal = 999999
  const r7 = await callCreate({ body: mismatch })
  eq('D14 total mismatch -> 422', r7.statusCode, 422)

  // Vendor tidak dikenal -> 422 unknown_reference, nol tulisan.
  mock.__reset({ tables: tables() })
  const unknownVendor = F.validCreatePayload()
  unknownVendor.purchase.vendorId = '00000000-0000-4000-8000-000000000000'
  delete unknownVendor.purchase.vendorName
  const r8 = await callCreate({ body: unknownVendor })
  eq('D15 vendor tak dikenal -> 422', r8.statusCode, 422)
  eq('D16 kode unknown_reference', r8.body.code, 'unknown_reference')
  eq('D17 nol insert', mock.__callsOf('insert', 'receivings').length, 0)

  // Proyek tidak dikenal.
  mock.__reset({ tables: tables() })
  const unknownProject = F.validCreatePayload()
  unknownProject.purchase.items[0].projectId = '00000000-0000-4000-8000-000000000001'
  const r9 = await callCreate({ body: unknownProject })
  eq('D18 proyek tak dikenal -> 422', r9.statusCode, 422)

  // > 80 baris.
  mock.__reset({ tables: tables() })
  const tooMany = F.validCreatePayload()
  tooMany.purchase.items = Array.from({ length: 81 }, () => ({ itemName: 'X', qty: 1, harga: 1000 }))
  const r10 = await callCreate({ body: tooMany })
  eq('D19 >80 baris -> 422', r10.statusCode, 422)
}

// ============================================================
group('E. CREATE — SUKSES, READBACK, IDEMPOTENSI, NOTIFIKASI')
// ============================================================
{
  // E1 sukses: satu nota + readback exact + notifikasi terkirim.
  mock.__reset({ tables: tables() })
  const tr = fakeTransport()
  const led = L.createMemoryLedger()
  const okRes = await callCreate({ body: F.validCreatePayload(), transport: tr, ledger: led })
  eq('E1 create sah -> 201', okRes.statusCode, 201)
  eq('E2 status tercatat', okRes.body.status, 'tercatat')
  ok('E3 receivingId dikembalikan', !!okRes.body.receivingId)
  eq('E4 tepat satu header nota', mock.__callsOf('insert', 'receivings').length, 1)
  eq('E5 readback ok', okRes.body.readback.ok, true)
  eq('E6 notifikasi terkirim ke DAT', tr.sent.length, 1)
  eq('E7 tujuan notifikasi chatId DAT', tr.sent[0].target.chatId, '1320969465')
  eq('E8 tujuan bukan WhatsApp', tr.sent[0].target.platform, 'telegram')
  ok('E9 teks notifikasi tidak memuat token', !tr.sent[0].text.includes(F.TEST_SECRET))

  // E10 idempotencyKey sama -> tidak ada tulisan kedua.
  const before = mock.__callsOf('insert', 'receivings').length
  const again = await callCreate({ body: F.validCreatePayload(), transport: tr, ledger: led })
  eq('E10 kunci sama -> 200 ignored', again.statusCode, 200)
  eq('E11 status ignored_duplicate_event', again.body.status, 'ignored_duplicate_event')
  eq('E12 tidak ada insert kedua', mock.__callsOf('insert', 'receivings').length, before)
  eq('E13 tidak ada notifikasi kedua', tr.sent.length, 1)

  // E14 kunci BEDA tapi bukti sama -> duplicate (lintas "kanal"/waktu).
  const before2 = mock.__callsOf('insert', 'receivings').length
  const otherKey = F.validCreatePayload({ idempotencyKey: 'sintetis-nota-0001-retry-baru' })
  const dupEv = await callCreate({ body: otherKey, transport: tr, ledger: led })
  eq('E14 bukti sama kunci beda -> duplicate', dupEv.body.status, 'duplicate')
  eq('E15 tidak ada insert ketiga', mock.__callsOf('insert', 'receivings').length, before2)

  // E16 notifikasi gagal: pembelian TIDAK ditulis ulang.
  mock.__reset({ tables: tables() })
  const failing = fakeTransport({ failTimes: 99 })
  const r16 = await callCreate({ body: F.validCreatePayload(), transport: failing, ledger: L.createMemoryLedger() })
  eq('E16 create tetap 201 walau notifikasi gagal', r16.statusCode, 201)
  eq('E17 notifikasi tercatat gagal', r16.body.notification.sent, false)
  eq('E18 hanya satu insert nota', mock.__callsOf('insert', 'receivings').length, 1)

  // E19 ledger tidak tersedia (tabel hilang) -> fail closed, nol tulisan.
  mock.__reset({ tables: tables(), missingTables: ['bakpau_events'] })
  const r19 = await callCreate({ body: F.validCreatePayload(), transport: fakeTransport(), useDbLedger: true })
  eq('E19 ledger hilang -> 503', r19.statusCode, 503)
  eq('E20 kode ledger_unavailable', r19.body.code, 'ledger_unavailable')
  eq('E21 nol insert nota', mock.__callsOf('insert', 'receivings').length, 0)

  // E22 readback mismatch -> bukan 201, status tidak 'tercatat'.
  mock.__reset({ tables: tables(), corruptOnRead: { table: 'receiving_items', patch: { quantity_received: 999 } } })
  const r22 = await callCreate({ body: F.validCreatePayload(), transport: fakeTransport() })
  ok('E22 readback mismatch tidak 201', r22.statusCode !== 201, `status=${r22.statusCode}`)
  ok('E23 status bukan tercatat', r22.body.status !== 'tercatat')

  // E24 nota tanpa nomor vendor -> ref internal (bukan nomor karangan).
  mock.__reset({ tables: tables() })
  const noInv = F.validCreatePayload({ idempotencyKey: 'sintetis-tanpa-nomor' })
  noInv.purchase.invoiceNo = ''
  const r24 = await callCreate({ body: noInv, transport: fakeTransport() })
  eq('E24 tanpa nomor nota -> 201', r24.statusCode, 201)
  eq('E25 ditandai ref internal', r24.body.isInternalRef, true)
  ok('E26 ref internal berprefix BK-', String(r24.body.invoiceNo).startsWith('BK-'))

  // E27 tautan PR: prNumber + nama barang cocok -> pr_item_id tertaut.
  mock.__reset({ tables: tables() })
  const withPr = F.validCreatePayload({ idempotencyKey: 'sintetis-dengan-pr' })
  withPr.purchase.invoiceNo = 'SINT-NOTA-PR'
  withPr.purchase.items[0] = {
    itemName: 'SINTETIS Triplek 9mm', qty: 2, harga: 120000, unit: 'Lembar',
    prNumber: 'PR-2026-0001'
  }
  const r27 = await callCreate({ body: withPr, transport: fakeTransport() })
  eq('E27 dengan prNumber -> 201', r27.statusCode, 201)
  const itemInserts = mock.__callsOf('insert', 'receiving_items')
  const flat = itemInserts.flatMap(c => Array.isArray(c.data) ? c.data : [c.data])
  ok('E28 pr_item_id tertaut dari nomor PR', flat.some(d => String(d.pr_item_id || '') === F.PR_ITEMS[0].id))

  // E29 tidak ada PR fiktif / approval_steps / handover.
  eq('E29 tidak ada insert purchase_requests', mock.__callsOf('insert', 'purchase_requests').length, 0)
  eq('E30 tidak ada insert handovers', mock.__callsOf('insert', 'handovers').length, 0)
  eq('E31 tidak ada delete', mock.__state.calls.filter(c => c.op === 'delete' && c.table !== 'bakpau_events').length, 0)
}

function r20code(res) { return res.body?.code }

// ============================================================
group('F. TIDAK ADA KEBOCORAN DI RESPONS')
// ============================================================
{
  mock.__reset({ tables: tables() })
  const okRes = await callCreate({ body: F.validCreatePayload(), transport: fakeTransport() })
  const json = JSON.stringify(okRes.body)
  ok('F1 respons tanpa token uji', !json.includes(F.TEST_SECRET))
  ok('F2 respons tanpa hash token', !json.includes(F.TEST_HASH))
  ok('F3 respons tanpa kata service_role', !/service_role/i.test(json))
  ok('F4 respons tanpa stack trace', !/\bat\s+\w+\s+\(/.test(json))
  ok('F5 respons tanpa SQL mentah', !/select\s+\*\s+from/i.test(json))

  mock.__reset({ tables: tables() })
  const authFail = await callRead({ body: { resource: 'masters/projects' }, headers: {} })
  ok('F6 respons auth gagal tanpa petunjuk internal', !/postgres|supabase|relation/i.test(JSON.stringify(authFail.body)))

  // Header keamanan dasar.
  ok('F7 Cache-Control no-store', String(authFail.headers['cache-control'] || '').includes('no-store'))
  ok('F8 X-Content-Type-Options nosniff', authFail.headers['x-content-type-options'] === 'nosniff')
}

// ============================================================
group('G. CLIENT RUNNABLE — KONTRAK DASAR')
// ============================================================
{
  // Client diuji sebagai modul (tanpa jaringan): konfigurasi & daftar putih.
  const clientPath = path.join(SB, 'client.mjs')
  const { loadConfig, RESOURCES, COMMANDS } = await import(pathToFileURL(clientPath).href)

  const goodEnv = { BAKPAU_API_BASE_URL: 'https://example.test', BAKPAU_API_TOKEN: F.TEST_TOKEN }
  const cfg = loadConfig(goodEnv)
  eq('G1 base URL https diterima', cfg.baseUrl, 'https://example.test')
  eq('G2 keyId terbaca', cfg.keyId, F.TEST_KEY_ID)
  ok('G3 fingerprint bukan token', cfg.tokenFingerprint !== F.TEST_TOKEN && cfg.tokenFingerprint.length === 12)

  let threw = false
  try { loadConfig({ ...goodEnv, BAKPAU_API_BASE_URL: 'http://example.test' }) } catch { threw = true }
  ok('G4 http:// ditolak', threw)

  threw = false
  try { loadConfig({ ...goodEnv, BAKPAU_API_BASE_URL: 'https://user:pass@example.test' }) } catch { threw = true }
  ok('G5 kredensial di URL ditolak', threw)

  threw = false
  try { loadConfig({ ...goodEnv, BAKPAU_API_TOKEN: 'bukan-token' }) } catch { threw = true }
  ok('G6 token bukan format bpk ditolak', threw)

  ok('G7 perintah whitelist', COMMANDS.join(',') === 'read,create,doctor')
  ok('G8 tidak ada perintah SQL/query bebas', !COMMANDS.includes('sql') && !COMMANDS.includes('query'))
  ok('G9 resource whitelist lengkap', RESOURCES.length === 8)
}
// E20 butuh r19; dideklarasikan di atas lewat fungsi agar urutan aman.

// ============================================================
console.log(`\n=== RINGKASAN ===`)
console.log(`PASS: ${pass}  FAIL: ${fail}`)
if (failures.length) {
  for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`)
  process.exit(1)
}
console.log('SEMUA TES API BAKPAU HIJAU')
