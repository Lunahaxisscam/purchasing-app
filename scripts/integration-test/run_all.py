#!/usr/bin/env python3
# ============================================================
# scripts/integration-test/run_all.py — regresi penuh branch integrasi
# ============================================================
# Menjalankan SEMUA harness secara BERURUTAN (satu per satu) — bukan paralel.
# Alasan: `next build` di mesin ini hanya punya <1GB RAM tersisa; dua build
# sekaligus membuat OOM dan hasilnya tidak bisa dipercaya.
#
# Hasil ditulis ke docs/integration-evidence-<stamp>.json supaya angka yang
# dilaporkan bisa diaudit ulang (bukan ringkasan dari ingatan).
#
# Pemakaian:
#   python3 scripts/integration-test/run_all.py            # suite saja
#   E2E_BASE=http://127.0.0.1:3014 python3 .../run_all.py  # + e2e HTTP
# ============================================================
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WIB = timezone(timedelta(hours=7))
STAMP = datetime.now(WIB).strftime('%Y%m%d-%H%M%S')
OUT = os.path.join(REPO, 'docs', f'integration-evidence-{STAMP}.json')
LOGDIR = os.path.join(REPO, 'docs', 'integration-logs', STAMP)

# Harness berbasis run.py (urutan sengaja: modul inti dulu, modul baru akhir).
SUITES = [
    'flow-logic-test',
    'fase2-save-test',
    'approval-queue-test',
    # t_7634fa92: aksi per-item Approval (Setujui / Sudah Order) sempat hilang
    # saat panel tbody diganti drawer. Suite ini mengunci bahwa aksi itu
    # benar-benar terjangkau dan memanggil callback dengan payload yang benar.
    'approval-item-action-test',
    'purchase-flow-test',
    'pr-purchase-compact-test',
    'handover-compact-test',
    'handover-flow-test',
    'material-acuan-test',
    'material-export-test',
    'pr-estimator-test',
    'pr-group-test',
    'pr-print-template-test',
    'showmore-list-test',
    'vendors-toolbar-test',
    'manual-input-staging-test',
    'rab-boq-test',
    'rab-boq-render-test',
    'ui-olive-tokens-test',
    'rap-test',
    'sales-invoice-test',
    'reminders-test',
    'marketing-test',
    # t_7634fa92 (pra-review): lapisan UI modul Marketing dipisah dari lapisan
    # kontrak S6 karena keduanya dulu bernama run.py dan bertabrakan saat port.
    # Dua-duanya harus jalan: 263 asersi kontrak + 327 asersi UI.
    'marketing-test/run_ui.py',
    's7-compact-test',
    'crm-test',
    'rap-compare-test',
    'stock-view-test',
    'projects-merge-test',
    'labor-stock-test',
    'flow-gap-repro-test',
]

# Harness e2e (butuh server smoke hidup di E2E_BASE).
E2E_SCRIPTS = [
    ('rap-test', 'node', ['scripts/rap-test/e2e_runtime_test.mjs', '{base}']),
    ('sales-invoice-test', 'node', ['scripts/sales-invoice-test/e2e_runtime_test.mjs', '{base}']),
    ('reminders-test', 'python3', ['scripts/reminders-test/run_e2e.py', '{base}']),
    ('marketing-test', 'python3', ['scripts/marketing-test/run_e2e.py', '{base}']),
    ('purchase-flow-test', 'node', ['scripts/purchase-flow-test/e2e_runtime_test.mjs'], {'PORT': '{port}'}),
    ('handover-compact-test', 'node', ['scripts/handover-compact-test/e2e_runtime_test.mjs', '{base}']),
    ('handover-flow-test', 'node', ['scripts/handover-flow-test/e2e_runtime_test.mjs'], {'PORT': '{port}'}),
    ('pr-print-template-test', 'node', ['scripts/pr-print-template-test/e2e_runtime_test.mjs'], {'PORT': '{port}'}),
    ('integration-security', 'node', ['scripts/integration-test/security_http_check.mjs', '{base}']),
    ('integration-mobile-unified', 'node', ['scripts/integration-test/mobile_unified_check.mjs', '{base}']),
]

COUNT_RE = re.compile(r'(\d+)\s*(?:/|lulus|LULUS|pass|PASS)', re.I)


def run(cmd, env_extra=None, timeout=1800):
    env = os.environ.copy()
    env.setdefault('NEXT_TELEMETRY_DISABLED', '1')
    if env_extra:
        env.update({k: v for k, v in env_extra.items() if v is not None})
    started = time.time()
    try:
        p = subprocess.run(cmd, cwd=REPO, env=env, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or '') + (p.stderr or ''), round(time.time() - started, 1)
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or '') if isinstance(e.stdout, str) else ''
        return 124, out + '\n[TIMEOUT]', round(time.time() - started, 1)


def summarize(suite, code, out):
    """Ambil angka lulus/gagal dari output; jangan mengarang bila tak terbaca.

    Urutan prioritas pola (semua eksplisit, bukan tebakan):
      1. "X/Y lulus"                       -> passed=X, failed=Y-X
      2. "TOTAL: X LULUS, Y GAGAL"         -> passed=X, failed=Y
      3. "X LULUS, Y GAGAL" / "X lulus, Y gagal"
      4. "Total check: X; gagal: Y"        -> passed=X, failed=Y
      5. "X PASS, Y FAIL"
    Bila tidak ada yang cocok, angka dibiarkan None (parsed=false) dan hanya
    exit code yang dilaporkan — lebih baik kosong daripada salah hitung.
    """
    res = {'suite': suite, 'exit': code, 'parsed': False, 'passed': None, 'failed': None, 'note': ''}

    patterns = [
        (r'(\d+)\s*/\s*(\d+)\s*(?:lulus|LULUS|pass|PASS)', 'frac'),
        (r'(\d+)\s*/\s*(\d+)\s*cek lulus', 'frac'),
        (r'TOTAL:\s*(\d+)\s*LULUS,\s*(\d+)\s*GAGAL', 'pair'),
        (r'(\d+)\s*(?:LULUS|lulus)\D{1,4}(\d+)\s*(?:GAGAL|gagal|FAIL|fail)', 'pair'),
        (r'Total check:\s*(\d+);\s*gagal:\s*(\d+)', 'pair'),
        (r'(\d+)\s*PASS,\s*(\d+)\s*FAIL', 'pair'),
        (r'(?:RENDER_TOTAL|JS_TOTAL)\s*(\d+),\s*FAIL\s*(\d+)', 'pair'),
        (r'HASIL:\s*(\d+)\s*LULUS,\s*(\d+)\s*GAGAL', 'pair'),
    ]
    for pat, kind in patterns:
        found = re.findall(pat, out)
        if not found:
            continue
        a, b = found[-1]
        a, b = int(a), int(b)
        res['passed'] = a
        res['failed'] = (b - a) if kind == 'frac' else b
        res['parsed'] = True
        break

    fails = [ln.strip() for ln in out.splitlines() if ('✗' in ln or '[FAIL]' in ln or 'FAIL ' in ln)]
    if fails:
        res['note'] = ' | '.join(fails[:6])
    return res


def main():
    results = []
    os.makedirs(LOGDIR, exist_ok=True)
    print(f'=== REGRESI INTEGRASI (berurutan) — {STAMP} ===')
    for s in SUITES:
        # Entri boleh berupa direktori suite (scripts/<s>/run.py) atau path
        # runner eksplisit (mis. 'marketing-test/run_ui.py') untuk suite yang
        # punya LEBIH DARI SATU lapisan uji.
        rel = s if s.endswith('.py') else os.path.join(s, 'run.py')
        script = os.path.join(REPO, 'scripts', rel)
        if not os.path.exists(script):
            results.append({'suite': s, 'exit': None, 'skipped': True, 'note': f'{rel} tidak ada'})
            print(f'  -- {s}: dilewati ({rel} tidak ada)')
            continue
        code, out, secs = run([sys.executable, script])
        r = summarize(s, code, out)
        r['seconds'] = secs
        results.append(r)
        # Nama suite bisa berupa path (marketing-test/run_ui.py) -> jangan
        # dipakai apa adanya sebagai nama berkas log.
        safe = s.replace('/', '__')
        with open(os.path.join(LOGDIR, f'{safe}.log'), 'w', encoding='utf-8') as fh:
            fh.write(out)
        print(f'  {"OK " if code == 0 else "RED"} {s}: exit={code} lulus={r["passed"]} gagal={r["failed"]} ({secs}s)')

    base = os.environ.get('E2E_BASE', '').strip()
    if base:
        port = re.search(r':(\d+)', base)
        port = port.group(1) if port else '3000'
        print(f'\n=== E2E (server {base}) ===')
        for item in E2E_SCRIPTS:
            name, binp, argv = item[0], item[1], item[2]
            extra = item[3] if len(item) > 3 else {}
            args = [a.format(base=base, port=port) for a in argv]
            env_extra = {k: v.format(base=base, port=port) for k, v in extra.items()}
            code, out, secs = run([binp] + args, env_extra)
            r = summarize('e2e:' + name, code, out)
            r['seconds'] = secs
            results.append(r)
            with open(os.path.join(LOGDIR, f'e2e-{name}.log'), 'w', encoding='utf-8') as fh:
                fh.write(out)
            print(f'  {"OK " if code == 0 else "RED"} e2e:{name}: exit={code} lulus={r["passed"]} gagal={r["failed"]} ({secs}s)')

    payload = {
        'stamp': STAMP,
        'repo': REPO,
        'commit': subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO,
                                 capture_output=True, text=True).stdout.strip(),
        'branch': subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd=REPO,
                                 capture_output=True, text=True).stdout.strip(),
        'e2e_base': base or None,
        'results': results,
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    red = [r['suite'] for r in results if r.get('exit') not in (0, None)]
    print(f'\nHASIL: {len(results) - len(red)}/{len(results)} suite/entry hijau')
    if red:
        print('MERAH: ' + ', '.join(red))
    print(f'Bukti: {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
