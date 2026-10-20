#!/usr/bin/env python3
"""Harness uji kontrak Tahap A (project data map) — tanpa DB, tanpa jaringan.

Cara kerja:
  1. Sandbox TMPDIR resmi (bukan /tmp global): lib/projectCrosswalk.js disalin
     apa adanya ke sandbox sebagai .mjs (ESM) supaya bisa diimpor Node.
  2. Jalankan crosswalk_test.mjs terhadap sandbox.
  3. Cetak laporan JSON; exit code mengikuti hasil tes.

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


def main():
    sandbox = tempfile.mkdtemp(prefix='project-data-map-')
    try:
        os.makedirs(os.path.join(sandbox, 'lib'), exist_ok=True)
        if not os.path.exists(LIB):
            print(json.dumps({'pass': 0, 'fail': 1, 'red': True,
                              'failures': ['lib/projectCrosswalk.js belum ada (RED)']}, indent=2))
            return 1
        shutil.copyfile(LIB, os.path.join(sandbox, 'lib', 'projectCrosswalk.js'))

        proc = subprocess.run(
            ['node', os.path.join(HERE, 'crosswalk_test.mjs'), sandbox],
            capture_output=True, text=True, timeout=180)
        sys.stdout.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        return proc.returncode
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
