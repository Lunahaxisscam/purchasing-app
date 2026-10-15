// ============================================================
// modules/materials/view.jsx — Material
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Material diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
// ============================================================
import React from 'react'
import { format, rupiah, isBhpMaterial, isStokMenipis, stokText } from '../../lib/constants'

// --- Banner peringatan stok BHP menipis (Sprint 1) ---
export function banner(ctx) {
  const { rows } = ctx
  const stokMenipisCount = (rows || []).filter(isStokMenipis).length
  if (!(stokMenipisCount > 0)) return null
  return (
    <div
      className="notice"
      style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b', fontWeight: 600, marginBottom: '12px' }}
    >
      🔴 {stokMenipisCount} bahan habis pakai (BHP) mencapai/melewati batas minimum stok — segera buat Purchase Request pengisian ulang.
    </div>
  )
}

// --- Kelas baris khusus (stok menipis) ---
export function rowClass(r) {
  return isStokMenipis(r) ? 'row-stok-menipis' : null
}

// --- Filter tabs (termasuk badge Stok Menipis) ---
export function filters(ctx) {
  const { rows, materialFilter, setMaterialFilter } = ctx
  const stokMenipisCount = (rows || []).filter(isStokMenipis).length
  return (
    <div className="filter-tabs">
      <button
        type="button"
        className={`pill ${materialFilter === 'all' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('all')}
      >
        Semua ({rows.length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'Plywood & Board' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('Plywood & Board')}
      >
        Plywood & Board ({rows.filter(r => r.category === 'Plywood & Board').length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'HPL & Edging' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('HPL & Edging')}
      >
        HPL & Edging ({rows.filter(r => r.category === 'HPL & Edging').length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'Hardware & Fitting' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('Hardware & Fitting')}
      >
        Hardware & Fitting ({rows.filter(r => r.category === 'Hardware & Fitting').length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'Bahan Habis Pakai' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('Bahan Habis Pakai')}
      >
        Bahan Habis Pakai ({rows.filter(r => r.category === 'Bahan Habis Pakai').length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'Lainnya' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('Lainnya')}
      >
        Lainnya ({rows.filter(r => !['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai'].includes(r.category)).length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'STOK_MENIPIS' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('STOK_MENIPIS')}
        style={stokMenipisCount > 0 ? { borderColor: '#dc2626', color: '#dc2626', fontWeight: 'bold' } : {}}
      >
        🔴 Stok Menipis ({stokMenipisCount})
      </button>
    </div>
  )
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal) {
  if (h === 'name') {
    return (
      <div className="cell-name" title={String(rawVal || '')}>{format(rawVal)}</div>
    )
  }
  if (h === 'current_stock') {
    return (
      // Sprint 1 — stok BHP: badge merah mencolok bila menipis.
      isStokMenipis(r) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{stokText(r.current_stock)}</span>
          <span style={{
            display: 'inline-block', width: 'fit-content',
            background: '#dc2626', color: '#fff', border: '1px solid #b91c1c',
            borderRadius: '10px', padding: '2px 8px', fontSize: '10px',
            fontWeight: 800, whiteSpace: 'nowrap'
          }}>
            🔴 Stok Menipis
          </span>
        </div>
      ) : (
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {isBhpMaterial(r) ? stokText(r.current_stock) : <span className="muted">—</span>}
        </span>
      )
    )
  }
  if (h === 'min_stock') {
    return (
      <span style={{ whiteSpace: 'nowrap' }}>
        {isBhpMaterial(r) && Number(r.min_stock) > 0 ? stokText(r.min_stock) : <span className="muted">—</span>}
      </span>
    )
  }
  if (h === 'harga_acuan') {
    return (
      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {rawVal === null || rawVal === undefined || rawVal === '' ? <span className="muted">—</span> : rupiah(rawVal)}
      </span>
    )
  }
  return null
}

// --- Aksi per baris (desktop): edit (stok/min) + hapus ---
export function rowActions(r, ctx) {
  const { title, page, setEditRow, onDelete } = ctx
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
        {page === 'materials' && (
          <button
            type="button"
            className="btn-edit icon-btn"
            onClick={() => setEditRow(r)}
            title={`Edit ${r.name || title} (ubah stok / batas minimum)`}
          >
            ✏️
          </button>
        )}
        <button
          type="button"
          className="btn-delete"
          onClick={() => onDelete(page, r)}
          title={`Hapus ${title}`}
        >
          Hapus
        </button>
      </div>
    </td>
  )
}

// --- Kartu mobile ---
export function mobileCard(r, ctx) {
  const { page, setEditRow, onDelete } = ctx
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.kode || '—'}</b>
          <div className="mobile-card-sub">{r.name}</div>
        </div>
        <span className="badge status-APPROVED" style={{ fontSize: '11px' }}>
          {r.qty ?? 0} {r.satuan || ''}
        </span>
      </div>
      {isStokMenipis(r) && (
        <div style={{ margin: '0 14px 8px', background: '#dc2626', color: '#fff', borderRadius: '8px', padding: '6px 10px', fontSize: '11px', fontWeight: 800, textAlign: 'center' }}>
          🔴 Stok Menipis — {stokText(r.current_stock)} (batas min {stokText(r.min_stock)})
        </div>
      )}
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Kategori:</span>
          <span className="mobile-val">{r.category || '—'}</span>
        </div>
        {isBhpMaterial(r) && (
          <>
            <div className="mobile-card-row">
              <span className="mobile-label">Stok Saat Ini:</span>
              <span className="mobile-val" style={{ fontWeight: 700, color: isStokMenipis(r) ? '#b91c1c' : undefined }}>{stokText(r.current_stock)}</span>
            </div>
            <div className="mobile-card-row">
              <span className="mobile-label">Batas Min:</span>
              <span className="mobile-val">{Number(r.min_stock) > 0 ? stokText(r.min_stock) : '—'}</span>
            </div>
          </>
        )}
        <div className="mobile-card-row">
          <span className="mobile-label">Acuan Harga:</span>
          <span className="mobile-val" style={{ fontWeight: 600 }}>
            {r.harga_acuan === null || r.harga_acuan === undefined || r.harga_acuan === '' ? '—' : rupiah(r.harga_acuan)}
          </span>
        </div>
      </div>
      <div className="mobile-card-actions">
        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
          <button
            type="button"
            className="outline"
            onClick={() => setEditRow(r)}
            style={{ flex: 1, padding: '8px', fontSize: '12px' }}
          >
            ✏️ Edit
          </button>
          <button
            type="button"
            className="btn-delete"
            onClick={() => onDelete(page, r)}
            style={{ flex: 1, padding: '8px', fontSize: '12px' }}
          >
            Hapus Material
          </button>
        </div>
      </div>
    </>
  )
}
