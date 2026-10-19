#!/usr/bin/env python3
"""
ADAPTER HARNESS LAMA — dependency baru `components/CompactRoot.js`
==================================================================
Modul Admin Suite kini dibungkus `components/CompactRoot.js` (compact UI),
yang mengimpor CSS module `components/compact-admin.module.css`. Harness lama
menyalin closure file per modul ke sandbox `/tmp/<nama>` lalu menjalankannya
dengan Node ESM, sehingga:

  * `components/CompactRoot.js` tidak ikut tersalin  -> ERR_MODULE_NOT_FOUND
  * `import ... from '*.module.css'` tidak bisa dimuat Node ESM

Skrip ini menambal harness tersebut secara IDEMPOTEN dan SERAGAM:
  1. `components/CompactRoot.js` ditambahkan ke daftar REL_FILES (bila ada),
  2. satu blok helper ditulis tepat setelah `SB = ...`,
  3. satu panggilan `_compact_fix_sandbox()` disisipkan tepat sebelum
     `subprocess.run(` pertama — helper itu memindai sandbox, menulis stub
     kelas CSS, dan menulis ulang specifier CSS module di semua file .mjs.

Yang diubah HANYA persiapan sandbox; assertion test tidak disentuh.
Jalankan dari root repo:

    python3 scripts/compact-admin-test/adapt_legacy_harness.py
"""
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TARGETS = [
    'scripts/stock-view-test/run.py',
    'scripts/crm-test/run.py',
    'scripts/labor-stock-test/run.py',
    'scripts/rap-test/run.py',
    'scripts/rap-compare-test/run.py',
    'scripts/fn-repro/run.py',
    'scripts/planning-budget-test/verify_panel_render.py',
    'scripts/planning-budget-test/verify_custom_mode.py',
    'scripts/growth-kpi-test/run.py',
    'scripts/marketing-test/run_ui.py',
    'scripts/sales-invoice-test/run.py',
    'scripts/sales-invoice-payment-test/run.py',
]

MARK = 'COMPACT_ADMIN_ADAPTER'
EXTRA_FILE = "'components/CompactRoot.js'"

HELPER = r'''
# --- __MARK__: dependency CompactRoot (compact UI Admin Suite) ----------
# CompactRoot mengimpor CSS module; Node ESM tidak bisa memuat .css. Helper
# di bawah menulis stub kelas ke sandbox dan mengalihkan specifier CSS
# module ke stub itu. Tidak ada assertion yang diubah.
import re as _compact_re


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
    line_pat = _compact_re.compile(r"^[ \t]*import\s+([A-Za-z_$][\w$]*)\s+from\s+[\x27\x22][^\x27\x22]*compact-admin\.module\.css[\x27\x22][ \t]*;?[ \t]*$", _compact_re.M)
    # Specifier './CompactRoot' tanpa ekstensi tidak bisa di-resolve Node ESM.
    ext_pat = _compact_re.compile(r"([\x27\x22][^\x27\x22]*/CompactRoot)([\x27\x22])")
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
            new = src
            if 'compact-admin.module.css' in new:
                new = line_pat.sub(
                    lambda mm: "const " + mm.group(1) + " = new Proxy({}, { get: (t, k) => 'cm_' + String(k) })",
                    new
                )
            if '/CompactRoot' in new:
                new = ext_pat.sub(lambda mm: mm.group(1) + '.js' + mm.group(2), new)
            if new != src:
                open(p, 'w', encoding='utf-8').write(new)
# --- end __MARK__ -------------------------------------------------------
'''.replace('__MARK__', MARK)


def add_rel_files(text):
    """Tambahkan CompactRoot.js ke setiap daftar file yang disalin/dikompilasi."""
    if EXTRA_FILE in text:
        return text, False
    changed = False
    # 1) Daftar python: REL_FILES = [...] atau FILES = [...]
    for name in ('REL_FILES', 'FILES'):
        m = re.search(name + r'\s*=\s*\[(.*?)\]', text, re.S)
        if not m:
            continue
        body = m.group(1).rstrip()
        if not body.endswith(','):
            body += ','
        body += '\n    ' + EXTRA_FILE + '\n'
        text = text[:m.start(1)] + body + text[m.end(1):]
        changed = True
    # 2) Daftar JS di dalam string COMPILE_JS: const targets = [ ... ]
    m = re.search(r'const targets = \[(.*?)\]', text, re.S)
    if m:
        body = m.group(1).rstrip()
        if not body.endswith(','):
            body += ','
        body += "\n  'components/CompactRoot.js'\n"
        text = text[:m.start(1)] + body + text[m.end(1):]
        changed = True
    return text, changed


def add_copy_call(text):
    """Placeholder dipertahankan agar pemanggilan lama tidak error."""
    return text, False


def insert_helper(text):
    if MARK in text:
        return text, False
    m = re.search(r'^SB\s*=\s*.*$', text, re.M)
    if not m:
        return text, False
    return text[:m.end()] + '\n' + HELPER + text[m.end():], True


def add_call(text):
    """Sisipkan panggilan tepat sebelum subprocess.run pertama (bila belum)."""
    if '_compact_fix_sandbox()' in text:
        return text, False
    m = re.search(r'^([ \t]*)(\w+\s*=\s*subprocess\.run\()', text, re.M)
    if not m:
        return text, False
    indent = m.group(1)
    return text[:m.start()] + f'{indent}_compact_fix_sandbox()\n' + text[m.start():], True


def main():
    changed = 0
    for rel in TARGETS:
        path = os.path.join(REPO, rel)
        if not os.path.isfile(path):
            print(f'  lewat (tidak ada): {rel}')
            continue
        text = open(path, encoding='utf-8').read()
        orig = text
        text, a = add_rel_files(text)
        text, b = insert_helper(text)
        text, c = add_call(text)
        if text != orig:
            open(path, 'w', encoding='utf-8').write(text)
            changed += 1
            print(f'  dipatch: {rel} (rel_files={a} helper={b} call={c})')
        else:
            print(f'  sudah ok: {rel}')
    print(f'\nTotal dipatch: {changed}')


if __name__ == '__main__':
    sys.exit(main())
