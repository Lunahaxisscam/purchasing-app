#!/usr/bin/env python3
"""
scripts/approval-off-test/enable_in_sandbox.py — HELPER HARNESS (bukan kode app)
===============================================================================
Sejak t_50b783de modul Approval purchasing DINONAKTIFKAN lewat satu flag di
`lib/constants.js` (APPROVAL_MODULE_ENABLED = false). Kode modulnya SENGAJA
dipertahankan (reversible) dan tetap harus teruji.

Harness lama yang menguji UI modul Approval (approval-queue, approval-item,
pr-group, showmore, pr-estimator, pr-estimate-sync, s7-compact, all-modules)
karena itu menyalakan flag DI SALINAN SANDBOX saja:

  * sumber repo TIDAK diubah (produksi tetap OFF),
  * perubahan hanya pada file hasil copy di /tmp/<sandbox>/lib/constants.mjs,
  * perilaku produksi (OFF) dijaga oleh scripts/approval-off-test/*.

Dipakai: `from enable_in_sandbox import force_enable` (sys.path disiapkan
oleh run.py masing-masing) atau salin 3 baris di bawah.
"""

import os

NEEDLE = 'export const APPROVAL_MODULE_ENABLED = false'
REPLACEMENT = 'export const APPROVAL_MODULE_ENABLED = true'


def force_enable(sandbox_dir, rel='lib/constants.mjs'):
    """Balik flag di SALINAN sandbox. Gagal keras bila pola tidak ditemukan."""
    path = os.path.join(sandbox_dir, rel)
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    if NEEDLE not in src:
        raise SystemExit(
            f'[enable_in_sandbox] pola flag tidak ditemukan di {path}. '
            'Perbarui helper ini bila deklarasi flag berubah.'
        )
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(src.replace(NEEDLE, REPLACEMENT, 1))
    print(f'[approval-off] sandbox: APPROVAL_MODULE_ENABLED=true (uji UI modul Approval; repo tetap OFF)')
