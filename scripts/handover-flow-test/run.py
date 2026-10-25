#!/usr/bin/env python3
"""
HARNESS VERIFIKASI ALUR HANDOVER (bamboo-tech) — task t_b418827b
=================================================================
Membuktikan kontrak Handover di UI NYATA (React + jsdom interaktif,
ModuleView.js + CreateModal.js + modules/handovers/* ASLI hasil transform
SWC) plus logika murni (display.js) dan aksi tulis (confirm.js, save.js
dengan mock DB perekam):

  H1 semantik bukti fisik: "Sudah Diserahkan" = diserahkan_at; CONFIRMED
     lama tanpa diserahkan_at ditampilkan apa adanya (bukan diklaim).
  H2 rincian barang: data lama -> "Rincian barang belum tersedia"; TIDAK
     menebak dari quantity_received Purchase; items terstruktur (setelah
     skema) ditampilkan apa adanya.
  H3 referensi sumber: Purchase + PR asal dari receiving_id.
  H4 prototype per-item: parsial, sisa belum diserahkan, tanpa hitung
     ganda, beberapa penerima, qty invalid ditolak.
  H5 konfirmasi fisik idempoten: CAS `diserahkan_at IS NULL` (retry/2 user
     tidak menandai dua kali), error DB dilaporkan, re-confirm no-op.
  H6 simpan: edit HANYA metadata (FK/status/diserahkan_at terkunci dari
     form — payload tampering ditolak), tambah masuk antrean DRAFT,
     tanpa receiving ditolak dengan nol tulisan.
  R1..R6 render jsdom interaktif: daftar (kolom Barang, status, aksi
     ringkas tidak bertumpuk, filter bukti fisik), konfirmasi dari UI,
     detail expand + prototype (nol mutasi), modal edit tanpa dropdown
     sumber/status + rincian wajib terlihat, modal tambah link wajib,
     kartu mobile.

Cara kerja: sandbox /tmp/handover-flow-verify — salin VERBATIM file sumber
(ModuleView, CreateModal, lib/constants, seluruh modules/**), mock
supabaseClient perekam, transform SWC, lalu render_test.mjs (jsdom
interaktif). Tanpa DB, tanpa jaringan, tanpa menyentuh .next aktif.

Jalankan dari root repo:  python3 scripts/handover-flow-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/handover-flow-verify'

REL_FILES = ['components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js', 'lib/constants.js', 'lib/purchaseNote.js']
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
        # CSS module: lingkungan node ESM tidak bisa memuat .css — stub agar
        # ModuleView (yang kini mengimpor compact-ops.module.css) tetap bisa
        # dieksekusi di sandbox. Tidak ada assertion yang diubah.
        if spec.endswith('.module.css'):
            stub = os.path.join(SB, os.path.normpath(os.path.join(os.path.dirname(sb_rel(rel)), 'css-stubs', os.path.basename(spec) + '.mjs')))
            os.makedirs(os.path.dirname(stub), exist_ok=True)
            if not os.path.exists(stub):
                open(stub, 'w', encoding='utf-8').write('export default new Proxy({}, { get: () => "" });\n')
            new_spec = './css-stubs/' + os.path.basename(spec) + '.mjs'
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
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'logic_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'queue_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'logic_test.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'queue_test.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'render_test.mjs'], cwd=SB)
sys.exit(r.returncode)
