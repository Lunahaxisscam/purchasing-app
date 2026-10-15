#!/usr/bin/env python3
"""
HARNESS VERIFIKASI PANEL 4-PILAR (bit-dev) — render DOM nyata Planning.js
========================================================================
Tujuan: membuktikan panel Kontrol Anggaran 4-Pilar + deteksi anomali benar-benar
TER-RENDER di DOM (bukan hanya cek identifier statis), untuk 3 kondisi:
  1) Revenue belum diset (fallback aman, tidak ada NaN)
  2) Proyek sehat (semua pilar on-track, 0 anomali)
  3) Multi-pos anomali (4 anomali tampil, banner + kartu merah + rekomendasi)

Cara kerja (tanpa menyentuh DB, tanpa menyentuh repo):
  1. Sandbox /tmp/bitdev-panel-verify
  2. Copy VERBATIM: components/Planning.js, lib/constants.js
     Ganti lib/supabaseClient.js dengan mock (data uji disuntik, tanpa jaringan)
  3. Transform JSX via SWC bawaan Next.js (next/dist/build/swc)
  4. Render dengan react-dom/server (SSR) di dalam jsdom (untuk window.confirm dll)
  5. Assert isi HTML: nominal, badge, banner anomali, teks rekomendasi.

Jalankan: python3 scripts/planning-budget-test/verify_panel_render.py
"""
import os, re, shutil, subprocess, sys, json

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/bitdev-panel-verify'
HERE = os.path.dirname(os.path.abspath(__file__))

if os.path.exists(SB):
    shutil.rmtree(SB)
os.makedirs(f'{SB}/lib')
os.makedirs(f'{SB}/components')

shutil.copy(f'{REPO}/components/Planning.js', f'{SB}/components/Planning.js')
shutil.copy(f'{REPO}/lib/constants.js', f'{SB}/lib/constants.js')
shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), f'{SB}/lib/supabaseClient.js')

# node_modules: pakai react/react-dom milik repo + jsdom global (symlink, tidak di-copy)
os.symlink(f'{REPO}/node_modules', f'{SB}/node_modules')

# Node ESM butuh ekstensi eksplisit pada import relatif
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

shutil.copy(os.path.join(HERE, 'panel_render_test.mjs'), f'{SB}/panel_render_test.mjs')
open(f'{SB}/package.json', 'w').write('{ "type": "module" }')

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'panel_render_test.mjs'], cwd=SB)
sys.exit(r.returncode)
