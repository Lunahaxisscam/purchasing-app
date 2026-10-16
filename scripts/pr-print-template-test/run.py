#!/usr/bin/env python3
"""
HARNESS VERIFIKASI TOMBOL TEMPLATE PENGADAAN (bamboo-tech) — task t_bb0929f6
============================================================================
Tujuan: membuktikan di DOM hasil render NYATA (React SSR + jsdom) bahwa:
  A) Halaman Purchase Request: link "Template Pengadaan" ada di toolbar-actions
     (href /print/form-pengadaan-lapangan-template.pdf, target _blank, <a> bukan
     <button> — tidak ada submit/trigger PR), search + Tambah PR tetap ada.
  B) Modul lain (vendors/materials): link TIDAK muncul (scope benar).

Cara kerja (tanpa menyentuh DB, tanpa menyentuh runtime):
  1. Sandbox /tmp/pr-print-verify — salin VERBATIM closure file sumber
     (components/ModuleView.js dsb), mock supabaseClient, transform SWC.
  2. render_test.mjs merender ModuleView.js ASLI (SSR) + assert DOM.

Jalankan dari root repo:  python3 scripts/pr-print-template-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/pr-print-verify'
VT = os.path.join(REPO, 'scripts', 'vendors-toolbar-test')

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

# mock supabase + skrip compile generik: dipakai dari harness vendors-toolbar-test
shutil.copy(os.path.join(VT, 'mock-supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(VT, 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'render_test.mjs'], cwd=SB)
sys.exit(r.returncode)
