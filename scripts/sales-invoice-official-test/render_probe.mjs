// Render modul Invoice Penjualan (view.jsx ASLI) di jsdom — mencari exception
// sisi klien yang membuat halaman jadi "Application error".
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
global.window = dom0.window
global.document = dom0.window.document
try { global.navigator = dom0.window.navigator } catch { /* getter-only */ }
global.HTMLElement = dom0.window.HTMLElement
global.Event = dom0.window.Event
try { global.localStorage = dom0.window.localStorage } catch { /* opaque */ }
global.fetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
global.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

let mod
try {
  mod = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/view.jsx')).href)
} catch (e) {
  console.log('IMPORT GAGAL:', e.message)
  console.log(e.stack?.split('\n').slice(0, 8).join('\n'))
  process.exit(1)
}

const View = mod.default
const rows = { projects: [], customers: [] }
const root = createRoot(document.getElementById('app'))
let ok = false
try {
  flushSync(() => root.render(React.createElement(View, {
    rows, refresh: () => {}, say: () => {}, session: { user: { email: 'x@y.z' } }
  })))
  ok = true
  console.log('RENDER OK')
  const text = document.body.textContent || ''
  console.log('teks halaman (200 char):', text.replace(/\s+/g, ' ').slice(0, 200))
  console.log('ADA tombol PDF:', /PDF/.test(text))
} catch (e) {
  console.log('RENDER THROW:', e.message)
  console.log(e.stack?.split('\n').slice(0, 10).join('\n'))
  process.exitCode = 1
}
