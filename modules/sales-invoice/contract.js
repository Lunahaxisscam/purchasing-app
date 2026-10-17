// ============================================================
// modules/sales-invoice/contract.js — KONTRAK DATA & ATURAN INVOICE PENJUALAN
// ============================================================
// SATU-SATUNYA sumber kebenaran untuk:
//   1) batas DRAFT → TERBIT → TERKIRIM → LUNAS (mesin transisi status),
//   2) format & parsing nomor invoice (INV/NL/YYYY/MM/NNN),
//   3) penomoran proyek (advisory di klien, OTORITATIF di server),
//   4) normalisasi + validasi payload (nilai uang TIDAK dipercaya dari
//      klien: tax_amount & grand_total selalu dihitung ulang),
//   5) bentuk record kanonik (composeInvoice) yang dipakai semua store.
//
// File ini murni (tanpa import node/browser) supaya dipakai bersama oleh
// pages/api/sales-invoices.js (otoritatif), modul UI, dan harness.
//
// Lihat docs/sales-invoice-contract.md untuk handoff Supabase kanonik.
// ============================================================

export const SCHEMA_VERSION = 3

// ---------- 1. STATUS ----------
// DRAFT    : belum terbit. TIDAK punya nomor invoice, TIDAK menerbitkan
//            nomor proyek, isinya masih boleh diubah, boleh dibuang.
// TERBIT   : titik "issued". Nomor invoice + (opsional) nomor proyek
//            direservasi. Isi finansial BEKU setelah ini.
//            TERBIT ≠ terkirim ke klien.
// TERKIRIM : admin menyatakan dokumen BENAR-BENAR sudah dikirim ke klien
//            (aksi eksplisit + bukti kanal). Tidak pernah otomatis.
// DISETUJUI: klien menyetujui dokumen (bukan berarti dibayar).
// DITOLAK  : klien menolak; koreksi = BATAL + terbit invoice baru.
// LUNAS    : WAJIB bukti pembayaran terverifikasi (nominal + referensi +
//            verifikator). Tanpa itu server menolak.
// BATAL    : final. Nomor invoice tetap terpakai (tidak didaur ulang).
export const DRAFT_STATUS = 'DRAFT'
export const ISSUED_STATUS = 'TERBIT'
export const ALL_STATUSES = Object.freeze([
  'DRAFT', 'TERBIT', 'TERKIRIM', 'DISETUJUI', 'DITOLAK', 'LUNAS', 'BATAL'
])
// Status yang berarti "dokumen resmi sudah punya nomor".
export const ISSUED_STATUSES = Object.freeze(['TERBIT', 'TERKIRIM', 'DISETUJUI', 'DITOLAK', 'LUNAS'])
export const TERMINAL_STATUSES = Object.freeze(['LUNAS', 'BATAL'])
// Status yang menuntut bukti pembayaran terverifikasi.
export const PAYMENT_REQUIRED_STATUSES = Object.freeze(['LUNAS'])

// Transisi yang DIIZINKAN. Yang tidak ada di daftar = ditolak (409).
// Sengaja TIDAK ada DRAFT → TERKIRIM / DRAFT → LUNAS: dokumen yang belum
// terbit tidak boleh dianggap terkirim atau dibayar.
// TERBIT → LUNAS diizinkan karena klien bisa membayar sebelum admin sempat
// mencatat pengiriman (mis. bayar langsung di studio); gerbang sebenarnya
// untuk LUNAS adalah BUKTI pembayaran, bukan status pengiriman.
export const STATUS_TRANSITIONS = Object.freeze({
  DRAFT: Object.freeze(['TERBIT', 'BATAL']),
  TERBIT: Object.freeze(['TERKIRIM', 'LUNAS', 'BATAL']),
  TERKIRIM: Object.freeze(['DISETUJUI', 'DITOLAK', 'LUNAS', 'BATAL']),
  DISETUJUI: Object.freeze(['LUNAS', 'BATAL']),
  DITOLAK: Object.freeze(['BATAL']),
  LUNAS: Object.freeze([]),
  BATAL: Object.freeze([])
})

// Aksi yang butuh bukti tambahan (divalidasi server, bukan UI).
export const EVIDENCE_REQUIREMENTS = Object.freeze({
  TERKIRIM: Object.freeze(['sent_channel']),
  LUNAS: Object.freeze(['paid_amount', 'paid_at', 'payment_ref', 'verified_by'])
})

export function normalizeStatus(status) {
  return String(status == null ? '' : status).trim().toUpperCase()
}

export function isKnownStatus(status) {
  return ALL_STATUSES.includes(normalizeStatus(status))
}

export function isDraftStatus(status) {
  return normalizeStatus(status) === DRAFT_STATUS
}

export function isIssuedStatus(status) {
  return ISSUED_STATUSES.includes(normalizeStatus(status))
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(normalizeStatus(status))
}

export function allowedTransitions(status) {
  return STATUS_TRANSITIONS[normalizeStatus(status)] || []
}

// Hasil: { ok:true } | { ok:false, code, message }
export function checkTransition(from, to) {
  const f = normalizeStatus(from)
  const t = normalizeStatus(to)
  if (!ALL_STATUSES.includes(f)) {
    return { ok: false, code: 'UNKNOWN_CURRENT_STATUS', message: `Status invoice saat ini tidak dikenal: "${from}".` }
  }
  if (!ALL_STATUSES.includes(t)) {
    return { ok: false, code: 'UNKNOWN_TARGET_STATUS', message: `Status tujuan tidak dikenal: "${to}".` }
  }
  if (f === t) {
    return { ok: false, code: 'NOOP_TRANSITION', message: `Invoice sudah berstatus ${t}.` }
  }
  if (TERMINAL_STATUSES.includes(f)) {
    return { ok: false, code: 'TERMINAL_STATUS', message: `Invoice berstatus ${f} bersifat final dan tidak bisa diubah lagi.` }
  }
  if (!STATUS_TRANSITIONS[f].includes(t)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      message: `Transisi ${f} → ${t} tidak diizinkan. Dari ${f} hanya boleh ke: ${STATUS_TRANSITIONS[f].join(', ') || '(tidak ada)'}.`
    }
  }
  return { ok: true }
}

// ---------- 2. NOMOR INVOICE ----------
// Format kanonik: INV/NL/<tahun 4>/<bulan 2>/<urut >=3 digit>.
// Nomor hanya dialokasikan SERVER saat invoice TERBIT (DRAFT tidak punya nomor).
export const INVOICE_NO_PATTERN = /^INV\/NL\/(\d{4})\/(\d{2})\/(\d{3,6})$/

export function invoicePeriod(dateISO) {
  const raw = String(dateISO || '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (m) return `${m[1]}-${m[2]}`
  const d = raw ? new Date(raw) : new Date()
  const safe = isNaN(d.getTime()) ? new Date() : d
  return `${safe.getUTCFullYear()}-${String(safe.getUTCMonth() + 1).padStart(2, '0')}`
}

export function formatInvoiceNo(period, seq) {
  const p = String(period || '').trim()
  const m = /^(\d{4})-(\d{2})$/.exec(p)
  if (!m) throw new Error(`Periode invoice tidak valid: "${period}" (harus YYYY-MM).`)
  const n = Number(seq)
  if (!Number.isInteger(n) || n < 1) throw new Error(`Urutan invoice tidak valid: "${seq}".`)
  return `INV/NL/${m[1]}/${m[2]}/${String(n).padStart(3, '0')}`
}

export function parseInvoiceNo(invoiceNo) {
  const m = INVOICE_NO_PATTERN.exec(String(invoiceNo || '').trim())
  if (!m) return null
  return { period: `${m[1]}-${m[2]}`, year: Number(m[1]), month: Number(m[2]), seq: Number(m[3]) }
}

// Urutan berikutnya = max(seq) + 1 dari invoice yang SUDAH terbit pada
// periode yang sama. Draft tidak dihitung (draft memang tidak punya nomor).
export function nextSequenceFromExisting(invoices, period) {
  const p = String(period || '').trim()
  let max = 0
  for (const inv of Array.isArray(invoices) ? invoices : []) {
    const parsed = parseInvoiceNo(inv && inv.invoice_no)
    if (!parsed || parsed.period !== p) continue
    if (parsed.seq > max) max = parsed.seq
  }
  return max + 1
}

// ---------- 3. NOMOR PROYEK ----------
export function nextNumericProjectCode(projects = []) {
  if (!Array.isArray(projects) || projects.length === 0) return '106'
  let max = 0
  for (const p of projects) {
    const raw = String((p && (p.kode ?? p.code)) ?? '').trim()
    if (!/^\d+$/.test(raw)) continue
    const n = parseInt(raw, 10)
    if (Number.isInteger(n) && n > max) max = n
  }
  return max > 0 ? String(max + 1) : '106'
}

export function isProjectCodeTaken(projects = [], code) {
  const c = String(code == null ? '' : code).trim().toLowerCase()
  if (!c) return false
  return (Array.isArray(projects) ? projects : []).some(
    p => String((p && (p.kode ?? p.code)) ?? '').trim().toLowerCase() === c
  )
}

// ---------- 4. VALIDASI / NORMALISASI PAYLOAD ----------
export const LIMITS = Object.freeze({
  customer_name: 120,
  customer_phone: 40,
  project_address: 200,
  project_name: 120,
  rab_reff: 80,
  notes: 500,
  payment_terms: 120,
  project_code: 20,
  invoice_no: 40,
  sent_channel: 40,
  payment_ref: 80
})

export const PROJECT_MODES = Object.freeze(['new', 'existing', 'none'])
// Pembuatan invoice SELALU bermula sebagai DRAFT. Penerbitan (TERBIT) adalah
// aksi terpisah supaya nomor invoice & nomor proyek tidak pernah terpakai
// untuk dokumen yang ternyata gagal disimpan.
export const CREATE_INITIAL_STATUS = DRAFT_STATUS
export const MAX_AMOUNT = 1e15

function text(value, max) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) : s
}

function amount(value) {
  const n = Number(value)
  if (!isFinite(n)) return NaN
  return Math.round(n)
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim()) && !isNaN(new Date(String(value)).getTime())
}

// normalizeNewInvoice(body) -> { ok, errors:[{field,code,message}], value }
// Aturan uang: nominal WAJIB > 0; tax_rate 0..100; tax_amount & grand_total
// DIHITUNG ULANG di server (kiriman klien diabaikan).
// Status awal SELALU DRAFT — mengirim status lain saat POST ditolak, bukan
// diam-diam diturunkan, supaya klien tahu kontraknya.
export function normalizeNewInvoice(body = {}) {
  const errors = []
  const push = (field, code, message) => errors.push({ field, code, message })
  const b = body && typeof body === 'object' ? body : {}

  if (b.status !== undefined && b.status !== null && String(b.status).trim() !== '') {
    const s = normalizeStatus(b.status)
    if (s !== DRAFT_STATUS) {
      push(
        'status',
        'INITIAL_STATUS_MUST_BE_DRAFT',
        `Invoice baru selalu dibuat sebagai ${DRAFT_STATUS}. Penerbitan (${ISSUED_STATUS}) adalah aksi terpisah (PATCH status).`
      )
    }
  }
  // Nomor invoice TIDAK boleh ditentukan klien — dialokasikan server saat TERBIT.
  if (b.invoice_no !== undefined && String(b.invoice_no || '').trim() !== '') {
    push('invoice_no', 'INVOICE_NO_SERVER_ASSIGNED', 'Nomor invoice dialokasikan otomatis oleh server saat penerbitan; jangan dikirim dari klien.')
  }

  const customerName = text(b.customer_name, LIMITS.customer_name)
  if (!customerName) push('customer_name', 'REQUIRED', 'Nama customer (CRM) wajib diisi.')

  const nominal = amount(b.nominal)
  if (!isFinite(nominal) || nominal <= 0) {
    push('nominal', 'INVALID_AMOUNT', 'Nominal tagihan harus berupa angka lebih besar dari 0.')
  } else if (nominal > MAX_AMOUNT) {
    push('nominal', 'AMOUNT_TOO_LARGE', 'Nominal tagihan melebihi batas wajar.')
  }

  const taxRateRaw = b.tax_rate == null || b.tax_rate === '' ? 0 : Number(b.tax_rate)
  const taxRate = isFinite(taxRateRaw) ? Math.round(taxRateRaw * 100) / 100 : NaN
  if (!isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    push('tax_rate', 'INVALID_TAX_RATE', 'Tarif PPN harus di antara 0 dan 100 persen.')
  }

  const issueDate = String(b.issue_date || '').trim() || new Date().toISOString().slice(0, 10)
  if (!isIsoDate(issueDate)) push('issue_date', 'INVALID_DATE', 'Tanggal terbit harus format YYYY-MM-DD.')

  const dueDate = String(b.due_date || '').trim()
  if (dueDate && !isIsoDate(dueDate)) {
    push('due_date', 'INVALID_DATE', 'Tanggal jatuh tempo harus format YYYY-MM-DD.')
  } else if (dueDate && isIsoDate(issueDate) && dueDate < issueDate) {
    push('due_date', 'DUE_BEFORE_ISSUE', 'Jatuh tempo tidak boleh lebih awal dari tanggal terbit.')
  }

  const rawIntent = b.project_intent && typeof b.project_intent === 'object' ? b.project_intent : {}
  const mode = String(rawIntent.mode || b.project_mode || '').trim() ||
    (b.project_id ? 'existing' : (b.project_code ? 'new' : 'none'))
  if (!PROJECT_MODES.includes(mode)) {
    push('project_intent.mode', 'INVALID_PROJECT_MODE', `Mode proyek harus salah satu dari: ${PROJECT_MODES.join(', ')}.`)
  }
  const projectCode = text(rawIntent.code ?? b.project_code, LIMITS.project_code)
  const projectId = String(rawIntent.project_id ?? b.project_id ?? '').trim()
  if (mode === 'existing' && !projectId) {
    push('project_intent.project_id', 'REQUIRED', 'Pilih proyek existing yang akan ditautkan.')
  }
  if (mode === 'new' && projectCode && !/^[0-9A-Za-z._/-]+$/.test(projectCode)) {
    push('project_intent.code', 'INVALID_PROJECT_CODE', 'Nomor proyek hanya boleh huruf, angka, titik, garis miring, strip.')
  }

  const value = {
    customer_name: customerName,
    customer_phone: text(b.customer_phone, LIMITS.customer_phone),
    project_address: text(b.project_address, LIMITS.project_address),
    project_name: text(b.project_name, LIMITS.project_name),
    rab_reff: text(b.rab_reff, LIMITS.rab_reff),
    notes: text(b.notes, LIMITS.notes),
    payment_terms: text(b.payment_terms, LIMITS.payment_terms),
    nominal: isFinite(nominal) ? nominal : 0,
    tax_rate: isFinite(taxRate) ? taxRate : 0,
    tax_amount: 0,
    grand_total: 0,
    issue_date: issueDate,
    due_date: dueDate,
    status: DRAFT_STATUS,
    project_intent: { mode: PROJECT_MODES.includes(mode) ? mode : 'none', code: projectCode, project_id: projectId }
  }
  if (isFinite(nominal) && nominal > 0 && isFinite(taxRate) && taxRate >= 0 && taxRate <= 100) {
    value.tax_amount = Math.round(nominal * (taxRate / 100))
    value.grand_total = value.nominal + value.tax_amount
  }

  return { ok: errors.length === 0, errors, value }
}

// normalizeTransition(body) -> { ok, errors, value:{ id, to, patch, evidence } }
// Draf boleh diubah isinya; invoice TERBIT hanya boleh pindah status.
// Bukti (evidence) wajib untuk TERKIRIM dan LUNAS — divalidasi di sini supaya
// UI, API, dan harness memakai aturan yang sama.
export function normalizeTransition(body = {}) {
  const errors = []
  const push = (field, code, message) => errors.push({ field, code, message })
  const b = body && typeof body === 'object' ? body : {}
  const id = String(b.id || '').trim()
  if (!id) push('id', 'REQUIRED', 'ID invoice wajib diisi.')

  const to = normalizeStatus(b.status || b.to)
  if (!to) push('status', 'REQUIRED', 'Status tujuan wajib diisi.')
  else if (!ALL_STATUSES.includes(to)) {
    push('status', 'UNKNOWN_TARGET_STATUS', `Status tujuan tidak dikenal: "${b.status}".`)
  }

  const fields = b.fields && typeof b.fields === 'object' ? b.fields : null
  let patch = null
  if (fields) {
    patch = {}
    if (fields.customer_name !== undefined) {
      const v = text(fields.customer_name, LIMITS.customer_name)
      if (!v) push('fields.customer_name', 'REQUIRED', 'Nama customer tidak boleh kosong.')
      else patch.customer_name = v
    }
    if (fields.customer_phone !== undefined) patch.customer_phone = text(fields.customer_phone, LIMITS.customer_phone)
    if (fields.project_address !== undefined) patch.project_address = text(fields.project_address, LIMITS.project_address)
    if (fields.project_name !== undefined) patch.project_name = text(fields.project_name, LIMITS.project_name)
    if (fields.rab_reff !== undefined) patch.rab_reff = text(fields.rab_reff, LIMITS.rab_reff)
    if (fields.notes !== undefined) patch.notes = text(fields.notes, LIMITS.notes)
    if (fields.payment_terms !== undefined) patch.payment_terms = text(fields.payment_terms, LIMITS.payment_terms)
    if (fields.nominal !== undefined) {
      const n = amount(fields.nominal)
      if (!isFinite(n) || n <= 0) push('fields.nominal', 'INVALID_AMOUNT', 'Nominal tagihan harus lebih besar dari 0.')
      else patch.nominal = n
    }
    if (fields.tax_rate !== undefined) {
      const r = Number(fields.tax_rate)
      if (!isFinite(r) || r < 0 || r > 100) push('fields.tax_rate', 'INVALID_TAX_RATE', 'Tarif PPN harus di antara 0 dan 100.')
      else patch.tax_rate = Math.round(r * 100) / 100
    }
    if (fields.issue_date !== undefined) {
      if (!isIsoDate(fields.issue_date)) push('fields.issue_date', 'INVALID_DATE', 'Tanggal terbit harus format YYYY-MM-DD.')
      else patch.issue_date = String(fields.issue_date).trim()
    }
    if (fields.due_date !== undefined) {
      const d = String(fields.due_date || '').trim()
      if (d && !isIsoDate(d)) push('fields.due_date', 'INVALID_DATE', 'Jatuh tempo harus format YYYY-MM-DD.')
      else patch.due_date = d
    }
    if (Object.keys(patch).length === 0) patch = null
  }

  const rawEvidence = b.evidence && typeof b.evidence === 'object' ? b.evidence : {}
  const evidence = {}

  if (to === 'TERKIRIM') {
    const channel = text(rawEvidence.sent_channel, LIMITS.sent_channel)
    if (!channel) {
      push('evidence.sent_channel', 'EVIDENCE_REQUIRED', 'Sebutkan kanal pengiriman yang benar-benar dipakai (mis. WhatsApp, email, cetak/serah langsung) sebelum menandai terkirim.')
    } else {
      evidence.sent_channel = channel
    }
  }

  if (to === 'LUNAS') {
    const paidAmount = amount(rawEvidence.paid_amount)
    if (!isFinite(paidAmount) || paidAmount <= 0) {
      push('evidence.paid_amount', 'EVIDENCE_REQUIRED', 'Nominal pembayaran yang benar-benar diterima wajib diisi.')
    }
    const paidAt = String(rawEvidence.paid_at || '').trim()
    if (!isIsoDate(paidAt)) {
      push('evidence.paid_at', 'EVIDENCE_REQUIRED', 'Tanggal pembayaran diterima wajib diisi (YYYY-MM-DD).')
    }
    const paymentRef = text(rawEvidence.payment_ref, LIMITS.payment_ref)
    if (!paymentRef) {
      push('evidence.payment_ref', 'EVIDENCE_REQUIRED', 'Referensi pembayaran (no. transfer / bukti bayar) wajib diisi.')
    }
    // verified_by SENGAJA tidak diambil dari body: handler mengisinya dari sesi
    // admin yang sudah diverifikasi (lihat pages/api/sales-invoices.js).
    if (isFinite(paidAmount) && paidAmount > 0) {
      evidence.paid_amount = paidAmount
      evidence.paid_at = paidAt
      evidence.payment_ref = paymentRef
    }
  }

  return { ok: errors.length === 0, errors, value: { id, to, patch, evidence } }
}

// ---------- 5. BENTUK RECORD KANONIK ----------
// composeInvoice adalah SATU-SATUNYA tempat field invoice dibentuk, supaya
// store file (pratinjau) dan store Supabase (kanonik) tidak pernah berbeda.
export function composeInvoice(input, opts = {}) {
  const now = opts.now || new Date().toISOString()
  const status = normalizeStatus(opts.status || input.status || DRAFT_STATUS)
  const issued = isIssuedStatus(status)
  const nominal = Number(input.nominal) || 0
  const taxRate = Number(input.tax_rate) || 0
  const taxAmount = Math.round(nominal * (taxRate / 100))
  const intent = input.project_intent || { mode: 'none', code: '', project_id: '' }
  return {
    schema_version: SCHEMA_VERSION,
    id: opts.id,
    status,
    invoice_no: issued ? (opts.invoice_no || null) : null,
    customer_name: input.customer_name || '',
    customer_phone: input.customer_phone || '',
    project_address: input.project_address || '',
    project_name: input.project_name || '',
    project_code: opts.project_code || null,
    project_id: opts.project_id || null,
    project_issued: !!opts.project_issued,
    project_intent: { mode: intent.mode || 'none', code: intent.code || '', project_id: intent.project_id || '' },
    rab_reff: input.rab_reff || '',
    nominal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    grand_total: nominal + taxAmount,
    notes: input.notes || '',
    payment_terms: input.payment_terms || '',
    issue_date: input.issue_date || now.slice(0, 10),
    due_date: input.due_date || '',
    created_at: opts.created_at || now,
    updated_at: now,
    issued_at: issued ? (opts.issued_at || now) : null,
    sent_at: null,
    sent_channel: '',
    paid_at: null,
    paid_amount: null,
    payment_ref: '',
    payment_verified_by: null,
    voided_at: null,
    idempotency_key: opts.idempotency_key || null,
    request_fingerprint: opts.request_fingerprint || null,
    store: opts.store || 'unknown'
  }
}

// Field yang boleh berubah setelah invoice TERBIT (selain status).
// Kosong = dokumen terbit bersifat beku; koreksi harus lewat BATAL + terbit baru.
export const IMMUTABLE_AFTER_ISSUE = Object.freeze([
  'invoice_no', 'nominal', 'tax_rate', 'tax_amount', 'grand_total',
  'customer_name', 'issue_date', 'project_code', 'project_id'
])

export function frozenFieldsTouched(patch = {}) {
  return Object.keys(patch || {}).filter(k => IMMUTABLE_AFTER_ISSUE.includes(k))
}
