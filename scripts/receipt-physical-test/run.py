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
SB = os.environ.get('SB', '/tmp/receipt-physical-verify-t7bc')

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
# run 206: probe adversarial (keadaan lapangan yang tidak diuji harness utama).
# Dijalankan SESUDAH harness utama; exit-nya dilaporkan terpisah supaya tidak
# menyamarkan hasil 153+ assertion di atas.
shutil.copy(os.path.join(HERE, 'probe_run206_adversarial.mjs'), SB)
# run 208: pengunci temuan "permukaan input per barang tanpa penyimpanan"
# (panel prototype) + pesan usang "menunggu skema" di detail handover.
shutil.copy(os.path.join(HERE, 'probe_run208_prototype.mjs'), SB)
# run 215: pengunci perbaikan review run 212 (R1 capability null / R2 aksi
# borongan di READY / R3 klaim stok). Dijalankan terakhir, exit terpisah.
shutil.copy(os.path.join(HERE, 'probe_run215_review_fixes.mjs'), SB)
# run 222: pengunci review run 219 (S1/S2/S3) — queue.jsx memakai model
# keadaan yang SAMA dengan banner (5 keadaan), `partial` bukan LEGACY, dan
# panel Bermasalah tidak menawarkan jalur tulis saat keadaan tidak diketahui.
shutil.copy(os.path.join(HERE, 'probe_run222_queue_capability.mjs'), SB)
# run 233: pengunci review run 231 (T1/T2/T3) — keadaan `ready_no_return`
# (ledger inti siap, layer retur belum) harus punya nama sendiri, tidak boleh
# menawarkan jalur retur yang buntu, dan TIDAK boleh menjanjikan retur.
shutil.copy(os.path.join(HERE, 'probe_run233_return_layer_state.mjs'), SB)
# run 234: pengunci review run 234 (BUG-U1) — capability adalah SNAPSHOT.
# Migrasi dijalankan TANPA deploy saat aplikasi dipakai, jadi layar yang sudah
# terbuka memegang LEGACY basi dan LEGACY satu-satunya keadaan yang menulis
# jalur lama. Probe ini menuntut NOL tulisan di snapshot basi, penolakan pada
# Konfirmasi form yang sudah terbuka, dan LEGACY yang SAH tetap bisa menulis.
shutil.copy(os.path.join(HERE, 'probe_run234_stale_capability.mjs'), SB)
# run 237: pengunci defect HAPUS — tombol 🗑️ ada di setiap baris tanpa syarat;
# `delete from handovers` menghapus handover_items (cascade) dan membuka kuota
# tukang. Probe ini menuntut tombol NONAKTIF + nol tulisan untuk dokumen
# berbekti, dan KONTROL POSITIF bahwa DRAFT tanpa bukti tetap bisa dihapus.
shutil.copy(os.path.join(HERE, 'probe_run237_delete_ui.mjs'), SB)
# run 237: memastikan shell BENAR-BENAR memakai keputusan penjaga SEBELUM
# menulis (optimistic update & .delete()), termasuk jalur non-tombol.
shutil.copy(os.path.join(HERE, 'probe_run237_shell_wiring.mjs'), SB)
# run 239: pengunci defect DUA DOKUMEN untuk SATU PENERIMAAN — penjaga
# pembuatan (save.js), tombol konfirmasi (queue/view), dan choke point
# physicalHost. Di PG nyata dua dokumen aktif membuat `handover_confirm`
# menerima KEDUANYA (kunci per dokumen) → rincian 2× kuota, sisa negatif.
shutil.copy(os.path.join(HERE, 'probe_run239_dup_ui.mjs'), SB)
# Kontrak ditulis ulang supaya §7 bisa diperiksa probe 234 (tanpa ini probe
# membaca path sandbox dan lolos secara hampa).
shutil.copy(os.path.join(REPO, 'docs', 'receiving-events-contract.md'), SB)
# Probe MILIK REVIEWER run 219 dijalankan APA ADANYA (tidak diubah satu baris
# pun) — bukti bahwa temuan mereka benar-benar tertutup, bukan diakali.
shutil.copy(os.path.join(HERE, 'probe_run219_reviewer_final.mjs'), SB)
shutil.copy(os.path.join(HERE, 'probe_run219_reviewer_positive.mjs'), SB)
shutil.copy(os.path.join(HERE, 'probe_run219_reviewer_partial_RAW.mjs'), SB)
shutil.copy(os.path.join(HERE, 'probe_run219_reviewer_problem_RAW.mjs'), SB)

print(f'Sandbox: {SB}\n')
rc = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB).returncode
if rc:
    sys.exit(rc)
rc_main = subprocess.run(['node', 'receipt_physical_test.mjs'], cwd=SB).returncode
print('\n=== PROBE ADVERSARIAL (run 206) ===')
rc_probe = subprocess.run(['node', 'probe_run206_adversarial.mjs'], cwd=SB).returncode
print('\n=== PROBE PERMUKAAN INPUT PALSU (run 208) ===')
rc_probe2 = subprocess.run(['node', 'probe_run208_prototype.mjs'], cwd=SB).returncode
print('\n=== PROBE PERBAIKAN REVIEW RUN 212 (run 215: R1/R2/R3) ===')
rc_probe3 = subprocess.run(['node', 'probe_run215_review_fixes.mjs'], cwd=SB).returncode
print('\n=== PROBE KUNCI REVIEW RUN 219 (run 222: S1/S2/S3) ===')
rc_probe4 = subprocess.run(['node', 'probe_run222_queue_capability.mjs'], cwd=SB).returncode
print('\n=== PROBE KUNCI REVIEW RUN 231 (run 233: T1/T2/T3 — ready_no_return) ===')
rc_probe5 = subprocess.run(['node', 'probe_run233_return_layer_state.mjs'], cwd=SB).returncode
print('\n=== PROBE KUNCI REVIEW RUN 234 (run 234: U1 — capability BASI) ===')
rc_probe6 = subprocess.run(['node', 'probe_run234_stale_capability.mjs'], cwd=SB).returncode
print('\n=== PROBE KUNCI DEFECT HAPUS (run 237: 🗑️ menghancurkan bukti fisik) ===')
rc_probe7 = subprocess.run(['node', 'probe_run237_delete_ui.mjs'], cwd=SB).returncode
print('\n=== PROBE SAMBUNGAN PENJAGA HAPUS KE SHELL (run 237: dipakai SEBELUM menulis) ===')
# Probe ini membaca SUMBER (pages/index.js), jadi dijalankan dengan cwd = repo,
# bukan sandbox kompilasi.
rc_probe8 = subprocess.run(['node', os.path.join(SB, 'probe_run237_shell_wiring.mjs')], cwd=REPO).returncode
print('\n=== PROBE DOKUMEN GANDA (run 239: dua dokumen aktif untuk satu penerimaan) ===')
rc_probe9 = subprocess.run(['node', 'probe_run239_dup_ui.mjs'], cwd=SB).returncode
print('\n=== PROBE MILIK REVIEWER RUN 219 — DIJALANKAN APA ADANYA (final: K1/K2/K3) ===')
rc_rev1 = subprocess.run(['node', 'probe_run219_reviewer_final.mjs'], cwd=SB).returncode
print('\n=== PROBE MILIK REVIEWER RUN 219 — kontrol positif READY (J) ===')
rc_rev2 = subprocess.run(['node', 'probe_run219_reviewer_positive.mjs'], cwd=SB).returncode
print('\n=== PROBE MILIK REVIEWER RUN 219 — migrasi sebagian (I) — assertion DEFECT, harus TERBALIK ===')
rc_rev3 = subprocess.run(['node', 'probe_run219_reviewer_partial_RAW.mjs'], cwd=SB).returncode
print('\n=== PROBE MILIK REVIEWER RUN 219 — panel Bermasalah (H) — assertion DEFECT, harus TERBALIK ===')
rc_rev4 = subprocess.run(['node', 'probe_run219_reviewer_problem_RAW.mjs'], cwd=SB).returncode
# I & H sengaja mengandung assertion yang MENDAFTARKAN defect (mis. "banner
# mengklaim belum aktif", "tombol borongan AKTIF"). Di pohon yang sudah
# diperbaiki assertion itu WAJIB gagal. Jadi exit-nya TIDAK dihitung sebagai
# kegagalan harness — hasilnya dibaca manusia di log (lihat run222/).
if rc_rev3 == 0 or rc_rev4 == 0:
    print('\nPERINGATAN: probe I/H milik reviewer LULUS — berarti defect run 219 masih ada!')
    sys.exit(1)
sys.exit(rc_main or rc_probe or rc_probe2 or rc_probe3 or rc_probe4 or rc_probe5 or rc_probe6 or rc_probe7 or rc_probe8 or rc_probe9 or rc_rev1 or rc_rev2)
