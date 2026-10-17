// E2E harness t_b418827b: buka /__smoke di server scratch via Chrome headless
// CDP, verifikasi di BROWSER NYATA:
//   1) Daftar Handover: kolom Barang, status bukti fisik (bukan CONFIRMED lama),
//      aksi ringkas (✓/✏️/🗑️ satu baris), TIDAK ada dropdown status.
//   2) Detail expand: referensi Purchase/PR + label "Rincian barang belum
//      tersedia" + prototype per-item (nol request mutasi DB).
//   3) Modal Edit Handover: TIDAK ada dropdown Penerimaan/Project/Status;
//      ringkasan sumber read-only + rincian terlihat; field metadata tetap.
//   4) Modal Tambah Handover: dropdown Penerimaan ada (link wajib).
//   5) Purchase list: TIDAK ada dropdown status parent + tidak ada tombol bulk
//      utk nota multi-item; ringkasan "Belum diterima (0/2)" bukan PARSIAL.
//   6) Mobile: kartu handover + tombol konfirmasi; purchase multi-item tanpa bulk.
// Prasyarat: server smoke berjalan (ENABLE_SMOKE=1 npx next build && start).
// Jalankan: PORT=3121 node scripts/handover-flow-test/e2e_runtime_test.mjs
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const APP_PORT = process.env.PORT || 3121
const BASE = `http://localhost:${APP_PORT}`
const PORT = 9257
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
  '--user-data-dir=/tmp/tb418-chrome-profile',
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
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

await send('Page.navigate', { url: BASE + '/__smoke' })
await sleep(3500)

console.log('\n=== E2E BROWSER NYATA (Chrome CDP) — alur Handover (t_b418827b) ===\n')

// ---------- 1) daftar handover ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-handovers')
    if (!sec) return { err: 'no section' }
    const t = sec.querySelector('.desktop-table-view')
    const text = t ? t.textContent : ''
    const heads = [...sec.querySelectorAll('.desktop-table-view th')].map(x => x.textContent.trim())
    return {
      heads,
      hasBarang: /Barang/.test(text),
      hasUnavailable: /Rincian barang belum tersedia/.test(text),
      hasLegacy: /Status lama "CONFIRMED"/.test(text),
      hasDelivered: /Sudah Diserahkan/.test(text),
      hasDeliverBtn: !!sec.querySelector('[data-testid^="btn-deliver-"]'),
      hasDeliveredMark: !!sec.querySelector('[data-testid^="delivered-"]'),
      hasSelect: !!t && !!t.querySelector('select'),
      inlineActions: (() => { const b = sec.querySelector('[data-testid^="btn-edit-"]'); return b ? /inline-flex/.test(b.parentElement.getAttribute('style') || '') : false })()
    }
  })()`)
  check('1a seksi Handover ada dgn kolom Barang', r.hasBarang === true, JSON.stringify(r.heads))
  check('1b data lama -> "Rincian barang belum tersedia"', r.hasUnavailable === true)
  check('1c status lama CONFIRMED tampil dgn catatan (bukan diklaim)', r.hasLegacy === true)
  check('1d ada baris "Sudah Diserahkan" (bukti fisik h1)', r.hasDelivered === true)
  check('1e tombol konfirmasi ✓ ada utk belum diserahkan', r.hasDeliverBtn === true)
  check('1f tanda ✓ statis utk sudah diserahkan', r.hasDeliveredMark === true)
  check('1g TIDAK ada dropdown status handover di daftar', r.hasSelect === false)
  check('1h aksi berbentuk baris inline (tidak bertumpuk)', r.inlineActions === true)
}

// ---------- 2) detail expand + prototype ----------
{
  const opened = await evalJs(`(() => {
    const sec = document.getElementById('mod-handovers')
    const b = sec.querySelector('[data-testid="btn-detail-h2"]')
    if (!b) return false
    b.scrollIntoView({ block: 'center', behavior: 'instant' })
    b.click()
    return true
  })()`)
  await sleep(500)
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-handovers')
    const d = sec.querySelector('[data-testid="handover-detail-h2"]')
    if (!d) return { open: false }
    const t = d.textContent
    return {
      open: true,
      purchase: /INV-LAMA-2/.test(t),
      pr: /PR-002/.test(t),
      penerima: /Pak Joko|Pak Andi|Mandor Tono/.test(t),
      rincian: /Rincian barang belum tersedia/.test(t),
      legacy: /Status lama/.test(t),
      proto: !!d.querySelector('[data-testid^="prototype-panel-"]'),
      protoHonest: /belum tersimpan|TIDAK ditulis/i.test((d.querySelector('[data-testid^="prototype-panel-"]') || {}).textContent || '')
    }
  })()`)
  check('2a klik Detail membuka detail', opened === true && r.open === true, JSON.stringify(r))
  check('2b referensi Purchase asal tampil', r.purchase === true)
  check('2c PR asal tampil', r.pr === true)
  check('2d penerima tampil', r.penerima === true)
  check('2e label rincian jujur di detail', r.rincian === true)
  check('2e2 catatan status lama tampil (bukan diklaim)', r.legacy === true)
  check('2f prototype per-item tampil', r.proto === true)
  check('2g prototype jujur belum tersimpan', r.protoHonest === true)
  check('2h NOL request mutasi DB sejauh ini', mutationRequests === 0, 'mutations=' + mutationRequests)
}

// ---------- 3) modal edit handover ----------
{
  const r = await evalJs(`(() => {
    // Buka edit h2 (data lama tanpa rincian) lewat klik nyata
    const sec = document.getElementById('mod-handovers')
    const b = sec.querySelector('[data-testid="btn-edit-h2"]')
    b.scrollIntoView({ block: 'center', behavior: 'instant' })
    b.click()
    return true
  })()`)
  await sleep(600)
  const m = await evalJs(`(() => {
    const forms = [...document.querySelectorAll('.modal form.dialog')]
    const f = forms.find(x => /Edit Handover/.test(x.textContent))
    if (!f) return { open: false, count: forms.length }
    const t = f.textContent
    const selects = [...f.querySelectorAll('select')].map(s => (s.previousSibling || {}).textContent || '')
    return {
      open: true,
      noPenerimaan: !/Penerimaan \\(Purchase\\)/.test(t),
      noProject: !/Project \\(otomatis dari penerimaan/.test(t),
      noStatus: !/Status Serah Terima/.test(t),
      summary: !!f.querySelector('[data-testid="handover-source-summary"]'),
      items: !!f.querySelector('[data-testid="handover-items-summary"]'),
      rincianUnavailable: /Rincian barang belum tersedia/.test((f.querySelector('[data-testid="handover-rincian-unavailable"]') || {}).textContent || ''),
      textInput: !!f.querySelector('input[type="text"]'),
      dateInput: !!f.querySelector('input[type="date"]'),
      fileInput: !!f.querySelector('input[type="file"]'),
      selects: f.querySelectorAll('select').length
    }
  })()`)
  check('3a modal Edit Handover terbuka', r === true && m.open === true, JSON.stringify(m))
  check('3b TIDAK ada dropdown Penerimaan di edit', m.noPenerimaan === true)
  check('3c TIDAK ada dropdown Project di edit', m.noProject === true)
  check('3d TIDAK ada dropdown Status di edit', m.noStatus === true)
  check('3e nol <select> di modal edit', m.selects === 0, 'selects=' + m.selects)
  check('3f ringkasan sumber read-only tampil', m.summary === true)
  check('3g daftar rincian barang wajib terlihat', m.items === true)
  check('3h label rincian jujur di modal', m.rincianUnavailable === true)
  check('3i field metadata tetap (teks/tanggal/foto)', m.textInput && m.dateInput && m.fileInput)
  // Tutup modal (Batal)
  await evalJs(`(() => { const f = [...document.querySelectorAll('.modal form.dialog')].find(x => /Edit Handover/.test(x.textContent)); if (f) { const b = [...f.querySelectorAll('.actions button')].find(x => x.textContent.trim() === 'Batal'); b && b.click(); } return true })()`)
  await sleep(300)
}

// ---------- 4) modal tambah handover ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-handovers')
    const b = [...sec.querySelectorAll('.toolbar button')].find(x => /Tambah Handover/.test(x.textContent))
    if (!b) return { found: false }
    b.click()
    return { found: true }
  })()`)
  await sleep(600)
  const m = await evalJs(`(() => {
    const forms = [...document.querySelectorAll('.modal form.dialog')]
    const f = forms.find(x => /Tambah Handover/.test(x.textContent))
    if (!f) return { open: false }
    const sel = [...f.querySelectorAll('select')].find(s => /Pilih Penerimaan/.test(s.textContent))
    return {
      open: true,
      hasPenerimaan: !!sel,
      required: sel ? sel.required : false,
      noStatusDropdown: !/Status Serah Terima/.test(f.textContent),
      linkNote: /harus terhubung ke penerimaan/.test(f.textContent)
    }
  })()`)
  check('4a modal Tambah Handover terbuka', r.found === true && m.open === true, JSON.stringify(m))
  check('4b dropdown Penerimaan ada (link wajib)', m.hasPenerimaan === true)
  check('4c dropdown penerimaan required', m.required === true)
  check('4d TIDAK ada dropdown status di tambah', m.noStatusDropdown === true)
  check('4e keterangan link wajib tampil', m.linkNote === true)
  await evalJs(`(() => { const f = [...document.querySelectorAll('.modal form.dialog')].find(x => /Tambah Handover/.test(x.textContent)); if (f) { const b = [...f.querySelectorAll('.actions button')].find(x => x.textContent.trim() === 'Batal'); b && b.click(); } return true })()`)
  await sleep(300)
}

// ---------- 5) modul Purchase: alur belanja baru (t_9109cf5e) ----------
// Modul Purchase SUDAH DIROMBAK: tombol gudang/tukang/retur/refund serta
// dropdown status nota DIHAPUS TOTAL dari halaman ini (distribusi fisik
// pindah ke Handover). Verifikasi penuh alur belanja ada di
// scripts/purchase-flow-test/e2e_runtime_test.mjs — di sini cukup memastikan
// TIDAK ADA sisa aksi lama yang bocor.
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    if (!sec) return { err: 'no section' }
    const text = sec.textContent || ''
    return {
      hasTabReady: !!sec.querySelector('[data-testid="tab-ready"]'),
      hasTabHistory: !!sec.querySelector('[data-testid="tab-history"]'),
      hasBulkStock: /Masuk Stok Gudang/.test(text),
      hasBulkTukang: /Serah Terima ke Tukang|Serah ke Tukang/.test(text),
      hasStatusSelect: sec.querySelectorAll('select.status-select').length,
      hasTerimaBtn: sec.querySelectorAll('[data-testid^="btn-terima"]').length,
      hasReturRefund: /Retur|Refund/.test(text)
    }
  })()`)
  check('5a modul Purchase memakai dua tab baru', r.hasTabReady === true && r.hasTabHistory === true, JSON.stringify(r))
  check('5b TIDAK ada tombol "Masuk Stok Gudang" di Purchase', r.hasBulkStock === false)
  check('5c TIDAK ada tombol "Serah Terima ke Tukang" di Purchase', r.hasBulkTukang === false)
  check('5d TIDAK ada dropdown status nota di Purchase', r.hasStatusSelect === 0)
  check('5e TIDAK ada tombol "Terima Barang" lama', r.hasTerimaBtn === 0)
  check('5f TIDAK ada teks Retur/Refund di Purchase', r.hasReturRefund === false)
}

// ---------- 6) mobile ----------
{
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(900)
  const r = await evalJs(`(() => {
    const h = document.getElementById('mod-handovers')
    const rec = document.getElementById('mod-receivings')
    const hc = h ? h.querySelector('.mobile-cards-view') : null
    const rcText = rec ? (rec.textContent || '') : ''
    return {
      handoverRincian: hc ? /Rincian barang belum tersedia/.test(hc.textContent) : false,
      handoverDeliverBtn: hc ? !!hc.querySelector('[data-testid^="btn-deliver-mobile-"]') : false,
      purchaseBulkStock: /Masuk Stok Gudang/.test(rcText),
      purchaseBulkTukang: /Serah ke Tukang|Serah Terima ke Tukang/.test(rcText),
      purchaseHasCards: rec ? rec.querySelectorAll('.mobile-cards-view .mobile-card').length : 0
    }
  })()`)
  check('6a kartu handover menampilkan label rincian jujur', r.handoverRincian === true)
  check('6b tombol konfirmasi mobile ada', r.handoverDeliverBtn === true)
  check('6c mobile Purchase: kartu tampil', r.purchaseHasCards > 0, 'cards=' + r.purchaseHasCards)
  check('6d mobile Purchase: TIDAK ada bulk stok', r.purchaseBulkStock === false)
  check('6e mobile Purchase: TIDAK ada bulk tukang', r.purchaseBulkTukang === false)
}

console.log(`\nE2E: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
ws.close()
chrome.kill()
process.exit(fail ? 1 : 0)
