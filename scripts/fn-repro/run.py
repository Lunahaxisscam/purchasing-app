#!/usr/bin/env python3
"""
HARNESS REGRESI TEMUAN AUDIT REVIEW-03 (FN-EST_LABEL / FN-TARGET70 / FN-PRINTREF)
================================================================================
Tujuan: membuktikan pada EKSEKUSI NYATA bahwa tiga temuan audit Bandeng
(REVIEW-03 bagian 6) benar-benar tertutup — bukan sekadar diubah komentarnya.

  1. FN-EST_LABEL (MEDIUM)
     project_plans.labor_cost = ESTIMASI WBS, bukan upah terbayar.
     - Planning.js  : label kartu Manpower TIDAK lagi "Pengeluaran Riil (WBS)".
     - ProjectFinance.js : kartu upah berlabel "Estimasi Upah WBS", BUKAN
       "Actual Tukang"; aktual tukang_projects ditampilkan terpisah dan
       TIDAK dijumlahkan ke estimasi.
     - Finance.js   : tabel/kartu/dokumen cetak memakai label estimasi WBS;
       tidak ada lagi "Actual Tukang" untuk sumber project_plans.
     - KONTRA ARAH: tukang_projects (AKTUAL) TIDAK boleh dilabeli estimasi.
  2. FN-TARGET70 (LOW)
     Target 70% = rupiah utuh, tanpa pecahan sen, dan angka yang dibandingkan
     (HEMAT/OVER) identik dengan yang ditampilkan/di-snapshot.
  3. FN-PRINTREF (LOW)
     Dokumen cetak closing tidak lagi merujuk baris "(1 − 5)" yang tidak ada;
     rujukan cocok dengan nomor baris yang benar-benar tercetak.

Cara kerja (tanpa DB, tanpa jaringan, tidak menyentuh .next):
  1. Sandbox /tmp/fn-review03 — salin VERBATIM komponen + lib yang relevan.
  2. Kompilasi JSX via SWC bawaan Next (next/dist/build/swc).
  3. Render SSR (react-dom/server) di jsdom, lalu periksa teks DOM nyata.

Jalankan: python3 scripts/fn-repro/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/fn-review03'

FILES = [
    'components/Planning.js',
    'components/Finance.js',
    'components/ProjectFinance.js',
    'lib/constants.js',
    'lib/money.js',
    'lib/laborSource.js',
]

IMPORT_RE = re.compile(r"((?:\bfrom\s+|\bimport\s+)['\"])(\.[^'\"]+)(['\"])")


def rewrite_specifiers(src):
    """Spesifier relatif hasil kompilasi SWC -> path ber-ekstensi .mjs nyata."""
    def sub(m):
        spec = m.group(2)
        base = os.path.basename(spec)
        return f"{m.group(1)}./{base}.mjs{m.group(3)}"
    return IMPORT_RE.sub(sub, src)


def main():
    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(os.path.join(SB, 'components'))
    os.makedirs(os.path.join(SB, 'lib'))

    for rel in FILES:
        src_path = os.path.join(REPO, rel)
        if not os.path.exists(src_path):
            print(f'GAGAL: berkas wajib tidak ada — {rel}')
            return 1
        with open(src_path, encoding='utf-8') as f:
            src = f.read()
        # Disalin VERBATIM dengan nama aslinya; kompilasi SWC menulis .mjs.
        out_path = os.path.join(SB, rel)
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(src)
    # mock supabaseClient (tanpa jaringan) — komponen hanya butuh objeknya ada.
    # Nama .mjs karena spesifier relatif hasil kompilasi di-rewrite ke
    # './supabaseClient.mjs'.
    with open(os.path.join(SB, 'lib', 'supabaseClient.mjs'), 'w', encoding='utf-8') as f:
        f.write('export const supabase = null\nexport default { supabase }\n')

    compile_script = os.path.join(SB, 'compile.mjs')
    with open(compile_script, 'w', encoding='utf-8') as f:
        f.write(COMPILE_JS)

    # Sandbox butuh node_modules + package.json sendiri supaya `import 'react'`
    # resolve ke dependensi repo (bukan ke /tmp). Symlink, bukan salinan —
    # tidak ada node_modules yang masuk repo.
    os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
    with open(os.path.join(SB, 'package.json'), 'w', encoding='utf-8') as f:
        f.write('{"type":"module"}')

    # Harness uji disalin ke sandbox supaya impor relatifnya konsisten.
    shutil.copyfile(os.path.join(HERE, 'regression_test.mjs'),
                    os.path.join(SB, 'regression_test.mjs'))

    r = subprocess.run(['node', compile_script], cwd=SB, capture_output=True, text=True)
    if r.returncode != 0:
        print('GAGAL kompilasi SWC:')
        print(r.stdout[-4000:])
        print(r.stderr[-4000:])
        return 1

    r = subprocess.run(['node', os.path.join(SB, 'regression_test.mjs'), REPO, SB],
                       cwd=SB, capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    if r.stderr.strip():
        sys.stderr.write(r.stderr[-4000:])
    if r.returncode != 0:
        print('\nHARNESS GAGAL (exit != 0)')
        return 1
    print('\nSEMUA TEMUAN REVIEW-03 TERTUTUP (harness exit 0)')
    return 0


COMPILE_JS = r"""
// Kompilasi JSX -> ESM lewat SWC bawaan Next, lalu rapikan spesifier relatif.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const repo = process.argv[2] || path.dirname(path.dirname(SB))
const swc = require(path.join('/home/ubuntu/purchasing-app/node_modules/next/dist/build/swc'))

const targets = [
  'components/Planning.js',
  'components/Finance.js',
  'components/ProjectFinance.js',
  'lib/constants.js',
  'lib/money.js',
  'lib/laborSource.js'
]
for (const rel of targets) {
  const src = path.join(SB, rel)
  const out = src.replace(/\.js$/, '.mjs')
  const code = swc.transformSync(fs.readFileSync(src, 'utf8'), {
    filename: src,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' }
  }).code
  const rewritten = code.replace(/((?:\bfrom\s+|\bimport\s+)['"])(\.[^'"]+)(['"])/g,
    (m, a, spec, c) => `${a}${spec.replace(/\.js$/, '')}.mjs${c}`)
  fs.writeFileSync(out, rewritten)
}
console.log('kompilasi selesai')
"""


if __name__ == '__main__':
    sys.exit(main())
