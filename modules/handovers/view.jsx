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
// ============================================================
import React from 'react'

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

// --- Aksi per baris (desktop): tandai sudah diserahkan + hapus ---
export function rowActions(r, ctx) {
  const { title, page, onMarkHandoverDelivered, onDelete } = ctx
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
        {['CONFIRMED', 'SELESAI'].includes(String(r.status || '').toUpperCase()) ? (
          <span style={{ fontSize: '10px', color: '#137333', fontWeight: 600, whiteSpace: 'nowrap' }}>✓ Sudah diserahkan</span>
        ) : (
          <button
            type="button"
            onClick={() => onMarkHandoverDelivered(r)}
            style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
            title="Tandai serah terima sudah diserahkan"
          >
            ✓ Sudah Diserahkan
          </button>
        )}
        <button
          type="button"
          className="btn-delete icon-btn"
          onClick={() => onDelete(page, r)}
          title={`Hapus ${title}`}
        >
          🗑️
        </button>
      </div>
    </td>
  )
}
