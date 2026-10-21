#!/usr/bin/env python3
"""
Harness DB NYATA untuk ledger penerimaan (t_7bc6246b) — menutup gap run 101
============================================================================
Review run 101 memblok task ini karena jalur READY (RPC) hanya diuji terhadap
MOCK. Skrip ini menjalankan RPC SUNGGUHAN pada cluster PostgreSQL terisolasi
yang dimigrasikan paket schema owner (t_03b41644), dengan payload yang
dibentuk modul aplikasi VERBATIM (hasil transform SWC).

Alur:
  1. buat database uji baru (additive, tidak menyentuh DB lain)
  2. apply fixture baseline live-like + migrasi 00..04 milik t_03b41644
  3. siapkan sandbox modul aplikasi (verbatim, tanpa mock supabaseClient —
     RPC dipanggil lewat `pg` sehingga nama parameter & tipe benar2 diuji)
  4. jalankan db_rpc_test.mjs

Tanpa Supabase, tanpa jaringan, tanpa data produksi.

Jalankan: python3 scripts/receipt-ledger-db-test/run.py
  PGADMIN=postgresql://postgres@127.0.0.1:55434/postgres  (default)
  MIGDIR=<workspace t_03b41644>                            (default di bawah)
"""
import os, re, shutil, subprocess, sys, urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
# Sandbox path WAJIB bisa di-override: beberapa worker menjalankan harness ini
# bersamaan di worktree berbeda, dan path /tmp tetap yang dipakai bersama akan
# saling menimpa (sandbox berisi kode commit LAIN → hasil uji menyesatkan).
SB = os.environ.get('SB', '/tmp/receipt-ledger-app-t7bc')
DBNAME = 'receipt_ledger_t7bc'

PGADMIN = os.environ.get('PGADMIN', 'postgresql://postgres@127.0.0.1:55434/postgres')
MIGDIR = os.environ.get(
    'MIGDIR',
    '/home/ubuntu/.hermes/kanban/boards/purchasing-app/workspaces/t_03b41644'
)

u = urllib.parse.urlparse(PGADMIN)
PGURL_DB = PGADMIN.rsplit('/', 1)[0] + '/' + DBNAME


def run(cmd, **kw):
    print('$', ' '.join(cmd) if isinstance(cmd, list) else cmd)
    r = subprocess.run(cmd, **kw)
    if r.returncode:
        print(f'  -> exit {r.returncode}')
    return r.returncode


def psql(url, args):
    return run(['psql', url, '-X', '-q', '-v', 'ON_ERROR_STOP=1'] + args,
               stdout=subprocess.DEVNULL)


# ---------------------------------------------------------------- 1. database
print(f'\n=== 1. Database uji terisolasi: {DBNAME} ===')
# drop via psql (bukan shell rm) supaya jelas & idempotent
run(['psql', PGADMIN, '-X', '-q', '-c', f'drop database if exists {DBNAME}'],
    stdout=subprocess.DEVNULL)
rc = run(['psql', PGADMIN, '-X', '-q', '-c', f'create database {DBNAME}'], stdout=subprocess.DEVNULL)
if rc:
    print('GAGAL membuat database uji'); sys.exit(1)

# ------------------------------------------------------- 2. fixture + migrasi
print('\n=== 2. Fixture baseline + migrasi schema owner (00..04) ===')
if not os.path.isdir(MIGDIR):
    print(f'GAGAL: MIGDIR tidak ada: {MIGDIR}'); sys.exit(1)
if psql(PGURL_DB, ['-f', os.path.join(MIGDIR, 'test', 'fixture_baseline.sql')]):
    print('GAGAL apply fixture'); sys.exit(1)
for f in ['00_migration_ledger', '01_ops_line_identity', '02_receiving_events_physical',
          '03_return_layer', '04_master_refs']:
    p = os.path.join(MIGDIR, 'migrations', 'final', f + '.sql')
    if not os.path.isfile(p):
        print(f'GAGAL: migrasi tidak ada: {p}'); sys.exit(1)
    if psql(PGURL_DB, ['-f', p]):
        print(f'GAGAL apply {f}'); sys.exit(1)
    print(f'  apply {f} ok')

# ------------------------------------------------------------- 3. sandbox app
print('\n=== 3. Sandbox modul aplikasi (VERBATIM, tanpa mock DB) ===')
if os.path.exists(SB):
    shutil.rmtree(SB)

REL_FILES = ["lib/constants.js", "lib/purchaseNote.js"]
for root, dirs, files in os.walk(os.path.join(REPO, 'modules', 'receivings')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))

# run 206: probe rincian serah terima memakai modul display handover VERBATIM
# (rincianInfo/rincianCell) supaya yang diuji adalah kode yang dipakai UI,
# bukan salinannya. display.js hanya bergantung pada lib/constants.
REL_FILES.append('modules/handovers/display.js')


def sb_rel(rel):
    base, _ = os.path.splitext(rel)
    return base + '.mjs'


def resolve(rel_dir, spec):
    for cand in (spec, spec + '.js', spec + '.jsx'):
        p = os.path.normpath(os.path.join(rel_dir, cand))
        if os.path.isfile(os.path.join(REPO, p)):
            return p
    return None


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

# supabaseClient TIDAK dipakai (RPC lewat pg) — tetap disediakan supaya impor
# modul tidak pecah, tetapi setiap pemakaian langsung gagal keras (bukan mock
# yang bisa diam-diam "berhasil").
open(os.path.join(SB, 'lib', 'supabaseClient.mjs'), 'w').write(
    'export const supabase = null\n'
    'export const __noMock = true\n'
)
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)

print(f'  sandbox: {SB}')
rc = run(['node', 'compile_sandbox.mjs'], cwd=SB)
if rc:
    print('GAGAL kompilasi sandbox'); sys.exit(1)

# ------------------------------------------------------------------ 4. jalankan
print('\n=== 4. Uji RPC NYATA ===')
env = dict(os.environ, PGURL=PGURL_DB)
rc = run(['node', os.path.join(HERE, 'db_rpc_test.mjs')], cwd=REPO, env=env)

# ------------------------------------------- 5. matriks retur (rantai penuh)
# db_rpc_test membuktikan RPC-nya benar. Skrip ini membuktikan HAL YANG
# BERBEDA: setiap baris yang DITAWARKAN modal retur benar-benar DITERIMA RPC.
# Ditemukan defect run 190 justru di sambungan ini (UI menawarkan qty_rusak,
# RPC memakai retur_qty) — jadi keduanya harus dijalankan.
print('\n=== 5. Matriks retur: pilihan form → modal → RPC ===')
rc2 = run(['node', os.path.join(HERE, 'probe_retur_matrix.mjs')], cwd=REPO, env=env)

# --------------------------------- 6. resolusi retur (status × tindakan)
# Menutup defect run 195: modal menawarkan tindakan yang PASTI ditolak RPC
# (DISCARD untuk event belum dikonfirmasi dibuang) dan tindakan yang
# bertentangan dengan status barang (RETURN untuk barang yang sudah dibuang).
print('\n=== 6. Resolusi retur: ditawarkan aplikasi vs diterima RPC ===')
rc3 = run(['node', os.path.join(HERE, 'probe_retur_resolution.mjs')], cwd=REPO, env=env)

# ------------------------------ 7. penjaga kedatangan (defect run 199)
# Menutup tiga defect yang hanya terlihat saat form → payload → RPC diuji
# sebagai satu rantai: retur tanpa qty rusak, kedatangan barang yang BELUM
# DIBELI, dan DATANG melebihi BELI (termasuk baris beli langsung tanpa PR).
print('\n=== 7. Penjaga kedatangan: rusak 0 / belum dibeli / datang > beli ===')
rc4 = run(['node', os.path.join(HERE, 'probe_receipt_guards.mjs')], cwd=REPO, env=env)

# ------------------- 8. jalan buntu retur "Tentukan nanti" (run 202)
# Membuktikan kenapa panel modal retur TIDAK boleh menyuruh admin mengubah
# catatan yang sudah tersimpan: client_event_id deterministik membuat pilihan
# retur yang diubah menghasilkan replay (already_applied), bukan koreksi —
# dan tidak ada RPC reversal di paket skema.
print('\n=== 8. Jalan buntu retur "Tentukan nanti": koreksi tidak mungkin ===')
rc5 = run(['node', os.path.join(HERE, 'probe_retur_deadend.mjs')], cwd=REPO, env=env)

# ---------------- 9. serah terima sebagian / melewati baris (run 202)
# Menguji rantai prefill → validasi → RPC: qty 2 dari 5 diterima lalu dokumen
# TERKUNCI (sisa 3 tidak bisa ditambahkan), dan satu baris kosong dulu
# memblokir SELURUH submit. Skema mendukung dokumen susulan (H3) — jadi
# jalan keluarnya ada, dan UI harus mengatakannya.
print('\n=== 9. Serah terima sebagian / baris dilewati ===')
rc6 = run(['node', os.path.join(HERE, 'probe_handover_partial.mjs')], cwd=REPO, env=env)

# --------- 10. role aplikasi: apakah READY benar-benar mungkin? (run 202)
# Paket migrasi diuji sebagai `postgres`; aplikasi berjalan sebagai
# `authenticated`. Skrip ini menemukan bahwa GRANT SELECT pada view
# `v_receipt_progress` BELUM ada → capability probe gagal (permission denied,
# bukan PGRST205) sehingga mode READY tidak akan pernah menyala. Bukan sesuatu
# yang boleh ditambal dari kode aplikasi: grant = keputusan schema owner.
print('\n=== 10. Role aplikasi (authenticated): grant yang dibutuhkan READY ===')
rc7 = run(['node', os.path.join(HERE, 'probe_app_role.mjs')], cwd=REPO, env=env)

# ---------- 11. rincian serah terima benar-benar TERLIHAT (run 206) ----------
# `handover_confirm` menulis handover_items, tetapi halaman tidak pernah
# membacanya → rincian mustahil tampil walau datanya ADA. Probe ini menulis
# lewat RPC nyata, membaca dengan kolom yang dipakai loadAll, lalu menjalankan
# display.rincianInfo/rincianCell VERBATIM pada baris hasilnya.
print('\n=== 11. Rincian serah terima terlihat (handover_items terbaca halaman) ===')
rc8 = run(['node', os.path.join(HERE, 'probe_handover_items_visible.mjs')], cwd=REPO, env=env)

# ---------------- 12. qty PECAHAN (m3/kg) — run 210 ----------------
# Run 184..208 semuanya menguji qty BULAT. Padahal keempat input form memakai
# `step="any" inputMode="decimal"`, jadi admin memang boleh mengisi 3.5 m2
# atau 12.75 kg. Tiga lapisan memakai toleransi BERBEDA: JS EPS=1e-9,
# constraint/RPC `+0.001`, checker `> 0.001`. Probe ini membuktikan qty
# pecahan sah tersimpan utuh, alokasi pecahan berlebih tetap ditolak, dan
# retur pecahan mengikuti qty rusak pecahan.
print('\n=== 12. Qty pecahan (m3/kg): simpan utuh, batas & retur tetap benar ===')
rc9 = run(['node', os.path.join(HERE, 'probe_run210_fractional.mjs')], cwd=REPO, env=env)

# ---------------- 13. jalur HAPUS (run 237) ----------------
# LENSA yang belum pernah dipakai 13 run sebelumnya: tombol 🗑️ ada di setiap
# baris tanpa syarat. `delete from handovers` (persis deleteItem di
# pages/index.js) menghapus `handover_items` lewat ON DELETE CASCADE → bukti
# fisik hilang permanen — tanpa mengoreksi `receiving_items.qty_handed_over`,
# sehingga kuota tukang terbuka lagi dan barang yang sama bisa diserahkan DUA
# kali. Checker integritas DB sendiri menandainya rusak.
print('\n=== 13. Jalur HAPUS: bukti fisik hilang & kuota terbuka (run 237) ===')
rc10 = run(['node', os.path.join(HERE, 'probe_run237_delete.mjs')], cwd=REPO, env=env)

# ---------------- 14. cakupan FK hapus (run 237) ----------------
# Menentukan kebenaran yang HARUS dipakai penjaga aplikasi: FK
# `handovers.receiving_id` TIDAK cascade, jadi hapus nota yang masih dirujuk
# serah terima APA PUN sudah ditolak database dengan pesan mentah 23503.
# Penjaga aplikasi harus sama ketatnya — bukan lebih longgar.
print('\n=== 14. Cakupan FK hapus: nota vs PR (run 237) ===')
rc11 = run(['node', os.path.join(HERE, 'probe_run237_fk_scope.mjs')], cwd=REPO, env=env)

# ---------------- 15. dua dokumen untuk satu penerimaan (run 239) ----------------
# LENSA yang belum pernah dipakai 16 run sebelumnya: DUA DOKUMEN pada SATU
# PENERIMAAN. `handover_confirm` mengunci `handover:<id>` (per DOKUMEN) dan
# mengecek kuota SEBELUM baris `receiving_items` dikunci, sehingga dua dokumen
# yang dikonfirmasi bersamaan SAMA-SAMA lolos: rincian 2× kuota, sisa negatif.
# Penjaga aplikasi ada di modules/handovers/duplicateGuard.js; probe ini
# mengunci BUKTI-nya di database supaya tidak ada yang menutupnya dengan asumsi.
print('\n=== 15. Dua dokumen untuk satu penerimaan: penyerahan ganda (run 239) ===')
rc12 = run(['node', os.path.join(HERE, 'probe_run239_dupdoc.mjs')], cwd=REPO, env=env)

# CATATAN: exit 2 dari probe_app_role = BLOCKER SKEMA (grant view belum ada),
# bukan regresi aplikasi. Dibiarkan "tidak hijau" supaya tidak ada yang
# menyimpulkan "siap DDL" padahal READY mustahil menyala.
if rc7 == 2:
    print('\n!! BLOCKER SKEMA: grant SELECT pada v_receipt_progress belum ada.')
    print('   DDL/grant milik t_03b41644 — laporkan, jangan ditambal dari aplikasi.')
    sys.exit(2)
sys.exit(rc or rc2 or rc3 or rc4 or rc5 or rc6 or rc7 or rc8 or rc9 or rc10 or rc11 or rc12)
