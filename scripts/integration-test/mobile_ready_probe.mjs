// ============================================================
// MOBILE READINESS PROBE (t_2e5ef03c) — pengukuran, bukan klaim
// ============================================================
// Kartu mobile t_eebe4678 menuntut: target sentuh >=44px, font input >=16px
// (cegah auto-zoom iOS), tidak ada overflow BODY horizontal di 360/390/412/
// 768/1024, dan regresi desktop 1440.
//
// Skrip ini MENGUKUR di build yang benar-benar disajikan (bukan menghitung
// dari CSS), lalu mencetak angka + daftar pelanggaran. Exit code 1 hanya bila
// ADA pelanggaran, supaya hasilnya jujur: kalau polish mobile belum lengkap di
// paket ini, itu terlihat sebagai MERAH, bukan disembunyikan.
//
// Pemakaian: node scripts/integration-test/mobile_ready_probe.mjs http://127.0.0.1:3017
// ============================================================
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const BASE = process.argv[2] || 'http://127.0.0.1:3017'
const PORT = 9382
const CHROME = '/usr/bin/google-chrome'
const VIEWPORTS = [[360, 780], [390, 844], [412, 915], [768, 1024], [1024, 768], [1440, 900]]

function waitPort(port, tries = 80) {
  return new Promise((resolve, reject) => {
    const tick = n => {
      const s = net.connect(port, '127.0.0.1')
      s.on('connect', () => { s.destroy(); resolve() })
      s.on('error', () => { s.destroy(); n <= 0 ? reject(new Error('port timeout ' + port)) : setTimeout(() => tick(n - 1), 250) })
    }
    tick(tries)
  })
}

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--user-data-dir=/tmp/mobile-ready-chrome', '--window-size=1440,900',
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
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++mid
    pending.set(id, m => m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 400) }
  return r.result && r.result.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
await send('Page.enable'); await send('Runtime.enable')

async function viewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await sleep(250)
}

// Pengukuran pada halaman yang sedang terbuka.
// Catatan metodologi (jujur): elemen yang berada di luar viewport (mis. item
// drawer yang sedang TERTUTUP, translateX(-100%)) TIDAK dihitung sebagai
// target sentuh yang bisa ditekan — kalau dihitung, angkanya jadi palsu besar
// dan tidak bisa dipakai memutuskan apa pun. Jadi syaratnya: benar-benar
// terlihat (di dalam kotak viewport), bukan hanya punya ukuran.
const MEASURE = `(() => {
  const de = document.documentElement
  const overflow = Math.max(0, de.scrollWidth - window.innerWidth)
  const isVisible = el => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (r.width <= 0 || r.height <= 0) return false
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    if (parseFloat(cs.opacity || '1') === 0) return false
    // harus berada di dalam viewport (horizontal & vertikal)
    if (r.right <= 0 || r.left >= window.innerWidth) return false
    if (r.bottom <= 0 || r.top >= window.innerHeight) return false
    return true
  }
  const small = []
  for (const el of document.querySelectorAll('button, a, select, .filter-tabs button, .pill')) {
    if (!isVisible(el)) continue
    const r = el.getBoundingClientRect()
    const h = Math.round(Math.min(r.width, r.height))
    if (h > 0 && h < 44) small.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 40), h: Math.round(r.height), w: Math.round(r.width), txt: (el.textContent || '').trim().slice(0, 24) })
  }
  const smallInputs = []
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (!isVisible(el)) continue
    const fs = parseFloat(getComputedStyle(el).fontSize || '0')
    if (fs > 0 && fs < 16) smallInputs.push({ tag: el.tagName, fs, name: el.getAttribute('name') || el.getAttribute('placeholder') || '' })
  }
  return { overflow, small: small.slice(0, 8), smallCount: small.length, smallInputs: smallInputs.slice(0, 8), smallInputCount: smallInputs.length }
})()`

console.log('=== MOBILE READINESS PROBE — pengukuran nyata pada build tersaji ===\n')
console.log(`base: ${BASE}`)
console.log('Cakupan: target sentuh >=44px & font input >=16px hanya diukur untuk')
console.log('         viewport < 1024 (mandat mobile). Desktop 1440 hanya diukur')
console.log('         overflow + regresi layout, karena sidebar desktop memang')
console.log('         memakai tombol 38px dan itu bukan target sentuh mobile.\n')

let violations = 0
const perViewport = []
for (const [w, h] of VIEWPORTS) {
  const mobile = w < 1024
  await viewport(w, h, mobile)
  await send('Page.navigate', { url: BASE + '/__mobile' })
  await sleep(1800)
  const m = await evalJs(MEASURE)
  const row = { w, h, ...m }
  perViewport.push(row)
  const overflowOk = m.overflow <= 2
  const touchOk = mobile ? m.smallCount === 0 : true
  const fontOk = mobile ? m.smallInputCount === 0 : true
  if (!overflowOk) violations++
  if (!touchOk) violations++
  if (!fontOk) violations++
  console.log(`\n@${w}x${h}${mobile ? '' : ' (desktop)'}`)
  console.log(`  overflow BODY      : ${m.overflow}px ${overflowOk ? 'OK' : '<-- PELANGGARAN'}`)
  console.log(`  target < 44px      : ${m.smallCount} ${mobile ? (touchOk ? 'OK' : '<-- PELANGGARAN') : '(tidak diukur di desktop)'}`)
  if (mobile && m.smallCount) console.log(`     contoh: ${JSON.stringify(m.small)}`)
  console.log(`  font input < 16px  : ${m.smallInputCount} ${mobile ? (fontOk ? 'OK' : '<-- PELANGGARAN') : '(tidak diukur di desktop)'}`)
  if (mobile && m.smallInputCount) console.log(`     contoh: ${JSON.stringify(m.smallInputs)}`)
}

console.log('\n=== RINGKASAN ===')
console.log(`viewport diuji: ${VIEWPORTS.map(v => v[0]).join('/')}`)
console.log(`pelanggaran   : ${violations}`)
ws.close()
chrome.kill('SIGKILL')
process.exit(violations ? 1 : 0)
