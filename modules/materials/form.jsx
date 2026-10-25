// ============================================================
// modules/materials/form.jsx — form Tambah/Edit Material
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
  const { form, setForm, field, materialCategories, isEdit, editRow, nextMatKodeFor, formatNominalInput } = ctx
  return (
    <>
      <label>Kategori
        <select
          required
          value={form.category || ''}
          onChange={e => setForm({ ...form, category: e.target.value })}
        >
          <option value="">-- Pilih Kategori --</option>
          {materialCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>Kode Material (otomatis dari kategori)
        <input
          type="text"
          value={isEdit ? (editRow?.kode || editRow?.code || '') : (form.category ? nextMatKodeFor(form.category) : '— pilih kategori dulu —')}
          readOnly
          disabled
          style={{ background: '#f1f5f3', color: '#5b6b66', fontWeight: 600, cursor: 'not-allowed' }}
        />
      </label>
      {isEdit && (
        <small style={{ color: '#5b6b66', marginTop: '-6px' }}>
          Kode dibuat sekali saat material dibuat — mengubah kategori tidak mengubah kode.
        </small>
      )}
      {field('name', 'Nama Material', 'text', true)}
      {field('qty', 'Qty', 'number', false)}
      <label>Satuan
        <select value={form.satuan || 'Lembar'} onChange={e => setForm({ ...form, satuan: e.target.value })}>
          <option value="Lembar">Lembar</option>
          <option value="Batang">Batang</option>
          <option value="Kaleng">Kaleng</option>
          <option value="Roll">Roll</option>
          <option value="Meter">Meter</option>
          <option value="Pcs">Pcs</option>
          <option value="Box">Box</option>
          <option value="Set">Set</option>
          <option value="Botol">Botol</option>
          <option value="Blek">Blek</option>
          <option value="Kg">Kg</option>
          <option value="Liter">Liter</option>
          <option value="Pasang">Pasang</option>
          <option value="Kotak">Kotak</option>
          <option value="Bungkus">Bungkus</option>
        </select>
      </label>
      <label>Acuan Harga (Rp)
        <input
          type="text"
          inputMode="numeric"
          placeholder="Contoh: 250.000"
          value={form.harga_acuan || ''}
          onChange={e => setForm({ ...form, harga_acuan: formatNominalInput(e.target.value) })}
        />
      </label>
      {/* Sprint 1 — Minimum Stock BHP. Opsional untuk kategori umum;
          sangat dianjurkan untuk Bahan Habis Pakai (badge merah muncul
          bila stok saat ini <= batas minimum).
          type=text + format koma (bukan type=number) supaya desimal
          '1,5' tidak hilang dinormalisasi browser (fix review F3). */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <label>Stok Saat Ini
          <input
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={form.current_stock ?? ''}
            onChange={e => setForm({ ...form, current_stock: e.target.value.replace(/[^\d.,]/g, '').slice(0, 15) })}
          />
        </label>
        <label>Batas Minimum Stok
          <input
            type="text"
            inputMode="decimal"
            placeholder="0 = nonaktif"
            value={form.min_stock ?? ''}
            onChange={e => setForm({ ...form, min_stock: e.target.value.replace(/[^\d.,]/g, '').slice(0, 15) })}
          />
        </label>
      </div>
      {(String(form.category || '').toLowerCase() === 'bahan habis pakai' || /^BHP/i.test(String(editRow?.kode || ''))) && (
        <small style={{ color: '#a15309', marginTop: '-6px', fontWeight: 600 }}>
          ⚠️ Bahan Habis Pakai: isi <b>Batas Minimum Stok</b> supaya sistem menampilkan badge 🔴 Stok Menipis saat stok menipis.
        </small>
      )}
    </>
  )
}
