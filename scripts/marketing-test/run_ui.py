#!/usr/bin/env python3
"""
HARNESS VERIFIKASI MODUL "MARKETING / LEAD PIPELINE" (bit-dev, t_31a1a9f9)
===============================================================================
CATATAN INTEGRASI (t_7634fa92, Bamboo):
  Berkas ini semula bernama run.py di branch Bit dan BERTABRAKAN (add/add)
  dengan run.py milik lapisan kontrak S6 di branch integrasi. Keduanya sama-
  sama sah dan menguji hal BERBEDA:
    - run.py      (S6) : kontrak Marketing -> CRM/Project, otorisasi API,
                         bukti tidak ada jalur tulis/kirim (263 asersi).
    - run_ui.py   (ini): modul UI Marketing / Lead Pipeline itu sendiri
                         (logika murni, render jsdom, responsif) — 327 asersi.
  Karena itu berkas ini DIPERTAHANKAN dengan nama run_ui.py, bukan ditimpa
  atau dihapus. Tidak ada asersi yang dilonggarkan; hanya nama runner yang
  berbeda supaya dua lapisan uji bisa hidup berdampingan.

Tujuan: membuktikan pada eksekusi NYATA (Node + jsdom, React asli) bahwa
modul Marketing / Lead Pipeline JUJUR terhadap data:

  A) HOST TIDAK MENGIRIM LEAD -> panel "belum tersedia", BUKAN papan
     kosong yang terlihat seperti bug. Tidak ada lead contoh/demo.
  B) HOST MENGIRIM [] -> "Belum ada lead terdata" (kasus lain: benar-benar
     kosong, dan itu dikatakan).
  C) LEAD BARU = DRAF MEMORI HALAMAN: label "Draf halaman" di kartu,
     hilang saat halaman dimuat ulang. Tidak ada tabel leads baru,
     RPC, migrasi, Supabase, localStorage.
  D) TAHAP TIDAK DIKENALI -> ember "Tahap tidak diketahui", TIDAK
     dipaksa masuk "New Lead".
  E) NILAI KOSONG: sumber/kampanye -> "Tidak tersedia", aksi berikutnya
     -> "Belum ada aksi berikutnya" (BUKAN string kosong yang terbaca
     "tidak ada tindakan").
  F) TAUTAN CRM: 4 keadaan berbeda (linked / missing / unresolved /
     unknown). "Data customer tidak dikirim" BUKAN "tidak ditemukan".
  G) TANGGAL AKSI: yang lewat ditandai "Terlambat"; yang tidak ada
     tidak jadi 1970. Parsing 'YYYY-MM-DD' tidak bergeser hari.
  H) BARIS DARI HOST BACA SAJA: tidak ada tombol ubah/hapus, hanya draf.
  I) RESPONSIF: 360/390/768/1440 — halaman tidak melebar, papan
     1/3/5 kolom, KPI 1/2/4 kolom, touch target, drawer & form tetap
     terbaca.
  J) TIDAK ADA PENULISAN: nol fetch/XHR/localStorage pada render +
     interaksi penuh.

Cara kerja (tanpa DB, tanpa jaringan, tidak menyentuh .next aktif):
  1. Sandbox /tmp/marketing-verify — salin VERBATIM
     modules/marketing/{view,logic}.jsx|js, rewrite specifier relatif
     -> .mjs.
  2. compile_sandbox.mjs : transform esbuild (sama seperti harness
     crm-test / rap-compare).
  3. logic_test.mjs      : uji fungsi murni (readLeads, normalizeStage,
                           leadCapability, filterLeads, summarizeLeads,
                           validateLead, nextActionDue, customerLink,
                           toCsv, ...).
  4. render_test.mjs     : jsdom interaktif (createRoot) — render
                           MarketingModule asli, submit form draf,
                           filter, buka drawer, pastikan nol panggilan
                           fetch/XHR/localStorage.
  5. responsive_test.mjs : kontrak responsif di 360/390/768/1440 +
                           aturan CSS (prefix mk-, modul lain tak disentuh).

Jalankan dari root repo:  python3 scripts/marketing-test/run.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/marketing-verify'

# Closure import dari modules/marketing/view.jsx -> logic.js (self-contained).
REL_FILES = [
    'modules/marketing/view.jsx',
    'modules/marketing/logic.js'
]


def sb_rel(rel):
    """modules/marketing/view.jsx -> modules/marketing/view.mjs"""
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
    src = re.sub(r"(\bimport\s+['\"])(\.[^'\"]+)(['\"])", _repl, src)
    out = os.path.join(SB, sb_rel(rel))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(src)

# react/react-dom milik repo (symlink, tidak di-copy)
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(HERE, 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'logic_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'responsive_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs', REPO], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'logic_test.mjs', REPO], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'render_test.mjs', REPO], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'responsive_test.mjs', REPO], cwd=SB)
sys.exit(r.returncode)
