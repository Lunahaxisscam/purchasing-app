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

  const candidateCols = [
    'id', 'purchase_request_id', 'project_id', 'vendor_id',
    'delivery_note', 'invoice_no', 'status', 'note', 'received_date',
    'alokasi', 'masuk_gudang', 'tukang_at', 'kendala', 'created_at',
    'total_amount', 'total_cost', 'total_price', 'amount', 'nominal',
    'nota_url', 'photo_url', 'attachment_url', 'file_url', 'receipt_url'
  ]

  const results = {}
  for (const c of candidateCols) {
    const { error } = await supabase.from('receivings').select(c).limit(1)
    results[c] = !error
  }

  return res.status(200).json({ receivings_columns: results })
}
