#!/usr/bin/env python3
"""
HARNESS VERIFIKASI TOOLBAR VENDOR (bamboo-tech) — feedback DAT
=============================================================
Tujuan: membuktikan di DOM hasil render NYATA (React SSR + jsdom) bahwa:
  A) Halaman Vendor: toolbar BERSIH — tanpa teks "{n} data tersedia", tanpa
     container filter (.filter-tabs / .pill); hanya search bar + tombol
     "+ Tambah Vendor"; seluruh data vendor tetap tampil (tidak terfilter).
  B) Regresi modul lain: halaman Material / Project / Past Project TETAP
     menampilkan counter "data tersedia" + filter pills seperti sebelumnya.

Cara kerja (tanpa menyentuh DB, tanpa menyentuh repo):
  1. Sandbox /tmp/vendors-toolbar-verify — salin VERBATIM file sumber yang
     dibutuhkan (components/{ModuleView,CreateModal,Common}.js, lib/constants.js,
     seluruh modules/**), ganti lib/supabaseClient.js dengan mock (tanpa jaringan).
  2. Rewrite specifier import relatif -> .mjs (kebutuhan Node ESM).
  3. compile_sandbox.mjs mentransform semua file via SWC bawaan Next.js.
  4. render_test.mjs merender components/ModuleView.js ASLI (SSR) + assert DOM.

Jalankan dari root repo:  python3 scripts/vendors-toolbar-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/vendors-toolbar-verify'

# Closure import dari ModuleView.js + CreateModal.js (shell -> dispatcher -> semua modul)
REL_FILES = ['components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js', 'lib/constants.js', 'lib/purchaseNote.js']
for root, dirs, files in os.walk(os.path.join(REPO, 'modules')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))


def sb_rel(rel):
    """modules/vendors/view.jsx -> modules/vendors/view.mjs"""
    base, _ = os.path.splitext(rel)
    return base + '.mjs'


def resolve(rel_dir, spec):
    """Resolusi specifier relatif ala bundler (tanpa ekstensi / .js / .jsx)."""
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

# lib/supabaseClient -> mock (tidak menyentuh DB / jaringan)
shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
# react/react-dom/next milik repo (symlink, tidak di-copy)
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(HERE, 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'render_test.mjs'], cwd=SB)
sys.exit(r.returncode)
