#!/usr/bin/env python3
"""
HARNESS VERIFIKASI ALUR "TERIMA BARANG" (bamboo-tech) — task t_5196b689
=======================================================================
Membuktikan alur penerimaan baru di UI NYATA (React + jsdom interaktif,
ModuleView.js & receiptForm.jsx ASLI hasil transform SWC) plus logika murni
(receiptLogic) dan simpan idempoten (receiptSave dengan mock DB perekam):

  A. LOGIKA (receiptLogic.js — verbatim):
     A1 kuantitas: rusak<=datang, non-negatif, over-receipt diblok (sisa),
        baik = datang-rusak, belum datang dihitung.
     A2 tujuan: split WS/tukang <= baik; tukang wajib nama penerima.
     A3 rusak: opsi nanti/supplier/dibuang; dibuang wajib foto+konfirmasi;
        "kembalikan ke supplier" = MENUNGGU, bukan sudah dikembalikan.
     A4 ringkasan: total tidak menggandakan (rusak tidak masuk baik).
     A5 buildSavePlan: hanya item terisi; prevCum = snapshot kumulatif.
  B. SIMPAN (receiptSave.js + mock CAS):
     B1 sukses: CAS menulis kumulatif baru + tgl terima terisi bila kosong.
     B2 retry/dobel: submit kedua dengan snapshot SAMA ditolak (conflict),
        angka TIDAK bertambah dua kali (idempoten).
     B3 user lain mengubah angka -> konflik, tidak menimpa.
     B4 baris NULL (data lama) tetap bisa diisi dari prevCum 0.
     B5 invalid plan kosong -> error, nol tulisan.
     B6 loadItemsFromPr: nota lama tanpa item -> item PR dimuat qty 0;
        duplikat 23505 dilewati; nota tanpa PR -> pesan jelas.
  C. UI (receiptForm.jsx + ModuleView.js — jsdom interaktif):
     C1 satu tombol "Terima Barang" per baris (desktop+mobile), klik ->
        modal form terbuka dengan semua item.
     C2 TIDAK ADA panel legacy "Langkah 1 — Cek Fisik" / "Lihat X item" /
        tabel cek-fisik inline di desktop MAUPUN mobile.
     C3 input TIDAK menulis DB saat mengetik (nol mutation sampai submit);
        hanya submit tunggal yang memanggil saveReceipt.
     C4 double submit (klik 2x/requestSubmit 2x) -> satu payload tulisan.
     C5 baris invalid (rusak>datang / over-receipt / tujuan>baik / tukang
        tanpa penerima) -> tombol submit disabled + pesan error; nol tulisan.
     C6 dimensi rusak/tujuan -> submit diblok dengan pesan gap skema,
        TIDAK ada tulisan (bukan flow salah, bukan packing ke note).
     C7 kolom daftar Purchase menampilkan ringkasan barang ("N item" + nama).
     C8 old-data: nota tanpa item -> pesan + tombol "Muat item dari PR";
        nota tanpa PR -> pesan hubungi admin; alokasi asing tampil apa adanya.

Cara kerja: sandbox /tmp/receipt-flow-verify — salin VERBATIM file sumber
(ModuleView, CreateModal, Common, lib/constants, seluruh modules/**), mock
supabaseClient perekam, transform SWC, lalu render_test.mjs (jsdom interaktif).
Tanpa DB, tanpa jaringan, tanpa menyentuh .next aktif.

Jalankan dari root repo:  python3 scripts/receipt-flow-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/receipt-flow-verify'

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
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'logic_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'logic_test.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'render_test.mjs'], cwd=SB)
sys.exit(r.returncode)
