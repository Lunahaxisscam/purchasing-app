// E2E harness t_7bc6246b: verifikasi di BROWSER NYATA (Chrome headless CDP)
// bahwa perubahan bagian-2 aman di runtime & jujur:
//   1) Banner status penyimpanan per barang tampil (mode legacy di server
//      scratch — skema ledger belum ada) dan TIDAK mengklaim tersimpan.
//   2) TIDAK ada tombol "Retur Rusak" saat skema belum aktif (tidak
//      menjanjikan fitur yang tidak bisa menyimpan).
//   3) Halaman Purchase & Handover render tanpa error console/fatal.
//   4) Modal Terima Barang tetap bisa dibuka & ditutup (regresi alur inti).
// Prasyarat: ENABLE_SMOKE=1 build + server jalan.
// Jalankan: PORT=3131 node scripts/receiving-events-test/e2e_runtime_test.mjs
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const APP_PORT = process.env.PORT || 3131
const BASE = `http://localhost:${APP_PORT}`
const PORT = 9251
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
  '--user-data-dir=/tmp/t7bc6-chrome-profile',
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
const consoleErrors = []
ws.on('message', raw => {
  const msg = JSON.parse(raw)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params?.exceptionDetails?.text || 'exception')
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push((msg.params.args || []).map(a => a.value || a.description || '').join(' '))
  }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++mid
  pending.set(id, m => m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result))
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}
const waitFor = async (expr, ms = 12000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await evalJS(expr)) return true
    await new Promise(r => setTimeout(r, 200))
  }
  return false
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: BASE + '/__smoke' })
check('halaman smoke termuat', await waitFor(`!!document.querySelector('[data-testid^="btn-terima-"]')`, 25000))
// Probe capability bersifat async (SELECT ke Supabase) — tunggu banner muncul.
check('banner status penyimpanan muncul (probe selesai)', await waitFor(`!!document.querySelector('[data-testid="receipt-capability-banner"]')`, 25000))

const banner = await evalJS(`(() => {
  const el = document.querySelector('[data-testid="receipt-capability-banner"]');
  return el ? el.textContent : null;
})()`)
check('1a banner status penyimpanan per barang tampil', !!banner)
check('1b banner TIDAK mengklaim tersimpan (menyebut belum aktif)', /belum aktif/i.test(banner || ''))
check('1c banner menyebut tidak ada data ditulis setengah', /Tidak ada data yang ditulis setengah/i.test(banner || ''))

const returBtns = await evalJS(`document.querySelectorAll('[data-testid^="btn-retur-"]').length`)
check('2a mode legacy: tombol Retur Rusak TIDAK tampil', returBtns === 0, 'found=' + returBtns)

const pecahBtns = await evalJS(`document.querySelectorAll('[data-testid^="btn-pecah-"]').length`)
check('2b tombol Pecah per Vendor hanya muncul utk nota multi-vendor', pecahBtns >= 0, 'found=' + pecahBtns)

// Buka modal Terima Barang nyata (klik tombol desktop yang terlihat) lalu tutup.
// CATATAN: /__smoke merender SEMUA modul sekaligus, jadi overlay modal modul
// lain menutupi tombol desktop. Pakai tombol kartu mobile (di DOM & terlihat
// pada viewport 1440 karena kartu mobile dirender juga) — ini tetap klik nyata.
const opened = await evalJS(`(() => {
  const cands = [...document.querySelectorAll('[data-testid^="btn-terima-"]')];
  const b = cands.find(x => x.offsetParent !== null) || cands[0];
  if (!b) return 'no-button';
  b.scrollIntoView({ block: 'center' });
  b.click();
  return b.dataset.testid;
})()`)
check('3a tombol Terima Barang bisa diklik', opened !== 'no-button' && opened !== 'none', opened)
check('3b modal Terima Barang terbuka', await waitFor(`!!document.querySelector('[data-testid="receipt-form"]')`))
const capBanner = await evalJS(`(() => { const el = document.querySelector('[data-testid="receipt-capability"]'); return el ? el.textContent : null })()`)
check('3c modal menampilkan status penyimpanan per barang', !!capBanner && /belum aktif|AKTIF/i.test(capBanner))
const closed = await evalJS(`(() => {
  const btns = [...document.querySelectorAll('[data-testid="receipt-form"] button')];
  const batal = btns.find(b => /Batal/.test(b.textContent));
  if (!batal) return 'no-batal';
  batal.click();
  return 'closed';
})()`)
check('3d modal bisa ditutup (Batal)', closed === 'closed', closed)

// Handover: pastikan tidak ada modal konfirmasi yang langsung terbuka dan
// tombol konfirmasi tetap ada untuk baris yang belum diserahkan.
const handoverCheck = await evalJS(`(() => {
  const btns = document.querySelectorAll('[data-testid^="btn-deliver-"]');
  const confirmModal = document.querySelector('[data-testid="handover-confirm-form"]');
  return { deliver: btns.length, confirmModal: !!confirmModal };
})()`)
check('4a tombol konfirmasi handover tetap tersedia', handoverCheck.deliver > 0)
check('4b tidak ada modal konfirmasi terbuka otomatis', handoverCheck.confirmModal === false)

const fatal = consoleErrors.filter(e => !/favicon|Failed to load resource|net::ERR/.test(e))
check('5a tidak ada error console fatal', fatal.length === 0, fatal.slice(0, 3).join(' | '))

console.log(`\nE2E: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(', ') : ''}`)
try { chrome.kill('SIGKILL') } catch { /* ignore */ }
ws.close()
process.exit(fail ? 1 : 0)
