#!/usr/bin/env python3
"""
scripts/reminders-test/run_e2e.py — UJI RUNTIME NYATA /api/reminders

Menjalankan DUA server lokal lalu menembak endpoint lewat HTTP:

  1) scripts/reminders-test/fake_supabase.mjs  → Supabase palsu (HTTP), berisi
     data contoh. Tabel `sales_invoices` sengaja TIDAK ADA supaya perilaku
     BLOCKED terbukti. Setiap operasi tulis dicatat dan membuat uji gagal.
  2) `next start` dengan SUPABASE_URL menunjuk ke server palsu itu.

Tidak ada kredensial produksi dan tidak ada tulisan ke DB mana pun.

Prasyarat: build sudah ada (`ENABLE_SMOKE=1 npx next build`).
Pemakaian:  python3 scripts/reminders-test/run_e2e.py
"""
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FAKE_SCRIPT = os.path.join(REPO, 'scripts', 'reminders-test', 'fake_supabase.mjs')
E2E_SCRIPT = os.path.join(REPO, 'scripts', 'reminders-test', 'e2e_runtime_test.mjs')


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_http(url, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code
        except Exception:
            time.sleep(0.5)
    return None


def main():
    if not os.path.exists(os.path.join(REPO, '.next', 'BUILD_ID')):
        print('Build Next belum ada. Jalankan: ENABLE_SMOKE=1 npx next build')
        return 1

    fake_port = free_port()
    app_port = free_port()

    env = dict(os.environ)
    env.update({
        'NODE_ENV': 'test',
        'SUPABASE_URL': f'http://127.0.0.1:{fake_port}',
        'NEXT_PUBLIC_SUPABASE_URL': f'http://127.0.0.1:{fake_port}',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'anon-uji-e2e',
        'SUPABASE_SERVICE_ROLE_KEY': 'service-uji-e2e',
        'REMINDER_PREVIEW_TOKEN': '',
        'SALES_INVOICE_PREVIEW_TOKEN': ''
    })

    fake = subprocess.Popen(['node', FAKE_SCRIPT, str(fake_port)], cwd=REPO, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    app = subprocess.Popen(
        ['npx', 'next', 'start', '-p', str(app_port)],
        cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )

    ok = False
    try:
        status = wait_http(f'http://127.0.0.1:{fake_port}/rest/v1/purchase_requests')
        print(f'fake-supabase: HTTP {status}')
        status2 = wait_http(f'http://127.0.0.1:{app_port}/api/reminders')
        print(f'next app     : HTTP {status2} (401 = endpoint menolak tanpa sesi, benar)')

        r = subprocess.run(
            ['node', E2E_SCRIPT, f'http://127.0.0.1:{app_port}', '--fake-supabase', f'http://127.0.0.1:{fake_port}'],
            cwd=REPO, env=env, capture_output=True, text=True, timeout=300
        )
        print(r.stdout.rstrip())
        if r.stderr.strip():
            print('STDERR:', r.stderr[:2000])
        ok = r.returncode == 0
    finally:
        for p in (app, fake):
            try:
                p.terminate()
                p.wait(timeout=10)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass

    print('\n================ HASIL E2E ================')
    print('E2E RUNTIME LULUS' if ok else 'E2E RUNTIME GAGAL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
