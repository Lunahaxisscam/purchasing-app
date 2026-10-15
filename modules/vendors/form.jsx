// ============================================================
// modules/vendors/form.jsx — form Tambah/Edit Vendor
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/CreateModal.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Field form {label} diubah
// HANYA di file ini.
//
// Kontrak: formBody(ctx) mengembalikan potongan JSX (fragment) yang dirender
// shell CreateModal. ctx berisi form, setForm, field, isEdit, editRow, dst.
// yang disediakan shell — lihat components/CreateModal.js.
//
// CATATAN Fase 2 (belum dikerjakan): logika simpan (save) per modul masih di
// shell CreateModal; pemindahannya direncanakan terpisah agar tidak
// mencampur refactor struktur dengan perubahan perilaku.
// ============================================================
import React from 'react'

export function formBody(ctx) {
  const { form, setForm, field, materialCategories } = ctx
  return (
    <>
      {field('name', 'Nama Vendor', 'text', true)}
      {field('phone', 'Kontak WA (No. WhatsApp)', 'text', false)}
      {field('store_link', 'Link Toko (URL)', 'text', false)}
      <label>Kategori Material yang Disuplai Vendor Ini
        <select value={form.supplier_category || ''} onChange={e => setForm({ ...form, supplier_category: e.target.value })}>
          <option value="">-- Pilih Kategori --</option>
          {materialCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      {field('contact', 'Kontak / Email (opsional)', 'text', false)}
    </>
  )
}
