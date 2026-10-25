#!/usr/bin/env python3
"""
scripts/all-modules-compact-test/run.py
Harness Pengujian Komprehensif Seluruh 22 Nav IDs x 7 Viewport COMMON
Memverifikasi tidak ada horizontal scroll, tidak ada table-scroll-hint,
tidak ada swipe-only tabs, serta seluruh admin guard & komponen shared fit-container.
"""
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEST_SCRIPT = os.path.join(REPO, 'scripts', 'all-modules-compact-test', 'all_modules_test.mjs')

def main():
    print("=" * 65)
    print("ALL MODULES COMPACT & COVERAGE TEST (22 MODUL X 7 VIEWPORTS)")
    print("=" * 65)
    
    cmd = ['node', TEST_SCRIPT]
    res = subprocess.run(cmd, cwd=REPO)
    sys.exit(res.returncode)

if __name__ == '__main__':
    main()
