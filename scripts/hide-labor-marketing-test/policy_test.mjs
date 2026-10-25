// scripts/hide-labor-marketing-test/policy_test.mjs
// Kebijakan terpusat (t_6a18a263) — dibaca dari SUMBER TERKOMPILASI.
// Memakai file asli lib/constants.mjs di sandbox, BUKAN salinan logika.
import {
  navSections, allModules, visibleNavSections,
  isModuleVisible, isNavModuleDisabled,
  isLaborStockEnabled, isMarketingEnabled,
  isApprovalEnabled, isStockMenuConsolidated,
  LABOR_STOCK_MODULE_ID, MARKETING_MODULE_ID,
  LABOR_STOCK_MODULE_ENABLED, MARKETING_MODULE_ENABLED,
} from './lib/constants.mjs'

let pass = 0, fail = 0
const ok = (name, cond) => {
  if (cond) { pass++; console.log('  ok  ', name) }
  else { fail++; console.log('  FAIL', name) }
}

console.log('KEBIJAKAN TERPUSAT (lib/constants.js asli)')

// 1. Nilai kebijakan memang OFF (itu yang membuat menu hilang).
ok('LABOR_STOCK_MODULE_ENABLED === false', LABOR_STOCK_MODULE_ENABLED === false)
ok('MARKETING_MODULE_ENABLED === false', MARKETING_MODULE_ENABLED === false)
ok('isLaborStockEnabled() === false', isLaborStockEnabled() === false)
ok('isMarketingEnabled() === false', isMarketingEnabled() === false)

// 2. isModuleVisible menolak keduanya.
ok("isModuleVisible('labor_stock') === false", isModuleVisible('labor_stock') === false)
ok("isModuleVisible('marketing') === false", isModuleVisible('marketing') === false)

// 3. isNavModuleDisabled mengenali keduanya (dipakai fail-closed rute lama).
ok("isNavModuleDisabled('labor_stock') === true", isNavModuleDisabled('labor_stock') === true)
ok("isNavModuleDisabled('marketing') === true", isNavModuleDisabled('marketing') === true)

// 4. Modul lain TIDAK ikut tersembunyi (kecuali yang memang sudah off
//    sejak task sebelumnya: approvals saat APPROVAL OFF, stock saat
//    STOCK_MENU_CONSOLIDATED).
// Bentuk item navSections adalah tuple [id, label] (lihat lib/constants.js).
const laborItems = allModules.filter(m => m[0] === 'labor_stock' || m[0] === 'marketing')
ok('katalog navSections masih memuat entri labor_stock & marketing (reversible)', laborItems.length === 2)
ok("label labor_stock persis 'Actual Labor & Stok'", laborItems.find(m => m[0] === 'labor_stock')?.[1] === 'Actual Labor & Stok')
ok("label marketing persis 'Marketing / Lead Pipeline'", laborItems.find(m => m[0] === 'marketing')?.[1] === 'Marketing / Lead Pipeline')

const unexpectedHidden = allModules
  .map(m => ({ id: m[0], label: m[1] }))
  .filter(m => m.id !== 'labor_stock' && m.id !== 'marketing')
  .filter(m => m.id === 'approvals' ? isApprovalEnabled() : (m.id === 'stock' ? !isStockMenuConsolidated() : true))
  .filter(m => !isModuleVisible(m.id))
ok('tidak ada modul lain yang kehilangan tampilan karena patch ini', unexpectedHidden.length === 0)
if (unexpectedHidden.length) {
  console.log('    modul terpengaruh tak terduga:', unexpectedHidden.map(m => m.id).join(', '))
}

// 5. visibleNavSections juga bersih dari keduanya (lapisan pertama).
const flatVisible = visibleNavSections.flatMap(s => s.items || []).map(m => m[0])
ok("visibleNavSections tidak memuat labor_stock", !flatVisible.includes('labor_stock'))
ok("visibleNavSections tidak memuat marketing", !flatVisible.includes('marketing'))

// 6. Kontrak penting untuk reversibilitas: ID tetap sama persis.
ok("LABOR_STOCK_MODULE_ID === 'labor_stock'", LABOR_STOCK_MODULE_ID === 'labor_stock')
ok("MARKETING_MODULE_ID === 'marketing'", MARKETING_MODULE_ID === 'marketing')

// 7. Konstanta yang dipakai aplikasi lain TETAP diekspor (tidak ada
//    regresi pada modul stock/approvals karena patch ini).
ok('isApprovalEnabled masih fungsi', typeof isApprovalEnabled === 'function')
ok('isStockMenuConsolidated masih diekspor', typeof isStockMenuConsolidated === 'function')

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`)
process.exit(fail === 0 ? 0 : 1)
