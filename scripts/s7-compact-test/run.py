#!/usr/bin/env python3
"""
HARNESS VERIFIKASI S7 — AUDIT RESPONSIF / COMPACT MODUL (bit-dev, t_2b64c71a)
===============================================================================
Tujuan: membuktikan pada eksekusi NYATA (Node + jsdom, React asli) bahwa setiap
modul yang punya kartu mobile (`mobileCard`) memenuhi kontrak compact/mobile:

  A) LENGKAP: setiap modul yang terekspos `mobileCard` benar-benar punya satu
     (tidak ada modul setengah jadi yang jatuh ke kartu generik shell).
  B) STRUKTUR KARTU: setiap kartu memakai kontrak kelas bersama —
     mobile-card-header / mobile-card-body / mobile-card-title — supaya gaya
     mobile dari globals.css benar-benar berlaku.
  C) KELAS TERPAKAI: tidak ada kelas `mobile-*` yang dipakai JSX tapi tidak
     pernah didefinisikan di styles/globals.css (kelas hantu = kartu tanpa gaya).
  D) TOUCH TARGET: tombol aksi di kartu mobile punya min-height nyata (>=32px)
     dan tidak memakai font-size di bawah 11px.
  E) NILAI JUJUR: kartu tidak menampilkan "NaN"/"undefined"/"Rp 0" untuk data
     yang tidak dikirim — memakai label jujur ("—", "Tidak tersedia", dst).
  F) LEBAR: tidak ada elemen dengan lebar paksa inline >=100px di kartu mobile.
  G) CSS TIDAK BOCOR: styles/globals.css tidak punya duplikat blok identik
     (non-media), dan blok @media responsif masih utuh.

Cara kerja (sama seperti harness crm-test/rap-compare-test/marketing-test):
  1. Hitung closure transitif otomatis dari modul target (tanpa daftar manual).
  2. Salin VERBATIM closure modul + lib + komponen ke /tmp/s7-compact,
     rewrite specifier relatif -> .mjs.
  3. compile_sandbox.mjs : transform esbuild -> dist/.
  4. compact_test.mjs    : uji kontrak di atas dengan jsdom interaktif.

Jalankan dari root repo:  python3 scripts/s7-compact-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/s7-compact'

# Modul target S7: semua view yang mengekspor mobileCard.
ENTRY = [
    'modules/projects/view.jsx',
    'modules/vendors/view.jsx',
    'modules/requests/view.jsx',
    'modules/approvals/view.jsx',
    'modules/handovers/view.jsx',
    'modules/materials/view.jsx',
    # Dipakai harness (bukan modul) untuk membangun helper item nyata.
    'modules/shared/itemHelpers.js'
]

IMPORT_RE = re.compile(r"((?:\bfrom\s+|\bimport\s+)['\"])(\.[^'\"]+)(['\"])")

# Direktori yang aman diikutkan ke closure (di luar modules/, lib/, components/
# biasanya hanya util/konstanta; hooks tidak ada karena tidak dipakai).
ROOTS = ['modules', 'lib', 'components', 'utils', 'hooks']


def sb_rel(rel):
    """modules/x/view.jsx -> modules/x/view.mjs"""
    base, _ = os.path.splitext(rel)
    return base + '.mjs'


def resolve(rel_dir, spec):
    """Resolusi specifier relatif ala bundler (tanpa ekstensi / .js / .jsx)."""
    for cand in (spec, spec + '.js', spec + '.jsx'):
        p = os.path.normpath(os.path.join(rel_dir, cand))
        if os.path.isfile(os.path.join(REPO, p)):
            return p.replace(os.sep, '/')
    return None


def closure(entries):
    seen, stack, order = set(), list(entries), []
    while stack:
        rel = stack.pop(0)
        if rel in seen:
            continue
        seen.add(rel)
        order.append(rel)
        src = open(os.path.join(REPO, rel), encoding='utf-8').read()
        for spec in [m[1] for m in IMPORT_RE.findall(src)]:
            tgt = resolve(os.path.dirname(rel), spec)
            if tgt and tgt not in seen:
                stack.append(tgt)
    return order


REL_FILES = closure(ENTRY)
print(f'Closure S7: {len(REL_FILES)} file')
for r in REL_FILES:
    print(f'  - {r}')

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

    src = IMPORT_RE.sub(_repl, src)
    out = os.path.join(SB, sb_rel(rel))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(src)

# react/react-dom milik repo (symlink, tidak di-copy)
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(HERE, 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'compact_test.mjs'), SB)

print(f'\nSandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs', REPO], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'compact_test.mjs', REPO], cwd=SB)
sys.exit(r.returncode)
