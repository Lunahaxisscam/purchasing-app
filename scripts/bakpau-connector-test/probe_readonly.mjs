// ============================================================
// probe_readonly.mjs — PROBE READ-ONLY (SELECT saja) untuk konektor Bakpau.
// ============================================================
// Tujuan: memastikan BENTUK kolom nyata dari master yang akan dipakai
// adapter (projects / vendors / materials / receivings / receiving_items)
// dan APAKAH tabel ledger idempotensi (`bakpau_events`) sudah ada.
//
// ATURAN:
//   * HANYA `select(...).limit(1)` — tidak ada insert/update/delete/rpc.
//   * Kunci TIDAK pernah dicetak (hanya boolean "ada/tidak").
//   * Bila RLS menolak, hasilnya dilaporkan apa adanya (bukan dianggap kosong).
//
// Jalankan: node scripts/bakpau-connector-test/probe_readonly.mjs
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

function loadEnv(file) {
  const out = {}
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* file tidak ada -> env kosong */ }
  return out
}

const env = { ...loadEnv(path.join(process.cwd(), '.env.local')), ...process.env }
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) {
  console.log(JSON.stringify({ ok: false, reason: 'no_credentials_in_env' }, null, 2))
  process.exit(2)
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const out = { ok: true, anon_key_present: !!key, service_key_present: !!env.SUPABASE_SERVICE_ROLE_KEY, tables: {} }

const TABLES = ['projects', 'vendors', 'materials', 'receivings', 'receiving_items', 'purchase_requests', 'pr_items', 'handovers', 'bakpau_events', 'bakpau_idempotency']

for (const t of TABLES) {
  const { data, error, count } = await sb.from(t).select('*', { count: 'exact' }).limit(1)
  if (error) {
    out.tables[t] = { exists: false, error_code: error.code || null, error: String(error.message || '').slice(0, 160) }
    continue
  }
  out.tables[t] = {
    exists: true,
    count: count === null ? null : count,
    columns: data && data[0] ? Object.keys(data[0]).sort() : [],
    sample_keys_only: true
  }
}

console.log(JSON.stringify(out, null, 2))
