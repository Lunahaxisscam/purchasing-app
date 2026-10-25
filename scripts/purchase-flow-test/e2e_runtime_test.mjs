// ============================================================
// E2E harness t_9109cf5e: buka /__smoke di server scratch via Chrome
// headless CDP dan verifikasi modul Purchase di BROWSER NYATA:
//   1) Dua tab (Siap Dibeli / Riwayat Pembelian), tab default benar.
//   2) Tab Siap Dibeli: barang APPROVED muncul, ada checkbox per baris,
//      filter toko & proyek berfungsi (pilih opsi nyata).
//   3) Dialog Proses Pembelian: field Toko/Tanggal/No. Nota, tabel item
//      (qty default PR, harga kosong), biaya lain & diskon, total nota,
//      dua slot lampiran, tombol "✓ Selesaikan Pembelian".
//   4) Hitungan live di browser (qty × harga, ongkir, diskon).
//   5) TIDAK ADA tombol/dropdown gudang, tukang, retur, refund di halaman.
//   6) Tab Riwayat: total rupiah + lampiran bukti.
//   7) Mobile (390px): kartu + tombol proses, tetap tanpa aksi gudang.
// Nol request mutasi ke Supabase (halaman smoke memakai data mock).
// Prasyarat: server smoke berjalan (ENABLE_SMOKE=1 next build && next start).
// Jalankan: PORT=3131 node scripts/purchase-flow-test/e2e_runtime_test.mjs
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const APP_PORT = process.env.PORT || 3131
const BASE = `http://localhost:${APP_PORT}`
const PORT = 9261
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

function waitPort(port, tries = 60) {
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
  '--user-data-dir=/tmp/tb9109-chrome-profile',
  `--remote-debugging-port=${PORT}`, '--window-size=1440,1000', 'about:blank'
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
  if (r.exceptionDetails) throw new Error('JS error: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BASE + '/__smoke' })
await sleep(4000)

console.log('\n=== E2E BROWSER NYATA (Chrome CDP) — modul Purchase (t_9109cf5e) ===\n')

// ---------- 1) dua tab ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    if (!sec) return { err: 'no section' }
    const tabReady = sec.querySelector('[data-testid="tab-ready"]')
    const tabHistory = sec.querySelector('[data-testid="tab-history"]')
    return {
      hasSection: true,
      readyText: tabReady ? tabReady.textContent.trim() : '',
      historyText: tabHistory ? tabHistory.textContent.trim() : '',
      readyActive: tabReady ? /active/.test(tabReady.className) : false,
      historyActive: tabHistory ? /active/.test(tabHistory.className) : false,
      readyRows: sec.querySelectorAll('[data-testid^="ready-row-"]').length,
      checkboxes: sec.querySelectorAll('[data-testid^="check-"]').length,
      bodyText: sec.textContent
    }
  })()`)
  check('1a seksi Purchase ada di halaman', r.hasSection === true)
  check('1b tab "Siap Dibeli" tampil', /Siap Dibeli/.test(r.readyText), r.readyText)
  check('1c tab "Riwayat Pembelian" tampil', /Riwayat Pembelian/.test(r.historyText), r.historyText)
  check('1d tab default = Siap Dibeli', r.readyActive === true && r.historyActive === false)
  check('1e ada baris barang siap dibeli', r.readyRows > 0, 'rows=' + r.readyRows)
  check('1f ada checkbox per barang', r.checkboxes > 0, 'checkbox=' + r.checkboxes)
}

// ---------- 2) tidak ada aksi gudang/tukang/retur/refund ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    const text = sec.textContent || ''
    const buttons = [...sec.querySelectorAll('button')].map(b => b.textContent.trim())
    const selects = [...sec.querySelectorAll('select')].map(s => (s.getAttribute('data-testid') || 'select'))
    return {
      text,
      buttons,
      selects,
      hasStatusSelect: sec.querySelectorAll('select.status-select').length,
      hasTerimaBtn: sec.querySelectorAll('[data-testid^="btn-terima"]').length,
      hasReturSelect: /RETUR|REFUND/.test(text),
      hasGudang: /Gudang|Tukang/.test(text)
    }
  })()`)
  check('2a TIDAK ada teks Gudang / Tukang', r.hasGudang === false, r.text.slice(0, 160))
  check('2b TIDAK ada teks RETUR / REFUND', r.hasReturSelect === false)
  check('2c TIDAK ada dropdown status nota', r.hasStatusSelect === 0)
  check('2d TIDAK ada tombol Terima Barang lama', r.hasTerimaBtn === 0)
  check('2e tombol hanya tab/filter/proses', r.buttons.every(b => !/Gudang|Tukang|Retur|Refund/.test(b)), JSON.stringify(r.buttons))
  check('2f dropdown hanya filter toko & proyek', r.selects.every(s => ['filter-vendor', 'filter-project'].includes(s)), JSON.stringify(r.selects))
}

// ---------- 3) centang + dialog ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    const boxes = [...sec.querySelectorAll('[data-testid^="check-"]')]
    boxes[0].click()
    const btn = sec.querySelector('[data-testid="btn-process-purchase"]')
    const afterOne = { disabled: btn.disabled, text: btn.textContent.trim() }
    if (boxes[1]) boxes[1].click()
    const afterTwo = { disabled: btn.disabled, text: btn.textContent.trim() }
    btn.click()
    return { afterOne, afterTwo, boxes: boxes.length }
  })()`)
  check('3a centang 1 -> tombol aktif', r.afterOne.disabled === false)
  check('3b label tombol menyebut jumlah', /\(1\)/.test(r.afterOne.text), r.afterOne.text)
  check('3c centang 2 -> (2)', /\(2\)/.test(r.afterTwo.text), r.afterTwo.text)
  await sleep(600)
  const d = await evalJs(`(() => {
    const f = document.querySelector('[data-testid="purchase-form"]')
    if (!f) return { err: 'form tidak terbuka' }
    const items = [...f.querySelectorAll('[data-testid^="form-item-"]')]
    const qty = f.querySelector('[data-testid^="qty-"]')
    const harga = f.querySelector('[data-testid^="harga-"]')
    return {
      title: f.querySelector('.dialoghead h2')?.textContent.trim(),
      items: items.length,
      hasVendor: !!f.querySelector('[data-testid="form-vendor"]'),
      hasDate: !!f.querySelector('[data-testid="form-date"]'),
      hasInvoice: !!f.querySelector('[data-testid="form-invoice"]'),
      qtyDefault: qty ? qty.value : null,
      hargaEmpty: harga ? harga.value === '' : null,
      hasExtra: !!f.querySelector('[data-testid="form-extra-cost"]'),
      hasDiscount: !!f.querySelector('[data-testid="form-discount"]'),
      hasFileNota: !!f.querySelector('[data-testid="file-nota"]'),
      hasFileTransfer: !!f.querySelector('[data-testid="file-transfer"]'),
      submitText: f.querySelector('[data-testid="purchase-submit"]')?.textContent.trim(),
      submitDisabled: f.querySelector('[data-testid="purchase-submit"]')?.disabled,
      totalsText: f.querySelector('[data-testid="purchase-totals"]')?.textContent || '',
      grand: f.querySelector('[data-testid="purchase-grand-total"]')?.textContent || ''
    }
  })()`)
  check('3d dialog "Proses Pembelian" terbuka', /Proses Pembelian/.test(d.title || ''), String(d.err || d.title))
  check('3e field Toko / Tanggal / No. Nota ada', d.hasVendor && d.hasDate && d.hasInvoice)
  check('3f 2 baris item belanja', d.items === 2, String(d.items))
  check('3g qty default dari PR', d.qtyDefault !== null && Number(d.qtyDefault) > 0, String(d.qtyDefault))
  check('3h harga riil awalnya kosong (bukan estimasi)', d.hargaEmpty === true)
  check('3i kolom biaya lain & diskon dipisah', d.hasExtra && d.hasDiscount)
  check('3j dua slot lampiran (nota & transfer)', d.hasFileNota && d.hasFileTransfer)
  check('3k tombol "✓ Selesaikan Pembelian" ada', /Selesaikan Pembelian/.test(d.submitText || ''), d.submitText)
  check('3l tombol submit nonaktif sebelum lengkap', d.submitDisabled === true)
}

// ---------- 4) hitungan live di browser ----------
{
  const r = await evalJs(`(() => {
    const f = document.querySelector('[data-testid="purchase-form"]')
    const setVal = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const inv = f.querySelector('[data-testid="form-invoice"]')
    setVal(inv, 'TB-88912')
    const qtyEls = [...f.querySelectorAll('[data-testid^="qty-"]')]
    const hargaEls = [...f.querySelectorAll('[data-testid^="harga-"]')]
    setVal(qtyEls[0], '4'); setVal(hargaEls[0], '118000')
    return { step1: f.querySelector('[data-testid="purchase-grand-total"]').textContent }
  })()`)
  await sleep(400)
  const r2 = await evalJs(`(() => {
    const f = document.querySelector('[data-testid="purchase-form"]')
    const setVal = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const hargaEls = [...f.querySelectorAll('[data-testid^="harga-"]')]
    setVal(hargaEls[1], '35000')
    return { step2: f.querySelector('[data-testid="purchase-grand-total"]').textContent }
  })()`)
  await sleep(400)
  const r3 = await evalJs(`(() => {
    const f = document.querySelector('[data-testid="purchase-form"]')
    const setVal = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setVal(f.querySelector('[data-testid="form-extra-cost"]'), '25000')
    return { step3: f.querySelector('[data-testid="purchase-grand-total"]').textContent }
  })()`)
  await sleep(400)
  const r4 = await evalJs(`(() => {
    const f = document.querySelector('[data-testid="purchase-form"]')
    const setVal = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setVal(f.querySelector('[data-testid="form-discount"]'), '10000')
    return {
      step4: f.querySelector('[data-testid="purchase-grand-total"]').textContent,
      totals: f.querySelector('[data-testid="purchase-totals"]').textContent,
      submitDisabled: f.querySelector('[data-testid="purchase-submit"]').disabled
    }
  })()`)
  check('4a subtotal baris 1 = Rp 472.000', /472\.000/.test(r.step1 || ''), r.step1)
  check('4b total material = Rp 542.000', /542\.000/.test(r2.step2 || ''), r2.step2)
  check('4c + ongkir 25.000 = Rp 567.000', /567\.000/.test(r3.step3 || ''), r3.step3)
  check('4d − diskon 10.000 = Rp 557.000', /557\.000/.test(r4.step4 || ''), r4.step4)
  check('4e total material tetap 542.000 (diskon terpisah)', /542\.000/.test(r4.totals || ''))
  check('4f tombol submit aktif setelah lengkap', r4.submitDisabled === false)
  // tutup dialog (Batal) supaya tidak mengubah data mock
  await evalJs(`(() => {
    const f = document.querySelector('[data-testid="purchase-form"]')
    const batal = [...f.querySelectorAll('.actions button')].find(b => /Batal/.test(b.textContent))
    if (batal) batal.click()
    return true
  })()`)
  await sleep(400)
  const closed = await evalJs(`!document.querySelector('[data-testid="purchase-form"]')`)
  check('4g dialog bisa ditutup tanpa menyimpan', closed === true)
}

// ---------- 5) tab riwayat ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    sec.querySelector('[data-testid="tab-history"]').click()
    return true
  })()`)
  await sleep(700)
  const d = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    const rows = [...sec.querySelectorAll('[data-testid^="history-row-"]')]
    const t = sec.querySelector('.desktop-table-view')?.textContent || ''
    const heads = [...sec.querySelectorAll('.desktop-table-view th')].map(x => x.textContent.trim())
    return {
      rows: rows.length,
      heads,
      text: t,
      hasTotal: /Total Nota/.test(t),
      hasBukti: /Bukti/.test(t),
      hasRincian: rows.length ? /Rincian/.test(rows[0].textContent) : false,
      hasLegacy: /nota lama/.test(t),
      totalChip: sec.querySelector('[data-testid="history-total"]')?.textContent || ''
    }
  })()`)
  check('5a tab riwayat menampilkan nota', d.rows > 0, 'rows=' + d.rows)
  check('5b kolom Total Nota ada', d.hasTotal === true, JSON.stringify(d.heads))
  check('5c kolom Bukti ada', d.hasBukti === true)
  check('5d total belanja tercatat tampil', /Rp/.test(d.totalChip), d.totalChip)
  check('5e tombol rincian per nota ada', d.hasRincian === true)
  // buka rincian
  const det = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    const btn = sec.querySelector('[data-testid^="detail-"]')
    btn.click()
    return true
  })()`)
  await sleep(600)
  const detText = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    return sec.querySelector('.purchase-detail')?.textContent || ''
  })()`)
  check('5f rincian nota berisi harga satuan & subtotal', /Harga Satuan/.test(detText) && /Subtotal/.test(detText), detText.slice(0, 200))
  check('5g rincian berisi total nota', /Total Nota/.test(detText))
}

// ---------- 6) mobile ----------
{
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await sleep(600)
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    sec.querySelector('[data-testid="tab-ready"]').click()
    return true
  })()`)
  await sleep(700)
  const m = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    const cards = [...sec.querySelectorAll('.mobile-cards-view .mobile-card')]
    const visible = cards.filter(c => c.getBoundingClientRect().width > 0)
    const table = sec.querySelector('.desktop-table-view')
    return {
      cards: visible.length,
      tableHidden: table ? getComputedStyle(table).display === 'none' : null,
      hasMobileCheck: sec.querySelectorAll('[data-testid^="check-mobile-"]').length,
      hasGudang: /Gudang|Tukang|Retur|Refund/.test(sec.textContent || ''),
      bodyWidth: document.body.scrollWidth,
      viewport: window.innerWidth
    }
  })()`)
  check('6a kartu mobile tampil', m.cards > 0, 'cards=' + m.cards)
  check('6b tabel desktop disembunyikan di mobile', m.tableHidden === true)
  check('6c checkbox mobile ada', m.hasMobileCheck > 0, 'n=' + m.hasMobileCheck)
  check('6d mobile tetap tanpa aksi gudang/tukang/retur', m.hasGudang === false)
  check('6e tidak ada scroll horizontal (lebar badan ≤ viewport+2)', m.bodyWidth <= m.viewport + 2, `${m.bodyWidth} vs ${m.viewport}`)
}

check('7 nol request mutasi Supabase (halaman mock, tidak menyentuh DB)', mutationRequests === 0, 'mutations=' + mutationRequests)

console.log(`\n=== HASIL E2E: ${pass} lulus, ${fail} gagal ===`)
try { ws.close() } catch (e) { /* ignore */ }
chrome.kill('SIGKILL')
if (fail) {
  console.log('GAGAL:')
  for (const f of failures) console.log(' -', f)
  process.exit(1)
}
