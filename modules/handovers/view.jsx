// ============================================================
// modules/handovers/view.jsx — Handover
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Handover diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
//
// Fitur 15 Okt 2026 — Bukti Foto Serah Terima (maks 2MB):
//   Foto disimpan sebagai data-URL base64 di dalam kolom note dengan penanda
//   [FotoBukti: …] (lihat lib/constants.js). Kolom "Bukti Foto" menampilkan
//   thumbnail + tombol lihat; kolom "Catatan" menampilkan teksnya saja
//   (tanpa base64). Kartu mobile ikut menampilkan thumbnail.
// ============================================================
import React from 'react'
import { format, parseHandoverNote } from '../../lib/constants'

// --- Bukti foto serah terima (fitur 15 Okt 2026) ---
// Buka foto ukuran penuh di jendela baru: untuk data-URL, navigasi top-frame
// ke data: URL diblokir Chrome — jadi jendela kosong dibuka dulu, lalu gambar
// ditulis lewat DOM API. Bila foto berupa link http(s), langsung buka link.
// Fallback (popup diblokir): unduh file via <a download>.
function bukaFoto(foto) {
  const src = String(foto || '')
  if (!src) return
  try {
    if (/^https?:\/\//i.test(src)) {
      const w = window.open(src, '_blank', 'noopener')
      if (w) return
    } else {
      const w = window.open('', '_blank')
      if (w && w.document) {
        w.document.title = 'Bukti Foto Serah Terima'
        w.document.body.style.cssText = 'margin:16px;background:#0f1c19;text-align:center;'
        const img = w.document.createElement('img')
        img.src = src
        img.alt = 'Bukti foto serah terima'
        img.style.cssText = 'max-width:100%;height:auto;border-radius:8px;'
        w.document.body.appendChild(img)
        return
      }
    }
  } catch (e) { /* lanjut ke fallback unduh */ }
  try {
    const a = document.createElement('a')
    a.href = src
    a.download = 'bukti-foto-handover.jpg'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch (e) { /* tidak ada yang bisa dilakukan di lingkungan ini */ }
}

// --- Filter tabs ---
export function filters(ctx) {
  const { rows, handoverFilter, setHandoverFilter } = ctx
  return (
    <div className="filter-tabs">
      <button
        type="button"
        className={`pill ${handoverFilter === 'all' ? 'active' : ''}`}
        onClick={() => setHandoverFilter('all')}
      >
        Semua ({rows.length})
      </button>
      <button
        type="button"
        className={`pill ${handoverFilter === 'CONFIRMED' ? 'active' : ''}`}
        onClick={() => setHandoverFilter('CONFIRMED')}
      >
        ✓ Sudah Diserahkan ({rows.filter(r => r.status === 'CONFIRMED' || r.status === 'SELESAI').length})
      </button>
      <button
        type="button"
        className={`pill ${handoverFilter === 'DRAFT' ? 'active' : ''}`}
        onClick={() => setHandoverFilter('DRAFT')}
      >
        Belum Diserahkan ({rows.filter(r => r.status !== 'CONFIRMED' && r.status !== 'SELESAI').length})
      </button>
    </div>
  )
}

// --- Header kolom khusus ---
export function header(h) {
  if (h === 'bukti_foto') return '📷 Bukti Foto'
  return null
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal, ctx) {
  // Kolom Bukti Foto: thumbnail + tombol "Lihat Foto" bila bukti tersedia,
  // selain itu dibiarkan kosong (shell menampilkan '—').
  if (h === 'bukti_foto') {
    const { foto } = parseHandoverNote(r.note)
    if (!foto) return null
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <img
          src={foto}
          alt="Bukti foto serah terima"
          title="Klik untuk lihat bukti foto"
          onClick={() => bukaFoto(foto)}
          style={{ width: '42px', height: '42px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cbd8d4', cursor: 'zoom-in', flexShrink: 0 }}
        />
        <button
          type="button"
          onClick={() => bukaFoto(foto)}
          style={{ width: 'fit-content', background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', borderRadius: '4px', padding: '2px 7px', fontSize: '10px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          title="Buka bukti foto serah terima"
        >
          📷 Lihat Foto
        </button>
      </div>
    )
  }
  // Kolom Catatan: bila note memuat bukti foto, tampilkan HANYA teks catatannya
  // (tanpa base64). Bila tidak ada foto, return null -> jalur generik seperti
  // sebelumnya (kompatibel data lama).
  if (h === 'note') {
    const { foto, extra } = parseHandoverNote(rawVal)
    if (!foto) return null
    return extra ? (
      <div style={{ whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.4, fontSize: '12px', maxWidth: '230px' }} title={extra}>
        {extra}
      </div>
    ) : (
      <span style={{ color: '#9aa8a4' }}>—</span>
    )
  }
  return null
}

// --- Aksi per baris (desktop): tandai diserahkan + edit + hapus ---
// Standar Noir Living (review Brooklyn #B.3): kolom aksi VERTIKAL — lebar
// seragam, tidak wrap horizontal.
// Tombol Edit ditambahkan bersama fitur bukti foto (15 Okt 2026) supaya foto
// bukti bisa dilampirkan pada handover yang SUDAH ADA (termasuk yang dibuat
// otomatis dari alur Penerimaan → Ke Tukang) — pola sama dengan modul
// Material / PR yang sudah punya ✏️ Edit.
export function rowActions(r, ctx) {
  const { title, page, setEditRow, onMarkHandoverDelivered, onDelete } = ctx
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'stretch', width: '120px', margin: '0 auto' }}>
        {['CONFIRMED', 'SELESAI'].includes(String(r.status || '').toUpperCase()) ? (
          <span style={{ fontSize: '10px', color: '#137333', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'center' }}>✓ Sudah diserahkan</span>
        ) : (
          <button
            type="button"
            onClick={() => onMarkHandoverDelivered(r)}
            style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', width: '100%' }}
            title="Tandai serah terima sudah diserahkan"
          >
            ✓ Sudah Diserahkan
          </button>
        )}
        <button
          type="button"
          className="btn-edit icon-btn"
          onClick={() => setEditRow(r)}
          title={`Edit ${title}`}
          style={{ width: '100%' }}
        >
          ✏️
        </button>
        <button
          type="button"
          className="btn-delete icon-btn"
          onClick={() => onDelete(page, r)}
          title={`Hapus ${title}`}
          style={{ width: '100%' }}
        >
          🗑️
        </button>
      </div>
    </td>
  )
}

// --- Kartu mobile ---
// WAJIB ada karena kartu generik menampilkan kolom note apa adanya — dengan
// bukti foto, itu berarti seluruh base64 ikut tampil sebagai teks. Kartu ini
// menampilkan thumbnail + tombol lihat foto, catatan teks saja, dan aksi yang
// sama dengan baris desktop (✓ Sudah Diserahkan / ✏️ Edit / Hapus).
export function mobileCard(r, ctx) {
  const { page, title, setEditRow, onMarkHandoverDelivered, onDelete } = ctx
  const { foto, extra } = parseHandoverNote(r.note)
  const delivered = ['CONFIRMED', 'SELESAI'].includes(String(r.status || '').toUpperCase())
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.project_name || 'Handover'}</b>
          <div className="mobile-card-sub">{r.received_by || 'Belum ditentukan'}</div>
        </div>
        <span className={`badge status-${delivered ? 'APPROVED' : 'DRAFT'}`} style={{ fontSize: '10px' }}>
          {delivered ? '✓ Sudah Diserahkan' : 'Belum Diserahkan'}
        </span>
      </div>
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Tgl Serah Terima:</span>
          <span className="mobile-val">{format(r.handover_date)}</span>
        </div>
        {foto && (
          <div className="mobile-card-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
            <span className="mobile-label">Bukti Foto:</span>
            <img
              src={foto}
              alt="Bukti foto serah terima"
              onClick={() => bukaFoto(foto)}
              style={{ width: '84px', height: '84px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #cbd8d4', cursor: 'zoom-in' }}
            />
            <button
              type="button"
              onClick={() => bukaFoto(foto)}
              style={{ width: 'fit-content', background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', borderRadius: '4px', padding: '3px 10px', fontSize: '11px', fontWeight: 700 }}
            >
              📷 Lihat Foto
            </button>
          </div>
        )}
        {extra && (
          <div className="mobile-card-note">
            <b>Catatan:</b> {extra}
          </div>
        )}
      </div>
      <div className="mobile-card-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {delivered ? (
          <span style={{ fontSize: '12px', color: '#137333', fontWeight: 700 }}>✓ Sudah diserahkan</span>
        ) : (
          <button
            type="button"
            onClick={() => onMarkHandoverDelivered(r)}
            style={{ width: '100%', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px', fontSize: '12px', fontWeight: 700 }}
          >
            ✓ Sudah Diserahkan
          </button>
        )}
        <button
          type="button"
          className="outline"
          onClick={() => setEditRow(r)}
          style={{ width: '100%' }}
        >
          ✏️ Edit
        </button>
        <button type="button" className="btn-delete" onClick={() => onDelete(page, r)} style={{ width: '100%' }}>
          Hapus {title}
        </button>
      </div>
    </>
  )
}
