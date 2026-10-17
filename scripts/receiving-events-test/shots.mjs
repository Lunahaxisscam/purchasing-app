// Ambil screenshot bukti dari build scratch (/__smoke) — banner status
// penyimpanan per barang, modal Terima Barang, dan daftar Handover.
// Jalankan: PORT=3131 node scripts/receiving-events-test/shots.mjs /tmp/out
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const BASE = 'http://localhost:' + (process.env.PORT || 3131)
const OUT = process.argv[2] || '/tmp/shots'
const PORT = 9281
fs.mkdirSync(OUT, { recursive: true })

function waitPort(port, tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = n => {
      const s = net.connect(port, '127.0.0.1')
      s.on('connect', () => { s.destroy(); resolve() })
      s.on('error', () => { s.destroy(); n <= 0 ? reject(new Error('timeout')) : setTimeout(() => tick(n - 1), 250) })
    }
    tick(tries)
  })
}

const chrome = spawn('/usr/bin/google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--user-data-dir=/tmp/t7bc6-shots-profile',
  `--remote-debugging-port=${PORT}`, '--window-size=1600,1000', 'about:blank'
], { stdio: 'pipe' })
await waitPort(PORT)

const list = await new Promise((res, rej) => http.get(`http://127.0.0.1:${PORT}/json/list`, r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)))
}).on('error', rej))
const t = list.find(x => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false })
await new Promise(r => ws.on('open', r))

let mid = 0
const pending = new Map()
ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++mid
  pending.set(id, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
const waitFor = async (expr, ms = 20000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await evalJS(expr)) return true; await new Promise(r => setTimeout(r, 200)) }
  return false
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'))
  console.log('saved', `${OUT}/${name}.png`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: BASE + '/__smoke' })
await waitFor(`!!document.querySelector('[data-testid="receipt-capability-banner"]')`, 30000)

// /__smoke merender SEMUA modal modul sekaligus (state terbuka by design).
// Suntik stylesheet (bukan inline style — React menimpa inline saat re-render)
// supaya hanya modal yang ditandai `.keep-visible` yang tampil.
await evalJS(`(() => {
  const st = document.createElement('style');
  st.id = 'shot-override';
  st.textContent = '.modal:not(.keep-visible){display:none !important}';
  document.head.appendChild(st);
  return true;
})()`)
await new Promise(r => setTimeout(r, 400))
await evalJS(`(() => {
  const b = document.querySelector('[data-testid="receipt-capability-banner"]');
  b.scrollIntoView({ block: 'start' });
  return true;
})()`)
await new Promise(r => setTimeout(r, 500))
await shot('proof-01-purchase-banner-legacy')

// Buka modal Terima Barang lalu screenshot.
await evalJS(`(() => {
  const cands = [...document.querySelectorAll('[data-testid^="btn-terima-"]')];
  const b = cands.find(x => x.offsetParent !== null) || cands[0];
  b.click(); return true;
})()`)
await waitFor(`!!document.querySelector('[data-testid="receipt-form"]')`)
await evalJS(`(() => {
  const f = document.querySelector('[data-testid="receipt-form"]');
  f.closest('.modal')?.classList.add('keep-visible');
  f.scrollIntoView({ block: 'center' });
  return true;
})()`)
await new Promise(r => setTimeout(r, 700))
await shot('proof-02-receipt-form-capability')

// Tutup, lalu tampilkan daftar Handover (tanpa modal).
await evalJS(`(() => {
  const btns = [...document.querySelectorAll('[data-testid="receipt-form"] button')];
  (btns.find(b => /Batal/.test(b.textContent)) || btns[0]).click();
  return true;
})()`)
await new Promise(r => setTimeout(r, 500))
await evalJS(`(() => {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('keep-visible'));
  const heads = [...document.querySelectorAll('h1,h2,h3,th')];
  const h = heads.find(e => /Diterima Oleh/i.test(e.textContent)) || heads.find(e => /Handover/i.test(e.textContent));
  if (h) h.scrollIntoView({ block: 'center' });
  return true;
})()`)
await new Promise(r => setTimeout(r, 600))
await shot('proof-03-handover-list')

try { chrome.kill('SIGKILL') } catch { /* ignore */ }
ws.close()
process.exit(0)
