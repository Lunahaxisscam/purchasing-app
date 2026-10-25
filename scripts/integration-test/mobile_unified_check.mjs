// ============================================================
// MOBILE UNIFIED UI CHECK (t_35cd0354) — Chrome nyata via CDP
// ============================================================
// Membuktikan hasil merge tetap sehat di mobile SETELAH semua branch
// digabung (temuan Brooklyn REVIEW-01/02: "Full UI unified mobile test
// sesudah merges"). Murni baca: tidak ada klik yang menulis DB (halaman
// /__mobile hanya mock), tidak ada request tulis.
//
// Pemakaian:
//   node scripts/integration-test/mobile_unified_check.mjs http://127.0.0.1:3014
// ============================================================
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const BASE = process.argv[2] || 'http://127.0.0.1:3014'
const PORT = 9381
const CHROME = '/usr/bin/google-chrome'

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

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
  '--user-data-dir=/tmp/mobile-unified-chrome', '--window-size=1440,900',
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
let mutationRequests = 0
ws.on('message', raw => {
  const msg = JSON.parse(raw)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
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
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 400) }
  return r.result && r.result.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')

async function viewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await sleep(300)
}

await viewport(1440, 900, false)
await send('Page.navigate', { url: BASE + '/__mobile' })
await sleep(3000)

console.log('=== MOBILE UNIFIED UI — hasil merge (t_35cd0354) ===\n')

// ---------- 1) semua modul baru ada di sidebar setelah merge ----------
{
  const r = await evalJs(`(() => {
    const items = [...document.querySelectorAll('aside.app-sidebar nav button')].map(b => b.getAttribute('title') || b.textContent.trim())
    return { items, count: items.length }
  })()`)
  const txt = (r.items || []).join(' | ')
  check('sidebar memuat menu RAP', /RAP/.test(txt), txt)
  check('sidebar memuat menu Perbandingan RAB/RAP/Aktual', /Perbandingan/.test(txt), txt)
  check('sidebar memuat menu Stok Workshop', /Stok Workshop/.test(txt), txt)
  check('sidebar memuat menu Customer CRM', /CRM/.test(txt), txt)
  check('sidebar memuat menu lama (Pembelian + Serah Terima)', /Pembelian/.test(txt) && /Serah Terima/.test(txt), txt)
}

// ---------- 2) overflow horizontal di 4 lebar ----------
for (const [w, h] of [[360, 780], [390, 844], [768, 1024], [1024, 768]]) {
  await viewport(w, h, true)
  const r = await evalJs(`(() => {
    const de = document.documentElement
    return {
      w: window.innerWidth,
      docScrollWidth: de.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      overflow: Math.max(0, de.scrollWidth - window.innerWidth)
    }
  })()`)
  check(`tidak ada overflow horizontal di ${w}px`, r && r.overflow <= 2, JSON.stringify(r))
}

// ---------- 3) drawer mobile: buka, scrim tidak menutupi tombol tutup ----------
await viewport(390, 844, true)
{
  const opened = await evalJs(`(() => {
    const btn = document.querySelector('.mobile-menu-btn')
    if (!btn) return { err: 'no menu button' }
    btn.click()
    return { clicked: true }
  })()`)
  await sleep(400)
  const r = await evalJs(`(() => {
    const aside = document.querySelector('aside.app-sidebar')
    const btn = document.querySelector('.mobile-menu-btn')
    const scrim = document.querySelector('.mobile-backdrop')
    if (!aside || !btn) return { err: 'missing aside/btn' }
    const ab = aside.getBoundingClientRect()
    const bb = btn.getBoundingClientRect()
    // titik tengah tombol tutup: elemen teratas di titik itu HARUS tombol
    // (bukan scrim) — ini bug asli t_eebe4678.
    const hit = document.elementFromPoint(bb.x + bb.width / 2, bb.y + bb.height / 2)
    return {
      open: aside.classList.contains('sidebar-open'),
      asideLeft: Math.round(ab.left),
      asideHeight: Math.round(ab.height),
      vh: window.innerHeight,
      topElementIsButton: !!(hit && (hit === btn || btn.contains(hit))),
      hitTag: hit ? hit.className || hit.tagName : null,
      hasScrim: !!scrim,
      inert: aside.hasAttribute('inert')
    }
  })()`)
  check('drawer terbuka setelah tap ☰', r.open === true, JSON.stringify(r))
  check('drawer tampil penuh (left=0)', r.asideLeft === 0, JSON.stringify(r))
  check('tombol tutup TIDAK ter-intercept scrim', r.topElementIsButton === true, JSON.stringify(r))
  check('drawer tidak inert saat terbuka', r.inert === false, JSON.stringify(r))
  check('drawer memakai tinggi viewport (dvh)', Math.abs(r.asideHeight - r.vh) <= 2, JSON.stringify(r))
}
{
  const r = await evalJs(`(() => {
    const btn = document.querySelector('.mobile-menu-btn')
    btn.click()
    return true
  })()`)
  await sleep(400)
  const st = await evalJs(`(() => {
    const aside = document.querySelector('aside.app-sidebar')
    return {
      open: aside.classList.contains('sidebar-open'),
      scrim: !!document.querySelector('.mobile-backdrop'),
      inert: aside.hasAttribute('inert'),
      bodyOverflow: getComputedStyle(document.body).overflow
    }
  })()`)
  check('drawer tertutup lagi setelah tap ✕', st.open === false, JSON.stringify(st))
  check('scrim hilang saat drawer tertutup (tidak ada scrim yatim)', st.scrim === false, JSON.stringify(st))
  check('body tidak terkunci scroll setelah tutup', st.bodyOverflow !== 'hidden', JSON.stringify(st))
}

// ---------- 4) BOQ aside tidak dihijack jadi drawer fixed ----------
await viewport(390, 844, true)
{
  const r = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('aside.app-sidebar nav button')]
    const boq = btns.find(b => (b.getAttribute('title') || b.textContent || '').includes('RAB'))
    if (!boq) return { err: 'no BOQ menu' }
    boq.click()
    return { ok: true }
  })()`)
  await sleep(600)
  const st = await evalJs(`(() => {
    const side = document.querySelector('.boq-side')
    if (!side) return { err: 'no .boq-side' }
    const cs = getComputedStyle(side)
    const r = side.getBoundingClientRect()
    return { position: cs.position, left: Math.round(r.left), width: Math.round(r.width), visible: r.width > 40 }
  })()`)
  check('kartu samping BOQ tetap terlihat (tidak off-screen)', st.visible === true, JSON.stringify(st))
  check('kartu samping BOQ tidak dipaksa fixed', st.position !== 'fixed', JSON.stringify(st))
}

// ---------- 5) nol mutasi Supabase selama audit ----------
check('nol request tulis Supabase selama audit mobile', mutationRequests === 0, String(mutationRequests))

console.log(`\n=== HASIL MOBILE UNIFIED: ${pass} lulus, ${fail} gagal ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
ws.close()
chrome.kill('SIGKILL')
process.exit(fail ? 1 : 0)
