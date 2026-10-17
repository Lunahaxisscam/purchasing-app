#!/usr/bin/env node
// ============================================================
// PROBE LIVE (READ-ONLY) — memastikan capability probe di aplikasi
// menjawab sama dengan kenyataan schema Supabase saat ini.
// Hanya SELECT limit 1. Tidak menulis apa pun. Tidak mencetak secret.
// Jalankan dari root repo: node scripts/receiving-events-test/probe_live.mjs
// ============================================================
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const EVENT_COLUMNS = ['id', 'client_event_id', 'receiving_id', 'receiving_item_id', 'pr_item_id',
  'item_name', 'unit', 'qty_datang', 'qty_rusak', 'tujuan_ws', 'tujuan_tukang', 'penerima_tukang',
  'retur_status', 'retur_qty', 'discard_confirmed', 'foto_ref', 'source', 'created_at']
const HANDOVER_COLUMNS = ['id', 'handover_id', 'receiving_event_id', 'receiving_item_id', 'pr_item_id',
  'item_name', 'qty_diserahkan', 'satuan', 'penerima', 'catatan', 'created_at']

async function probe(table, cols) {
  const { error } = await supabase.from(table).select(cols.join(',')).limit(1)
  if (!error) return { table, ok: true }
  return { table, ok: false, code: error.code || null, message: error.message }
}

const results = []
results.push(await probe('receiving_events', EVENT_COLUMNS))
results.push(await probe('handover_items', HANDOVER_COLUMNS))
results.push(await probe('v_receipt_progress', ['receiving_item_id', 'qty_datang', 'qty_rusak', 'qty_baik', 'tujuan_ws', 'tujuan_tukang', 'belum_diserahkan']))

console.log('--- PROBE SKEMA LEDGER PER BARANG (read-only) ---')
for (const r of results) {
  console.log(`${r.ok ? 'ADA    ' : 'TIDAK  '} ${r.table}${r.ok ? '' : '  (' + (r.code || '') + ') ' + (r.message || '').slice(0, 80)}`)
}
const ready = results[0].ok && results[1].ok
console.log('\nCAPABILITY ready =', ready)
console.log(ready
  ? 'Aplikasi akan memakai mode READY (simpan per barang via RPC).'
  : 'Aplikasi akan memakai mode LEGACY: jumlah datang tetap tersimpan, dimensi per barang DIBLOK dengan pesan gap (nol tulisan).')
process.exit(0)
