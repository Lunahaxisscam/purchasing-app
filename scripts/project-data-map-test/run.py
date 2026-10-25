#!/usr/bin/env python3
"""Harness uji kontrak Tahap A + regresi integrasi Tahap B — tanpa DB, tanpa jaringan.

Cara kerja:
  1. Sandbox TMPDIR resmi (bukan /tmp global): lib/projectCrosswalk.js disalin
     apa adanya ke sandbox sebagai .mjs (ESM) supaya bisa diimpor Node.
  2. Jalankan setiap skrip uji terhadap sandbox:
       - crosswalk_test.mjs        (kontrak Tahap A, 36 cek)
       - regression_integrator.mjs (tiga regresi VERIFICATION_A, lane B)
  3. Cetak laporan JSON gabungan; exit code mengikuti hasil tes.

Tidak menyentuh .next, tidak menulis DB, tidak memanggil Drive.

Jalankan: python3 scripts/project-data-map-test/run.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(REPO, 'lib', 'projectCrosswalk.js')

SUITES = ['crosswalk_test.mjs', 'regression_integrator.mjs']


def main():
    sandbox = tempfile.mkdtemp(prefix='project-data-map-')
    try:
        os.makedirs(os.path.join(sandbox, 'lib'), exist_ok=True)
        if not os.path.exists(LIB):
            print(json.dumps({'pass': 0, 'fail': 1, 'red': True,
                              'failures': ['lib/projectCrosswalk.js belum ada (RED)']}, indent=2))
            return 1
        shutil.copyfile(LIB, os.path.join(sandbox, 'lib', 'projectCrosswalk.js'))

        total_pass = 0
        failures = []
        for suite in SUITES:
            proc = subprocess.run(
                ['node', os.path.join(HERE, suite), sandbox],
                capture_output=True, text=True, timeout=300)
            out = (proc.stdout or '').strip()
            try:
                parsed = json.loads(out)
                total_pass += int(parsed.get('pass', 0))
                for f in parsed.get('failures', []):
                    failures.append(f'{suite}: {f}')
            except Exception:
                sys.stderr.write(proc.stderr or '')
                failures.append(f'{suite}: keluaran tidak terbaca (exit {proc.returncode})')
                failures.append((out or '')[-400:])
        report = {
            'suites': SUITES,
            'pass': total_pass,
            'fail': len(failures),
            'failures': failures,
        }
        print(json.dumps(report, indent=2))
        return 1 if failures else 0
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
