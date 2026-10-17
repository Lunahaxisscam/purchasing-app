#!/usr/bin/env python3
"""
HARNESS VERIFIKASI LEDGER PER BARANG (bamboo-tech) — task t_7bc6246b
====================================================================
Membuktikan kontrak docs/receiving-events-contract.md di KODE NYATA:

  A. LOGIKA MURNI (receiptEventLogic.js — verbatim)
     A1 dimensi terpisah: datang ≠ rusak ≠ tujuan ≠ retur; baik = datang-rusak
     A2 idempotency key deterministik (submit sama → id sama)
     A3 validasi mirror constraint DB (rusak<=datang, tujuan<=baik, penerima
        wajib, konfirmasi buang wajib, over-receipt diblok)
     A4 eventTotals: qty_rusak NULL = tidak diketahui (bukan 0 palsu)
     A5 retur tanpa ketik ulang: baris dari event rusak − yang sudah diretur
     A6 handover prefill: alokasi tukang − yang sudah diserahkan (tanpa dobel)
     A7 pemecahan PR multi-vendor: grouping stabil + guard histori
     A8 validasi konfirmasi fisik (qty ≤ sisa, penerima wajib)

  B. CAPABILITY PROBE (receiptCapability.js — read-only)
     B1 skema belum ada → ready=false + missing terisi (mode legacy)
     B2 skema ada → ready=true
     B3 probe TIDAK menulis apa pun (nol insert/update/rpc)
     B4 cache TTL: probe kedua tidak query ulang; force=true query ulang

  C. SIMPAN via RPC (receiptEventSave.js + mock PostgREST/RPC)
     C1 sukses: event tersimpan + quantity_received = Σ datang
     C2 submit ganda (idempotency key sama) → tidak menggandakan qty
     C3 validasi gagal → NOL panggilan RPC
     C4 error RPC diteruskan apa adanya (tidak ditelan)
     C5 handover_confirm: CAS diserahkan_at + insert handover_items sekali
     C6 retur: return_cases/return_lines dibuat dari event, qty tidak ganda

  D. PEMECAHAN NOTA MULTI-VENDOR (receiptSplit.js + mock)
     D1 rencana: grup per vendor, jejak PR tetap, nota baru untuk vendor lain
     D2 guard: nota yang sudah menerima / sudah ke gudang → tolak
     D3 eksekusi: item pindah ke nota vendornya + readback cocok
     D4 idempoten: nota (PR, vendor) sudah ada → tidak membuat nota baru

Cara kerja: sandbox /tmp/receiving-events-verify — salin VERBATIM file sumber
(modul + lib), mock supabaseClient perekam, transform SWC, jalankan test.
Tanpa DB, tanpa jaringan, tanpa menyentuh .next aktif.

Jalankan dari root repo:  python3 scripts/receiving-events-test/run.py
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SB = '/tmp/receiving-events-verify'

REL_FILES = ['components/ModuleView.js', 'components/CreateModal.js', 'components/Common.js', 'lib/constants.js']
for root, dirs, files in os.walk(os.path.join(REPO, 'modules')):
    dirs.sort()
    for f in sorted(files):
        if f.endswith(('.js', '.jsx')):
            REL_FILES.append(os.path.relpath(os.path.join(root, f), REPO))


def sb_rel(rel):
    base, _ = os.path.splitext(rel)
    return base + '.mjs'


def resolve(rel_dir, spec):
    for cand in (spec, spec + '.js', spec + '.jsx'):
        p = os.path.normpath(os.path.join(rel_dir, cand))
        if os.path.isfile(os.path.join(REPO, p)):
            return p
    return None


if os.path.exists(SB):
    shutil.rmtree(SB)

for rel in REL_FILES:
    src = open(os.path.join(REPO, rel), encoding='utf-8').read()

    def _repl(m):
        pre, spec, post = m.group(1), m.group(2), m.group(3)
        resolved = resolve(os.path.dirname(rel), spec)
        if resolved is None:
            return m.group(0)
        target = sb_rel(resolved)
        new_spec = os.path.relpath(target, os.path.dirname(sb_rel(rel))).replace(os.sep, '/')
        if not new_spec.startswith('.'):
            new_spec = './' + new_spec
        return f'{pre}{new_spec}{post}'

    src = re.sub(r"(\bfrom\s+['\"])(\.[^'\"]+)(['\"])", _repl, src)
    out = os.path.join(SB, sb_rel(rel))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8').write(src)

shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), os.path.join(SB, 'lib', 'supabaseClient.mjs'))
os.symlink(os.path.join(REPO, 'node_modules'), os.path.join(SB, 'node_modules'))
open(os.path.join(SB, 'package.json'), 'w').write('{ "type": "module" }')
shutil.copy(os.path.join(REPO, 'scripts', 'vendors-toolbar-test', 'compile_sandbox.mjs'), SB)
shutil.copy(os.path.join(HERE, 'logic_test.mjs'), SB)
shutil.copy(os.path.join(HERE, 'render_test.mjs'), SB)

print(f'Sandbox: {SB}\n')
r = subprocess.run(['node', 'compile_sandbox.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'logic_test.mjs'], cwd=SB)
if r.returncode:
    sys.exit(r.returncode)
r = subprocess.run(['node', 'render_test.mjs'], cwd=SB)
sys.exit(r.returncode)
