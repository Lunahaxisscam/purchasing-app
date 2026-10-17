#!/usr/bin/env python3
"""
HARNESS VERIFIKASI HANDOVER DIPADATKAN (bamboo-tech) — task t_b03c5228 (S2/7)
=============================================================================
Membuktikan dua hal yang diminta kartu, di UI NYATA (React + jsdom interaktif,
modules/handovers/* dan modules/receivings/* ASLI hasil transform SWC):

  A. VISIBILITAS AKSI (queue.jsx)
     A1  dua aksi utama tampil & ditonjolkan: Gudang + Tukang
     A2  "Bermasalah" tampil sebagai aksi SEKUNDER (bukan tombol utama)
     A3  "Tandai Diserahkan" = langkah PENUTUP, bukan aksi keempat setara
     A4  status teknis TIDAK tampil (KE_GUDANG / KE_TUKANG / DI_GUDANG /
         DI_TUKANG / RETUR / REFUND) — hanya kalimat manusia
     A5  label jujur "Rincian barang belum tersedia" tetap ada
     A6  aksi nonaktif SELALU punya alasan yang bisa dibaca (title), tidak
         ada tombol mati tanpa penjelasan
     A7  nota bermasalah: distribusi ditutup + badge jujur, aksi bermasalah
         juga ditolak dengan alasan (tidak bisa ditandai dua kali)
     A8  data lama tanpa receiving_id: kartu tetap tampil, semua aksi
         nonaktif dengan alasan (fallback legacy, bukan kartu hilang)
     A9  Bermasalah memakai handler shell yang SUDAH ADA
         (ctx.onReceivingStatusChange) dan menulis NOL DB sendiri
     A10 "Bermasalah" pada nota multi-item ditolak dengan alasan skema —
         tidak ada ilusi tersimpan

  B. TIDAK ADA FIELD FISIK GANDA (page.jsx Purchase + queue.jsx Handover)
     B1  Purchase tidak punya tombol/kontrol gudang, tukang, retur, refund
     B2  Purchase tidak menampilkan status nota / kendala
     B3  Purchase tidak menyebut kolom fisik (masuk_gudang/tukang_at/
         alokasi/kendala) di teks UI mana pun
     B4  jalur simpan Purchase tidak menulis kolom distribusi fisik
         (alokasi hanya di-reset saat header BARU dibuat, bukan diedit)
     B5  Handover = satu-satunya tempat aksi fisik (gudang/tukang/bermasalah)

Cara kerja: sandbox /tmp/handover-compact-verify — salin VERBATIM file sumber
(components, lib, seluruh modules/**), mock supabaseClient perekam, transform
SWC, lalu jalankan test .mjs. Tanpa DB, tanpa jaringan, tanpa menyentuh .next.

Jalankan dari root repo:  python3 scripts/handover-compact-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/handover-compact-verify'

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

# Mock supabase perekam: pakai milik harness handover (sudah mengemulasi CAS).
shutil.copy(os.path.join(REPO, 'scripts', 'handover-flow-test', 'mock-supabaseClient.mjs'),
            os.path.join(SB, 'lib', 'supabaseClient.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)
for f in ('queue_ui_test.mjs', 'purchase_scope_test.mjs'):
    shutil.copy(os.path.join(HERE, f), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'queue_ui_test.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'purchase_scope_test.mjs'], cwd=SB)
sys.exit(r.returncode)
