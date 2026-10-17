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
//      Dulu dipakai TANPA SYARAT; sekarang DIBATASI: hanya NODE_ENV != production
//      dan hanya bila SALES_INVOICE_STORE tidak memaksa supabase. Di produksi
//      backend ini MENOLAK (fail closed) — bukan diam-diam menulis file di
//      server Vercel yang ephemeral & tidak dibagi antar-instance.
//
// Urutan tulis yang aman (temuan penting):
//   * DRAFT dibuat dulu TANPA nomor invoice & TANPA proyek.
//   * TERBIT = alokasi nomor invoice (server) → simpan → BARU terbitkan proyek.
//     Jadi kegagalan simpan invoice TIDAK PERNAH meninggalkan nomor proyek
//     yatim (dulu: proyek di-insert lebih dulu, invoice gagal = proyek hantu).
//   * Invoice tetap sah walau penerbitan proyek gagal; penanda
//     project_issued=false + peringatan jujur dikembalikan (bukan klaim palsu).
//
// Lihat docs/sales-invoice-contract.md (§ handoff Supabase & RPC usulan).
// ============================================================

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  DRAFT_STATUS,
  checkTransition,
  composeInvoice,
  formatInvoiceNo,
  invoicePeriod,
  isDraftStatus,
  isIssuedStatus,
  isProjectCodeTaken,
  nextNumericProjectCode,
  nextSequenceFromExisting,
  normalizeStatus,
  parseInvoiceNo
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

  const capabilities = {
    kind: 'supabase',
    durable: true,
    preview: false,
    atomicSequence: !!opts.hasIssueRpc,
    issueRpc: opts.hasIssueRpc ? (opts.issueRpcName || 'sales_invoice_issue') : null,
    projectAllocation: true,
    idempotency: true,
    note: opts.hasIssueRpc
      ? 'Nomor invoice & proyek dialokasikan dalam satu RPC transaksional.'
      : 'Alokasi nomor berlapis: baca max+1 lalu insert; unique constraint + retry menutup balapan. RPC transaksional belum tersedia.'
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
    async invoicesInPeriod(period) {
      const prefix = `INV/NL/${String(period).replace('-', '/')}/`
      const { data, error } = await client.from(table).select('invoice_no').like('invoice_no', `${prefix}%`)
      if (error) throw fail(error, 'READ_FAILED', 'Gagal membaca nomor invoice periode ini.')
      return Array.isArray(data) ? data : []
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
    async issueViaRpc(payload) {
      if (!opts.hasIssueRpc) return null
      const { data, error } = await client.rpc(capabilities.issueRpc, payload)
      if (error) throw fail(error, 'ISSUE_RPC_FAILED', 'Gagal menerbitkan invoice lewat RPC.')
      return data
    },
    maxAttempts
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

  // Kunci berbasis mkdir supaya dua permintaan bersamaan tidak saling menimpa
  // (masalah nyata pada pola read-modify-write JSON: dulu unshift lalu write
  // tanpa kunci, dua POST bersamaan = satu invoice hilang).
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

  const capabilities = {
    kind: 'file-preview',
    durable: false,
    preview: true,
    atomicSequence: false,
    issueRpc: null,
    projectAllocation: false,
    idempotency: true,
    note: 'PRATINJAU LOKAL: data hanya ada di file JSON mesin ini, hilang saat deploy/instance baru, dan TIDAK menerbitkan nomor proyek.'
  }

  return {
    kind: 'file-preview',
    capabilities,
    file,
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
    async invoicesInPeriod(period) {
      return readAll()
        .map(r => ({ invoice_no: r.invoice_no }))
        .filter(r => {
          const p = parseInvoiceNo(r.invoice_no)
          return p && p.period === period
        })
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
    async issueViaRpc() {
      return null
    },
    maxAttempts: MAX_NUMBER_ATTEMPTS
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

// issueInvoice(store, id, opts) -> { invoice, warnings }
// DRAFT → TERBIT. Urutan: alokasi nomor → simpan → terbitkan proyek.
export async function issueInvoice(store, id, opts = {}) {
  const now = opts.now || (() => new Date().toISOString())
  const warnings = []

  const current = await store.getById(id)
  if (!current) throw new StoreError('NOT_FOUND', 'Invoice tidak ditemukan.', 404)
  if (!isDraftStatus(current.status)) {
    throw new StoreError('NOT_A_DRAFT', `Hanya draf yang bisa diterbitkan; invoice ini berstatus ${current.status}.`, 409)
  }

  const intent = current.project_intent || { mode: 'none', code: '', project_id: '' }
  const mode = intent.mode || 'none'

  // Pra-validasi kode proyek SEBELUM nomor invoice dipakai, supaya tidak ada
  // nomor terpakai untuk penerbitan yang pasti gagal.
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
  }
  if (mode === 'existing') {
    const projects = await store.listProjects()
    if (projects.length > 0) {
      const found = projects.find(p => String(p.id) === String(intent.project_id))
      if (!found) throw new StoreError('PROJECT_NOT_FOUND', 'Proyek existing yang dipilih tidak ditemukan di Master Project.', 409)
      projectCodeToUse = String(found.kode ?? found.code ?? '')
    } else if (!store.capabilities.projectAllocation) {
      warnings.push('Tautan proyek disimpan sebagai referensi saja: mode pratinjau tidak membaca Master Project.')
    }
  }
  if (mode === 'none') {
    warnings.push('Invoice diterbitkan tanpa nomor proyek (mode tanpa proyek).')
  }

  const period = invoicePeriod(current.issue_date)
  let lastErr = null
  // Nomor yang sudah dicoba pada periode ini. Penting: retry TIDAK boleh
  // bergantung pada pembacaan ulang yang mungkin basi (replica lag / cache
  // schema). Kalau sebuah nomor sudah ditolak unique constraint, nomor itu
  // dilewati walau pembacaan periode kembali kosong.
  const attempted = new Set()

  for (let attempt = 1; attempt <= (store.maxAttempts || MAX_NUMBER_ATTEMPTS); attempt++) {
    const existing = await store.invoicesInPeriod(period)
    let seq = nextSequenceFromExisting(existing, period)
    while (attempted.has(seq)) seq++
    attempted.add(seq)
    const invoiceNo = formatInvoiceNo(period, seq)

    try {
      // 1. Simpan invoice DULU (satu-satunya operasi yang menentukan nomor
      //    terpakai). Bila gagal, tidak ada yang perlu dibersihkan.
      const issued = await store.update(current.id, {
        status: 'TERBIT',
        invoice_no: invoiceNo,
        issued_at: now(),
        updated_at: now(),
        project_code: projectCodeToUse || null,
        project_id: mode === 'existing' ? String(intent.project_id || '') || null : null,
        project_issued: mode === 'none' ? false : mode === 'existing',
        store: store.kind
      })

      // 2. BARU terbitkan nomor proyek baru. Kegagalan di sini TIDAK
      //    membatalkan invoice (nomor invoice sudah sah & tercatat), tetapi
      //    penanda project_issued tetap false + peringatan jujur.
      if (mode === 'new') {
        if (!store.capabilities.projectAllocation) {
          warnings.push(
            'Nomor proyek TIDAK diterbitkan: penyimpanan pratinjau tidak terhubung ke Master Project. Invoice tersimpan dengan penanda "proyek belum terbit".'
          )
          return { invoice: issued, warnings }
        }
        try {
          const projects = await store.listProjects()
          const code = String(projectCodeToUse || '').trim() || nextNumericProjectCode(projects)
          const project = await store.insertProject({
            kode: code,
            code,
            name: current.project_name || `${current.customer_name} Project`,
            status: 'ON_GOING'
          })
          const updated = await store.update(current.id, {
            project_id: (project && project.id) || null,
            project_code: String((project && (project.kode ?? project.code)) || code),
            project_issued: true,
            updated_at: now()
          })
          return { invoice: updated || issued, warnings }
        } catch (projErr) {
          warnings.push(`Invoice terbit, tetapi nomor proyek gagal diterbitkan: ${projErr.message}`)
          return { invoice: issued, warnings }
        }
      }

      return { invoice: issued, warnings }
    } catch (err) {
      lastErr = err
      if (err instanceof StoreError && err.code === 'DUPLICATE_INVOICE_NO') continue
      throw err
    }
  }

  throw new StoreError(
    'NUMBER_ALLOCATION_EXHAUSTED',
    `Gagal mengalokasikan nomor invoice setelah ${store.maxAttempts || MAX_NUMBER_ATTEMPTS} percobaan${lastErr ? `: ${lastErr.message}` : '.'}`,
    409
  )
}

// patchInvoice(store, { id, to, patch, evidence, actor }) -> { invoice, warnings }
export async function patchInvoice(store, req, opts = {}) {
  const now = opts.now || (() => new Date().toISOString())
  const current = await store.getById(req.id)
  if (!current) throw new StoreError('NOT_FOUND', 'Invoice tidak ditemukan.', 404)

  const to = normalizeStatus(req.to)

  // Menerbitkan draf = jalur khusus (butuh nomor invoice), bukan update biasa.
  if (to === 'TERBIT') {
    if (req.patch && Object.keys(req.patch).length > 0) {
      // Terbitkan isi draf yang sudah dikoreksi sekaligus: tulis koreksi dulu
      // selama masih draf, baru terbitkan.
      const nominal = req.patch.nominal !== undefined ? Number(req.patch.nominal) : Number(current.nominal)
      const rate = req.patch.tax_rate !== undefined ? Number(req.patch.tax_rate) : Number(current.tax_rate)
      await store.update(current.id, {
        ...req.patch,
        tax_amount: Math.round(nominal * (rate / 100)),
        grand_total: nominal + Math.round(nominal * (rate / 100)),
        updated_at: now()
      })
    }
    return issueInvoice(store, current.id, opts)
  }

  const transition = checkTransition(current.status, to)
  if (!transition.ok) throw new StoreError(transition.code, transition.message, 409)

  const warnings = []
  const patch = { status: to, updated_at: now() }

  if (req.patch) {
    if (!isDraftStatus(current.status)) {
      throw new StoreError(
        'ISSUED_INVOICE_FROZEN',
        `Invoice yang sudah terbit tidak boleh diubah isinya (${Object.keys(req.patch).join(', ')}). Batalkan invoice lalu terbitkan yang baru.`,
        409
      )
    }
    Object.assign(patch, req.patch)
    if (req.patch.nominal !== undefined || req.patch.tax_rate !== undefined) {
      const nominal = req.patch.nominal !== undefined ? Number(req.patch.nominal) : Number(current.nominal)
      const rate = req.patch.tax_rate !== undefined ? Number(req.patch.tax_rate) : Number(current.tax_rate)
      patch.tax_amount = Math.round(nominal * (rate / 100))
      patch.grand_total = nominal + patch.tax_amount
    }
  }

  if (to === 'TERKIRIM') {
    patch.sent_at = now()
    patch.sent_channel = req.evidence.sent_channel
  }

  if (to === 'LUNAS') {
    const paid = Number(req.evidence.paid_amount)
    const total = Number(current.grand_total || current.nominal || 0)
    if (!isFinite(paid) || paid <= 0) {
      throw new StoreError('EVIDENCE_REQUIRED', 'Nominal pembayaran yang diterima wajib diisi.', 400)
    }
    // Pembayaran sebagian BUKAN LUNAS. Selisih 1 rupiah ditoleransi (pembulatan).
    if (Math.abs(paid - total) > 1) {
      throw new StoreError(
        'PAYMENT_AMOUNT_MISMATCH',
        `Pembayaran Rp ${paid.toLocaleString('id-ID')} tidak sama dengan total tagihan Rp ${total.toLocaleString('id-ID')}. Invoice tidak boleh ditandai LUNAS sebelum pembayaran penuh terverifikasi.`,
        409,
        { expected_amount: total, received_amount: paid }
      )
    }
    patch.paid_at = req.evidence.paid_at
    patch.paid_amount = paid
    patch.payment_ref = req.evidence.payment_ref
    patch.payment_verified_by = req.evidence.verified_by
    patch.payment_verified_at = now()
  }

  if (to === 'BATAL') {
    patch.voided_at = now()
    if (current.invoice_no) {
      warnings.push(`Nomor invoice ${current.invoice_no} tetap tercatat sebagai terpakai (tidak didaur ulang).`)
    }
  }

  const saved = await store.update(current.id, patch)
  return { invoice: saved, warnings }
}

export async function listInvoices(store) {
  return store.list()
}

// Ringkasan kapabilitas untuk UI/endpoint — supaya halaman bisa menyatakan
// dengan jujur apakah data benar-benar tersimpan.
export function storeStatus(store) {
  return {
    ...store.capabilities,
    durable: !!store.capabilities.durable,
    writes_local_json: store.kind === 'file-preview'
  }
}
