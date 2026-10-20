#!/usr/bin/env python3
"""
HARNESS VERIFIKASI LEDGER FISIK PER BARANG (t_7bc6246b)
=======================================================
Membuktikan bagian 2 blueprint ("proses yang bisa dibuat lebih singkat") di
KODE UI NYATA — React + jsdom interaktif, modul ASLI hasil transform SWC,
tanpa DB dan tanpa jaringan.

Fokus (arahan DAT): UI fisik HANYA di Handover.
  R  TERIMA BARANG per item (receiptForm.jsx)
     R1  satu form memuat kedatangan/rusak/tujuan/retur per barang
     R2  foto OPSIONAL (tidak memblokir submit tanpa foto)
     R3  sisa dihitung dari qty_arrived (DATANG), BUKAN quantity_received
     R4  mode LEGACY: submit diblok, pesan gap, NOL tulisan
     R5  mode READY: submit memanggil RPC receipt_apply_events SATU kali
     R6  double submit → hanya satu panggilan RPC
     R7  over-receipt ditolak sebelum RPC (nol tulisan)

  C  KONFIRMASI FISIK per item (confirmForm.jsx)
     C1  baris prefill dari alokasi tukang dikurangi yang sudah diserahkan
     C2  qty & penerima bisa diverifikasi/diubah, bukan diketik dari nol
     C3  konfirmasi memanggil RPC handover_confirm (bukan update header)
     C4  mode LEGACY jatuh ke confirm.js (header) dengan pesan jujur

  T  RETUR tanpa ketik ulang (returnForm.jsx)
     T1  baris diambil dari event rusak (nama & qty otomatis)
     T2  qty yang sudah pernah diretur TIDAK ditawarkan lagi (anti dobel)
     T3  riwayat retur tak terbaca → modal MENOLAK (bukan mengarang)
     T4  submit memanggil RPC return_create dengan baris terpilih

  P  PINTU MASUK di Handover (queue.jsx / view.jsx)
     P1  tombol Terima Barang ada di kartu antrean & aksi baris
     P2  kontrak DAT "tepat 3 aksi fisik" TIDAK dilanggar (Terima Barang di
         blok langkah tersendiri, bukan aksi ke-4 di baris aksi)
     P3  capability banner jujur saat skema belum ada
     P4  Bermasalah → form retur per barang saat ledger siap; tetap alasan
         jujur saat belum

Cara kerja: sandbox /tmp/receipt-physical-verify — salin VERBATIM file sumber,
mock supabaseClient perekam (PGRST205 untuk tabel ledger yang belum ada),
transform SWC, lalu jalankan receipt_physical_test.mjs.

Jalankan dari root repo:  python3 scripts/receipt-physical-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/receipt-physical-verify'

REL_FILES = ['components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js',
             'lib/constants.js', 'lib/purchaseNote.js']
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
shutil.copy(os.path.join(HERE, 'receipt_physical_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
rc = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB).returncode
if rc:
    sys.exit(rc)
sys.exit(subprocess.run(['node', 'receipt_physical_test.mjs'], cwd=SB).returncode)
