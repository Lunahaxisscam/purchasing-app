// ============================================================
// modules/handovers/actions.js — TULIS DB UNTUK DISTRIBUSI FISIK
// ============================================================
// Tiga aksi: kirim ke gudang, kirim ke tukang, tandai diserahkan.
// Semua fungsi mengembalikan { ok, message } — tidak melempar exception ke UI.
//
// CATATAN SKEMA (dibekukan, tidak ada kolom baru):
//   handovers.diserahkan_at / received_by / status
//   receivings.masuk_gudang / tukang_at
//   pr_items.status  (ORDERED|APPROVED|RECEIVED|DI_GUDANG|DI_TUKANG)
//
// EFEK TIDAK DIINGINKAN YANG DIJAGA:
//   - stok materials TIDAK diubah dari sini (gudang punya alurnya sendiri);
//   - aksi idempoten: bila state sudah sesuai, tidak menulis ulang.
// ============================================================

import { supabase } from '../../lib/supabaseClient'
import { ACT_GUDANG, ACT_TUKANG, ACT_TERIMA, targetStatusForAction } from './logic'

function nowIso() {
  return new Date().toISOString()
}

function ok(message) {
  return { ok: true, message }
}

function fail(message) {
  return { ok: false, message }
}

// Ambil nota (receiving) + item-item nota untuk satu handover.
async function loadContext(handoverId) {
  const { data: ho, error: hoErr } = await supabase
    .from('handovers')
    .select('id, receiving_id, diserahkan_at')
    .eq('id', handoverId)
    .maybeSingle()
  if (hoErr) return { error: hoErr.message }
  if (!ho) return { error: 'Handover tidak ditemukan.' }

  let receiving = null
  let items = []
  if (ho.receiving_id) {
    const rec = await supabase.from('receivings').select('id, masuk_gudang, tukang_at, alokasi').eq('id', ho.receiving_id).maybeSingle()
    if (rec.error) return { error: rec.error.message }
    receiving = rec.data || null

    const ri = await supabase.from('receiving_items').select('id, pr_item_id').eq('receiving_id', ho.receiving_id)
    if (ri.error) return { error: ri.error.message }
    items = ri.data || []
  }
  return { handover: ho, receiving, items }
}

// Ambil pr_items milik nota ini (untuk set status distribusi).
async function loadPrItems(items) {
  const ids = [...new Set((items || []).map(i => i.pr_item_id).filter(Boolean))]
  if (!ids.length) return { prItems: [] }
  const { data, error } = await supabase.from('pr_items').select('id, status').in('id', ids)
  if (error) return { error: error.message }
  return { prItems: data || [] }
}

// ------------------------------------------------------------
// AKSI 1 — KIRIM KE GUDANG
// ------------------------------------------------------------
// Tanda nota sudah masuk gudang dan angkat status item menjadi DI_GUDANG.
export async function kirimKeGudang(handoverId) {
  try {
    const ctx = await loadContext(handoverId)
    if (ctx.error) return fail(ctx.error)

    if (ctx.receiving && !ctx.receiving.masuk_gudang) {
      const { error } = await supabase.from('receivings').update({ masuk_gudang: true }).eq('id', ctx.receiving.id)
      if (error) return fail(error.message)
    }

    const { prItems, error: prErr } = await loadPrItems(ctx.items)
    if (prErr) return fail(prErr)

    const target = targetStatusForAction(ACT_GUDANG)
    const pending = prItems.filter(p => p.status !== target)
    if (pending.length) {
      const { error } = await supabase.from('pr_items').update({ status: target }).in('id', pending.map(p => p.id))
      if (error) return fail(error.message)
    }

    return ok(pending.length ? `${pending.length} barang ditandai masuk gudang.` : 'Semua barang sudah tercatat masuk gudang.')
  } catch (err) {
    return fail(err.message)
  }
}

// ------------------------------------------------------------
// AKSI 2 — KIRIM KE TUKANG
// ------------------------------------------------------------
// Catat waktu pengiriman ke tukang pada nota + status item DI_TUKANG.
export async function kirimKeTukang(handoverId) {
  try {
    const ctx = await loadContext(handoverId)
    if (ctx.error) return fail(ctx.error)

    if (ctx.receiving && !ctx.receiving.tukang_at) {
      const { error } = await supabase.from('receivings').update({ tukang_at: nowIso() }).eq('id', ctx.receiving.id)
      if (error) return fail(error.message)
    }

    const { prItems, error: prErr } = await loadPrItems(ctx.items)
    if (prErr) return fail(prErr)

    const target = targetStatusForAction(ACT_TUKANG)
    const pending = prItems.filter(p => p.status !== target)
    if (pending.length) {
      const { error } = await supabase.from('pr_items').update({ status: target }).in('id', pending.map(p => p.id))
      if (error) return fail(error.message)
    }

    return ok(pending.length ? `${pending.length} barang dikirim ke tukang.` : 'Semua barang sudah tercatat dikirim ke tukang.')
  } catch (err) {
    return fail(err.message)
  }
}

// ------------------------------------------------------------
// AKSI 3 — TANDAI DISERAHKAN
// ------------------------------------------------------------
// Isi diserahkan_at + status CONFIRMED. Bukti fisik penyerahan diterima.
export async function tandaiDiserahkan(handoverId, { receivedBy = '' } = {}) {
  try {
    const ctx = await loadContext(handoverId)
    if (ctx.error) return fail(ctx.error)
    if (ctx.handover.diserahkan_at) return ok('Handover ini sudah ditandai diserahkan sebelumnya.')

    const patch = {
      diserahkan_at: nowIso(),
      status: 'CONFIRMED'
    }
    const nama = String(receivedBy || '').trim()
    if (nama) patch.received_by = nama

    const { error } = await supabase.from('handovers').update(patch).eq('id', handoverId)
    if (error) return fail(error.message)

    return ok('Handover ditandai sudah diserahkan.')
  } catch (err) {
    return fail(err.message)
  }
}

// Pemetaan aksi -> fungsi. UI memanggil runHandoverAction(action, id, opts).
const RUNNERS = {
  [ACT_GUDANG]: (id) => kirimKeGudang(id),
  [ACT_TUKANG]: (id) => kirimKeTukang(id),
  [ACT_TERIMA]: (id, opts) => tandaiDiserahkan(id, opts)
}

export async function runHandoverAction(action, handoverId, opts = {}) {
  const runner = RUNNERS[action]
  if (!runner) return fail('Aksi tidak dikenal.')
  return runner(handoverId, opts)
}
