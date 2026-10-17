// ============================================================
// C+D. OTORISASI SERVER-SIDE & API HANDLER
// ============================================================
// Yang dibuktikan (permintaan eksplisit review Brooklyn):
//   * guard peran di UI TIDAK cukup — handler diuji LANGSUNG, tanpa UI;
//   * GET/POST/PATCH semuanya menolak tanpa JWT (401);
//   * non-admin ditolak 403 (peran dibaca dari tabel profiles);
//   * token pratinjau salah ditolak 401, tanpa konfigurasi 503 (fail closed);
//   * POST dengan status selain DRAFT / invoice_no dari klien = 400;
//   * PATCH TERKIRIM tanpa kanal = 400, LUNAS tanpa bukti = 400,
//     LUNAS nominal kurang = 409;
//   * method lain = 405;
//   * store blocked (produksi tanpa kredensial) = 503 dan TIDAK menulis apa pun.
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const S = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/store.js')).href)
const A = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/auth.js')).href)
const API = await import(pathToFileURL(path.join(SB, 'pages/api/sales-invoices.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(no, name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  if (ok) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(no); console.log(`  FAIL ${no} ${name} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`) }
}
function ok(no, name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(no); console.log(`  FAIL ${no} ${name} ${extra}`) }
}

// ---------- Mock request/response ----------
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { res.headers[k.toLowerCase()] = v },
    status(c) { res.statusCode = c; return res },
    json(b) { res.body = b; return res }
  }
  return res
}
function mockReq({ method = 'GET', body = null, headers = {} } = {}) {
  return { method, body, headers: { ...headers }, query: {} }
}

// ---------- Stub Supabase client untuk auth ----------
// mode: 'admin' | 'user' | 'nosession' | 'roleerror'
function authStub(mode, users = {}) {
  return function createClient(url, key, opts = {}) {
    return {
      auth: {
        async getUser() {
          if (mode === 'nosession') return { data: { user: null }, error: { message: 'invalid jwt' } }
          return { data: { user: { id: 'u-admin', email: 'admin@noir.id' } }, error: null }
        }
      },
      from() {
        const api = {
          select() { return api },
          eq() { return api },
          maybeSingle() {
            if (mode === 'roleerror') return Promise.resolve({ data: null, error: { message: 'profiles tidak bisa dibaca' } })
            return Promise.resolve({ data: { role: mode === 'admin' ? 'admin' : 'user' }, error: null })
          }
        }
        return api
      }
    }
  }
}

const ENV_JWT = {
  NODE_ENV: 'test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://stub.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key'
}

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-api-'))
  return path.join(dir, 'sales_invoices.json')
}

function makeHandler({ authMode = 'admin', env = ENV_JWT, file = tmpFile(), plan = { kind: 'file-preview' } } = {}) {
  return API.createSalesInvoiceHandler({
    env,
    createClient: authStub(authMode),
    previewFile: file,
    plan,
    authDeps: { createClient: authStub(authMode) }
  })
}

const VALID_BODY = {
  customer_name: 'Jessica Wong',
  customer_phone: '08123456789',
  project_name: 'Fit-Out',
  rab_reff: 'BOQ-001',
  nominal: 85000000,
  tax_rate: 11,
  issue_date: '2026-10-17',
  due_date: '2026-10-31',
  project_intent: { mode: 'new', code: '106' }
}
const AUTH_HEADER = { authorization: 'Bearer token-admin' }

// ============================================================
// C1. AUTH MODULE — UNIT
// ============================================================
{
  const env = ENV_JWT
  try {
    await A.verifyAdmin(mockReq({}), env, { createClient: authStub('admin') })
    fail++; failures.push('C1a'); console.log('  FAIL C1a tanpa header seharusnya 401')
  } catch (err) {
    check('C1a', 'tanpa Authorization = 401 UNAUTHORIZED', [401, 'UNAUTHORIZED'], [err.status, err.code])
  }

  try {
    await A.verifyAdmin(mockReq({ headers: { authorization: 'Basic abc' } }), env, { createClient: authStub('admin') })
    fail++; failures.push('C1b'); console.log('  FAIL C1b skema auth salah seharusnya 401')
  } catch (err) {
    check('C1b', 'skema Authorization bukan Bearer = 401', 401, err.status)
  }

  try {
    await A.verifyAdmin(mockReq({ headers: AUTH_HEADER }), env, { createClient: authStub('nosession') })
    fail++; failures.push('C1c'); console.log('  FAIL C1c JWT tidak valid seharusnya 401')
  } catch (err) {
    check('C1c', 'JWT tidak valid = 401 INVALID_SESSION', [401, 'INVALID_SESSION'], [err.status, err.code])
  }

  try {
    await A.verifyAdmin(mockReq({ headers: AUTH_HEADER }), env, { createClient: authStub('user') })
    fail++; failures.push('C1d'); console.log('  FAIL C1d non-admin seharusnya 403')
  } catch (err) {
    check('C1d', 'peran non-admin = 403 FORBIDDEN', [403, 'FORBIDDEN'], [err.status, err.code])
    ok('C1e', 'pesan 403 menyebut khusus administrator', /khusus administrator/i.test(err.message), err.message)
  }

  try {
    await A.verifyAdmin(mockReq({ headers: AUTH_HEADER }), env, { createClient: authStub('roleerror') })
    fail++; failures.push('C1f'); console.log('  FAIL C1f gagal baca peran seharusnya 503')
  } catch (err) {
    check('C1f', 'gagal membaca profiles = 503 (fail closed)', [503, 'ROLE_LOOKUP_FAILED'], [err.status, err.code])
  }

  const good = await A.verifyAdmin(mockReq({ headers: AUTH_HEADER }), env, { createClient: authStub('admin') })
  check('C1g', 'admin sah diterima', ['admin', 'jwt'], [good.role, good.via])
  check('C1h', 'identitas user diteruskan', 'u-admin', good.user.id)

  // Mode pratinjau (tanpa kredensial) WAJIB token eksplisit
  const noCreds = { NODE_ENV: 'development' }
  try {
    await A.verifyAdmin(mockReq({}), noCreds, {})
    fail++; failures.push('C1i'); console.log('  FAIL C1i preview tanpa token seharusnya 503')
  } catch (err) {
    check('C1i', 'tanpa kredensial & tanpa token pratinjau = 503', [503, 'AUTH_NOT_CONFIGURED'], [err.status, err.code])
  }

  const withToken = { NODE_ENV: 'development', SALES_INVOICE_PREVIEW_TOKEN: 'rahasia-lokal' }
  try {
    await A.verifyAdmin(mockReq({ headers: { 'x-preview-token': 'salah' } }), withToken, {})
    fail++; failures.push('C1j'); console.log('  FAIL C1j token salah seharusnya 401')
  } catch (err) {
    check('C1j', 'token pratinjau salah = 401', 401, err.status)
  }
  const previewOk = await A.verifyAdmin(mockReq({ headers: { 'x-preview-token': 'rahasia-lokal' } }), withToken, {})
  check('C1k', 'token pratinjau benar diterima', 'preview-token', previewOk.via)
}

// ============================================================
// C2. HANDLER — SEMUA METHOD WAJIB OTORISASI
// ============================================================
{
  const file = tmpFile()
  const handler = makeHandler({ file })

  for (const method of ['GET', 'POST', 'PATCH']) {
    const res = mockRes()
    await handler(mockReq({ method, body: VALID_BODY }), res)
    check(`C2a-${method}`, `${method} tanpa sesi = 401`, 401, res.statusCode)
    ok(`C2a-${method}-b`, `${method} tidak membocorkan data`, res.body && res.body.ok === false && !res.body.invoices)
  }

  // Non-admin juga ditolak untuk semua method
  const nonAdmin = makeHandler({ authMode: 'user', file: tmpFile() })
  for (const method of ['GET', 'POST', 'PATCH']) {
    const res = mockRes()
    await nonAdmin(mockReq({ method, body: VALID_BODY, headers: AUTH_HEADER }), res)
    check(`C2b-${method}`, `${method} non-admin = 403`, 403, res.statusCode)
  }

  // Tidak ada satu pun tulisan file terjadi dari percobaan tidak sah
  ok('C2c', 'tidak ada file pratinjau dibuat oleh permintaan tak sah', !fs.existsSync(file), file)
}

// ============================================================
// D1. GET — daftar + status penyimpanan jujur
// ============================================================
{
  const file = tmpFile()
  const handler = makeHandler({ file })
  const res = mockRes()
  await handler(mockReq({ method: 'GET', headers: AUTH_HEADER }), res)
  check('D1a', 'GET admin = 200', 200, res.statusCode)
  check('D1b', 'daftar kosong', [], res.body.invoices)
  check('D1c', 'status penyimpanan menyatakan pratinjau', ['file-preview', false], [res.body.storage.kind, res.body.storage.durable])
  ok('D1d', 'peringatan tidak durable disertakan', /PRATINJAU/i.test(res.body.storage.note), res.body.storage.note)
  check('D1e', 'cache-control no-store', 'no-store', res.headers['cache-control'])
  check('D1f', 'peran pelaku dilaporkan', 'admin', res.body.auth.role)
}

// ============================================================
// D2. POST — hanya DRAFT
// ============================================================
{
  const file = tmpFile()
  const handler = makeHandler({ file })

  const res = mockRes()
  await handler(mockReq({ method: 'POST', headers: { ...AUTH_HEADER, 'idempotency-key': 'key-1' }, body: VALID_BODY }), res)
  check('D2a', 'POST sah = 201', 201, res.statusCode)
  check('D2b', 'invoice lahir sebagai DRAFT', 'DRAFT', res.body.invoice.status)
  check('D2c', 'draf tanpa nomor invoice', null, res.body.invoice.invoice_no)
  ok('D2d', 'status penyimpanan ikut dikembalikan', res.body.storage.kind === 'file-preview')
  const firstId = res.body.invoice.id

  // Retry dengan Idempotency-Key sama → 200, bukan duplikat
  const res2 = mockRes()
  await handler(mockReq({ method: 'POST', headers: { ...AUTH_HEADER, 'idempotency-key': 'key-1' }, body: VALID_BODY }), res2)
  check('D2e', 'retry key sama = 200', 200, res2.statusCode)
  ok('D2f', 'retry ditandai replayed', res2.body.replayed === true)
  check('D2g', 'id invoice sama (tidak duplikat)', firstId, res2.body.invoice.id)

  // Status selain DRAFT ditolak
  const res3 = mockRes()
  await handler(mockReq({ method: 'POST', headers: AUTH_HEADER, body: { ...VALID_BODY, status: 'TERKIRIM' } }), res3)
  check('D2h', 'POST dengan status TERKIRIM = 400', 400, res3.statusCode)
  check('D2i', 'kode error status awal', 'INITIAL_STATUS_MUST_BE_DRAFT', res3.body.code)

  // invoice_no dari klien ditolak
  const res4 = mockRes()
  await handler(mockReq({ method: 'POST', headers: AUTH_HEADER, body: { ...VALID_BODY, invoice_no: 'INV/NL/2026/10/999' } }), res4)
  check('D2j', 'POST dengan invoice_no karangan = 400', 400, res4.statusCode)
  check('D2k', 'kode error nomor dari klien', 'INVOICE_NO_SERVER_ASSIGNED', res4.body.code)

  // Nominal 0 ditolak
  const res5 = mockRes()
  await handler(mockReq({ method: 'POST', headers: AUTH_HEADER, body: { ...VALID_BODY, nominal: 0 } }), res5)
  check('D2l', 'POST nominal 0 = 400', 400, res5.statusCode)

  // Uang karangan klien diabaikan (total dihitung server)
  const res6 = mockRes()
  await handler(mockReq({ method: 'POST', headers: AUTH_HEADER, body: { ...VALID_BODY, tax_amount: 1, grand_total: 1 } }), res6)
  check('D2m', 'total dihitung ulang server', 94350000, res6.body.invoice.grand_total)

  // key-1 (2x → 1 invoice) + tanpa key (1) = 2; tiga percobaan tidak sah
  // (status TERKIRIM, invoice_no karangan, nominal 0) TIDAK tersimpan.
  check('D2n', 'hanya invoice sah yang tersimpan (2)', 2, JSON.parse(fs.readFileSync(file, 'utf8')).length)
}

// ============================================================
// D3. PATCH — transisi & bukti
// ============================================================
{
  const file = tmpFile()
  const handler = makeHandler({ file })
  const created = mockRes()
  await handler(mockReq({ method: 'POST', headers: AUTH_HEADER, body: VALID_BODY }), created)
  const id = created.body.invoice.id

  // Terbitkan
  const issued = mockRes()
  await handler(mockReq({ method: 'PATCH', headers: AUTH_HEADER, body: { id, status: 'TERBIT' } }), issued)
  check('D3a', 'PATCH TERBIT = 200', 200, issued.statusCode)
  check('D3b', 'nomor invoice dialokasikan', 'INV/NL/2026/10/001', issued.body.invoice.invoice_no)
  check('D3c', 'status TERBIT', 'TERBIT', issued.body.invoice.status)
  ok('D3d', 'peringatan proyek belum terbit jujur', issued.body.warnings.join(' ').length > 0)

  // Lompat ke DISETUJUI dari TERBIT → ditolak (klien belum menyetujui apa pun)
  const jump = mockRes()
  await handler(mockReq({ method: 'PATCH', headers: AUTH_HEADER, body: { id, status: 'DISETUJUI' } }), jump)
  check('D3e', 'TERBIT → DISETUJUI ditolak (belum terkirim)', 409, jump.statusCode)
  check('D3f', 'kode error transisi', 'INVALID_TRANSITION', jump.body.code)

  // TERKIRIM tanpa kanal → 400
  const noChannel = mockRes()
  await handler(mockReq({ method: 'PATCH', headers: AUTH_HEADER, body: { id, status: 'TERKIRIM' } }), noChannel)
  check('D3g', 'TERKIRIM tanpa kanal = 400', 400, noChannel.statusCode)
  check('D3h', 'kode error bukti kanal', 'EVIDENCE_REQUIRED', noChannel.body.code)

  // TERKIRIM dengan kanal → 200
  const sent = mockRes()
  await handler(mockReq({ method: 'PATCH', headers: AUTH_HEADER, body: {
    id, status: 'TERKIRIM', evidence: { sent_channel: 'WhatsApp' }
  } }), sent)
  check('D3i', 'TERKIRIM dengan kanal = 200', 200, sent.statusCode)
  check('D3j', 'kanal tersimpan', 'WhatsApp', sent.body.invoice.sent_channel)

  // LUNAS tanpa bukti → 400
  const noProof = mockRes()
  await handler(mockReq({ method: 'PATCH', headers: AUTH_HEADER, body: { id, status: 'LUNAS' } }), noProof)
  check('D3k', 'LUNAS tanpa bukti = 400', 400, noProof.statusCode)
  ok('D3l', 'error menyebut field bukti', /pembayaran|Nominal/i.test(noProof.body.error), noProof.body.error)

  // LUNAS nominal kurang → 409
  const short = mockRes()
  await handler(mockReq({ method: 'PATCH', headers: AUTH_HEADER, body: {
    id, status: 'LUNAS', evidence: { paid_amount: 1000, paid_at: '2026-10-20', payment_ref: 'TRF' }
  } }), short)
  check('D3m', 'LUNAS nominal kurang = 409', 409, short.statusCode)
  check('D3n', 'kode error nominal', 'PAYMENT_AMOUNT_MISMATCH', short.body.code)
  check('D3o', 'nominal yang diharapkan dilaporkan', 94350000, short.body.expected_amount)

  // LUNAS lengkap → 200, verifikator dari sesi
  const paid = mockRes()
  await handler(mockReq({ method: 'PATCH', headers: AUTH_HEADER, body: {
    id, status: 'LUNAS',
    evidence: { paid_amount: 94350000, paid_at: '2026-10-20', payment_ref: 'TRF-9911', verified_by: 'PALSU' }
  } }), paid)
  check('D3p', 'LUNAS lengkap = 200', 200, paid.statusCode)
  check('D3q', 'status LUNAS', 'LUNAS', paid.body.invoice.status)
  check('D3r', 'verifikator dari sesi, bukan body', 'u-admin', paid.body.invoice.payment_verified_by)

  // PATCH tanpa id → 400
  const noId = mockRes()
  await handler(mockReq({ method: 'PATCH', headers: AUTH_HEADER, body: { status: 'BATAL' } }), noId)
  check('D3s', 'PATCH tanpa id = 400', 400, noId.statusCode)

  // PATCH id tidak ada → 404
  const missing = mockRes()
  await handler(mockReq({ method: 'PATCH', headers: AUTH_HEADER, body: { id: 'si_tidak_ada', status: 'BATAL' } }), missing)
  check('D3t', 'PATCH id tidak ada = 404', 404, missing.statusCode)
}

// ============================================================
// D4. METHOD LAIN & STORE BLOCKED
// ============================================================
{
  const handler = makeHandler({ file: tmpFile() })
  const res = mockRes()
  await handler(mockReq({ method: 'DELETE', headers: AUTH_HEADER }), res)
  check('D4a', 'DELETE = 405', 405, res.statusCode)
  check('D4b', 'header Allow diisi', ['GET', 'POST', 'PATCH'], res.headers['allow'])

  // Store diblokir (produksi tanpa kredensial) → 503, tidak menulis
  const blockedFile = tmpFile()
  const blocked = makeHandler({
    file: blockedFile,
    plan: { kind: 'blocked', reason: 'Produksi tanpa kredensial Supabase: penyimpanan file lokal dilarang (fail closed).', blocker: 'MISSING_CREDENTIALS' }
  })
  const res2 = mockRes()
  await blocked(mockReq({ method: 'POST', headers: AUTH_HEADER, body: VALID_BODY }), res2)
  check('D4c', 'store diblokir = 503', 503, res2.statusCode)
  check('D4d', 'kode blocker dilaporkan', 'MISSING_CREDENTIALS', res2.body.blocker)
  ok('D4e', 'TIDAK ada tulisan file saat store diblokir', !fs.existsSync(blockedFile), blockedFile)

  // Schema belum ada → 503 SCHEMA_UNAVAILABLE (lewat store supabase yang error)
  const schemaFile = tmpFile()
  const schemaHandler = API.createSalesInvoiceHandler({
    env: ENV_JWT,
    createClient: authStub('admin'),
    authDeps: { createClient: authStub('admin') },
    plan: { kind: 'supabase' },
    buildStore: () => S.createSupabaseStore({
      from() {
        const api = {
          select() { return api }, order() { return api }, limit() { return api },
          eq() { return api }, like() { return api },
          then(resolve) {
            return resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.sales_invoices'" } })
          }
        }
        return api
      }
    })
  })
  const res3 = mockRes()
  await schemaHandler(mockReq({ method: 'GET', headers: AUTH_HEADER }), res3)
  check('D4f', 'tabel belum ada = 503', 503, res3.statusCode)
  check('D4g', 'kode SCHEMA_UNAVAILABLE', 'SCHEMA_UNAVAILABLE', res3.body.code)
  ok('D4h', 'blocker disebut supaya UI bisa menjelaskan', res3.body.blocker === 'SCHEMA_UNAVAILABLE')
  void schemaFile
}

// ============================================================
// D5. PATCH tidak boleh menulis lewat jalur lain
// ============================================================
{
  const file = tmpFile()
  const handler = makeHandler({ file })
  const created = mockRes()
  await handler(mockReq({ method: 'POST', headers: AUTH_HEADER, body: VALID_BODY }), created)
  const id = created.body.invoice.id
  const before = JSON.parse(fs.readFileSync(file, 'utf8'))[0]

  // Ubah nominal saat masih draf: boleh, tapi total dihitung ulang
  const edited = mockRes()
  await handler(mockReq({ method: 'PATCH', headers: AUTH_HEADER, body: {
    id, status: 'TERBIT', fields: { nominal: 90000000 }
  } }), edited)
  check('D5a', 'koreksi draf saat terbit dihitung ulang', 99900000, edited.body.invoice.grand_total)
  ok('D5b', 'nilai berubah dari sebelumnya', before.nominal !== edited.body.invoice.nominal)
}

console.log(`\n=== C+D. AUTH & API: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('Gagal: ' + failures.join(', ')); process.exit(1) }
