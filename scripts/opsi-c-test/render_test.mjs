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
  fs.writeFileSync(path.join(distDir, out), rewritten)
}

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
const PLANS = [
  { project_id: 'p1', labor_cost: 5000000 },
  { project_id: 'p2', labor_cost: 2500000 }
]
const DRIVE = [
  { id: 'd1', project_no: '99', project_name: 'Baroni', cumulative_cost: 15000000, current_week_expense: 1000000, revenue: 40000000, petty_cash: 800000 },
  { id: 'd2', project_no: '83', project_name: 'Mabes', cumulative_cost: 9000000, current_week_expense: 500000, revenue: 30000000, petty_cash: 0 },
  { id: 'd3', project_no: 'operasional ws', project_name: 'Operasional WS', cumulative_cost: 6500000, current_week_expense: 350000 }
]
const ROWS = { projects: PROJECTS, requests: [], pr_items: [], receivings: [] }

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
  check('kartu Actual Tukang ada', cards.some(c => c.includes('Actual Tukang')))
  check('kartu Project Margin (Gross Profit) ada', cards.some(c => c.includes('Project Margin')))
  check('% Margin proyek tampil (50,00% utk Baroni: 20jt/40jt)', text.includes('50,00%'))
  check('angka petty cash 800.000 TIDAK muncul', !text.includes('800.000'))
  check('tanpa kartu "Biaya Tukang" label lama', !cards.some(c => c.includes('Biaya Tukang')))
  check('tanpa label lama "Margin (Laba Kotor)"', !cards.some(c => c.includes('Laba Kotor')))
}

console.log(`\n=== HASIL: ${pass} pass, ${fail} fail ===`)
if (failures.length) console.log('GAGAL:', failures.join(' ; '))
process.exit(fail ? 1 : 0)
