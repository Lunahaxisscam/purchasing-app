// ============================================================
// modules/projects/form.jsx — form Tambah/Edit Project
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
  const { form, setForm, field } = ctx
  return (
    <>
      {field('kode', 'Kode Project (Nomor)', 'text', true)}
      {field('name', 'Nama Project', 'text', true)}
      <label>Status
        <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
          <option value="NOT_START">Not Start</option>
          <option value="ON_GOING">On Going</option>
          <option value="DONE">Done</option>
        </select>
      </label>
    </>
  )
}
