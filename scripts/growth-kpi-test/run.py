#!/usr/bin/env python3
"""
HARNESS AUDIT KPI PERTUMBUHAN + MARGIN LEAKAGE + REPEAT ORDER (t_13fd2d4a)
===========================================================================
S6/7 — bit-dev (Bit, Software Engineer Noir Living)

Apa yang diuji: delapan keluarga metrik pertumbuhan yang diminta DAT, sebagai
FIXTURE + KRITERIA PENERIMAAN yang bisa dieksekusi, terhadap SUMBER ASLI
(modul repo hasil transform SWC, bukan salinan logika):

  F1 CONVERSION  Lead -> Qualified -> Project/RAB -> Invoice -> Lunas
                 (kontrak marketing-crm-project: status, transisi, gerbang)
  F2 TIME-TO-APPROVAL  request.created_at -> approval_steps.decided_at
  F3 MARGIN LEAKAGE  RAB vs RAP vs AKTUAL per baris (rap-compare)
  F4 REPEAT CUSTOMER  pola order berulang + integritas dedup customer
  F5 VENDOR SAVINGS  harga acuan historis vs harga beli terbaru
  F6 STOCK TURNS  kematangan data stok (apakah turns BISA dihitung jujur)
  F7 OVERDUE CASH  piutang jatuh tempo (due_date vs hari H)
  F8 HONESTY GATES  nilai tak diketahui TIDAK boleh jadi 0 / tak boleh
                    disembunyikan; estimasi TIDAK boleh jadi aktual

SEMUA dengan data fixture murni: TANPA DB, TANPA jaringan, TANPA mutasi data
hidup, TANPA kampanye/outbound.

Cara kerja: sandbox /tmp/growth-kpi-verify — salin VERBATIM file sumber
(modules/**, lib/**, scripts/marketing/**), rewrite specifier relatif,
transform SWC, jalankan 4 suite uji.

Jalankan dari root repo:  python3 scripts/growth-kpi-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/growth-kpi-verify'

# --- COMPACT_ADMIN_ADAPTER: dependency CompactRoot (compact UI Admin Suite) ------------
# CompactRoot mengimpor CSS module; Node ESM tidak bisa memuat .css. Helper
# di bawah menulis stub kelas ke sandbox dan mengalihkan specifier CSS
# module ke stub itu. Tidak ada assertion yang diubah.
def _compact_copy_root():
    """Harness yang menyalin file eksplisit: pastikan CompactRoot.js ada."""
    src = os.path.join(REPO, 'components', 'CompactRoot.js')
    dst_dir = os.path.join(SB, 'components')
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, 'CompactRoot.js')
    if not os.path.exists(dst):
        shutil.copy(src, dst)


def _compact_fix_sandbox(sb=None):
    root = sb or SB
    stub = os.path.join(root, 'components', 'compact-admin.stub.mjs')
    os.makedirs(os.path.dirname(stub), exist_ok=True)
    open(stub, 'w', encoding='utf-8').write(
        "export default new Proxy({}, { get: (t, k) => 'cm_' + String(k) })\n"
    )
    pat = re.compile(r"(['\"])[^'\"]*compact-admin\.module(\.css|\.mjs)?\1")
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', 'dist', '.next')]
        for name in filenames:
            if not name.endswith(('.mjs', '.js', '.jsx', '.mts')):
                continue
            p = os.path.join(dirpath, name)
            try:
                src = open(p, encoding='utf-8').read()
            except (OSError, UnicodeDecodeError):
                continue
            if 'compact-admin.module' not in src:
                continue
            rel_stub = os.path.relpath(stub, dirpath).replace(os.sep, '/')
            if not rel_stub.startswith('.'):
                rel_stub = './' + rel_stub
            new = pat.sub(lambda m: m.group(1) + rel_stub + m.group(1), src)
            if new != src:
                open(p, 'w', encoding='utf-8').write(new)
# --- end COMPACT_ADMIN_ADAPTER ---------------------------------------------------------


# Modul yang benar-benar dibutuhkan keluarga metrik S6 (sumber asli).
REL_FILES = [
    'lib/purchaseNote.js',
    'lib/constants.js',
    'modules/materials/acuan.js',
    'modules/requests/estimator.js',
    'modules/rap-compare/logic.js',
    'modules/labor-stock/logic.js',
    'modules/stock/logic.js',
    'modules/crm/logic.js',
    'modules/sales-invoice/contract.js',
    'modules/receivings/purchaseLogic.js',
    'scripts/marketing/contract.js',
    'components/CompactRoot.js'
]


def sb_rel(rel):
    base, _ = os.path.splitext(rel)
    return base + '.mjs'


def resolve(rel_dir, spec):
    for cand in (spec, spec + '.js', spec + '.jsx'):
        p = os.path.normpath(os.path.join(rel_dir, cand))
        if os.path.isfile(os.path.join(REPO, p)):
            return p
    return None


def main():
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

    # node_modules git-ignored di worktree -> pakai yang sama dengan baseline.
    MAIN_REPO = os.environ.get('REPO_MAIN') or subprocess.run(
        ['git', 'worktree', 'list', '--porcelain'], cwd=REPO, capture_output=True, text=True
    ).stdout.split('worktree ')[1].split('\n')[0].strip()
    if not os.path.exists(os.path.join(MAIN_REPO, 'node_modules')):
        print(f'FATAL: node_modules tidak ada di {MAIN_REPO} — jalankan npm install di repo utama dulu.')
        return 1
    os.symlink(os.path.join(MAIN_REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
    open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
    shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)

    TESTS = [
        ('conversion_test.mjs', 'F1. CONVERSION Lead->RAB->Invoice->Lunas + F2. TIME-TO-APPROVAL'),
        ('margin_leakage_test.mjs', 'F3. MARGIN LEAKAGE RAB/RAP/Aktual + F5. VENDOR SAVINGS'),
        ('repeat_stock_cash_test.mjs', 'F4. REPEAT ORDER + F6. STOCK TURNS + F7. OVERDUE CASH'),
        ('honesty_gates_test.mjs', 'F8. GERBANG KEJUJURAN (tak-diketahui != 0)')
    ]
    for t, _ in TESTS:
        shutil.copy(os.path.join(HERE, t), os.path.join(SB, t))

    print(f'Sandbox: {SB}\n')
    _compact_fix_sandbox()
    r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
    if r.returncode:
        return r.returncode

    failed = []
    totals = {}
    for t, label in TESTS:
        print(f'\n===== {label} =====')
        r = subprocess.run(['node', t], cwd=SB)
        if r.returncode:
            failed.append(t)
    print('\n' + '=' * 60)
    if failed:
        print(f'GAGAL: {", ".join(failed)}')
        return 1
    print('SEMUA TEST LULUS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
