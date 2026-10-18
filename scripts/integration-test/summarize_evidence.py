#!/usr/bin/env python3
"""Ringkas artefak docs/integration-evidence-*.json + angka tambahan dari log.

Dipakai laporan paket akhir supaya setiap angka bisa ditelusuri ke artefak.

Kenapa perlu skrip ini:
  run_all.py hanya mengenali beberapa format ringkasan (`X/Y lulus`,
  `TOTAL: X LULUS, Y GAGAL`, dst). Suite dengan format lain tercatat
  parsed=false dan assertion-nya TIDAK masuk total — kalau angka itu dipakai
  apa adanya, total yang dilaporkan lebih kecil dari kenyataan. Skrip ini
  membaca log mentah untuk suite tsb dan mencetak angka per suite, sehingga
  laporan bisa menyebut angka yang benar-benar terbaca (bukan tebakan).

Aturan anti-hitung-ganda: untuk satu log diambil SATU ringkasan (kandidat
dengan jumlah assertion terbesar), bukan menjumlahkan semua baris ringkasan
yang sering dicetak dua kali dalam format berbeda.

Pemakaian: python3 scripts/integration-test/summarize_evidence.py [file.json]
"""
import glob
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PATTERNS = [
    (r'HASIL:\s*(\d+)\s*ok,\s*(\d+)\s*FAIL', 'pair'),
    (r'(\d+)\s+ok,\s*(\d+)\s*FAIL', 'pair'),
    (r'TOTAL:\s*(\d+)\s*LULUS,\s*(\d+)\s*GAGAL', 'pair'),
    (r'(\d+)\s*LULUS,\s*(\d+)\s*GAGAL', 'pair'),
    (r'TOTAL:\s*LULUS=(\d+)\s*GAGAL=(\d+)', 'pair'),
    (r'\[[A-Z+]*\]\s*lulus=(\d+)\s*gagal=(\d+)', 'pair'),
    (r'(\d+)\s*/\s*(\d+)\s*lulus', 'frac'),
    (r'(\d+)\s*/\s*(\d+)\s*cek lulus', 'frac'),
    (r'(?:JS_PDF_TOTAL|RENDER_TOTAL|JS_TOTAL)\s*(\d+),\s*FAIL\s*(\d+)', 'pair'),
    (r'HASIL:\s*(\d+)\s*lulus,\s*(\d+)\s*gagal', 'pair'),
    (r'TOTAL assertion lulus\s*:\s*(\d+)', 'pass_only'),
]


def counts(text):
    """Satu ringkasan per log: kandidat dengan total assertion terbesar.

    Pengecualian: beberapa suite (mis. growth-kpi-test) mencetak ringkasan
    PER BAGIAN (`F1/F2 LULUS: 26 assertion`, `F3/F5 ... 30`, dst). Bagian
    itu saling lepas, jadi jumlahnya memang total — dijumlahkan, bukan
    diambil maksimum.
    """
    sections = re.findall(r'^F[\w/]+ LULUS:\s*(\d+)\s*assertion', text, re.M)
    if len(sections) > 1:
        return (sum(int(x) for x in sections), 0, 'sections')

    best = (0, 0, None)
    for pat, kind in PATTERNS:
        for m in re.finditer(pat, text, re.M):
            if m.lastindex and m.lastindex >= 2:
                a, b = int(m.group(1)), int(m.group(2))
                if kind == 'frac':
                    b = b - a
            else:
                a, b = int(m.group(1)), 0
            if sum((a, b)) > sum(best[:2]):
                best = (a, b, pat)
    return best


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
        unparsed = []
        for r in res:
            if r.get('parsed') or r.get('exit') is None:
                continue
            safe = str(r.get('suite')).replace('/', '__')
            lp = os.path.join(logdir, f'{safe}.log')
            try:
                text = open(lp, encoding='utf-8', errors='replace').read()
            except OSError:
                unparsed.append((r.get('suite'), None, None))
                continue
            a, b, pat = counts(text)
            if pat:
                extra_pass += a
                extra_fail += b
                unparsed.append((r.get('suite'), a, b))
            else:
                unparsed.append((r.get('suite'), None, None))
        secs = sum((r.get('seconds') or 0) for r in res)
        print(f'== {os.path.basename(f)}')
        print(f'   commit={str(d.get("commit", "?"))[:8]} stamp={stamp}')
        print(f'   suite={len(res)} hijau={len(green)} merah={len(red)} dilewati={len(skipped)}')
        print(f'   assertion terparse run_all : lulus={parsed_pass} gagal={parsed_fail}')
        print(f'   assertion dari log tambahan: lulus={extra_pass} gagal={extra_fail}')
        print(f'   TOTAL terbaca              : lulus={parsed_pass + extra_pass} '
              f'gagal={parsed_fail + extra_fail}')
        print(f'   durasi={round(secs, 1)}s')
        if unparsed:
            print('   suite tanpa angka terparse:')
            for name, a, b in unparsed:
                if a is None:
                    print(f'     {name}: tidak ada ringkasan terbaca di log (hanya exit code)')
                else:
                    print(f'     {name}: lulus={a} gagal={b}')
        for r in red:
            print(f'   MERAH {r.get("suite")} exit={r.get("exit")} '
                  f'passed={r.get("passed")} failed={r.get("failed")} note={str(r.get("note", ""))[:110]}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
