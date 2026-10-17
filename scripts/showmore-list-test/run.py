#!/usr/bin/env python3
"""
HARNESS VERIFIKASI DAFTAR RINGKAS + SHOW MORE (bit-dev) — arahan DAT t_cf05c96f
==============================================================================
Tujuan: membuktikan di DOM hasil render NYATA (React SSR + jsdom, ModuleView
asli) bahwa daftar modul kini RINGKAS — 10 data pertama + tombol Show More:

  A) Material 335 rows (screenshot DAT): hanya 10 baris ter-render, footer
     Show More ada dengan indikator "Menampilkan 10 dari 335"; klik Show More
     (+10) diuji via jsdom interaktif (React state) -> 20 baris ter-render,
     indikator "Menampilkan 20 dari 335".
  B) Filter/search/sort memakai SELURUH dataset sebelum slice: search yang
     TIDAK menemukan apa pun di 10 baris pertama tetap menemukan item di
     luar batch awal (tab count "Semua (335)" tetap full saat terfilter).
  C) Reset limit ke 10 saat filter berubah (interaktif: klik pill "Semua"
     setelah Show More -> kembali 10 baris; klik sort header -> kembali 10).
  D) Parent-child utuh: PR master-detail (rowSpan) & perluasan Approval
     tidak terpotong di tengah (10 PR PERTAMA utuh, bukan 10 baris fisik).
  E) Empty state tetap tampil; daftar <= 10 TANPA footer Show More; vendor
     tanpa filter juga ringkas; tidak ada data yang hilang dari dataset.

Cara kerja (tanpa DB, tanpa jaringan, tidak menyentuh .next aktif):
  1. Sandbox /tmp/showmore-verify — salin VERBATIM file sumber yang
     dibutuhkan (components/{ModuleView,CreateModal,Common}.js,
     lib/constants.js, seluruh modules/**), mock supabaseClient.
  2. Rewrite specifier import relatif -> .mjs; compile via SWC bawaan Next.
  3. render_test.mjs: SSR renderToStaticMarkup + jsdom interaktif
     (createRoot) untuk klik Show More / filter / sort.

Jalankan dari root repo:  python3 scripts/showmore-list-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/showmore-verify'

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
