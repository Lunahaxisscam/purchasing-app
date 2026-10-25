// Read-only probe: baca OpenAPI PostgREST utk daftar kolom (TIDAK menulis apa pun).
// Dipakai hanya utk memastikan skema existing cukup; tidak mencetak kredensial.
import fs from 'node:fs'

const txt = fs.readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
const env = {}
for (const line of txt.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (!m) continue
  env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) {
  console.log(JSON.stringify({ ok: false, error: 'env tidak lengkap', hasUrl: !!url, hasKey: !!key }))
  process.exit(0)
}

const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/', {
  headers: { apikey: key, Authorization: 'Bearer ' + key }
})
console.log('HTTP', res.status)
const body = await res.text()
let spec = null
try { spec = JSON.parse(body) } catch { /* bukan JSON */ }
if (!spec || !spec.definitions) {
  console.log('BODY_HEAD:', body.slice(0, 300))
  process.exit(0)
}
const want = ['purchase_requests', 'pr_items', 'receivings', 'receiving_items', 'approval_steps', 'materials', 'vendors']
const out = {}
for (const t of want) {
  const d = spec.definitions[t]
  if (!d) { out[t] = null; continue }
  out[t] = Object.entries(d.properties || {}).map(([name, p]) => ({
    name,
    type: p.type || (p.format === 'text[]' ? 'array' : p.format),
    format: p.format,
    enum: p.enum || null,
    desc: (p.description || '').slice(0, 160)
  }))
}
console.log(JSON.stringify(out, null, 1))
