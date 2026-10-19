// Read-only: distribusi status nyata + jumlah PR tanpa approval_steps.
// SELECT saja. Tidak mencetak kredensial, tidak menulis apa pun.
import fs from 'node:fs'

const txt = fs.readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
const env = {}
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (!m) continue
  env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
const url = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function get(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const text = await res.text()
  try { return { status: res.status, data: JSON.parse(text) } } catch { return { status: res.status, data: text.slice(0, 200) } }
}

const prs = await get('purchase_requests?select=id,pr_number,status,notes,title&order=pr_number.asc')
const items = await get('pr_items?select=id,pr_id,status')
const steps = await get('approval_steps?select=id,purchase_request_id,status,step_number')

if (prs.status >= 400) { console.log('ERR prs', prs); process.exit(0) }
const byStatus = {}
for (const p of prs.data) byStatus[p.status] = (byStatus[p.status] || 0) + 1
const itemStatus = {}
for (const it of items.data || []) itemStatus[it.status] = (itemStatus[it.status] || 0) + 1
const stepByPr = {}
for (const s of steps.data || []) stepByPr[s.purchase_request_id] = (stepByPr[s.purchase_request_id] || 0) + 1

const rows = prs.data.map(p => ({
  pr_number: p.pr_number,
  status: p.status,
  steps: stepByPr[p.id] || 0,
  items: (items.data || []).filter(i => i.pr_id === p.id).length,
  title: String(p.title || '').slice(0, 40)
}))
console.log(JSON.stringify({
  total_pr: prs.data.length,
  by_status: byStatus,
  pr_item_status: itemStatus,
  total_approval_steps: (steps.data || []).length,
  prs: rows
}, null, 1))
