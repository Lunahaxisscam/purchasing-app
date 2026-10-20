// Probe READ-ONLY data live (anon key, GET saja): apakah ada baris nota
// dengan quantity_received = 0 (cangkang) dan berapa nota yang qty belinya
// lebih kecil dari qty pesanan PR. TIDAK menulis apa pun, tidak mencetak key.
import fs from 'node:fs'

const ENV = ['/home/ubuntu/dev-workspaces/release-novi-4a92bec/.env.local', '/home/ubuntu/purchasing-app/.env.local']
let env = ''
for (const p of ENV) { try { env = fs.readFileSync(p, 'utf8'); if (env) break } catch {} }
if (!env) { console.error('env tidak terbaca'); process.exit(2) }
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^"|"$/g, '')
const URL = get('NEXT_PUBLIC_SUPABASE_URL')
const KEY = get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function sel(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H })
  const t = await r.text()
  let b = null
  try { b = JSON.parse(t) } catch { b = t.slice(0, 200) }
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(b).slice(0, 200)}`)
  return b
}

const recs = await sel('receivings?select=id,invoice_no,status,received_date,purchase_request_id,note&limit=200')
const items = await sel('receiving_items?select=id,receiving_id,pr_item_id,item_name,quantity_received&limit=500')
const prItems = await sel('pr_items?select=id,item_name,quantity,status&limit=500')

const prById = new Map(prItems.map(p => [p.id, p]))
const byRec = new Map()
for (const it of items) {
  const l = byRec.get(it.receiving_id) || []
  l.push(it)
  byRec.set(it.receiving_id, l)
}

console.log(`receivings=${recs.length} receiving_items=${items.length} pr_items=${prItems.length}\n`)
let zeroRows = 0
let overBought = 0
for (const r of recs) {
  const list = byRec.get(r.id) || []
  const isNota = !!(r.invoice_no || '').trim()
  console.log(`- ${r.invoice_no || '(tanpa nomor)'} | status=${r.status} | items=${list.length}`)
  for (const it of list) {
    const q = Number(it.quantity_received || 0)
    const pr = it.pr_item_id ? prById.get(it.pr_item_id) : null
    const ordered = Number(pr?.quantity || 0)
    if (q <= 0) zeroRows++
    if (q > 0 && ordered > 0 && q < ordered) overBought++
    console.log(`    · ${it.item_name} | BELI=${q} | pesanan PR=${ordered || '—'} | ${q <= 0 ? 'BELUM DIBELI (baris 0)' : (ordered > q ? 'dibeli sebagian' : 'penuh')}`)
  }
}
console.log(`\nRINGKASAN: baris qty 0 = ${zeroRows} · baris dibeli sebagian (BELI < pesanan) = ${overBought}`)
