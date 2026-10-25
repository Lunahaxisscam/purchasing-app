// ============================================================
// VERIFIKASI RENDER PANEL KONTROL ANGGARAN 4-PILAR (bit-dev)
// Merender components/Planning.js ASLI (di-transform SWC) via React +
// jsdom, lalu memeriksa DOM hasil render untuk 3 kondisi bisnis:
//   A) Revenue belum diset  -> fallback aman, tanpa NaN
//   B) Proyek sehat         -> 4 pilar on-track, 0 anomali
//   C) Multi-pos anomali    -> 4 anomali tampil + banner + rekomendasi
//
// Dijalankan dari sandbox oleh verify_panel_render.py (mock supabase).
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// ---------- 1) DOM environment (jsdom dari instalasi global Hermes) ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
for (const k of ['HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'getComputedStyle']) {
  globalThis[k] = window[k]
}
window.confirm = () => true

// ---------- 2) Transform Planning.js (JSX) dengan SWC bawaan Next ----------
const swc = require('next/dist/build/swc')
const src = fs.readFileSync(path.join(SB, 'components/Planning.js'), 'utf8')
const compiledRaw = swc.transformSync(src, {
  filename: path.join(SB, 'components/Planning.js'),
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
  module: { type: 'es6' }
}).code
// Node ESM butuh ekstensi eksplisit untuk import relatif hasil kompilasi SWC
// (SWC memakai tanda kutip ganda; import relatif bisa berakhir .js atau tanpa ekstensi).
const compiled = compiledRaw.replace(
  /(\bfrom\s+["'])(\.\.?\/[^"']+)(["'])/g,
  (m, a, spec, c) => spec.endsWith('.js') ? m : `${a}${spec}.js${c}`
)
const compiledPath = path.join(SB, 'components', 'Planning.compiled.mjs')
fs.writeFileSync(compiledPath, compiled)

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { __mockState } = await import(pathToFileURL(path.join(SB, 'lib/supabaseClient.js')).href)
const Planning = (await import(pathToFileURL(compiledPath).href)).default

// ---------- 3) Assertion helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const PROJECTS = [{ id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' }]
const PLANS = [
  { id: 'pl1', project_id: 'p1', area: 'Dapur', item_name: 'Kabinet Atas', labor_cost: 20000000, status: 'Perencanaan', progress: 50 }
]

async function renderScenario(costs, plans = PLANS, opts = {}) {
  __mockState.costs = costs
  __mockState.plans = plans
  __mockState.failPlans = !!opts.failPlans
  __mockState.failCosts = !!opts.failCosts
  const host = window.document.createElement('div')
  window.document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(Planning, {
      rows: { projects: PROJECTS },
      say: () => {},
      setPage: () => {},
      refresh: async () => {}
    }))
  })
  // flush efek pemuatan data (mock thenable) + render ulang
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const html = host.innerHTML
  const text = host.textContent || ''
  return { html, text, host, unmount: () => act(() => root.unmount()) }
}

console.log('=== VERIFIKASI RENDER PANEL 4-PILAR (React + jsdom, Planning.js asli) ===\n')

// ---------- SKENARIO A: revenue belum diset ----------
console.log('A. Revenue belum diset (fallback aman)')
{
  const { html, text, host, unmount } = await renderScenario([])
  check('panel kontrol anggaran ter-render', html.includes('Kontrol Anggaran'))
  check('badge "Revenue belum diset" tampil', text.includes('Revenue belum diset'))
  check('overview Nilai Kontrak = "Belum Diset"', text.includes('Belum Diset'))
  check('status "Menunggu Nilai Kontrak"', text.includes('Menunggu Nilai Kontrak'))
  check('4 kartu pilar tetap ter-render', host.querySelectorAll('.budget-card').length === 4)
  check('tidak ada "NaN" di DOM', !text.includes('NaN'), text.match(/.{0,30}NaN.{0,30}/)?.[0] || '')
  check('tidak ada "ANOMALI" saat revenue kosong', !text.includes('ANOMALI ANGGARAN TERDETEKSI'))
  check('footer komposisi 100% tampil', text.includes('Komposisi Pagu Total (100%)'))
  check('footer pilar tidak mengklaim "Aman" tanpa revenue', !text.includes('(Aman)') && (text.match(/\(—\)/g) || []).length === 4)
  await unmount()
}

// ---------- SKENARIO B: proyek sehat ----------
console.log('\nB. Proyek sehat — semua pilar on-track (revenue 100jt; mat 45jt, upah 20jt, ops 8jt)')
{
  const costs = [{ project_no: '99', revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }]
  const { html, text, host, unmount } = await renderScenario(costs)
  check('badge "Semua 4-Pilar Aman" tampil', text.includes('Semua 4-Pilar Aman'))
  check('status "Sesuai Pagu Historis" tampil', text.includes('Sesuai Pagu Historis'))
  check('tidak ada banner anomali', !html.includes('budget-anomaly-summary-banner'))
  check('0 kartu is-anomaly', host.querySelectorAll('.budget-card.is-anomaly').length === 0)
  check('4 kartu is-on-track', host.querySelectorAll('.budget-card.is-on-track').length === 4)
  check('pagu material Rp 50.000.000', text.includes('Rp 50.000.000'))
  check('pagu manpower Rp 25.000.000', text.includes('Rp 25.000.000'))
  check('pagu operasional Rp 10.000.000', text.includes('Rp 10.000.000'))
  check('target margin Rp 15.000.000', text.includes('Rp 15.000.000'))
  check('margin riil Rp 27.000.000 (27,0%)', text.includes('Rp 27.000.000') && text.includes('27,0%'))
  check('footer "Margin 15% (Aman)"', text.includes('Margin 15% (Aman)'))
  check('tidak ada "NaN" di DOM', !text.includes('NaN'))
  await unmount()
}

// ---------- SKENARIO C: multi-pos anomali ----------
console.log('\nC. Multi-pos anomali (mat 55jt, upah 28jt, ops 12jt — semua melebihi pagu)')
{
  const costs = [{ project_no: '99', revenue: 100000000, cumulative_cost: 55000000, petty_cash: 12000000 }]
  const plans = [
    { id: 'pl1', project_id: 'p1', area: 'Dapur', item_name: 'Kabinet Atas', labor_cost: 28000000, status: 'Perencanaan', progress: 50 }
  ]
  const { html, text, host, unmount } = await renderScenario(costs, plans)
  check('badge "4 ANOMALI ANGGARAN TERDETEKSI"', text.includes('4 ANOMALI ANGGARAN TERDETEKSI'))
  check('banner rangkuman anomali ter-render', html.includes('budget-anomaly-summary-banner'))
  check('4 kartu anomali (.anomaly-item-card)', host.querySelectorAll('.anomaly-item-card').length === 4)
  check('4 kartu pilar is-anomaly', host.querySelectorAll('.budget-card.is-anomaly').length === 4)
  check('anomali Material tampil (+Rp 5.000.000)', text.includes('Material (50% max)') && text.includes('+Rp 5.000.000'))
  check('anomali Manpower tampil (+Rp 3.000.000)', text.includes('Upah Tukang (25% max)') && text.includes('+Rp 3.000.000'))
  check('anomali Operasional tampil (+Rp 2.000.000)', text.includes('Operasional (10% max)') && text.includes('+Rp 2.000.000'))
  check('anomali Margin tampil (defisit Rp 10.000.000)', text.includes('Target Margin (15% min)') && text.includes('-Rp 10.000.000'))
  check('setiap anomali punya rekomendasi', (text.match(/💡 Rekomendasi:/g) || []).length === 4)
  check('peringatan di atas tabel WBS', text.includes('Perhatian Pekerjaan WBS') && text.includes('4 anomali anggaran'))
  check('footer 4 pilar (Over)', (text.match(/\(Over\)/g) || []).length === 3 && text.includes('(Tipis)'))
  check('label "Over-Budget:" tampil di kartu', (text.match(/Over-Budget:/g) || []).length === 3)
  check('margin defisit di kartu: -Rp 10.000.000', text.includes('-Rp 10.000.000'))
  check('badge kartu margin = "Defisit Margin" (bukan Over-Budget)', text.includes('Defisit Margin (-Rp 10.000.000)') && !text.includes('Over-Budget (-Rp 10.000.000)'))
  check('footer menandai pilar anomali (Over) & margin (Tipis)', text.includes('Material 50% (Over)') && text.includes('Margin 15% (Tipis)'))
  check('tidak ada "NaN" di DOM', !text.includes('NaN'))
  await unmount()
}

// ---------- SKENARIO D: Rekap Cost gagal dimuat (data-layer: costError) ----------
console.log('\nD. Rekap Cost gagal dimuat (project_cost_summary error — bukan nol sesungguhnya)')
{
  const { html, text, host, unmount } = await renderScenario([], PLANS, { failCosts: true })
  check('notice kegagalan Rekap Cost tampil', text.includes('Gagal memuat data Rekap Cost'))
  check('notice menyebut nilai BUKAN angka nol sesungguhnya', text.includes('BUKAN angka nol sesungguhnya'))
  check('badge header = "Gagal memuat Rekap Cost" (bukan "Revenue belum diset")', text.includes('Gagal memuat Rekap Cost — pagu belum bisa dihitung') && !text.includes('Revenue belum diset di Rekap Cost'))
  check('overview Nilai Kontrak = "Gagal Dimuat"', text.includes('Gagal Dimuat') && !text.includes('Belum Diset'))
  check('status anggaran = "Rekap Cost Gagal Dimuat"', text.includes('Rekap Cost Gagal Dimuat') && !text.includes('Menunggu Nilai Kontrak'))
  check('kartu material tidak klaim "Riil: Rp 0"', text.includes('Riil: — (Rekap Cost gagal dimuat)') && !text.includes('Riil: Rp 0'))
  check('kartu ops tidak klaim "Petty Cash: Rp 0"', text.includes('Petty Cash: — (Rekap Cost gagal dimuat)'))
  check('detail Pengeluaran Riil = "—"', (text.match(/Pengeluaran Riil:/g) || []).length >= 1)
  check('4 kartu pilar tetap ter-render', host.querySelectorAll('.budget-card').length === 4)
  check('tidak ada "NaN" di DOM', !text.includes('NaN'))
  check('tidak ada klaim anomali tanpa data revenue', !text.includes('ANOMALI ANGGARAN TERDETEKSI'))
  await unmount()
}

// ---------- SKENARIO E: toleransi format nomor project_no ↔ kode ----------
console.log('\nE. Integrasi revenue: normalisasi nomor (leading zero / desimal ekspor Sheets)')
{
  // E1: project.kode '99' vs cost.project_no '099' (leading zero)
  {
    const costs = [{ project_no: '099', revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }]
    const { text, host, unmount } = await renderScenario(costs)
    check('kode "99" cocok dengan project_no "099"', text.includes('Semua 4-Pilar Aman') && text.includes('Rp 50.000.000'))
    check('4 kartu is-on-track', host.querySelectorAll('.budget-card.is-on-track').length === 4)
    await unmount()
  }
  // E2: project.kode '99' vs cost.project_no '99.0' (sisa desimal ekspor numerik)
  {
    const costs = [{ project_no: '99.0', revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }]
    const { text, unmount } = await renderScenario(costs)
    check('kode "99" cocok dengan project_no "99.0"', text.includes('Semua 4-Pilar Aman'))
    await unmount()
  }
  // E3: TIDAK boleh false-match — project_no '1000' tidak boleh dianggap proyek '99'
  {
    const costs = [{ project_no: '1000', revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }]
    const { text, unmount } = await renderScenario(costs)
    check('project_no "1000" TIDAK dianggap proyek "99"', text.includes('Revenue belum diset di Rekap Cost') && !text.includes('Semua 4-Pilar Aman'))
    await unmount()
  }
  // E4: string non-numerik tidak false-match ('99abc' ≠ '99')
  {
    const costs = [{ project_no: '99abc', revenue: 100000000, cumulative_cost: 45000000, petty_cash: 8000000 }]
    const { text, unmount } = await renderScenario(costs)
    check('project_no "99abc" TIDAK dianggap proyek "99"', text.includes('Revenue belum diset di Rekap Cost'))
    await unmount()
  }
}

// ---------- SKENARIO F: koersi nilai revenue/realisasi (string & null dari Sheets) ----------
console.log('\nF. Integrasi revenue: nilai string / null dari ekspor Sheets aman')
{
  // F1: revenue & cost sebagai string angka (format Sheets)
  {
    const costs = [{ project_no: '99', revenue: '100000000', cumulative_cost: '55000000', petty_cash: '12000000' }]
    const plans = [{ id: 'pl1', project_id: 'p1', area: 'Dapur', item_name: 'Kabinet Atas', labor_cost: 28000000, status: 'Perencanaan', progress: 50 }]
    const { text, unmount } = await renderScenario(costs, plans)
    check('revenue string "100000000" terbaca (pagu Rp 50.000.000)', text.includes('Rp 50.000.000'))
    check('anomali material terdeteksi dari nilai string (+Rp 5.000.000)', text.includes('+Rp 5.000.000'))
    check('tidak ada "NaN" di DOM', !text.includes('NaN'))
    await unmount()
  }
  // F2: revenue null & cost null → fallback aman (bukan NaN, bukan anomali)
  {
    const costs = [{ project_no: '99', revenue: null, cumulative_cost: null, petty_cash: null }]
    const { text, host, unmount } = await renderScenario(costs)
    check('revenue null → "Revenue belum diset"', text.includes('Revenue belum diset di Rekap Cost'))
    check('tidak ada "NaN" di DOM', !text.includes('NaN'))
    check('tidak ada klaim anomali', !text.includes('ANOMALI ANGGARAN TERDETEKSI'))
    check('4 kartu pilar tetap ter-render', host.querySelectorAll('.budget-card').length === 4)
    await unmount()
  }
}

console.log(`\n=== HASIL: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA VERIFIKASI RENDER PANEL LULUS')
