// ============================================================
// VERIFIKASI RENDER OPSI C (Finance.js) + ProjectFinance.js — React SSR.
// Merender komponen ASLI (hasil transform SWC bawaan Next) dengan
// react-dom/server, lalu memeriksa DOM hasil render:
//   Finance (default tab 'opsi' — Ringkasan Perusahaan):
//     A) 4 kartu KPI: Total Revenue, Total Project Margin,
//        Beban Operasional WS, Net Margin Perusahaan (+ % Net Margin)
//     B) Tabel rincian per proyek: Kode, Proyek, Revenue, Material,
//        Tukang, Gross Profit, % Margin
//     C) Rekap Pos Umum Operasional WS
//     D) Petty cash TIDAK muncul di ringkasan perusahaan
//   ProjectFinance:
//     E) 4 kartu: Revenue, Actual Material, Actual Tukang, Project Margin
//        (Gross Profit) + % Margin — tanpa kartu petty cash
// Data mock memuat baris pos umum "operasional ws" sesuai konvensi Drive.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

// ---------- 1) Transform Finance.js & ProjectFinance.js via SWC ----------
const swc = require(path.join(SB, 'node_modules/next/dist/build/swc'))
const distDir = path.join(SB, 'scripts/opsi-c-test/dist')
fs.rmSync(distDir, { recursive: true, force: true })
fs.mkdirSync(distDir, { recursive: true })

const SOURCES = {
  'Finance.mjs': path.join(SB, 'components/Finance.js'),
  'ProjectFinance.mjs': path.join(SB, 'components/ProjectFinance.js'),
  'supabaseClient.mjs': path.join(SB, 'lib/supabaseClient.js'),
  'constants.mjs': path.join(SB, 'lib/constants.js'),
  // FN-EST_LABEL / FN-TARGET70 (REVIEW-03): komponen Finance & ProjectFinance
  // kini mengimpor dua modul murni ini — harus ikut dikompilasi & di-rewrite,
  // kalau tidak harness akan gagal resolve (bukan gagal assertion).
  'money.mjs': path.join(SB, 'lib/money.js'),
  'laborSource.mjs': path.join(SB, 'lib/laborSource.js'),
  // t_57f6a3f9: ProjectFinance juga mengimpor CompactRoot + buildCostBreakdown
  // (transitif: projectCostBreakdown → purchaseNote). Semua modul ini harus
  // ikut dikompilasi supaya render SSR tidak gagal resolve import.
  'compactRoot.mjs': path.join(SB, 'components/CompactRoot.js'),
  'projectCostBreakdown.mjs': path.join(SB, 'lib/projectCostBreakdown.js'),
  'purchaseNote.mjs': path.join(SB, 'lib/purchaseNote.js'),
  'projectCrosswalk.mjs': path.join(SB, 'lib/projectCrosswalk.js')
}
for (const [out, src] of Object.entries(SOURCES)) {
  const compiled = swc.transformSync(fs.readFileSync(src, 'utf8'), {
    filename: src,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' }
  }).code
  // rewrite relative imports to compiled siblings
  const rewritten = compiled
    .replace(/from ['"]\.\.\/lib\/supabaseClient['"]/g, `from './supabaseClient.mjs'`)
    .replace(/from ['"]\.\.\/lib\/constants['"]/g, `from './constants.mjs'`)
    .replace(/from ['"]\.\.\/lib\/money['"]/g, `from './money.mjs'`)
    .replace(/from ['"]\.\.\/lib\/laborSource['"]/g, `from './laborSource.mjs'`)
    .replace(/from ['"]\.\.\/lib\/projectCostBreakdown['"]/g, `from './projectCostBreakdown.mjs'`)
    .replace(/from ['"]\.\.\/lib\/purchaseNote['"]/g, `from './purchaseNote.mjs'`)
    .replace(/from ['"]\.\.\/lib\/projectCrosswalk['"]/g, `from './projectCrosswalk.mjs'`)
    .replace(/from ['"]\.\/projectCrosswalk\.js['"]/g, `from './projectCrosswalk.mjs'`)
    .replace(/from ['"]\.\/purchaseNote\.js['"]/g, `from './purchaseNote.mjs'`)
    .replace(/from ['"]\.\/projectCostBreakdown\.js['"]/g, `from './projectCostBreakdown.mjs'`)
    .replace(/from ['"]\.\/CompactRoot['"]/g, `from './compactRoot.mjs'`)
    // CompactRoot mengimpor CSS module — SWC tidak menyertakan isinya, jadi
    // rewrite ke stub kosong (harness hanya peduli DOM, bukan class name asli).
    .replace(/from ['"]\.\/compact-admin\.module\.css['"]/g, `from './stubCss.mjs'`)
  fs.writeFileSync(path.join(distDir, out), rewritten)
}
// Stub CSS module: dipakai CompactRoot (import compact-admin.module.css).
fs.writeFileSync(path.join(distDir, 'stubCss.mjs'), 'export default {}\n')

// ---------- 2) Import ----------
const React = (await import('react')).default
const { renderToStaticMarkup } = await import('react-dom/server')
const Finance = (await import(pathToFileURL(path.join(distDir, 'Finance.mjs')).href)).default
const ProjectFinance = (await import(pathToFileURL(path.join(distDir, 'ProjectFinance.mjs')).href)).default

// ---------- 3) Helpers ----------
let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

// ---------- 4) Data mock ----------
const PROJECTS = [
  { id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' },
  { id: 'p2', kode: '83', name: 'Mabes', status: 'ON_GOING' },
  { id: 'p3', kode: '75', name: 'TanpaDrive', status: 'ON_GOING' }
]
// t_57f6a3f9: proyek SUDAH SELESAI (status DONE / Past Project) — dipakai
// menguji filter status "Selesai" dan "Semua Proyek" di ProjectFinance.
const DONE_PROJECTS = [
  { id: 'p4', kode: '61', name: 'Vila PIK 2', status: 'DONE' },
  { id: 'p5', kode: '42', name: 'Kantor Sudirman', status: 'DONE' }
]
const PLANS = [
  { project_id: 'p1', labor_cost: 5000000 },
  { project_id: 'p2', labor_cost: 2500000 },
  // t_57f6a3f9: estimasi upah WBS proyek selesai — dipakai membuktikan
  // kalkulasi Upah & Margin tetap jalan untuk proyek ber-status DONE.
  { project_id: 'p4', labor_cost: 6000000 }
]
const DRIVE = [
  { id: 'd1', project_no: '99', project_name: 'Baroni', cumulative_cost: 15000000, current_week_expense: 1000000, revenue: 40000000, petty_cash: 800000 },
  { id: 'd2', project_no: '83', project_name: 'Mabes', cumulative_cost: 9000000, current_week_expense: 500000, revenue: 30000000, petty_cash: 0 },
  { id: 'd3', project_no: 'operasional ws', project_name: 'Operasional WS', cumulative_cost: 6500000, current_week_expense: 350000 },
  // t_57f6a3f9: baris Drive proyek selesai (kode 61) — revenue 55jt,
  // cost material kumulatif 28jt. Margin proyek selesai harus sama akuratnya:
  // 55 − 28 − 6 (upah WBS) = 21jt → 38,18% dari revenue.
  { id: 'd4', project_no: '61', project_name: 'Vila PIK 2', cumulative_cost: 28000000, current_week_expense: 0, revenue: 55000000, petty_cash: 0 }
]
// t_57f6a3f9: rows.projects untuk ProjectFinance menggabungkan on-going +
// selesai. Finance (Ringkasan Perusahaan) tetap memakai PROJECTS on-going
// saja supaya assertion A–D di atas tidak berubah.
const ALL_PROJECTS = [...PROJECTS, ...DONE_PROJECTS]
const ROWS = { projects: PROJECTS, requests: [], pr_items: [], receivings: [] }
const ROWS_WITH_DONE = { ...ROWS, projects: ALL_PROJECTS }

console.log('=== VERIFIKASI OPSI C — Finance & ProjectFinance (React SSR) ===\n')

// ---------- A/B/C/D: Finance — default view 'opsi' ----------
console.log('A. Finance — 4 kartu KPI Ringkasan Perusahaan')
{
  const html = renderToStaticMarkup(React.createElement(Finance, {
    rows: ROWS,
    session: { user: { email: 't@t' } },
    refresh: async () => {},
    initialDriveRows: DRIVE,
    initialPlans: PLANS
  }))
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
  const doc = dom.window.document
  const text = doc.body.textContent || ''

  const cards = [...doc.querySelectorAll('.card')].map(c => c.textContent)
  check('kartu Total Revenue ada', cards.some(c => c.includes('Total Revenue')), cards.map(c => c.slice(0, 30)).join(' | '))
  check('kartu Total Project Margin ada', cards.some(c => c.includes('Total Project Margin')))
  check('kartu Beban Operasional WS ada', cards.some(c => c.includes('Beban Operasional WS')))
  check('kartu Net Margin Perusahaan ada', cards.some(c => c.includes('Net Margin Perusahaan')))
  // Nilai: Total Revenue 40jt+30jt = 70jt; Gross 99: 40-15-5=20jt; 83: 30-9-2.5=18.5jt → 38.5jt
  check('Total Revenue = Rp 70.000.000', text.includes('Rp 70.000.000'), text.match(/Total Revenue[\s\S]{0,120}/)?.[0])
  check('Total Gross Profit = Rp 38.500.000', text.includes('Rp 38.500.000'))
  // OPEX kumulatif 6.5jt → net = 38.5 - 6.5 = 32jt
  check('Net Margin = Rp 32.000.000 (38.5jt − 6.5jt OPEX)', text.includes('Rp 32.000.000'))
  check('% Net Margin tampil (45,71%)', text.includes('45,71%'))
  // Gross margin % = 38.5/70 = 55%
  check('% Gross Margin tampil (55,00%)', text.includes('55,00%'))

  console.log('\nB. Finance — tabel rincian gross margin per proyek')
  const opsiTable = [...doc.querySelectorAll('.panel table')].find(t => (t.textContent || '').includes('Gross Profit'))
  check('tabel rincian ada (header Gross Profit)', !!opsiTable)
  check('header Kode/Proyek/Revenue/Material/Tukang ada', !!opsiTable && /Kode/.test(opsiTable.textContent) && /Proyek/.test(opsiTable.textContent))
  check('baris proyek 99 Baroni ada', !!opsiTable && opsiTable.textContent.includes('99'))
  check('Gross Baroni = Rp 20.000.000 (40 − 15 − 5)', !!opsiTable && opsiTable.textContent.includes('Rp 20.000.000'))
  check('Gross Mabes = Rp 18.500.000 (30 − 9 − 2.5)', !!opsiTable && opsiTable.textContent.includes('Rp 18.500.000'))
  check('tfoot TOTAL ada', !!opsiTable && !!opsiTable.querySelector('tfoot'))

  console.log('\nC. Finance — Rekap Pos Umum Operasional WS')
  const rekap = [...doc.querySelectorAll('.panel')].find(p => (p.textContent || '').includes('Rekap Pos Umum'))
  check('panel Rekap Pos Umum ada', !!rekap)
  check('OPEX kumulatif Rp 6.500.000', !!rekap && rekap.textContent.includes('Rp 6.500.000'))
  check('OPEX minggu ini Rp 350.000', !!rekap && rekap.textContent.includes('Rp 350.000'))
  check('baris perhitungan net margin', !!rekap && /Gross Profit semua proyek/.test(rekap.textContent))

  console.log('\nD. Finance — tab lama & petty cash')
  check('tab Pengadaan per Project ada', text.includes('Pengadaan per Project'))
  check('petty cash TIDAK tampil sebagai pos margin (angka 800.000 absen)', !text.includes('Rp 800.000'))
}

// ---------- E: ProjectFinance ----------
console.log('\nE. ProjectFinance — 4 kartu murni tanpa petty cash')
{
  const html = renderToStaticMarkup(React.createElement(ProjectFinance, {
    rows: ROWS,
    initialDriveRows: DRIVE,
    initialPlans: PLANS
  }))
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
  const doc = dom.window.document
  const text = doc.body.textContent || ''
  const cards = [...doc.querySelectorAll('.card')].map(c => c.textContent)
  check('kartu Revenue ada', cards.some(c => c.includes('Revenue')))
  check('kartu Actual Material ada', cards.some(c => c.includes('Actual Material')))
  // FN-EST_LABEL (REVIEW-03): kartu upah WAJIB berlabel estimasi WBS, bukan
  // "Actual Tukang" — angkanya dari project_plans.labor_cost (rencana), jadi
  // menyebutnya "Actual" adalah temuan audit yang harus tetap tertutup.
  check('kartu Estimasi Upah WBS ada', cards.some(c => c.includes('Estimasi Upah WBS')))
  check('label menyesatkan "Actual Tukang" TIDAK ada lagi', !cards.some(c => c.includes('Actual Tukang')))
  check('kartu upah menyatakan sumber aktual terpisah (tukang_projects / belum ada)',
    cards.some(c => /Aktual tersinkron|Aktual upah: belum ada catatan tersinkron/.test(c)))
  check('kartu Project Margin (Gross Profit) ada', cards.some(c => c.includes('Project Margin')))
  check('% Margin proyek tampil (50,00% utk Baroni: 20jt/40jt)', text.includes('50,00%'))
  check('angka petty cash 800.000 TIDAK muncul', !text.includes('800.000'))
  check('tanpa kartu "Biaya Tukang" label lama', !cards.some(c => c.includes('Biaya Tukang')))
  check('tanpa label lama "Margin (Laba Kotor)"', !cards.some(c => c.includes('Laba Kotor')))
}

// ---------- F: FN-EST_LABEL — aktual tukang_projects TIDAK dicampur ----------
console.log('\nF. FN-EST_LABEL — estimasi WBS vs aktual tukang_projects')
{
  // Proyek Baroni (revenue 40jt, estimasi upah 5jt). Sesuai KONTRAK TAHAP B
  // (t_da4a9ef8): penghubungnya NOMOR PROYEK / alias terkonfirmasi — BUKAN
  // kemiripan nama. Baris bernomor 99 = cocok; baris hanya bernama tanpa
  // nomor TIDAK dipinjamkan ke proyek mirip (masuk ember "belum terhubung"
  // yang dilaporkan terpisah) — itulah yang ditest di sini.
  const TUKANG = [
    { tukang_key: 'mandor-a', project_no: '99', project_name: 'baroni', total_upah: 4000000 },
    { tukang_key: 'mandor-b', project_no: '99', project_name: 'BARONI', total_upah: 250000 },
    // Tanpa nomor & tanpa alias terkonfirmasi → TIDAK boleh masuk proyek manapun.
    { tukang_key: 'mandor-c', project_name: 'BARONI', total_upah: 9990000 }
  ]
  const html = renderToStaticMarkup(React.createElement(ProjectFinance, {
    rows: { ...ROWS, tukang_projects: TUKANG },
    initialDriveRows: DRIVE,
    initialPlans: PLANS
  }))
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
  const text = dom.window.document.body.textContent || ''
  const cards = [...dom.window.document.querySelectorAll('.card')].map(c => c.textContent)

  check('estimasi WBS tetap 5jt (proyek terpilih = proyek pertama aktif)',
    cards.some(c => c.includes('Estimasi Upah WBS') && c.includes('Rp 5.000.000')), cards.join(' | '))
  check('aktual tukang_projects tampil terpisah = Rp 4.250.000 (2 baris bernomor 99)',
    cards.some(c => c.includes('Aktual tersinkron: Rp 4.250.000') && c.includes('2 baris')))
  check('estimasi & aktual TIDAK dijumlahkan (9.250.000 tidak muncul)', !text.includes('9.250.000'))
  check('margin tetap memakai estimasi WBS (40 − 15 − 5 = 20jt), bukan aktual',
    cards.some(c => c.includes('Project Margin') && c.includes('Rp 20.000.000')))
  check('kartu TIDAK mengklaim aktual sebagai angka utama', !cards.some(c => /^👷 Aktual Tukang/.test(c.trim())))
  // Kontrak Tahap B: baris tanpa nomor tidak dipinjamkan lewat kemiripan nama.
  check('upah tanpa nomor (Rp 9.990.000) TIDAK dipinjamkan ke proyek Baroni',
    !cards.some(c => c.includes('Aktual tersinkron: Rp 14.240.000')))
}

// ---------- G: FN-EST_LABEL — aktual belum ada -> "belum ada", bukan Rp 0 ----
console.log('\nG. FN-EST_LABEL — aktual belum ada ditulis jujur (bukan Rp 0)')
{
  const html = renderToStaticMarkup(React.createElement(ProjectFinance, {
    rows: { ...ROWS, tukang_projects: [] },
    initialDriveRows: DRIVE,
    initialPlans: PLANS
  }))
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
  const cards = [...dom.window.document.querySelectorAll('.card')].map(c => c.textContent)
  check('tulis "Aktual upah: belum ada catatan tersinkron"',
    cards.some(c => c.includes('Aktual upah: belum ada catatan tersinkron')))
  check('TIDAK menampilkan "Aktual tersinkron: Rp 0"', !cards.some(c => c.includes('Aktual tersinkron: Rp 0')))
}

// ---------- H: FN-TARGET70 — target 70% selalu rupiah utuh ----------
console.log('\nH. FN-TARGET70 — target 70% dibulatkan sekali ke rupiah utuh')
{
  const { targetBudget70 } = await import(pathToFileURL(path.join(distDir, 'money.mjs')).href)
  check('revenue 43.300.000 -> 30.310.000 tepat', targetBudget70(43300000) === 30310000, String(targetBudget70(43300000)))
  check('revenue desimal 99.999.999,99 -> BILANGAN BULAT (tidak ada pecahan sen)',
    Number.isInteger(targetBudget70(99999999.99)), String(targetBudget70(99999999.99)))
  check('revenue desimal dibulatkan ke rupiah terdekat (70.000.000)',
    targetBudget70(99999999.99) === 70000000, String(targetBudget70(99999999.99)))
  check('revenue 1.234.567,89 -> integer', Number.isInteger(targetBudget70(1234567.89)))
  check('revenue 0 / negatif / NaN -> 0 (tidak ada pagu karangan)',
    targetBudget70(0) === 0 && targetBudget70(-5) === 0 && targetBudget70('abc') === 0)
}

// ---------- I: t_57f6a3f9 — filter status proyek (On-Going / Selesai / Semua) ----------
console.log('\nI. t_57f6a3f9 — filter status proyek di ProjectFinance')
{
  // 3 on-going (99/83/75) + 2 selesai DONE (61/42). Drive hanya punya baris
  // untuk kode 99 dan 61 — kode 42 sengaja TIDAK punya baris Drive supaya
  // bisa dibuktikan UI tidak crash saat revenue/cost proyek selesai kosong.
  const rows = { ...ROWS, projects: ALL_PROJECTS }

  // I.1 — DEFAULT: hanya on-going (perilaku lama, tidak ada kejutan)
  {
    const html = renderToStaticMarkup(React.createElement(ProjectFinance, {
      rows, initialDriveRows: DRIVE, initialPlans: PLANS
    }))
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
    const doc = dom.window.document
    const opts = [...doc.querySelectorAll('select option')].map(o => o.textContent)
    check('default hanya menampilkan proyek on-going (3 pilihan, tanpa DONE)',
      opts.filter(o => !o.startsWith('—')).length === 3, opts.join(' | '))
    check('label dropdown menyebut On-Going (3)', (doc.body.textContent || '').includes('On-Going (3)'))
    check('proyek selesai TIDAK ada di daftar default',
      !opts.some(o => o.includes('Vila PIK 2') || o.includes('Kantor Sudirman')), opts.join(' | '))
    check('pill Selesai (2) & Semua Proyek (5) tampil dengan jumlah benar',
      (doc.body.textContent || '').includes('Selesai (2)') && (doc.body.textContent || '').includes('Semua Proyek (5)'))
    check('proyek pertama aktif terpilih otomatis (Baroni, revenue 40jt)',
      (doc.body.textContent || '').includes('Rp 40.000.000'))
  }

  // I.2 — initialStatusFilter='done': langsung proyek selesai, angka benar
  {
    const html = renderToStaticMarkup(React.createElement(ProjectFinance, {
      rows, initialDriveRows: DRIVE, initialPlans: PLANS, initialStatusFilter: 'done'
    }))
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
    const doc = dom.window.document
    const text = doc.body.textContent || ''
    const opts = [...doc.querySelectorAll('select option')].map(o => o.textContent)
    check('filter done: hanya 2 proyek selesai di dropdown',
      opts.filter(o => !o.startsWith('—')).length === 2, opts.join(' | '))
    check('filter done: dropdown TIDAK memuat proyek on-going',
      !opts.some(o => o.includes('Baroni') || o.includes('Mabes') || o.includes('TanpaDrive')), opts.join(' | '))
    check('filter done: proyek selesai terpilih otomatis = Vila PIK 2 (kode 61)',
      text.includes('Vila PIK 2'), text.slice(0, 200))
    check('badge "✓ Proyek Selesai" tampil untuk proyek DONE',
      (doc.querySelector('.badge') || { textContent: '' }).textContent.includes('Proyek Selesai')
      || [...doc.querySelectorAll('.badge')].some(b => b.textContent.includes('Proyek Selesai')))
    // KALKULASI proyek selesai harus sama akuratnya:
    // Revenue 55jt − Material 28jt − Upah WBS 6jt = 21jt → 38,18%
    check('Revenue proyek selesai = Rp 55.000.000', text.includes('Rp 55.000.000'))
    check('Actual Material proyek selesai = Rp 28.000.000', text.includes('Rp 28.000.000'))
    check('Estimasi Upah WBS proyek selesai = Rp 6.000.000', text.includes('Rp 6.000.000'))
    check('Project Margin proyek selesai = Rp 21.000.000 (55 − 28 − 6)', text.includes('Rp 21.000.000'))
    check('% Margin proyek selesai tampil (38,18%: 21jt/55jt)', text.includes('38,18%'))
    check('margin 21jt TIDAK tercampur angka proyek on-going (20jt Baroni absen)',
      !text.includes('Rp 20.000.000'))
  }

  // I.3 — initialStatusFilter='all': semua proyek, dikelompokkan optgroup
  {
    const html = renderToStaticMarkup(React.createElement(ProjectFinance, {
      rows, initialDriveRows: DRIVE, initialPlans: PLANS, initialStatusFilter: 'all'
    }))
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
    const doc = dom.window.document
    const text = doc.body.textContent || ''
    const opts = [...doc.querySelectorAll('select option')].map(o => o.textContent)
    const groups = [...doc.querySelectorAll('select optgroup')].map(g => g.getAttribute('label'))
    check('filter all: 5 proyek di dropdown (3 on-going + 2 selesai)',
      opts.filter(o => !o.startsWith('—')).length === 5, opts.join(' | '))
    check('filter all: dropdown dikelompokkan (On-Going / Selesai)',
      groups.length === 2 && groups[0].startsWith('On-Going') && groups[1].startsWith('Selesai'), groups.join(' | '))
    check('filter all: proyek pertama terpilih tetap Baroni (urut rows.projects)',
      text.includes('Rp 40.000.000'))
    check('filter all: baris on-going dan selesai sama-sama tersedia sebagai pilihan',
      opts.some(o => o.includes('Baroni')) && opts.some(o => o.includes('Vila PIK 2')))
  }

  // I.4 — proyek selesai TANPA baris Drive: UI jujur, tidak Rp 0 / tidak crash
  {
    const rowsNoDrive = { ...ROWS, projects: ALL_PROJECTS }
    const html = renderToStaticMarkup(React.createElement(ProjectFinance, {
      rows: rowsNoDrive, initialDriveRows: [], initialPlans: [], initialStatusFilter: 'done'
    }))
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
    const text = dom.window.document.body.textContent || ''
    check('proyek selesai tanpa data Drive tetap ter-render (tanpa crash)', !!text)
    check('revenue kosong tidak ditulis "Rp 0" (menghindari angka karangan)',
      !text.includes('Rp 0'))
  }
}

console.log(`\n=== HASIL: ${pass} pass, ${fail} fail ===`)
if (failures.length) console.log('GAGAL:', failures.join(' ; '))
process.exit(fail ? 1 : 0)
