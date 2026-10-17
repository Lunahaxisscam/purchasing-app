// ============================================================
// modules/sales-invoice/store.js — LAPISAN PENYIMPANAN INVOICE PENJUALAN
// ============================================================
// SERVER-ONLY (Node). Dipakai pages/api/sales-invoices.js dan harness.
// JANGAN diimpor dari komponen browser.
//
// Dua backend dengan kontrak yang sama:
//
//   1) createSupabaseStore()  — KANONIK. Tabel `sales_invoices` + `projects`.
//      Satu-satunya backend yang boleh jalan di produksi.
//
//   2) createFileStore()      — PRATINJAU LOKAL SAJA (data/sales_invoices.json).
//      Dibatasi: hanya NODE_ENV != production dan hanya bila
//      SALES_INVOICE_STORE tidak memaksa supabase. Di produksi backend ini
//      MENOLAK (fail closed).
//
// ATURAN KERAS (review Brooklyn, P0):
//
//   * TIDAK ADA MUTASI SEBELUM VALIDASI. patchInvoice/issueInvoice menghitung
//     rencana + memvalidasi status/transisi/isi/bukti lebih dulu
//     (preflightIssue / assertTransitionAllowed), baru menulis. Dulu
//     `{to:'TERBIT', fields:{nominal:999}}` pada invoice TERKIRIM menulis
//     nominal 999 DULU lalu gagal NOT_A_DRAFT — respons "gagal" tapi data
//     beku sudah berubah.
//   * Semua update status memakai CAS (compare-and-set) pada status yang
//     diharapkan: `updateIf(id, {status:'DRAFT'}, patch)`. Dua permintaan
//     bersamaan tidak bisa sama-sama menang.
//   * Penerbitan TIDAK transaksional. `atomicSequence` hanya true bila RPC
//     disediakan. Tanpa RPC: nomor dialokasikan max+1 + unique index + retry,
//     proyek ditautkan setelah invoice tersimpan, dan kegagalan tautan
//     dikompensasi best-effort (hapus proyek yang baru dibuat). Semua itu
//     dilaporkan jujur di `capabilities` — bukan klaim transaksional.
//   * `SALES_INVOICE_REQUIRE_RPC=1` → penerbitan fail closed sampai RPC ada.
//
// Lihat docs/sales-invoice-contract.md (§ handoff Supabase & RPC usulan).
// ============================================================

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  DRAFT_STATUS,
  MAX_AMOUNT,
  PROJECT_MODES,
  checkTransition,
  composeInvoice,
  formatInvoiceNoFor,
  invoiceNoPrefix,
  isDraftStatus,
  isIssuedStatus,
  isProjectCodeTaken,
  nextNumericProjectCode,
  nextSequenceForFormat,
  normalizeStatus,
  numberingPeriod,
  parseAnyInvoiceNo,
  resolveInvoiceNumberFormat
} from './contract.js'

export const MAX_NUMBER_ATTEMPTS = 5

// ---------- ERROR BERTIPE ----------
export class StoreError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message)
    this.name = 'StoreError'
    this.code = code
    this.status = status
    Object.assign(this, extra)
  }
}

// ---------- FINGERPRINT (idempotensi) ----------
export function fingerprint(value) {
  const obj = value && typeof value === 'object' ? value : {}
  const keys = Object.keys(obj).sort()
  const canonical = JSON.stringify(obj, keys)
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

function normalizeKey(key) {
  const k = String(key == null ? '' : key).trim()
  if (!k) return null
  if (k.length > 120) throw new StoreError('IDEMPOTENCY_KEY_TOO_LONG', 'Idempotency key terlalu panjang (maks 120 karakter).', 400)
  return k
}

function sameNo(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

function sameCode(project, code) {
  const raw = String((project && (project.kode ?? project.code)) ?? '').trim().toLowerCase()
  return !!raw && raw === String(code || '').trim().toLowerCase()
}

// Normalisasi konfigurasi format nomor: string pendek (untuk harness) atau
// objek hasil resolveInvoiceNumberFormat().
function resolveNumbering(opts = {}) {
  if (opts.numbering && typeof opts.numbering === 'object' && opts.numbering.format !== undefined) return opts.numbering
  if (opts.numberFormat) {
    return resolveInvoiceNumberFormat({ SALES_INVOICE_NO_FORMAT: opts.numberFormat, SALES_INVOICE_NO_FORMAT_ACK: '1' })
  }
  return resolveInvoiceNumberFormat(opts.env || process.env)
}

// ============================================================
// BACKEND 1 — SUPABASE (KANONIK)
// ============================================================
export function createSupabaseStore(client, opts = {}) {
  if (!client || typeof client.from !== 'function') {
    throw new StoreError('STORE_NOT_CONFIGURED', 'Klien Supabase tidak tersedia untuk penyimpanan invoice.', 503)
  }
  const table = opts.table || 'sales_invoices'
  const projectsTable = opts.projectsTable || 'projects'
  const maxAttempts = opts.maxAttempts || MAX_NUMBER_ATTEMPTS
  const numbering = resolveNumbering(opts)
  const requireRpc = !!opts.requireRpc
  const hasIssueRpc = !!opts.hasIssueRpc

  const capabilities = {
    kind: 'supabase',
    durable: true,
    preview: false,
    // JUJUR: sekuens nomor TIDAK atomik kecuali RPC tersedia.
    atomicSequence: hasIssueRpc,
    casIssue: true,
    transactional: hasIssueRpc,
    projectCompensation: 'best-effort',
    projectAllocation: true,
    idempotency: true,
    issueRpc: hasIssueRpc ? (opts.issueRpcName || 'sales_invoice_issue') : null,
    rpcAvailable: hasIssueRpc,
    requireRpc,
    numberFormat: numbering.format,
    note: hasIssueRpc
      ? 'Nomor invoice & proyek dialokasikan dalam satu RPC transaksional.'
      : 'Alokasi nomor: baca max+1 → CAS status DRAFT→TERBIT → unique constraint + retry. Proyek ditautkan SETELAH invoice tersimpan; kegagalan tautan dikompensasi best-effort (bukan transaksi).'
  }

  function fail(error, fallbackCode, message) {
    const code = error && (error.code || error.details)
    const text = String((error && error.message) || '')
    if (code === '23505' || /duplicate key|unique constraint/i.test(text)) {
      if (/idempotency/i.test(text)) return new StoreError('DUPLICATE_IDEMPOTENCY_KEY', 'Permintaan dengan idempotency key ini sudah pernah tersimpan.', 409)
      if (/invoice_no/i.test(text)) return new StoreError('DUPLICATE_INVOICE_NO', 'Nomor invoice sudah dipakai (balapan alokasi).', 409)
      if (/kode|code/i.test(text)) return new StoreError('DUPLICATE_PROJECT_CODE', 'Kode proyek sudah dipakai di Master Project.', 409)
      return new StoreError('DUPLICATE_ROW', message || 'Baris dengan nilai unik yang sama sudah ada.', 409)
    }
    if (code === 'PGRST205' || code === '42P01' || /could not find the table|does not exist/i.test(text)) {
      return new StoreError(
        'SCHEMA_UNAVAILABLE',
        `Tabel "${table}" belum ada di Supabase. Migrasi sales_invoices BELUM dijalankan (lihat docs/sales-invoice-contract.md §3).`,
        503,
        { blocker: 'SCHEMA_UNAVAILABLE' }
      )
    }
    return new StoreError(fallbackCode || 'DB_ERROR', text || message || 'Kesalahan database.', 502)
  }

  return {
    kind: 'supabase',
    capabilities,
    numbering,
    maxAttempts,
    async list() {
      const { data, error } = await client.from(table).select('*').order('created_at', { ascending: false })
      if (error) throw fail(error, 'LIST_FAILED', 'Gagal membaca daftar invoice.')
      return Array.isArray(data) ? data : []
    },
    async getById(id) {
      const { data, error } = await client.from(table).select('*').eq('id', id).limit(1)
      if (error) throw fail(error, 'READ_FAILED', 'Gagal membaca invoice.')
      return (data && data[0]) || null
    },
    async findByIdempotencyKey(key) {
      const k = normalizeKey(key)
      if (!k) return null
      const { data, error } = await client.from(table).select('*').eq('idempotency_key', k).limit(1)
      if (error) throw fail(error, 'READ_FAILED', 'Gagal memeriksa idempotency key.')
      return (data && data[0]) || null
    },
    async findByInvoiceNo(invoiceNo) {
      const { data, error } = await client.from(table).select('*').eq('invoice_no', invoiceNo).limit(1)
      if (error) throw fail(error, 'READ_FAILED', 'Gagal memeriksa nomor invoice.')
      return (data && data[0]) || null
    },
    async findByProjectCode(code) {
      const c = String(code || '').trim()
      if (!c) return null
      const { data, error } = await client.from(table).select('*').eq('project_code', c).limit(1)
      if (error) throw fail(error, 'READ_FAILED', 'Gagal memeriksa pemakaian kode proyek pada invoice.')
      return (data && data[0]) || null
    },
    // Nomor invoice yang sudah terpakai pada satu format+periode (dasar alokasi).
    async numbersInPeriod(format, period) {
      const prefix = invoiceNoPrefix(format, period)
      const { data, error } = await client.from(table).select('invoice_no').like('invoice_no', `${prefix}%`)
      if (error) throw fail(error, 'READ_FAILED', 'Gagal membaca nomor invoice periode ini.')
      return Array.isArray(data) ? data : []
    },
    // Kompatibilitas: perilaku lama = format INV/NL per bulan.
    async invoicesInPeriod(period) {
      return this.numbersInPeriod('inv-nl', period)
    },
    async insert(record) {
      const { data, error } = await client.from(table).insert([record]).select()
      if (error) throw fail(error, 'INSERT_FAILED', 'Gagal menyimpan invoice.')
      return (data && data[0]) || record
    },
    async update(id, patch) {
      const { data, error } = await client.from(table).update(patch).eq('id', id).select()
      if (error) throw fail(error, 'UPDATE_FAILED', 'Gagal memperbarui invoice.')
      return (data && data[0]) || null
    },
    // CAS: hanya menulis bila kolom `expected` masih bernilai seperti yang dibaca.
    // Null = kalah balapan (tidak ada baris yang cocok), BUKAN error.
    async updateIf(id, expected, patch) {
      let query = client.from(table).update(patch).eq('id', id)
      for (const [col, val] of Object.entries(expected || {})) query = query.eq(col, val)
      const { data, error } = await query.select()
      if (error) throw fail(error, 'UPDATE_FAILED', 'Gagal memperbarui invoice (CAS).')
      return (data && data[0]) || null
    },
    async listProjects() {
      const { data, error } = await client.from(projectsTable).select('id,kode,code,name,status')
      if (error) throw fail(error, 'PROJECT_READ_FAILED', 'Gagal membaca Master Project.')
      return Array.isArray(data) ? data : []
    },
    async insertProject(project) {
      const { data, error } = await client.from(projectsTable).insert([project]).select()
      if (error) throw fail(error, 'PROJECT_INSERT_FAILED', 'Gagal menerbitkan nomor proyek baru.')
      return (data && data[0]) || project
    },
    // Kompensasi best-effort: hapus proyek yang BARU dibuat dan gagal ditautkan.
    async deleteProject(id) {
      if (!id) throw new StoreError('PROJECT_DELETE_FAILED', 'ID proyek kosong.', 400)
      const { error } = await client.from(projectsTable).delete().eq('id', id)
      if (error) throw fail(error, 'PROJECT_DELETE_FAILED', 'Gagal membatalkan proyek yang gagal ditautkan.')
      return true
    },
    async issueViaRpc(payload) {
      if (!hasIssueRpc) return null
      const { data, error } = await client.rpc(capabilities.issueRpc, payload)
      if (error) throw fail(error, 'ISSUE_RPC_FAILED', 'Gagal menerbitkan invoice lewat RPC.')
      return data
    }
  }
}

// ============================================================
// BACKEND 2 — FILE JSON (PRATINJAU LOKAL, TIDAK DURABLE)
// ============================================================
// Struktur file dipertahankan: array record invoice (kompatibel dengan
// data/sales_invoices.json lama). Idempotency key ikut tersimpan sehingga
// replay tetap terdeteksi setelah server restart.
export function createFileStore(opts = {}) {
  const file = opts.file || path.join(process.cwd(), 'data', 'sales_invoices.json')
  const lockTtlMs = opts.lockTtlMs || 10000
  const lockWaitMs = opts.lockWaitMs || 2000
  const numbering = resolveNumbering(opts)

  function readAll() {
    try {
      if (!fs.existsSync(file)) return []
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch (err) {
      throw new StoreError('PREVIEW_READ_FAILED', `Gagal membaca penyimpanan pratinjau: ${err.message}`, 500)
    }
  }

  function writeAll(rows) {
    const dir = path.dirname(file)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  }

  // Kunci berbasis mkdir supaya dua permintaan bersamaan tidak saling menimpa.
  function withLock(fn) {
    const lockDir = `${file}.lock`
    const started = Date.now()
    for (;;) {
      try {
        fs.mkdirSync(lockDir)
        break
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
        try {
          const age = Date.now() - fs.statSync(lockDir).mtimeMs
          if (age > lockTtlMs) { fs.rmdirSync(lockDir); continue }
        } catch (_) { /* lock hilang sendiri */ }
        if (Date.now() - started > lockWaitMs) {
          throw new StoreError('PREVIEW_LOCK_TIMEOUT', 'Penyimpanan pratinjau sedang dipakai permintaan lain. Coba lagi.', 503)
        }
        const until = Date.now() + 20
        while (Date.now() < until) { /* spin pendek */ }
      }
    }
    try {
      return fn()
    } finally {
      try { fs.rmdirSync(lockDir) } catch (_) { /* ignore */ }
    }
  }

  function matchesExpected(row, expected) {
    return Object.entries(expected || {}).every(([col, val]) => {
      const actual = row[col]
      if (val === null || val === undefined) return actual === null || actual === undefined
      return String(actual) === String(val)
    })
  }

  const capabilities = {
    kind: 'file-preview',
    durable: false,
    preview: true,
    atomicSequence: false,
    casIssue: true,
    transactional: false,
    projectCompensation: 'unsupported',
    projectAllocation: false,
    idempotency: true,
    issueRpc: null,
    rpcAvailable: false,
    requireRpc: !!opts.requireRpc,
    numberFormat: numbering.format,
    note: 'PRATINJAU LOKAL: data hanya ada di file JSON mesin ini, hilang saat deploy/instance baru, dan TIDAK menerbitkan nomor proyek.'
  }

  return {
    kind: 'file-preview',
    capabilities,
    numbering,
    file,
    maxAttempts: MAX_NUMBER_ATTEMPTS,
    async list() {
      return readAll().slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    },
    async getById(id) {
      return readAll().find(r => r.id === id) || null
    },
    async findByIdempotencyKey(key) {
      const k = normalizeKey(key)
      if (!k) return null
      return readAll().find(r => r.idempotency_key === k) || null
    },
    async findByInvoiceNo(invoiceNo) {
      return readAll().find(r => sameNo(r.invoice_no, invoiceNo)) || null
    },
    async findByProjectCode(code) {
      const c = String(code || '').trim().toLowerCase()
      if (!c) return null
      return readAll().find(r => String(r.project_code || '').trim().toLowerCase() === c) || null
    },
    async numbersInPeriod(format, period) {
      return readAll()
        .map(r => ({ invoice_no: r.invoice_no }))
        .filter(r => {
          const p = parseAnyInvoiceNo(r.invoice_no)
          return p && p.format === format && p.period === period
        })
    },
    async invoicesInPeriod(period) {
      return this.numbersInPeriod('inv-nl', period)
    },
    async insert(record) {
      return withLock(() => {
        const rows = readAll()
        if (record.invoice_no && rows.some(r => sameNo(r.invoice_no, record.invoice_no))) {
          throw new StoreError('DUPLICATE_INVOICE_NO', 'Nomor invoice sudah dipakai.', 409)
        }
        if (record.idempotency_key && rows.some(r => r.idempotency_key === record.idempotency_key)) {
          throw new StoreError('DUPLICATE_IDEMPOTENCY_KEY', 'Permintaan dengan idempotency key ini sudah tersimpan.', 409)
        }
        rows.unshift(record)
        writeAll(rows)
        return record
      })
    },
    async update(id, patch) {
      return withLock(() => {
        const rows = readAll()
        const idx = rows.findIndex(r => r.id === id)
        if (idx === -1) throw new StoreError('NOT_FOUND', 'Invoice tidak ditemukan.', 404)
        rows[idx] = { ...rows[idx], ...patch }
        writeAll(rows)
        return rows[idx]
      })
    },
    async updateIf(id, expected, patch) {
      return withLock(() => {
        const rows = readAll()
        const idx = rows.findIndex(r => r.id === id)
        if (idx === -1) return null
        if (!matchesExpected(rows[idx], expected)) return null
        rows[idx] = { ...rows[idx], ...patch }
        writeAll(rows)
        return rows[idx]
      })
    },
    async listProjects() {
      return []
    },
    async insertProject() {
      throw new StoreError(
        'PROJECT_ALLOCATION_UNSUPPORTED',
        'Mode pratinjau tidak menerbitkan nomor proyek ke Master Project (tidak ada koneksi DB).',
        503
      )
    },
    async deleteProject() {
      throw new StoreError(
        'PROJECT_ALLOCATION_UNSUPPORTED',
        'Mode pratinjau tidak mengelola Master Project.',
        503
      )
    },
    async issueViaRpc() {
      return null
    }
  }
}

// ============================================================
// RESOLUSI BACKEND (fail closed di produksi)
// ============================================================
// env: SALES_INVOICE_STORE = 'supabase' | 'file' | 'auto' (default auto)
export function resolveStorePlan(env = process.env) {
  const requested = String(env.SALES_INVOICE_STORE || 'auto').trim().toLowerCase()
  const isProduction = env.NODE_ENV === 'production' && env.VERCEL_ENV !== 'preview' && env.VERCEL_ENV !== 'development'
  const hasCreds = !!((env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) &&
    (env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY))

  if (requested === 'supabase') {
    return hasCreds
      ? { kind: 'supabase', reason: 'SALES_INVOICE_STORE=supabase' }
      : { kind: 'blocked', reason: 'SALES_INVOICE_STORE=supabase tetapi kredensial Supabase tidak tersedia.', blocker: 'MISSING_CREDENTIALS' }
  }
  if (requested === 'file') {
    return isProduction
      ? {
        kind: 'blocked',
        reason: 'SALES_INVOICE_STORE=file ditolak di produksi: file JSON lokal tidak durable dan tidak dibagi antar-instance.',
        blocker: 'FILE_STORE_FORBIDDEN_IN_PRODUCTION'
      }
      : { kind: 'file-preview', reason: 'SALES_INVOICE_STORE=file (pratinjau lokal).' }
  }
  if (hasCreds) return { kind: 'supabase', reason: 'auto: kredensial Supabase tersedia.' }
  if (isProduction) {
    return {
      kind: 'blocked',
      reason: 'Produksi tanpa kredensial Supabase: penyimpanan file lokal dilarang (fail closed).',
      blocker: 'MISSING_CREDENTIALS'
    }
  }
  return { kind: 'file-preview', reason: 'auto: tanpa kredensial Supabase di lingkungan non-produksi → pratinjau file.' }
}

// ============================================================
// OPERASI BERSAMA
// ============================================================
function newId() {
  return `si_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim()) && !isNaN(new Date(String(value)).getTime())
}

// Field yang boleh diubah lewat PATCH `fields` (dan hanya selama DRAFT).
// Daftar putih ini menutup jalur tulis ke status/nomor/total dari klien.
const PATCHABLE_FIELDS = Object.freeze([
  'customer_name', 'customer_phone', 'project_address', 'project_name', 'rab_reff',
  'notes', 'payment_terms', 'nominal', 'tax_rate', 'issue_date', 'due_date'
])

// normalizeFieldPatch(patch) -> { fieldPatch, nominal, taxRate } | null
// Murni: melempar StoreError bila ada nilai tidak sah. TIDAK menulis apa pun.
export function normalizeFieldPatch(patch, current = {}) {
  if (!patch || typeof patch !== 'object') return null
  const keys = Object.keys(patch)
  if (keys.length === 0) return null

  const unknown = keys.filter(k => !PATCHABLE_FIELDS.includes(k))
  if (unknown.length > 0) {
    throw new StoreError(
      'FIELD_NOT_PATCHABLE',
      `Field berikut tidak boleh diubah lewat koreksi draf: ${unknown.join(', ')}. Status, nomor invoice, dan total dihitung server.`,
      409
    )
  }

  const out = {}
  if (patch.customer_name !== undefined) {
    const v = String(patch.customer_name == null ? '' : patch.customer_name).replace(/\s+/g, ' ').trim()
    if (!v) throw new StoreError('REQUIRED', 'Nama customer tidak boleh kosong.', 400)
    out.customer_name = v.slice(0, 120)
  }
  for (const f of ['customer_phone', 'project_address', 'project_name', 'rab_reff', 'notes', 'payment_terms']) {
    if (patch[f] !== undefined) out[f] = String(patch[f] == null ? '' : patch[f]).replace(/\s+/g, ' ').trim()
  }
  if (patch.nominal !== undefined) {
    const n = Number(patch.nominal)
    if (!isFinite(n) || n <= 0) throw new StoreError('INVALID_AMOUNT', 'Nominal tagihan harus berupa angka lebih besar dari 0.', 400)
    if (n > MAX_AMOUNT) throw new StoreError('AMOUNT_TOO_LARGE', 'Nominal tagihan melebihi batas wajar.', 400)
    out.nominal = Math.round(n)
  }
  if (patch.tax_rate !== undefined) {
    const r = Number(patch.tax_rate)
    if (!isFinite(r) || r < 0 || r > 100) throw new StoreError('INVALID_TAX_RATE', 'Tarif PPN harus di antara 0 dan 100 persen.', 400)
    out.tax_rate = Math.round(r * 100) / 100
  }
  if (patch.issue_date !== undefined) {
    if (!isIsoDate(patch.issue_date)) throw new StoreError('INVALID_DATE', 'Tanggal terbit harus format YYYY-MM-DD.', 400)
    out.issue_date = String(patch.issue_date).trim()
  }
  if (patch.due_date !== undefined) {
    const d = String(patch.due_date || '').trim()
    if (d && !isIsoDate(d)) throw new StoreError('INVALID_DATE', 'Jatuh tempo harus format YYYY-MM-DD.', 400)
    out.due_date = d
  }
  const effectiveIssue = out.issue_date || String(current.issue_date || '').trim()
  if (out.due_date && effectiveIssue && out.due_date < effectiveIssue) {
    throw new StoreError('DUE_BEFORE_ISSUE', 'Jatuh tempo tidak boleh lebih awal dari tanggal terbit.', 400)
  }

  const nominal = out.nominal !== undefined ? out.nominal : Number(current.nominal)
  const taxRate = out.tax_rate !== undefined ? out.tax_rate : Number(current.tax_rate)
  if (out.nominal !== undefined || out.tax_rate !== undefined) {
    const taxAmount = Math.round(nominal * (taxRate / 100))
    out.tax_amount = taxAmount
    out.grand_total = nominal + taxAmount
  }
  return Object.keys(out).length > 0 ? out : null
}

// assertTransitionAllowed(current, to) — murni, tanpa I/O.
// Dipakai patchInvoice SEBELUM satu pun penulisan.
export function assertTransitionAllowed(current, to) {
  const target = normalizeStatus(to)
  const from = normalizeStatus(current && current.status)
  if (!isDraftStatus(from) && target === 'TERBIT') {
    throw new StoreError('NOT_A_DRAFT', `Hanya draf yang bisa diterbitkan; invoice ini berstatus ${from}.`, 409)
  }
  const transition = checkTransition(from, target)
  if (!transition.ok) throw new StoreError(transition.code, transition.message, 409)
  return target
}

// createInvoice(store, value, opts) -> { invoice, replayed, warnings }
// HANYA membuat DRAFT. Nomor invoice & nomor proyek TIDAK dialokasikan di sini.
export async function createInvoice(store, value, opts = {}) {
  const now = opts.now || (() => new Date().toISOString())
  const idempotencyKey = normalizeKey(opts.idempotencyKey)
  const requestFingerprint = opts.requestFingerprint || fingerprint(value)
  const warnings = []

  if (idempotencyKey) {
    const existing = await store.findByIdempotencyKey(idempotencyKey)
    if (existing) {
      if (existing.request_fingerprint && existing.request_fingerprint !== requestFingerprint) {
        throw new StoreError(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key ini sudah dipakai untuk isi invoice yang berbeda. Muat ulang data lalu ulangi.',
          409
        )
      }
      return { invoice: existing, replayed: true, warnings: ['Permintaan identik sudah tersimpan — invoice lama dikembalikan, tidak ada duplikat.'] }
    }
  }

  const record = composeInvoice(value, {
    id: newId(),
    status: DRAFT_STATUS,
    invoice_no: null,
    project_code: null,
    project_id: null,
    project_issued: false,
    created_at: now(),
    idempotency_key: idempotencyKey,
    request_fingerprint: requestFingerprint,
    store: store.kind
  })

  const saved = await store.insert(record)
  if (value.project_intent && value.project_intent.mode !== 'none') {
    warnings.push(
      `Draf tersimpan. Nomor invoice & nomor proyek baru dialokasikan saat penerbitan (${value.project_intent.mode === 'new' ? 'proyek baru akan diterbitkan' : 'tautan proyek dikunci'}).`
    )
  }
  return { invoice: saved, replayed: false, warnings }
}

// preflightIssue(store, current, opts) — MURNI (tanpa tulis).
// Semua alasan penerbitan bisa gagal ditemukan di sini: status, format nomor,
// gate RPC, mode proyek, kode proyek bentrok, klaim ganda.
export async function preflightIssue(store, current, opts = {}) {
  const warnings = []
  if (!current) throw new StoreError('NOT_FOUND', 'Invoice tidak ditemukan.', 404)
  if (!isDraftStatus(current.status)) {
    throw new StoreError('NOT_A_DRAFT', `Hanya draf yang bisa diterbitkan; invoice ini berstatus ${current.status}.`, 409)
  }
  const transition = checkTransition(current.status, 'TERBIT')
  if (!transition.ok) throw new StoreError(transition.code, transition.message, 409)

  const numbering = store.numbering || resolveNumbering(opts)
  if (!numbering || numbering.blocked || !numbering.format) {
    throw new StoreError(
      (numbering && numbering.code) || 'NUMBER_FORMAT_BLOCKED',
      (numbering && numbering.message) || 'Format nomor invoice belum disepakati; penerbitan ditolak (fail closed).',
      409
    )
  }
  const caps = store.capabilities || {}
  if (caps.requireRpc && !caps.rpcAvailable) {
    throw new StoreError(
      'ISSUE_REQUIRES_RPC',
      'Penerbitan invoice dikonfigurasi WAJIB lewat RPC atomik (SALES_INVOICE_REQUIRE_RPC=1) tetapi RPC belum tersedia. Penerbitan ditolak (fail closed) — tidak ada nomor yang dialokasikan.',
      503
    )
  }

  const intent = current.project_intent || { mode: 'none', code: '', project_id: '' }
  const mode = PROJECT_MODES.includes(intent.mode) ? intent.mode : 'none'
  let projectCodeToUse = ''

  if (mode === 'new') {
    const projects = await store.listProjects()
    const requested = String(intent.code || '').trim()
    if (requested && isProjectCodeTaken(projects, requested)) {
      throw new StoreError(
        'DUPLICATE_PROJECT_CODE',
        `Kode proyek "${requested}" sudah dipakai di Master Project. Nomor berikutnya yang tersedia: ${nextNumericProjectCode(projects)}.`,
        409,
        { suggested_code: nextNumericProjectCode(projects) }
      )
    }
    projectCodeToUse = requested
    if (requested && caps.projectAllocation) {
      // Satu proyek hanya boleh diterbitkan oleh satu invoice. Pemeriksaan ini
      // hanya berlaku bila store benar-benar menerbitkan proyek (Supabase);
      // mode pratinjau hanya menyimpan kode sebagai referensi.
      const claimed = await store.findByProjectCode(requested)
      if (claimed && String(claimed.id) !== String(current.id)) {
        throw new StoreError(
          'PROJECT_ALREADY_CLAIMED',
          `Kode proyek "${requested}" sudah tertaut ke invoice lain (${claimed.invoice_no || claimed.id}). Satu invoice menerbitkan satu proyek — pakai mode "proyek existing" untuk menagih proyek yang sudah ada.`,
          409
        )
      }
    }
  }
  if (mode === 'existing') {
    const projects = await store.listProjects()
    if (projects.length > 0) {
      const found = projects.find(p => String(p.id) === String(intent.project_id))
      if (!found) throw new StoreError('PROJECT_NOT_FOUND', 'Proyek existing yang dipilih tidak ditemukan di Master Project.', 409)
      projectCodeToUse = String(found.kode ?? found.code ?? '')
    } else if (!(store.capabilities && store.capabilities.projectAllocation)) {
      warnings.push('Tautan proyek disimpan sebagai referensi saja: mode pratinjau tidak membaca Master Project.')
    }
  }
  if (mode === 'none') warnings.push('Invoice diterbitkan tanpa nomor proyek (mode tanpa proyek).')

  return { numbering, mode, intent, projectCodeToUse, warnings }
}

// attachProject(store, issued, plan, ctx) — fase SETELAH invoice bernomor.
// Idempoten: klaim slot proyek disimpan di invoice; kode proyek deterministik;
// kode yang sudah ada ditautkan (bukan membuat proyek kedua).
async function attachProject(store, issued, plan, ctx) {
  const { now, warnings } = ctx
  if (plan.mode === 'none') return { invoice: issued, warnings }
  if (!(store.capabilities && store.capabilities.projectAllocation)) {
    warnings.push(
      'Nomor proyek TIDAK diterbitkan: penyimpanan pratinjau tidak terhubung ke Master Project. Invoice tersimpan dengan penanda "proyek belum terbit".'
    )
    return { invoice: issued, warnings }
  }
  if (plan.mode === 'existing') return { invoice: issued, warnings }
  if (issued.project_issued && issued.project_id) return { invoice: issued, warnings }

  let row = issued
  let claimCode = String((issued.project_claim && issued.project_claim.code) || plan.projectCodeToUse || '').trim()
  if (!claimCode) claimCode = nextNumericProjectCode(await store.listProjects())

  // 1. Klaim slot proyek — hanya satu permintaan yang boleh menulis klaim.
  if (!issued.project_claim || !issued.project_claim.code) {
    const claimed = await store.updateIf(issued.id, { status: 'TERBIT', project_issued: false }, {
      project_claim: { code: claimCode, invoice_id: issued.id, requested_at: now() },
      updated_at: now()
    })
    if (claimed) {
      row = claimed
    } else {
      const fresh = await store.getById(issued.id)
      if (fresh && fresh.project_issued) {
        warnings.push('Proyek sudah tertaut oleh permintaan lain; tidak ada proyek kedua yang dibuat.')
        return { invoice: fresh, warnings }
      }
      if (fresh && fresh.project_claim && fresh.project_claim.code) {
        row = fresh
        claimCode = String(fresh.project_claim.code)
      } else {
        throw new StoreError('PROJECT_CLAIM_CONFLICT', 'Slot proyek invoice ini sedang diklaim permintaan lain. Tidak ada proyek yang dibuat.', 409)
      }
    }
  }

  // 2. Kode proyek tidak boleh sudah dipakai invoice lain.
  const other = await store.findByProjectCode(claimCode)
  if (other && String(other.id) !== String(issued.id)) {
    throw new StoreError(
      'PROJECT_ALREADY_CLAIMED',
      `Kode proyek "${claimCode}" sudah tertaut ke invoice lain (${other.invoice_no || other.id}); proyek kedua tidak dibuat.`,
      409
    )
  }

  // 3. Insert proyek — idempoten lewat kode (bentrok = tautkan yang ada).
  let created = null
  let project = null
  try {
    created = await store.insertProject({
      kode: claimCode,
      code: claimCode,
      name: row.project_name || `${row.customer_name} Project`,
      status: 'ON_GOING'
    })
    project = created
  } catch (err) {
    if (err && err.code === 'DUPLICATE_PROJECT_CODE') {
      const projects = await store.listProjects()
      const existing = projects.find(p => sameCode(p, claimCode))
      if (!existing) throw err
      project = existing
      warnings.push(`Kode proyek ${claimCode} sudah ada di Master Project; invoice ditautkan ke proyek itu (tidak membuat proyek kedua).`)
    } else {
      throw err
    }
  }

  // 4. Tautkan ke invoice (retry singkat; bukan transaksi).
  let linkErr = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const linked = await store.update(issued.id, {
        project_id: (project && project.id) || null,
        project_code: String((project && (project.kode ?? project.code)) || claimCode),
        project_issued: true,
        project_claim: {
          ...((row && row.project_claim) || {}),
          code: claimCode,
          project_id: (project && project.id) || null,
          linked_at: now()
        },
        project_issue_error: null,
        updated_at: now()
      })
      return { invoice: linked || issued, warnings }
    } catch (err) {
      linkErr = err
    }
  }

  // 5. Kompensasi best-effort — BUKAN transaksi. Bila proyek BARU saja dibuat
  //    oleh kita, coba hapus supaya tidak ada proyek yatim. Bila penghapusan
  //    juga gagal, laporkan id proyeknya supaya bisa dibersihkan manual.
  let compensated = false
  if (created && created.id) {
    try {
      await store.deleteProject(created.id)
      compensated = true
    } catch (_) { /* dilaporkan di bawah */ }
  }
  const detail = compensated
    ? `Proyek ${claimCode} yang baru dibuat sudah dibatalkan (kompensasi best-effort, bukan transaksi); tidak ada proyek yatim.`
    : `PERINGATAN: proyek ${claimCode}${created && created.id ? ` (id ${created.id})` : ''} SUDAH dibuat di Master Project tetapi TIDAK tertaut ke invoice — perlu perbaikan manual.`
  const msg = `Invoice terbit & bernomor, tetapi tautan proyek gagal disimpan: ${linkErr ? linkErr.message : 'tidak diketahui'}. ${detail}`
  warnings.push(msg)
  try {
    await store.update(issued.id, { project_issued: false, project_issue_error: msg, updated_at: now() })
  } catch (_) { /* invoice tetap sah; pesan sudah dikembalikan */ }
  return { invoice: { ...issued, project_issued: false, project_issue_error: msg }, warnings }
}

// issueInvoice(store, id, opts) -> { invoice, warnings, project }
// DRAFT → TERBIT. Urutan: validasi (tanpa tulis) → CAS status → tautkan proyek.
export async function issueInvoice(store, id, opts = {}) {
  const now = opts.now || (() => new Date().toISOString())
  const current = await store.getById(id)
  const plan = await preflightIssue(store, current, opts)
  const warnings = plan.warnings.slice()
  const numbering = plan.numbering
  const issueDate = String(current.issue_date || '').trim()
  const period = numberingPeriod(numbering.format, issueDate)
  const month = /^\d{4}-\d{2}/.test(issueDate) ? issueDate.slice(5, 7) : null

  const attempted = new Set()
  let lastErr = null

  for (let attempt = 1; attempt <= (store.maxAttempts || MAX_NUMBER_ATTEMPTS); attempt++) {
    const existing = await store.numbersInPeriod(numbering.format, period)
    let seq = nextSequenceForFormat(existing, numbering.format, period)
    while (attempted.has(seq)) seq++
    attempted.add(seq)
    const invoiceNo = formatInvoiceNoFor(numbering.format, { period, seq, month })

    let issued = null
    try {
      // CAS: hanya berhasil bila status MASIH draf yang kita baca. Permintaan
      // kedua (dua admin / dua tab) kalah di sini dan tidak mendapat nomor.
      issued = await store.updateIf(current.id, { status: current.status }, {
        status: 'TERBIT',
        invoice_no: invoiceNo,
        number_format: numbering.format,
        issued_at: now(),
        updated_at: now(),
        project_code: plan.projectCodeToUse || null,
        project_id: plan.mode === 'existing' ? (String(plan.intent.project_id || '') || null) : null,
        project_issued: plan.mode === 'none' ? false : plan.mode === 'existing',
        store: store.kind
      })
    } catch (err) {
      lastErr = err
      if (err instanceof StoreError && err.code === 'DUPLICATE_INVOICE_NO') continue
      throw err
    }

    if (!issued) {
      throw new StoreError(
        'ISSUE_CONFLICT',
        'Invoice ini sudah berubah status saat penerbitan (kemungkinan diterbitkan permintaan lain). Tidak ada nomor atau proyek tambahan yang dibuat — muat ulang daftar.',
        409
      )
    }

    // Fase proyek: kegagalan di sini TIDAK membatalkan invoice (nomor sudah sah).
    try {
      return await attachProject(store, issued, plan, { now, warnings })
    } catch (projErr) {
      warnings.push(`Invoice terbit, tetapi nomor proyek gagal diterbitkan: ${projErr.message}`)
      return { invoice: issued, warnings }
    }
  }

  throw new StoreError(
    'NUMBER_ALLOCATION_EXHAUSTED',
    `Gagal mengalokasikan nomor invoice setelah ${store.maxAttempts || MAX_NUMBER_ATTEMPTS} percobaan${lastErr ? `: ${lastErr.message}` : '.'}`,
    409
  )
}

// patchInvoice(store, { id, to, patch, evidence, actor }) -> { invoice, warnings }
//
// URUTAN KERAS: baca → VALIDASI (status, transisi, isi, bukti) → BARU tulis.
// Tidak ada satu pun penulisan sebelum seluruh validasi lulus.
export async function patchInvoice(store, req, opts = {}) {
  const now = opts.now || (() => new Date().toISOString())
  const current = await store.getById(req.id)
  if (!current) throw new StoreError('NOT_FOUND', 'Invoice tidak ditemukan.', 404)

  const to = normalizeStatus(req.to)
  const warnings = []

  // ---- 1. STATUS & TRANSISI (tanpa tulis) ----
  // Inilah yang dulu bocor: `{to:'TERBIT', fields}` pada invoice TERKIRIM
  // menulis nominal lebih dulu, lalu gagal NOT_A_DRAFT.
  const target = assertTransitionAllowed(current, to)

  // ---- 2. ISI (tanpa tulis) ----
  const fieldPatch = normalizeFieldPatch(req.patch, current)
  if (fieldPatch && !isDraftStatus(current.status)) {
    throw new StoreError(
      'ISSUED_INVOICE_FROZEN',
      `Invoice yang sudah terbit tidak boleh diubah isinya (${Object.keys(fieldPatch).join(', ')}). Batalkan invoice lalu terbitkan yang baru.`,
      409
    )
  }

  // ---- 3. BUKTI (tanpa tulis) ----
  const evidence = req.evidence && typeof req.evidence === 'object' ? req.evidence : {}
  const patch = { status: target, updated_at: now() }
  if (fieldPatch) Object.assign(patch, fieldPatch)

  if (target === 'TERKIRIM') {
    const channel = String(evidence.sent_channel || '').trim()
    if (!channel) {
      throw new StoreError('EVIDENCE_REQUIRED', 'Sebutkan kanal pengiriman yang benar-benar dipakai sebelum menandai terkirim.', 400)
    }
    patch.sent_at = now()
    patch.sent_channel = channel
  }

  if (target === 'LUNAS') {
    const paid = Number(evidence.paid_amount)
    const total = Number(current.grand_total || current.nominal || 0)
    if (!isFinite(paid) || paid <= 0) {
      throw new StoreError('EVIDENCE_REQUIRED', 'Nominal pembayaran yang diterima wajib diisi.', 400)
    }
    if (Math.abs(paid - total) > 1) {
      throw new StoreError(
        'PAYMENT_AMOUNT_MISMATCH',
        `Pembayaran Rp ${paid.toLocaleString('id-ID')} tidak sama dengan total tagihan Rp ${total.toLocaleString('id-ID')}. Invoice tidak boleh ditandai LUNAS sebelum pembayaran penuh terverifikasi.`,
        409,
        { expected_amount: total, received_amount: paid }
      )
    }
    patch.paid_at = evidence.paid_at
    patch.paid_amount = paid
    patch.payment_ref = evidence.payment_ref
    patch.payment_verified_by = evidence.verified_by
    patch.payment_verified_at = now()
  }

  if (target === 'BATAL') {
    patch.voided_at = now()
    if (current.invoice_no) {
      warnings.push(`Nomor invoice ${current.invoice_no} tetap tercatat sebagai terpakai (tidak didaur ulang).`)
    }
  }

  // ---- 4. PENERBITAN: preflight dulu, baru koreksi draf, baru terbitkan ----
  if (target === 'TERBIT') {
    // Preflight memastikan penerbitan TIDAK akan gagal (format nomor, RPC,
    // kode proyek, klaim ganda). Jadi koreksi draf tidak pernah "menggantung"
    // pada penerbitan yang pasti gagal.
    await preflightIssue(store, current, opts)
    if (fieldPatch) {
      const corrected = await store.updateIf(current.id, { status: current.status }, { ...fieldPatch, updated_at: now() })
      if (!corrected) {
        throw new StoreError('CONCURRENT_MODIFICATION', 'Draf ini berubah saat dikoreksi (permintaan lain). Muat ulang lalu ulangi.', 409)
      }
    }
    return issueInvoice(store, current.id, opts)
  }

  // ---- 5. EKSEKUSI dengan CAS pada status yang dibaca ----
  const saved = await store.updateIf(current.id, { status: current.status }, patch)
  if (!saved) {
    throw new StoreError(
      'CONCURRENT_MODIFICATION',
      `Status invoice berubah saat permintaan ini diproses (dibaca ${current.status}). Muat ulang daftar lalu ulangi — tidak ada perubahan yang ditulis.`,
      409
    )
  }
  return { invoice: saved, warnings }
}

export async function listInvoices(store) {
  return store.list()
}

// Ringkasan kapabilitas untuk UI/endpoint — supaya halaman bisa menyatakan
// dengan jujur apakah data benar-benar tersimpan dan apa yang belum dijamin.
export function storeStatus(store) {
  const caps = store.capabilities || {}
  const numbering = store.numbering || resolveNumbering({})
  return {
    ...caps,
    durable: !!caps.durable,
    writes_local_json: store.kind === 'file-preview',
    transactional: !!caps.transactional,
    number_format: {
      active: numbering.format,
      authoritative: 'legacy-buku',
      configured: !!numbering.configured,
      agreed: numbering.agreed !== false,
      discrepancy: numbering.discrepancy !== false,
      note: numbering.note || null
    }
  }
}

// Hitung sebaran format nomor yang SUDAH ada (tidak ada migrasi otomatis).
export function summarizeNumberFormats(invoices = []) {
  const out = { 'legacy-buku': 0, 'inv-nl': 0, unknown: 0 }
  for (const inv of Array.isArray(invoices) ? invoices : []) {
    const no = inv && inv.invoice_no
    if (!no) continue
    const parsed = parseAnyInvoiceNo(no)
    if (!parsed) out.unknown++
    else out[parsed.format] = (out[parsed.format] || 0) + 1
  }
  return out
}
