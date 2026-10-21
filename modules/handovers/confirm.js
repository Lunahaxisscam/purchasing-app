// ============================================================
// modules/handovers/confirm.js — konfirmasi fisik serah terima
// ============================================================
// "Sudah Diserahkan" HANYA ditulis lewat aksi eksplisit ini — BUKAN lewat
// simpan metadata, BUKAN otomatis karena alokasi dipilih (audit t_905e0e5a
// A3/G4; arahan DAT t_b418827b).
//
// Idempoten (anti dobel / re-confirm):
//  - handover yang sudah punya `diserahkan_at` -> tidak ditulis ulang;
//  - update memakai compare-and-swap (`diserahkan_at IS NULL`) sehingga
//    retry / 2 user tidak menggandakan penandaan — waktu penyerahan
//    tercatat SEKALI (siapa pun yang menang).
//
// Validasi rincian qty per item menyusul saat tabel `handover_items`
// disetujui DAT (skema belum ada — lihat docs/handover-gap-proposal.md).
// Selama itu: minimal guard status + `diserahkan_at` selalu ditulis.
//
// run 245: `client` opsional supaya `confirmUniqueHandover()` (penjaga dokumen
// ganda) bisa memakai klien yang SAMA untuk baca-sebelum dan baca-sesudah.
// Tanpa argumen, perilakunya identik dengan sebelumnya (supabase global).
// ============================================================
import { supabase } from '../../lib/supabaseClient'

export async function markHandoverDelivered({ handover, now, receivedBy, client } = {}) {
  const sb = client || supabase
  if (!sb) return { ok: false, error: 'Supabase tidak tersedia.' }
  if (!handover?.id) return { ok: false, error: 'Data serah terima tidak dikenal.' }
  if (handover.diserahkan_at) return { ok: true, already: true }

  const ts = now || new Date().toISOString()
  // Nama penerima ikut ditulis bila diberikan. Tanpa ini field "Diterima oleh"
  // hanya hiasan: bukti serah terima tidak menyebut siapa yang menerima
  // (defect run 190 pada jalur konfirmasi tanpa rincian).
  const patch = { status: 'CONFIRMED', diserahkan_at: ts }
  const nama = String(receivedBy || '').trim()
  if (nama) patch.received_by = nama
  try {
    const { data, error } = await sb
      .from('handovers')
      .update(patch)
      .eq('id', handover.id)
      .is('diserahkan_at', null)
      .select()
    if (error) return { ok: false, error: error.message }
    // 0 baris = sudah ditandai pihak lain lebih dulu (retry / balapan) —
    // jangan klaim baru saja menandai.
    if (!Array.isArray(data) || data.length === 0) return { ok: true, already: true }
    return { ok: true, updated: true, diserahkan_at: ts }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
