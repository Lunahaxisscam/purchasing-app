#!/usr/bin/env python3
"""Impor customer lama dari Client_Database.xlsx (Sheet1) ke tabel `customers`.

Keputusan DAT (24 Okt 2026): sheet Sheet1 saja (A), semua status CUSTOMER (A),
alamat DISIMPAN (A).

Sifat: idempoten per nama. Bila nama sudah ada, baris TIDAK diduplikasi —
hanya kolom yang masih kosong (wa/alamat) yang dilengkapi.

Pakai:
  python3 scripts/import/import_customers.py --dry-run
  python3 scripts/import/import_customers.py --apply
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

import openpyxl

XLSX = '/home/ubuntu/.hermes/webui/attachments/fff4b1110401/Client_Database.xlsx'
ENV = '/home/ubuntu/dev-workspaces/purchasing-release-compact/.env.local'
SESSION = '/tmp/papp_admin_session_fresh.json'
SHEET = 'Sheet1'


def read_env(path):
    vals = {}
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def parse_sheet(path, sheet):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet]
    out = []
    cur = None
    for r in ws.iter_rows(values_only=True):
        nama = r[2] if len(r) > 2 else None
        addr = r[3] if len(r) > 3 else None
        phone = r[4] if len(r) > 4 else None

        def s(v):
            return str(v).strip() if v is not None else ''

        if s(nama) and s(nama) != 'Name':
            cur = {'nama': s(nama), 'alamat': s(addr), 'wa': s(phone)}
            out.append(cur)
        elif cur and s(addr):
            cur['alamat'] = (cur['alamat'] + ' ' + s(addr)).strip()
    return out


def call(url, token, path, method='GET', body=None, prefer=None, anon=None):
    """apikey = ANON key (wajib), Authorization = Bearer <access_token user>.

    Tertukar keduanya menghasilkan 'Invalid API key' dari PostgREST.
    """
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url.rstrip('/') + path, data=data, method=method)
    req.add_header('apikey', anon or os.environ['SB_ANON'])
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    if prefer:
        req.add_header('Prefer', prefer)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    env = read_env(ENV)
    url = env['NEXT_PUBLIC_SUPABASE_URL']
    anon = env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
    token = json.load(open(SESSION))['access_token']
    os.environ['SB_ANON'] = anon

    recs = parse_sheet(XLSX, SHEET)
    print(f'Dari {SHEET}: {len(recs)} customer')

    st, existing = call(url, token, '/rest/v1/customers?select=id,nama,wa,alamat')
    if st != 200:
        sys.exit(f'gagal membaca customers: {st} {existing}')
    by_name = {str(r['nama']).strip().lower(): r for r in (existing or [])}
    print(f'Sudah ada di database: {len(by_name)} customer')

    to_insert, to_update = [], []
    for r in recs:
        key = r['nama'].strip().lower()
        if key in by_name:
            row = by_name[key]
            patch = {}
            if not (row.get('wa') or '').strip() and r['wa']:
                patch['wa'] = r['wa']
            if not (row.get('alamat') or '').strip() and r['alamat']:
                patch['alamat'] = r['alamat']
            if patch:
                to_update.append((row['id'], r['nama'], patch))
        else:
            to_insert.append({
                'nama': r['nama'],
                'wa': r['wa'] or None,
                'alamat': r['alamat'] or None,
                'status': 'CUSTOMER'
            })

    print(f'Akan DITAMBAH : {len(to_insert)}')
    print(f'Akan DILENGKAPI: {len(to_update)}')
    print('\nContoh yang ditambahkan:')
    for r in to_insert[:5]:
        print('  -', r['nama'], '|', (r['wa'] or '(tanpa WA)'), '|', (r['alamat'] or '')[:45])

    if not args.apply:
        print('\n(dry-run — tidak ada yang ditulis. Tambahkan --apply untuk eksekusi.)')
        return

    ok_ins = 0
    for r in to_insert:
        st, res = call(url, token, '/rest/v1/customers', 'POST', r, 'return=representation')
        if st in (200, 201):
            ok_ins += 1
        else:
            print(f'  GAGAL insert {r["nama"]}: {st} {res}')

    ok_upd = 0
    for cid, nama, patch in to_update:
        st, res = call(url, token, f'/rest/v1/customers?id=eq.{cid}', 'PATCH', patch, 'return=representation')
        if st in (200, 204):
            ok_upd += 1
        else:
            print(f'  GAGAL update {nama}: {st} {res}')

    st, final = call(url, token, '/rest/v1/customers?select=id,nama,status,wa,alamat')
    print(f'\nHASIL: {ok_ins} ditambahkan, {ok_upd} dilengkapi')
    print(f'TOTAL customer di database sekarang: {len(final or [])}')
    cust = sum(1 for x in (final or []) if x['status'] == 'CUSTOMER')
    print(f'  status CUSTOMER: {cust} | PROSPEK: {len(final or []) - cust}')
    withwa = sum(1 for x in (final or []) if (x.get('wa') or '').strip())
    withaddr = sum(1 for x in (final or []) if (x.get('alamat') or '').strip())
    print(f'  punya WA: {withwa} | punya alamat: {withaddr}')


if __name__ == '__main__':
    main()
