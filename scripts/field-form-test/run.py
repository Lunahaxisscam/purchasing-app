#!/usr/bin/env python3
"""
HARNESS UJI FORM LAPANGAN INTERAKTIF -> PR EXISTING (t_9b823724)
===============================================================
Menguji Form Lapangan interaktif dari template PDF ke Draft PR:
1. Logic test: template mapping, unique row IDs, matcher, alias/mismatch, touched/empty, decimals, notes, estimator.
2. Save integration test: seed PR dialirkan ke save boundary existing -> DRAFT PR + PENDING_APPROVAL pr_items.
3. Render test: entry button di ModuleView, FieldFormComponent 4 kelompok, mode switch di CreateModal.
4. Viewport test: responsif di 7 viewport COMMON (360, 390, 412, 768, 1024, 1280, 1440) tanpa horizontal overflow.
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/field-form-sandbox'

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
os.makedirs(os.path.join(SB, 'lib'), exist_ok=True)
shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
for script in ['mock-supabaseClient.mjs', 'logic_test.mjs', 'save_integration_test.mjs', 'render_test.mjs', 'test_viewports.mjs', 'compile_sandbox.mjs']:
    shutil.copy(os.path.join(HERE, script), os.path.join(SB, script))

os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')

print(f'Sandbox: {SB}\n')
r_swc = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r_swc.returncode:
    sys.exit(r_swc.returncode)

print('\n--- Menjalankan 1. Logic Test ---')
r_logic = subprocess.run(['node', 'logic_test.mjs'], cwd=SB)

print('\n--- Menjalankan 2. Save Integration Test ---')
r_save = subprocess.run(['node', 'save_integration_test.mjs'], cwd=SB)

print('\n--- Menjalankan 3. Render Test ---')
r_render = subprocess.run(['node', 'render_test.mjs'], cwd=SB)

print('\n--- Menjalankan 4. Viewport Test (7 viewports) ---')
r_vp = subprocess.run(['node', 'test_viewports.mjs'], cwd=SB)

if any(r.returncode != 0 for r in [r_logic, r_save, r_render, r_vp]):
    print('\n[STATUS: RED] Pengujian belum lengkap / ada yang gagal (fase TDD sebelum implementasi).')
    sys.exit(1)

print('\n[STATUS: GREEN] Semua pengujian Form Lapangan (logika, simpan, render, viewport) lulus 100%!')
