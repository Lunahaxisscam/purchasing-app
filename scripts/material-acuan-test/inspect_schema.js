// Inspeksi skema READ-ONLY untuk t_090127ad (Material acuan harga).
// Tidak menulis apa pun ke DB — hanya SELECT ke tabel existing + probe
// keberadaan tabel kandidat ledger harga (semuanya read-only).
const { createClient } = require('@supabase/supabase-js')
require('fs').readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
})
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
;(async () => {
  for (const t of ['purchase_requests', 'vendors']) {
    const { data, error } = await sb.from(t).select('*').limit(2)
    if (error) { console.log('##', t, 'ERR', error.message); continue }
    console.log('##', t, 'cols:', data[0] ? Object.keys(data[0]).join(', ') : '(kosong)')
    for (const r of data) console.log('   ', JSON.stringify(r).slice(0, 300))
  }
  // Probe keberadaan tabel kandidat ledger harga (read-only, limit 1).
  for (const t of ['material_price_history', 'price_history', 'material_prices', 'vendor_prices', 'material_vendor_prices']) {
    const { error } = await sb.from(t).select('*').limit(1)
    console.log('probe', t, error ? 'TIDAK ADA (' + error.message.slice(0, 60) + ')' : 'ADA')
  }
  // Cek data historis nyata: berapa receiving_items yang qty>0 dan punya material_id?
  const { data: ri, error: riErr } = await sb.from('receiving_items').select('id, receiving_id, pr_item_id, quantity_received, unit, created_at').limit(1000)
  if (riErr) { console.log('receiving_items ERR', riErr.message); return }
  const recIds = [...new Set(ri.map(x => x.receiving_id))]
  const prItemIds = [...new Set(ri.map(x => x.pr_item_id).filter(Boolean))]
  console.log('receiving_items rows:', ri.length, '| receivings unik:', recIds.length, '| pr_item_id unik:', prItemIds.length)
})()
