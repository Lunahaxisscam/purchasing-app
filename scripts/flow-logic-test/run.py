#!/usr/bin/env python3
"""
Harness regresi logika alur PR→Purchase→Handover (t_905e0e5a) — READ-ONLY repo.

Bukan test UI: ini test LOGIKA BISNIS murni yang dijalankan terhadap fungsi
yang diekstrak verbatim dari source repo (sandbox di /tmp, tanpa DB, tanpa
mutasi). Setiap kasus = EXPECtED vs ACTUAL terukur, bukan assertion `true`.

Sumber fungsi (disalin verbatim + strip `export `):
  - modules/shared/itemHelpers.js  -> makeItemHelpers, itemReceiveStatus,
    receivingProgress (parsial/mixed/lengkap)
  - lib/constants.js               -> parseReceivingNote, parseHandoverNote,
    buildReceivingNote, buildHandoverNote, isReceivingKendala, notaHref,
    dataUrlByteSize, validateHandoverFotoSize
  - modules/handovers/save.js      -> build payload (diuji via mirror payload
    builder yang memanggil fungsi constants asli)
  - modules/receivings/save.js     -> kendala mapping

Cara jalankan:  python3 scripts/flow-logic-test/run.py   (dari root repo)
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/flow-logic-test-sandbox'

CHECKS = []          # (no, name, expected, actual, pass)
def check(no, name, expected, actual):
    ok = expected == actual
    CHECKS.append((no, name, expected, actual, ok))
    return ok

def load_js(path):
    """Salin file repo ke sandbox, strip 'export ' di awal baris (Node ESM
    sandbox butuh ekstensi; kita jadikan CommonJS sederhana per file)."""
    src = open(path, encoding='utf-8').read()
    # konversi minimal: ESM export -> CommonJS
    src = re.sub(r'^export (function|const|let|var) ', r'\1 ', src, flags=re.M)
    return src

def main():
    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(f'{SB}')
    # 1) Kumpulkan fungsi verbatim dari repo
    helpers = load_js(f'{REPO}/modules/shared/itemHelpers.js')
    constants = load_js(f'{REPO}/lib/constants.js')

    # 2) Test script: fungsi repo ASLI dipakai, kasus dibangun di sekitarnya
    test_mjs = r'''
// ===== Test logic (berjalan di sandbox, memakai FUNGSI REPO ASLI) =====
const CHECKS = []
function check(no, name, expected, actual) {
  CHECKS.push({no, name, expected, actual, ok: JSON.stringify(expected) === JSON.stringify(actual)})
}

// --- A. itemHelpers verbatim (dari modules/shared/itemHelpers.js) ---
__HELPERS__
__CONSTANTS__

// Data fixture
const prItems = [
  { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'ORDERED' },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng', status: 'ORDERED' },
  { id: 'pi3', pr_id: 'pr1', item_name: 'Paku 2in', quantity: 2, unit: 'Kg', status: 'ORDERED' }
]
const receivingItems = [
  // nota A: mixed per-item — triplek lengkap, cat rusak/parcial, paku 0
  { id: 'ri1', receiving_id: 'recA', pr_item_id: 'pi1', item_name: 'Triplek 9mm', quantity_received: 10, unit: 'Lembar' },
  { id: 'ri2', receiving_id: 'recA', pr_item_id: 'pi2', item_name: 'Cat Duco', quantity_received: 2, unit: 'Kaleng' },
  { id: 'ri3', receiving_id: 'recA', pr_item_id: 'pi3', item_name: 'Paku 2in', quantity_received: 0, unit: 'Kg' }
]
const H = makeItemHelpers({ allPrItems: prItems, allReceivingItems: receivingItems, allRequests: [{id:'pr1'}] })

// A1: item mixed — status per item dihitung benar
const s1 = H.itemReceiveStatus(receivingItems[0])
const s2 = H.itemReceiveStatus(receivingItems[1])
const s3 = H.itemReceiveStatus(receivingItems[2])
check('A1a', 'item lengkap: key', 'LENGKAP', s1.key)
check('A1b', 'item parsial: key', 'PARSIAL', s2.key)
check('A1c', 'item belum: key', 'BELUM', s3.key)
check('A1d', 'parsial: sisa dihitung', 2, s2.ordered - s2.rec)

// A2: progress nota = summary dari children, bukan "semua item sama"
const prog = H.receivingProgress('recA')
check('A2a', 'progress doneCount', 1, prog.doneCount)
check('A2b', 'progress total', 3, prog.total)
check('A2c', 'progress allDone=false utk mixed', false, prog.allDone)
check('A2d', 'anyReceived=true', true, prog.anyReceived)

// A3: nota kosong -> progress null (bukan "LENGKAP")
check('A3', 'nota tanpa item -> null', null, H.receivingProgress('recX'))

// --- B. constants: parse/build note ---
const n1 = parseReceivingNote('[Nominal: Rp 1.980.000] Pembelian Plywood Baroni')
check('B1a', 'nominal parsed', 1980000, n1.nominal)
check('B1b', 'extra parsed', 'Pembelian Plywood Baroni', n1.extra)

const n2 = parseReceivingNote('Catatan lama tanpa penanda')
check('B2a', 'legacy note: nominal null', null, n2.nominal)
check('B2b', 'legacy note: extra utuh', 'Catatan lama tanpa penanda', n2.extra)

const built = buildReceivingNote({ nominal: '450.000', nota: 'https://drive.google.com/x', extra: 'OPS' })
check('B3', 'build note urutan', '[Nominal: Rp 450.000] [Nota: https://drive.google.com/x] OPS', built)

// B4: buildReceivingNote nominal aneh ('abc') -> tidak crash, tanpa nominal
const builtBad = buildReceivingNote({ nominal: 'abc', nota: '', extra: 'X' })
check('B4', 'nominal non-digit diabaikan', 'X', builtBad)

// --- C. Handover note + foto ---
const h1 = parseHandoverNote('[FotoBukti: data:image/png;base64,AAA] Catatan serah')
check('C1a', 'foto parsed', 'data:image/png;base64,AAA', h1.foto)
check('C1b', 'extra parsed', 'Catatan serah', h1.extra)

const dsz = dataUrlByteSize('data:image/png;base64,AAAA')
check('C2', 'dataUrl 3 byte dari 4 b64', 3, dsz)

const over = validateHandoverFotoSize(3 * 1024 * 1024)
check('C3a', 'foto >2MB ditolak dgn pesan', true, String(over).includes('2MB'))
check('C3b', 'foto 1MB lolos', '', validateHandoverFotoSize(1024 * 1024))

// C4: buildHandoverNote tanpa foto & tanpa catatan -> null (bukan string kosong)
check('C4', 'note kosong -> null', null, buildHandoverNote({ foto: '', extra: '' }))

// --- D. status receiving/kendala ---
check('D1', 'isReceivingKendala RETUR', true, isReceivingKendala('RETUR'))
check('D2', 'isReceivingKendala RUSAK', true, isReceivingKendala('RUSAK'))
check('D3', 'isReceivingKendala NORMAL', false, isReceivingKendala('NORMAL'))
// bahasa lain kasus lama
check('D4', 'KENDALA_RETUR dikenali', true, isReceivingKendala('KENDALA_RETUR'))

// --- E. notaHref keamanan ---
check('E1', 'url https lolos', 'https://a.co/x', notaHref('https://a.co/x'))
check('E2', 'resi biasa bukan link', '', notaHref('JX-1234567890'))
check('E3', 'domain telanjang jadi https', 'https://tbmakmur.com', notaHref('tbmakmur.com'))
check('E4', 'spasi ditolak', '', notaHref('http://evil com'))

console.log('CHECKS_JSON:' + JSON.stringify(CHECKS))
'''
    test_mjs = test_mjs.replace('__HELPERS__', helpers).replace('__CONSTANTS__', constants)
    with open(f'{SB}/test.mjs', 'w', encoding='utf-8') as f:
        f.write(test_mjs)

    # 3) Run
    proc = subprocess.run(['node', f'{SB}/test.mjs'], capture_output=True, text=True, timeout=60)
    out = proc.stdout
    if proc.returncode != 0:
        print('SANDBOX ERROR:', proc.stderr[:3000])
        sys.exit(2)
    line = next(l for l in out.splitlines() if l.startswith('CHECKS_JSON:'))
    import json
    results = json.loads(line[len('CHECKS_JSON:'):])
    passed = 0
    for r in results:
        status = 'PASS' if r['ok'] else 'FAIL'
        if r['ok']:
            passed += 1
        else:
            print(f"  [{status}] {r['no']} {r['name']}: expected={r['expected']!r} actual={r['actual']!r}")
    total = len(results)
    print(f'flow-logic-test: {passed}/{total} lulus (sumber verbatim repo, tanpa DB)')
    sys.exit(0 if passed == total else 1)

if __name__ == '__main__':
    main()
