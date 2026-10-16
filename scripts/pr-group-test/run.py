#!/usr/bin/env python3
"""
HARNESS VERIFIKASI PENGELOMPOKAN KATEGORI PR & APPROVAL (bit-dev) — t_48f6b336
==============================================================================
Arahan DAT (screenshot PR-007): kelompokkan item barang dalam setiap PR
menurut kategori master material (via pr_items.material_id — BUKAN vendor,
BUKAN tebakan nama/prefix); berlaku juga modul Approval. Judul kategori tampil
SEKALI sebagai pemisah grup; nama item tetap nama saja; material tanpa
kategori masuk "Belum Berkategori"; Total Estimasi TIDAK berubah; Show More
tetap menghitung parent PR; alur approval/nomor/status tidak berubah.

Diuji pada:
  1) UNIT    — helper grouping (modules/requests/view.jsx): multi-kategori,
               satu kategori, missing master/category, ordering stabil,
               subtotal kategori, attachMaterialIds, heading label.
  2) RENDER  — daftar PR desktop & mobile + desktop Approval & panel
               perluasan & mobile Approval: heading grup, qty alignment,
               total estimasi, Show More parent-based, legacy tanpa relasi.

Cara kerja: sandbox /tmp verbatim + mock supabase + SWC + jsdom (pola
scripts/pr-estimator-test). Jalankan dari root repo:
  python3 scripts/pr-group-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/pr-group-verify'

REL_FILES = ['components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js', 'lib/constants.js']
for root, dirs, files in os.walk(os.path.join(REPO, 'modules')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))


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

shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(HERE, 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'unit_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'grid_audit.mjs'), SB)
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
rc = 0
for t in ('unit_test.mjs', 'render_test.mjs'):
    r = subprocess.run(['node', t], cwd=SB)
    rc = rc or r.returncode
sys.exit(rc)
