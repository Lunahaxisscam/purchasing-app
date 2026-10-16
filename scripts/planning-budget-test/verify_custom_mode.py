#!/usr/bin/env python3
"""
HARNESS VERIFIKASI BUDGET CUSTOM (t_6e6d00b0) — render DOM nyata Planning.js
===========================================================================
Membuktikan panel "Atur persentase anggaran" benar-benar TER-RENDER & BEKERJA:
  1) klik Budget Custom -> 4 field editable terlihat tepat di bawah saklar
  2) revenue 0 -> panel tetap tampil & bisa diatur (pagu nominal pending)
  3) total draft > 100 -> TIDAK diterapkan (pagu pakai snapshot valid terakhir)
  4) nominal valid (<=100) -> pagu ter-update
  5) kembali ke Standar -> patokan fixed 50/25/10/15 pulih
  6) ganti proyek -> tidak ada kebocoran draft antar proyek

Cara kerja (tanpa DB, tanpa menyentuh repo):
  1. Sandbox /tmp/bitdev-custom-verify
  2. Copy VERBATIM: components/Planning.js, lib/constants.js
     Ganti lib/supabaseClient.js dengan mock (data uji disuntik, tanpa jaringan)
  3. Transform JSX via SWC bawaan Next.js (next/dist/build/swc)
  4. Render dengan React + jsdom, simulasi klik/ketik, assert DOM.

Jalankan: python3 scripts/planning-budget-test/verify_custom_mode.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/bitdev-custom-verify'
HERE = os.path.dirname(os.path.abspath(__file__))

if os.path.exists(SB):
    shutil.rmtree(SB)
os.makedirs(f'{SB}/lib')
os.makedirs(f'{SB}/components')

shutil.copy(f'{REPO}/components/Planning.js', f'{SB}/components/Planning.js')
shutil.copy(f'{REPO}/lib/constants.js', f'{SB}/lib/constants.js')
shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), f'{SB}/lib/supabaseClient.js')
os.symlink(f'{REPO}/node_modules', f'{SB}/node_modules')

# Node ESM butuh ekstensi eksplisit pada import relatif hasil kompilasi SWC.
for rel in ['components/Planning.js', 'lib/constants.js']:
    p = f'{SB}/{rel}'
    src = open(p).read()
    out = []
    for l in src.split('\n'):
        m = re.match(r"^(\s*import\s.*from\s+')(\.\.?/[^']+)('.*)$", l)
        if m and not m.group(2).endswith('.js'):
            l = m.group(1) + m.group(2) + '.js' + m.group(3)
        out.append(l)
    open(p, 'w').write('\n'.join(out))

shutil.copy(os.path.join(HERE, 'custom_mode_render_test.mjs'), f'{SB}/custom_mode_render_test.mjs')
open(f'{SB}/package.json', 'w').write('{ "type": "module" }')

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'custom_mode_render_test.mjs'], cwd=SB)
sys.exit(r.returncode)
