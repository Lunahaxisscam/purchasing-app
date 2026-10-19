#!/usr/bin/env python3
"""
HARNESS VERIFIKASI "PR & PURCHASE DIPADATKAN" (t_cde1b8ad) — bamboo-tech
=======================================================================
Arahan DAT: alur PR & Purchase diringkas TANPA mengubah schema.

  PR   = Project · Judul · Prioritas · Material · Qty · Estimasi
         (vendor/toko AKTUAL pindah ke Purchase; catatan opsional dilipat)
  PURCHASE = Toko · No. Nota · Tanggal · Total · Bukti · Catatan
         (kendala/status nota tidak tampil di UI utama; alokasi fisik = Handover)

Yang diuji (semua terhadap SUMBER ASLI hasil transform SWC, tanpa DB):

  A. PR FORM (modules/requests/form.jsx + CreateModal.jsx asli)
     A1 field utama hanya Project, Judul, Prioritas, Material, Qty, Estimasi —
        TIDAK ada input vendor/kategori di permukaan form (di luar <details>).
     A2 kontrol rencana toko MASIH ADA tapi TERLIPAT (details tanpa `open`) —
        bukti bahwa data lama bisa dilihat/dikoreksi & validasi vendor tidak
        menjadi jalan buntu.
     A3 catatan: textarea ada di dalam <details> dan default TERTUTUP saat
        kosong; TERBUKA otomatis bila PR lama punya catatan (data tidak
        tampak hilang).
     A4 estimasi & total tetap hidup (regresi estimator tidak rusak):
        tambah item → harga acuan terisi, Total Estimasi terhitung.
     A5 tabel item di dalam kontainer ber-overflow sendiri (anti body overflow).

  B. PR SAVE (modules/requests/save.js — service boundary TIDAK berubah)
     B1 payload pr_items tetap memuat vendor_id & supplier_category (nilai
        lama dipertahankan; item tanpa toko = null, BUKAN field hilang).
     B2 gate vendor tidak-eligible masih menolak (kontrak lama utuh).
     B3 notes tetap ditulis (fallback judul) walau UI-nya dilipat.
     B4 edit PR: vendor tersimpan tidak dihapus diam-diam.

  C. PR VIEW (modules/requests/view.jsx)
     C1 kolom vendor berlabel jujur "Rencana Toko" (bukan klaim supplier
        aktual); toko aktual dinyatakan milik modul Purchase.
     C2 daftar PR tetap menampilkan subtotal + Total Estimasi (tidak rusak).

  D. PURCHASE PAGE (modules/receivings/page.jsx)
     D1 tabel "Siap Dibeli" dipadatkan: ≤6 kolom (checkbox + 5 data), kode &
        satuan tetap terbaca di sel Barang, No. PR di sel Proyek.
     D2 tabel "Riwayat" ≤6 kolom; Material & Biaya Lain TIDAK hilang — turun
        jadi baris rincian di bawah Total Nota.
     D3 TIDAK ada teks status nota / kendala (Retur/Refund/Rusak/Status Nota)
        di UI utama.
     D4 tombol "Proses Pembelian" footer hanya muncul saat ada yang dipilih
        (tidak ada tombol primer kembar yang mati).
     D5 alur baca/simpan tetap: centang → dialog → isi → simpan → riwayat.

  E. PURCHASE FORM (modules/receivings/purchaseForm.jsx)
     E1 urutan baca: identitas nota → barang → TOTAL → bukti → catatan.
     E2 Total Nota Riil tampil SEBELUM rincian biaya (angka utama di atas).
     E3 tambahan/potongan (ongkir/diskon) dilipat, default tertutup saat
        kosong; terbuka saat ada nilai — rumus total tidak berubah.
     E4 semua data-testid lama tetap ada (kontrak harness lama dijaga).

  F. TANPA PERUBAHAN SCHEMA / FILE TERLARANG
     F1 tidak ada file migrasi baru/berubah di commit ini.
     F2 file milik modul lain (handovers, materials, vendors) tidak diubah.

Cara kerja: sandbox /tmp/pr-purchase-compact-verify — salin VERBATIM file
sumber, mock supabaseClient perekam, transform SWC, jalankan render_test.mjs
dan save_test.mjs. Tanpa DB, tanpa jaringan, tanpa menyentuh .next aktif.

Jalankan dari root repo:  python3 scripts/pr-purchase-compact-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/pr-purchase-compact-verify'

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
        if spec.endswith('.css'):
            css_stub = os.path.join(SB, os.path.normpath(os.path.join(os.path.dirname(sb_rel(rel)), spec + '.mjs')))
            os.makedirs(os.path.dirname(css_stub), exist_ok=True)
            open(css_stub, 'w', encoding='utf-8').write('export default {};\n')
            new_spec = spec + '.mjs'
            return f'{pre}{new_spec}{post}'
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
shutil.copy(os.path.join(REPO, 'scripts', 'pr-estimator-test', 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'save_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
rc = 0
for t in ('save_test.mjs', 'render_test.mjs'):
    r = subprocess.run(['node', t], cwd=SB)
    rc = rc or r.returncode
sys.exit(rc)
