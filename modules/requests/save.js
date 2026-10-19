// ============================================================
// modules/requests/save.js — logika simpan Purchase Request (PR)
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
// Menangani 2 jalur: EDIT PR yang ada (sinkronisasi pr_items) dan PR BARU
// (nomor atomic via RPC next_pr_number, dibuat sebagai DRAFT).
//
// ============================================================
// t_cde1b8ad (arahan DAT) — KONTRAK SIMPAN TIDAK BERUBAH
// ============================================================
// Form PR dipangkas ke Project · Judul · Prioritas · Material · Qty ·
// Estimasi, dan pemilih toko dipindah ke modul Purchase. Konsekuensi yang
// SENGAJA dijaga di file ini:
//
//  1. `pr_items.vendor_id` dan `pr_items.supplier_category` TETAP DITULIS
//     apa adanya (termasuk nilai kosong → null). Field-nya tidak dihapus
//     dari payload: PR lama yang sudah punya rencana toko tetap utuh saat
//     diedit, dan item baru menyimpan null karena PR tidak lagi menanyakan
//     toko. TIDAK ada migrasi, TIDAK ada kolom baru.
//  2. Gate validasi vendor eligible TETAP dijalankan. Ia bukan hiasan:
//     `vendor_id` masih tersimpan, jadi kombinasi vendor ↔ kategori material
//     yang tidak sah tetap harus ditolak di service boundary. Karena gate ini
//     masih ada, kontrol vendor TIDAK boleh dihilangkan total dari form —
//     kalau dihilangkan, PR lama yang vendornya sudah tidak aktif menjadi
//     tidak bisa disimpan sama sekali (jalan buntu tanpa jalan keluar di UI).
//     Solusinya: kontrol vendor dilipat di <details> "Rencana toko (opsional)"
//     di modules/requests/form.jsx, bukan dibuang.
//  3. `purchase_requests.notes` tetap ditulis (fallback ke judul PR bila
//     catatan kosong) — catatan hanya dilipat di UI, bukan dibuang.
//  4. Toko AKTUAL (nota belanja) TIDAK pernah ditulis dari sini; itu
//     `receivings.vendor_id` milik modul Purchase. Dua konsep ini sengaja
//     dipisah supaya "rencana toko" di PR tidak pernah diklaim sebagai
//     supplier aktual (lihat docs/pr-estimasi-policy.md).
// ============================================================
import { supabase } from '../../lib/supabaseClient'
// ============================================================
// VALIDASI ESTIMASI & KELAYAKAN (t_ac0b39c0) — SERVICE BOUNDARY, bukan UI-only
// ============================================================
// Validasi harga/qty nonnegative & finite (tidak NaN) + vendor eligible
// dijalankan di sini (save), bukan cuma di form. Resolver & aturan kelayakan
// SATU SUMBER: modules/requests/estimator.js (resolver acuan sama dgn modul
// Material, t_090127ad).
import { isVendorEligible } from './estimator'
import { composeNotesWithMarkers } from './leanRequest'

// Harga valid utk simpan: nonnegative, finite. Tanda minus/parenthesis
// ditolak EKSPLISIT ('-5' tidak boleh diam-diam jadi 5). Hasil null =
// tidak ada harga (bukan nol).
function validatedPrice(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.round(v) : NaN
  const raw = String(v)
  if (/[-(]/.test(raw)) return NaN
  const digits = raw.replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

// Qty valid utk simpan: finite & > 0. Return NaN bila invalid.
function validatedQty(q) {
  const n = Number(q)
  return isFinite(n) && n > 0 ? n : NaN
}

export async function save(ctx) {
  const { form, isEdit, editRow, editItems, prItemsList, nextPrNum, allMaterials, allVendors, say, close, refresh, setSaving } = ctx

  const summary = prItemsList.length
    ? prItemsList.map(it => `${it.qty} ${it.satuan || ''} ${it.name}`).join(', ')
    : (form.title || '—')

  // ============================================================
  // GATE VALIDASI ITEM (t_ac0b39c0): harga/qty nonnegatif & finite, dan
  // vendor eligible terhadap kategori KANONIK master material. Validasi
  // di service boundary — UI hanya lapisan pertama.
  // ============================================================
  const problems = []
  for (const it of prItemsList) {
    const label = it.name || it.kode || 'item'
    if (Number.isNaN(validatedQty(it.qty))) {
      problems.push(`Qty "${label}" harus angka lebih dari 0.`)
    }
    const p = validatedPrice(it.estimated_price)
    if (Number.isNaN(p)) {
      problems.push(`Estimasi harga "${label}" tidak valid (negatif / bukan angka).`)
    }
    if (it.vendor_id) {
      const v = (allVendors || []).find(x => x.id === it.vendor_id)
      if (v) {
        const mat = (allMaterials || []).find(m => m.id === it.material_id)
        if (mat && !isVendorEligible(v, mat.category || '')) {
          problems.push(
            `Vendor "${v.name}" untuk "${label}" tidak aktif pada kategori material ` +
            `"${mat.category || '—'}" — aktifkan kategori itu di modul Vendor, atau pilih vendor lain.`
          )
        }
      }
    }
  }
  if (problems.length) {
    setSaving(false)
    say(`PR belum bisa disimpan: ${problems.join(' ')}`)
    return
  }

  // Mode EDIT: perbarui PR yang ada + sinkronkan item (tanpa membuat approval baru)
  if (isEdit) {
    const { error: upErr } = await supabase.from('purchase_requests').update({
      project_id: form.project_id || null,
      title: form.title,
      pr_number: form.pr_number,
      priority: form.priority || 'NORMAL',
      materials_summary: summary,
      // t_a5a73034: penanda jalur ([Jalur: LEAN], [Tutup: …]) yang sudah
      // tersimpan DIPERTAHANKAN saat admin mengedit catatan — kalau dibuang,
      // request akan berubah klasifikasi jadi "Submitted lama" dan sisa
      // kebutuhan yang sudah ditutup terbuka lagi.
      notes: composeNotesWithMarkers(form.notes || form.title, editRow.notes)
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
          estimated_price: validatedPrice(it.estimated_price),
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
          estimated_price: validatedPrice(it.estimated_price),
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
      estimated_price: validatedPrice(it.estimated_price),
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
  say(`Purchase Request ${data.pr_number} berhasil dibuat (${prItemsList.length} item). Klik "✓ Selesai & Kirim" pada baris PR untuk mengirimnya ke daftar kebutuhan siap dibeli (tanpa approval).`)
  close()
  refresh()
}
