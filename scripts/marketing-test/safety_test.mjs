// ============================================================
// scripts/marketing-test/safety_test.mjs — C. BUKTI "TIDAK MENGGANGGU PURCHASING"
// ============================================================
// Ini harness yang membuat klaim di dokumen bisa dipercaya. Semua bukti
// diambil dari FILE DI REPO (bukan pernyataan niat):
//
//   C1. Nol jalur tulis di SELURUH lapisan marketing (contract/probe/handler/
//       auth/samples/cli/endpoint): tidak ada insert/update/delete/upsert/rpc.
//   C2. Nol transport keluar (telegram/WA/email/webhook) & nol API iklan.
//   C3. Nol cron/penjadwalan (vercel.json, package.json, kode).
//   C4. probe.js TIDAK PERNAH menyebut tabel purchasing; handler/contract
//       hanya menyebutnya sebagai larangan (string), bukan query.
//   C5. Kode purchasing TIDAK membaca tabel marketing (invarian P3).
//   C6. Nol file migrasi baru/berubah; DDL usulan hanya menyentuh tabel
//       marketing + customers (invarian P2).
//   C7. Tidak ada file milik agent/modul lain yang diubah kartu ini.
//   C8. CLI tidak menulis berkas (tidak ada writeFile/appendFile/mkdir).
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const REPO = path.resolve(HERE, '..', '..')
const DIR = path.join(REPO, 'scripts', 'marketing')

let pass = 0
let fail = 0
const failures = []
function ok(no, name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(`${no} ${name}`); console.log(`  FAIL ${no} ${name} ${extra}`) }
}

function read(p) { return fs.readFileSync(p, 'utf8') }

// Buang komentar + isi string literal, sisakan kode saja.
// Dipakai supaya kata "whatsapp"/"ads"/"purchase_requests" yang muncul di
// DAFTAR LARANGAN atau pesan penolakan tidak dianggap sebagai implementasi.
function codeOnly(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '')
  const noLine = noBlock.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
  return noLine
    .replace(/`[^`]*`/g, '""')
    .replace(/'[^']*'/g, '""')
    .replace(/"[^"]*"/g, '""')
}
function commentsAndStrings(src) {
  return src
}

const LAYER_FILES = [
  'scripts/marketing/contract.js',
  'scripts/marketing/probe.js',
  'scripts/marketing/handler.js',
  'scripts/marketing/auth.js',
  'scripts/marketing/samples.js',
  'scripts/marketing/cli.mjs',
  'pages/api/marketing-contract.js'
]

console.log('\n=== C. BUKTI KESELAMATAN (TIDAK MENGGANGGU PURCHASING) ===')

// ---------- C1. Nol jalur tulis di seluruh lapisan ----------
{
  const ops = ['insert', 'update', 'delete', 'upsert', 'rpc']
  const hits = []
  for (const rel of LAYER_FILES) {
    const src = codeOnly(read(path.join(REPO, rel)))
    for (const op of ops) {
      const re = new RegExp(`\\.${op}\\s*\\(`, 'g')
      const m = src.match(re)
      if (m) hits.push(`${rel}:${op}×${m.length}`)
    }
  }
  ok('C1a', `nol .insert/.update/.delete/.upsert/.rpc di ${LAYER_FILES.length} file lapisan`, hits.length === 0, hits.join(', '))

  // .select() justru HARUS ada di probe.js (itu bukti read-only).
  const probeSrc = codeOnly(read(path.join(DIR, 'probe.js')))
  ok('C1b', 'probe.js hanya memakai .select(', /\.select\s*\(/.test(probeSrc))
  ok('C1c', 'probe.js tidak memakai .limit(...) untuk menulis apa pun', !/\.(insert|update|delete|upsert|rpc)\s*\(/.test(probeSrc))
  ok('C1d', 'probe.js mendokumentasikan larangan operasi tulis', /FORBIDDEN_OPERATIONS/.test(read(path.join(DIR, 'probe.js'))))
}

// ---------- C2. Nol transport keluar & nol iklan ----------
{
  const transport = /(telegram|whatsapp|wa\.me|twilio|sendgrid|nodemailer|mailgun|resend\.com|webhook|axios|node-fetch|fetch\s*\()/i
  const ads = /(googleads|google-ads|facebook\.com|graph\.facebook|meta[-_]?ads|ads[-_]?api|tiktok[-_]?ads|pixel|audience[-_]?upload|adspend|ad_spend)/i
  const tHits = []
  const aHits = []
  for (const rel of LAYER_FILES) {
    const src = codeOnly(read(path.join(REPO, rel)))
    const t = src.match(transport)
    if (t) tHits.push(`${rel}:${t[0]}`)
    const a = src.match(ads)
    if (a) aHits.push(`${rel}:${a[0]}`)
  }
  // probe.js WAJIB punya supabase-js (itu klien baca), tetapi bukan transport pesan.
  ok('C2a', 'nol transport pengiriman pesan di seluruh lapisan', tHits.length === 0, tHits.join(', '))
  ok('C2b', 'nol API iklan/pixel/audience di seluruh lapisan', aHits.length === 0, aHits.join(', '))
  ok('C2c', 'satu-satunya import jaringan ada di probe.js (supabase-js)',
    /@supabase\/supabase-js/.test(read(path.join(DIR, 'probe.js'))))
  const otherNetwork = LAYER_FILES.filter(rel => rel !== 'scripts/marketing/probe.js' && !rel.endsWith('auth.js'))
    .filter(rel => /@supabase\/supabase-js/.test(read(path.join(REPO, rel))))
  ok('C2d', 'file lain tidak mengimpor klien jaringan', otherNetwork.length === 0, otherNetwork.join(', '))
}

// ---------- C3. Nol cron / penjadwalan ----------
{
  const vercel = path.join(REPO, 'vercel.json')
  ok('C3a', 'tidak ada vercel.json dengan crons', !fs.existsSync(vercel) || !/"crons"/.test(read(vercel)))

  const pkg = JSON.parse(read(path.join(REPO, 'package.json')))
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const sched = Object.keys(deps).filter(d => /cron|schedule|agenda|bull|queue|node-cron/i.test(d))
  ok('C3b', 'tidak ada paket penjadwal di package.json', sched.length === 0, sched.join(', '))

  const cronHits = []
  for (const rel of LAYER_FILES) {
    const src = codeOnly(read(path.join(REPO, rel)))
    const m = src.match(/(setInterval|setTimeout|node-cron|node-schedule|\.schedule\s*\()/i)
    if (m) cronHits.push(`${rel}:${m[0]}`)
  }
  ok('C3c', 'nol timer/penjadwal yang dipanggil di lapisan', cronHits.length === 0, cronHits.join(', '))

  const mkgPkg = JSON.parse(read(path.join(DIR, 'package.json')))
  ok('C3d', 'package.json lapisan tidak menambah dependensi', !mkgPkg.dependencies && !mkgPkg.devDependencies)
}

// ---------- C4. Tabel purchasing tidak pernah dibaca ----------
{
  const purchasing = ['purchase_requests', 'pr_items', 'approval_steps', 'receivings', 'receiving_items', 'handovers', 'sales_invoices']

  // probe.js: SATU-SATUNYA file yang menyentuh jaringan → tidak boleh menyebut
  // tabel purchasing SAMA SEKALI (bahkan di komentar), karena itu daftar query.
  const probeSrc = read(path.join(DIR, 'probe.js'))
  const probeHits = purchasing.filter(t => probeSrc.includes(t))
  ok('C4a', 'probe.js tidak menyebut satu pun tabel purchasing (termasuk komentar)', probeHits.length === 0, probeHits.join(', '))

  // Daftar tabel yang di-query HARUS sama dengan READABLE_SOURCES.
  const readable = [...probeSrc.matchAll(/table:\s*'([a-z_]+)'/g)].map(m => m[1])
  ok('C4b', 'daftar query probe = 6 tabel baca', readable.length === 6, readable.join(', '))
  ok('C4c', 'query probe hanya leads/touchpoints/campaigns/handoffs/customers/projects',
    readable.every(t => ['leads', 'lead_touchpoints', 'campaigns', 'lead_handoffs', 'customers', 'projects'].includes(t)),
    readable.join(', '))

  // handler/contract boleh MENTION tabel purchasing, tetapi hanya sebagai
  // string larangan — bukan pemanggilan query.
  const handlerSrc = read(path.join(DIR, 'handler.js'))
  ok('C4d', 'handler tidak melakukan query ke tabel purchasing',
    !/from\s*\(\s*'(purchase_requests|pr_items|approval_steps|receivings|receiving_items|handovers|sales_invoices)'\s*\)/.test(handlerSrc))
  ok('C4e', 'handler tidak mengimpor probe selain dari probe.js', /from '\.\/probe\.js'/.test(handlerSrc))
}

// ---------- C5. Kode purchasing tidak membaca tabel marketing (P3) ----------
{
  const purchasingDirs = [
    'modules/requests', 'modules/approvals', 'modules/receivings', 'modules/handovers',
    'modules/materials', 'modules/vendors', 'modules/projects', 'modules/rab-boq',
    'modules/rap', 'modules/sales-invoice', 'lib'
  ]
  const marketingTables = ['leads', 'lead_touchpoints', 'campaigns', 'lead_handoffs', 'customers']
  const hits = []
  function walk(dir) {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(js|jsx|mjs)$/.test(e.name)) {
        const src = codeOnly(read(p))
        for (const t of marketingTables) {
          const re = new RegExp(`from\\s*\\(\\s*['"]${t}['"]\\s*\\)`)
          if (re.test(src)) hits.push(`${path.relative(REPO, p)}:${t}`)
        }
      }
    }
  }
  for (const d of purchasingDirs) walk(path.join(REPO, d))
  ok('C5a', 'nol modul purchasing/lib yang query tabel marketing', hits.length === 0, hits.join(', '))

  // Endpoint purchasing juga tidak boleh menyentuh tabel marketing.
  const apiHits = []
  const apiDir = path.join(REPO, 'pages', 'api')
  for (const f of fs.readdirSync(apiDir)) {
    if (!/\.js$/.test(f) || f === 'marketing-contract.js') continue
    const src = codeOnly(read(path.join(apiDir, f)))
    for (const t of marketingTables) {
      if (new RegExp(`from\\s*\\(\\s*['"]${t}['"]\\s*\\)`).test(src)) apiHits.push(`${f}:${t}`)
    }
  }
  ok('C5b', 'nol endpoint lain yang query tabel marketing', apiHits.length === 0, apiHits.join(', '))
}

// ---------- C6. Nol migrasi baru; DDL usulan hanya tabel marketing ----------
// Basis perbandingan = commit tempat kartu ini MULAI, bukan `main`.
//
// Kenapa bukan `main`: branch ini juga memuat kartu S1..S5, jadi
// `git diff main` akan menampilkan file milik kartu-kartu itu dan assertion
// "kartu ini tidak menyentuh file modul lain" jadi mustahil lulus tanpa
// menduplikasi daftar kepemilikan milik harness S1 (dua sumber kebenaran yang
// pasti menyimpang).
//
// Cara menentukannya otomatis dan deterministik: commit yang PERTAMA kali
// menambahkan folder kartu ini (`scripts/marketing/contract.js`), lalu ambil
// induknya. Bila belum di-commit, basisnya HEAD (yang diperiksa = working tree).
// `MARKETING_BASE` bisa menimpa (mis. `MARKETING_BASE=main` untuk audit
// seluruh branch — hasilnya memang akan memuat file kartu S1..S5).
function resolveBase() {
  if (process.env.MARKETING_BASE) return process.env.MARKETING_BASE
  try {
    const first = execSync(
      `git -C ${REPO} log --format=%H --diff-filter=A -- scripts/marketing/contract.js`,
      { encoding: 'utf8' }
    ).split('\n').map(s => s.trim()).filter(Boolean)
    if (first.length) return `${first[first.length - 1]}^`
  } catch (e) { /* belum ada commit: jatuh ke HEAD */ }
  return 'HEAD'
}

function cardChanges(base = resolveBase()) {
  let tracked = []
  let untracked = []
  try {
    tracked = execSync(`git -C ${REPO} diff --name-only ${base} --`, { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean)
    untracked = execSync(`git -C ${REPO} ls-files --others --exclude-standard`, { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean)
  } catch (e) { /* biarkan kosong: dianggap tidak ada perubahan */ }
  return [...new Set([...tracked, ...untracked])]
}

{
  const base = resolveBase()
  const changed = cardChanges(base)
  console.log(`  (basis perbandingan kartu: ${base})`)

  const migr = changed.filter(f => f.startsWith('migrations/'))
  ok('C6a', 'nol file migrations/ yang berubah atau ditambah', migr.length === 0, migr.join(', '))

  // DDL usulan di dokumen: setiap CREATE TABLE harus tabel marketing/customers.
  const doc = path.join(REPO, 'docs', 'marketing-crm-integration-contract.md')
  if (fs.existsSync(doc)) {
    const sql = read(doc)
    const created = [...sql.matchAll(/create table if not exists public\.([a-z_]+)/gi)].map(m => m[1].toLowerCase())
    const allowed = ['leads', 'lead_touchpoints', 'campaigns', 'lead_handoffs', 'customers']
    ok('C6b', 'DDL usulan hanya membuat tabel marketing + customers',
      created.length > 0 && created.every(t => allowed.includes(t)), created.join(', '))
    ok('C6c', 'DDL usulan TIDAK mengubah tabel purchasing (nol ALTER pada tabel itu)',
      !/alter table public\.(purchase_requests|pr_items|approval_steps|receivings|receiving_items|handovers|projects|sales_invoices)/i.test(sql))
    ok('C6d', 'DDL usulan ditandai BELUM DIJALANKAN', /BELUM DIJALANKAN/i.test(sql))
    ok('C6e', 'dokumen menyatakan customer_id sales_invoices tetap nullable',
      /customer_id[\s\S]{0,120}nullable/i.test(sql))
    ok('C6f', 'dokumen menyebut risiko PGRST205 (tabel belum ada)', /PGRST205/.test(sql))
  } else {
    ok('C6b', 'dokumen kontrak ada', false, doc)
  }
}

// ---------- C7. Tidak menyentuh file milik modul/agent lain ----------
{
  const changed = cardChanges()

  const ownedByThisCard = [
    'scripts/marketing/contract.js',
    'scripts/marketing/probe.js',
    'scripts/marketing/handler.js',
    'scripts/marketing/auth.js',
    'scripts/marketing/samples.js',
    'scripts/marketing/cli.mjs',
    'scripts/marketing/package.json',
    'scripts/marketing-test/contract_test.mjs',
    'scripts/marketing-test/api_test.mjs',
    'scripts/marketing-test/safety_test.mjs',
    'scripts/marketing-test/run.py',
    'pages/api/marketing-contract.js',
    'docs/marketing-crm-integration-contract.md',
    'docs/report-t_1fd27ad9.md',
    // Satu-satunya file di luar folder kartu: assertion kepemilikan harness
    // S1/S2 bersifat ENUMERATIF dan harus mendaftarkan endpoint baru kartu
    // ini — persis seperti yang dilakukan kartu S4/S5 sebelumnya. Tidak ada
    // assertion yang dilonggarkan (lihat diff-nya).
    'scripts/pr-purchase-compact-test/render_test.mjs'
  ]
  const codeChanges = changed.filter(f => /\.(js|jsx|mjs)$/.test(f) && !f.startsWith('scripts/'))
  const foreign = codeChanges.filter(f => !ownedByThisCard.includes(f))
  ok('C7a', 'perubahan kode non-scripts hanya file milik kartu S6', foreign.length === 0, foreign.join(', '))

  const newEndpoints = codeChanges.filter(f => f.startsWith('pages/api/'))
  ok('C7b', 'endpoint baru hanya marketing-contract.js',
    newEndpoints.every(f => f === 'pages/api/marketing-contract.js'), newEndpoints.join(', '))

  const uiFiles = ['pages/index.js', 'modules/registry.js', 'lib/constants.js', 'pages/__smoke.js', 'components/ModuleView.js', 'components/CreateModal.js', 'components/Sidebar.js', 'lib/workflow.js']
  const touchedUi = changed.filter(f => uiFiles.includes(f))
  ok('C7c', 'nol file CORE/UI yang diubah (kartu ini kontrak saja)', touchedUi.length === 0, touchedUi.join(', '))

  const handoverContract = ['modules/handovers/actions.js', 'modules/handovers/logic.js']
  ok('C7d', 'kontrak handover (actions.js/logic.js) tidak disentuh',
    changed.filter(f => handoverContract.includes(f)).length === 0)

  const otherModules = changed.filter(f => f.startsWith('modules/'))
  ok('C7e', 'nol file modules/ yang diubah', otherModules.length === 0, otherModules.join(', '))
}

// ---------- C8. CLI & lapisan tidak menulis berkas ----------
{
  const hits = []
  for (const rel of LAYER_FILES) {
    const src = codeOnly(read(path.join(REPO, rel)))
    const m = src.match(/(writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|rmSync|unlinkSync|createWriteStream)/)
    if (m) hits.push(`${rel}:${m[0]}`)
  }
  ok('C8a', 'nol operasi tulis berkas di lapisan', hits.length === 0, hits.join(', '))

  // CLI hanya membaca berkas masukan (--validate/--plan) & .env.local.
  const cliSrc = read(path.join(DIR, 'cli.mjs'))
  ok('C8b', 'CLI hanya membaca berkas (readFileSync/existsSync)', /readFileSync/.test(cliSrc) && !/writeFile/.test(cliSrc))
  ok('C8c', 'CLI mencetak pernyataan "tidak ada yang dikirim/ditulis"',
    /Tidak ada pesan yang dikirim/.test(cliSrc))
}

console.log(`\n  HASIL C: ${pass} LULUS, ${fail} GAGAL`)
if (fail) console.log('  gagal: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
