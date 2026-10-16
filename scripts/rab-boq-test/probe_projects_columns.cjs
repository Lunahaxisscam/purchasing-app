#!/usr/bin/env node
// Read-only probe: kolom tabel projects (REST GET, anon) untuk mapping
// identitas master project (t_18564dce run 58). TIDAK ada insert/update.
const fs = require('fs')
const path = require('path')
const repo = '/home/ubuntu/purchasing-app'
const env = fs.readFileSync(path.join(repo, '.env.local'), 'utf8')
const url = (env.match(/NEXT_PUBLIC_SUPABASE_URL\s*=\s*(\S+)/) || [])[1]
const key = (env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY\s*=\s*(\S+)/) || [])[1]
if (!url || !key) { console.log('NO_ENV'); process.exit(0) }
const base = url.replace(/\/$/, '') + '/rest/v1'
async function get(q) {
  const r = await fetch(base + q, { headers: { apikey: key, Authorization: 'Bearer ' + key } })
  const j = await r.json().catch(() => null)
  return { status: r.status, body: j }
}
;(async () => {
  const one = await get('/projects?select=*&limit=1')
  if (one.body && Array.isArray(one.body) && one.body[0]) {
    console.log('projects columns:', Object.keys(one.body[0]).join(', '))
    console.log('sample:', JSON.stringify(one.body[0]).slice(0, 300))
  } else {
    console.log('projects empty/err:', one.status, JSON.stringify(one.body).slice(0, 200))
  }
  const last = await get('/projects?select=id,kode,code,name,status&order=id.desc&limit=5')
  console.log('last5 (id desc):', JSON.stringify(last.body))
  // How many total (HEAD count via Prefer count)
  const r2 = await fetch(base + '/projects?select=id', {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'count=exact', Range: '0-0' }
  })
  console.log('count:', r2.headers.get('content-range'))
})().catch(e => { console.log('ERR', e.message); process.exit(0) })
