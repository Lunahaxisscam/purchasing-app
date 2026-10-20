// ============================================================
// scripts/reminders/collect.js — PEMBACA DATA READ-ONLY UNTUK REMINDER
// ============================================================
// SERVER-ONLY. Satu-satunya file di lapisan reminder yang menyentuh jaringan.
//
// JAMINAN READ-ONLY (ditegakkan di kode, bukan sekadar niat):
//   * Hanya SELECT. Tidak ada insert/update/delete/upsert/rpc di file ini.
//   * Tidak ada pengiriman keluar (Telegram/WA/email/webhook).
//   * Tidak ada pembayaran, tidak ada penjadwalan/cron, tidak ada perubahan
//     status apa pun.
//   * Bila sebuah tabel tidak bisa dibaca (mis. `sales_invoices` belum ada →
//     PGRST205), hasilnya `available:false` + kode error. TIDAK dianggap
//     "0 baris" dan TIDAK diisi data karangan.
//
// Dipakai oleh pages/api/reminders.js (GET, admin) dan scripts/reminders/cli.mjs.
// ============================================================

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { APPROVAL_MODULE_ENABLED } from './rules.js'

// Tabel yang dibaca. `key` dipakai oleh aturan di rules.js.
// `expect` = kolom yang WAJIB ada agar jenis reminder terkait bisa dipercaya.
// Kolom yang hilang TIDAK menggagalkan pembacaan; dilaporkan di readiness.
export const SOURCES = Object.freeze([
  {
    key: 'purchase_requests',
    table: 'purchase_requests',
    expect: ['id', 'status', 'created_at'],
    optional: ['pr_number', 'title', 'project_id', 'materials_summary']
  },
  {
    key: 'pr_items',
    table: 'pr_items',
    expect: ['id', 'pr_id', 'status'],
    optional: ['item_name', 'kode', 'quantity', 'estimated_price', 'unit']
  },
  {
    key: 'approval_steps',
    table: 'approval_steps',
    expect: ['id', 'purchase_request_id', 'status'],
    optional: ['step_number', 'decided_at', 'created_at', 'note']
  },
  {
    key: 'receivings',
    table: 'receivings',
    expect: ['id'],
    optional: ['purchase_request_id', 'project_id', 'invoice_no', 'received_date', 'note', 'delivery_note', 'status', 'created_at', 'alokasi', 'masuk_gudang', 'tukang_at']
  },
  {
    key: 'receiving_items',
    table: 'receiving_items',
    expect: ['id', 'receiving_id'],
    optional: ['pr_item_id', 'item_name', 'quantity_received', 'note']
  },
  {
    key: 'handovers',
    table: 'handovers',
    expect: ['id'],
    optional: ['receiving_id', 'project_id', 'received_by', 'handover_date', 'status', 'diserahkan_at', 'created_at']
  },
  {
    key: 'projects',
    table: 'projects',
    expect: ['id'],
    optional: ['name', 'kode', 'code', 'status']
  },
  {
    // BELUM ADA di Supabase saat dokumen ini ditulis (PGRST205). Dibiarkan di
    // daftar supaya laporan menyatakan BLOCKED, bukan seolah bersih.
    key: 'sales_invoices',
    table: 'sales_invoices',
    expect: ['id', 'status'],
    optional: ['invoice_no', 'customer_name', 'grand_total', 'issue_date', 'due_date', 'paid_at', 'paid_amount', 'payment_ref', 'payment_verified_by', 'sent_channel', 'created_at']
  }
])

export const DEFAULT_ROW_LIMIT = 1000
export const MAX_ROW_LIMIT = 5000

function makeClient(env = process.env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return { client: null, reason: 'Kredensial Supabase tidak tersedia (SUPABASE_URL / anon key kosong).' }
  return {
    client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    reason: null
  }
}

function classifyError(error) {
  const code = error && (error.code || '')
  const message = String((error && error.message) || 'Gagal membaca data.')
  if (code === 'PGRST205' || code === '42P01' || /could not find the table|does not exist/i.test(message)) {
    return { error_code: 'SCHEMA_UNAVAILABLE', error_message: message }
  }
  if (code === '42501' || /permission denied|row-level security/i.test(message)) {
    return { error_code: 'PERMISSION_DENIED', error_message: message }
  }
  if (code === 'PGRST301' || /JWT/i.test(message)) {
    return { error_code: 'AUTH_ERROR', error_message: message }
  }
  return { error_code: code || 'READ_FAILED', error_message: message }
}

// Baca satu tabel: SELECT * (read-only) + count exact.
// Urutan ASCENDING by created_at bila kolomnya ada, supaya bila batas baris
// tercapai yang terpotong adalah data TERBARU (reminder mengurus yang tertua).
async function readOne(client, def, { rowLimit }) {
  const base = {
    key: def.key,
    table: def.table,
    available: false,
    row_count: 0,
    fetched: 0,
    truncated: false,
    columns: [],
    error_code: null,
    error_message: null
  }
  if (!client) {
    return { ...base, error_code: 'NO_CREDENTIALS', error_message: 'Klien Supabase tidak tersedia.' }
  }

  const run = async (withOrder) => {
    let q = client.from(def.table).select('*', { count: 'exact' })
    if (withOrder) q = q.order('created_at', { ascending: true })
    return q.limit(rowLimit)
  }

  let { data, count, error } = await run(true)
  if (error && /created_at/i.test(String(error.message || ''))) {
    // Tabel tanpa kolom created_at: ulangi tanpa order (masih read-only).
    ({ data, count, error } = await run(false))
  }
  if (error) {
    return { ...base, ...classifyError(error) }
  }
  const rows = Array.isArray(data) ? data : []
  const total = typeof count === 'number' ? count : rows.length
  return {
    ...base,
    available: true,
    row_count: total,
    fetched: rows.length,
    truncated: total > rows.length,
    columns: rows.length ? Object.keys(rows[0]) : [],
    rows
  }
}

// collect({ env, rowLimit }) -> { dataset, sources, meta }
// `dataset` hanya berisi array baris per key; `sources` berisi status tiap
// tabel (tersedia / tidak, jumlah, kolom, kode error).
export async function collect({ env = process.env, rowLimit = DEFAULT_ROW_LIMIT, client = null, previewDir = null } = {}) {
  const limit = Math.max(1, Math.min(Number(rowLimit) || DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT))
  let c = client
  let reason = null
  if (!c) {
    const made = makeClient(env)
    c = made.client
    reason = made.reason
  }

  const dataset = {}
  const sources = []
  for (const def of SOURCES) {
    // t_50b783de (Approval OFF): tabel `approval_steps` TIDAK dibaca sama
    // sekali saat modul Approval dimatikan — konektor query ikut diputus,
    // bukan hanya menunya. Sumber dilaporkan `skipped_by_policy` (bukan
    // "tersedia 0 baris" dan bukan error) supaya laporan tetap jujur.
    if (def.key === 'approval_steps' && !APPROVAL_MODULE_ENABLED) {
      dataset[def.key] = []
      sources.push({
        key: def.key,
        table: def.table,
        available: false,
        skipped_by_policy: true,
        row_count: 0,
        fetched: 0,
        truncated: false,
        columns: [],
        error_code: null,
        error_message: null,
        note: 'Modul Approval purchasing dinonaktifkan sementara — tabel ini sengaja TIDAK dibaca.'
      })
      continue
    }
    const res = await readOne(c, def, { rowLimit: limit })
    dataset[def.key] = res.available ? res.rows : []
    const { rows, ...status } = res

    // HANDOFF S4 (t_22865fc4) — WAJIB: invoice punya DUA backend. Supabase =
    // kanonik/durable; file JSON lokal = PRATINJAU saja (tidak durable, tidak
    // dibagi antar-instance). Lapisan reminder TIDAK boleh menyamakan
    // keduanya: kalau yang ada hanya file pratinjau, data itu TIDAK boleh
    // dipakai untuk keputusan penagihan nyata. Karena itu keberadaan file
    // pratinjau DILAPORKAN (bukan dibaca sebagai data kanonik).
    if (def.key === 'sales_invoices' && !res.available) {
      const preview = inspectInvoicePreview(previewDir)
      status.durable = false
      status.preview = preview
    } else if (def.key === 'sales_invoices') {
      status.durable = true
      status.preview = { exists: false, rows: 0, relative_path: null }
    }

    sources.push(status)
  }

  return {
    dataset,
    sources,
    meta: {
      read_only: true,
      row_limit: limit,
      client_ready: !!c,
      client_reason: reason,
      // t_50b783de: daftar query yang BENAR-BENAR dijalankan (approval_steps
      // tidak muncul saat modul Approval OFF).
      queries: SOURCES
        .filter(d => !(d.key === 'approval_steps' && !APPROVAL_MODULE_ENABLED))
        .map(d => ({ table: d.table, method: 'SELECT' }))
    }
  }
}

// Membaca HANYA metadata file pratinjau invoice (jumlah baris). Tidak pernah
// memakai isinya sebagai data kanonik. Read-only: tidak menulis/menghapus.
export function inspectInvoicePreview(previewDir = null) {
  const empty = { exists: false, rows: 0, relative_path: null, durable: false }
  try {
    // Bila direktori pratinjau ditentukan eksplisit (env/test), HANYA
    // direktori itu yang diperiksa — jangan diam-diam jatuh ke data/ repo
    // karena hasilnya bisa menyesatkan (melaporkan file yang tidak dimaksud).
    const dir = previewDir || process.env.SALES_INVOICE_PREVIEW_DIR || null
    const candidates = dir
      ? [path.join(dir, 'sales_invoices.json')]
      : [path.join(process.cwd(), 'data', 'sales_invoices.json')]
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue
      const raw = fs.readFileSync(file, 'utf8')
      let rows = 0
      try {
        const parsed = JSON.parse(raw)
        rows = Array.isArray(parsed) ? parsed.length : 0
      } catch (_) {
        rows = 0
      }
      return {
        exists: true,
        rows,
        relative_path: path.relative(process.cwd(), file) || file,
        durable: false,
        note: 'Pratinjau lokal (file JSON) — tidak durable, tidak dibagi antar-instance. JANGAN dipakai untuk keputusan penagihan nyata.'
      }
    }
    return empty
  } catch (_) {
    return empty
  }
}

// Dipakai harness & CLI untuk membuktikan tidak ada operasi tulis di file ini.
export const FORBIDDEN_OPERATIONS = Object.freeze(['insert', 'update', 'delete', 'upsert', 'rpc', 'sendMessage', 'fetch'])
