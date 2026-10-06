import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Missing supabase credentials' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const tables = ['projects', 'vendors', 'materials', 'purchase_requests', 'pr_items', 'approval_steps', 'receivings', 'receiving_items', 'handovers']
  const results = {}

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1)
    results[table] = { sample: data, error: error ? error.message : null }
  }

  return res.status(200).json(results)
}
