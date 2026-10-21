// Read-only live probe (run 239): apakah 4 objek ledger masih PGRST205?
// Tidak ada tulisan. Hanya SELECT dengan limit 1 lewat REST + anon key.
const URL_BASE = process.env.SUPABASE_URL || 'https://wuurovgjflrhczlsbixm.supabase.co'
const KEY = process.env.SUPABASE_ANON || ''

const tables = [
  ['receiving_events', 'id'],
  ['handover_items', 'id'],
  ['return_lines', 'id'],
  ['v_receipt_progress', 'receiving_item_id']
]
const out = []
for (const [t, col] of tables) {
  const url = `${URL_BASE}/rest/v1/${t}?select=${col}&limit=1`
  const r = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  let body = ''
  try { body = await r.text() } catch (e) { body = '' }
  let code = ''
  try { code = JSON.parse(body)?.code || '' } catch (e) { code = '' }
  out.push({ table: t, status: r.status, code })
}
console.log(JSON.stringify(out, null, 1))
const allMissing = out.every(o => o.code === 'PGRST205')
console.log(allMissing ? '\nSEMUA objek ledger masih PGRST205 → live tetap LEGACY' : '\nPERHATIAN: ada objek yang sudah ADA (migrasi tampaknya berjalan)')
