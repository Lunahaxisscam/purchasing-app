#!/usr/bin/env python3
"""
HARNESS VERIFIKASI RAP INTERNAL (bamboo-tech) — task t_71d95cfe (S3/7)
======================================================================
Membuktikan alur RAP versi minimum yang diminta kartu, tanpa DB & tanpa
migrasi:

  A. KONVERSI HARGA  — RAB & BOQ menyimpan harga RIBUAN rupiah, RAP rupiah
     penuh; konversi terjadi di SATU tempat; input minus/bukan angka ditolak.
  B. SUMBER ACUAN    — payload RAB & BOQ (v5 + legacy v1) dan WBS Budgeting
     (hanya upah, dinyatakan jujur) jadi baris acuan; payload rusak DITOLAK.
  C. SELISIH         — qty/harga rencana diedit -> total RAP berubah, acuan
     RAB TIDAK ikut berubah, selisih rupiah + persen benar; baris RAB yang
     dihapus tetap terhitung di acuan & muncul sebagai "belum tercakup".
  D. STATUS VERSI    — transisi eksplisit Draft->Diajukan->Disetujui/Ditolak,
     loncat status DITOLAK dengan alasan.
  E. HANDOFF PR      — payload berbentuk kontrak PR existing, nomor PR TIDAK
     dikarang, nol penulisan DB.
  F. KEJUJURAN       — mode DRAFT_ONLY dinyatakan di model, store, dan UI;
     pemulihan JSON tidak mengubahnya jadi "tersimpan".

Cara kerja: sandbox /tmp/rap-verify — salin VERBATIM modules/rap/*, mock
lib/supabaseClient (perekam operasi), transform SWC, jalankan test .mjs.
Tidak menyentuh DB, jaringan, migrasi, atau .next.

Jalankan dari root repo:  python3 scripts/rap-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/rap-verify'

# File sumber yang disalin VERBATIM (hanya modul RAP; shell tidak disentuh).
REL_FILES = [
    'modules/rap/model.js',
    'modules/rap/budgetingBridge.js',
    'modules/rap/store.js',
    'modules/rap/view.jsx',
]


def sb_rel(rel):
    base, _ = os.path.splitext(rel)
    return base + '.mjs'


def resolve(rel_dir, spec):
    for cand in (spec, spec + '.js', spec + '.jsx'):
        p = os.path.normpath(os.path.join(rel_dir, cand))
        if os.path.isfile(os.path.join(REPO, p)):
            return p
    return None


if os.path.exists(SB):
    shutil.rmtree(SB)
os.makedirs(SB)

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

# Mock client (perekam) menggantikan lib/supabaseClient — tidak ada jaringan.
os.makedirs(os.path.join(SB, 'lib'), exist_ok=True)
shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)
for f in ('unit_test.mjs', 'render_test.mjs'):
    shutil.copy(os.path.join(HERE, f), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'unit_test.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'render_test.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
# Wiring/contract test dijalankan LANGSUNG di repo (bukan sandbox): ia memeriksa
# file shell apa adanya, termasuk larangan menulis DB di seluruh modul RAP.
env = dict(os.environ, RAP_REPO=REPO)
sys.exit(subprocess.run(['node', os.path.join(HERE, 'wiring_test.mjs')], cwd=REPO, env=env).returncode)
