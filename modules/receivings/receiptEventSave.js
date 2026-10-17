// ============================================================
// modules/receivings/receiptEventSave.js — tulis ledger penerimaan via RPC
// ============================================================
// SATU jalur tulis untuk dimensi per barang (datang/rusak/tujuan/retur):
//   supabase.rpc('receipt_apply_events', { p_receiving_id, p_events, p_meta })
// Tidak pernah insert/update tabel ledger langsung dari client (RLS: tanpa
// policy tulis). Lihat docs/receiving-events-contract.md §2.1.
//
// Mode LEGACY (skema belum ada): fungsi ini TIDAK dipanggil; form tetap
// memblokir submit dengan pesan gap dan nol tulisan (perilaku sekarang).
//
// Idempotensi: client_event_id deterministik (receiptEventLogic) + RPC
// memakai ON CONFLICT DO NOTHING → submit ganda / retry / dua user aman.
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { validateEventDrafts } from './receiptEventLogic'

// Panggil RPC. `drafts` = hasil buildEventDrafts (sudah divalidasi UI).
// Mengembalikan { ok, applied, alreadyApplied, eventIds, totals, error }.
export async function applyReceiptEvents({ receiving, drafts, meta = {}, sisaById = {} } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  if (!receiving?.id) return { ok: false, error: 'Data penerimaan tidak dikenal.' }
  const list = Array.isArray(drafts) ? drafts : []
  if (!list.length) return { ok: false, error: 'Tidak ada jumlah datang yang diisi.' }

  const v = validateEventDrafts(list, { sisaById })
  if (!v.ok) return { ok: false, error: v.errors[0], errors: v.errors }

  // Buang field internal (_computed) — payload hanya kolom kontrak.
  const payload = list.map(({ _computed, ...rest }) => rest)

  try {
    const { data, error } = await supabase.rpc('receipt_apply_events', {
      p_receiving_id: receiving.id,
      p_events: payload,
      p_meta: meta || {}
    })
    if (error) {
      // Pesan RPC diteruskan apa adanya (mis. over_receipt) — jangan ditelan.
      return { ok: false, error: error.message, code: error.code || null }
    }
    if (!data || data.ok === false) {
      return { ok: false, error: (data && data.error) || 'RPC penerimaan menolak permintaan.', reason: data?.reason || null, data }
    }
    return {
      ok: true,
      applied: data.applied ?? payload.length,
      alreadyApplied: data.already_applied ?? 0,
      eventIds: data.event_ids || [],
      totals: data.item_totals || [],
      raw: data
    }
  } catch (err) {
    return { ok: false, error: `Gagal menyimpan penerimaan: ${err.message}` }
  }
}

// Konfirmasi fisik serah terima per item (RPC handover_confirm).
// BUKAN auto-confirm: hanya dipanggil dari aksi eksplisit user.
export async function confirmHandoverLines({ handover, lines } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  if (!handover?.id) return { ok: false, error: 'Data serah terima tidak dikenal.' }
  const list = Array.isArray(lines) ? lines : []
  if (!list.length) return { ok: false, error: 'Tidak ada barang yang diserahkan.' }
  try {
    const { data, error } = await supabase.rpc('handover_confirm', {
      p_handover_id: handover.id,
      p_lines: list
    })
    if (error) return { ok: false, error: error.message }
    if (!data || data.ok === false) return { ok: false, error: (data && data.error) || 'RPC serah terima menolak permintaan.', data }
    return { ok: true, already: !!data.already, inserted: data.inserted ?? list.length, diserahkanAt: data.diserahkan_at || null, raw: data }
  } catch (err) {
    return { ok: false, error: `Gagal menyimpan serah terima: ${err.message}` }
  }
}

// Retur dari event rusak (RPC return_create) — TANPA mengetik ulang item/qty.
export async function createReturnCase({ receiving, lines, resolution = 'RETURN', reason = '' } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  if (!receiving?.id) return { ok: false, error: 'Data penerimaan tidak dikenal.' }
  const list = (Array.isArray(lines) ? lines : []).filter(l => Number(l.qty) > 0)
  if (!list.length) return { ok: false, error: 'Tidak ada barang rusak yang bisa diretur.' }
  try {
    const { data, error } = await supabase.rpc('return_create', {
      p_receiving_id: receiving.id,
      p_lines: list.map(l => ({ receiving_event_id: l.receiving_event_id, qty: Number(l.qty), note: l.note || null })),
      p_resolution: resolution,
      p_reason: reason || null
    })
    if (error) return { ok: false, error: error.message }
    if (!data || data.ok === false) return { ok: false, error: (data && data.error) || 'RPC retur menolak permintaan.', data }
    return { ok: true, returnCaseId: data.return_case_id, lines: data.lines || list, raw: data }
  } catch (err) {
    return { ok: false, error: `Gagal menyimpan retur: ${err.message}` }
  }
}

// Baca event + turunan untuk satu penerimaan (read-only).
export async function loadReceivingEvents({ receivingId } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.', events: [] }
  if (!receivingId) return { ok: false, error: 'Penerimaan tidak dikenal.', events: [] }
  try {
    const { data, error } = await supabase
      .from('receiving_events')
      .select('id, receiving_id, receiving_item_id, pr_item_id, item_name, unit, qty_datang, qty_rusak, tujuan_ws, tujuan_tukang, penerima_tukang, retur_status, retur_qty, discard_confirmed, created_at')
      .eq('receiving_id', receivingId)
      .order('created_at', { ascending: true })
    if (error) return { ok: false, error: error.message, events: [] }
    return { ok: true, events: data || [] }
  } catch (err) {
    return { ok: false, error: err.message, events: [] }
  }
}

// Baca baris serah terima (untuk prefill "sisa belum diserahkan").
export async function loadHandoverItems({ handoverId } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.', items: [] }
  if (!handoverId) return { ok: false, error: 'Handover tidak dikenal.', items: [] }
  try {
    const { data, error } = await supabase
      .from('handover_items')
      .select('id, handover_id, receiving_event_id, receiving_item_id, pr_item_id, item_name, qty_diserahkan, satuan, penerima, catatan, created_at')
      .eq('handover_id', handoverId)
    if (error) return { ok: false, error: error.message, items: [] }
    return { ok: true, items: data || [] }
  } catch (err) {
    return { ok: false, error: err.message, items: [] }
  }
}

// Total qty yang SUDAH diserahkan per event penerimaan (LINTAS semua handover
// dari penerimaan itu) — dipakai menghitung sisa supaya tidak dobel hitung
// ketika satu penerimaan diserahkan bertahap lewat beberapa dokumen.
export async function loadDeliveredByEvent({ eventIds = [] } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.', delivered: {} }
  const ids = (eventIds || []).filter(Boolean)
  if (!ids.length) return { ok: true, delivered: {} }
  try {
    const { data, error } = await supabase
      .from('handover_items')
      .select('receiving_event_id, qty_diserahkan')
      .in('receiving_event_id', ids)
    if (error) return { ok: false, error: error.message, delivered: {} }
    const delivered = {}
    for (const row of data || []) {
      const k = row.receiving_event_id
      if (!k) continue
      delivered[k] = (delivered[k] || 0) + Number(row.qty_diserahkan || 0)
    }
    return { ok: true, delivered }
  } catch (err) {
    return { ok: false, error: err.message, delivered: {} }
  }
}
