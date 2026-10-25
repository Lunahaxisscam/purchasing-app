// ============================================================
// modules/shared/saveHelpers.js — helper simpan lintas modul
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
// Berisi: retry unique-index (23505) + ekor insert generik (pesan sukses).
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { labels } from '../../lib/constants'

// Retry sekali bila kode/nomor bentrok (unique index) karena balapan sesi lain:
// ambil nomor baru dari RPC atomic, lalu insert ulang.
export async function insertWithRetry({ table, page, data, form, allocMaterialKode }) {
  let { error } = await supabase.from(table).insert(data)
  if (error && String(error.code) === '23505') {
    let retryKode = null
    if (page === 'materials') {
      try { retryKode = await allocMaterialKode(form.category) } catch (e) { retryKode = null }
      if (retryKode) data = { ...data, kode: retryKode, code: retryKode }
    } else if (page === 'requests') {
      const { data: rp } = await supabase.rpc('next_pr_number')
      if (rp) data = { ...data, pr_number: String(rp) }
    }
    if (retryKode || page === 'requests') {
      const retry = await supabase.from(table).insert(data)
      error = retry.error
    }
  }
  return { error, data }
}

// Ekor insert generik: simpan → matikan loading → pesan sukses → tutup + refresh.
// Diekstrak VERBATIM dari CreateModal.save() (blok penutup).
export async function insertAndFinish(ctx, { table, data, allocMaterialKode = null }) {
  const { page, form, say, close, refresh, setSaving } = ctx
  const { error } = await insertWithRetry({ table, page, data, form, allocMaterialKode })
  setSaving(false)
  if (error) {
    say(error.message)
    return
  }
  say(`${labels[page]} berhasil ditambahkan.`)
  close()
  refresh()
}
