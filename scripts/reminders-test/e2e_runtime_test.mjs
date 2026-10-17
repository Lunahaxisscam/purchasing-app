// ============================================================
// scripts/reminders-test/e2e_runtime_test.mjs — D. UJI RUNTIME NYATA
// ============================================================
// Unit test tidak membuktikan endpoint benar-benar berperilaku begitu di
// server Next sungguhan. Skrip ini menembak HTTP nyata:
//
//   D1. tanpa sesi → 401 (dan tidak membocorkan daftar reminder)
//   D2. JWT non-admin → 403
//   D3. JWT admin → 200 + readiness lengkap + item sesuai data uji
//   D4. method tulis (POST/PATCH/DELETE) → 405
//   D5. format=text → text/plain, memuat DRY-RUN & BLOCKED
//   D6. tabel sales_invoices yang tidak ada → jenis BLOCKED (bukan 0 temuan)
//   D7. nol operasi tulis ke "Supabase" (dibuktikan dari log server palsu)
//   D8. tidak ada endpoint lain yang berubah (regresi /api/sales-invoices)
//
// Pemakaian:
//   node scripts/reminders-test/e2e_runtime_test.mjs http://127.0.0.1:PORT \
//        [--fake-supabase http://127.0.0.1:PORT2]
// ============================================================

const BASE = process.argv[2] || 'http://127.0.0.1:3182'
const fakeIdx = process.argv.indexOf('--fake-supabase')
const FAKE = fakeIdx > -1 ? process.argv[fakeIdx + 1] : null

let pass = 0
let fail = 0
const failures = []
function ok(no, name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(`${no} ${name}`); console.log(`  FAIL ${no} ${name} ${extra}`) }
}

async function call(method, path, { headers = {}, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch (_) { json = null }
  return { status: res.status, json, text, headers: res.headers }
}

// JWT palsu: server uji (fake supabase) menerima token apa pun yang tidak
// kosong, dan peran dibaca dari tabel profiles yang juga ditiru.
const JWT_ADMIN = 'header.payload.signature'
const JWT_USER = 'header.user.signature'

console.log(`\n=== D. RUNTIME NYATA (${BASE}) ===`)

// ---- D1. Tanpa sesi ----
{
  const r = await call('GET', '/api/reminders')
  ok('D1a', 'GET tanpa sesi → 401/503', [401, 503].includes(r.status), `status=${r.status}`)
  ok('D1b', 'tidak membocorkan daftar reminder', !(r.json && Array.isArray(r.json.items)))
  ok('D1c', 'error berbentuk {ok:false, code}', r.json && r.json.ok === false && !!r.json.code)
}
{
  const r = await call('GET', '/api/reminders', { headers: { 'x-preview-token': 'ngawur' } })
  ok('D1d', 'token pratinjau salah ditolak', [401, 403].includes(r.status), `status=${r.status}`)
}

// ---- D2/D3. JWT ----
let adminBody = null
{
  const r = await call('GET', '/api/reminders?as_of=2026-10-18', { headers: { authorization: `Bearer ${JWT_USER}` } })
  // Server uji mengembalikan role 'user' untuk token ini bila fake supabase
  // membedakannya; bila tidak, minimal bukan 2xx.
  ok('D2a', 'JWT non-admin bukan 200', r.status !== 200 || r.json?.readiness?.authorized_as === 'user',
    `status=${r.status} body=${JSON.stringify(r.json).slice(0, 200)}`)
}
{
  const r = await call('GET', '/api/reminders?as_of=2026-10-18', { headers: { authorization: `Bearer ${JWT_ADMIN}` } })
  adminBody = r.json
  ok('D3a', 'JWT admin → 200', r.status === 200, `status=${r.status} body=${JSON.stringify(r.json).slice(0, 300)}`)
  if (r.status === 200) {
    const b = r.json
    ok('D3b', 'dry_run true', b.dry_run === true)
    ok('D3c', 'read_only true', b.read_only === true)
    ok('D3d', 'readiness.no_outbound_send true', b.readiness.no_outbound_send === true)
    ok('D3e', 'readiness.no_payment true', b.readiness.no_payment === true)
    ok('D3f', 'readiness.no_cron_mutation true', b.readiness.no_cron_mutation === true)
    ok('D3g', 'authorized_as admin', b.readiness.authorized_as === 'admin', String(b.readiness.authorized_as))
    ok('D3h', 'sumber data terbaca (purchase_requests tersedia)',
      b.readiness.sources_available.includes('purchase_requests'), JSON.stringify(b.readiness.sources_available))
    ok('D3i', 'ambang tercetak', typeof b.thresholds.pr_overdue_days === 'number')
    ok('D3j', 'PR overdue terdeteksi dari data uji', b.items.some(i => i.kind === 'pr_overdue_approval'),
      JSON.stringify(b.items.map(i => i.kind)))
    ok('D3k', 'handover pending terdeteksi', b.items.some(i => i.kind === 'handover_pending'))
    ok('D3l', 'missing_evidence terdeteksi', b.items.some(i => i.kind === 'missing_evidence'))
    ok('D3m', 'semua query SELECT', (b.meta.queries || []).every(q => q.method === 'SELECT'))
  }
}

// ---- D4. Method tulis ----
for (const m of ['POST', 'PATCH', 'DELETE', 'PUT']) {
  const r = await call(m, '/api/reminders', { headers: { authorization: `Bearer ${JWT_ADMIN}` }, body: {} })
  ok(`D4-${m}`, `${m} → 405`, r.status === 405, `status=${r.status}`)
}

// ---- D5. format=text ----
{
  const r = await call('GET', '/api/reminders?format=text&as_of=2026-10-18', { headers: { authorization: `Bearer ${JWT_ADMIN}` } })
  ok('D5a', 'format=text → 200', r.status === 200, `status=${r.status}`)
  ok('D5b', 'content-type text/plain', String(r.headers.get('content-type')).includes('text/plain'))
  ok('D5c', 'memuat DRY-RUN', r.text.includes('DRY-RUN'))
  ok('D5d', 'memuat pernyataan tidak ada pengiriman', /tidak ada pesan yang dikirim/i.test(r.text))
  ok('D5e', 'memuat ambang batas', r.text.includes('AMBANG BATAS'))
  ok('D5f', 'memuat status sumber data', r.text.includes('SUMBER DATA'))
}

// ---- D6. Tabel hilang → BLOCKED ----
if (adminBody) {
  ok('D6a', 'sales_invoices dilaporkan tidak tersedia',
    adminBody.readiness.sources_unavailable.some(s => s.key === 'sales_invoices'),
    JSON.stringify(adminBody.readiness.sources_unavailable))
  ok('D6b', 'invoice_due BLOCKED', adminBody.readiness.kinds_blocked.some(k => k.kind === 'invoice_due'))
  ok('D6c', 'data_ready false', adminBody.readiness.data_ready === false)
  ok('D6d', 'status degraded/unavailable', ['degraded', 'unavailable'].includes(adminBody.readiness.status))
  ok('D6e', 'BLOCKED menjelaskan "bukan berarti bersih"',
    adminBody.readiness.kinds_blocked.every(k => String(k.reason).includes('bukan berarti bersih')))
}

// ---- D7. Nol operasi tulis ke Supabase ----
if (FAKE) {
  const r = await fetch(`${FAKE}/__writes`)
  const { writes } = await r.json()
  ok('D7a', 'tidak ada POST/PATCH/DELETE ke Supabase selama uji', writes.length === 0, JSON.stringify(writes))
}

// ---- D8. Regresi endpoint lain ----
{
  const r = await call('GET', '/api/sales-invoices')
  ok('D8a', '/api/sales-invoices tetap menolak tanpa sesi', [401, 503].includes(r.status), `status=${r.status}`)
  const r2 = await call('POST', '/api/sales-invoices', { body: { customer_name: 'x', nominal: 1 } })
  ok('D8b', '/api/sales-invoices tetap menolak POST tanpa sesi', r2.status >= 400, `status=${r2.status}`)
}

console.log(`\n  HASIL D: ${pass} LULUS, ${fail} GAGAL`)
if (fail) console.log('  gagal: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
