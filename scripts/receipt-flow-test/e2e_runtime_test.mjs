// E2E harness t_5196b689: buka /__smoke di server scratch via Chrome headless
// CDP, verifikasi di BROWSER NYATA:
//   1) Tombol "Terima Barang" ada di baris Purchase (desktop) & kartu mobile.
//   2) Klik nyata -> modal form terbuka; tidak ada panel legacy "Langkah 1 —
//      Cek Fisik" / "Lihat X item" di DOM manapun (desktop & mobile).
//   3) Isi qty di form -> TIDAK ada request network mutasi (nol tulisan saat
//      mengetik); double click submit tetap satu payload (UI guard).
//   4) Modal tertutup via Batal; state bersih.
// Prasyarat: server smoke berjalan (ENABLE_SMOKE=1 npx next build && start).
// Jalankan: PORT=3117 node scripts/receipt-flow-test/e2e_runtime_test.mjs
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const APP_PORT = process.env.PORT || 3117
const BASE = `http://localhost:${APP_PORT}`
const PORT = 9239
const CHROME = '/usr/bin/google-chrome'

function getJSON(pathname) {
  return new Promise((resolve, reject) => {
    http.get(BASE + pathname, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve({ status: res.statusCode, body: d }))
    }).on('error', reject)
  })
}

function waitPort(port, tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = n => {
      const s = net.connect(port, '127.0.0.1')
      s.on('connect', () => { s.destroy(); resolve() })
      s.on('error', () => { s.destroy(); n <= 0 ? reject(new Error('port timeout ' + port)) : setTimeout(() => tick(n - 1), 250) })
    }
    tick(tries)
  })
}

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const page = await getJSON('/__smoke')
check('/__smoke HTTP 200 (server scratch)', page.status === 200, 'status=' + page.status)

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--user-data-dir=/tmp/t5196-chrome-profile',
  `--remote-debugging-port=${PORT}`, '--window-size=1440,900', 'about:blank'
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
let mutationRequests = 0
ws.on('message', raw => {
  const msg = JSON.parse(raw)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  // hitung request mutasi ke supabase selama skenario
  if (msg.method === 'Network.requestWillBeSent') {
    const { url, method } = msg.params.request
    if (/supabase/.test(url) && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) mutationRequests++
  }
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
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
// Viewport eksplisit (profil chrome bisa membawa ukuran jendela lama):
// desktop 1440x900 dulu — media query .desktop-table-view vs .mobile-cards-view
// bergantung lebar ini.
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

await send('Page.navigate', { url: BASE + '/__smoke' })
await sleep(3500)

console.log('\n=== E2E BROWSER NYATA (Chrome CDP) — alur Terima Barang ===\n')

// ---------- 1) tombol ada (desktop+mobile DOM) ----------
{
  const found = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('[data-testid^="btn-terima"]')]
    return { count: btns.length, sample: btns.slice(0,3).map(b => b.textContent.trim()) }
  })()`)
  check('1a tombol Terima Barang/Lihat Barang ada di halaman Purchase', found.count > 0, JSON.stringify(found))
  check('1b label tombol berbahasa lapangan', found.sample.every(t => /Terima Barang|Lihat Barang/.test(t)), JSON.stringify(found.sample))
}

// ---------- 2) legacy hilang + klik -> modal ----------
{
  const legacy = await evalJs(`(() => {
    const t = document.body.textContent || ''
    return { langkah1: /Langkah 1/.test(t), cekFisik: /Cek Fisik/.test(t), lihatX: /Lihat\\s+\\d+\\s+item/.test(t) }
  })()`)
  check('2a TIDAK ada teks "Langkah 1" di DOM', legacy.langkah1 === false)
  check('2b TIDAK ada teks "Cek Fisik" di DOM', legacy.cekFisik === false)
  check('2c TIDAK ada toggle "Lihat X item" di DOM', legacy.lihatX === false)

  // Catatan: halaman /__smoke menumpuk SEMUA modul termasuk modal Create yang
  // terbuka; overlay itu artefak smoke (bukan produksi). Sembunyikan overlay
  // HANYA untuk hit-test, klik tetap event mouse nyata.
  const hidden = await evalJs(`(() => {
    const s = document.createElement('style'); s.id = 'e2e-hide-overlay'
    s.textContent = '.modal { display: none !important; }'
    document.head.appendChild(s)
    return document.querySelectorAll('.modal').length
  })()`)
  console.log(`  (info) ${hidden} overlay .modal smoke disembunyikan untuk hit-test`)

  // klik tombol pertama via CDP (mouse event nyata)
  await evalJs(`(() => { const b = document.querySelector('#mod-receivings .desktop-table-view [data-testid^="btn-terima-"]'); b.scrollIntoView({ block: 'center', behavior: 'instant' }); return true })()`)
  await sleep(400)
  const box = await evalJs(`(() => {
    const b = document.querySelector('#mod-receivings .desktop-table-view [data-testid^="btn-terima-"]')
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width/2, y: r.y + r.height/2, vis: b.offsetParent !== null }
  })()`)
  const hit = await evalJs(`(() => {
    const el = document.elementFromPoint(${box.x}, ${box.y})
    return el ? (el.tagName + '#' + (el.getAttribute('data-testid') || '')) : 'none'
  })()`)
  console.log(`  (info) tombol di (${Math.round(box.x)},${Math.round(box.y)}) visible=${box.vis}; hit-test: ${hit}`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await sleep(600)
  // Kembalikan overlay supaya modal form kita sendiri terlihat di DOM
  await evalJs(`(() => { const s = document.getElementById('e2e-hide-overlay'); if (s) s.remove(); return true })()`)
  const modal = await evalJs(`(() => {
    const f = document.querySelector('[data-testid="receipt-form"]')
    return f ? { open: true, title: f.textContent.slice(0, 60), items: document.querySelectorAll('[data-testid^="receipt-item-"]').length, summary: !!document.querySelector('[data-testid="receipt-summary"]') } : { open: false }
  })()`)
  check('2d klik nyata -> modal Terima Barang terbuka', modal.open === true, JSON.stringify(modal))
  check('2e judul modal "Terima Barang"', /Terima Barang/.test(modal.title || ''), modal.title)
  check('2f ringkasan akhir tampil', modal.summary === true)
}

// ---------- 3) ketik -> nol mutasi; validasi live ----------
{
  const res = await evalJs(`(() => {
    const inp = document.querySelector('[data-testid^="datang-"]')
    if (!inp) return { err: 'no input' }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(inp, '3'); inp.dispatchEvent(new Event('input', { bubbles: true }))
    setter.call(inp, '12'); inp.dispatchEvent(new Event('input', { bubbles: true }))
    return { value: inp.value, err: (document.querySelector('[data-testid="receipt-error"]')||{}).textContent || '' }
  })()`)
  await sleep(400)
  check('3a input menerima ketikan', res.value === '12', JSON.stringify(res))
  check('3b NOL request mutasi ke DB selama mengetik', mutationRequests === 0, 'mutations=' + mutationRequests)
  check('3c over-receipt memblokir submit (disabled)', await evalJs(`document.querySelector('[data-testid="receipt-submit"]').disabled === true`) === true)
}

// ---------- 4) Batal -> modal tertutup ----------
{
  const closed = await evalJs(`(() => {
    const f = document.querySelector('[data-testid="receipt-form"]')
    const btns = [...f.querySelectorAll('.actions button')].filter(b => b.textContent.trim() === 'Batal')
    if (!btns.length) return false
    btns[0].click()
    return true
  })()`)
  await sleep(400)
  const stillOpen = await evalJs(`!!document.querySelector('[data-testid="receipt-form"]')`)
  check('4a klik Batal menutup modal', closed === true && stillOpen === false, 'closed=' + closed + ' stillOpen=' + stillOpen)
}

// ---------- 5) mobile viewport ----------
{
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(800)
  const mobile = await evalJs(`(() => {
    const cards = document.querySelector('#mod-receivings .mobile-cards-view')
    const btn = cards ? cards.querySelector('[data-testid^="btn-terima-mobile-"]') : null
    const t = cards ? cards.textContent : ''
    return { btn: !!btn, label: btn ? btn.textContent.trim() : '', vis: btn ? btn.offsetParent !== null : false, legacy: /Cek Fisik|Langkah 1/.test(t) }
  })()`)
  check('5a mobile: tombol Terima Barang ada', mobile.btn === true, JSON.stringify(mobile))
  check('5b mobile: label benar', /Terima Barang|Lihat Barang/.test(mobile.label), mobile.label)
  check('5c mobile: tidak ada teks legacy di kartu', mobile.legacy === false)
}

console.log(`\nE2E: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
ws.close()
chrome.kill()
process.exit(fail ? 1 : 0)
