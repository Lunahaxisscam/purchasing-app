// ============================================================
// modules/approvals/detailDrawer.jsx — Drawer Detail Approval (t_ff02257a S1)
// ============================================================
// Arahan DAT (t_ff02257a): daftar Approval tetap COMPACT — rincian item
// material & catatan tolak/revisi dibuka lewat drawer/modal, BUKAN baris
// perluasan di dalam <tbody> (portal ke document.body — tidak memecah
// geometri tabel master-detail rowSpan).
//
// ============================================================
// KOREKSI t_7634fa92 (pra-review, Bamboo) — CAPABILITY YANG HILANG
// ============================================================
// Commit asli 8148465 memindahkan tombol "▼ Material (n)" (panel perluasan
// tbody) menjadi drawer BACA-SAJA. Akibatnya, pada baseline integrasi:
//   - `expandedApproval` TIDAK PERNAH di-set lagi -> rowExpand() di view.jsx
//     menjadi kode mati;
//   - tombol per-item "✓ Setujui" (onApproveItem) dan "🛒 Sudah Order"
//     (onMarkPrItemOrdered) TIDAK bisa dijangkau dari UI mana pun.
// Kedua aksi itu bukan sekadar tampilan: keduanya memanggil
// ensureItemInPurchase() lalu meng-update pr_items.status (lihat
// pages/index.js approveItem / markPrItemOrdered). Jadi port ini DIAM-DIAM
// MENGHILANGKAN alur "setujui material satu per satu" — persis yang dilarang
// arahan ("preserve admin guards, all routes, advanced PR values").
// Ditangkap oleh scripts/pr-group-test (G), scripts/pr-estimator-test,
// scripts/showmore-list-test yang semuanya mencari tombol "Material (".
//
// PERBAIKAN: drawer tetap jadi satu-satunya jangkar (geometri tabel aman),
// tetapi isinya TIDAK lagi baca-saja untuk aksi yang memang milik baris:
//   - rincian item per kategori + subtotal + Total Estimasi (seperti aslinya)
//   - tombol "✓ Setujui" per item saat status PENDING (onApproveItem)
//   - tombol "🛒 Sudah Order" per item saat APPROVED & PR sudah disetujui
//     (onMarkPrItemOrdered)
// Keputusan tingkat PR (Setujui/Tolak/Revisi) TETAP di baris/kartu daftar —
// drawer tidak menambah jalur keputusan baru, hanya mengembalikan aksi
// per-item yang hilang.
// ============================================================
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

function ApprovalDetailDialog({ H, r, close, allMaterials, onApproveItem, onMarkPrItemOrdered, itemState }) {
  // Escape key closes dialog
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const matMap = materialMapFrom(allMaterials)
  const rawItems = H.approvalItems(r)
  const rows = H.approvalItemRows(r).map(row => ({ ...row }))
  const groups = rawItems.length
    ? groupItemsByCategory(rawItems, matMap)
    : []
  const est = prEstimateRows(rawItems, matMap)
  return createPortal(
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 25, 22, 0.45)',
        zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center',
        padding: '24px 16px', boxSizing: 'border-box'
      }}
    >
      <div
        role="dialog"
        aria-label={`Rincian approval ${r.pr_number || 'PR'}`}
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(640px, 94vw)', maxWidth: '100%', maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto', overflowX: 'hidden', background: '#fff', color: '#1f3a34',
          borderRadius: '12px',
          boxShadow: '0 12px 36px rgba(0,0,0,0.22)',
          boxSizing: 'border-box'
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
          {/* Rincian item material. KOREKSI t_7634fa92: bukan lagi baca-saja
              untuk aksi per-item (lihat catatan kepala berkas). */}
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
                    const price = savedPriceOf(it, matMap)
                    const q = Number(it.quantity)
                    if (price === null || !isFinite(q) || q <= 0) continue
                    subtotal = (subtotal || 0) + Math.round(q * price)
                  }
                  return (
                    <div key={gi} style={{ marginBottom: '8px' }}>
                      <div className="ap-group-heading"><span>{groupHeadingText(g.heading)}</span></div>
                      <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                            <th style={{ padding: '4px 6px' }}>Item</th>
                            <th style={{ padding: '4px 6px', width: '70px', textAlign: 'right' }}>Qty</th>
                            <th style={{ padding: '4px 6px', width: '90px', textAlign: 'right' }}>Subtotal</th>
                            <th style={{ padding: '4px 6px', width: '96px', textAlign: 'center' }}>Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.items.map((it, ii) => {
                            const price = savedPriceOf(it, matMap)
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
                                {/* KOREKSI t_7634fa92: aksi per-item yang dulu
                                    hidup di panel perluasan tbody dikembalikan
                                    di drawer (satu-satunya jangkar sekarang).
                                    Gerbang izin SAMA PERSIS dengan
                                    approvalItemTr di view.jsx: PENDING -> boleh
                                    setujui; APPROVED & PR disetujui -> boleh
                                    tandai sudah order. Tidak ada jalur baru. */}
                                <td style={{ padding: '4px 6px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  {(() => {
                                    const st = itemState ? itemState(it) : null
                                    const canApprove = st === 'PENDING' && (r.status === 'PENDING' || r.status === 'APPROVED')
                                    const canOrder = st === 'APPROVED' && r.status === 'APPROVED'
                                    if (st === 'ORDERED') {
                                      return <span style={{ fontSize: '10px', color: '#137333' }}>✓ Sudah Order</span>
                                    }
                                    if (canOrder && onMarkPrItemOrdered) {
                                      return (
                                        <button
                                          type="button"
                                          onClick={() => onMarkPrItemOrdered(it)}
                                          style={{ background: '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}
                                        >
                                          🛒 Sudah Order
                                        </button>
                                      )
                                    }
                                    if (canApprove && onApproveItem) {
                                      return (
                                        <button
                                          type="button"
                                          onClick={() => onApproveItem(it)}
                                          style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}
                                        >
                                          ✓ Setujui
                                        </button>
                                      )
                                    }
                                    return <span style={{ fontSize: '10px', color: '#71817d' }}>—</span>
                                  })()}
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

export function approvalDetail(props) {
  if (!props?.r || !props?.H || !props?.close) return null
  return <ApprovalDetailDialog {...props} />
}
