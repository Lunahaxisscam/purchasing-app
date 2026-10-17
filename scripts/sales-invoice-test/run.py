#!/usr/bin/env python3
"""
scripts/sales-invoice-test/run.py — UJI MODUL SALES INVOICE (S4: hardening)

Fokus S4 (temuan review Brooklyn):
  A) KONTRAK MURNI (node, tanpa HTTP): status/transisi, format nomor invoice,
     validasi payload, penghitungan ulang uang, field beku setelah terbit.
  B) NEGATIVE CASES STORE: draft tanpa nomor, idempotensi (retry tidak
     menduplikasi), key dipakai ulang dengan isi berbeda = 409, balapan nomor
     invoice, LUNAS tanpa bukti / nominal kurang, invoice terbit beku,
     proyek TIDAK diterbitkan bila invoice gagal (tanpa proyek yatim).
  C) OTORISASI SERVER-SIDE: tanpa JWT = 401, non-admin = 403, preview token
     salah = 401, tanpa konfigurasi = 503 (fail closed). Handler diuji langsung
     (bukan lewat UI) supaya terbukti guard UI tidak bisa diakali.
  D) API HANDLER: 405, 400 validasi, 201 draf, replay 200, PATCH transisi,
     TERKIRIM butuh kanal, LUNAS butuh bukti + nominal penuh.
  E) PDF: tidak ada data karangan (rekening/telepon/website), watermark draf.
  F) WIRING/RENDER: halaman tetap terbuka, guard admin tetap, storage banner.

Pemakaian: python3 scripts/sales-invoice-test/run.py
"""
import json
import os
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

    for f in ['view.jsx', 'CreateInvoiceModal.jsx', 'pdf.js', 'contract.js', 'store.js', 'auth.js', 'apiClient.js']:
        p = f'{REPO}/modules/sales-invoice/{f}'
        if os.path.exists(p):
            shutil.copy(p, f'{SB}/modules/sales-invoice/{f}')
    for f in ['constants.js', 'workflow.js', 'supabaseClient.js']:
        p = f'{REPO}/lib/{f}'
        if os.path.exists(p):
            shutil.copy(p, f'{SB}/lib/{f}')
            shutil.copy(p, f'{SB}/lib/{f[:-3]}.mjs')

    # API handler ikut diuji: salin apa adanya, ganti import supabase dengan stub.
    api_src = open(f'{REPO}/pages/api/sales-invoices.js', encoding='utf-8').read()
    api_src = api_src.replace(
        "import { createClient } from '@supabase/supabase-js'",
        "import { createClient } from '../../lib/supabaseStub.mjs'"
    )
    os.makedirs(f'{SB}/pages/api', exist_ok=True)
    open(f'{SB}/pages/api/sales-invoices.mjs', 'w', encoding='utf-8').write(api_src)
    open(f'{SB}/lib/supabaseStub.mjs', 'w', encoding='utf-8').write('''
// Stub minimal: cukup untuk memastikan modul bisa diimpor tanpa kredensial.
export function createClient() {
  return {
    from() { throw new Error('stub: tidak dipakai dalam uji ini') },
    rpc() { throw new Error('stub: tidak dipakai dalam uji ini') },
    auth: { getUser: async () => ({ data: { user: null }, error: new Error('stub') }) }
  }
}
''')

    # Compile JSX via SWC
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
    for script, label in [('contract_test.mjs', 'A. KONTRAK & VALIDASI'),
                          ('store_test.mjs', 'B. STORE / IDEMPOTENSI / NEGATIVE CASES'),
                          ('auth_api_test.mjs', 'C+D. OTORISASI SERVER & API HANDLER'),
                          ('render_test.mjs', 'E+F. PDF, RENDER, WIRING')]:
        src = open(f'{REPO}/scripts/sales-invoice-test/{script}', encoding='utf-8').read()
        open(f'{SB}/{script}', 'w', encoding='utf-8').write(src)
        print(f'\n================ {label} ================')
        r = subprocess.run(['node', f'{SB}/{script}'], capture_output=True, text=True, cwd=SB,
                           env=dict(os.environ, SI_REPO=REPO))
        print(r.stdout)
        if r.stderr.strip():
            print('STDERR:', r.stderr[:3000])
        if r.returncode != 0:
            ok = False

    print('\n================ HASIL AKHIR ================')
    print('SEMUA HARNESS LULUS' if ok else 'ADA HARNESS YANG GAGAL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
