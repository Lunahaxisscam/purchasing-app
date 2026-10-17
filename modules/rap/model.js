// ============================================================
// modules/rap/model.js — LOGIKA MURNI RAP (Rencana Anggaran Pelaksana)
// ============================================================
// t_71d95cfe (S3/7). RAP = anggaran PELAKSANAAN internal (rencana qty &
// harga satuan versi tim sendiri) yang diturunkan dari RAB/BOQ yang sudah
// ada. File ini SENGAJA bebas React, bebas browser API, dan bebas Supabase
// supaya bisa diuji langsung oleh harness Node (scripts/rap-test).
//
// BATAS TANGGUNG JAWAB (jujur):
//   * Modul ini TIDAK menulis DB. Tidak ada tabel `rap_versions` (freeze
//     migrasi) — lihat store.js: mode DRAFT_ONLY.
//   * Modul ini TIDAK menghitung markup/PPN RAB. Perbandingan RAB vs RAP
//     memakai NILAI DASAR baris (qty × harga satuan), supaya apel-vs-apel:
//     RAP adalah biaya pelaksanaan, bukan harga jual ke klien.
//   * Modul ini TIDAK mengirim PR. Ia hanya MENYUSUN payload PR (kontrak
//     handoff) yang bentuknya sama dengan jalur simpan PR yang sudah ada
//     (modules/requests/save.js).
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
// 2) ANGKA & UANG
// ------------------------------------------------------------
// Harga RAB (payload BOQ) bersatuan RIBUAN rupiah (000). RAP memakai
// rupiah penuh. Konversi ini SATU-SATUNYA tempat perkalian 1000 terjadi.
export const RAB_PRICE_UNIT = 1000

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// String angka dari input (boleh "1.200.000" / "1,5") -> number.
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

export function rabPriceToRupiah(priceThousand) {
  const n = toNumber(priceThousand)
  if (n === null) return 0
  return Math.round(Math.max(0, n) * RAB_PRICE_UNIT)
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
// 3) BARIS RAP
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
export function normalizeLine(raw = {}) {
  const itemName = String(raw.item_name == null ? (raw.item || '') : raw.item_name).trim()
  const unit = String(raw.unit == null ? '' : raw.unit).trim()
  const rabQty = toNumber(raw.rab_qty)
  const rabPrice = toNumber(raw.rab_unit_price)
  const plannedQty = toNumber(raw.planned_qty)
  const plannedPrice = toNumber(raw.planned_unit_price)
  return {
    id: raw.id || newLineId(),
    key: lineKey(itemName, unit),
    item_name: itemName,
    unit,
    area: String(raw.area == null ? '' : raw.area).trim(),
    specs: String(raw.specs == null ? '' : raw.specs).trim(),
    material_id: raw.material_id || null,
    kode: String(raw.kode == null ? '' : raw.kode).trim(),
    rab_qty: rabQty === null ? 0 : rabQty,
    rab_unit_price: rabPrice === null ? 0 : Math.max(0, roundRupiah(rabPrice)),
    planned_qty: plannedQty === null ? (rabQty === null ? 0 : rabQty) : plannedQty,
    planned_unit_price: plannedPrice === null
      ? (rabPrice === null ? 0 : Math.max(0, roundRupiah(rabPrice)))
      : Math.max(0, roundRupiah(plannedPrice)),
    // dari mana harga RAB baris ini berasal (RAB / WBS / MANUAL) — dipakai UI
    // untuk jujur soal kelengkapan, bukan untuk mengklaim angka.
    price_source: raw.price_source || 'RAB'
  }
}

export function lineAmounts(line) {
  const rabQty = toNumber(line.rab_qty) || 0
  const rabPrice = toNumber(line.rab_unit_price) || 0
  const plannedQty = toNumber(line.planned_qty) || 0
  const plannedPrice = toNumber(line.planned_unit_price) || 0
  const rabAmount = roundRupiah(rabQty * rabPrice)
  const rapAmount = roundRupiah(plannedQty * plannedPrice)
  const diffAmount = rapAmount - rabAmount
  const diffPct = rabAmount > 0 ? Math.round((diffAmount / rabAmount) * 1000) / 10 : null
  const qtyDiff = Math.round((plannedQty - rabQty) * 1000) / 1000
  const priceDiff = roundRupiah(plannedPrice - rabPrice)
  const state = diffAmount > 0 ? 'OVER' : (diffAmount < 0 ? 'UNDER' : 'SAME')
  return { rabAmount, rapAmount, diffAmount, diffPct, qtyDiff, priceDiff, state }
}

// ------------------------------------------------------------
// 4) DOKUMEN RAP
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

export function rapTotals(rap, rabLines = null) {
  const lines = (rap && rap.lines) || []
  let rabFromLines = 0
  let rapTotal = 0
  let overCount = 0
  let zeroPrice = 0
  for (const line of lines) {
    const a = lineAmounts(line)
    rabFromLines += a.rabAmount
    rapTotal += a.rapAmount
    if (a.state === 'OVER') overCount += 1
    if (!(toNumber(line.planned_unit_price) > 0)) zeroPrice += 1
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
  return {
    lineCount: lines.length,
    rabTotal,
    rabFromLines,
    rapTotal,
    diffAmount,
    diffPct,
    overCount,
    zeroPrice,
    // true bila rencana pelaksanaan lebih mahal dari RAB (indikasi bocor
    // margin). TANPA acuan RAB (rabTotal 0) tidak boleh diklaim over budget —
    // tidak ada pembanding, jadi selisihnya "tidak diketahui", bukan "lebih".
    overBudget: rabTotal > 0 && diffAmount > 0,
    hasRabBaseline: rabTotal > 0
  }
}

// ------------------------------------------------------------
// 5) PERBANDINGAN RAP vs RAB
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
      inRab: !!rabLine,
      rabAmount: amounts.rabAmount,
      rapAmount: amounts.rapAmount,
      diffAmount: amounts.diffAmount,
      diffPct: amounts.diffPct,
      qtyDiff: amounts.qtyDiff,
      priceDiff: amounts.priceDiff,
      state: amounts.state
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
      extraCount: extraInRap.length
    }
  }
}

// ------------------------------------------------------------
// 6) VALIDASI
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
    const qty = toNumber(line.planned_qty)
    if (qty === null || qty <= 0) problems.push(`Qty rencana "${label}" harus angka lebih dari 0.`)
    const price = toNumber(line.planned_unit_price)
    if (price === null || price < 0) problems.push(`Harga satuan rencana "${label}" harus angka 0 atau lebih.`)
    else if (price === 0) warnings.push(`Harga satuan rencana "${label}" masih 0 — anggaran baris ini belum lengkap.`)
    if (toNumber(line.rab_unit_price) === 0) warnings.push(`Harga RAB "${label}" tidak tersedia — selisih vs RAB tidak bisa dihitung untuk baris ini.`)
  })

  const totals = rapTotals(rap)
  if (totals.overBudget) {
    warnings.push(`Total RAP ${formatRupiah(totals.rapTotal)} MELEBIHI nilai RAB ${formatRupiah(totals.rabTotal)} (${totals.diffPct}%) — perlu persetujuan.`)
  }
  return { ok: problems.length === 0, problems, warnings, totals }
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
// 7) KONTRAK HANDOFF KE PURCHASE REQUEST
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
export const PR_REQUEST_FIELDS = ['project_id', 'title', 'pr_number', 'priority', 'status', 'materials_summary', 'notes']
export const PR_ITEM_FIELDS = ['pr_id', 'material_id', 'item_name', 'kode', 'unit', 'quantity', 'status', 'supplier_category', 'vendor_id', 'estimated_price', 'sort_order']
export const PR_ITEM_FIELDS_FROM_TARGET = ['pr_id']
export const PR_ITEM_PAYLOAD_FIELDS = PR_ITEM_FIELDS.filter(f => PR_ITEM_FIELDS_FROM_TARGET.indexOf(f) < 0)

export function buildPrHandoff(rap, opts = {}) {
  const problems = []
  const warnings = []
  const projectId = opts.project_id || (rap && rap.project_id) || null
  if (!projectId) problems.push('RAP belum terhubung ke proyek — PR wajib punya project_id.')

  const selectedIds = Array.isArray(opts.line_ids) ? opts.line_ids : null
  const lines = ((rap && rap.lines) || []).filter(line => {
    if (!selectedIds) return true
    return selectedIds.indexOf(line.id) >= 0 || selectedIds.indexOf(line.key) >= 0
  })
  if (!lines.length) problems.push('Tidak ada baris RAP yang dipilih untuk dibuatkan PR.')

  const items = []
  lines.forEach((rawLine, idx) => {
    const line = normalizeLine(rawLine)
    const qty = toNumber(line.planned_qty)
    const price = toNumber(line.planned_unit_price)
    const label = line.item_name || `baris ${idx + 1}`
    if (qty === null || qty <= 0) {
      problems.push(`Qty rencana "${label}" tidak valid untuk PR.`)
      return
    }
    if (price === null || price < 0) {
      problems.push(`Harga rencana "${label}" tidak valid untuk PR.`)
      return
    }
    if (price === 0) warnings.push(`Harga rencana "${label}" masih 0 — PR akan tercatat tanpa estimasi harga.`)
    if (!line.material_id) warnings.push(`"${label}" belum tertaut master material — PR tetap bisa dibuat, tapi tautan material kosong.`)
    items.push({
      material_id: line.material_id || null,
      item_name: line.item_name,
      kode: line.kode || '',
      unit: line.unit || 'unit',
      quantity: qty,
      status: 'PENDING_APPROVAL',
      supplier_category: null,
      vendor_id: null,
      estimated_price: Math.max(0, roundRupiah(price)),
      sort_order: idx
    })
  })

  const totals = rapTotals(rap)
  const summary = items.map(it => `${it.quantity} ${it.unit || ''} ${it.item_name}`.replace(/\s+/g, ' ').trim()).join(', ')
  const projectLabel = rap && (rap.project_kode ? `[${rap.project_kode}] ${rap.project_name}` : rap.project_name)
  const request = {
    project_id: projectId,
    title: opts.title || `Material RAP ${rap ? rap.version : ''}`.trim(),
    // nomor PR = null: diisi RPC next_pr_number di modul PR (bukan di sini).
    pr_number: null,
    priority: opts.priority || 'NORMAL',
    status: 'DRAFT',
    materials_summary: summary || '—',
    notes: `Dari RAP ${rap ? rap.version : '—'}${rap && rap.rab_reff ? ` (RAB ${rap.rab_reff}${rap.rab_revision ? ` ${rap.rab_revision}` : ''})` : ''}${projectLabel ? ` — ${projectLabel}` : ''}. Rencana pelaksanaan internal; qty & harga masih RENCANA, bukan realisasi.`
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    request,
    items,
    meta: {
      rap_version: rap ? rap.version : null,
      rap_status: rap ? rap.status : null,
      rab_reff: rap ? rap.rab_reff : null,
      rab_revision: rap ? rap.rab_revision : null,
      planned_total: totals.rapTotal,
      // Eksplisit: fungsi ini hanya MENYUSUN payload, tidak menulis apa pun.
      writes: 0,
      delivered: false
    }
  }
}

// ------------------------------------------------------------
// 8) SNAPSHOT JSON (backup manual — bukan persistence)
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
