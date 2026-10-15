// ============================================================
// modules/handovers/form.jsx — form Tambah/Edit Handover
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
  const { form, setForm, field, allReceivings, allProjects } = ctx
  return (
    <>
      <label>Penerimaan (Purchase)
        <select
          value={form.receiving_id || ''}
          onChange={e => {
            const rec = (allReceivings || []).find(r => r.id === e.target.value)
            setForm({ ...form, receiving_id: e.target.value, project_id: rec?.project_id || form.project_id })
          }}
          required
        >
          <option value="">-- Pilih Penerimaan --</option>
          {(allReceivings || []).map(r => (
            <option key={r.id} value={r.id}>
              {r.invoice_no || r.delivery_note || 'Penerimaan'} — {r.project_name || ''}
            </option>
          ))}
        </select>
      </label>
      <label>Project (otomatis dari penerimaan, bisa diubah)
        <select
          value={form.project_id}
          onChange={e => setForm({ ...form, project_id: e.target.value })}
          required
        >
          <option value="">-- Pilih Project --</option>
          {allProjects.map(p => (
            <option key={p.id} value={p.id}>
              {p.kode ? `[${p.kode}] ` : ''}{p.name}
            </option>
          ))}
        </select>
      </label>
      {field('received_by', 'Diterima Oleh (Mandor / Tukang Lapangan)', 'text', true)}
      <label>Status Serah Terima
        <select value={form.handover_status || 'CONFIRMED'} onChange={e => setForm({ ...form, handover_status: e.target.value })}>
          <option value="CONFIRMED">CONFIRMED (Sudah Diserahkan)</option>
          <option value="DRAFT">DRAFT</option>
        </select>
      </label>
      {field('handover_date', 'Tanggal Serah Terima', 'date', false)}
      {field('notes', 'Catatan Serah Terima', 'text', false)}
    </>
  )
}
