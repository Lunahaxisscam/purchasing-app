#!/usr/bin/env python3
"""
RUNNER probe 248 — PAYLOAD APLIKASI → RPC KONTRAK v1 di PostgreSQL NYATA
=======================================================================
Kenapa runner terpisah dari `run.py`:
  `run.py` memakai baseline 00..04 milik t_03b41644 (paket schema lama).
  Probe ini membutuhkan paket OPERASIONAL v1 milik t_2b8dcab3:
  baseline 00..03 (snapshot, tidak diedit) + dua file migration
  `20261021_01_operational_contract_v1.sql` dan
  `20261021_02_operational_physical_v1.sql`.

Yang dijalankan:
  1. database uji BARU (additive; tidak menyentuh database lain)
  2. fixture baseline sintetis + baseline 00..03 + operational v1
  3. sandbox modul aplikasi VERBATIM (hasil transform SWC)
  4. probe_r248_app_to_pg.mjs — payload modul produksi → RPC sungguhan

Tidak ada kredensial, tidak ada data produksi, tidak ada DDL ke Supabase.
Jalankan dari root repo:
  python3 scripts/receipt-ledger-db-test/run_r248.py
"""
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = os.environ.get('SB', '/tmp/r248-app-pg')
DBNAME = os.environ.get('DBNAME', 'ops_r248_app')
PGADMIN = os.environ.get('PGADMIN', 'postgresql://postgres@127.0.0.1:55434/postgres')
OPSDIR = os.environ.get(
    'OPSDIR',
    '/home/ubuntu/.hermes/kanban/boards/purchasing-app/workspaces/t_2b8dcab3'
)

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


# ------------------------------------------------------------- 1. database
print(f'\n=== 1. Database uji terisolasi: {DBNAME} ===')
# Buang database uji SEBELUMNYA bila ada, dengan nama yang jelas milik harness
# ini (bukan database lain). `dropdb` dipakai (bukan shell rm) supaya idempotent.
run(['psql', PGADMIN, '-X', '-q', '-c',
     f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{DBNAME}'"],
    stdout=subprocess.DEVNULL)
run(['psql', PGADMIN, '-X', '-q', '-c', f'drop database if exists {DBNAME}'],
    stdout=subprocess.DEVNULL)
rc = run(['psql', PGADMIN, '-X', '-q', '-c', f'create database {DBNAME}'],
         stdout=subprocess.DEVNULL)
if rc:
    print('GAGAL membuat database uji')
    sys.exit(1)

# --------------------------------------------- 2. fixture + baseline + v1
print('\n=== 2. Fixture baseline + baseline 00..03 + operational v1 ===')
fixture = os.path.join(OPSDIR, 'baseline', 'test', 'fixture_baseline.sql')
if not os.path.isfile(fixture):
    print(f'GAGAL: fixture tidak ada: {fixture}')
    sys.exit(1)
if psql(PGURL_DB, ['-f', fixture]):
    print('GAGAL apply fixture')
    sys.exit(1)

BASE = ['00_migration_ledger.sql', '01_ops_line_identity.sql',
        '02_receiving_events_physical.sql', '03_return_layer.sql']
for f in BASE:
    p = os.path.join(OPSDIR, 'baseline', 'migrations', 'final', f)
    if not os.path.isfile(p):
        print(f'GAGAL: baseline tidak ada: {p}')
        sys.exit(1)
    if psql(PGURL_DB, ['-f', p]):
        print(f'GAGAL apply baseline {f}')
        sys.exit(1)
    print(f'  apply baseline {f} ok')

V1 = ['20261021_01_operational_contract_v1.sql', '20261021_02_operational_physical_v1.sql']
for f in V1:
    p = os.path.join(OPSDIR, 'migrations', f)
    if not os.path.isfile(p):
        print(f'GAGAL: migration v1 tidak ada: {p}')
        sys.exit(1)
    if psql(PGURL_DB, ['-f', p]):
        print(f'GAGAL apply {f}')
        sys.exit(1)
    print(f'  apply {f} ok')

# Profil admin & member (predikat role kontrak v1: profiles.id = auth.uid()
# AND lower(role) = 'admin'). Data SINTETIS.
seed = (
    "insert into public.profiles(id,full_name,role) values "
    "('90000000-0000-0000-0000-000000000001','Admin Uji','admin'),"
    "('90000000-0000-0000-0000-000000000002','Member Uji','staff') "
    "on conflict (id) do update set role=excluded.role;"
    # Baris PR tambahan (qty 100) khusus uji split 12/8: fixture hanya punya
    # satu baris PR qty 10, dan membeli 20 akan ditolak `over_purchase_pr`
    # (benar) sehingga bukan yang ingin diuji di sini. Data SINTETIS.
    "insert into public.pr_items(id,pr_id,material_id,quantity,estimated_price,status,item_name,kode,unit) values "
    "('dddddddd-0000-0000-0000-0000000000aa','cccccccc-0000-0000-0000-000000000001',"
    "'aaaaaaaa-0000-0000-0000-000000000001',100,140000,'APPROVED','Triplek 9mm (uji split)','M001','Lembar') "
    "on conflict (id) do nothing;"
)
if psql(PGURL_DB, ['-c', seed]):
    print('GAGAL seed profiles')
    sys.exit(1)

# ------------------------------------------------- 3. sandbox modul verbatim
print('\n=== 3. Sandbox modul aplikasi (VERBATIM, tanpa mock DB) ===')
if os.path.exists(SB):
    shutil.rmtree(SB)

REL_FILES = ['lib/constants.js', 'lib/purchaseNote.js']
for root, dirs, files in os.walk(os.path.join(REPO, 'modules', 'receivings')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))
for rel in ['modules/handovers/duplicateGuard.js', 'modules/handovers/duplicateGuardDb.js',
            'modules/handovers/createHandover.js', 'modules/handovers/createCapability.js',
            'modules/handovers/confirm.js', 'modules/handovers/display.js',
            # purchaseLogic mengimpor penanda jalur LEAN dari modul requests;
            # tanpa file ini sandbox gagal di IMPOR (bukan di assertion).
            'modules/requests/leanRequest.js']:
    REL_FILES.append(rel)


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

open(os.path.join(SB, 'lib', 'supabaseClient.mjs'), 'w').write(
    'export const supabase = null\n'
    'export const __noMock = true\n'
)
# Untuk probe APP→PG, tabel dibaca dari mock perekam (in-memory) tetapi SEMUA
# RPC diteruskan ke PostgreSQL NYATA oleh probe. Jadi yang diuji adalah
# payload yang dibentuk modul produksi + jawaban RPC sungguhan; bukan tiruan.
shutil.copy(os.path.join(REPO, 'scripts', 'receipt-physical-test', 'mock_purchase_recorder.mjs'),
            os.path.join(SB, 'lib', 'supabaseClient.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)

print(f'  sandbox: {SB}')
rc = run(['node', 'compile_sandbox.mjs'], cwd=SB)
if rc:
    print('GAGAL kompilasi sandbox')
    sys.exit(1)

# ------------------------------------------------------------- 4. jalankan
print('\n=== 4. Probe APP→PG (payload produksi → RPC kontrak v1) ===')
env = dict(os.environ, PGURL=PGURL_DB)
rc = run(['node', os.path.join(HERE, 'probe_r248_app_to_pg.mjs')], cwd=SB, env=env)
sys.exit(rc)
