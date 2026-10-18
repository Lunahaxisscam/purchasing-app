#!/usr/bin/env python3
"""
REGRESI CAPABILITY APPROVAL PER-ITEM (t_7634fa92, pra-review)
=============================================================
Konteks temuan (ditemukan saat port 8148465 ke baseline integrasi):

  Commit 8148465 memindahkan panel perluasan material ("▼ Material (n)" di
  <tbody>) menjadi DRAWER BACA-SAJA. Di branch asalnya, alur "setujui
  material satu per satu" sudah tidak dipakai (PR-nya beda), jadi tidak
  terasa. Di baseline integrasi, aksi itu MASIH ADA di pages/index.js:

    approveItem(prItem)        -> ensureItemInPurchase() + pr_items.status
                                  = 'APPROVED'  (masuk modul Purchase)
    markPrItemOrdered(prItem)  -> ensureItemInPurchase() + status 'ORDERED'

  Setelah port: `expandedApproval` tidak pernah di-set lagi, jadi
  rowExpand() mati, dan kedua callback itu TIDAK BISA dijangkau dari UI.
  Ini regresi kemampuan (bukan kosmetik): pengguna kehilangan jalur
  menyetujui material satu per satu.

Harness ini mengunci perbaikannya:
  1. Tombol "✓ Setujui" per item MUNCUL di drawer saat item PENDING.
  2. Tombol "🛒 Sudah Order" MUNCUL saat item APPROVED & PR APPROVED.
  3. Klik tombol memanggil callback dengan item yang BENAR (payload utuh).
  4. Gerbang izin tidak longgar: PR REJECTED / item ORDERED tidak
     menampilkan tombol aksi.
  5. Drawer tetap tidak menambah keputusan tingkat PR (Setujui/Tolak/Revisi
     PR tetap hanya di baris/kartu daftar).

Jalankan: python3 scripts/approval-item-action-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/approval-item-action'

# Closure modul Approval + dependensi (tanpa DB, tanpa jaringan).
FILES = [
    'components/ModuleView.js',
    'modules/approvals/view.jsx',
    'modules/approvals/detailDrawer.jsx',
    'modules/requests/view.jsx',
    'modules/shared/itemHelpers.js',
    'lib/constants.js',
]

IMPORT_RE = re.compile(r"((?:\bfrom\s+|\bimport\s+)['\"])(\.[^'\"]+)(['\"])")


def resolve(rel_dir, spec):
    for cand in (spec, spec + '.js', spec + '.jsx'):
        p = os.path.normpath(os.path.join(rel_dir, cand))
        if os.path.isfile(os.path.join(REPO, p)):
            return p
    return None


def main():
    if os.path.exists(SB):
        shutil.rmtree(SB)

    for rel in FILES:
        src_path = os.path.join(REPO, rel)
        if not os.path.exists(src_path):
            print(f'GAGAL: berkas wajib tidak ada — {rel}')
            return 1
        with open(src_path, encoding='utf-8') as f:
            src = f.read()

        def repl(m, rel=rel):
            pre, spec, post = m.group(1), m.group(2), m.group(3)
            resolved = resolve(os.path.dirname(rel), spec)
            if resolved is None:
                return m.group(0)
            # semua berkas sandbox dinamai .mjs
            target = os.path.splitext(resolved)[0] + '.mjs'
            new_spec = os.path.relpath(target, os.path.dirname(
                os.path.splitext(rel)[0] + '.mjs')).replace(os.sep, '/')
            if not new_spec.startswith('.'):
                new_spec = './' + new_spec
            return f'{pre}{new_spec}{post}'

        src = IMPORT_RE.sub(repl, src)
        out = os.path.join(SB, os.path.splitext(rel)[0] + '.mjs')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'w', encoding='utf-8') as f:
            f.write(src)

    os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
    with open(os.path.join(SB, 'package.json'), 'w', encoding='utf-8') as f:
        f.write('{ "type": "module" }')

    shutil.copy(os.path.join(HERE, 'compile_sandbox.mjs'), SB)
    shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)

    r = subprocess.run(['node', 'compile_sandbox.mjs', REPO], cwd=SB,
                       capture_output=True, text=True)
    if r.returncode != 0:
        print('GAGAL kompilasi:')
        print(r.stdout[-3000:], r.stderr[-3000:])
        return 1

    r = subprocess.run(['node', 'render_test.mjs', REPO], cwd=SB)
    return r.returncode


if __name__ == '__main__':
    sys.exit(main())
