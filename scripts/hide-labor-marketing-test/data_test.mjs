// scripts/hide-labor-marketing-test/data_test.mjs
// JANGAN HAPUS DATA (t_6a18a263) — bukti berbasis git.
// Membandingkan working tree terhadap titik cabang dari origin/main: patch
// ini hanya boleh menyentuh file NAVIGASI/UI. Tidak boleh ada perubahan
// pada file yang membaca/menulis data (tukang_projects, project_plans,
// customer, dll), tidak boleh ada migrasi baru, tidak boleh ada perubahan
// RLS/policy.
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

// BASE = titik percabangan dari origin/main (merge-base), bukan origin/main
// langsung. Setelah perubahan di-commit, `git diff origin/main` masih
// bekerja, tapi memakai merge-base membuat harness ini tetap benar baik
// saat working tree masih kotor maupun setelah di-commit.
let BASE = 'origin/main'
try {
  BASE = sh(['merge-base', 'origin/main', 'HEAD']).trim() || 'origin/main'
} catch (e) {
  console.log('  (info) merge-base gagal, pakai origin/main langsung')
}
console.log(`A. FILE YANG BERUBAH (vs ${BASE} = titik cabang dari origin/main)`)

let changed = []
try {
  const out = sh(['diff', '--name-only', BASE, '--'])
  changed = out.split('\n').map(s => s.trim()).filter(Boolean)
} catch (e) {
  console.log('  (info) tidak bisa diff vs base:', String(e).split('\n')[0])
}

// Daftar yang DIIZINKAN berubah: UI/navigasi + harness bukti + dokumentasi.
// Entri per-file di bawah hanya untuk file yang SUDAH di-review manual.
// Tidak ada allow-all direktori scripts/ — hanya file yang benar-benar
// diperiksa isinya (lihat bagian E untuk audit assertion-nya).
const ALLOWED_EXACT = new Set([
  // ——— produksi: UI/navigasi ———
  'lib/constants.js',
  'components/Sidebar.js',
  'components/Dashboard.js',
  'pages/index.js',
  'pages/__smoke.js',
  'modules/registry.js',
  // ——— harness bukti khusus t_6a18a263 ———
  'scripts/hide-labor-marketing-test/run.py',
  'scripts/hide-labor-marketing-test/compile_sandbox.mjs',
  'scripts/hide-labor-marketing-test/policy_test.mjs',
  'scripts/hide-labor-marketing-test/render_test.mjs',
  'scripts/hide-labor-marketing-test/guard_test.mjs',
  'scripts/hide-labor-marketing-test/data_test.mjs',
  'scripts/hide-labor-marketing-test/authguard_test.mjs',
  // ——— regresi existing yang DIREVIEW (bukan allow-all) ———
  // t_6a18a263: hanya menambah turunan jumlah menu dari kebijakan
  // (LABOR_STOCK_MODULE_ENABLED / MARKETING_MODULE_ENABLED) + assertion
  // teks modul nonaktif tidak dirender. Assertion lama tidak dihapus;
  // sweep render 22 modul tetap berjalan penuh.
  'scripts/all-modules-compact-test/all_modules_test.mjs',
  // t_6a18a263: EXPECTED_MENU ikut kebijakan 2 modul baru + 2 assertion
  // isModuleVisible(). Sisa harness Approval OFF tidak berubah.
  'scripts/approval-off-test/logic_test.mjs',
  // t_6a18a263: EXPECTED_NAV ikut kebijakan 2 modul baru. Assertion role
  // user tetap 7 (labor_stock & marketing adminOnly — lihat bagian E).
  'scripts/approval-off-test/render_test.mjs',
])
const ALLOWED_PREFIX = ['docs/']
const forbidden = changed.filter(f => !ALLOWED_EXACT.has(f) && !ALLOWED_PREFIX.some(p => f.startsWith(p)))
ok(`hanya file UI/navigasi + harness yang berubah (${changed.length} file)`, forbidden.length === 0,
   forbidden.length ? `\n    berubah tak diizinkan: ${forbidden.join(', ')}` : '')
if (changed.length) console.log('    berubah:', changed.join(', '))

console.log('\nB. TIDAK ADA FILE DATA/MIGRASI/RLS YANG DITAMBAH/DIUBAH')
// Deteksi mutasi DB berbasis SEMANTIK & LOKASI file, bukan nama file:
//   * path migrasi/SQL nyata (migrations/, *.sql), atau
//   * file schema/seed, atau
//   * diff NYATA menambah pernyataan DDL/DCL/RLS pada baris KODE.
// File test yang membahas kebijakan (mis. .../policy_test.mjs) TIDAK
// dihitung sebagai migrasi — namanya bukan semantiknya.
const riskyPath = changed.filter(f =>
  /(^|\/)(migrations?|sql)\//.test(f) ||
  /\.sql$/i.test(f) ||
  /(^|\/)(schema|seed)[^/]*$/i.test(f)
)
ok('tidak ada file migrasi/SQL/schema/seed yang disentuh', riskyPath.length === 0, riskyPath.join(', '))

// Pola DDL/DCL/RLS dan operasi destruktif runtime.
const ddlRe = /\b(create\s+(or\s+replace\s+)?(table|policy|index|function|trigger|type|view)|alter\s+(table|policy)|drop\s+(table|policy|index|function|trigger)|truncate\s+table|grant\s+|revoke\s+|create\s+policy)\b/i
const destructiveRe = /\.delete\s*\(|\.drop\s*\(|\.remove\s*\(|\bTRUNCATE\b/i

// Pembersih baris: buang komentar, literal regex, dan literal string —
// supaya pola di atas hanya dinasikan pada KODE YANG BENAR-BENAR BERJALAN,
// bukan pada komentar/contoh di dalam harness. Tanpa ini, file uji yang
// MENYEBUT pola destruktif akan mendeklarasikan dirinya sendiri salah.
const stripNonCode = (line) => {
  let s = line.replace(/^\+\s?/, '')
  s = s.replace(/\/\/.*$/, '')                       // komentar baris
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ')            // komentar blok satu baris
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''")          // literal string
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""')
  s = s.replace(/`(?:\\.|[^`\\])*`/g, '``')
  s = s.replace(/\/(?:\\.|[^/\\\n])+\/[gimsuy]*/g, 'REGEX') // literal regex
  return s
}
const isCodeLine = (line) => {
  const t = stripNonCode(line).trim()
  return t.length > 0
}

// Klasifier harus terbukti bekerja (kasus positif & negatif) supaya tidak
// ada loophole diam-diam: mutasi NYATA tetap harus terdeteksi.
const scannerCases = [
  { name: 'pemanggilan destruktif nyata terdeteksi', re: destructiveRe, sample: "await supabase.from('pr_items').delete().eq('id', id)", want: true },
  { name: 'DROP TABLE nyata terdeteksi', re: ddlRe, sample: 'DROP TABLE tukang_projects', want: true },
  { name: 'CREATE POLICY nyata terdeteksi', re: ddlRe, sample: 'CREATE POLICY p ON tukang_projects FOR SELECT USING (true)', want: true },
  { name: 'komentar yang menyebut .delete() TIDAK dihitung', re: destructiveRe, sample: '// Catatan: .delete() memang ADA di aplikasi (mis. hapus item PR)', want: false },
  { name: 'literal regex harness TIDAK dihitung', re: destructiveRe, sample: 'const destructiveRe = /\\.delete\\s*\\(|DROP\\s+TABLE/i', want: false },
  { name: 'string contoh DDL di harness TIDAK dihitung', re: ddlRe, sample: "ok('pola DDL mengenali migrasi nyata CREATE POLICY', ddlRe.test('CREATE POLICY p ON x'))", want: false },
  { name: 'nama file test policy_test.mjs TIDAK dihitung', re: ddlRe, sample: 'scripts/hide-labor-marketing-test/policy_test.mjs', want: false },
]
for (const c of scannerCases) {
  ok(`scanner: ${c.name}`, c.re.test(stripNonCode(c.sample)) === c.want)
}

// Pindai diff NYATA per file: hanya baris '+' yang masih berupa KODE
// setelah dibersihkan dari komentar/string/regex-literal.
let scannedFiles = 0, addedTotal = 0, addedCodeTotal = 0
const ddlHits = [], destructiveHits = []
for (const f of changed) {
  let fileDiff = ''
  try { fileDiff = sh(['diff', BASE, '--', f]) } catch (e) { continue }
  const added = fileDiff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'))
  if (!added.length) continue
  scannedFiles += 1
  addedTotal += added.length
  for (const l of added) {
    if (!isCodeLine(l)) continue
    addedCodeTotal += 1
    const s = stripNonCode(l)
    if (ddlRe.test(s)) ddlHits.push(`${f}: ${s.trim()}`)
    if (destructiveRe.test(s)) destructiveHits.push(`${f}: ${s.trim()}`)
  }
}
console.log(`    (dipindai ${scannedFiles} file: ${addedTotal} baris '+', ${addedCodeTotal} baris kode)`)
ok('tidak ada DDL/DCL/RLS baru pada baris kode yang ditambahkan', ddlHits.length === 0,
   ddlHits.slice(0, 3).join('\n    '))
ok(`tidak ada operasi destruktif baru pada ${addedCodeTotal} baris kode tambahan`, destructiveHits.length === 0,
   destructiveHits.slice(0, 3).join('\n    '))

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
    const head = execFileSync('git', ['show', `${BASE}:${f}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const cur = fs.existsSync(path.join(REPO, f)) ? fs.readFileSync(path.join(REPO, f), 'utf8') : null
    same = cur === head
  } catch (e) { same = false }
  ok(`${f} identik dengan origin/main (data & logika modul utuh)`, same)
}

console.log('\nD. EKSPEKTASI JUMLAH MENU DIHITUNG DARI KEBIJAKAN (bukan angka mati)')
// t_6a18a263: labor_stock & marketing adminOnly — toggle flag admin TIDAK
// boleh mengubah jumlah menu role user. Audit assertion pada file test yang
// di-review terhadap perilaku nyata (bukan sekadar menyesuaikan angka).
const constantsSrc = (() => {
  try { return fs.readFileSync(path.join(REPO, 'lib', 'constants.js'), 'utf8') } catch (e) { return '' }
})()
const adminOnlyIds = (() => {
  const i = constantsSrc.indexOf('adminOnly: true')
  if (i < 0) return []
  const seg = constantsSrc.slice(i, constantsSrc.indexOf('\n]', i))
  return [...seg.matchAll(/\['([a-z_]+)',\s*'[^']*'\]/g)].map(x => x[1])
})()
ok('section adminOnly memuat labor_stock & marketing (modul admin-only)',
   adminOnlyIds.includes('labor_stock') && adminOnlyIds.includes('marketing'),
   `adminOnly=${adminOnlyIds.join(',')}`)
const allModulesSrc = (() => {
  try { return fs.readFileSync(path.join(REPO, 'scripts', 'all-modules-compact-test', 'all_modules_test.mjs'), 'utf8') } catch (e) { return '' }
})()
ok('all_modules_test: expectedUser TIDAK mengurangi flag modul admin-only',
   /const expectedUser = 8 - \(APPROVAL_ON \? 0 : 1\)\s*\n/.test(allModulesSrc),
   'expectedUser hanya bergantung kebijakan approval (labor/marketing adminOnly)')
ok('all_modules_test: expectedAdmin tetap mengurangi 2 modul yang dinonaktifkan',
   /const expectedAdmin = 21[\s\S]{0,220}?\(LABOR_STOCK_ON \? 0 : 1\)[\s\S]{0,80}?\(MARKETING_ON \? 0 : 1\)/.test(allModulesSrc))
ok('approval-off render_test: assertion role user tetap 7 (adminOnly difilter)',
   /R1f Sidebar user: 7 item operasional/.test(
     (() => { try { return fs.readFileSync(path.join(REPO, 'scripts', 'approval-off-test', 'render_test.mjs'), 'utf8') } catch (e) { return '' } })()))

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`)
process.exit(fail === 0 ? 0 : 1)
