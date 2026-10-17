#!/usr/bin/env python3
"""
scripts/sales-invoice-test/run.py — UJI OTOMATIS MODUL SALES INVOICE (OPsi B)
Noir Living Internal Purchasing App.

Mencakup:
  A) Render Admin & UI Shell (judul, intro alur bisnis CRM -> RAB -> Invoice -> Proyek).
  B) Guard Non-Admin 3 Lapis (menu adminOnly, guard render role admin).
  C) Navigasi existing di Admin Suite tetap utuh & terurut.
  D) Data Mapping: kolom detail, format nominal, badge status dokumen.
  E) Form Pembuatan Invoice: nomor invoice generator, suggest next project code (max+1).
  F) Native PDF Generator: validasi biner PDF 1.4, header kop resmi, %%EOF.
"""
import json
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/sales-invoice-sandbox'

def main():
    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(f'{SB}/modules/sales-invoice')
    os.makedirs(f'{SB}/lib')
    if not os.path.exists(f'{SB}/node_modules'):
        os.symlink('/home/ubuntu/purchasing-app/node_modules', f'{SB}/node_modules')

    # Salin file modul
    for f in ['view.jsx', 'CreateInvoiceModal.jsx', 'pdf.js', 'README.md']:
        p = f'{REPO}/modules/sales-invoice/{f}'
        if os.path.exists(p):
            shutil.copy(p, f'{SB}/modules/sales-invoice/{f}')
    for f in ['constants.js', 'workflow.js', 'supabaseClient.js']:
        p = f'{REPO}/lib/{f}'
        if os.path.exists(p):
            shutil.copy(p, f'{SB}/lib/{f}')
            shutil.copy(p, f'{SB}/lib/{f[:-3]}.mjs')

    # Compile JSX via SWC
    open(f'{SB}/swc_compile.cjs', 'w', encoding='utf-8').write(r'''
const fs = require('fs')
const path = require('path')
const swc = require('/home/ubuntu/purchasing-app/node_modules/next/dist/build/swc')

const files = [
  { in: 'modules/sales-invoice/view.jsx', out: 'modules/sales-invoice/view.compiled.mjs' },
  { in: 'modules/sales-invoice/CreateInvoiceModal.jsx', out: 'modules/sales-invoice/CreateInvoiceModal.js' },
  { in: 'modules/sales-invoice/pdf.js', out: 'modules/sales-invoice/pdf.js' }
]

for (const item of files) {
  const fullIn = path.join(process.cwd(), item.in)
  if (!fs.existsSync(fullIn)) continue
  const raw = fs.readFileSync(fullIn, 'utf8')
  let code = swc.transformSync(raw, {
    filename: fullIn,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' }
  }).code
  // Fix extensionless local imports in pure Node ESM
  code = code.replace(/from\s+['"]\.\/CreateInvoiceModal['"]/g, "from './CreateInvoiceModal.js'")
  code = code.replace(/from\s+['"]\.\/pdf['"]/g, "from './pdf.js'")
  code = code.replace(/from\s+['"]\.\.\/\.\.\/lib\/supabaseClient['"]/g, "from '../../lib/supabaseClient.js'")
  const fullOut = path.join(process.cwd(), item.out)
  fs.mkdirSync(path.dirname(fullOut), { recursive: true })
  fs.writeFileSync(fullOut, code)
}
console.log('swc-compiled-ok')
''')

    r_swc = subprocess.run(['node', f'{SB}/swc_compile.cjs'], capture_output=True, text=True, cwd=SB)
    if r_swc.returncode != 0:
        print('SWC error:', r_swc.stderr)
        return 1

    test_js = r'''
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const SB = process.cwd()
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
for (const k of ['HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'getComputedStyle']) globalThis[k] = window[k]
window.confirm = () => true
window.alert = () => {}

// Mock fetch
globalThis.fetch = async (url, opts) => {
  return {
    ok: true,
    json: async () => ({ ok: true, invoices: [] })
  }
}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const View = (await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/view.compiled.mjs')).href)).default
const { suggestNextProjectCode, generateInvoiceNumber } =
  await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/CreateInvoiceModal.js')).href)
const { buildSalesInvoicePdf } =
  await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/pdf.js')).href)

const REPO = process.env.SI_REPO

let pass = 0, fail = 0
const failures = []
function check(no, name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  if (ok) { pass++; console.log('  ok ' + no + ' ' + name) }
  else { fail++; failures.push(no + ' ' + name); console.log('  FAIL ' + no + ' ' + name + ' | expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual)) }
}

const host = window.document.createElement('div')
window.document.body.appendChild(host)
const root = createRoot(host)
const q = (sel) => host.querySelector(sel)
const qa = (sel) => Array.from(host.querySelectorAll(sel))

// ============ A. RENDER ADMIN (tanpa data) ============
await act(async () => { root.render(React.createElement(View, {})) })

check('A1', 'judul "Invoice Penjualan" tampil', 'Invoice Penjualan', q('.si-intro-copy strong')?.textContent.trim())
const intro = q('.si-intro-copy span')?.textContent || ''
check('A2', 'intro menyebut alur CRM', true, /CRM/i.test(intro))
check('A3', 'intro menyebut RAB', true, /RAB/i.test(intro))
check('A4', 'intro menyebut Invoice', true, /Invoice/i.test(intro))
check('A5', 'badge fase ada', true, !!q('.si-badge-fase'))
check('A6', 'panel daftar ada', 'Daftar Invoice Penjualan', q('.si-panel-head strong')?.textContent.trim())
check('A7', 'empty state tampil (belum ada data)', true, !!q('[data-testid="si-empty"]'))
check('A8', 'teks empty state menyebut Belum ada invoice penjualan', 'Belum ada invoice penjualan', q('.si-empty strong')?.textContent.trim())
check('A9', 'tombol + Buat Invoice Penjualan tampil di header', '+ Buat Invoice Penjualan', q('.si-header-actions .si-btn-create')?.textContent.trim())
check('A10', 'KPI grid menampilkan 4 kartu metrik', 4, qa('.si-kpi-card').length)

// ============ B. GUARD NON-ADMIN ============
const idxSrc = fs.readFileSync(REPO + '/pages/index.js', 'utf8')
check('B1', 'pages/index.js: branch sales_invoice ada guard role admin',
  true, /page === 'sales_invoice' \? \(\s*\n\s*role === 'admin' \? \(\s*\n\s*<SalesInvoiceModule/.test(idxSrc))
const guardSeg = idxSrc.split("page === 'sales_invoice'")[1] || ''
check('B2', 'guard render non-admin: panel "khusus administrator"',
  true, guardSeg.includes("Halaman ini khusus administrator."))
check('B3', 'guard render merender SalesInvoiceModule dengan props projects',
  true, guardSeg.includes('projects={rows.projects || []}'))

// ============ C. NAVIGASI EXISTING ============
const { navSections, labels } = await import(pathToFileURL(path.join(SB, 'lib/constants.mjs')).href)
const adminItems = navSections.find(s => s.adminOnly).items.map(i => i[0])
check('C1', 'sales_invoice ada di Admin Suite', true, adminItems.includes('sales_invoice'))
check('C2', 'posisi: tepat setelah rab_boq, sebelum planning',
  ['rab_boq', 'sales_invoice', 'planning'], (() => {
    const i = adminItems.indexOf('sales_invoice')
    return adminItems.slice(i - 1, i + 2)
  })())
check('C3', 'labels.sales_invoice = Invoice Penjualan', 'Invoice Penjualan', labels.sales_invoice)

// ============ D. KERANGKA DETAIL + DATA ============
const { INVOICE_COLUMNS, invoiceStatusBadge, formatNominal } =
  await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/view.compiled.mjs')).href)
check('D1', 'kolom kerangka detail sesuai kesepakatan bisnis',
  ['invoice_no', 'customer_name', 'rab_reff', 'nominal', 'status'], INVOICE_COLUMNS.map(c => c.key))
check('D2', 'badge status DISETUJUI', 'approved', invoiceStatusBadge('DISETUJUI').tone)
check('D3', 'badge status LUNAS', 'paid', invoiceStatusBadge('LUNAS').tone)
check('D4', 'formatNominal 85000000 -> Rp 85.000.000', 'Rp 85.000.000', formatNominal(85000000))

// Render dengan data
await act(async () => {
  root.render(React.createElement(View, { invoices: [
    { id: 'si_1', invoice_no: 'INV/NL/2026/10/001', customer_name: 'Jessica Wong', project_name: 'Alsut Fitout', project_code: '106', rab_reff: 'BOQ-001', nominal: 85000000, status: 'TERKIRIM' }
  ] }))
})
check('D5', 'dengan data: tabel ter-render 1 baris', 1, qa('.si-table tbody tr').length)
check('D6', 'dengan data: nomor invoice terbaca', 'INV/NL/2026/10/001', q('.si-inv-num')?.textContent.trim())
check('D7', 'dengan data: nomor proyek terbitan [106] tampil', true, q('.si-proj-code')?.textContent.includes('[106]'))
check('D8', 'dengan data: tombol aksi PDF tersedia', true, !!q('.si-act-pdf'))

// ============ E. LOGIKA PENOMORAN PROYEK & INVOICE ============
const dummyProjects = [
  { id: '1', kode: '83', name: 'Josh' },
  { id: '2', kode: '99', name: 'Santi' },
  { id: '3', kode: '105', name: 'Lia' }
]
check('E1', 'suggestNextProjectCode memilih max+1 dari 105 -> 106', '106', suggestNextProjectCode(dummyProjects))
check('E2', 'suggestNextProjectCode fallback 106 bila list kosong', '106', suggestNextProjectCode([]))
check('E3', 'generateInvoiceNumber membuat format INV/NL/YYYY/MM/001', true, /^INV\/NL\/\d{4}\/\d{2}\/001$/.test(generateInvoiceNumber([])))

// ============ F. NATIVE PDF GENERATOR VALIDATION ============
const sampleInvoice = {
  id: 'si_test',
  invoice_no: 'INV/NL/2026/10/001',
  customer_name: 'Jessica Wong',
  customer_phone: '08123456789',
  project_address: 'Gading Serpong',
  rab_reff: 'BOQ-001',
  project_name: 'Fit-Out Interior',
  project_code: '106',
  nominal: 85000000,
  tax_rate: 11,
  tax_amount: 9350000,
  grand_total: 94350000,
  notes: 'DP 50%',
  issue_date: '2026-10-17',
  due_date: '2026-10-31',
  status: 'TERKIRIM'
}
const pdfBytes = buildSalesInvoicePdf(sampleInvoice)
const pdfStr = Buffer.from(pdfBytes).toString('latin1')
check('F1', 'PDF magic bytes %PDF-1.4', true, pdfStr.startsWith('%PDF-1.4'))
check('F2', 'PDF diakhiri %%EOF', true, pdfStr.trim().endsWith('%%EOF'))
check('F3', 'PDF memuat teks kop NOIR LIVING ATELIER', true, pdfStr.includes('NOIR LIVING ATELIER'))
check('F4', 'PDF memuat teks INVOICE PENJUALAN', true, pdfStr.includes('INVOICE') && pdfStr.includes('PENJUALAN'))
check('F5', 'PDF memuat nama customer Jessica Wong', true, pdfStr.includes('Jessica Wong'))
check('F6', 'PDF memuat nomor proyek [106]', true, pdfStr.includes('[106]'))
check('F7', 'PDF memuat rekening BCA Noir Living', true, pdfStr.includes('Bank Central Asia') || pdfStr.includes('BCA'))

console.log('\n=== HASIL: ' + pass + ' LULUS, ' + fail + ' GAGAL ===')
if (fail) { console.log('Gagal: ' + failures.join('; ')); process.exit(1) }
'''

    open(f'{SB}/run_test.mjs', 'w', encoding='utf-8').write(test_js)
    r_test = subprocess.run(['node', f'{SB}/run_test.mjs'], capture_output=True, text=True, cwd=SB, env=dict(os.environ, SI_REPO=REPO))
    print(r_test.stdout)
    if r_test.stderr.strip():
        print('STDERR:', r_test.stderr[:2000])
    if r_test.returncode != 0:
        return 1

    return 0

if __name__ == '__main__':
    sys.exit(main())
