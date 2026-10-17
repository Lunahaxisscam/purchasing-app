#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HARNESS VERIFIKASI VALIDATOR STAGING INPUT MANUAL (bit-dev) — t_0bb833f1
========================================================================
Pola scripts/pr-estimator-test: sandbox /tmp verbatim, TIDAK menyentuh DB,
tidak ada jaringan, tidak ada write di luar sandbox /tmp.

Menguji aturan body t_0bb833f1:
  1. mandatory IDs       — vendor/material/project wajib resolve ke master;
                           UPDATE intent tanpa master ditolak; template CSV
                           kosong (header saja, tanpa baris dummy).
  2. source row evidence — harga moneter tanpa source_file_id/source_row
                           ditolak; provenance historis tidak ditebak.
  3. duplicate detection — external_ref duplikat, natural key duplikat
                           (casefold/space-normalized), CONFLICT INSERT vs
                           master (bukan update senyap).
  4. reconciliation      — counts/totals per batch, sha256 input,
                           schema drift warning, SKIP_UNCHANGED idempoten.
  5. DRY-RUN ONLY        — apply_blocked selalu true; PLAN_STAGING utk
                           entitas schema-pending (owner tunggal t_03b41644).
  6. Kompabilitas        — prefix kode material == MATERIAL_KODE_PREFIXES
                           lib/constants.js (guard drift); resolver vendor
                           array kompatibel (estimator.js) TIDAK diubah.

Cara: python3 scripts/manual-input-staging-test/run.py   (dari root repo)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures')
VALIDATOR = os.path.join(REPO, 'scripts', 'manual-input-staging', 'validate.py')

FAILURES = []
CHECKS = [0]


def check(name, cond, detail=''):
    CHECKS[0] += 1
    if cond:
        print(f'  PASS  {name}')
    else:
        print(f'  FAIL  {name}' + (f' — {detail}' if detail else ''))
        FAILURES.append(name)


def run_validator(entity, csv_path, snapshot, batch=None, workdir=None):
    out = os.path.join(workdir, 'out', entity)
    args = [sys.executable, VALIDATOR, '--entity', entity,
            '--input', csv_path, '--master', snapshot, '--out',
            os.path.dirname(out)]
    if batch:
        args += ['--batch-id', batch]
    proc = subprocess.run(args, capture_output=True, text=True)
    report_path = os.path.join(out, 'report.json')
    plan_path = os.path.join(out, 'plan.json')
    report = json.load(open(report_path, encoding='utf-8')) if os.path.isfile(report_path) else None
    plan = json.load(open(plan_path, encoding='utf-8')) if os.path.isfile(plan_path) else None
    return proc, report, plan


def statuses(report):
    return [r['status'] for r in report['rows']]


def row_by_ref(report, ref):
    for r in report['rows']:
        if r.get('external_ref') == ref:
            return r
    return None


# ============================================================
# 0) GUARD DRIFT: prefix kategori == lib/constants.js
# ============================================================
def test_kode_prefix_match_js():
    print('[0] Prefix kode material sinkron dgn lib/constants.js')
    js = open(os.path.join(REPO, 'lib', 'constants.js'), encoding='utf-8').read()
    m = re.search(r'MATERIAL_KODE_PREFIXES\s*=\s*\{(.*?)\}', js, re.S)
    check('blok MATERIAL_KODE_PREFIXES ditemukan di constants.js', bool(m))
    pairs = re.findall(r"'([^']+)':\s*'([A-Z]+)'", m.group(1))
    check('constants.js punya >=7 kategori', len(pairs) >= 7, f'dapat {len(pairs)}')
    sys.path.insert(0, os.path.dirname(VALIDATOR))
    import importlib
    val = importlib.import_module('validate')
    js_map = dict(pairs)
    check('prefix JS == validator', js_map == val.MATERIAL_KODE_PREFIXES,
          f'JS={js_map} PY={val.MATERIAL_KODE_PREFIXES}')


# ============================================================
# 1) TEMPLATE: header saja, tanpa baris dummy
# ============================================================
def test_templates_blank():
    print('[1] Template CSV kosong — header saja, tanpa data dummy')
    tdir = os.path.join(REPO, 'scripts', 'manual-input-staging', 'templates')
    for f in sorted(os.listdir(tdir)):
        if not f.endswith('.csv'):
            continue
        with open(os.path.join(tdir, f), encoding='utf-8') as fh:
            lines = [ln for ln in fh.read().splitlines() if ln.strip()]
        check(f'{f}: hanya 1 baris header (tanpa contoh data)', len(lines) == 1, f'{len(lines)} baris')
    check('kelima template entitas ada',
          sorted(os.listdir(tdir)) == ['materials.csv', 'price_references.csv',
                                       'projects.csv', 'vendor_categories.csv', 'vendors.csv'])


# ============================================================
# 2) VENDORS
# ============================================================
def test_vendors(workdir, snap):
    print('[2] Vendors — mandatory ID, duplikat, conflict, schema existing')
    proc, rep, plan = run_validator('vendors', os.path.join(FIX, 'vendors_test.csv'), snap,
                                    'B-TEST-VENDORS', workdir)
    check('exit code 1 (ada REJECTED)', proc.returncode == 1, f'rc={proc.returncode} stderr={proc.stderr[:200]}')
    st = statuses(rep)
    # EXT-V-001 insert OK; V-002 update existing OK; V-003 kategori aneh REJ;
    # V-004 tanpa kategori REJ; V-005 dup ref REJ; V-007 dup nama REJ;
    # V-008 conflict master REJ; V-009 UPDATE tanpa master REJ
    check('V-001 valid insert', row_by_ref(rep, 'EXT-V-001')['status'] == 'PLAN_INSERT')
    check('V-002 valid update existing', row_by_ref(rep, 'EXT-V-002')['status'] == 'PLAN_UPDATE')
    check('V-002 resolve vendor_id master', row_by_ref(rep, 'EXT-V-002')['resolved'].get('vendor_id'))
    check('V-003 kategori tak dikenal ditolak', row_by_ref(rep, 'EXT-V-003')['status'] == 'REJECTED'
          and any('kategori' in x for x in row_by_ref(rep, 'EXT-V-003')['reasons']))
    check('V-004 tanpa kategori ditolak', row_by_ref(rep, 'EXT-V-004')['status'] == 'REJECTED')
    check('V-005 external_ref duplikat ditolak', 'V-005 duplikat' in proc.stdout
          or any('duplikat' in x for r in rep['rows'] if r['external_ref'] == 'EXT-V-001'
                 for x in r['reasons']) or any(
              'duplikat dalam batch' in x for r in rep['rows']
              for x in r['reasons']))
    check('V-007 nama duplikat casefold ditolak', row_by_ref(rep, 'EXT-V-007')['status'] == 'REJECTED')
    check('V-008 INSERT vs master = CONFLICT message', row_by_ref(rep, 'EXT-V-008')['status'] == 'REJECTED'
          and any('master' in x for x in row_by_ref(rep, 'EXT-V-008')['reasons']))
    check('V-009 UPDATE tanpa master match ditolak', row_by_ref(rep, 'EXT-V-009')['status'] == 'REJECTED')
    c = rep['counts']
    check('counts konsisten', c['total'] == 8 and c['valid'] == 2 and c['rejected'] == 6,
          json.dumps(c))
    check('plan hanya berisi baris valid', len(plan['rows']) == 2)
    check('plan apply_blocked + alasan DRY_RUN', plan['apply_blocked'] is True
          and 'DRY_RUN_ONLY' in plan['apply_block_reason'])
    check('vendor existing schema — TIDAK masuk PLAN_STAGING', 'PLAN_STAGING' not in st)
    check('sha256 input tercatat (reconciliation)', len(rep['input_sha256']) == 64)
    # phone dengan huruf -> warning tapi tidak reject (nomor telepon = teks);
    # baris V-002 kini meng-update phone, nilai teks dipertahankan apa adanya
    r2 = row_by_ref(rep, 'EXT-V-002')
    check('phone disimpan sbg teks apa adanya', r2['payload']['phone'] == '081299900001')


# ============================================================
# 3) MATERIALS
# ============================================================
def test_materials(workdir, snap):
    print('[3] Materials — kode per kategori, harga, evidence, natural key')
    proc, rep, plan = run_validator('materials', os.path.join(FIX, 'materials_test.csv'), snap,
                                    'B-TEST-MAT', workdir)
    check('exit code 1', proc.returncode == 1)
    check('M-001 valid (format harga Indonesia diterima)',
          row_by_ref(rep, 'EXT-M-001')['status'] == 'PLAN_INSERT'
          and row_by_ref(rep, 'EXT-M-001')['payload']['harga_acuan'] == 142000)
    check('M-002 kode HWF-0002 valid', row_by_ref(rep, 'EXT-M-002')['status'] == 'PLAN_INSERT')
    check('M-003 kode prefix salah kategori ditolak', row_by_ref(rep, 'EXT-M-003')['status'] == 'REJECTED')
    check('M-004 harga negatif ditolak eksplisit', row_by_ref(rep, 'EXT-M-004')['status'] == 'REJECTED'
          and any('negatif' in x for x in row_by_ref(rep, 'EXT-M-004')['reasons']))
    check('M-005 harga tanpa evidence ditolak', row_by_ref(rep, 'EXT-M-005')['status'] == 'REJECTED'
          and any('source_file_id' in x for x in row_by_ref(rep, 'EXT-M-005')['reasons']))
    check('M-006 satuan wajib ditolak', row_by_ref(rep, 'EXT-M-006')['status'] == 'REJECTED')
    check('M-007 UPDATE intent, satuan beda master = warning tetap valid',
          row_by_ref(rep, 'EXT-M-007')['status'] == 'PLAN_UPDATE'
          and any('satuan' in w for w in row_by_ref(rep, 'EXT-M-007')['warnings']))
    check('M-008 natural key duplikat ditolak', row_by_ref(rep, 'EXT-M-008')['status'] == 'REJECTED'
          and any('duplikat' in x for x in row_by_ref(rep, 'EXT-M-008')['reasons']))
    check('M-009 INSERT vs master = CONFLICT', row_by_ref(rep, 'EXT-M-009')['status'] == 'REJECTED'
          and any('master' in x for x in row_by_ref(rep, 'EXT-M-009')['reasons']))
    c = rep['counts']
    check('counts materials konsisten', c['total'] == 9 and c['valid'] == 3 and c['rejected'] == 6, json.dumps(c))
    check('totals harga input tercatat (reconciliation)',
          rep['totals'].get('harga_acuan_sum_input') == 142000 + 78000 + 185000, json.dumps(rep['totals']))
    check('totals planned == hanya baris valid',
          rep['totals'].get('harga_acuan_sum_planned') == rep['totals'].get('harga_acuan_sum_input'))


# ============================================================
# 4) PRICE REFERENCES — schema pending
# ============================================================
def test_price_references(workdir, snap):
    print('[4] Price references — evidence wajib + PLAN_STAGING (schema pending)')
    proc, rep, plan = run_validator('price_references', os.path.join(FIX, 'price_references_test.csv'), snap,
                                    'B-TEST-PRICE', workdir)
    check('exit code 1', proc.returncode == 1)
    check('P-001 valid -> PLAN_STAGING (bukan PLAN_INSERT)',
          row_by_ref(rep, 'EXT-P-001')['status'] == 'PLAN_STAGING')
    check('P-001 resolve material_id master', row_by_ref(rep, 'EXT-P-001')['resolved'].get('material_id')
          == '33333333-3333-3333-3333-333333333331')
    check('P-002 material tak dikenal ditolak (mandatory ID)', row_by_ref(rep, 'EXT-P-002')['status'] == 'REJECTED')
    check('P-003 harga tanpa evidence ditolak', row_by_ref(rep, 'EXT-P-003')['status'] == 'REJECTED')
    check('P-004 tanggal non-ISO ditolak', row_by_ref(rep, 'EXT-P-004')['status'] == 'REJECTED'
          and any('YYYY-MM-DD' in x for x in row_by_ref(rep, 'EXT-P-004')['reasons']))
    check('P-005 vendor referensi tak dikenal ditolak', row_by_ref(rep, 'EXT-P-005')['status'] == 'REJECTED')
    check('P-001 dup ref + dup natural key di baris lain ditolak',
          row_by_ref(rep, 'EXT-P-007')['status'] == 'REJECTED')
    check('apply_block_reason menyebut owner schema t_03b41644',
          't_03b41644' in rep['apply_block_reason'])
    check('plan requires admin_approve + approved batch',
          set(plan['requires']) >= {'admin_approve', 'approved_batch_flag', 'transactional_apply_tooling'})


# ============================================================
# 5) PROJECTS
# ============================================================
def test_projects(workdir, snap):
    print('[5] Projects — enum status, dedupe, SKIP_UNCHANGED, tanpa FK customer palsu')
    proc, rep, plan = run_validator('projects', os.path.join(FIX, 'projects_test.csv'), snap,
                                    'B-TEST-PRJ', workdir)
    check('exit code 1', proc.returncode == 1)
    check('PRJ-001 valid insert, customer_note teks bebas',
          row_by_ref(rep, 'EXT-PRJ-001')['status'] == 'PLAN_INSERT'
          and row_by_ref(rep, 'EXT-PRJ-001')['payload']['customer_note'])
    check('PRJ-001 tidak mengklaim FK customer_id (menunggu skema t_03b41644)',
          'customer_id' not in json.dumps(row_by_ref(rep, 'EXT-PRJ-001')['payload']))
    check('PRJ-002 status non-enum ditolak', row_by_ref(rep, 'EXT-PRJ-002')['status'] == 'REJECTED')
    check('PRJ-003 tanpa project_code ditolak', row_by_ref(rep, 'EXT-PRJ-003')['status'] == 'REJECTED')
    check('PRJ-004 kode duplikat batch ditolak', row_by_ref(rep, 'EXT-PRJ-004')['status'] == 'REJECTED')
    check('PRJ-005 update nilai sama = SKIP_UNCHANGED',
          row_by_ref(rep, 'EXT-PRJ-005')['status'] == 'SKIP_UNCHANGED')
    check('PRJ-006 INSERT vs master = CONFLICT', row_by_ref(rep, 'EXT-PRJ-006')['status'] == 'REJECTED')
    c = rep['counts']
    check('counts projects konsisten', c['total'] == 6 and c['unchanged'] == 1 and c['rejected'] == 4, json.dumps(c))


# ============================================================
# 6) VENDOR CATEGORIES — schema pending
# ============================================================
def test_vendor_categories(workdir, snap):
    print('[6] Vendor categories — FK vendor + PLAN_STAGING, tanpa delimiter hack')
    proc, rep, plan = run_validator('vendor_categories', os.path.join(FIX, 'vendor_categories_test.csv'), snap,
                                    'B-TEST-VC', workdir)
    check('exit code 1', proc.returncode == 1)
    check('VC-001 valid -> PLAN_STAGING', row_by_ref(rep, 'EXT-VC-001')['status'] == 'PLAN_STAGING')
    check('VC-001 resolve vendor_id master', row_by_ref(rep, 'EXT-VC-001')['resolved'].get('vendor_id')
          == '22222222-2222-2222-2222-222222222221')
    check('VC-002 vendor tak dikenal ditolak', row_by_ref(rep, 'EXT-VC-002')['status'] == 'REJECTED')
    check('VC-003 kategori non-kanonik ditolak', row_by_ref(rep, 'EXT-VC-003')['status'] == 'REJECTED')
    check('VC-004 pasangan duplikat ditolak', row_by_ref(rep, 'EXT-VC-004')['status'] == 'REJECTED')
    check('VC-005 sudah ada di master = SKIP_UNCHANGED',
          row_by_ref(rep, 'EXT-VC-005')['status'] == 'SKIP_UNCHANGED')


# ============================================================
# 7) RECONCILIATION — schema drift, batch id, retry idempoten
# ============================================================
def test_reconciliation(workdir, snap):
    print('[7] Reconciliation — schema drift warning, retry idempoten (SKIP)')
    # a) snapshot schema_version beda -> WARNING drift terdeteksi
    snap2 = json.load(open(snap, encoding='utf-8'))
    snap2['schema_version'] = '2099-01-01.9'
    snap2_path = os.path.join(workdir, 'snapshot_drift.json')
    json.dump(snap2, open(snap2_path, 'w', encoding='utf-8'), ensure_ascii=False)
    proc, rep, plan = run_validator('vendors', os.path.join(FIX, 'vendors_test.csv'), snap2_path,
                                    'B-DRIFT', workdir)
    check('schema drift menimbulkan WARNING', any('drift' in w for w in rep['warnings']), json.dumps(rep['warnings']))

    # b) retry idempoten: baris yang identik dgn master -> SKIP_UNCHANGED, plan kosong
    retry_csv = os.path.join(workdir, 'vendors_retry.csv')
    with open(retry_csv, 'w', encoding='utf-8') as f:
        f.write('record_id,external_ref,source_file_id,source_row,notes,name,phone,store_link,supplier_category,contact\n')
        f.write('22222222-2222-2222-2222-222222222221,EXT-V-R1,,retry sama dgn master,,[CONTOH] Toko Kayu Jaya,0812xxxx001,,Plywood & Board,\n')
    proc, rep, plan = run_validator('vendors', retry_csv, snap, 'B-RETRY', workdir)
    check('retry identik master = SKIP_UNCHANGED, exit 0', proc.returncode == 0
          and statuses(rep) == ['SKIP_UNCHANGED'], f"rc={proc.returncode} st={statuses(rep)}")
    check('plan kosong saat semua unchanged', plan['rows'] == [])
    check('batch id dari argumen dipakai', rep['batch_id'] == 'B-RETRY')

    # c) header salah -> ditolak struktur, bukan baris per baris
    bad_csv = os.path.join(workdir, 'vendors_badheader.csv')
    with open(bad_csv, 'w', encoding='utf-8') as f:
        f.write('nama,vendor\nfoo,bar\n')
    proc, rep, plan = run_validator('vendors', bad_csv, snap, 'B-HEADER', workdir)
    check('header salah -> REJECTED + sebab kolom', proc.returncode == 1
          and rep['rows'][0]['status'] == 'REJECTED'
          and any('kolom' in x for x in rep['rows'][0]['reasons']))


# ============================================================
# 8) BUKAN DUA ARAH — validator tidak punya jalur tulis DB
# ============================================================
def test_no_db_write():
    print('[8] Dry-run only — tidak ada koneksi/write DB di validator')
    src = open(VALIDATOR, encoding='utf-8').read()
    check('tidak ada import supabase/pg/psycopg/requests/urllib/socket',
          not re.search(r'\b(import|from)\s+(supabase|pg|psycopg|psycopg2|requests|urllib|socket|http)', src))
    check('tidak ada string koneksi postgres', 'postgres://' not in src and 'postgresql://' not in src)
    check('tidak ada .update(/.delete(/upsert ke client DB',
          '.from(' not in src)
    check('apply_blocked hard-coded True (desain dry-run)', "apply_blocked = True" in src)


def main():
    tmp = tempfile.mkdtemp(prefix='staging-verify-')
    snap = os.path.join(FIX, 'master_snapshot.fixture.json')
    try:
        print(f'Sandbox: {tmp}\n')
        test_kode_prefix_match_js()
        test_templates_blank()
        test_vendors(tmp, snap)
        test_materials(tmp, snap)
        test_price_references(tmp, snap)
        test_projects(tmp, snap)
        test_vendor_categories(tmp, snap)
        test_reconciliation(tmp, snap)
        test_no_db_write()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f'\nTotal check: {CHECKS[0]}; gagal: {len(FAILURES)}')
    if FAILURES:
        print('GAGAL: ' + ', '.join(FAILURES))
        return 1
    print('SEMUA TEST STAGING VALIDATOR HIJAU')
    return 0


if __name__ == '__main__':
    sys.exit(main())
