// ============================================================
// modules/receivings/view.jsx — Purchase / Receiving
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Purchase / Receiving diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// REVISI 16 Okt 2026 (t_5196b689, arahan DAT):
//   - Panel legacy "📦 Langkah 1 — Cek Fisik Item" + toggle "Lihat X item" +
//     tabel cek-fisik inline DIHAPUS TOTAL (bukan ganti judul / sembunyi CSS).
//   - Pengganti: SATU tombol "Terima Barang" (atau "Lihat Barang" bila sudah
//     lengkap) yang membuka modal ReceiptForm per item. Input qty TIDAK lagi
//     menulis DB saat mengetik — hanya saat "Simpan Penerimaan".
//   - Kolom daftar menampilkan ringkasan nama/jumlah item (bukan cuma
//     invoice/status).
//   - Kondisi (rusak), tujuan (WS/tukang), retur: divalidasi di form; dimensi
//     yang belum ada kolomnya di skema ditandai gap (lihat receiptLogic.js) —
//     TIDAK di-packing ke kolom note, tidak ada migrasi.
// ============================================================
import React from 'react'
import { format, rupiah, parseReceivingNote, notaHref, prettyReceivingStatus, isReceivingKendala } from '../../lib/constants'
import ReceiptForm from './receiptForm'
import { itemRingkas } from './receiptLogic'

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

// --- Header kolom khusus: ringkasan barang ---
export function header(h) {
  if (h === 'items') return '📦 Barang'
  return null
}

// Badge progres qty yang TIDAK menyamakan dimensi:
//   - over-receipt (datang > dipesan) → merah "Melebihi pesanan" (audit G1)
//   - nota kendala (Retur/Refund) dengan qty penuh → jangan hijau "LENGKAP";
//     dimensi qty vs dimensi status nota dipisah tegas (audit G9).
function progressBadge(prog, status) {
  const base = { fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', width: 'fit-content', whiteSpace: 'nowrap' }
  const over = prog.statuses.some(s => s.key === 'OVER')
  if (over) {
    return { text: `⚠ Melebihi pesanan (${prog.statuses.filter(s => s.key === 'OVER').map(s => `${s.rec}/${s.ordered}`).join(', ')})`, style: { ...base, background: '#fdecea', color: '#c93b2b', border: '1px solid #f5c6c0' } }
  }
  if (prog.allDone && prog.kendala) {
    return { text: `Qty penuh (${prog.doneCount}/${prog.total}) · nota ${prettyReceivingStatus(status)}`, style: { ...base, background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6' } }
  }
  if (prog.allDone) {
    return { text: `✓ LENGKAP (${prog.doneCount}/${prog.total})`, style: { ...base, background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' } }
  }
  return { text: `⏳ PARSIAL (${prog.doneCount}/${prog.total})`, style: { ...base, background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6' } }
}

// Nilai alokasi tak dikenal (mis. 'LANGSUNG_LAPANGAN' di data lama) ditampilkan
// APA ADANYA — jangan disembunyikan / ditafsirkan ulang (kontrak audit A2).
function unknownAlokasi(r) {
  const a = String(r.alokasi || '').toUpperCase()
  if (!a) return null
  if (a === 'MASUK_GUDANG' || a === 'KE_TUKANG') return null
  return r.alokasi
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal, ctx) {
  const { H, onReceivingStatusChange } = ctx
  const { receivingProgress } = H

  if (h === 'items') {
    const items = H.receivingItemsForReceiving(r.id)
    const ring = itemRingkas(items)
    if (!ring.count) {
      return <span style={{ fontSize: '11px', color: '#9aa8a4' }}>Belum ada rincian</span>
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '220px', whiteSpace: 'normal', lineHeight: 1.35 }}>
        <b style={{ fontSize: '12px' }}>{ring.count} item</b>
        <span style={{ fontSize: '11px', color: '#556b65' }} title={ring.names.join(', ')}>{ring.ringkas}</span>
      </div>
    )
  }

  if (h === 'status') {
    const prog = receivingProgress(r.id, isReceivingKendala(r.status))
    const alokasiAsing = unknownAlokasi(r)
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
        {prog && (() => { const b = progressBadge(prog, r.status); return <span style={b.style}>{b.text}</span> })()}
        {r.masuk_gudang ? (
          <span style={{ fontSize: '11px', color: '#137333', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            ✓ Di Stok Gudang
          </span>
        ) : r.tukang_at || String(r.alokasi || '').toUpperCase() === 'KE_TUKANG' ? (
          <span style={{ fontSize: '11px', color: '#1a73e8', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            👷 Ke Tukang (Handover)
          </span>
        ) : ['RETUR', 'REFUND'].includes(String(r.status || '').toUpperCase()) ? (
          <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 600, whiteSpace: 'nowrap' }}>
            ⚠️ {prettyReceivingStatus(r.status)} — stok tidak ditambah
          </span>
        ) : null}
        {alokasiAsing && (
          <span style={{ fontSize: '10px', color: '#71817d', fontWeight: 600, whiteSpace: 'nowrap' }} title="Nilai alokasi dari data lama — ditampilkan apa adanya">
            📌 Alokasi: {alokasiAsing}
          </span>
        )}
        {!r.masuk_gudang && !r.tukang_at && String(r.alokasi || '').toUpperCase() !== 'KE_TUKANG' && !['RETUR', 'REFUND'].includes(String(r.status || '').toUpperCase()) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '9px', color: '#71817d', fontWeight: 700, letterSpacing: '0.04em' }}>TUJUAN SETELAH DITERIMA</span>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => ctx.onMoveToWarehouse(r)}
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
                title="Tambah stok barang yang sudah diterima ke modul Materials"
              >
                📦 Masuk Stok Gudang
              </button>
              <button
                type="button"
                onClick={() => ctx.onSendToTukang(r)}
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
                title="Buat antrean serah terima ke tukang — belum dikonfirmasi sampai serah terima fisik dicatat"
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

// --- Aksi per baris (desktop): Terima Barang + Hapus ---
// Satu pintu input penerimaan: tombol membuka modal ReceiptForm (per item).
// Label "Lihat Barang" dipakai bila semua item sudah lengkap & nota bukan
// kendala (untuk sekadar meninjau rincian/qty).
export function rowActions(r, ctx) {
  const { title, page, onDelete, setReceiptRow, H } = ctx
  const prog = H.receivingProgress(r.id, isReceivingKendala(r.status))
  const done = !!(prog && prog.allDone && !prog.kendala)
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', justifyContent: 'center', alignItems: 'stretch', width: '120px', margin: '0 auto' }}>
        <button
          type="button"
          onClick={() => setReceiptRow(r)}
          data-testid={`btn-terima-${r.id}`}
          style={{ background: '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 8px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', width: '100%' }}
          title={done ? 'Lihat rincian barang penerimaan ini' : 'Terima barang — isi jumlah datang per item'}
        >
          {done ? '📦 Lihat Barang' : '📦 Terima Barang'}
        </button>
        <button
          type="button"
          className="btn-delete"
          onClick={() => onDelete(page, r)}
          title={`Hapus ${title}`}
          style={{ width: '100%' }}
        >
          Hapus
        </button>
      </div>
    </td>
  )
}

// --- Baris perluasan: DIHAPUS (t_5196b689) ---
// Panel "Langkah 1 — Cek Fisik Item" + toggle "Lihat X item" + tabel qty
// inline sudah digantikan modal Terima Barang. rowExpand sengaja TIDAK
// diekspor lagi supaya tidak ada tampilan lama yang tersisa desktop/mobile.
// Fungsi pencatatan qty dipindah ke ReceiptForm (submit tunggal).

// --- Kartu mobile ---
export function mobileCard(r, ctx) {
  const { H, page, onDelete, setReceiptRow } = ctx
  const { receivingProgress, receivingItemsForReceiving } = H
  const prog = receivingProgress(r.id, isReceivingKendala(r.status))
  const pn = parseReceivingNote(r.note)
  const href = notaHref(pn.notaUrl)
  const ring = itemRingkas(receivingItemsForReceiving(r.id))
  const done = !!(prog && prog.allDone && !prog.kendala)
  const alokasiAsing = unknownAlokasi(r)
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
          {prog && (() => { const b = progressBadge(prog, r.status); return <span style={{ ...b.style, fontSize: '9px', borderRadius: '8px' }}>{b.text}</span> })()}
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
        <div className="mobile-card-row">
          <span className="mobile-label">Barang:</span>
          <span className="mobile-val">{ring.count ? `${ring.count} item — ${ring.ringkas}` : 'Belum ada rincian'}</span>
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
        {alokasiAsing && (
          <div className="mobile-card-row">
            <span className="mobile-label">Alokasi:</span>
            <span className="mobile-val">📌 {alokasiAsing}</span>
          </div>
        )}
      </div>
      <div className="mobile-card-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          type="button"
          onClick={() => setReceiptRow(r)}
          data-testid={`btn-terima-mobile-${r.id}`}
          style={{ width: '100%', background: '#1f3a34', color: '#fff', border: 'none', borderRadius: '6px', padding: '9px', fontSize: '12px', fontWeight: 700 }}
        >
          {done ? '📦 Lihat Barang' : '📦 Terima Barang'}
        </button>
        {r.masuk_gudang ? (
          <span style={{ fontSize: '12px', color: '#137333', fontWeight: 700 }}>✓ Di Stok Gudang</span>
        ) : r.tukang_at || String(r.alokasi || '').toUpperCase() === 'KE_TUKANG' ? (
          <span style={{ fontSize: '12px', color: '#1a73e8', fontWeight: 700 }}>👷 Ke Tukang (Handover)</span>
        ) : ['RETUR', 'REFUND'].includes(String(r.status || '').toUpperCase()) ? (
          <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>⚠️ {prettyReceivingStatus(r.status)} — stok tidak ditambah</span>
        ) : (
          <>
            <span style={{ fontSize: '10px', color: '#71817d', fontWeight: 700, letterSpacing: '0.04em' }}>TUJUAN SETELAH DITERIMA</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => ctx.onMoveToWarehouse(r)}
                style={{ flex: 1, background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6', borderRadius: '6px', padding: '8px', fontSize: '11px', fontWeight: 700 }}
              >
                📦 Masuk Stok Gudang
              </button>
              <button
                type="button"
                onClick={() => ctx.onSendToTukang(r)}
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

// --- Modal Terima Barang (dirender shell lewat dispatcher) ---
// ctx.receiptRow = baris Purchase yang dipilih (null = modal tertutup).
export function receiptForm(ctx) {
  const { receiptRow, setReceiptRow, H, say, refresh } = ctx
  if (!receiptRow) return null
  const prId = receiptRow.purchase_request_id
  return (
    <ReceiptForm
      receiving={receiptRow}
      items={H.receivingItemsForReceiving(receiptRow.id)}
      prItems={prId ? H.prItemsForPr(prId) : []}
      orderedFor={H.orderedQtyFor}
      say={say}
      refresh={refresh}
      close={() => setReceiptRow(null)}
    />
  )
}
