// ============================================================
// modules/requests/save.js — logika simpan Purchase Request (PR)
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
// Menangani 2 jalur: EDIT PR yang ada (sinkronisasi pr_items) dan PR BARU
// (nomor atomic via RPC next_pr_number, dibuat sebagai DRAFT).
// ============================================================
import { supabase } from '../../lib/supabaseClient'

// Estimasi harga: string berformat ("1.250.000") → integer rupiah.
const priceDigits = (v) => {
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d ? Number(d) : null
}

export async function save(ctx) {
  const { form, isEdit, editRow, editItems, prItemsList, nextPrNum, say, close, refresh, setSaving } = ctx

  const summary = prItemsList.length
    ? prItemsList.map(it => `${it.qty} ${it.satuan || ''} ${it.name}`).join(', ')
    : (form.title || '—')

  // Mode EDIT: perbarui PR yang ada + sinkronkan item (tanpa membuat approval baru)
  if (isEdit) {
    const { error: upErr } = await supabase.from('purchase_requests').update({
      project_id: form.project_id || null,
      title: form.title,
      pr_number: form.pr_number,
      priority: form.priority || 'NORMAL',
      materials_summary: summary,
      notes: form.notes || form.title
    }).eq('id', editRow.id)
    if (upErr) { setSaving(false); say(upErr.message); return }

    // Sinkronkan pr_items: hapus yang dibuang (kecuali sudah diorder),
    // update item lama, dan insert item baru.
    const keptIds = prItemsList.filter(it => it.id).map(it => it.id)
    const removed = (editItems || []).filter(oi => !keptIds.includes(oi.id))
    let skipped = 0
    let itemErrMsg = ''
    for (const oi of removed) {
      if (String(oi.status || '').toUpperCase() === 'ORDERED') { skipped++; continue }
      const { error } = await supabase.from('pr_items').delete().eq('id', oi.id)
      if (error && !itemErrMsg) itemErrMsg = error.message
    }
    for (let idx = 0; idx < prItemsList.length; idx++) {
      const it = prItemsList[idx]
      if (it.id) {
        const { error } = await supabase.from('pr_items').update({
          quantity: it.qty,
          unit: it.satuan,
          supplier_category: it.supplier_category || null,
          vendor_id: it.vendor_id || null,
          estimated_price: priceDigits(it.estimated_price),
          sort_order: idx
        }).eq('id', it.id)
        if (error && !itemErrMsg) itemErrMsg = error.message
      } else {
        const { error } = await supabase.from('pr_items').insert({
          pr_id: editRow.id,
          material_id: it.material_id,
          item_name: it.name,
          kode: it.kode,
          unit: it.satuan,
          quantity: it.qty,
          status: 'PENDING_APPROVAL',
          supplier_category: it.supplier_category || null,
          vendor_id: it.vendor_id || null,
          estimated_price: priceDigits(it.estimated_price),
          sort_order: idx
        })
        if (error && !itemErrMsg) itemErrMsg = error.message
      }
    }

    setSaving(false)
    if (itemErrMsg) {
      say(`PR ${form.pr_number} diperbarui, tapi ada masalah pada item: ${itemErrMsg}`)
    } else {
      say(`Purchase Request ${form.pr_number} berhasil diperbarui (${prItemsList.length} item).${skipped ? ` ${skipped} item sudah diorder tidak ikut dihapus.` : ''}`)
    }
    close(); refresh()
    return
  }

  // PR baru dibuat sebagai DRAFT; masuk modul Approval lewat tombol ✓ Selesai.
  // Nomor PR diambil atomic dari DB (advisory lock) agar tidak dobel saat
  // dua user membuka form bersamaan; fallback ke nilai tampilan bila RPC gagal.
  let prNumberFinal = form.pr_number || nextPrNum
  {
    const { data: rpcPr, error: rpcPrErr } = await supabase.rpc('next_pr_number')
    if (!rpcPrErr && rpcPr) prNumberFinal = String(rpcPr)
  }
  const data = {
    project_id: form.project_id || null,
    title: form.title,
    pr_number: prNumberFinal,
    priority: form.priority || 'NORMAL',
    status: 'DRAFT',
    materials_summary: summary,
    notes: form.notes || form.title
  }

  const { data: insertedPR, error: prErr } = await supabase.from('purchase_requests').insert(data).select().single()
  if (prErr) {
    setSaving(false)
    say(prErr.message)
    return
  }

  if (prItemsList.length && insertedPR) {
    const itemRecords = prItemsList.map((it, idx) => ({
      pr_id: insertedPR.id,
      material_id: it.material_id,
      item_name: it.name,
      kode: it.kode,
      unit: it.satuan,
      quantity: it.qty,
      status: 'PENDING_APPROVAL',
      supplier_category: it.supplier_category || null,
      vendor_id: it.vendor_id || null,
      estimated_price: priceDigits(it.estimated_price),
      sort_order: idx
    }))
    const { error: itemErr } = await supabase.from('pr_items').insert(itemRecords)
    if (itemErr) {
      setSaving(false)
      say(`PR tersimpan, tapi gagal simpan item: ${itemErr.message}`)
      close(); refresh()
      return
    }
  }

  setSaving(false)
  say(`Purchase Request ${data.pr_number} berhasil dibuat (${prItemsList.length} item). Klik "✓ Selesai" pada baris PR untuk mengirim ke modul Approval.`)
  close()
  refresh()
}
