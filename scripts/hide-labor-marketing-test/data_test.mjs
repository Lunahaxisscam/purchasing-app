// scripts/hide-labor-marketing-test/data_test.mjs
// JANGAN HAPUS DATA (t_6a18a263) — bukti berbasis git.
// Membandingkan working tree terhadap origin/main: patch ini hanya boleh
// menyentuh file NAVIGASI/UI. Tidak boleh ada perubahan pada file yang
// membaca/menulis data (tukang_projects, project_plans, customer, dll),
// tidak boleh ada migrasi baru, tidak boleh ada perubahan RLS/policy.
//
// Jalankan dari root repo: node scripts/hide-labor-marketing-test/data_test.mjs <repo>
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.argv[2] || process.cwd()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name) }
  else { fail++; console.log('  FAIL', name, extra) }
}

const sh = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

console.log('A. FILE YANG BERUAH (vs origin/main)')

let changed = []
try {
  const out = sh(['diff', '--name-only', 'origin/main', '--'])
  changed = out.split('\n').map(s => s.trim()).filter(Boolean)
} catch (e) {
  console.log('  (info) tidak bisa diff vs origin/main:', String(e).split('\n')[0])
}

// Daftar yang DIIZINKAN berubah: UI/navigasi + harness bukti + dokumentasi.
const ALLOWED_PREFIX = [
  'lib/constants.js',
  'components/Sidebar.js',
  'components/Dashboard.js',
  'pages/index.js',
  'pages/__smoke.js',
  'modules/registry.js',
  'scripts/hide-labor-marketing-test/',
  'docs/',
]
const forbidden = changed.filter(f => !ALLOWED_PREFIX.some(p => f === p || f.startsWith(p)))
ok(`hanya file UI/navigasi + harness yang berubah (${changed.length} file)`, forbidden.length === 0,
   forbidden.length ? `\n    berubah tak diizinkan: ${forbidden.join(', ')}` : '')
if (changed.length) console.log('    berubah:', changed.join(', '))

console.log('\nB. TIDAK ADA FILE DATA/MIGRASI/RLS YANG DITAMBAH/DIUBAH')
const risky = changed.filter(f =>
  /(^|\/)(migrations?|sql)\//.test(f) ||
  /\.sql$/i.test(f) ||
  /policy|rls/i.test(path.basename(f)) ||
  /(^|\/)(schema|seed)/i.test(path.basename(f))
)
ok('tidak ada migrasi/SQL/RLS/policy yang disentuh', risky.length === 0, risky.join(', '))

console.log('\nC. SUMBER DATA (tukang_projects, project_plans, customer) TIDAK DIUBAH')
// File yang membacanya harus BYTE-IDENTIK dengan origin/main.
const dataReaders = [
  'lib/laborSource.js',
  'components/ProjectFinance.js',
  'components/Planning.js',
  'components/Finance.js',
  'modules/labor-stock/logic.js',
  'modules/labor-stock/view.jsx',
  'modules/marketing/logic.js',
  'modules/marketing/view.jsx',
  'scripts/labor-stock-test/run.py',
  'scripts/marketing-test/run.py',
]
for (const f of dataReaders) {
  let same = true
  try {
    const head = execFileSync('git', ['show', `origin/main:${f}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const cur = fs.existsSync(path.join(REPO, f)) ? fs.readFileSync(path.join(REPO, f), 'utf8') : null
    same = cur === head
  } catch (e) { same = false }
  ok(`${f} identik dengan origin/main (data & logika modul utuh)`, same)
}

console.log('\nD. TIDAK ADA PERINTAH DELETE/DROP PADA BARIS YANG *DITAMBAHKAN*')
// Catatan: .delete() memang ADA di aplikasi (mis. hapus item PR) — itu
// fitur normal yang sudah ada sejak origin/main. Yang dilarang: patch ini
// MENAMBAHKAN perintah destruktif baru. Jadi uji baris '+' pada diff saja.
let all = ''
try {
  all = sh(['diff', 'origin/main', '--'])
} catch (e) { all = '' }
const added = all.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'))
const destructive = added.filter(l => /\.delete\(\)|DROP\s+TABLE|TRUNCATE|\.drop\(|\.remove\(\)/i.test(l))
ok(`tidak ada perintah destruktif baru di ${added.length} baris tambahan`, destructive.length === 0,
   destructive.slice(0, 3).join('\n    '))

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`)
process.exit(fail === 0 ? 0 : 1)
