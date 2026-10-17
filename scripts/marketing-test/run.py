#!/usr/bin/env python3
"""
scripts/marketing-test/run.py — UJI LAPISAN KONTRAK MARKETING → CRM/PROJECT (S6)

Menjalankan tiga harness Node (tanpa DB, tanpa jaringan):

  A. contract_test.mjs — kontrak murni: taksonomi sumber lead, mesin status,
                         gerbang bukti kualifikasi, normalisasi kontak & kunci
                         dedupe, rencana handoff, atribusi kampanye, perilaku
                         fixture, kemurnian (input tidak dimutasi).
  B. api_test.mjs      — otorisasi & route guard: 401/403/503, 405, 403 untuk
                         setiap aksi keluar (send/ads/sync/…), readiness
                         BLOCKED (bukan "0 lead"), sample dry-run, bukti tidak
                         ada jalur tulis/kirim di handler.
  C. safety_test.mjs   — bukti "tidak mengganggu purchasing": nol operasi tulis,
                         nol transport pesan/iklan/cron, probe tidak menyentuh
                         tabel purchasing, kode purchasing tidak membaca tabel
                         marketing, nol migrasi, nol file modul lain berubah.

Pemakaian: python3 scripts/marketing-test/run.py
"""
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEST = os.path.join(REPO, 'scripts', 'marketing-test')

SUITES = [
    ('contract_test.mjs', 'A. KONTRAK MURNI (LEAD → CRM/PROJECT)'),
    ('api_test.mjs', 'B. OTORISASI, ROUTE GUARD & ENDPOINT /api/marketing-contract'),
    ('safety_test.mjs', 'C. BUKTI TIDAK MENGGANGGU PURCHASING'),
]


def main():
    total_pass = 0
    total_fail = 0
    failures = []
    for script, label in SUITES:
        path = os.path.join(TEST, script)
        if not os.path.exists(path):
            print(f'\n================ {label} ================')
            print(f'HARNESS HILANG: {path}')
            total_fail += 1
            failures.append(f'{script}: hilang')
            continue
        print(f'\n================ {label} ================')
        r = subprocess.run(
            ['node', path],
            capture_output=True, text=True, cwd=REPO,
            env=dict(os.environ, NODE_ENV='test'),
            timeout=300
        )
        print(r.stdout.rstrip())
        if r.stderr.strip():
            print('STDERR:', r.stderr[:2000])
        m = re.findall(r'(\d+)\s*LULUS,\s*(\d+)\s*GAGAL', r.stdout or '')
        if m:
            total_pass += int(m[-1][0])
            total_fail += int(m[-1][1])
        if r.returncode != 0:
            failures.append(script)

    print('\n================ HASIL TOTAL ================')
    print(f'{total_pass} LULUS, {total_fail} GAGAL')
    if failures:
        print('GAGAL: ' + ' | '.join(failures))
        return 1
    print('SEMUA VERIFIKASI KONTRAK MARKETING → CRM/PROJECT LULUS')
    print('Catatan: lapisan ini DRY-RUN. Tidak ada pesan terkirim, tidak ada iklan')
    print('dibeli, tidak ada tabel ditulis, tidak ada migrasi dijalankan.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
