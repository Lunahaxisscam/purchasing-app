#!/usr/bin/env python3
"""Harness Tahap B (t_da4a9ef8) — breakdown cost per proyek.

Sandbox memakai TMPDIR resmi. File yang disalin VERBATIM dari repo:
  lib/projectCostBreakdown.js, lib/projectCrosswalk.js, lib/purchaseNote.js
Specifier import ditulis ulang ke bentuk .mjs di sandbox (tidak ada salinan
logika). Tanpa DB, tanpa jaringan, tanpa .next.

Jalankan: python3 scripts/project-cost-link-test/run.py
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

FILES = [
    'lib/projectCrosswalk.js',
    'lib/projectCostBreakdown.js',
    'lib/purchaseNote.js',
]


def main():
    sandbox = tempfile.mkdtemp(prefix='project-cost-link-')
    try:
        for rel in FILES:
            src = os.path.join(REPO, rel)
            if not os.path.exists(src):
                print(json.dumps({'pass': 0, 'fail': 1, 'failures': [f'{rel} belum ada']}, indent=2))
                return 1
            body = open(src, encoding='utf-8').read()
            body = re.sub(r"(from\s+')(\./[^']+?)(\.js)?(')",
                          lambda m: f"{m.group(1)}{m.group(2)}.mjs{m.group(4)}", body)
            out = os.path.join(sandbox, rel.replace('.js', '.mjs'))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, 'w', encoding='utf-8').write(body)

        proc = subprocess.run(['node', os.path.join(HERE, 'breakdown_test.mjs'), sandbox],
                              capture_output=True, text=True, timeout=300)
        out = (proc.stdout or '').strip()
        sys.stderr.write(proc.stderr or '')
        try:
            parsed = json.loads(out)
            print(json.dumps(parsed, indent=2))
            return 1 if parsed.get('fail') else 0
        except Exception:
            print(out[-2000:])
            return 1
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
