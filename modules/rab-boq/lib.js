// ============================================================
// modules/rab-boq/lib.js — DATA SEED & LOGIKA UI NON-DOM
// ============================================================
// plainChoiceSeed, standardNoteSeed, templates, templateChoiceSeed
// disalin VERBATIM dari source HTML line 594-657 (tidak diubah).
// Fungsi di sini bebas React supaya harness Node bisa mengimpornya.
// ============================================================

export var blankItem = { item: '', area: '', specs: '', qty: 1, unit: 'unit', price: 0, breakdown: [{ name: 'Material', length: 1, width: 1, qty: 1, unitPrice: 0 }, { name: 'Labor', length: 1, width: 1, qty: 1, unitPrice: 0 }], breakdownOpen: false, manualItem: true }

export var plainChoiceSeed = [
  { id: 'mobilization-cleaning', name: 'Mobilization and cleaning', unit: 'ls' },
  { id: 'dismantle-item', name: 'Dismantle Item', unit: 'ls' },
  { id: 'demolition-item', name: 'Demolition Item', unit: 'ls' }
]

export var standardNoteSeed = [
  'Free Design Fee for project above 100 Mio',
  'Standard fittings for cabinet: Slowmotion hinges ex Hafele; Slowmotion double track full extension ex: Huben',
  'Project duration: estimate 6-8 weeks after down payment / when site ready.',
  'All price included delivery & installation',
  'Price might be adjusted by design agreed.',
  'Quotation is valid for 14 days from the date of issue.',
  'Down payment of 50% is required before work commencement; remaining balance upon project handover.',
  'Any additional work beyond the agreed scope will be charged separately upon written approval.',
  'Client to provide site access and necessary utilities (electricity and water) during installation period.',
  'Warranty covers 1 year for workmanship; manufacturer warranty applies for fittings and appliances.',
  'Up to 2 minor design revisions are included; major changes may incur additional fees.',
  'Project timeline may be adjusted due to material availability or site conditions beyond our control.',
  'All materials follow the agreed specifications; any substitution requires prior client approval.'
]

export var templates = {
  'Plain': [],
  'Preliminary': [],
  'Interior': [
    { item: 'Top kitchen cabinet', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Bottom kitchen cabinet', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Kitchen island', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Pantry cabinet', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Wardrobe', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Sliding door wardrobe', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Credenza', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Shelving', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Bookshelf', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'TV cabinet', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'TV backdrop panel', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Vanity table', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Study desk', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Shoe cabinet', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Bathroom vanity', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Bed frame', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Headboard', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Nightstand', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Display cabinet', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Partition', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Wall panel', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Bar counter', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Reception desk', area: '', specs: '', qty: 1, unit: 'unit', price: 0 },
    { item: 'Office workstation', area: '', specs: '', qty: 1, unit: 'unit', price: 0 }
  ],
  'Civil': [
    { item: 'Demolition', area: '', specs: '', qty: 1, unit: 'm²', price: 0 },
    { item: 'Wall works', area: '', specs: '', qty: 1, unit: 'm²', price: 0 },
    { item: 'Ceiling works', area: '', specs: '', qty: 1, unit: 'm²', price: 0 },
    { item: 'Flooring works', area: '', specs: '', qty: 1, unit: 'm²', price: 0 },
    { item: 'Electrical', area: '', specs: '', qty: 1, unit: 'point', price: 0 },
    { item: 'Paint finishing', area: '', specs: '', qty: 1, unit: 'm²', price: 0 }
  ]
}

// templateChoiceSeed (source line 652-657) — Plain/Preliminary kosong,
// Interior/Civil dipetakan dari item template.
export function buildTemplateChoiceSeed() {
  return {
    'Plain': [],
    'Preliminary': plainChoiceSeed.slice(),
    'Interior': templates['Interior'].map(function (entry, index) { return { id: 'interior-' + index, name: entry.item, unit: entry.unit, specs: entry.specs } }),
    'Civil': templates['Civil'].map(function (entry, index) { return { id: 'civil-' + index, name: entry.item, unit: entry.unit, specs: entry.specs } })
  }
}

// Nama template yang dikenal (source import line 1478/1482).
export const TEMPLATE_NAMES = ['Plain', 'Preliminary', 'Interior', 'Civil']

// itemOptions (source line 723-729): daftar nama untuk dropdown ITEM
// dari template terpilih + pilihan kustom + item yang sudah ada.
export function itemOptionsFor(state) {
  var names = []
  var push = function (n) { if (n && names.indexOf(n) < 0) names.push(n) }
  ;(templates[state.selectedTemplate] || []).forEach(function (entry) { push(entry.item) })
  ;(state.plainChoices || []).forEach(function (entry) { push(entry.name) })
  ;(state.items || []).forEach(function (entry) { push(entry.item) })
  return names
}

// incrementReference (source line 730-735): PRJ-001 -> PRJ-002 / BOQ-002, dst.
export function incrementReference(value, fallback) {
  var match = String(value || '').match(/^(.*?)(\d+)$/)
  if (!match) return fallback
  return match[1] + String(Number(match[2]) + 1).padStart(Math.max(3, match[2].length), '0')
}

// Tanggal hari ini zona Asia/Jakarta dalam format YYYY-MM-DD (source line 1554-1557).
export function todayJakarta() {
  var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  var bits = {}
  parts.forEach(function (part) { bits[part.type] = part.value })
  return bits.year + '-' + bits.month + '-' + bits.day
}
