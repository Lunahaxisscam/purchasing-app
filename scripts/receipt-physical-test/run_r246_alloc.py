#!/usr/bin/env python3
"""
RUNNER probe run 246 — alokasi per baris TERSIMPAN atau hanya state UI?
=======================================================================
Sandbox TERPISAH (tidak menyentuh .next, tidak menyentuh DB).
Menyalin VERBATIM:
  modules/receivings/purchaseSave.js (+ dependensinya)
  lib/purchaseNote.js, lib/projectCostBreakdown.js, lib/constants.js
lalu transform SWC seperti harness lain, dan menjalankan
probe_r246_alloc_persist.mjs dengan mock supabaseClient perekam.

Jalankan: python3 scripts/receipt-physical-test/run_r246_alloc.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/r246-alloc-verify'

REL_FILES = []
for root, dirs, files in os.walk(os.path.join(REPO, 'lib')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))
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

missing = []
for rel in REL_FILES:
    src_path = os.path.join(REPO, rel)
    if not os.path.isfile(src_path):
        missing.append(rel)
        continue
    src = open(src_path, encoding='utf-8').read()

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

if missing:
    print('file tidak ada (dilewati):', missing)

shutil.copy(os.path.join(HERE, 'mock_purchase_recorder.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'probe_r246_alloc_persist.mjs'), SB)
shutil.copy(os.path.join(HERE, 'probe_r246_retry.mjs'), SB)
shutil.copy(os.path.join(HERE, 'probe_r246_capability.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'probe_r246_alloc_persist.mjs'], cwd=SB)
rc1 = r.returncode
r2 = subprocess.run(['node', 'probe_r246_retry.mjs'], cwd=SB)
rc2 = r2.returncode
r3 = subprocess.run(['node', 'probe_r246_capability.mjs'], cwd=SB)
rc3 = r3.returncode
sys.exit(rc1 or rc2 or rc3)
