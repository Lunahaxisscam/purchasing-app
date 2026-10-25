// ============================================================
// RUNTIME GEOMETRY PROBE — compact Admin Suite
// ============================================================
// Mengukur GEOMETRI NYATA (scrollWidth vs clientWidth) di browser yang SUDAH
// ADA. Skrip ini TIDAK meluncurkan, meng-install, atau mengunduh browser
// apa pun — sesuai mandat DAT, browser VPS tidak boleh diaktifkan diam-diam.
//
// Dua cara pakai:
//
// 1) Lewat browser yang sudah dibuka pengguna/agent (CDP endpoint yang sudah
//    hidup), mis. Chrome di PC dengan --remote-debugging-port=9222:
//
//      node scripts/compact-admin-test/runtime_geometry.mjs \
//        http://127.0.0.1:9222 http://localhost:3000
//
// 2) Tanpa Node/CDP — tempel isi PROBE_SOURCE (lihat `--print-probe`) ke
//    console DevTools pada tab aplikasi:
//
//      node scripts/compact-admin-test/runtime_geometry.mjs --print-probe
//
// Keduanya menjalankan pemeriksaan yang sama:
//   * document.documentElement.scrollWidth <= clientWidth + 1
//   * setiap container yang terlihat: scrollWidth <= clientWidth + 1
//   * tidak ada elemen teks wajib yang terpotong (clientWidth < scrollWidth
//     pada sel/elemen berisi teks, di luar elemen scroll vertikal)
//   * target sentuh >= 40px pada lebar <= 1024
//   * font input >= 16px pada lebar <= 1024 (anti-zoom iOS)
//
// Catatan kejujuran: skrip ini hanya BUKTI bila dijalankan pada browser
// nyata. Di lingkungan tanpa browser, hasilnya WAJIB dilaporkan sebagai
// UNVERIFIED (lihat docs/compact-admin-report.md).
// ============================================================
import http from 'node:http'

export const VIEWPORTS = [
  { w: 360, h: 780, mobile: true },
  { w: 390, h: 844, mobile: true },
  { w: 412, h: 915, mobile: true },
  { w: 768, h: 1024, mobile: true },
  { w: 1024, h: 768, mobile: false },
  { w: 1280, h: 800, mobile: false },
  { w: 1440, h: 900, mobile: false }
]

// Nama menu sidebar -> teks yang diklik (sama dengan label modul di UI).
export const MODULES = [
  'Dashboard',
  'RAB & BOQ',
  'Invoice Penjualan',
  'Stok Workshop',
  'Customer CRM',
  'Actual Labor',
  'Marketing',
  'Budgeting',
  'RAP',
  'Perbandingan RAB',
  'Project Finance',
  'Finance',
  'Upah Tukang',
  'Settings'
]

export const PROBE_SOURCE = `(() => {
  const de = document.documentElement
  const docOverflow = Math.max(0, de.scrollWidth - de.clientWidth)

  const visible = el => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (r.width <= 0 || r.height <= 0) return false
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    if (parseFloat(cs.opacity || '1') === 0) return false
    return true
  }

  // Container yang punya overflow sendiri (scroll vertikal / panel) tetap
  // diperiksa horizontalnya: kita ingin TIDAK ada scroller samping.
  const containers = []
  for (const el of document.querySelectorAll('main, section, .content, .panel, .table, [class*="-table-wrap"], .cards, .toolbar, .filter-tabs, .modal, .dialog, .si-modal-card')) {
    if (!visible(el)) continue
    const over = Math.max(0, el.scrollWidth - el.clientWidth)
    if (over > 1) {
      containers.push({
        cls: String(el.className || '').slice(0, 70),
        tag: el.tagName,
        over,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth
      })
    }
  }

  // Teks terpotong: elemen dengan overflow hidden + teks lebih lebar dari
  // kotaknya (ellipsis menyembunyikan nilai wajib).
  const clipped = []
  for (const el of document.querySelectorAll('td, th, .mobile-val, .card strong, .card-label, .st-card-title b, .crm-row, code')) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX !== 'hidden' && cs.textOverflow !== 'ellipsis') continue
    if (el.scrollWidth > el.clientWidth + 1 && (el.textContent || '').trim()) {
      clipped.push({ cls: String(el.className || '').slice(0, 50), text: (el.textContent || '').trim().slice(0, 40) })
    }
  }

  // Target sentuh & font input (hanya untuk layar kecil).
  const narrow = window.innerWidth <= 1024
  const smallTouch = []
  const smallFont = []
  if (narrow) {
    for (const el of document.querySelectorAll('button, a[href], select, [role=button]')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (Math.min(r.width, r.height) < 40) smallTouch.push({ h: Math.round(r.height), t: (el.textContent || '').trim().slice(0, 24) })
    }
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (!visible(el)) continue
      const t = (el.getAttribute('type') || '').toLowerCase()
      if (t === 'checkbox' || t === 'radio') continue
      const fs = parseFloat(getComputedStyle(el).fontSize || '0')
      if (fs > 0 && fs < 16) smallFont.push({ fs, p: el.getAttribute('placeholder') || el.tagName })
    }
  }

  return {
    url: location.href,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    docOverflow,
    containers: containers.slice(0, 8),
    containerCount: containers.length,
    clipped: clipped.slice(0, 8),
    clippedCount: clipped.length,
    smallTouch: smallTouch.slice(0, 6),
    smallTouchCount: smallTouch.length,
    smallFont: smallFont.slice(0, 6),
    smallFontCount: smallFont.length,
    ok: docOverflow <= 1 && containers.length === 0 && clipped.length === 0 && smallTouch.length === 0 && smallFont.length === 0
  }
})()`

export function verdict(probe) {
  const problems = []
  if (probe.docOverflow > 1) problems.push(`document overflow ${probe.docOverflow}px`)
  if (probe.containerCount) problems.push(`${probe.containerCount} container scroll horizontal`)
  if (probe.clippedCount) problems.push(`${probe.clippedCount} teks terpotong`)
  if (probe.smallTouchCount) problems.push(`${probe.smallTouchCount} target sentuh < 40px`)
  if (probe.smallFontCount) problems.push(`${probe.smallFontCount} input font < 16px`)
  return problems
}

// ---------------- CLI: hubungkan ke CDP yang SUDAH hidup ----------------
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = ''
      res.on('data', c => { d += c })
      res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

async function runCdp(cdpBase, appUrl) {
  const list = await getJson(`${cdpBase.replace(/\/$/, '')}/json/list`)
  const page = list.find(t => t.type === 'page')
  if (!page) throw new Error('Tidak ada tab page pada CDP endpoint tersebut.')
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const WebSocket = require('/home/ubuntu/.hermes/hermes-agent/node_modules/ws')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

  let id = 0
  const pending = new Map()
  ws.on('message', raw => {
    const m = JSON.parse(raw)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id
    pending.set(mid, m => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)))
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result && r.result.value
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  await send('Page.enable')
  await send('Runtime.enable')

  const rows = []
  let violations = 0
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile
    })
    await sleep(150)
    await send('Page.navigate', { url: appUrl })
    await sleep(1500)
    for (const label of MODULES) {
      const clicked = await evaluate(`(() => {
        const btns = [...document.querySelectorAll('aside.app-sidebar nav button, nav button')]
        const b = btns.find(x => ((x.getAttribute('title') || '') + ' ' + (x.textContent || '')).includes(${JSON.stringify(label)}))
        if (!b) return false
        b.click(); return true
      })()`)
      await sleep(600)
      if (!clicked) { rows.push({ w: vp.w, module: label, skip: 'menu tidak ditemukan' }); continue }
      const probe = await evaluate(PROBE_SOURCE)
      const problems = verdict(probe)
      if (problems.length) violations += 1
      rows.push({ w: vp.w, module: label, probe, problems })
    }
  }
  ws.close()
  return { rows, violations }
}

function printRows(rows) {
  let lastW = null
  for (const r of rows) {
    if (r.w !== lastW) { console.log(`\n--- ${r.w}px ---`); lastW = r.w }
    if (r.skip) { console.log(`  ${r.module.padEnd(22)} DILEWATI (${r.skip})`); continue }
    const p = r.probe
    const mark = r.problems.length ? 'GAGAL' : 'OK'
    console.log(`  ${r.module.padEnd(22)} doc=${String(p.docOverflow).padStart(3)}px container=${String(p.containerCount).padStart(2)} clip=${String(p.clippedCount).padStart(2)} touch<40=${String(p.smallTouchCount).padStart(2)} font<16=${String(p.smallFontCount).padStart(2)}  ${mark}`)
    if (r.problems.length) console.log(`      ${r.problems.join(' · ')}`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--print-probe') {
    console.log(PROBE_SOURCE)
    return
  }
  const [cdpBase, appUrl] = args
  if (!cdpBase || !appUrl) {
    console.log('Pemakaian:')
    console.log('  node scripts/compact-admin-test/runtime_geometry.mjs <cdpBase> <appUrl>')
    console.log('  node scripts/compact-admin-test/runtime_geometry.mjs --print-probe')
    console.log('\nSkrip ini TIDAK meluncurkan browser. Sediakan CDP endpoint yang')
    console.log('sudah hidup (mis. Chrome di PC sendiri dengan --remote-debugging-port).')
    process.exitCode = 2
    return
  }
  console.log(`=== RUNTIME GEOMETRY — ${MODULES.length} modul × ${VIEWPORTS.length} viewport ===`)
  const { rows, violations } = await runCdp(cdpBase, appUrl)
  printRows(rows)
  const total = rows.filter(r => !r.skip).length
  console.log(`\n=== RINGKASAN: ${total} kombinasi diukur, ${violations} pelanggaran ===`)
  process.exitCode = violations ? 1 : 0
}

if (process.argv[1] && process.argv[1].endsWith('runtime_geometry.mjs')) {
  main().catch(e => { console.error('GAGAL:', e.message); process.exitCode = 1 })
}
