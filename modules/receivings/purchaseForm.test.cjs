// Offline component interaction checks. No service or database calls leave this sandbox.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { transform } = require('next/dist/build/swc')

async function main() {
  const dir = __dirname
  const compile = async file => (await transform(fs.readFileSync(file, 'utf8'), {
    filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } }, target: 'es2020' }, module: { type: 'commonjs' }
  })).code
  const logicModule = { exports: {} }
  vm.runInNewContext(await compile(path.join(dir, 'purchaseLogic.js')), {
    module: logicModule, exports: logicModule.exports, require: () => ({})
  })
  const slots = []; let cursor = 0; let saves = 0; let saved; let releaseSave
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
    useState: init => { const i = cursor++; if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef: value => { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i] },
    useMemo: fn => fn()
  }
  const componentModule = { exports: {} }
  vm.runInNewContext(await compile(path.join(dir, 'purchaseForm.jsx')), {
    module: componentModule, exports: componentModule.exports,
    require: name => name === 'react' ? React : name === './purchaseLogic' ? logicModule.exports
      : name === '../../lib/constants' ? { rupiah: value => String(value) }
        : name === './purchaseSave' ? { savePurchase: args => { saves++; saved = args; return new Promise(resolve => { releaseSave = resolve }) } }
          : { readAttachment: async () => ({ ok: false, error: 'Rejected fixture' }), ATTACHMENT_MAX_BYTES: 1024, sizeLabel: String, dataUrlByteSize: () => 0 }
  })
  const Component = componentModule.exports.default
  const props = { rows: [{ isDirect: true, itemName: '', projectId: 'p1' }], vendors: [{ id: 'v1', name: 'Toko' }], projects: [{ id: 'p1', kode: 'P01', name: 'Proyek' }], materials: [{ id: 'm1', kode: 'B01', name: 'Besi', satuan: 'pcs', harga_acuan: 999 }] }
  let tree
  const render = () => { cursor = 0; tree = Component(props); return tree }
  const all = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children || []).flatMap(all)]
  const find = id => { const node = all(tree).find(node => node.props?.['data-testid'] === id); assert.ok(node, id); return node }
  const change = (id, value) => { find(id).props.onChange({ target: { value } }); render() }
  render()
  assert.equal(find('purchase-submit').props.disabled, false, 'incomplete form allows validation attempt')
  await find('purchase-form').props.onSubmit({ preventDefault() {} }); render()
  assert.match(find('purchase-error').props.children[0], /wajib dipilih/)
  assert.equal(saves, 0, 'invalid submission never saves')
  const totalLabel = () => all(tree).find(node => node.props?.className === 'purchase-totals-row purchase-totals-grand').props.children[0].props.children.join('')
  assert.match(totalLabel(), /belum lengkap/i)
  assert.equal(all(tree).filter(node => String(node.props?.['data-testid'] || '').startsWith('form-item-')).length, 0)
  change('form-material-search', 'b01')
  assert.ok(all(tree).some(node => node.type === 'option' && node.props.value === 'm1'))
  change('form-material-picker', 'm1')
  find('form-add-material').props.onClick(); render()
  assert.equal(find('harga-direct-material-1').props.value, '', 'actual must never use master estimate')
  assert.match(totalLabel(), /belum lengkap/i)
  await find('purchase-form').props.onSubmit({ preventDefault() {} }); render()
  assert.equal(saves, 0)
  assert.equal(find('harga-direct-material-1').props['aria-invalid'], true)
  change('qty-direct-material-1', '2')
  change('harga-direct-material-1', '12000')
  change('form-vendor', 'v1')
  change('form-invoice', 'INV-01')
  change('form-project', '')
  assert.equal(find('qty-direct-material-1').props.value, '2', 'project change preserves input')
  assert.equal(find('purchase-grand-total').props.children[0], '24000')
  assert.equal(totalLabel(), 'Total Nota Riil')
  assert.equal(find('purchase-submit').props.disabled, false)
  const firstSubmit = find('purchase-form').props.onSubmit({ preventDefault() {} })
  await find('purchase-form').props.onSubmit({ preventDefault() {} })
  assert.equal(saves, 1, 'double-submit stays guarded')
  assert.equal(saved.form.items[0].projectId, null)
  assert.equal(saved.form.items[0].prItemId, null, 'direct does not forge PR')
  releaseSave({ ok: true }); await firstSubmit; render()
  find('remove-direct-material-1').props.onClick(); render()
  assert.equal(find('purchase-submit').props.disabled, false, 'empty purchase can show validation')
  await find('purchase-form').props.onSubmit({ preventDefault() {} }); render()
  assert.match(find('purchase-error').props.children[0], /Belum ada barang/)
  assert.equal(saves, 1, 'empty purchase cannot save')

  slots.length = 0
  props.rows = [{ prItemId: 'pr-item-1', prId: 'pr1', prNumber: 'PR-01', itemName: 'Semen', qtyPr: 10, qtySisa: 4, unit: 'sak', projectId: 'p1', estimasi: 50000 }]
  render()
  assert.equal(find('qty-pr-item-1').props.value, '4', 'PR uses outstanding quantity')
  assert.equal(find('harga-pr-item-1').props.value, '')
  assert.equal(all(tree).some(node => node.props?.['data-testid'] === 'form-material-picker'), false, 'cannot replace PR identity with master')
  change('qty-pr-item-1', '3'); change('harga-pr-item-1', '55000'); change('form-vendor', 'v1')
  const prSubmit = find('purchase-form').props.onSubmit({ preventDefault() {} })
  assert.equal(saved.form.items[0].prItemId, 'pr-item-1')
  assert.equal(saved.form.items[0].prId, 'pr1')
  assert.equal(saved.form.items[0].projectId, 'p1')
  releaseSave({ ok: true }); await prSubmit
  console.log('PASS purchaseForm: SWC parse, searchable master, direct project/stock, no actual autofill, actual totals, remove/empty guard, PR identity/remaining qty, double submit')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
