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
import { HANDOVER_FOTO_MAX_BYTES, dataUrlByteSize, validateHandoverFotoSize, parseHandoverNote } from '../../lib/constants'

export function formBody(ctx) {
  const { form, setForm, field, isEdit, editRow, allReceivings, allProjects } = ctx

  // --- Bukti foto serah terima (fitur 15 Okt 2026) -------------------------
  // File dibaca client-side menjadi data-URL base64 dan disimpan di state form
  // (form.bukti_foto) — ikut mekanisme form shell, tanpa mengubah kontrak ctx.
  // Mode edit: bila foto belum disentuh, tampilkan foto lama dari catatan.
  const fotoTersimpan = form.bukti_foto !== undefined ? form.bukti_foto : parseHandoverNote(editRow?.note).foto
  const fotoNama = form.bukti_foto_name || ''
  const fotoError = form.bukti_foto_error || ''

  function pilihFoto(e) {
    const input = e.target
    const file = input.files && input.files[0]
    if (!file) return
    // Validasi client-side: ukuran file maksimal 2MB (2 * 1024 * 1024 byte).
    const errMsg = validateHandoverFotoSize(file.size)
    if (errMsg) {
      setForm({ ...form, bukti_foto_error: errMsg })
      input.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      // Cek ulang dari data-URL (byte sebenarnya; padding '=' diabaikan).
      if (dataUrlByteSize(dataUrl) > HANDOVER_FOTO_MAX_BYTES) {
        setForm(prev => ({ ...prev, bukti_foto_error: validateHandoverFotoSize(dataUrlByteSize(dataUrl) + 1) }))
        input.value = ''
        return
      }
      setForm(prev => ({ ...prev, bukti_foto: dataUrl, bukti_foto_name: file.name || 'foto-bukti', bukti_foto_error: '' }))
      input.value = ''
    }
    reader.onerror = () => {
      setForm(prev => ({ ...prev, bukti_foto_error: '⚠️ Gagal membaca file foto. Coba pilih ulang.' }))
      input.value = ''
    }
    reader.readAsDataURL(file)
  }

  function hapusFoto() {
    setForm({ ...form, bukti_foto: '', bukti_foto_name: '', bukti_foto_error: '' })
  }

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
      <label>Bukti Foto Serah Terima (opsional, maks 2MB)
        <input
          type="file"
          accept="image/*"
          onChange={pilihFoto}
        />
        <span style={{ fontSize: '11px', color: '#71817d', fontWeight: 500 }}>
          Maksimal 2MB (JPG/PNG). Foto bukti akan tampil di tabel Handover.
        </span>
      </label>
      {fotoError && (
        <p className="error" role="alert" style={{ margin: 0 }}>{fotoError}</p>
      )}
      {fotoTersimpan && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#f4f8f6', border: '1px solid #d5e0dc', borderRadius: '8px', padding: '8px 10px' }}>
          <img
            src={fotoTersimpan}
            alt="Pratinjau bukti foto"
            style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cbd8d4', flexShrink: 0 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#1f3a34', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fotoNama || 'foto-bukti'}>
              📷 {fotoNama || 'Foto bukti tersimpan'}
            </span>
            <button
              type="button"
              className="outline"
              onClick={hapusFoto}
              style={{ width: 'fit-content', fontSize: '11px', padding: '3px 10px' }}
            >
              Hapus Foto
            </button>
          </div>
        </div>
      )}
      {field('notes', 'Catatan Serah Terima', 'text', false)}
    </>
  )
}
