// ============================================================
// api_test.mjs — HARNESS API BAKPAU (handler ASLI, tanpa server)
// ============================================================
// Memanggil createBakpauReadHandler / createBakpauCreateHandler dengan req/res
// tiruan. Membuktikan:
//   * auth ditolak SEBELUM satu pun query DB (dihitung dari mock.calls)
//   * scope ditegakkan server-side (bukan label nama token)
//   * kredensial BACA tidak pernah jatuh ke service role (fail closed)
//   * read hanya resource/kolom/filter daftar putih + pagination nyata
//   * create: payload invalid/ambigu -> 0 tulisan; valid -> 1 nota + readback
//   * create memakai SATU RPC transaksional (bukan tulisan multipart)
//   * duplikat event/bukti/nota lintas kanal -> tidak ada tulisan kedua
//   * notifikasi gagal -> pembelian TIDAK ditulis ulang
//   * tidak ada token/key/SQL/stack di respons
//
// Regresi review Brooklyn (2026-10-21) ada di group C22-C30 (kredensial baca)
// dan group H (batas transaksi atomik).
// ============================================================

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const load = rel => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const H = await load('lib/bakpau/apiHandler.mjs')
const A = await load('lib/bakpau/apiAuth.mjs')
const R = await load('lib/bakpau/apiRead.mjs')
const C = await load('lib/bakpau/apiCreate.mjs')
const AP = await load('lib/bakpau/atomicPurchase.mjs')
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
function rowsOf(table) { return mock.__rows(table) }
function atomicCalls() { return mock.__state.calls.filter(c => c.op === 'rpc' && c.fn === 'bakpau_save_purchase_atomic') }
function directWrites() {
  return mock.__state.calls.filter(c => ['insert', 'update', 'delete'].includes(c.op))
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

async function callRead({ body, headers = F.authHeaders(), env = F.ENV, client = mock.supabase, useRealCred = false } = {}) {
  const handler = H.createBakpauReadHandler({
    env,
    ...(useRealCred ? {} : { createReadClient: () => client }),
    rateLimiter: A.createRateLimiter({ perMinute: 1000 })
  })
  const res = makeRes()
  await handler(makeReq({ body, headers }), res)
  return res
}

async function callCreate({ body, headers = F.authHeaders(), env = F.ENV, client = mock.supabase, transport = null } = {}) {
  const handler = H.createBakpauCreateHandler({
    env,
    createClient: () => client,
    loadMasters: async () => ({ ok: true, masters: F.MASTERS }),
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

  // --- Klasifikasi kredensial BACA (regresi review Brooklyn) ---
  const svcJwt = `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.y`
  const anonJwt = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.y`
  eq('A9 kunci service_role JWT ditolak', A.classifyReadKey(svcJwt).ok, false)
  eq('A10 alasan privileged', A.classifyReadKey(svcJwt).reason, 'read_credential_privileged')
  eq('A11 kunci sb_secret_ ditolak', A.classifyReadKey('sb_secret_abc').ok, false)
  eq('A12 kunci anon JWT diterima', A.classifyReadKey(anonJwt).ok, true)
  eq('A13 kunci publishable diterima', A.classifyReadKey('sb_publishable_abc').ok, true)
  eq('A14 kunci kosong ditolak', A.classifyReadKey('').ok, false)
  ok('A15 service role TIDAK ada di rantai kunci baca', !A.READ_KEY_CHAIN.includes('SUPABASE_SERVICE_ROLE_KEY'))
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

  // CREATE tanpa token -> 401 SEBELUM DB (termasuk sebelum loadMasters).
  mock.__reset({ tables: tables() })
  const createNoAuth = await callCreate({ body: F.validCreatePayload(), headers: {} })
  eq('B27 create tanpa token -> 401', createNoAuth.statusCode, 401)
  eq('B28 nol query DB pada create tanpa token', dbCalls().length, 0)
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

  // ---- REGRESI (ditemukan lewat probe LIVE 3001, bukan mock) ----
  // PostgREST menerjemahkan `*` menjadi `%` di dalam ilike; escape backslash
  // tidak menolong. Tanpa penolakan, `kode: "*"` mengembalikan SELURUH tabel
  // (live: 344 baris) sehingga jaminan "filter literal" hilang.
  for (const pat of ['*', 'A*', 'ALM*0001', '**']) {
    mock.__reset({ tables: tables() })
    const star = await callRead({ body: { resource: 'masters/materials', query: { kode: pat } } })
    eq(`C20a pola "*" ditolak (${pat})`, star.statusCode, 400)
    eq(`C20b kode bad_query (${pat})`, star.body.code, 'bad_query')
    eq(`C20c nol query DB saat pola ditolak (${pat})`, dbCalls().length, 0)
  }

  // Filter kolom ID non-UUID harus 400 (bukan 502 internal_error seperti di
  // live sebelum perbaikan) dan tanpa query DB.
  for (const [res, q] of [
    ['masters/materials', { id: 'not-a-uuid' }],
    ['purchase-requests', { project_id: 'abc' }],
    ['purchases', { vendor_id: 'SINTETIS' }]
  ]) {
    mock.__reset({ tables: tables() })
    const badId = await callRead({ body: { resource: res, query: q } })
    eq(`C21a filter id non-UUID -> 400 (${res})`, badId.statusCode, 400)
    eq(`C21b kode bad_query (${res})`, badId.body.code, 'bad_query')
    eq(`C21c nol query DB (${res})`, dbCalls().length, 0)
  }

  // UUID sah tetap boleh dipakai sebagai filter id (tidak over-blocking).
  mock.__reset({ tables: tables() })
  const goodId = await callRead({ body: { resource: 'masters/projects', query: { id: F.PROJECTS[0].id } } })
  eq('C21d filter id UUID sah -> 200', goodId.statusCode, 200)
  eq('C21e tepat satu baris', goodId.body.data.length, 1)

  // Nilai filter berupa objek/array ditolak (tidak di-coerce jadi "[object Object]").
  mock.__reset({ tables: tables() })
  const objFilter = await callRead({ body: { resource: 'masters/projects', query: { kode: { $ne: '101' } } } })
  eq('C21f filter objek ditolak -> 400', objFilter.statusCode, 400)

  // ---- SAKLAR TULIS: create WAJIB mati bila env tidak menyalakannya ----
  // Ini yang membuat gate review Brooklyn bisa ditegakkan: RPC yang sudah
  // di-apply Bandeng TIDAK otomatis membuka tulis.
  for (const [label, envPatch] of [
    ['env absen', { BAKPAU_API_CREATE_ENABLED: undefined }],
    ['"false"', { BAKPAU_API_CREATE_ENABLED: 'false' }],
    ['"1"', { BAKPAU_API_CREATE_ENABLED: '1' }],
    ['"yes"', { BAKPAU_API_CREATE_ENABLED: 'yes' }],
    ['"TRUE " (spasi+kapital) tetap true', { BAKPAU_API_CREATE_ENABLED: ' TRUE ' }]
  ]) {
    const env = { ...F.ENV, ...envPatch }
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k]
    mock.__reset({ tables: tables() })
    const r = await callCreate({ body: F.validCreatePayload(), env })
    if (label.startsWith('"TRUE')) {
      eq(`C22 ${label} -> 201`, r.statusCode, 201)
    } else {
      eq(`C22 create dengan ${label} -> 503`, r.statusCode, 503)
      eq(`C23 kode create_disabled (${label})`, r.body.code, 'create_disabled')
      eq(`C24 nol aktivitas DB (${label})`, dbCalls().length, 0)
    }
  }

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

  // Tanpa kredensial server (token sah, tapi klien tidak ada) -> 503,
  // bukan 200 kosong.
  mock.__reset({ tables: tables() })
  const noSvc = await callRead({ body: { resource: 'masters/projects' }, client: null })
  eq('C21 tanpa klien server -> 503', noSvc.statusCode, 503)

  // ---- REGRESI BROOKLYN: kredensial baca privileged TIDAK boleh dipakai ----
  const svcJwt = `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.y`
  mock.__reset({ tables: tables() })
  const onlyService = await callRead({
    body: { resource: 'masters/projects' },
    useRealCred: true,
    env: { ...F.ENV, SUPABASE_URL: 'https://sintetis.supabase.co', SUPABASE_SERVICE_ROLE_KEY: svcJwt }
  })
  eq('C22 hanya service role -> 503 (fail closed)', onlyService.statusCode, 503)
  eq('C23 kode read_credential_missing', onlyService.body.code, 'read_credential_missing')
  eq('C24 nol query DB saat kredensial baca absen', dbCalls().length, 0)

  mock.__reset({ tables: tables() })
  const svcAsRead = await callRead({
    body: { resource: 'masters/projects' },
    useRealCred: true,
    env: { ...F.ENV, SUPABASE_URL: 'https://sintetis.supabase.co', BAKPAU_API_READ_SUPABASE_KEY: svcJwt }
  })
  eq('C25 service role dipasang sebagai kunci baca -> 503', svcAsRead.statusCode, 503)
  eq('C26 kode read_credential_privileged', svcAsRead.body.code, 'read_credential_privileged')
  eq('C27 nol query DB', dbCalls().length, 0)

  // Kunci anon (ber-RLS) DITERIMA sebagai kredensial baca: handler tidak lagi
  // menolak karena "kredensial hilang". (Klien nyata menunjuk host sintetis,
  // jadi kegagalan jaringannya bukan bagian dari asersi ini.)
  const anonJwt = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.y`
  mock.__reset({ tables: tables() })
  const anonOk = await callRead({
    body: { resource: 'masters/projects' },
    useRealCred: true,
    env: { ...F.ENV, SUPABASE_URL: 'https://sintetis.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: anonJwt }
  })
  ok('C28 kunci anon diterima (bukan 503 kredensial)',
    !(anonOk.statusCode === 503 && /read_credential/.test(String(anonOk.body.code))),
    `status=${anonOk.statusCode} code=${anonOk.body.code}`)

  const src = H.readCredentialSource({ SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: svcJwt })
  eq('C29 laporan sumber kredensial: bukan service role', src.usesServiceRole, false)
  ok('C30 nama env terlarang dilaporkan (bukan nilainya)',
    Array.isArray(src.forbiddenEnvPresent) && src.forbiddenEnvPresent.includes('SUPABASE_SERVICE_ROLE_KEY'))
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
  eq('D17 nol baris nota', rowsOf('receivings').length, 0)

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

  // Nama vendor (bukan UUID) harus cocok LITERAL — bukan substring.
  mock.__reset({ tables: tables() })
  const fuzzy = F.validCreatePayload({ idempotencyKey: 'sintetis-fuzzy-vendor' })
  fuzzy.purchase.invoiceNo = 'SINT-FUZZY'
  delete fuzzy.purchase.vendorId
  fuzzy.purchase.vendorName = 'SINTETIS Toko A1'
  const r11 = await callCreate({ body: fuzzy })
  eq('D20 nama vendor tidak literal -> 422', r11.statusCode, 422)
  eq('D21 nol baris nota', rowsOf('receivings').length, 0)
}

// ============================================================
group('E. CREATE — SUKSES, READBACK, IDEMPOTENSI, NOTIFIKASI')
// ============================================================
{
  // E1 sukses: satu nota + readback exact + notifikasi terkirim.
  mock.__reset({ tables: tables() })
  const tr = fakeTransport()
  const okRes = await callCreate({ body: F.validCreatePayload(), transport: tr })
  eq('E1 create sah -> 201', okRes.statusCode, 201)
  eq('E2 status tercatat', okRes.body.status, 'tercatat')
  ok('E3 receivingId dikembalikan', !!okRes.body.receivingId)
  eq('E4 tepat satu header nota di DB', rowsOf('receivings').length, 1)
  eq('E4b SATU panggilan RPC atomik', atomicCalls().length, 1)
  eq('E4c NOL tulisan tabel langsung (bukan multipart)', directWrites().length, 0)
  eq('E5 readback ok', okRes.body.readback.ok, true)
  eq('E6 notifikasi terkirim ke DAT', tr.sent.length, 1)
  eq('E7 tujuan notifikasi chatId DAT', tr.sent[0].target.chatId, '1320969465')
  eq('E8 tujuan bukan WhatsApp', tr.sent[0].target.platform, 'telegram')
  ok('E9 teks notifikasi tidak memuat token', !tr.sent[0].text.includes(F.TEST_SECRET))

  // E10 idempotencyKey sama -> tidak ada tulisan kedua.
  const before = rowsOf('receivings').length
  const again = await callCreate({ body: F.validCreatePayload(), transport: tr })
  eq('E10 kunci sama -> 200 ignored', again.statusCode, 200)
  eq('E11 status ignored_duplicate_event', again.body.status, 'ignored_duplicate_event')
  eq('E12 tidak ada nota kedua', rowsOf('receivings').length, before)
  eq('E13 tidak ada notifikasi kedua', tr.sent.length, 1)

  // E14 kunci BEDA tapi bukti sama -> duplicate (lintas "kanal"/waktu).
  const before2 = rowsOf('receivings').length
  const otherKey = F.validCreatePayload({ idempotencyKey: 'sintetis-nota-0001-retry-baru' })
  const dupEv = await callCreate({ body: otherKey, transport: tr })
  eq('E14 bukti sama kunci beda -> duplicate', dupEv.body.status, 'duplicate')
  eq('E15 tidak ada nota ketiga', rowsOf('receivings').length, before2)
  eq('E15b klaim ledger tidak menumpuk dari percobaan gagal', rowsOf('bakpau_events').length, 2)

  // E16 notifikasi gagal: pembelian TIDAK ditulis ulang.
  mock.__reset({ tables: tables() })
  const failing = fakeTransport({ failTimes: 99 })
  const r16 = await callCreate({ body: F.validCreatePayload(), transport: failing })
  eq('E16 create tetap 201 walau notifikasi gagal', r16.statusCode, 201)
  eq('E17 notifikasi tercatat gagal', r16.body.notification.sent, false)
  eq('E18 hanya satu nota', rowsOf('receivings').length, 1)

  // E19 RPC atomik belum di-apply -> fail closed, nol tulisan.
  mock.__reset({ tables: tables(), missingRpc: ['bakpau_save_purchase_atomic'] })
  const r19 = await callCreate({ body: F.validCreatePayload(), transport: fakeTransport() })
  eq('E19 RPC atomik absen -> 503', r19.statusCode, 503)
  eq('E20 kode atomic_rpc_unavailable', r19.body.code, 'atomic_rpc_unavailable')
  eq('E21 nol nota saat RPC absen', rowsOf('receivings').length, 0)
  eq('E21b nol klaim ledger saat RPC absen', rowsOf('bakpau_events').length, 0)

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
  const items27 = rowsOf('receiving_items').filter(i => String(i.receiving_id) === String(r27.body.receivingId))
  ok('E28 pr_item_id tertaut dari nomor PR',
    items27.some(d => String(d.pr_item_id || '') === F.PR_ITEMS[0].id), items27.map(i => i.pr_item_id))

  // E29 tidak ada PR fiktif / approval_steps / handover.
  eq('E29 tidak ada insert purchase_requests', mock.__callsOf('insert', 'purchase_requests').length, 0)
  eq('E30 tidak ada dokumen handover dibuat', rowsOf('handovers').length, 0)
  eq('E31 tidak ada delete di jalur create', mock.__state.calls.filter(c => c.op === 'delete').length, 0)

  // E32 alokasi proyek per baris dipertahankan (satu nota dua proyek).
  mock.__reset({ tables: tables() })
  const multi = F.validCreatePayload({ idempotencyKey: 'sintetis-dua-proyek' })
  multi.purchase.invoiceNo = 'SINT-DUA-PROYEK'
  multi.purchase.projectId = undefined
  multi.purchase.statedTotal = 240000
  multi.purchase.items = [
    { itemName: 'SINTETIS Triplek 9mm', qty: 1, harga: 120000, unit: 'Lembar', projectId: F.PROJECTS[0].id },
    { itemName: 'SINTETIS Triplek 9mm', qty: 1, harga: 120000, unit: 'Lembar', projectId: F.PROJECTS[1].id }
  ]
  const r32 = await callCreate({ body: multi, transport: fakeTransport() })
  eq('E32 nota dua proyek -> 201', r32.statusCode, 201)
  const head32 = rowsOf('receivings').find(r => r.id === r32.body.receivingId)
  eq('E33 header tanpa proyek tunggal (tidak memilih salah satu)', head32.project_id, null)
  const it32 = rowsOf('receiving_items').filter(i => i.receiving_id === r32.body.receivingId)
  ok('E34 dua baris dengan proyek berbeda', it32.length === 2
    && it32.some(i => String(i.note).includes(F.PROJECTS[0].id))
    && it32.some(i => String(i.note).includes(F.PROJECTS[1].id)),
    it32.map(i => i.note))
}

// ============================================================
group('H. BATAS TRANSAKSI ATOMIK (regresi review Brooklyn)')
// ============================================================
{
  // H1: nota SUDAH ada (dibuat admin) dengan vendor+nomor sama -> ditolak oleh
  // transaksi, 0 baris baru. Ini idempotensi LINTAS KANAL, bukan hanya API.
  mock.__reset({ tables: tables() })
  mock.__state.tables.get('receivings').set('admin-nota-1', {
    id: 'admin-nota-1',
    vendor_id: F.VENDORS[0].id,
    invoice_no: 'SINT-NOTA-0001',
    status: 'DIBELI',
    note: '[Nominal: Rp 240000] [Tahap: DIBELI]',
    received_date: '2026-10-19'
  })
  const r1 = await callCreate({ body: F.validCreatePayload(), transport: fakeTransport() })
  eq('H1 nota sama dari kanal admin -> 200 duplicate', r1.statusCode, 200)
  eq('H2 status duplicate', r1.body.status, 'duplicate')
  eq('H3 tidak ada nota kedua', rowsOf('receivings').length, 1)
  eq('H4 nol klaim ledger tertinggal', rowsOf('bakpau_events').length, 0)

  // H5: kegagalan di tengah transaksi -> TIDAK ada header/baris/klaim.
  mock.__reset({ tables: tables(), failAtomic: 'after_header' })
  const r5 = await callCreate({ body: F.validCreatePayload(), transport: fakeTransport() })
  ok('H5 gagal di tengah -> bukan 201', r5.statusCode !== 201, `status=${r5.statusCode}`)
  eq('H6 nol header tertinggal', rowsOf('receivings').length, 0)
  eq('H7 nol baris tertinggal', rowsOf('receiving_items').filter(i => i.receiving_id !== F.RECEIVING_ITEMS_SEED[0].receiving_id).length, 0)
  eq('H8 nol klaim ledger tertinggal', rowsOf('bakpau_events').length, 0)

  // H9: balasan RPC tidak konsisten (item_count beda) -> bukan 'tercatat'.
  mock.__reset({ tables: tables(), atomicResultPatch: { item_count: 99 } })
  const r9 = await callCreate({ body: F.validCreatePayload(), transport: fakeTransport() })
  ok('H9 balasan tidak konsisten tidak 201', r9.statusCode !== 201, `status=${r9.statusCode}`)
  ok('H10 status bukan tercatat', r9.body.status !== 'tercatat')

  // H11: verifikasi menolak receiving_id/rows tidak sah.
  const bad = AP.verifyAtomicResult({
    result: { receiving_id: 'bukan-uuid', evidence_hash: 'a'.repeat(64), event_key: 'k', item_count: 1, total: 1, items: [{}] },
    args: { evidence_hash: 'a'.repeat(64), event_key: 'k', items: [{}, {}] },
    expectedTotal: 1
  })
  eq('H11 verifikasi menolak id/rows tidak sah', bad.ok, false)
  ok('H12 diffs menyebut receiving_id', bad.diffs.includes('receiving_id'))

  // H13: readback KETAT menolak alokasi proyek yang salah (bukan candidates[0]).
  mock.__reset({ tables: tables() })
  const okCase = await callCreate({ body: F.validCreatePayload({ idempotencyKey: 'sintetis-proyek-salah' }), transport: fakeTransport() })
  eq('H13 nota kontrol tersimpan', okCase.statusCode, 201)
  const rid = okCase.body.receivingId
  // Rusak alokasi proyek pada baris DB (simulasi bug penulisan alokasi).
  const row = mock.__state.tables.get('receiving_items').get([...mock.__state.tables.get('receiving_items').keys()].find(k => {
    const v = mock.__state.tables.get('receiving_items').get(k)
    return String(v.receiving_id) === String(rid)
  }))
  row.note = String(row.note || '').replace(F.PROJECTS[0].id, F.PROJECTS[1].id)
  const rb = await AP.readbackPurchaseStrict({
    client: mock.supabase,
    receivingId: rid,
    expected: {
      vendorId: F.VENDORS[0].id,
      invoiceNo: okCase.body.invoiceNo,
      date: '2026-10-20',
      projectId: F.PROJECTS[0].id,
      itemCount: 1,
      totalRows: 1,
      items: [{
        item_name: 'SINTETIS Triplek 9mm', unit: 'Lembar', quantity_received: 2,
        harga: 120000, projectId: F.PROJECTS[0].id, prItemId: null
      }]
    }
  })
  eq('H14 readback menolak proyek salah', rb.ok, false)
  ok('H15 diff menyebut item/proyek', rb.diffs.some(d => /item_hilang|proyek/.test(d)), rb.diffs)
}

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

  // F9: error DB internal tidak pernah keluar (disanitasi).
  mock.__reset({ tables: tables(), failSelectTable: 'projects' })
  const badDb = await callRead({ body: { resource: 'masters/projects' } })
  eq('F9 error DB -> 502', badDb.statusCode, 502)
  ok('F10 pesan DB internal tidak diteruskan', !/relation|character|42P01/i.test(JSON.stringify(badDb.body)),
    JSON.stringify(badDb.body))

  // F11: sanitasi log membuang nilai rahasia.
  const clean = H.sanitizeLogMessage('failed postgres://u:password=abc123&apikey=xyz Bearer abc.def')
  ok('F11 log tanpa password/apikey', !/abc123|xyz/.test(clean), clean)
  ok('F12 log tanpa bearer token', !/abc\.def/.test(clean), clean)
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

// ============================================================
console.log(`\n=== RINGKASAN ===`)
console.log(`PASS: ${pass}  FAIL: ${fail}`)
if (failures.length) {
  for (const f of failures) console.log(` - ${f.name}: ${f.detail || ''}`)
  process.exit(1)
}
console.log('SEMUA TES API BAKPAU HIJAU')
