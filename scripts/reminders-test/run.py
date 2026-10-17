#!/usr/bin/env python3
"""
scripts/reminders-test/run.py — UJI LAPISAN REMINDER / READINESS (S5)

Menjalankan tiga harness Node (tanpa DB, tanpa jaringan):

  A. rules_test.mjs   — mesin aturan murni: 7 jenis reminder, ambang, BLOCKED,
                        read-only (dataset tidak dimutasi), urutan, render teks.
  B. api_test.mjs     — otorisasi endpoint: 401 tanpa sesi, 403 non-admin,
                        503 fail closed, token pratinjau, 405 non-GET,
                        readiness, format=text, bukti tidak ada jalur tulis.
  C. parity_test.mjs  — paritas pembaca penanda nota dengan parser kanonik
                        lib/purchaseNote.js + bukti read-only seluruh lapisan
                        (tidak ada insert/update/delete/rpc, tidak ada cron).

Pemakaian: python3 scripts/reminders-test/run.py
"""
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEST = os.path.join(REPO, 'scripts', 'reminders-test')

SUITES = [
    ('rules_test.mjs', 'A. MESIN ATURAN (MURNI)'),
    ('api_test.mjs', 'B. OTORISASI & ENDPOINT /api/reminders'),
    ('parity_test.mjs', 'C. PARITAS PARSER & BUKTI READ-ONLY'),
]


def main():
    total_pass = 0
    total_fail = 0
    failures = []
    for script, label in SUITES:
        path = os.path.join(TEST, script)
        if not os.path.exists(path):
            print(f'\n================ {label} ================')
            print(f'HARNESS HILANG: {path}')
            total_fail += 1
            failures.append(f'{script}: hilang')
            continue
        print(f'\n================ {label} ================')
        r = subprocess.run(
            ['node', path],
            capture_output=True, text=True, cwd=REPO,
            env=dict(os.environ, NODE_ENV='test'),
            timeout=300
        )
        print(r.stdout.rstrip())
        if r.stderr.strip():
            print('STDERR:', r.stderr[:2000])
        m = re.findall(r'(\d+)\s*LULUS,\s*(\d+)\s*GAGAL', r.stdout or '')
        if m:
            total_pass += int(m[-1][0])
            total_fail += int(m[-1][1])
        if r.returncode != 0:
            failures.append(script)
            if not m:
                total_fail += 1

    print('\n================ HASIL AKHIR ================')
    print(f'TOTAL: {total_pass} LULUS, {total_fail} GAGAL')
    if failures:
        print('HARNESS GAGAL: ' + ', '.join(failures))
        return 1
    print('SEMUA HARNESS REMINDER LULUS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
