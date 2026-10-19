#!/usr/bin/env python3
"""Regression harness Fase 2 — jalankan test logika save per modul.

Cara kerja:
1. Membangun sandbox di /tmp/fase2-save-test-sandbox:
   - copy VERBATIM modules/<modul>/save.js + shared/* dari repo
   - ganti lib/supabaseClient.js dengan mock perekam (TIDAK menyentuh DB)
   - tambah ekstensi .js pada import (kebutuhan Node ESM; Next.js tidak butuh)
2. Menjalankan test.mjs di sandbox.

Jalankan dari root repo:  python3 scripts/fase2-save-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/fase2-save-test-sandbox'
MODULES = ['requests', 'materials', 'vendors', 'projects', 'handovers']

if os.path.exists(SB):
    shutil.rmtree(SB)
os.makedirs(f'{SB}/lib')
os.makedirs(f'{SB}/modules/shared')
for m in MODULES:
    os.makedirs(f'{SB}/modules/{m}')

for m in MODULES:
    shutil.copy(f'{REPO}/modules/{m}/save.js', f'{SB}/modules/{m}/save.js')
# t_ac0b39c0: modules/requests/save.js mengimpor ./estimator (resolver acuan
# & kelayakan vendor satu-sumber) — file pendamping ikut disalin. estimator
# sendiri mengimpor resolver modul Material ../materials/acuan.js (satu sumber).
if os.path.isfile(f'{REPO}/modules/requests/estimator.js'):
    shutil.copy(f'{REPO}/modules/requests/estimator.js', f'{SB}/modules/requests/estimator.js')
# t_a5a73034: modules/requests/save.js mengimpor ./leanRequest (penanda jalur
# lean yang harus DIPERTAHANKAN saat edit catatan) — file pendamping disalin
# supaya harness meregresi file NYATA, bukan salinan logika.
if os.path.isfile(f'{REPO}/modules/requests/leanRequest.js'):
    shutil.copy(f'{REPO}/modules/requests/leanRequest.js', f'{SB}/modules/requests/leanRequest.js')
if os.path.isfile(f'{REPO}/modules/materials/acuan.js'):
    os.makedirs(f'{SB}/modules/materials', exist_ok=True)
    shutil.copy(f'{REPO}/modules/materials/acuan.js', f'{SB}/modules/materials/acuan.js')
# t_e626b674: modules/vendors/save.js mengimpor ./categories (parser
# multi-kategori vendor satu-sumber) — file pendamping ikut disalin.
if os.path.isfile(f'{REPO}/modules/vendors/categories.js'):
    shutil.copy(f'{REPO}/modules/vendors/categories.js', f'{SB}/modules/vendors/categories.js')
for f in ['saveHelpers.js', 'saveDispatcher.js']:
    shutil.copy(f'{REPO}/modules/shared/{f}', f'{SB}/modules/shared/{f}')
shutil.copy(f'{REPO}/lib/constants.js', f'{SB}/lib/constants.js')
# t_9109cf5e: modules/materials/acuan.js mengimpor lib/purchaseNote.js (parser
# harga satuan riil nota belanja) — file pendamping ikut disalin.
if os.path.isfile(f'{REPO}/lib/purchaseNote.js'):
    shutil.copy(f'{REPO}/lib/purchaseNote.js', f'{SB}/lib/purchaseNote.js')
shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock-supabaseClient.js'), f'{SB}/lib/supabaseClient.js')
shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test.mjs'), f'{SB}/test.mjs')

# Node ESM butuh ekstensi eksplisit
for root, _, files in os.walk(f'{SB}/modules'):
    for fn in files:
        p = os.path.join(root, fn)
        with open(p) as fh:
            src = fh.read()
        out = []
        for l in src.split('\n'):
            m = re.match(r"^(\s*import\s.*from\s+')(\.\.?/[^']+)('.*)$", l)
            if m and not m.group(2).endswith('.js'):
                l = m.group(1) + m.group(2) + '.js' + m.group(3)
            out.append(l)
        with open(p, 'w') as fh:
            fh.write('\n'.join(out))

with open(f'{SB}/package.json', 'w') as f:
    f.write('{ "type": "module" }')

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'test.mjs'], cwd=SB)
sys.exit(r.returncode)
