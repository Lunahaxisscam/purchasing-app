#!/usr/bin/env python3
"""
HARNESS VERIFIKASI PANEL 4-PILAR (bit-dev) — render DOM nyata Planning.js
========================================================================
Tujuan: membuktikan panel Kontrol Anggaran 4-Pilar + deteksi anomali benar-benar
TER-RENDER di DOM (bukan hanya cek identifier statis), untuk 3 kondisi:
  1) Revenue belum diset (fallback aman, tidak ada NaN)
  2) Proyek sehat (semua pilar on-track, 0 anomali)
  3) Multi-pos anomali (4 anomali tampil, banner + kartu merah + rekomendasi)

Cara kerja (tanpa menyentuh DB, tanpa menyentuh repo):
  1. Sandbox /tmp/bitdev-panel-verify
  2. Copy VERBATIM: components/Planning.js, lib/constants.js
     Ganti lib/supabaseClient.js dengan mock (data uji disuntik, tanpa jaringan)
  3. Transform JSX via SWC bawaan Next.js (next/dist/build/swc)
  4. Render dengan react-dom/server (SSR) di dalam jsdom (untuk window.confirm dll)
  5. Assert isi HTML: nominal, badge, banner anomali, teks rekomendasi.

Jalankan: python3 scripts/planning-budget-test/verify_panel_render.py
"""
import os, re, shutil, subprocess, sys, json

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/bitdev-panel-verify'

# --- COMPACT_ADMIN_ADAPTER: dependency CompactRoot (compact UI Admin Suite) ----------
# CompactRoot mengimpor CSS module; Node ESM tidak bisa memuat .css. Helper
# di bawah menulis stub kelas ke sandbox dan mengalihkan specifier CSS
# module ke stub itu. Tidak ada assertion yang diubah.
def _compact_copy_root():
    """Harness yang menyalin file eksplisit: pastikan CompactRoot.js ada."""
    src = os.path.join(REPO, 'components', 'CompactRoot.js')
    dst_dir = os.path.join(SB, 'components')
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, 'CompactRoot.js')
    if not os.path.exists(dst):
        shutil.copy(src, dst)


def _compact_fix_sandbox(sb=None):
    """Ganti import CSS module dengan objek kelas inline (tanpa file stub).

    Dilakukan pada SALINAN di sandbox, bukan pada repo. Bentuk inline dipilih
    karena beberapa harness menambahkan '.mjs' ke setiap specifier relatif,
    sehingga file stub bisa berubah nama dan gagal di-resolve.
    """
    root = sb or SB
    # Pastikan CompactRoot.js ada di sandbox (harness yang menyalin file
    # eksplisit mungkin belum memasukkannya).
    src_root = os.path.join(REPO, 'components', 'CompactRoot.js')
    dst_root = os.path.join(root, 'components', 'CompactRoot.js')
    if os.path.exists(src_root) and not os.path.exists(dst_root):
        os.makedirs(os.path.dirname(dst_root), exist_ok=True)
        shutil.copy(src_root, dst_root)
    line_pat = re.compile(r"^[ \t]*import\s+([A-Za-z_$][\w$]*)\s+from\s+[\x27\x22][^\x27\x22]*compact-admin\.module\.css[\x27\x22][ \t]*;?[ \t]*$", re.M)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('node_modules', 'dist', '.next')]
        for name in filenames:
            if not name.endswith(('.mjs', '.js', '.jsx', '.mts')):
                continue
            p = os.path.join(dirpath, name)
            try:
                src = open(p, encoding='utf-8').read()
            except (OSError, UnicodeDecodeError):
                continue
            if 'compact-admin.module.css' not in src:
                continue
            new = line_pat.sub(
                lambda mm: "const " + mm.group(1) + " = new Proxy({}, { get: (t, k) => 'cm_' + String(k) })",
                src
            )
            if new != src:
                open(p, 'w', encoding='utf-8').write(new)
# --- end COMPACT_ADMIN_ADAPTER -------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))

if os.path.exists(SB):
    shutil.rmtree(SB)
os.makedirs(f'{SB}/lib')
os.makedirs(f'{SB}/components')

shutil.copy(f'{REPO}/components/Planning.js', f'{SB}/components/Planning.js')
shutil.copy(f'{REPO}/lib/constants.js', f'{SB}/lib/constants.js')
shutil.copy(os.path.join(HERE, 'mock-supabaseClient.mjs'), f'{SB}/lib/supabaseClient.js')

# node_modules: pakai react/react-dom milik repo + jsdom global (symlink, tidak di-copy)
os.symlink(f'{REPO}/node_modules', f'{SB}/node_modules')

# Node ESM butuh ekstensi eksplisit pada import relatif
for rel in ['components/Planning.js', 'lib/constants.js']:
    p = f'{SB}/{rel}'
    src = open(p).read()
    out = []
    for l in src.split('\n'):
        m = re.match(r"^(\s*import\s.*from\s+')(\.\.?/[^']+)('.*)$", l)
        if m and not m.group(2).endswith('.js'):
            l = m.group(1) + m.group(2) + '.js' + m.group(3)
        out.append(l)
    open(p, 'w').write('\n'.join(out))

shutil.copy(os.path.join(HERE, 'panel_render_test.mjs'), f'{SB}/panel_render_test.mjs')
open(f'{SB}/package.json', 'w').write('{ "type": "module" }')

print(f'Sandbox: {SB}\n')
_compact_fix_sandbox()
r = subprocess.run(['node', 'panel_render_test.mjs'], cwd=SB)
sys.exit(r.returncode)
