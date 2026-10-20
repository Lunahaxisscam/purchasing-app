#!/usr/bin/env python3
"""
HARNESS KONEKTOR BAKPAU (t_310dfb07) — Bandeng
==============================================
Menguji KODE YANG SAMA PERSIS dengan yang dipakai Next (bukan salinan yang
bisa menyimpang): file sumber disalin verbatim ke sandbox /tmp/bakpau-verify,
spesifier import ditulis ulang, lalu ditransform SWC. Tidak ada DB, tidak ada
jaringan, tidak ada pesan keluar sungguhan.

Yang diuji:
  A. Gerbang masuk  — tanda tangan Telegram/WA, allowlist identitas, DM-only,
     freshness/anti-replay, bot sender, payload kosong.
  B. Parser bukti   — baris pipe & inline, satuan dikenal/tidak, nominal saja,
     baris tak terbaca TIDAK dibuang, total tertulis vs rincian.
  C. Resolusi master — proyek exact, ambiguitas, konflik kode/code (fail closed),
     vendor unknown, sisa kebutuhan PR + cap alokasi.
  D. Anti-duplikat  — event per kanal, bukti lintas kanal, nota sama isi beda
     (konflik, bukan merge), pembelian berulang sah, regresi 'A-12' vs 'A1-2'.
  E. Alur penuh     — intake Telegram & WA, satu nota campuran PR/direct,
     readback exact, status 'tercatat' hanya setelah readback cocok.
  F. Kegagalan      — simpan gagal (nol tulisan), readback gagal (bukan sukses),
     notifikasi gagal (TIDAK menulis ulang pembelian), ledger tidak ada
     (fail closed).
  G. Notifikasi     — target tepat DAT, WA ditolak, recipient lain ditolak,
     dedup notifikasi, retry terbatas, status draft/gagal tidak mengaku simpan.
  H. Tujuh skenario purchasing (NOVI_BAKPAU_ACCEPTANCE.md).

Jalankan dari root repo:
    python3 scripts/bakpau-connector-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/bakpau-verify'

# File sumber yang disalin VERBATIM ke sandbox (read-only, tidak diubah).
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
    """Cari file nyata untuk sebuah spesifier relatif."""
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
            return m.group(0)  # paket node_modules: biarkan
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

# Klien Supabase DIGANTI mock perekam: sumber lain tetap verbatim.
os.makedirs(os.path.join(SB, 'lib'), exist_ok=True)
shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), os.path.join(SB, SB_MOCK))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')

shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)
for f in ('connector_test.mjs', 'http_test.mjs', 'fixtures.mjs'):
    shutil.copy(os.path.join(HERE, f), SB)

print(f'Sandbox: {SB}')
print(f'File sumber verbatim: {len(REL_FILES)}')

r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)

failed = False
for test in ('connector_test.mjs', 'http_test.mjs'):
    print(f'\n=== {test} ===')
    r = subprocess.run(['node', test], cwd=SB)
    if r.returncode:
        failed = True

sys.exit(1 if failed else 0)
