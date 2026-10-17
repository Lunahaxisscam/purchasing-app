// ============================================================
// E2E — modul RAP di Chrome SUNGGUHAN (CDP), t_71d95cfe (S3/7)
// ============================================================
// jsdom tidak menghitung layout. Skrip ini membuktikan di browser nyata:
//   1) modul RAP benar-benar ter-render di dalam aplikasi (section #mod-rap
//      pada /__smoke) dan banner "belum tersimpan di server" TERLIHAT;
//   2) alur minimum jalan: tempel JSON RAB -> draft + 2 baris -> edit harga
//      -> selisih berubah -> susun payload PR (0 penulisan);
//   3) tidak ada overflow horizontal di 360/390/768/1440;
//   4) tombol aksi utama punya tinggi klik layak (>= 20px);
//   5) tidak ada kata "aktual" pada angka RAP & tidak ada klaim tersimpan.
//
// Pemakaian (butuh server smoke: ENABLE_SMOKE=1 npx next build && npx next start):
//   node e2e_runtime_test.mjs http://127.0.0.1:3311
// ============================================================
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const BASE = process.argv[2] || 'http://127.0.0.1:3311'
const PORT = 9377
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
  '--user-data-dir=/tmp/trap-chrome-profile',
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

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

async function viewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  await sleep(250)
}

await viewport(1440, 900, false)
await send('Page.navigate', { url: BASE + '/__smoke' })
await sleep(3500)

console.log('=== E2E CHROME NYATA — RAP internal versi minimum (t_71d95cfe) ===\n')

// ---------- 1) modul terpasang di aplikasi & banner terlihat ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-rap')
    if (!sec) return { err: 'no #mod-rap section' }
    const root = sec.querySelector('[data-testid="rap-root"]')
    if (!root) return { err: 'no rap-root' }
    const banner = sec.querySelector('[data-testid="rap-persistence-banner"]')
    const rect = el => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } }
    const importBtn = sec.querySelector('[data-testid="rap-act-import-rab"]')
    return {
      hasRoot: true,
      bannerVisible: !!banner && rect(banner).w > 200 && rect(banner).h > 20,
      bannerText: banner ? banner.textContent : '',
      emptyVisible: !!sec.querySelector('[data-testid="rap-empty"]'),
      importBtn: rect(importBtn),
      versionDisabled: sec.querySelector('[data-testid="rap-version"]').disabled
    }
  })()`)
  check('1a modul RAP ter-render di dalam aplikasi (section #mod-rap)', r.hasRoot === true, JSON.stringify(r).slice(0, 240))
  check('1b banner "belum tersimpan di server" TERLIHAT (layout nyata)', r.bannerVisible === true)
  check('1c banner menyebut tabel rap_versions / migrasi beku', /rap_versions/.test(r.bannerText || '') && /dibekukan/.test(r.bannerText || ''))
  check('1d empty state terlihat sebelum draft', r.emptyVisible === true)
  check('1e tombol impor punya ukuran klik layak', r.importBtn.h >= 20, 'h=' + r.importBtn.h)
  check('1f input versi nonaktif sebelum ada draft', r.versionDisabled === true)
}

// ---------- 2) alur: impor JSON RAB -> draft ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-rap')
    const ta = sec.querySelector('[data-testid="rap-rab-json"]')
    const payload = { version: 5, boqReff: 'BOQ-014', revisionNumber: 'REV02', items: [
      { item: 'Wardrobe', qty: 2, unit: 'unit', price: 1500 },
      { item: 'Kitchen set', qty: 1, unit: 'unit', price: 8000 }
    ] }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, JSON.stringify(payload))
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    sec.querySelector('[data-testid="rap-act-import-rab"]').click()
    return { clicked: true }
  })()`)
  await sleep(700)
  const after = await evalJs(`(() => {
    const sec = document.getElementById('mod-rap')
    const t = id => { const el = sec.querySelector('[data-testid="' + id + '"]'); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null }
    return {
      rows: sec.querySelectorAll('tr[data-testid^="rap-line-"]').length,
      rab: t('rap-kpi-rab'),
      rap: t('rap-kpi-rap'),
      diff: t('rap-kpi-diff'),
      status: t('rap-status-badge'),
      version: sec.querySelector('[data-testid="rap-version"]').value,
      empty: !!sec.querySelector('[data-testid="rap-empty"]')
    }
  })()`)
  check('2a klik impor berhasil (tidak ada error)', r.clicked === true, JSON.stringify(r))
  check('2b dua baris RAB jadi baris RAP', after.rows === 2, 'rows=' + after.rows)
  check('2c empty state hilang', after.empty === false)
  check('2d total acuan RAB = Rp 11.000.000', after.rab === 'Rp 11.000.000', after.rab)
  check('2e total RAP awal = acuan', after.rap === 'Rp 11.000.000', after.rap)
  check('2f selisih awal nol', /Rp 0/.test(after.diff || ''), after.diff)
  check('2g status awal Draft', after.status === 'Draft', after.status)
  check('2h label versi otomatis RAP-01', after.version === 'RAP-01', after.version)
}

// ---------- 3) edit harga rencana -> selisih berubah ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-rap')
    const rows = [...sec.querySelectorAll('tr[data-testid^="rap-line-"]')]
    const row = rows.find(x => {
      const i = x.querySelector('input[data-testid^="rap-name-"]')
      return i && i.value === 'Wardrobe'
    })
    if (!row) return { err: 'row not found' }
    const id = row.getAttribute('data-testid').replace('rap-line-', '')
    const input = sec.querySelector('[data-testid="rap-price-' + id + '"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '1400000')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { id }
  })()`)
  await sleep(600)
  const after = await evalJs(`(() => {
    const sec = document.getElementById('mod-rap')
    const t = id => { const el = sec.querySelector('[data-testid="' + id + '"]'); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null }
    return { rap: t('rap-kpi-rap'), rab: t('rap-kpi-rab'), diff: t('rap-kpi-diff') }
  })()`)
  check('3a edit harga berhasil (baris ditemukan)', !r.err, JSON.stringify(r))
  check('3b total RAP turun jadi Rp 10.800.000', after.rap === 'Rp 10.800.000', after.rap)
  check('3c acuan RAB TIDAK ikut berubah', after.rab === 'Rp 11.000.000', after.rab)
  check('3d selisih jadi negatif (di bawah acuan)', /200\.000/.test(after.diff || ''), after.diff)
}

// ---------- 4) handoff PR: payload tampil, nol penulisan ----------
{
  await evalJs(`document.getElementById('mod-rap').querySelector('[data-testid="rap-act-pr-preview"]').click()`)
  await sleep(500)
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-rap')
    const pre = sec.querySelector('[data-testid="rap-pr-payload"]')
    const meta = sec.querySelector('[data-testid="rap-pr-meta"]')
    let parsed = null
    try { parsed = JSON.parse(pre.textContent) } catch (e) { /* biarkan null */ }
    return {
      hasPre: !!pre,
      meta: meta ? meta.textContent.replace(/\\s+/g, ' ').trim() : null,
      items: parsed ? parsed.items.length : -1,
      prNumber: parsed ? parsed.request.pr_number : 'x',
      status: parsed ? parsed.request.status : 'x'
    }
  })()`)
  check('4a payload PR tampil di browser', r.hasPre === true)
  check('4b meta menyatakan penulisan DB: 0', /penulisan DB: 0/.test(r.meta || ''), r.meta)
  check('4c jumlah item = baris RAP', r.items === 2, 'items=' + r.items)
  check('4d nomor PR tidak dikarang (null)', r.prNumber === null, String(r.prNumber))
  check('4e status request DRAFT', r.status === 'DRAFT', String(r.status))
  check('4f NOL request mutasi ke Supabase', mutationRequests === 0, 'mutations=' + mutationRequests)
}

// ---------- 5) responsif: 4 viewport tanpa overflow ----------
for (const [w, h, mobile, label] of [[360, 780, true, '360 (HP kecil)'], [390, 844, true, '390 (HP)'], [768, 1024, false, '768 (tablet)'], [1440, 900, false, '1440 (desktop)']]) {
  await viewport(w, h, mobile)
  await sleep(450)
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-rap')
    const docW = document.documentElement.clientWidth
    const over = [...sec.querySelectorAll('*')]
      .filter(el => el.getBoundingClientRect().right > docW + 1)
      .slice(0, 5)
      .map(el => (el.getAttribute('data-testid') || el.className || el.tagName) + ':' + Math.round(el.getBoundingClientRect().right))
    const banner = sec.querySelector('[data-testid="rap-persistence-banner"]')
    const btn = sec.querySelector('[data-testid="rap-act-pr-preview"]')
    const r1 = banner.getBoundingClientRect(); const r2 = btn.getBoundingClientRect()
    return {
      scrollW: document.documentElement.scrollWidth,
      docW,
      over,
      bannerVisible: r1.width > 100 && r1.height > 15,
      btnVisible: r2.width > 40 && r2.height >= 20,
      btnHeight: Math.round(r2.height)
    }
  })()`)
  check(`5a ${label}: tidak ada overflow horizontal`, r.scrollW <= r.docW + 1, `scrollW=${r.scrollW} docW=${r.docW} ${JSON.stringify(r.over)}`)
  check(`5b ${label}: banner tetap terlihat`, r.bannerVisible === true)
  check(`5c ${label}: tombol aksi tetap terlihat & bisa diklik`, r.btnVisible === true, 'h=' + r.btnHeight)
}

// ---------- 6) kejujuran teks (khusus modul RAP) ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-rap')
    const t = sec.textContent || ''
    return {
      aktual: /\\baktual\\b/i.test(t),
      draftSaja: /Draft saja/.test(t),
      localStorage: /localStorage/.test(t),
      claimSaved: /(?<!belum )(?<!tidak )tersimpan/i.test(t)
    }
  })()`)
  check('6a tidak ada kata "aktual" pada angka RAP', r.aktual === false)
  check('6b penanda "Draft saja" ada', r.draftSaja === true)
  check('6c tidak memakai localStorage sebagai DB', r.localStorage === false)
  check('6d tidak ada klaim "tersimpan" tanpa penyangkalan', r.claimSaved === false)
}

console.log(`\n=== HASIL E2E: ${pass} lulus, ${fail} gagal ===`)
try { ws.close() } catch (e) { /* noop */ }
chrome.kill('SIGKILL')
if (fail) {
  console.log('Gagal:')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
}
