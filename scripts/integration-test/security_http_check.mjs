// ============================================================
// SECURITY HTTP CHECK (t_35cd0354) — server Next NYATA
// ============================================================
// Membuktikan lubang P0 "S4 API tanpa auth" TETAP tertutup setelah semua
// branch digabung (bukan hanya di branch corrective):
//   * GET / POST / PATCH /api/sales-invoices tanpa sesi -> 401
//   * GET /api/reminders, GET /api/marketing-contract tanpa sesi -> 401
//   * POST /api/reminders (method salah) -> 405 (bukan 200)
//   * token pratinjau SALAH -> 401
//   * user valid NON-ADMIN -> 403: dibuktikan di harness in-process
//     (scripts/sales-invoice-test/auth_api_test.mjs C2b-*), karena JWT
//     Supabase sah tidak bisa dikarang tanpa kredensial — di sini hanya
//     dipastikan jalur 403 itu memang ada di kode yang disajikan.
//
// Pemakaian:
//   node scripts/integration-test/security_http_check.mjs http://127.0.0.1:3014
// ============================================================
const BASE = process.argv[2] || 'http://127.0.0.1:3014'

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

async function call(method, path, { body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch (_) { json = null }
  return { status: res.status, json }
}

console.log('=== SECURITY HTTP — endpoint setelah merge (t_35cd0354) ===\n')

console.log('--- A. /api/sales-invoices tanpa sesi ---')
for (const [method, body] of [
  ['GET', undefined],
  ['POST', { customer_name: 'x', nominal: 1000 }],
  ['PATCH', { id: 'si_x', to: 'TERBIT' }]
]) {
  const r = await call(method, '/api/sales-invoices', { body })
  check(`A: ${method} tanpa sesi = 401 (bukan 200/400)`, r.status === 401, `status=${r.status} ${JSON.stringify(r.json)}`)
  check(`A: ${method} body tidak membocorkan data invoice`,
    !r.json || (!r.json.invoices && !r.json.data), JSON.stringify(r.json).slice(0, 160))
}

console.log('\n--- B. token pratinjau salah ---')
{
  const r = await call('GET', '/api/sales-invoices', { headers: { 'x-preview-token': 'token-palsu' } })
  check('B: token pratinjau salah = 401', r.status === 401, `status=${r.status} ${JSON.stringify(r.json)}`)
}

console.log('\n--- C. endpoint baru S5/S6 juga menolak tanpa sesi ---')
for (const p of ['/api/reminders', '/api/marketing-contract']) {
  const r = await call('GET', p)
  check(`C: GET ${p} tanpa sesi = 401`, r.status === 401, `status=${r.status} ${JSON.stringify(r.json)}`)
}
{
  const r = await call('POST', '/api/reminders', { body: {} })
  check('C: POST /api/reminders = 405 (hanya GET)', r.status === 405, `status=${r.status}`)
}

console.log('\n--- D. jalur 403 non-admin ada di kode yang disajikan ---')
{
  const fs = await import('node:fs')
  const auth = fs.readFileSync('modules/sales-invoice/auth.js', 'utf8')
  check('D: auth.js punya jalur 403 FORBIDDEN untuk peran non-admin',
    /403/.test(auth) && /FORBIDDEN/.test(auth) && /admin/.test(auth))
  const api = fs.readFileSync('pages/api/sales-invoices.js', 'utf8')
  check('D: setiap method lewat verifyAdmin SEBELUM membaca/menulis',
    api.indexOf('verifyAdmin') < api.indexOf("req.method === 'GET'"))
  check('D: tidak ada lagi penulisan file JSON tanpa otorisasi di route',
    !/writeFile(Sync)?\(/.test(api) || /createFileStore/.test(api))
}

console.log(`\n=== HASIL SECURITY HTTP: ${pass} lulus, ${fail} gagal ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
