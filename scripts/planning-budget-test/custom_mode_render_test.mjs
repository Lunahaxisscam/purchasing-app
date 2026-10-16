// ============================================================
// VERIFIKASI BUDGET CUSTOM (t_6e6d00b0) — render Planning.js ASLI
// Menguji perilaku saklar Budget Standar/Custom + panel 4 input persentase:
//   1) klik Budget Custom -> 4 field editable TERLIHAT di area saklar
//   2) revenue 0 (pagu nominal pending) -> panel tetap tampil & bisa diatur
//   3) total > 100 (draft) -> TIDAK diterapkan (pagu pakai snapshot valid)
//   4) nominal valid (<=100) -> pagu ter-update
//   5) kembali ke Budget Standar -> patokan fixed 50/25/10/15 pulih
//   6) ganti proyek -> tidak ada kebocoran draft antar proyek
//
// Dijalankan oleh verify_custom_mode.py (sandbox + mock supabase).
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// ---------- 1) DOM environment ----------
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

const PROJECTS = [
  { id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' },
  { id: 'p2', kode: '100', name: 'Senopati', status: 'ON_GOING' }
]
const PLANS = [
  { id: 'pl1', project_id: 'p1', area: 'Dapur', item_name: 'Kabinet Atas', labor_cost: 20000000, status: 'Perencanaan', progress: 50 }
]

async function mount() {
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
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  return { host, root, unmount: () => act(() => root.unmount()) }
}

// Set nilai input React terkontrol (native setter + event input).
async function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(input, String(value))
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

function pctInputs(host) {
  return Array.from(host.querySelectorAll('.budget-pct-grid input.custom-pct-input'))
}
function radio(host, value) {
  return Array.from(host.querySelectorAll('input[name="budgetMode"]')).find(r => r.value === value)
}

console.log('=== VERIFIKASI BUDGET CUSTOM (React + jsdom, Planning.js asli) ===\n')

// ---------- SKENARIO 1: klik Budget Custom -> 4 field editable terlihat ----------
console.log('1. Klik Budget Custom -> 4 field editable terlihat di area saklar')
{
  __mockState.costs = [{ project_no: '99', revenue: 43300000, cumulative_cost: 4225401, petty_cash: 0 }]
  __mockState.plans = PLANS
  __mockState.failPlans = false
  __mockState.failCosts = false
  const { host, unmount } = await mount()

  check('awal: mode Standar (tidak ada panel custom)', host.querySelector('.budget-pct-panel') === null)
  check('awal: badge patokan fixed Material 50%', (host.textContent || '').includes('Material 50%'))

  await act(async () => { radio(host, 'custom').click() })

  const panel = host.querySelector('.budget-pct-panel')
  check('panel "Atur persentase anggaran" tampil', !!panel && (panel.textContent || '').includes('Atur persentase anggaran'))
  check('panel berada di dalam kartu kontrol (tepat di bawah saklar)', !!panel && !!host.querySelector('.budget-control-panel .budget-pct-panel'))

  const inputs = pctInputs(host)
  check('tepat 4 input persentase', inputs.length === 4)
  check('semua input editable (tidak disabled/readonly)', inputs.every(i => !i.disabled && !i.readOnly))
  const labels = Array.from(host.querySelectorAll('.budget-pct-field-label')).map(l => l.textContent)
  check('label Material (%)', labels.some(t => t.includes('Material')))
  check('label Upah (%)', labels.some(t => t.includes('Upah')))
  check('label Operasional (%)', labels.some(t => t.includes('Operasional')))
  check('label Target Margin (%)', labels.some(t => t.includes('Target Margin')))
  check('menampilkan Total', (panel.textContent || '').includes('Total:'))
  check('menampilkan Sisa', (panel.textContent || '').includes('Sisa:'))
  check('helper "Belum tersimpan permanen"', (panel.textContent || '').includes('Belum tersimpan permanen'))

  await unmount()
}

// ---------- SKENARIO 2: revenue 0 -> panel tetap tampil & bisa diatur ----------
console.log('\n2. Revenue 0 (pagu nominal pending) -> panel custom tetap tampil & bisa diatur')
{
  __mockState.costs = []
  __mockState.plans = []
  __mockState.failCosts = false
  const { host, unmount } = await mount()
  await act(async () => { radio(host, 'custom').click() })

  check('mode Custom tetap aktif walau revenue kosong', radio(host, 'custom').checked)
  check('panel input tetap tampil', !!host.querySelector('.budget-pct-panel'))
  check('4 input tetap editable', pctInputs(host).every(i => !i.disabled))
  check('catatan pagu nominal menunggu revenue', (host.textContent || '').includes('pagu nominal menunggu'))
  check('badge "Revenue belum diset" tetap tampil', (host.textContent || '').includes('Revenue belum diset'))
  check('kartu pilar nominal = — (bukan angka nol)', (host.textContent || '').includes('—'))
  check('TIDAK fallback diam-diam ke Standar', (host.textContent || '').includes('Atur persentase anggaran'))

  await unmount()
}

// ---------- SKENARIO 3: total > 100 (draft) -> tidak diterapkan ----------
console.log('\n3. Total draft > 100% -> TIDAK diterapkan; pagu pakai snapshot valid terakhir')
{
  __mockState.costs = [{ project_no: '99', revenue: 100000000, cumulative_cost: 0, petty_cash: 0 }]
  __mockState.plans = []
  const { host, unmount } = await mount()
  await act(async () => { radio(host, 'custom').click() })
  let inputs = pctInputs(host)

  // Awalnya 50/25/10/15 valid -> pagu material 50jt
  check('awal valid: pagu material Rp 50.000.000', (host.textContent || '').includes('Rp 50.000.000'))

  // Naikkan Material ke 90 -> total 140% (invalid draft)
  await setInputValue(inputs[0], '90')
  const panel = host.querySelector('.budget-pct-panel')
  check('status panel: total melebihi 100 belum diterapkan', (panel.textContent || '').includes('belum diterapkan'))
  check('warning menjelaskan pagu pakai alokasi valid terakhir', (panel.textContent || '').includes('alokasi valid terakhir'))
  // Pagu HARUS tetap 50jt (snapshot valid), bukan 90jt
  check('pagu material TIDAK ikut berubah ke 90jt (tetap Rp 50.000.000)', (host.textContent || '').includes('Rp 50.000.000') && !(host.textContent || '').includes('Rp 90.000.000'))
  check('tidak ada normalisasi senyap (draft tetap 90)', pctInputs(host)[0].value === '90')

  await unmount()
}

// ---------- SKENARIO 4: nominal valid -> pagu ter-update ----------
console.log('\n4. Nominal valid (<=100) -> pagu & anomali ter-update')
{
  __mockState.costs = [{ project_no: '99', revenue: 100000000, cumulative_cost: 0, petty_cash: 0 }]
  __mockState.plans = []
  const { host, unmount } = await mount()
  await act(async () => { radio(host, 'custom').click() })
  const inputs = pctInputs(host)

  // Material 60, Upah 20, Ops 10, Margin 10 -> total 100 valid
  await setInputValue(inputs[0], '60')
  await setInputValue(inputs[1], '20')
  await setInputValue(inputs[2], '10')
  await setInputValue(inputs[3], '10')

  const text = host.textContent || ''
  check('status panel "Diterapkan"', text.includes('Diterapkan'))
  check('pagu material = Rp 60.000.000', text.includes('Rp 60.000.000'))
  check('pagu manpower = Rp 20.000.000', text.includes('Rp 20.000.000'))
  check('target margin = Rp 10.000.000', text.includes('Rp 10.000.000'))
  check('badge kartu menandai persentase diterapkan (60%)', text.includes('60% Diterapkan'))
  check('tidak ada NaN', !text.includes('NaN'))

  await unmount()
}

// ---------- SKENARIO 5: kembali ke Standar -> fixed pulih ----------
console.log('\n5. Kembali ke Budget Standar -> patokan fixed 50/25/10/15 pulih')
{
  __mockState.costs = [{ project_no: '99', revenue: 100000000, cumulative_cost: 0, petty_cash: 0 }]
  __mockState.plans = []
  const { host, unmount } = await mount()
  await act(async () => { radio(host, 'custom').click() })
  const inputs = pctInputs(host)
  await setInputValue(inputs[0], '60')
  await setInputValue(inputs[3], '10')
  await setInputValue(inputs[1], '20')
  await setInputValue(inputs[2], '10')
  check('custom aktif: pagu material Rp 60.000.000', (host.textContent || '').includes('Rp 60.000.000'))

  await act(async () => { radio(host, 'standard').click() })
  const text = host.textContent || ''
  check('panel custom hilang', host.querySelector('.budget-pct-panel') === null)
  check('pagu kembali ke standar Rp 50.000.000', text.includes('Rp 50.000.000'))
  check('badge patokan fixed Material 50% pulih', text.includes('Material 50%'))
  check('tidak ada sisa "Diterapkan" custom di kartu', !text.includes('60% Diterapkan'))

  // Kembali ke custom -> draft pulih ke nilai valid terakhir (60) bukan reset?
  // Desain: kembali ke standar me-reset applied ke fixed; custom berikutnya mulai dari fixed.
  await act(async () => { radio(host, 'custom').click() })
  check('custom lagi: draft mulai dari patokan standar (50)', pctInputs(host)[0].value === '50')

  await unmount()
}

// ---------- SKENARIO 6: ganti proyek -> tidak ada kebocoran draft ----------
console.log('\n6. Ganti proyek -> tidak ada kebocoran draft antar proyek')
{
  __mockState.costs = [
    { project_no: '99', revenue: 100000000, cumulative_cost: 0, petty_cash: 0 },
    { project_no: '100', revenue: 200000000, cumulative_cost: 0, petty_cash: 0 }
  ]
  __mockState.plans = []
  const { host, unmount } = await mount()
  await act(async () => { radio(host, 'custom').click() })
  const inputs = pctInputs(host)
  await setInputValue(inputs[0], '60')
  await setInputValue(inputs[3], '10')
  await setInputValue(inputs[1], '20')
  await setInputValue(inputs[2], '10')
  check('proyek 99: pagu material Rp 60.000.000', (host.textContent || '').includes('Rp 60.000.000'))

  // Ganti proyek ke p2 (kode 100, revenue 200jt)
  const select = host.querySelector('select')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(select, 'p2')
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await act(async () => { await new Promise(r => setTimeout(r, 20)) })
  const text = host.textContent || ''
  // Draft tidak bocor: masih custom dengan 60% material diterapkan -> 60% x 200jt = 120jt
  check('proyek 100: pagu material 60% x Rp 200jt = Rp 120.000.000', text.includes('Rp 120.000.000'))
  check('persentase custom dipertahankan (bukan reset ke standar)', text.includes('60% Diterapkan'))

  await unmount()
}

console.log(`\n=== HASIL: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA VERIFIKASI BUDGET CUSTOM LULUS')
