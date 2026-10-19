#!/usr/bin/env python3
"""
HARNESS VERIFIKASI ESTIMATOR HARGA PR (bit-dev) — t_ac0b39c0
============================================================
Arahan DAT: harga acuan otomatis saat item dipilih/ditambahkan (bukan nol
palsu), sumber & vendor referensi & tanggal tampil bila nyata, subtotal per
item + Total Estimasi PR, ganti vendor recalc hanya bila belum manual,
filter kategori + search di area pemilih (irisan), vendor eligible per
kategori kanonik master material, validasi service boundary, snapshot saat
edit (tidak recalc histori), dan label "belum lengkap" utk item tanpa acuan.

Diuji pada:
  1) UNIT — resolver/estimator (modules/requests/estimator.js): pola sama
     dgn material-acuan-test, plus kelayakan vendor & total.
  2) RENDER INTERAKTIF — form PR ASLI (CreateModal.js + requests/form.jsx)
     dgn React+jsdom: tambah item auto-terisi, badge sumber, subtotal,
     Total Estimasi live (tambah/hapus/ubah qty/ubah vendor/override),
     filter kategori × search, vendor eligible-only, dan validasi save.
  3) SAVE BOUNDARY — modules/requests/save.js: tolak qty/harga invalid &
     vendor tidak eligible; terima yang valid (mock supabase).
  4) VIEW — daftar PR (desktop+mobile) & Approval menampilkan subtotal
     snapshot + Total Estimasi; item tanpa harga ≠ 0 (label belum lengkap).

Cara kerja: sandbox /tmp verbatim + mock supabase + SWC + jsdom (pola
scripts/material-acuan-test & fase2-save-test). Jalankan dari root repo:
  python3 scripts/pr-estimator-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/pr-estimator-verify'

REL_FILES = ['components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js', 'lib/constants.js', 'lib/purchaseNote.js']
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
        # CSS module: node ESM tidak bisa memuat .css — stub kelas (FieldForm
        # kini mengimpor field-form.module.css). Tidak ada assertion diubah.
        if spec.endswith('.module.css'):
            stub = os.path.join(SB, os.path.normpath(os.path.join(os.path.dirname(sb_rel(rel)), 'css-stubs', os.path.basename(spec) + '.mjs')))
            os.makedirs(os.path.dirname(stub), exist_ok=True)
            if not os.path.exists(stub):
                open(stub, 'w', encoding='utf-8').write('export default new Proxy({}, { get: () => "" });\n')
            new_spec = './css-stubs/' + os.path.basename(spec) + '.mjs'
            return f'{pre}{new_spec}{post}'
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
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'save_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
rc = 0
for t in ('unit_test.mjs', 'render_test.mjs', 'save_test.mjs'):
    r = subprocess.run(['node', t], cwd=SB)
    rc = rc or r.returncode
sys.exit(rc)
