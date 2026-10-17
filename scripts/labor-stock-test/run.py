#!/usr/bin/env python3

"""
HARNESS VERIFIKASI MODUL "ACTUAL LABOR & STOK" (bit-dev) — t_62e41e91
==============================================================================
Tujuan: membuktikan pada eksekusi NYATA (Node + esbuild + jsdom, React asli)
bahwa modul Actual Labor & Stok jujur soal ESTIMASI vs AKTUAL:

  A) ESTIMASI TIDAK PERNAH tertulis sebagai AKTUAL, dan AKTUAL tidak pernah
     dirampas dari estimasi. project_plans.labor_cost = rencana; tukang_
     projects.total_upah = tercatat. Keduanya tidak dijumlahkan.
  B) SUMBER TIDAK DIKIRIM = panel "belum tersedia", BUKAN daftar kosong,
     BUKAN angka 0 (0 terbaca "aktual nol rupiah").
  C) NILAI TIDAK ADA di baris = "Tidak tersedia", BUKAN 0. Selisih hanya
     dihitung bila KEDUA angka ada.
  D) STATUS KELENGKAPAN per project: LENGKAP / AKTUAL_SAJA / ESTIMASI_SAJA /
     KOSONG — bukan state karangan.
  E) FILTER project, periode (batch), pencarian; CSV hanya baris & kolom yang
     tampil, nilai kosong -> string kosong, BUKAN 0.
  F) WORKSHOP STOCK memakai kembali modules/stock/logic.js (aturan "bukan 0"
     konsisten dengan modul Stok Workshop).
  G) READ-ONLY: tidak ada .insert/.update/.delete/.rpc di modul ini; tidak
     ada tabel DB baru, tidak ada migrasi, formula finance tidak disentuh.

Cara kerja (tanpa DB, tanpa jaringan, tidak menyentuh .next aktif):
  1. Sandbox /tmp/labor-stock-verify — salin VERBATIM modul + modules/stock,
     mock supabaseClient.
  2. Rewrite specifier import relatif -> .mjs; transpile via esbuild.
  3. logic_test.mjs  : fungsi murni (capability, toNumberOrNull, aktual vs
                       estimasi, status kelengkapan, filter, CSV).
  4. render_test.mjs : jsdom interaktif (createRoot) — render LaborStockModule
                       asli: panel unavailable, label "Tidak tersedia", bukan 0.
  5. responsive_test.mjs: 360/390/768/1440 + kontrak CSS no-overflow.

Jalankan dari root repo:  python3 scripts/labor-stock-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/labor-stock-verify'

# Closure import: view.jsx -> logic.js (modul ini) dan view.jsx ->
# ../stock/logic.js (dipakai ulang untuk bagian Workshop Stock).
REL_FILES = [
    'modules/labor-stock/view.jsx',
    'modules/labor-stock/logic.js',
    'modules/stock/logic.js'
]


def sb_rel(rel):
    """modules/labor-stock/view.jsx -> modules/labor-stock/view.mjs"""
    base, _ = os.path.splitext(rel)
    return base + '.mjs'


def resolve(rel_dir, spec):
    """Resolusi specifier relatif ala bundler (tanpa ekstensi / .js / .jsx)."""
    for cand in (spec, spec + '.js', spec + '.jsx'):
        p = os.path.normpath(os.path.join(rel_dir, cand))
        if os.path.isfile(os.path.join(REPO, p)):
            return p
    return None


if os.path.exists(SB):
    shutil.rmtree(SB)

for rel in REL_FILES:
    src = open(os.path.join(REPO, rel), encoding='utf-8').read()

    def _repl(m):
        pre, spec, post = m.group(1), m.group(2), m.group(3)
        resolved = resolve(os.path.dirname(rel), spec)
        if resolved is None:
            return m.group(0)
        target = sb_rel(resolved)
        new_spec = os.path.relpath(target, os.path.dirname(sb_rel(rel))).replace(os.sep, '/')
        if not new_spec.startswith('.'):
            new_spec = './' + new_spec
        return f'{pre}{new_spec}{post}'

    src = re.sub(r"(\bfrom\s+['\"])(\.[^'\"]+)(['\"])", _repl, src)
    out = os.path.join(SB, sb_rel(rel))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(src)

# react/react-dom milik repo (symlink, tidak di-copy)
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
for f in ('compile_sandbox.mjs', 'logic_test.mjs', 'render_test.mjs', 'responsive_test.mjs'):
    shutil.copy(os.path.join(HERE, f), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
for step in ('logic_test.mjs', 'render_test.mjs', 'responsive_test.mjs'):
    r = subprocess.run(['node', step, REPO], cwd=SB)
    if r.returncode:
        sys.exit(r.returncode)
sys.exit(0)
