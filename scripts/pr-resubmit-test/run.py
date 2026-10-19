#!/usr/bin/env python3
"""
HARNESS UJI SUBMIT / RESUBMIT PR (t_3032ecb7)
============================================
Menguji tombol Submit Ulang pada PR REJECTED dan service boundary submit.
1. Render test: tombol Submit Ulang tampil di desktopRow, rowActions, mobileCard
2. Logic test: cancel0writes, sameID/no preserved, pending approval reuse, doubleclick1request,
   stale/ineligible denied, errors no false success, old rejectionnote preserved,
   ORDERED unchanged, empty invalidqty denied, old DRAFT/REVISI compatible.
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/pr-resubmit-sandbox'

REL_FILES = [
    'components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js',
    'lib/constants.js', 'lib/purchaseNote.js'
]
if os.path.exists(os.path.join(REPO, 'lib/telegramAlert.js')):
    REL_FILES.append('lib/telegramAlert.js')

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
    src_path = os.path.join(REPO, rel)
    if not os.path.exists(src_path):
        continue
    src = open(src_path, encoding='utf-8').read()

    def _repl(m, rel=rel):
        pre, spec, post = m.group(1), m.group(2), m.group(3)
        if spec.endswith('.css'):
            css_stub = os.path.join(SB, os.path.normpath(os.path.join(os.path.dirname(sb_rel(rel)), spec + '.mjs')))
            os.makedirs(os.path.dirname(css_stub), exist_ok=True)
            open(css_stub, 'w', encoding='utf-8').write('export default {};\n')
            new_spec = spec + '.mjs'
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

# Salin script pengujian dan mock client ke dalam sandbox
shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), os.path.join(SB, 'mock-supabaseClient.mjs'))
shutil.copy(os.path.join(HERE, 'render_test.mjs'), os.path.join(SB, 'render_test.mjs'))
shutil.copy(os.path.join(HERE, 'logic_test.mjs'), os.path.join(SB, 'logic_test.mjs'))
shutil.copy(os.path.join(HERE, 'compile_sandbox.mjs'), os.path.join(SB, 'compile_sandbox.mjs'))

os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')

print(f'Sandbox: {SB}\n')
r_swc = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r_swc.returncode:
    sys.exit(r_swc.returncode)

print('\n--- Menjalankan Render Test ---')
r_render = subprocess.run(['node', 'render_test.mjs'], cwd=SB)

print('\n--- Menjalankan Logic Test ---')
r_logic = subprocess.run(['node', 'logic_test.mjs'], cwd=SB)

if r_render.returncode != 0 or r_logic.returncode != 0:
    print('\n[STATUS: RED] Pengujian gagal (diharapkan pada fase TDD sebelum implementasi).')
    sys.exit(1)

print('\n[STATUS: GREEN] Semua pengujian render dan logika lulus 100%!')
sys.exit(0)
