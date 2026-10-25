// Cek status approval_steps via anon key (read-only, untuk verifikasi runtime)
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
require('fs').readFileSync('.env.local', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
})
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
sb.from('approval_steps').select('status').then(({ data, error }) => {
  if (error) console.log('ERR', error.message)
  else {
    const c = {}
    data.forEach(r => { c[r.status] = (c[r.status] || 0) + 1 })
    console.log('approval_steps status counts:', JSON.stringify(c), 'total', data.length)
  }
})
