const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const postcss = require('postcss')
const root = path.resolve(__dirname, '../..')
const css = postcss.parse(fs.readFileSync(path.join(root, 'styles/compact-flow.css'), 'utf8'))
function value(selector, property) {
  let result
  css.walkRules(selector, rule => rule.walkDecls(property, decl => { result = decl.value }))
  return result
}
assert.equal(value('table.requests-compact-table', 'min-width'), '1040px', 'Desktop PR table must reserve readable column space')
assert.equal(value('table.requests-compact-table th:nth-child(7)', 'width'), '13%', 'Actions must have enough room for resubmission')
assert.equal(value('table.requests-compact-table .compact-flow-actions button', 'white-space'), 'nowrap', 'Action labels must not break into vertical letters')
assert.equal(value('table.requests-compact-table .compact-flow-number', 'white-space'), 'nowrap', 'Quantities and currency must stay readable')
const shell = fs.readFileSync(path.join(root, 'components/ModuleView.js'), 'utf8')
assert.doesNotMatch(shell, /page === 'requests' \? '5%'/, 'Inline shared header width must not override compact PR column widths')
const view = fs.readFileSync(path.join(root, 'modules/requests/compactView.jsx'), 'utf8')
assert.equal((view.match(/<td className="compact-flow-number">/g) || []).length, 2, 'Numeric styling must survive rowspan rows')
assert.match(view, /export function compactMobileCard/, 'Keep legacy renderer available without using it in shared table mode')
assert.match(shell, /page === 'requests' \? 'pr-shared-table'/, 'PR must keep the table on mobile')
assert.match(shell, /page === 'requests' \? 'pr-hidden-cards'/, 'Do not duplicate PR as mobile cards')
const constants = fs.readFileSync(path.join(root, 'lib/constants.js'), 'utf8')
assert.match(constants, /requests: \['pr_number', 'project_name', 'materials_summary', 'items_qty', 'estimated_unit', 'status'\]/, 'Approved six data columns plus actions')
console.log('PASS PR table layout source regression checks (not browser geometry)')

assert.equal(value('.panel.table.pr-shared-table > table.requests-compact-table', 'min-width'), '1040px', 'Scoped cascade override must match the actual compact-only class')
assert.equal(value('.panel.table.pr-shared-table > table.requests-compact-table', 'table-layout'), 'fixed')
assert.equal(value('.panel.table.pr-shared-table > table.requests-compact-table th:nth-child(3)', 'width'), '22%', 'Barang must receive readable space')
