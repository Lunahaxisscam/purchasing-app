// ============================================================
// OVERFLOW CHECK — halaman /__smoke di Chrome sungguhan (CDP), t_cde1b8ad
// ============================================================
// Acceptance card: "desktop+mobile build, no body overflow". jsdom tidak
// menghitung layout, jadi pemeriksaan ini WAJIB di browser nyata:
//   - documentElement.scrollWidth <= clientWidth + 1  (tidak ada scroll
//     horizontal di level body/document)
//   - setiap elemen yang lebih lebar dari viewport dilaporkan; elemen yang
//     memang kontainer scroll (overflow-x auto/scroll) dianggap SAH.
//
// Pemakaian: node overflow_check.mjs <baseUrl> [outJson]
// ============================================================
import fs from 'node:fs'

const BASE = process.argv[2] || 'http://127.0.0.1:3127'
const OUT = process.argv[3] || ''
const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9333'

const VIEWPORTS = [
  { label: 'desktop-1440', width: 1440, height: 900, mobile: false },
  { label: 'desktop-1280', width: 1280, height: 800, mobile: false },
  { label: 'tablet-768', width: 768, height: 1024, mobile: true },
  { label: 'mobile-412', width: 412, height: 915, mobile: true },
  { label: 'mobile-390', width: 390, height: 844, mobile: true },
  { label: 'mobile-360', width: 360, height: 800, mobile: true }
]

async function httpJson(path) {
  const r = await fetch(CDP_HTTP + path)
  return r.json()
}

async function main() {
  // Buka tab baru lewat /json/new (Chrome 111+ butuh PUT)
  const target = await (await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(BASE + '/__smoke')}`, { method: 'PUT' })).json()
  const wsUrl = target.webSocketDebuggerUrl
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const myId = ++id
    pending.set(myId, { resolve, reject })
    ws.send(JSON.stringify({ id: myId, method, params }))
  })

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400))
    return r.result.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  // Tunggu halaman siap (__smoke merender semua modul termasuk Purchase)
  for (let i = 0; i < 60; i++) {
    const ready = await evalJs(`document.readyState === 'complete' && !!document.querySelector('#mod-receivings, .purchase-tabs')`)
    if (ready) break
    await new Promise(r => setTimeout(r, 250))
  }

  const PROBE = `(() => {
    const d = document.documentElement, b = document.body;
    const vw = window.innerWidth;
    const offenders = [];
    const scrollable = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX)) scrollable.add(el);
    }
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.height <= 0 || r.width <= vw + 2) continue;
      // Dianggap SAH bila ada ancestor yang meng-clip/menggeser (kontainer
      // scroll tabel, dialog dengan overflow, dsb) — pola "⇄ Geser ke kanan"
      // yang memang disengaja aplikasi ini.
      let clipped = false, p = el.parentElement;
      while (p) {
        if (scrollable.has(p)) { clipped = true; break }
        p = p.parentElement;
      }
      if (clipped) continue;
      offenders.push({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 70),
        w: Math.round(r.width),
        overflowX: getComputedStyle(el).overflowX
      });
    }
    // Kontainer scroll yang ISINYA melebar: sah, tapi dicatat untuk laporan.
    const wideScrollers = [...scrollable].filter(s => s.scrollWidth > s.clientWidth + 2)
      .map(s => ({ cls: String(s.className || s.tagName).slice(0, 60), sw: s.scrollWidth, cw: s.clientWidth }))
    return {
      vw,
      docScrollW: d.scrollWidth,
      docClientW: d.clientWidth,
      bodyScrollW: b.scrollWidth,
      docOverflow: d.scrollWidth > d.clientWidth + 1,
      bodyOverflow: b.scrollWidth > vw + 1,
      offenders: offenders.slice(0, 10),
      wideScrollers: wideScrollers.slice(0, 8)
    };
  })()`

  const results = []
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile
    })
    await new Promise(r => setTimeout(r, 400))
    // Paksa reflow + scroll ke kiri atas
    await evalJs(`window.scrollTo(0,0); document.body.getBoundingClientRect(); true`)
    const probe = await evalJs(PROBE)
    // Cek juga setelah membuka tab Riwayat Pembelian (tabel 6 kolom) & dialog
    await evalJs(`(() => {
      const t = document.querySelector('[data-testid="tab-history"]');
      if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`)
    await new Promise(r => setTimeout(r, 400))
    const probeHistory = await evalJs(PROBE)
    // Buka dialog Proses Pembelian (satu-satunya jalur tulis Purchase) dan
    // ukur lagi — dialog ini juga berubah di t_cde1b8ad.
    // CATATAN: tiap langkah dipisah + ditunggu, karena React 18 merender
    // asinkron — membaca tombol langsung setelah klik akan melihat state lama.
    await evalJs(`(() => {
      const t = document.querySelector('[data-testid="tab-ready"]');
      if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`)
    await new Promise(r => setTimeout(r, 300))
    await evalJs(`(() => {
      const cb = document.querySelector('[data-testid^="check-"]');
      if (cb && !cb.checked) cb.click();
      return true;
    })()`)
    await new Promise(r => setTimeout(r, 300))
    const opened = await evalJs(`(() => {
      const btn = document.querySelector('[data-testid="btn-process-purchase"]');
      if (!btn || btn.disabled) return false;
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`)
    await new Promise(r => setTimeout(r, 600))
    const hasDialog = await evalJs(`!!document.querySelector('[data-testid="purchase-form"]')`)
    const probeDialog = hasDialog ? await evalJs(PROBE) : null
    results.push({ viewport: vp.label, ready: probe, history: probeHistory, purchaseDialog: probeDialog, dialogClicked: opened })
  }
  await send('Emulation.clearDeviceMetricsOverride')

  let fail = 0
  const lines = []
  for (const r of results) {
    const bad = r.ready.docOverflow || r.ready.bodyOverflow
      || r.history.docOverflow || r.history.bodyOverflow
      || (r.purchaseDialog && (r.purchaseDialog.docOverflow || r.purchaseDialog.bodyOverflow))
    const offenders = [...r.ready.offenders, ...r.history.offenders, ...(r.purchaseDialog?.offenders || [])]
    if (bad || offenders.length) fail++
    lines.push(
      `${bad || offenders.length ? '✗' : '✓'} ${r.viewport}  doc=${r.ready.docScrollW}/${r.ready.docClientW}` +
      `  body=${r.ready.bodyScrollW}/${r.ready.vw}` +
      `  historyDoc=${r.history.docScrollW}/${r.history.docClientW}` +
      (r.purchaseDialog ? `  dialogDoc=${r.purchaseDialog.docScrollW}/${r.purchaseDialog.docClientW}` : '  dialog=tidak terbuka') +
      (offenders.length ? `  offenders=${JSON.stringify(offenders)}` : '') +
      (r.ready.wideScrollers?.length ? `  scrollKontainer=${JSON.stringify(r.ready.wideScrollers)}` : '')
    )
  }
  console.log('=== OVERFLOW CHECK (Chrome nyata, /__smoke) ===')
  for (const l of lines) console.log('  ' + l)
  console.log(`\n=== HASIL OVERFLOW: ${results.length - fail}/${results.length} viewport bersih ===`)
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ results, fail }, null, 1))
  await send('Page.close').catch(() => {})
  ws.close()
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(2) })
