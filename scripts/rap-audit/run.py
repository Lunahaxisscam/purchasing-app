#!/usr/bin/env python3
"""
scripts/rap-audit/run.py — pembungkus suite audit RAP (S3, t_18652eb1)

Suite asli Bit Dev berbentuk .mjs dan dijalankan langsung dengan node:
  rap_audit_test.mjs       36 assertion (RAP, pagu 4 pilar, variance, margin)
  probe_infinity.mjs       22 probe fixture negatif Infinity/NaN/locale
  probe_rap_compare.mjs    19 probe negatif pagu/variance (rap-compare)
  verify_csv.mjs           keselarasan variance_scenarios.csv

Pembungkus ini ada supaya suite ikut `scripts/integration-test/run_all.py`
(seluruh regresi satu perintah) TANPA mengubah isi harness asli.

Pemakaian: python3 scripts/rap-audit/run.py
"""
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.join(REPO, 'scripts', 'rap-audit')

SUITES = [
    ('rap_audit_test.mjs', 'S3. RAP / PAGU / VARIANCE / MARGIN'),
    ('probe_infinity.mjs', 'S3. FIXTURE NEGATIF Infinity/NaN/locale'),
    ('probe_rap_compare.mjs', 'S3. FIXTURE NEGATIF pagu & variance'),
    ('verify_csv.mjs', 'S3. KESELARASAN CSV variance'),
]


def main():
    ok = True
    for script, label in SUITES:
        path = os.path.join(HERE, script)
        print(f'\n================ {label} ================')
        if not os.path.exists(path):
            print(f'HARNESS HILANG: {path}')
            ok = False
            continue
        r = subprocess.run(['node', script], cwd=HERE, capture_output=True, text=True, timeout=600)
        out = (r.stdout or '') + (r.stderr or '')
        # tampilkan baris ringkas saja (hindari ratusan baris probe)
        for ln in out.splitlines():
            if re.search(r'TOTAL|LULUS|GAGAL|FATAL|Error|✗', ln):
                print('  ' + ln.strip())
        if r.returncode != 0:
            ok = False
            print(f'  EXIT={r.returncode}')

    print('\n================ HASIL AKHIR ================')
    print('SEMUA HARNESS RAP-AUDIT LULUS' if ok else 'ADA HARNESS RAP-AUDIT YANG GAGAL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
