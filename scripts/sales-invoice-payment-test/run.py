#!/usr/bin/env python3
"""
scripts/sales-invoice-payment-test/run.py — UJI TERMIN, PEMBAYARAN, PIUTANG (S4/7 audit)

Kartu t_108ebc3e: AUDIT ONLY — tidak ada file aplikasi yang diubah. Harness
ini adalah bukti: setiap temuan audit diuji sebagai assertion terhadap kode
APA ADANYA (belum diperbaiki). Assertion gagal = temuan terkonfirmasi.

  A) TERMIN & DUE DATE   : termin tidak punya skema, due_date opsional,
                           termin parsial (DP 50%) tidak dikenali.
  B) PAYMENT LEDGER      : field pembayaran, bukti, duplikat guard,
                           nominal parsing, koreksi salah input.
  C) PIUTANG / OVERDUE   : definisi outstanding, perhitungan overdue,
                           hari WIB, status DITOLAK/BATAL.
  D) CASHFLOW & KPI      : KPI view (omzet vs lunas vs piutang),
                           kas masuk, rekonsiliasi.
  E) REGRESI             : harness S4 + reminders tetap lulus (tidak ada
                           temuan yang mengklaim "kode rusak" tanpa alasan).

Pemakaian: python3 scripts/sales-invoice-payment-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/sales-invoice-payment-sandbox'


def main():
    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(f'{SB}/modules/sales-invoice')
    os.makedirs(f'{SB}/lib')
    os.makedirs(f'{SB}/scripts/reminders')
    if not os.path.exists(f'{SB}/node_modules'):
        os.symlink('/home/ubuntu/purchasing-app/node_modules', f'{SB}/node_modules')

    # Modul yang diuji apa adanya (audit: salinan identik, bukan stub).
    for f in ['contract.js', 'store.js', 'auth.js', 'pdf.js', 'view.jsx', 'CreateInvoiceModal.jsx', 'apiClient.js']:
        p = f'{REPO}/modules/sales-invoice/{f}'
        if os.path.exists(p):
            shutil.copy(p, f'{SB}/modules/sales-invoice/{f}')
    for f in ['constants.js', 'workflow.js', 'supabaseClient.js']:
        p = f'{REPO}/lib/{f}'
        if os.path.exists(p):
            shutil.copy(p, f'{SB}/lib/{f}')
            shutil.copy(p, f'{SB}/lib/{f[:-3]}.mjs')
    for f in ['rules.js', 'collect.js', 'handler.js', 'cli.mjs', 'auth.js', 'sample-data.json']:
        p = f'{REPO}/scripts/reminders/{f}'
        if os.path.exists(p):
            shutil.copy(p, f'{SB}/scripts/reminders/{f}')

    # --- compile JSX via SWC (pola sama dengan scripts/sales-invoice-test) ---
    open(f'{SB}/swc_compile.cjs', 'w', encoding='utf-8').write(r'''
const fs = require('fs')
const path = require('path')
const swc = require('/home/ubuntu/purchasing-app/node_modules/next/dist/build/swc')

const files = [
  { in: 'modules/sales-invoice/view.jsx', out: 'modules/sales-invoice/view.compiled.mjs' },
  { in: 'modules/sales-invoice/CreateInvoiceModal.jsx', out: 'modules/sales-invoice/CreateInvoiceModal.js' }
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
  code = code.replace(/from\s+['"]\.\/CreateInvoiceModal['"]/g, "from './CreateInvoiceModal.js'")
  code = code.replace(/from\s+['"]\.\/pdf['"]/g, "from './pdf.js'")
  code = code.replace(/from\s+['"]\.\/contract\.js['"]/g, "from './contract.js'")
  code = code.replace(/from\s+['"]\.\/apiClient['"]/g, "from './apiClient.js'")
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

    ok = True
    total_ok = total_find = total_fail = 0
    findings = []
    for script, label in [
        ('payment_test.mjs', 'A+B. TERMIN & PAYMENT LEDGER'),
        ('guard_test.mjs', 'A6b. GUARD PROYEK & LEDGER (Supabase)'),
        ('piutang_test.mjs', 'C+D. PIUTANG, OVERDUE & KPI CASHFLOW'),
        ('regression_test.mjs', 'E. REGRESI (tidak ada klaim palsu)'),
    ]:
        src = open(f'{REPO}/scripts/sales-invoice-payment-test/{script}', encoding='utf-8').read()
        open(f'{SB}/{script}', 'w', encoding='utf-8').write(src)
        print(f'\n================ {label} ================')
        r = subprocess.run(['node', f'{SB}/{script}'], capture_output=True, text=True, cwd=SB,
                           env=dict(os.environ, SI_REPO=REPO))
        print(r.stdout)
        if r.stderr.strip():
            print('STDERR:', r.stderr[:3000])
        if r.returncode != 0:
            ok = False
        # Agregat baris ringkasan tiap harness:
        # "X selesai: N ok, M fail, K finding (kode...)"
        m = re.search(r':\s*(\d+) ok, (\d+) fail, (\d+) finding \(([^)]*)\)', r.stdout)
        if m:
            total_ok += int(m.group(1))
            total_fail += int(m.group(2))
            total_find += int(m.group(3))
            for code in [c.strip() for c in m.group(4).split(',') if c.strip()]:
                findings.append(code)
        # Ringkasan "E selesai: 12 ok, 0 fail ()"
        m2 = re.search(r':\s*(\d+) ok, (\d+) fail \(\)', r.stdout)
        if m2:
            total_ok += int(m2.group(1))
            total_fail += int(m2.group(2))

    print('\n================ HASIL AKHIR ================')
    print('SEMUA HARNESS LULUS' if ok else 'ADA HARNESS YANG GAGAL')
    print(f'TOTAL assertion lulus : {total_ok}')
    print(f'TOTAL assertion gagal : {total_fail}')
    print(f'TOTAL finding audit   : {total_find} (kode: {", ".join(findings) if findings else "-"})')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
