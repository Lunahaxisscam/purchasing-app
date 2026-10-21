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

  // ----------------------------------------------------------
  // REVIEW run 253 / D5: kode di bawah ini NYATA bisa muncul dari tiga RPC
  // yang dipakai form (receipt_apply_events, return_create,
  // purchase_save_atomic) tetapi dulu tidak punya kalimat — admin membaca
  // "… (kode: over_return)" tanpa tahu harus berbuat apa. `over_return`
  // adalah penolakan retur PALING UMUM, jadi ketiadaannya paling merugikan.
  // Setiap kalimat menyebut APA yang salah DAN langkah berikutnya.
  // ----------------------------------------------------------
  // --- penerimaan (receipt_apply_events) ---
  empty_events: 'Tidak ada baris penerimaan yang dikirim — isi minimal satu barang lalu simpan lagi.',
  duplicate_client_event_id:
    'Ada dua baris dengan kunci kiriman yang sama dalam satu penyimpanan. Muat ulang form lalu isi ulang sekali saja.',
  missing_client_event_id:
    'Baris penerimaan tidak membawa kunci kiriman, jadi tidak bisa dicek anti-gandanya. Muat ulang halaman lalu isi ulang form.',
  backfill_not_authorized:
    'Baris ini ditandai sebagai data isian lama (backfill) — hanya admin yang boleh memasukkannya lewat jalur resmi.',
  duplicate_event_line:
    'Barang yang sama dikirim dua kali dalam satu konfirmasi. Gabungkan menjadi satu baris.',
  // --- retur (return_create) ---
  over_return:
    'Jumlah retur melebihi sisa barang rusak yang belum diretur pada baris itu. Kurangi jumlahnya, atau periksa riwayat retur barang tersebut.',
  event_not_found:
    'Baris penerimaan yang dirujuk tidak ditemukan (mungkin sudah berubah). Tutup lalu buka lagi form retur.',
  already_discarded:
    'Barang ini sudah tercatat DIBUANG, jadi tidak bisa diubah menjadi retur/penggantian. Pilih tindakan "Dibuang", atau catat lewat dokumen baru.',
  bad_resolution:
    'Tindakan barang rusak tidak dikenali. Pilih salah satu: kembalikan ke supplier, ganti, refund, atau dibuang.',
  // --- pembelian (purchase_save_atomic) ---
  request_key_required:
    'Kunci permintaan (request key) tidak sah. Muat ulang form Pembelian lalu simpan ulang.',
  vendor_not_found: 'Vendor/toko tidak ditemukan. Pilih vendor dari daftar, bukan mengetik nama.',
  invoice_required: 'Nomor nota wajib diisi.',
  bad_date: 'Tanggal nota tidak sah — gunakan format TTTT-BB-HH (contoh 2026-10-21).',
  items_required: 'Nota harus punya minimal satu baris barang (dan maksimal 200 baris).',
  item_name_required: 'Nama barang wajib diisi pada setiap baris.',
  unit_required: 'Satuan barang wajib diisi (mis. sak, lembar, m3).',
  material_unresolved:
    'Barang belum terhubung ke master material. Pilih materialnya dulu — biaya tidak boleh masuk tanpa identitas material.',
  material_mismatch: 'Material baris ini berbeda dari material yang diminta di PR asal.',
  pr_item_not_found: 'Baris PR asal tidak ditemukan untuk barang ini. Muat ulang lalu pilih ulang dari PR.',
  project_not_found: 'Proyek yang dipilih tidak ditemukan. Pilih proyek lain dari daftar.',
  discount_over_total: 'Diskon melebihi total nota sehingga totalnya menjadi negatif. Periksa angka diskon.',
  bad_allocations: 'Format pembagian proyek tidak dikenali (harus berupa daftar proyek + qty).',
  allocation_over_bought:
    'Pembagian ke proyek melebihi qty yang benar-benar dibeli pada baris itu. Kurangi pembagiannya.',
  actual_price_required:
    'Harga satuan aktual wajib diisi sebelum barang bisa dibagi ke proyek.',
  bad_payload: 'Isi formulir tidak bisa dibaca penyimpanan. Muat ulang halaman lalu isi ulang.',
  bad_item: 'Salah satu baris barang tidak berbentuk data yang sah. Muat ulang lalu isi ulang baris itu.',
  // --- kontrak/teknis yang tetap harus bisa ditindaklanjuti ---
  duplicate_active_handover:
    'Penerimaan ini sudah punya dokumen Serah Terima lain yang belum diserahkan. Konfirmasi dokumen yang PALING AWAL dibuat; dokumen ini hapus bila belum punya bukti.',
  handover_queue_failed:
    'Nota tersimpan, tetapi antrean Serah Terima gagal dibuat. Periksa menu Serah Terima sebelum menyimpan ulang nota.',
  physical_evidence_immutable:
    'Bukti fisik (penerimaan/serah terima) hanya boleh DITAMBAH, tidak boleh diubah atau dihapus. Catat koreksi lewat dokumen baru.',
  read_committed_required:
    'Penyimpanan harus berjalan pada transaksi baca-komit. Coba simpan ulang dari form (jangan lewat skrip).',
  replace_only:
    'Pembagian proyek hanya bisa diganti SELURUHNYA, bukan ditambah sepotong. Buka form pembagian lalu simpan ulang.',
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
