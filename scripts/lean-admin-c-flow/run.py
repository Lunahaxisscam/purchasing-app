#!/usr/bin/env python3
"""
HARNESS ALUR ADMIN LEAN END-TO-END (Tahap C) — task t_c720bd7c
==============================================================
Membuktikan alur lengkap admin sebagai RANTAI (bukan modul tunggal):

  S1  Form/template → submit lean (TANPA approval_steps/receivings baru)
  S2  Klik ganda → idempoten (0 write tambahan)
  S3  Kebutuhan lean muncul di "Siap Dibeli"; legacy tanpa penanda tidak
  S4  Nota lintas proyek (2 lean + 1 direct + satu SKU split) → header
      project_id NULL, alokasi readback per proyek dari BARIS item
  S5  Tutup sisa (penanda saja, qty asli preserved)
  S6  Readback realisasi (fulfillment): DIBELI menghitung, RETUR tidak
  S7  Antrean Handover: 1 DRAFT per nota
  S8  Anti nota ganda lewat dua kanal + boundary reusable (BakpauWA)
  S9  Kegagalan parsial jujur (item insert gagal → partial, bukan sukses palsu)
  S10 Pembelian sebagian → SEBAGIAN (bukan dipaksa selesai)

Cara kerja: sandbox /tmp/lean-admin-c-flow — file VERBATIM modul, transform
SWC Next.js, mock Supabase perekam (dipinjam dari purchase-flow-test).

BUKTI UNIT (mock) — BUKAN bukti schema/live E2E; label laporan mencantumkan.

Jalankan dari root repo:  python3 scripts/lean-admin-c-flow/run.py
"""
import json
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/lean-admin-c-flow'

# rel path TANPA ekstensi
REL_FILES = [
    'lib/money', 'lib/purchaseNote', 'lib/constants',
    'modules/receivings/purchaseSave',
    'modules/receivings/purchaseLogic',
    'modules/requests/submitLean',
    'modules/requests/leanRequest',
    'modules/requests/fulfillment',
    'modules/requests/suggest',
    'modules/requests/estimator',
    'modules/materials/acuan',
]


def find_source(rel):
    """Cari file sumber REPO untuk rel path (dengan/atau tanpa ekstensi)."""
    for ext in ('.js', '.jsx', '.mjs'):
        p = os.path.join(REPO, rel + ext)
        if os.path.isfile(p):
            return p, ext
    return None, None


def sb_rel(rel):
    """Path sandbox untuk rel (tanpa ekstensi) — selalu .mjs."""
    return rel + '.mjs'


def rewrite_imports(rel, src):
    """Rewrite relative imports ke .mjs sandbox; CSS jadi stub Proxy."""

    def _repl(m):
        pre, spec, post = m.group(1), m.group(2), m.group(3)
        if spec.endswith('.css'):
            stub = os.path.join(SB, os.path.normpath(
                os.path.join(os.path.dirname(sb_rel(rel)), spec + '.mjs')))
            os.makedirs(os.path.dirname(stub), exist_ok=True)
            with open(stub, 'w', encoding='utf-8') as fh:
                fh.write('export default new Proxy({}, { get: () => "" });\n')
            return f"{pre}{spec}.mjs{post}"
        if spec.startswith('.'):
            rel_dir = os.path.dirname(rel)
            resolved = None
            resolved_ext = None
            for cand in (spec, spec + '.js', spec + '.jsx', spec + '.mjs'):
                p = os.path.normpath(os.path.join(rel_dir, cand))
                if os.path.isfile(os.path.join(REPO, p)):
                    resolved = os.path.normpath(p)
                    resolved_ext = '.js' if cand != spec else (".mjs" if cand.endswith('.mjs') else (".js" if cand.endswith('.js') else ".jsx"))
                    break
            if resolved is None:
                print(f'  (WARNING) import tak ter-resolve di {rel}: {spec}')
                return m.group(0)
            base = resolved[:-len(resolved_ext)] if resolved_ext else resolved
            target = sb_rel(base)
            new_spec = os.path.relpath(target, os.path.dirname(sb_rel(rel))).replace(os.sep, '/')
            if not new_spec.startswith('.'):
                new_spec = './' + new_spec
            return f'{pre}{new_spec}{post}'
        return m.group(0)

    return re.sub(r"(\bfrom\s+['\"])(\.[^'\"]+)(['\"])", _repl, src)


def build_sandbox():
    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(SB, exist_ok=True)

    srcjs_map = {}  # rel (no ext) -> ekstensi asli
    for rel in REL_FILES:
        src_path, ext = find_source(rel)
        if src_path is None:
            print(f'  (WARNING) sumber tidak ada: {rel}')
            continue
        srcjs_map[rel] = ext
        src = open(src_path, encoding='utf-8').read()
        out = os.path.join(SB, sb_rel(rel))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'w', encoding='utf-8') as fh:
            fh.write(rewrite_imports(rel, src))

    # supabase client asli DIGANTI mock perekam (fitur-fitur dari purchase-flow-test)
    mock_src = open(os.path.join(REPO, 'scripts', 'purchase-flow-test', 'mock-supabaseClient.mjs'), encoding='utf-8').read()
    # PATCH: .single()/.maybeSingle() harus mengembalikan OBJEK, bukan array —
    # kontrak Supabase asli. Mock purchase-flow hanya pernah dipakai savePurchase
    # yang tidak memakai .single(); submitLean memakai .single() untuk readback.
    mock_src = mock_src.replace(
        "single() { return Promise.resolve(terminal(st)) },",
        "single() { return Promise.resolve(terminal(st)).then(r => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })) },",
    ).replace(
        "maybeSingle() { return Promise.resolve(terminal(st)) },",
        "maybeSingle() { return Promise.resolve(terminal(st)).then(r => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })) },",
    )
    with open(os.path.join(SB, 'lib', 'supabaseClient.mjs'), 'w', encoding='utf-8') as fh:
        fh.write(mock_src)

    # seed.json: dua request lean + item masing-masing (satu material sama lagi di direct)
    seed = {
        'requests': [
            {'id': 'rLeanA', 'pr_number': 'PR-101', 'title': 'Rangka Baroni', 'project_id': 'p1', 'status': 'SUBMITTED', 'notes': 'Catatan asli dari tukang\n[Jalur: LEAN]'},
            {'id': 'rLeanB', 'pr_number': 'PR-102', 'title': 'Finishing Mabes', 'project_id': 'p2', 'status': 'SUBMITTED', 'notes': 'Catatan admin\n[Jalur: LEAN]'}
        ],
        'pr_items': [
            {'id': 'iA', 'pr_id': 'rLeanA', 'item_name': 'Triplek 9mm', 'quantity': 4, 'unit': 'Lembar', 'status': 'PENDING_APPROVAL', 'material_id': 'm1'},
            {'id': 'iB', 'pr_id': 'rLeanB', 'item_name': 'Sekrup 3cm', 'quantity': 5, 'unit': 'Pcs', 'status': 'PENDING_APPROVAL', 'material_id': 'm2'}
        ]
    }
    with open(os.path.join(SB, 'seed.json'), 'w', encoding='utf-8') as fh:
        json.dump(seed, fh, indent=2)

    # node_modules symlink (SWC bawaan Next.js)
    if not os.path.exists(os.path.join(SB, 'node_modules')):
        os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))

    with open(os.path.join(SB, 'package.json'), 'w') as fh:
        fh.write('{ "type": "module" }')

    shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)
    shutil.copy(os.path.join(HERE, 'lean_admin_test.mjs'), SB)


def main():
    build_sandbox()
    print(f'Sandbox: {SB}')
    r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
    if r.returncode:
        sys.exit(r.returncode)
    r = subprocess.run(['node', 'lean_admin_test.mjs'], cwd=SB)
    sys.exit(r.returncode)


if __name__ == '__main__':
    main()
