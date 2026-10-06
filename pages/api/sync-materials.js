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
    // 1. Update existing materials with new fields (satuan, unit, etc.)
    const chunkSize = 20
    let updated = 0
    for (let i = 0; i < materialsData.length; i += chunkSize) {
      const chunk = materialsData.slice(i, i + chunkSize)
      await Promise.all(chunk.map(async item => {
        await supabase
          .from('materials')
          .update({
            satuan: item.satuan,
            unit: item.unit,
            name: item.name,
            category: item.category,
            qty: item.qty
          })
          .eq('kode', item.kode)
      }))
      updated += chunk.length
    }

    return res.status(200).json({ success: true, count: updated })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
