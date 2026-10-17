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
import ReturnForm from './returnForm'
import { itemRingkas, parentSummary, bulkActionState } from './receiptLogic'
import { buildSplitPlan, applySplitPlan } from './receiptSplit'

// --- Banner modul: status penyimpanan per barang (jujur, dari probe) ---
// Ditampilkan SEBELUM user membuka form supaya tidak ada kejutan: kalau skema
// ledger belum ada, user tahu kondisi/tujuan/retur belum bisa disimpan.
export function banner(ctx) {
  const { capability } = ctx
  if (!capability) return null
  if (capability.ready) {
    return (
      <div data-testid="receipt-capability-banner" style={{ background: '#e6f4ea', border: '1px solid #ceead6', color: '#137333', borderRadius: '8px', padding: '8px 12px', fontSize: '12px' }}>
        ✓ Penyimpanan per barang aktif — kondisi (baik/rusak), tujuan (Workshop/Tukang), retur, dan rincian serah terima tersimpan per barang.
      </div>
    )
  }
  return (
    <div data-testid="receipt-capability-banner" style={{ background: '#fef6e7', border: '1px solid #fcdfa6', color: '#7a4a08', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', lineHeight: 1.45 }}>
      ⚠️ Penyimpanan per barang belum aktif: {(capability.missing || []).filter(m => !/^\(opsional\)/.test(m)).join('; ') || 'skema belum tersedia'}.
      Jumlah datang tetap bisa dicatat; kondisi/tujuan/retur per barang akan tersimpan setelah migrasi aditif (task t_03b41644). Tidak ada data yang ditulis setengah.
    </div>
  )
}

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

// Badge ringkasan parent (READ-ONLY) — DITURUNKAN dari hasil item, bukan
// dropdown default "Normal". Arahan DAT 16 Okt (t_b418827b):
//   - Qty 0 = "Belum diterima", BUKAN "Parsial".
//   - multi-item: "Sebagian", bukan "PARSIAL (0/2)" yang menyesatkan.
//   - over-receipt tetap merah (audit G1); nota kendala ≠ hijau (audit G9).
const TONE_STYLE = {
  red: { background: '#fdecea', color: '#c93b2b', border: '1px solid #f5c6c0' },
  amber: { background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6' },
  green: { background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' },
  muted: { background: '#f3f5f6', color: '#556260', border: '1px solid #d6dcde' }
}

function progressBadge(prog, status) {
  const base = { fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', width: 'fit-content', whiteSpace: 'nowrap' }
  const s = parentSummary(prog, { kendalaLabel: `nota ${prettyReceivingStatus(status)}` })
  return { text: s.text, style: { ...base, ...(TONE_STYLE[s.tone] || TONE_STYLE.muted) } }
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
  const { H } = ctx
  const { receivingProgress, receivingItemsForReceiving } = H

  if (h === 'items') {
    const items = receivingItemsForReceiving(r.id)
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
    const items = receivingItemsForReceiving(r.id)
    const bulk = bulkActionState(items, { ready: !!ctx.capability?.ready })
    // Arahan DAT 16 Okt: dropdown status parent DILARANG utk nota multi-item
    // (bisa meng-override anak). Utk nota 0/1 item, dropdown tetap ada TAPI
    // diberi label "Status Nota" — dimensi nota (Normal/Retur/Refund) yang
    // TERPISAH dari kondisi barang, bukan kondisi barang itu sendiri.
    const showNotaStatus = items.length <= 1
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {/* RINGKASAN READ-ONLY hasil item — DITURUNKAN dari item, bukan
            default "Normal". Kondisi & tujuan diisi per barang di dalam
            Terima Barang. */}
        {prog && (() => { const b = progressBadge(prog, r.status); return <span data-testid={`ringkasan-${r.id}`} style={b.style}>{b.text}</span> })()}
        {!prog && (
          <span data-testid={`ringkasan-${r.id}`} style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', width: 'fit-content', background: '#f3f5f6', color: '#556260', border: '1px solid #d6dcde' }}>
            Belum ada rincian barang
          </span>
        )}
        {showNotaStatus ? (
          <select
            className={`status-select ${isReceivingKendala(r.status) ? 'status-kendala' : 'status-normal'}`}
            value={['NORMAL', 'RETUR', 'REFUND'].includes(String(r.status || '').toUpperCase()) ? String(r.status).toUpperCase() : (r.status || 'NORMAL')}
            onChange={e => onReceivingStatusChange(r, e.target.value)}
            title="Status NOTA (Normal/Retur/Refund) — dimensi terpisah dari kondisi barang"
          >
            {r.status && !['NORMAL', 'RETUR', 'REFUND'].includes(String(r.status).toUpperCase()) && (
              <option value={r.status} disabled>{prettyReceivingStatus(r.status)} (status lama)</option>
            )}
            <option value="NORMAL">✓ Nota Normal</option>
            <option value="RETUR">⚠️ Nota Retur</option>
            <option value="REFUND">⚠️ Nota Refund</option>
          </select>
        ) : (
          <span
            data-testid={`nota-info-${r.id}`}
            style={{ fontSize: '10px', color: '#71817d', lineHeight: 1.4, maxWidth: '200px' }}
            title="Status nota multi-item diubah lewat tindakan per barang (menunggu persetujuan skema)"
          >
            Status nota: <b>{prettyReceivingStatus(r.status)}</b> — perubahan Retur/Refund menunggu pencatatan per barang (menunggu persetujuan skema).
          </span>
        )}
        {r.masuk_gudang ? (
          <span style={{ fontSize: '11px', color: '#137333', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            ✓ Di Stok Gudang
          </span>
        ) : r.tukang_at || String(r.alokasi || '').toUpperCase() === 'KE_TUKANG' ? (
          <span style={{ fontSize: '11px', color: '#1a73e8', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            👷 Ke Tukang (Handover)
          </span>
        ) : isReceivingKendala(r.status) ? (
          <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 600, whiteSpace: 'nowrap' }}>
            ⚠️ {prettyReceivingStatus(r.status)} — stok tidak ditambah
          </span>
        ) : null}
        {alokasiAsing && (
          <span style={{ fontSize: '10px', color: '#71817d', fontWeight: 600, whiteSpace: 'nowrap' }} title="Nilai alokasi dari data lama — ditampilkan apa adanya">
            📌 Alokasi: {alokasiAsing}
          </span>
        )}
        {/* TUJUAN per barang: bulk DILARANG utk multi-item (arahan DAT).
            Hanya nota dengan TEPAT 1 item + sudah ada jumlah diterima yang
            masih boleh memakai aksi tujuan (keterbatasan skema: tujuan per
            item belum punya kolom — menunggu receiving_events/handover_items).
            Item dengan qty 0 / rusak tidak pernah masuk stok/handover. */}
        {!r.masuk_gudang && !r.tukang_at && String(r.alokasi || '').toUpperCase() !== 'KE_TUKANG' && !isReceivingKendala(r.status) && (
          bulk.allowed ? (
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
                  title="Tambah stok barang yang sudah diterima ke modul Materials (nota 1 barang)"
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
                  title="Buat antrean serah terima ke tukang (nota 1 barang) — belum dikonfirmasi sampai serah terima fisik dicatat"
                >
                  👷 Serah Terima ke Tukang
                </button>
              </div>
            </div>
          ) : (
            <div data-testid={`tujuan-info-${r.id}`} style={{ fontSize: '10px', color: '#71817d', lineHeight: 1.4, maxWidth: '200px' }}>
              🎯 Tujuan (Stok Gudang / Tukang) dicatat <b>per barang</b> di dalam <b>Terima Barang</b>. {bulk.reason}
            </div>
          )
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

// --- Aksi per baris (desktop): Terima Barang + Retur + Pecah Vendor + Hapus ---
// Satu pintu input penerimaan: tombol membuka modal ReceiptForm (per item).
// Label "Lihat Barang" dipakai bila semua item sudah lengkap & nota bukan
// kendala (untuk sekadar meninjau rincian/qty).
//
// t_7bc6246b:
//   - "↩ Retur" hanya tampil bila penyimpanan per barang AKTIF (capability),
//     karena retur mengambil baris dari catatan rusak — tanpa skema tidak ada
//     yang bisa diretur dan tombol akan menyesatkan.
//   - "✂ Pecah per Vendor" hanya tampil bila nota memuat barang dari ≥2 vendor
//     dan belum ada qty diterima / alokasi (lihat receiptSplit.splitBlockReason).
export function rowActions(r, ctx) {
  const { title, page, onDelete, setReceiptRow, setReturnRow, H, capability, say, refresh } = ctx
  const prog = H.receivingProgress(r.id, isReceivingKendala(r.status))
  const done = !!(prog && prog.allDone && !prog.kendala)
  const items = H.receivingItemsForReceiving(r.id)
  const prItems = r.purchase_request_id ? H.prItemsForPr(r.purchase_request_id) : []
  const splitPlan = buildSplitPlan({ receiving: r, items, prItems, vendors: ctx.allVendors || [] })
  const canSplit = splitPlan.ok

  async function pecah() {
    const vendors = splitPlan.plan.filter(g => g.vendorId).map(g => g.vendorName)
    const ok = window.confirm(`Pecah nota ini menjadi pembelian per vendor?\n\n${vendors.map(v => '• ' + v).join('\n')}\n\nItem akan dipindah ke nota vendornya; jejak PR tetap tersimpan. Tindakan ini tidak mengubah jumlah diterima (semua item masih 0).`)
    if (!ok) return
    const res = await applySplitPlan({ receiving: r, plan: splitPlan.plan, existingReceivings: (ctx.allReceivings || []) })
    if (!res.ok) { say?.(`Pemecahan gagal: ${res.error}`); refresh?.(); return }
    say?.(`Nota dipecah menjadi ${res.done.length} pembelian per vendor${res.created.length ? ` (${res.created.length} nota baru)` : ''}.`)
    refresh?.()
  }

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
        {capability?.ready && (
          <button
            type="button"
            onClick={() => setReturnRow?.(r)}
            data-testid={`btn-retur-${r.id}`}
            style={{ background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', width: '100%' }}
            title="Retur barang rusak — baris diambil dari catatan penerimaan, tanpa mengetik ulang"
          >
            ↩ Retur Rusak
          </button>
        )}
        {canSplit && (
          <button
            type="button"
            onClick={pecah}
            data-testid={`btn-pecah-${r.id}`}
            style={{ background: '#eef3f1', color: '#1f3a34', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', width: '100%' }}
            title="Nota ini memuat barang dari beberapa vendor — pecah jadi pembelian per vendor/nota (jejak PR tetap)"
          >
            ✂ Pecah per Vendor
          </button>
        )}
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
  const items = receivingItemsForReceiving(r.id)
  const ring = itemRingkas(items)
  const done = !!(prog && prog.allDone && !prog.kendala)
  const bulk = bulkActionState(items, { ready: !!ctx.capability?.ready })
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
        {/* Kondisi & tujuan per barang diisi DI DALAM Terima Barang — bulk
            parent hanya utk nota 1 barang (arahan DAT 16 Okt). */}
        {r.masuk_gudang ? (
          <span style={{ fontSize: '12px', color: '#137333', fontWeight: 700 }}>✓ Di Stok Gudang</span>
        ) : r.tukang_at || String(r.alokasi || '').toUpperCase() === 'KE_TUKANG' ? (
          <span style={{ fontSize: '12px', color: '#1a73e8', fontWeight: 700 }}>👷 Ke Tukang (Handover)</span>
        ) : isReceivingKendala(r.status) ? (
          <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>⚠️ {prettyReceivingStatus(r.status)} — stok tidak ditambah</span>
        ) : bulk.allowed ? (
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
        ) : (
          <span data-testid={`tujuan-info-mobile-${r.id}`} style={{ fontSize: '11px', color: '#71817d', lineHeight: 1.45 }}>
            🎯 Tujuan (Stok Gudang / Tukang) dicatat <b>per barang</b> di dalam <b>Terima Barang</b>. {bulk.reason}
          </span>
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
  const { receiptRow, setReceiptRow, H, say, refresh, capability } = ctx
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
      capability={capability}
      close={() => setReceiptRow(null)}
    />
  )
}

// --- Modal Retur (t_7bc6246b) — baris dari catatan rusak, tanpa ketik ulang ---
export function returnForm(ctx) {
  const { returnRow, setReturnRow, say, refresh, capability } = ctx
  if (!returnRow) return null
  return (
    <ReturnForm
      receiving={returnRow}
      capability={capability}
      say={say}
      refresh={refresh}
      close={() => setReturnRow(null)}
    />
  )
}
