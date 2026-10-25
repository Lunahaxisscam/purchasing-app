#!/usr/bin/env python3
"""
Isolated build sandbox t_48f6b336 — .next AKTIF TIDAK disentuh.
Pola sama dgn scripts/pr-estimator-test/build_sandbox.py: salin repo (kecuali
node_modules/.next/.git) ke sandbox /tmp, symlink node_modules repo, jalankan
`next build` dengan distDir terpisah, dan bandingkan BUILD_ID/.next aktif
sebelum-sesudah. SMOKE ikut (ENABLE_SMOKE=1) supaya halaman mock tervalidasi.
"""
import hashlib
import os
import shutil
import subprocess
import sys

REPO = '/home/ubuntu/purchasing-app'
SB = '/tmp/pr-group-build-sbx'

def md5(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    active_bid = open(f'{REPO}/.next/BUILD_ID').read().strip()
    active_md5 = md5(f'{REPO}/.next/BUILD_ID')
    print(f'ACTIVE .next BUILD_ID before: {active_bid} (md5 {active_md5})')

    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(SB)
    for item in os.listdir(REPO):
        if item in ('node_modules', '.next', '.git'):
            continue
        src = os.path.join(REPO, item)
        dst = os.path.join(SB, item)
        if os.path.isdir(src):
            shutil.copytree(src, dst, symlinks=True)
        else:
            shutil.copy2(src, dst)
    os.symlink(f'{REPO}/node_modules', f'{SB}/node_modules')

    env = dict(os.environ)
    env['NEXT_DIST_DIR'] = '.next-isolated'
    env['NEXT_TELEMETRY_DISABLED'] = '1'
    env['ENABLE_SMOKE'] = '1'

    r = subprocess.run(
        ['npx', 'next', 'build'],
        cwd=SB, env=env, capture_output=True, text=True, timeout=1500
    )
    out = (r.stdout or '') + (r.stderr or '')
    tail = '\n'.join(out.strip().splitlines()[-22:])
    print(tail)

    ok = r.returncode == 0
    iso_bid = ''
    for bid_path in (f'{SB}/.next-isolated/BUILD_ID', f'{SB}/.next/BUILD_ID'):
        if os.path.exists(bid_path):
            iso_bid = open(bid_path).read().strip()
            break
    after_bid = open(f'{REPO}/.next/BUILD_ID').read().strip()
    after_md5 = md5(f'{REPO}/.next/BUILD_ID')
    print(f'\nISOLATED BUILD_ID: {iso_bid} (exit {r.returncode})')
    print(f'ACTIVE .next BUILD_ID after: {after_bid} (md5 {after_md5})')
    unchanged = after_bid == active_bid and after_md5 == active_md5
    print(f'ACTIVE .next UNCHANGED: {unchanged}')
    if not ok:
        sys.exit(1)
    print('ISOLATED BUILD OK')

if __name__ == '__main__':
    main()
