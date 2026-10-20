#!/usr/bin/env python3
"""
scripts/hide-labor-marketing-test/run.py — HARNESS HIDE MODULE (t_6a18a263)

Menjalankan uji NYATA terhadap file SUMBER repo (bukan salinan logika):

  1. policy_test.mjs  — kebijakan terpusat: isModuleVisible /
                        isNavModuleDisabled untuk labor_stock & marketing,
                        dan jaminan modul lain TIDAK ikut terpengaruh.
  2. render_test.mjs  — render Sidebar (desktop+mobile) dan Dashboard
                        dengan React nyata di jsdom: menu & kartu
                        "Actual Labor & Stok" dan "Marketing / Lead
                        Pipeline" HILANG; modul lain tetap ada.
  3. guard_test.mjs   — rute/bookmark/state lama ke labor_stock & marketing
                        TIDAK lagi me-render komponen modul (fail closed),
                        dan guard role admin TIDAK melemah: modul admin
                        lain masih menolak non-admin.
  4. data_test.mjs    — jaminan "jangan hapus data": sumber yang menyebut
                        tukang_projects / project_plans / customer TIDAK
                        berubah oleh patch ini (dibandingkan terhadap
                        origin/main lewat git).
  5. authguard_test.mjs — fail-closed: pola auth/guard di pages/index.js
                        TIDAK dilemahkan (hanya tambahan cabang early
                        return yang tidak menyentuh pemeriksaan role).

Sandbox TMPDIR resmi (bukan /tmp global): file VERBATIM repo, transform
SWC Next.js, mock supabase perekam. TIDAK ada koneksi DB/jaringan.

Jalankan dari root repo:  python3 scripts/hide-labor-marketing-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = os.path.join(os.environ.get('TMPDIR') or '/tmp', 'hide-labor-marketing-sandbox')

REL_FILES = [
    'components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js',
    'components/Sidebar.js', 'components/Dashboard.js', 'components/CompactRoot.js',
    'lib/constants.js', 'lib/purchaseNote.js', 'lib/money.js', 'lib/workflow.js',
    'lib/telegramAlert.js', 'lib/laborSource.js',
    'pages/index.js',
]
for root, dirs, files in os.walk(os.path.join(REPO, 'modules')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx', '.css')):
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
os.makedirs(SB, exist_ok=True)

missing = []
for rel in REL_FILES:
    src_path = os.path.join(REPO, rel)
    if not os.path.exists(src_path):
        missing.append(rel)
        continue
    if rel.endswith('.css'):
        stub = os.path.join(SB, sb_rel(rel))
        os.makedirs(os.path.dirname(stub), exist_ok=True)
        open(stub, 'w', encoding='utf-8').write('export default new Proxy({}, { get: () => "cm" });\n')
        continue
    src = open(src_path, encoding='utf-8').read()

    def _repl(m, rel=rel):
        pre, spec, post = m.group(1), m.group(2), m.group(3)
        if spec.endswith('.css'):
            css_stub = os.path.join(SB, os.path.normpath(os.path.join(os.path.dirname(sb_rel(rel)), spec + '.mjs')))
            os.makedirs(os.path.dirname(css_stub), exist_ok=True)
            open(css_stub, 'w', encoding='utf-8').write('export default new Proxy({}, { get: () => "cm" });\n')
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

if missing:
    print(f'(info) file tidak ada, dilewati: {", ".join(missing)}')

os.makedirs(os.path.join(SB, 'lib'), exist_ok=True)
open(os.path.join(SB, 'lib', 'supabaseClient.mjs'), 'w', encoding='utf-8').write('export const supabase = null\n')

for script in ['compile_sandbox.mjs', 'policy_test.mjs', 'render_test.mjs', 'guard_test.mjs', 'data_test.mjs', 'authguard_test.mjs']:
    shutil.copy(os.path.join(HERE, script), os.path.join(SB, script))

os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)

results = []
for script, label in [
    ('policy_test.mjs', '1. KEBIJAKAN TERPUSAT'),
    ('render_test.mjs', '2. RENDER UI (SIDEBAR/DASHBOARD)'),
    ('guard_test.mjs', '3. RUTE LAMA FAIL-CLOSED + GUARD ROLE'),
]:
    print(f'\n--- {label} ---')
    results.append(subprocess.run(['node', script], cwd=SB))

# Uji yang membaca SUMBER REPO (bukan hasil kompilasi) — jalankan di repo.
print('\n--- 4. JANGAN HAPUS DATA (DIBANDINGKAN origin/main) ---')
results.append(subprocess.run(['node', os.path.join(HERE, 'data_test.mjs'), REPO], cwd=REPO))

print('\n--- 5. AUTHGUARD TIDAK MELEMAH ---')
results.append(subprocess.run(['node', os.path.join(HERE, 'authguard_test.mjs'), REPO], cwd=REPO))

if any(r.returncode != 0 for r in results):
    print('\n[STATUS: RED] Ada pengujian yang gagal.')
    sys.exit(1)

print('\n[STATUS: GREEN] Semua pengujian hide module lulus.')
sys.exit(0)
