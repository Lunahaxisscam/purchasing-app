// ============================================================
// modules/materials/save.js — logika simpan Material
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
// Termasuk alokasi kode kategori (PLY/HPL/...) via RPC atomic + fallback DB,
// parser stok format Indonesia, dan mode EDIT (update, bukan insert).
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { prefixForCategory } from '../../lib/constants'
import { insertAndFinish } from '../shared/saveHelpers'

// Alokasi kode final saat simpan: coba RPC atomic dulu (bila fungsi DB
// tersedia), lalu fallback hitung dari data terbaru di DB.
export async function allocMaterialKode(category) {
  const prefix = prefixForCategory(category)
  try {
    const { data: rpcKode, error: rpcErr } = await supabase.rpc('next_material_kode_cat', { p_category: category })
    if (!rpcErr && rpcKode) return String(rpcKode)
  } catch (e) { /* RPC belum tersedia — lanjut fallback */ }
  const { data: allMats, error: kodeErr } = await supabase.from('materials').select('kode')
  if (kodeErr) throw new Error(kodeErr.message)
  const re = new RegExp('^' + prefix + '-(\\d+)$')
  const maxNum = (allMats || []).reduce((max, m) => {
    const match = String(m.kode || '').match(re)
    const n = match ? parseInt(match[1], 10) : NaN
    return isFinite(n) && n > max ? n : max
  }, 0)
  return prefix + '-' + String(maxNum + 1).padStart(4, '0')
}

export async function save(ctx) {
  const { form, isEdit, editRow, say, close, refresh, setSaving } = ctx

  // Kode material otomatis mengikuti KATEGORI (PLY-0001, HWF-0124, dst).
  // Kategori wajib dipilih supaya kode tidak jatuh ke prefix cadangan.
  if (!form.category) {
    setSaving(false)
    say('Pilih Kategori dulu — kode material dibuat dari kategori.')
    return
  }
  let newKode = (isEdit && (editRow?.kode || editRow?.code)) || ''
  if (!newKode) {
    try {
      newKode = await allocMaterialKode(form.category)
    } catch (err) {
      setSaving(false)
      say(`Gagal membuat kode material: ${err.message}`)
      return
    }
  }
  // Acuan harga disimpan sebagai INTEGER rupiah (bukan desimal) supaya
  // round-trip edit tidak pernah menggeser nilai; kosong = null.
  const hargaDigits = String(form.harga_acuan ?? '').replace(/[^\d]/g, '').slice(0, 15)
  // Sprint 1 — stok BHP: current_stock & min_stock numeric (>= 0).
  // Parser format Indonesia: '1.234,5' / '1234,5' / '1.234' → angka benar.
  // (Input type=text agar tidak dinormalisasi browser — fix review F3.)
  const stokNum = (v) => {
    const s = String(v ?? '').trim()
    if (!s) return 0
    // Buang titik ribuan, ganti koma desimal → titik; hanya digit/titik.
    const cleaned = s.replace(/\./g, '').replace(',', '.')
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return 0
    const n = Number(cleaned)
    return isFinite(n) && n >= 0 ? n : 0
  }
  const data = {
    name: form.name,
    category: form.category || null,
    kode: newKode,
    code: newKode,
    qty: form.qty || '0',
    satuan: form.satuan || 'Lembar',
    unit: form.satuan || 'Lembar',
    harga_acuan: hargaDigits ? Number(hargaDigits) : null,
    current_stock: stokNum(form.current_stock),
    min_stock: stokNum(form.min_stock)
  }
  // Mode EDIT material: UPDATE baris yang ada — bukan insert baru.
  // (Sebelumnya edit material ikut jatuh ke INSERT → gagal unique kode
  // atau membuat duplikat; diperbaiki di Sprint 1.)
  if (isEdit && editRow?.id) {
    const { error: upMatErr } = await supabase.from('materials').update(data).eq('id', editRow.id)
    setSaving(false)
    if (upMatErr) { say(upMatErr.message); return }
    say(`Material ${newKode} berhasil diperbarui.`)
    close(); refresh()
    return
  }

  // Insert material baru (+ retry bila kode bentrok — lihat saveHelpers).
  await insertAndFinish(ctx, { table: 'materials', data, allocMaterialKode })
}
