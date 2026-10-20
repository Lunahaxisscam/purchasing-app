#!/usr/bin/env python3
"""
scripts/approval-off-test/run.py — HARNESS APPROVAL OFF (t_50b783de)
===================================================================
Menjalankan uji NYATA terhadap file sumber (bukan salinan logika):

  1. logic_test.mjs   — kebijakan terpusat, navigasi, handler fail closed,
                        jalur lean request baru, kirim ulang PR REJECTED
                        (ID sama), klik ganda/stale, legacy, reminder.
  2. render_test.mjs  — render Sidebar (desktop+mobile), Dashboard,
                        ModuleView fallback, dan tooltip tombol kirim ulang
                        dengan React nyata di jsdom.
  3. static_test.mjs  — urutan guard: setiap handler approval di
                        pages/index.js WAJIB memanggil approvalGuard SEBELUM
                        operasi DB/RPC apa pun (fail closed terbukti statis).

Sandbox /tmp/approval-off-sandbox: file VERBATIM repo, transform SWC Next.js,
mock supabase perekam. TIDAK ada koneksi DB/jaringan.

Jalankan dari root repo:  python3 scripts/approval-off-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/approval-off-sandbox'

REL_FILES = [
    'components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js',
    'components/Sidebar.js', 'components/Dashboard.js', 'components/CompactRoot.js',
    'components/compact-ops.module.css', 'components/compact-admin.module.css',
    'lib/constants.js', 'lib/purchaseNote.js', 'lib/money.js', 'lib/workflow.js',
    'lib/telegramAlert.js', 'lib/laborSource.js',
    'pages/index.js',
]
for root, dirs, files in os.walk(os.path.join(REPO, 'modules')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx', '.css')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))
for root, dirs, files in os.walk(os.path.join(REPO, 'scripts', 'reminders')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith('.js'):
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
    # File CSS tidak dikompilasi: tulis stub module kosong (kelas apa adanya).
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

# lib/supabaseClient -> stub (tanpa kredensial, tanpa jaringan)
os.makedirs(os.path.join(SB, 'lib'), exist_ok=True)
open(os.path.join(SB, 'lib', 'supabaseClient.mjs'), 'w', encoding='utf-8').write('export const supabase = null\n')

for script in ['compile_sandbox.mjs', 'logic_test.mjs', 'render_test.mjs', 'static_test.mjs', 'mock-supabase.mjs']:
    shutil.copy(os.path.join(HERE, script), os.path.join(SB, script))

os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)

results = []
for script, label in [
    ('logic_test.mjs', '1. LOGIKA & KONTRAK KEBIJAKAN'),
    ('render_test.mjs', '2. RENDER UI (SIDEBAR/DASHBOARD/SHELL)'),
]:
    print(f'\n--- {label} ---')
    results.append(subprocess.run(['node', script], cwd=SB))

# Uji statis membaca SUMBER REPO (bukan hasil kompilasi) — jalankan di repo.
print('\n--- 3. URUTAN GUARD FAIL-CLOSED (STATIS) ---')
results.append(subprocess.run(['node', os.path.join(HERE, 'static_test.mjs'), REPO], cwd=REPO))

if any(r.returncode != 0 for r in results):
    print('\n[STATUS: RED] Ada pengujian yang gagal.')
    sys.exit(1)

print('\n[STATUS: GREEN] Semua pengujian Approval OFF lulus.')
sys.exit(0)
