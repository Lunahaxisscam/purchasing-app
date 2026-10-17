// ============================================================
// E2E — /__smoke di Chrome SUNGGUHAN (CDP) untuk t_b03c5228
// ============================================================
// jsdom tidak menghitung layout dan tidak bisa membuktikan tombol benar-benar
// terlihat. Skrip ini memeriksa di browser nyata:
//   1) kartu antrean Handover: 2 aksi utama (gudang/tukang) + Bermasalah
//      sebagai aksi sekunder + langkah penutup;
//   2) status teknis (KE_GUDANG/KE_TUKANG/DI_GUDANG/DI_TUKANG/RETUR/REFUND)
//      TIDAK muncul sebagai teks di modul Handover;
//   3) tidak ada overflow horizontal di desktop maupun mobile 390px;
//   4) modul Purchase tidak punya kontrol distribusi fisik.
//
// Pemakaian: node e2e_runtime_test.mjs <baseUrl>
// ============================================================
import { spawn } from 'node:child_process'
import net from 'node:net'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')

const BASE = process.argv[2] || 'http://127.0.0.1:3161'
const PORT = 9361
const CHROME = '/usr/bin/google-chrome'

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
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

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--user-data-dir=/tmp/tb03c-chrome-profile',
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
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BASE + '/__smoke' })
await sleep(4000)

console.log('=== E2E CHROME NYATA — antrean distribusi fisik (t_b03c5228) ===\n')

// ---------- 1) kartu antrean ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-handovers')
    if (!sec) return { err: 'no section' }
    const banner = sec.querySelector('[data-testid="handover-queue-banner"]')
    if (!banner) return { err: 'no banner' }
    const cards = [...banner.querySelectorAll('[data-testid^="queue-card-"]')]
    const c = cards[0]
    if (!c) return { err: 'no card' }
    const id = c.getAttribute('data-testid').replace('queue-card-', '')
    const primary = c.querySelector('[data-testid="queue-primary-' + id + '"]')
    const rect = el => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top) } }
    const gudang = c.querySelector('[data-testid="queue-act-gudang-' + id + '"]')
    const tukang = c.querySelector('[data-testid="queue-act-tukang-' + id + '"]')
    const problem = c.querySelector('[data-testid="queue-problem-' + id + '"]')
    const finish = c.querySelector('[data-testid="queue-finish-' + id + '"]')
    return {
      cards: cards.length,
      id,
      primaryBtns: primary ? primary.querySelectorAll('button').length : 0,
      gudangVisible: !!gudang && rect(gudang).w > 40 && rect(gudang).h > 10,
      tukangVisible: !!tukang && rect(tukang).w > 40 && rect(tukang).h > 10,
      problemVisible: !!problem && rect(problem).w > 40 && rect(problem).h > 10,
      problemInPrimary: !!problem && !!primary && primary.contains(problem),
      problemSmallerThanPrimary: !!problem && !!gudang && rect(problem).h <= rect(gudang).h,
      // Tiga tombol harus berada di SATU baris baca (tidak bertumpuk vertikal
      // masing-masing satu baris penuh) — bukti "3 aksi" ringkas.
      sameRow: !!gudang && !!tukang && !!problem
        && Math.abs(rect(gudang).top - rect(tukang).top) <= 6
        && Math.abs(rect(gudang).top - rect(problem).top) <= 12,
      finishVisible: !!finish,
      text: c.textContent || ''
    }
  })()`)
  check('1a banner antrean tampil di modul Handover', !r.err && r.cards > 0, JSON.stringify(r).slice(0, 200))
  check('1b baris aksi fisik berisi tepat 3 tombol (gudang/tukang/bermasalah)', r.primaryBtns === 3, 'btns=' + r.primaryBtns)
  check('1c tombol Gudang benar-benar terlihat (layout nyata)', r.gudangVisible === true)
  check('1d tombol Tukang benar-benar terlihat', r.tukangVisible === true)
  check('1e tombol Bermasalah terlihat', r.problemVisible === true)
  check('1f Bermasalah ada di baris aksi fisik yang sama', r.problemInPrimary === true)
  check('1g Bermasalah tidak lebih menonjol dari aksi utama', r.problemSmallerThanPrimary === true)
  check('1i 3 aksi berada di satu baris (ringkas, tidak bertumpuk)', r.sameRow === true, 'sameRow=' + r.sameRow)
  check('1h langkah penutup (tandai diserahkan) ada', r.finishVisible === true)
  // status teknis tidak bocor
  const leaked = ['KE_GUDANG', 'KE_TUKANG', 'LANGSUNG_LAPANGAN', 'DI_GUDANG', 'DI_TUKANG', 'RECEIVED', 'RETUR', 'REFUND'].filter(t => r.text.includes(t))
  check('1i tidak ada kode status mentah di kartu', leaked.length === 0, leaked.join(','))
}

// ---------- 2) modul Handover keseluruhan bebas kode status ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-handovers')
    const t = sec ? (sec.textContent || '') : ''
    return {
      keGudang: t.includes('KE_GUDANG'),
      keTukang: t.includes('KE_TUKANG'),
      diGudang: t.includes('DI_GUDANG'),
      diTukang: t.includes('DI_TUKANG'),
      retur: /\\bRETUR\\b/.test(t),
      refund: /\\bREFUND\\b/.test(t),
      hasUnavailable: /Rincian barang belum tersedia/.test(t),
      hasHumanDest: /Tujuan:/.test(t),
      hasDestLabel: /Tujuan barang:/.test(t)
    }
  })()`)
  check('2a modul Handover bebas KE_GUDANG', r.keGudang === false)
  check('2b modul Handover bebas KE_TUKANG', r.keTukang === false)
  check('2c modul Handover bebas DI_GUDANG', r.diGudang === false)
  check('2d modul Handover bebas DI_TUKANG', r.diTukang === false)
  check('2e modul Handover bebas RETUR/REFUND mentah', r.retur === false && r.refund === false)
  check('2f label jujur "Rincian barang belum tersedia" tetap ada', r.hasUnavailable === true)
  // Data /__smoke tidak punya receivings.alokasi -> badge "Tujuan:" memang
  // TIDAK boleh muncul (tidak mengarang tujuan). Yang diuji: label tujuan
  // memakai kalimat manusia (bukan kode) di mana pun ia muncul.
  const destLabels = await evalJs(`(() => {
    const sec = document.getElementById('mod-handovers')
    const tags = sec ? [...sec.querySelectorAll('[data-testid^="queue-dest-"]')].map(x => x.textContent) : []
    return { tags, count: tags.length }
  })()`)
  check('2g label tujuan memakai bahasa manusia (bukan kode DB)',
    destLabels.tags.every(t => /^Tujuan:\s*(Gudang|Tukang|Langsung ke lapangan)$/.test(t.trim())),
    JSON.stringify(destLabels.tags))
  check('2h tanpa alokasi tercatat -> tujuan TIDAK dikarang',
    destLabels.count === 0, 'tags=' + JSON.stringify(destLabels.tags))
}

// ---------- 3) Purchase bebas kontrol fisik ----------
{
  const r = await evalJs(`(() => {
    const sec = document.getElementById('mod-receivings')
    const t = sec ? (sec.textContent || '') : ''
    return {
      exists: !!sec,
      stock: /Masuk Stok Gudang/.test(t),
      tukang: /Serah Terima ke Tukang|Serah ke Tukang/.test(t),
      retur: /Retur|Refund/.test(t),
      tabs: !!sec && !!sec.querySelector('[data-testid="tab-ready"]') && !!sec.querySelector('[data-testid="tab-history"]')
    }
  })()`)
  check('3a modul Purchase ada (dua tab)', r.exists && r.tabs === true)
  check('3b tidak ada tombol Masuk Stok Gudang', r.stock === false)
  check('3c tidak ada tombol Serah Terima ke Tukang', r.tukang === false)
  check('3d tidak ada Retur/Refund', r.retur === false)
}

// ---------- 4) overflow horizontal (desktop + mobile) ----------
for (const vp of [
  { label: 'desktop-1440', width: 1440, height: 900, mobile: false },
  { label: 'desktop-1280', width: 1280, height: 800, mobile: false },
  { label: 'mobile-390', width: 390, height: 844, mobile: true },
  { label: 'mobile-360', width: 360, height: 800, mobile: true }
]) {
  await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.mobile ? 2 : 1, mobile: vp.mobile })
  await sleep(700)
  const r = await evalJs(`(() => {
    const d = document.documentElement
    const banner = document.querySelector('[data-testid="handover-queue-banner"]')
    let cardOverflow = 0
    if (banner) {
      for (const el of banner.querySelectorAll('*')) {
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible') cardOverflow++
      }
    }
    return { docOverflow: d.scrollWidth - d.clientWidth, cardOverflow }
  })()`)
  check(`4 ${vp.label}: tanpa scroll horizontal di body`, r.docOverflow <= 1, 'delta=' + r.docOverflow)
  check(`4 ${vp.label}: kartu antrean tidak memaksa overflow`, r.cardOverflow === 0, 'n=' + r.cardOverflow)
}

check('5 nol request mutasi DB selama pemeriksaan tampilan', mutationRequests === 0, 'mutations=' + mutationRequests)

console.log(`\nE2E: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
ws.close()
chrome.kill()
process.exit(fail ? 1 : 0)
