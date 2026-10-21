// ============================================================
// modules/handovers/save.js — logika simpan Handover
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
// REVISI t_b418827b (arahan DAT):
//  - Mode EDIT hanya menyimpan METADATA: Diterima Oleh, Tanggal Serah Terima,
//    Foto bukti, Catatan. `receiving_id` / `project_id` / `status` /
//    `diserahkan_at` TIDAK PERNAH dibaca dari form saat edit — selalu
//    dipertahankan dari baris (editRow) supaya payload tampering tidak bisa
//    memindah proyek/source, mengosongkan FK, atau mengubah status (G5).
//  - Status TIDAK lagi bisa di-set dari form. Handover baru masuk antrean
//    "Belum Diserahkan" (status DRAFT); "Sudah Diserahkan" hanya lewat aksi
//    konfirmasi fisik eksplisit (modules/handovers/confirm.js) yang menulis
//    `diserahkan_at`. Jangan klaim CONFIRMED hanya karena alokasi dipilih.
//  - Foto bukti OPSIONAL (koreksi DAT 16 Okt): tidak memblokir simpan.
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { buildHandoverNote, parseHandoverNote, dataUrlByteSize, HANDOVER_FOTO_MAX_BYTES } from '../../lib/constants'
import { createActiveHandover } from './createHandover'

export async function save(ctx) {
  const { form, isEdit, editRow, say, close, refresh, setSaving } = ctx

  // Bukti foto serah terima (fitur 15 Okt 2026): data-URL base64 disimpan di
  // kolom note dengan penanda [FotoBukti: …] (pola sama dengan [Nota] pada
  // penerimaan — tanpa kolom/relasi DB baru).
  // - Mode tambah: foto baru dari form.bukti_foto.
  // - Mode edit: bila field foto tidak disentuh (undefined), pertahankan foto
  //   lama dari catatan; bila dihapus user (''), jangan disertakan.
  const fotoBaru = form.bukti_foto
  const fotoLama = parseHandoverNote(editRow?.note).foto
  const foto = fotoBaru !== undefined ? String(fotoBaru || '') : fotoLama

  // Validasi akhir ukuran (byte sebenarnya dari data-URL) — jaga-jaga bila
  // file lolos dari validasi form atau data dari jalur lain.
  if (foto && /^data:/i.test(foto) && dataUrlByteSize(foto) > HANDOVER_FOTO_MAX_BYTES) {
    setSaving(false)
    say('⚠️ Bukti foto melebihi 2MB. Pilih foto yang lebih kecil lalu simpan lagi.')
    return
  }

  const note = buildHandoverNote({ foto, extra: form.notes })

  // ============================================================
  // MODE EDIT — HANYA metadata (lihat kontrak di header).
  // ============================================================
  if (isEdit && editRow?.id) {
    const data = {
      received_by: form.received_by,
      handover_date: form.handover_date || editRow?.handover_date || new Date().toISOString().slice(0, 10),
      note
    }
    // Sengaja TIDAK menyertakan receiving_id / project_id / status /
    // diserahkan_at — nilainya tetap seperti baris aslinya. Edit metadata
    // (catatan/foto) tidak mengubah quantity/stock/status/source.
    const { error } = await supabase.from('handovers').update(data).eq('id', editRow.id)
    setSaving(false)
    if (error) { say(error.message); return }
    say('Serah Terima berhasil diperbarui (metadata — status & sumber tidak berubah).')
    close(); refresh()
    return
  }

  // ============================================================
  // MODE TAMBAH — antrean "Belum Diserahkan" (DRAFT), bukan CONFIRMED.
  // ============================================================
  const receivingId = form.receiving_id || null
  if (!receivingId) {
    setSaving(false)
    say('Pilih Penerimaan (Purchase) dulu — handover harus terhubung ke penerimaan asalnya.')
    return
  }

  // ============================================================
  // DEFECT run 239 + REVIEW run 242 (BUG-V2) + REVIEW run 244 (BUG-W1)
  // DUA DOKUMEN AKTIF untuk satu penerimaan.
  // ============================================================
  // Run 239 memasang penjaga SELECT-lalu-INSERT. Review run 242 membuktikan
  // di PostgreSQL nyata bahwa dua sesi bersamaan SAMA-SAMA lolos, lalu
  // `handover_confirm` menerima KEDUANYA (kuncinya per DOKUMEN) → rincian
  // 2× kuota dan `belum_diserahkan` negatif.
  //
  // Run 243 mencoba insert → verifikasi → tarik diri sendiri. Review run 244
  // membuktikan itu TIDAK konvergen: penulis yang commit TERAKHIR melihat
  // semuanya, dan bila ia justru yang paling awal (`created_at` terkecil) ia
  // TIDAK menarik diri — penulis lain sudah selesai dan tidak pernah
  // melihatnya. Dua dokumen aktif, keduanya `ok:true`.
  //
  // Run 245: `insertUniqueActiveHandover` memakai PRIMARY KEY `handovers.id`
  // sebagai kunci slot — id diturunkan DETERMINISTIK dari
  // (receiving_id, jumlah dokumen yang terlihat), jadi dua penulis bersamaan
  // menghasilkan id yang SAMA dan database menolak yang kedua (23505).
  // Baca DB tetap dilakukan lebih dulu (pesan ramah + fail closed), tetapi
  // jaminannya berasal dari database, bukan dari pembacaan ulang.
  // Detail + batas yang diakui: header duplicateGuardDb.js dan docs §9B.
  const data = {
    receiving_id: receivingId,
    project_id: form.project_id || null,
    received_by: form.received_by,
    status: 'DRAFT',
    handover_date: form.handover_date || new Date().toISOString().slice(0, 10),
    note
  }

  // TIGA pintu create memakai SATU pembungkus: bila RPC kontrak v1 terbukti
  // ada, database yang menjamin satu dokumen aktif per penerimaan; bila belum
  // ada (LEGACY), jalur slot lama dipakai. unknown/error = ditolak (fail closed).
  const result = await createActiveHandover({ data, client: supabase })
  setSaving(false)
  if (!result.ok) {
    say(result.reason)
    return
  }
  say('Serah Terima berhasil ditambahkan.')
  close(); refresh()
}
