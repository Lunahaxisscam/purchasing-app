#!/usr/bin/env python3
"""
BUKTI HARNESS TIDAK TAUTOLOGIS
==============================
Menjalankan harness regresi FN-* terhadap BASELINE SEBELUM PERBAIKAN
(commit 1d364e7) untuk membuktikan temuan memang NYATA: harness harus
MERAH di baseline dan HIJAU setelah perbaikan.

Cara: checkout berkas sumber versi baseline ke sandbox terpisah, lalu
jalankan harness yang sama. Tidak menyentuh worktree (memakai `git show`).

Jalankan: python3 scripts/fn-repro/verify_baseline_red.py
"""
import os
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/fn-review03-baseline'
BASE = '1d364e7'   # HEAD integrasi sebelum perbaikan FN-*

# Berkas yang ADA di baseline (money.js & laborSource.js belum ada).
BASE_FILES = [
    'components/Planning.js',
    'components/Finance.js',
    'components/ProjectFinance.js',
    'lib/constants.js',
]


def main():
    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(os.path.join(SB, 'components'))
    os.makedirs(os.path.join(SB, 'lib'))

    for rel in BASE_FILES:
        blob = subprocess.run(['git', 'show', f'{BASE}:{rel}'], cwd=REPO,
                              capture_output=True, text=True)
        if blob.returncode != 0:
            print(f'GAGAL ambil {BASE}:{rel}')
            return 1
        with open(os.path.join(SB, rel), 'w', encoding='utf-8') as f:
            f.write(blob.stdout)

    # money.js / laborSource.js TIDAK ada di baseline: komponen baseline juga
    # tidak mengimpornya. Buat stub kosong agar harness tetap bisa memuat
    # modulnya untuk uji fungsi murni (uji itu akan merah karena targetBudget70
    # tidak ada -> perilaku lama).
    with open(os.path.join(SB, 'lib', 'money.js'), 'w', encoding='utf-8') as f:
        f.write('// baseline: modul perbaikan belum ada\nexport function targetBudget70(){ return null }\n')
    with open(os.path.join(SB, 'lib', 'laborSource.js'), 'w', encoding='utf-8') as f:
        f.write('// baseline: modul perbaikan belum ada\n'
                "export const WBS_ESTIMATE_LABEL=''\n"
                "export const ACTUAL_WAGE_LABEL=''\n"
                "export const WBS_ESTIMATE_NOTE=''\n"
                "export const ACTUAL_WAGE_NOTE=''\n"
                "export function projectKey(n){ return String(n||'').trim().toLowerCase().replace(/\\s+/g,' ') }\n"
                "export function actualLaborForProject(){ return null }\n")

    with open(os.path.join(SB, 'lib', 'supabaseClient.mjs'), 'w', encoding='utf-8') as f:
        f.write('export const supabase = null\nexport default { supabase }\n')

    os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
    with open(os.path.join(SB, 'package.json'), 'w', encoding='utf-8') as f:
        f.write('{"type":"module"}')

    # Kompilasi: money/laborSource stub tidak perlu SWC (sudah ESM), tapi
    # komponen baseline perlu.
    compile_js = os.path.join(SB, 'compile.mjs')
    with open(compile_js, 'w', encoding='utf-8') as f:
        f.write(COMPILE_JS)
    r = subprocess.run(['node', compile_js], cwd=SB, capture_output=True, text=True)
    if r.returncode != 0:
        print('GAGAL kompilasi baseline:')
        print(r.stdout[-3000:], r.stderr[-3000:])
        return 1

    shutil.copyfile(os.path.join(HERE, 'regression_test.mjs'),
                    os.path.join(SB, 'regression_test.mjs'))
    r = subprocess.run(['node', os.path.join(SB, 'regression_test.mjs'), REPO, SB],
                       cwd=SB, capture_output=True, text=True)
    out = r.stdout
    sys.stdout.write(out)

    red = r.returncode != 0
    print('\n' + '=' * 62)
    if red:
        print('BUKTI OK: harness MERAH di baseline 1d364e7 (temuan nyata,')
        print('bukan asersi kosong). Harness HIJAU setelah perbaikan.')
        return 0
    print('MASALAH: harness HIJAU di baseline — asersi tidak membuktikan apa pun.')
    return 1


COMPILE_JS = r"""
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const SB = process.cwd()
const swc = require('/home/ubuntu/purchasing-app/node_modules/next/dist/build/swc')
for (const rel of ['components/Planning.js','components/Finance.js','components/ProjectFinance.js','lib/constants.js']) {
  const src = path.join(SB, rel)
  const out = src.replace(/\.js$/, '.mjs')
  const code = swc.transformSync(fs.readFileSync(src, 'utf8'), {
    filename: src,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' }
  }).code
  fs.writeFileSync(out, code.replace(/((?:\bfrom\s+|\bimport\s+)['"])(\.[^'"]+)(['"])/g,
    (m, a, spec, c) => `${a}${spec.replace(/\.js$/, '')}.mjs${c}`))
}
// stub money/laborSource juga diberi nama .mjs
for (const rel of ['lib/money.js','lib/laborSource.js']) {
  fs.copyFileSync(path.join(SB, rel), path.join(SB, rel.replace(/\.js$/, '.mjs')))
}
console.log('kompilasi baseline selesai')
"""


if __name__ == '__main__':
    sys.exit(main())
