// ============================================================
// API Route: /api/alerts/telegram — Sprint 1 Real-Time Alerting.
// ============================================================
// Endpoint operasional untuk sistem alert Telegram:
//
//   GET  /api/alerts/telegram
//        → status konfigurasi + riwayat alert terakhir (butuh JWT admin)
//
//   POST /api/alerts/telegram  { "action": "test" }
//        → kirim pesan uji ke chat Telegram DAT (butuh JWT admin)
//
//   POST /api/alerts/telegram  { "action": "cost-scan", "token": "<drive_sync_token>" }
//        → scan cost proyek >= 65% & kirim early warning (dipakai daemon
//          drive-sync setelah sinkron Google Sheets; token ter-gate di DB)
//
// KEAMANAN:
//   * Token bot Telegram TIDAK PERNAH melewati endpoint ini — semua
//     pengiriman dilakukan di dalam database (RPC + ekstensi http).
//   * Verifikasi otorisasi dilakukan DB (fn_telegram_is_admin /
//     drive_sync_token) — endpoint hanya meneruskan hasil.
// ============================================================

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, error: 'Konfigurasi Supabase tidak tersedia.' })
  }

  // Teruskan JWT user (bila ada) supaya guard admin di DB bisa menilai.
  const authHeader = req.headers.authorization || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : {}
  })

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.rpc('telegram_alert_status')
      if (error) return res.status(403).json({ ok: false, error: error.message })
      return res.status(200).json(data)
    }

    if (req.method === 'POST') {
      const { action, token, min_step } = req.body || {}

      if (action === 'test') {
        const { data, error } = await supabase.rpc('telegram_send_test', { p_token: token || null })
        if (error) return res.status(403).json({ ok: false, error: error.message })
        const ok = data && data.ok === true
        return res.status(ok ? 200 : 502).json(data)
      }

      if (action === 'cost-scan') {
        const { data, error } = await supabase.rpc('telegram_send_cost_alerts', {
          p_token: token || null,
          p_min_step: typeof min_step === 'number' ? min_step : 2
        })
        if (error) return res.status(403).json({ ok: false, error: error.message })
        const ok = data && data.ok === true
        return res.status(ok ? 200 : 502).json(data)
      }

      return res.status(400).json({ ok: false, error: 'Aksi tidak dikenal. Gunakan "test" atau "cost-scan".' })
    }

    res.setHeader('Allow', ['GET', 'POST'])
    return res.status(405).json({ ok: false, error: 'Method tidak diizinkan.' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
}
