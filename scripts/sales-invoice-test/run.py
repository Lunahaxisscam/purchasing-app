#!/usr/bin/env python3
"""
Harness verifikasi modul Invoice Penjualan / Sales Invoice (t_ff3a96cf).

Pola rab-boq-render-test: merender view.jsx ASLI via React+jsdom (swc
transform), memeriksa UI tahap awal modul + guard akses admin-only.
READ-ONLY repo — sandbox di /tmp, tanpa DB, tanpa mutasi.

Cakupan:
  A) Render admin: judul "Invoice Penjualan", intro alur bisnis CRM -> RAB
     -> Invoice, badge fase, panel daftar, empty state JUJUR tanpa data
     demo (teks persis arahan task), TIDAK ada tombol buat/simpan/termin.
  B) Guard non-admin: role 'user' -> panel "Halaman ini khusus
     administrator." (guard render pages/index.js + menu adminOnly
     navSections, dicek statis dari source asli).
  C) Navigasi existing tidak rusak: navSections masih berisi semua item
     lama (urutan utuh, sales_invoice disisipkan tepat setelah rab_boq),
     labels lengkap, registry modul existing tidak berubah, dan page
     existing tetap ada di pages/index.js (render dispatch utuh).
  D) Kerangka detail: kolom INVOICE_COLUMNS = No. Invoice / Customer (CRM)
     / RAB Final-Disetujui / Nominal / Status Dokumen; bila suatu saat
     data invoice di-pass, tabel read-only dirender dengan badge status
     dikenal; nilai kosong -> dash, bukan tebakan.
  E) Tidak ada persistence palsu: view tidak memanggil localStorage,
     tidak ada fetch/insert/supabase di modul, tidak ada data demo/seed.

Cara jalankan:  python3 scripts/sales-invoice-test/run.py  (dari root repo)
"""
import json
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/sales-invoice-sandbox'

CHECKS = []
def check(no, name, expected, actual):
    ok = expected == actual
    CHECKS.append((no, name, expected, actual, ok))
    return ok

SUPABASE_MOCK = r'''
// lib/supabaseClient.js — mock (pola rab-boq-render-test)
export let __calls = []
export const supabase = { from() { return {} } }
'''

def main():
    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(f'{SB}/modules/sales-invoice')
    os.makedirs(f'{SB}/lib')
    if not os.path.exists(f'{SB}/node_modules'):
        os.symlink('/home/ubuntu/purchasing-app/node_modules', f'{SB}/node_modules')

    # --- salin sumber ASLI (verbatim) ---
    for f in ['view.jsx', 'README.md']:
        shutil.copy(f'{REPO}/modules/sales-invoice/{f}', f'{SB}/modules/sales-invoice/{f}')
    for f in ['constants.js', 'workflow.js']:
        shutil.copy(f'{REPO}/lib/{f}', f'{SB}/lib/{f}')
        shutil.copy(f'{REPO}/lib/{f}', f'{SB}/lib/{f[:-3]}.mjs')

    # --- swc transform view.jsx (dari WORKTREE, bukan main checkout) ---
    open(f'{SB}/swc_transform.cjs', 'w', encoding='utf-8').write(r'''
const fs = require('fs')
const swc = require('/home/ubuntu/purchasing-app/node_modules/next/dist/build/swc')
const src = process.env.SI_VIEW_SRC
const code = swc.transformSync(fs.readFileSync(src, 'utf8'), {
  filename: src,
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
  module: { type: 'es6' }
}).code
fs.writeFileSync('modules/sales-invoice/view.compiled.mjs', code)
console.log('compiled')
''')
    env = dict(os.environ, SI_VIEW_SRC=f'{REPO}/modules/sales-invoice/view.jsx')
    subprocess.run(['node', f'{SB}/swc_transform.cjs'], capture_output=True, text=True, timeout=120, cwd=SB, check=True, env=env)

    open(f'{SB}/lib/supabaseClientMock.js', 'w', encoding='utf-8').write(SUPABASE_MOCK)

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

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const View = (await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/view.compiled.mjs')).href)).default
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
check('A5', 'badge fase tahap pembukaan ada', true, !!q('.si-badge-fase'))
check('A6', 'panel daftar ada', 'Daftar Invoice Penjualan', q('.si-panel-head strong')?.textContent.trim())
check('A7', 'empty state tampil (belum ada data)', true, !!q('[data-testid="si-empty"]'))
check('A8', 'teks empty state persis arahan task (paragraf)',
  'Belum ada invoice penjualan',
  q('.si-empty strong')?.textContent.trim())
check('A9', 'teks "Pengaturan penagihan/termin akan ditambahkan berikutnya" ada',
  true, (q('.si-empty p')?.textContent || '').includes('Pengaturan penagihan/termin akan ditambahkan berikutnya'))
check('A10', 'TIDAK ada data demo (tanpa baris tabel invoice)', 0, qa('.si-table tbody tr').length)
check('A11', 'TIDAK ada tombol apapun di modul (no fake save/create)', 0, qa('button').length)
check('A12', 'TIDAK ada tombol/teks termin', true, qa('*').every(el => !(el.children.length === 0 && /termin \d/.test(el.textContent || ''))))
check('A13', 'TIDAK ada nomor invoice dummy', true, !/INV-\d{4}/.test(host.textContent))
const notebar = q('.si-notebar')?.textContent || ''
check('A14', 'status implementasi jujur (belum simpan/termin/penomoran)',
  true, /belum/.test(notebar) && /penomoran/.test(notebar))
check('A15', 'empty note menyebut menunggu keputusan DAT', true, /Menunggu keputusan DAT/.test(q('.si-empty-note')?.textContent || ''))

// ============ B. GUARD NON-ADMIN (level source, statis) ============
// Guard render di pages/index.js: role dari profiles, panel khusus admin.
const idxSrc = fs.readFileSync(REPO + '/pages/index.js', 'utf8')
check('B1', 'pages/index.js: branch sales_invoice ada guard role admin',
  true, /page === 'sales_invoice' \? \(\s*\n\s*\/\/[^\n]*\n[\s\S]{0,600}?role === 'admin' \? \(\s*\n\s*<SalesInvoiceModule/.test(idxSrc))
const guardSeg = idxSrc.split("page === 'sales_invoice'")[1] || ''
check('B2', 'guard render non-admin: panel "khusus administrator"',
  true, guardSeg.includes("Halaman ini khusus administrator."))
check('B3', 'guard render merender SalesInvoiceModule utk admin', true, guardSeg.includes('<SalesInvoiceModule />'))
check('B4', 'tombol refresh global disembunyikan di halaman sales_invoice', true, /'planning', 'project_finance', 'finance', 'tukang_upah', 'rab_boq', 'sales_invoice', 'settings'/.test(idxSrc))
// Menu: section Admin Suite adminOnly -> sidebar menyaring berdasarkan role.
const constSrc = fs.readFileSync(REPO + '/lib/constants.js', 'utf8')
check('B5', 'navSections Admin Suite tetap adminOnly (menu tersembunyi utk user)',
  true, /label: 'Admin Suite',\s*\n\s*\/\/[^\n]*\n\s*adminOnly: true/.test(constSrc))

// ============ C. NAVIGASI EXISTING TIDAK RUSAK (statis, source asli) ============
const { navSections, labels } = await import(pathToFileURL(path.join(SB, 'lib/constants.mjs')).href)
const adminItems = navSections.find(s => s.adminOnly).items.map(i => i[0])
check('C1', 'sales_invoice ada di Admin Suite', true, adminItems.includes('sales_invoice'))
check('C2', 'posisi: tepat setelah rab_boq, sebelum planning',
  ['rab_boq', 'sales_invoice', 'planning'], (() => {
    const i = adminItems.indexOf('sales_invoice')
    return adminItems.slice(i - 1, i + 2)
  })())
const coreItems = [
  'dashboard', 'projects', 'vendors', 'materials', 'requests', 'approvals',
  'receivings', 'handovers', 'past_projects'
]
check('C3', 'semua menu existing utuh di navSections', true,
  coreItems.every(id => navSections.some(s => s.items.some(i => i[0] === id))))
check('C4', 'urutan menu existing TIDAK berubah (Admin Suite utk item lain)', true,
  ['rab_boq', 'planning', 'project_finance', 'finance', 'tukang_upah', 'settings']
    .every((id, i) => adminItems.filter(x => x !== 'sales_invoice')[i] === id))
check('C5', 'labels.sales_invoice = Invoice Penjualan', 'Invoice Penjualan', labels.sales_invoice)
const regSrc = fs.readFileSync(REPO + '/modules/registry.js', 'utf8')
check('C6', 'registry: sales_invoice source core + adminOnly', true,
  /id: 'sales_invoice',\s*\n\s*label: 'Invoice Penjualan',\s*\n\s*adminOnly: true,\s*\n\s*source: 'core'/.test(regSrc))
check('C7', 'registry: modul existing tetap terdaftar', true,
  ['projects', 'vendors', 'materials', 'requests', 'approvals', 'receivings', 'handovers', 'past_projects', 'dashboard', 'planning', 'project_finance', 'finance', 'tukang_upah', 'rab_boq', 'settings']
    .every(id => regSrc.includes(`id: '${id}'`)))
const dashSrc = fs.readFileSync(REPO + '/components/Dashboard.js', 'utf8')
check('C8', 'dashboard: kartu sales_invoice hanya di blok role admin', true,
  (/role === 'admin'\) \{[\s\S]*?cards\.push\(\['sales_invoice'/.test(dashSrc)) ||
  (/role === 'admin' \? \[[\s\S]*?\['sales_invoice'/.test(dashSrc)))
check('C9', 'dashboard: kartu existing utuh', true,
  ['planning', 'project_finance', 'finance', 'tukang_upah', 'rab_boq', 'settings'].every(id => dashSrc.includes(`['${id}'`)))

// ============ D. KERANGKA DETAIL + DATA (bila suatu saat ada) ============
const { INVOICE_COLUMNS, invoiceStatusBadge, formatNominal } =
  await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/view.compiled.mjs')).href)
check('D1', 'kolom kerangka detail sesuai kesepakatan bisnis',
  ['invoice_no', 'customer_name', 'rab_reff', 'nominal', 'status'], INVOICE_COLUMNS.map(c => c.key))
check('D2', 'label kolom Customer (CRM)', 'Customer (CRM)', INVOICE_COLUMNS.find(c => c.key === 'customer_name').label)
check('D3', 'label kolom RAB Final / Disetujui', 'RAB Final / Disetujui', INVOICE_COLUMNS.find(c => c.key === 'rab_reff').label)
check('D4', 'badge status dikenal: DISETUJUI', 'approved', invoiceStatusBadge('DISETUJUI').tone)
check('D5', 'badge status dikenal: LUNAS', 'paid', invoiceStatusBadge('LUNAS').tone)
check('D6', 'badge status tidak dikenal -> apa adanya (muted, bukan tebakan)',
  { label: 'MENUNGGU', tone: 'muted' }, invoiceStatusBadge('MENUNGGU'))
check('D7', 'status kosong -> dash', '—', invoiceStatusBadge('').label)
check('D8', 'formatNominal 45000000 -> Rp 45.000.000', 'Rp 45.000.000', formatNominal(45000000))
check('D9', 'formatNominal null -> dash', '—', formatNominal(null))

// render DENGAN data (simulasi masa depan: props dari tabel DB)
await act(async () => {
  root.render(React.createElement(View, { invoices: [
    { id: 's1', invoice_no: 'SINV-2026-0001', customer_name: 'PT Contoh', rab_reff: 'RAB [99] REV01 (disetujui)', nominal: 45000000, status: 'TERKIRIM' }
  ] }))
})
check('D10', 'dengan data: tabel ter-render 1 baris', 1, qa('.si-table tbody tr').length)
check('D11', 'dengan data: empty state hilang', null, q('[data-testid="si-empty"]'))
check('D12', 'dengan data: kolom nominal terbaca', 'Rp 45.000.000', qa('.si-table tbody td')[3]?.textContent.trim())
check('D13', 'dengan data: badge status TERKIRIM', 'TERKIRIM', qa('.si-badge').map(b => b.textContent.trim())[0])

// ============ E. TIDAK ADA PERSISTENCE PALSU ============
const viewSrc = fs.readFileSync(REPO + '/modules/sales-invoice/view.jsx', 'utf8')
// Uji KODE (komentar dokumentasi dilucuti — komentar menjelaskan larangan
// justru menyebut kata kuncinya), pola sama dgn E5.
const viewCode = viewSrc.replace(/\/\/[^\n]*/g, '')
check('E1', 'view TIDAK menyentuh localStorage', false, /localStorage/.test(viewCode))
check('E2', 'view TIDAK memanggil supabase/fetch', false, /supabase|fetch\(/.test(viewCode))
check('E3', 'view TIDAK ada insert/update/save', false, /\.insert\(|\.update\(|onSubmit/.test(viewCode))
check('E4', 'view TIDAK ada seed/demo data', false, /demo|sample|DUMMY/i.test(viewCode))
check('E5', 'view TIDAK ada termin (%)', false, /termin\s*:|%"/i.test(viewSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')))
check('E6', 'README mencatat kebutuhan fase database', true, (() => {
  const md = fs.readFileSync(REPO + '/modules/sales-invoice/README.md', 'utf8')
  return ['customer_id', 'rab_version_id', 'project_id', 'unique'].every(k => md.includes(k))
})())

console.log('\n=== HASIL: ' + pass + ' LULUS, ' + fail + ' GAGAL ===')
if (fail) { console.log('Gagal: ' + failures.join('; ')); process.exit(1) }
'''

    open(f'{SB}/run_test.mjs', 'w', encoding='utf-8').write(test_js)
    env_test = dict(os.environ, SI_REPO=REPO, SI_VIEW_SRC=f'{REPO}/modules/sales-invoice/view.jsx')
    r = subprocess.run(['node', f'{SB}/run_test.mjs'], capture_output=True, text=True, timeout=180, cwd=SB, env=env_test)
    print(r.stdout)
    if r.stderr.strip():
        print('STDERR:', r.stderr[:3000])
    if r.returncode != 0:
        print(f'=== harness exit {r.returncode} ===')
        return 1

    # Ringkasan python-side
    n_pass = sum(1 for c in CHECKS if c[4])
    print(f"=== PYTHON SUMMARY: {len(CHECKS)} checks terdaftar (JS yang menjalankan check: lihat output di atas) ===")
    return 0

if __name__ == '__main__':
    sys.exit(main())
