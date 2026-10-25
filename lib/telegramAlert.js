// ============================================================
// Telegram Alert Helper (Sprint 1) — formatting & trigger.
// ============================================================
// ARSITEKTUR KEAMANAN (penting):
//   Pengiriman pesan dilakukan SERVER-SIDE di dalam database (RPC +
//   ekstensi http) supaya TOKEN BOT tidak pernah bocor ke browser.
//   File ini hanya berisi:
//     1) formatter pesan (referensi format resmi — sama dengan format
//        yang dirakit RPC di DB);
//     2) pembungkus pemanggilan RPC (client → DB → Telegram).
//
// Dipakai oleh:
//   * pages/index.js        → sendPrAlert() saat PR disubmit (Trigger A)
//   * pages/api/alerts/telegram.js → endpoint ops (test / cost-scan)
//   * daemon drive_cost_sync.py    → memanggil RPC cost-scan setelah sync
// ============================================================

import { formatRibuan } from './constants'
// t_50b783de (Approval OFF): Trigger A adalah ALERT APPROVAL ("mohon tinjau
// untuk approval") — ikut diputus saat modul Approval mati. Trigger B (cost
// warning) dan pesan uji TIDAK terkait approval dan tetap berfungsi.
import { approvalGuard } from './constants'

function rp(n) {
  const v = Number(n)
  return `Rp ${formatRibuan(isFinite(v) ? v : 0)}`
}

// Trigger A — PR besar > Rp 5 juta (format resmi brief Sprint 1).
export function formatPrBesarAlert({ pr_number, project_name, project_no, total, requester }) {
  return [
    '🔔 [ALERT PURCHASING] Purchase Request Baru > Rp 5 Juta',
    `• No PR      : ${pr_number || '—'}`,
    `• Proyek     : ${project_name || '—'}${project_no ? ` (${project_no})` : ''}`,
    `• Total Est. : ${rp(total)}`,
    `• Diajukan   : ${requester || '—'}`,
    'Mohon tinjau di dashboard purchasing untuk approval.'
  ].join('\n')
}

// Trigger B — early warning cost proyek >= 65% dari revenue (format resmi brief).
export function formatCostWarningAlert({ project_name, project_no, revenue, cumulative_cost, pct }) {
  const pctText = (() => {
    const v = Number(pct)
    return isFinite(v)
      ? v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—'
  })()
  return [
    '⚠️ [EARLY WARNING] Biaya Proyek Mendekati Batas 70%',
    `• Proyek     : ${project_name || '—'}${project_no ? ` (${project_no})` : ''}`,
    `• Revenue    : ${rp(revenue)}`,
    `• Realisasi  : ${rp(cumulative_cost)} (${pctText}%)`,
    '• Batas Max  : 70%',
    'Peringatan: Realisasi biaya telah menyentuh batas peringatan dini (65%).'
  ].join('\n')
}

// ============================================================
// Pemanggil RPC (client-side wrapper).
// Semua pengiriman tetap di DB — client hanya memicu RPC.
// ============================================================

// Trigger A: dipanggil saat PR disubmit (tombol ✓ Selesai di modul PR).
// Aman dipanggil berkali-kali (dedup by nomor PR di DB).
// t_50b783de: fail closed saat Approval OFF — TIDAK memanggil RPC Telegram,
// jadi tidak ada alert "mohon approval" yang dikirim untuk alur non-approval.
export async function sendPrAlert(supabase, prId) {
  const gate = approvalGuard('pr-alert')
  if (!gate.ok) return { ok: false, disabled: true, code: gate.code, error: gate.error }
  if (!supabase || !prId) return { ok: false, error: 'Supabase / PR id tidak tersedia.' }
  try {
    const { data, error } = await supabase.rpc('telegram_send_pr_alert', { p_pr_id: prId })
    if (error) return { ok: false, error: error.message }
    return data || { ok: false, error: 'RPC tanpa data.' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Trigger B: scan cost >= 65% dan kirim alert (admin-only dari UI).
// Daemon drive-sync memakai jalur token (p_token) via API route.
export async function sendCostAlerts(supabase, { token = null, minStep = 2 } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  try {
    const { data, error } = await supabase.rpc('telegram_send_cost_alerts', {
      p_token: token,
      p_min_step: minStep
    })
    if (error) return { ok: false, error: error.message }
    return data || { ok: false, error: 'RPC tanpa data.' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Pesan uji koneksi (admin-only dari UI / ops).
export async function sendTestAlert(supabase, { token = null } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  try {
    const { data, error } = await supabase.rpc('telegram_send_test', { p_token: token })
    if (error) return { ok: false, error: error.message }
    return data || { ok: false, error: 'RPC tanpa data.' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Status konfigurasi alert + riwayat terakhir (admin-only).
export async function fetchAlertStatus(supabase) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  try {
    const { data, error } = await supabase.rpc('telegram_alert_status')
    if (error) return { ok: false, error: error.message }
    return data || { ok: false, error: 'RPC tanpa data.' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
