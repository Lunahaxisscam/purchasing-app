// ============================================================
// modules/handovers/form.jsx — form Tambah/Edit Handover
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/CreateModal.js
// pada Fase 1 modularisasi (perilaku tidak diubah).
//
// REVISI t_b418827b (arahan DAT + screenshot Edit Handover):
//  - Mode EDIT: input/dropdown Penerimaan (Purchase), Project, dan Status
//    Serah Terima DIHAPUS dari form. Purchase/project diturunkan dari record
//    sumber dan ditampilkan sebagai ringkasan READ-ONLY; FK dipertahankan
//    saat simpan (lihat save.js). Status tidak lagi bisa diedit lewat
//    dropdown — "Sudah Diserahkan" hanya via aksi konfirmasi fisik.
//  - Mode TAMBAH (standalone): pemilihan Penerimaan + Project TETAP ada
//    (link wajib, tidak boleh orphan) — form tambah terpisah dari edit.
//  - Daftar rincian barang WAJIB terlihat di modal (label "Rincian barang
//    belum tersedia" untuk data lama — tidak menebak jumlah).
// ============================================================
import React from 'react'
import { HANDOVER_FOTO_MAX_BYTES, dataUrlByteSize, validateHandoverFotoSize, parseHandoverNote } from '../../lib/constants'
import { sourceRefs, rincianInfo, statusInfo } from './display'

export function formBody(ctx) {
  const { form, setForm, field, isEdit, editRow, allReceivings, allRequestsFull = [] } = ctx
  const allRequests = allRequestsFull

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

  // ============================================================
  // MODE EDIT — sumber & status read-only (diturunkan dari record).
  // ============================================================
  if (isEdit && editRow) {
    const refs = sourceRefs(editRow, { allReceivings, allRequests })
    const rinc = rincianInfo(editRow)
    const st = statusInfo(editRow)
    return (
      <>
        <div data-testid="handover-source-summary" style={{ background: '#f4f8f6', border: '1px solid #d5e0dc', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#1f3a34', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <b>Sumber (tidak bisa diubah di sini)</b>
          <span>Penerimaan: <b>{refs.receivingLabel || '—'}</b>{refs.prNumber ? <> · PR asal: <b>{refs.prNumber}</b></> : null}</span>
          <span>Project: <b>{editRow.project_name || '—'}</b></span>
          <span>Status: <b>{st.delivered ? 'Sudah Diserahkan' : 'Belum Diserahkan'}</b>{st.delivered && st.diserahkanAt ? ` — ${new Date(st.diserahkanAt).toLocaleString('id-ID')}` : ''}</span>
          {st.legacyNote && <span style={{ color: '#a15309' }}>⚠️ {st.legacyNote}</span>}
        </div>

        <div data-testid="handover-items-summary" style={{ border: '1px solid #e1e7e4', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#1f3a34' }}>
          <b>Rincian barang</b>
          {rinc.available ? (
            <ul style={{ margin: '5px 0 0 18px', padding: 0 }}>
              {rinc.rows.map((row, i) => (
                <li key={i}>{row.name} — {row.qty}{row.unit ? ` ${row.unit}` : ''} ({row.qtyLabel})</li>
              ))}
            </ul>
          ) : (
            <div style={{ marginTop: '4px' }}>
              <b data-testid="handover-rincian-unavailable">{rinc.label}</b>
              {rinc.notice && <div className="muted" style={{ fontSize: '11px', marginTop: '3px' }}>{rinc.notice}</div>}
            </div>
          )}
        </div>

        {field('received_by', 'Diterima Oleh (Mandor / Tukang Lapangan)', 'text', true)}
        {field('handover_date', 'Tanggal Serah Terima', 'date', false)}
        <label>Bukti Foto Serah Terima (opsional, maks 2MB)
          <input
            type="file"
            accept="image/*"
            onChange={pilihFoto}
          />
          <span style={{ fontSize: '11px', color: '#71817d', fontWeight: 500 }}>
            Maksimal 2MB (JPG/PNG). Foto bukti akan tampil di tabel Serah Terima.
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

  // ============================================================
  // MODE TAMBAH (standalone) — sumber wajib dipilih (link, bukan orphan).
  // ============================================================
  const recSelected = (allReceivings || []).find(r => r.id === form.receiving_id)
  const rincBaru = form.receiving_id ? rincianInfo({ receiving_id: form.receiving_id }) : null

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
        <span style={{ fontSize: '11px', color: '#71817d', fontWeight: 500 }}>
          Serah Terima harus terhubung ke penerimaan asalnya — pilih penerimaan yang barangnya diserahkan ke tukang.
        </span>
      </label>
      {recSelected && (
        <div data-testid="handover-create-source-summary" style={{ background: '#f4f8f6', border: '1px solid #d5e0dc', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', color: '#1f3a34' }}>
          Project: <b>{recSelected.project_name || '—'}</b>
          {recSelected.purchase_request_id && (allRequests || []).some(p => p.id === recSelected.purchase_request_id) && (
            <> · PR asal: <b>{(allRequests || []).find(p => p.id === recSelected.purchase_request_id)?.pr_number || '—'}</b></>
          )}
        </div>
      )}
      {rincBaru && (
        <div data-testid="handover-create-items-summary" style={{ border: '1px solid #e1e7e4', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', color: '#1f3a34' }}>
          <b>Rincian barang:</b> <span data-testid="handover-create-rincian-unavailable">{rincBaru.label}</span>
          <div className="muted" style={{ fontSize: '11px', marginTop: '3px' }}>{rincBaru.notice}</div>
        </div>
      )}
      {field('received_by', 'Diterima Oleh (Mandor / Tukang Lapangan)', 'text', true)}
      {field('handover_date', 'Tanggal Serah Terima', 'date', false)}
      <label>Bukti Foto Serah Terima (opsional, maks 2MB)
        <input
          type="file"
          accept="image/*"
          onChange={pilihFoto}
        />
        <span style={{ fontSize: '11px', color: '#71817d', fontWeight: 500 }}>
          Maksimal 2MB (JPG/PNG). Foto bukti akan tampil di tabel Serah Terima.
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
