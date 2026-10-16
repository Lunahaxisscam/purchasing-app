#!/usr/bin/env python3
"""
HARNESS REGRESI DESIGN TOKENS — UI OLIVE/SAGE (Blossom t_0b304478)
=================================================================
Tujuan: membuktikan secara terukur (tanpa DB, tanpa menyentuh repo) bahwa:

  A) Token palet olive/sage/ivory ADA di styles/globals.css.
  B) Token semantik (ok/warn/danger) + tint ADA, sehingga status tidak
     disampaikan lewat warna saja (teks/ikon tetap wajib di JSX).
  C) Tidak ada lagi DEKLARASI warna lama yang bocor:
     - "Tech Blue" #1a73e8 sebagai nilai warna (bukan sekadar di selector override),
     - font-weight ganjil 550/650/750/850,
     - palet forest lama (#173d36 / #102b27) sebagai nilai warna.
  D) Utilitas finansial & a11y ADA: tabular-nums, :focus-visible,
     touch target 44px mobile, fade hint filter, label grup sidebar.
  E) Runtime: CSS yang DISAJIKAN preview (port 3001) memuat token olive
     (bukti bundle tidak stale). Jika preview tidak dapat dihubungi, tahap
     ini dilaporkan SKIP (bukan gagal) supaya harness tetap portabel.

Jalankan dari root repo:  python3 scripts/ui-olive-tokens-test/run.py
"""
import os, re, sys, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSS = os.path.join(REPO, 'styles', 'globals.css')
CONST = os.path.join(REPO, 'lib', 'constants.js')
PREVIEW = os.environ.get('PREVIEW_URL', 'http://127.0.0.1:3001')

passed = 0
failed = 0
skipped = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f"  \u2713 {name}")
    else:
        failed += 1
        print(f"  \u2717 {name} {detail}")


def value_hexes(css):
    """Ambil hex yang muncul SEBAGAI NILAI warna (setelah ':' atau '('),
    abaikan yang berada di dalam selector [style*=...] (override lama)."""
    # buang isi atribut selector [style*="..."]
    stripped = re.sub(r'\[style\*="[^"]*"\]', '', css)
    return [h.lower() for h in re.findall(r'[:,(]\s*(#[0-9a-fA-F]{6})', stripped)]


def main():
    print("=" * 62)
    print("REGRESI DESIGN TOKENS UI OLIVE/SAGE (t_0b304478)")
    print("=" * 62)

    css = open(CSS, encoding='utf-8').read()

    print("\nA. Token palet olive/sage/ivory")
    for tok in ['--olive-800', '--olive-600', '--olive-400', '--ivory', '--sand',
                '--text-main', '--border-light']:
        check(f"token {tok} terdefinisi", tok in css)

    print("\nB. Token semantik + tint (no color-only status)")
    for tok in ['--ok', '--ok-tint', '--warn', '--warn-tint', '--danger', '--danger-tint']:
        check(f"token {tok} terdefinisi", tok in css)

    print("\nC. Warna lama tidak bocor sebagai NILAI warna")
    vals = value_hexes(css)
    check("Tech Blue #1a73e8 tidak dipakai sebagai nilai", '#1a73e8' not in vals,
          f"(ditemukan {vals.count('#1a73e8')}x)")
    check("Forest lama #173d36 tidak dipakai sebagai nilai", '#173d36' not in vals,
          f"(ditemukan {vals.count('#173d36')}x)")
    check("Forest lama #102b27 tidak dipakai sebagai nilai", '#102b27' not in vals,
          f"(ditemukan {vals.count('#102b27')}x)")
    check("Warm sand lama #d6c29f tidak dipakai sebagai nilai", '#d6c29f' not in vals)
    check("Neon admin #f3c969 tidak dipakai sebagai nilai", '#f3c969' not in vals)
    odd = re.findall(r'font-weight:\s*(550|650|750|850)\b', css)
    check("Tidak ada font-weight ganjil (550/650/750/850)", not odd, f"(ditemukan {odd})")

    print("\nD. Utilitas finansial & a11y")
    check("tabular-nums (angka rupiah)", 'tabular-nums' in css)
    check(":focus-visible (fokus keyboard)", ':focus-visible' in css)
    check("touch target 44px di mobile", 'min-height: 44px' in css)
    check("fade hint filter (filter-tabs-wrapper)", '.filter-tabs-wrapper' in css)
    check("label grup sidebar (.nav-group-label)", '.nav-group-label' in css)

    print("\nE. Label grup navigasi di lib/constants.js (nama menu tak berubah)")
    konst = open(CONST, encoding='utf-8').read()
    for lab in ["label: 'Operasional'", "label: 'Pengadaan'", "label: 'Arsip'", "label: 'Admin Suite'"]:
        check(f"{lab}", lab in konst)
    # nama menu inti tetap sama (tidak diubah)
    for item in ["['receivings', 'Purchase']", "['tukang_upah', 'Upah Tukang']",
                 "['planning', 'Budgeting']", "['approvals', 'Approval']"]:
        check(f"nama menu tetap: {item}", item in konst)

    print("\nF. Runtime: CSS yang disajikan preview memuat token olive")
    try:
        html = urllib.request.urlopen(PREVIEW + '/', timeout=6).read().decode('utf-8', 'ignore')
        m = re.search(r'/_next/static/css/[^"]+\.css', html)
        if not m:
            check("chunk CSS ditemukan di HTML", False, "(tidak ada <link css>)")
        else:
            served = urllib.request.urlopen(PREVIEW + m.group(0), timeout=6).read().decode('utf-8', 'ignore')
            check("served CSS memuat --olive-600", '--olive-600' in served)
            check("served CSS memuat tabular-nums", 'tabular-nums' in served)
            check("served CSS BUKAN bundle lama (tanpa forest #102b27 sbg nilai)",
                  '#102b27' not in served)
    except Exception as e:
        global skipped
        skipped += 3
        print(f"  ~ SKIP runtime (preview tak terjangkau): {e}")

    print("\n" + "=" * 62)
    print(f"HASIL: {passed} LULUS, {failed} GAGAL, {skipped} SKIP")
    print("=" * 62)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
