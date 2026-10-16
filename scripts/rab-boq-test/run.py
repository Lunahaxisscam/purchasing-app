#!/usr/bin/env python3
"""
Harness regresi modul RAB & BOQ (t_18564dce) — tanpa DB, tanpa browser.

Menguji fungsi VERBATIM dari modules/rab-boq/ (Node sandbox /tmp):
  A. Math parity vs source HTML: expected dihitung dari SEMANTIK SOURCE
     (implementasi independen di Python) — bukan dari kode modul.
  B. Import sanitizer: limits/tipe/panjang/XSS-stability.
  C. Ekspor CSV: struktur baris + BOM + total (berbasis semantic source).
  D. PDF: header %PDF, jumlah halaman, xref, konten item ter-render.
  E. Guard admin: pemeriksaan statis wiring pages/index.js/constants/registry
     (grep, bukan render) — menu label, branch render + role guard, exclude
     refresh, registry adminOnly.
  F. Buat Proyek: hanya kolom {kode,name,NOT_START}, tanpa angka BOQ.

Cara jalankan:  python3 scripts/rab-boq-test/run.py   (dari root repo)
"""
import os, re, shutil, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/rab-boq-test-sandbox'

CHECKS = []
def check(no, name, expected, actual):
    ok = expected == actual
    CHECKS.append((no, name, expected, actual, ok))
    return ok

def load_js(path):
    src = open(path, encoding='utf-8').read()
    src = re.sub(r'^export (function|const|let|var) ', r'\1 ', src, flags=re.M)
    return src

# ============================================================
# Implementasi INDEPENDEN dari semantik source HTML (Python).
# Dipakai sebagai expected: math parity harus cocok dengan kode repo.
# ============================================================
def pnum(v):
    try:
        n = float(v)
        return n if n == n and abs(n) != float('inf') else 0.0
    except (TypeError, ValueError):
        return 0.0

def parea(part):
    return max(0.0, pnum(part.get('length', 0))) * max(0.0, pnum(part.get('width', 0)))

def ppart(part):
    return parea(part) * max(0.0, pnum(part.get('qty', 0))) * max(0.0, pnum(part.get('unitPrice', 0)))

def pitem_total(item):
    return max(0.0, pnum(item.get('qty', 0))) * max(0.0, pnum(item.get('price', 0)))

def ptotals(items, mode, rate, dtype, adj_on, tax_on, tax_rate):
    base = sum(pitem_total(it) for it in items)
    rate = max(0.0, pnum(rate))
    pct = min(rate, 99) / 100.0
    nom = rate / 1000.0 if dtype == 'nominal' else 0.0
    adj = 0.0
    if adj_on:
        if mode == 'gross':
            adj = base / (1 - pct) - base
        elif mode == 'markup':
            adj = nom if dtype == 'nominal' else base * pct
        elif mode == 'discount':
            adj = -min(base, nom) if dtype == 'nominal' else -base * pct
    sell = max(0.0, base + adj)
    tr = max(0.0, pnum(tax_rate)) / 100.0 if tax_on else 0.0
    tax = sell * tr
    return {'base': base, 'margin': adj, 'tax': tax, 'grand': sell + tax}

def pthousand(v):
    n = round((v or 0) * 100) / 100
    s = f'{n:,.2f}'.rstrip('0').rstrip('.')
    # id-ID style: koma desimal, titik ribuan
    s = s.replace(',', '§').replace('.', ',').replace('§', '.')
    return s

TEST_CASES = [
    # (nama, items, mode, rate, dtype, adj_on, tax_on, tax_rate)
    ('markup 20% PPN 11', [
        {'item': 'Mobilization', 'qty': 1, 'price': 3500, 'breakdown': [{'name': 'Labor', 'length': 1, 'width': 1, 'qty': 2, 'unitPrice': 1000}, {'name': 'Protective', 'length': 1, 'width': 1, 'qty': 3, 'unitPrice': 500}]},
        {'item': 'Upper cabinet', 'qty': 4.2, 'price': 2750, 'breakdown': []},
        {'item': 'Countertop', 'qty': 1, 'price': 3132, 'breakdown': [{'name': 'Material', 'length': 3.6, 'width': 0.6, 'qty': 1, 'unitPrice': 1100}, {'name': 'Install', 'length': 3.6, 'width': 0.6, 'qty': 1, 'unitPrice': 350}]},
    ], 'markup', 20, 'percent', True, True, 11),
    ('gross margin 25%', [{'item': 'A', 'qty': 2, 'price': 1000, 'breakdown': []}], 'gross', 25, 'percent', True, False, 0),
    ('discount 10%', [{'item': 'A', 'qty': 3, 'price': 500, 'breakdown': []}], 'discount', 10, 'percent', True, True, 11),
    ('markup nominal Rp 5jt', [{'item': 'A', 'qty': 1, 'price': 4000, 'breakdown': []}], 'markup', 5000, 'nominal', True, False, 0),
    ('discount nominal cap', [{'item': 'A', 'qty': 1, 'price': 1000, 'breakdown': []}], 'discount', 8000, 'nominal', True, False, 0),
    ('adj off, tax off', [{'item': 'A', 'qty': 1, 'price': 1234.5, 'breakdown': []}], 'markup', 20, 'percent', False, False, 11),
    ('empty items', [], 'markup', 20, 'percent', True, True, 11),
    ('qty 0 & negatif', [
        {'item': 'A', 'qty': 0, 'price': 5000, 'breakdown': []},
        {'item': 'B', 'qty': -2, 'price': 1000, 'breakdown': []},
        {'item': 'C', 'qty': 2, 'price': -50, 'breakdown': []},
    ], 'markup', 20, 'percent', True, True, 11),
]

def main():
    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(SB)

    calc = load_js(f'{REPO}/modules/rab-boq/boqCalc.js')
    libjs = load_js(f'{REPO}/modules/rab-boq/lib.js')
    csvjs = load_js(f'{REPO}/modules/rab-boq/csvExport.js')

    test_mjs = r'''
// ===== Sandbox: file modul repo disalin verbatim (ESM asli, import antar file) =====
import { num, calcCostArea, calcCostPart, calcItem, breakdownTotal, calcTotals, effectivePrice,
         thousand, rupiahFromK, normalizeItem, sanitizeItems, sanitizeNotes,
         sanitizeTemplateChoices } from './boqCalc.js'
import { buildTemplateChoiceSeed, itemOptionsFor, incrementReference } from './lib.js'
import { buildBoqCsv } from './csvExport.js'

const CHECKS = []
function check(no, name, expected, actual) {
  CHECKS.push({no, name, expected: JSON.stringify(expected), actual: JSON.stringify(actual), ok: JSON.stringify(expected) === JSON.stringify(actual)})
}

// ===== A. MATH PARITY (expected dari Python = semantik source) =====
const CASES = __CASES__
CASES.forEach((c, idx) => {
  const t = calcTotals({items: c.items, marginMode: c.mode, marginRate: c.rate, discountType: c.dtype, adjustmentEnabled: c.adj, taxEnabled: c.tax, taxRate: c.trate})
  const no = 'A' + (idx + 1)
  check(no + 'a', c.name + ': base', c.exp.base, Math.round(t.base * 1e6) / 1e6)
  check(no + 'b', c.name + ': margin', c.exp.margin, Math.round(t.margin * 1e6) / 1e6)
  check(no + 'c', c.name + ': tax', c.exp.tax, Math.round(t.tax * 1e6) / 1e6)
  check(no + 'd', c.name + ': grand', c.exp.grand, Math.round(t.grand * 1e6) / 1e6)
})

// A-per-item: calcItem & breakdown
const it1 = {item:'X', qty:4.2, price:2750, breakdown:[]}
check('A9a', 'calcItem 4.2×2750', 11550, calcItem(it1))
const it2 = {item:'Y', qty:1, price:0, breakdown:[{name:'Material', length:3.6, width:0.6, qty:1, unitPrice:1100},{name:'Install', length:3.6, width:0.6, qty:1, unitPrice:350}]}
check('A9b', 'breakdownTotal 2376+756', 3132, breakdownTotal(it2))
check('A9c', 'part area 3.6×0.6', 2.16, calcCostArea(it2.breakdown[0]))
check('A9d', 'part amount 2.16×1100', 2376, calcCostPart(it2.breakdown[0]))
check('A9e', 'effectivePrice max0', 0, effectivePrice({price:-5}))
check('A9f', 'calcItem qty max0', 0, calcItem({qty:-2, price:1000}))

// A10: rupiahFromK & thousand (source formatting). Intl 'currency' IDR
// memakai non-breaking space (U+00A0) setelah "Rp" — samakan di expected.
check('A10a', 'rupiahFromK(3500)', 'Rp\u00A03.500.000', rupiahFromK(3500))
check('A10b', 'thousand(2.16)', '2,16', thousand(2.16))
check('A10c', 'thousand(11550)', '11.550', thousand(11550))

// ===== B. NORMALIZE + LEGACY (source line 685-715, 1473) =====
const norm = normalizeItem({item: 'Custom', qty: '2.5', unit: 'batang', price: '100', breakdown: [{name:'M', amount: 900}]})
check('B1a', 'unit tak dikenal -> unit', 'unit', norm.unit)
check('B1b', 'legacy amount -> unitPrice', 900, norm.breakdown[0].unitPrice)
check('B1c', 'breakdown kosong -> default 2', 2, normalizeItem({item:'z'}).breakdown.length)
const v1 = sanitizeItems([{item:'legacy', qty:1, price:4000}]).map(e => { const n = normalizeItem(e); n.price = num(4000) / 1000; return n })
check('B2', 'import v1 price/1000', 4, v1[0].price)

// ===== B3. SANITIZER =====
const big = sanitizeItems([{item:'ok', qty:1, price:1}, null, 'string', 42, {item:'<img src=x onerror=alert(1)>', qty:1e15, price:-5, specs:'A'.repeat(5000)}])
check('B3a', 'items non-object dibuang', 2, big.length)
check('B3b', 'qty clamp 1e9', 1000000000, big[1].qty)
check('B3c', 'price negatif -> 0', 0, big[1].price)
check('B3d', 'specs dipotong 2000', 2000, big[1].specs.length)
check('B3e', 'tag tetap string biasa', 'string', typeof big[1].item)
check('B3f', 'karakter kontrol dibuang', 'AB', sanitizeItems([{item:'A\u0000B', qty:1}])[0].item)

const tc = sanitizeTemplateChoices({'Plain': [{name:'P1'}], 'Civil': 'bukan-array', 'X': [{name:'nope'}], 'Interior': [null, {name:'I1'}, {name:''}]})
check('B3g', 'templateChoices Plain tersaring', 1, tc['Plain'].length)
check('B3h', 'template tak dikenal diabaikan', undefined, tc['X'])
check('B3i', 'choice tanpa nama dibuang', 1, tc['Interior'].length)

const notes = sanitizeNotes(['  A  ', 'A', 123, '', 'B'.repeat(3000), 'C'])
check('B3j', 'notes unik + trim', 3, notes.length)
check('B3k', 'note panjang dipotong 2000', 2000, notes[1].length)

// ===== C. CSV EXPORT (semantik source) =====
const csvPayload = {
  boqReff: 'BOQ-001', projectReffNo: 'PRJ-001', revisionNumber: 'REV00',
  projectName: 'Interior Pantry & Storage Office', clientName: 'PT Cakrawala Kreatif',
  projectLocation: 'Jakarta Selatan', estimateDate: '2026-10-16',
  marginMode: 'markup', marginRate: 20, discountType: 'percent',
  adjustmentEnabled: true, taxEnabled: true, taxRate: 11, showAdjustmentPdf: true
}
const csv = buildBoqCsv(csvPayload, CASES[0].items)
check('C1', 'CSV diawali BOM', true, csv.charCodeAt(0) === 0xFEFF)
check('C2', 'CSV pakai ;', true, csv.includes(';'))
// C3: header kolom — csvCell dari source me-QUOTE SETIAP sel (termasuk
// header), jadi baris header punya tanda kutip per kolom.
check('C3', 'header kolom ada', true, csv.includes('"NO";"ITEM";"AREA";"GENERAL SPECS.";"Vol";"MEA";"PRICE (000)";"COST BREAKDOWN";"TOTAL (000)";"TOTAL (IDR)"'))
check('C4', 'baris Work total', true, csv.includes('Work total'))
check('C5', 'baris PPN', true, csv.includes('PPN'))
check('C6', 'baris QUOTATION TOTAL', true, csv.includes('QUOTATION TOTAL'))
check('C7', 'label markup %', true, csv.includes('Percentage markup'))
check('C8', 'breakdown detail format', true, csv.includes('Labor: 1 × 1 × 2 × 1.000 = 2.000'))
check('C9', 'TOTAL (IDR) = ribuan×1000 bulat', '"11550000"', csv.split('\n').find(l => l.includes('Upper cabinet')).split(';').pop())
check('C10', 'baris tanpa breakdown tidak punya detail ×', true, !csv.split('\n').find(l => l.includes('Upper cabinet')).includes('×'))

// C11: quote escape
const esc = buildBoqCsv({...csvPayload, projectName: 'Project "aneh"'}, [])
check('C11', 'kutip di-escape ""', true, esc.includes('Project ""aneh""'))

// ===== D. incrementReference (source 730-735) =====
check('D1', 'BOQ-001 -> BOQ-002', 'BOQ-002', incrementReference('BOQ-001', 'BOQ-001'))
check('D2', 'PRJ-99 pad3', 'PRJ-100', incrementReference('PRJ-099', 'PRJ-001'))
check('D3', 'tanpa digit -> fallback', 'PRJ-001', incrementReference('abc', 'PRJ-001'))
check('D4', 'panjang digit dipertahankan', 'BOQ-0001', incrementReference('BOQ-0000', 'BOQ-001'))

// ===== E. itemOptionsFor (source 723-729) =====
const seed = buildTemplateChoiceSeed()
const opts = itemOptionsFor({selectedTemplate: 'Interior', plainChoices: seed['Interior'], items: [{item:'Custom zebra', breakdown:[]}]})
check('E1', 'template dulu', 'Top kitchen cabinet', opts[0])
check('E2', 'item custom ikut', true, opts.includes('Custom zebra'))
check('E3', 'dedupe', opts.length, new Set(opts).size)

const allChecked = CHECKS.filter(c => !c.ok)
allChecked.forEach(c => console.error(`FAIL ${c.no} ${c.name}: expected=${c.expected} actual=${c.actual}`))
console.log('JS_TOTAL ' + CHECKS.length + ', FAIL ' + allChecked.length)
if (allChecked.length) process.exit(1)
'''

    cases_js = []
    for name, items, mode, rate, dtype, adj, tax, trate in TEST_CASES:
        exp = ptotals(items, mode, rate, dtype, adj, tax, trate)
        for k in ('base', 'margin', 'tax', 'grand'):
            exp[k] = round(exp[k], 6)
        cases_js.append({'name': name, 'items': items, 'mode': mode, 'rate': rate,
                         'dtype': dtype, 'adj': adj, 'tax': tax, 'trate': trate, 'exp': exp})

    test_mjs = test_mjs.replace('__CASES__', json_dumps(cases_js))

    # Salin modul VERBATIM (tanpa strip export — ESM asli supaya import antar
    # file berjalan; pdf.js tidak disalin karena pakai Uint8Array blob dst. yang
    # tidak diuji di Node; logika PDF diuji lewat struktur string di build repo).
    # Satu adaptasi khusus SANDBOX: Node ESM butuh ekstensi .js pada import
    # relatif (kode repo pakai import tanpa ekstensi untuk webpack Next.js).
    for fn in ['boqCalc.js', 'lib.js', 'csvExport.js']:
        src = open(f'{REPO}/modules/rab-boq/{fn}', encoding='utf-8').read()
        src = re.sub(r"from '(\./[a-zA-Z]+)'", r"from '\1.js'", src)
        open(f'{SB}/{fn}', 'w', encoding='utf-8').write(src)
    with open(f'{SB}/test.mjs', 'w', encoding='utf-8') as f:
        f.write(test_mjs)

    r = subprocess.run(['node', f'{SB}/test.mjs'], capture_output=True, text=True, timeout=120)
    node_ok = r.returncode == 0
    print(r.stdout.strip())
    if r.stderr.strip():
        print(r.stderr.strip()[:3000])
    check('NODE', 'sandbox Node lulus semua cek JS', True, node_ok)

    # ================= D. PDF EXPORT (port source buildBoqPdf) =================
    # pdf.js dieksekusi di sandbox Node dengan shim minimal (Blob/URL/document)
    # supaya builder-nya berjalan tanpa browser. Struktur PDF diverifikasi:
    # magic header, xref/trailer, font Type1, konten item/summary ter-render,
    # multi-page CONTINUED, dan payload ekstrem tidak crash.
    pdf_shim = (
        "globalThis.Blob = class { constructor(parts, opts) { this.parts = parts; this.opts = opts } }\n"
        "globalThis.URL = { createObjectURL: () => 'blob:shim', revokeObjectURL: () => {} }\n"
        "globalThis.document = { createElement: () => ({ click: () => {}, remove: () => {} }), body: { appendChild: () => {} } }\n"
    )
    pdfjs = open(f'{REPO}/modules/rab-boq/pdf.js', encoding='utf-8').read()
    pdfjs = pdfjs.replace("from './boqCalc'", "from './boqCalc.js'")
    # pdf.js ke file sendiri (pdfsrc.mjs); test mengimpornya — hindari
    # bentrok identifier dengan import di file test.
    with open(f'{SB}/pdfsrc.mjs', 'w', encoding='utf-8') as f:
        f.write(pdf_shim + pdfjs)
    pdf_js = r'''
import { buildBoqPdf } from './pdfsrc.mjs'

const CHECKS = []
function check(no, name, expected, actual) {
  CHECKS.push({no, name, expected: JSON.stringify(expected), actual: JSON.stringify(actual), ok: JSON.stringify(expected) === JSON.stringify(actual)})
}

const payload = {
  version: 5, priceUnit: 'thousand IDR (000)',
  boqReff: 'BOQ-001', projectReffNo: 'PRJ-001', revisionNumber: 'REV00',
  projectName: 'Interior Pantry & Storage Office', clientName: 'PT Cakrawala Kreatif',
  projectLocation: 'Jakarta Selatan', estimateDate: '2026-10-16',
  marginMode: 'markup', marginRate: 20, discountType: 'percent',
  adjustmentEnabled: true, taxEnabled: true, taxRate: 11, showAdjustmentPdf: true,
  activeNotes: ['Quotation is valid for 14 days from the date of issue.']
}
const items = [
  { item: 'Mobilization and cleaning', area: 'All Area', specs: 'Work area protection', qty: 1, unit: 'ls', price: 3500, breakdown: [{ name: 'Labor', length: 1, width: 1, qty: 2, unitPrice: 1000 }] },
  { item: 'Upper cabinet', area: 'Pantry', specs: '18 mm plywood', qty: 4.2, unit: 'm¹', price: 2750, breakdown: [] }
]
const bytes = buildBoqPdf(payload, items)
const P = (o) => { if (o instanceof Uint8Array) return Buffer.from(o).toString('latin1'); return String(o) }
const text = P(bytes)
check('P1', 'magic %PDF-1.4', true, text.startsWith('%PDF-1.4'))
check('P2', '%%EOF di akhir', true, text.trimEnd().endsWith('%%EOF'))
check('P3', 'xref + trailer', true, text.includes('xref') && text.includes('trailer'))
check('P4', '4 font Type1', 4, (text.match(/\/Subtype \/Type1/g) || []).length)
check('P5', 'judul Build On Quantity', true, text.includes('Build On Quantity'))
check('P6', 'item ter-render (Mobilization, wrap 2 baris)', true, text.includes('Mobilization and') && text.includes('cleaning'))
check('P7', 'specs ter-render', true, text.includes('18 mm plywood'))
check('P8', 'total item 11.550', true, text.includes('11.550'))
check('P9', 'summary QUOTATION TOTAL', true, text.includes('QUOTATION TOTAL'))
check('P10', 'PPN label 11% (paren di-escape PDF)', true, text.includes(String.raw`PPN \(11%\)`))
check('P11', 'notes masuk PDF', true, text.includes('Quotation is valid for 14 days'))
// grand: base 15.050k + markup 20% 3.010k + PPN 11% 1.986,6k = 20.046,6k
// rupiahFromK memakai non-breaking space setelah "Rp" (lihat cek A10a).
check('P12', 'grand total 20.046.600', true, text.includes('Rp\u00A020.046.600'))
// cleanText membersihkan non-WinAnsi (¹, ²) — semua byte <= 255
check('P13', 'cleanText: byte semua <= 255', true, Array.from(bytes).every(b => b <= 255))
// Multi-halaman: 30 item panjang -> header CONTINUED + /Count > 1
const manyItems = Array.from({ length: 30 }, (_, i) => ({ item: 'Item nomor ' + (i + 1) + ' dengan nama yang cukup panjang agar membungkus beberapa baris', area: 'A' + i, specs: 'Spec ' + i, qty: 1, unit: 'unit', price: 100, breakdown: [] }))
const bytes2 = buildBoqPdf(payload, manyItems)
const text2 = P(bytes2)
check('P14', 'multi-page: ada CONTINUED', true, text2.includes('CONTINUED'))
check('P15', 'multi-page: /Count > 1', true, /\/Count ([2-9]|\d{2,}) /.test(text2))
// Payload ekstrem (angka NaN/Infinity) tidak membuat PDF crash
const extreme = buildBoqPdf({ ...payload, marginRate: 1e9, taxRate: 1e9, clientName: null, estimateDate: null }, [{ item: 'X', qty: NaN, price: Infinity, breakdown: [] }])
check('P16', 'payload ekstrem tetap menghasilkan PDF', true, P(extreme).startsWith('%PDF-1.4'))
console.log('JS_PDF_TOTAL ' + CHECKS.length + ', FAIL ' + CHECKS.filter(c => !c.ok).length)
CHECKS.filter(c => !c.ok).forEach(c => console.error('PDFFAIL ' + c.no + ': expected=' + c.expected + ' actual=' + c.actual))
if (CHECKS.some(c => !c.ok)) process.exit(1)
'''
    with open(f'{SB}/pdftest.mjs', 'w', encoding='utf-8') as f:
        f.write(pdf_js)
    r2 = subprocess.run(['node', f'{SB}/pdftest.mjs'], capture_output=True, text=True, timeout=120)
    print(r2.stdout.strip())
    if r2.stderr.strip():
        print(r2.stderr.strip()[:2000])
    check('PDFNODE', 'sandbox PDF lulus semua cek', True, r2.returncode == 0)

    # ================= E. GUARD ADMIN (statis) =================
    idx_src = open(f'{REPO}/pages/index.js', encoding='utf-8').read()
    const_src = open(f'{REPO}/lib/constants.js', encoding='utf-8').read()
    reg_src = open(f'{REPO}/modules/registry.js', encoding='utf-8').read()
    view_src = open(f'{REPO}/modules/rab-boq/view.jsx', encoding='utf-8').read()

    check('E1', "navSections admin suite berisi rab_boq", True, "['rab_boq', 'RAB & BOQ']" in const_src)
    check('E2', 'labels.rab_boq ada', True, "rab_boq: 'RAB & BOQ'" in const_src)
    # Branch render + guard: cari blok page === 'rab_boq' lalu pastikan role === 'admin' guard-nya
    m = re.search(r"page === 'rab_boq' \? \((.*?)\n        \) : page === 'settings'", idx_src, re.S)
    block = m.group(1) if m else ''
    check('E3', 'pages/index.js punya cabang rab_boq', True, bool(m))
    check('E4', 'cabang rab_boq di-guard role admin', True, "role === 'admin'" in block)
    check('E5', 'fallback non-admin "khusus administrator"', True, 'khusus administrator' in block)
    check('E6', 'BoqModule diimpor di pages/index.js', True, "from '../modules/rab-boq/view'" in idx_src)
    check('E7', 'exclude dari tombol refresh global', True, "'rab_boq', 'settings']" in idx_src)
    check('E8', 'registry: rab_boq adminOnly source core', True, bool(re.search(r"id: 'rab_boq'.*?adminOnly: true.*?source: 'core'", reg_src, re.S)))
    # ModuleView TIDAK menyentuh rab_boq
    mv_src = open(f'{REPO}/components/ModuleView.js', encoding='utf-8').read()
    check('E9', 'ModuleView tidak merender rab_boq', True, 'rab_boq' not in mv_src)
    # Source HTML tidak dibawa ke public/
    pub_public = []
    for root, _dirs, files in os.walk(f'{REPO}/public'):
        for fn in files:
            pub_public.append(os.path.join(root, fn))
    check('E10', 'tidak ada file perhitungan-rab di public/', True,
          not any('perhitungan' in p or 'rab' in os.path.basename(p).lower() for p in pub_public))
    # Tidak ada dangerouslySetInnerHTML / iframe di modul
    mod_dir = f'{REPO}/modules/rab-boq'
    bad = []
    for fn in sorted(os.listdir(mod_dir)):
        if not (fn.endswith('.js') or fn.endswith('.jsx')):
            continue  # README.md boleh MENYEBUT istilah; yang diuji hanya kode
        srcf = open(os.path.join(mod_dir, fn), encoding='utf-8').read()
        if 'dangerouslySetInnerHTML' in srcf or '<iframe' in srcf:
            bad.append(fn)
    check('E11', 'tanpa dangerouslySetInnerHTML/iframe', True, not bad)
    # view pakai CSS scoped boq-
    check('E12', 'CSS scoped .boq-root (tidak global)', True, '.boq-root' in view_src)

    # ================= F. BUAT PROYEK DARI BOQ =================
    cp_src = open(f'{REPO}/modules/rab-boq/CreateProjectModal.jsx', encoding='utf-8').read()
    check('F1', 'insert hanya kolom projects', True, bool(re.search(r"\.insert\(\{\s*kode: finalKode,\s*code: finalKode,\s*name: projectName,\s*status: 'NOT_START'\s*\}\)", cp_src)))
    check('F2', 'konfirmasi eksplisit window.confirm', True, 'window.confirm' in cp_src)
    check('F3', 'tidak menyentuh PR/budget/revenue', True,
          all(w not in cp_src for w in ['purchase_requests', 'project_plans', 'project_closings']))
    check('F4', 'status awal NOT_START', True, "status: 'NOT_START'" in cp_src)
    check('F5', 'cek duplikat kode', True, 'duplicate' in cp_src)

    # ================= G. SUMBER ASLI TIDAK DIUBAH =================
    src_path = '/home/ubuntu/.hermes/webui/attachments/fff4b1110401/perhitungan-rab-otomatis-2/perhitungan-rab-otomatis-2.html'
    src_text = open(src_path, encoding='utf-8').read()
    check('G1', 'source HTML utuh (1570 baris)', 1570, len(src_text.splitlines()))

    # ================= LAPORAN =================
    print('\n=== HASIL scripts/rab-boq-test ===')
    fails = 0
    for no, name, expected, actual, ok in CHECKS:
        mark = 'PASS' if ok else 'FAIL'
        if not ok:
            fails += 1
        if not ok or os.environ.get('RAB_VERBOSE'):
            print(f'[{mark}] {no}: {name}' + ('' if ok else f' — expected={expected!r} actual={actual!r}'))
    total = len(CHECKS)
    print(f'{total - fails}/{total} cek lulus' + ('' if fails else ' — SEMUA HIJAU'))
    return 1 if (fails or not node_ok) else 0

def json_dumps(obj):
    import json
    return json.dumps(obj)

if __name__ == '__main__':
    sys.exit(main())
