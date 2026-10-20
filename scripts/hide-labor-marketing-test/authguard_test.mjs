// scripts/hide-labor-marketing-test/authguard_test.mjs
// AUTHGUARD TIDAK BOLEH MELEMAH (t_6a18a263).
// Membandingkan working tree dengan origin/main pada hal-hal yang menjaga
// autentikasi/otorisasi: jumlah & bentuk pemeriksaan role, komponen login,
// guard route, dan middleware. Patch ini hanya menambah cabang
// early-return untuk modul nonaktif, jadi hitungan tidak boleh turun.
//
// Jalankan dari root repo: node scripts/hide-labor-marketing-test/authguard_test.mjs <repo>
import { execFileSync } from 'node:child_process'

const REPO = process.argv[2] || process.cwd()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name) }
  else { fail++; console.log('  FAIL', name, extra) }
}
const sh = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

const FILES = ['pages/index.js', 'components/Sidebar.js', 'components/Dashboard.js', 'lib/constants.js']

console.log('A. JUMLAH PEMERIKSAAN ROLE TIDAK BERKURANG')
for (const f of FILES) {
  let before = '', after = ''
  try {
    before = sh(['show', `origin/main:${f}`])
    after = sh(['show', `HEAD:${f}`]) // working tree via git stash tidak dipakai; bandingkan HEAD
  } catch (e) { /* abaikan */ }
  // Bandingkan working copy langsung:
  let cur = ''
  try {
    cur = execFileSync('cat', [f], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (e) { cur = '' }
  const count = (s) => (s.match(/role === 'admin'/g) || []).length
  const b = count(before)
  const c = count(cur)
  ok(`${f}: pemeriksaan role === 'admin' ${b} -> ${c} (tidak turun)`, c >= b && b > 0 || (b === 0 && c === 0),
     b === 0 && c === 0 ? '(tidak ada di file ini)' : `\n    origin/main=${b} sekarang=${c}`)
}

console.log('\nB. KOMPONEN LOGIN & GUARD ROUTE MASIH ADA')
const idx = execFileSync('cat', ['pages/index.js'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
ok('pages/index.js masih punya tampilan/login guard', /login|Login/.test(idx))
ok('pages/index.js masih punya guard role', /role === 'admin'|role !== 'admin'|role:/.test(idx))

console.log('\nC. TIDAK ADA PELEMAHAN AUTH DI lib/constants.js')
const cst = execFileSync('cat', ['lib/constants.js'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
ok('tidak ada bypass auth baru (skipAuth/allowAnonymous/NO_AUTH)', !/skipAuth|allowAnonymous|NO_AUTH|bypassAuth/i.test(cst))
ok('tidak ada flag "public" baru pada modul dinonaktifkan', !/isPublic\s*[:=]\s*true/.test(cst))
ok('modul dinonaktifkan TIDAK diberi rute publik baru', !/route\s*[:=]\s*['"]\/labor_stock|route\s*[:=]\s*['"]\/marketing/.test(cst))

console.log('\nD. TIDAK ADA PENAMBAHAN DAFTAR EMAIL/AKUN')
const all = execFileSync('git', ['diff', 'origin/main'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
ok('tidak ada penambahan email/allowlist akun di diff', !/^\+\s*['"][\w.+-]+@[\w.-]+\.[a-z]{2,}['"]/im.test(all))
ok('tidak ada penambahan UUID allowlist di diff', !/^\+\s*['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/im.test(all))

console.log('\nE. FILE AUTH LAIN IDENTIK DENGAN origin/main')
for (const f of ['lib/supabaseClient.js', 'middleware.js', 'lib/auth.js', 'lib/roles.js']) {
  try {
    const base = sh(['show', `origin/main:${f}`])
    const cur = execFileSync('cat', [f], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    ok(`${f} identik dengan origin/main`, base === cur)
  } catch (e) {
    console.log(`  --   ${f} tidak ada di repo (dilewati)`)
  }
}

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`)
process.exit(fail === 0 ? 0 : 1)
