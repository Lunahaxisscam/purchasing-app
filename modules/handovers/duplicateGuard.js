// ============================================================
// modules/handovers/duplicateGuard.js — SATU dokumen AKTIF per penerimaan
// ============================================================
// LENSA KEENAM (run 239). Run 101..237 menguji: SIMPAN, TAMPIL, KESIAPAN,
// RETUR, WAKTU (capability basi), dan HAPUS. Yang belum pernah diuji:
// DUA DOKUMEN pada SATU PENERIMAAN.
//
// Bukti di PostgreSQL NYATA (probe_run239_dupdoc.mjs, 21/21):
//   S1  `handovers` menerima DUA dokumen DRAFT untuk satu `receiving_id`
//       (tidak ada unique index — dan memang tidak boleh ada, karena
//       serah terima BERTAHAP sah: sisa dicatat lewat dokumen baru).
//   S2  KONTROL berurutan (commit dulu): dokumen kedua DITOLAK kuota.
//       Jadi aturan kuotanya benar.
//   S3  BERSAMAAN (dua koneksi, dua dokumen): KEDUA dokumen `ok:true`,
//       rincian menjadi 10 untuk kuota tukang 5 — penyerahan fisik GANDA,
//       tanpa satu pun error.
//   S4  Akibatnya `v_receipt_progress.belum_diserahkan` menjadi NEGATIF
//       (−5) dan `qty_handed_over_mismatch` menyala.
//   S5  Sebabnya presisi: `handover_confirm` mengunci `handover:<id>` —
//       PER DOKUMEN. Dua dokumen = dua kunci berbeda, jadi tidak saling
//       menunggu; cek kuota keduanya selesai SEBELUM salah satu menulis.
//       Transaksi kedua baru menunggu di ROW LOCK `receiving_items`
//       (UPDATE qty_handed_over) — yaitu SESUDAH cek kuota lewat.
//
// INVARIAN YANG DITEGAKKAN DI SINI:
//   Untuk satu `receiving_id` hanya boleh ada SATU dokumen yang BELUM
//   diserahkan (`diserahkan_at` kosong) pada satu waktu.
//
// Kenapa invarian itu, bukan "satu dokumen selamanya":
//   Serah terima BERTAHAP adalah perilaku sah dan sudah didokumentasikan
//   (`probe_handover_partial.mjs` H3): dokumen pertama dikonfirmasi sebagian
//   → TERKUNCI (CAS `diserahkan_at`) → sisa dicatat lewat dokumen BARU untuk
//   penerimaan yang sama. Yang tidak sah adalah DUA dokumen AKTIF sekaligus:
//   keduanya bisa dikonfirmasi untuk barang yang sama, dan server tidak bisa
//   menahannya karena kuncinya per dokumen.
//
// Penjaga ini murni (tanpa DB/React) supaya bisa diuji, dan dipakai EMPAT
// lapis: `save.js` (jangan buat dokumen kedua), `queue.jsx` (tombol konfirmasi
// hanya untuk dokumen kanonik), `view.jsx` (tombol ✓ per baris), dan
// `physicalHost.jsx` (satu choke point untuk SEMUA pintu modal konfirmasi).
//
// BATAS YANG SAYA AKUI: ini penjaga APLIKASI. Panggilan RPC langsung (SQL
// manual / service-role) tetap bisa membuat dokumen kedua lalu
// mengonfirmasinya. Perbaikan di level database ada di tangan schema owner
// `t_03b41644`: kunci per PENERIMAAN (`handover:rec:<receiving_id>`) atau
// kunci baris `receiving_items` DIAMBIL SEBELUM cek kuota. Rekomendasi
// lengkap ada di docs/receiving-events-contract.md §9.
// ============================================================

// Urutan deterministik: dokumen paling AWAL dibuat menang. `created_at` bisa
// tidak ada pada baris data lama / fixture, jadi jatuh ke `handover_date` lalu
// `id` — yang penting HASILNYA SAMA di setiap layar dan setiap render.
function sortKey(h) {
  return [
    String(h?.created_at || ''),
    String(h?.handover_date || ''),
    String(h?.id || '')
  ].join('|')
}

function byOldest(a, b) {
  const ka = sortKey(a)
  const kb = sortKey(b)
  if (ka < kb) return -1
  if (ka > kb) return 1
  return 0
}

// Semua dokumen yang masih AKTIF (belum diserahkan) untuk satu penerimaan.
export function activeDocumentsFor(receivingId, handovers = []) {
  if (!receivingId) return []
  return (handovers || [])
    .filter(h => h && h.id && !h.diserahkan_at && String(h.receiving_id || '') === String(receivingId))
    .sort(byOldest)
}

// Dokumen KANONIK = yang paling awal dibuat. Hanya dokumen ini yang boleh
// dikonfirmasi; sisanya harus dihapus admin (belum punya bukti, jadi hapusnya
// sah — lihat deleteGuard) sebelum pekerjaan dilanjutkan.
export function canonicalDocumentId(receivingId, handovers = []) {
  const list = activeDocumentsFor(receivingId, handovers)
  return list.length ? list[0].id : null
}

export const DUPLIKAT_ALASAN =
  'Penerimaan ini punya LEBIH DARI SATU dokumen Serah Terima yang belum diserahkan. ' +
  'Kalau keduanya dikonfirmasi, barang yang sama bisa tercatat diserahkan DUA kali ' +
  '(jumlah "sudah diserahkan" bisa melebihi alokasi, dan sisa menjadi minus). ' +
  'Konfirmasi hanya bisa dilakukan pada dokumen yang PALING AWAL dibuat; ' +
  'hapus dokumen duplikat (yang belum punya bukti) lalu ulangi.'

// Penjaga saat MEMBUAT dokumen baru (save.js mode TAMBAH).
// Mengembalikan { ok } atau { ok:false, reason, existingId }.
export function handoverCreateGuard({ receiving, handovers = [] } = {}) {
  if (!receiving || !receiving.id) {
    return { ok: false, reason: 'Pilih Penerimaan (Purchase) dulu — serah terima harus terhubung ke penerimaan asalnya.' }
  }
  const active = activeDocumentsFor(receiving.id, handovers)
  if (!active.length) return { ok: true, reason: '', existingId: null }
  return {
    ok: false,
    existingId: active[0].id,
    reason:
      'Penerimaan ini SUDAH punya dokumen Serah Terima yang belum diserahkan. ' +
      'Buka dokumen itu dan konfirmasi di sana — jangan buat dokumen kedua. ' +
      'Dokumen baru hanya boleh dibuat SETELAH dokumen sebelumnya dikonfirmasi ' +
      '(untuk mencatat sisa barang yang belum diserahkan).'
  }
}

// Penjaga saat MENGONFIRMASI dokumen (queue.jsx / view.jsx / physicalHost.jsx).
// `handover` = dokumen yang akan dikonfirmasi; `handovers` = SEMUA baris modul
// (bukan hanya antrean) supaya duplikat yang sudah terlanjur ada ikut terlihat.
export function confirmDuplicateGuard({ handover, handovers = [] } = {}) {
  if (!handover || !handover.id) {
    return { ok: false, reason: 'Data Serah Terima tidak dikenal.', canonicalId: null }
  }
  // Sudah diserahkan → bukan urusan penjaga ini (idempoten di RPC/confirm.js).
  if (handover.diserahkan_at) return { ok: true, reason: '', canonicalId: handover.id }
  const active = activeDocumentsFor(handover.receiving_id, handovers)
  if (active.length <= 1) return { ok: true, reason: '', canonicalId: handover.id, activeCount: active.length }
  const canonicalId = active[0].id
  if (canonicalId === handover.id) {
    // Dokumen kanonik boleh lanjut, TETAPI admin harus tahu ada duplikat.
    return {
      ok: true,
      reason: '',
      canonicalId,
      activeCount: active.length,
      warn:
        `Ada ${active.length - 1} dokumen Serah Terima LAIN untuk penerimaan ini yang juga belum diserahkan. ` +
        'Hanya dokumen paling awal yang boleh dikonfirmasi. Setelah ini tersimpan, hapus dokumen duplikatnya ' +
        'supaya tidak ada yang mengonfirmasi barang yang sama dua kali.'
    }
  }
  return { ok: false, canonicalId, activeCount: active.length, reason: DUPLIKAT_ALASAN }
}

// Ringkasan untuk ditampilkan di kartu antrean (badge + sebab), tanpa menulis.
export function duplicateInfoFor(handover, handovers = []) {
  const active = activeDocumentsFor(handover?.receiving_id, handovers)
  if (active.length <= 1) return { duplicate: false, activeCount: active.length, canonicalId: active[0]?.id || null }
  return {
    duplicate: true,
    activeCount: active.length,
    canonicalId: active[0].id,
    isCanonical: active[0].id === handover?.id,
    others: active.filter(h => h.id !== handover?.id).map(h => h.id)
  }
}
