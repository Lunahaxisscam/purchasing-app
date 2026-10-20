// ============================================================
// probe_transport_readiness.mjs — BISAKAH UJI TRANSPORT LIVE DARI LANE INI?
// ============================================================
// Tujuan: membuktikan secara READ-ONLY (tanpa mengirim pesan apa pun) apakah
// lane ini punya otorisasi yang cukup untuk (a) membaca identitas chat tujuan
// dan (b) memicu pesan uji resmi.
//
// KENAPA INI PENTING:
//   Aturan DAT: "Jangan menebak recipient". Pesan uji hanya boleh dikirim bila
//   kita BISA MEMBUKTIKAN bahwa chat tujuan memang DM DAT (1320969465).
//   Kalau identitas tujuan tidak bisa dibaca, mengirim "pesan TEST" justru
//   bisa mengirim ke pihak lain — itu pelanggaran, bukan bukti.
//
// Yang dijalankan: HANYA `rpc('telegram_alert_status')` dan
// `rpc('telegram_send_test')` DENGAN TOKEN KOSONG. Keduanya gagal otorisasi
// sebelum menyentuh Telegram, jadi TIDAK ADA pesan keluar. Hasilnya dipakai
// sebagai bukti "tidak berwenang" — bukan sebagai percobaan kirim.
//
// Jalankan: node scripts/bakpau-connector-test/probe_transport_readiness.mjs
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

function loadEnv(file) {
  const out = {}
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* tidak ada file -> env kosong */ }
  return out
}

const env = { ...loadEnv(path.join(process.cwd(), '.env.local')), ...process.env }
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) {
  console.log(JSON.stringify({ ok: false, reason: 'no_credentials_in_env' }, null, 2))
  process.exit(2)
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const out = {
  ok: true,
  note: 'READ-ONLY: tidak ada pesan yang dikirim. Kedua RPC dipanggil TANPA token otorisasi.',
  service_role_present_in_env: !!env.SUPABASE_SERVICE_ROLE_KEY,
  drive_sync_token_present_in_env: !!env.DRIVE_SYNC_TOKEN,
  checks: {}
}

// (1) Bisakah kita membaca identitas chat tujuan? (butuh admin JWT)
const st = await sb.rpc('telegram_alert_status')
out.checks.alert_status = st.error
  ? { ok: false, error_code: st.error.code || null, error: String(st.error.message || '').slice(0, 200) }
  : { ok: !!(st.data && st.data.ok === true), data_keys: st.data ? Object.keys(st.data) : [], reason: st.data?.reason || null }
out.checks.can_verify_target_identity = out.checks.alert_status.ok === true

// (2) Bisakah kita memicu pesan uji? (butuh admin JWT atau drive_sync_token)
//     Dipanggil dengan p_token null -> guard DB menolak SEBELUM kirim.
const ts = await sb.rpc('telegram_send_test', { p_token: null })
out.checks.send_test_authorized = !!(ts.data && ts.data.ok === true)
out.checks.send_test_response = ts.error
  ? { error_code: ts.error.code || null, error: String(ts.error.message || '').slice(0, 200) }
  : { ok: ts.data?.ok ?? null, reason: ts.data?.reason || null, sent: ts.data?.sent ?? null }

// Kesimpulan eksplisit (dipakai di laporan, bukan diasumsikan pembaca).
out.conclusion = out.checks.can_verify_target_identity && out.checks.send_test_authorized
  ? 'live_transport_test_allowed'
  : 'live_transport_test_blocked__cannot_verify_target_identity_or_not_authorized'

console.log(JSON.stringify(out, null, 2))
