// ============================================================
// modules/handovers/createCapability.js — PROBE "BOLEH BUAT DOKUMEN LEWAT RPC?"
// ============================================================
// Kontrak schema owner (t_2b8dcab3, OPERATIONAL_CONTRACT_v1):
//   handover_create_atomic(p_payload jsonb) -> jsonb
//   { receiving_id, project_id?, received_by?, handover_date?, note? }
//   -> { ok, already, handover_id, handover:{...} }
//
// Kenapa probe ini dipisah dari `duplicateGuardDb`:
//   `duplicateGuardDb` adalah penjaga APLIKASI (kunci slot deterministik di
//   `handovers.id`). Begitu migrasi v1 diterapkan, database sudah punya
//   `unique index (receiving_id) where diserahkan_at is null` + RPC yang
//   mengunci per penerimaan. Dua mekanisme sekaligus = dua sumber kebenaran,
//   dan yang lebih lemah (slot id dari aplikasi) bisa MENOLAK pembuatan yang
//   sebenarnya sah atau sebaliknya. Jadi: bila RPC terbukti ADA, semua pintu
//   create WAJIB lewat RPC; jalur slot hanya untuk skema lama (LEGACY).
//
// KEADAAN (empat, bukan boolean):
//   unknown → probe belum selesai; JANGAN menulis lewat jalur mana pun
//   error   → probe gagal / tidak bisa disimpulkan; JANGAN menebak LEGACY
//   legacy  → RPC belum ada (PGRST202/42P01) → jalur lama (slot id) dipakai
//   ready   → RPC ada & menjawab kontrak → SEMUA pintu create lewat RPC
//
// Probe TIDAK menulis: payload kosong ditolak validasi RPC
// (`receiving_not_found`), jadi nol baris tersentuh. Bukti sah HANYA jawaban
// `{ok:false, reason:...}` atau error validasi yang jelas — `data:null` tanpa
// error BUKAN bukti fungsi ada (kelas defect run 246).
// ============================================================
import { supabase } from '../../lib/supabaseClient'

export const CREATE_CAP = {
  UNKNOWN: 'unknown',
  ERROR: 'error',
  LEGACY: 'legacy',
  READY: 'ready'
}

const TTL_MS = 60 * 1000
let cache = null
let inflight = null

function clientOf(client) {
  return client || supabase
}

// Bukti bahwa fungsi BENAR-BENAR berjalan: RPC menolak payload kosong dengan
// sebab kontrak. `data:null` tanpa error tidak diterima.
function classifyProbe({ data, error }) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  if (error) {
    if (code === 'PGRST202' || code === '42883' || /Could not find the function|does not exist/i.test(msg)) {
      return { state: CREATE_CAP.LEGACY, reason: 'RPC handover_create_atomic belum ada' }
    }
    // Fungsi ADA tetapi menolak (validasi / role). Itu bukti fungsi hidup.
    if (code === '22023' || code === '23514' || code === '22P02' || code === '42501'
      || /receiving_not_found|forbidden|invalid|required|reason/i.test(msg)) {
      if (code === '42501') {
        return { state: CREATE_CAP.ERROR, reason: `akses RPC ditolak (${code}) — periksa role admin` }
      }
      return { state: CREATE_CAP.READY, reason: '' }
    }
    return { state: CREATE_CAP.ERROR, reason: msg || 'RPC tidak bisa dipanggil' }
  }
  if (data && typeof data === 'object' && data.ok === false) {
    if (String(data.reason || '') === 'forbidden') {
      return { state: CREATE_CAP.ERROR, reason: 'RPC menolak: hanya admin yang boleh membuat Serah Terima.' }
    }
    return { state: CREATE_CAP.READY, reason: '' }
  }
  return {
    state: CREATE_CAP.ERROR,
    reason: 'RPC menjawab tanpa hasil yang bisa dibaca — kesiapan tidak bisa disimpulkan'
  }
}

export async function getCreateCapability({ force = false, client = null } = {}) {
  const sb = clientOf(client)
  if (!sb) return { state: CREATE_CAP.ERROR, reason: 'Supabase tidak tersedia.', at: Date.now() }
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value
  if (!force && inflight) return inflight
  const run = (async () => {
    let res
    try {
      res = await sb.rpc('handover_create_atomic', { p_payload: {} })
    } catch (err) {
      const value = { state: CREATE_CAP.ERROR, reason: String(err?.message || err), at: Date.now() }
      cache = { at: Date.now(), value }
      return value
    }
    const value = { ...classifyProbe(res || {}), at: Date.now() }
    cache = { at: Date.now(), value }
    return value
  })()
  inflight = run
  try {
    return await run
  } finally {
    if (inflight === run) inflight = null
  }
}

export function resetCreateCapability() {
  cache = null
  inflight = null
}

export function createCapabilityMessage(cap) {
  if (!cap) return 'Kesiapan penyimpanan Serah Terima belum diperiksa.'
  if (cap.state === CREATE_CAP.READY) return 'Penyimpanan Serah Terima atomik aktif (satu dokumen aktif per penerimaan dijaga database).'
  if (cap.state === CREATE_CAP.LEGACY) {
    return 'Skema penyimpanan atomik belum aktif — dokumen dibuat dengan jalur lama. Jangan buat dua dokumen untuk satu penerimaan.'
  }
  return `Kesiapan penyimpanan belum bisa dipastikan: ${cap.reason || 'tidak diketahui'}. Pembuatan dokumen ditahan sampai pemeriksaan berhasil.`
}
