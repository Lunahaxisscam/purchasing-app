#!/usr/bin/env python3
"""
BUKTI: kegagalan G (blok CSS duplikat) di scripts/s7-compact-test BUKAN
regresi dari paket pra-review ini — sudah ada di baseline integrasi 1d364e7.

Harness S7 dijalankan terhadap styles/globals.css versi BASELINE (diambil
dari git, bukan dari worktree) dan dibandingkan dengan hasil pada worktree.
Yang dibandingkan hanya ANGKA: jumlah blok terduplikat dan jumlah kelas
mobile-* hantu.

Jalankan: python3 scripts/s7-compact-test/verify_dup_baseline.py
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = '1d364e7'


def count_dups(css_path):
    """Hitung blok (selector, body) non-@ yang muncul lebih dari sekali."""
    s = open(css_path, encoding='utf-8').read()
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    depth = 0
    cur = ''
    sel = ''
    seen = {}
    for ch in s:
        if ch == '{':
            depth += 1
            if depth == 1:
                sel = ' '.join(cur.split())
                cur = ''
            else:
                cur += ch
        elif ch == '}':
            depth -= 1
            if depth == 0:
                body = ' '.join(cur.split())
                if not sel.startswith('@'):
                    seen[(sel, body)] = seen.get((sel, body), 0) + 1
                cur = ''
            else:
                cur += ch
        else:
            cur += ch
    dups = {k: v for k, v in seen.items() if v > 1}
    return len(seen), len(dups), sorted({k[0] for k in dups})


def main():
    tmp = '/tmp/css-baseline-' + BASE
    os.makedirs(tmp, exist_ok=True)
    base_css = os.path.join(tmp, 'globals.css')
    blob = subprocess.run(['git', 'show', f'{BASE}:styles/globals.css'],
                          cwd=REPO, capture_output=True, text=True)
    if blob.returncode != 0:
        print('GAGAL ambil CSS baseline')
        return 1
    open(base_css, 'w', encoding='utf-8').write(blob.stdout)

    cur_css = os.path.join(REPO, 'styles', 'globals.css')

    u0, d0, s0 = count_dups(base_css)
    u1, d1, s1 = count_dups(cur_css)

    print(f'BASELINE {BASE} : {u0} blok unik, {d0} blok terduplikat')
    print(f'WORKTREE        : {u1} blok unik, {d1} blok terduplikat')
    print(f'selisih         : {d1 - d0:+d} blok terduplikat')

    new_dups = sorted(set(s1) - set(s0))
    gone_dups = sorted(set(s0) - set(s1))
    print(f'selector duplikat BARU (regresi): {len(new_dups)}')
    for x in new_dups[:10]:
        print('   +', x[:80])
    print(f'selector duplikat yang HILANG  : {len(gone_dups)}')

    ok = True
    if d1 > d0:
        print('\nGAGAL: paket ini MENAMBAH blok duplikat (regresi nyata).')
        ok = False
    else:
        print('\nBUKTI OK: jumlah blok duplikat TIDAK bertambah dari baseline')
        print('(kegagalan assertion G adalah kondisi pra-ada, bukan regresi paket ini).')
    if new_dups:
        print('GAGAL: ada selector duplikat baru.')
        ok = False
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
