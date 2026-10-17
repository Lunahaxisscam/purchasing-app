#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VALIDATOR STAGING INPUT MANUAL TERKONTROL (bit-dev) — t_0bb833f1
================================================================

Alat DRY-RURN murni: file staging (CSV) + snapshot master (JSON, read-only
export) -> laporan validasi + rencana apply INTENDED (tidak pernah menulis
database). Tidak ada koneksi DB, tidak ada jaringan, tidak ada write apa pun.

Posisi dalam pipeline (docs/manual-input-staging-spec.md):

    snapshot master (read-only) -> [VALIDATOR INI] -> report + plan
        -> review konflik -> approve admin -> apply transaksional
        (oleh tooling apply TERAPPROVAL terpisah — BUKAN file ini)
        -> readback reconciliation -> log batch

Aturan yang dijalankan (body t_0bb833f1):
  - mandatory IDs            : project_code / material kode / vendor name
                               wajib resolve ke master; FK tak boleh ditebak.
  - source row validation    : nilai moneter (harga) WAJIB source_file_id +
                               source_row — provenance historis tidak ditebak.
  - duplicate detection      : external_ref duplikat, natural key duplikat
                               dalam batch, dan bentrok vs master (INSERT
                               intent ke kunci yang sudah ada = CONFLICT,
                               bukan error senyap / auto-update).
  - reconciliation           : hitungan + total per batch, sha256 input,
                               schema_version snapshot (drift terdeteksi),
                               baris SKIP_UNCHANGED untuk retry idempoten.
  - BUKAN dua arah bebas sync: satu jalur masuk; baris hilang dari sheet
                               BUKAN perintah hapus; validator tidak apply.

Entitas dgn skema BELUM disetujui (vendor_categories, price_references)
hanya menghasilkan PLAN_STAGING dan selalu apply_blocked
SCHEMA_PENDING — schema owner tunggal reviewer_resek (t_03b41644);
jangan SQL mandiri.

Data contoh/dummy HANYA ada di fixture test (prefix "[CONTOH]"); template
di templates/ kosong (header saja) — tidak ada baris dummy yang tampil
seperti data nyata.

Pemakaian:
  python3 scripts/manual-input-staging/validate.py \
      --entity vendors --input staging_vendors.csv \
      --master master_snapshot.json --out out/ [--batch-id B-20261017-01]

Exit code: 0 = bersih; 1 = ada baris REJECTED; 3 = ada CONFLICT (perlu
review manusia); 2 = kesalahan pemakaian/file.
"""

import argparse
import csv
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

# ============================================================
# KONSTANTA MASTER
# ============================================================

# Versi skema snapshot yang didukung validator ini. Bila snapshot lebih
# baru, validator tetap jalan tapi menandai WARNING schema drift di
# manifest (risiko "schema version drift" di blueprint, bagian 9).
SUPPORTED_SNAPSHOT_SCHEMA_VERSION = "2026-10-17.1"

# Peta kategori -> prefix kode material. SUMBER KEBENARAN = lib/constants.js
# MATERIAL_KODE_PREFIXES (drift dijaga test:
# scripts/manual-input-staging-test/test_staging.py::test_kode_prefix_match_js).
MATERIAL_KODE_PREFIXES = {
    'Plywood & Board': 'PLY',
    'HPL & Edging': 'HPL',
    'WPC & Panel': 'WPC',
    'Hardware & Fitting': 'HWF',
    'Kelistrikan & Lampu': 'KEL',
    'Aluminium & Profil': 'ALM',
    'Bahan Habis Pakai': 'BHP'
}

PROJECT_STATUS_ENUM = {'NOT_START', 'ON_GOING', 'DONE'}

# Entitas dengan tabel master BELUM disetujui DAT (schema owner t_03b41644).
# Row valid tetap divalidasi & masuk plan sbg PLAN_STAGING, tapi apply
# selalu diblokir sampai migrasi approved ada.
SCHEMA_PENDING_ENTITIES = {
    'vendor_categories': 'SCHEMA_PENDING:vendor_categories (usulan blueprint MASTER; migrasi menunggu owner schema t_03b41644)',
    'price_references': 'SCHEMA_PENDING:material_price_refs (usulan blueprint MASTER; migrasi menunggu owner schema t_03b41644)',
}

# Definisi kolom per entitas. Universal columns wajib ada di SEMUA template.
UNIVERSAL_COLUMNS = ['record_id', 'external_ref', 'source_file_id', 'source_row', 'notes']

ENTITIES = {
    'projects': {
        'table': 'projects',
        'columns': ['project_code', 'name', 'status', 'customer_note'],
        'required': ['project_code', 'name'],
        'natural_key': ['project_code'],
        'monetary': [],
        'description': 'Master project existing (tabel projects). customer_note = teks bebas; FK customer_id menunggu skema customers (t_03b41644) — TIDAK divalidasi sebagai ID.',
    },
    'vendors': {
        'table': 'vendors',
        'columns': ['name', 'phone', 'store_link', 'supplier_category', 'contact'],
        'required': ['name', 'supplier_category'],
        'natural_key': ['name'],
        'monetary': [],
        'description': 'Master vendor (tabel vendors). supplier_category SCALAR wajib salah satu kategori kanonik; multi-kategori hanya lewat entitas vendor_categories setelah skema (tanpa delimiter hack).',
    },
    'materials': {
        'table': 'materials',
        'columns': ['kode', 'name', 'category', 'satuan', 'harga_acuan', 'current_stock', 'min_stock'],
        'required': ['name', 'category', 'satuan'],
        'natural_key': ['name', 'category'],
        'monetary': ['harga_acuan'],
        'description': 'Master material (tabel materials). kode kosong = dialokasikan aplikasi (RPC next_material_kode_cat); bila diisi wajib format <PREFIX>-NNNN sesuai kategori. current_stock/min_stock hanya diisi saat cutover disepakati; kosong = default aplikasi 0.',
    },
    'vendor_categories': {
        'table': 'vendor_categories (usulan — belum ada)',
        'columns': ['vendor_name', 'category'],
        'required': ['vendor_name', 'category'],
        'natural_key': ['vendor_name', 'category'],
        'monetary': [],
        'description': 'Relasi multi-kategori vendor (usulan skema). vendor_name wajib resolve ke master vendors — batch vendors harus di-apply lebih dulu. Setelah skema approved, baris ini dipetakan ke supplier_categories[]/tabel relasi; resolver isVendorEligible (modules/requests/estimator.js) sudah kompatibel array.',
    },
    'price_references': {
        'table': 'material_price_refs (usulan — belum ada)',
        'columns': ['material_kode', 'price', 'price_date', 'vendor_name'],
        'required': ['material_kode', 'price'],
        'natural_key': ['material_kode', 'price_date'],
        'monetary': ['price'],
        'description': 'Acuan harga material ber-sumber (usulan skema). material_kode wajib resolve ke master materials; price wajib evidence (source_file_id + source_row); vendor_name optional wajib resolve bila diisi.',
    },
}

# ============================================================
# HELPER PARSING (semantik SAMA dgn aplikasi)
# ============================================================

# Normalisasi teks utk pencocokan dedupe: casefold + rapikan spasi.
def norm_text(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip().casefold()


# Harga moneter: semantic sama dgn validatedPrice/parsePriceValue aplikasi
# (modules/requests/save.js & estimator.js): negatif / parenthesis ditolak
# EKSPLISIT ('-5' tidak boleh diam-diam jadi 5); format Indonesia
# '1.250.000' diterima; koma desimal ditolak utk harga rupiah utuh.
def parse_money(v):
    if v is None:
        return None, None
    raw = str(v).strip()
    if raw == '':
        return None, None
    if '-' in raw or '(' in raw:
        return None, 'negatif/parenthesis tidak diizinkan'
    if not re.fullmatch(r'[0-9.,\s]+', raw):
        return None, 'berisi karakter bukan angka'
    digits = raw.replace('.', '').replace(' ', '')
    if ',' in digits:
        return None, 'harga rupiah harus bilangan bulat (tanpa desimal)'
    if not digits.isdigit():
        return None, 'format angka tidak dikenali'
    return int(digits), None


# Stok numerik >= 0, format Indonesia '1.234,5' -> 1234.5 (semantik sama
# dgn parser stok modules/materials/save.js).
def parse_stock(v):
    if v is None:
        return None, None
    s = str(v).strip()
    if s == '':
        return None, None
    cleaned = s.replace('.', '').replace(',', '.')
    if not re.fullmatch(r'\d+(\.\d+)?', cleaned):
        return None, 'stok harus angka >= 0 (format 1.234,5 diperbolehkan)'
    n = float(cleaned)
    if n < 0:
        return None, 'stok tidak boleh negatif'
    return n, None


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# ============================================================
# SNAPSHOT MASTER
# ============================================================

def load_master_snapshot(path):
    with open(path, 'r', encoding='utf-8-sig') as f:
        snap = json.load(f)
    if not isinstance(snap, dict):
        raise ValueError('snapshot master harus objek JSON')
    missing = [k for k in ('schema_version', 'generated_at', 'categories',
                           'projects', 'vendors', 'materials') if k not in snap]
    if missing:
        raise ValueError('snapshot master kurang kunci: ' + ', '.join(missing))
    return snap


def master_indexes(snap):
    """Index master utk resolve ID + dedupe. Semua read-only."""
    projects_by_code = {}
    for p in snap.get('projects') or []:
        code = norm_text(p.get('kode') or p.get('code') or p.get('project_code'))
        if code:
            projects_by_code[code] = p
    vendors_by_name = {}
    for v in snap.get('vendors') or []:
        nm = norm_text(v.get('name'))
        if nm:
            vendors_by_name[nm] = v
    materials_by_kode = {}
    materials_by_nat = {}
    for m in snap.get('materials') or []:
        kd = norm_text(m.get('kode') or m.get('code'))
        if kd:
            materials_by_kode[kd] = m
        nat = (norm_text(m.get('name')), norm_text(m.get('category')))
        if nat[0]:
            materials_by_nat[nat] = m
    vendor_categories = set()
    for row in snap.get('vendor_categories') or []:
        vendor_categories.add((norm_text(row.get('vendor_name')), norm_text(row.get('category'))))
    return {
        'projects_by_code': projects_by_code,
        'vendors_by_name': vendors_by_name,
        'materials_by_kode': materials_by_kode,
        'materials_by_nat': materials_by_nat,
        'vendor_categories': vendor_categories,
    }


# ============================================================
# PEMBACAAN CSV
# ============================================================

def read_staging_csv(path, entity):
    """Baca CSV staging; header wajib = universal + kolom entitas (set
    exact — kolom ekstra/kurang ditolak agar tidak ada drift senyap).
    Return (rows, parse_problems)."""
    spec = ENTITIES[entity]
    expected = set(UNIVERSAL_COLUMNS + spec['columns'])
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        header = [h.strip() for h in (reader.fieldnames or [])]
        header_set = set(header)
        problems = []
        missing = sorted(expected - header_set)
        extra = sorted(header_set - expected)
        if missing:
            problems.append('kolom hilang: ' + ', '.join(missing))
        if extra:
            problems.append('kolom tak dikenal: ' + ', '.join(extra))
        if problems:
            return [], problems
        rows = []
        for i, raw in enumerate(reader, start=2):  # baris 1 = header
            if all((v is None or str(v).strip() == '') for v in raw.values()):
                continue  # baris kosong trailing diabaikan (dihitung terpisah)
            row = {k: (raw.get(k) or '').strip() for k in expected}
            row['_line'] = i
            rows.append(row)
    return rows, []


# ============================================================
# VALIDASI PER BARIS
# ============================================================

def validate_row(entity, row, snap, idx, batch_state):
    """Validasi satu baris. Mutasi batch_state (dedupe dalam batch).
    Return dict hasil baris {status, reasons, warnings, resolved, payload}."""
    spec = ENTITIES[entity]
    reasons = []
    warnings = []
    resolved = {}
    line = row.get('_line')

    external_ref = row.get('external_ref', '').strip()
    if not external_ref:
        reasons.append('external_ref wajib diisi (identitas stabil utk retry idempoten)')
    else:
        nref = norm_text(external_ref)
        if nref in batch_state['external_refs']:
            reasons.append(f'external_ref "{external_ref}" duplikat dalam batch (baris {batch_state["external_refs"][nref]})')
        else:
            batch_state['external_refs'][nref] = line

    # --- intent: UPDATE (record_id diisi) vs INSERT (record_id kosong) ---
    record_id = row.get('record_id', '').strip()
    intent = 'UPDATE' if record_id else 'INSERT'
    master_row = None

    # --- source row validation utk nilai moneter ---
    needs_source = bool(spec['monetary']) and any(
        (row.get(col) or '').strip() for col in spec['monetary'])
    if needs_source:
        if not row.get('source_file_id', '').strip():
            reasons.append('source_file_id wajib utk nilai moneter (provenance historis tidak ditebak)')
        if not row.get('source_row', '').strip():
            reasons.append('source_row wajib utk nilai moneter (baris halaman sumber dicatat)')

    # --- validasi per entitas ---
    if entity == 'projects':
        code = row.get('project_code', '').strip()
        name = row.get('name', '').strip()
        status = row.get('status', '').strip()
        if not code:
            reasons.append('project_code wajib (ID master project)')
        if not name:
            reasons.append('name wajib')
        status_up = status.upper() if status else ''
        if status and status_up not in PROJECT_STATUS_ENUM:
            reasons.append(f'status "{status}" tidak dikenal (harus salah satu: {", ".join(sorted(PROJECT_STATUS_ENUM))})')
        ncode = norm_text(code)
        if ncode:
            if ncode in batch_state['natural']:
                reasons.append(f'project_code "{code}" duplikat dalam batch (baris {batch_state["natural"][ncode]})')
            else:
                batch_state['natural'][ncode] = line
            master_row = idx['projects_by_code'].get(ncode)
            if master_row:
                resolved['project_id'] = master_row.get('id')
                if record_id and str(master_row.get('id') or '') != record_id:
                    reasons.append('record_id tidak cocok dengan baris master untuk project_code itu — periksa record_id')
            elif intent == 'UPDATE':
                reasons.append(f'project_code "{code}" tidak ditemukan di master — UPDATE intent butuh record yang ada')
        payload = {'project_code': code, 'name': name,
                   'status': status_up or 'NOT_START',
                   'customer_note': row.get('customer_note', '').strip() or None}
        if intent == 'UPDATE' and master_row is not None:
            same = (norm_text(master_row.get('name')) == norm_text(name)
                    and (master_row.get('status') or 'NOT_START') == payload['status'])
            if same:
                warnings.append('nilai identik dgn master -> SKIP_UNCHANGED')

    elif entity == 'vendors':
        name = row.get('name', '').strip()
        cat = row.get('supplier_category', '').strip()
        phone = row.get('phone', '').strip()
        if not name:
            reasons.append('name wajib (nama vendor adalah kunci dedupe)')
        if not cat:
            reasons.append('supplier_category wajib (kategori kanonik master)')
        elif cat not in MATERIAL_KODE_PREFIXES and cat not in (snap.get('categories') or []):
            reasons.append(f'supplier_category "{cat}" bukan kategori kanonik master (lihat snapshot.categories)')
        if phone and re.search(r'[A-Za-z]', phone):
            warnings.append('phone berisi huruf — nomor telepon disimpan sbg teks, periksa kembali')
        nname = norm_text(name)
        if nname:
            if nname in batch_state['natural']:
                reasons.append(f'vendor "{name}" duplikat dalam batch (baris {batch_state["natural"][nname]})')
            else:
                batch_state['natural'][nname] = line
            master_row = idx['vendors_by_name'].get(nname)
            if master_row:
                resolved['vendor_id'] = master_row.get('id')
                if record_id and str(master_row.get('id') or '') != record_id:
                    reasons.append('record_id tidak cocok dengan baris master untuk nama vendor itu — periksa record_id')
            elif intent == 'UPDATE':
                reasons.append(f'vendor "{name}" tidak ditemukan di master — UPDATE intent butuh record yang ada')
        payload = {'name': name, 'phone': phone or None,
                   'store_link': row.get('store_link', '').strip() or None,
                   'supplier_category': cat or None,
                   'contact': row.get('contact', '').strip() or None}
        if intent == 'UPDATE' and master_row is not None:
            same = (norm_text(master_row.get('name')) == nname
                    and (master_row.get('supplier_category') or '') == cat
                    and (master_row.get('phone') or '') == phone)
            if same:
                warnings.append('nilai identik dgn master -> SKIP_UNCHANGED')

    elif entity == 'materials':
        name = row.get('name', '').strip()
        cat = row.get('category', '').strip()
        satuan = row.get('satuan', '').strip()
        kode = row.get('kode', '').strip()
        if not name:
            reasons.append('name wajib')
        if not cat:
            reasons.append('category wajib (kategori kanonik — autofill kategori PR bergantung ini)')
        elif cat not in MATERIAL_KODE_PREFIXES and cat not in (snap.get('categories') or []):
            reasons.append(f'category "{cat}" bukan kategori kanonik master')
        if not satuan:
            reasons.append('satuan wajib (resolver acuan hanya memakai entri satuan sama — tidak ada konversi)')
        if kode:
            prefix = MATERIAL_KODE_PREFIXES.get(cat, 'MAT') if cat else 'MAT'
            if not re.fullmatch(re.escape(prefix) + r'-\d{4}', kode):
                reasons.append(f'kode "{kode}" tidak cocok format kategori {cat} ({prefix}-NNNN)')
        harga, err = parse_money(row.get('harga_acuan'))
        if err:
            reasons.append(f'harga_acuan tidak valid: {err}')
        elif harga is not None:
            resolved['harga_acuan'] = harga
        cstock, errc = parse_stock(row.get('current_stock'))
        if errc:
            reasons.append(f'current_stock tidak valid: {errc}')
        mstock, errm = parse_stock(row.get('min_stock'))
        if errm:
            reasons.append(f'min_stock tidak valid: {errm}')
        if cstock is not None or mstock is not None:
            warnings.append('kolom stok diisi — pastikan cutover stok opening sudah disepakati DAT (blueprint: template stok opening hanya bila disepakati)')
        nat = (norm_text(name), norm_text(cat))
        if nat[0]:
            if nat in batch_state['natural']:
                reasons.append(f'material "{name}" ({cat}) duplikat dalam batch (baris {batch_state["natural"][nat]})')
            else:
                batch_state['natural'][nat] = line
            master_row = idx['materials_by_nat'].get(nat) or (idx['materials_by_kode'].get(norm_text(kode)) if kode else None)
            if master_row:
                resolved['material_id'] = master_row.get('id')
                if record_id and str(master_row.get('id') or '') != record_id:
                    reasons.append('record_id tidak cocok dengan baris master untuk material itu — periksa record_id')
                if satuan and norm_text(master_row.get('satuan') or master_row.get('unit') or '') not in ('', norm_text(satuan)):
                    warnings.append(f'satuan berbeda dgn master ("{master_row.get("satuan") or master_row.get("unit")}") — resolver tidak akan memakai entri lintas satuan')
            elif intent == 'UPDATE':
                reasons.append(f'material "{name}" ({cat}) tidak ditemukan di master — UPDATE intent butuh record yang ada')
        payload = {'kode': kode or None, 'name': name, 'category': cat or None,
                   'satuan': satuan, 'harga_acuan': harga,
                   'current_stock': cstock, 'min_stock': mstock}

    elif entity == 'vendor_categories':
        vname = row.get('vendor_name', '').strip()
        cat = row.get('category', '').strip()
        if not vname:
            reasons.append('vendor_name wajib (FK ke master vendors)')
        if not cat:
            reasons.append('category wajib (kategori kanonik master)')
        elif cat not in MATERIAL_KODE_PREFIXES and cat not in (snap.get('categories') or []):
            reasons.append(f'category "{cat}" bukan kategori kanonik master')
        nv = norm_text(vname)
        if nv:
            v = idx['vendors_by_name'].get(nv)
            if v:
                resolved['vendor_id'] = v.get('id')
            else:
                reasons.append(f'vendor "{vname}" tidak ditemukan di master — apply batch vendors lebih dulu (mandatory ID, tidak menebak)')
            pair = (nv, norm_text(cat))
            if pair in batch_state['natural']:
                reasons.append(f'pasangan "{vname} × {cat}" duplikat dalam batch (baris {batch_state["natural"][pair]})')
            else:
                batch_state['natural'][pair] = line
            if pair in idx['vendor_categories']:
                warnings.append('pasangan sudah ada di master snapshot -> SKIP_UNCHANGED')
        payload = {'vendor_name': vname, 'category': cat or None}

    elif entity == 'price_references':
        mkode = row.get('material_kode', '').strip()
        price, err = parse_money(row.get('price'))
        pdate = row.get('price_date', '').strip()
        vname = row.get('vendor_name', '').strip()
        if not mkode:
            reasons.append('material_kode wajib (FK ke master materials)')
        else:
            m = idx['materials_by_kode'].get(norm_text(mkode))
            if m:
                resolved['material_id'] = m.get('id')
            else:
                reasons.append(f'material_kode "{mkode}" tidak ditemukan di master (mandatory ID, tidak menebak)')
        if err:
            reasons.append(f'price tidak valid: {err}')
        elif price is None:
            reasons.append('price wajib diisi')
        else:
            resolved['price'] = price
        if pdate and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', pdate):
            reasons.append('price_date harus format YYYY-MM-DD (tanggal SOURCE terpisah dari modifiedTime)')
        if vname and norm_text(vname) not in idx['vendors_by_name']:
            reasons.append(f'vendor_name "{vname}" tidak ditemukan di master (mandatory ID bila diisi)')
        nat = (norm_text(mkode), norm_text(pdate))
        if nat[0]:
            if nat in batch_state['natural']:
                reasons.append(f'pasangan material+tanggal "{mkode} @ {pdate}" duplikat dalam batch (baris {batch_state["natural"][nat]})')
            else:
                batch_state['natural'][nat] = line
        payload = {'material_kode': mkode, 'price': price,
                   'price_date': pdate or None,
                   'vendor_name': vname or None}

    # --- CONFLICT vs master: INSERT intent ke kunci yang sudah ada = ---
    # CONFLICT (bukan update senyap / duplikat baru). Terjadi setelah
    # resolusi master_row per entitas di atas.
    if master_row is not None and intent == 'INSERT' and entity in ('projects', 'vendors', 'materials'):
        reasons.append('CONFLICT: kunci sudah ada di master — INSERT intent ditolak; isi record_id utk UPDATE atau gunakan external_ref berbeda')

    # --- resolve intent UPDATE + unchanged utk entitas umum ---
    if entity not in ('projects', 'vendors') and intent == 'UPDATE':
        if master_row is None:
            reasons.append('UPDATE intent (record_id diisi) tapi baris master tidak ditemukan — record_id tidak boleh menebak')
        elif str(master_row.get('id') or '') != record_id:
            reasons.append('record_id tidak cocok dengan baris master — record_id tidak boleh menebak')

    status = 'PLAN_INSERT' if intent == 'INSERT' else 'PLAN_UPDATE'
    if reasons:
        status = 'REJECTED'
    else:
        if any('SKIP_UNCHANGED' in w for w in warnings):
            status = 'SKIP_UNCHANGED'
        elif entity in SCHEMA_PENDING_ENTITIES:
            status = 'PLAN_STAGING'

    return {
        'row': line,
        'external_ref': external_ref or None,
        'record_id': record_id or None,
        'status': status,
        'reasons': reasons,
        'warnings': warnings,
        'resolved': resolved,
        'payload': payload,
    }


# ============================================================
# VALIDASI SATU ENTITAS (satu file CSV)
# ============================================================

def validate_entity(entity, input_path, snapshot_path, batch_id=None):
    if entity not in ENTITIES:
        raise ValueError(f'entitas tidak dikenal: {entity} (pilihan: {", ".join(ENTITIES)})')
    spec = ENTITIES[entity]
    snap = load_master_snapshot(snapshot_path)
    idx = master_indexes(snap)
    rows, parse_problems = read_staging_csv(input_path, entity)

    batch_state = {'external_refs': {}, 'natural': {}}
    results = []
    if parse_problems:
        results.append({
            'row': 1, 'external_ref': None, 'record_id': None,
            'status': 'REJECTED', 'reasons': parse_problems,
            'warnings': [], 'resolved': {}, 'payload': {},
        })
    else:
        for row in rows:
            results.append(validate_row(entity, row, snap, idx, batch_state))

    counts = {k: 0 for k in ('total', 'valid', 'rejected', 'conflicts',
                             'unchanged', 'planned_inserts', 'planned_updates')}
    counts['total'] = len(results)
    for r in results:
        if r['status'] == 'REJECTED':
            counts['rejected'] += 1
        elif r['status'] in ('PLAN_INSERT', 'PLAN_UPDATE', 'PLAN_STAGING'):
            counts['valid'] += 1
            if r['status'] == 'PLAN_INSERT':
                counts['planned_inserts'] += 1
            elif r['status'] == 'PLAN_UPDATE':
                counts['planned_updates'] += 1
        elif r['status'] == 'SKIP_UNCHANGED':
            counts['unchanged'] += 1
            counts['valid'] += 1

    # Reconciliation total moneter (control sum, bukan event tambahan).
    monetary_col = spec['monetary'][0] if spec['monetary'] else None
    totals = {}
    if monetary_col:
        totals[f'{monetary_col}_sum_input'] = sum(
            r['payload'].get(monetary_col) or 0 for r in results
            if r['status'] != 'REJECTED' and r['payload'].get(monetary_col) is not None)
        totals[f'{monetary_col}_sum_planned'] = sum(
            r['payload'].get(monetary_col) or 0 for r in results
            if r['status'] in ('PLAN_INSERT', 'PLAN_UPDATE', 'PLAN_STAGING')
            and r['payload'].get(monetary_col) is not None)

    warnings_batch = []
    snap_ver = str(snap.get('schema_version', ''))
    if snap_ver != SUPPORTED_SNAPSHOT_SCHEMA_VERSION:
        warnings_batch.append(
            f'schema drift: snapshot {snap_ver} vs validator {SUPPORTED_SNAPSHOT_SCHEMA_VERSION} — periksa snapshot terbaru sebelum apply')

    apply_blocked = True  # validator TIDAK PERNAH apply — desain, bukan kebetulan
    apply_block_reason = 'DRY_RUN_ONLY: apply dilakukan tooling approved terpisah setelah admin approve batch (blueprint flow import)'
    if entity in SCHEMA_PENDING_ENTITIES:
        apply_block_reason = SCHEMA_PENDING_ENTITIES[entity]

    report = {
        'tool': 'manual-input-staging validator (t_0bb833f1)',
        'mode': 'DRY_RUN',
        'batch_id': batch_id or ('DRYRUN-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')),
        'entity': entity,
        'table': spec['table'],
        'generated_at': now_iso(),
        'input_file': os.path.abspath(input_path),
        'input_sha256': sha256_file(input_path),
        'master_snapshot': {
            'file': os.path.abspath(snapshot_path),
            'schema_version': snap_ver,
            'generated_at': snap.get('generated_at'),
        },
        'counts': counts,
        'totals': totals,
        'warnings': warnings_batch,
        'apply_blocked': apply_blocked,
        'apply_block_reason': apply_block_reason,
        'rows': results,
    }
    return report


def write_outputs(report, out_dir):
    entity_dir = os.path.join(out_dir, report['entity'])
    os.makedirs(entity_dir, exist_ok=True)
    report_path = os.path.join(entity_dir, 'report.json')
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    # Plan = payload INTENDED utk baris valid saja. Label tegas:
    # bukan hasil apply; butuh approve + tooling approved.
    plan = {
        'batch_id': report['batch_id'],
        'entity': report['entity'],
        'note': 'INTENDED PAYLOAD — belum di-apply. Apply hanya oleh tooling approved setelah admin approve; validator ini tidak menulis DB.',
        'requires': ['admin_approve', 'approved_batch_flag', 'transactional_apply_tooling'],
        'apply_blocked': report['apply_blocked'],
        'apply_block_reason': report['apply_block_reason'],
        'input_sha256': report['input_sha256'],
        'counts': report['counts'],
        'totals': report['totals'],
        'rows': [
            {
                'external_ref': r['external_ref'],
                'record_id': r['record_id'],
                'status': r['status'],
                'resolved': r['resolved'],
                'payload': r['payload'],
            }
            for r in report['rows'] if r['status'] in ('PLAN_INSERT', 'PLAN_UPDATE', 'PLAN_STAGING')
        ],
    }
    plan_path = os.path.join(entity_dir, 'plan.json')
    with open(plan_path, 'w', encoding='utf-8') as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    return report_path, plan_path


# ============================================================
# CLI
# ============================================================

def main(argv=None):
    ap = argparse.ArgumentParser(description='Validator staging input manual (DRY RUN — tidak menulis DB).')
    ap.add_argument('--entity', required=True, choices=sorted(ENTITIES))
    ap.add_argument('--input', required=True, help='CSV staging')
    ap.add_argument('--master', required=True, help='JSON snapshot master (read-only export)')
    ap.add_argument('--out', required=True, help='direktori output report/plan')
    ap.add_argument('--batch-id', default=None)
    args = ap.parse_args(argv)

    try:
        report = validate_entity(args.entity, args.input, args.master, args.batch_id)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return 2

    report_path, plan_path = write_outputs(report, args.out)
    c = report['counts']
    print(f"[{report['entity']}] batch {report['batch_id']}")
    print(f"  total={c['total']} valid={c['valid']} (insert={c['planned_inserts']} update={c['planned_updates']}) "
          f"unchanged={c['unchanged']} rejected={c['rejected']}")
    if report['totals']:
        print(f"  totals: {report['totals']}")
    if report['warnings']:
        for w in report['warnings']:
            print(f"  WARNING: {w}")
    print(f"  apply_blocked={report['apply_blocked']} ({report['apply_block_reason']})")
    print(f"  report: {report_path}")
    print(f"  plan  : {plan_path}")
    for r in report['rows']:
        if r['status'] == 'REJECTED':
            print(f"  REJECTED baris {r['row']}: {'; '.join(r['reasons'])}")
    if c['rejected']:
        return 1
    if c['unchanged'] and c['valid'] == c['unchanged']:
        print('  semua baris unchanged — tidak ada yang perlu apply (retry idempoten)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
