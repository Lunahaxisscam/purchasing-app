#!/usr/bin/env python3

"""
HARNESS VERIFIKASI MODUL "STOK WORKSHOP" (bit-dev) — t_02e5f5fd
==============================================================================
Tujuan: membuktikan pada eksekusi NYATA (Node + jsdom, React asli) bahwa modul
Stok Workshop Jujur:

  A) ANGKA STOK HILANG = "Tidak tersedia", BUKAN 0.
     Material tanpa current_stock TIDAK boleh dirender sebagai stok 0.
  B) TIDAK ADA angka stok yang diturunkan dari status PR / header.
     Test memastikan logic.js tidak punya jalan kode yang membaca status
     dokumen (PR/receiving/handover) — diperiksa lewat pemeriksaan statis
     sumber + tidak ada properti status yang terbawa ke kartu.
  C) FILTER kategori & pencarian bekerja; daftar kategori hanya yang ADA
     di data (tidak mengarang pilihan kosong).
  D) KPI jujur: hitungan baris, bukan total stok / nilai persediaan.
  E) CSV: angka kosong diekspor sebagai string kosong, BUKAN 0.
  F) BATASAN DATA tampil di UI (DATA_LIMITATIONS) supaya keterbatasan
     ledger/movement terdokumentasi di tampilan, bukan hanya di kode.
  G) READ-ONLY: tidak ada penulisan DB — diperiksa statis pada sandbox
     (tidak ada .insert/.update/.delete/.rpc di modul stock).

Cara kerja (tanpa DB, tanpa jaringan, tidak menyentuh .next aktif):
  1. Sandbox /tmp/stock-view-verify — salin VERBATIM modules/stock/*,
     mock supabaseClient.
  2. Rewrite specifier import relatif -> .mjs; compile via SWC bawaan Next.
  3. logic_test.mjs  : uji fungsi murni (toNumberOrNull, stockStatus,
                       filterStockRows, summarizeStock, toCsv).
  4. render_test.mjs : jsdom interaktif (createRoot) — render StockModule
                       asli, klik tab kategori, ketik pencarian.

Jalankan dari root repo:  python3 scripts/stock-view-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/stock-view-verify'

# Closure import dari modules/stock/view.jsx -> logic.js (self-contained).
REL_FILES = [
    'modules/stock/view.jsx',
    'modules/stock/logic.js'
]


def sb_rel(rel):
    """modules/stock/view.jsx -> modules/stock/view.mjs"""
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
shutil.copy(os.path.join(HERE, 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'logic_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'logic_test.mjs', REPO], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'render_test.mjs', REPO], cwd=SB)
sys.exit(r.returncode)
