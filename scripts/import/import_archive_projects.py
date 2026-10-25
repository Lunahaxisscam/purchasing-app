#!/usr/bin/env python3
"""Impor 85 project arsip dari Drive (3. ARCHIEVED_PROJECT) ke tabel projects.

Keputusan DAT (24 Okt 2026, opsi A): SEMUA folder arsip diimpor dengan status
DONE lalu ditautkan otomatis ke customer yang cocok. Dropdown PR/Pembelian
sudah menyaring status DONE (modules/requests/form.jsx) sehingga arsip tidak
muncul di alur kerja baru; riwayat tetap terlihat di CRM & Past Projects.

Sumber kebenaran nama: /tmp/arch_scan.json (hasil pemindaian Drive, memuat
nama folder asli 85 project). Format nama: "N. Person - Lokasi" (N boleh
hilang; ada nama tanpa person seperti "2024").

Pencocokan customer (konservatif — jangan menebak):
  - sapaan & kata sambung dibuang (aturan sama dengan merge_customer_phones)
  - tertaut bila "person" SAMA PERSIS dengan nama customer ternormalisasi,
    ATAU person adalah AWALAN dari nama TUNGGAL satu customer
    (dua kandidat atau lebih = ambigu = tidak ditautkan).
  - project lama yang sudah ada di DB juga ikut dicocokkan dengan aturan sama.

Idempoten: kode project yang sudah ada di DB tidak diimpor ulang; duplikat
nomor di dalam arsip diberi sufiks huruf (81, 81a, ...).

Pakai:
  python3 scripts/import/import_archive_projects.py            (dry-run)
  python3 scripts/import/import_archive_projects.py --apply
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

ENV = '/home/ubuntu/dev-workspaces/purchasing-release-compact/.env.local'
SESSION = '/tmp/papp_admin_session_fresh.json'
SCAN = '/tmp/arch_scan.json'
SCAN_REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'arch_scan.json')

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
    s = re.sub(r'[^a-z0-9 ]', ' ', str(name).lower())
    return ' '.join(p for p in s.split() if p and p not in SAPAN and p not in SAMBUNG)


def parse_folder_name(name):
    """'29. Agung - Vasaka Solterra Apt' -> ('29', 'Agung', 'Vasaka Solterra Apt')."""
    m = re.match(r'^\s*(\d+)\s*\.\s*(.*)$', name)
    num = m.group(1) if m else ''
    rest = (m.group(2) if m else name).strip()
    if ' - ' in rest:
        person, loc = rest.split(' - ', 1)
        return num, person.strip(), loc.strip()
    return num, rest, ''


def match_customer(person, loc, cust_by_norm, cust_names, alamat_of):
    """Customer utk bagian 'person' dari nama folder. Konservatif:
    1) sama persis (setelah buang sapaan/sambung), atau
    2) prefix unik — person adalah AWALAN dari nama TUNGGAL satu customer.
    Kasus sulit: ada kandidat PERSIS sekaligus kandidat PREFIKS
    (contoh: folder 'Iva - Meranti SS' vs customer 'Iva' dan
    'Iva, Vera & Family' yang alamatnya Cluster Meranti 7 No 9).
    Pemutus: kata LOKASI pada nama folder dicocokkan ke ALAMAT customer;
    kandidat dengan alamat paling cocok yang menang. Seri = tak ditautkan."""
    key = norm(person)
    if not key:
        return None
    exact = cust_by_norm.get(key)
    competing = [cid for nm, cid in cust_names if nm.startswith(key + ' ')]
    if not competing:
        return exact
    loc_words = set(norm(loc).split()) - {'ss', 'apt', 'no'}
    if not loc_words:
        return exact
    cands = ([exact] if exact else []) + competing

    def score(cid):
        return len(loc_words & set(norm(alamat_of.get(cid) or '').split()))

    best = max(cands, key=score)
    tops = [c for c in cands if score(c) == score(best)]
    return best if score(best) > 0 and len(tops) == 1 else exact


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

    scan_path = SCAN if os.path.exists(SCAN) else SCAN_REPO
    folders = json.load(open(scan_path))
    print(f'Folder arsip hasil pemindaian Drive: {len(folders)}')

    st, existing = call(url, token, '/rest/v1/projects?select=id,kode,name,status,customer_id')
    if st != 200:
        sys.exit(f'gagal membaca projects: {st} {existing}')
    st, customers = call(url, token, '/rest/v1/customers?select=id,nama,alamat')
    if st != 200:
        sys.exit(f'gagal membaca customers: {st} {customers}')

    cust_by_norm, cust_names, alamat_of = {}, [], {}
    for c in customers or []:
        key = norm(c['nama'])
        cust_by_norm.setdefault(key, c['id'])
        cust_names.append((key, c['id']))
        alamat_of[c['id']] = c.get('alamat') or ''
    print(f'Project di DB: {len(existing)} | customer: {len(cust_names)}')

    used_kode = {str(p.get('kode') or '').strip() for p in existing}
    used_name = {norm(p['name']) for p in existing}

    ins_rows, rel_rows = [], []
    for f in folders:
        num, person, loc = parse_folder_name(f['name'])
        name = f['name'].strip()
        kode = num
        if kode:  # sufiks bila nomor sudah terpakai (duplikat arsip / vs DB)
            base, i = kode, 0
            while kode in used_kode:
                i += 1
                kode = base + chr(96 + i)      # a, b, c, ...
        disp = name if not (norm(name) in used_name and loc) else f'{name} ({loc})'
        used_kode.add(kode)
        used_name.add(norm(disp))
        cid = match_customer(person, loc, cust_by_norm, cust_names, alamat_of)
        ins_rows.append({'kode': kode or None, 'name': disp,
                         'status': 'DONE', 'customer_id': cid, 'person': person})

    # project LAMA yang belum tertaut, cocokkan dengan aturan sama
    for p in existing:
        if p.get('customer_id'):
            continue
        person = str(p['name']).split(' - ')[0].strip()
        loc_rest = str(p['name']).split(' - ')[1].strip() if ' - ' in str(p['name']) else ''
        cid = match_customer(person, loc_rest, cust_by_norm, cust_names, alamat_of)
        if cid:
            rel_rows.append({'id': p['id'], 'name': p['name'], 'customer_id': cid})

    linked = [r for r in ins_rows if r['customer_id']]
    print(f'\nAKAN DIIMPOR : {len(ins_rows)} project (status DONE)')
    print(f'  otomatis tertaut ke customer: {len(linked)}')
    print(f'  belum tertaut (tak ada yang cocok): {len(ins_rows) - len(linked)}')
    print(f'AKAN DITAUTKAN (project lama): {len(rel_rows)}')
    for r in rel_rows:
        print(f"  + {r['name'][:45]:45} -> {r['customer_id'][:8]}…")
    print('\nContoh impor:')
    for r in ins_rows[:12]:
        mark = 'LINK' if r['customer_id'] else '----'
        print(f"  [{r['kode']}] {r['name'][:44]:44} {mark}")
    print('\nSemua yang tertaut:')
    for r in linked:
        print(f"  [{r['kode']}] {r['name'][:44]:44} person={r['person']}")

    if not args.apply:
        print('\n(dry-run — tidak ada yang ditulis. Tambahkan --apply.)')
        return

    ok_i = 0
    for r in ins_rows:
        payload = {k: r[k] for k in ('kode', 'name', 'status', 'customer_id')}
        st, res = call(url, token, '/rest/v1/projects', 'POST', payload, 'return=representation')
        if st in (200, 201):
            ok_i += 1
        else:
            print(f"  GAGAL insert {r['name']}: {st} {res}")
    ok_r = 0
    for r in rel_rows:
        st, res = call(url, token, f"/rest/v1/projects?id=eq.{r['id']}",
                       'PATCH', {'customer_id': r['customer_id']})
        if st in (200, 204):
            ok_r += 1
        else:
            print(f"  GAGAL relink {r['name']}: {st} {res}")

    st, final = call(url, token, '/rest/v1/projects?select=id,kode,name,status,customer_id')
    print(f'\nHASIL: {ok_i} project diimpor, {ok_r} project lama ditautkan')
    print(f'TOTAL project di DB sekarang: {len(final or [])}')
    done = [p for p in (final or []) if p['status'] == 'DONE']
    withc = [p for p in (final or []) if p.get('customer_id')]
    ong = [p for p in (final or []) if p['status'] != 'DONE']
    print(f'  status DONE    : {len(done)}')
    print(f'  punya customer : {len(withc)}')
    print(f'  bukan DONE (muncul di dropdown PR): {len(ong)}')


if __name__ == '__main__':
    main()
