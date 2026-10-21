// ============================================================
// modules/handovers/duplicateGuardDb.js — PENJAGA DOKUMEN GANDA
//                                        YANG MEMBACA DATABASE
// ============================================================
// RIWAYAT LENSA INI
//   run 239  penjaga murni dipasang di 4 lapis, tetapi SEMUA lapis memanggil
//            penjaga dengan `ctx.rows` (memori halaman) → buta terhadap
//            dokumen yang dibuat admin lain (review run 242 / V1).
//   run 243  penjaga membaca DB, dan pembuatan memakai
//            insert → verifikasi-sesudah-commit → tarik diri sendiri.
//   run 244  review independen membuktikan mekanisme run 243 TIDAK konvergen
//            (BUG-W1). Bukti: `created_at` diambil saat INSERT, commit di
//            akhir permintaan; penulis LAMBAT (created_at lebih awal) yang
//            commit TERAKHIR melihat dua baris, dan karena ia KANONIK ia TIDAK
//            menarik diri — sementara penulis lain sudah selesai dan tidak
//            pernah melihatnya. Hasil: 2 dokumen aktif, KEDUANYA `ok:true`.
//            Klaim "keadaan akhir SELALU satu dokumen" karena itu DICABUT.
//   run 245  (file ini) mekanismenya diganti dengan jaminan DATABASE tanpa
//            DDL: `handovers.id` adalah PRIMARY KEY, dan setiap penulis
//            menurunkannya secara DETERMINISTIK dari (receiving_id, slot) —
//            lihat `slotHandoverId` di duplicateGuard.js. Dua penulis yang
//            memakai slot yang sama bertabrakan (23505) dan hanya satu masuk.
//            Verifikasi sesudah tulis TETAP ada, tetapi sekarang sebagai
//            pemeriksa kejujuran (dan penarik diri untuk sisa duplikat LAMA),
//            BUKAN sebagai dasar klaim konvergensi.
//
// YANG BISA DIJAMIN (dan yang TIDAK)
//   JAMIN: untuk setiap penerimaan, jalur APLIKASI (semua pintu tulis di repo
//   ini) tidak bisa meninggalkan DUA dokumen aktif — bukan karena "pembacaan
//   ulang", melainkan karena database menolak INSERT kedua (PRIMARY KEY pada
//   id yang deterministik). Serah terima bertahap tetap sah: dokumen lama yang
//   sudah dikonfirmasi keluar dari predikat "aktif", jadi slot berikutnya
//   kosong.
//   TIDAK DIJAMIN: SQL manual / service-role yang mengarang `id` acak tetap
//   bisa menyisipkan dokumen kedua. Untuk itu kunci per PENERIMAAN di
//   `handover_confirm` (`handover:rec:<receiving_id>`) tetap dibutuhkan dan
//   tetap milik schema owner `t_03b41644` (docs §9.5). Tidak diklaim selesai.
//   TIDAK DIJAMIN juga: bila peramban mati setelah INSERT tetapi sebelum
//   verifikasi, baris itu tetap ada (sah: ia satu-satunya dokumen aktif).
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { confirmDuplicateGuard, handoverCreateGuard, duplicateInfoFor, slotHandoverId, activeDocumentsFor } from './duplicateGuard'
import { markHandoverDelivered } from './confirm'

// Kolom yang dibutuhkan urutan kanonik + tampilan sebab.
const SELECT_COLS = 'id, receiving_id, handover_date, created_at, diserahkan_at, status, received_by, project_id'

function clientOf(client) {
  return client || supabase
}

function failMessage(what, err) {
  return `Tidak bisa memeriksa ${what} (${err}). Penyimpanan dibatalkan supaya tidak membuat/mengonfirmasi dokumen ganda — coba lagi.`
}

function isUniqueViolation(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '23505') return true
  return /duplicate key value|violates unique constraint|already exists/i.test(String(error.message || ''))
}

// ------------------------------------------------------------------
// SEMUA dokumen untuk satu penerimaan — DARI DB (aktif DAN yang sudah
// diserahkan). Ini penting untuk dua hal yang tidak terlihat oleh daftar
// aktif saja: (1) sisa duplikat yang saudaranya sudah dikonfirmasi
// (review run 244 / L3), dan (2) menghitung slot id deterministik.
// `ok:false` = pemeriksaan gagal; pemanggil WAJIB berhenti (fail closed).
export async function loadReceivingHandovers(receivingId, { client } = {}) {
  const sb = clientOf(client)
  if (!sb) return { ok: false, rows: [], error: 'Supabase tidak tersedia.' }
  if (!receivingId) return { ok: false, rows: [], error: 'Penerimaan tidak dikenal.' }
  try {
    const { data, error } = await sb
      .from('handovers')
      .select(SELECT_COLS)
      .eq('receiving_id', receivingId)
    if (error) return { ok: false, rows: [], error: error.message }
    return { ok: true, rows: Array.isArray(data) ? data : [], error: null }
  } catch (err) {
    return { ok: false, rows: [], error: String(err?.message || err) }
  }
}

// Semua dokumen AKTIF (belum diserahkan) untuk satu penerimaan — DARI DB.
// Dipertahankan karena dipakai layar/form; keputusan tulis memakai
// `loadReceivingHandovers` supaya sisa duplikat ikut terlihat.
export async function loadActiveHandovers(receivingId, { client } = {}) {
  const res = await loadReceivingHandovers(receivingId, { client })
  if (!res.ok) return res
  return { ok: true, rows: activeDocumentsFor(receivingId, res.rows), error: null }
}

// Keputusan KONFIRMASI dari DB (V1 + L3). Mengembalikan bentuk yang sama
// dengan `confirmDuplicateGuard` + `fresh:true` supaya pemanggil bisa
// membedakan hasil DB dari hasil memori.
export async function guardConfirmFresh({ handover, client } = {}) {
  if (!handover || !handover.id) {
    return { ok: false, reason: 'Data Serah Terima tidak dikenal.', canonicalId: null, fresh: true, kind: 'unknown' }
  }
  // Dokumen TANPA penerimaan (data lama / orphan) tidak punya "saudara" yang
  // bisa membuat penyerahan ganda: invariannya per `receiving_id`. Jangan
  // menutup jalur yang sah ini — dulu `loadActiveHandovers(null)` mengembalikan
  // ok:false dan (bila tidak dijaga) akan memblokir semua dokumen orphan.
  if (!handover.receiving_id) {
    return { ok: true, reason: '', canonicalId: handover.id, fresh: true, rows: [], kind: 'no-receiving' }
  }
  const res = await loadReceivingHandovers(handover.receiving_id, { client })
  if (!res.ok) {
    return {
      ok: false,
      failed: true,
      fresh: true,
      canonicalId: null,
      kind: 'check-failed',
      reason: failMessage('dokumen Serah Terima lain pada penerimaan ini', res.error)
    }
  }
  // `handover` dari baris halaman bisa BASI. Bila dokumen itu sendiri sudah
  // diserahkan di DB (sesi lain), konfirmasi ulang aman (RPC/confirm.js
  // idempoten) — penjaga duplikat tidak perlu menebak.
  const guard = confirmDuplicateGuard({ handover, handovers: res.rows })
  return { ...guard, fresh: true, rows: res.rows }
}

// Keputusan CREATE dari DB (V2 lapis pertama: jalur cepat + pesan ramah).
export async function guardCreateFresh({ receivingId, client } = {}) {
  const res = await loadReceivingHandovers(receivingId, { client })
  if (!res.ok) {
    return { ok: false, failed: true, reason: failMessage('dokumen Serah Terima yang sudah ada', res.error) }
  }
  const guard = handoverCreateGuard({ receiving: { id: receivingId }, handovers: res.rows })
  return { ...guard, fresh: true, rows: res.rows }
}

// Ringkasan tampilan (badge) dari DB — dipakai layar yang tidak boleh menebak
// dari `ctx.rows`. Gagal baca = `ok:false` (layar menyatakan jujur).
export async function duplicateInfoFresh({ handover, client } = {}) {
  if (!handover || !handover.receiving_id) {
    return { ok: false, failed: true, error: 'Penerimaan tidak dikenal.' }
  }
  const res = await loadReceivingHandovers(handover.receiving_id, { client })
  if (!res.ok) return { ok: false, failed: true, error: res.error }
  return { ok: true, ...duplicateInfoFor(handover, res.rows) }
}

// ------------------------------------------------------------------
// INSERT dengan KUNCI SLOT dari PRIMARY KEY (menutup BUG-W1 tanpa DDL)
// ------------------------------------------------------------------
// Mengembalikan:
//   { ok:true, row, slot }
//   { ok:false, reason, existingId? }            → tidak ada baris tertinggal
//   { ok:false, needsReview:true, row }          → insert terjadi tetapi
//                                                  verifikasi gagal (JANGAN
//                                                  klaim sukses)
export async function insertUniqueActiveHandover({ data, client } = {}) {
  const sb = clientOf(client)
  if (!sb) return { ok: false, reason: 'Supabase tidak tersedia.' }
  const receivingId = data?.receiving_id
  if (!receivingId) return { ok: false, reason: 'Pilih Penerimaan (Purchase) dulu — serah terima harus terhubung ke penerimaan asalnya.' }

  // Lapis 1 — baca DB (SEMUA dokumen, satu snapshot).
  const pre = await loadReceivingHandovers(receivingId, { client: sb })
  if (!pre.ok) {
    return { ok: false, failed: true, reason: failMessage('dokumen Serah Terima yang sudah ada', pre.error) }
  }
  // Jalur cepat: sudah ada dokumen aktif → jangan INSERT sama sekali.
  const preGuard = handoverCreateGuard({ receiving: { id: receivingId }, handovers: pre.rows })
  if (!preGuard.ok) return { ok: false, reason: preGuard.reason, existingId: preGuard.existingId || null }

  // Lapis 2 — INSERT dengan id DETERMINISTIK untuk slot berikutnya.
  // Slot = jumlah dokumen yang TERLIHAT pada snapshot yang sama dengan
  // pre-check. Dua penulis bersamaan melihat jumlah yang sama → id yang sama
  // → PRIMARY KEY menolak yang kedua (23505). Tidak ada jendela.
  let slot = pre.rows.length
  let inserted = null
  let lastError = null
  for (let attempt = 0; attempt < 4; attempt++) {
    const id = slotHandoverId(receivingId, slot)
    try {
      const { data: rows, error } = await sb.from('handovers').insert({ ...data, id }).select()
      if (error) {
        if (isUniqueViolation(error)) {
          lastError = error
          // Slot diambil penulis lain. Baca ulang: bila ia masih aktif,
          // permintaan ini memang harus ditolak (bukan diulang).
          const again = await loadReceivingHandovers(receivingId, { client: sb })
          if (!again.ok) {
            return { ok: false, failed: true, reason: failMessage('dokumen Serah Terima yang sudah ada', again.error) }
          }
          const againGuard = handoverCreateGuard({ receiving: { id: receivingId }, handovers: again.rows })
          if (!againGuard.ok) {
            return {
              ok: false,
              raced: true,
              existingId: againGuard.existingId || null,
              reason:
                'Penerimaan ini SUDAH punya dokumen Serah Terima aktif yang dibuat lebih dulu ' +
                '(kemungkinan admin lain menyimpan pada saat yang hampir bersamaan). ' +
                'Tidak ada dokumen kedua yang dibuat — buka dokumen yang lebih awal dan konfirmasi di sana.'
            }
          }
          // Slot itu ternyata kosong lagi (baris lama sudah dihapus) → coba
          // slot berikutnya, tetap dengan id deterministik.
          slot = again.rows.length
          continue
        }
        return { ok: false, reason: error.message }
      }
      inserted = Array.isArray(rows) ? rows[0] : rows
      break
    } catch (err) {
      lastError = err
      return { ok: false, reason: String(err?.message || err) }
    }
  }
  if (!inserted || !inserted.id) {
    return {
      ok: false,
      raced: true,
      reason:
        'Dokumen TIDAK bisa disimpan: slot dokumen untuk penerimaan ini baru saja dipakai ' +
        'permintaan lain (kemungkinan admin lain menyimpan pada saat yang hampir bersamaan). ' +
        'Tidak ada dokumen kedua yang dibuat — buka daftar Serah Terima, dan bila dokumen itu ada, ' +
        'konfirmasi di sana; bila tidak ada, ulangi simpan.' +
        (lastError ? ` [${lastError.code || 'error'}]` : '')
    }
  }

  // Lapis 3 — VERIFIKASI KEJUJURAN sesudah tulis. Bukan dasar klaim
  // konvergensi (itu milik PRIMARY KEY); ini menangkap sisa duplikat LAMA
  // yang dibuat di luar modul ini (SQL manual) supaya kita tidak melaporkan
  // sukses di atas keadaan yang sudah rusak.
  const after = await loadReceivingHandovers(receivingId, { client: sb })
  if (!after.ok) {
    return {
      ok: false,
      needsReview: true,
      row: inserted,
      reason: `Dokumen sudah dibuat, tetapi pemeriksaan ulang gagal (${after.error}). Buka daftar Serah Terima dan pastikan hanya ada SATU dokumen aktif untuk penerimaan ini sebelum melanjutkan.`
    }
  }
  const guard = confirmDuplicateGuard({
    handover: {
      id: inserted.id,
      receiving_id: receivingId,
      diserahkan_at: null,
      created_at: inserted.created_at,
      handover_date: inserted.handover_date
    },
    handovers: after.rows
  })
  if (guard.ok) return { ok: true, row: inserted, slot }

  // Ada dokumen aktif LAIN yang lebih awal (data lama di luar modul ini) →
  // tarik diri sendiri. Hanya menyentuh baris yang BARU dibuat dan HANYA bila
  // belum diserahkan (CAS) — tidak mungkin menghapus bukti.
  // Ditulis INLINE (bukan helper) supaya pemeriksaan statis
  // `probe_run237_shell_wiring` W7 bisa membuktikan `.delete()` ini menunjuk
  // `inserted.id` + `.is('diserahkan_at', null)`, bukan ID dari input pengguna.
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
      reason: `Dokumen yang baru dibuat TIDAK bisa ditarik otomatis (${withdrawError || 'tidak diketahui'}) — hapus dokumen duplikat secara manual sebelum mengonfirmasi apa pun.`
    }
  }
  // Verifikasi ULANG sesudah tarik diri (review run 244 butir 2a): jangan
  // klaim bersih tanpa membuktikannya.
  const final = await loadReceivingHandovers(receivingId, { client: sb })
  const stillActive = final.ok ? activeDocumentsFor(receivingId, final.rows) : null
  return {
    ok: false,
    withdrawn: true,
    canonicalId: guard.canonicalId,
    verifiedAfterWithdraw: final.ok,
    remainingActive: stillActive ? stillActive.length : null,
    reason:
      'Penerimaan ini SUDAH punya dokumen Serah Terima aktif yang dibuat lebih dulu. ' +
      'Dokumen yang baru saja dibuat sudah DIBATALKAN otomatis; buka dokumen yang lebih awal dan konfirmasi di sana.' +
      (final.ok ? '' : ' (Pemeriksaan ulang sesudah pembatalan gagal — periksa daftar secara manual.)')
  }
}

// Tarik diri sendiri tidak dipisah ke helper: jalur `delete` harus terbaca
// inline oleh pemeriksaan statis `probe_run237_shell_wiring` W7 (menunjuk
// `inserted.id` + CAS `diserahkan_at IS NULL`).

// ------------------------------------------------------------------
// KONFIRMASI: satu pintu, dengan verifikasi SESUDAH menulis diserahkan_at
// ------------------------------------------------------------------
// Review run 244 butir 2a menuntut verifikasi ulang SETELAH menulis
// `diserahkan_at`, bukan hanya sebelum. Yang diverifikasi sesudah tulis:
//   - bila ada dokumen LAIN pada penerimaan yang sama yang masih AKTIF (data
//     lama di luar modul ini), keadaan itu dilaporkan `needsReview`. Bukti
//     yang sudah tertulis TIDAK dihapus (menghapus bukti dilarang, §8), dan
//     dokumen lain itu tetap ditolak penjaga karena kini menjadi sisa
//     duplikat (`deliveredSiblingFor`).
//   - `already:true` (CAS kalah / retry) diteruskan apa adanya.
export async function confirmUniqueHandover({ handover, receivedBy, now, client } = {}) {
  const gate = await guardConfirmFresh({ handover, client })
  if (!gate.ok) return { ok: false, blocked: true, guard: gate, error: gate.reason }

  const res = await markHandoverDelivered({ handover, receivedBy, now, client })
  if (!res.ok) return res
  if (res.already) return { ...res, verifiedAfter: true }
  // Dokumen tanpa penerimaan: tidak ada saudara untuk diverifikasi.
  if (!handover.receiving_id) return { ...res, verifiedAfter: true, otherActive: 0 }

  const sb = clientOf(client)
  const after = await loadReceivingHandovers(handover.receiving_id, { client: sb })
  if (!after.ok) {
    return {
      ...res,
      needsReview: true,
      warning:
        `Serah terima tersimpan, tetapi pemeriksaan ulang gagal (${after.error}). ` +
        'Periksa daftar Serah Terima: pastikan tidak ada dokumen lain yang belum diserahkan untuk penerimaan ini.'
    }
  }
  const others = activeDocumentsFor(handover.receiving_id, after.rows)
    .filter(r => String(r.id) !== String(handover.id))
  if (!others.length) return { ...res, verifiedAfter: true, otherActive: 0 }
  return {
    ...res,
    verifiedAfter: true,
    otherActive: others.length,
    needsReview: true,
    warning:
      `Serah terima ini TERSIMPAN, tetapi penerimaan yang sama masih punya ${others.length} dokumen lain ` +
      'yang belum diserahkan. Dokumen lain itu DITOLAK untuk dikonfirmasi (sisa dokumen ganda) — ' +
      'hapus dokumen tersebut (belum punya bukti) supaya tidak ada yang mencatat barang yang sama dua kali.'
  }
}

// Verifikasi SESUDAH menulis `diserahkan_at` untuk jalur per barang (RPC
// `handover_confirm`). Dipisah dari `confirmUniqueHandover()` karena RPC
// menulis bukti + rincian sekaligus; yang diperiksa di sini adalah apakah
// masih ada dokumen LAIN yang belum diserahkan pada penerimaan yang sama.
// Mengembalikan `{ ok, others, warning }` — tidak pernah menghapus bukti.
export async function verifyAfterConfirm({ handover, client } = {}) {
  if (!handover || !handover.receiving_id) return { ok: true, others: 0, warning: '' }
  const res = await loadReceivingHandovers(handover.receiving_id, { client })
  if (!res.ok) {
    return {
      ok: false,
      others: 0,
      warning:
        `Serah terima tersimpan, tetapi pemeriksaan ulang gagal (${res.error}). ` +
        'Periksa daftar Serah Terima: pastikan tidak ada dokumen lain yang belum diserahkan untuk penerimaan ini.'
    }
  }
  const others = activeDocumentsFor(handover.receiving_id, res.rows)
    .filter(r => String(r.id) !== String(handover.id))
  if (!others.length) return { ok: true, others: 0, warning: '' }
  return {
    ok: true,
    others: others.length,
    warning:
      `Serah terima tersimpan, tetapi penerimaan yang sama masih punya ${others.length} dokumen lain ` +
      'yang belum diserahkan. Dokumen lain itu DITOLAK untuk dikonfirmasi (sisa dokumen ganda) — ' +
      'hapus dokumen tersebut (belum punya bukti) supaya tidak ada yang mencatat barang yang sama dua kali.'
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
