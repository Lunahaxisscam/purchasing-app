#!/usr/bin/env python3
"""
HARNESS UJI JALUR LEAN ADMIN (t_a5a73034)
=========================================
Menjalankan acceptance test modul Request jalur lean TANPA approval:
  1. logic_test.mjs        — kontrak penanda, klasifikasi legacy, submit lean
                             (0 approval_steps/0 receivings/0 ubah item),
                             tutup sisa, pemenuhan dari realisasi, autofill.
  2. render_test.mjs       — UI: label status jujur, tombol Kirim (bukan
                             Selesai/Approval), blok saran vendor + estimasi,
                             tombol tutup sisa, dialog alasan.
  3. viewport_test.mjs     — 7 viewport COMMON: tanpa horizontal scroll,
                             input phone >=16px, target sentuh >=44px.

Sandbox menyalin file nyata (bukan salinan logika) ke /tmp, mengompilasi
JSX via SWC Next.js, lalu menjalankan test terhadap hasil kompilasi.
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/lean-admin-sandbox'

REL_FILES = [
    'components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js',
    'lib/constants.js', 'lib/purchaseNote.js', 'lib/money.js'
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
            open(css_stub, 'w', encoding='utf-8').write('export default new Proxy({}, { get: () => "" });\n')
            return f'{pre}{spec}.mjs{post}'
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

# lib/supabaseClient.js stub (test render tidak butuh kredensial)
os.makedirs(os.path.join(SB, 'lib'), exist_ok=True)
open(os.path.join(SB, 'lib', 'supabaseClient.mjs'), 'w', encoding='utf-8').write(
    'export const supabase = null\n'
)

for script in ['compile_sandbox.mjs', 'logic_test.mjs', 'render_test.mjs', 'viewport_test.mjs', 'mock.mjs']:
    shutil.copy(os.path.join(HERE, script), os.path.join(SB, script))

os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')

print(f'Sandbox: {SB}\n')
r_swc = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r_swc.returncode:
    sys.exit(r_swc.returncode)

results = []
print('\n--- 1. Acceptance Test Logika/Kontrak ---')
results.append(subprocess.run(['node', 'logic_test.mjs'], cwd=SB))

print('\n--- 2. Render Test UI ---')
results.append(subprocess.run(['node', 'render_test.mjs'], cwd=SB))

print('\n--- 3. Viewport Test (7 viewport) ---')
results.append(subprocess.run(['node', 'viewport_test.mjs'], cwd=SB))

if any(r.returncode != 0 for r in results):
    print('\n[STATUS: RED] Ada pengujian yang gagal.')
    sys.exit(1)

print('\n[STATUS: GREEN] Semua pengujian jalur lean lulus.')
sys.exit(0)
