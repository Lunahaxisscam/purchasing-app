#!/usr/bin/env python3
"""
PROBE READ-ONLY: kesiapan ledger serah-terima di database yang dipakai app.

Tujuan: membuktikan APA ADANYA apakah tabel/RPC migrasi
`migrations/2026-10-23_compact_ops_flow.DRAFT.sql` sudah ada di database,
TANPA menulis apa pun (tidak ada INSERT/DDL/fixture).

Cara pakai (dari root repo):
    python3 scripts/compact-flow-test/probe_ledger_readiness.py
    python3 scripts/compact-flow-test/probe_ledger_readiness.py --env .env.local

Kredensial dibaca dari file env dan TIDAK pernah dicetak. Output hanya
status HTTP + kode error PostgREST, jadi aman ditempel di laporan.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

DEFAULT_ENV = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), '.env.local')

TABLES = ['ops_transfers', 'ops_stock_lots', 'ops_stock_allocations']
RPCS = [
    ('ops_transfer_apply', {'p_event_key': 'probe', 'p_source': 'PURCHASE',
                            'p_receiving_item_id': None, 'p_material_id': None,
                            'p_destination': 'GUDANG', 'p_quantity': 1,
                            'p_project_id': None, 'p_receiver': None}),
    ('pr_return_for_revision', {'p_pr_id': None, 'p_reason': 'probe'}),
]


def read_env(path):
    if not os.path.isfile(path):
        sys.exit(f'env file tidak ditemukan: {path}')
    vals = {}
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def pick(vals, *names):
    for n in names:
        if vals.get(n):
            return vals[n]
    return ''


def call(url, key, path, method='GET', body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url.rstrip('/') + path, data=data, method=method)
    req.add_header('apikey', key)
    req.add_header('Authorization', f'Bearer {key}')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Prefer', 'return=minimal')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:  # jaringan
        return 0, str(e)


def code_of(raw):
    try:
        j = json.loads(raw)
        if isinstance(j, dict):
            return j.get('code') or ''
    except Exception:
        pass
    m = re.search(r'"code"\s*:\s*"([^"]+)"', raw or '')
    return m.group(1) if m else ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--env', default=DEFAULT_ENV)
    args = ap.parse_args()

    vals = read_env(args.env)
    url = pick(vals, 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL')
    key = pick(vals, 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    if not url or not key:
        sys.exit('URL/anon key Supabase tidak ditemukan di env file.')

    print(f'Database target: {url}')
    print('(kredensial tidak dicetak)\n')

    st, raw = call(url, key, '/rest/v1/materials?select=id&limit=1')
    print(f'konektivitas materials      : HTTP {st} {code_of(raw)}'.rstrip())
    if st not in (200, 206):
        print('  -> koneksi/izin baca dasar gagal; hasil di bawah tidak dapat dipercaya.')

    missing = []
    for t in TABLES:
        st, raw = call(url, key, f'/rest/v1/{t}?select=id&limit=1')
        state = 'ADA' if st in (200, 206) else 'BELUM ADA'
        if state == 'BELUM ADA':
            missing.append(t)
        print(f'tabel {t:<24}: HTTP {st} {code_of(raw)} -> {state}'.rstrip())

    for fn, payload in RPCS:
        st, raw = call(url, key, f'/rest/v1/rpc/{fn}', method='POST', body=payload)
        state = 'ADA' if st not in (404,) else 'BELUM ADA'
        print(f'rpc   {fn:<24}: HTTP {st} {code_of(raw)} -> {state}'.rstrip())

    print()
    if missing:
        print('KESIMPULAN: ledger serah-terima BELUM aktif di database ini.')
        print('UI wajib tetap fail-closed (tidak menulis stok/cost). Aktivasi butuh go-ahead DAT.')
        return 1
    print('KESIMPULAN: tabel ledger sudah ada. Lanjutkan uji transaksi self-cleaning sebelum dipakai user.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
