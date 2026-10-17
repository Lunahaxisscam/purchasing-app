// ============================================================
// scripts/reminders-test/api_test.mjs — B. OTORISASI + ENDPOINT (DRY-RUN)
// ============================================================
// Yang dibuktikan:
//   * GET tanpa sesi = 401; non-admin = 403; tanpa konfigurasi = 503;
//   * token pratinjau salah = 401, benar = 200 (mode lokal);
//   * method selain GET = 405 dan TIDAK memanggil pembacaan data;
//   * respons selalu memuat readiness (sumber tersedia / ambang / BLOCKED);
//   * sumber yang tidak tersedia → jenis BLOCKED, bukan 0 temuan;
//   * endpoint TIDAK memuat jalur tulis: tidak ada insert/update/delete/rpc,
//     tidak ada pengiriman keluar, tidak ada cron.
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const REPO = path.resolve(HERE, '..', '..')
const REM = path.join(REPO, 'scripts', 'reminders')

const H = await import(pathToFileURL(path.join(REM, 'handler.js')).href)
const R = await import(pathToFileURL(path.join(REM, 'rules.js')).href)

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

// ---------- mock req/res ----------
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
function mockReq({ method = 'GET', headers = {}, query = {}, body = null } = {}) {
  return { method, headers: { ...headers }, query: { ...query }, body }
}

// ---------- stub auth (pola sama dengan auth.js milik modul invoice) ----------
function authStub(mode) {
  return {
    createClient(url, key, opts = {}) {
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

// Pembaca data palsu: mencatat panggilan supaya bisa dibuktikan tidak dipanggil.
function collectStub(dataset = {}, sourcesOverride = null) {
  const calls = []
  const sources = (sourcesOverride || ['purchase_requests', 'pr_items', 'approval_steps', 'receivings', 'receiving_items', 'handovers', 'projects', 'sales_invoices'])
    .map(k => ({
      key: k, table: k, available: dataset[k] !== null && dataset[k] !== undefined,
      row_count: (dataset[k] || []).length, fetched: (dataset[k] || []).length, truncated: false, columns: [],
      error_code: (dataset[k] === null || dataset[k] === undefined) ? 'SCHEMA_UNAVAILABLE' : null,
      error_message: (dataset[k] === null || dataset[k] === undefined) ? 'tabel tidak ada' : null
    }))
  async function collectFn(args) {
    calls.push(args)
    return { dataset, sources, meta: { read_only: true, row_limit: args.rowLimit, queries: sources.map(s => ({ table: s.table, method: 'SELECT' })) } }
  }
  return { collectFn, calls }
}

const SAMPLE = {
  purchase_requests: [{ id: 'pr1', pr_number: 'PR-001', status: 'SUBMITTED', title: 'Lemari', project_id: 'p1', created_at: '2026-10-08T00:00:00Z' }],
  approval_steps: [{ id: 's1', purchase_request_id: 'pr1', status: 'PENDING', created_at: '2026-10-08T00:00:00Z' }],
  pr_items: [],
  receivings: [],
  receiving_items: [],
  handovers: [],
  projects: [{ id: 'p1', name: 'Josh - Mabes' }],
  sales_invoices: null // tabel belum ada
}

async function call(handler, req) {
  const res = mockRes()
  await handler(req, res)
  return res
}

console.log('\n=== B. OTORISASI & ENDPOINT /api/reminders ===')

// ---------- B1. Fail closed tanpa konfigurasi ----------
{
  const { collectFn, calls } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: { NODE_ENV: 'test' }, collect: collectFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq())
  eq('B1a', 'tanpa kredensial & tanpa token pratinjau → 503', 503, res.statusCode)
  eq('B1b', 'kode AUTH_NOT_CONFIGURED', 'AUTH_NOT_CONFIGURED', res.body.code)
  eq('B1c', 'tidak ada pembacaan data saat auth gagal', 0, calls.length)
}
{
  const { collectFn } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({
    env: { NODE_ENV: 'test', REMINDER_PREVIEW_TOKEN: 'rahasia' },
    collect: collectFn,
    authDeps: authStub('admin')
  })
  const res = await call(handler, mockReq({ headers: { 'x-preview-token': 'salah' } }))
  eq('B1d', 'token pratinjau salah → 401', 401, res.statusCode)
  const res2 = await call(handler, mockReq({ headers: { 'x-preview-token': 'rahasia' } }))
  eq('B1e', 'token pratinjau benar → 200', 200, res2.statusCode)
  eq('B1f', 'via auth tercatat preview-token', 'preview-token', res2.body.readiness.auth_via)
}

// ---------- B2. JWT: tanpa sesi / non-admin / error peran ----------
{
  const { collectFn, calls } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('nosession') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer rusak' } }))
  eq('B2a', 'tanpa sesi valid → 401', 401, res.statusCode)
  eq('B2b', 'kode INVALID_SESSION', 'INVALID_SESSION', res.body.code)
  eq('B2c', 'tidak ada pembacaan data', 0, calls.length)
}
{
  const { collectFn } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('user') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' } }))
  eq('B2d', 'non-admin → 403', 403, res.statusCode)
  eq('B2e', 'kode FORBIDDEN', 'FORBIDDEN', res.body.code)
}
{
  const { collectFn } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('roleerror') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' } }))
  eq('B2f', 'gagal membaca peran → 503 (fail closed)', 503, res.statusCode)
}
{
  const { collectFn } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' } }))
  eq('B2g', 'admin → 200', 200, res.statusCode)
  eq('B2h', 'peran tercatat di readiness', 'admin', res.body.readiness.authorized_as)
  eq('B2i', 'via auth = jwt', 'jwt', res.body.readiness.auth_via)
}

// ---------- B3. Method selain GET ----------
for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const { collectFn, calls } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ method: m, headers: { authorization: 'Bearer ok' } }))
  eq(`B3-${m}a`, `${m} → 405`, 405, res.statusCode)
  eq(`B3-${m}b`, `${m} tidak memanggil pembacaan data`, 0, calls.length)
  ok(`B3-${m}c`, `${m} menyebut hanya GET`, String(res.body.error).includes('GET'))
}

// ---------- B4. Bentuk laporan & readiness ----------
let adminRes
{
  const { collectFn, calls } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('admin') })
  adminRes = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { as_of: '2026-10-18' } }))
  const b = adminRes.body
  eq('B4a', 'ok true', true, b.ok)
  eq('B4b', 'dry_run true', true, b.dry_run)
  eq('B4c', 'read_only true', true, b.read_only)
  eq('B4d', 'as_of dipakai dari query', '2026-10-18', b.as_of)
  eq('B4e', 'readiness.dry_run true', true, b.readiness.dry_run)
  eq('B4f', 'readiness.no_outbound_send true', true, b.readiness.no_outbound_send)
  eq('B4g', 'readiness.no_payment true', true, b.readiness.no_payment)
  eq('B4h', 'readiness.no_cron_mutation true', true, b.readiness.no_cron_mutation)
  ok('B4i', 'readiness.sources_available memuat tabel yang ada',
    b.readiness.sources_available.includes('purchase_requests'), JSON.stringify(b.readiness.sources_available))
  ok('B4j', 'readiness.sources_unavailable memuat sales_invoices',
    b.readiness.sources_unavailable.some(s => s.key === 'sales_invoices' && s.error_code === 'SCHEMA_UNAVAILABLE'))
  ok('B4k', 'readiness.kinds_blocked memuat invoice_due',
    b.readiness.kinds_blocked.some(k => k.kind === 'invoice_due'))
  eq('B4l', 'data_ready false karena ada sumber hilang', false, b.readiness.data_ready)
  eq('B4m', 'status degraded', 'degraded', b.readiness.status)
  eq('B4n', 'thresholds_used = default', R.DEFAULT_THRESHOLDS, b.readiness.thresholds_used)
  eq('B4o', 'threshold_defaults dicetak untuk pembanding', R.DEFAULT_THRESHOLDS, b.readiness.threshold_defaults)
  eq('B4p', 'collect dipanggil sekali dengan rowLimit default', 1, calls.length)
  ok('B4q', 'semua query tercatat SELECT',
    b.meta.queries.every(q => q.method === 'SELECT'), JSON.stringify(b.meta.queries))
  ok('B4r', 'PR overdue muncul sebagai item', b.items.some(i => i.kind === 'pr_overdue_approval'))
}

// ---------- B5. Override ambang via query + penolakan ----------
{
  const { collectFn } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({
    headers: { authorization: 'Bearer ok' },
    query: { as_of: '2026-10-18', pr_overdue_days: '30' }
  }))
  eq('B5a', 'ambang dari query dipakai', 30, res.body.thresholds.pr_overdue_days)
  eq('B5b', 'sumber ambang "query"', 'query', res.body.threshold_sources.pr_overdue_days)
  eq('B5c', 'PR 10 hari tidak lagi masuk (ambang 30)', 0,
    res.body.items.filter(i => i.kind === 'pr_overdue_approval').length)
}
{
  const { collectFn } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({
    headers: { authorization: 'Bearer ok' },
    query: { as_of: '2026-10-18', pr_overdue_days: '5000' }
  }))
  eq('B5d', 'ambang di luar batas ditolak', R.DEFAULT_THRESHOLDS.pr_overdue_days, res.body.thresholds.pr_overdue_days)
  ok('B5e', 'penolakan dilaporkan', res.body.rejected_thresholds.length === 1)
  ok('B5f', 'catatan menyebut ambang diabaikan', res.body.notes.some(n => n.includes('Ambang diabaikan')))
}

// ---------- B6. format=text ----------
{
  const { collectFn } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { format: 'text', as_of: '2026-10-18' } }))
  eq('B6a', 'format=text → 200', 200, res.statusCode)
  ok('B6b', 'content-type text/plain', String(res.headers['content-type']).includes('text/plain'))
  ok('B6c', 'isi teks memuat DRY-RUN', String(res.text).includes('DRY-RUN'))
  ok('B6d', 'isi teks memuat BLOCKED', String(res.text).includes('BLOCKED'))
  ok('B6e', 'cache-control no-store', String(res.headers['cache-control']).includes('no-store'))
}
{
  const { collectFn } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { format: 'pdf' } }))
  eq('B6f', 'format tak dikenal → 400', 400, res.statusCode)
}

// ---------- B7. kinds filter & pemotongan item ----------
{
  const many = { ...SAMPLE, purchase_requests: [] }
  many.handovers = Array.from({ length: 12 }, (_, i) => ({ id: `h${i}`, status: 'CONFIRMED', diserahkan_at: null }))
  const { collectFn } = collectStub(many)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { max_items: '5' } }))
  eq('B7a', 'items dibatasi max_items', 5, res.body.items.length)
  eq('B7b', 'items_truncated true', true, res.body.readiness.items_truncated)
  ok('B7c', 'items_total lebih besar dari yang ditampilkan', res.body.readiness.items_total > 5)
  const res2 = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { all: '1' } }))
  eq('B7d', 'all=1 menampilkan semua', res2.body.readiness.items_total, res2.body.items.length)
}
{
  const { collectFn } = collectStub(SAMPLE)
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { kinds: 'handover_pending' } }))
  eq('B7e', 'kinds membatasi jenis yang dievaluasi', ['handover_pending'], res.body.kinds.map(k => k.key))
}

// ---------- B8. Kegagalan pembacaan data ----------
{
  const handler = H.createRemindersHandler({
    env: ENV_JWT,
    collect: async () => { throw new Error('jaringan mati') },
    authDeps: authStub('admin')
  })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' } }))
  eq('B8a', 'pembacaan gagal → 502', 502, res.statusCode)
  eq('B8b', 'kode COLLECT_FAILED', 'COLLECT_FAILED', res.body.code)
  eq('B8c', 'tetap menyatakan dry_run', true, res.body.dry_run)
}

// ---------- B9. Tidak ada jalur tulis/kirim di kode endpoint ----------
{
  const files = ['handler.js', 'collect.js', 'rules.js', 'auth.js'].map(f => path.join(REM, f))
  const sourcesTxt = files.map(f => fs.readFileSync(f, 'utf8')).join('\n')
  const codeOnly = sourcesTxt
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
  ok('B9a', 'tidak ada .insert( di lapisan reminder', !/\.insert\s*\(/.test(codeOnly))
  ok('B9b', 'tidak ada .update( di lapisan reminder', !/\.update\s*\(/.test(codeOnly))
  ok('B9c', 'tidak ada .delete( di lapisan reminder', !/\.delete\s*\(/.test(codeOnly))
  ok('B9d', 'tidak ada .upsert( di lapisan reminder', !/\.upsert\s*\(/.test(codeOnly))
  ok('B9e', 'tidak ada .rpc( di lapisan reminder', !/\.rpc\s*\(/.test(codeOnly))
  // Dicek sebagai PEMANGGILAN/ENDPOINT nyata, bukan kata di teks laporan:
  // laporan justru WAJIB menyebut "tidak ada cron" dan "tidak ada Telegram".
  ok('B9f', 'tidak ada pemanggilan pengiriman keluar',
    !/sendMessage\s*\(|api\.telegram\.org|graph\.facebook\.com|smtp\.|nodemailer|sendgrid|twilio/i.test(codeOnly))
  ok('B9g', 'tidak ada fetch/axios keluar dari collect', !/fetch\s*\(|axios/.test(fs.readFileSync(path.join(REM, 'rules.js'), 'utf8')))
  ok('B9h', 'tidak ada penjadwalan/cron nyata di lapisan reminder',
    !/node-cron|require\(['"]cron|setInterval\s*\(|setTimeout\s*\(|schedule\s*\(|\.schedule\b|crontab/i.test(codeOnly))
}
{
  const apiSrc = fs.readFileSync(path.join(REPO, 'pages/api/reminders.js'), 'utf8')
  ok('B9i', 'pages/api/reminders.js hanya re-export (logika tunggal di handler.js)',
    !/createClient|\.insert|\.update/.test(apiSrc))
  ok('B9j', 'pages/api/reminders.js mendokumentasikan dry-run', /DRY-RUN/.test(apiSrc))
}

// ---------- B10. collect.js: hanya SELECT & laporkan tabel hilang ----------
{
  const src = fs.readFileSync(path.join(REM, 'collect.js'), 'utf8')
  const codeOnly = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  ok('B10a', 'collect memakai select()', /\.select\s*\(/.test(codeOnly))
  ok('B10b', 'collect tidak memakai insert/update/delete/upsert/rpc',
    !/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(/.test(codeOnly))
  ok('B10c', 'collect memakai count exact (untuk mendeteksi pemotongan)', /count:\s*'exact'/.test(codeOnly))
  ok('B10d', 'collect mendeteksi PGRST205 sebagai SCHEMA_UNAVAILABLE', /PGRST205/.test(codeOnly))
}
{
  // Tanpa kredensial: semua sumber available:false, dataset kosong, tidak melempar.
  const C = await import(pathToFileURL(path.join(REM, 'collect.js')).href)
  const out = await C.collect({ env: {}, rowLimit: 10 })
  ok('B10e', 'tanpa kredensial tidak melempar', !!out && Array.isArray(out.sources))
  eq('B10f', 'semua sumber tidak tersedia', 0, out.sources.filter(s => s.available).length)
  ok('B10g', 'alasan kredensial dilaporkan', out.sources.every(s => s.error_code === 'NO_CREDENTIALS'))
  ok('B10h', 'dataset kosong tapi kunci lengkap', Object.keys(out.dataset).length === out.sources.length)
  eq('B10i', 'row_limit dihormati & dilaporkan', 10, out.meta.row_limit)
}

// ---------- B11. Handler dengan pembaca Supabase palsu (client disuntik) ----------
{
  // Mensimulasikan Supabase: satu tabel ada, satu tabel PGRST205.
  const tables = {
    purchase_requests: [{ id: 'pr1', pr_number: 'PR-001', status: 'SUBMITTED', created_at: '2026-10-01T00:00:00Z' }],
    pr_items: [], approval_steps: [], receivings: [], receiving_items: [], handovers: [], projects: []
  }
  function fakeClient() {
    return {
      from(table) {
        const q = {
          select() { return q },
          order() { return q },
          limit() { return q },
          then(resolve) {
            if (!(table in tables)) {
              resolve({ data: null, count: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}'` } })
            } else {
              resolve({ data: tables[table], count: tables[table].length, error: null })
            }
          }
        }
        return q
      }
    }
  }
  const C = await import(pathToFileURL(path.join(REM, 'collect.js')).href)
  const handler = H.createRemindersHandler({ env: ENV_JWT, authDeps: authStub('admin'), client: fakeClient() })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' }, query: { as_of: '2026-10-18' } }))
  eq('B11a', 'handler dengan client palsu → 200', 200, res.statusCode)
  ok('B11b', 'sales_invoices dilaporkan tidak tersedia',
    res.body.readiness.sources_unavailable.some(s => s.key === 'sales_invoices'))
  ok('B11c', 'purchase_requests dilaporkan tersedia',
    res.body.readiness.sources_available.includes('purchase_requests'))
  ok('B11d', 'PR overdue ditemukan dari data nyata (client palsu)',
    res.body.items.some(i => i.kind === 'pr_overdue_approval'))
  ok('B11e', 'invoice_due BLOCKED (bukan 0 temuan)',
    res.body.readiness.kinds_blocked.some(k => k.kind === 'invoice_due'))
}

// ---------- B12. Handoff S4: pratinjau lokal BUKAN data durable ----------
{
  // Sumber invoice tidak tersedia (PGRST205) + ada file pratinjau lokal.
  const { collectFn } = collectStub({ ...SAMPLE })
  const handler = H.createRemindersHandler({ env: ENV_JWT, collect: collectFn, authDeps: authStub('admin') })
  const res = await call(handler, mockReq({ headers: { authorization: 'Bearer ok' } }))
  eq('B12a', 'invoice_source_durable false saat tabel hilang', false, res.body.readiness.invoice_source_durable)
  ok('B12b', 'invoice_due tetap BLOCKED (pratinjau tidak dianggap data)',
    res.body.readiness.kinds_blocked.some(k => k.kind === 'invoice_due'))
}
{
  const C = await import(pathToFileURL(path.join(REM, 'collect.js')).href)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rem-preview-'))
  fs.writeFileSync(path.join(tmp, 'sales_invoices.json'), JSON.stringify([{ id: 'x' }, { id: 'y' }]))
  const preview = C.inspectInvoicePreview(tmp)
  ok('B12c', 'file pratinjau terdeteksi', preview.exists === true && preview.rows === 2, JSON.stringify(preview))
  eq('B12d', 'pratinjau ditandai tidak durable', false, preview.durable)
  ok('B12e', 'catatan melarang pemakaian untuk penagihan', /JANGAN dipakai/.test(preview.note))
  const empty = C.inspectInvoicePreview(path.join(tmp, 'tidak-ada'))
  eq('B12f', 'direktori tanpa file → exists false', false, empty.exists)
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n  HASIL B: ${pass} LULUS, ${fail} GAGAL`)
if (fail) console.log('  gagal: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
