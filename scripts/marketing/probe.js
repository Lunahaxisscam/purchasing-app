// ============================================================
// scripts/marketing/probe.js — PEMERIKSA KETERSEDIAAN TABEL (READ-ONLY)
// ============================================================
// SERVER-ONLY. Satu-satunya file di lapisan marketing yang menyentuh jaringan.
//
// JAMINAN (ditegakkan harness, bukan niat):
//   * Hanya SELECT. Tidak ada insert/update/delete/upsert/rpc di file ini.
//   * TIDAK mengirim pesan, TIDAK memasang iklan/pixel, TIDAK ada cron.
//   * Hanya membaca tabel yang MENURUT KONTRAK boleh dibaca marketing
//     (leads, lead_touchpoints, campaigns, lead_handoffs, customers, projects).
//     Tabel milik modul purchasing/keuangan TIDAK PERNAH disebut di file ini —
//     itu inti invarian "tidak mengganggu purchasing" (dibuktikan harness C4).
//   * Tabel yang tidak ada (PGRST205) dilaporkan `available:false` +
//     kode error — BUKAN "0 baris" dan BUKAN data karangan.
// ============================================================

import { createClient } from '@supabase/supabase-js'

// Hanya tabel yang boleh dibaca lapisan marketing (lihat TABLE_OWNERSHIP).
export const READABLE_SOURCES = Object.freeze([
  { key: 'leads', table: 'leads', owner: 'marketing', note: 'Inti modul marketing — belum ada tabelnya.' },
  { key: 'lead_touchpoints', table: 'lead_touchpoints', owner: 'marketing', note: 'Bukti kontak (syarat status CONTACTED).' },
  { key: 'campaigns', table: 'campaigns', owner: 'marketing', note: 'Kampanye untuk atribusi.' },
  { key: 'lead_handoffs', table: 'lead_handoffs', owner: 'marketing', note: 'Jejak handoff + idempotensi.' },
  { key: 'customers', table: 'customers', owner: 'crm', note: 'CRM — belum ada tabelnya (PGRST205).' },
  { key: 'projects', table: 'projects', owner: 'projects', note: 'Dibaca untuk atribusi/penautan. Marketing TIDAK menulis.' }
])

export const DEFAULT_ROW_LIMIT = 200
export const MAX_ROW_LIMIT = 1000

function makeClient(env = process.env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    return { client: null, reason: 'Kredensial Supabase tidak tersedia (SUPABASE_URL / anon key kosong).' }
  }
  return {
    client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    reason: null
  }
}

export function classifyError(error) {
  const code = String((error && error.code) || '')
  const message = String((error && error.message) || 'Gagal membaca data.')
  if (code === 'PGRST205' || code === '42P01' || /could not find the table|does not exist/i.test(message)) {
    return { error_code: 'SCHEMA_UNAVAILABLE', error_message: message }
  }
  if (code === '42501' || /permission denied|row-level security/i.test(message)) {
    return { error_code: 'PERMISSION_DENIED', error_message: message }
  }
  if (code === 'PGRST301' || /jwt/i.test(message)) {
    return { error_code: 'AUTH_ERROR', error_message: message }
  }
  return { error_code: code || 'READ_FAILED', error_message: message }
}

// Baca SATU tabel secara read-only. `limit: 1` cukup: lapisan ini hanya
// melaporkan ketersediaan, bukan memuat seluruh data lead.
async function probeOne(client, def, { rowLimit }) {
  const base = {
    key: def.key,
    table: def.table,
    owner: def.owner,
    note: def.note,
    available: false,
    row_count: 0,
    fetched: 0,
    columns: [],
    error_code: null,
    error_message: null
  }
  if (!client) {
    return { ...base, error_code: 'NO_CREDENTIALS', error_message: 'Klien Supabase tidak tersedia.' }
  }

  const { data, count, error } = await client
    .from(def.table)
    .select('*', { count: 'exact' })
    .limit(rowLimit)

  if (error) return { ...base, ...classifyError(error) }
  const rows = Array.isArray(data) ? data : []
  return {
    ...base,
    available: true,
    row_count: typeof count === 'number' ? count : rows.length,
    fetched: rows.length,
    columns: rows.length ? Object.keys(rows[0]) : []
  }
}

// probe({ env, rowLimit, client }) -> { sources, meta }
// TIDAK mengembalikan baris data: lapisan kontrak tidak butuh isi tabel, dan
// dengan begitu tidak ada risiko data pelanggan ikut tercetak di laporan.
export async function probe({ env = process.env, rowLimit = DEFAULT_ROW_LIMIT, client = null } = {}) {
  const limit = Math.max(1, Math.min(Number(rowLimit) || DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT))
  let c = client
  let reason = null
  if (!c) {
    const made = makeClient(env)
    c = made.client
    reason = made.reason
  }

  const sources = []
  for (const def of READABLE_SOURCES) {
    sources.push(await probeOne(c, def, { rowLimit: limit }))
  }

  return {
    sources,
    meta: {
      read_only: true,
      row_limit: limit,
      client_ready: !!c,
      client_reason: reason,
      queries: READABLE_SOURCES.map(d => ({ table: d.table, method: 'SELECT', limit }))
    }
  }
}

// Dipakai harness untuk membuktikan tidak ada operasi tulis di file ini.
// Daftar tabel yang HARAM disentuh tidak diulang di sini — sumber tunggalnya
// `TABLE_OWNERSHIP` di contract.js (harness C memeriksa file ini tidak
// menyebut satu pun tabel purchasing).
export const FORBIDDEN_OPERATIONS = Object.freeze(['insert', 'update', 'delete', 'upsert', 'rpc'])
