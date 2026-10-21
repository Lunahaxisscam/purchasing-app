#!/usr/bin/env python3
"""Runner probe r254 (D4/D5) — PG16 terisolasi, paket v1 beku.

Langkah:
  1. database uji BARU (prefix `ops_r254_`) — tidak menyentuh DB lain
  2. fixture baseline + baseline 00..03 + dua migration operasional v1
  3. sandbox modul aplikasi VERBATIM (SWC, tanpa mock DB)
  4. probe_r254_d4_d5.mjs — modul produksi dijalankan di atas PostgreSQL nyata

Tidak ada kredensial produksi, tidak ada DDL ke Supabase.
Jalankan dari root repo:
  OPSDIR=<paket v1 ter-unzip> python3 scripts/receipt-ledger-db-test/run_r254.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = os.environ.get('SB', '/tmp/r254-app-pg')
DBNAME = os.environ.get('DBNAME', 'ops_r254_d4d5')
PGADMIN = os.environ.get('PGADMIN', 'postgresql://postgres@127.0.0.1:55434/postgres')
OPSDIR = os.environ.get('OPSDIR', '/tmp/opsv1b')

PGURL = PGADMIN.rsplit('/', 1)[0] + '/' + DBNAME


def run(cmd, **kw):
    r = subprocess.run(cmd, **kw)
    if r.returncode:
        print(f'  -> exit {r.returncode}')
    return r.returncode


def psql(url, args):
    return run(['psql', url, '-X', '-q', '-v', 'ON_ERROR_STOP=1'] + args, stdout=subprocess.DEVNULL)


print(f'\n=== 1. Database uji terisolasi: {DBNAME} ===')
run(['psql', PGADMIN, '-X', '-q', '-c',
     f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{DBNAME}'"], stdout=subprocess.DEVNULL)
if run(['psql', PGADMIN, '-X', '-q', '-c', f'drop database if exists {DBNAME}'], stdout=subprocess.DEVNULL):
    sys.exit(1)
if run(['psql', PGADMIN, '-X', '-q', '-c', f'create database {DBNAME}'], stdout=subprocess.DEVNULL):
    sys.exit(1)

print('\n=== 2. Fixture baseline + baseline 00..03 + operational v1 ===')
steps = [os.path.join(OPSDIR, 'baseline', 'test', 'fixture_baseline.sql')]
for f in ['00_migration_ledger.sql', '01_ops_line_identity.sql',
          '02_receiving_events_physical.sql', '03_return_layer.sql']:
    steps.append(os.path.join(OPSDIR, 'baseline', 'migrations', 'final', f))
steps.append(os.path.join(OPSDIR, 'migrations', '20261021_01_operational_contract_v1.sql'))
steps.append(os.path.join(OPSDIR, 'migrations', '20261021_02_operational_physical_v1.sql'))
for p in steps:
    if not os.path.isfile(p):
        print(f'GAGAL: tidak ada {p}')
        sys.exit(1)
    if psql(PGURL, ['-f', p]):
        print(f'GAGAL apply {os.path.basename(p)}')
        sys.exit(1)
    print(f'  apply {os.path.basename(p)} ok')

seed = (
    "insert into public.profiles(id,full_name,role) values "
    "('90000000-0000-0000-0000-000000000001','Admin Uji','admin'),"
    "('90000000-0000-0000-0000-000000000002','Member Uji','staff') "
    "on conflict (id) do update set role=excluded.role;"
    "insert into public.pr_items(id,pr_id,material_id,quantity,estimated_price,status,item_name,kode,unit) values "
    "('dddddddd-0000-0000-0000-0000000000aa','cccccccc-0000-0000-0000-000000000001',"
    "'aaaaaaaa-0000-0000-0000-000000000001',100,140000,'APPROVED','Triplek 9mm (uji r254)','M001','Lembar') "
    "on conflict (id) do nothing;"
)
if psql(PGURL, ['-c', seed]):
    print('GAGAL seed profil/pr_items')
    sys.exit(1)

print('\n=== 3. Sandbox modul aplikasi (VERBATIM, SWC) ===')
if os.path.exists(SB):
    shutil.rmtree(SB)
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

os.makedirs(os.path.join(SB, 'lib'), exist_ok=True)
# Probe ini menjalankan MODUL PRODUKSI di atas PostgreSQL NYATA: klien supabase
# diganti adapter tipis (select/update/delete/rpc → SQL sungguhan), sehingga
# trigger, RLS, GRANT, dan RPC kontrak v1 ikut diuji. BUKAN mock yang selalu
# menjawab "ok" — kelas defect yang berulang di card ini.
shutil.copy(os.path.join(HERE, 'pg_supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)
if run(['node', 'compile_sandbox.mjs'], cwd=SB):
    sys.exit(1)

print('\n=== 4. Probe D4/D5 (modul produksi → PostgreSQL NYATA) ===')
env = dict(os.environ, PGURL=PGURL, SB=SB)
rc = subprocess.run(['node', os.path.join(HERE, 'probe_r254_d4_d5.mjs')], cwd=SB, env=env).returncode
sys.exit(rc)
