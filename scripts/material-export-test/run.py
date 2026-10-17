#!/usr/bin/env python3
"""
HARNESS VERIFIKASI EXPORT CSV & PDF — MODUL MATERIAL (t_27e26b0e)
================================================================
Fitur: tombol [📥 Export CSV] & [📄 Export PDF] di toolbar Modul Material.

Diuji pada render NYATA (React + jsdom, ModuleView.js asli + modul export
asli, mock supabase — tanpa DB, tanpa jaringan, tanpa menyentuh .next:

  A) TOOLBAR: tombol "Export CSV" & "Export PDF" tampil di toolbar
     page materials; TIDAK tampil di modul lain (vendors);
     klik memicu download dgn nama file benar (stub URL.createObjectURL).
  B) CSV: BOM \\ufeff di awal, header kolom persis (Kode, Nama Material,
     Kategori, Satuan, Stok Saat Ini, Min Stok, Harga Acuan Terakhir),
     jumlah baris data = seluruh displayRows (335 — TANPA potongan
     Show More 10), nilai kolom benar (kode/nama/kategori/stok), dan
     Harga Acuan Terakhir MENGECER resolver acuan + label sumber jujur:
     HISTORIS pakai price_actual, estimasi PR dilabel eksplisit
     "BUKAN harga beli" (P1 t_e88c28fb).
  C) PDF: biner valid (magic %PDF-1.4, %%EOF, xref), pdftotext
     menghasilkan teks berisi header "NOIR LIVING", tanggal ekspor,
     header kolom (No, Kode, Nama Material, Kategori, Satuan, Stok),
     paginasi multi-halaman utk 335 material (Page 2 muncul), dan data
     material terlihat. Ukuran A4 (595x842pt) dicek dari MediaBox.
  D) REGRESI t_090127ad & t_cf05c96f: kolom "Acuan Harga" tetap tidak ada
     di header; expand "+ Acuan Harga" tetap buka rincian tanpa menambah
     jumlah baris parent & TIDAK me-reset Show More ("10 dari 335").

Cara kerja: pola sama dgn scripts/material-acuan-test — sandbox /tmp diisi
salinan VERBATIM sumber + mock supabaseClient, compile SWC, render jsdom.

Jalankan dari root repo:  python3 scripts/material-export-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/material-export-verify'

# Closure import dari ModuleView.js + CreateModal.js (shell -> semua modul)
# + seluruh lib/ (t_27e26b0e: acuan.js kini mengimpor lib/purchaseNote,
#   dan save/materials save.js menarik lantai helper lintas-lantai lain).
REL_FILES = ['components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js', 'lib/constants.js']
for root, dirs, files in os.walk(os.path.join(REPO, 'modules')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))
for root, dirs, files in os.walk(os.path.join(REPO, 'lib')):
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

shutil.copy(os.path.join(os.path.dirname(HERE), 'material-acuan-test', 'mock-supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
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
