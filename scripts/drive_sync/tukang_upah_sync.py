#!/usr/bin/env python3
"""
Drive Sync — DASHBOARD UPAH TUKANG (Google Sheets) -> Supabase tukang_dashboards
================================================================================
READ-ONLY ke Google Drive: script ini HANYA membaca spreadsheet.

Sumber : folder "BAKSO - ACCOUNTING" (di bawah Project/5. Invoice & conf/
         00 HERMES AGENT PLAYFIELD/BAKPAU - FINANCE).
         File per tukang berpola "*_Simple_Upah_Kasbon" (Google Sheets),
         tab 'Dashboard' — hasil rekapitulasi upah borongan & kasbon.
Target : Supabase tabel public.tukang_dashboards
         (via RPC sync_write_tukang_dashboards / sync_status_*_id, token rahasia)

Mode:
  --once     : jalankan sync sekali
  --daemon   : polling tiap N detik; sync bila requested_at > last_synced_at
               (dipakai tombol "🔄 Refresh Sekarang" dari web app)

Token: /home/ubuntu/.hermes/drive_sync_token.txt (chmod 600) — sama dengan
       daemon drive-sync (tabel private_secrets key 'drive_sync_token').
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.environ.get('DRIVE_SYNC_TOKEN_FILE', '/home/ubuntu/.hermes/drive_sync_token.txt')
SB_URL_FILE = os.path.join(BASE_DIR, 'sb_url.txt')
SB_KEY_FILE = os.path.join(BASE_DIR, 'sb_key.txt')
GOOGLE_TOKEN_FILE = '/home/ubuntu/.hermes/google_token.json'

# Folder "BAKSO - ACCOUNTING" — daemon memindai file dashboard tukang di sini.
BAKSO_FOLDER_ID = '116Ruo90LZkCkRLv8AORbpIMddbfn1DDZ'
# Fallback bila pemindaian folder gagal (sheet id terverifikasi 11 Okt 2026).
FALLBACK_SHEETS = {
    'asep': '1rDddWjHSV0egk6wRDuEWfT5KjPQWLDGrxMS5fGe5tO4',
    'pujon': '12AZYVVV8_PoscDvjWlA2yjTTSim_uBsdBGGQu-OkOlk',
}

STATUS_ID = 'tukang_upah'
POLL_INTERVAL = int(os.environ.get('TUKANG_SYNC_POLL_SECONDS', '45'))

# Label NON-proyek di tab 'List Proyek' (baris subtotal & blok proyeksi yang
# ikut terbaca sebagai kolom B). Dibandingkan case-insensitive setelah strip.
# Lihat docstring fetch_list_proyek — baris ini pernah membuat sync pujon
# gagal 4 hari berturut-turut (DB 409 duplicate key).
NON_PROJECT_LABELS = {
    'total project',
    'total kasbon',
    'berjalan',
    'periode sebelumnya',
    'proyeksi',
    'total',
}


def read_text(path):
    with open(path, 'r') as f:
        return f.read().strip()


def http_json(url, method='GET', headers=None, body=None, timeout=60):
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode('utf-8')
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', errors='replace')
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = raw[:400]
        return e.code, parsed


def google_access_token():
    tok = json.load(open(GOOGLE_TOKEN_FILE))
    body = urllib.parse.urlencode({
        'client_id': tok['client_id'],
        'client_secret': tok['client_secret'],
        'refresh_token': tok['refresh_token'],
        'grant_type': 'refresh_token',
    }).encode('utf-8')
    req = urllib.request.Request('https://oauth2.googleapis.com/token', data=body, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode('utf-8'))['access_token']


def discover_sheets(access_token):
    """Pindai folder BAKSO - ACCOUNTING untuk file dashboard tukang.

    Return dict {tukang_key: {'name': ..., 'sheet_id': ...}}. File XLSX dengan
    nama serupa diabaikan (hanya mimeType spreadsheet = Google Sheets).
    """
    q = urllib.parse.quote(
        f"'{BAKSO_FOLDER_ID}' in parents and trashed = false "
        f"and mimeType = 'application/vnd.google-apps.spreadsheet'"
    )
    url = (f'https://www.googleapis.com/drive/v3/files?q={q}'
           f'&fields=files(id,name)&pageSize=100')
    status, data = http_json(url, headers={'Authorization': f'Bearer {access_token}'})
    out = {}
    if status == 200 and data.get('files'):
        for f in data['files']:
            m = re.match(r'^([A-Za-z]+)[_\s-]+Simple[_\s-]*Upah', f['name'])
            if not m:
                continue
            key = m.group(1).lower()
            out[key] = {'name': f['name'], 'sheet_id': f['id']}
    if not out:
        # Fallback statis bila folder tidak bisa dipindai.
        for key, sid in FALLBACK_SHEETS.items():
            out[key] = {'name': f'{key.capitalize()}_Simple_Upah_Kasbon', 'sheet_id': sid}
    return out


def parse_rupiah_loose(s):
    """'Rp 9,500' / '(-Rp 9,500)' / '-Rp 32,107' / '-' -> float / None.

    Nilai dalam kurung atau berawalan minus = negatif.
    Mendukung DUA konvensi format angka:
      - US/Sheets-default : '15,000.76'  (koma ribuan, titik desimal)
      - Indonesia         : '15.000,76'  (titik ribuan, koma desimal)
    Tanpa penanganan ini, '15.000,76' salah dibaca jadi 1500076.
    """
    if s is None:
        return None
    t = str(s).strip()
    if not t or t in ('-', '–', '—'):
        return None
    neg = t.startswith('-') or t.startswith('(') or '(-' in t
    # Ambil hanya karakter angka + pemisah
    num = re.sub(r'[^\d.,]', '', t)
    if not num:
        return None
    # Tentukan konvensi: pemisah terakhir = desimal (jika ada 1-2 digit di belakangnya)
    last_dot = num.rfind('.')
    last_comma = num.rfind(',')
    dec_sep = None
    if last_dot > last_comma and last_dot != -1:
        dec_sep = '.'
    elif last_comma > last_dot and last_comma != -1:
        dec_sep = ','
    if dec_sep:
        head, _, tail = num.rpartition(dec_sep)
        # Desimal hanya bila 1-2 digit (mis. '15.000,76'); '15,000' gaya US = ribuan
        if tail.isdigit() and 1 <= len(tail) <= 2:
            int_part = re.sub(r'[.,]', '', head)
            val = float(f'{int_part}.{tail}') if int_part else float(f'0.{tail}')
            return -val if neg else val
    digits = re.sub(r'[.,]', '', num)
    if not digits:
        return None
    val = float(digits)
    return -val if neg else val


def fetch_dashboard(access_token, sheet_id):
    """Baca tab 'Dashboard' satu file tukang (READ-ONLY).

    Struktur (terverifikasi 11 Okt 2026):
      R2  : 'Nama Tukang / Subkon: X | Unit Bisnis: Y'
      R4  : header ringkasan (kolom B/E/H/J)
      R5  : nilai ringkasan  [hak_upah, kasbon, pelunasan, saldo]
      R9  : header tabel batch
      R10+: baris batch … sampai baris 'TOTAL KESELURUHAN BATCH'
    """
    rng = urllib.parse.quote("Dashboard!A1:Z120")
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{rng}?majorDimension=ROWS'
    status, data = http_json(url, headers={'Authorization': f'Bearer {access_token}'})
    if status != 200:
        raise RuntimeError(f'Sheets API HTTP {status}: {str(data)[:200]}')
    values = data.get('values', [])
    if len(values) < 5:
        raise RuntimeError('Tab Dashboard kosong / struktur tidak dikenal')

    def cell(row_idx, col_idx):
        if row_idx >= len(values):
            return ''
        row = values[row_idx]
        if col_idx >= len(row):
            return ''
        return str(row[col_idx]).strip()

    # --- Identitas tukang (baris 2) ---
    line2 = ' | '.join(str(c) for c in (values[1] if len(values) > 1 else []))
    name, unit = None, None
    m = re.search(r'Nama\s+Tukang\s*/\s*Subkon\s*:\s*([^|]+)', line2, re.IGNORECASE)
    if m:
        name = m.group(1).strip()
    m = re.search(r'Unit\s+Bisnis\s*:\s*([^|]+)', line2, re.IGNORECASE)
    if m:
        unit = m.group(1).strip()

    # --- Ringkasan (baris 5; kolom B=1, E=4, H=7, J=9) ---
    hak = parse_rupiah_loose(cell(4, 1))
    kasbon = parse_rupiah_loose(cell(4, 4))
    pelunasan = parse_rupiah_loose(cell(4, 7))
    saldo = parse_rupiah_loose(cell(4, 9))

    # --- Tabel batch (mulai baris 10 / index 9) ---
    batches = []
    total_row = None
    for i in range(9, min(len(values), 120)):
        row = values[i]
        if not row or not any(str(c).strip() for c in row):
            continue
        joined = ' | '.join(str(c) for c in row)
        if 'TOTAL KESELURUHAN' in joined.upper():
            total_row = {
                'label': str(row[2]).strip() if len(row) > 2 else 'TOTAL KESELURUHAN BATCH',
                'total_upah': parse_rupiah_loose(row[4] if len(row) > 4 else None),
                'total_kasbon': parse_rupiah_loose(row[5] if len(row) > 5 else None),
                'sisa_bersih': parse_rupiah_loose(row[6] if len(row) > 6 else None),
                'pelunasan': parse_rupiah_loose(row[7] if len(row) > 7 else None),
                'status': str(row[10]).strip() if len(row) > 10 else None,
            }
            break
        no = str(row[1]).strip() if len(row) > 1 else ''
        if not re.match(r'^\d+$', no):
            continue  # lewati baris header / catatan
        batches.append({
            'no': no,
            'periode': str(row[2]).strip() if len(row) > 2 else '',
            'proyek': str(row[3]).strip() if len(row) > 3 else '',
            'total_upah': parse_rupiah_loose(row[4] if len(row) > 4 else None),
            'total_kasbon': parse_rupiah_loose(row[5] if len(row) > 5 else None),
            'sisa_bersih': parse_rupiah_loose(row[6] if len(row) > 6 else None),
            'pelunasan': parse_rupiah_loose(row[7] if len(row) > 7 else None),
            'metode': str(row[8]).strip() if len(row) > 8 else '',
            'saldo_berjalan': parse_rupiah_loose(row[9] if len(row) > 9 else None),
            'status': str(row[10]).strip() if len(row) > 10 else '',
        })

    return {
        'tukang_name': name,
        'unit_bisnis': unit,
        'total_hak_upah': hak,
        'total_kasbon': kasbon,
        'total_pelunasan': pelunasan,
        'saldo_berjalan': saldo,
        'batches': batches,
        'total_row': total_row,
        'source_sheet_id': sheet_id,
        'source_url': f'https://docs.google.com/spreadsheets/d/{sheet_id}/edit',
    }


def fetch_list_proyek(access_token, sheet_id):
    """Baca tab 'List Proyek' (READ-ONLY). Return list of dict rows.

    Struktur (terverifikasi 11 Okt 2026): header di baris 2
      kolom B=Project, C=Total Upah, D=Status, E=Batch.

    PENGAMAN (fix 15 Okt 2026 — sync pujon gagal 4 hari karena 23505):
    Sheet asli juga memuat baris NON-proyek di bawah daftar proyek:
      - 'Total project'   (baris subtotal)
      - 'Total kasbon' / 'Berjalan' / 'periode sebelumnya' / 'Proyeksi'
      - 'minggu ke 3 oct' (baris proyeksi)
    dan SATU proyek bisa muncul di DUA blok (daftar utama + blok tambahan),
    contoh: 'Project Steffi' muncul 2x. Tabel tukang_projects punya
    UNIQUE (tukang_key, project_name) sehingga baris duplikat/non-proyek
    membuat SELURUH sync kind 'projects' gagal (DB 409).

    Aturan filter:
      1. Buang baris yang namanya sama dengan label non-proyek (daftar tetap
         di NON_PROJECT_LABELS) atau berawalan 'minggu ke'.
      2. Dedupe per nama proyek: kemunculan PERTAMA menang (blok utama lebih
         lengkap: punya status & batch). Kemunculan berikutnya dilewati.
    """
    rng = urllib.parse.quote("List Proyek!A1:H400")
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{rng}?majorDimension=ROWS'
    status, data = http_json(url, headers={'Authorization': f'Bearer {access_token}'})
    if status != 200:
        raise RuntimeError(f'List Proyek HTTP {status}: {str(data)[:200]}')
    values = data.get('values', [])
    out = []
    order = 0
    seen = set()
    for raw in values[2:]:  # data mulai baris 3
        def cell(i):
            return str(raw[i]).strip() if i < len(raw) else ''
        name = cell(1)
        if not name:
            continue
        low = name.lower()
        # 1) Buang baris non-proyek (subtotal & blok proyeksi di bawah sheet).
        if low in NON_PROJECT_LABELS or low.startswith('minggu ke'):
            continue
        # 2) Dedupe: kemunculan pertama menang (lihat docstring).
        key = low
        if key in seen:
            continue
        seen.add(key)
        order += 1
        out.append({
            'project_name': name,
            'total_upah': parse_rupiah_loose(cell(2)),
            'status': cell(3),
            'batch': cell(4),
            'sort_order': order,
        })
    return out


def fetch_rincian_upah(access_token, sheet_id):
    """Baca tab 'Rincian Upah' (READ-ONLY). Return list of dict rows.

    Struktur (terverifikasi 11 Okt 2026): header di baris 5
      A=Project (dipakai bila baris berikutnya kosong), B=Pekerjaan,
      C=Ukuran, D=Harga Satuan, E=Upah Rincian, F=Total Proyek, G=Catatan.
    Baris 'Total Project X' = subtotal (kolom F terisi, B berisi teks Total).
    """
    rng = urllib.parse.quote("Rincian Upah!A1:H900")
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{rng}?majorDimension=ROWS'
    status, data = http_json(url, headers={'Authorization': f'Bearer {access_token}'})
    if status != 200:
        raise RuntimeError(f'Rincian Upah HTTP {status}: {str(data)[:200]}')
    values = data.get('values', [])
    out = []
    last_proj = ''
    order = 0
    for raw in values[5:]:  # data mulai baris 6
        def cell(i):
            return str(raw[i]).strip() if i < len(raw) else ''
        proj = cell(0) or last_proj
        pekerjaan = cell(1)
        if not pekerjaan and not cell(5):
            continue  # baris kosong
        if cell(0):
            last_proj = cell(0)
        order += 1
        out.append({
            'project_name': proj or '—',
            'pekerjaan': pekerjaan or '—',
            'ukuran': parse_rupiah_loose(cell(2)),
            'harga_satuan': parse_rupiah_loose(cell(3)),
            'upah_rincian': parse_rupiah_loose(cell(4)),
            'total_proyek': parse_rupiah_loose(cell(5)),
            'catatan': cell(6),
            'sort_order': order,
        })
    return out


def fetch_total_kasbon(access_token, sheet_id):
    """Baca tab 'Total Kasbon' (READ-ONLY). Return list of dict rows.

    Struktur (terverifikasi 11 Okt 2026): header di baris 5
      A=Tanggal, B=Jenis, C=Deskripsi, D=Metode, E=Nominal, F=created by, G=Bukti.
    """
    rng = urllib.parse.quote("Total Kasbon!A1:H600")
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{rng}?majorDimension=ROWS'
    status, data = http_json(url, headers={'Authorization': f'Bearer {access_token}'})
    if status != 200:
        raise RuntimeError(f'Total Kasbon HTTP {status}: {str(data)[:200]}')
    values = data.get('values', [])
    out = []
    order = 0
    for raw in values[5:]:  # data mulai baris 6
        def cell(i):
            return str(raw[i]).strip() if i < len(raw) else ''
        if not cell(0) and not cell(4):
            continue
        order += 1
        out.append({
            'tanggal': parse_date_loose(cell(0)),
            'jenis': cell(1),
            'deskripsi': cell(2),
            'metode': cell(3),
            'nominal': parse_rupiah_loose(cell(4)),
            'bukti': cell(6),
            'sort_order': order,
        })
    return out


def parse_date_loose(s):
    """'19-Sep-2026' / '7-Dec-2024' / '2026-09-19' -> 'YYYY-MM-DD' / None."""
    t = str(s or '').strip()
    if not t:
        return None
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', t)
    if m:
        return f'{m.group(1)}-{m.group(2)}-{m.group(3)}'
    m = re.match(r'^(\d{1,2})[-/](\w{3})[-/](\d{4})$', t)
    if m:
        months = {'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'mei':5,'jun':6,'jul':7,'aug':8,'agu':8,'sep':9,'oct':10,'okt':10,'nov':11,'dec':12,'des':12}
        mo = months.get(m.group(2).lower())
        if mo:
            return f'{m.group(3)}-{mo:02d}-{int(m.group(1)):02d}'
    return None


def status_write(sb_url, sb_key, token, st, msg, rows, trigger):
    http_json(f'{sb_url}/rest/v1/rpc/sync_status_write_id', method='POST',
              headers={'apikey': sb_key, 'Authorization': f'Bearer {sb_key}', 'Content-Type': 'application/json'},
              body={'p_token': token, 'p_id': STATUS_ID, 'p_status': st,
                    'p_message': msg[:500], 'p_rows': rows, 'p_trigger': trigger})


def run_sync(trigger):
    """Satu siklus sync. Return (ok, message, rows)."""
    sb_url = read_text(SB_URL_FILE)
    sb_key = read_text(SB_KEY_FILE)
    sync_token = read_text(TOKEN_FILE)

    try:
        access_token = google_access_token()
        sheets = discover_sheets(access_token)
        rows = []
        errors = []
        detail_counts = {'projects': 0, 'items': 0, 'kasbon': 0}
        for key, info in sorted(sheets.items()):
            try:
                d = fetch_dashboard(access_token, info['sheet_id'])
                d['tukang_key'] = key
                rows.append(d)
            except Exception as e:
                errors.append(f'{key}: {e}')
                continue
            # Tab detail per proyek (Rincian Upah / List Proyek / Total Kasbon).
            # Kegagalan salah satu tab TIDAK menggagalkan dashboard utama —
            # data lama di tabel itu dipertahankan (tidak di-DELETE).
            # Ambil dulu ketiga jenis data, hitung agregat per proyek, baru tulis.
            fetched = {}
            for kind, fetcher in (
                ('projects', fetch_list_proyek),
                ('items', fetch_rincian_upah),
                ('kasbon', fetch_total_kasbon),
            ):
                try:
                    fetched[kind] = fetcher(access_token, info['sheet_id'])
                except Exception as e:
                    errors.append(f'{key}/{kind}: {e}')

            # Agregat per proyek dari item pekerjaan (supaya UI tidak perlu
            # menarik semua item hanya untuk menghitung jumlah & total):
            #   item_count  = baris pekerjaan (BUKAN baris subtotal 'Total Project X')
            #   total_rincian = SUM(upah_rincian) + SUM(total_proyek) baris subtotal
            if 'items' in fetched and 'projects' in fetched:
                agg = {}
                for it in fetched['items']:
                    pn = it.get('project_name') or '—'
                    a = agg.setdefault(pn, {'count': 0, 'sum': 0.0})
                    pek = str(it.get('pekerjaan') or '')
                    is_subtotal = pek.lower().startswith('total')
                    if not is_subtotal:
                        a['count'] += 1
                    a['sum'] += float(it.get('upah_rincian') or 0)
                    a['sum'] += float(it.get('total_proyek') or 0)
                for p in fetched['projects']:
                    a = agg.get(p.get('project_name'))
                    p['item_count'] = a['count'] if a else 0
                    p['total_rincian'] = a['sum'] if a else None

            for kind, detail_rows in fetched.items():
                try:
                    st2, data2 = http_json(f'{sb_url}/rest/v1/rpc/sync_replace_tukang_detail', method='POST',
                                           headers={'apikey': sb_key, 'Authorization': f'Bearer {sb_key}', 'Content-Type': 'application/json'},
                                           body={'p_token': sync_token, 'p_tukang_key': key, 'p_kind': kind, 'p_rows': detail_rows})
                    if st2 == 200 and data2 and data2.get('ok'):
                        detail_counts[kind] += data2.get('rows', len(detail_rows))
                    else:
                        errors.append(f'{key}/{kind}: DB {st2} {str(data2)[:120]}')
                except Exception as e:
                    errors.append(f'{key}/{kind}: {e}')
        if not rows:
            raise RuntimeError('Tidak ada dashboard tukang yang berhasil dibaca. ' + '; '.join(errors))
    except Exception as e:
        msg = f'Gagal baca Google Sheets: {e}'
        status_write(sb_url, sb_key, sync_token, 'ERROR', msg, 0, trigger)
        return False, msg, 0

    status, data = http_json(f'{sb_url}/rest/v1/rpc/sync_write_tukang_dashboards', method='POST',
                             headers={'apikey': sb_key, 'Authorization': f'Bearer {sb_key}', 'Content-Type': 'application/json'},
                             body={'p_token': sync_token, 'p_rows': rows})
    if status != 200 or not data or not data.get('ok'):
        msg = f'Gagal tulis DB: HTTP {status} {str(data)[:300]}'
        status_write(sb_url, sb_key, sync_token, 'ERROR', msg, 0, trigger)
        return False, msg, 0

    n = data.get('rows', len(rows))
    msg = f'Sinkron sukses: {n} dashboard tukang (' + ', '.join(sorted(sheets.keys())) + ').'
    msg += f' Detail: {detail_counts["projects"]} proyek, {detail_counts["items"]} item pekerjaan, {detail_counts["kasbon"]} kasbon.'
    if errors:
        msg += f' Sebagian gagal: {"; ".join(errors)[:200]}'
    status_write(sb_url, sb_key, sync_token, 'OK', msg, n, trigger)
    return True, msg, n


def get_status():
    sb_url = read_text(SB_URL_FILE)
    sb_key = read_text(SB_KEY_FILE)
    sync_token = read_text(TOKEN_FILE)
    status, data = http_json(f'{sb_url}/rest/v1/rpc/sync_status_read_id', method='POST',
                             headers={'apikey': sb_key, 'Authorization': f'Bearer {sb_key}', 'Content-Type': 'application/json'},
                             body={'p_token': sync_token, 'p_id': STATUS_ID})
    if status == 200 and data and data.get('ok'):
        return data.get('status') or {}
    return {}


def parse_ts(s):
    if not s:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except Exception:
        return None


def daemon_loop():
    print(f'[daemon] tukang-upah polling tiap {POLL_INTERVAL}s — Ctrl+C untuk berhenti', flush=True)
    auto_enabled = os.environ.get('TUKANG_SYNC_AUTO', '1') != '0'
    auto_hours = float(os.environ.get('TUKANG_SYNC_AUTO_HOURS', '24'))
    while True:
        try:
            st = get_status()
            req = parse_ts(st.get('requested_at'))
            last = parse_ts(st.get('last_synced_at'))
            if req and (last is None or req > last):
                print(f'[daemon] ada permintaan sync (requested_at={st.get("requested_at")}) — jalan…', flush=True)
                ok, msg, n = run_sync('manual')
                print(f'[daemon] hasil: ok={ok} rows={n} — {msg}', flush=True)
            elif auto_enabled:
                from datetime import datetime, timezone, timedelta
                now = datetime.now(timezone.utc)
                stale = last is None or (now - last) > timedelta(hours=auto_hours)
                if stale:
                    print(f'[daemon] sync otomatis (terakhir: {st.get("last_synced_at") or "belum pernah"}) — jalan…', flush=True)
                    ok, msg, n = run_sync('cron')
                    print(f'[daemon] hasil otomatis: ok={ok} rows={n} — {msg}', flush=True)
        except Exception as e:
            print(f'[daemon] error siklus: {e}', flush=True)
        time.sleep(POLL_INTERVAL)


def main():
    args = sys.argv[1:]
    if '--daemon' in args:
        daemon_loop()
        return
    trigger = 'manual' if '--manual' in args else 'cron'
    ok, msg, n = run_sync(trigger)
    print(json.dumps({'ok': ok, 'rows': n, 'message': msg}, ensure_ascii=False))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
