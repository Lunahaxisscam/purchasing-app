// ============================================================
// modules/receivings/receiptSplit.js — pecah PR multi-vendor jadi
// pembelian per vendor/nota (TANPA skema baru, trace ke PR asal)
// ============================================================
// Masalah nyata: satu PR bisa memuat barang dari beberapa toko, tetapi satu
// nota/invoice hanya milik SATU vendor. Sebelumnya semua item PR masuk ke satu
// baris Purchase (dibuat RPC ensure_item_in_purchase) sehingga nota mencampur
// vendor dan harga/retur per vendor tidak bisa dicocokkan.
//
// Solusi (memakai kolom yang SUDAH ADA: receivings.vendor_id,
// purchase_request_id, delivery_note, note):
//   - kelompokkan item PR per vendor (modules/receivings/receiptEventLogic.js
//     → groupItemsByVendor)
//   - nota pertama (yang sudah ada) DIPAKAI ULANG untuk vendor pertama:
//     vendor_id + delivery_note diisi, item vendor lain DIPINDAH ke nota baru
//     (receiving_items.receiving_id) — jejak ke PR tetap via
//     purchase_request_id, jadi tidak ada data yang hilang.
//   - nota tambahan dibuat untuk vendor berikutnya (status NORMAL, qty 0).
//
// GUARD (tidak boleh mengubah histori):
//   * semua item harus quantity_received = 0 / NULL
//   * nota belum masuk gudang / belum ke tukang / bukan nota kendala
//   * bila ada yang sudah bergerak → tolak dengan alasan jujur
// Idempoten: bila nota untuk (PR, vendor) sudah ada, grup itu DILEWATI.
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { groupItemsByVendor, splitBlockReason } from './receiptEventLogic'

const SPLIT_TAG = '[split-vendor]'

export function buildSplitPlan({ receiving, items, prItems, vendors = [], projectName = '' }) {
  const block = splitBlockReason(receiving, items)
  if (block) return { ok: false, reason: block }
  if (!receiving?.purchase_request_id) {
    return { ok: false, reason: 'Nota ini tidak terhubung ke PR — pemecahan per vendor hanya untuk nota hasil PR.' }
  }
  const byId = new Map((prItems || []).map(p => [p.id, p]))
  const vendorOf = (it) => byId.get(it.pr_item_id)?.vendor_id || null
  const groups = groupItemsByVendor(items, vendorOf)
  if (groups.length < 2) {
    return { ok: false, reason: 'Semua barang di nota ini berasal dari satu vendor (atau vendor belum diisi) — tidak perlu dipecah.' }
  }
  const vname = new Map((vendors || []).map(v => [v.id, v.name]))
  const plan = groups.map((g, idx) => {
    const label = g.vendorId ? (vname.get(g.vendorId) || 'Vendor') : 'Vendor belum ditentukan'
    const base = receiving.delivery_note || `PR ${receiving.pr_number || ''}`.trim()
    return {
      index: idx,
      vendorId: g.vendorId,
      vendorName: g.vendorId ? (vname.get(g.vendorId) || 'Vendor') : 'Vendor belum ditentukan',
      itemIds: g.items.map(it => it.id),
      items: g.items,
      deliveryNote: `${base} · ${label} ${SPLIT_TAG}`.trim(),
      existingReceivingId: idx === 0 ? receiving.id : null,
      note: `Pembelian per vendor (dipecah dari PR ${receiving.pr_number || ''}${projectName ? ' · ' + projectName : ''}). Jejak PR tetap tersimpan di purchase_request_id.`
    }
  })
  return { ok: true, plan, groups: plan.length }
}

// Eksekusi rencana. Semua langkah memakai kolom existing; bila satu langkah
// gagal, hasil sebagian dilaporkan APA ADANYA (tidak diklaim sukses).
export async function applySplitPlan({ receiving, plan, existingReceivings = [] } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  if (!plan?.length) return { ok: false, error: 'Rencana pemecahan kosong.' }
  if (plan.length < 2) return { ok: false, error: 'Minimal dua vendor untuk dipecah.' }

  const done = []
  const created = []

  // Guard ulang dari DB (bukan dari state UI): qty harus masih 0 dan nota
  // belum bergerak. Ini mencegah dua user memecah nota yang sudah diterima.
  const allItemIds = plan.flatMap(g => g.itemIds)
  try {
    const { data, error } = await supabase
      .from('receiving_items')
      .select('id, receiving_id, quantity_received')
      .in('id', allItemIds)
    if (error) return { ok: false, error: `Gagal membaca item: ${error.message}` }
    const moved = (data || []).filter(r => Number(r.quantity_received || 0) > 0)
    if (moved.length) {
      return { ok: false, error: 'Sudah ada jumlah diterima pada item nota ini — pemecahan dibatalkan (histori penerimaan tidak boleh dipindah).' }
    }
  } catch (err) {
    return { ok: false, error: `Gagal membaca item: ${err.message}` }
  }

  for (let i = 0; i < plan.length; i++) {
    const g = plan[i]
    if (!g.vendorId) {
      // Vendor belum ditentukan: jangan buat nota palsu; biarkan di nota asal.
      continue
    }
    // Idempoten: nota untuk (PR, vendor) sudah ada → lewati.
    const already = (existingReceivings || []).find(r =>
      r.purchase_request_id === receiving.purchase_request_id &&
      r.vendor_id === g.vendorId &&
      r.id !== receiving.id
    )
    let targetId = g.existingReceivingId || (already ? already.id : null)

    if (!targetId) {
      try {
        const { data, error } = await supabase.from('receivings').insert({
          purchase_request_id: receiving.purchase_request_id,
          project_id: receiving.project_id || null,
          vendor_id: g.vendorId,
          status: 'NORMAL',
          delivery_note: g.deliveryNote,
          note: g.note
        }).select()
        if (error) return { ok: false, error: `Gagal membuat nota ${g.vendorName}: ${error.message}`, done, created }
        targetId = data?.[0]?.id
        created.push({ id: targetId, vendorName: g.vendorName })
      } catch (err) {
        return { ok: false, error: `Gagal membuat nota ${g.vendorName}: ${err.message}`, done, created }
      }
    } else {
      // Nota pertama: isi vendor + label. Tidak menyentuh qty/status/histori.
      try {
        const { error } = await supabase.from('receivings').update({
          vendor_id: g.vendorId,
          delivery_note: g.deliveryNote,
          note: receiving.note && receiving.note.includes(SPLIT_TAG) ? receiving.note : `${receiving.note ? receiving.note + ' ' : ''}${g.note}`
        }).eq('id', targetId)
        if (error) return { ok: false, error: `Gagal melabeli nota ${g.vendorName}: ${error.message}`, done, created }
      } catch (err) {
        return { ok: false, error: `Gagal melabeli nota ${g.vendorName}: ${err.message}`, done, created }
      }
    }

    // Pindahkan item grup ini ke nota target (hanya yang belum diterima).
    const toMove = i === 0 ? [] : g.itemIds
    for (const itemId of toMove) {
      try {
        const { data, error } = await supabase
          .from('receiving_items')
          .update({ receiving_id: targetId })
          .eq('id', itemId)
          .or('quantity_received.eq.0,quantity_received.is.null')
          .select()
        if (error) return { ok: false, error: `Gagal memindahkan item: ${error.message}`, done, created }
        if (!Array.isArray(data) || !data.length) {
          return { ok: false, error: 'Ada item yang sudah berubah saat pemecahan — sisa item tidak dipindahkan. Periksa daftar Purchase.', done, created }
        }
      } catch (err) {
        return { ok: false, error: `Gagal memindahkan item: ${err.message}`, done, created }
      }
    }
    done.push({ ...g, receivingId: targetId })
  }

  // Readback: pastikan setiap item benar-benar berada di nota vendornya.
  try {
    const { data } = await supabase
      .from('receiving_items')
      .select('id, receiving_id')
      .in('id', plan.flatMap(g => g.itemIds))
    const map = new Map((data || []).map(r => [r.id, r.receiving_id]))
    const mismatch = plan.filter(g => g.vendorId).flatMap(g =>
      g.itemIds.filter(id => map.get(id) !== (done.find(d => d.index === g.index)?.receivingId)).map(id => ({ id, item: g.items.find(x => x.id === id)?.item_name }))
    )
    if (mismatch.length) {
      return { ok: false, error: `Readback tidak cocok untuk ${mismatch.length} item (${mismatch.map(m => m.item).join(', ')}).`, done, created }
    }
  } catch (err) {
    return { ok: false, error: `Readback gagal: ${err.message}`, done, created }
  }

  return { ok: true, done, created }
}
