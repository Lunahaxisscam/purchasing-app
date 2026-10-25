#!/usr/bin/env python3
"""
HARNESS VERIFIKASI MODUL PURCHASE BARU (t_9109cf5e) — bamboo-tech
==================================================================
Arahan DAT: Purchase murni untuk ADMIN BELANJA KANTOR — dua tab
("Siap Dibeli" & "Riwayat Pembelian") + dialog "Proses Pembelian" per toko,
berhenti sampai barang dibeli. Tidak ada tombol gudang/tukang/retur/refund.

Yang diuji (semua terhadap SUMBER ASLI hasil transform SWC, tanpa DB):

  A. LOGIKA (purchaseLogic.js + lib/purchaseNote.js — verbatim)
     A1 tab Siap Dibeli: hanya item APPROVED/ORDERED yang belum dibeli;
        item yang sudah punya nota DIBELI / qty>0 TIDAK muncul lagi.
     A2 filter per vendor & per proyek benar (tidak mengarang opsi).
     A3 draft form: qty default = qty PR, harga riil SELALU kosong
        (estimasi/acuan hanya pembanding — bukan harga beli).
     A4 subtotal = qty × harga; total nota = material + biaya lain − diskon;
        angka dibulatkan (tanpa desimal liar).
     A5 validasi: vendor wajib, no. nota wajib, tanggal wajib, qty>0,
        harga>0 per item; form tidak valid -> tidak ada payload.
     A6 riwayat: nota DIBELI & nota lama (LEGACY) tampil, cangkang otomatis
        (belum dibeli) TIDAK tampil; total & jumlah item benar.
     A7 catatan nota: penanda [Nominal]/[BiayaLain]/[Diskon]/[Tahap]/
        [BuktiNota]/[BuktiTransfer] dibaca & ditulis balik tanpa tabrakan;
        data lama tanpa penanda tetap aman (teks masuk catatan).
     A8 harga satuan riil dari baris nota ([Harga: n]) terbaca oleh resolver
        acuan Material sebagai HISTORIS (bukan estimasi PR).

  B. SIMPAN (purchaseSave.js + mock DB perekam)
     B1 simpan normal: header nota (vendor, no. nota, tanggal, status DIBELI,
        note terstruktur) + baris barang (qty, [Harga: n]).
     B2 anti dobel: nota toko + nomor yang sama ditolak, tidak ada tulisan.
     B3 cangkang nota dari Approval DIPAKAI ULANG (tidak membuat header baru,
        tidak menduplikasi baris item).
     B4 CHECK constraint menolak status DIBELI -> fallback [Tahap: DIBELI]
        di catatan, nota TETAP tersimpan (bukan gagal senyap).
     B5 barang dibeli -> dokumen Handover DRAFT dibuat otomatis (antrean);
        bila gagal, nota tetap tersimpan + pesan jujur.
     B6 validasi awal: tanpa vendor / tanpa no. nota / tanpa item -> nol tulisan.

  C. UI (page.jsx + purchaseForm.jsx + ModuleView — jsdom INTERAKTIF)
     C1 dua tab ada; tab default "Siap Dibeli"; pindah tab menampilkan riwayat.
     C2 centang beberapa barang -> tombol Proses Pembelian aktif; dialog
        terbuka dengan semua barang terpilih & qty default dari PR.
     C3 ketik qty & harga -> subtotal + total nota terhitung live; NOL tulisan
        ke DB sebelum tombol "Selesaikan Pembelian".
     C4 biaya lain & diskon mempengaruhi total nota (dipisah dari material).
     C5 double submit -> hanya SATU payload header nota.
     C6 TIDAK ADA teks/tombol gudang, tukang, retur, refund di halaman
        Purchase (desktop maupun mobile).
     C7 riwayat: total rupiah + lampiran bukti tampil & bisa dibuka.

Cara kerja: sandbox /tmp/purchase-flow-verify — salin VERBATIM file sumber,
mock supabaseClient perekam, transform SWC, lalu jalankan logic_test.mjs dan
render_test.mjs. Tanpa DB, tanpa jaringan, tanpa menyentuh .next aktif.

Jalankan dari root repo:  python3 scripts/purchase-flow-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/purchase-flow-verify'

REL_FILES = [
    'components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js',
    'lib/constants.js', 'lib/purchaseNote.js'
]
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
shutil.copy(os.path.join(HERE, 'logic_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'logic_test.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'render_test.mjs'], cwd=SB)
sys.exit(r.returncode)
