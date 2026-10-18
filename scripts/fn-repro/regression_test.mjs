// ============================================================
// REGRESI TEMUAN AUDIT REVIEW-03 — dijalankan di /tmp/fn-review03
// ============================================================
// Merender komponen ASLI (hasil kompilasi SWC) dengan React nyata di jsdom,
// lalu memeriksa DOM. Tidak ada DB, tidak ada jaringan, tidak menyentuh .next.
//
//   FN-EST_LABEL : estimasi WBS tidak dilabeli "riil/actual"; aktual
//                  tukang_projects tidak dilabeli estimasi; keduanya tidak
//                  dijumlahkan.
//   FN-TARGET70  : target 70% selalu rupiah utuh + perbandingan memakai
//                  angka yang sama dengan yang ditampilkan.
//   FN-PRINTREF  : dokumen cetak closing tidak merujuk baris "(1 − 5)" yang
//                  tidak ada; rujukan cocok dengan nomor baris nyata.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const REPO = process.argv[2] || path.dirname(path.dirname(process.cwd()))
const SB = process.argv[3] || process.cwd()
const require = createRequire(import.meta.url)
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}

// ---------- 1) DOM global dulu ----------
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom0.window.navigator, configurable: true })
global.HTMLElement = dom0.window.HTMLElement
global.Node = dom0.window.Node
global.Event = dom0.window.Event
global.MouseEvent = dom0.window.MouseEvent
global.getComputedStyle = dom0.window.getComputedStyle
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// ---------- 2) Import ----------
const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { renderToStaticMarkup } = await import('react-dom/server')

const load = async (rel) => (await import(pathToFileURL(path.join(SB, rel + '.mjs')).href))
const Planning = (await load('components/Planning')).default
const Finance = (await load('components/Finance')).default
const ProjectFinance = (await load('components/ProjectFinance')).default
const money = await load('lib/money')
const laborSource = await load('lib/laborSource')

const staticHtml = (Comp, props) => renderToStaticMarkup(React.createElement(Comp, props))
const textOf = (html) => {
  const d = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
  return { text: d.window.document.body.textContent || '', doc: d.window.document }
}

// ---------- 3) Data mock ----------
const PROJECTS = [
  { id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' },
  { id: 'p2', kode: '83', name: 'Mabes', status: 'ON_GOING' }
]
const PLANS = [
  { project_id: 'p1', labor_cost: 5000000, item_name: 'Kitchen set', area: 'Dapur', worker_name: 'Mandor A', worker_type: 'borongan', status: 'Selesai', progress: 100 },
  { project_id: 'p2', labor_cost: 2500000, item_name: 'Pintu', area: 'Foyer', worker_name: 'Mandor B', worker_type: 'harian', status: 'Berjalan', progress: 40 }
]
const DRIVE = [
  { id: 'd1', project_no: '99', project_name: 'Baroni', cumulative_cost: 15000000, current_week_expense: 1000000, revenue: 40000000, petty_cash: 800000 },
  { id: 'd2', project_no: '83', project_name: 'Mabes', cumulative_cost: 9000000, current_week_expense: 500000, revenue: 30000000, petty_cash: 0 },
  { id: 'd3', project_no: 'operasional ws', project_name: 'Operasional WS', cumulative_cost: 6500000, current_week_expense: 350000 }
]
const ROWS = { projects: PROJECTS, requests: [], pr_items: [], receivings: [], tukang_projects: [] }

// ============================================================
// A. FN-EST_LABEL — Planning.js kartu Manpower
// ============================================================
console.log('\nA. FN-EST_LABEL — Planning.js: kartu Manpower tidak menyebut "riil"')
{
  const html = staticHtml(Planning, {
    rows: ROWS,
    session: { user: { email: 't@t' } },
    initialCosts: [{ project_no: '99', project_name: 'Baroni', revenue: 40000000, cumulative_cost: 15000000, petty_cash: 800000 }],
    initialPlans: PLANS
  })
  const { text } = textOf(html)
  check('label "Pengeluaran Riil (WBS)" TIDAK ada lagi', !text.includes('Pengeluaran Riil (WBS)'))
  check('label baru "Estimasi Upah WBS" tampil', text.includes('Estimasi Upah WBS'))
  // Material & Petty Cash tetap "Pengeluaran Riil" — keduanya memang realisasi
  // (Drive kumulatif / petty cash), jadi JANGAN ikut diubah.
  check('Material tetap "Pengeluaran Riil:" (memang realisasi Drive)', text.includes('Pengeluaran Riil:'))
  check('Petty cash tetap "Pengeluaran Riil (Petty Cash)"', text.includes('Pengeluaran Riil (Petty Cash)'))
  check('tidak ada NaN/undefined di panel', !/NaN|undefined/.test(text))
}

// ============================================================
// B. FN-EST_LABEL — ProjectFinance.js estimasi vs aktual
// ============================================================
console.log('\nB. FN-EST_LABEL — ProjectFinance.js: estimasi WBS vs aktual tukang_projects')
{
  const TUKANG = [
    { tukang_key: 'mandor-a', project_name: '  baroni ', total_upah: 4000000 },
    { tukang_key: 'mandor-b', project_name: 'BARONI', total_upah: 250000 }
  ]
  const html = staticHtml(ProjectFinance, {
    rows: { ...ROWS, tukang_projects: TUKANG },
    initialDriveRows: DRIVE,
    initialPlans: PLANS
  })
  const { text, doc } = textOf(html)
  const cards = [...doc.querySelectorAll('.card')].map((c) => c.textContent || '')
  check('kartu upah berlabel "Estimasi Upah WBS"', cards.some((c) => c.includes('Estimasi Upah WBS')))
  check('label menyesatkan "Actual Tukang" TIDAK ada', !text.includes('Actual Tukang'))
  check('estimasi WBS = Rp 5.000.000', cards.some((c) => c.includes('Estimasi Upah WBS') && c.includes('Rp 5.000.000')))
  check('aktual tukang_projects = Rp 4.250.000 (2 baris, cocok beda kapitalisasi/spasi)',
    cards.some((c) => c.includes('Aktual tersinkron: Rp 4.250.000') && c.includes('2 baris')))
  check('estimasi & aktual TIDAK dijumlahkan (Rp 9.250.000 absen)', !text.includes('9.250.000'))
  check('margin tetap memakai estimasi (40 − 15 − 5 = Rp 20.000.000)',
    cards.some((c) => c.includes('Project Margin') && c.includes('Rp 20.000.000')))
  check('tooltip margin menyatakan komponennya estimasi, bukan upah terbayar',
    [...doc.querySelectorAll('.card')].some((c) => /ESTIMASI upah WBS/.test(c.getAttribute('title') || '')))
}
{
  const html = staticHtml(ProjectFinance, {
    rows: { ...ROWS, tukang_projects: [] },
    initialDriveRows: DRIVE,
    initialPlans: PLANS,
    initialView: 'tukang'
  })
  const { text, doc } = textOf(html)
  const cards = [...doc.querySelectorAll('.card')].map((c) => c.textContent || '')
  check('aktual belum ada -> "belum ada catatan tersinkron"', cards.some((c) => c.includes('Aktual upah: belum ada catatan tersinkron')))
  check('BUKAN "Aktual tersinkron: Rp 0" (nol palsu)', !cards.some((c) => c.includes('Aktual tersinkron: Rp 0')))
  check('tab Tukang menyatakan dua sumber berbeda', text.includes('Dua sumber upah yang berbeda'))
  check('tab Tukang tidak mengklaim tabel rencana sebagai realisasi',
    text.includes('Estimasi Upah (WBS)') && !text.includes('Realisasi Upah'))
}

// ============================================================
// C. FN-EST_LABEL — arah sebaliknya: AKTUAL jangan dilabeli estimasi
// ============================================================
console.log('\nC. FN-EST_LABEL — aktual tukang_projects tidak boleh dilabeli estimasi')
{
  check('label aktual eksplisit menyebut tukang_projects / tersinkron',
    /tersinkron/i.test(laborSource.ACTUAL_WAGE_LABEL + ' ' + laborSource.ACTUAL_WAGE_NOTE))
  check('label estimasi eksplisit menyebut WBS', /WBS/.test(laborSource.WBS_ESTIMATE_LABEL))
  check('catatan estimasi menyatakan BUKAN upah terbayar', /Bukan upah yang sudah dibayar/i.test(laborSource.WBS_ESTIMATE_NOTE))
  check('catatan aktual menyatakan BUKAN rencana WBS', /bukan rencana WBS/i.test(laborSource.ACTUAL_WAGE_NOTE))
  // Kesetaraan projectKey dengan modul labor-stock (kalau beda, angka aktual
  // bisa "hilang" hanya karena beda kapitalisasi nama proyek).
  const { projectKey: logicKey } = await import(
    pathToFileURL(path.join(REPO, 'modules/labor-stock/logic.js')).href
  )
  const names = ['Baroni', '  BARONI  ', 'baroni residence', 'Aan - BSD', 'Aan  -  BSD']
  check('projectKey setara dengan modules/labor-stock/logic.js',
    names.every((n) => logicKey(n) === laborSource.projectKey(n)),
    names.map((n) => `${n}: ${logicKey(n)} vs ${laborSource.projectKey(n)}`).join(' | '))
  check('aktual nol tercatat -> null (bukan 0)', laborSource.actualLaborForProject([], 'Baroni') === null)
  check('baris tanpa angka -> null (bukan 0)',
    laborSource.actualLaborForProject([{ project_name: 'Baroni', total_upah: '' }], 'Baroni') === null)
  // Dibungkus: di baseline fungsi ini mengembalikan null sehingga `.actual`
  // akan melempar TypeError — itu sendiri bukti temuan, jangan hentikan harness
  // (bagian D/E masih perlu dijalankan untuk membuktikan temuannya juga).
  let idrOk = false
  try {
    idrOk = laborSource.actualLaborForProject([{ project_name: 'Baroni', total_upah: '3.000.000,50' }], 'Baroni').actual === 3000000.5
  } catch (e) { idrOk = false }
  check('angka bergaya Indonesia "3.000.000,50" terbaca 3000000.5', idrOk)
}

// ============================================================
// D. FN-TARGET70 — target 70% rupiah utuh
// ============================================================
console.log('\nD. FN-TARGET70 — target 70% rupiah utuh, tanpa pecahan sen')
{
  check('43.300.000 -> 30.310.000 tepat', money.targetBudget70(43300000) === 30310000, String(money.targetBudget70(43300000)))
  check('99.999.999,99 -> 70.000.000 (integer)', money.targetBudget70(99999999.99) === 70000000, String(money.targetBudget70(99999999.99)))
  check('semua hasil integer (tidak ada pecahan sen)', [1, 7, 250000, 1234567.89, 99999999.99, 43300000]
    .every((r) => Number.isInteger(money.targetBudget70(r))))
  check('revenue 0/negatif/NaN -> 0', money.targetBudget70(0) === 0 && money.targetBudget70(-1) === 0 && money.targetBudget70('x') === 0)
  // costVsTarget70 belum ada di baseline -> dibungkus agar harness lanjut ke
  // bagian E dan tetap melaporkan temuan PRINTREF secara terpisah.
  let cmp = null
  let cmp2 = null
  try { cmp = money.costVsTarget70({ revenue: 43300000, cost: 30310000 }) } catch (e) { cmp = null }
  try { cmp2 = money.costVsTarget70({ revenue: 43300000, cost: 30310001 }) } catch (e) { cmp2 = null }
  check('costVsTarget70 revenue 0 -> null (belum bisa dinilai, bukan "hemat")',
    (() => { try { return money.costVsTarget70({ revenue: 0, cost: 5 }) === null } catch (e) { return false } })())
  check('tepat di pagu -> underBudget true (batas pas 70% tidak jadi OVER)', !!cmp && cmp.underBudget === true)
  check('1 rupiah di atas pagu -> underBudget false', !!cmp2 && cmp2.underBudget === false)
}
{
  // Reproduksi cacat lama vs perilaku baru, pada jalur yang dipakai UI.
  const legacy = (r) => Math.round(r * 70) / 100
  check('cacat lama ter-reproduksi: 99.999.999,99 -> pecahan sen', !Number.isInteger(legacy(99999999.99)), String(legacy(99999999.99)))
  check('perbaikan: hasil baru integer untuk kasus yang sama', Number.isInteger(money.targetBudget70(99999999.99)))
}

// ============================================================
// E. FN-PRINTREF — dokumen cetak closing
// ============================================================
console.log('\nE. FN-PRINTREF — dokumen cetak closing tidak merujuk baris yang tidak ada')
{
  const CLOSINGS = [{
    id: 'c1', project_id: 'p1', project_no: '99', project_name: 'Baroni - BSD',
    revenue: 40000000, target_budget: 28000000, material_cost: 15000000,
    petty_cash_cost: 800000, labor_cost: 5000000, total_cost: 20800000,
    margin_nominal: 19200000, margin_percentage: 48, labor_ratio: 24.04,
    notes: 'Selesai lebih cepat', closed_at: '2026-10-18T05:00:00.000Z', closed_by: 'admin'
  }]
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(React.createElement(Finance, {
      rows: ROWS,
      session: { user: { email: 't@t' } },
      refresh: async () => {},
      initialDriveRows: DRIVE,
      initialPlans: PLANS,
      initialClosings: CLOSINGS
    }))
  })

  const findButton = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent || ''))
  const archiveTab = findButton(/Arsip Closing/i)
  check('tab "Arsip Closing" ada', !!archiveTab)
  if (archiveTab) {
    await act(async () => { archiveTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  }
  const printBtn = findButton(/Cetak Dokumen Closing/i)
  check('tombol "Cetak Dokumen Closing (PDF)" ada di arsip', !!printBtn)
  if (printBtn) {
    await act(async () => { printBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  }

  const printRoot = document.querySelector('.print-doc, .print-sheet, .print-area') || document.body
  const printText = printRoot.textContent || ''

  check('dokumen cetak benar-benar terbuka', /Dokumen Closing/.test(printText), printText.slice(0, 200))
  check('rujukan salah "(1 − 5)" TIDAK ada lagi', !printText.includes('1 − 5') && !printText.includes('1 - 5'))
  check('rujukan baru cocok baris nyata (1 − TOTAL BIAYA TERCATAT)',
    printText.includes('GROSS MARGIN / KEUNTUNGAN KOTOR (1 − TOTAL BIAYA TERCATAT)'))
  // Setiap nomor yang dirujuk harus benar-benar ada sebagai baris bernomor.
  const rowNumbers = [...printRoot.querySelectorAll('td')]
    .map((td) => (td.textContent || '').trim())
    .filter((t) => /^\d$/.test(t))
  check('baris bernomor 1..4 tercetak (tidak ada nomor 5)', JSON.stringify(rowNumbers) === JSON.stringify(['1', '2', '3', '4']), JSON.stringify(rowNumbers))
  check('label baris 3 = estimasi WBS, bukan "Realisasi Biaya Tukang"',
    printText.includes('Estimasi Biaya Tukang') && !printText.includes('Realisasi Biaya Tukang'))
  check('total tidak diklaim "HPP RIIL" penuh',
    printText.includes('TOTAL BIAYA TERCATAT') && !printText.includes('TOTAL HPP RIIL'))
  check('angka snapshot tetap dicetak apa adanya (revenue 40jt, total 20,8jt, margin 19,2jt)',
    printText.includes('Rp 40.000.000') && printText.includes('Rp 20.800.000') && printText.includes('Rp 19.200.000'))

  await act(async () => { root.unmount() })
  container.remove()
}

// ============================================================
// F. Finance.js — label estimasi di tabel & kartu, bukan "Actual Tukang"
// ============================================================
console.log('\nF. Finance.js — tabel/kartu memakai label estimasi WBS')
{
  const html = staticHtml(Finance, {
    rows: ROWS,
    session: { user: { email: 't@t' } },
    refresh: async () => {},
    initialDriveRows: DRIVE,
    initialPlans: PLANS
  })
  const { text } = textOf(html)
  check('header tabel "Estimasi Upah WBS" ada', text.includes('Estimasi Upah WBS'))
  check('"Actual Tukang" tidak lagi dipakai untuk sumber project_plans', !text.includes('Actual Tukang'))
  check('tidak ada NaN/undefined', !/NaN|undefined/.test(text))
  check('nilai gross Baroni tetap benar (40 − 15 − 5 = 20jt)', text.includes('Rp 20.000.000'))
}

console.log(`\n=== HASIL: ${pass} ok, ${fail} FAIL ===`)
if (failures.length) console.log('GAGAL: ' + failures.join(' ; '))
process.exit(fail ? 1 : 0)
