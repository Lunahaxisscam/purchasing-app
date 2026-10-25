// ============================================================
// modules/rab-boq/boqCalc.js — FUNGSI KALKULASI VERBATIM dari source
// perhitungan-rab-otomatis-2.html (DAT, 1570 baris, versi 5).
// ============================================================
// SEMUA rumus di file ini disalin 1:1 dari <script> source HTML
// (function num/calcCostArea/calcCostPart/calcItem/breakdownTotal/
//  calculateTotals core) — TIDAK ada perubahan matematis.
// Admin Suite hanya membungkus UI-nya. Referensi source: baris HTML
// 668-736 (helper + calc), 854-872 (calculateTotals), 701-715 (normalize).
//
// File ini HARUS bebas React dan bebas browser API supaya bisa di-import
// langsung oleh harness Node (scripts/rab-boq-test/run.py pattern
// scripts/flow-logic-test/run.py — regresi math parity vs source).
// ============================================================

// Batas ukuran & jumlah untuk JSON import (hardening, bukan dari source:
// source mem-parse JSON apa pun; di app ini dibatasi agar payload ekstrem
// tidak menggantung tab admin). Nilai dipilih konservatif.
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024      // 2 MB file JSON
export const IMPORT_MAX_ITEMS = 500                  // batas item BOQ
export const IMPORT_MAX_NOTES = 100                  // batas opsi/catatan aktif
export const IMPORT_MAX_CHOICES_PER_TEMPLATE = 500   // batas pilihan per template
export const IMPORT_MAX_TEXT_LEN = 2000              // batas panjang 1 field teks
export const IMPORT_MAX_BREAKDOWN = 200              // batas komponen per item

export function num(value) {
  var n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

// Area selalu >= 0 (source line 696).
export function calcCostArea(part) {
  return Math.max(0, num(part.length)) * Math.max(0, num(part.width))
}

// Amount = P × L × Qty × Unit Price (source line 698-700).
export function calcCostPart(part) {
  return calcCostArea(part) * Math.max(0, num(part.qty)) * Math.max(0, num(part.unitPrice))
}

// Total breakdown 1 item = jumlah semua komponen (source line 716-718).
export function breakdownTotal(item) {
  return (item.breakdown || []).reduce(function (sum, part) { return sum + calcCostPart(part) }, 0)
}

// Harga efektif >= 0 (source line 719-721).
export function effectivePrice(item) {
  return Math.max(0, num(item.price))
}

// Total 1 item = qty × price (source line 722).
export function calcItem(item) {
  return Math.max(0, num(item.qty)) * effectivePrice(item)
}

// Batas persentase markup/discount: 99 (source line 860: Math.min(adjustmentValue, 99)).
export const PERCENT_CAP = 99

// inti calculateTotals (source line 854-872) — dikembalikan objek murni
// agar bisa diuji tanpa DOM. Semua nama field identik dengan source.
export function calcTotals(opts) {
  var base = (opts.items || []).reduce(function (sum, item) { return sum + calcItem(item) }, 0)
  var adjustmentValue = Math.max(0, num(opts.marginRate))
  var mode = opts.marginMode
  var adjustmentType = opts.discountType
  var adjustmentEnabled = opts.adjustmentEnabled !== false
  var percentageRate = Math.min(adjustmentValue, 99) / 100
  var nominalAdjustmentK = adjustmentType === 'nominal' ? adjustmentValue / 1000 : 0
  var appliedAdjustmentK = 0
  if (adjustmentEnabled) {
    if (mode === 'gross') appliedAdjustmentK = base / (1 - percentageRate) - base
    if (mode === 'markup') appliedAdjustmentK = adjustmentType === 'nominal' ? nominalAdjustmentK : base * percentageRate
    if (mode === 'discount') appliedAdjustmentK = adjustmentType === 'nominal' ? -Math.min(base, nominalAdjustmentK) : -base * percentageRate
  }
  var sellBeforeTax = Math.max(0, base + appliedAdjustmentK)
  var taxRate = opts.taxEnabled ? Math.max(0, num(opts.taxRate)) / 100 : 0
  var tax = sellBeforeTax * taxRate
  return {
    base: base,
    margin: appliedAdjustmentK,
    tax: tax,
    grand: sellBeforeTax + tax,
    adjustmentValue: adjustmentValue,
    nominalAdjustmentK: nominalAdjustmentK,
    mode: mode,
    adjustmentType: adjustmentType,
    adjustmentEnabled: adjustmentEnabled
  }
}

// Fallback breakdown default (source blankItem line 593 + defaultBreakdown 679-684).
export function defaultBreakdown() {
  return [
    { name: 'Material', length: 1, width: 1, qty: 1, unitPrice: 0 },
    { name: 'Labor', length: 1, width: 1, qty: 1, unitPrice: 0 }
  ]
}

// normalizeBreakdownPart (source line 685-694) — mendukung legacy field `amount`.
export function normalizeBreakdownPart(part) {
  var legacyAmount = num(part.amount)
  return {
    name: String(part.name || 'Component'),
    length: num(part.length == null ? 1 : part.length),
    width: num(part.width == null ? 1 : part.width),
    qty: num(part.qty == null ? 1 : part.qty),
    unitPrice: num(part.unitPrice == null ? legacyAmount : part.unitPrice)
  }
}

// Daftar unit valid (source line 659).
export const UNITS = ['ls', 'm²', 'm¹', 'unit', 'point', 'set', 'day', 'kg']

// normalizeItem (source line 701-715). pilihan unit di luar daftar -> 'unit'.
export function normalizeItem(entry) {
  var item = {
    item: String(entry.item != null ? entry.item : (entry.name || '')),
    area: String(entry.area || ''),
    specs: String(entry.specs || ''),
    qty: num(entry.qty == null ? 1 : entry.qty),
    unit: UNITS.indexOf(entry.unit) >= 0 ? entry.unit : 'unit',
    price: num(entry.price),
    breakdown: Array.isArray(entry.breakdown) && entry.breakdown.length ? entry.breakdown.map(normalizeBreakdownPart) : defaultBreakdown(),
    breakdownOpen: entry.breakdownOpen === true,
    manualItem: entry.manualItem === true
  }
  if (entry.choiceId) item.choiceId = String(entry.choiceId)
  return item
}

// thousand() (source line 671): id-ID, maks 2 desimal, pembulatan 2 digit.
export function thousand(value) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Math.round((value || 0) * 100) / 100)
}

// rupiahFromK() (source line 670): nilai ribuan -> string Rp penuh (× 1000).
export function rupiahFromK(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Math.round((value || 0) * 1000))
}

// csvCell (source line 945): sel CSV di-quote, " di-double.
export function csvCell(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'
}

// safeFileName (source line 944).
export function safeFileName(name) {
  return (name || 'rab').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'rab'
}

// formattedDate untuk PDF (source line 1034-1038): YYYY-MM-DD -> DD/MM/YYYY.
export function formattedDate(value) {
  if (!value) return '-'
  var parts = String(value).split('-')
  return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : value
}

// ============================================================
// Import sanitizer — hardening di ATAS perilaku source (bukan pengganti).
// Source line 1463-1514 mem-parse JSON lalu menyalin nilai apa pun ke state.
// Di sini ditambah: cek ukuran, tipe, jumlah, panjang string; nilai di luar
// spesifikasi ditolak/dibuang dengan jejak, BUKAN diam-diam diparse jadi 0.
// Referensi: task body "Sanitasi JSON import limits/type validation/XSS".
// React tidak merender string sebagai HTML, jadi risiko XSS utamanya lewat
// atribut berbahaya; sanitizer memastikan hanya string biasa & angka terbatas.
// ============================================================
function cleanText(v) {
  var s = String(v == null ? '' : v)
  if (s.length > IMPORT_MAX_TEXT_LEN) s = s.slice(0, IMPORT_MAX_TEXT_LEN)
  // buang karakter kontrol (kecuali \n \t) — teks BOQ tidak butuh itu
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

function cleanNum(v, fallback, maxAbs, min) {
  if (v === null || v === undefined || v === '') return fallback
  var n = parseFloat(v)
  if (!Number.isFinite(n)) return fallback
  if (maxAbs != null && Math.abs(n) > maxAbs) n = maxAbs * Math.sign(n)
  if (min != null && n < min) n = min
  return n
}

// Sanitasi pilihan template (source import line 1477-1481 hanya cek string name).
export function sanitizeChoice(c) {
  if (!c || typeof c !== 'object') return null
  var name = cleanText(c.name).trim()
  if (!name) return null
  return {
    id: cleanText(c.id).slice(0, 120) || ('choice-' + Math.random().toString(36).slice(2, 10)),
    name: name,
    unit: UNITS.indexOf(c.unit) >= 0 ? c.unit : 'unit',
    specs: cleanText(c.specs || '')
  }
}

// Sanitasi state.templateChoices (maks 4 template dikenal).
export function sanitizeTemplateChoices(tc) {
  var out = { Plain: [], Preliminary: [], Interior: [], Civil: [] }
  if (!tc || typeof tc !== 'object') return out
  Object.keys(out).forEach(function (key) {
    if (!Array.isArray(tc[key])) return
    out[key] = tc[key].slice(0, IMPORT_MAX_CHOICES_PER_TEMPLATE).map(sanitizeChoice).filter(Boolean)
  })
  return out
}

// Sanitasi items — memakai normalizeItem verbatim di atasnya, ditambah
// limit jumlah item & komponen (source tidak punya limit).
export function sanitizeItems(items) {
  if (!Array.isArray(items)) return []
  // entri yang bukan objek (null/string/angka) dibuang — bukan diubah jadi
  // item kosong; file valid tidak pernah punya entri seperti ini.
  return items.slice(0, IMPORT_MAX_ITEMS).filter(function (entry) {
    return entry && typeof entry === 'object'
  }).map(function (entry) {
    var it = normalizeItem(entry)
    it.item = cleanText(it.item)
    it.area = cleanText(it.area)
    it.specs = cleanText(it.specs)
    it.qty = cleanNum(it.qty, 1, 1e9, 0)
    it.price = cleanNum(it.price, 0, 1e9, 0)
    it.breakdown = (it.breakdown || []).slice(0, IMPORT_MAX_BREAKDOWN).map(function (p) {
      return {
        name: cleanText(p.name).slice(0, 200) || 'Component',
        length: cleanNum(p.length, 1, 1e6, 0),
        width: cleanNum(p.width, 1, 1e6, 0),
        qty: cleanNum(p.qty, 1, 1e6, 0),
        unitPrice: cleanNum(p.unitPrice, 0, 1e9, 0)
      }
    })
    if (it.choiceId) it.choiceId = cleanText(it.choiceId).slice(0, 120)
    return it
  })
}

// Sanitasi noteOptions / activeNotes (source line 1484-1487).
export function sanitizeNotes(arr) {
  if (!Array.isArray(arr)) return []
  var seen = []
  arr.forEach(function (n) {
    if (typeof n !== 'string') return
    var s = cleanText(n).trim()
    if (s && seen.indexOf(s) < 0 && seen.length < IMPORT_MAX_NOTES) seen.push(s)
  })
  return seen
}
