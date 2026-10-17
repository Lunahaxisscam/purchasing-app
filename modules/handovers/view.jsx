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

// Antrean Distribusi Fisik (3 aksi: gudang / tukang / tandai diserahkan).
// Dire-export dari queue.jsx supaya dispatcher modules/shared/renderModuleCell
// menemukannya sebagai `banner` modul handovers tanpa mengubah file shell.
export { renderHandoverQueue as banner } from './queue'

import React from 'react'
import { format, parseHandoverNote, isHandoverDelivered } from '../../lib/constants'
import { sourceRefs, rincianInfo, rincianCell, statusInfo, RINCIAN_BELUM_TERSEDIA, validatePrototypeRow, prototypeTotals } from './display'

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
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {st.delivered ? (
          <span style={{ fontSize: '11px', color: '#137333', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ Sudah Diserahkan</span>
        ) : (
          <span style={{ fontSize: '11px', color: '#8a6d1f', fontWeight: 700, whiteSpace: 'nowrap' }}>⏳ Belum Diserahkan</span>
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
// ✓ (tandai sudah diserahkan; hanya bila belum), ✏️ edit, 🗑️ hapus.
// Konfirmasi fisik menulis diserahkan_at lewat onMarkHandoverDelivered
// (modules/handovers/confirm.js) — bukan sekadar mengubah status.
export function rowActions(r, ctx) {
  const { title, page, setEditRow, onMarkHandoverDelivered, onDelete } = ctx
  const delivered = isHandoverDelivered(r)
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
            onClick={() => onMarkHandoverDelivered(r)}
            style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 7px', fontSize: '11px', cursor: 'pointer', fontWeight: 700, lineHeight: 1 }}
            title="Tandai serah terima SUDAH DISERAHKAN (konfirmasi fisik)"
          >
            ✓
          </button>
        )}
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
  const { columns, expandedAcuan, allReceivings, allRequests, H } = ctx
  if (!r?.id || expandedAcuan !== r.id) return null
  const refs = sourceRefs(r, { allReceivings, allRequests })
  const rinc = rincianInfo(r)
  const st = statusInfo(r)
  const refItems = (r.receiving_id && H?.receivingItemsForReceiving) ? H.receivingItemsForReceiving(r.receiving_id) : []
  return (
    <tr className="acuan-expand-row">
      <td colSpan={columns.length + 1} style={{ background: '#fbfdfc', padding: '10px 14px' }}>
        <div data-testid={`handover-detail-${r.id}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: '#1f3a34' }}>
          <div style={{ fontWeight: 600 }}>📄 Detail Serah Terima — {r.project_name || 'Tanpa Project'}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px' }}>
            <span>Purchase asal: <b>{refs.receivingLabel || '—'}</b></span>
            <span>Surat Jalan: <b>{refs.deliveryNote || '—'}</b></span>
            <span>PR asal: <b>{refs.prNumber || '—'}</b></span>
            <span>Pengirim/Gudang: <b>{refs.alokasi === 'KE_TUKANG' ? 'Langsung ke Tukang' : (refs.alokasi || '—')}</b></span>
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
          {refItems.length > 0 && <PrototypePanel handover={r} refItems={refItems} />}
        </div>
      </td>
    </tr>
  )
}

// ============================================================
// PROTOTYPE — panel "rencana rincian penyerahan per item" (SESI SAJA).
// ============================================================
// Mendemokan alur yang diusulkan DAT: pilih barang dari penerimaan, isi
// jumlah yang DISERAHKAN KALI INI (boleh parsial), pilih penerima (boleh
// beberapa orang), lihat sisa yang belum diserahkan tanpa hitung ganda.
// TIDAK PERNAH menulis DB / kolom note — entri hidup di memori komponen;
// menunggu persetujuan tabel `handover_items` (docs/handover-gap-proposal.md).
function PrototypePanel({ handover, refItems }) {
  const [entries, setEntries] = React.useState([])
  const [refItemId, setRefItemId] = React.useState('')
  const [qty, setQty] = React.useState('')
  const [penerima, setPenerima] = React.useState('')
  const [error, setError] = React.useState('')
  const totals = prototypeTotals(entries, refItems)

  function tambah() {
    const v = validatePrototypeRow({ refItemId, qty }, refItems, entries)
    if (!v.ok) { setError(v.error); return }
    setEntries(prev => [...prev, { refItemId, name: v.ref.item_name, unit: v.ref.unit || '', qty: v.qty, penerima: String(penerima || '').trim() }])
    setError('')
    setQty('')
    setPenerima('')
  }

  return (
    <div data-testid={`prototype-panel-${handover.id}`} style={{ background: '#fff8ec', border: '1px dashed #e0b96a', borderRadius: '8px', padding: '10px 12px' }}>
      <div style={{ fontWeight: 700, color: '#8a6d1f' }}>🧪 Prototype: rencana rincian penyerahan per item (belum tersimpan)</div>
      <div className="muted" style={{ fontSize: '11px', margin: '3px 0 7px', maxWidth: '720px' }}>
        Contoh alur usulan — entri hanya hidup di sesi ini dan TIDAK ditulis ke database (menunggu persetujuan tabel <code>handover_items</code>).
        Mendukung penyerahan sebagian, sisa belum diserahkan, dan beberapa penerima.
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          Barang (dari penerimaan)
          <select value={refItemId} onChange={e => setRefItemId(e.target.value)} data-testid={`proto-item-${handover.id}`} style={{ minWidth: '190px' }}>
            <option value="">-- pilih barang --</option>
            {refItems.map(it => (
              <option key={it.id} value={it.id}>{it.item_name} ({Number(it.quantity_received || 0)}{it.unit ? ` ${it.unit}` : ''} diterima)</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          Jumlah diserahkan kini
          <input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} data-testid={`proto-qty-${handover.id}`} style={{ width: '110px' }} />
        </label>
        <label style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          Penerima (nama)
          <input type="text" value={penerima} onChange={e => setPenerima(e.target.value)} placeholder="mis. Pak Joko" data-testid={`proto-penerima-${handover.id}`} style={{ width: '150px' }} />
        </label>
        <button type="button" className="outline" onClick={tambah} data-testid={`proto-add-${handover.id}`} style={{ padding: '5px 10px', fontSize: '11px', fontWeight: 600 }}>＋ Catat (sesi)</button>
      </div>
      {error && <div style={{ color: '#c93b2b', fontSize: '11px', marginTop: '5px' }} data-testid={`proto-error-${handover.id}`}>{error}</div>}
      {totals.length > 0 && (
        <table className="acuan-table" style={{ marginTop: '8px', fontSize: '11px', width: 'auto' }}>
          <thead>
            <tr><th>Barang</th><th>Diterima</th><th>Tercatat (sesi)</th><th>Sisa belum diserahkan</th></tr>
          </thead>
          <tbody>
            {totals.map(t => (
              <tr key={t.refItemId}>
                <td>{t.name}</td>
                <td>{t.received}{t.unit ? ` ${t.unit}` : ''}</td>
                <td>{t.used}{t.unit ? ` ${t.unit}` : ''}</td>
                <td><b>{t.sisa}{t.unit ? ` ${t.unit}` : ''}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {entries.length > 0 && (
        <div style={{ marginTop: '6px', fontSize: '11px' }}>
          <b>Rencana tercatat (sesi ini):</b>{' '}
          {entries.map((e, i) => (
            <span key={i} style={{ marginRight: '10px' }}>
              {e.name} {e.qty}{e.unit ? ` ${e.unit}` : ''}{e.penerima ? ` → ${e.penerima}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
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
          <span>Pengirim/Gudang: <b>{refs.alokasi === 'KE_TUKANG' ? 'Langsung ke Tukang' : (refs.alokasi || '—')}</b></span>
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
            onClick={() => onMarkHandoverDelivered(r)}
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
