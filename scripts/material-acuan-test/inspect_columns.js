// Inspeksi skema READ-ONLY (t_090127ad): dump kolom + sampel baris tabel
// relasi pengadaan. Tidak menulis apa pun ke DB — hanya SELECT limit 3.
// Dipakai saat merancang resolver acuan harga (modules/materials/acuan.js).
const { createClient } = require('@supabase/supabase-js')
require('fs').readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
})
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const tables = ['receivings', 'receiving_items', 'handovers', 'pr_items', 'materials']
;(async () => {
  for (const t of tables) {
    const { data, error, count } = await sb.from(t).select('*', { count: 'exact' }).limit(3)
    if (error) { console.log(`\n## ${t}: ERROR ${error.message}`); continue }
    console.log(`\n## ${t} (count=${count}) columns:`, data && data[0] ? Object.keys(data[0]).join(', ') : '(no rows)')
    for (const r of (data || [])) console.log('   sample:', JSON.stringify(r).slice(0, 400))
  }
})()
