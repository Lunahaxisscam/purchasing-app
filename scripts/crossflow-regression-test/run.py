#!/usr/bin/env python3
"""
HARNESS REGRESI LINTAS FLOW + ANTI-DOUBLE-COST (t_796f8498) — bit-dev
===================================================================
Menguji kontrak PR -> Approval -> Purchase -> Handover sebagai SATU alur,
plus guard anti-dobel-dobel-cost (double-click, retry, dua user) dan
kegunaan laporan (KPI invoice, RAB/RAP variance, aktual labor).

Semua terhadap SUMBER ASLI hasil transform SWC, tanpa DB, tanpa jaringan,
tanpa menyentuh .next aktif:

  A. ALUR PENUH (fixtures murni, mock DB perekam)
     A1 Approval membuat cangkang nota (RPC ensure_item_in_purchase)
        idempoten — double-click/retry tidak menduplikasi baris item.
     A2 Purchase mencatat nota riil di atas cangkang itu (pakai ulang
        header & baris, TIDAK menduplikasi) + membuat antrean Handover
        DRAFT sekali saja.
     A3 Handover: aksi gudang/tukang/terima idempoten; CAS
        diserahkan_at menolak penandaan ganda.
     A4 Alur parsial: item dibeli sebagian -> sisa tetap di antrean,
        total qty tercatat = qty dibeli (tidak lebih).
  B. ANTI-DOUBLE-COST (inti temuan DAT)
     B1 nota sama (vendor + no nota) ditolak -> nol insert kedua.
     B2 retry savePurchase dengan data identik -> tidak ada nota/baris
        ganda (selain penolakan eksplisit di B1).
     B3 handover antrean ganda dicegah (select-then-insert race
        disimulasikan: satu nota hanya satu dokumen handover).
     B4 confirm ganda (retry) -> satu penulisan diserahkan_at.
     B5 shell approval yang sudah jadi nota TIDAK ditimpa oleh nota baru.
  C. PARSIAL QTY
     C1 buildReadyRows: qty sisa = qty PR - sudah dibeli, minimal 1.
     C2 nota penuh -> item hilang dari antrean (tidak beli ulang).
     C3 form default qty = sisa (bukan qty PR penuh).
  D. LAPORAN / KPI
     D1 rap-compare: aktual hanya dari nota; tanpa harga = null (bukan 0).
     D2 labor-stock: aktual (tukang_projects) TIDAK dijumlahkan dengan
         estimasi (project_plans); tanpa angka = null bukan 0.
     D3 sales-invoice: KPI total invoice tidak menjumlah draft/batal.
     D4 piutang: paid_amount parsial mengurangi outstanding (BUKAN nominal penuh).

Cara kerja: sandbox /tmp/crossflow-regression-verify — salin VERBATIM file
sumber (modules/**, lib/**), mock supabaseClient perekam, transform SWC.

Jalankan dari root repo:  python3 scripts/crossflow-regression-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/crossflow-regression-verify'

REL_FILES = ['lib/purchaseNote.js', 'lib/constants.js']
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

# node_modules di-ignore git (tidak ada di worktree) -> arahkan ke main repo,
# tempat yang sama dengan baseline agar transform SWC identik.
MAIN_REPO = os.environ.get('REPO_MAIN') or subprocess.run(
    ['git', 'worktree', 'list', '--porcelain'], cwd=REPO, capture_output=True, text=True
).stdout.split('worktree ')[1].split('\n')[0].strip()
shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
os.symlink(os.path.join(MAIN_REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)

TESTS = ['crossflow_test.mjs', 'guard_test.mjs', 'reporting_test.mjs']
for t in TESTS:
    shutil.copy(os.path.join(HERE, t), os.path.join(SB, t))

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
failed = []
for t in TESTS:
    print(f'\n===== {t} =====')
    r = subprocess.run(['node', t], cwd=SB)
    if r.returncode:
        failed.append(t)
print('\n' + '=' * 60)
if failed:
    print(f'GAGAL: {", ".join(failed)}')
    sys.exit(1)
print('SEMUA TEST LULUS')
