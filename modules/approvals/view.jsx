// ============================================================
// modules/approvals/view.jsx — Approval
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Approval diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
// ============================================================
import React from 'react'
import { format } from '../../lib/constants'

// --- Filter tabs ---
export function filters(ctx) {
  const { rows, approvalFilter, setApprovalFilter } = ctx
  return (
    <div className="filter-tabs">
      <button
        type="button"
        className={`pill ${approvalFilter === 'all' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('all')}
      >
        Semua ({rows.length})
      </button>
      <button
        type="button"
        className={`pill ${approvalFilter === 'PENDING' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('PENDING')}
        style={rows.some(r => r.status === 'PENDING') ? { borderColor: '#d97706', color: '#d97706', fontWeight: 'bold' } : {}}
      >
        ⏳ Menunggu ({rows.filter(r => r.status === 'PENDING').length})
      </button>
      <button
        type="button"
        className={`pill ${approvalFilter === 'APPROVED' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('APPROVED')}
      >
        ✓ Disetujui ({rows.filter(r => r.status === 'APPROVED').length})
      </button>
      <button
        type="button"
        className={`pill ${approvalFilter === 'REVISI' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('REVISI')}
      >
        ✎ Revisi ({rows.filter(r => r.status === 'REVISI').length})
      </button>
      <button
        type="button"
        className={`pill ${approvalFilter === 'REJECTED' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('REJECTED')}
      >
        ✕ Ditolak ({rows.filter(r => r.status === 'REJECTED').length})
      </button>
    </div>
  )
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal, ctx) {
  const { H } = ctx
  const { approvalItemLines, approvalItemQtys } = H

  if (h === 'items') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {approvalItemLines(r).length ? approvalItemLines(r).map((line, idx) => (
          <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, paddingLeft: '12px', textIndent: '-12px' }}>
            • {line}
          </span>
        )) : <span className="muted" style={{ fontSize: '12px' }}>—</span>}
      </div>
    )
  }
  if (h === 'items_qty') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {approvalItemQtys(r).length ? approvalItemQtys(r).map((q, idx) => (
          <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, fontWeight: 600 }}>
            {q}
          </span>
        )) : <span className="muted" style={{ fontSize: '12px' }}>—</span>}
      </div>
    )
  }
  return null
}

// --- Aksi per baris (desktop): Setujui / Tolak / Revisi + perluasan material ---
export function rowActions(r, ctx) {
  const { H, expandedApproval, setExpandedApproval, onDecideApproval, onReviseApproval } = ctx
  const { approvalItemLines } = H
  return (
    <td style={{ textAlign: 'center' }}>
      {r.status === 'PENDING' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => onDecideApproval(r, 'APPROVED')}
            style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
          >
            ✓ Setujui
          </button>
          <button
            type="button"
            onClick={() => onDecideApproval(r, 'REJECTED')}
            style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
          >
            ✕ Tolak
          </button>
          <button
            type="button"
            onClick={() => onReviseApproval(r)}
            style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
          >
            ✎ Revisi
          </button>
        </div>
        {approvalItemLines(r).length > 0 && (
          <button
            type="button"
            onClick={() => setExpandedApproval(expandedApproval === r.id ? null : r.id)}
            style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34' }}
          >
            {expandedApproval === r.id ? '▲ Tutup material' : `▼ Material (${approvalItemLines(r).length})`}
          </button>
        )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
          <span className={`badge status-${r.status}`}>{r.status}</span>
          {approvalItemLines(r).length > 0 && (
            <button
              type="button"
              onClick={() => setExpandedApproval(expandedApproval === r.id ? null : r.id)}
              style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34' }}
            >
              {expandedApproval === r.id ? '▲ Tutup material' : `▼ Material (${approvalItemLines(r).length})`}
            </button>
          )}
        </div>
      )}
    </td>
  )
}

// --- Baris perluasan: setujui material per barang ---
export function rowExpand(r, ctx) {
  const { H, columns, expandedApproval, onApproveItem, onMarkPrItemOrdered } = ctx
  const { approvalItems, approvalItemLines, itemState } = H
  if (!(expandedApproval === r.id)) return null
  return (
    <tr>
      <td colSpan={columns.length + 2} style={{ background: '#fbfdfc', padding: '10px 12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: '#1f3a34' }}>
          📋 Material — setujui per barang{r.status === 'APPROVED' ? ', lalu tandai yang sudah dipesan ke supplier' : ''}
        </div>
        {approvalItems(r).length === 0 ? (
          <div>
            {approvalItemLines(r).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '6px' }}>
                {approvalItemLines(r).map((line, i) => (
                  <span key={i} style={{ fontSize: '11px', lineHeight: 1.45, paddingLeft: '12px', textIndent: '-12px' }}>• {line}</span>
                ))}
              </div>
            )}
            <p className="muted" style={{ fontSize: '11px', margin: 0 }}>
              Rincian per barang belum tersimpan untuk PR lama ini — gunakan tombol ✓ Setujui untuk menyetujui seluruh PR.
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                <th style={{ padding: '4px 6px', width: '90px' }}>Kode</th>
                <th style={{ padding: '4px 6px' }}>Nama Item</th>
                <th style={{ padding: '4px 6px', width: '70px' }}>Qty</th>
                <th style={{ padding: '4px 6px', width: '70px' }}>Satuan</th>
                <th style={{ padding: '4px 6px', width: '110px' }}>Status</th>
                <th style={{ padding: '4px 6px', width: '150px', textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {approvalItems(r).map(it => {
                const st = itemState(it)
                const canApprove = st === 'PENDING' && (r.status === 'PENDING' || r.status === 'APPROVED')
                const canOrder = st === 'APPROVED' && r.status === 'APPROVED'
                return (
                  <tr key={it.id} style={{ borderBottom: '1px solid #e1e7e4' }}>
                    <td style={{ padding: '4px 6px' }}><b>{it.kode || '—'}</b></td>
                    <td style={{ padding: '4px 6px' }}>{it.item_name}</td>
                    <td style={{ padding: '4px 6px' }}>{it.quantity}</td>
                    <td style={{ padding: '4px 6px' }}>{it.unit || '—'}</td>
                    <td style={{ padding: '4px 6px' }}>
                      <span className={`badge ${st === 'ORDERED' ? 'status-APPROVED' : (st === 'APPROVED' ? 'badge-item-approved' : 'status-PENDING')}`} style={{ fontSize: '10px' }}>
                        {st === 'ORDERED' ? '✓ Sudah Order' : (st === 'APPROVED' ? '✓ Disetujui' : '⏳ Menunggu')}
                      </span>
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                      {st === 'ORDERED' ? (
                        <span style={{ fontSize: '10px', color: '#137333' }}>→ ke Purchase</span>
                      ) : canOrder ? (
                        <button
                          type="button"
                          onClick={() => onMarkPrItemOrdered(it)}
                          style={{ background: '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                        >
                          🛒 Sudah Order
                        </button>
                      ) : canApprove ? (
                        <button
                          type="button"
                          onClick={() => onApproveItem(it)}
                          style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                        >
                          ✓ Setujui
                        </button>
                      ) : st === 'APPROVED' ? (
                        <span style={{ fontSize: '10px', color: '#b45309', whiteSpace: 'nowrap' }}>⏳ Menunggu PR disetujui</span>
                      ) : (
                        <span style={{ fontSize: '10px', color: '#71817d' }}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  )
}

// --- Kartu mobile ---
export function mobileCard(r, ctx) {
  const { H, onDecideApproval, onReviseApproval } = ctx
  const { approvalItemLines, approvalItemQtys } = H
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.pr_number || 'PR'}</b>
          <div className="mobile-card-sub">{r.project_name || 'Tanpa Project'}</div>
        </div>
        <span className={`badge status-${r.status}`}>{r.status}</span>
      </div>
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Judul:</span>
          <span className="mobile-val">{r.title || '—'}</span>
        </div>
        <div className="mobile-card-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
          <span className="mobile-label">Item Material ({approvalItemLines(r).length}):</span>
          <div className="mobile-items-box">
            {approvalItemLines(r).length ? approvalItemLines(r).map((line, idx) => {
              const q = approvalItemQtys(r)[idx]
              return (
                <div key={idx} className="mobile-item-line">
                  • {line}{q && q !== '—' ? <b> — {q}</b> : null}
                </div>
              )
            }) : <span className="muted">—</span>}
          </div>
        </div>
        {r.note && (
          <div className="mobile-card-note">
            <b>Catatan:</b> {r.note}
          </div>
        )}
        {r.decided_at && (
          <div className="mobile-card-row">
            <span className="mobile-label">Diputuskan:</span>
            <span className="mobile-val">{format(r.decided_at)}</span>
          </div>
        )}
      </div>
      <div className="mobile-card-actions">
        {r.status === 'PENDING' ? (
          <div className="mobile-action-grid-3">
            <button
              type="button"
              className="btn-mobile-approve"
              onClick={() => onDecideApproval(r, 'APPROVED')}
            >
              ✓ Setujui
            </button>
            <button
              type="button"
              className="btn-mobile-reject"
              onClick={() => onDecideApproval(r, 'REJECTED')}
            >
              ✕ Tolak
            </button>
            <button
              type="button"
              className="btn-mobile-revise"
              onClick={() => onReviseApproval(r)}
            >
              ✎ Revisi
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontSize: '12px', color: '#556b65', padding: '6px' }}>
            Sudah diproses ({r.status})
          </div>
        )}
      </div>
    </>
  )
}
