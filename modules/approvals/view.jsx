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
import { format, rupiah } from '../../lib/constants'
// Total Estimasi PR (t_ac0b39c0): snapshot harga tersimpan pr_items —
// read-only di Approval (detail persetujuan), resolver/list jujur sumbernya.
import { prEstimateRows } from '../requests/view'

// ============================================================
// CATATAN APPROVAL — aturan render (t_1fe52e80)
// ============================================================
// Kolom/note card "Catatan" HANYA berisi catatan yang benar-benar diketik
// pengguna. Approval baru dibuat TANPA note (null) — teks "Menunggu
// persetujuan..." tidak pernah disemai lagi (pages/index.js finishPr sudah
// berhenti menyemai). Untuk data lama yang pernah disemai otomatis oleh
// versi aplikasi sebelumnya, teks tsb digantikan dash "—" saat render
// (TIDAK ada mutasi DB). Deteksi legacy dilakukan dua lapis agar catatan
// pengguna yang KEBETULAN mengandung frasa yang sama tidak pernah
// disembunyikan:
//   1) TEKS: harus sama persis dengan satu pola auto-generate yang dikenal
//      (setelah trim). Pola dijaga ketat — menambah pola baru di sini hanya
//      jika pola itu memang lahir dari kode auto-generate.
//   2) METADATA: baris approval harus berasal dari jalur auto-seed, yaitu
//      step pertama yang dibuat finishPr (step_number === 1) dan BELUM
//      diputuskan (decided_at kosong). Catatan keputusan (selalu punya
//      decided_at) tidak pernah memenuhi syarat, apa pun teksnya.
// Keterbatasan (didokumentasikan, tidak ada cleanup palsu): bila pengguna
// lama sengaja mengetik teks yang 100% identik dengan pola auto pada step-1
// yang masih pending, teksnya ikut tampil sebagai dash — kasus ini tidak
// bisa dibedakan dari luar tanpa kolom provenance di DB (tidak ada migrasi).
// ============================================================

// Pola teks auto-generate yang pernah dipakai aplikasi saat membuat/
// mengaktifkan approval step (exact match setelah trim). SATU-SATUNYA sumber
// pola: template literal di finishPr() pages/index.js sebelum t_1fe52e80.
const LEGACY_AUTO_NOTE_PATTERNS = [
  /^Menunggu persetujuan Direksi \/ PM untuk .*$/ // `Menunggu persetujuan Direksi / PM untuk ${pr.pr_number || 'PR'}`
]

// True bila note adalah sisa auto-seed legacy yang aman diganti dash.
export function isLegacyAutoNote(r) {
  const note = typeof r?.note === 'string' ? r.note.trim() : null
  if (!note) return false
  // Lapis 2 (metadata): hanya step-1 yang belum diputuskan yang pernah
  // di-seed otomatis. Catatan keputusan tidak pernah lolos gerbang ini.
  if (r.step_number !== 1 || r.decided_at) return false
  // Lapis 1 (teks): exact match ke pola yang dikenal.
  return LEGACY_AUTO_NOTE_PATTERNS.some(re => re.test(note))
}

// Teks catatan siap render: null/'' -> null (dash oleh format()),
// sisa auto-seed legacy -> null, catatan pengguna -> utuh apa adanya.
export function displayNote(r) {
  if (isLegacyAutoNote(r)) return null
  const note = r?.note
  if (note === null || note === undefined || note === '') return null
  return note
}

// --- Filter tabs ---
// Urutan tab (arahan DAT t_0a35264f): antrean "⏳ Menunggu" SELALU di posisi
// pertama dan aktif secara default (state awal approvalFilter='PENDING' di
// ModuleView.js). Riwayat tetap bisa dibuka eksplisit lewat tab-nya; data
// tidak pernah dihapus. "Semua" dipindah ke akhir karena bukan antrean kerja.
export function filters(ctx) {
  const { rows, approvalFilter, setApprovalFilter } = ctx
  return (
    <div className="filter-tabs">
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
      <button
        type="button"
        className={`pill ${approvalFilter === 'all' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('all')}
      >
        Semua ({rows.length})
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
  // Kolom Catatan (t_1fe52e80): hanya catatan pengguna; sisa auto-seed legacy
  // tampil dash. Null/'' dirender dash via format() — konsisten dgn modul lain.
  if (h === 'note') {
    const note = displayNote(r)
    return (
      <div style={{ whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.4, fontSize: '12px' }}>
        {format(note)}
      </div>
    )
  }
  return null
}

// --- Aksi per baris (desktop): Setujui / Tolak / Revisi + perluasan material ---
// Standar Noir Living (review Brooklyn #B.3): kolom aksi tabel VERTIKAL —
// tombol tersusun ke bawah dengan lebar seragam supaya tidak melompat
// berantakan saat kolom menyempit di layar sempit.
export function rowActions(r, ctx) {
  const { H, expandedApproval, setExpandedApproval, onDecideApproval, onReviseApproval } = ctx
  const { approvalItemLines } = H
  return (
    <td style={{ textAlign: 'center' }}>
      {r.status === 'PENDING' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'stretch', width: '110px', margin: '0 auto' }}>
          <button
            type="button"
            onClick={() => onDecideApproval(r, 'APPROVED')}
            style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, width: '100%' }}
          >
            ✓ Setujui
          </button>
          <button
            type="button"
            onClick={() => onDecideApproval(r, 'REJECTED')}
            style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, width: '100%' }}
          >
            ✕ Tolak
          </button>
          <button
            type="button"
            onClick={() => onReviseApproval(r)}
            style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, width: '100%' }}
          >
            ✎ Revisi
          </button>
          {approvalItemLines(r).length > 0 && (
            <button
              type="button"
              onClick={() => setExpandedApproval(expandedApproval === r.id ? null : r.id)}
              style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34', width: '100%' }}
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
  // ============================================================
  // Total Estimasi (t_ac0b39c0): harga SNAPSHOT pr_items yang tersimpan —
  // read-only, TIDAK dihitung ulang dari histori terbaru saat dibuka ulang.
  // Item tanpa harga ≠ 0 → label "belum lengkap".
  // ============================================================
  const est = prEstimateRows(approvalItems(r))
  const savedPriceOf = (it) => {
    const raw = (it.estimated_price !== null && it.estimated_price !== undefined && it.estimated_price !== '')
      ? Number(it.estimated_price) : null
    return raw !== null && isFinite(raw) && raw >= 0 ? Math.round(raw) : null
  }
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
                <th style={{ padding: '4px 6px', width: '110px', textAlign: 'right' }}>Subtotal</th>
                <th style={{ padding: '4px 6px', width: '110px' }}>Status</th>
                <th style={{ padding: '4px 6px', width: '150px', textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {approvalItems(r).map(it => {
                const st = itemState(it)
                const canApprove = st === 'PENDING' && (r.status === 'PENDING' || r.status === 'APPROVED')
                const canOrder = st === 'APPROVED' && r.status === 'APPROVED'
                const price = savedPriceOf(it)
                const qNum = Number(it.quantity)
                const subtotal = (price !== null && isFinite(qNum) && qNum > 0) ? Math.round(qNum * price) : null
                return (
                  <tr key={it.id} style={{ borderBottom: '1px solid #e1e7e4' }}>
                    <td style={{ padding: '4px 6px' }}><b>{it.kode || '—'}</b></td>
                    <td style={{ padding: '4px 6px' }}>{it.item_name}</td>
                    <td style={{ padding: '4px 6px' }}>{it.quantity}</td>
                    <td style={{ padding: '4px 6px' }}>{it.unit || '—'}</td>
                    <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {/* Subtotal per item (snapshot): harga satuan × qty */}
                      {subtotal !== null
                        ? <>
                            <span className="muted" style={{ fontSize: '10px' }}>{rupiah(price)}</span>
                            <div style={{ fontWeight: 700, color: '#137333' }}>{rupiah(subtotal)}</div>
                          </>
                        : <span className="muted">—</span>}
                    </td>
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
              {/* ===== Total Estimasi PR — snapshot tersimpan, read-only ===== */}
              <tr className="pr-est-total-row">
                <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700, color: '#1f3a34', borderTop: '2px solid #1f3a34', background: '#fbfdfc' }}>
                  Total Estimasi{est.complete ? '' : ' (belum lengkap)'}:
                </td>
                <td style={{ fontWeight: 700, color: est.complete ? '#137333' : '#b45309', borderTop: '2px solid #1f3a34', background: '#fbfdfc', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {rupiah(est.total)}{!est.complete ? ` — ${est.unknown} item belum ada harga` : ''}
                </td>
                <td colSpan={2} style={{ borderTop: '2px solid #1f3a34', background: '#fbfdfc' }} />
              </tr>
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
        {/* Catatan (t_1fe52e80): hanya catatan pengguna yang tampil. Sisa
            auto-seed legacy & pending tanpa catatan sama-sama tampil dash. */}
        {displayNote(r) && (
          <div className="mobile-card-note">
            <b>Catatan:</b> {displayNote(r)}
          </div>
        )}
        {!displayNote(r) && r.status !== 'PENDING' && (
          <div className="mobile-card-note">
            <b>Catatan:</b> —
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
