// ============================================================
// scripts/approval-off-test/seed_guard_test.mjs
// REGRESI INTEGRASI t_da4a9ef8: jalur MAINTENANCE tidak boleh menulis
// approval_steps selama modul Approval OFF.
// ============================================================
// Brooklyn (verifikasi handoff Bit): `pages/api/seed-simulation.js` masih
// menghapus & menyisipkan baris `approval_steps` bila diberi token maintenance
// yang sah. Menutup menu saja tidak cukup — handler harus berhenti SEBELUM
// klien DB dibuat / write pertama.
//
// Uji ini menjalankan HANDLER ASLI (disalin verbatim ke sandbox, hanya
// specifier import yang ditulis ulang) dengan klien Supabase PENIPU yang
// mencatat setiap operasi. Tidak ada jaringan, tidak ada DB, tidak ada token
// nyata.
//
//   S1. token sah + modul OFF  -> HTTP 409 APPROVAL_OFF, NOL operasi tabel,
//                                 createClient tidak pernah dipanggil.
//   S2. token salah + modul OFF -> 401, tetap nol operasi (auth dulu, guard
//                                 berikutnya; dua-duanya fail closed).
//   S3. kontrol: flag dihidupkan di SALINAN sandbox -> handler sampai ke jalur
//       tulis (membuktikan bahwa yang menghentikan adalah kebijakan terpusat,
//       bukan kebetulan karena import rusak).
//
// Jalankan dari root repo:  node scripts/approval-off-test/seed_guard_test.mjs
// (sandbox memakai TMPDIR resmi, bukan /tmp global)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd()
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-guard-'))

let pass = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`) }
  else { failures.push(`${name} ${extra}`); console.log(`  FAIL ${name}  ${extra}`) }
}

function write(rel, body) {
  const p = path.join(SANDBOX, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}

// ---------- salin sumber ASLI (bukan salinan logika) ----------
const constantsSrc = fs.readFileSync(path.join(REPO, 'lib/constants.js'), 'utf8')
const handlerSrc = fs.readFileSync(path.join(REPO, 'pages/api/seed-simulation.js'), 'utf8')

write('constants.mjs', constantsSrc)
// Ganti hanya specifier import; isi handler tetap verbatim.
const rewritten = handlerSrc
  .replace(/from ['"]@supabase\/supabase-js['"]/, "from './mockSupabase.mjs'")
  .replace(/from ['"]\.\.\/\.\.\/lib\/constants['"]/, "from './constants.mjs'")
check('S0a handler menyalin guard approval (adapter sumber nyata)',
  /approvalGuard\(\s*['"]seed-simulation['"]\s*\)/.test(rewritten))
check('S0b specifier import ditulis ulang (tanpa paket nyata)',
  rewritten.includes("from './mockSupabase.mjs'") && rewritten.includes("from './constants.mjs'"))
write('handler.mjs', rewritten)

write('mockSupabase.mjs', `
export const state = { created: 0, ops: [] }
export function resetState() { state.created = 0; state.ops.length = 0 }
function chain(table) {
  const op = { table, verbs: [] }
  state.ops.push(op)
  const result = () => ({ data: [], error: null, count: 0 })
  const proxy = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve) => resolve(result())
      return (...args) => { op.verbs.push(String(prop)); return proxy }
    }
  })
  return proxy
}
export function createClient() {
  state.created += 1
  return {
    from: (table) => chain(table),
    rpc: (name) => { state.ops.push({ table: 'rpc:' + name, verbs: ['rpc'] }); return Promise.resolve({ data: null, error: null }) }
  }
}
`)

const mock = await import(pathToFileURL(path.join(SANDBOX, 'mockSupabase.mjs')).href)
const handler = (await import(pathToFileURL(path.join(SANDBOX, 'handler.mjs')).href)).default

function recorder() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
  return res
}

process.env.MAINTENANCE_TOKEN = 'tok-uji-sintetis'
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'kunci-palsu-uji'

const TOKEN = 'tok-uji-sintetis'

// ---------------- S1: token sah, modul OFF ----------------
mock.resetState()
{
  const res = recorder()
  await handler({ method: 'POST', headers: { 'x-maintenance-token': TOKEN }, query: {} }, res)
  check('S1a HTTP 409 (bukan 200)', res.statusCode === 409, `got=${res.statusCode}`)
  check('S1b kode APPROVAL_OFF dilaporkan', res.body && res.body.code === 'APPROVAL_OFF', JSON.stringify(res.body))
  check('S1c createClient TIDAK dipanggil', mock.state.created === 0, `created=${mock.state.created}`)
  check('S1d nol operasi tabel (termasuk approval_steps)', mock.state.ops.length === 0, `ops=${JSON.stringify(mock.state.ops)}`)
  check('S1e nol tulisan approval dilaporkan', res.body && res.body.approvalWrites === 0)
}

// ---------------- S2: token salah ----------------
mock.resetState()
{
  const res = recorder()
  await handler({ method: 'POST', headers: { 'x-maintenance-token': 'salah' }, query: {} }, res)
  check('S2a HTTP 401 untuk token salah', res.statusCode === 401, `got=${res.statusCode}`)
  check('S2b nol operasi tabel', mock.state.ops.length === 0)
}

// ---------------- S3: kontrol, flag dihidupkan di SALINAN ----------------
{
  const enabledSrc = constantsSrc.replace(
    /export const APPROVAL_MODULE_ENABLED = false/,
    'export const APPROVAL_MODULE_ENABLED = true'
  )
  check('S3a salinan sandbox berhasil menghidupkan flag', enabledSrc !== constantsSrc)
  // Modul sandbox terpisah supaya cache ESM tidak mencampur dua kebijakan.
  const SB2 = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-guard-on-'))
  fs.writeFileSync(path.join(SB2, 'constants.mjs'), enabledSrc)
  fs.copyFileSync(path.join(SANDBOX, 'mockSupabase.mjs'), path.join(SB2, 'mockSupabase.mjs'))
  fs.writeFileSync(path.join(SB2, 'handler.mjs'), rewritten)
  const mock2 = await import(pathToFileURL(path.join(SB2, 'mockSupabase.mjs')).href)
  const handler2 = (await import(pathToFileURL(path.join(SB2, 'handler.mjs')).href)).default
  const res = recorder()
  await handler2({ method: 'POST', headers: { 'x-maintenance-token': TOKEN }, query: {} }, res)
  check('S3b dengan flag ON handler melewati guard (mencapai klien DB)',
    mock2.state.created === 1, `created=${mock2.state.created}`)
  check('S3c dengan flag ON jalur approval_steps benar-benar ada di handler',
    mock2.state.ops.some(o => o.table === 'approval_steps'),
    JSON.stringify(mock2.state.ops.map(o => o.table)))
}

console.log(`\nHASIL seed_guard_test: ${pass} lulus, ${failures.length} gagal`)
if (failures.length) {
  console.error(failures.map(f => ' - ' + f).join('\n'))
  process.exit(1)
}
