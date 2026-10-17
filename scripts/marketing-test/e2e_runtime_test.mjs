// ============================================================
// scripts/marketing-test/e2e_runtime_test.mjs — D. UJI RUNTIME NYATA
// ============================================================
// Unit test tidak membuktikan endpoint benar-benar berperilaku begitu di server
// Next sungguhan. Skrip ini menembak HTTP nyata:
//
//   D1. tanpa sesi → 401/503 (dan tidak membocorkan isi kontrak)
//   D2. JWT non-admin → 403
//   D3. JWT admin → 200 + kontrak lengkap + penanda nol efek samping
//   D4. method tulis (POST/PATCH/PUT/DELETE) → 405
//   D5. ROUTE GUARD: aksi keluar (send/ads/sync/…) → 403 ACTION_FORBIDDEN
//   D6. view=readiness: tabel belum ada → blocked_capabilities (bukan "0 lead")
//   D7. view=sample: contoh dry-run divalidasi, tidak ada yang dieksekusi
//   D8. NOL operasi tulis ke "Supabase" (dari log server palsu)
//   D9. NOL pembacaan tabel purchasing (dari log server palsu) — invarian P1/P3
//   D10. regresi endpoint lain tetap menolak tanpa sesi
//
// Pemakaian:
//   node scripts/marketing-test/e2e_runtime_test.mjs http://127.0.0.1:PORT \
//        --fake-supabase http://127.0.0.1:PORT2
// ============================================================

const BASE = process.argv[2] || 'http://127.0.0.1:3183'
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

const JWT_ADMIN = 'header.payload.signature'
const JWT_USER = 'header.user.signature'

console.log(`\n=== D. RUNTIME NYATA (${BASE}) ===`)

// ---- D1. Tanpa sesi ----
{
  const r = await call('GET', '/api/marketing-contract')
  ok('D1a', 'GET tanpa sesi → 401/503', [401, 503].includes(r.status), `status=${r.status}`)
  ok('D1b', 'tidak membocorkan kontrak', !(r.json && Array.isArray(r.json.lead_sources)))
  ok('D1c', 'error berbentuk {ok:false, code}', !!(r.json && r.json.ok === false && r.json.code))
}
{
  const r = await call('GET', '/api/marketing-contract', { headers: { 'x-preview-token': 'ngawur' } })
  ok('D1d', 'token pratinjau salah ditolak', [401, 403].includes(r.status), `status=${r.status}`)
}

// ---- D2. JWT non-admin ----
{
  const r = await call('GET', '/api/marketing-contract', { headers: { authorization: `Bearer ${JWT_USER}` } })
  ok('D2a', 'JWT non-admin bukan 200', r.status !== 200, `status=${r.status} body=${JSON.stringify(r.json).slice(0, 160)}`)
}

// ---- D3. JWT admin: ringkasan kontrak ----
let adminBody = null
{
  const r = await call('GET', '/api/marketing-contract', { headers: { authorization: `Bearer ${JWT_ADMIN}` } })
  adminBody = r.json
  ok('D3a', 'JWT admin → 200', r.status === 200, `status=${r.status} body=${JSON.stringify(r.json).slice(0, 300)}`)
  if (r.status === 200) {
    const b = r.json
    ok('D3b', 'dry_run true', b.dry_run === true)
    ok('D3c', 'read_only true', b.read_only === true)
    ok('D3d', 'side_effects menyatakan nol kirim', b.side_effects.outbound_send === false)
    ok('D3e', 'side_effects menyatakan nol iklan', b.side_effects.paid_ads === false)
    ok('D3f', 'side_effects menyatakan nol tulis', b.side_effects.write_queries === 0)
    ok('D3g', 'authorized_as admin', b.authorized_as === 'admin', String(b.authorized_as))
    ok('D3h', 'taksonomi sumber lead ikut', Array.isArray(b.lead_sources) && b.lead_sources.length === 11, String((b.lead_sources || []).length))
    ok('D3i', 'status kualifikasi ikut', Array.isArray(b.lead_statuses) && b.lead_statuses.includes('WON'))
    ok('D3j', 'gerbang bukti ikut', !!(b.qualification_gates && b.qualification_gates.WON))
    ok('D3k', 'kepemilikan tabel ikut', Array.isArray(b.table_ownership) && b.table_ownership.length >= 10)
    ok('D3l', 'invarian purchasing ikut', Array.isArray(b.purchasing_invariants) && b.purchasing_invariants.length === 8)
    ok('D3m', 'rute hanya GET', b.routes && b.routes.allowed_methods.length === 1 && b.routes.allowed_methods[0] === 'GET')
    ok('D3n', 'purchase_requests ditandai haram disentuh',
      (b.table_ownership.find(t => t.table === 'purchase_requests') || {}).marketing === 'none')
  }
}

// ---- D4. Method tulis ----
for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
  const r = await call(m, '/api/marketing-contract', { headers: { authorization: `Bearer ${JWT_ADMIN}` }, body: {} })
  ok(`D4-${m}`, `${m} → 405`, r.status === 405, `status=${r.status}`)
  ok(`D4-${m}-code`, `${m} kode METHOD_NOT_ALLOWED`, !!(r.json && r.json.code === 'METHOD_NOT_ALLOWED'))
}

// ---- D5. Route guard: aksi keluar ----
{
  const cases = [
    ['action=send', 'send'],
    ['action=broadcast', 'broadcast'],
    ['action=publish', 'publish'],
    ['action=ads', 'ads'],
    ['action=launch', 'launch'],
    ['action=audience-upload', 'audience-upload'],
    ['action=sync', 'sync'],
    ['action=handoff-execute', 'handoff-execute'],
    ['ads=1', 'ads-flag'],
    ['send=true', 'send-flag'],
    ['pixel=1', 'pixel-flag']
  ]
  let allOk = true
  const bad = []
  for (const [qs, label] of cases) {
    const r = await call('GET', `/api/marketing-contract?${qs}`, { headers: { authorization: `Bearer ${JWT_ADMIN}` } })
    if (r.status !== 403 || !r.json || r.json.code !== 'ACTION_FORBIDDEN') { allOk = false; bad.push(`${label}→${r.status}`) }
  }
  ok('D5a', 'semua aksi keluar → 403 ACTION_FORBIDDEN', allOk, bad.join(', '))

  // Guard berlaku bahkan TANPA sesi (403, bukan 401): aksinya memang tidak ada.
  const r2 = await call('GET', '/api/marketing-contract?action=send')
  ok('D5b', 'guard aksi mendahului auth (tanpa sesi tetap 403)', r2.status === 403, `status=${r2.status}`)
  ok('D5c', 'respons 403 menyatakan nol efek samping',
    !!(r2.json && r2.json.side_effects && r2.json.side_effects.outbound_send === false && r2.json.side_effects.paid_ads === false))
}

// ---- D6. view=readiness ----
{
  const r = await call('GET', '/api/marketing-contract?view=readiness', { headers: { authorization: `Bearer ${JWT_ADMIN}` } })
  ok('D6a', 'readiness → 200', r.status === 200, `status=${r.status}`)
  if (r.status === 200) {
    const b = r.json
    ok('D6b', 'leads dilaporkan tidak tersedia', b.readiness.sources_unavailable.some(s => s.key === 'leads'))
    ok('D6c', 'kode error SCHEMA_UNAVAILABLE',
      b.readiness.sources_unavailable.every(s => s.error_code === 'SCHEMA_UNAVAILABLE'),
      JSON.stringify(b.readiness.sources_unavailable.map(s => s.error_code)))
    ok('D6d', 'projects terbaca (2 baris dari server palsu)',
      b.readiness.sources_available.includes('projects'),
      JSON.stringify(b.readiness.sources_available))
    ok('D6e', 'data_ready false', b.data_ready === false)
    ok('D6f', 'status degraded', b.status === 'degraded', String(b.status))
    ok('D6g', 'lead_pipeline BLOCKED dengan alasan "bukan berarti kosong"',
      b.readiness.blocked_capabilities.some(c => c.capability === 'lead_pipeline' && /bukan berarti kosong/i.test(c.reason)))
    ok('D6h', 'customer_handoff BLOCKED', b.readiness.blocked_capabilities.some(c => c.capability === 'customer_handoff'))
    ok('D6i', 'semua query SELECT', (b.meta.queries || []).every(q => q.method === 'SELECT'))
    ok('D6j', 'tidak ada tabel purchasing di daftar query',
      (b.meta.queries || []).every(q => !['purchase_requests', 'pr_items', 'approval_steps', 'receivings', 'receiving_items', 'handovers', 'sales_invoices'].includes(q.table)),
      JSON.stringify((b.meta.queries || []).map(q => q.table)))
  }
}

// ---- D7. view=sample ----
{
  const r = await call('GET', '/api/marketing-contract?view=sample', { headers: { authorization: `Bearer ${JWT_ADMIN}` } })
  ok('D7a', 'sample → 200', r.status === 200, `status=${r.status}`)
  if (r.status === 200) {
    const b = r.json
    ok('D7b', 'semua contoh divalidasi', b.samples.length === 11, String(b.samples.length))
    ok('D7c', 'tidak ada yang dieksekusi', b.samples.every(s => s.executed === false && s.wrote === 0))
    ok('D7d', 'ada contoh lulus', b.summary.valid > 0, String(b.summary.valid))
    ok('D7e', 'ada contoh gagal karena gerbang bukti', b.summary.invalid > 0, String(b.summary.invalid))
    ok('D7f', 'ada rencana LINK_EXISTING (anti-duplikat)', b.summary.plans_link > 0, String(b.summary.plans_link))
    ok('D7g', 'semua rencana would_write=false',
      b.samples.every(s => s.handoff_plan.would_write === false))
  }
  const r2 = await call('GET', '/api/marketing-contract?view=sample&sample=valid-won-full', { headers: { authorization: `Bearer ${JWT_ADMIN}` } })
  ok('D7h', 'sample tunggal → 1 hasil', r2.status === 200 && r2.json.samples.length === 1)
}

// ---- D8/D9. Nol tulis & nol baca tabel purchasing ----
if (FAKE) {
  const r = await fetch(`${FAKE}/__writes`)
  const body = await r.json()
  ok('D8a', 'tidak ada POST/PATCH/DELETE ke Supabase selama uji', body.writes.length === 0, JSON.stringify(body.writes))
  ok('D9a', 'tidak ada pembacaan tabel purchasing sama sekali', body.forbidden_reads.length === 0, JSON.stringify(body.forbidden_reads))
}

// ---- D10. Regresi endpoint lain ----
{
  const r = await call('GET', '/api/sales-invoices')
  ok('D10a', '/api/sales-invoices tetap menolak tanpa sesi', [401, 503].includes(r.status), `status=${r.status}`)
  const r2 = await call('GET', '/api/reminders')
  ok('D10b', '/api/reminders tetap menolak tanpa sesi', [401, 503].includes(r2.status), `status=${r2.status}`)
}

console.log(`\n  HASIL D: ${pass} LULUS, ${fail} GAGAL`)
if (fail) console.log('  gagal: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
