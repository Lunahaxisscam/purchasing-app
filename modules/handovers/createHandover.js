// ============================================================
// modules/handovers/createHandover.js — SATU PINTU PEMBUATAN DOKUMEN
// ============================================================
// TIGA pintu create di aplikasi:
//   1. `modules/handovers/save.js`            (form "+ Tambah Serah Terima")
//   2. `modules/receivings/purchaseSave.js`   (antrean otomatis per nota)
//   3. `pages/index.js` `sendToTukang`        (kirim langsung ke tukang)
//
// Sebelum ini ketiganya memanggil `insertUniqueActiveHandover()` (kunci slot
// deterministik di `handovers.id`). Itu penjaga APLIKASI yang sah untuk skema
// lama. Begitu paket schema owner (t_2b8dcab3, OPERATIONAL_CONTRACT_v1)
// diterapkan, database punya:
//   - `unique index (receiving_id) where diserahkan_at is null`
//   - RPC `handover_create_atomic(p_payload jsonb)` yang mengunci per
//     penerimaan (`ops_v1_lock_receiving`) sebelum memeriksa/menulis.
//
// Bila keduanya dipakai bersamaan, ada DUA sumber kebenaran: kunci slot
// aplikasi bisa menolak pembuatan yang SAH (mis. slot sudah terpakai baris
// yang sudah diserahkan tetapi belum terbaca di snapshot) atau justru
// mengarang id yang tidak sesuai kontrak. Karena itu:
//
//   capability READY   → SEMUA pintu lewat RPC (database yang menjamin)
//   capability LEGACY  → jalur slot lama (tidak ada RPC untuk dipanggil)
//   unknown / error    → TOLAK menulis (fail closed), sebab terbaca
//
// Ini bukan "fallback writer baru": jalur LEGACY adalah jalur yang SUDAH ada
// dan sudah diuji (run 245), dipakai hanya ketika RPC terbukti tidak ada.
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { insertUniqueActiveHandover } from './duplicateGuardDb'
import { getCreateCapability, CREATE_CAP } from './createCapability'

function clientOf(client) {
  return client || supabase
}

// Terjemahkan hasil RPC ke bentuk yang sama dengan `insertUniqueActiveHandover`
// supaya semua pemanggil (dan pesan UI) tidak perlu bercabang.
function fromRpc(data, payload) {
  if (data && typeof data === 'object' && data.ok === true) {
    const row = data.handover || null
    const id = data.handover_id || row?.id || null
    return {
      ok: true,
      already: !!data.already,
      id,
      row: row || (id ? { id, receiving_id: payload.receiving_id } : null),
      via: 'rpc'
    }
  }
  const reason = String(data?.reason || data?.error || '')
  const messages = {
    receiving_not_found: 'Penerimaan tidak ditemukan — dokumen Serah Terima tidak dibuat.',
    forbidden: 'Hanya admin yang boleh membuat dokumen Serah Terima.',
    duplicate_active_handover:
      'Penerimaan ini SUDAH punya dokumen Serah Terima yang belum diserahkan. Buka dokumen itu dan konfirmasi di sana — jangan buat dokumen kedua.'
  }
  return {
    ok: false,
    via: 'rpc',
    reason: messages[reason] || reason || 'Penyimpanan menolak pembuatan dokumen Serah Terima.'
  }
}

// Buat (atau temukan) dokumen Serah Terima AKTIF untuk satu penerimaan.
//
// `data` memakai nama kolom tabel (`receiving_id`, `project_id`, `received_by`,
// `handover_date`, `note`) — sama seperti yang sudah dikirim ketiga pintu,
// sehingga tidak ada mapper kedua yang bisa menyimpang.
export async function createActiveHandover({ data, client, capability = null } = {}) {
  const sb = clientOf(client)
  if (!sb) return { ok: false, reason: 'Supabase tidak tersedia.' }
  const receivingId = data?.receiving_id
  if (!receivingId) {
    return { ok: false, reason: 'Pilih Penerimaan (Purchase) dulu — serah terima harus terhubung ke penerimaan asalnya.' }
  }

  // Satu keputusan per percobaan simpan. Pemanggil boleh memberi hasil probe
  // yang sudah dipegang layar; kalau tidak ada, probe sekarang (force) supaya
  // tidak memakai snapshot basi — migrasi bisa dijalankan saat aplikasi dipakai.
  const cap = capability || await getCreateCapability({ force: true, client: sb })
  const state = cap?.state

  if (state === CREATE_CAP.READY) {
    const payload = {
      receiving_id: receivingId,
      ...(data.project_id ? { project_id: data.project_id } : {}),
      ...(data.received_by ? { received_by: data.received_by } : {}),
      ...(data.handover_date ? { handover_date: data.handover_date } : {}),
      ...(data.note ? { note: data.note } : {})
    }
    let res
    try {
      res = await sb.rpc('handover_create_atomic', { p_payload: payload })
    } catch (err) {
      return {
        ok: false,
        via: 'rpc',
        reason: `Gagal menghubungi penyimpanan atomik: ${err?.message || err}. Coba lagi — permintaan ini tidak akan membuat dokumen kedua.`
      }
    }
    const { data: out, error } = res || {}
    if (error) {
      const code = String(error.code || '')
      const msg = String(error.message || '')
      // Fungsi hilang di tengah jalan (migrasi dibatalkan) → jangan menulis
      // lewat jalur lain dengan asumsi skema lama; minta periksa ulang.
      if (code === 'PGRST202' || code === '42883' || /Could not find the function/i.test(msg)) {
        return {
          ok: false,
          via: 'rpc',
          reason: 'Penyimpanan atomik tidak lagi tersedia. Muat ulang halaman lalu periksa kesiapan skema sebelum membuat dokumen.'
        }
      }
      if (code === '42501') {
        return { ok: false, via: 'rpc', reason: 'Hanya admin yang boleh membuat dokumen Serah Terima.' }
      }
      return { ok: false, via: 'rpc', reason: msg || 'Penyimpanan menolak pembuatan dokumen Serah Terima.' }
    }
    if (!out || typeof out !== 'object') {
      return {
        ok: false,
        via: 'rpc',
        reason: 'Penyimpanan tidak mengembalikan hasil yang bisa dibaca. Periksa daftar Serah Terima sebelum mencoba lagi.'
      }
    }
    return fromRpc(out, payload)
  }

  if (state === CREATE_CAP.LEGACY) {
    const res = await insertUniqueActiveHandover({ data, client: sb })
    return { ...res, via: 'slot' }
  }

  // unknown / error → TIDAK menebak LEGACY (kelas defect BUG-R1/S1: menulis
  // lewat jalur lama saat skema mungkin sudah hidup = dokumen kedua / tanpa
  // rincian). Sebab harus terbaca admin.
  return {
    ok: false,
    via: 'none',
    blocked: true,
    reason:
      'Kesiapan penyimpanan Serah Terima belum bisa dipastikan' +
      (cap?.reason ? ` (${cap.reason})` : '') +
      '. Pembuatan dokumen ditahan supaya tidak ada dokumen ganda — periksa ulang kesiapan skema.'
  }
}
