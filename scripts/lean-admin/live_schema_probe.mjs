// Read-only probe LIVE (SELECT saja, tidak ada write/DDL).
// Tujuan: tahu kolom nyata + nilai status yang benar-benar dipakai, supaya
// keputusan "pakai enum existing" tidak menebak. Tidak mencetak kredensial.
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
if (!url || !key) {
  console.log(JSON.stringify({ ok: false, error: 'env tidak lengkap' }))
  process.exit(0)
}

async function get(path, params = '') {
  const res = await fetch(`${url}/rest/v1/${path}${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' }
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text.slice(0, 200) }
  return { status: res.status, data }
}

const tables = ['purchase_requests', 'pr_items', 'receivings', 'receiving_items', 'approval_steps', 'materials', 'vendors', 'projects']
const out = { ok: true, tables: {} }
for (const t of tables) {
  const r = await get(t, '?select=*&limit=1')
  if (r.status >= 400) { out.tables[t] = { status: r.status, error: r.data }; continue }
  const row = Array.isArray(r.data) ? r.data[0] : null
  out.tables[t] = { status: r.status, columns: row ? Object.keys(row) : [], sample: row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? (v.length > 60 ? v.slice(0, 60) + '…' : v) : v])) : null }
}
console.log(JSON.stringify(out, null, 1))
