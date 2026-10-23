// Render modul Invoice Penjualan (view.jsx ASLI) di jsdom, transform SWC,
// untuk mencari exception sisi klien ("Application error").
// Pola sama dengan scripts/compact-flow-test/runtime.cjs.
const fs = require('fs'), Module = require('module'), path = require('path')
const root = process.cwd()
const swc = require('next/dist/build/swc')
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const k of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent']) global[k] = dom.window[k]
try { global.localStorage = dom.window.localStorage } catch { /* opaque */ }
global.fetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
global.IS_REACT_ACT_ENVIRONMENT = true

// stub lib/supabaseClient (modul ini memakainya untuk listInvoices dsb.)
const stubPath = path.join(root, 'lib/supabaseClient.js')
const orig = Module._extensions['.js']
for (const ext of ['.js', '.jsx']) {
  Module._extensions[ext] = function (mod, file) {
    if (!file.startsWith(root + '/') || file.includes('/node_modules/')) return orig(mod, file)
    if (file === stubPath) { mod.exports = { supabase: null }; return }
    if (file.endsWith('.css')) { mod.exports = {}; return }
    const code = swc.transformSync(fs.readFileSync(file, 'utf8'), {
      filename: file,
      jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
      module: { type: 'commonjs' }
    }).code
    mod._compile(code, file)
  }
}

const React = require('react')
const { createRoot } = require('react-dom/client')
const { flushSync } = require('react-dom')

let View
try {
  View = require(path.join(root, 'modules/sales-invoice/view.jsx')).default
} catch (e) {
  console.log('IMPORT GAGAL:', e.message)
  console.log((e.stack || '').split('\n').slice(0, 10).join('\n'))
  process.exit(1)
}

const rootEl = document.getElementById('app')
const app = createRoot(rootEl)
try {
  flushSync(() => app.render(React.createElement(View, { rows: { projects: [] }, refresh: () => {}, say: () => {} })))
  console.log('RENDER OK')
  const text = (document.body.textContent || '').replace(/\s+/g, ' ')
  console.log('teks:', text.slice(0, 240))
  console.log('ADA tombol PDF:', /PDF/.test(text))
} catch (e) {
  console.log('RENDER THROW:', e.message)
  console.log((e.stack || '').split('\n').slice(0, 12).join('\n'))
  process.exitCode = 1
}
