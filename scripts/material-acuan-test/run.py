#!/usr/bin/env python3
"""
HARNESS VERIFIKASI ACUAN HARGA EXPANDABLE MATERIAL (bit-dev) — t_090127ad
=========================================================================
Arahan DAT: kolom "Acuan Harga" hilang dari daftar Material; digantikan
rincian expandable di bawah NAMA (+ tombol "+ Acuan Harga" / "▲ Tutup Acuan"),
rincian per vendor: Vendor | Harga per satuan | Tanggal | Sumber.

Diuji pada render NYATA (React + jsdom, ModuleView.js asli, mock supabase —
tanpa DB, tanpa jaringan, tanpa menyentuh .next):

  A) Kolom "Acuan Harga" TIDAK ada di header desktop & kartu mobile.
  B) Default SEMUA baris TERTUTUP: tidak ada tombol toggle, tidak ada
     "Belum ada acuan harga" di awal; footer Show More tetap normal.
  C) Klik "+ Acuan Harga" membuka rincian; tombol berubah "▲ Tutup Acuan";
     expand TIDAK menambah jumlah parent (10 material tetap 10 baris + 1
     expand) dan TIDAK me-reset Show More (indikator tetap "10 dari 335").
  D) Resolver acuan (unit test langsung modules/materials/acuan.js):
     - histori HANYA dari receiving_items qty>0 terlink via pr_item_id;
     - bukan estimasi PR yang belum diterima;
     - bukan produk nama mirip (material beda tidak bocor);
     - bukan [Nominal] nota (harga = estimated_price per satuan);
     - penerimaan RETUR/REFUND tidak masuk histori;
     - satuan beda (per Dus vs per Meter) TIDAK dijadikan histori;
     - harga_acuan existing tampil sbg MASTER tanpa tanggal/vendor palsu;
     - empty state "Belum ada acuan harga".
  E) Prototype "Tambah Acuan": validasi (vendor wajib, harga > 0, satuan
     wajib), entri manual masuk daftar dgn badge "belum tersimpan", dan
     input invalid TIDAK menambah entri.
  F) Data lama: material tanpa histori apapun tetap render aman (rincian
     kosong); regenerasi render 335 baris tidak error.

Cara kerja: pola sama dgn scripts/showmore-list-test — sandbox /tmp diisi
salinan VERBATIM sumber + mock supabaseClient, compile SWC, render jsdom.

Jalankan dari root repo:  python3 scripts/material-acuan-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/material-acuan-verify'

# Closure import dari ModuleView.js + CreateModal.js (shell -> semua modul)
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

shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
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
