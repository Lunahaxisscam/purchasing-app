// ============================================================
// modules/handovers/view.jsx — Handover
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Handover diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// REVISI t_b418827b (arahan DAT):
//  - Daftar menjelaskan BARANG: kolom "📦 Barang" (ringkas; data lama tanpa
//    rincian → "Rincian barang belum tersedia", TIDAK menebak dari Purchase).
//  - "Sudah Diserahkan" = bukti fisik (`diserahkan_at`) — status CONFIRMED
//    lama tanpa diserahkan_at ditampilkan apa adanya + catatan kecil, TIDAK
//    diklaim sudah diserahkan. Aksi konfirmasi fisik eksplisit menulis
//    diserahkan_at (modules/handovers/confirm.js).
//  - Aksi baris TIDAK bertumpuk: satu baris ikon ringkas (✓ / ✏️ / 🗑️).
//  - Detail expand per baris: referensi Purchase/PR asal, penerima, rincian
//    barang, catatan status.
//
// Fitur 15 Okt 2026 — Bukti Foto Serah Terima (maks 2MB):
//   Foto disimpan sebagai data-URL base64 di dalam kolom note dengan penanda
//   [FotoBukti: …] (lihat lib/constants.js). Kolom "Bukti Foto" menampilkan
//   thumbnail + tombol lihat; kolom "Catatan" menampilkan teksnya saja.
// ============================================================

// Antrean Distribusi Fisik (3 aksi fisik: gudang / tukang / bermasalah, plus
// langkah penutup "tandai diserahkan"). Dire-export dari queue.jsx supaya
// dispatcher modules/shared/renderModuleCell menemukannya sebagai `banner`
// modul handovers tanpa mengubah file shell.
export { renderHandoverQueue as banner } from './queue'

import React from 'react'
import { format, parseHandoverNote, isHandoverDelivered } from '../../lib/constants'
import { sourceRefs, rincianInfo, rincianCell, statusInfo, RINCIAN_BELUM_TERSEDIA } from './display'
import { alokasiLabel, isProblemNoted } from './queue'
import { openPhysicalModal } from './physicalModal'

// --- Bukti foto serah terima (fitur 15 Okt 2026) ---
// Buka foto ukuran penuh di jendela baru: untuk data-URL, navigasi top-frame
// ke data: URL diblokir Chrome — jadi jendela kosong dibuka dulu, lalu gambar
// ditulis lewat DOM API. Bila foto berupa link http(s), langsung buka link.
// Fallback (popup diblokir): unduh file via <a download>.
function bukaFoto(foto) {
  const src = String(foto || '')
  if (!src) return
  try {
    if (/^https?:\/\//i.test(src)) {
      const w = window.open(src, '_blank', 'noopener')
      if (w) return
    } else {
      const w = window.open('', '_blank')
      if (w && w.document) {
        w.document.title = 'Bukti Foto Serah Terima'
        w.document.body.style.cssText = 'margin:16px;background:#0f1c19;text-align:center;'
        const img = w.document.createElement('img')
        img.src = src
        img.alt = 'Bukti foto serah terima'
        img.style.cssText = 'max-width:100%;height:auto;border-radius:8px;'
        w.document.body.appendChild(img)
        return
      }
    }
  } catch (e) { /* lanjut ke fallback unduh */ }
  try {
    const a = document.createElement('a')
    a.href = src
    a.download = 'bukti-foto-handover.jpg'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch (e) { /* tidak ada yang bisa dilakukan di lingkungan ini */ }
}

// --- Filter tabs ---
// "Sudah Diserahkan" = ada bukti fisik (diserahkan_at), bukan status CONFIRMED
// lama (lihat kontrak t_b418827b).
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
        ✓ Sudah Diserahkan ({rows.filter(isHandoverDelivered).length})
      </button>
      <button
        type="button"
        className={`pill ${handoverFilter === 'DRAFT' ? 'active' : ''}`}
        onClick={() => setHandoverFilter('DRAFT')}
      >
        Belum Diserahkan ({rows.filter(r => !isHandoverDelivered(r)).length})
      </button>
    </div>
  )
}

// --- Header kolom khusus ---
export function header(h) {
  if (h === 'items') return '📦 Barang'
  if (h === 'bukti_foto') return '📷 Bukti Foto'
  return null
}

// Tombol buka/tutup rincian barang satu baris. State expand memakai
// ctx.expandedAcuan (state bersama shell — satu modul aktif per halaman;
// direset saat pindah modul) agar tidak menambah field kontrak ctx.
function toggleExpand(r, ctx, e) {
  e?.stopPropagation?.()
  const { expandedAcuan, setExpandedAcuan } = ctx || {}
  setExpandedAcuan?.(expandedAcuan === r.id ? null : r.id)
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal, ctx) {
  // Kolom Barang: ringkasan rincian penyerahan. Data lama tanpa rincian
  // terstruktur → label "Rincian barang belum tersedia" (jangan menebak).
  if (h === 'items') {
    const cell = rincianCell(r)
    const isOpen = ctx?.expandedAcuan === r.id
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '230px', whiteSpace: 'normal', lineHeight: 1.35 }}>
        {cell.unavailable ? (
          <span style={{ fontSize: '11.5px', color: '#9aa8a4' }} title={cell.text}>{cell.text}</span>
        ) : (
          <>
            <b style={{ fontSize: '12px' }}>{cell.count} item</b>
            <span style={{ fontSize: '11px', color: '#556b65' }}>{cell.text.replace(`${cell.count} item — `, '')}</span>
          </>
        )}
        <button
          type="button"
          className="acuan-toggle"
          data-testid={`btn-detail-${r.id}`}
          onClick={e => toggleExpand(r, ctx, e)}
          title="Lihat detail dokumen serah terima"
        >
          {isOpen ? '▲ Tutup detail' : '+ Detail'}
        </button>
      </div>
    )
  }
  // Kolom Status: dimensi bukti fisik — "Sudah Diserahkan" hanya bila
  // diserahkan_at ada. Status lama CONFIRMED tanpa waktu penyerahan
  // ditampilkan sebagai catatan kecil (apa adanya, tidak diklaim).
  if (h === 'status') {
    const st = statusInfo(r)
    // t_b03c5228: kendala nota (Retur/Refund) ditampilkan sebagai label
    // MANUSIA di sini — satu-satunya tempat status nota muncul di modul
    // Handover. Kode status mentah tidak pernah ditampilkan.
    const rec = (ctx?.allReceivings || []).find(x => x && x.id === r.receiving_id) || null
    const problem = isProblemNoted(rec)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {st.delivered ? (
          <span style={{ fontSize: '11px', color: '#137333', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ Sudah Diserahkan</span>
        ) : (
          <span style={{ fontSize: '11px', color: '#8a6d1f', fontWeight: 700, whiteSpace: 'nowrap' }}>⏳ Belum Diserahkan</span>
        )}
        {problem && (
          <span
            data-testid={`problem-${r.id}`}
            style={{ fontSize: '10.5px', color: '#a15309', fontWeight: 700, whiteSpace: 'nowrap' }}
            title="Nota pembelian ditandai bermasalah (Retur/Refund) — barang tidak didistribusikan"
          >
            ⚠ Nota bermasalah
          </span>
        )}
        {st.legacyNote && (
          <span style={{ fontSize: '10px', color: '#a15309', whiteSpace: 'normal', maxWidth: '170px', lineHeight: 1.3 }} title={st.legacyNote}>
            ⚠️ {st.legacyNote}
          </span>
        )}
      </div>
    )
  }
  // Kolom Bukti Foto: thumbnail + tombol "Lihat Foto" bila bukti tersedia,
  // selain itu dibiarkan kosong (shell menampilkan '—').
  if (h === 'bukti_foto') {
    const { foto } = parseHandoverNote(r.note)
    if (!foto) return null
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <img
          src={foto}
          alt="Bukti foto serah terima"
          title="Klik untuk lihat bukti foto"
          onClick={() => bukaFoto(foto)}
          style={{ width: '42px', height: '42px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cbd8d4', cursor: 'zoom-in', flexShrink: 0 }}
        />
        <button
          type="button"
          onClick={() => bukaFoto(foto)}
          style={{ width: 'fit-content', background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', borderRadius: '4px', padding: '2px 7px', fontSize: '10px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          title="Buka bukti foto serah terima"
        >
          📷 Lihat Foto
        </button>
      </div>
    )
  }
  // Kolom Catatan: bila note memuat bukti foto, tampilkan HANYA teks catatannya
  // (tanpa base64). Bila tidak ada foto, return null -> jalur generik seperti
  // sebelumnya (kompatibel data lama).
  if (h === 'note') {
    const { foto, extra } = parseHandoverNote(rawVal)
    if (!foto) return null
    return extra ? (
      <div style={{ whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.4, fontSize: '12px', maxWidth: '230px' }} title={extra}>
        {extra}
      </div>
    ) : (
      <span style={{ color: '#9aa8a4' }}>—</span>
    )
  }
  return null
}

// --- Aksi per baris (desktop) ---
// Arahan DAT (t_b418827b): hindari tombol bertumpuk — satu baris ikon ringkas:
// ✓ (konfirmasi fisik), ✏️ edit, 🗑️ hapus.
// Konfirmasi fisik menulis diserahkan_at lewat RPC handover_confirm per barang
// (modal confirmForm) atau confirm.js (header) saat skema belum ada.
export function rowActions(r, ctx) {
  const { title, page, setEditRow, onMarkHandoverDelivered, onDelete } = ctx
  const delivered = isHandoverDelivered(r)
  const rec = (ctx?.allReceivings || []).find(x => x && x.id === r.receiving_id) || null
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
        {delivered ? (
          <span
            data-testid={`delivered-${r.id}`}
            style={{ fontSize: '11px', color: '#137333', fontWeight: 700, padding: '0 2px' }}
            title="Sudah diserahkan (bukti fisik tercatat)"
          >
            ✓
          </span>
        ) : (
          <button
            type="button"
            data-testid={`btn-deliver-${r.id}`}
            onClick={() => {
              // DEFECT run 206: tombol ✓ dulu langsung memanggil
              // `onMarkHandoverDelivered` (window.confirm + tulis header saja).
              // Di mode READY itu MELEWATI konfirmasi per barang dan langsung
              // mengunci dokumen (CAS `diserahkan_at`), sehingga rincian barang
              // tidak akan pernah bisa dicatat untuk dokumen itu. Sekarang ✓
              // membuka modal konfirmasi yang SAMA dengan antrean: per barang
              // bila skema siap, dan otomatis jatuh ke konfirmasi header
              // (perilaku lama) bila belum — jadi tidak ada jalur yang hilang.
              openPhysicalModal({ kind: 'confirm', handover: r })
            }}
            style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 7px', fontSize: '11px', cursor: 'pointer', fontWeight: 700, lineHeight: 1 }}
            title="Tandai serah terima SUDAH DISERAHKAN (konfirmasi fisik — rincian per barang bila tersedia)"
          >
            ✓
          </button>
        )}
        {/* Terima Barang: satu-satunya pintu input kedatangan/kondisi/tujuan
            per barang (DAT: UI fisik hanya di Handover). */}
        <button
          type="button"
          data-testid={`btn-terima-${r.id}`}
          disabled={!rec}
          onClick={() => rec && openPhysicalModal({ kind: 'receipt', receiving: rec })}
          style={{ background: '#1f6feb', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 7px', fontSize: '11px', cursor: rec ? 'pointer' : 'not-allowed', fontWeight: 700, lineHeight: 1 }}
          title={rec ? 'Catat barang datang (per barang: datang/rusak/tujuan)' : 'Belum terhubung ke nota pembelian'}
        >
          📥
        </button>
        <button
          type="button"
          className="btn-edit icon-btn"
          data-testid={`btn-edit-${r.id}`}
          onClick={() => setEditRow(r)}
          title={`Edit ${title} (catatan/foto — sumber & status tidak berubah)`}
        >
          ✏️
        </button>
        <button
          type="button"
          className="btn-delete icon-btn"
          data-testid={`btn-hapus-${r.id}`}
          onClick={() => onDelete(page, r)}
          title={`Hapus ${title}`}
        >
          🗑️
        </button>
      </div>
    </td>
  )
}

// --- Baris perluasan: detail dokumen serah terima (referensi asal, rincian) ---
// Dirender shell lewat renderModuleRowExpand; hanya tampil bila baris dibuka.
export function rowExpand(r, ctx) {
  const { columns, expandedAcuan, allReceivings, allRequests } = ctx
  if (!r?.id || expandedAcuan !== r.id) return null
  const refs = sourceRefs(r, { allReceivings, allRequests })
  const rinc = rincianInfo(r)
  const st = statusInfo(r)
  return (
    <tr className="acuan-expand-row">
      <td colSpan={columns.length + 1} style={{ background: '#fbfdfc', padding: '10px 14px' }}>
        <div data-testid={`handover-detail-${r.id}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: '#1f3a34' }}>
          <div style={{ fontWeight: 600 }}>📄 Detail Serah Terima — {r.project_name || 'Tanpa Project'}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px' }}>
            <span>Purchase asal: <b>{refs.receivingLabel || '—'}</b></span>
            <span>Surat Jalan: <b>{refs.deliveryNote || '—'}</b></span>
            <span>PR asal: <b>{refs.prNumber || '—'}</b></span>
            <span>Tujuan barang: <b>{alokasiLabel(refs.alokasi) || 'Belum ditentukan'}</b></span>
            <span>Penerima: <b>{r.received_by || '—'}</b></span>
            <span>Tanggal: <b>{format(r.handover_date)}</b></span>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '3px' }}>Rincian barang:</div>
            {rinc.available ? (
              <ul style={{ margin: '0 0 0 18px', padding: 0 }}>
                {rinc.rows.map((row, i) => (
                  <li key={i}>{row.name} — {row.qty}{row.unit ? ` ${row.unit}` : ''} ({row.qtyLabel})</li>
                ))}
              </ul>
            ) : (
              <div>
                <b style={{ color: '#8a6d1f' }} data-testid={`rincian-unavailable-${r.id}`}>{RINCIAN_BELUM_TERSEDIA}</b>
                <div className="muted" style={{ fontSize: '11px', marginTop: '3px', maxWidth: '640px' }}>{rinc.notice}</div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px' }}>
            <span>Status: <b>{st.label}</b>{st.delivered && st.diserahkanAt ? ` — ${new Date(st.diserahkanAt).toLocaleString('id-ID')}` : ''}</span>
            {st.legacyNote && <span style={{ color: '#a15309' }}>⚠️ {st.legacyNote}</span>}
          </div>
          {/* PANEL PROTOTYPE DIHAPUS (run 208).
              Panel "🧪 rencana rincian penyerahan per item" adalah mockup dari
              masa sebelum tabel `handover_items` ada: ia menerima qty+penerima,
              menampilkan "Rencana tercatat (sesi ini)", tetapi NOL tulisan DB
              dan hilang saat halaman dimuat ulang. Sekarang jalur NYATA sudah
              ada (konfirmasi per barang → RPC handover_confirm), jadi panel itu
              menjadi persistence palsu di layar yang sama — dua form untuk satu
              pekerjaan, yang satu membuang datanya. Angka "Diterima" di panel
              itu pun diambil dari `quantity_received` (QTY BELI), bukan qty
              DATANG — semantik yang justru diperbaiki seluruh card ini.
              Fungsi murninya (display.validatePrototypeRow/prototypeTotals)
              TIDAK dihapus: masih diuji sebagai catatan desain, tetapi tidak
              lagi dirender ke pengguna. */}
        </div>
      </td>
    </tr>
  )
}

// --- Kartu mobile ---
export function mobileCard(r, ctx) {
  const { page, title, setEditRow, onMarkHandoverDelivered, onDelete, expandedAcuan, setExpandedAcuan, allReceivings, allRequests } = ctx
  const { foto, extra } = parseHandoverNote(r.note)
  const delivered = isHandoverDelivered(r)
  const st = statusInfo(r)
  const rinc = rincianInfo(r)
  const isOpen = !!r.id && expandedAcuan === r.id
  const refs = isOpen ? sourceRefs(r, { allReceivings, allRequests }) : null
  // t_b03c5228: kendala nota tampil di kartu mobile juga (label manusia).
  const rec = (allReceivings || []).find(x => x && x.id === r.receiving_id) || null
  const problem = isProblemNoted(rec)
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.project_name || 'Serah Terima'}</b>
          <div className="mobile-card-sub">{r.received_by || 'Belum ditentukan'}</div>
        </div>
        <span className={`badge status-${delivered ? 'APPROVED' : 'DRAFT'}`} style={{ fontSize: '10px' }}>
          {delivered ? '✓ Sudah Diserahkan' : 'Belum Diserahkan'}
        </span>
      </div>
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Barang:</span>
          <span className="mobile-val">{rinc.available ? `${rinc.rows.length} item — ${rinc.rows.map(x => x.name).slice(0, 2).join(', ')}` : RINCIAN_BELUM_TERSEDIA}</span>
        </div>
        <div className="mobile-card-row">
          <span className="mobile-label">Tgl Serah Terima:</span>
          <span className="mobile-val">{format(r.handover_date)}</span>
        </div>
        {st.legacyNote && (
          <div className="mobile-card-note" style={{ color: '#a15309' }}>⚠️ {st.legacyNote}</div>
        )}
        {problem && (
          <div className="mobile-card-note" style={{ color: '#a15309' }} data-testid={`problem-mobile-${r.id}`}>
            ⚠ Nota bermasalah — barang tidak didistribusikan. Retur/Refund dicatat di Catatan handover ini + rekonsiliasi manual admin dengan supplier.
          </div>
        )}
        {foto && (
          <div className="mobile-card-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
            <span className="mobile-label">Bukti Foto:</span>
            <img
              src={foto}
              alt="Bukti foto serah terima"
              onClick={() => bukaFoto(foto)}
              style={{ width: '84px', height: '84px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #cbd8d4', cursor: 'zoom-in' }}
            />
            <button
              type="button"
              onClick={() => bukaFoto(foto)}
              style={{ width: 'fit-content', background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', borderRadius: '4px', padding: '3px 10px', fontSize: '11px', fontWeight: 700 }}
            >
              📷 Lihat Foto
            </button>
          </div>
        )}
        {extra && (
          <div className="mobile-card-note">
            <b>Catatan:</b> {extra}
          </div>
        )}
      </div>
      <button
        type="button"
        className="acuan-toggle"
        data-testid={`btn-detail-mobile-${r.id}`}
        style={{ margin: '0 14px', width: 'fit-content' }}
        onClick={e => { e.stopPropagation(); setExpandedAcuan?.(isOpen ? null : r.id) }}
        title="Lihat detail dokumen serah terima"
      >
        {isOpen ? '▲ Tutup detail' : '+ Detail'}
      </button>
      {isOpen && (
        <div data-testid={`handover-detail-mobile-${r.id}`} style={{ margin: '8px 14px 0', background: '#fbfdfc', border: '1px solid #e1e7e4', borderRadius: '8px', padding: '10px', fontSize: '11.5px', color: '#1f3a34', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span>Purchase asal: <b>{refs.receivingLabel || '—'}</b></span>
          <span>PR asal: <b>{refs.prNumber || '—'}</b></span>
          <span>Tujuan barang: <b>{alokasiLabel(refs.alokasi) || 'Belum ditentukan'}</b></span>
          <span>Penerima: <b>{r.received_by || '—'}</b></span>
          <span>Status: <b>{st.label}</b>{st.delivered && st.diserahkanAt ? ` — ${new Date(st.diserahkanAt).toLocaleString('id-ID')}` : ''}</span>
          <div>
            <b>Rincian barang:</b>{' '}
            {rinc.available
              ? rinc.rows.map(x => `${x.name} — ${x.qty}${x.unit ? ' ' + x.unit : ''} (${x.qtyLabel})`).join('; ')
              : <span style={{ color: '#8a6d1f' }}>{RINCIAN_BELUM_TERSEDIA}</span>}
          </div>
        </div>
      )}
      <div className="mobile-card-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {delivered ? (
          <span style={{ fontSize: '12px', color: '#137333', fontWeight: 700 }}>✓ Sudah diserahkan (bukti fisik tercatat)</span>
        ) : (
          <button
            type="button"
            data-testid={`btn-deliver-mobile-${r.id}`}
            onClick={() => openPhysicalModal({ kind: 'confirm', handover: r })}
            style={{ width: '100%', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px', fontSize: '12px', fontWeight: 700 }}
          >
            ✓ Tandai Sudah Diserahkan
          </button>
        )}
        <button
          type="button"
          className="outline"
          onClick={() => setEditRow(r)}
          style={{ width: '100%' }}
        >
          ✏️ Edit
        </button>
        <button type="button" className="btn-delete" onClick={() => onDelete(page, r)} style={{ width: '100%' }}>
          Hapus {title}
        </button>
      </div>
    </>
  )
}
