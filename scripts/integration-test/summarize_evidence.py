#!/usr/bin/env python3
"""Ringkas artefak docs/integration-evidence-*.json: hitung suite, assertion, merah.

Dipakai laporan akhir supaya angka diambil dari artefak (bukan ingatan).

Catatan kejujuran angka:
  run_all.py hanya mengambil angka lulus/gagal dari pola ringkasan yang
  dikenali (`X/Y lulus`, `TOTAL: X LULUS, Y GAGAL`, dst). Suite yang memakai
  format lain (mis. `TOTAL: LULUS=36 GAGAL=0`, `[A] lulus=35`) tercatat
  `parsed=false` sehingga assertion-nya TIDAK masuk total. Skrip ini membaca
  ulang log mentah di docs/integration-logs/<stamp>/ untuk pola tambahan itu,
  supaya total yang dilaporkan tidak lebih kecil dari kenyataan.

Pemakaian: python3 scripts/integration-test/summarize_evidence.py [file.json ...]
"""
import glob
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Pola tambahan untuk suite yang format ringkasannya tidak dikenali run_all.py.
EXTRA = [
    (r'TOTAL:\s*LULUS=(\d+)\s*GAGAL=(\d+)', 'pair'),
    (r'TOTAL assertion lulus\s*:\s*(\d+)', 'pass_only'),
    (r'\[[A-Z+]*\]\s*lulus=(\d+)\s*gagal=(\d+)', 'pair'),
    (r'F\d+\s*LULUS:\s*(\d+)\s*assertion', 'pass_only'),
    (r'^\s*(\d+)\s+lulus,\s*(\d+)\s+gagal', 'pair'),
]


def extra_counts(logpath):
    """Kembalikan (lulus, gagal) dari pola tambahan di satu file log."""
    try:
        text = open(logpath, encoding='utf-8', errors='replace').read()
    except OSError:
        return 0, 0
    lulus = gagal = 0
    seen = set()
    for pat, kind in EXTRA:
        for m in re.finditer(pat, text, re.M):
            key = (pat, m.start())
            if key in seen:
                continue
            seen.add(key)
            if kind == 'pair':
                lulus += int(m.group(1))
                gagal += int(m.group(2))
            else:
                lulus += int(m.group(1))
    return lulus, gagal


def main(argv):
    files = argv[1:]
    if not files:
        files = sorted(glob.glob(os.path.join(REPO, 'docs', 'integration-evidence-*.json')))
    for f in files:
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception as e:  # noqa: BLE001
            print(f'{os.path.basename(f)}: GAGAL dibaca ({e})')
            continue
        res = d.get('results', [])
        stamp = d.get('stamp', '')
        logdir = os.path.join(REPO, 'docs', 'integration-logs', stamp)
        green = [r for r in res if r.get('exit') == 0]
        red = [r for r in res if r.get('exit') not in (0, None)]
        skipped = [r for r in res if r.get('skipped')]
        parsed_pass = sum((r.get('passed') or 0) for r in res)
        parsed_fail = sum((r.get('failed') or 0) for r in res)
        extra_pass = extra_fail = 0
        unparsed = [r for r in res if r.get('exit') == 0 and not r.get('parsed')]
        for r in unparsed:
            safe = str(r.get('suite')).replace('/', '__')
            lp = os.path.join(logdir, f'{safe}.log')
            a, b = extra_counts(lp)
            extra_pass += a
            extra_fail += b
        secs = sum((r.get('seconds') or 0) for r in res)
        print(f'== {os.path.basename(f)}')
        print(f'   commit={str(d.get("commit", "?"))[:8]} stamp={stamp}')
        print(f'   suite={len(res)} hijau={len(green)} merah={len(red)} dilewati={len(skipped)}')
        print(f'   assertion (pola run_all)   lulus={parsed_pass} gagal={parsed_fail}')
        print(f'   assertion (log tambahan)   lulus={extra_pass} gagal={extra_fail}')
        print(f'   assertion (total terbaca)  lulus={parsed_pass + extra_pass} gagal={parsed_fail + extra_fail}')
        print(f'   durasi={round(secs, 1)}s')
        if unparsed:
            print('   suite tanpa angka terparse: ' + ', '.join(str(r.get('suite')) for r in unparsed))
        for r in red:
            print(f'   MERAH {r.get("suite")} exit={r.get("exit")} '
                  f'passed={r.get("passed")} failed={r.get("failed")} note={str(r.get("note", ""))[:120]}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
