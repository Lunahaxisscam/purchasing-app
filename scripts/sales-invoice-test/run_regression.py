#!/usr/bin/env python3
"""Jalankan seluruh harness regresi terkait dan rangkum hasilnya."""
import json
import os
import re
import subprocess
import sys

REPO = '/home/ubuntu/dev-workspaces/agent-1-ops'

SUITES = [
    ('sales-invoice-test (S4, baru)', 'scripts/sales-invoice-test/run.py'),
    ('rap-test (S3)', 'scripts/rap-test/run.py'),
    ('handover-compact-test (S2)', 'scripts/handover-compact-test/run.py'),
    ('handover-flow-test', 'scripts/handover-flow-test/run.py'),
    ('purchase-flow-test', 'scripts/purchase-flow-test/run.py'),
    ('pr-purchase-compact-test', 'scripts/pr-purchase-compact-test/run.py'),
    ('pr-estimator-test', 'scripts/pr-estimator-test/run.py'),
    ('pr-group-test', 'scripts/pr-group-test/run.py'),
    ('approval-queue-test', 'scripts/approval-queue-test/run.py'),
    ('fase2-save-test', 'scripts/fase2-save-test/run.py'),
    ('showmore-list-test', 'scripts/showmore-list-test/run.py'),
    ('material-acuan-test', 'scripts/material-acuan-test/run.py'),
    ('rab-boq-test', 'scripts/rab-boq-test/run.py'),
]


def main():
    results = []
    for name, rel in SUITES:
        path = os.path.join(REPO, rel)
        if not os.path.exists(path):
            results.append((name, 'MISSING', ''))
            print(f'\n##### {name}: SKIP (tidak ada)')
            continue
        print(f'\n##### {name}')
        r = subprocess.run([sys.executable, path], capture_output=True, text=True, cwd=REPO, timeout=1800)
        out = (r.stdout or '') + (r.stderr or '')
        tail = out.strip().splitlines()[-6:]
        print('\n'.join(tail))
        counts = re.findall(r'(\d+)\s*LULUS,\s*(\d+)\s*GAGAL', out)
        summary = '; '.join(f'{a} lulus/{b} gagal' for a, b in counts) if counts else ''
        status = 'GREEN' if r.returncode == 0 else 'RED'
        results.append((name, status, summary))
        if r.returncode != 0:
            fails = [l for l in out.splitlines() if 'FAIL' in l or '✗' in l][:8]
            if fails:
                print('  --- kegagalan:')
                for f in fails:
                    print('   ', f.strip()[:160])

    print('\n================= RANGKUMAN =================')
    for name, status, summary in results:
        print(f'{status:8} {name:34} {summary}')
    red = [r for r in results if r[1] == 'RED']
    print(f'\nTotal: {len(results) - len(red)} suite hijau, {len(red)} merah')
    return 0 if not red else 1


if __name__ == '__main__':
    sys.exit(main())
