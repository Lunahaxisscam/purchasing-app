// ============================================================
// WIRING/CONTRACT TEST — integrasi RAP ke shell (STATIS, tanpa render)
// t_71d95cfe (S3/7). Memastikan modul benar-benar terpasang sebagai halaman
// admin-only dan bahwa kontrak "nol tulisan DB" tidak dilanggar di sumber.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.env.RAP_REPO || process.cwd()
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const constants = read('lib/constants.js')
const registry = read('modules/registry.js')
const index = read('pages/index.js')
const smoke = read('pages/__smoke.js')
const view = read('modules/rap/view.jsx')
const model = read('modules/rap/model.js')
const bridge = read('modules/rap/budgetingBridge.js')
const store = read('modules/rap/store.js')

console.log('\n=== A. MENU & LABEL (lib/constants.js) ===')
check("A1 item menu 'rap' terdaftar di Admin Suite", /\['rap', 'RAP \(Rencana Pelaksanaan\)'\]/.test(constants))
check('A2 label halaman rap ada di labels', /rap:\s*'RAP \(Rencana Pelaksanaan\)'/.test(constants))
{
  // 'rap' harus berada di section adminOnly (setelah heading Admin Suite).
  const adminIdx = constants.indexOf("label: 'Admin Suite'")
  const rapIdx = constants.indexOf("['rap',")
  check('A3 menu rap berada di section Admin Suite (admin-only)', adminIdx > -1 && rapIdx > adminIdx)
}

console.log('\n=== B. REGISTRY (modules/registry.js) ===')
check("B1 modul 'rap' terdaftar", /id: 'rap'/.test(registry))
check('B2 adminOnly: true', /id: 'rap',[\s\S]{0,200}?adminOnly: true/.test(registry))
check("B3 source: 'core' (halaman sendiri, bukan ModuleView)", /id: 'rap',[\s\S]{0,200}?source: 'core'/.test(registry))
check('B4 files mencakup seluruh file modul + harness', ['modules/rap/view.jsx', 'modules/rap/model.js', 'modules/rap/budgetingBridge.js', 'modules/rap/store.js', 'scripts/rap-test/run.py'].every(f => registry.includes(f)))
check('B5 tidak didaftarkan sebagai moduleViewPages (source bukan module)', !/id: 'rap',[\s\S]{0,200}?source: 'module'/.test(registry))

console.log('\n=== C. SHELL RENDER (pages/index.js) ===')
check('C1 RapModule diimpor', /import RapModule from '\.\.\/modules\/rap\/view'/.test(index))
check("C2 ada cabang page === 'rap'", /page === 'rap' \?/.test(index))
{
  const m = index.match(/page === 'rap' \? \(([\s\S]*?)\n        \) : page === 'receivings'/)
  const block = m ? m[1] : ''
  check('C3 cabang rap di-guard role admin', /role === 'admin'/.test(block))
  check('C4 fallback non-admin "khusus administrator"', /khusus administrator/.test(block))
  check('C5 RapModule dirender dengan projects + say + setPage', /<RapModule/.test(block) && /projects=/.test(block) && /say=/.test(block))
}
check("C6 'rap' dikecualikan dari tombol Perbarui global", /'rap', 'settings'\]/.test(index))
check('C7 tidak menulis DB dari shell untuk RAP', !/from\('rap/i.test(index))

console.log('\n=== D. SMOKE BUILD MERENDER RAP (pages/__smoke.js) ===')
check('D1 RapModule diimpor di smoke', /import RapModule from '\.\.\/modules\/rap\/view'/.test(smoke))
check('D2 section #mod-rap dirender', /id="mod-rap"/.test(smoke))

console.log('\n=== E. KONTRAK NOL TULISAN DB (sumber modul) ===')
for (const [label, src] of [['view.jsx', view], ['model.js', model], ['budgetingBridge.js', bridge], ['store.js', store]]) {
  check(`E1 ${label}: tidak ada .insert(`, !/\.insert\s*\(/.test(src))
  check(`E2 ${label}: tidak ada .update(`, !/\.update\s*\(/.test(src))
  // `listeners.delete(...)` pada Set BUKAN tulisan DB — hanya chain PostgREST
  // yang dihitung. Semua tulisan DB di app ini berbentuk `supabase.from(...)`.
  const dbDelete = /supabase[\s\S]{0,80}?\.delete\s*\(/.test(src) || /\.from\([^)]*\)\s*\.delete\s*\(/.test(src)
  check(`E3 ${label}: tidak ada .delete( pada query DB`, !dbDelete)
  check(`E4 ${label}: tidak ada .rpc(`, !/\.rpc\s*\(/.test(src))
}
check('E5 model.js tidak mengimpor Supabase sama sekali', !/supabaseClient/.test(model))
check('E6 budgetingBridge hanya memakai satu select (read-only)', (bridge.match(/\.select\s*\(/g) || []).length === 1, String((bridge.match(/\.select\s*\(/g) || []).length))
check('E7 budgetingBridge membaca project_plans (bukan tabel RAP)', /from\('project_plans'\)/.test(bridge))
check('E8 view.jsx tidak memakai localStorage', !/localStorage/.test(view))
check('E9 tidak ada tabel rap di seluruh modul (tidak ada skema)', !/from\('rap/i.test(view + bridge + store + model))
check('E10 store menandai mode DRAFT_ONLY', /PERSISTENCE_MODE = 'DRAFT_ONLY'/.test(store))
check('E11 kapabilitas menyatakan canSave false', /canSave: false/.test(bridge))

console.log('\n=== F. TIDAK MENYENTUH FILE MODUL LAIN ===')
check('F1 view.jsx tidak mengimpor modules/requests/*', !/from '\.\.\/requests/.test(view))
check('F2 view.jsx tidak mengimpor modules/rab-boq/*', !/from '\.\.\/rab-boq/.test(view))
check('F3 tidak mengimpor shell (ModuleView/CreateModal/pages)', !/from '[^']*(ModuleView|CreateModal|pages\/index)/.test(view))
check('F4 tidak ada migrasi baru untuk RAP', !fs.existsSync(path.join(REPO, 'migrations')) || !fs.readdirSync(path.join(REPO, 'migrations')).some(f => /rap/i.test(f)))

console.log(`\n=== HASIL WIRING: ${pass} lulus, ${fail} gagal ===`)
if (fail) {
  console.log('Gagal:')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
