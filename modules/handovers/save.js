// ============================================================
// modules/handovers/save.js — logika simpan Handover
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { buildHandoverNote, parseHandoverNote, dataUrlByteSize, HANDOVER_FOTO_MAX_BYTES } from '../../lib/constants'
import { insertAndFinish } from '../shared/saveHelpers'

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

  const data = {
    receiving_id: form.receiving_id || null,
    project_id: form.project_id || null,
    received_by: form.received_by,
    status: form.handover_status || 'CONFIRMED',
    handover_date: form.handover_date || new Date().toISOString().slice(0, 10),
    note: buildHandoverNote({ foto, extra: form.notes })
  }

  // Mode EDIT handover: UPDATE baris yang ada (termasuk catatan/foto) —
  // bukan insert baru. (Sebelumnya edit selalu jatuh ke INSERT.)
  if (isEdit && editRow?.id) {
    const { error: upErr } = await supabase.from('handovers').update(data).eq('id', editRow.id)
    setSaving(false)
    if (upErr) { say(upErr.message); return }
    say('Handover berhasil diperbarui.')
    close(); refresh()
    return
  }

  await insertAndFinish(ctx, { table: 'handovers', data })
}
