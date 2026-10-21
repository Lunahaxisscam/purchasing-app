// ============================================================
// modules/handovers/deleteGuard.js — PENJAGA HAPUS (defect run 237)
// ============================================================
// LENSA YANG BELUM PERNAH DIPAKAI (run 101..236): semua run sebelumnya menguji
// SIMPAN, TAMPIL, dan KESIAPAN. Tidak satu pun menguji tombol 🗑️ Hapus —
// padahal tombol itu ada di SETIAP baris, tanpa syarat, di layar yang sama
// dengan tombol konfirmasi fisik.
//
// Bukti di PostgreSQL NYATA (probe_run237_delete.mjs, 16/16):
//   D1  `delete from handovers where id=…` (persis `deleteItem` di
//       pages/index.js) MENGHAPUS `handover_items` lewat `on delete cascade`
//       → bukti fisik serah terima HILANG PERMANEN.
//   D2  `receiving_items.qty_handed_over` TIDAK dikoreksi → 5 padahal
//       rinciannya 0 (dua sumber angka saling bertentangan).
//   D3  `v_receipt_progress.belum_diserahkan` kembali 5 → barang yang SUDAH
//       diterima tukang tampil "belum diserahkan".
//   D4  kuota tukang TERBUKA LAGI → dokumen baru diterima RPC untuk 5 unit
//       yang sama (penyerahan fisik ganda, tidak terlihat di total).
//   D5  `check_receipt_qty_consistency()` sendiri menandai
//       `qty_handed_over_mismatch` — database menganggapnya rusak.
//   D6  hapus NOTA yang punya serah terima terkonfirmasi ditolak FK
//       `restrict`, tetapi admin hanya melihat pesan mentah Postgres.
//
// Aplikasi TIDAK boleh menyediakan tombol yang menghancurkan bukti fisik tanpa
// satu kata pun peringatan. Penjaga ini murni (tanpa DB) supaya bisa diuji,
// dan dipakai DUA lapis:
//   1. `deleteDecision()` di pages/index.js — SEBELUM optimistic update dan
//      sebelum `delete()`, jadi SEMUA jalur hapus (ikon baris desktop, kartu
//      mobile, pemanggilan programatik) melewatinya.
//   2. view.jsx — tombolnya dinonaktifkan + sebabnya terbaca, supaya admin
//      tidak menekan sesuatu yang pasti ditolak.
//
// BATAS YANG SAYA AKUI: ini penjaga APLIKASI. Tidak ada trigger/RLS yang
// menolak DELETE di level database (itu milik schema owner t_03b41644) —
// penghapusan lewat SQL langsung tetap bisa merusak `qty_handed_over`.
// Rekomendasi trigger dicatat di docs/receiving-events-contract.md §8.
// ============================================================

// Bukti fisik = `diserahkan_at` ATAU ada baris rincian. Status CONFIRMED saja
// BUKAN bukti — `display.js` (`statusInfo`) sudah menyatakan itu ke pengguna:
// "Status lama CONFIRMED tanpa catatan waktu penyerahan — belum dihitung Sudah
// Diserahkan". Jadi penjaga ini TIDAK boleh lebih ketat dari kontrak aplikasi
// sendiri: baris CONFIRMED tanpa waktu & tanpa rincian adalah DRAFT yang
// statusnya basi, dan menghapusnya adalah pembersihan yang sah (dengan
// peringatan tambahan di shell). Yang mengunci hanyalah bukti nyata.
export function handoverProof(handover) {
  const items = Array.isArray(handover?.items) ? handover.items.filter(Boolean) : []
  const status = String(handover?.status || '').toUpperCase()
  const legacyConfirmed = (status === 'CONFIRMED' || status === 'SELESAI')
  return {
    diserahkanAt: handover?.diserahkan_at || null,
    itemCount: items.length,
    confirmed: legacyConfirmed,
    delivered: !!handover?.diserahkan_at || items.length > 0,
    // Status selesai TANPA bukti = status basi (bukan bukti) → tidak mengunci,
    // tetapi dihapusnya tetap perlu peringatan eksplisit.
    locked: !!handover?.diserahkan_at || items.length > 0,
    staleStatus: legacyConfirmed && !handover?.diserahkan_at && items.length === 0
  }
}

export const HAPUS_DITOLAK_HANDOVER =
  'Serah Terima ini TIDAK bisa dihapus: sudah punya bukti penyerahan ' +
  '(waktu serah terima dan/atau rincian barang per item). Menghapusnya akan ' +
  'menghilangkan bukti fisik itu permanen dan membuat jumlah "sudah diserahkan" ' +
  'tidak lagi cocok dengan rinciannya. Riwayat serah terima memang disimpan. ' +
  'Bila dokumen ini salah, jangan hapus — laporkan ke admin untuk koreksi.'

// Peringatan untuk baris yang statusnya CONFIRMED/SELESAI tetapi TIDAK punya
// bukti fisik (data lama). Menghapusnya sah, tetapi admin harus tahu bahwa
// status basi itu ikut hilang — bukan bukti penyerahan.
export const HAPUS_STATUS_BASI_WARNING =
  'Dokumen ini berstatus CONFIRMED/SELESAI tetapi TIDAK punya waktu serah terima ' +
  'maupun rincian barang — menurut kontrak aplikasi itu BUKAN bukti penyerahan ' +
  '(hanya status lama). Menghapusnya akan menghilangkan baris ini beserta status ' +
  'basinya. Lanjutkan?'

export function handoverDeleteGuard(handover) {
  if (!handover || !handover.id) return { ok: false, reason: 'Data Serah Terima tidak dikenal.' }
  const p = handoverProof(handover)
  if (p.locked) return { ok: false, reason: HAPUS_DITOLAK_HANDOVER, proof: p }
  return { ok: true, reason: '', proof: p, warn: p.staleStatus ? HAPUS_STATUS_BASI_WARNING : '' }
}

// Hapus NOTA (Pembelian) yang masih dirujuk Serah Terima.
//
// Diverifikasi di PostgreSQL NYATA (probe_run237_fk_scope.mjs): FK
// `handovers.receiving_id → receivings(id)` TIDAK cascade, jadi menghapus nota
// yang punya serah terima APA PUN (bahkan DRAFT) sudah ditolak database:
//   "update or delete on table "receivings" violates foreign key constraint
//    "handovers_receiving_id_fkey" on table "handovers"" (23503)
// Admin melihat pesan mentah itu tanpa penjelasan. Penjaga ini menyamakan
// keputusan aplikasi dengan kenyataan database — bukan lebih longgar — supaya
// tidak ada tombol yang dijanjikan berhasil lalu gagal dengan pesan SQL.
export function receivingDeleteGuard(receiving, handovers = []) {
  if (!receiving || !receiving.id) return { ok: false, reason: 'Data penerimaan tidak dikenal.' }
  const linked = (handovers || []).filter(h => h && h.receiving_id === receiving.id)
  if (!linked.length) return { ok: true, reason: '', linked: 0 }
  const withProof = linked.filter(h => handoverProof(h).locked)
  if (withProof.length) {
    return {
      ok: false,
      linked: linked.length,
      blocked: withProof.length,
      reason:
        `Penerimaan ini TIDAK bisa dihapus: ${withProof.length} dokumen Serah Terima ` +
        'di dalamnya sudah punya bukti penyerahan. Menghapus nota akan menghapus ' +
        'catatan penerimaan per barang dan bukti serah terimanya sekaligus. ' +
        'Riwayat pengadaan disimpan; laporkan ke admin bila nota ini salah.'
    }
  }
  return {
    ok: false,
    linked: linked.length,
    blocked: 0,
    reason:
      `Penerimaan ini belum bisa dihapus: masih dirujuk ${linked.length} dokumen ` +
      'Serah Terima (belum diserahkan). Database menolak menghapus nota yang masih ' +
      'dipakai dokumen lain. Hapus dokumen Serah Terima itu dulu bila memang salah, ' +
      'baru hapus notanya.'
  }
}

// Satu pintu keputusan untuk shell (pages/index.js deleteItem). Mengembalikan
// { ok } atau { ok:false, reason } — tidak pernah melempar. `warn` (bila ada)
// berarti boleh dihapus tetapi admin harus mengonfirmasi dulu.
export function deleteDecision(pageTarget, item, { handovers = [] } = {}) {
  if (pageTarget === 'handovers') return handoverDeleteGuard(item)
  if (pageTarget === 'receivings') return receivingDeleteGuard(item, handovers)
  return { ok: true, reason: '', warn: '' }
}
