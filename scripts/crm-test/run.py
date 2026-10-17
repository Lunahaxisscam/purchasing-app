#!/usr/bin/env python3
"""
HARNESS VERIFIKASI MODUL "CUSTOMER CRM" (bit-dev, t_7253b859)
===============================================================================
Tujuan: membuktikan pada eksekusi NYATA (Node + jsdom, React asli) bahwa
modul Customer CRM JUJUR terhadap data:

  A) HOST TIDAK MENGIRIM CUSTOMER -> panel "belum tersedia", BUKAN daftar
     kosong yang terlihat seperti bug. Tidak ada customer contoh/demo.
  B) HOST MENGIRIM [] -> "Belum ada customer terdata" (kasus lain: benar-benar
     kosong, dan itu dikatakan).
  C) KONTAK KOSONG -> "Tidak tersedia" (bukan sel kosong, bukan "0").
  D) HITUNGAN RELASI INVOICE TIDAK DIKIRIM HOST -> "tidak dikirim", BUKAN 0.
     Kalau host mengirim counts dan nilainya 0, barulah 0 yang ditulis.
  E) TAMBAH CUSTOMER = DRAF MEMORI HALAMAN: label "Draf halaman", hilang saat
     modul ditutup. Tidak ada tabel baru, RPC, migrasi, Supabase, localStorage.
  F) BARIS DARI HOST BACA SAJA: tidak ada tombol ubah/hapus, hanya draf yang
     bisa dihapus dari memori halaman.
  G) SELECTOR (`<CustomerSelector />`) reusable: value terikat customer.id,
     status ready/empty/unavailable mengikuti data yang benar-benar dikirim.
  H) RESPONSIF: 360/390/768/1440 — halaman tidak melebar, tabel scroll sendiri,
     KPI 1/2/4 kolom, touch target, drawer & form tetap terbaca.

Cara kerja (tanpa DB, tanpa jaringan, tidak menyentuh .next aktif):
  1. Sandbox /tmp/crm-verify — salin VERBATIM modules/crm/*, rewrite
     specifier relatif -> .mjs.
  2. compile_sandbox.mjs : transform SWC (sama seperti harness rap-compare).
  3. logic_test.mjs      : uji fungsi murni (readCustomers, mergeCustomers,
                           filterCustomers, summarizeCustomers, customerCapability,
                           customerContact, relationCount/relationText,
                           validateCustomer, findDuplicate, toCsv, ...).
  4. render_test.mjs     : jsdom interaktif (createRoot) — render CrmModule
                           asli, submit form draf, cari, buka drawer, pastikan
                           nol panggilan fetch/XHR/localStorage.
  5. responsive_test.mjs : kontrak responsif di 360/390/768/1440.

Jalankan dari root repo:  python3 scripts/crm-test/run.py

"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/crm-verify'

# Closure import dari modules/crm/{view,selector}.jsx -> logic.js (self-contained).
REL_FILES = [
    'modules/crm/view.jsx',
    'modules/crm/selector.jsx',
    'modules/crm/logic.js'
]


def sb_rel(rel):
    """modules/crm/view.jsx -> modules/crm/view.mjs"""
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
    # selector.jsx di-import sebagai './selector' oleh logic? Tidak: view
    # mengimpor './selector' TANPA ekstensi di beberapa baris. Regex di atas
    # sudah menangani itu, tapi nomor baris bisa berubah — pastikan rewrite
    # juga berlaku untuk import dinamis dan export-from.
    src = re.sub(r"(\bimport\s+['\"])(\.[^'\"]+)(['\"])", _repl, src)
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
r = subprocess.run(['node', 'compile_sandbox.mjs', REPO], cwd=SB)
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
