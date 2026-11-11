// Offline server-render regression for the initial PR item table.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { transformSync } = require('next/dist/build/swc')
const file = path.resolve(__dirname, '../../modules/requests/form.jsx')
const source = fs.readFileSync(file, 'utf8').replace("import { rupiah, normalizeStatus } from '../../lib/constants'", "const rupiah = n => String(n); const normalizeStatus = s => s")
const compiled = transformSync(source, { filename: file, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' } }).code
const mod = new Module(file, module)
mod.filename = file
mod.paths = module.paths
mod._compile(compiled, file)
const noop = () => {}
const ctx = { form: {}, setForm: noop, allProjects: [], allMaterials: [], allVendors: [], prItemsList: [], materialSearch: '', setMaterialSearch: noop, materialCategoryFilter: '', setMaterialCategoryFilter: noop, selectedMaterialId: '', setSelectedMaterialId: noop, filteredMaterials: [], itemQty: 1, setItemQty: noop, addItemToPR: noop, removeItemFromPR: noop, updateItemQty: noop, updateItemSupplier: noop, updateItemVendor: noop, vendorsForItem: () => [], updateItemPrice: noop, applyAcuanToItem: noop, vendorEligibleForItem: () => true, totals: { total: 0, complete: true }, materialCategories: [], isEdit: false, setInputMode: noop }
const html = renderToStaticMarkup(mod.exports.formBody(ctx))
assert.match(html, /<table class="pr-items-table"/, 'empty PR exposes its item table')
assert.match(html, /<th>Barang<\/th>.*<th>Qty<\/th>.*<th>Harga<\/th>.*<th>Supplier<\/th>.*<th>Aksi<\/th>/, 'table shows the item columns')
assert.match(html, /<td colspan="5"[^>]*>[^<]*Belum ada item/i, 'empty state belongs to table')
assert.ok(html.indexOf('Item Material') < html.indexOf('Buka Form Lapangan'), 'secondary field-form switch follows item entry')
assert.ok(html.includes('Tambah Item'), 'item addition remains available')
const populated = renderToStaticMarkup(mod.exports.formBody({ ...ctx, prItemsList: [{ material_id: 'm1', name: 'Semen', kode: 'M1', satuan: 'sak', qty: 2, estimated_price: '', vendor_id: '' }], totals: { total: 0, complete: false, unknown: 1 } }))
assert.match(populated, /Semen/, 'added item is rendered')
assert.match(populated, /Pilih supplier dahulu untuk acuan/, 'supplier-first pricing guidance remains')
assert.match(populated, /aria-label="Supplier Semen"/, 'supplier selection remains available')
assert.match(populated, /aria-label="Hapus Semen"/, 'item removal remains available')
assert.match(populated, /Total estimasi BELUM LENGKAP/, 'missing price remains visible')
assert.doesNotMatch(populated, /Belum ada item\./, 'empty state disappears when an item exists')
console.log('Initial and populated PR item table regression passed')
