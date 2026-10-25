// ============================================================
// probe_live.mjs — probe READ-ONLY kemampuan skema di Supabase LIVE
// ============================================================
// Menjawab satu pertanyaan dengan bukti, bukan asumsi:
//   "Apakah tabel ledger per barang sudah ADA di database produksi?"
//
// Hanya SELECT limit 1 (GET). Tidak ada insert/update/DDL. Memakai anon key
// yang sama dengan yang dikirim aplikasi ke browser (bukan service role).
//
// Keluaran: status per objek + verdict `ready`/`returnReady` yang HARUS sama
// dengan yang dihitung receiptCapability.js di aplikasi.
//
// Jalankan: node scripts/receipt-physical-test/probe_live.mjs
// ============================================================
import fs from 'node:fs'

const ENV_CANDIDATES = [
  '/home/ubuntu/dev-workspaces/release-novi-4a92bec/.env.local',
  '/home/ubuntu/purchasing-app/.env.local'
]
let env = ''
for (const p of ENV_CANDIDATES) {
  try { env = fs.readFileSync(p, 'utf8'); if (env) { console.log(`env: ${p}`); break } } catch {}
}
if (!env) { console.error('Tidak ada .env.local yang bisa dibaca.'); process.exit(2) }
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^"|"$/g, '')
const SUPABASE_URL = get('NEXT_PUBLIC_SUPABASE_URL')
const KEY = get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
if (!SUPABASE_URL || !KEY) { console.error('env tidak lengkap'); process.exit(2) }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function probe(table, columns) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${columns.join(',')}&limit=1`
  try {
    const r = await fetch(url, { headers: H })
    const text = await r.text()
    let body = null
    try { body = JSON.parse(text) } catch { body = text.slice(0, 200) }
    if (r.ok) return { table, ok: true, rows: Array.isArray(body) ? body.length : 0 }
    return { table, ok: false, status: r.status, code: body?.code || null, message: body?.message || String(body).slice(0, 160) }
  } catch (e) {
    return { table, ok: false, status: 0, code: 'FETCH', message: e.message }
  }
}

const EVENT_COLUMNS = ['id', 'client_event_id', 'receiving_id', 'receiving_item_id', 'pr_item_id',
  'item_name', 'unit', 'qty_datang', 'qty_rusak', 'tujuan_ws', 'tujuan_tukang', 'penerima_tukang',
  'retur_status', 'retur_qty', 'discard_confirmed', 'foto_ref', 'source', 'created_at']
const HANDOVER_ITEM_COLUMNS = ['id', 'handover_id', 'receiving_event_id', 'receiving_item_id', 'pr_item_id',
  'item_name', 'qty_diserahkan', 'satuan', 'penerima', 'catatan', 'created_at']
const RETURN_LINE_COLUMNS = ['id', 'return_case_id', 'receiving_event_id', 'qty']
const PROGRESS_COLUMNS = ['receiving_item_id', 'qty_datang', 'qty_rusak', 'qty_baik', 'belum_diserahkan',
  'qty_bought', 'qty_arrived', 'qty_handed_over', 'tujuan_tukang']

const results = []
results.push(await probe('receiving_events', EVENT_COLUMNS))
results.push(await probe('handover_items', HANDOVER_ITEM_COLUMNS))
results.push(await probe('return_lines', RETURN_LINE_COLUMNS))
results.push(await probe('v_receipt_progress', PROGRESS_COLUMNS))

const by = Object.fromEntries(results.map(r => [r.table, r]))
const ready = !!(by.receiving_events.ok && by.handover_items.ok && by.v_receipt_progress.ok)
const returnReady = ready && !!by.return_lines.ok

// Data live yang relevan (READ-ONLY, hanya hitung baris).
async function count(table) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
    const cr = r.headers.get('content-range') || ''
    const n = cr.split('/')[1]
    return n === undefined ? null : Number(n)
  } catch { return null }
}

console.log('\n=== HASIL PROBE LIVE (READ-ONLY, anon key) ===\n')
for (const r of results) {
  console.log(r.ok
    ? `  ✓ ${r.table.padEnd(22)} ADA (${r.rows} baris terbaca pada limit 1)`
    : `  ✗ ${r.table.padEnd(22)} TIDAK BISA DIBACA — ${r.status} ${r.code || ''} ${String(r.message).slice(0, 100)}`)
}
console.log(`\n  ready       = ${ready}`)
console.log(`  returnReady = ${returnReady}`)
console.log(`  mode UI     = ${ready ? 'READY' : 'LEGACY'}`)
console.log('\n=== DATA LIVE (hanya jumlah, tidak dibaca isinya) ===')
for (const t of ['receivings', 'receiving_items', 'handovers', 'purchase_requests', 'pr_items', 'vendors']) {
  console.log(`  ${t.padEnd(20)} ${await count(t)}`)
}

const out = {
  probed_at: new Date().toISOString(),
  base: SUPABASE_URL,
  results,
  ready,
  returnReady,
  ui_mode: ready ? 'READY' : 'LEGACY'
}
fs.writeFileSync(new URL('./probe_live_result.json', import.meta.url), JSON.stringify(out, null, 2))
console.log('\n  → probe_live_result.json ditulis')
