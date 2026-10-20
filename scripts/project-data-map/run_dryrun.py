#!/usr/bin/env python3
"""Jalankan dry-run kontrak Tahap A terhadap snapshot sumber (read-only).

Lib ESM disalin ke sandbox TMPDIR sebagai .mjs, lalu dryrun.mjs dijalankan
dengan path snapshot privat + dua output: privat (lengkap) dan git (anonim).

Jalankan: python3 scripts/project-data-map/run_dryrun.py
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
PRIVATE = '/home/ubuntu/agents/bamboo/purchasing-project-data-map'
GIT_OUT = os.path.join(REPO, 'docs', 'project-cost', 'dry-run-evidence.json')


def newest(prefix):
    files = sorted(glob.glob(os.path.join(PRIVATE, prefix)))
    return files[-1] if files else None


def main():
    cw = os.path.join(PRIVATE, 'crosswalk-audit.json')
    snap = newest('source-snapshot-*.json')
    closing = os.path.join(PRIVATE, 'closing-key-rows.json')
    detail = os.path.join(PRIVATE, 'source-detail-audit.json')
    missing = [p for p in (cw, snap, closing, detail) if not p or not os.path.exists(p)]
    if missing:
        print(json.dumps({'ok': False, 'blocker': 'snapshot sumber belum lengkap',
                          'missing': missing}, indent=2))
        return 2

    sandbox = tempfile.mkdtemp(prefix='project-data-map-dry-')
    try:
        os.makedirs(os.path.join(sandbox, 'lib'), exist_ok=True)
        lib_mjs = os.path.join(sandbox, 'lib', 'projectCrosswalk.mjs')
        shutil.copyfile(os.path.join(REPO, 'lib', 'projectCrosswalk.js'), lib_mjs)

        env = dict(os.environ, CW_LIB=lib_mjs)
        out_priv = os.path.join(PRIVATE, 'dryrun-evidence.json')
        proc = subprocess.run(
            ['node', os.path.join(HERE, 'dryrun.mjs'), cw, snap, closing, detail, out_priv, GIT_OUT],
            capture_output=True, text=True, timeout=300, env=env)
        sys.stdout.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        print('out_private:', out_priv)
        print('out_git    :', GIT_OUT)
        return proc.returncode
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
