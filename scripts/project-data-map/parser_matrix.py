#!/usr/bin/env python3
"""Matriks parser angka: bukti bahwa "parse sukses" != "satuan benar".

Membandingkan TIGA parser yang benar-benar dipakai sistem:
  1. drive_cost_sync.parse_rupiah           (daemon drive-sync -> project_cost_summary)
  2. tukang_upah_sync.parse_rupiah_loose    (daemon tukang-upah-sync -> tukang_*)
  3. modules/labor-stock/logic.js toNumberOrNull  (UI Actual Labor)
  4. lib/projectCrosswalk.js parseSourceAmount    (kontrak baru Tahap A)

Read-only: hanya mengimpor fungsi murni, tidak menjalankan daemon/jaringan.

Jalankan: python3 scripts/project-data-map/parser_matrix.py
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))
SYNC_DIR = '/home/ubuntu/workspace/drive_sync'
OUT = os.path.join(REPO, 'docs', 'project-cost', 'parser-matrix.json')

SAMPLES = [
    'Rp 12,345,678', '  12,345,678 ', '15,000.76', '15.000,76', '12,5', '12.5',
    '1.500', '1,500', '1.234.567,89', '(-Rp 9,500)', '-Rp 32,107', '-',
    '0', 'Rp 0', '', 'n/a', '7,890,000'
]

NODE_COMPARE = r'''
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
const [logicPath, cwPath, samplesJson] = process.argv.slice(2)
const logic = await import(pathToFileURL(logicPath).href)
const cw = await import(pathToFileURL(cwPath).href)
const samples = JSON.parse(fs.readFileSync(samplesJson, 'utf8'))
const out = samples.map(s => ({
  raw: s,
  logic: logic.toNumberOrNull(s),
  crosswalk: cw.parseSourceAmount(s).amount,
  crosswalkFormat: cw.parseSourceAmount(s).format,
  crosswalkAmbiguous: cw.parseSourceAmount(s).ambiguous
}))
console.log(JSON.stringify(out))
'''


def load_mod(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    if not os.path.isdir(SYNC_DIR):
        print(json.dumps({'ok': False, 'blocker': 'folder daemon tidak ada', 'path': SYNC_DIR}))
        return 2

    cost = load_mod(os.path.join(SYNC_DIR, 'drive_cost_sync.py'), 'drive_cost_sync_ro')
    upah = load_mod(os.path.join(SYNC_DIR, 'tukang_upah_sync.py'), 'tukang_upah_sync_ro')

    sandbox = tempfile.mkdtemp(prefix='parser-matrix-')
    try:
        os.makedirs(os.path.join(sandbox, 'modules', 'labor-stock'), exist_ok=True)
        os.makedirs(os.path.join(sandbox, 'lib'), exist_ok=True)
        logic_mjs = os.path.join(sandbox, 'modules', 'labor-stock', 'logic.mjs')
        cw_mjs = os.path.join(sandbox, 'lib', 'projectCrosswalk.mjs')
        shutil.copyfile(os.path.join(REPO, 'modules', 'labor-stock', 'logic.js'), logic_mjs)
        shutil.copyfile(os.path.join(REPO, 'lib', 'projectCrosswalk.js'), cw_mjs)
        node_script = os.path.join(sandbox, 'compare.mjs')
        open(node_script, 'w').write(NODE_COMPARE)
        samples_json = os.path.join(sandbox, 'samples.json')
        json.dump(SAMPLES, open(samples_json, 'w'))

        proc = subprocess.run(['node', node_script, logic_mjs, cw_mjs, samples_json],
                              capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            print(json.dumps({'ok': False, 'blocker': 'node gagal', 'stderr': proc.stderr[-800:]}))
            return 3
        js = {r['raw']: r for r in json.loads(proc.stdout)}
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)

    rows = []
    disagreements = 0
    for s in SAMPLES:
        py_cost = cost.parse_rupiah(s)
        py_upah = upah.parse_rupiah_loose(s)
        j = js.get(s, {})
        values = [py_cost, py_upah, j.get('logic'), j.get('crosswalk')]
        distinct = {v for v in values if v is not None}
        agree = len(distinct) <= 1 and not (any(v is None for v in values) and any(v is not None for v in values))
        if not agree:
            disagreements += 1
        rows.append({
            'raw': s,
            'drive_cost_sync.parse_rupiah': py_cost,
            'tukang_upah_sync.parse_rupiah_loose': py_upah,
            'logic.toNumberOrNull': j.get('logic'),
            'crosswalk.parseSourceAmount': j.get('crosswalk'),
            'crosswalk.format': j.get('crosswalkFormat'),
            'crosswalk.ambiguous': j.get('crosswalkAmbiguous'),
            'agree': agree
        })

    out = {
        'ok': True,
        'note': 'Parser diuji pada fungsi murni (tanpa daemon/jaringan/DB).',
        'samples': len(SAMPLES),
        'disagreements': disagreements,
        'rows': rows
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=2)
    print('WROTE', OUT)
    hdr = f"{'raw':16} {'cost_sync':>12} {'upah_sync':>12} {'logic.js':>12} {'crosswalk':>12} agree"
    print(hdr)
    for r in rows:
        print(f"{r['raw']!r:16} {str(r['drive_cost_sync.parse_rupiah']):>12} "
              f"{str(r['tukang_upah_sync.parse_rupiah_loose']):>12} {str(r['logic.toNumberOrNull']):>12} "
              f"{str(r['crosswalk.parseSourceAmount']):>12} {r['agree']}")
    print('disagreements:', disagreements)
    return 0


if __name__ == '__main__':
    sys.exit(main())
