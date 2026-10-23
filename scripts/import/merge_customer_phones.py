#!/usr/bin/env python3
"""Lengkapi nomor WA yang kosong + tambah customer baru dari sheet Hampers.

Sumber: Client_Database.xlsx, sheet `Xmast Hampers 24` & `Xmast Hampers 25`
(di file yang sama dengan Sheet1). Keputusan DAT (24 Okt 2026): jalankan opsi A
— lengkapi WA yang kosong DAN tambah customer baru, semua status CUSTOMER.

Aturan pencocokan nama (jangan menebak):
  - normalisasi: huruf kecil, buang tanda baca, rapikan spasi
  - PREFIX sapaan dibuang di kedua sisi: ko, ci, kak, bu, ibu, pak, bapak,
    mr, mrs, ms, mas, mbak  -> supaya "Wira & Venti" cocok dengan
    "Ko Wira & Ci Venti"
  - kata sambung dibuang: &, dan, n
  - HANYA cocok bila hasil normalisasi identik. Tidak ada fuzzy matching.

Baris rekap (nama 1-2 huruf seperti A/B/C/D di sheet Hampers24 yang isinya
qty candle) otomatis dibuang. Nomor dianggap valid hanya bila diawali 62/0/+
dan punya >=9 digit.

Idempoten: nama yang sudah ada tidak diduplikasi, nomor yang sudah terisi
tidak ditimpa.

Pakai:
  python3 scripts/import/merge_customer_phones.py --dry-run
  python3 scripts/import/merge_customer_phones.py --apply
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

import openpyxl

XLSX = '/home/ubuntu/.hermes/webui/attachments/fff4b1110401/Client_Database.xlsx'
ENV = '/home/ubuntu/dev-workspaces/purchasing-release-compact/.env.local'
SESSION = '/tmp/papp_admin_session_fresh.json'
SOURCES = ['Xmast Hampers 24', 'Xmast Hampers 25']

SAPAN = {'ko', 'ci', 'kak', 'bu', 'ibu', 'pak', 'bapak', 'mr', 'mrs', 'ms',
         'mas', 'mbak', 'om', 'tante', 'koh', 'cik'}
SAMBUNG = {'&', 'dan', 'n', 'and'}


def read_env(path):
    vals = {}
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def norm(name):
    """Kunci pencocokan nama. Buang sapaan + kata sambung."""
    s = re.sub(r'[^a-z0-9 ]', ' ', str(name).lower())
    parts = [p for p in s.split() if p and p not in SAPAN and p not in SAMBUNG]
    return ' '.join(parts)


def is_phone(v):
    if v is None:
        return False
    s = str(v).strip().replace(' ', '')
    if not re.match(r'^(\+?62|0)', s):
        return False
    return len(re.sub(r'\D', '', s)) >= 9


def parse_sheet(wb, sheet, start_row=1):
    ws = wb[sheet]
    out = []
    cur = None
    for r in ws.iter_rows(min_row=start_row, values_only=True):
        def s(i):
            v = r[i] if len(r) > i else None
            return str(v).strip() if v is not None else ''
        nama, addr, phone = s(2), s(3), s(4)
        if nama and nama != 'Name':
            cur = {'nama': nama, 'alamat': addr, 'wa': phone, 'sheet': sheet}
            out.append(cur)
        elif cur and addr and addr != 'None':
            cur['alamat'] = (cur['alamat'] + ' ' + addr).strip()
    return out


def call(url, token, path, method='GET', body=None, prefer=None, anon=None):
    """apikey = ANON key (wajib), Authorization = Bearer <access_token user>."""
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
    args = ap.parse_args()

    env = read_env(ENV)
    url = env['NEXT_PUBLIC_SUPABASE_URL']
    anon = env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
    os.environ['SB_ANON'] = anon
    token = json.load(open(SESSION))['access_token']

    wb = openpyxl.load_workbook(XLSX, data_only=True)
    pool = {}
    for sheet in SOURCES:
        for rec in parse_sheet(wb, sheet):
            if len(rec['nama']) <= 2:      # buang baris rekap A/B/C/D
                continue
            pool.setdefault(norm(rec['nama']), []).append(rec)
    print(f'Kandidat dari {len(SOURCES)} sheet Hampers: {sum(len(v) for v in pool.values())} baris, {len(pool)} nama unik')

    st, existing = call(url, token, '/rest/v1/customers?select=id,nama,wa,alamat,status')
    if st != 200:
        sys.exit(f'gagal membaca customers: {st} {existing}')
    print(f'Customer di database: {len(existing)}')

    by_norm = {}
    for row in existing:
        by_norm.setdefault(norm(row['nama']), []).append(row)

    to_update, to_insert = [], []
    for key, cands in pool.items():
        phone = next((c['wa'] for c in cands if is_phone(c['wa'])), None)
        addr = next((c['alamat'] for c in cands if c['alamat']), None)
        if key in by_norm:
            row = by_norm[key][0]
            patch = {}
            if not (row.get('wa') or '').strip() and phone:
                patch['wa'] = phone
            if not (row.get('alamat') or '').strip() and addr:
                patch['alamat'] = addr
            if patch:
                to_update.append({'id': row['id'], 'nama': row['nama'], 'patch': patch,
                                  'from': cands[0]['sheet']})
        else:
            to_insert.append({'nama': cands[0]['nama'], 'wa': phone,
                              'alamat': addr, 'status': 'CUSTOMER',
                              'from': cands[0]['sheet']})

    print(f'\nAKAN DILENGKAPI : {len(to_update)} customer (nomor WA / alamat kosong)')
    for u in to_update:
        print(f"  + {u['nama'][:28]:28} {u['patch'].get('wa') or u['patch'].get('alamat','')[:40]:24} ({u['from']})")
    print(f'\nAKAN DITAMBAH   : {len(to_insert)} customer baru')
    for i in to_insert:
        print(f"  + {i['nama'][:28]:28} {i['wa'] or '(tanpa WA)':22} ({i['from']})")

    if not args.apply:
        print('\n(dry-run — tidak ada yang ditulis. Tambahkan --apply.)')
        return

    ok_u = 0
    for u in to_update:
        st, res = call(url, token, f"/rest/v1/customers?id=eq.{u['id']}", 'PATCH', u['patch'],
                       'return=representation')
        if st in (200, 204):
            ok_u += 1
        else:
            print(f"  GAGAL update {u['nama']}: {st} {res}")

    ok_i = 0
    for i in to_insert:
        payload = {k: i[k] for k in ('nama', 'wa', 'alamat', 'status')}
        st, res = call(url, token, '/rest/v1/customers', 'POST', payload, 'return=representation')
        if st in (200, 201):
            ok_i += 1
        else:
            print(f"  GAGAL insert {i['nama']}: {st} {res}")

    st, final = call(url, token, '/rest/v1/customers?select=id,nama,wa,alamat,status')
    print(f'\nHASIL: {ok_u} dilengkapi, {ok_i} ditambahkan')
    print(f'TOTAL customer sekarang: {len(final or [])}')
    print(f'  punya WA     : {sum(1 for x in (final or []) if (x.get("wa") or "").strip())}')
    print(f'  tanpa WA     : {sum(1 for x in (final or []) if not (x.get("wa") or "").strip())}')
    print(f'  punya alamat : {sum(1 for x in (final or []) if (x.get("alamat") or "").strip())}')
    print(f'  status CUSTOMER: {sum(1 for x in (final or []) if x["status"] == "CUSTOMER")}')


if __name__ == '__main__':
    main()
