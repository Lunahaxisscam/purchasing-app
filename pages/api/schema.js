import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // KEAMANAN: endpoint maintenance ini dapat mengubah/menghapus data produksi.
  // Wajibkan token admin lewat header (x-maintenance-token) atau query ?token=.
  const MAINT_TOKEN = process.env.MAINTENANCE_TOKEN
  if (!MAINT_TOKEN) {
    return res.status(403).json({ error: 'Endpoint maintenance dinonaktifkan (MAINTENANCE_TOKEN belum diset).' })
  }
  const provided = req.headers['x-maintenance-token'] || req.query.token
  if (provided !== MAINT_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }


  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Missing supabase credentials' })
  const supabase = createClient(supabaseUrl, supabaseKey)
  const tables = ['projects','vendors','materials','purchase_requests','pr_items','approval_steps','receivings','receiving_items','handovers']
  const out = {}
  for (const t of tables) {
    const { data, count, error } = await supabase.from(t).select('*', { count: 'exact' }).limit(1)
    out[t] = { count: count || 0, columns: data && data[0] ? Object.keys(data[0]) : [], error: error ? error.message : null }
  }
  return res.status(200).json(out)
}
