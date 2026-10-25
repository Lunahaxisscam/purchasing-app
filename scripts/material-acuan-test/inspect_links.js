// Verifikasi lanjutan READ-ONLY: apakah pr_items.unit konsisten dengan
// materials.satuan, dan apakah relasi pr_items.material_id -> materials ada.
// Juga cek estimated_price vs harga_acuan (apakah estimasi mengikuti acuan).
const { createClient } = require('@supabase/supabase-js')
require('fs').readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
})
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
;(async () => {
  const { data: items, error } = await sb.from('pr_items').select('id, pr_id, material_id, vendor_id, quantity, estimated_price, unit, item_name, kode').limit(500)
  if (error) { console.log('ERR', error.message); return }
  const { data: mats } = await sb.from('materials').select('id, name, satuan, unit, harga_acuan, category').limit(1000)
  const matMap = new Map((mats || []).map(m => [m.id, m]))
  let linked = 0, unlinked = 0, withPrice = 0, priceNull = 0, unitMatch = 0, unitDiff = 0
  const samples = []
  for (const it of items) {
    const m = it.material_id ? matMap.get(it.material_id) : null
    if (m) linked++; else unlinked++
    if (it.estimated_price === null || it.estimated_price === undefined || it.estimated_price === '') priceNull++
    else withPrice++
    if (m) {
      const mu = (m.satuan || m.unit || '').trim()
      const iu = (it.unit || '').trim()
      if (mu && iu && mu.toLowerCase() === iu.toLowerCase()) unitMatch++
      else { unitDiff++; if (samples.length < 5) samples.push(`${it.item_name} [pr:${iu}] vs mat [${mu}] acuan=${m.harga_acuan} est=${it.estimated_price}`) }
    }
  }
  console.log(`pr_items total=${items.length} | linked material=${linked} unlinked=${unlinked}`)
  console.log(`estimated_price terisi=${withPrice} null=${priceNull}`)
  console.log(`unit sama=${unitMatch} beda=${unitDiff}`)
  for (const s of samples) console.log('  beda:', s)
  // berapa material yang punya harga_acuan?
  const withAcuan = (mats || []).filter(m => m.harga_acuan !== null && m.harga_acuan !== undefined && m.harga_acuan !== '')
  console.log(`materials dengan harga_acuan: ${withAcuan.length}/${(mats || []).length}`)
  for (const m of withAcuan.slice(0, 5)) console.log('  ', m.name, '=', m.harga_acuan, m.satuan)
})()
