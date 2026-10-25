// ============================================================
// scripts/reminders/rules.js — MESIN ATURAN REMINDER OPERASIONAL (MURNI)
// ============================================================
// LAPISAN REMINDER / READINESS CONTROL (S5, t_94e9bfaa).
//
// Sifat lapisan ini — dan ini yang membuatnya aman dipasang di aplikasi
// produksi:
//   * DRY-RUN & READ-ONLY. File ini MURNI: tidak menyentuh jaringan, tidak
//     menulis file, tidak memanggil DB, tidak mengirim pesan, tidak
//     menyentuh cron/jadwal apa pun. Masukannya array data yang sudah
//     dibaca pihak lain; keluarannya laporan.
//   * TIDAK ADA PENGIRIMAN KELUAR. Reminder hanya DIBACA manusia (endpoint
//     GET /api/reminders atau CLI). Tidak ada Telegram/WA/email, tidak ada
//     pembayaran, tidak ada mutasi status.
//   * ANGKA TIDAK DIKARANG. Bila sumber data tidak tersedia (mis. tabel
//     `sales_invoices` belum ada → PGRST205), jenis reminder yang
//     membutuhkannya dilaporkan BLOCKED — bukan "0 temuan" yang menyamar
//     jadi "semua aman".
//
// Dipakai oleh:
//   pages/api/reminders.js        → endpoint admin (GET, dry-run)
//   scripts/reminders/collect.js  → pembaca data read-only
//   scripts/reminders/cli.mjs     → laporan teks di terminal
//   scripts/reminders-test/*      → harness (verbatim, tanpa DB)
//
// Lihat docs/reminders-contract.md untuk daftar jenis, ambang, dan alasan
// tiap ambang dipilih.
// ============================================================

// CATATAN KETEKNISAN: file ini SENGAJA tidak mengimpor lib/purchaseNote.js.
// Folder ini ditandai ESM (package.json type:module) supaya bisa dijalankan
// langsung oleh CLI/harness Node tanpa bundler; lib/purchaseNote.js adalah
// modul ESM di dalam paket CommonJS sehingga tidak bisa diimpor dari sini.
// Karena itu penanda nota dibaca oleh `readNoteMarkers` di bawah — HANYA tiga
// penanda yang dibutuhkan lapisan reminder. Kesetaraan dengan parser kanonik
// diuji di scripts/reminders-test/parity_test.mjs atas data nyata, jadi tidak
// ada dua kebenaran yang menyimpang tanpa ketahuan.

// ------------------------------------------------------------
// 0. TANDA KEBIJAKAN APPROVAL (t_50b783de) — HARUS SAMA dengan
//    lib/constants.js (APPROVAL_MODULE_ENABLED).
// ------------------------------------------------------------
// File ini paket ESM terpisah yang tidak bisa mengimpor lib/ (root package
// bukan type:module), jadi nilai ini DIDUPLIKASI dan dijaga paritas test
// `scripts/approval-off-test/logic_test.mjs`.
// Saat false:
//   * `approval_steps` TIDAK dibaca sama sekali oleh collect.js,
//   * jenis reminder `pr_overdue_approval` (khusus antrean approval) mati,
//   * pemeriksaan "APPROVED tanpa jejak approval" dilewati secara jujur.
// Reminder operasional lain (draft stale, pending delivery, handover, invoice)
// TIDAK terpengaruh.
export const APPROVAL_MODULE_ENABLED = false

// ------------------------------------------------------------
// 1. KATALOG JENIS REMINDER
// ------------------------------------------------------------
// `threshold`  : kunci ambang hari (null = tidak memakai ambang waktu)
// `required`   : sumber data WAJIB tersedia; bila salah satu hilang jenis ini
//                BLOCKED (tidak dievaluasi) — bukan dianggap bersih.
// `optional`   : sumber yang memperkaya tetapi tidak menggagalkan evaluasi.
// `severity`   : tingkat bawaan jenis ini (satu item bisa lebih berat,
//                mis. invoice yang sudah lewat jatuh tempo = critical).
export const KINDS = Object.freeze([
  {
    key: 'pr_overdue_approval',
    label: 'PR menunggu approval terlalu lama',
    severity: 'warning',
    threshold: 'pr_overdue_days',
    required: ['purchase_requests'],
    optional: ['approval_steps', 'projects'],
    // t_50b783de: jenis ini HANYA bermakna bila modul Approval aktif.
    requiresApprovalModule: true
  },
  {
    key: 'pr_draft_stale',
    label: 'Draft PR tidak dilanjutkan',
    severity: 'info',
    threshold: 'draft_stale_days',
    required: ['purchase_requests'],
    optional: ['projects']
  },
  {
    key: 'purchase_pending_delivery',
    label: 'Barang disetujui belum dibeli / nota belum diisi',
    severity: 'warning',
    threshold: 'purchase_pending_days',
    required: ['pr_items', 'receiving_items'],
    optional: ['receivings', 'approval_steps', 'purchase_requests', 'projects']
  },
  {
    key: 'handover_pending',
    label: 'Barang sudah dibeli tetapi belum diserahkan',
    severity: 'warning',
    threshold: 'handover_pending_days',
    required: ['handovers'],
    optional: ['receivings', 'projects']
  },
  {
    key: 'invoice_due',
    label: 'Invoice jatuh tempo / mendekati jatuh tempo',
    severity: 'critical',
    threshold: 'invoice_due_soon_days',
    required: ['sales_invoices'],
    optional: ['projects']
  },
  {
    key: 'invoice_draft_stale',
    label: 'Draft invoice belum diterbitkan',
    severity: 'info',
    threshold: 'invoice_draft_stale_days',
    required: ['sales_invoices'],
    optional: ['projects']
  },
  {
    key: 'missing_evidence',
    label: 'Bukti operasional belum lengkap',
    severity: 'warning',
    threshold: null,
    // Tidak ada sumber wajib: tiap pemeriksaan bukti dinilai hanya bila
    // sumbernya tersedia, sisanya dilaporkan sebagai `checks_skipped`.
    required: [],
    optional: ['handovers', 'receivings', 'receiving_items', 'approval_steps', 'purchase_requests', 'sales_invoices']
  }
])

export const KIND_BY_KEY = Object.freeze(Object.fromEntries(KINDS.map(k => [k.key, k])))

export const SEVERITIES = Object.freeze(['critical', 'warning', 'info'])
const SEVERITY_RANK = Object.freeze({ critical: 0, warning: 1, info: 2 })

// ------------------------------------------------------------
// 2. AMBANG BATAS (THRESHOLDS)
// ------------------------------------------------------------
// Angka ini SENGAJA konservatif dan bisa diubah tanpa deploy kode lewat env
// (REMINDER_*_DAYS) atau per-permintaan lewat query string. Setiap laporan
// MENCETAK ambang yang benar-benar dipakai beserta asalnya (default/env/query)
// supaya pembaca tidak menebak.
export const DEFAULT_THRESHOLDS = Object.freeze({
  pr_overdue_days: 3,
  draft_stale_days: 7,
  purchase_pending_days: 7,
  handover_pending_days: 3,
  invoice_due_soon_days: 7,
  invoice_draft_stale_days: 3
})

export const THRESHOLD_ENV = Object.freeze({
  pr_overdue_days: 'REMINDER_PR_OVERDUE_DAYS',
  draft_stale_days: 'REMINDER_DRAFT_STALE_DAYS',
  purchase_pending_days: 'REMINDER_PURCHASE_PENDING_DAYS',
  handover_pending_days: 'REMINDER_HANDOVER_PENDING_DAYS',
  invoice_due_soon_days: 'REMINDER_INVOICE_DUE_SOON_DAYS',
  invoice_draft_stale_days: 'REMINDER_INVOICE_DRAFT_STALE_DAYS'
})

// Batas wajar: 0 hari boleh (artinya "langsung"), 365 hari batas atas supaya
// salah ketik (mis. 3000) tidak membuat seluruh laporan kosong diam-diam.
export const THRESHOLD_MIN = 0
export const THRESHOLD_MAX = 365

function toDayNumber(v) {
  const n = Number(v)
  if (!isFinite(n)) return null
  const i = Math.trunc(n)
  if (i < THRESHOLD_MIN || i > THRESHOLD_MAX) return null
  return i
}

// resolveThresholds({ query, env }) -> { values, sources, rejected }
// `rejected` mencatat nilai yang ditolak (di luar 0..365 / bukan angka) supaya
// laporan bisa jujur bahwa permintaan tidak dipakai.
export function resolveThresholds({ query = {}, env = {} } = {}) {
  const values = { ...DEFAULT_THRESHOLDS }
  const sources = Object.fromEntries(Object.keys(DEFAULT_THRESHOLDS).map(k => [k, 'default']))
  const rejected = []

  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    const envName = THRESHOLD_ENV[key]
    const fromEnv = envName ? env[envName] : undefined
    if (fromEnv !== undefined && String(fromEnv).trim() !== '') {
      const n = toDayNumber(fromEnv)
      if (n === null) rejected.push({ key, from: 'env', value: String(fromEnv) })
      else { values[key] = n; sources[key] = 'env' }
    }
    const fromQuery = query ? query[key] : undefined
    if (fromQuery !== undefined && String(fromQuery).trim() !== '') {
      const n = toDayNumber(fromQuery)
      if (n === null) rejected.push({ key, from: 'query', value: String(fromQuery) })
      else { values[key] = n; sources[key] = 'query' }
    }
  }
  return { values, sources, rejected }
}

// ------------------------------------------------------------
// 3. UTIL TANGGAL (tanggal kalender WIB, tanpa jam)
// ------------------------------------------------------------
// Laporan ini dipakai pagi hari WIB. Sebelumnya hari "hari ini" diambil dari
// UTC (`toISOString()`), sehingga pada 09:00 WIB tanggal masih tanggal
// kemarin — invoice yang jatuh tempo hari ini masuk "due_soon" bukan
// "overdue" (penagihan telat sehari). Sekarang tanggal kalender dihitung di
// zona Asia/Jakarta. String tanggal polos (YYYY-MM-DD) diperlakukan apa
// adanya: itu sudah tanggal kalender, bukan instan waktu.
const REPORT_TZ = 'Asia/Jakarta'

function calendarDate(d) {
  // en-CA menghasilkan format YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d)
}

export function toDateOnly(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') {
    const exact = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (exact) return `${exact[1]}-${exact[2]}-${exact[3]}`
    const d = new Date(value)
    if (isNaN(d.getTime())) return null
    return calendarDate(d)
  }
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return calendarDate(d)
}

function dayNumber(dateOnly) {
  if (!dateOnly) return null
  const [y, m, d] = String(dateOnly).split('-').map(Number)
  if (!y || !m || !d) return null
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

// Umur dalam hari: asOf - date. Positif = sudah lewat.
export function daysBetween(dateValue, asOfDate) {
  const a = dayNumber(toDateOnly(dateValue))
  const b = dayNumber(toDateOnly(asOfDate))
  if (a === null || b === null) return null
  return b - a
}

export function isPastDue(dueDate, asOfDate) {
  const a = dayNumber(toDateOnly(dueDate))
  const b = dayNumber(toDateOnly(asOfDate))
  if (a === null || b === null) return null
  return b > a
}

export function todayISO(now) {
  const d = now ? new Date(now) : new Date()
  if (isNaN(d.getTime())) return calendarDate(new Date())
  return calendarDate(d)
}

// ------------------------------------------------------------
// 4. PEMBANTU DATA (defensif: field boleh hilang / null)
// ------------------------------------------------------------
function arr(v) {
  return Array.isArray(v) ? v : []
}

function norm(v) {
  return String(v === null || v === undefined ? '' : v).trim().toUpperCase()
}

function text(v) {
  return String(v === null || v === undefined ? '' : v).trim()
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return isFinite(n) ? n : null
}

function rp(n) {
  const v = Number(n)
  if (!isFinite(v)) return '—'
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(v))
}

function nameOfProject(projectsById, projectId) {
  if (!projectId) return ''
  const p = projectsById.get(projectId)
  if (!p) return ''
  return text(p.name) || text(p.kode) || text(p.code)
}

function refLabel(row, fallback) {
  return text(row && (row.pr_number || row.invoice_no || row.delivery_note)) || text(row && row.id) || fallback
}

// ------------------------------------------------------------
// 4b. PEMBACA PENANDA NOTA (subset dari lib/purchaseNote.js)
// ------------------------------------------------------------
// Kontrak penanda ada di lib/purchaseNote.js. Lapisan reminder hanya perlu
// tahu tiga hal: apakah nota punya nominal material, punya foto nota, dan
// punya bukti transfer. Pola regex di bawah SAMA PERSIS dengan parser kanonik
// (termasuk penerimaan "Rp 1.250.000" bertitik), dan paritasnya diuji atas
// data nyata oleh scripts/reminders-test/parity_test.mjs.
export function readNoteMarkers(note) {
  const s = String(note === null || note === undefined ? '' : note)
  const grab = (re) => {
    const m = s.match(re)
    return m ? String(m[1] || '').trim() : ''
  }
  const digits = (v) => {
    const d = String(v === null || v === undefined ? '' : v).replace(/[^\d]/g, '')
    return d ? Number(d) : null
  }
  return {
    material: digits(grab(/\[Nominal:\s*Rp\s*([\d.,]+)\s*\]/i)),
    buktiNota: grab(/\[BuktiNota:\s*([^\]]+)\]/i),
    buktiTransfer: grab(/\[BuktiTransfer:\s*([^\]]+)\]/i)
  }
}

function makeItem({
  kind, severity, refType, refId, refText, title, detail,
  ageDays = null, thresholdDays = null, dueDate = null, overdueDays = null,
  evidenceMissing = [], actionHint = '', sub = '', meta = {}
}) {
  return {
    id: [kind, sub, refType, refId].filter(Boolean).join(':'),
    kind,
    severity,
    title,
    detail,
    entity: { type: refType, id: refId || null, ref: refText || null },
    age_days: ageDays,
    threshold_days: thresholdDays,
    due_date: dueDate,
    overdue_days: overdueDays,
    evidence_missing: evidenceMissing,
    action_hint: actionHint,
    meta
  }
}

// ------------------------------------------------------------
// 5. ATURAN PER JENIS
// ------------------------------------------------------------
// Setiap fungsi menerima (ctx) dan mengembalikan array item. Semua fungsi
// WAJIB hanya membaca: tidak ada satu pun yang mengubah dataset masuk.

function approvalIndex(approvalSteps) {
  const byPr = new Map()
  for (const s of arr(approvalSteps)) {
    const prId = s.purchase_request_id
    if (!prId) continue
    if (!byPr.has(prId)) byPr.set(prId, [])
    byPr.get(prId).push(s)
  }
  return byPr
}

function decidedAtOf(steps) {
  const approved = arr(steps)
    .filter(s => norm(s.status) === 'APPROVED' && s.decided_at)
    .map(s => toDateOnly(s.decided_at))
    .filter(Boolean)
    .sort()
  return approved.length ? approved[approved.length - 1] : null
}

// --- pr_overdue_approval ---
// PR yang sudah SUBMITTED tetapi belum ada putusan. Umur dihitung dari
// langkah approval PENDING tertua (bila ada) — itu titik "menunggu" yang
// sebenarnya — atau dari created_at PR bila jejak approval tidak tersedia.
export function rulePrOverdueApproval(ctx) {
  const { dataset, thresholds, asOf, approvalAvailable } = ctx
  const byPr = approvalIndex(dataset.approval_steps)
  const projects = new Map(arr(dataset.projects).map(p => [p.id, p]))
  const out = []
  const limit = thresholds.pr_overdue_days

  for (const pr of arr(dataset.purchase_requests)) {
    const status = norm(pr.status)
    if (status !== 'SUBMITTED' && status !== 'MENUNGGU') continue
    const steps = byPr.get(pr.id) || []
    const pending = steps.filter(s => norm(s.status) === 'PENDING')
    const startRaw = pending
      .map(s => toDateOnly(s.created_at))
      .filter(Boolean)
      .sort()[0] || toDateOnly(pr.created_at)
    const age = daysBetween(startRaw, asOf)
    if (age === null || age < limit) continue

    const severity = age >= limit * 2 + 1 ? 'critical' : 'warning'
    const project = nameOfProject(projects, pr.project_id)
    out.push(makeItem({
      kind: 'pr_overdue_approval',
      severity,
      refType: 'purchase_request',
      refId: pr.id,
      refText: refLabel(pr, 'PR'),
      title: `${refLabel(pr, 'PR')} menunggu approval ${age} hari`,
      detail: [
        project ? `Proyek: ${project}` : '',
        text(pr.title) ? `Kebutuhan: ${text(pr.title)}` : '',
        pending.length ? `${pending.length} langkah approval masih PENDING` : 'Tidak ada langkah approval tercatat (jejak putusan hilang)'
      ].filter(Boolean).join(' · '),
      ageDays: age,
      thresholdDays: limit,
      evidenceMissing: pending.length ? [] : ['approval_steps'],
      actionHint: 'Buka modul Approval dan putuskan, atau tarik kembali PR ke draft bila memang belum siap.',
      meta: { status, pending_steps: pending.length, approval_source_available: approvalAvailable !== false }
    }))
  }
  return out
}

// --- pr_draft_stale ---
export function rulePrDraftStale(ctx) {
  const { dataset, thresholds, asOf } = ctx
  const projects = new Map(arr(dataset.projects).map(p => [p.id, p]))
  const out = []
  const limit = thresholds.draft_stale_days

  for (const pr of arr(dataset.purchase_requests)) {
    if (norm(pr.status) !== 'DRAFT') continue
    const age = daysBetween(pr.created_at, asOf)
    if (age === null || age < limit) continue
    const project = nameOfProject(projects, pr.project_id)
    out.push(makeItem({
      kind: 'pr_draft_stale',
      severity: 'info',
      refType: 'purchase_request',
      refId: pr.id,
      refText: refLabel(pr, 'PR'),
      title: `Draft ${refLabel(pr, 'PR')} berumur ${age} hari`,
      detail: [project ? `Proyek: ${project}` : '', 'Belum diajukan — tidak masuk antrean approval maupun pembelian.'].filter(Boolean).join(' · '),
      ageDays: age,
      thresholdDays: limit,
      actionHint: 'Ajukan (submit) bila masih dibutuhkan, atau hapus bila sudah tidak relevan.',
      meta: { status: 'DRAFT' }
    }))
  }
  return out
}

// --- purchase_pending_delivery ---
// Dua jalur, dan keduanya harus terlihat:
//  (a) item sudah APPROVED tapi belum ada satu pun penerimaan (qty > 0);
//  (b) cangkang nota dari Approval (delivery_note "PO …", tanpa invoice_no &
//      tanpa received_date) yang umurnya lewat ambang — uang belum keluar,
//      nota belum diisi.
export function rulePurchasePendingDelivery(ctx) {
  const { dataset, thresholds, asOf } = ctx
  const out = []
  const limit = thresholds.purchase_pending_days

  const receivedItemIds = new Set(
    arr(dataset.receiving_items)
      .filter(ri => (num(ri.quantity_received) || 0) > 0)
      .map(ri => ri.pr_item_id)
      .filter(Boolean)
  )
  const prById = new Map(arr(dataset.purchase_requests).map(p => [p.id, p]))
  const projects = new Map(arr(dataset.projects).map(p => [p.id, p]))
  const byPr = approvalIndex(dataset.approval_steps)

  // (a) kelompokkan item yang belum dibeli per PR
  const pendingByPr = new Map()
  for (const it of arr(dataset.pr_items)) {
    const st = norm(it.status)
    if (!['APPROVED', 'ORDERED', 'PENDING_APPROVAL'].includes(st)) continue
    if (receivedItemIds.has(it.id)) continue
    const prId = it.pr_id || null
    if (!prId) continue
    const pr = prById.get(prId)
    if (pr && norm(pr.status) === 'DRAFT') continue // draft bukan urusan pembelian
    if (!pendingByPr.has(prId)) pendingByPr.set(prId, [])
    pendingByPr.get(prId).push(it)
  }

  const coveredPrIds = new Set()
  for (const [prId, items] of pendingByPr) {
    const pr = prById.get(prId) || {}
    const startRaw = decidedAtOf(byPr.get(prId)) || toDateOnly(pr.created_at) ||
      items.map(i => toDateOnly(i.created_at)).filter(Boolean).sort()[0] || null
    const age = daysBetween(startRaw, asOf)
    if (age === null || age < limit) continue
    coveredPrIds.add(prId)

    const estimated = items.reduce((sum, i) => {
      const q = num(i.quantity) || 0
      const p = num(i.estimated_price) || 0
      return sum + q * p
    }, 0)
    const project = nameOfProject(projects, pr.project_id)
    const onlyPendingApproval = items.every(i => norm(i.status) === 'PENDING_APPROVAL')
    out.push(makeItem({
      kind: 'purchase_pending_delivery',
      sub: 'item',
      severity: onlyPendingApproval ? 'info' : 'warning',
      refType: 'purchase_request',
      refId: prId,
      refText: refLabel(pr, 'PR'),
      title: `${items.length} barang ${refLabel(pr, 'PR')} belum dibeli (${age} hari)`,
      detail: [
        project ? `Proyek: ${project}` : '',
        items.slice(0, 3).map(i => text(i.item_name) || text(i.kode) || 'item').join(', ') + (items.length > 3 ? `, +${items.length - 3} lain` : ''),
        estimated ? `Estimasi ${rp(estimated)}` : ''
      ].filter(Boolean).join(' · '),
      ageDays: age,
      thresholdDays: limit,
      actionHint: 'Buka tab "Siap Dibeli" di modul Purchase dan catat nota belanjanya.',
      meta: { item_count: items.length, estimated_total: estimated, statuses: [...new Set(items.map(i => norm(i.status)))] }
    }))
  }

  // (b) cangkang nota yang belum diisi (hanya untuk PR yang belum dilaporkan di atas)
  for (const rec of arr(dataset.receivings)) {
    if (text(rec.invoice_no)) continue
    if (text(rec.received_date)) continue
    if (readNoteMarkers(rec.note).material !== null) continue // sudah nota nyata
    const prId = rec.purchase_request_id || null
    if (prId && coveredPrIds.has(prId)) continue
    const age = daysBetween(rec.created_at, asOf)
    if (age === null || age < limit) continue
    const project = nameOfProject(projects, rec.project_id || (prById.get(prId) || {}).project_id)
    out.push(makeItem({
      kind: 'purchase_pending_delivery',
      sub: 'shell',
      severity: 'warning',
      refType: 'receiving',
      refId: rec.id,
      refText: text(rec.delivery_note) || 'Nota',
      title: `Nota belum diisi sejak ${age} hari`,
      detail: [
        text(rec.delivery_note) ? `Cangkang: ${text(rec.delivery_note)}` : '',
        project ? `Proyek: ${project}` : '',
        'Tidak ada nomor nota, tanggal, maupun nominal — belum ada uang keluar yang tercatat.'
      ].filter(Boolean).join(' · '),
      ageDays: age,
      thresholdDays: limit,
      evidenceMissing: ['invoice_no', 'received_date', 'nominal'],
      actionHint: 'Lengkapi nota belanja di modul Purchase, atau tandai PR tidak jadi dibeli.',
      meta: { purchase_request_id: prId, status: text(rec.status) }
    }))
  }

  return out
}

// --- handover_pending ---
export function ruleHandoverPending(ctx) {
  const { dataset, thresholds, asOf } = ctx
  const out = []
  const limit = thresholds.handover_pending_days
  const projects = new Map(arr(dataset.projects).map(p => [p.id, p]))
  const receivingById = new Map(arr(dataset.receivings).map(r => [r.id, r]))

  for (const ho of arr(dataset.handovers)) {
    if (ho.diserahkan_at) continue
    const startRaw = toDateOnly(ho.handover_date) || toDateOnly(ho.created_at)
    const age = daysBetween(startRaw, asOf)
    if (age === null || age < limit) continue
    const rec = receivingById.get(ho.receiving_id) || null
    const project = nameOfProject(projects, ho.project_id)
    out.push(makeItem({
      kind: 'handover_pending',
      severity: 'warning',
      refType: 'handover',
      refId: ho.id,
      refText: text(ho.received_by) || 'Handover',
      title: `Barang belum diserahkan ${age} hari`,
      detail: [
        rec ? `Nota: ${text(rec.invoice_no) || text(rec.delivery_note) || '—'}` : '',
        project ? `Proyek: ${project}` : '',
        `Penerima tercatat: ${text(ho.received_by) || 'belum ditentukan'}`
      ].filter(Boolean).join(' · '),
      ageDays: age,
      thresholdDays: limit,
      actionHint: 'Buka antrean Handover dan catat distribusi fisik (gudang / tukang / bermasalah).',
      meta: { status: text(ho.status), receiving_id: ho.receiving_id || null }
    }))
  }
  return out
}

// --- invoice_due ---
// Outstanding dihitung dari STATUS (TERBIT/TERKIRIM/DISETUJUI), bukan dari
// selisih paid_amount: modul invoice belum punya skema pembayaran bertahap
// (lihat catatan S4 di docs/sales-invoice-contract.md).
export const OUTSTANDING_INVOICE_STATUSES = Object.freeze(['TERBIT', 'TERKIRIM', 'DISETUJUI'])

export function ruleInvoiceDue(ctx) {
  const { dataset, thresholds, asOf } = ctx
  const out = []
  const soon = thresholds.invoice_due_soon_days

  for (const inv of arr(dataset.sales_invoices)) {
    const status = norm(inv.status)
    if (!OUTSTANDING_INVOICE_STATUSES.includes(status)) continue
    const due = toDateOnly(inv.due_date)
    const base = toDateOnly(inv.issue_date) || toDateOnly(inv.created_at)
    const label = text(inv.invoice_no) || text(inv.customer_name) || text(inv.id)

    if (due) {
      const late = daysBetween(due, asOf) // > 0 berarti sudah lewat
      if (late !== null && late > 0) {
        out.push(makeItem({
          kind: 'invoice_due',
          sub: 'overdue',
          severity: 'critical',
          refType: 'sales_invoice',
          refId: inv.id,
          refText: label,
          title: `Invoice ${label} lewat jatuh tempo ${late} hari`,
          detail: [
            text(inv.customer_name) ? `Klien: ${text(inv.customer_name)}` : '',
            `Jatuh tempo ${due}`,
            inv.grand_total !== undefined && inv.grand_total !== null ? `Nilai ${rp(inv.grand_total)}` : ''
          ].filter(Boolean).join(' · '),
          ageDays: late,
          thresholdDays: soon,
          dueDate: due,
          overdueDays: late,
          actionHint: 'Tindak lanjuti penagihan manual (di luar aplikasi). Aplikasi TIDAK mengirim tagihan otomatis.',
          meta: { status, grand_total: num(inv.grand_total) }
        }))
        continue
      }
      const remaining = daysBetween(asOf, due)
      if (remaining !== null && remaining <= soon) {
        out.push(makeItem({
          kind: 'invoice_due',
          sub: 'due_soon',
          severity: 'warning',
          refType: 'sales_invoice',
          refId: inv.id,
          refText: label,
          title: `Invoice ${label} jatuh tempo dalam ${remaining} hari`,
          detail: [
            text(inv.customer_name) ? `Klien: ${text(inv.customer_name)}` : '',
            `Jatuh tempo ${due}`,
            inv.grand_total !== undefined && inv.grand_total !== null ? `Nilai ${rp(inv.grand_total)}` : ''
          ].filter(Boolean).join(' · '),
          ageDays: remaining,
          thresholdDays: soon,
          dueDate: due,
          actionHint: 'Siapkan penagihan sebelum jatuh tempo.',
          meta: { status, grand_total: num(inv.grand_total) }
        }))
        continue
      }
      continue
    }

    // Outstanding tanpa tanggal jatuh tempo: tetap dilaporkan bila sudah lama
    // terbit — invoice tanpa due_date tidak bisa "jatuh tempo", tapi juga tidak
    // boleh hilang dari radar.
    const age = daysBetween(base, asOf)
    if (age !== null && age >= soon) {
      out.push(makeItem({
        kind: 'invoice_due',
        sub: 'no_due_date',
        severity: 'warning',
        refType: 'sales_invoice',
        refId: inv.id,
        refText: label,
        title: `Invoice ${label} tanpa tanggal jatuh tempo (${age} hari)`,
        detail: [text(inv.customer_name) ? `Klien: ${text(inv.customer_name)}` : '', `Status ${status}`, 'Tanggal jatuh tempo kosong — tidak bisa ditagih tepat waktu.'].filter(Boolean).join(' · '),
        ageDays: age,
        thresholdDays: soon,
        evidenceMissing: ['due_date'],
        actionHint: 'Lengkapi tanggal jatuh tempo invoice.',
        meta: { status }
      }))
    }
  }
  return out
}

// --- invoice_draft_stale ---
export function ruleInvoiceDraftStale(ctx) {
  const { dataset, thresholds, asOf } = ctx
  const out = []
  const limit = thresholds.invoice_draft_stale_days
  for (const inv of arr(dataset.sales_invoices)) {
    if (norm(inv.status) !== 'DRAFT') continue
    const age = daysBetween(inv.created_at, asOf)
    if (age === null || age < limit) continue
    const label = text(inv.customer_name) || text(inv.id)
    out.push(makeItem({
      kind: 'invoice_draft_stale',
      severity: 'info',
      refType: 'sales_invoice',
      refId: inv.id,
      refText: label,
      title: `Draft invoice ${label} berumur ${age} hari`,
      detail: 'Draft belum punya nomor invoice dan belum diterbitkan ke klien.',
      ageDays: age,
      thresholdDays: limit,
      actionHint: 'Terbitkan bila sudah final, atau hapus bila batal.',
      meta: { status: 'DRAFT' }
    }))
  }
  return out
}

// --- missing_evidence ---
// Setiap pemeriksaan berdiri sendiri; sumber yang tidak tersedia dicatat di
// `skipped` (dilaporkan di laporan), bukan dianggap lulus.
export function ruleMissingEvidence(ctx) {
  const { dataset, sourcesAvailable, approvalModuleEnabled = APPROVAL_MODULE_ENABLED } = ctx
  const out = []
  const skipped = []
  const have = (key) => sourcesAvailable[key] !== false

  // 1) Handover ditandai selesai (CONFIRMED) tetapi bukti serah terima kosong.
  if (have('handovers')) {
    for (const ho of arr(dataset.handovers)) {
      const status = norm(ho.status)
      const done = status === 'CONFIRMED' || status === 'SELESAI' || status === 'DONE'
      if (done && !ho.diserahkan_at) {
        out.push(makeItem({
          kind: 'missing_evidence',
          sub: 'handover_confirmed_no_timestamp',
          severity: 'critical',
          refType: 'handover',
          refId: ho.id,
          refText: text(ho.received_by) || 'Handover',
          title: 'Handover berstatus selesai tanpa bukti waktu serah terima',
          detail: `Status ${status} tetapi kolom diserahkan_at kosong — status dan bukti fisik bertentangan.`,
          evidenceMissing: ['diserahkan_at'],
          actionHint: 'Catat ulang penyerahan lewat antrean Handover supaya waktu bukti tercatat.',
          meta: { status }
        }))
      }
      if (done && (!text(ho.received_by) || /^belum ditentukan$/i.test(text(ho.received_by)))) {
        out.push(makeItem({
          kind: 'missing_evidence',
          sub: 'handover_no_receiver',
          severity: 'warning',
          refType: 'handover',
          refId: ho.id,
          refText: text(ho.id),
          title: 'Handover selesai tanpa nama penerima',
          detail: 'Barang tidak bisa dipertanggungjawabkan ke orang tertentu.',
          evidenceMissing: ['received_by'],
          actionHint: 'Isi nama penerima (mandor/tukang/gudang).',
          meta: { status }
        }))
      }
    }
  } else {
    skipped.push('handovers')
  }

  // 2) Nota belanja (uang keluar) tanpa bukti nota / transfer, atau tanpa rincian.
  if (have('receivings')) {
    const itemsByReceiving = new Map()
    for (const ri of arr(dataset.receiving_items)) {
      const key = ri.receiving_id
      if (!key) continue
      if (!itemsByReceiving.has(key)) itemsByReceiving.set(key, [])
      itemsByReceiving.get(key).push(ri)
    }
    for (const rec of arr(dataset.receivings)) {
      const parsed = readNoteMarkers(rec.note)
      const isNota = !!text(rec.invoice_no) || parsed.material !== null
      if (!isNota) continue
      const label = text(rec.invoice_no) || text(rec.delivery_note) || 'Nota'
      const missing = []
      if (!parsed.buktiNota) missing.push('bukti_nota')
      if (!parsed.buktiTransfer) missing.push('bukti_transfer')
      if (missing.length) {
        out.push(makeItem({
          kind: 'missing_evidence',
          sub: 'nota_no_proof',
          // Bukti nota/transfer memang OPSIONAL di kontrak Purchase, jadi ini
          // informasi — bukan pelanggaran. Tetap dilaporkan karena uang keluar
          // tanpa bukti adalah risiko audit yang nyata.
          severity: 'info',
          refType: 'receiving',
          refId: rec.id,
          refText: label,
          title: `Nota ${label} tanpa ${missing.join(' & ')}`,
          detail: [
            parsed.material !== null ? `Nominal ${rp(parsed.material)}` : '',
            'Bukti bersifat opsional di kontrak, tetapi tanpa bukti nota/transfer pengeluaran tidak bisa diaudit.'
          ].filter(Boolean).join(' · '),
          evidenceMissing: missing,
          actionHint: 'Unggah foto nota / bukti transfer di modul Purchase.',
          meta: { invoice_no: text(rec.invoice_no) }
        }))
      }
      if (have('receiving_items') && !(itemsByReceiving.get(rec.id) || []).length) {
        out.push(makeItem({
          kind: 'missing_evidence',
          sub: 'nota_no_items',
          severity: 'warning',
          refType: 'receiving',
          refId: rec.id,
          refText: label,
          title: `Nota ${label} tanpa rincian barang`,
          detail: 'Nota tercatat tetapi tidak ada baris barang — isi nota tidak bisa diperiksa.',
          evidenceMissing: ['receiving_items'],
          actionHint: 'Muat item dari PR atau isi rincian barang pada nota.',
          meta: { invoice_no: text(rec.invoice_no) }
        }))
      }
      if (!text(rec.received_date)) {
        out.push(makeItem({
          kind: 'missing_evidence',
          sub: 'nota_no_date',
          severity: 'info',
          refType: 'receiving',
          refId: rec.id,
          refText: label,
          title: `Nota ${label} tanpa tanggal`,
          detail: 'Tanggal nota kosong sehingga umur pengeluaran tidak bisa dihitung.',
          evidenceMissing: ['received_date'],
          actionHint: 'Isi tanggal belanja sesuai nota toko.',
          meta: { invoice_no: text(rec.invoice_no) }
        }))
      }
    }
  } else {
    skipped.push('receivings')
  }

  // 3) PR disetujui tanpa jejak putusan approval.
  if (have('purchase_requests')) {
    const byPr = approvalIndex(dataset.approval_steps)
    const itemsByPr = new Map()
    for (const it of arr(dataset.pr_items)) {
      if (!it.pr_id) continue
      itemsByPr.set(it.pr_id, (itemsByPr.get(it.pr_id) || 0) + 1)
    }
    for (const pr of arr(dataset.purchase_requests)) {
      if (norm(pr.status) !== 'APPROVED') continue
      const steps = byPr.get(pr.id) || []
      const approved = steps.some(s => norm(s.status) === 'APPROVED')
      // t_50b783de: saat Approval OFF, pemeriksaan "APPROVED tanpa langkah
      // approval" TIDAK relevan (approval tidak dipakai) — dilewati secara
      // jujur lewat `skipped`, bukan dilaporkan sebagai temuan palsu.
      if (approvalModuleEnabled && have('approval_steps') && !approved) {
        out.push(makeItem({
          kind: 'missing_evidence',
          sub: 'pr_approved_no_step',
          severity: 'warning',
          refType: 'purchase_request',
          refId: pr.id,
          refText: refLabel(pr, 'PR'),
          title: `${refLabel(pr, 'PR')} berstatus APPROVED tanpa langkah approval`,
          detail: 'Status disetujui tidak punya baris approval_steps yang mendukung — tidak jelas siapa yang menyetujui.',
          evidenceMissing: ['approval_steps'],
          actionHint: 'Periksa modul Approval; lengkapi catatan putusan.',
          meta: { status: norm(pr.status) }
        }))
      }
      // PR disetujui tetapi tidak punya SATU pun baris item: tidak akan pernah
      // bisa dibeli, dan tidak akan pernah muncul di tab "Siap Dibeli".
      // Tanpa pemeriksaan ini, PR seperti itu hilang dari semua radar.
      if (have('pr_items') && !itemsByPr.get(pr.id)) {
        out.push(makeItem({
          kind: 'missing_evidence',
          sub: 'pr_approved_no_items',
          severity: 'warning',
          refType: 'purchase_request',
          refId: pr.id,
          refText: refLabel(pr, 'PR'),
          title: `${refLabel(pr, 'PR')} disetujui tetapi tidak punya item`,
          detail: 'Tidak ada baris pr_items — barang tidak bisa dibeli dan PR ini tidak akan muncul di tab "Siap Dibeli".',
          evidenceMissing: ['pr_items'],
          actionHint: 'Lengkapi item PR, atau kembalikan ke draft bila pengajuan ini batal.',
          meta: { status: norm(pr.status) }
        }))
      }
    }
  } else {
    skipped.push('purchase_requests')
  }

  // 4) Invoice: LUNAS tanpa bukti bayar, TERKIRIM tanpa kanal.
  if (have('sales_invoices')) {
    for (const inv of arr(dataset.sales_invoices)) {
      const status = norm(inv.status)
      const label = text(inv.invoice_no) || text(inv.id)
      if (status === 'LUNAS') {
        const missing = []
        if (!inv.paid_at) missing.push('paid_at')
        if (!text(inv.payment_ref)) missing.push('payment_ref')
        if (!inv.payment_verified_by) missing.push('payment_verified_by')
        if (missing.length) {
          out.push(makeItem({
            kind: 'missing_evidence',
            sub: 'invoice_paid_no_proof',
            severity: 'critical',
            refType: 'sales_invoice',
            refId: inv.id,
            refText: label,
            title: `Invoice ${label} LUNAS tanpa bukti pembayaran`,
            detail: `Field bukti kosong: ${missing.join(', ')}.`,
            evidenceMissing: missing,
            actionHint: 'Lengkapi bukti pembayaran; status LUNAS tanpa bukti tidak sah.',
            meta: { status }
          }))
        }
      }
      if (status === 'TERKIRIM' && !text(inv.sent_channel)) {
        out.push(makeItem({
          kind: 'missing_evidence',
          sub: 'invoice_sent_no_channel',
          severity: 'warning',
          refType: 'sales_invoice',
          refId: inv.id,
          refText: label,
          title: `Invoice ${label} TERKIRIM tanpa kanal pengiriman`,
          detail: 'Status terkirim tanpa bukti kanal (WhatsApp/email/cetak/kurir).',
          evidenceMissing: ['sent_channel'],
          actionHint: 'Catat kanal pengiriman dokumen.',
          meta: { status }
        }))
      }
    }
  } else {
    skipped.push('sales_invoices')
  }

  return { items: out, skipped }
}

// ------------------------------------------------------------
// 6. ORKESTRASI LAPORAN
// ------------------------------------------------------------
export function summarize(items) {
  const byKind = {}
  const bySeverity = { critical: 0, warning: 0, info: 0 }
  for (const it of items) {
    byKind[it.kind] = (byKind[it.kind] || 0) + 1
    if (bySeverity[it.severity] === undefined) bySeverity[it.severity] = 0
    bySeverity[it.severity] += 1
  }
  const ages = items.map(i => (typeof i.age_days === 'number' ? i.age_days : null)).filter(v => v !== null)
  return {
    total: items.length,
    by_kind: byKind,
    by_severity: bySeverity,
    oldest_age_days: ages.length ? Math.max(...ages) : null
  }
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const ra = SEVERITY_RANK[a.severity] === undefined ? 9 : SEVERITY_RANK[a.severity]
    const rb = SEVERITY_RANK[b.severity] === undefined ? 9 : SEVERITY_RANK[b.severity]
    if (ra !== rb) return ra - rb
    const aa = typeof a.age_days === 'number' ? a.age_days : -1
    const ab = typeof b.age_days === 'number' ? b.age_days : -1
    if (aa !== ab) return ab - aa
    return String(a.id).localeCompare(String(b.id))
  })
}

// buildReport({ dataset, sources, thresholds, asOf, kinds }) -> laporan lengkap
// `sources` = daftar status per tabel dari collect.js:
//   [{ key, table, available, row_count, error_code, error_message, truncated }]
export function buildReport({
  dataset = {},
  sources = [],
  thresholds = DEFAULT_THRESHOLDS,
  thresholdSources = {},
  rejectedThresholds = [],
  asOf = null,
  kinds = null,
  generatedAt = null,
  limit = null,
  // Parameter UJI saja: default SELALU mengikuti kebijakan terpusat. Pemanggil
  // produksi (handler/CLI) tidak pernah mengirimnya, jadi tidak ada jalan
  // bypass di aplikasi. Dipakai harness untuk tetap menguji aturan approval
  // yang kodenya sengaja dipertahankan (reversible).
  approvalModuleEnabled = APPROVAL_MODULE_ENABLED
} = {}) {
  const asOfDate = toDateOnly(asOf) || todayISO()
  const sourcesAvailable = Object.fromEntries(arr(sources).map(s => [s.key, !!s.available]))
  const requested = Array.isArray(kinds) && kinds.length ? kinds : KINDS.map(k => k.key)

  const blocked = []
  const unknownKinds = requested.filter(k => !KIND_BY_KEY[k])
  const activeKinds = requested.filter(k => KIND_BY_KEY[k])

  for (const key of activeKinds) {
    const def = KIND_BY_KEY[key]
    // t_50b783de: jenis khusus approval tidak dievaluasi saat modul Approval
    // dimatikan — dilaporkan sebagai DISABLED (bukan "0 temuan"/bersih).
    if (def.requiresApprovalModule && !approvalModuleEnabled) {
      blocked.push({
        kind: key,
        label: def.label,
        missing_sources: [],
        disabled_by_policy: true,
        reason: 'Modul Approval purchasing dinonaktifkan sementara — jenis reminder ini tidak dievaluasi (bukan berarti bersih).'
      })
      continue
    }
    const missing = def.required.filter(s => sourcesAvailable[s] === false)
    if (missing.length) {
      blocked.push({
        kind: key,
        label: def.label,
        missing_sources: missing,
        reason: `Sumber data ${missing.join(', ')} tidak tersedia — jenis ini TIDAK dievaluasi (bukan berarti bersih).`
      })
    }
  }
  const blockedKeys = new Set(blocked.map(b => b.kind))

  // Saat Approval OFF, `approval_steps` tidak dibaca (collect.js) sehingga
  // sumbernya dilaporkan tidak tersedia. Itu BUKAN degradasi data: jangan
  // menandai laporan "degraded" hanya karena satu sumber yang sengaja mati.
  const policyDisabledSources = approvalModuleEnabled ? [] : ['approval_steps']
  const unavailable = arr(sources).filter(s => !s.available && !policyDisabledSources.includes(s.key))

  const ctx = { dataset, thresholds, asOf: asOfDate, sourcesAvailable, approvalAvailable: sourcesAvailable.approval_steps, approvalModuleEnabled }
  const collected = []

  if (activeKinds.includes('pr_overdue_approval') && !blockedKeys.has('pr_overdue_approval')) {
    collected.push(...rulePrOverdueApproval(ctx))
  }
  if (activeKinds.includes('pr_draft_stale') && !blockedKeys.has('pr_draft_stale')) {
    collected.push(...rulePrDraftStale(ctx))
  }
  if (activeKinds.includes('purchase_pending_delivery') && !blockedKeys.has('purchase_pending_delivery')) {
    collected.push(...rulePurchasePendingDelivery(ctx))
  }
  if (activeKinds.includes('handover_pending') && !blockedKeys.has('handover_pending')) {
    collected.push(...ruleHandoverPending(ctx))
  }
  if (activeKinds.includes('invoice_due') && !blockedKeys.has('invoice_due')) {
    collected.push(...ruleInvoiceDue(ctx))
  }
  if (activeKinds.includes('invoice_draft_stale') && !blockedKeys.has('invoice_draft_stale')) {
    collected.push(...ruleInvoiceDraftStale(ctx))
  }

  let evidenceSkipped = []
  if (activeKinds.includes('missing_evidence') && !blockedKeys.has('missing_evidence')) {
    const r = ruleMissingEvidence(ctx)
    collected.push(...r.items)
    evidenceSkipped = r.skipped
  }

  const items = sortItems(collected)
  const summary = summarize(items)
  const truncated = arr(sources).filter(s => s.truncated)

  const notes = []
  if (unavailable.length) {
    notes.push(`Sumber data tidak tersedia: ${unavailable.map(s => `${s.key}${s.error_code ? ` (${s.error_code})` : ''}`).join(', ')}. Jenis reminder yang bergantung padanya dilaporkan BLOCKED.`)
  }
  // t_50b783de: sumber yang sengaja tidak dibaca dilaporkan terpisah — jujur,
  // bukan error dan bukan "0 baris".
  const skippedByPolicy = arr(sources).filter(s => s.skipped_by_policy)
  if (skippedByPolicy.length) {
    notes.push(`Sumber dilewati karena kebijakan Approval OFF: ${skippedByPolicy.map(s => s.key).join(', ')}. Tabel tidak dibaca dan jenis reminder khusus approval tidak dievaluasi.`)
  }
  if (evidenceSkipped.length) {
    notes.push(`Pemeriksaan bukti dilewati karena sumber tidak tersedia: ${[...new Set(evidenceSkipped)].join(', ')}.`)
  }
  if (truncated.length) {
    notes.push(`Data mungkin terpotong pada: ${truncated.map(s => s.key).join(', ')} (batas ${limit || '—'} baris per tabel). Angka bisa lebih besar dari yang terlihat.`)
  }
  if (rejectedThresholds.length) {
    notes.push(`Ambang diabaikan (harus angka ${THRESHOLD_MIN}–${THRESHOLD_MAX} hari): ${rejectedThresholds.map(r => `${r.key}=${r.value} (${r.from})`).join(', ')}.`)
  }
  // Handoff S4: data invoice bisa ada di DUA backend. Laporan WAJIB
  // membedakan data durable (Supabase) dari pratinjau file lokal, supaya
  // tidak ada yang memakai pratinjau untuk keputusan penagihan nyata.
  const invoiceSource = arr(sources).find(s => s.key === 'sales_invoices')
  if (invoiceSource && invoiceSource.preview && invoiceSource.preview.exists) {
    notes.push(`File pratinjau invoice lokal terdeteksi (${invoiceSource.preview.relative_path}, ${invoiceSource.preview.rows} baris) tetapi TIDAK durable — tidak dipakai sebagai dasar reminder penagihan.`)
  }
  if (invoiceSource && invoiceSource.available) {
    notes.push('Sumber invoice berasal dari Supabase (durable).')
  }
  if (unknownKinds.length) {
    notes.push(`Jenis reminder tidak dikenal diabaikan: ${unknownKinds.join(', ')}.`)
  }

  const dataReady = unavailable.length === 0
  const status = unavailable.length === 0 ? 'ok' : (arr(sources).some(s => s.available) ? 'degraded' : 'unavailable')

  return {
    ok: true,
    // Dua penanda ini adalah inti keamanan lapisan ini: laporan tidak pernah
    // mengirim apa pun dan tidak pernah menulis apa pun.
    dry_run: true,
    read_only: true,
    side_effects: {
      outbound_send: false,
      payment: false,
      cron_mutation: false,
      write_queries: 0,
      status_changes: 0
    },
    generated_at: generatedAt || new Date().toISOString(),
    as_of: asOfDate,
    data_ready: dataReady,
    status,
    thresholds,
    threshold_sources: thresholdSources,
    rejected_thresholds: rejectedThresholds,
    sources: arr(sources),
    kinds: activeKinds.map(k => {
      const def = KIND_BY_KEY[k]
      return {
        key: def.key,
        label: def.label,
        severity: def.severity,
        threshold_key: def.threshold,
        threshold_days: def.threshold ? thresholds[def.threshold] : null,
        required_sources: def.required,
        blocked: blockedKeys.has(k),
        found: summary.by_kind[k] || 0
      }
    }),
    blocked,
    summary,
    items,
    notes
  }
}

// ------------------------------------------------------------
// 7. RENDER TEKS (dipakai ?format=text dan CLI)
// ------------------------------------------------------------
function pad(s, n) {
  const v = String(s === null || s === undefined ? '' : s)
  return v.length >= n ? v : v + ' '.repeat(n - v.length)
}

export function renderText(report) {
  const L = []
  L.push('LAPORAN REMINDER OPERASIONAL (DRY-RUN · READ-ONLY)')
  L.push(`Dibuat        : ${report.generated_at}`)
  L.push(`Per tanggal   : ${report.as_of}`)
  L.push(`Status data   : ${String(report.status || '').toUpperCase()}${report.data_ready ? ' (semua sumber tersedia)' : ' (ada sumber tidak tersedia)'}`)
  L.push('Efek samping  : tidak ada pengiriman keluar · tidak ada pembayaran · tidak ada perubahan cron/status')
  L.push('')
  L.push('SUMBER DATA')
  const width = Math.max(12, ...(report.sources || []).map(s => String(s.key).length))
  if (!(report.sources || []).length) L.push('  (tidak ada sumber yang diperiksa)')
  for (const s of report.sources || []) {
    const state = s.skipped_by_policy ? 'DILEWATI' : (s.available ? 'TERSEDIA' : 'TIDAK   ')
    let extra = s.skipped_by_policy
      ? 'sengaja tidak dibaca (modul Approval dinonaktifkan)'
      : (s.available
        ? `${s.row_count} baris${s.truncated ? ' (TERPOTONG)' : ''}`
        : `${s.error_code || 'ERROR'} — ${s.error_message || 'tidak bisa dibaca'}`)
    if (s.key === 'sales_invoices' && s.durable !== undefined) {
      extra += s.durable ? ' · durable (Supabase)' : ' · TIDAK durable'
    }
    if (s.preview && s.preview.exists) {
      extra += ` · pratinjau lokal ${s.preview.rows} baris (tidak dipakai)`
    }
    L.push(`  ${state} ${pad(s.key, width)}  ${extra}`)
  }
  L.push('')
  L.push('AMBANG BATAS (HARI)')
  for (const [key, val] of Object.entries(report.thresholds || {})) {
    const src = (report.threshold_sources || {})[key] || 'default'
    L.push(`  ${pad(key, 26)} ${pad(val, 4)} (${src})`)
  }
  L.push('')
  const sum = report.summary || { total: 0, by_severity: {}, by_kind: {} }
  L.push(`RINGKASAN: ${sum.total} reminder — ${sum.by_severity.critical || 0} critical, ${sum.by_severity.warning || 0} warning, ${sum.by_severity.info || 0} info`)
  for (const k of report.kinds || []) {
    const state = k.blocked ? 'BLOCKED' : `${k.found} temuan`
    L.push(`  ${pad(k.key, 28)} ${state}`)
  }
  if ((report.blocked || []).length) {
    L.push('')
    L.push('JENIS YANG TIDAK BISA DINILAI (BLOCKED)')
    for (const b of report.blocked) L.push(`  ${b.kind}: ${b.reason}`)
  }
  if ((report.notes || []).length) {
    L.push('')
    L.push('CATATAN')
    for (const n of report.notes) L.push(`  - ${n}`)
  }
  L.push('')
  L.push('RINCIAN')
  if (!(report.items || []).length) {
    L.push('  (tidak ada reminder pada ambang yang berlaku)')
  }
  for (const it of report.items || []) {
    const sev = String(it.severity || '').toUpperCase()
    L.push(`  [${pad(sev, 8)}] ${it.kind}${it.entity && it.entity.ref ? ` · ${it.entity.ref}` : ''}`)
    L.push(`             ${it.title}`)
    if (it.detail) L.push(`             ${it.detail}`)
    const bits = []
    if (typeof it.age_days === 'number') bits.push(`umur ${it.age_days} hari`)
    if (it.due_date) bits.push(`jatuh tempo ${it.due_date}`)
    if (it.evidence_missing && it.evidence_missing.length) bits.push(`bukti kurang: ${it.evidence_missing.join(', ')}`)
    if (bits.length) L.push(`             ${bits.join(' · ')}`)
    if (it.action_hint) L.push(`             → ${it.action_hint}`)
  }
  L.push('')
  L.push('Tidak ada pesan yang dikirim, tidak ada pembayaran, tidak ada jadwal/cron yang diubah.')
  return L.join('\n')
}
