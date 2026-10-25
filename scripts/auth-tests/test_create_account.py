#!/usr/bin/env python3
"""
Test Traceable: Verifikasi Pembuatan Akun Baru (admin_create_user)
Format Log Terstruktur: [TIMESTAMP] [LEVEL] [MODULE] - PESAN
"""

import sys
import os
import json
import urllib.request
import urllib.error
from datetime import datetime

# Setup path & credentials
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DRIVE_SYNC_DIR = "/home/ubuntu/workspace/drive_sync"

def log(level, module, msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] [{level:<5}] [{module}] {msg}")

def main():
    log("INFO", "INIT", "Membaca konfigurasi endpoint Supabase...")
    try:
        with open(os.path.join(DRIVE_SYNC_DIR, "sb_url.txt")) as f:
            sb_url = f.read().strip()
        with open(os.path.join(DRIVE_SYNC_DIR, "sb_key.txt")) as f:
            sb_key = f.read().strip()
    except Exception as e:
        log("ERROR", "CONFIG", f"Gagal membaca sb_url / sb_key: {e}")
        sys.exit(1)

    log("INFO", "CONFIG", f"Supabase URL: {sb_url}")
    log("INFO", "TEST", "Verifikasi status RPC admin_create_user dengan payload dummy...")

    url = f"{sb_url}/rest/v1/rpc/admin_create_user"
    headers = {
        'apikey': sb_key,
        'Authorization': f'Bearer {sb_key}',
        'Content-Type': 'application/json'
    }

    # Anon call should reject with not_authenticated (guard working)
    req = urllib.request.Request(url, data=json.dumps({
        'p_email': 'probe@test.com',
        'p_password': 'Password123!',
        'p_full_name': 'Probe Test',
        'p_role': 'user'
    }).encode(), headers=headers, method='POST')

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            if data.get('reason') == 'not_authenticated':
                log("INFO", "GUARD", "✓ RPC Guard OK: Anon request ditolak dengan 'not_authenticated'.")
            else:
                log("WARN", "GUARD", f"Respon guard tidak terduga: {data}")
    except Exception as e:
        log("ERROR", "RPC", f"Koneksi gagal: {e}")

    log("INFO", "DONE", "Verifikasi selesai.")

if __name__ == "__main__":
    main()
