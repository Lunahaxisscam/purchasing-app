// ============================================================
// modules/projects/view.jsx — Project / Past Project
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Project / Past Project diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
// ============================================================
import React from 'react'
import { format, normalizeStatus } from '../../lib/constants'

// --- Filter tabs ---
export function filters(ctx) {
  const { allProjects, projectFilter, setProjectFilter } = ctx
  return (
    <div className="filter-tabs">
      <button
        type="button"
        className={`pill ${projectFilter === 'active' ? 'active' : ''}`}
        onClick={() => setProjectFilter('active')}
      >
        Aktif ({allProjects.filter(p => normalizeStatus(p.status) !== 'DONE').length})
      </button>
      <button
        type="button"
        className={`pill ${projectFilter === 'ON_GOING' ? 'active' : ''}`}
        onClick={() => setProjectFilter('ON_GOING')}
      >
        On Going ({allProjects.filter(p => normalizeStatus(p.status) === 'ON_GOING').length})
      </button>
      <button
        type="button"
        className={`pill ${projectFilter === 'NOT_START' ? 'active' : ''}`}
        onClick={() => setProjectFilter('NOT_START')}
      >
        Not Start ({allProjects.filter(p => normalizeStatus(p.status) === 'NOT_START').length})
      </button>
      <button
        type="button"
        className={`pill ${projectFilter === 'all' ? 'active' : ''}`}
        onClick={() => setProjectFilter('all')}
      >
        Semua ({allProjects.length})
      </button>
    </div>
  )
}

// --- Cell tabel desktop: dropdown status project ---
export function renderCell(h, r, rawVal, ctx) {
  const { onStatusChange } = ctx
  if (h === 'status') {
    return (
      <select
        className={`status-select status-${normalizeStatus(r.status)}`}
        value={normalizeStatus(r.status)}
        onChange={e => onStatusChange(r, e.target.value)}
      >
        <option value="NOT_START">Not Start</option>
        <option value="ON_GOING">On Going</option>
        <option value="DONE">Done</option>
      </select>
    )
  }
  return null
}

// --- Aksi per baris (desktop) ---
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
  const { onStatusChange } = ctx
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.kode || r.code || '—'}</b>
          <div className="mobile-card-sub">{r.name}</div>
        </div>
        <select
          className={`status-select status-${normalizeStatus(r.status)}`}
          value={normalizeStatus(r.status)}
          onChange={e => onStatusChange(r, e.target.value)}
        >
          <option value="NOT_START">Not Start</option>
          <option value="ON_GOING">On Going</option>
          <option value="DONE">Done</option>
        </select>
      </div>
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Tanggal:</span>
          <span className="mobile-val">{format(r.created_at)}</span>
        </div>
      </div>
    </>
  )
}
