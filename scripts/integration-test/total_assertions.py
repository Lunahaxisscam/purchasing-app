#!/usr/bin/env python3
"""Hitung total assertion dari log bukti integrasi (bukan dari ingatan).

Aturan hitung (LINE-BASED, satu baris = maksimal satu pasangan angka, jadi
tidak ada baris yang dihitung dua kali):

  * baris "bagian"  : "=== HASIL UNIT: 214 lulus, 0 gagal ===",
                      "queue_ui_test: 89/89 lulus", "Total check: 73; gagal: 0".
                      Angka bagian DIJUMLAHKAN.
  * baris "grand"   : "TOTAL: 486 LULUS, 0 GAGAL", "263 LULUS, 0 GAGAL",
                      "HASIL: 56 LULUS, 0 GAGAL".
  * Dilaporkan      = max(jumlah bagian, grand) supaya ringkasan tidak
                      dihitung dua kali, dan suite yang tidak punya ringkasan
                      tetap terhitung dari bagian-bagiannya.

Tidak ada angka yang dikarang: bila tidak ada pola yang cocok, nilainya "-".
"""
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
stamp = sys.argv[1] if len(sys.argv) > 1 else ''
if not stamp:
    base = os.path.join(REPO, 'docs', 'integration-logs')
    stamp = sorted(os.listdir(base))[-1]
LOGDIR = os.path.join(REPO, 'docs', 'integration-logs', stamp)

FRAC = re.compile(r'(\d+)\s*/\s*(\d+)\s*(?:lulus|LULUS|pass|PASS|cek lulus)')
PAIR = re.compile(r'(\d+)\s*(?:LULUS|lulus|PASS|pass)\D{1,4}(\d+)\s*(?:GAGAL|gagal|FAIL|fail)')
TOTCHECK = re.compile(r'Total check:\s*(\d+);\s*gagal:\s*(\d+)')
GRAND = re.compile(r'(?:TOTAL|HASIL TOTAL|HASIL:)\s*[:]?\s*(\d+)\s*(?:LULUS|lulus)\D{1,4}(\d+)\s*(?:GAGAL|gagal)')
GRAND_BARE = re.compile(r'^\s*(\d+)\s*LULUS,\s*(\d+)\s*GAGAL\s*$')

rows = []
tp = tf = 0
for name in sorted(os.listdir(LOGDIR)):
    if not name.endswith('.log'):
        continue
    lines = open(os.path.join(LOGDIR, name), encoding='utf-8', errors='replace').read().splitlines()

    part_p = part_f = 0
    grand_p = grand_f = 0
    for ln in lines:
        m = TOTCHECK.search(ln)
        if m:
            part_p += int(m.group(1))
            part_f += int(m.group(2))
            continue
        m = re.search(r'(?:RENDER_TOTAL|JS_TOTAL|JS_PDF_TOTAL)\s*(\d+),\s*FAIL\s*(\d+)', ln)
        if m:
            # baris per-bagian: jumlah assertion = lulus + gagal
            part_p += int(m.group(1)) - int(m.group(2))
            part_f += int(m.group(2))
            continue
        if GRAND.search(ln) or GRAND_BARE.match(ln):
            g = (GRAND.search(ln) or GRAND_BARE.match(ln))
            grand_p = max(grand_p, int(g.group(1)))
            grand_f = max(grand_f, int(g.group(2)))
            continue
        m = FRAC.search(ln)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            part_p += a
            part_f += (b - a)
            continue
        m = PAIR.search(ln)
        if m:
            part_p += int(m.group(1))
            part_f += int(m.group(2))

    p = max(part_p, grand_p)
    f = max(part_f, grand_f)
    if p == 0 and f == 0:
        rows.append((name[:-4], None, None))
        continue
    rows.append((name[:-4], p, f))
    tp += p
    tf += f

print(f'stamp={stamp}')
print(f'{"suite":42s} {"lulus":>7s} {"gagal":>6s}')
for n, p, f in rows:
    print(f'{n:42s} {str(p) if p is not None else "-":>7s} {str(f) if f is not None else "-":>6s}')
print(f'{"TOTAL":42s} {tp:7d} {tf:6d}')

ev = os.path.join(REPO, 'docs', f'integration-evidence-{stamp}.json')
if os.path.exists(ev):
    data = json.load(open(ev, encoding='utf-8'))
    print('\ncommit:', data['commit'])
    print('branch:', data['branch'], '| e2e_base:', data['e2e_base'])
    red = [r['suite'] for r in data['results'] if r.get('exit') not in (0, None)]
    print('merah:', ', '.join(red) or 'tidak ada')
