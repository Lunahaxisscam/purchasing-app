#!/usr/bin/env python3


"""
HARNESS VERIFIKASI MODUL "PERBANDINGAN RAB vs RAP vs AKTUAL" (bit-dev)
===============================================================================
Tujuan: membuktikan pada eksekusi NYATA (Node + jsdom, React asli) bahwa
modul perbandingan JUJUR:

  A) TANPA AKTUAL = "Belum ada aktual", BUKAN Rp 0.
     Baris/proyek yang belum punya nota pembelian tidak boleh dirender
     sebagai aktual nol (itu terbaca sebagai "belanja nol rupiah").
  B) PERBANDINGAN memakai nilai dasar baris (qty x harga satuan) — bukan
     grand total quotation yang sudah kena markup/PPN.
  C) SELISIH = RAP - RAB (positif = rencana melebihi acuan), dan "—"
     ketika salah satu sisi belum ada.
  D) DRAFT RAP hidup di memori halaman saja: ganti proyek -> draft reset,
     tidak bocor antar proyek. Tidak ada tabel/RPC/migrasi baru.
  E) COVERAGE eksplisit: baris RAB belum masuk RAP, baris RAP di luar
     acuan, belanja nyata tanpa acuan, baris berencana tanpa aktual.
  F) READ-ONLY: tidak ada tombol simpan/tambah/hapus, tidak ada input
     bebas — diperiksa statis pada komponen ter-render.

Cara kerja (tanpa DB, tanpa jaringan, tidak menyentuh .next aktif):
  1. Sandbox /tmp/rap-compare-verify — salin VERBATIM
     modules/rap-compare/*, rewrite specifier relatif -> .mjs.
  2. compile_sandbox.mjs : transform SWC (sama seperti harness stock).
  3. logic_test.mjs      : uji fungsi murni (toRupiah, toQty, readRabLines,
                           readRapLines, readActualLines, buildComparison,
                           toCsv).
  4. render_test.mjs     : jsdom interaktif (createRoot) — render
                           RapCompareModule asli, klik impor, ganti proyek,
                           status pagu, drawer.
  5. responsive_test.mjs : kontrak responsif di 360/390/768/1440 — halaman
                           tidak melebar, tabel scroll sendiri, KPI 1/2/4
                           kolom, touch target, drawer tetap terbaca.

Jalankan dari root repo:  python3 scripts/rap-compare-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/rap-compare-verify'

# --- COMPACT_ADMIN_ADAPTER: dependency CompactRoot (compact UI Admin Suite) ------------
# CompactRoot mengimpor CSS module; Node ESM tidak bisa memuat .css. Helper
# di bawah menulis stub kelas ke sandbox dan mengalihkan specifier CSS
# module ke stub itu. Tidak ada assertion yang diubah.
def _compact_copy_root():
    """Harness yang menyalin file eksplisit: pastikan CompactRoot.js ada."""
    src = os.path.join(REPO, 'components', 'CompactRoot.js')
    dst_dir = os.path.join(SB, 'components')
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, 'CompactRoot.js')
    if not os.path.exists(dst):
        shutil.copy(src, dst)


def _compact_fix_sandbox(sb=None):
    root = sb or SB
    stub = os.path.join(root, 'components', 'compact-admin.stub.mjs')
    os.makedirs(os.path.dirname(stub), exist_ok=True)
    open(stub, 'w', encoding='utf-8').write(
        "export default new Proxy({}, { get: (t, k) => 'cm_' + String(k) })\n"
    )
    pat = re.compile(r"(['\"])[^'\"]*compact-admin\.module(\.css|\.mjs)?\1")
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', 'dist', '.next')]
        for name in filenames:
            if not name.endswith(('.mjs', '.js', '.jsx', '.mts')):
                continue
            p = os.path.join(dirpath, name)
            try:
                src = open(p, encoding='utf-8').read()
            except (OSError, UnicodeDecodeError):
                continue
            if 'compact-admin.module' not in src:
                continue
            rel_stub = os.path.relpath(stub, dirpath).replace(os.sep, '/')
            if not rel_stub.startswith('.'):
                rel_stub = './' + rel_stub
            new = pat.sub(lambda m: m.group(1) + rel_stub + m.group(1), src)
            if new != src:
                open(p, 'w', encoding='utf-8').write(new)
# --- end COMPACT_ADMIN_ADAPTER ---------------------------------------------------------


# Closure import dari modules/rap-compare/view.jsx -> logic.js (self-contained).
REL_FILES = [
    'modules/rap-compare/view.jsx',
    'modules/rap-compare/logic.js',
    'components/CompactRoot.js'
]


def sb_rel(rel):
    """modules/rap-compare/view.jsx -> modules/rap-compare/view.mjs"""
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
shutil.copy(os.path.join(HERE, 'responsive_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
_compact_fix_sandbox()
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'logic_test.mjs', REPO], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'render_test.mjs', REPO], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'responsive_test.mjs', REPO], cwd=SB)
sys.exit(r.returncode)
