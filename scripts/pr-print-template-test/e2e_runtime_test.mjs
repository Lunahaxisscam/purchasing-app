// E2E harness t_bb0929f6: buka /__smoke di server scratch via Chrome headless CDP,
// verifikasi tombol "Print Template Pengadaan" di DOM runtime:
//   - ada, teks persis, href benar, target=_blank, <a> (bukan button)
//   - terlihat (visible, ukuran wajar), dapat diklik
//   - posisi: rata kanan, di atas baris search/Tambah PR, sejajar tombol lain
//   - klik tombol -> tab baru terbuka menuju PDF (server merespons application/pdf)
// Tanpa menyentuh DB; server scratch = build terisolasi /tmp/bamboo-build.
//
// PRASYARAT: server smoke berjalan (ENABLE_SMOKE=1 npx next build && npx next start -p PORT).
// Jalankan: PORT=3101 node scripts/pr-print-template-test/e2e_runtime_test.mjs
import { spawn, execFileSync } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const APP_PORT = process.env.PORT || 3101
const BASE = `http://localhost:${APP_PORT}`
const PORT = 9229
const CHROME = '/usr/bin/google-chrome'

function getJSON(pathname) {
  return new Promise((resolve, reject) => {
    http.get(BASE + pathname, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve({ status: res.statusCode, ctype: res.headers['content-type'], body: d }))
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

// --- 1) server scratch hidup? ---
const page = await getJSON('/__smoke')
check('/__smoke HTTP 200 (server scratch)', page.status === 200, 'status=' + page.status)

// --- 2) chrome + CDP ---
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--disable-popup-blocking',
  '--user-data-dir=/tmp/bamboo-chrome-profile',
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

await send('Page.enable')
await send('Runtime.enable')

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result.value
}

await send('Page.navigate', { url: BASE + '/__smoke' })
await new Promise(r => setTimeout(r, 2500))

console.log('\n=== VERIFIKASI RUNTIME TOMBOL PRINT TEMPLATE (Chrome headless CDP) ===\n')

const info = await evalJs(`(() => {
  const sec = document.querySelector('#mod-requests');
  const scope = sec || document;
  const links = [...scope.querySelectorAll('a.btn-print-template')];
  return links.map(a => {
    const r = a.getBoundingClientRect();
    const row = a.closest('.print-template-row');
    const rr = row ? row.getBoundingClientRect() : null;
    const toolbar = scope.querySelector('.toolbar');
    const tr = toolbar ? toolbar.getBoundingClientRect() : null;
    const cs = getComputedStyle(a);
    const secRect = sec ? sec.getBoundingClientRect() : null;
    return {
      text: a.textContent.trim(),
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
      tag: a.tagName,
      visible: r.width > 0 && r.height > 0,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      rowRight: rr ? rr.right : null,
      rowJustify: row ? getComputedStyle(row).justifyContent : null,
      sectionRight: secRect ? secRect.right : null,
      toolbarTop: tr ? tr.top : null,
      rowBottom: rr ? rr.bottom : null,
      cursor: cs.cursor,
      borderWidth: cs.borderTopWidth,
      borderRadius: cs.borderRadius,
      padding: cs.padding
    };
  });
})()`)

check('tombol ditemukan di DOM runtime', info.length >= 1, JSON.stringify(info))
if (info.length) {
  const b = info[0]
  check('teks persis "Print Template Pengadaan"', b.text === 'Print Template Pengadaan', JSON.stringify(b.text))
  check('href = /print/form-pengadaan-lapangan-template.pdf', b.href === '/print/form-pengadaan-lapangan-template.pdf', b.href)
  check('target=_blank + rel noopener noreferrer', b.target === '_blank' && (b.rel || '').includes('noopener') && (b.rel || '').includes('noreferrer'))
  check('berupa <a> (bukan <button>/form submit)', b.tag === 'A', b.tag)
  check('terlihat di viewport (visible, ukuran wajar)', b.visible && b.rect.w > 100 && b.rect.h >= 30, JSON.stringify(b.rect))
  check('rata kanan dalam section requests (Δ<24px dari tepi section)', b.sectionRight !== null && Math.abs((b.rect.x + b.rect.w) - b.sectionRight) < 24, `btnRight=${(b.rect.x + b.rect.w).toFixed(1)} sectionRight=${b.sectionRight}`)
  check('baris print di ATAS baris toolbar (search+Tambah)', b.rowBottom !== null && b.toolbarTop !== null && b.rowBottom <= b.toolbarTop + 2, `rowBottom=${b.rowBottom} toolbarTop=${b.toolbarTop}`)
  check('gaya tombol (border, radius, cursor pointer)', parseFloat(b.borderWidth) >= 1 && parseFloat(b.borderRadius) >= 4 && b.cursor === 'pointer', JSON.stringify(b))
}

// --- klik tombol via CDP Input (user gesture nyata) -> tab baru menuju PDF ---
// Catatan: halaman /__smoke menumpuk SEMUA modul; modal milik modul lain
// (mis. dialog catatan approval) menutupi viewport. Di aplikasi nyata hanya
// satu modul yang tampil tanpa modal terbuka, jadi overlay itu artefak smoke —
// sembunyikan dulu supaya hit test mengukur tombol yang sebenarnya.
const hiddenModals = await evalJs(`(() => {
  const style = document.createElement('style');
  style.textContent = '.modal, .dialog, .mobile-backdrop { display: none !important; }';
  document.head.appendChild(style);
  return document.querySelectorAll('.modal').length;
})()`)
console.log(`  (info) ${hiddenModals} overlay .modal smoke disembunyikan untuk hit test`)

const btnInfo = await evalJs(`(() => {
  const a = document.querySelector('#mod-requests a.btn-print-template');
  a.scrollIntoView({ block: 'center' });
  const r = a.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const el = document.elementFromPoint(x, y);
  return {
    x, y,
    hit: el ? (el.tagName + '.' + el.className) : null,
    isButtonOrChild: el ? (el === a || a.contains(el)) : false,
    scrollY: window.scrollY
  };
})()`)
check('elemen di titik klik = tombol (hit test)', btnInfo.isButtonOrChild, JSON.stringify(btnInfo))

const targetsBefore = (await new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${PORT}/json/list`, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))) }).on('error', reject)
})).length

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btnInfo.x, y: btnInfo.y })
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btnInfo.x, y: btnInfo.y, button: 'left', clickCount: 1 })
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btnInfo.x, y: btnInfo.y, button: 'left', clickCount: 1 })
await new Promise(r => setTimeout(r, 2500))

const targetsAfter = (await new Promise((resolve, reject) => {
  http.get(`http://127.0.0.1:${PORT}/json/list`, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))) }).on('error', reject)
}))

const pdfTarget = targetsAfter.find(t => t.url && t.url.includes('form-pengadaan-lapangan-template.pdf'))
check('klik tombol membuka tab baru menuju PDF', !!pdfTarget, JSON.stringify(targetsAfter.map(t => t.url).slice(0, 8)))

// --- verifikasi HTTP PDF dari server scratch ---
const pdfRes = await new Promise((resolve, reject) => {
  http.get(BASE + '/print/form-pengadaan-lapangan-template.pdf', res => {
    let n = 0
    res.on('data', c => n += c.length)
    res.on('end', () => resolve({ status: res.statusCode, ctype: res.headers['content-type'], size: n }))
  }).on('error', reject)
})
check('PDF URL HTTP 200 application/pdf', pdfRes.status === 200 && pdfRes.ctype === 'application/pdf', JSON.stringify(pdfRes))
check('PDF size = 30430 bytes (sesuai artifact)', pdfRes.size === 30430, String(pdfRes.size))

ws.close()
chrome.kill()

console.log(`\n=== HASIL RUNTIME: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA VERIFIKASI RUNTIME LULUS')
