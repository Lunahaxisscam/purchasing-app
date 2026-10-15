// ============================================================
// modules/requests/view.jsx — Purchase Request (PR)
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Purchase Request (PR) diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
// ============================================================
import React from 'react'
import { format, rupiah } from '../../lib/constants'

// --- Filter tabs ---
export function filters(ctx) {
  const { rows, prFilter, setPrFilter } = ctx
  return (
    <div className="filter-tabs">
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <button
        type="button"
        className={`pill ${prFilter === 'all' ? 'active' : ''}`}
        onClick={() => setPrFilter('all')}
      >
        Semua ({rows.length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'DRAFT' ? 'active' : ''}`}
        onClick={() => setPrFilter('DRAFT')}
      >
        Draft ({rows.filter(r => r.status === 'DRAFT').length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'SUBMITTED' ? 'active' : ''}`}
        onClick={() => setPrFilter('SUBMITTED')}
      >
        Submitted ({rows.filter(r => r.status === 'SUBMITTED').length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'APPROVED' ? 'active' : ''}`}
        onClick={() => setPrFilter('APPROVED')}
      >
        Approved ({rows.filter(r => r.status === 'APPROVED').length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'REVISI' ? 'active' : ''}`}
        onClick={() => setPrFilter('REVISI')}
      >
        Revisi ({rows.filter(r => r.status === 'REVISI').length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'REJECTED' ? 'active' : ''}`}
        onClick={() => setPrFilter('REJECTED')}
      >
        Ditolak ({rows.filter(r => r.status === 'REJECTED').length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'URGENT' ? 'active' : ''}`}
        onClick={() => setPrFilter('URGENT')}
        style={rows.some(r => r.priority === 'URGENT') ? { borderColor: '#c93b2b', color: '#c93b2b', fontWeight: 'bold' } : {}}
      >
        🚨 Prioritas ({rows.filter(r => r.priority === 'URGENT').length})
      </button>
      </div>
    </div>
  )
}

// --- Header kolom khusus: ikon prioritas (bukan teks "Priority") ---
export function header(h) {
  if (h === 'priority') {
    return <span className="prio-dot prio-header" title="Prioritas — klik untuk urutkan" />
  }
  return null
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal, ctx) {
  const { H, openNoteId, setOpenNoteId } = ctx
  const { requestItemRows, requestItemLines } = H

  if (h === 'pr_number') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <b>{format(rawVal)}</b>
          <button
            type="button"
            className={`note-dot ${String(r.notes || '').trim() ? 'note-dot-on' : ''}`}
            title={String(r.notes || '').trim() || 'Tidak ada catatan'}
            aria-label="Catatan PR"
            onClick={() => setOpenNoteId(openNoteId === r.id ? null : r.id)}
          />
        </div>
        <small style={{ color: '#9aa8a4', fontSize: '10px', fontWeight: 500 }}>{format(r.created_at)}</small>
        {openNoteId === r.id && (
          <div className="note-pop">{String(r.notes || '').trim() || 'Tidak ada catatan.'}</div>
        )}
      </div>
    )
  }
  if (h === 'priority') {
    return (
      <span
        className={`prio-dot ${String(r.priority || '').toUpperCase() === 'URGENT' ? 'prio-urgent' : 'prio-normal'}`}
        title={String(r.priority || '').toUpperCase() === 'URGENT' ? 'Prioritas' : 'Standard'}
      />
    )
  }
  if (h === 'items_qty') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {requestItemRows(r).length ? requestItemRows(r).map((it, idx) => (
          <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {it.qtyText}
          </span>
        )) : <span className="muted" style={{ fontSize: '12px' }}>—</span>}
      </div>
    )
  }
  if (h === 'vendor_name') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {requestItemRows(r).length ? requestItemRows(r).map((it, idx) => (
          <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, color: it.vendor ? '#1a73e8' : '#9aa8a4', whiteSpace: 'normal' }}>
            {it.vendor || '—'}
          </span>
        )) : <span className="muted" style={{ fontSize: '12px' }}>—</span>}
      </div>
    )
  }
  if (h === 'materials_summary') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {requestItemLines(r).map((line, idx) => (
          <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, whiteSpace: 'normal', paddingLeft: '12px', textIndent: '-12px' }}>
            • {line}
          </span>
        ))}
      </div>
    )
  }
  return null
}

// --- Baris desktop khusus: master-detail item PR (rowSpan; tiap item 1 baris) ---
export function desktopRow(r, ctx) {
  const { H, title, page, setEditRow, onFinishPr, onDelete, openNoteId, setOpenNoteId } = ctx
  const { requestItemRows } = H
  // Master-detail: setiap item = satu baris tabel; Qty / Item Material /
  // Vendor PASTI sejajar karena berada di baris fisik yang sama.
  // Kolom lain (prioritas, no PR, project, judul, status, aksi) pakai rowSpan.
  const itemList = requestItemRows(r)
  const list = itemList.length ? itemList : [{ name: '—', qtyText: '—', vendor: '' }]
  const span = list.length
  const urgent = String(r.priority || '').toUpperCase() === 'URGENT'
  return list.map((it, idx) => (
    <tr key={`pr-item-${idx}`} className="pr-item-row">
      {idx === 0 && (
        <>
          <td rowSpan={span} style={{ verticalAlign: 'top' }}>
            <span className={`prio-dot ${urgent ? 'prio-urgent' : 'prio-normal'}`} title={urgent ? 'Prioritas' : 'Standard'} />
          </td>
          <td rowSpan={span} style={{ verticalAlign: 'top' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <b>{format(r.pr_number)}</b>
                <button
                  type="button"
                  className={`note-dot ${String(r.notes || '').trim() ? 'note-dot-on' : ''}`}
                  title={String(r.notes || '').trim() || 'Tidak ada catatan'}
                  aria-label="Catatan PR"
                  onClick={() => setOpenNoteId(openNoteId === r.id ? null : r.id)}
                />
              </div>
              <small style={{ color: '#9aa8a4', fontSize: '10px', fontWeight: 500 }}>{format(r.created_at)}</small>
              {openNoteId === r.id && (
                <div className="note-pop">{String(r.notes || '').trim() || 'Tidak ada catatan.'}</div>
              )}
            </div>
          </td>
          <td rowSpan={span} style={{ verticalAlign: 'top' }}>
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }} title={String(r.project_name || '')}>
              {format(r.project_name)}
            </div>
          </td>
          <td rowSpan={span} style={{ verticalAlign: 'top' }}>
            <div className="pr-title-cell" title={String(r.title || '')}>
              {format(r.title)}
            </div>
          </td>
        </>
      )}
      <td className="pr-item-qty"><b>{it.qtyText}</b></td>
      <td className="pr-item-name">{it.name}</td>
      <td className="pr-item-vendor" style={{ color: it.vendor ? '#1a73e8' : '#9aa8a4' }}>{it.vendor || '—'}</td>
      <td className="pr-item-price">{it.estPrice !== null && it.estPrice !== undefined ? rupiah(it.estPrice) : '—'}</td>
      {idx === 0 && (
        <>
          <td rowSpan={span} style={{ verticalAlign: 'top' }}>{format(r.status)}</td>
          <td rowSpan={span} style={{ textAlign: 'center', verticalAlign: 'top' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', justifyContent: 'center', alignItems: 'stretch', width: '92px', margin: '0 auto' }}>
              {['DRAFT', 'REVISI'].includes(String(r.status || '').toUpperCase()) && (
                <button
                  type="button"
                  className="btn-finish"
                  onClick={() => onFinishPr(r)}
                  title={`Selesai — kirim ${r.pr_number || title} ke modul Approval`}
                  style={{ fontSize: '10px', padding: '4px 6px', whiteSpace: 'nowrap', width: '100%' }}
                >
                  ✓ Selesai
                </button>
              )}
              <button
                type="button"
                className="btn-edit icon-btn"
                onClick={() => setEditRow(r)}
                title={`Edit ${r.pr_number || title}`}
                style={{ width: '100%' }}
              >
                ✏️
              </button>
              <button
                type="button"
                className="btn-delete icon-btn"
                onClick={() => onDelete(page, r)}
                title={`Hapus ${r.pr_number || title}`}
                style={{ width: '100%' }}
              >
                🗑️
              </button>
            </div>
          </td>
        </>
      )}
    </tr>
  ))
}

// --- Aksi per baris (desktop) ---
export function rowActions(r, ctx) {
  const { title, page, setEditRow, onFinishPr, onDelete } = ctx
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', justifyContent: 'center', alignItems: 'stretch', width: '92px', margin: '0 auto' }}>
        {['DRAFT', 'REVISI'].includes(String(r.status || '').toUpperCase()) && (
          <button
            type="button"
            className="btn-finish"
            onClick={() => onFinishPr(r)}
            title={`Selesai — kirim ${r.pr_number || title} ke modul Approval`}
            style={{ fontSize: '10px', padding: '4px 6px', whiteSpace: 'nowrap', width: '100%' }}
          >
            ✓ Selesai
          </button>
        )}
        <button
          type="button"
          className="btn-edit icon-btn"
          onClick={() => setEditRow(r)}
          title={`Edit ${r.pr_number || title}`}
          style={{ width: '100%' }}
        >
          ✏️
        </button>
        <button
          type="button"
          className="btn-delete icon-btn"
          onClick={() => onDelete(page, r)}
          title={`Hapus ${r.pr_number || title}`}
          style={{ width: '100%' }}
        >
          🗑️
        </button>
      </div>
    </td>
  )
}

// --- Kartu mobile ---
export function mobileCard(r, ctx) {
  const { H, page, setEditRow, onFinishPr, onDelete } = ctx
  const { requestItemRows } = H
  return (
    <>
      <div className="mobile-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            className={`prio-dot ${String(r.priority || '').toUpperCase() === 'URGENT' ? 'prio-urgent' : 'prio-normal'}`}
            title={String(r.priority || '').toUpperCase() === 'URGENT' ? 'Prioritas' : 'Standard'}
          />
          <div>
            <b className="mobile-card-title">{r.pr_number || 'PR'}</b>
            <div className="mobile-card-sub">{format(r.created_at)}</div>
          </div>
        </div>
        <span className={`badge status-${r.status}`}>{r.status}</span>
      </div>
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Project:</span>
          <span className="mobile-val">{r.project_name || '—'}</span>
        </div>
        <div className="mobile-card-row">
          <span className="mobile-label">Judul:</span>
          <span className="mobile-val">{r.title || '—'}</span>
        </div>
        <div className="mobile-card-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
          <span className="mobile-label">Item Material:</span>
          <div className="mobile-items-box">
            {requestItemRows(r).map((it, idx) => (
              <div key={idx} className="mobile-item-line">
                • {it.name}
                {it.qtyText && it.qtyText !== '—' ? <b> — {it.qtyText}</b> : null}
                {it.vendor ? <span style={{ color: '#1a73e8' }}> · 🛒 {it.vendor}</span> : null}
                {(it.estPrice !== null && it.estPrice !== undefined) ? <span style={{ color: '#137333' }}> · {rupiah(it.estPrice)}</span> : null}
              </div>
            ))}
          </div>
        </div>
        {String(r.notes || '').trim() && (
          <div className="mobile-card-note">
            <b>Catatan PR:</b> {r.notes}
          </div>
        )}
      </div>
      <div className="mobile-card-actions">
        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
          {['DRAFT', 'REVISI'].includes(String(r.status || '').toUpperCase()) && (
            <button
              type="button"
              className="btn-finish"
              onClick={() => onFinishPr(r)}
              style={{ flex: 1, padding: '8px', fontSize: '12px' }}
            >
              ✓ Selesai
            </button>
          )}
          <button
            type="button"
            className="outline"
            onClick={() => setEditRow(r)}
            style={{ padding: '8px 14px', fontSize: '12px' }}
          >
            ✏️ Edit
          </button>
          <button
            type="button"
            className="btn-delete"
            onClick={() => onDelete(page, r)}
            style={{ padding: '8px 14px', fontSize: '12px' }}
          >
            🗑️
          </button>
        </div>
      </div>
    </>
  )
}
