#!/usr/bin/env python3
"""
HARNESS REGRESI ANTREAN APPROVAL (bit-dev) — arahan DAT t_0a35264f
==================================================================
Tujuan: membuktikan perilaku filter antrean Approval pada render NYATA
(React client-side di jsdom, sehingga state + event bisa diuji):

  A) DEFAULT ANTREAN: masuk modul Approval -> tab "⏳ Menunggu" posisi PERTAMA,
     aktif; hanya baris PENDING tampil (riwayat APPROVED tidak bocor ke default);
     counter "{n} data tersedia" konsisten dengan baris tampil.
  B) ZERO PENDING: tidak ada PENDING -> empty state Tegas
     "Tidak ada pengajuan yang perlu disetujui." — TIDAK fallback ke APPROVED.
  C) TAB RIWAYAT: Disetujui/Revisi/Ditolak/Semua tetap bisa dibuka eksplisit,
     hitungan tab konsisten, data riwayat utuh (tidak ada data terhapus).
  D) MASUK ULANG MODUL: pindah modul lain lalu masuk Approval lagi ->
     antrean RESET ke Menunggu meski sebelumnya user memilih tab lain.
  E) PERBARUI (refresh) MEMPERTAHANKAN filter aktif: re-render dengan data baru
     TIDAK mengganti tab yang sedang dipilih user (baris baru ikut tampil).
  F) KEPUTUSAN KELUAR DARI ANTREAN: baris PENDING yang statusnya jadi
     APPROVED/REVISI/REJECTED menghilang dari antrean Menunggu dan hitungan tab
     berubah konsisten (keputusan disimulasikan lewat prop rows — pola sama
     dengan loadAll() di pages/index.js).
  G) REGRESI MODUL LAIN: filter default modul lain tidak berubah
     (requests tetap 'all' -> menyembunyikan APPROVED; lainnya tetap semua data),
     dan empty state generik tetap "Belum ada data."

Cara kerja (tanpa DB, tanpa jaringan):
  1. Sandbox /tmp/approval-queue-verify — salin VERBATIM closure sumber
     (components/ModuleView.js + lib/constants.js + seluruh modules/**),
     ganti lib/supabaseClient.js dengan mock.
  2. Rewrite specifier import relatif -> .mjs (kebutuhan Node ESM).
  3. compile_sandbox.mjs mentransform semua file via SWC bawaan Next.js.
  4. render_test.mjs merender ModuleView.js ASLI (client-side, react-dom/client)
     di jsdom + assert DOM & interaksi klik tab.

Jalankan dari root repo:  python3 scripts/approval-queue-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/approval-queue-verify'

# Closure import dari ModuleView.js (shell -> dispatcher -> semua modul)
REL_FILES = ['components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js', 'lib/constants.js']
for root, dirs, files in os.walk(os.path.join(REPO, 'modules')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))


def sb_rel(rel):
    """modules/approvals/view.jsx -> modules/approvals/view.mjs"""
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
# react/react-dom/jsdom milik repo (symlink, tidak di-copy)
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
