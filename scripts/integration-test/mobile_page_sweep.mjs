// ============================================================
// MOBILE PAGE SWEEP (t_2e5ef03c) — ukur SEMUA modul di viewport mobile
// ============================================================
// mobile_ready_probe.mjs hanya mengukur Dashboard. Kartu mobile t_eebe4678
// menuntut modul lain juga (Budgeting/Finance/ProjectFinance/Upah/BOQ/Invoice/
// PR/Approval/Pembelian/Serah Terima). Skrip ini membuka tiap modul lewat
// sidebar harness /__mobile lalu MENGUKUR: overflow BODY, target sentuh <44px,
// font input <16px, dan elemen yang keluar viewport (bukan scroll lokal).
//
// Murni baca: harness /__mobile memakai data mock, tidak ada tulis DB.
//
// Pemakaian: node scripts/integration-test/mobile_page_sweep.mjs http://127.0.0.1:3017
// ============================================================
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const BASE = process.argv[2] || 'http://127.0.0.1:3017'
const PORT = 9383
const CHROME = '/usr/bin/google-chrome'
const VIEWPORTS = [[360, 780], [390, 844], [412, 915], [768, 1024]]
const PAGES = [
  'Dashboard', 'Projects', 'Vendors', 'Materials', 'Purchase Request', 'Approval',
  'Pembelian', 'Serah Terima', 'Budgeting', 'Project Finance', 'Finance',
  'Upah Tukang', 'RAB & BOQ', 'Invoice Penjualan'
]

function waitPort(port, tries = 80) {
  return new Promise((resolve, reject) => {
    const tick = n => {
      const s = net.connect(port, '127.0.0.1')
      s.on('connect', () => { s.destroy(); resolve() })
      s.on('error', () => { s.destroy(); n <= 0 ? reject(new Error('port timeout')) : setTimeout(() => tick(n - 1), 250) })
    }
    tick(tries)
  })
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--user-data-dir=/tmp/mobile-sweep-chrome', '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`, 'about:blank'
], { stdio: 'pipe' })
await waitPort(PORT)

const list = await new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${PORT}/json/list`, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
  }).on('error', reject)
})
const target = list.find(t => t.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false })
await new Promise(r => ws.on('open', r))

let mid = 0
const pending = new Map()
ws.on('message', raw => {
  const msg = JSON.parse(raw)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++mid
  pending.set(id, m => m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result))
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result && r.result.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
await send('Page.enable'); await send('Runtime.enable')

const MEASURE = `(() => {
  const de = document.documentElement
  const overflow = Math.max(0, de.scrollWidth - window.innerWidth)
  const vis = el => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    if (r.width <= 0 || r.height <= 0) return false
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    if (parseFloat(cs.opacity || '1') === 0) return false
    if (r.right <= 0 || r.left >= window.innerWidth) return false
    if (r.bottom <= 0 || r.top >= window.innerHeight) return false
    return true
  }
  const small = []
  for (const el of document.querySelectorAll('button, a, select')) {
    if (!vis(el)) continue
    // PENGECUALIAN yang disengaja (keputusan t_e626b674): "Hapus Vendor"
    // adalah aksi sekunder yang di-discourage — tetap kecil, hanya padding
    // transparannya yang diperbesar. Bukan pelanggaran.
    if (el.classList.contains('vendor-delete-link')) continue
    const r = el.getBoundingClientRect()
    if (Math.min(r.width, r.height) < 44) small.push({ h: Math.round(r.height), t: (el.textContent || '').trim().slice(0, 20) })
  }
  const smallFont = []
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!vis(el)) continue
    // Radio/checkbox tidak memicu auto-zoom iOS (tidak ada teks yang diketik).
    const t = (el.getAttribute('type') || '').toLowerCase()
    if (t === 'radio' || t === 'checkbox') continue
    const fs = parseFloat(getComputedStyle(el).fontSize || '0')
    if (fs > 0 && fs < 16) smallFont.push({ fs, p: el.getAttribute('placeholder') || el.tagName })
  }
  return { overflow, smallCount: small.length, small: small.slice(0, 5), fontCount: smallFont.length, font: smallFont.slice(0, 5) }
})()`

let violations = 0
const rows = []
for (const [w, h] of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true })
  await sleep(200)
  await send('Page.navigate', { url: BASE + '/__mobile' })
  await sleep(1800)
  for (const label of PAGES) {
    const clicked = await evalJs(`(() => {
      const btn = [...document.querySelectorAll('aside.app-sidebar nav button')]
        .find(b => ((b.getAttribute('title') || '') + ' ' + (b.textContent || '')).includes(${JSON.stringify(label)}))
      if (!btn) return false
      btn.click(); return true
    })()`)
    await sleep(700)
    if (!clicked) { rows.push({ w, page: label, skip: 'menu tidak ada' }); continue }
    const m = await evalJs(MEASURE)
    const bad = m.overflow > 2 || m.smallCount > 0 || m.fontCount > 0
    if (bad) violations++
    rows.push({ w, page: label, ...m, bad })
  }
}

console.log('=== MOBILE PAGE SWEEP (harness /__mobile, data mock) ===')
console.log('halaman: ' + PAGES.length + ' × viewport: ' + VIEWPORTS.length + '\n')
let lastW = null
for (const r of rows) {
  if (r.w !== lastW) { console.log(`\n--- ${r.w}px ---`); lastW = r.w }
  if (r.skip) { console.log(`  ${r.page.padEnd(20)} DILEWATI (${r.skip})`); continue }
  const mark = r.bad ? 'PELANGGARAN' : 'OK'
  console.log(`  ${r.page.padEnd(20)} overflow=${String(r.overflow).padStart(3)}px touch<44=${String(r.smallCount).padStart(2)} font<16=${String(r.fontCount).padStart(2)}  ${mark}`)
  if (r.smallCount) console.log(`      contoh tombol: ${JSON.stringify(r.small)}`)
  if (r.fontCount) console.log(`      contoh input : ${JSON.stringify(r.font)}`)
}

console.log('\n=== RINGKASAN ===')
const total = rows.filter(r => !r.skip).length
console.log(`kombinasi diukur: ${total}, pelanggaran: ${violations}`)
ws.close()
chrome.kill('SIGKILL')
process.exit(violations ? 1 : 0)
