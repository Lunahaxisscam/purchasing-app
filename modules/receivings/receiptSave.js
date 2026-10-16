// ============================================================
// modules/receivings/receiptSave.js — simpan satu kali dari form Terima Barang
// ============================================================
// Menyimpan penerimaan ke skema yang ADA (tanpa migrasi):
//   receiving_items.quantity_received = kumulatif baru (prevCum + datang)
//   receivings.received_date diisi bila masih kosong.
//
// ANTI DOBEL / IDEMPOTEN (arahan DAT: "penerimaan berulang & retry aman"):
//   1) Form mengirim SNAPSHOT kumulatif (prevCum) saat form dibuka.
//   2) Sebelum menulis, semua baris dibaca ulang (pre-check).
//   3) Setiap update memakai compare-and-swap: WHERE id = ? AND
//      quantity_received = prevCum (baris NULL dianggap 0). Kalau angka sudah
//      berubah (submit ganda / user lain), update mengenai 0 baris ->
//      dilaporkan sebagai konflik, TIDAK menambah/menimpa angka apa pun.
//   4) Validasi penuh terjadi SEBELUM fungsi ini dipanggil — penolakan input
//      invalid tidak pernah menghasilkan tulisan sebagian.
//
// loadItemsFromPr: nota lama (dibuat via form manual) sering TIDAK punya
// baris receiving_items (bukti audit t_905e0e5a A1: 3 dari 4 nota live).
// Aksi eksplisit "Muat item dari PR" menambahkan baris item qty 0 dari
// pr_items milik PR terkait — memakai tabel yang SUDAH ADA, tanpa migrasi.
// Duplikat (unique index receiving_id+pr_item_id) diperlakukan aman.
// ============================================================
import { supabase } from '../../lib/supabaseClient'

export async function saveReceipt({ receiving, plan, today } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  if (!receiving?.id) return { ok: false, error: 'Data penerimaan tidak dikenal.' }
  const rows = Array.isArray(plan) ? plan : []
  if (!rows.length) return { ok: false, error: 'Tidak ada jumlah yang diisi.' }

  const ids = rows.map(p => p.itemId)

  // --- 1) Pre-check: snapshot masih sama dengan DB? ---
  let current = null
  try {
    const { data, error } = await supabase
      .from('receiving_items')
      .select('id, quantity_received')
      .in('id', ids)
    if (error) return { ok: false, error: `Gagal membaca item: ${error.message}` }
    current = data || []
  } catch (err) {
    return { ok: false, error: `Gagal membaca item: ${err.message}` }
  }
  const byId = new Map(current.map(r => [r.id, Number(r.quantity_received || 0)]))
  const conflicts = rows.filter(p => {
    const now = byId.has(p.itemId) ? byId.get(p.itemId) : null
    return now !== p.prevCum
  })
  if (conflicts.length) {
    return {
      ok: false,
      reason: 'conflict',
      conflicts,
      error: `Jumlah item berubah sejak form dibuka (${conflicts.map(c => c.itemName).join(', ')}). Tidak ada yang disimpan — buka ulang form Terima Barang lalu ulangi.`
    }
  }

  // --- 2) Compare-and-swap per item (satu payload = satu submit) ---
  const updated = []
  for (const p of rows) {
    let res
    try {
      let q = supabase
        .from('receiving_items')
        .update({ quantity_received: p.newCum })
        .eq('id', p.itemId)
      // prevCum 0 cocokkan baris 0 ATAU NULL (data lama bisa NULL).
      q = p.prevCum === 0
        ? q.or('quantity_received.eq.0,quantity_received.is.null')
        : q.eq('quantity_received', p.prevCum)
      res = await q.select()
    } catch (err) {
      return { ok: false, reason: 'error', updated, error: `Gagal menyimpan "${p.itemName}": ${err.message}` }
    }
    const { data, error } = res || {}
    if (error) return { ok: false, reason: 'error', updated, error: `Gagal menyimpan "${p.itemName}": ${error.message}` }
    if (!Array.isArray(data) || data.length === 0) {
      return {
        ok: false,
        reason: 'conflict',
        updated,
        conflicts: [p],
        error: `Jumlah "${p.itemName}" berubah saat menyimpan. Item sebelumnya yang sudah tersimpan tetap tercatat; buka ulang form lalu ulangi untuk sisa item.`
      }
    }
    updated.push(p)
  }

  // --- 3) Tgl terima nota bila belum pernah diisi (tidak menimpa tanggal lama) ---
  let dateFilled = false
  if (!receiving.received_date) {
    const tgl = today || new Date().toISOString().slice(0, 10)
    try {
      const { error } = await supabase.from('receivings').update({ received_date: tgl }).eq('id', receiving.id)
      if (!error) dateFilled = true
    } catch (err) { /* tanggal opsional — jangan gagalkan penerimaan yang sudah tersimpan */ }
  }

  return { ok: true, updated, dateFilled }
}

// Aksi eksplisit untuk nota lama tanpa rincian item: salin item dari PR.
// qty 0 (belum diterima) — pengguna mengisi jumlah datang di form setelahnya.
export async function loadItemsFromPr({ receiving, prItems, existingItems } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  if (!receiving?.id) return { ok: false, error: 'Data penerimaan tidak dikenal.' }
  if (!receiving.purchase_request_id) {
    return { ok: false, error: 'Nota ini tidak terhubung ke PR — rincian item tidak bisa dimuat otomatis. Hubungi admin untuk melengkapi.' }
  }
  const have = new Set((existingItems || []).map(it => it.pr_item_id).filter(Boolean))
  const toAdd = (prItems || []).filter(it => it.id && !have.has(it.id))
  if (!toAdd.length) return { ok: true, added: 0, already: true }

  let added = 0
  for (const it of toAdd) {
    const row = {
      receiving_id: receiving.id,
      pr_item_id: it.id,
      item_name: it.item_name || it.kode || 'Item',
      unit: it.unit || 'Pcs',
      quantity_received: 0
    }
    try {
      const { error } = await supabase.from('receiving_items').insert(row)
      if (error) {
        // 23505 = baris sudah ada (balapan/duplikat) — aman, lewati.
        if (String(error.code) === '23505') continue
        return { ok: false, added, error: `Gagal memuat item "${row.item_name}": ${error.message}` }
      }
      added++
    } catch (err) {
      return { ok: false, added, error: `Gagal memuat item "${row.item_name}": ${err.message}` }
    }
  }
  return { ok: true, added }
}
