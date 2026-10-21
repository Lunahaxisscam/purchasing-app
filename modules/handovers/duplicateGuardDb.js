// ============================================================
// modules/handovers/duplicateGuardDb.js — PENJAGA DOKUMEN GANDA
//                                        YANG MEMBACA DATABASE
// ============================================================
// LENSA KETUJUH (review run 242). Run 239 memasang `duplicateGuard.js` di
// empat lapis, tetapi SEMUA lapis memanggil penjaga murni dengan `ctx.rows`:
//
//     confirmDuplicateGuard({ handover, handovers: ctx.rows || [] })
//
// `ctx.rows` = hasil `loadAll()` SAAT HALAMAN DIMUAT. Halaman tidak punya
// realtime dan tidak refresh saat tab kembali fokus, jadi daftar itu hanya
// berubah karena aksi tab itu sendiri. Dua akibat nyata (dibuktikan
// `probe_run242_stalerows.mjs` / `probe_run242_stale_write2.mjs` di pohon
// `323bfed`):
//
//   V1  Penjaga KONFIRMASI buta terhadap dokumen yang dibuat admin lain
//       sesudah halaman dimuat → dokumen duplikat bisa dikonfirmasi.
//   V2  Penjaga CREATE adalah SELECT-lalu-INSERT tanpa kunci → dua sesi
//       bersamaan sama-sama lolos (probe_run242_duprace.mjs: dua dokumen
//       aktif, nol error).
//   V3  Rantai penuh: dua dokumen aktif → KEDUA `handover_confirm` diterima
//       (kunci RPC per DOKUMEN) → rincian 2× kuota, `belum_diserahkan`
//       negatif, `check_receipt_qty_consistency()` menyala.
//
// MODUL INI MENJAWAB KETIGANYA TANPA SQL / TANPA DDL:
//
//   1. `loadActiveHandovers()` — baca DB (bukan memori) untuk satu penerimaan.
//      Dipakai SETIAP titik tulis, tepat sebelum menulis.
//   2. `guardConfirmFresh()` — keputusan konfirmasi dari hasil baca DB.
//      Gagal baca = FAIL CLOSED (tidak menulis).
//   3. `insertUniqueActiveHandover()` — INSERT lalu VERIFIKASI ULANG, dan
//      dokumen yang kalah menarik dirinya sendiri (compensating withdraw).
//
// KENAPA INSERT-LALU-VERIFIKASI ITU BENAR (bukan tambalan):
//   Tidak ada DDL yang boleh dijalankan card ini (schema owner t_03b41644),
//   dan unique index parsial `(receiving_id) where diserahkan_at is null`
//   memang TIDAK boleh dipakai karena serah terima bertahap sah.
//   Tanpa kunci, dua INSERT bersamaan tetap mungkin terjadi — yang bisa
//   dijamin aplikasi adalah KONVERGENSI: setiap penulis membaca ulang
//   SESUDAH commit-nya sendiri, memakai urutan kanonik yang SAMA
//   (created_at → handover_date → id), lalu yang bukan kanonik menghapus
//   barisnya sendiri.
//
//   Bukti tidak mungkin dua-duanya menang: agar A tidak melihat B, baca A
//   harus sebelum commit B; agar B tidak melihat A, baca B harus sebelum
//   commit A. Karena baca A sesudah commit A dan baca B sesudah commit B,
//   kedua syarat itu berarti commit A < commit B < baca B < commit A —
//   kontradiksi. Jadi paling sedikit satu penulis SELALU melihat yang lain,
//   dan karena urutannya total, hanya SATU yang bertahan.
//
// BATAS YANG DIAKUI (tidak disembunyikan):
//   - Jendela singkat "dua baris sempat ada" tetap ada (insert → verify →
//     delete = 3 round-trip). Yang hilang bukan jendela itu, melainkan
//     KEADAAN AKHIR ganda.
//   - Bila peramban penulis yang kalah mati ANTARA insert dan verify, baris
//     duplikat bisa tertinggal. Karena itu lapis kedua tetap wajib:
//     `guardConfirmFresh()` menolak konfirmasi dokumen non-kanonik, jadi
//     sisa duplikat TIDAK bisa menjadi penyerahan fisik ganda.
//   - Perbaikan sejati di level database (kunci per penerimaan
//     `handover:rec:<id>` atau row lock `receiving_items` SEBELUM cek kuota)
//     tetap milik schema owner — rekomendasinya di
//     docs/receiving-events-contract.md §9.5, bukan diklaim selesai di sini.
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { confirmDuplicateGuard, handoverCreateGuard, DUPLIKAT_ALASAN } from './duplicateGuard'

// Kolom yang dibutuhkan urutan kanonik + tampilan sebab.
const SELECT_COLS = 'id, receiving_id, handover_date, created_at, diserahkan_at, status, received_by, project_id'

function clientOf(client) {
  return client || supabase
}

function failMessage(what, err) {
  return `Tidak bisa memeriksa ${what} (${err}). Penyimpanan dibatalkan supaya tidak membuat/mengonfirmasi dokumen ganda — coba lagi.`
}

// Semua dokumen AKTIF (belum diserahkan) untuk satu penerimaan — DARI DB.
// `ok:false` = pemeriksaan gagal; pemanggil WAJIB berhenti (fail closed).
export async function loadActiveHandovers(receivingId, { client } = {}) {
  const sb = clientOf(client)
  if (!sb) return { ok: false, rows: [], error: 'Supabase tidak tersedia.' }
  if (!receivingId) return { ok: false, rows: [], error: 'Penerimaan tidak dikenal.' }
  try {
    const { data, error } = await sb
      .from('handovers')
      .select(SELECT_COLS)
      .eq('receiving_id', receivingId)
      .is('diserahkan_at', null)
    if (error) return { ok: false, rows: [], error: error.message }
    return { ok: true, rows: Array.isArray(data) ? data : [], error: null }
  } catch (err) {
    return { ok: false, rows: [], error: String(err?.message || err) }
  }
}

// Keputusan KONFIRMASI dari DB (V1). Mengembalikan bentuk yang sama dengan
// `confirmDuplicateGuard` + `fresh:true` supaya pemanggil bisa membedakan.
export async function guardConfirmFresh({ handover, client } = {}) {
  if (!handover || !handover.id) {
    return { ok: false, reason: 'Data Serah Terima tidak dikenal.', canonicalId: null, fresh: true }
  }
  const res = await loadActiveHandovers(handover.receiving_id, { client })
  if (!res.ok) {
    return {
      ok: false,
      failed: true,
      fresh: true,
      canonicalId: null,
      reason: failMessage('dokumen Serah Terima lain yang belum diserahkan', res.error)
    }
  }
  // `handover` dari baris halaman bisa BASI. Bila dokumen itu sendiri sudah
  // diserahkan di DB (sesi lain), jangan menulis apa pun.
  const self = res.rows.find(r => r && String(r.id) === String(handover.id))
  if (!self && handover.diserahkan_at == null) {
    // Tidak ada di daftar aktif DAN menurut memori belum diserahkan:
    // kemungkinan besar sudah diserahkan orang lain. Konfirmasi ulang aman
    // (RPC idempoten), tetapi keputusan duplikat tidak boleh ditebak.
    // Kita tetap memakai daftar aktif apa adanya — dokumen ini tidak ada di
    // sana berarti bukan pesaing, jadi konfirmasi diizinkan dan RPC yang
    // memutuskan (CAS `diserahkan_at IS NULL`).
  }
  const guard = confirmDuplicateGuard({ handover, handovers: res.rows })
  return { ...guard, fresh: true, activeRows: res.rows }
}

// Keputusan CREATE dari DB (V2 lapis pertama: jalur cepat + pesan ramah).
export async function guardCreateFresh({ receivingId, client } = {}) {
  const res = await loadActiveHandovers(receivingId, { client })
  if (!res.ok) {
    return { ok: false, failed: true, reason: failMessage('dokumen Serah Terima yang sudah ada', res.error) }
  }
  const guard = handoverCreateGuard({ receiving: { id: receivingId }, handovers: res.rows })
  return { ...guard, fresh: true, activeRows: res.rows }
}

// INSERT + VERIFIKASI + TARIK DIRI SENDIRI bila kalah balapan (V2/V3).
// Mengembalikan:
//   { ok:true, row }
//   { ok:false, reason, existingId? }        → tidak ada baris tertinggal
//   { ok:false, error, needsReview:true }    → insert terjadi tetapi verifikasi
//                                              gagal (JANGAN klaim sukses)
export async function insertUniqueActiveHandover({ data, client } = {}) {
  const sb = clientOf(client)
  if (!sb) return { ok: false, reason: 'Supabase tidak tersedia.' }
  const receivingId = data?.receiving_id
  if (!receivingId) return { ok: false, reason: 'Pilih Penerimaan (Purchase) dulu — serah terima harus terhubung ke penerimaan asalnya.' }

  // Lapis 1 — jalur cepat: sudah ada dokumen aktif → jangan INSERT sama sekali.
  const pre = await guardCreateFresh({ receivingId, client: sb })
  if (!pre.ok) return { ok: false, reason: pre.reason, existingId: pre.existingId || null, failed: !!pre.failed }

  // Lapis 2 — INSERT.
  let inserted = null
  try {
    const { data: rows, error } = await sb.from('handovers').insert(data).select()
    if (error) return { ok: false, reason: error.message }
    inserted = Array.isArray(rows) ? rows[0] : rows
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) }
  }
  if (!inserted || !inserted.id) {
    return { ok: false, reason: 'Dokumen tersimpan tetapi database tidak mengembalikan ID — periksa daftar Serah Terima sebelum mengulang.' }
  }

  // Lapis 3 — VERIFIKASI sesudah commit: siapa yang kanonik?
  const after = await loadActiveHandovers(receivingId, { client: sb })
  if (!after.ok) {
    return {
      ok: false,
      needsReview: true,
      row: inserted,
      reason: `Dokumen sudah dibuat, tetapi pemeriksaan ulang gagal (${after.error}). Buka daftar Serah Terima dan pastikan hanya ada SATU dokumen aktif untuk penerimaan ini sebelum melanjutkan.`
    }
  }
  const guard = confirmDuplicateGuard({ handover: { id: inserted.id, receiving_id: receivingId, diserahkan_at: null }, handovers: after.rows })
  if (guard.ok) return { ok: true, row: inserted }

  // Kalah balapan → tarik diri sendiri. Hanya menyentuh baris yang BARU dibuat
  // dan HANYA bila belum diserahkan (CAS) — tidak mungkin menghapus bukti.
  let withdrawn = false
  let withdrawError = null
  try {
    const { error } = await sb.from('handovers').delete().eq('id', inserted.id).is('diserahkan_at', null)
    if (error) withdrawError = error.message
    else withdrawn = true
  } catch (err) {
    withdrawError = String(err?.message || err)
  }

  if (!withdrawn) {
    return {
      ok: false,
      needsReview: true,
      row: inserted,
      canonicalId: guard.canonicalId,
      reason: `${DUPLIKAT_ALASAN} Dokumen yang baru dibuat TIDAK bisa ditarik otomatis (${withdrawError || 'tidak diketahui'}) — hapus dokumen duplikat secara manual sebelum mengonfirmasi apa pun.`
    }
  }
  return {
    ok: false,
    withdrawn: true,
    canonicalId: guard.canonicalId,
    reason:
      'Penerimaan ini SUDAH punya dokumen Serah Terima aktif yang dibuat lebih dulu (kemungkinan admin lain menyimpan pada saat yang hampir bersamaan). ' +
      'Dokumen yang baru saja dibuat sudah DIBATALKAN otomatis; buka dokumen yang lebih awal dan konfirmasi di sana.'
  }
}

// Untuk layar TAMBAH (V4): peta receiving_id → true bila sudah punya dokumen
// aktif. Dipakai menandai pilihan yang PASTI ditolak `save.js`.
export async function loadActiveReceivingIds({ client } = {}) {
  const sb = clientOf(client)
  if (!sb) return { ok: false, ids: {}, error: 'Supabase tidak tersedia.' }
  try {
    const { data, error } = await sb.from('handovers').select('id, receiving_id, diserahkan_at').is('diserahkan_at', null)
    if (error) return { ok: false, ids: {}, error: error.message }
    const ids = {}
    for (const row of (data || [])) {
      if (row && row.receiving_id) ids[String(row.receiving_id)] = true
    }
    return { ok: true, ids, error: null }
  } catch (err) {
    return { ok: false, ids: {}, error: String(err?.message || err) }
  }
}
