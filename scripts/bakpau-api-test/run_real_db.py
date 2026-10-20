#!/usr/bin/env python3
"""
run_real_db.py — uji jalur CREATE API Bakpau terhadap PostgreSQL NYATA
========================================================================
Bukan mock: memakai cluster PostgreSQL 16 terisolasi (port 55434) yang sudah
dipakai harness t_7bc6246b, fixture baseline live-like milik t_03b41644, dan
migrasi ledger Bakpau. Klien Supabase diganti shim `pg` (pgSupabaseShim.mjs)
sehingga SQL yang benar-benar dijalankan terlihat dan error Postgres asli
(23505, 23502, 23514) ikut teruji.

Yang dibuktikan:
  1. create SAH -> benar-benar 1 baris receivings + N baris receiving_items,
     status DIBELI, marker event/bukti/proyek ada, readback exact cocok.
  2. idempotencyKey sama -> 0 tulisan baru (UNIQUE dedup_key 23505).
  3. bukti sama kunci beda -> duplicate, 0 tulisan baru.
  4. payload invalid/ambigu -> 0 tulisan.
  5. notifikasi gagal -> tetap 1 nota (tidak menulis ulang).
  6. ledger tidak ada -> fail closed 0 tulisan.
  7. tidak ada PR fiktif / handover / invoice / payment.
  8. DUA create bersamaan dengan kunci sama (race) -> tepat 1 nota.

Tidak menyentuh Supabase, tidak menyentuh DB produksi, tidak ada data nyata.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = os.path.join(os.environ.get('TMPDIR') or '/tmp', 'bakpau-api-realdb')

PGADMIN = os.environ.get('PGADMIN', 'postgresql://postgres@127.0.0.1:55434/postgres')
MIGDIR = os.environ.get(
    'MIGDIR',
    '/home/ubuntu/.hermes/kanban/boards/purchasing-app/workspaces/t_03b41644'
)
DBNAME = os.environ.get('DBNAME', 'bakpau_api_t_dd743609')

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


print(f'\n=== 1. Database uji terisolasi: {DBNAME} ===')
run(['psql', PGADMIN, '-X', '-q', '-c', f'drop database if exists {DBNAME}'], stdout=subprocess.DEVNULL)
if run(['psql', PGADMIN, '-X', '-q', '-c', f'create database {DBNAME}'], stdout=subprocess.DEVNULL):
    sys.exit('GAGAL membuat database uji')

print('\n=== 2. Fixture baseline live-like (t_03b41644) ===')
if not os.path.isdir(MIGDIR):
    sys.exit(f'GAGAL: MIGDIR tidak ada: {MIGDIR}')
if psql(PGURL_DB, ['-f', os.path.join(MIGDIR, 'test', 'fixture_baseline.sql')]):
    sys.exit('GAGAL apply fixture')

print('\n=== 3. Migrasi ledger Bakpau (DRAFT, di DB uji saja) ===')
LEDGER = os.path.join(REPO, 'migrations', '2026-10-21_bakpau_connector_ledger.sql')
if not os.path.isfile(LEDGER):
    sys.exit(f'GAGAL: migrasi tidak ada: {LEDGER}')
if psql(PGURL_DB, ['-f', LEDGER]):
    sys.exit('GAGAL apply migrasi ledger')
print('  ledger bakpau_events applied ke DB UJI (bukan produksi)')

print('\n=== 4. Sandbox modul aplikasi VERBATIM ===')
if os.path.exists(SB):
    shutil.rmtree(SB)

REL_FILES = ['lib/purchaseNote.js', 'modules/requests/leanRequest.js']
for root, dirs, files in os.walk(os.path.join(REPO, 'modules', 'receivings')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))
for f in sorted(os.listdir(os.path.join(REPO, 'lib', 'bakpau'))):
    if f.endswith('.js'):
        REL_FILES.append('lib/bakpau/' + f)


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
        if not spec.startswith('.'):
            return m.group(0)
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

# supabaseClient TIDAK dipakai: shim pg disuntikkan lewat apiHandler deps.
os.makedirs(os.path.join(SB, 'lib'), exist_ok=True)
open(os.path.join(SB, 'lib', 'supabaseClient.mjs'), 'w').write(
    'export const supabase = null\n'
)
shutil.copy(os.path.join(HERE, 'pgSupabaseShim.mjs'), os.path.join(SB, 'pgSupabaseShim.mjs'))
shutil.copy(os.path.join(HERE, 'real_db_test.mjs'), os.path.join(SB, 'real_db_test.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)

print(f'  sandbox: {SB} ({len(REL_FILES)} file sumber)')
if run(['node', 'compile_sandbox.mjs'], cwd=SB):
    sys.exit('GAGAL kompilasi sandbox')

print('\n=== 5. Uji CREATE terhadap PostgreSQL NYATA ===')
env = dict(os.environ, PGURL=PGURL_DB)
rc = run(['node', 'real_db_test.mjs'], cwd=SB, env=env)
sys.exit(rc)
