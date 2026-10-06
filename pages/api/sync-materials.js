import { createClient } from '@supabase/supabase-js'
import materialsData from '../../data/materials_seed.json'

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Missing supabase credentials' })
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    // 1. Delete all existing records in materials
    const { error: delErr } = await supabase
      .from('materials')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (delErr) {
      return res.status(500).json({ error: 'Failed to delete old materials: ' + delErr.message })
    }

    // 2. Insert in chunks of 50
    const chunkSize = 50
    let inserted = 0
    for (let i = 0; i < materialsData.length; i += chunkSize) {
      const chunk = materialsData.slice(i, i + chunkSize)
      const { error: insErr } = await supabase.from('materials').insert(chunk)
      if (insErr) {
        return res.status(500).json({ error: `Failed to insert chunk ${i}: ${insErr.message}` })
      }
      inserted += chunk.length
    }

    return res.status(200).json({ success: true, count: inserted })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
