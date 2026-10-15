// ============================================================
// modules/receivings/form.jsx — form Tambah/Edit Purchase / Receiving
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
  const { form, setForm, field, allRequestsFull, allProjects, formatNominalInput } = ctx
  return (
    <>
      <label>Purchase Request (PR)
        <select
          value={form.pr_id || ''}
          onChange={e => {
            const pr = (allRequestsFull || []).find(p => p.id === e.target.value)
            setForm({ ...form, pr_id: e.target.value, project_id: pr?.project_id || form.project_id })
          }}
          required
        >
          <option value="">-- Pilih PR --</option>
          {(allRequestsFull || []).map(p => (
            <option key={p.id} value={p.id}>
              {p.pr_number} — {p.title || ''} {p.status ? `(${p.status})` : ''}
            </option>
          ))}
        </select>
      </label>
      <label>Project (otomatis dari PR, bisa diubah)
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
      {field('invoice_no', 'No. Invoice', 'text', true)}
      {field('delivery_note', 'Surat Jalan / No. PO (opsional)', 'text', false)}
      <label>Total Nominal Riil (Rp)
        <input
          type="text"
          inputMode="numeric"
          placeholder="Contoh: 450.000"
          value={form.nominal || ''}
          onChange={e => setForm({ ...form, nominal: formatNominalInput(e.target.value) })}
        />
      </label>
      <label>Foto / Link Nota Toko (URL Google Drive, link WA, foto, atau no. resi)
        <input
          type="text"
          placeholder="https://drive.google.com/… atau no. resi"
          value={form.nota_link || ''}
          onChange={e => setForm({ ...form, nota_link: e.target.value })}
        />
      </label>
      <label>Status Penerimaan
        <select value={form.receiving_status || 'NORMAL'} onChange={e => setForm({ ...form, receiving_status: e.target.value })}>
          <option value="NORMAL">✓ Normal</option>
          <option value="RETUR">⚠️ Retur</option>
          <option value="REFUND">⚠️ Refund</option>
        </select>
      </label>
      {field('received_date', 'Tanggal Diterima', 'date', false)}
      {field('notes', 'Catatan Penerimaan', 'text', false)}
    </>
  )
}
