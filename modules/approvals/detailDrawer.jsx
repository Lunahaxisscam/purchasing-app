// ============================================================
// modules/approvals/detailDrawer.jsx — Drawer Detail Approval (t_ff02257a S1)
// ============================================================
// Arahan DAT (t_ff02257a): daftar Approval tetap COMPACT — rincian item
// material & catatan tolak/revisi dibuka lewat drawer/modal, BUKAN baris
// perluasan di dalam <tbody> (portal ke document.body — tidak memecah
// geometri tabel master-detail rowSpan).
//
// Murni TAMPILAN (read-only): tidak ada tombol keputusan, tidak ada tulis
// DB. Keputusan (Setujui/Tolak/Revisi) & gerbang perluasan material per item
// tetap di baris/kartu daftar (modules/approvals/view.jsx) — alur, status,
// dan permission TIDAK berubah.
//
// Label Total Estimasi = snapshot pr_items tersimpan (sumber & semantik SAMA
// 1:1 dengan t_ac0b39c0 di view.jsx): item tanpa harga ≠ 0 → label
// "belum lengkap". TOTAL PARSIAL TIDAK PERNAH diklaim lengkap.
// ============================================================
import React from 'react'
import { createPortal } from 'react-dom'
import { format, rupiah } from '../../lib/constants'
// Sumber & semantik sama persis dengan modules/approvals/view.jsx.
import {
  prEstimateRows, groupItemsByCategory, groupHeadingText, materialMapFrom
} from '../requests/view'
import { displayNote, savedPriceOf } from './view'

export function approvalDetail({ H, r, close, allMaterials }) {
  if (!r || !H || !close) return null

  const rawItems = H.approvalItems(r)
  const rows = H.approvalItemRows(r).map(row => ({ ...row }))
  const groups = rawItems.length
    ? groupItemsByCategory(rawItems, materialMapFrom(allMaterials))
    : []
  const est = prEstimateRows(rawItems)
  return createPortal(
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 25, 22, 0.45)',
        zIndex: 1000, display: 'flex', justifyContent: 'flex-end', alignItems: 'stretch'
      }}
    >
      <div
        role="dialog"
        aria-label={`Rincian approval ${r.pr_number || 'PR'}`}
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(440px, 100%)', maxWidth: '100%', height: '100%',
          overflowY: 'auto', background: '#fff', color: '#1f3a34',
          borderTopLeftRadius: '12px', borderBottomLeftRadius: '12px',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.18)'
        }}
      >
        {/* Header: identitas dokumen + tombol Tutup */}
        <div style={{
          position: 'sticky', top: 0, background: '#fff', borderBottom: '1px solid #e1e7e4',
          padding: '14px 16px', display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center'
        }}>
          <div>
            <b style={{ fontSize: '15px' }}>{r.pr_number || 'PR'}</b>
            <span className={`badge status-${r.status}`} style={{ marginLeft: '8px' }}>{r.status}</span>
          </div>
          <button
            type="button"
            onClick={close}
            style={{
              background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '6px',
              padding: '4px 10px', fontSize: '12px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34'
            }}
          >
            ✕ Tutup
          </button>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Identitas PR */}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>{format(r.title)}</div>
            <div style={{ fontSize: '12px', color: '#556b65' }}>{format(r.project_name)}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 8px', fontSize: '12px' }}>
            <span style={{ fontWeight: 600, color: '#556b65' }}>Step</span><span>{format(r.step_number)}</span>
            <span style={{ fontWeight: 600, color: '#556b65' }}>Waktu Putusan</span><span>{format(r.decided_at)}</span>
          </div>
          {/* Catatan: HANYA catatan pengguna (aturan t_1fe52e80 tetap berlaku
              — sisa auto-seed legacy tampil dash, tidak pernah diarakan) */}
          <div style={{ background: '#fbfdfc', border: '1px solid #e1e7e4', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#556b65', marginBottom: '4px' }}>CATATAN</div>
            <div style={{ fontSize: '12px', whiteSpace: 'normal', overflowWrap: 'break-word' }}>{format(displayNote(r))}</div>
          </div>
          {/* Rincian item material (murni baca) — fallback legacy tetap didukung */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#556b65', marginBottom: '6px' }}>
              RINCIAN MATERIAL
            </div>
            {!rawItems.length ? (
              <div style={{ fontSize: '12px', color: '#71817d' }}>
                {rows.length
                  ? rows.map((row, i) => (
                    <div key={i} style={{ paddingLeft: '12px', textIndent: '-12px' }}>• {row.text} — {row.qty}</div>
                  ))
                  : 'Rincian per barang belum tersimpan untuk PR ini.'}
              </div>
            ) : (
              <>
                {groups.map((g, gi) => {
                  // Subtotal kategori: hanya item dengan harga snapshot valid
                  // (sumber & aturan skip sama dengan panel perluasan view.jsx)
                  let subtotal = null
                  for (const it of g.items) {
                    const price = savedPriceOf(it)
                    const q = Number(it.quantity)
                    if (price === null || !isFinite(q) || q <= 0) continue
                    subtotal = (subtotal || 0) + Math.round(q * price)
                  }
                  return (
                    <div key={gi} style={{ marginBottom: '8px' }}>
                      <div className="ap-group-heading"><span>{groupHeadingText(g.heading)}</span></div>
                      <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                        <tbody>
                          {g.items.map((it, ii) => {
                            const price = savedPriceOf(it)
                            const q = Number(it.quantity)
                            const subtotalIt = (price !== null && isFinite(q) && q > 0)
                              ? Math.round(q * price) : null
                            return (
                              <tr key={ii} style={{ borderBottom: '1px solid #e1e7e4' }}>
                                <td style={{ padding: '4px 6px' }}>
                                  <b>{it.kode || '—'}</b>
                                  {' '}{it.item_name || it.text}
                                </td>
                                <td style={{ padding: '4px 6px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                  {it.quantity ?? it.qty}{it.unit ? ` ${it.unit}` : ''}
                                </td>
                                <td style={{
                                  padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap',
                                  color: subtotalIt !== null ? '#137333' : '#b45309', fontWeight: 600
                                }}>
                                  {/* Item tanpa harga = "belum ada harga" — BUKAN 0 */}
                                  {subtotalIt !== null ? rupiah(subtotalIt) : 'belum ada harga'}
                                </td>
                              </tr>
                            )
                          })}
                          {subtotal !== null && subtotal !== undefined && (
                            <tr>
                              <td colSpan={2} style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>
                                Subtotal:
                              </td>
                              <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 700, color: '#137333', whiteSpace: 'nowrap' }}>
                                {rupiah(subtotal)}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
                {/* Total Estimasi PR — snapshot tersimpan; label jujur bila
                    belum lengkap (aturan t_e88c28fb tetap berlaku) */}
                {est.hasItems && (
                  <div style={{
                    borderTop: '2px solid #1f3a34', background: '#fbfdfc',
                    padding: '8px 10px', display: 'flex', justifyContent: 'space-between', gap: '8px'
                  }}>
                    <b style={{ fontSize: '12px' }}>
                      Total Estimasi{est.complete ? '' : ' (belum lengkap)'}:
                    </b>
                    <b style={{ fontSize: '12px', whiteSpace: 'nowrap', color: est.complete ? '#137333' : '#b45309' }}>
                      {rupiah(est.total)}{!est.complete ? ` — ${est.unknown} item belum ada harga` : ''}
                    </b>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
