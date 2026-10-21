// ============================================================
// modules/handovers/duplicateGuard.js — SATU dokumen AKTIF per penerimaan
// ============================================================
// LENSA KEENAM (run 239). Run 101..237 menguji: SIMPAN, TAMPIL, KESIAPAN,
// RETUR, WAKTU (capability basi), dan HAPUS. Yang belum pernah diuji:
// DUA DOKUMEN pada SATU PENERIMAAN.
//
// Bukti di PostgreSQL NYATA (probe_run239_dupdoc.mjs, 21/21):
//   S1  `handovers` menerima DUA dokumen DRAFT untuk satu `receiving_id`.
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
// Penjaga ini murni (tanpa DB/React) supaya bisa diuji, dan dipakai di SEMUA
// pintu tulis `handovers` di aplikasi: `save.js`, `purchaseSave.js`,
// `pages/index.js` (sendToTukang), `queue.jsx`, `view.jsx`, dan
// `physicalHost.jsx` (satu choke point untuk semua pintu modal konfirmasi).
//
// BATAS YANG SAYA AKUI (lihat docs/receiving-events-contract.md §9B):
//   - Jaminan "paling banyak satu dokumen aktif" untuk jalur APLIKASI
//     ditegakkan oleh PRIMARY KEY `handovers.id` yang diisi id DETERMINISTIK
//     (`slotHandoverId`) — lihat penjelasan panjang di fungsi itu. Ini jaminan
//     database nyata tanpa DDL, tetapi hanya berlaku bagi penulis yang memakai
//     modul ini.
//   - SQL manual / service-role yang mengarang `id` acak tetap bisa membuat
//     dokumen kedua. Kunci per PENERIMAAN di `handover_confirm`
//     (`handover:rec:<receiving_id>`) tetap milik schema owner `t_03b41644`
//     dan TIDAK diklaim selesai di sini.
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

function ts(v) {
  if (!v) return null
  const t = Date.parse(String(v))
  return isFinite(t) ? t : null
}

// Waktu "dokumen ini mulai ada", dalam presisi yang tersedia:
//   created_at (timestamp) bila ada → presisi milidetik;
//   kalau tidak, handover_date (tanggal) → presisi HARI, dikembalikan sebagai
//   'YYYY-MM-DD' supaya perbandingannya tetap jujur (bukan jam karangan);
//   kalau tidak ada keduanya → null (tidak bisa dibedakan).
function docStartOf(h) {
  const full = ts(h?.created_at)
  if (full !== null) return { ms: full, day: null, precision: 'timestamp' }
  const raw = String(h?.handover_date || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return { ms: null, day: raw.slice(0, 10), precision: 'date' }
  }
  return { ms: null, day: null, precision: 'none' }
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

// ------------------------------------------------------------------
// SISA DOKUMEN GANDA YANG SAUDARANYA SUDAH DIKONFIRMASI (review run 244 / L3)
// ------------------------------------------------------------------
// Temuan run 244: `activeDocumentsFor()` hanya melihat `diserahkan_at IS NULL`,
// jadi begitu dokumen PERTAMA dikonfirmasi, dokumen kedua "sendirian" dan
// dianggap kanonik → penjaga meloloskan TANPA peringatan → dua dokumen
// terkonfirmasi untuk satu penerimaan, dan `deleteGuard` menolak menghapus
// keduanya sehingga tidak ada pembersihan dari UI.
//
// Pembedanya BUKAN "ada dokumen lain yang sudah diserahkan" — itu juga keadaan
// serah terima BERTAHAP yang SAH. Pembedanya adalah KAUSALITAS: apakah dokumen
// ini SUDAH ADA ketika saudaranya dikonfirmasi?
//
//   duplikat : this.mulai <= sibling.diserahkan_at
//              → keduanya pernah aktif bersamaan → ini sisa duplikat.
//   bertahap : sibling.diserahkan_at < this.mulai
//              → dokumen ini dibuat SESUDAH yang lain dikonfirmasi → sah.
//
// Waktu "mulai" memakai `created_at` (timestamp dari database). Data lama tanpa
// `created_at` memakai `handover_date` dengan presisi HARI — dan perbandingan
// hari-vs-timestamp dilakukan dengan sadar: bila saudaranya dikonfirmasi pada
// hari yang SAMA atau LEBIH AKHIR dari tanggal dokumen ini, dokumen ini
// dianggap sisa duplikat (fail closed, sebabnya menyebut presisi tanggal).
// Bila TIDAK ada `created_at` maupun `handover_date`, keduanya tidak bisa
// dibedakan → juga fail closed, dan sebabnya menyebut hal itu apa adanya.
export function deliveredSiblingFor(handover, handovers = []) {
  if (!handover || !handover.id || !handover.receiving_id) return null
  const mine = docStartOf(handover)
  const siblings = (handovers || []).filter(h =>
    h && h.id && String(h.id) !== String(handover.id) &&
    String(h.receiving_id || '') === String(handover.receiving_id) &&
    h.diserahkan_at
  )
  for (const s of siblings) {
    const deliveredAt = ts(s.diserahkan_at)
    if (deliveredAt === null) continue
    if (mine.precision === 'timestamp') {
      if (mine.ms <= deliveredAt) return s
      continue
    }
    if (mine.precision === 'date') {
      // Presisi HARI: dokumen "mulai ada" pada tanggal itu (00:00 lokal).
      // Konfirmasi pada hari yang sama atau sesudahnya → tidak bisa
      // dibuktikan bertahap → duplikat (fail closed).
      const dayStart = Date.parse(`${mine.day}T00:00:00Z`)
      if (isFinite(dayStart) && dayStart <= deliveredAt) return s
      continue
    }
    // Tidak ada waktu sama sekali → tidak bisa dibedakan → fail closed.
    return s
  }
  return null
}

export const DUPLIKAT_ALASAN =
  'Penerimaan ini punya LEBIH DARI SATU dokumen Serah Terima yang belum diserahkan. ' +
  'Kalau keduanya dikonfirmasi, barang yang sama bisa tercatat diserahkan DUA kali ' +
  '(jumlah "sudah diserahkan" bisa melebihi alokasi, dan sisa menjadi minus). ' +
  'Konfirmasi hanya bisa dilakukan pada dokumen yang PALING AWAL dibuat; ' +
  'hapus dokumen duplikat (yang belum punya bukti) lalu ulangi.'

export const SISA_DUPLIKAT_ALASAN =
  'Dokumen ini adalah SISA DOKUMEN GANDA: ia sudah ada ketika dokumen lain untuk ' +
  'penerimaan yang sama dikonfirmasi, jadi barang yang sama bisa tercatat diserahkan ' +
  'DUA kali (jumlah "sudah diserahkan" melebihi alokasi dan sisa menjadi minus). ' +
  'Jangan konfirmasi dokumen ini. Hapus dokumen ini (belum punya bukti fisik) lalu ' +
  'catat sisa barang lewat dokumen BARU yang dibuat SETELAH dokumen sebelumnya ' +
  'dikonfirmasi — itu jalur serah terima bertahap yang sah.'

// Penjaga saat MEMBUAT dokumen baru (save.js / purchaseSave.js / shell).
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
// `handover` = dokumen yang akan dikonfirmasi; `handovers` = SEMUA baris untuk
// penerimaan itu (aktif DAN yang sudah diserahkan), supaya duplikat yang sudah
// terlanjur ada — termasuk yang sudah dikonfirmasi lebih dulu — ikut terlihat.
export function confirmDuplicateGuard({ handover, handovers = [] } = {}) {
  if (!handover || !handover.id) {
    return { ok: false, reason: 'Data Serah Terima tidak dikenal.', canonicalId: null, kind: 'unknown' }
  }
  // Sudah diserahkan → bukan urusan penjaga ini (idempoten di RPC/confirm.js).
  if (handover.diserahkan_at) return { ok: true, reason: '', canonicalId: handover.id, kind: 'done' }

  // 1) SISA DUPLIKAT yang saudaranya sudah dikonfirmasi (review run 244 / L3).
  //    Diperiksa LEBIH DULU: keadaan ini tidak terlihat oleh daftar aktif.
  const stale = deliveredSiblingFor(handover, handovers)
  if (stale) {
    return {
      ok: false,
      kind: 'late-sibling',
      canonicalId: stale.id,
      deliveredSiblingId: stale.id,
      deliveredAt: stale.diserahkan_at || null,
      reason: SISA_DUPLIKAT_ALASAN
    }
  }

  // 2) Dua dokumen AKTIF sekaligus (run 239) — hanya yang paling awal boleh.
  const active = activeDocumentsFor(handover.receiving_id, handovers)
  if (active.length <= 1) {
    return { ok: true, reason: '', canonicalId: handover.id, activeCount: active.length, kind: 'single' }
  }
  const canonicalId = active[0].id
  if (canonicalId === handover.id) {
    // Dokumen kanonik boleh lanjut, TETAPI admin harus tahu ada duplikat.
    return {
      ok: true,
      reason: '',
      canonicalId,
      activeCount: active.length,
      kind: 'canonical-with-duplicate',
      warn:
        `Ada ${active.length - 1} dokumen Serah Terima LAIN untuk penerimaan ini yang juga belum diserahkan. ` +
        'Hanya dokumen paling awal yang boleh dikonfirmasi. Setelah ini tersimpan, hapus dokumen duplikatnya ' +
        'supaya tidak ada yang mengonfirmasi barang yang sama dua kali.'
    }
  }
  return { ok: false, kind: 'duplicate', canonicalId, activeCount: active.length, reason: DUPLIKAT_ALASAN }
}

// Ringkasan untuk ditampilkan di kartu antrean (badge + sebab), tanpa menulis.
// `staleDuplicate` = dokumen ini sisa duplikat yang saudaranya SUDAH
// dikonfirmasi. Dulu badge ini MATI tepat sesudah dokumen pertama
// dikonfirmasi (review run 244 / probe_run244_after_first), sehingga tidak ada
// yang menahan dokumen kedua.
export function duplicateInfoFor(handover, handovers = []) {
  const active = activeDocumentsFor(handover?.receiving_id, handovers)
  const stale = handover && !handover.diserahkan_at ? deliveredSiblingFor(handover, handovers) : null
  if (active.length <= 1 && !stale) {
    return {
      duplicate: false,
      staleDuplicate: false,
      staleSibling: null,
      activeCount: active.length,
      canonicalId: active[0]?.id || null,
      isCanonical: true
    }
  }
  return {
    duplicate: active.length > 1,
    staleDuplicate: !!stale,
    staleSibling: stale ? { id: stale.id, diserahkan_at: stale.diserahkan_at || null } : null,
    activeCount: active.length,
    canonicalId: stale ? stale.id : (active[0]?.id || null),
    isCanonical: !stale && active[0]?.id === handover?.id,
    others: active.filter(h => h.id !== handover?.id).map(h => h.id)
  }
}

// ------------------------------------------------------------------
// KUNCI SLOT TANPA DDL — `handovers.id` (PRIMARY KEY) sebagai mutex
// ------------------------------------------------------------------
// Kenapa perlu: review run 244 (BUG-W1) membuktikan bahwa
// "insert → baca ulang → tarik diri sendiri" TIDAK konvergen. Penulis yang
// commit TERAKHIR selalu melihat semuanya; bila ia justru yang paling awal
// (`created_at` terkecil) ia TIDAK menarik diri, sementara penulis lain sudah
// selesai dan tidak pernah melihatnya → DUA dokumen aktif, keduanya `ok:true`.
// (Baca-tulis-tanpa-kunci memang tidak bisa memberi jaminan at-most-one.)
//
// Yang bisa menjamin TANPA DDL adalah membiarkan DATABASE menolak penulis
// kedua: `handovers.id` sudah PRIMARY KEY, jadi bila setiap penulis
// menurunkan `id` secara DETERMINISTIK dari (receiving_id, nomor slot), dua
// penulis yang memakai slot yang sama bertabrakan (SQLSTATE 23505) dan hanya
// satu yang masuk. Nomor slot = jumlah dokumen yang TERLIHAT pada pembacaan
// yang sama dengan pre-check (satu snapshot), sehingga:
//
//   - dua penulis bersamaan melihat jumlah yang sama → slot sama → tabrakan;
//   - penulis yang membaca SESUDAH penulis lain commit melihat slot
//     berikutnya, TETAPI juga melihat dokumen aktifnya → ditolak pre-check;
//   - serah terima bertahap tetap sah: dokumen lama sudah dikonfirmasi →
//     pre-check lolos → slot berikutnya kosong → dokumen baru masuk.
//
// Fungsi ini MURNI supaya setiap klien menghasilkan id yang sama dan bisa
// diuji tanpa DB.
function fnv1a(str, seed) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function hex8(n) {
  return (n >>> 0).toString(16).padStart(8, '0')
}

// id berbentuk UUID v4 (sah untuk kolom `uuid`) tetapi DETERMINISTIK:
// 128 bit dari empat seed berbeda atas kunci yang sama.
export function slotHandoverId(receivingId, slot) {
  const key = `handover-slot:${String(receivingId || '')}:${Number(slot) || 0}`
  // 32 hex chars = 128 bit, dari empat seed berbeda atas kunci yang sama.
  const hex = hex8(fnv1a(key, 0x811c9dc5)) + hex8(fnv1a(key, 0x9e3779b1)) +
              hex8(fnv1a(key, 0x85ebca6b)) + hex8(fnv1a(key, 0xc2b2ae35))
  // Bentuk UUID 8-4-4-4-12; nibble pertama segmen ke-3 dipaksa '4' (versi 4)
  // dan nibble pertama segmen ke-4 dipaksa 8..b (variant RFC 4122) supaya
  // nilainya sah untuk kolom `uuid` PostgreSQL.
  const s1 = hex.slice(0, 8)
  const s2 = hex.slice(8, 12)
  const s3 = '4' + hex.slice(13, 16)
  const s4 = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20)
  const s5 = hex.slice(20, 32)
  return `${s1}-${s2}-${s3}-${s4}-${s5}`
}
