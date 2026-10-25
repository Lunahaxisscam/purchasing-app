#!/usr/bin/env python3
"""
HARNESS API BAKPAU (t_dd743609) — tes kontrak API read/create
=============================================================
Menguji file sumber YANG SAMA dengan yang dipakai Next: sumber disalin
verbatim ke sandbox TMPDIR, spesifier import ditulis ulang, lalu ditransform
SWC. Tidak ada DB nyata, tidak ada jaringan, tidak ada pesan keluar.

Yang diuji:
  A. Konfigurasi token  — env kosong/rusak fail closed, parse ketat.
  B. Autentikasi        — tanpa/salah/format salah/revoked/scope kurang,
                          dan TIDAK ADA satu pun query DB sebelum ditolak.
  C. Read               — daftar putih resource/kolom/filter, pagination,
                          order, penolakan parameter asing & SQL.
  D. Create             — payload invalid/ambigu ditolak sebelum DB,
                          validasi boundary bersama, idempotensi event+bukti,
                          readback exact, notifikasi gagal tanpa tulis ulang.
  E. Kebocoran          — respons tidak memuat token/key/SQL/stack.

Jalankan dari root repo:
    python3 scripts/bakpau-api-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = os.path.join(os.environ.get('TMPDIR') or '/tmp', 'bakpau-api-verify')

REL_FILES = [
    'lib/purchaseNote.js',
    'modules/receivings/purchaseSave.js',
    'modules/receivings/purchaseLogic.js',
    'modules/requests/leanRequest.js',
]
for f in sorted(os.listdir(os.path.join(REPO, 'lib', 'bakpau'))):
    if f.endswith('.js'):
        REL_FILES.append('lib/bakpau/' + f)

SB_MOCK = 'lib/supabaseClient.mjs'


def sb_rel(rel):
    base, _ = os.path.splitext(rel)
    return base + '.mjs'


def resolve(rel_dir, spec):
    if spec.endswith('.js'):
        cands = [spec, spec[:-3] + '.jsx']
    elif spec.endswith('.jsx'):
        cands = [spec]
    else:
        cands = [spec, spec + '.js', spec + '.jsx', spec + '/index.js']
    for cand in cands:
        p = os.path.normpath(os.path.join(rel_dir, cand))
        if os.path.isfile(os.path.join(REPO, p)):
            return p
    return None


def rewrite(rel, src):
    def _repl(m):
        pre, spec, post = m.group(1), m.group(2), m.group(3)
        if not spec.startswith('.'):
            return m.group(0)
        resolved = resolve(os.path.dirname(rel), spec)
        if resolved is None:
            raise SystemExit(f'IMPORT TIDAK KETEMU: {rel} -> {spec}')
        target = sb_rel(resolved)
        new_spec = os.path.relpath(target, os.path.dirname(sb_rel(rel))).replace(os.sep, '/')
        if not new_spec.startswith('.'):
            new_spec = './' + new_spec
        return f'{pre}{new_spec}{post}'

    return re.sub(r"(\bfrom\s+['\"])(\.[^'\"]+)(['\"])", _repl, src)


if os.path.exists(SB):
    shutil.rmtree(SB)
os.makedirs(SB, exist_ok=True)

for rel in REL_FILES:
    src = open(os.path.join(REPO, rel), encoding='utf-8').read()
    out = os.path.join(SB, sb_rel(rel))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(rewrite(rel, src))

os.makedirs(os.path.join(SB, 'lib'), exist_ok=True)
shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'),
            os.path.join(SB, SB_MOCK))
shutil.copy(os.path.join(HERE, 'api_fixtures.mjs'), os.path.join(SB, 'api_fixtures.mjs'))
shutil.copy(os.path.join(HERE, 'api_test.mjs'), os.path.join(SB, 'api_test.mjs'))
shutil.copy(os.path.join(REPO, 'scripts', 'bakpau-api-client', 'client.mjs'), os.path.join(SB, 'client.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')

shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)

print(f'Sandbox: {SB}')
print(f'File sumber verbatim: {len(REL_FILES)}')

r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)

print('\n=== api_test.mjs ===')
r = subprocess.run(['node', 'api_test.mjs'], cwd=SB)
sys.exit(r.returncode)
