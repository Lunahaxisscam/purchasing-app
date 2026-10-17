// ============================================================
// scripts/marketing-test/api_test.mjs — B. OTORISASI, ROUTE GUARD, ENDPOINT
// ============================================================
// Membuktikan (tanpa DB, tanpa jaringan):
//   B1. fail closed: tanpa kredensial & tanpa token pratinjau → 503;
//   B2. token pratinjau salah → 401, benar → 200;
//   B3. JWT: tanpa sesi 401, non-admin 403, gagal baca peran 503, admin 200;
//   B4. method selain GET → 405 DAN tidak membaca data apa pun;
//   B5. ROUTE GUARD: aksi keluar (send/ads/sync/…) → 403 ACTION_FORBIDDEN,
//       terjadi SEBELUM auth & SEBELUM pembacaan data;
//   B6. view=summary tidak menyentuh jaringan sama sekali;
//   B7. view=readiness: sumber tidak tersedia → BLOCKED (bukan "0 lead"),
//       dan hanya tabel yang boleh dibaca marketing yang di-query;
//   B8. view=sample: contoh dry-run divalidasi, tidak ada yang dieksekusi;
//   B9. bentuk respons menyatakan nol efek samping di semua jalur 200.
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const REPO = path.resolve(HERE, '..', '..')
const DIR = path.join(REPO, 'scripts', 'marketing')

const H = await import(pathToFileURL(path.join(DIR, 'handler.js')).href)
const C = await import(pathToFileURL(path.join(DIR, 'contract.js')).href)
const P = await import(pathToFileURL(path.join(DIR, 'probe.js')).href)

let pass = 0
let fail = 0
const failures = []
function ok(no, name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(`${no} ${name}`); console.log(`  FAIL ${no} ${name} ${extra}`) }
}
function eq(no, name, expected, actual) {
  const a = JSON.stringify(expected)
  const b = JSON.stringify(actual)
  ok(no, name, a === b, `| expected=${a} actual=${b}`)
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    text: null,
    setHeader(k, v) { res.headers[k.toLowerCase()] = v },
    status(c) { res.statusCode = c; return res },
    json(b) { res.body = b; return res },
    send(b) { res.text = b; return res }
  }
  return res
}
function mockReq({ method = 'GET', headers = {}, query = {} } = {}) {
  return { method, headers: { ...headers }, query: { ...query } }
}

// Stub Supabase untuk guard admin (pola sama dengan auth.js S4).
function authStub(mode) {
  return {
    createClient() {
      return {
        auth: {
          async getUser() {
            if (mode === 'nosession') return { data: { user: null }, error: { message: 'invalid jwt' } }
            return { data: { user: { id: 'u-1', email: 'admin@noir.id' } }, error: null }
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
}

const ENV_JWT = {
  NODE_ENV: 'test',
  SUPABASE_URL: 'https://stub.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service'
}

// Pembaca palsu: mencatat pemanggilan supaya bisa dibuktikan TIDAK dipanggil.
function probeStub({ available = [], rowCounts = {} } = {}) {
  const calls = []
  async function probeFn(args) {
    calls.push(args)
    const sources = P.READABLE_SOURCES.map(d => {
      const av = available.includes(d.key)
      return {
        key: d.key, table: d.table, owner: d.owner, note: d.note,
        available: av, row_count: av ? (rowCounts[d.key] || 0) : 0, fetched: av ? 1 : 0,
        columns: av ? ['id'] : [], error_code: av ? null : 'SCHEMA_UNAVAILABLE',
        error_message: av ? null : `Could not find the table 'public.${d.table}' in the schema cache`
      }
    })
    return { sources, meta: { read_only: true, row_limit: args.rowLimit, client_ready: true, client_reason: null, queries: P.READABLE_SOURCES.map(d => ({ table: d.table, method: 'SELECT', limit: args.rowLimit })) } }
  }
  return { probeFn, calls }
}

async function call(handler, req) {
  const res = mockRes()
  await handler(req, res)
  return res
}

console.log('\n=== B. OTORISASI, ROUTE GUARD & ENDPOINT /api/marketing-contract ===')

// ---------- B1. Fail closed tanpa konfigurasi ----------
{
  const { probeFn, calls } = probeStub()
  const handler = H.createMarketingHandler({ env: { NODE_ENV: 'test' }, probe: probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ query: { view: 'readiness' } }))
  eq('B1a', 'tanpa kredensial & tanpa token pratinjau → 503', 503, res.statusCode)
  eq('B1b', 'kode AUTH_NOT_CONFIGURED', 'AUTH_NOT_CONFIGURED', res.body.code)
  eq('B1c', 'tidak ada pembacaan data saat auth gagal', 0, calls.length)
}
{
  const { probeFn } = probeStub()
  const handler = H.createMarketingHandler({
    env: { NODE_ENV: 'test', MARKETING_PREVIEW_TOKEN: 'rahasia-marketing' },
    probe: probeFn,
    authDeps: authStub('admin')
  })
  const bad = await call(handler, mockReq({ headers: { 'x-preview-token': 'salah' } }))
  eq('B1d', 'token pratinjau salah → 401', 401, bad.statusCode)
  const good = await call(handler, mockReq({ headers: { 'x-preview-token': 'rahasia-marketing' } }))
  eq('B1e', 'token pratinjau benar → 200', 200, good.statusCode)
  eq('B1f', 'via auth tercatat preview-token', 'preview-token', good.body.auth_via)
}
{
  // Token marketing jatuh ke token invoice (satu token pratinjau lokal).
  const handler = H.createMarketingHandler({
    env: { NODE_ENV: 'test', SALES_INVOICE_PREVIEW_TOKEN: 'token-invoice' },
    probe: probeStub().probeFn,
    authDeps: authStub('admin')
  })
  const res = await call(handler, mockReq({ headers: { 'x-preview-token': 'token-invoice' } }))
  eq('B1g', 'fallback ke SALES_INVOICE_PREVIEW_TOKEN berlaku', 200, res.statusCode)
}

// ---------- B2. JWT ----------
{
  const { probeFn, calls } = probeStub()
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeFn, authDeps: authStub('nosession') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer rusak' }, query: { view: 'readiness' } }))
  eq('B2a', 'tanpa sesi valid → 401', 401, res.statusCode)
  eq('B2b', 'kode INVALID_SESSION', 'INVALID_SESSION', res.body.code)
  eq('B2c', 'tidak ada pembacaan data', 0, calls.length)
}
{
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeStub().probeFn, authDeps: authStub('user') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' } }))
  eq('B2d', 'non-admin → 403', 403, res.statusCode)
  eq('B2e', 'kode FORBIDDEN', 'FORBIDDEN', res.body.code)
}
{
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeStub().probeFn, authDeps: authStub('roleerror') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' } }))
  eq('B2f', 'gagal membaca peran → 503 (fail closed)', 503, res.statusCode)
}
{
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeStub().probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' } }))
  eq('B2g', 'admin → 200', 200, res.statusCode)
  eq('B2h', 'peran tercatat', 'admin', res.body.authorized_as)
  eq('B2i', 'via auth = jwt', 'jwt', res.body.auth_via)
}

// ---------- B3. Method selain GET ----------
for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const { probeFn, calls } = probeStub()
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ method: m, headers: { authorization: 'Bearer ok' }, query: { view: 'readiness' } }))
  eq(`B3-${m}a`, `${m} → 405`, 405, res.statusCode)
  eq(`B3-${m}b`, `${m} tidak memanggil pembacaan data`, 0, calls.length)
  eq(`B3-${m}c`, `${m} kode METHOD_NOT_ALLOWED`, 'METHOD_NOT_ALLOWED', res.body.code)
  ok(`B3-${m}d`, `${m} menyebut hanya GET`, String(res.body.error).includes('GET'))
}

// ---------- B4. ROUTE GUARD: aksi keluar ditolak ----------
// Setiap nama aksi HARAM diuji lewat `?action=<x>`; sebagian lewat flag (?send=1).
{
  const forbidden = H.FORBIDDEN_ACTIONS
  ok('B4a', 'daftar aksi terlarang memuat kirim pesan', forbidden.includes('send') && forbidden.includes('whatsapp') && forbidden.includes('email'))
  ok('B4b', 'daftar aksi terlarang memuat iklan berbayar', forbidden.includes('ads') && forbidden.includes('audience-upload') && forbidden.includes('pixel'))
  ok('B4c', 'daftar aksi terlarang memuat tulis/sinkron', forbidden.includes('write') && forbidden.includes('sync') && forbidden.includes('cron'))

  let allBlocked = true
  const leaked = []
  for (const action of forbidden) {
    const { probeFn, calls } = probeStub()
    const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeFn, authDeps: authStub('admin') })
    const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { action } }))
    if (res.statusCode !== 403 || !res.body || res.body.code !== 'ACTION_FORBIDDEN') { allBlocked = false; leaked.push(`${action}→${res.statusCode}`) }
    if (calls.length !== 0) { allBlocked = false; leaked.push(`${action}:probe-dipanggil`) }
  }
  ok('B4d', `semua ${forbidden.length} aksi terlarang → 403 tanpa membaca data`, allBlocked, leaked.join(', '))
}
{
  // Guard jalan SEBELUM auth: tanpa sesi pun aksi terlarang dijawab 403,
  // bukan 401 — supaya pemanggil tahu aksinya tidak ada, bukan cuma "belum login".
  const handler = H.createMarketingHandler({ env: { NODE_ENV: 'test' }, probe: probeStub().probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ query: { action: 'send' } }))
  eq('B4e', 'guard aksi berjalan sebelum auth (403, bukan 401/503)', 403, res.statusCode)
  eq('B4f', 'kode ACTION_FORBIDDEN', 'ACTION_FORBIDDEN', res.body.code)
  eq('B4g', 'respons menyatakan nol efek samping', { outbound_send: false, paid_ads: false, writes: 0 }, res.body.side_effects)
  ok('B4h', 'pesan menjelaskan lapisan ini hanya baca+rencana', /hanya membaca dan merencanakan/i.test(res.body.error))
}
{
  // Flag bernama aksi juga ditangkap (?ads=1, ?send=true, ?publish=1).
  for (const [q, action] of [[{ ads: '1' }, 'ads'], [{ send: 'true' }, 'send'], [{ publish: 'ya' }, 'publish'], [{ sync: '1' }, 'sync']]) {
    const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeStub().probeFn, authDeps: authStub('admin') })
    const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: q }))
    eq(`B4i-${action}`, `flag ?${action}=… → 403`, 403, res.statusCode)
  }
  // Flag bernilai 0/false bukan aksi: harus lolos ke view normal.
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeStub().probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { ads: '0' } }))
  eq('B4j', 'flag ?ads=0 bukan aksi (tetap 200)', 200, res.statusCode)
}
{
  // ?action=summary (bukan aksi keluar) tidak boleh ikut diblokir.
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeStub().probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { action: 'summary' } }))
  eq('B4k', 'action yang tidak terlarang tidak diblokir', 200, res.statusCode)
}

// ---------- B5. view=summary: tanpa jaringan ----------
{
  const { probeFn, calls } = probeStub()
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' } }))
  const b = res.body
  eq('B5a', 'summary → 200', 200, res.statusCode)
  eq('B5b', 'summary TIDAK memanggil pembacaan data', 0, calls.length)
  eq('B5c', 'kontrak_id benar', 'marketing-crm-project', b.contract_id)
  eq('B5d', 'dry_run true', true, b.dry_run)
  eq('B5e', 'read_only true', true, b.read_only)
  eq('B5f', 'side_effects nol', { outbound_send: false, paid_ads: false, cron: false, write_queries: 0, status_changes: 0 }, b.side_effects)
  eq('B5g', 'taksonomi sumber ikut', C.LEAD_SOURCES.length, b.lead_sources.length)
  eq('B5h', 'daftar contoh ikut (id saja)', true, Array.isArray(b.samples) && b.samples.length > 0)
  ok('B5i', 'rute & method diumumkan', Array.isArray(b.routes.allowed_methods) && b.routes.allowed_methods.length === 1 && b.routes.allowed_methods[0] === 'GET')
}
{
  // view tidak dikenal → 400 (bukan diam-diam jadi summary).
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeStub().probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { view: 'dashboard' } }))
  eq('B5j', 'view tidak dikenal → 400', 400, res.statusCode)
  eq('B5k', 'kode BAD_VIEW', 'BAD_VIEW', res.body.code)
}

// ---------- B6. view=readiness ----------
let readinessBody = null
{
  // Semua tabel marketing/CRM belum ada (kondisi nyata hari ini), projects ada.
  const { probeFn, calls } = probeStub({ available: ['projects'], rowCounts: { projects: 11 } })
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { view: 'readiness' } }))
  readinessBody = res.body
  const b = res.body
  eq('B6a', 'readiness → 200', 200, res.statusCode)
  eq('B6b', 'memanggil pembacaan sekali', 1, calls.length)
  eq('B6c', 'data_ready false bila CRM/marketing belum ada', false, b.data_ready)
  eq('B6d', 'status degraded (sebagian terbaca)', 'degraded', b.status)
  ok('B6e', 'leads dilaporkan tidak tersedia dengan kode error',
    b.readiness.sources_unavailable.some(s => s.key === 'leads' && s.error_code === 'SCHEMA_UNAVAILABLE'))
  ok('B6f', 'customers dilaporkan tidak tersedia', b.readiness.sources_unavailable.some(s => s.key === 'customers'))
  ok('B6g', 'projects dilaporkan tersedia (baca saja)', b.readiness.sources_available.includes('projects'))
  ok('B6h', 'lead_pipeline BLOCKED, bukan "0 lead"',
    b.readiness.blocked_capabilities.some(c => c.capability === 'lead_pipeline' && /bukan berarti kosong/i.test(c.reason)))
  ok('B6i', 'customer_handoff BLOCKED',
    b.readiness.blocked_capabilities.some(c => c.capability === 'customer_handoff'))
  ok('B6j', 'crm_table_ready false', b.readiness.crm_table_ready === false)
  ok('B6k', 'marketing_tables_ready false', b.readiness.marketing_tables_ready === false)
  ok('B6l', 'semua query SELECT', (b.meta.queries || []).every(q => q.method === 'SELECT'))
  eq('B6m', 'side_effects nol di readiness', { outbound_send: false, paid_ads: false, cron: false, write_queries: 0 }, b.side_effects)

  // Yang di-query HANYA tabel yang boleh dibaca marketing.
  const queried = (b.meta.queries || []).map(q => q.table)
  const allowed = P.READABLE_SOURCES.map(s => s.table)
  ok('B6n', 'tidak ada tabel di luar daftar baca yang di-query',
    queried.every(t => allowed.includes(t)), queried.join(', '))
  for (const forbiddenTable of ['purchase_requests', 'pr_items', 'approval_steps', 'receivings', 'receiving_items', 'handovers', 'sales_invoices']) {
    ok(`B6-${forbiddenTable}`, `tabel ${forbiddenTable} TIDAK di-query`, !queried.includes(forbiddenTable))
  }
}
{
  // Semua tabel tersedia → data_ready true, tidak ada blocked capability.
  const { probeFn } = probeStub({ available: ['leads', 'campaigns', 'customers', 'projects', 'lead_touchpoints', 'lead_handoffs'] })
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { view: 'readiness' } }))
  eq('B6o', 'semua tabel ada → data_ready true', true, res.body.data_ready)
  eq('B6p', 'status ok', 'ok', res.body.status)
  eq('B6q', 'tidak ada capability BLOCKED', 0, res.body.readiness.blocked_capabilities.length)
}
{
  // Pembacaan gagal total → 502, bukan laporan kosong yang tampak aman.
  const handler = H.createMarketingHandler({
    env: ENV_JWT,
    probe: async () => { throw new Error('jaringan mati') },
    authDeps: authStub('admin')
  })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { view: 'readiness' } }))
  eq('B6r', 'pembacaan gagal → 502', 502, res.statusCode)
  eq('B6s', 'kode PROBE_FAILED', 'PROBE_FAILED', res.body.code)
  eq('B6t', 'tetap menandai dry_run', true, res.body.dry_run)
}

// ---------- B7. view=sample ----------
{
  const { probeFn, calls } = probeStub()
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { view: 'sample' } }))
  const b = res.body
  eq('B7a', 'sample → 200', 200, res.statusCode)
  eq('B7b', 'sample tidak memanggil jaringan', 0, calls.length)
  ok('B7c', 'semua contoh divalidasi', b.samples.length >= 8, String(b.samples.length))
  ok('B7d', 'setiap hasil punya validasi & rencana', b.samples.every(s => s.validation && s.handoff_plan))
  ok('B7e', 'TIDAK ADA contoh yang dieksekusi', b.samples.every(s => s.executed === false && s.wrote === 0))
  ok('B7f', 'ringkasan menghitung lulus/gagal', b.summary.total === b.samples.length && b.summary.valid + b.summary.invalid === b.summary.total)
  ok('B7g', 'ringkasan menghitung rencana', b.summary.plans_create + b.summary.plans_link + b.summary.plans_blocked === b.summary.total)
  ok('B7h', 'ada contoh yang gagal (bukti gerbang bekerja)', b.summary.invalid > 0)
  ok('B7i', 'ada contoh WON yang direncanakan (bukti handoff jalan)',
    b.samples.some(s => s.lead.status === 'WON' && s.validation.ok && s.handoff_plan.action !== 'BLOCKED'))
  ok('B7j', 'respons menyatakan contoh bukan data pelanggan', /bukan data pelanggan nyata/i.test(b.note))
  eq('B7k', 'side_effects nol', { outbound_send: false, paid_ads: false, cron: false, write_queries: 0 }, b.side_effects)
}
{
  const handler = H.createMarketingHandler({ env: ENV_JWT, probe: probeStub().probeFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { view: 'sample', sample: 'valid-won-full' } }))
  eq('B7l', 'sample tunggal → 1 hasil', 1, res.body.samples.length)
  eq('B7m', 'sample tunggal benar', 'valid-won-full', res.body.samples[0].sample_id)
  const res404 = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { view: 'sample', sample: 'tidak-ada' } }))
  eq('B7n', 'sample tidak ada → 404', 404, res404.statusCode)
  ok('B7o', 'respons 404 menyebut contoh yang tersedia', Array.isArray(res404.body.available_samples) && res404.body.available_samples.length > 0)
}

// ---------- B8. Bukti tidak ada jalur tulis/kirim di kode handler ----------
{
  const fs = await import('node:fs')
  const src = fs.readFileSync(path.join(DIR, 'handler.js'), 'utf8')
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  ok('B8a', 'handler.js tidak memanggil .insert(', !/\.insert\s*\(/.test(stripped))
  ok('B8b', 'handler.js tidak memanggil .update(', !/\.update\s*\(/.test(stripped))
  ok('B8c', 'handler.js tidak memanggil .delete(', !/\.delete\s*\(/.test(stripped))
  ok('B8d', 'handler.js tidak memanggil .upsert(', !/\.upsert\s*\(/.test(stripped))
  ok('B8e', 'handler.js tidak memanggil .rpc(', !/\.rpc\s*\(/.test(stripped))

  // Kata "whatsapp"/"email"/"ads"/"cron" WAJAR muncul di daftar LARANGAN dan
  // pesan penolakan. Yang harus dibuktikan: kata itu hanya ada di dalam
  // string (label/pesan), TIDAK PERNAH sebagai kode yang dieksekusi —
  // tidak ada import transport, tidak ada pemanggilan API, tidak ada timer.
  const codeOnly = stripped
    .replace(/`[^`]*`/g, '""')
    .replace(/'[^']*'/g, '""')
    .replace(/"[^"]*"/g, '""')
  ok('B8f', 'tidak ada import/pemanggilan transport pengiriman',
    !/(telegram|whatsapp|sendgrid|nodemailer|webhook|axios|fetch\s*\()/i.test(codeOnly), codeOnly.match(/(telegram|whatsapp|sendgrid|nodemailer|webhook|axios|fetch\s*\()/i)?.[0] || '')
  ok('B8g', 'tidak ada pemanggilan API iklan berbayar/pixel/audience',
    !/(googleads|facebook|meta[-_]?ads|ads[-_]?api|pixel|audience[-_]?upload)/i.test(codeOnly))
  // `cron: false` adalah KUNCI objek penanda efek samping (bukan penjadwal).
  // Yang dicari: benar-benar ada pemanggilan timer / penjadwal.
  ok('B8h', 'tidak ada penjadwalan/timer yang dipanggil',
    !/(setInterval|setTimeout|node-cron|node-schedule|\.schedule\s*\()/i.test(codeOnly),
    codeOnly.match(/(setInterval|setTimeout|node-cron|node-schedule|\.schedule\s*\()/i)?.[0] || '')
  ok('B8h2', 'penanda efek samping menegaskan cron tidak diubah',
    /cron:\s*false/.test(stripped))
  ok('B8i', 'kata-kata larangan memang HANYA ada di string (daftar guard & pesan)',
    /FORBIDDEN_ACTIONS/.test(stripped) && /'send'/.test(stripped))
}

console.log(`\n  HASIL B: ${pass} LULUS, ${fail} GAGAL`)
if (fail) console.log('  gagal: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
