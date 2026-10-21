// ============================================================
// modules/handovers/dbErrorText.js — pesan database → kalimat untuk admin
// ============================================================
// REVIEW run 251 / D2: saat kontrak v1 aktif, trigger & RPC menolak tulisan
// dengan KODE (mis. `physical_rpc_required`). Kode itu diteruskan apa adanya
// ke layar, sehingga admin membaca teks SQL mentah tanpa tahu apa yang harus
// dilakukan.
//
// Fungsi ini HANYA menerjemahkan. Ia tidak pernah menelan penolakan: kode asli
// tetap dikembalikan di `code` supaya bisa dicatat/dilaporkan, dan kode yang
// belum dikenal tetap ditampilkan (dengan kalimat pembuka yang jujur) —
// menyembunyikannya akan membuat masalah tak terlihat.
// ============================================================

const TEXT = {
  physical_rpc_required:
    'Pencatatan fisik hanya bisa lewat form aplikasi, bukan perubahan langsung ke database. '
    + 'Muat ulang halaman lalu catat lewat form yang tersedia (Terima Barang / konfirmasi per barang).',
  purchase_rpc_required:
    'Nota pembelian hanya bisa disimpan lewat form Pembelian. Muat ulang halaman lalu simpan ulang dari form.',
  handover_evidence_immutable:
    'Bukti serah terima yang sudah tersimpan tidak bisa diubah atau dihapus. Catat kekeliruan lewat dokumen baru, bukan dengan menimpa bukti lama.',
  handover_source_immutable:
    'Dokumen Serah Terima tidak bisa dipindahkan ke penerimaan lain.',
  purchase_evidence_immutable:
    'Nota ini sudah punya bukti penerimaan, jadi tidak bisa dihapus. Riwayat pengadaan disimpan.',
  purchase_immutable:
    'Nota yang sudah dibeli tidak bisa diubah isinya. Catat koreksi lewat dokumen baru.',
  purchase_line_immutable:
    'Baris nota yang sudah tercatat tidak bisa diubah. Catat koreksi lewat dokumen baru.',
  physical_source_immutable:
    'Barang yang sudah punya catatan penerimaan tidak bisa dipindah ke nota lain.',
  operational_history_no_truncate:
    'Riwayat operasional tidak boleh dikosongkan.',
  forbidden: 'Hanya admin yang boleh mencatat transaksi ini.',
  empty_lines: 'Tidak ada barang yang bisa diserahkan pada dokumen ini.',
  handover_not_found: 'Dokumen Serah Terima tidak ditemukan (mungkin sudah dihapus).',
  over_handover: 'Jumlah yang diserahkan melebihi alokasi ke tukang untuk barang itu.',
  over_receipt: 'Jumlah datang melebihi jumlah yang dibeli pada nota ini.',
  over_receipt_pr: 'Jumlah datang melebihi jumlah yang diminta di PR asal.',
  over_purchase_pr: 'Jumlah pembelian melebihi jumlah yang diminta di PR asal.',
  allocation_not_exact: 'Pembagian proyek tidak pas dengan jumlah yang dibeli.',
  project_xor_allocations: 'Pilih satu proyek ATAU bagi ke beberapa proyek — jangan keduanya.',
  bad_number: 'Ada angka yang tidak wajar (nol/negatif/bukan angka).',
  bad_allocation: 'Tujuan gudang + tukang melebihi jumlah barang baik.',
  rusak_gt_datang: 'Jumlah rusak melebihi jumlah yang datang.',
  missing_receiver: 'Nama penerima tukang wajib diisi bila ada barang ke tukang.',
  bad_retur: 'Keputusan barang rusak tidak lengkap (jumlah retur harus diisi).',
  discard_not_confirmed: 'Konfirmasi "barang benar-benar dibuang" belum dicentang.',
  retur_without_qty: 'Keputusan retur butuh jumlah yang dikembalikan lebih dari nol.',
  no_retur_balance: 'Barang rusak ini belum punya saldo retur — putuskan dulu di Terima Barang.',
  discard_not_allowed: 'Barang ini sudah tercatat dikembalikan ke supplier, tidak bisa diubah menjadi dibuang.',
  duplicate_invoice: 'Nomor nota ini sudah dipakai untuk vendor yang sama.',
  idempotency_conflict: 'Permintaan ini bentrok dengan data yang sudah tersimpan (isian berbeda untuk kunci yang sama).',
  receiving_not_found: 'Penerimaan tidak ditemukan.',
  item_not_found: 'Barang tidak ditemukan pada penerimaan ini.',
  purchase_rpc_required_unused: ''
}

const CODE_RE = /^[a-z][a-z0-9_]{2,60}$/

// Ambil kode dari error Supabase ({code,message}) ATAU dari string pesan.
// PostgreSQL melempar kode kita sebagai `message` (raise exception '...'),
// jadi string mentah yang berbentuk snake_case juga diperlakukan sebagai kode.
export function dbErrorCode(err) {
  if (!err) return ''
  const raw = typeof err === 'string' ? err : String(err.message || err.error || '')
  const code = typeof err === 'object' && err ? String(err.code || '') : ''
  if (code && CODE_RE.test(code)) return code
  const trimmed = raw.trim()
  if (CODE_RE.test(trimmed)) return trimmed
  return ''
}

// Terjemahkan. Mengembalikan { text, code, known }.
// `fallback` = kalimat pembuka bila kode tidak dikenal.
export function dbErrorText(err, { fallback = 'Penyimpanan menolak permintaan.' } = {}) {
  const raw = typeof err === 'string' ? err : String(err?.message || err?.error || '')
  const code = dbErrorCode(err)
  if (code && TEXT[code]) return { text: TEXT[code], code, known: true }
  const trimmed = raw.trim()
  if (!trimmed) return { text: fallback, code: '', known: false }
  // Pesan yang sudah berupa kalimat (bukan kode) diteruskan apa adanya —
  // itu pesan dari aplikasi sendiri, bukan teks SQL.
  if (!code) return { text: trimmed, code: '', known: false }
  // Kode tak dikenal: sebutkan apa adanya (jangan disembunyikan) + kode.
  return { text: `${fallback} (kode: ${code})`, code, known: false }
}
