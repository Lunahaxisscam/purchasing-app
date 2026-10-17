// ============================================================
// WIRING INTEGRASI (t_35cd0354) — STATIS, tanpa render
// ============================================================
// Membuktikan modul RAP / Perbandingan RAB-RAP-Aktual / Stok Workshop /
// Customer CRM benar-benar TERHUBUNG setelah semua branch digabung:
//   * ada di navSections (menu bisa diklik, bukan rute tersembunyi),
//   * ada di labels (judul halaman tidak undefined),
//   * terdaftar di registry dengan adminOnly + source:'core',
//   * punya cabang render di pages/index.js dengan guard role admin,
//   * diimpor di pages/index.js (bukan stub),
//   * dirender di /__smoke (build benar-benar menyentuh komponennya).
// Plus: modul lama TIDAK hilang (regresi wiring).
// ============================================================
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.env.INTEG_REPO || process.cwd()
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
const sidebar = read('components/Sidebar.js')
const dashboard = read('components/Dashboard.js')

console.log('\n=== A. MENU & LABEL (rute bisa dibuka user) ===')
for (const id of ['rap', 'rap_compare', 'stock', 'crm']) {
  check(`A: '${id}' ada di navSections (menu terlihat)`,
    new RegExp(`\\['${id}',\\s*'`).test(constants))
  check(`A: labels.${id} ada (judul halaman tidak undefined)`,
    new RegExp(`${id}:\\s*'`).test(constants))
}
check('A: nav lama tetap ada (projects/vendors/materials/requests/approvals/receivings/handovers)',
  ['projects', 'vendors', 'materials', 'requests', 'approvals', 'receivings', 'handovers']
    .every(id => new RegExp(`\\['${id}',\\s*'`).test(constants)))
check('A: nav admin lama tetap ada (rab_boq/sales_invoice/planning/project_finance/finance/tukang_upah/settings)',
  ['rab_boq', 'sales_invoice', 'planning', 'project_finance', 'finance', 'tukang_upah', 'settings']
    .every(id => new RegExp(`\\['${id}',\\s*'`).test(constants)))
check('A: rute lama past_projects tetap terdaftar di labels (bookmark lama)',
  /past_projects:\s*'/.test(constants))

console.log('\n=== B. REGISTRY (adminOnly + source core) ===')
for (const id of ['rap', 'rap_compare', 'stock', 'crm']) {
  const re = new RegExp(`id: '${id}'[\\s\\S]{0,400}?adminOnly: true[\\s\\S]{0,200}?source: 'core'`)
  check(`B: registry ${id} adminOnly + source:'core'`, re.test(registry))
}
check('B: registry tidak menghapus modul lama',
  ['projects', 'vendors', 'materials', 'requests', 'approvals', 'receivings', 'handovers', 'rab_boq', 'sales_invoice', 'settings']
    .every(id => new RegExp(`id: '${id}'`).test(registry)))

console.log('\n=== C. PAGES/INDEX (cabang render + guard admin) ===')
for (const [id, comp] of [['rap', 'RapModule'], ['rap_compare', 'RapCompareModule'], ['stock', 'StockModule'], ['crm', 'CrmModule']]) {
  check(`C: ${comp} diimpor di pages/index.js`, new RegExp(`import ${comp} from`).test(index))
  const m = index.match(new RegExp(`page === '${id}' \\? \\(([\\s\\S]*?)\\n        \\) : page === `))
  const block = m ? m[1] : ''
  check(`C: cabang page === '${id}' ada`, !!m)
  check(`C: cabang ${id} di-guard role admin`, /role === 'admin'/.test(block))
  check(`C: cabang ${id} punya fallback "khusus administrator"`, /khusus administrator/.test(block))
  check(`C: cabang ${id} merender <${comp}`, new RegExp(`<${comp}`).test(block))
}
check('C: cabang lama tidak hilang (rab_boq, sales_invoice, planning, finance, receivings)',
  ['rab_boq', 'sales_invoice', 'planning', 'finance', 'receivings']
    .every(id => new RegExp(`page === '${id}' \\?`).test(index)))

console.log('\n=== D. SMOKE (komponen benar-benar dirender saat build) ===')
for (const [id, comp] of [['mod-rap', 'RapModule'], ['mod-sales-invoice', 'SalesInvoiceModule'], ['mod-rap-compare', 'RapCompareModule'], ['mod-stock', 'StockModule'], ['mod-crm', 'CrmModule']]) {
  check(`D: /__smoke punya section #${id}`, new RegExp(`id="${id}"`).test(smoke))
  check(`D: section #${id} merender <${comp}>`, new RegExp(`<${comp}`).test(smoke))
}
check('D: /__smoke tetap 404 tanpa ENABLE_SMOKE=1', /ENABLE_SMOKE !== '1'/.test(smoke) && /notFound: true/.test(smoke))

console.log('\n=== E. DASHBOARD SHORTCUT (modul baru punya pintu masuk) ===')
for (const id of ['rap', 'rap_compare', 'stock', 'crm']) {
  check(`E: kartu dashboard ${id} ada`, new RegExp(`\\['${id}',`).test(dashboard))
}

console.log('\n=== F. TIDAK ADA STUB / KLAIM PALSU ===')
check('F: pages/index.js tidak menulis tabel baru (rap/stock/crm)',
  !/from\('(rap|rap_versions|stock|stock_movements|customers)'/i.test(index))
check('F: modul CRM tidak menulis DB', !/\.(insert|update|delete|upsert)\(/.test(read('modules/crm/view.jsx')) && !/\.(insert|update|delete|upsert)\(/.test(read('modules/crm/logic.js')))
check('F: modul Stock tidak menulis DB', !/\.(insert|update|delete|upsert)\(/.test(read('modules/stock/view.jsx')) && !/\.(insert|update|delete|upsert)\(/.test(read('modules/stock/logic.js')))
check('F: modul rap-compare tidak menulis DB', !/\.(insert|update|delete|upsert)\(/.test(read('modules/rap-compare/view.jsx')) && !/\.(insert|update|delete|upsert)\(/.test(read('modules/rap-compare/logic.js')))

console.log(`\nwiring_integration_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
process.exit(fail ? 1 : 0)
