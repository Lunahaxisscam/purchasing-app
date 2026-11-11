// Offline fixtures only. SWC compilation goes to an OS temp directory, never .next.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict')
const root = path.resolve(__dirname, '..')
const swc = require(path.join(root, 'node_modules/next/dist/build/swc'))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'approved-flow-'))
let passed = 0
function test(name, fn) { fn(); passed++; console.log('PASS', name) }
function compile(rel) {
  const src = path.join(root, rel), out = path.join(temp, rel.replace(/\.(jsx|js)$/, '.cjs'))
  if (fs.existsSync(out)) return out
  let code = fs.readFileSync(src, 'utf8')
  code = code.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, a, spec, z) => {
    let dep = path.resolve(path.dirname(src), spec)
    if (!fs.existsSync(dep)) dep = ['.js', '.jsx'].map(ext => dep + ext).find(p => fs.existsSync(p))
    if (!dep) throw Error('Missing import ' + spec)
    return a + compile(path.relative(root, dep)).replace(/\\/g, '/') + z
  })
  const result = swc.transformSync(code, { filename: src, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2020', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } })
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, result.code); return out
}
try {
  const { buildProjectPurchaseRows } = require(compile('lib/projectPurchaseRows.js'))
  const { makePrEstimator } = require(compile('modules/requests/estimator.js'))
  const { buildMonitoringRows, buildReadyRows, makePurchaseForm, validatePurchaseForm } = require(compile('modules/receivings/purchaseLogic.js'))
  const fixture = {
    projects: [{ id: 'a', kode: 'A' }, { id: 'b', kode: 'B' }],
    requests: [{ id: 'p', project_id: 'a', pr_number: 'PR-1', status: 'SUBMITTED', notes: '[Alur: LEAN]' }],
    prItems: [{ id: 'i', pr_id: 'p', material_id: 'm', item_name: 'Same', quantity: 10, unit: 'pcs', status: 'APPROVED' }, { id: 'j', pr_id: 'p', item_name: 'Same', quantity: 2, unit: 'pcs', status: 'APPROVED' }],
    receivings: [{ id: 'r', status: 'DIBELI', project_id: 'a', vendor_id: 'v' }, { id: 's', status: 'NORMAL', note: '[Tahap: DIBELI]', vendor_id: 'v' }, { id: 'not', status: 'NORMAL', project_id: 'a' }],
    receivingItems: [{ id: '1', receiving_id: 'r', pr_item_id: 'i', quantity_received: 3, note: '[Harga: 20]' }, { id: '2', receiving_id: 's', pr_item_id: 'i', quantity_received: 2, unit_price: 25 }, { id: '3', receiving_id: 'r', pr_item_id: 'j', quantity_received: 1, note: '[Harga: 7]' }, { id: '4', receiving_id: 'r', item_name: 'Direct', quantity_received: 4, note: '[Harga: 5]' }, { id: '5', receiving_id: 'not', pr_item_id: 'i', quantity_received: 100, note: '[Harga: 100]' }]
  }
  test('actual sums per PR-item without handover and no same-name merging', () => {
    const rows = buildProjectPurchaseRows(fixture).forProject('a'); assert.equal(rows.length, 3); assert.equal(rows.find(r => r.id === 'a:i').total, 110); assert.equal(rows.find(r => r.id === 'a:j').total, 7); assert.equal(rows.find(r => r.itemName === 'Direct').prNumber, '—')
  })
  test('PR item and request conflict is quarantined', () => { const f = { ...fixture, prItems: fixture.prItems.map(i => ({ ...i, project_id: 'b' })) }; const result = buildProjectPurchaseRows(f); assert.equal(result.forProject('b').length, 0); assert.ok(result.diagnostics.some(d => d.message.includes('bertentangan'))) })
  test('duplicate line counted once', () => { const f = { ...fixture, receivingItems: [...fixture.receivingItems, fixture.receivingItems[0]] }; assert.equal(buildProjectPurchaseRows(f).forProject('a').find(r => r.id === 'a:i').total, 110) })
  test('conflicts dangling links missing price invalid qty diagnosed', () => {
    const f = { ...fixture, receivingItems: [{ id: 'x', receiving_id: 'r', pr_item_id: 'i', project_id: 'b', quantity_received: 1, unit_price: 5 }, { id: 'y', receiving_id: 'r', pr_item_id: 'gone', quantity_received: 1, unit_price: 5 }, { id: 'z', receiving_id: 's', pr_item_id: 'i', quantity_received: 1 }, { id: 'q', receiving_id: 's', pr_item_id: 'j', quantity_received: -1, unit_price: 2 }] }; const result = buildProjectPurchaseRows(f); assert.equal(result.diagnostics.length, 4); assert.equal(result.forProject('a')[0].incomplete, true)
  })
  test('ambiguous header is never allocated over mixed siblings', () => {
    const f = { ...fixture, receivingItems: [{ id: 'x', receiving_id: 'r', project_id: 'b', quantity_received: 1, unit_price: 2 }, { id: 'y', receiving_id: 'r', quantity_received: 1, unit_price: 2 }] }; const result = buildProjectPurchaseRows(f); assert.equal(result.forProject('a').length, 0); assert.equal(result.forProject('b').length, 1); assert.equal(result.diagnostics.length, 1)
  })
  test('supplier-first refuses master and foreign supplier fallback', () => {
    const mat = { id: 'm', satuan: 'pcs', harga_acuan: 999 }
    const estimator = makePrEstimator({ allPrItems: fixture.prItems, allReceivingItems: fixture.receivingItems, allReceivings: fixture.receivings, allVendors: [{ id: 'v', name: 'Same shop' }, { id: 'other', name: 'Same shop' }] })
    assert.equal(estimator.estimateFor(mat, { supplierOnly: true }).price, null)
    assert.equal(estimator.estimateFor(mat, { supplierOnly: true, vendorId: 'other' }).price, null)
    assert.equal(estimator.estimateFor(mat, { supplierOnly: true, vendorId: 'v' }).price, 20)
  })
  test('monitor parent quantity stays original with actual column prices', () => { const rows = buildMonitoringRows(fixture); assert.equal(rows.find(r => r.key === 'i').qtyPr, 10); assert.equal(rows.find(r => r.key === 'i').estimatedPrice, null); assert.equal(rows.find(r => r.key === 'i').invoices.find(i => i.id === '2').unitPrice, 25) })
  test('approved source layout contract', () => {
    const c = fs.readFileSync(path.join(root, 'lib/constants.js'), 'utf8'); assert.ok(c.includes("['pr_number', 'project_name', 'materials_summary', 'items_qty', 'estimated_unit', 'status']"))
    const p = fs.readFileSync(path.join(root, 'modules/receivings/page.jsx'), 'utf8'); assert.ok(p.includes('<th>PR No</th><th>Project</th><th>Barang</th><th>Jumlah</th><th>Harga</th><th>Total</th><th>Aksi</th>')); assert.ok(p.includes('purchase-shared-table')); assert.ok(!p.includes("tab === 'monitoring'"))
    const f = fs.readFileSync(path.join(root, 'components/ProjectFinance.js'), 'utf8'); assert.ok(f.includes('<th>No PR</th><th>Barang</th>')); assert.ok(f.includes('Number(drive?.cumulative_cost) || 0')); assert.ok(!f.includes('materialPrTotals.est')); const laborStart = f.indexOf("{view === 'tukang' && ("); const materialStart = f.indexOf("{view === 'material' && (", laborStart); assert.ok(laborStart > 0 && materialStart > laborStart); const laborBranch = f.slice(laborStart, materialStart); assert.ok(laborBranch.includes('TOTAL ESTIMASI UPAH')); assert.ok(laborBranch.includes('laborRows.map')); assert.ok(!laborBranch.includes('finance-purchase-table')); assert.ok(f.slice(materialStart).includes('finance-purchase-table')); assert.ok(f.slice(materialStart).includes('REKAP COST 2026'))
    const form = fs.readFileSync(path.join(root, 'modules/requests/form.jsx'), 'utf8'); assert.ok(form.includes('<th>Barang</th><th>Qty</th><th>Harga</th><th>Supplier</th><th>Aksi</th>')); assert.ok(form.includes('aria-label={`Hapus'));
    const modal = fs.readFileSync(path.join(root, 'components/CreateModal.js'), 'utf8'); assert.ok(modal.includes('if (it.est_manual) return next')); assert.ok(modal.includes('est_manual: true'))
  })
  for (const rel of ['components/CreateModal.js', 'components/ModuleView.js', 'components/ProjectFinance.js', 'modules/requests/form.jsx', 'modules/requests/compactView.jsx', 'modules/requests/view.jsx', 'modules/receivings/page.jsx', 'pages/index.js']) {
    swc.transformSync(fs.readFileSync(path.join(root, rel), 'utf8'), { filename: rel, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2020', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }); passed++
  }
  console.log(`${passed} checks passed (offline fixtures and syntax; no build)`)
} finally { fs.rmSync(temp, { recursive: true, force: true }) }
