// ============================================================
// modules/rap/model.js — LOGIKA MURNI RAP (Rencana Anggaran Pelaksana)
// ============================================================
// t_71d95cfe (S3/7), diperkeras t_3b877fb5 (temuan Brooklyn P1).
// RAP = anggaran PELAKSANAAN internal (rencana qty & harga satuan versi tim
// sendiri) yang diturunkan dari RAB/BOQ yang sudah ada. File ini SENGAJA
// bebas React, bebas browser API, dan bebas Supabase supaya bisa diuji
// langsung oleh harness Node (scripts/rap-test).
//
// BATAS TANGGUNG JAWAB (jujur):
//   * Modul ini TIDAK menulis DB. Tidak ada tabel `rap_versions` (freeze
//     migrasi) — lihat store.js: mode DRAFT_ONLY.
//   * Modul ini TIDAK menghitung markup/PPN RAB, dan TIDAK mengklaim
//     perbandingan "apel-vs-apel". RAB & BOQ menyimpan HARGA JUAL penawaran
//     ke klien (sudah mengandung margin), sedangkan RAP adalah BIAYA
//     PELAKSANAAN. Karena itu perbandingan RAB vs RAP adalah INDIKASI MARGIN,
//     bukan perbandingan biaya-vs-biaya. Setiap hasil perbandingan membawa
//     `baseline` (kind + label + catatan) supaya UI tidak bisa menyebutnya
//     "apel-vs-apel" saat sumbernya tidak sebanding.
//   * Modul ini TIDAK mengirim PR dan TIDAK memecah pekerjaan menjadi
//     material. Ia hanya MENYUSUN payload PR (kontrak handoff) — dan hanya
//     untuk baris yang benar-benar baris MATERIAL BAKU (BOM) dengan
//     material_id + satuan + qty positif yang terverifikasi ke master
//     material. Pekerjaan jadi / upah / jasa DITOLAK dengan penjelasan,
//     bukan ditebak dari nama barang dan bukan dipecah otomatis.
//   * Angka TIDAK pernah dikoersi diam-diam: harga negatif / bukan angka /
//     kosong tidak pernah menjadi 0. Nilai yang tidak valid disimpan sebagai
//     state eksplisit (MONEY.*) dan MEMBLOKIR validasi + handoff.
// ============================================================

// ------------------------------------------------------------
// 1) STATUS & VERSI
// ------------------------------------------------------------
// Alur minimum: draft -> diajukan -> disetujui / ditolak, dan versi lama
// bisa DIGANTIKAN saat versi baru disetujui. Tidak ada status teknis lain
// supaya UI tidak menampilkan kosakata yang tidak dipakai lapangan.
export const RAP_STATUS = {
  DRAFT: 'DRAFT',
  DIAJUKAN: 'DIAJUKAN',
  DISETUJUI: 'DISETUJUI',
  DITOLAK: 'DITOLAK',
  DIGANTIKAN: 'DIGANTIKAN'
}

export const RAP_STATUS_LABEL = {
  DRAFT: 'Draft',
  DIAJUKAN: 'Diajukan',
  DISETUJUI: 'Disetujui',
  DITOLAK: 'Ditolak',
  DIGANTIKAN: 'Digantikan'
}

// Transisi yang DIIZINKAN. Semua transisi lain ditolak dengan alasan —
// tidak ada "loncat status" diam-diam.
const TRANSITIONS = {
  DRAFT: ['DIAJUKAN'],
  DIAJUKAN: ['DISETUJUI', 'DITOLAK', 'DRAFT'],
  DISETUJUI: ['DIGANTIKAN'],
  DITOLAK: ['DRAFT'],
  DIGANTIKAN: []
}

export function canTransition(from, to) {
  const a = String(from || '').toUpperCase()
  const b = String(to || '').toUpperCase()
  if (!RAP_STATUS[a] || !RAP_STATUS[b]) return false
  return (TRANSITIONS[a] || []).indexOf(b) >= 0
}

export function transitionProblem(from, to) {
  if (canTransition(from, to)) return null
  const a = RAP_STATUS_LABEL[String(from || '').toUpperCase()] || from || '—'
  const b = RAP_STATUS_LABEL[String(to || '').toUpperCase()] || to || '—'
  return `Status RAP tidak bisa berpindah dari "${a}" ke "${b}".`
}

// Versi: RAP-01, RAP-02, ... Nomor berikutnya = maksimum label yang ada + 1.
// Bukan nomor dokumen resmi (tidak ada penomoran DB) — hanya label versi
// internal supaya dua revisi tidak tertukar.
export function nextVersionLabel(existingLabels = []) {
  let max = 0
  for (const raw of existingLabels) {
    const m = String(raw || '').match(/RAP[-\s]?(\d+)/i)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return 'RAP-' + String(max + 1).padStart(2, '0')
}

// ------------------------------------------------------------
// 2) ANGKA & UANG (tanpa koersi diam-diam)
// ------------------------------------------------------------
// Harga RAB (payload BOQ) bersatuan RIBUAN rupiah (000). RAP memakai
// rupiah penuh. Konversi ini SATU-SATUNYA tempat perkalian 1000 terjadi.
export const RAB_PRICE_UNIT = 1000

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// State nilai uang/qty. `null` BUKAN nol; minus BUKAN positif.
export const MONEY = {
  OK: 'OK',
  ZERO: 'ZERO',
  MISSING: 'MISSING',
  NEGATIVE: 'NEGATIVE',
  NOT_NUMBER: 'NOT_NUMBER'
}

export const MONEY_LABEL = {
  OK: 'terisi',
  ZERO: 'nol (belum lengkap)',
  MISSING: 'kosong (bukan nol)',
  NEGATIVE: 'negatif (ditolak)',
  NOT_NUMBER: 'bukan angka (ditolak)'
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key)

// Pilih nilai mentah untuk satu field angka.
// Aturan: `*_raw` adalah otoritas — KECUALI field biasa diubah eksplisit
// (nilainya tidak lagi cocok dengan hasil baca `*_raw`). Tanpa aturan ini,
// `{...line, planned_qty: 2}` akan tetap memakai raw lama (edit hilang),
// atau sebaliknya nilai mentah "-100" hilang saat baris dinormalisasi ulang.
function pickRaw(src, field) {
  const rawKey = field + '_raw'
  const hasPlain = hasOwn(src, field)
  const hasRaw = hasOwn(src, rawKey)
  if (hasRaw && hasPlain) {
    const r = inspectNumber(src[rawKey])
    const same = (r.value === null && (src[field] === null || src[field] === undefined))
      || (r.value !== null && Number(src[field]) === r.value)
    return same ? src[rawKey] : src[field]
  }
  if (hasRaw) return src[rawKey]
  if (hasPlain) return src[field]
  return null
}

// Inspeksi nilai mentah SEBELUM koersi apa pun. Mengembalikan:
//   state  — MONEY.*
//   value  — angka hanya bila state OK/ZERO; null bila tidak bisa dipakai
//   raw    — nilai mentah apa adanya (untuk pesan & tampilan input)
//   negative — angka negatif apa adanya (untuk pesan), bila terbaca
export function inspectNumber(raw) {
  if (raw === null || raw === undefined) return { state: MONEY.MISSING, value: null, raw: null, negative: null }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { state: MONEY.NOT_NUMBER, value: null, raw, negative: null }
    if (raw < 0) return { state: MONEY.NEGATIVE, value: null, raw, negative: raw }
    return { state: raw === 0 ? MONEY.ZERO : MONEY.OK, value: raw, raw, negative: null }
  }
  if (typeof raw === 'boolean') return { state: MONEY.NOT_NUMBER, value: null, raw, negative: null }
  const text = String(raw).trim()
  if (!text) return { state: MONEY.MISSING, value: null, raw, negative: null }
  // Minus / parenthesis ditolak EKSPLISIT — tidak pernah jadi positif.
  if (/^[-−(]/.test(text)) {
    const digits = text.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')
    const n = Number(digits)
    return { state: MONEY.NEGATIVE, value: null, raw, negative: Number.isFinite(n) ? -Math.abs(n) : null }
  }
  const cleaned = text.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')
  if (!cleaned) return { state: MONEY.NOT_NUMBER, value: null, raw, negative: null }
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return { state: MONEY.NOT_NUMBER, value: null, raw, negative: null }
  return { state: n === 0 ? MONEY.ZERO : MONEY.OK, value: n, raw, negative: null }
}

// Alias eksplisit untuk uang (perilaku sama; nama dipakai di UI/test).
export const inspectMoney = inspectNumber
export const inspectQty = inspectNumber

// String angka dari input (boleh "1.200.000" / "1,5") -> number.
// Hanya dipakai untuk field qty lama; minus dikembalikan null (bukan 0).
export function parseNumberInput(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const raw = String(v == null ? '' : v).trim()
  if (!raw) return null
  if (/[-(]/.test(raw)) return null // minus/parenthesis ditolak eksplisit
  const cleaned = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

// Konversi payload RAB (ribuan -> rupiah). SATU-SATUNYA tempat ×1000.
// t_3b877fb5: TIDAK mengklaim nilai untuk input tidak valid — negatif,
// bukan angka, atau kosong menghasilkan `null` (BUKAN 0), supaya pemanggil
// wajib memutuskan sendiri dan tidak bisa "lolos" karena clamp diam-diam.
export function rabPriceToRupiah(priceThousand) {
  const check = inspectNumber(priceThousand)
  if (check.state === MONEY.NEGATIVE || check.state === MONEY.NOT_NUMBER || check.state === MONEY.MISSING) return null
  return Math.round(check.value * RAB_PRICE_UNIT)
}

export function roundRupiah(v) {
  const n = toNumber(v)
  if (n === null) return 0
  return Math.round(n)
}

export function formatRupiah(v) {
  const n = roundRupiah(v)
  return 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 0 })
}

// ------------------------------------------------------------
// 3) JENIS BARIS & SUMBER HARGA (eksplisit, bukan tebakan nama)
// ------------------------------------------------------------
// `line_kind` WAJIB ditandai manusia. Tidak ada heuristik nama barang:
// "Wardrobe barang jadi" tidak boleh otomatis dianggap material, dan
// "Triplek 9mm" tidak otomatis dianggap pekerjaan.
export const LINE_KIND = {
  MATERIAL: 'MATERIAL',       // material baku (BOM) — satu-satunya yang boleh masuk PR material
  WORK_ITEM: 'WORK_ITEM',     // pekerjaan / barang jadi (baris BOQ)
  LABOR: 'LABOR',             // upah / jasa
  UNSPECIFIED: 'UNSPECIFIED'  // belum ditandai — MEMBLOKIR handoff
}

export const LINE_KIND_LABEL = {
  MATERIAL: 'Material baku (BOM)',
  WORK_ITEM: 'Pekerjaan / barang jadi (BOQ)',
  LABOR: 'Upah / jasa',
  UNSPECIFIED: 'Belum ditandai'
}

// Sumber angka acuan. Dipakai untuk memberi label jujur pada perbandingan.
export const PRICE_BASIS = {
  RAB_SELL_PRICE: 'RAB_SELL_PRICE',     // harga JUAL penawaran (RAB & BOQ)
  WBS_LABOR_ONLY: 'WBS_LABOR_ONLY',     // hanya UPAH (Budgeting/WBS)
  MANUAL: 'MANUAL',                     // diisi manusia, tanpa acuan
  UNKNOWN: 'UNKNOWN'
}

export function basisFromPriceSource(priceSource) {
  const ps = String(priceSource || '').toUpperCase()
  if (ps === 'RAB' || ps === 'RAB_TANPA_HARGA' || ps === 'RAB_HARGA_TIDAK_VALID') return PRICE_BASIS.RAB_SELL_PRICE
  if (ps === 'WBS_UPAH' || ps === 'WBS_TANPA_UPAH' || ps === 'WBS_UPAH_TIDAK_VALID') return PRICE_BASIS.WBS_LABOR_ONLY
  if (ps === 'MANUAL') return PRICE_BASIS.MANUAL
  return PRICE_BASIS.UNKNOWN
}

// ------------------------------------------------------------
// 4) BARIS RAP
// ------------------------------------------------------------
// Kunci baris = nama pekerjaan + satuan (dinormalisasi). Dipakai untuk
// mencocokkan baris RAP dengan baris RAB tanpa ID (RAB hanya payload JSON).
export function lineKey(itemName, unit) {
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim()
  return norm(itemName) + '|' + norm(unit)
}

let lineSeq = 0
export function newLineId() {
  lineSeq += 1
  return 'rap-line-' + Date.now().toString(36) + '-' + lineSeq
}

// Baris kanonik. `rab_*` = angka acuan dari RAB (tidak boleh hilang saat
// qty/harga rencana diedit — itulah dasar perbandingan), `planned_*` = yang
// diedit tim.
//
// PENTING (t_3b877fb5): tidak ada `Math.max(0, ...)` di sini. Nilai mentah
// disimpan di `*_raw` + `*_state`; nilai yang tidak valid menjadi null dan
// MEMBLOKIR validasi/handoff. Harga 0 yang memang diketik manusia tetap 0
// (boleh, ditandai belum lengkap) — 0 hasil koersi TIDAK pernah terjadi.
export function normalizeLine(raw = {}) {
  const src = raw || {}

  const itemName = String(src.item_name == null ? (src.item || '') : src.item_name).trim()
  const unit = String(src.unit == null ? '' : src.unit).trim()

  const rabQtyRaw = pickRaw(src, 'rab_qty')
  const rabPriceRaw = pickRaw(src, 'rab_unit_price')
  const plannedQtyRaw = pickRaw(src, 'planned_qty')
  const plannedPriceRaw = pickRaw(src, 'planned_unit_price')

  const rabQty = inspectNumber(rabQtyRaw)
  const rabPrice = inspectNumber(rabPriceRaw)
  const plannedQty = inspectNumber(plannedQtyRaw)
  const plannedPrice = inspectNumber(plannedPriceRaw)

  const priceSource = String(src.price_source || 'UNSPECIFIED').toUpperCase()
  const priceBasis = String(src.price_basis || basisFromPriceSource(priceSource)).toUpperCase()
  const kindRaw = String(src.line_kind || src.kind || '').toUpperCase()
  const lineKind = LINE_KIND[kindRaw] ? kindRaw : LINE_KIND.UNSPECIFIED

  return {
    id: src.id || newLineId(),
    key: lineKey(itemName, unit),
    item_name: itemName,
    unit,
    area: String(src.area == null ? '' : src.area).trim(),
    specs: String(src.specs == null ? '' : src.specs).trim(),
    material_id: src.material_id == null || src.material_id === '' ? null : src.material_id,
    kode: String(src.kode == null ? '' : src.kode).trim(),
    line_kind: lineKind,
    // qty: angka hanya bila valid (>= 0). Kosong/minus/bukan angka -> null.
    rab_qty: rabQty.state === MONEY.OK || rabQty.state === MONEY.ZERO ? rabQty.value : null,
    rab_qty_state: rabQty.state,
    rab_qty_raw: rabQty.raw,
    rab_unit_price: rabPrice.state === MONEY.OK || rabPrice.state === MONEY.ZERO ? rabPrice.value : null,
    rab_unit_price_state: rabPrice.state,
    rab_unit_price_raw: rabPrice.raw,
    planned_qty: plannedQty.state === MONEY.OK || plannedQty.state === MONEY.ZERO ? plannedQty.value : null,
    planned_qty_state: plannedQty.state,
    planned_qty_raw: plannedQty.raw,
    planned_unit_price: plannedPrice.state === MONEY.OK || plannedPrice.state === MONEY.ZERO ? plannedPrice.value : null,
    planned_unit_price_state: plannedPrice.state,
    planned_unit_price_raw: plannedPrice.raw,
    // harga negatif yang terbaca (untuk pesan; TIDAK dipakai menghitung)
    planned_unit_price_negative: plannedPrice.negative,
    // dari mana harga acuan baris ini berasal (RAB / WBS / MANUAL / UNSPECIFIED)
    price_source: priceSource,
    price_basis: priceBasis
  }
}

// Nilai uang yang boleh masuk aritmetika: hanya angka valid >= 0.
function usableMoney(v) {
  const n = toNumber(v)
  return n === null || n < 0 ? 0 : n
}

export function lineAmounts(line) {
  const rabQty = usableMoney(line.rab_qty)
  const rabPrice = usableMoney(line.rab_unit_price)
  const plannedQty = usableMoney(line.planned_qty)
  const plannedPrice = usableMoney(line.planned_unit_price)
  const rabAmount = roundRupiah(rabQty * rabPrice)
  const rapAmount = roundRupiah(plannedQty * plannedPrice)
  const diffAmount = rapAmount - rabAmount
  const diffPct = rabAmount > 0 ? Math.round((diffAmount / rabAmount) * 1000) / 10 : null
  const qtyDiff = Math.round((plannedQty - rabQty) * 1000) / 1000
  const priceDiff = roundRupiah(plannedPrice - rabPrice)
  const state = diffAmount > 0 ? 'OVER' : (diffAmount < 0 ? 'UNDER' : 'SAME')
  return {
    rabAmount,
    rapAmount,
    diffAmount,
    diffPct,
    qtyDiff,
    priceDiff,
    state,
    // baris hanya bisa dibandingkan bila acuan RAB-nya benar-benar ada
    // dan harga rencananya valid.
    comparable: rabPrice > 0 && (line.planned_unit_price_state === MONEY.OK || line.planned_unit_price_state === MONEY.ZERO)
  }
}

// ------------------------------------------------------------
// 5) DOKUMEN RAP
// ------------------------------------------------------------
export function createRapDraft(opts = {}) {
  const project = opts.project || null
  const rab = opts.rab || {}
  const lines = (opts.lines || []).map(normalizeLine)
  // Snapshot baris RAB DISIMPAN terpisah dari baris RAP. Ini yang membuat
  // perbandingan tetap jujur walau baris RAP dihapus/diedit.
  const rabLines = (opts.rabLines || opts.rab_lines || []).map(normalizeLine)
  const now = opts.now || new Date().toISOString()
  return {
    id: opts.id || 'rap-' + Date.now().toString(36),
    version: String(opts.version || 'RAP-01'),
    status: RAP_STATUS.DRAFT,
    project_id: project ? (project.id || null) : (opts.project_id || null),
    project_name: project ? (project.name || '') : (opts.project_name || ''),
    project_kode: project ? (project.kode || project.code || '') : (opts.project_kode || ''),
    rab_reff: String(rab.reff || rab.boqReff || opts.rab_reff || '').trim(),
    rab_revision: String(rab.revision || rab.revisionNumber || opts.rab_revision || '').trim(),
    rab_source: String(opts.rab_source || '').trim(),
    rab_price_unit: String(opts.rab_price_unit || '').trim(),
    // MANUAL_NO_RAB = penanda eksplisit bahwa material di luar RAB. Bukan
    // default: tanpa penanda ini, handoff material PR DIBLOKIR.
    rab_basis: String(opts.rab_basis || '').toUpperCase(),
    rab_lines: rabLines,
    note: String(opts.note || '').trim(),
    lines,
    history: [{ at: now, action: 'DIBUAT', status: RAP_STATUS.DRAFT, by: opts.by || '' }],
    created_at: now,
    updated_at: now,
    // Selalu eksplisit: draft ini belum pernah tersimpan di server.
    persisted: false,
    persistence: 'DRAFT_ONLY'
  }
}

export function touchRap(rap, patch = {}, now) {
  const at = now || new Date().toISOString()
  return { ...rap, ...patch, updated_at: at }
}

// ------------------------------------------------------------
// 6) SUMBER ACUAN: APA YANG SEBENARNYA DIBANDINGKAN
// ------------------------------------------------------------
export const BASELINE_KIND = {
  RAB_SELL_PRICE: 'RAB_SELL_PRICE',
  WBS_LABOR_ONLY: 'WBS_LABOR_ONLY',
  MANUAL: 'MANUAL',
  MIXED: 'MIXED',
  NONE: 'NONE'
}

// Menjelaskan SUMBER angka acuan secara eksplisit. Tidak pernah mengklaim
// "apel-vs-apel": tidak ada satu pun sumber acuan di aplikasi ini yang
// berupa BIAYA terverifikasi, jadi `comparable_with_rap_cost` selalu false
// kecuali kelak ada acuan biaya (kolom `cost_baseline` di masa depan).
export function describeRabBaseline(rap, rabLines = null) {
  const snapshot = Array.isArray(rabLines) && rabLines.length
    ? rabLines
    : ((rap && Array.isArray(rap.rab_lines) && rap.rab_lines.length) ? rap.rab_lines : null)
  // Fallback jujur: bila draft belum punya snapshot acuan, sumber acuan
  // dibaca dari baris rencana itu sendiri (bukan diklaim "tidak ada").
  const basisSource = snapshot || ((rap && Array.isArray(rap.lines)) ? rap.lines : [])
  const lines = (basisSource || []).map(normalizeLine)
  const priced = lines.filter(l => toNumber(l.rab_unit_price) > 0)
  const bases = []
  for (const l of priced) {
    const b = l.price_basis || basisFromPriceSource(l.price_source)
    if (bases.indexOf(b) < 0) bases.push(b)
  }
  const reff = String((rap && rap.rab_reff) || '').trim()
  const revision = String((rap && rap.rab_revision) || '').trim()
  const source = String((rap && rap.rab_source) || '').trim()

  let kind = BASELINE_KIND.NONE
  if (priced.length === 0) kind = BASELINE_KIND.NONE
  else if (bases.length === 1 && bases[0] === PRICE_BASIS.RAB_SELL_PRICE) kind = BASELINE_KIND.RAB_SELL_PRICE
  else if (bases.length === 1 && bases[0] === PRICE_BASIS.WBS_LABOR_ONLY) kind = BASELINE_KIND.WBS_LABOR_ONLY
  else if (bases.length === 1 && bases[0] === PRICE_BASIS.MANUAL) kind = BASELINE_KIND.MANUAL
  else kind = BASELINE_KIND.MIXED

  const table = {
    RAB_SELL_PRICE: {
      label: 'HARGA JUAL RAB & BOQ (penawaran)',
      note: 'Angka RAB & BOQ adalah HARGA JUAL penawaran (sudah mengandung margin), sedangkan RAP adalah BIAYA PELAKSANAAN. Selisih di bawah = indikasi margin, BUKAN perbandingan biaya-vs-biaya (bukan apel-vs-apel).'
    },
    WBS_LABOR_ONLY: {
      label: 'WBS Budgeting — UPAH saja',
      note: 'WBS hanya menyimpan estimasi upah; tidak ada komponen material. Total acuan BUKAN nilai pekerjaan penuh dan tidak sebanding dengan biaya material RAP.'
    },
    MANUAL: {
      label: 'Manual (tanpa acuan RAB)',
      note: 'Baris diisi manual tanpa acuan RAB — tidak ada pembanding; selisih tidak diketahui.'
    },
    MIXED: {
      label: 'Campuran / sumber tidak seragam',
      note: 'Sebagian baris bercampur sumber (harga jual RAB + upah + manual). Total acuan TIDAK sebanding; periksa per baris.'
    },
    NONE: {
      label: 'Tidak ada acuan',
      note: 'Tidak ada harga acuan yang bisa dipakai — selisih TIDAK DIKETAHUI (bukan nol, bukan "aman").'
    }
  }
  const meta = table[kind]
  return {
    kind,
    label: meta.label,
    note: meta.note,
    // Tidak ada acuan BIAYA terverifikasi di aplikasi ini.
    comparable_with_rap_cost: false,
    cost_baseline_available: false,
    verified_source: !!reff,
    reff,
    revision,
    source,
    lineCount: lines.length,
    pricedLineCount: priced.length,
    bases
  }
}

export function rapTotals(rap, rabLines = null) {
  const lines = (rap && rap.lines) || []
  let rabFromLines = 0
  let rapTotal = 0
  let overCount = 0
  let zeroPrice = 0
  let missingPrice = 0
  let invalidPrice = 0
  let incomparable = 0
  for (const line of lines) {
    const a = lineAmounts(line)
    rabFromLines += a.rabAmount
    rapTotal += a.rapAmount
    if (a.state === 'OVER') overCount += 1
    if (!a.comparable) incomparable += 1
    const state = line.planned_unit_price_state
    if (state === MONEY.ZERO) zeroPrice += 1
    else if (state === MONEY.MISSING) missingPrice += 1
    else if (state === MONEY.NEGATIVE || state === MONEY.NOT_NUMBER) invalidPrice += 1
  }
  // Nilai acuan RAB: pakai SNAPSHOT baris RAB (rap.rab_lines) bila ada —
  // supaya baris RAB yang dihapus dari RAP tidak membuat "acuan" ikut
  // menyusut (kalau menyusut, selisih terlihat lebih kecil dari kenyataan).
  const snapshot = Array.isArray(rabLines) && rabLines.length
    ? rabLines
    : (rap && Array.isArray(rap.rab_lines) && rap.rab_lines.length ? rap.rab_lines : null)
  let rabTotal = rabFromLines
  if (snapshot) {
    rabTotal = snapshot.reduce((sum, line) => sum + lineAmounts(line).rabAmount, 0)
  }
  const diffAmount = rapTotal - rabTotal
  const diffPct = rabTotal > 0 ? Math.round((diffAmount / rabTotal) * 1000) / 10 : null
  const baseline = describeRabBaseline(rap, snapshot)
  return {
    lineCount: lines.length,
    rabTotal,
    rabFromLines,
    rapTotal,
    diffAmount,
    diffPct,
    overCount,
    zeroPrice,
    missingPrice,
    invalidPrice,
    incomparable,
    // true bila rencana pelaksanaan lebih mahal dari ACUAN (harga jual RAB).
    // TANPA acuan RAB (rabTotal 0) tidak boleh diklaim over budget — tidak ada
    // pembanding, jadi selisihnya "tidak diketahui", bukan "lebih".
    overBudget: rabTotal > 0 && diffAmount > 0,
    overBudgetAgainst: baseline.kind,
    overBudgetMeaning: 'Rencana biaya RAP lebih tinggi dari harga jual RAB — indikasi margin habis/negatif, bukan perbandingan biaya-vs-biaya.',
    hasRabBaseline: rabTotal > 0,
    baseline
  }
}

// ------------------------------------------------------------
// 7) PERBANDINGAN RAP vs RAB
// ------------------------------------------------------------
// `rabLines` = baris acuan dari RAB (lihat budgetingBridge.rabLinesFromPayload).
// Yang dideteksi: baris RAB yang HILANG di RAP (pekerjaan terlewat) dan
// baris RAP yang TIDAK ADA di RAB (pekerjaan tambahan di luar kontrak).
export function compareRapToRab(rap, rabLines = null) {
  const rapLines = ((rap && rap.lines) || []).map(normalizeLine)
  // Sumber acuan: parameter eksplisit, atau snapshot `rap.rab_lines`.
  const source = Array.isArray(rabLines) && rabLines.length
    ? rabLines
    : ((rap && Array.isArray(rap.rab_lines)) ? rap.rab_lines : [])
  const rab = (source || []).map(normalizeLine)
  const rapByKey = new Map()
  for (const line of rapLines) {
    // duplikat: yang pertama menang, sisanya dicatat sebagai duplikat
    if (!rapByKey.has(line.key)) rapByKey.set(line.key, line)
  }
  const rabByKey = new Map()
  for (const line of rab) if (!rabByKey.has(line.key)) rabByKey.set(line.key, line)

  const rows = rapLines.map(line => {
    const rabLine = rabByKey.get(line.key) || null
    const amounts = lineAmounts(line)
    return {
      key: line.key,
      item_name: line.item_name,
      unit: line.unit,
      line_kind: line.line_kind,
      inRab: !!rabLine,
      rabAmount: amounts.rabAmount,
      rapAmount: amounts.rapAmount,
      diffAmount: amounts.diffAmount,
      diffPct: amounts.diffPct,
      qtyDiff: amounts.qtyDiff,
      priceDiff: amounts.priceDiff,
      state: amounts.state,
      comparable: amounts.comparable && !!rabLine,
      price_state: line.planned_unit_price_state
    }
  })

  const missingInRap = rab.filter(line => !rapByKey.has(line.key)).map(line => {
    const a = lineAmounts(line)
    return { key: line.key, item_name: line.item_name, unit: line.unit, rabAmount: a.rabAmount, rapAmount: 0, diffAmount: -a.rabAmount }
  })
  const extraInRap = rows.filter(r => !r.inRab)

  const totals = rapTotals(rap, rab)
  return {
    rows,
    missingInRap,
    extraInRap,
    totals,
    // Label sumber: WAJIB ditampilkan UI. Tidak ada klaim "apel-vs-apel".
    baseline: totals.baseline,
    rabLineCount: rab.length,
    rapLineCount: rapLines.length,
    // "selisih" selalu dilaporkan sebagai angka rupiah + persen, tidak pernah
    // diklaim sebagai realisasi biaya.
    summary: {
      rabTotal: totals.rabTotal,
      rapTotal: totals.rapTotal,
      diffAmount: totals.diffAmount,
      diffPct: totals.diffPct,
      overBudget: totals.overBudget,
      overCount: totals.overCount,
      missingCount: missingInRap.length,
      extraCount: extraInRap.length,
      incomparableCount: totals.incomparable,
      baselineKind: totals.baseline.kind
    }
  }
}

// ------------------------------------------------------------
// 8) KESIAPAN MATERIAL (untuk PR) — informasi, bukan tebakan
// ------------------------------------------------------------
export function materialReadiness(rap) {
  const lines = ((rap && rap.lines) || []).map(normalizeLine)
  const counts = { material: 0, work_item: 0, labor: 0, unspecified: 0 }
  let withMaterialId = 0
  for (const l of lines) {
    if (l.line_kind === LINE_KIND.MATERIAL) counts.material += 1
    else if (l.line_kind === LINE_KIND.WORK_ITEM) counts.work_item += 1
    else if (l.line_kind === LINE_KIND.LABOR) counts.labor += 1
    else counts.unspecified += 1
    if (l.material_id) withMaterialId += 1
  }
  const nonMaterial = counts.work_item + counts.labor + counts.unspecified
  return {
    lineCount: lines.length,
    ...counts,
    with_material_id: withMaterialId,
    non_material: nonMaterial,
    // Semua baris material baku DAN tertaut master material = siap diverifikasi
    // lebih lanjut oleh buildPrHandoff (yang juga memeriksa satuan & harga).
    structurally_ready: lines.length > 0 && nonMaterial === 0 && withMaterialId === lines.length,
    note: nonMaterial > 0
      ? `${nonMaterial} baris BUKAN material baku (pekerjaan/upah/belum ditandai) — baris itu tidak bisa masuk PR material dan tidak dipecah otomatis.`
      : 'Semua baris ditandai material baku dan punya material_id.'
  }
}

// ------------------------------------------------------------
// 9) VALIDASI
// ------------------------------------------------------------
// problems = MEMBLOKIR (tidak boleh diajukan/di-handoff ke PR)
// warnings = INFORMASI (boleh lanjut, tapi UI wajib menampilkan)
export function validateRap(rap) {
  const problems = []
  const warnings = []
  if (!rap) return { ok: false, problems: ['Dokumen RAP belum ada.'], warnings }

  const version = String(rap.version || '').trim()
  if (!version) problems.push('Label versi RAP wajib diisi (mis. RAP-01).')
  if (!String(rap.rab_reff || '').trim()) warnings.push('Referensi RAB belum diisi — perbandingan RAB vs RAP tidak bisa diverifikasi.')
  if (!String(rap.project_id || rap.project_name || '').trim()) problems.push('Proyek wajib dipilih.')

  const lines = rap.lines || []
  if (!lines.length) problems.push('RAP belum punya baris pekerjaan.')

  const seen = new Map()
  lines.forEach((rawLine, idx) => {
    const line = normalizeLine(rawLine)
    const label = line.item_name || `baris ${idx + 1}`
    if (!line.item_name) problems.push(`Baris ${idx + 1}: nama pekerjaan wajib diisi.`)
    if (seen.has(line.key)) {
      problems.push(`Baris "${label}" (${line.unit || 'tanpa satuan'}) muncul lebih dari sekali — gabungkan supaya tidak dobel hitung.`)
    } else {
      seen.set(line.key, true)
    }

    // Qty rencana — kosong/negatif/bukan angka adalah PENGHALANG, bukan 0.
    const qtyState = line.planned_qty_state
    if (qtyState === MONEY.MISSING) problems.push(`Qty rencana "${label}" kosong — isi angka lebih dari 0 (kosong bukan 0).`)
    else if (qtyState === MONEY.NEGATIVE) problems.push(`Qty rencana "${label}" negatif (${String(line.planned_qty_raw)}) — nilai negatif ditolak, bukan dijadikan 0.`)
    else if (qtyState === MONEY.NOT_NUMBER) problems.push(`Qty rencana "${label}" bukan angka ("${String(line.planned_qty_raw)}").`)
    else if (qtyState === MONEY.ZERO) problems.push(`Qty rencana "${label}" harus angka lebih dari 0.`)

    // Harga rencana — diperiksa dari NILAI MENTAH sebelum koersi apa pun.
    const priceState = line.planned_unit_price_state
    if (priceState === MONEY.MISSING) problems.push(`Harga satuan rencana "${label}" kosong — isi angka 0 atau lebih (kosong BUKAN nol).`)
    else if (priceState === MONEY.NEGATIVE) problems.push(`Harga satuan rencana "${label}" negatif (${String(line.planned_unit_price_raw)}) — nilai negatif DITOLAK, tidak dijadikan 0.`)
    else if (priceState === MONEY.NOT_NUMBER) problems.push(`Harga satuan rencana "${label}" bukan angka ("${String(line.planned_unit_price_raw)}").`)
    else if (priceState === MONEY.ZERO) warnings.push(`Harga satuan rencana "${label}" masih 0 — anggaran baris ini belum lengkap.`)

    // Harga acuan RAB — nilai tidak valid tidak boleh diam-diam jadi 0.
    if (line.rab_unit_price_state === MONEY.NEGATIVE || line.rab_unit_price_state === MONEY.NOT_NUMBER) {
      warnings.push(`Harga RAB "${label}" tidak valid (${String(line.rab_unit_price_raw)}) — baris ini TIDAK bisa dibandingkan dengan RAB.`)
    } else if (toNumber(line.rab_unit_price) === 0) {
      warnings.push(`Harga RAB "${label}" tidak tersedia — selisih vs RAB tidak bisa dihitung untuk baris ini.`)
    }
  })

  const totals = rapTotals(rap)
  if (totals.overBudget) {
    warnings.push(`Total RAP ${formatRupiah(totals.rapTotal)} MELEBIHI ${totals.baseline.label} ${formatRupiah(totals.rabTotal)} (${totals.diffPct}%) — ${totals.baseline.kind === BASELINE_KIND.RAB_SELL_PRICE ? 'margin habis/negatif, perlu persetujuan' : 'acuan bukan biaya, jadi ini bukan perbandingan apel-vs-apel'}.`)
  }
  return {
    ok: problems.length === 0,
    problems,
    warnings,
    totals,
    // informasi sumber acuan + kesiapan material (bukan warning supaya
    // draft yang sah tidak dipenuhi peringatan yang sama terus-menerus)
    baseline: totals.baseline,
    material: materialReadiness(rap)
  }
}

export function setRapStatus(rap, to, opts = {}) {
  const target = String(to || '').toUpperCase()
  const problem = transitionProblem(rap && rap.status, target)
  if (problem) return { ok: false, rap, problem }
  const at = opts.now || new Date().toISOString()
  const next = {
    ...rap,
    status: target,
    updated_at: at,
    history: [
      ...((rap && rap.history) || []),
      { at, action: target, status: target, by: opts.by || '', note: opts.note || '' }
    ]
  }
  return { ok: true, rap: next, problem: null }
}

// ------------------------------------------------------------
// 10) KONTRAK HANDOFF KE PURCHASE REQUEST (BERGERBANG BOM)
// ------------------------------------------------------------
// BENTUK PAYLOAD HARUS SAMA dengan jalur simpan PR yang sudah ada
// (modules/requests/save.js): purchase_requests {project_id, title, pr_number,
// priority, status, materials_summary, notes} + pr_items {pr_id, material_id,
// item_name, kode, unit, quantity, status, supplier_category, vendor_id,
// estimated_price, sort_order}. Nomor PR TIDAK dibuat di sini — diambil dari
// RPC next_pr_number oleh modul PR saat benar-benar menyimpan.
//
// `pr_id` TIDAK ada di payload handoff: nilainya baru ada SETELAH PR disimpan
// (id baris purchase_requests). Ia diisi modul PR, bukan dikarang di sini.
//
// GERBANG (t_3b877fb5): PR ini adalah PR MATERIAL. Baris hanya boleh masuk
// bila SEMUA benar:
//   1. line_kind === MATERIAL (ditandai manusia, bukan ditebak dari nama)
//   2. material_id terisi DAN ada di katalog master material (terverifikasi)
//   3. satuan baris SAMA dengan satuan master (tanpa konversi karangan)
//   4. qty angka > 0 (tanpa koersi)
//   5. harga: terisi, bukan negatif, bukan bukan-angka; 0 boleh = belum lengkap
//   6. harga tidak ~1000x acuan master (indikasi salah skala ribuan/rupiah)
// Selain itu: acuan RAB harus ada, KECUALI draft ditandai eksplisit
// `rab_basis = 'MANUAL_NO_RAB'`.
export const PR_REQUEST_FIELDS = ['project_id', 'title', 'pr_number', 'priority', 'status', 'materials_summary', 'notes']
export const PR_ITEM_FIELDS = ['pr_id', 'material_id', 'item_name', 'kode', 'unit', 'quantity', 'status', 'supplier_category', 'vendor_id', 'estimated_price', 'sort_order']
export const PR_ITEM_FIELDS_FROM_TARGET = ['pr_id']
export const PR_ITEM_PAYLOAD_FIELDS = PR_ITEM_FIELDS.filter(f => PR_ITEM_FIELDS_FROM_TARGET.indexOf(f) < 0)

// Eksplisit: handoff ini BUKAN alokasi resmi & BUKAN persetujuan.
export const PR_HANDOFF_APPROVAL = 'NONE'
export const PR_HANDOFF_BASIS = 'RAP_DRAFT'
export const PR_HANDOFF_LABEL = 'Pratinjau payload — DRAFT, BUKAN alokasi resmi, 0 tulisan DB'

const SCALE_BLOCK_RATIO = 500 // >= 500x acuan master = hampir pasti salah skala
const SCALE_WARN_RATIO = 10   // >= 10x = perlu diperiksa

function catalogIndex(materials) {
  const map = new Map()
  if (!Array.isArray(materials)) return null
  for (const m of materials) {
    if (m && m.id !== null && m.id !== undefined) map.set(String(m.id), m)
  }
  return map
}

export function masterUnit(m) {
  return String((m && (m.satuan == null ? m.unit : m.satuan)) == null ? '' : (m.satuan == null ? m.unit : m.satuan)).trim()
}

export function masterName(m) {
  return String((m && (m.name || m.nama)) || '').trim()
}

export function masterKode(m) {
  return String((m && (m.kode || m.code)) || '').trim()
}

export function buildPrHandoff(rap, opts = {}) {
  const problems = []
  const warnings = []
  const projectId = opts.project_id || (rap && rap.project_id) || null
  if (!projectId) problems.push('RAP belum terhubung ke proyek — PR wajib punya project_id.')

  const materials = Array.isArray(opts.materials) ? opts.materials : (Array.isArray(opts.catalog) ? opts.catalog : null)
  const byId = catalogIndex(materials)
  if (!byId) {
    problems.push('Katalog master material belum dimuat — material_id, satuan, dan skala harga TIDAK bisa diverifikasi. Muat katalog material (baca-saja) lalu susun ulang payload.')
  }

  // --- acuan RAB -------------------------------------------------
  const baseline = describeRabBaseline(rap)
  const rabBasisOverride = String((rap && rap.rab_basis) || opts.rab_basis || '').toUpperCase()
  const manualNoRab = rabBasisOverride === 'MANUAL_NO_RAB'
  // Acuan dianggap ADA hanya bila ada identitas RAB yang bisa diperiksa
  // (reff/revisi). Harga manual tanpa RAB tidak boleh menyamar sebagai acuan.
  const hasApprovedSource = !!baseline.verified_source
  if (!hasApprovedSource && !manualNoRab) {
    problems.push('Acuan RAB yang disetujui belum ada (reff/revisi kosong) — handoff material PR tidak boleh mengklaim berbasis RAB. Lampirkan/tempel RAB yang disetujui, atau tandai draft "tanpa acuan RAB" secara eksplisit bila material memang di luar RAB.')
  } else if (manualNoRab) {
    warnings.push('Draft ditandai TANPA ACUAN RAB — PR ini tidak berbasis RAB dan tidak boleh disebut alokasi resmi RAB.')
  }
  if (baseline.kind === BASELINE_KIND.NONE && !manualNoRab) {
    problems.push('Tidak ada harga acuan sama sekali — total rencana tidak bisa diverifikasi terhadap RAB. Isi acuan RAB lebih dulu.')
  }
  if (baseline.kind === BASELINE_KIND.WBS_LABOR_ONLY) {
    warnings.push('Acuan hanya UPAH (WBS) — angka upah TIDAK dipakai sebagai harga material.')
  }
  if (baseline.kind === BASELINE_KIND.MIXED) {
    warnings.push('Acuan RAB bercampur sumber (harga jual + upah + manual) — total acuan tidak sebanding; periksa per baris.')
  }

  const selectedIds = Array.isArray(opts.line_ids) ? opts.line_ids : null
  const lines = ((rap && rap.lines) || []).filter(line => {
    if (!selectedIds) return true
    return selectedIds.indexOf(line.id) >= 0 || selectedIds.indexOf(line.key) >= 0
  })
  if (!lines.length) problems.push('Tidak ada baris RAP yang dipilih untuk dibuatkan PR.')

  const items = []
  let rejected = 0
  let verified = 0

  // Tanpa katalog, TIDAK ADA baris yang bisa diverifikasi — payload tidak
  // disusun sama sekali (tidak ada item "lolos" tanpa verifikasi). Baris tetap
  // diperiksa supaya alasan per baris (mis. jenis bukan material) tetap terlihat.
  lines.forEach((rawLine, idx) => {
    const line = normalizeLine(rawLine)
    const label = line.item_name || `baris ${idx + 1}`
    const kindLabel = LINE_KIND_LABEL[line.line_kind] || line.line_kind

    // 1) GERBANG JENIS BARIS — tidak ada heuristik nama barang.
    if (line.line_kind !== LINE_KIND.MATERIAL) {
      rejected += 1
      problems.push(`Baris "${label}" bertipe "${kindLabel}" — PR MATERIAL hanya menerima baris MATERIAL BAKU (BOM). Pecah pekerjaan/upah/barang jadi ini menjadi baris material baku (material_id + satuan + qty) dari gambar kerja/BOM; RAP tidak memecah otomatis dan tidak menebak material dari nama barang.`)
      return
    }

    // 2) material_id wajib + terverifikasi ke master.
    if (!line.material_id) {
      rejected += 1
      problems.push(`Baris "${label}" belum tertaut master material (material_id kosong). Pilih material baku di master — nama pekerjaan TIDAK dipakai untuk menebak material.`)
      return
    }
    if (!byId) {
      // Katalog belum dimuat: TIDAK ADA verifikasi yang mungkin. Penghalang
      // global sudah dicatat di atas; baris tidak boleh lolos diam-diam.
      rejected += 1
      return
    }
    const master = byId.get(String(line.material_id)) || null
    if (!master) {
      rejected += 1
      problems.push(`material_id "${String(line.material_id)}" pada baris "${label}" tidak ditemukan di master material — tautan tidak terverifikasi.`)
      return
    }

    // 3) satuan wajib & harus sama dengan master (tanpa konversi karangan).
    if (!line.unit) {
      rejected += 1
      problems.push(`Satuan baris "${label}" kosong — PR material wajib punya satuan.`)
      return
    }
    if (master) {
      const mu = masterUnit(master)
      if (!mu) {
        rejected += 1
        problems.push(`Master material untuk "${label}" belum punya satuan — satuan tidak bisa diverifikasi.`)
        return
      }
      if (mu.toLowerCase() !== line.unit.toLowerCase()) {
        rejected += 1
        problems.push(`Satuan baris "${label}" ("${line.unit}") BEDA dengan satuan master material ("${mu}"). Konversi satuan tidak dikarang — samakan satuannya atau pakai material yang tepat.`)
        return
      }
    }

    // 4) qty — angka > 0, tanpa koersi.
    if (line.planned_qty_state === MONEY.MISSING) {
      rejected += 1
      problems.push(`Qty rencana "${label}" kosong — isi angka lebih dari 0 (kosong bukan 0).`)
      return
    }
    if (line.planned_qty_state === MONEY.NEGATIVE || line.planned_qty_state === MONEY.NOT_NUMBER) {
      rejected += 1
      problems.push(`Qty rencana "${label}" tidak valid ("${String(line.planned_qty_raw)}") — ditolak, bukan diubah jadi 1.`)
      return
    }
    const qty = toNumber(line.planned_qty)
    if (qty === null || qty <= 0) {
      rejected += 1
      problems.push(`Qty rencana "${label}" harus angka lebih dari 0.`)
      return
    }

    // 5) harga — diperiksa dari nilai MENTAH; negatif/bukan angka DITOLAK.
    if (line.planned_unit_price_state === MONEY.MISSING) {
      rejected += 1
      problems.push(`Harga rencana "${label}" kosong — kosong BUKAN nol; isi harga atau tandai baris belum lengkap secara eksplisit.`)
      return
    }
    if (line.planned_unit_price_state === MONEY.NEGATIVE) {
      rejected += 1
      problems.push(`Harga rencana "${label}" negatif (${String(line.planned_unit_price_raw)}) — DITOLAK dan TIDAK dijadikan 0.`)
      return
    }
    if (line.planned_unit_price_state === MONEY.NOT_NUMBER) {
      rejected += 1
      problems.push(`Harga rencana "${label}" bukan angka ("${String(line.planned_unit_price_raw)}").`)
      return
    }
    const price = toNumber(line.planned_unit_price)
    if (price === null || price < 0) {
      rejected += 1
      problems.push(`Harga rencana "${label}" tidak valid untuk PR.`)
      return
    }
    if (line.planned_unit_price_state === MONEY.ZERO) {
      warnings.push(`Harga rencana "${label}" masih 0 — item masuk PR tanpa estimasi harga dan ditandai BELUM LENGKAP.`)
    }

    // 6) skala harga vs acuan master (indikasi ribuan vs rupiah).
    const masterPrice = toNumber(master && master.harga_acuan)
    if (masterPrice !== null && masterPrice > 0 && price > 0) {
      const ratio = price / masterPrice
      if (ratio >= SCALE_BLOCK_RATIO) {
        rejected += 1
        problems.push(`Harga "${label}" ${formatRupiah(price)} ≈ ${Math.round(ratio)}× acuan master ${formatRupiah(masterPrice)} — kemungkinan SALAH SKALA (ribuan vs rupiah). Perbaiki harga sebelum handoff.`)
        return
      }
      if (ratio >= SCALE_WARN_RATIO) {
        warnings.push(`Harga "${label}" ${formatRupiah(price)} ≈ ${Math.round(ratio)}× acuan master ${formatRupiah(masterPrice)} — periksa apakah skala harga benar.`)
      }
    }

    // Nama: pakai nama MASTER (otoritatif). Bila berbeda, beri peringatan —
    // supaya nama pekerjaan jadi tidak menyelinap ke PR material.
    const mName = master ? masterName(master) : ''
    if (mName && line.item_name && mName.toLowerCase() !== line.item_name.toLowerCase()) {
      warnings.push(`Nama baris "${line.item_name}" berbeda dari master material "${mName}" — payload memakai nama master.`)
    }
    verified += 1
    items.push({
      material_id: line.material_id,
      item_name: mName || line.item_name,
      kode: (master && masterKode(master)) || line.kode || '',
      unit: master ? (masterUnit(master) || line.unit) : line.unit,
      quantity: qty,
      status: 'PENDING_APPROVAL',
      supplier_category: null,
      vendor_id: null,
      estimated_price: roundRupiah(price),
      sort_order: idx
    })
  })

  const totals = rapTotals(rap)
  const summary = items.map(it => `${it.quantity} ${it.unit || ''} ${it.item_name}`.replace(/\s+/g, ' ').trim()).join(', ')
  const projectLabel = rap && (rap.project_kode ? `[${rap.project_kode}] ${rap.project_name}` : rap.project_name)
  const basisText = manualNoRab ? 'TANPA acuan RAB (ditandai manual)' : baseline.label
  const request = {
    project_id: projectId,
    title: opts.title || `Material RAP ${rap ? rap.version : ''}`.trim(),
    // nomor PR = null: diisi RPC next_pr_number di modul PR (bukan di sini).
    pr_number: null,
    priority: opts.priority || 'NORMAL',
    status: 'DRAFT',
    materials_summary: summary || '—',
    notes: `Dari RAP ${rap ? rap.version : '—'}${rap && rap.rab_reff ? ` (RAB ${rap.rab_reff}${rap.rab_revision ? ` ${rap.rab_revision}` : ''})` : ''}${projectLabel ? ` — ${projectLabel}` : ''}. `
      + `Ini PRATINJAU alokasi DRAFT, BUKAN alokasi resmi/persetujuan — PR tetap berstatus DRAFT dan wajib melalui persetujuan PR. `
      + `Basis acuan: ${basisText}. Qty & harga masih RENCANA (bukan realisasi), harga satuan material murni tanpa ongkir/admin.`
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    // FAIL-CLOSED: bila ada satu saja penghalang, payload TIDAK disusun sama
    // sekali (items kosong, request null). Tidak ada "sebagian item" yang bisa
    // dipakai tanpa sengaja oleh pemanggil. Baris yang lolos gerbang tetap
    // dilaporkan di `gate.verified_items` untuk transparansi pratinjau.
    request: problems.length === 0 ? request : null,
    items: problems.length === 0 ? items : [],
    gate: {
      selected: lines.length,
      verified,
      // tanpa katalog, semua baris dianggap belum terverifikasi (ditolak)
      rejected: byId ? rejected : lines.length,
      catalog_loaded: !!byId,
      catalog_size: materials ? materials.length : 0,
      verified_items: items,
      blocked: problems.length > 0
    },
    baseline,
    meta: {
      rap_version: rap ? rap.version : null,
      rap_status: rap ? rap.status : null,
      // Status RAP hanya label lokal sesi ini (DRAFT_ONLY) — BUKAN approval.
      rap_status_official: false,
      approval: PR_HANDOFF_APPROVAL,
      approval_note: 'RAP ini draft lokal (DRAFT_ONLY, belum tersimpan di server). Status RAP — termasuk "Disetujui" — BUKAN persetujuan resmi; PR yang disusun tetap DRAFT dan wajib approval PR.',
      handoff_basis: PR_HANDOFF_BASIS,
      rab_reff: rap ? rap.rab_reff : null,
      rab_revision: rap ? rap.rab_revision : null,
      rab_basis: manualNoRab ? 'MANUAL_NO_RAB' : baseline.kind,
      rab_basis_label: manualNoRab ? 'Tanpa acuan RAB (manual)' : baseline.label,
      rab_comparable_with_rap_cost: false,
      planned_total: totals.rapTotal,
      // Eksplisit: fungsi ini hanya MENYUSUN payload, tidak menulis apa pun.
      writes: 0,
      delivered: false
    }
  }
}

// ------------------------------------------------------------
// 11) SNAPSHOT JSON (backup manual — bukan persistence)
// ------------------------------------------------------------
export const RAP_SNAPSHOT_VERSION = 1

export function rapToSnapshot(rap) {
  return {
    version: RAP_SNAPSHOT_VERSION,
    kind: 'rap-draft',
    savedToServer: false,
    exportedAt: new Date().toISOString(),
    rap: {
      ...rap,
      lines: ((rap && rap.lines) || []).map(normalizeLine)
    }
  }
}

export function rapFromSnapshot(json) {
  const data = typeof json === 'string' ? safeParse(json) : json
  if (!data || typeof data !== 'object') return { ok: false, problem: 'Berkas RAP tidak terbaca (bukan JSON objek).' }
  if (data.kind && data.kind !== 'rap-draft') return { ok: false, problem: `Jenis berkas "${data.kind}" bukan draft RAP.` }
  const rap = data.rap || data
  if (!rap || !Array.isArray(rap.lines)) return { ok: false, problem: 'Draft RAP tidak punya daftar baris.' }
  const restored = {
    ...rap,
    version: String(rap.version || 'RAP-01'),
    status: RAP_STATUS[String(rap.status || '').toUpperCase()] ? String(rap.status).toUpperCase() : RAP_STATUS.DRAFT,
    lines: rap.lines.map(normalizeLine),
    // Draft hasil impor tetap BELUM tersimpan di server — jangan pernah
    // mengaku sebaliknya hanya karena JSON-nya ada.
    persisted: false,
    persistence: 'DRAFT_ONLY'
  }
  return { ok: true, rap: restored, problem: null }
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch (e) {
    return null
  }
}
