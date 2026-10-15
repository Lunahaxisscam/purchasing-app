// ============================================================
// modules/receivings/view.jsx — Purchase / Receiving
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Purchase / Receiving diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
// ============================================================
import React from 'react'
import { format, rupiah, parseReceivingNote, notaHref, prettyReceivingStatus, isReceivingKendala } from '../../lib/constants'

// --- Filter tabs ---
export function filters(ctx) {
  const { rows, receivingFilter, setReceivingFilter } = ctx
  return (
    <div className="filter-tabs">
      <button
        type="button"
        className={`pill ${receivingFilter === 'all' ? 'active' : ''}`}
        onClick={() => setReceivingFilter('all')}
      >
        Semua ({rows.length})
      </button>
      <button
        type="button"
        className={`pill ${receivingFilter === 'NORMAL' ? 'active' : ''}`}
        onClick={() => setReceivingFilter('NORMAL')}
      >
        ✓ Normal ({rows.filter(r => !isReceivingKendala(r.status)).length})
      </button>
      <button
        type="button"
        className={`pill ${receivingFilter === 'RETUR' ? 'active' : ''}`}
        onClick={() => setReceivingFilter('RETUR')}
        style={rows.some(r => String(r.status).toUpperCase().includes('RETUR')) ? { borderColor: '#d97706', color: '#d97706', fontWeight: 'bold' } : {}}
      >
        ⚠️ Retur ({rows.filter(r => String(r.status).toUpperCase().includes('RETUR')).length})
      </button>
      <button
        type="button"
        className={`pill ${receivingFilter === 'REFUND' ? 'active' : ''}`}
        onClick={() => setReceivingFilter('REFUND')}
        style={rows.some(r => String(r.status).toUpperCase().includes('REFUND')) ? { borderColor: '#c93b2b', color: '#c93b2b', fontWeight: 'bold' } : {}}
      >
        ⚠️ Refund ({rows.filter(r => String(r.status).toUpperCase().includes('REFUND')).length})
      </button>
    </div>
  )
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal, ctx) {
  const { H, onReceivingStatusChange, onMoveToWarehouse, onSendToTukang } = ctx
  const { receivingProgress } = H

  if (h === 'status') {
    const prog = receivingProgress(r.id)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <select
          className={`status-select ${isReceivingKendala(r.status) ? 'status-kendala' : 'status-normal'}`}
          value={['NORMAL', 'RETUR', 'REFUND'].includes(String(r.status || '').toUpperCase()) ? String(r.status).toUpperCase() : (r.status || 'NORMAL')}
          onChange={e => onReceivingStatusChange(r, e.target.value)}
        >
          {r.status && !['NORMAL', 'RETUR', 'REFUND'].includes(String(r.status).toUpperCase()) && (
            <option value={r.status} disabled>{prettyReceivingStatus(r.status)} (status lama)</option>
          )}
          <option value="NORMAL">✓ Normal</option>
          <option value="RETUR">⚠️ Retur</option>
          <option value="REFUND">⚠️ Refund</option>
        </select>
        {prog && (
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: '10px',
            width: 'fit-content',
            whiteSpace: 'nowrap',
            ...(prog.allDone
              ? { background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }
              : { background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6' })
          }}>
            {prog.allDone ? `✓ LENGKAP (${prog.doneCount}/${prog.total})` : `⏳ PARSIAL (${prog.doneCount}/${prog.total})`}
          </span>
        )}
        {r.masuk_gudang ? (
          <span style={{ fontSize: '11px', color: '#137333', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            ✓ Di Stok Gudang
          </span>
        ) : r.tukang_at || r.alokasi === 'KE_TUKANG' ? (
          <span style={{ fontSize: '11px', color: '#1a73e8', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            👷 Ke Tukang (Handover)
          </span>
        ) : ['RETUR', 'REFUND'].includes(String(r.status || '').toUpperCase()) ? (
          <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 600, whiteSpace: 'nowrap' }}>
            ⚠️ {prettyReceivingStatus(r.status)} — stok tidak ditambah
          </span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '9px', color: '#71817d', fontWeight: 700, letterSpacing: '0.04em' }}>LANGKAH 2 — ALOKASI</span>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => onMoveToWarehouse(r)}
                style={{
                  background: '#e6f4ea',
                  color: '#137333',
                  border: '1px solid #ceead6',
                  borderRadius: '4px',
                  padding: '4px 7px',
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: 'fit-content'
                }}
                title="Tambah stok barang ke modul Materials"
              >
                📦 Masuk Stok Gudang
              </button>
              <button
                type="button"
                onClick={() => onSendToTukang(r)}
                style={{
                  background: '#e8f0fe',
                  color: '#1a73e8',
                  border: '1px solid #d2e3fc',
                  borderRadius: '4px',
                  padding: '4px 7px',
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: 'fit-content'
                }}
                title="Serah terima langsung ke tukang — masuk modul Handover"
              >
                👷 Serah Terima ke Tukang
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }
  if (h === 'note') {
    const pn = parseReceivingNote(rawVal)
    const href = notaHref(pn.notaUrl)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '240px', whiteSpace: 'normal', lineHeight: 1.4, fontSize: '12px' }}>
        {pn.nominal !== null && (
          <b style={{ color: '#137333' }}>💰 {rupiah(pn.nominal)}</b>
        )}
        {pn.notaUrl && (
          href ? (
            <a href={href} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', width: 'fit-content', background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', borderRadius: '4px', padding: '2px 7px', fontSize: '10px', fontWeight: 700, textDecoration: 'none' }}>
              📄 Nota / Resi
            </a>
          ) : (
            <span style={{ width: 'fit-content', background: '#eef3f1', color: '#1f3a34', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '2px 7px', fontSize: '10px', fontWeight: 600 }}>
              📄 {pn.notaUrl}
            </span>
          )
        )}
        {pn.extra ? <span>{pn.extra}</span> : (pn.nominal === null && !pn.notaUrl ? format(rawVal) : null)}
      </div>
    )
  }
  return null
}

// --- Aksi per baris (desktop) ---
export function rowActions(r, ctx) {
  const { title, page, onDelete } = ctx
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
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

// --- Baris perluasan: Langkah 1 — cek fisik item (qty diterima per barang) ---
export function rowExpand(r, ctx) {
  const { H, columns, expandedReceiving, setExpandedReceiving, onUpdateReceivingQty, onMarkReceivingItemReceived } = ctx
  const { receivingItemsForReceiving, itemReceiveStatus, itemBadgeStyle } = H
  if (!(receivingItemsForReceiving(r.id).length > 0)) return null
  return (
    <tr>
      <td colSpan={columns.length + 2} style={{ background: '#fbfdfc', padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#1f3a34' }}>
            📦 Langkah 1 — Cek Fisik Item (isi qty diterima, status Parsial/Lengkap dihitung otomatis)
          </div>
          <button
            type="button"
            onClick={() => setExpandedReceiving(expandedReceiving === r.id ? null : r.id)}
            style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34' }}
          >
            {expandedReceiving === r.id ? '▲ Tutup item' : `▼ Lihat ${receivingItemsForReceiving(r.id).length} item`}
          </button>
        </div>
        {expandedReceiving === r.id && (
          <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', width: '40px' }}>No</th>
                <th style={{ padding: '6px 8px' }}>Nama Item</th>
                <th style={{ padding: '6px 8px', width: '110px' }}>Qty Dipesan (PR)</th>
                <th style={{ padding: '6px 8px', width: '110px' }}>Qty Diterima</th>
                <th style={{ padding: '6px 8px', width: '70px' }}>Satuan</th>
                <th style={{ padding: '6px 8px', width: '170px' }}>Status Fisik</th>
                <th style={{ padding: '6px 8px', width: '110px', textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {receivingItemsForReceiving(r.id).map((it, i) => {
                const st = itemReceiveStatus(it)
                return (
                  <tr key={it.id} style={{ borderBottom: '1px solid #e1e7e4' }}>
                    <td style={{ padding: '6px 8px' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{it.item_name}</td>
                    <td style={{ padding: '6px 8px' }}>{st.ordered !== null ? `${st.ordered} ${it.unit || ''}` : '—'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <input
                        type="number"
                        min="0"
                        value={it.quantity_received ?? ''}
                        placeholder="0"
                        onChange={e => onUpdateReceivingQty(it, e.target.value)}
                        style={{ width: '70px', padding: '3px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd8d4' }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>{it.unit || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', whiteSpace: 'nowrap', ...itemBadgeStyle(st.key) }}>
                        {st.text}
                      </span>
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => onMarkReceivingItemReceived(it)}
                        style={{ background: st.key === 'PARSIAL' ? '#b45309' : '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                        title="Simpan qty & konfirmasi penerimaan fisik"
                      >
                        {st.key === 'PARSIAL' ? '✓ Update Terima' : '✓ Cek Fisik'}
                      </button>
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
  const { H, page, onDelete, onUpdateReceivingQty, onMarkReceivingItemReceived,
          onMoveToWarehouse, onSendToTukang } = ctx
  const { receivingProgress, receivingItemsForReceiving, itemReceiveStatus, itemBadgeStyle } = H
  const prog = receivingProgress(r.id)
  const pn = parseReceivingNote(r.note)
  const href = notaHref(pn.notaUrl)
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.invoice_no || r.delivery_note || 'Penerimaan'}</b>
          <div className="mobile-card-sub">{r.project_name || 'Tanpa Project'}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
          <span className={`badge ${isReceivingKendala(r.status) ? 'status-REJECTED' : 'status-APPROVED'}`} style={{ fontSize: '10px' }}>
            {prettyReceivingStatus(r.status)}
          </span>
          {prog && (
            <span style={{
              fontSize: '9px',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '8px',
              whiteSpace: 'nowrap',
              ...(prog.allDone
                ? { background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }
                : { background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6' })
            }}>
              {prog.allDone ? `✓ LENGKAP (${prog.doneCount}/${prog.total})` : `⏳ PARSIAL (${prog.doneCount}/${prog.total})`}
            </span>
          )}
        </div>
      </div>
      <div className="mobile-card-body">
        {r.delivery_note && (
          <div className="mobile-card-row">
            <span className="mobile-label">Surat Jalan:</span>
            <span className="mobile-val">{r.delivery_note}</span>
          </div>
        )}
        <div className="mobile-card-row">
          <span className="mobile-label">Tgl Terima:</span>
          <span className="mobile-val">{format(r.received_date)}</span>
        </div>
        {pn.nominal !== null && (
          <div className="mobile-card-row">
            <span className="mobile-label">Nominal Riil:</span>
            <span className="mobile-val" style={{ color: '#137333', fontWeight: 700 }}>{rupiah(pn.nominal)}</span>
          </div>
        )}
        {pn.notaUrl && (
          <div className="mobile-card-row">
            <span className="mobile-label">Nota / Resi:</span>
            <span className="mobile-val">
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', borderRadius: '4px', padding: '2px 7px', fontSize: '10px', fontWeight: 700, textDecoration: 'none' }}>
                  📄 Buka Nota
                </a>
              ) : (
                `📄 ${pn.notaUrl}`
              )}
            </span>
          </div>
        )}
        {pn.extra && (
          <div className="mobile-card-note">
            <b>Catatan:</b> {pn.extra}
          </div>
        )}
        {receivingItemsForReceiving(r.id).length > 0 && (
          <div className="mobile-card-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
            <span className="mobile-label">Item (Langkah 1 — Cek Fisik):</span>
            <div className="mobile-items-box" style={{ width: '100%' }}>
              {receivingItemsForReceiving(r.id).map(it => {
                const st = itemReceiveStatus(it)
                return (
                  <div key={it.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingBottom: '8px', marginBottom: '8px', borderBottom: '1px dashed #d5e0dc' }}>
                    <span style={{ fontWeight: 600 }}>• {it.item_name}</span>
                    <span style={{ fontSize: '11px', color: '#556b65' }}>Dipesan: {st.ordered ?? '—'} {it.unit || ''} · Diterima: {st.rec} {it.unit || ''}</span>
                    <span style={{ width: 'fit-content', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', ...itemBadgeStyle(st.key) }}>
                      {st.text}
                    </span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '3px' }}>
                      <input
                        type="number"
                        min="0"
                        value={it.quantity_received ?? ''}
                        placeholder="0"
                        onChange={e => onUpdateReceivingQty(it, e.target.value)}
                        style={{ width: '65px', padding: '3px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd8d4' }}
                      />
                      <button
                        type="button"
                        onClick={() => onMarkReceivingItemReceived(it)}
                        style={{ background: st.key === 'PARSIAL' ? '#b45309' : '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', fontWeight: 600 }}
                      >
                        {st.key === 'PARSIAL' ? '✓ Update' : '✓ Cek Fisik'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
      <div className="mobile-card-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {r.masuk_gudang ? (
          <span style={{ fontSize: '12px', color: '#137333', fontWeight: 700 }}>✓ Di Stok Gudang</span>
        ) : r.tukang_at || r.alokasi === 'KE_TUKANG' ? (
          <span style={{ fontSize: '12px', color: '#1a73e8', fontWeight: 700 }}>👷 Ke Tukang (Handover)</span>
        ) : ['RETUR', 'REFUND'].includes(String(r.status || '').toUpperCase()) ? (
          <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>⚠️ {prettyReceivingStatus(r.status)} — stok tidak ditambah</span>
        ) : (
          <>
            <span style={{ fontSize: '10px', color: '#71817d', fontWeight: 700, letterSpacing: '0.04em' }}>LANGKAH 2 — ALOKASI AKHIR</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => onMoveToWarehouse(r)}
                style={{ flex: 1, background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6', borderRadius: '6px', padding: '8px', fontSize: '11px', fontWeight: 700 }}
              >
                📦 Masuk Stok Gudang
              </button>
              <button
                type="button"
                onClick={() => onSendToTukang(r)}
                style={{ flex: 1, background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', borderRadius: '6px', padding: '8px', fontSize: '11px', fontWeight: 700 }}
              >
                👷 Serah ke Tukang
              </button>
            </div>
          </>
        )}
        <button type="button" className="btn-delete" onClick={() => onDelete(page, r)} style={{ width: '100%' }}>
          Hapus Penerimaan
        </button>
      </div>
    </>
  )
}
