// ============================================================
// modules/materials/view.jsx — Material
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Material diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
//
// ============================================================
// ACUAN HARGA EXPANDABLE (t_090127ad — arahan DAT)
// ============================================================
// Kolom "Acuan Harga" DIHILANGKAN dari daftar Material (desktop & mobile):
// - kolom dihapus dari headersFor di lib/constants.js (nilai field/DB TIDAK
//   dihapus — data existing tetap utuh dan tetap tampil di rincian);
// - sebagai gantinya, di bawah NAMA ada tombol "+ Acuan Harga" (collapse
//   "▲ Tutup Acuan") yang membuka rincian per vendor: Vendor | Harga per
//   satuan | Tanggal | Sumber (Historis/Manual).
// - Sumber:
//     • HISTORIS — harga TEREALISASI dari pembelian nyata (receiving_items
//       qty>0 → pr_items → receivings), harga satuan murni material
//       (pr_items.estimated_price), bukan [Nominal] nota (bisa mengandung
//       ongkir/admin), bukan estimasi PR yang belum diterima, dan hanya
//       material yang BENAR-BENAR terlink via pr_item_id (bukan nama mirip).
//     • MASTER — harga_acuan existing di master material (TANPA tanggal &
//       vendor; nilai lama tidak diberi sejarah palsu).
//     • MANUAL — PROTOTYPE (state sesi, BELUM TERSIMPAN ke DB; migrasi DB
//       dibekukan DAT). Ditandai jelas di UI + docs/material-acuan-policy.md.
// - Default SEMUA baris TERTUTUP: daftar tetap ringkas; expand TIDAK
//   mengubah jumlah parent / tidak me-reset Show More (state terpisah di
//   shell, baris expand dirender di luar limit — lihat ModuleView.js).
// - Empty state: "Belum ada acuan harga".
// ============================================================
import React from 'react'
import { format, rupiah, isBhpMaterial, isStokMenipis, stokText } from '../../lib/constants'
import { materialUnit, ACUAN_SATUAN_OPTIONS, validateManualAcuan } from './acuan'

// --- Banner peringatan stok BHP menipis (Sprint 1) ---
export function banner(ctx) {
  const { rows } = ctx
  const stokMenipisCount = (rows || []).filter(isStokMenipis).length
  if (!(stokMenipisCount > 0)) return null
  return (
    <div
      className="notice"
      style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b', fontWeight: 600, marginBottom: '12px' }}
    >
      🔴 {stokMenipisCount} bahan habis pakai (BHP) mencapai/melewati batas minimum stok — segera buat Purchase Request pengisian ulang.
    </div>
  )
}

// --- Kelas baris khusus (stok menipis) ---
export function rowClass(r) {
  return isStokMenipis(r) ? 'row-stok-menipis' : null
}

// --- Filter tabs (termasuk badge Stok Menipis) ---
export function filters(ctx) {
  const { rows, materialFilter, setMaterialFilter } = ctx
  const stokMenipisCount = (rows || []).filter(isStokMenipis).length
  return (
    <div className="filter-tabs">
      <button
        type="button"
        className={`pill ${materialFilter === 'all' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('all')}
      >
        Semua ({rows.length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'Plywood & Board' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('Plywood & Board')}
      >
        Plywood & Board ({rows.filter(r => r.category === 'Plywood & Board').length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'HPL & Edging' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('HPL & Edging')}
      >
        HPL & Edging ({rows.filter(r => r.category === 'HPL & Edging').length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'Hardware & Fitting' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('Hardware & Fitting')}
      >
        Hardware & Fitting ({rows.filter(r => r.category === 'Hardware & Fitting').length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'Bahan Habis Pakai' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('Bahan Habis Pakai')}
      >
        Bahan Habis Pakai ({rows.filter(r => r.category === 'Bahan Habis Pakai').length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'Lainnya' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('Lainnya')}
      >
        Lainnya ({rows.filter(r => !['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai'].includes(r.category)).length})
      </button>
      <button
        type="button"
        className={`pill ${materialFilter === 'STOK_MENIPIS' ? 'active' : ''}`}
        onClick={() => setMaterialFilter('STOK_MENIPIS')}
        style={stokMenipisCount > 0 ? { borderColor: '#dc2626', color: '#dc2626', fontWeight: 'bold' } : {}}
      >
        🔴 Stok Menipis ({stokMenipisCount})
      </button>
    </div>
  )
}

// ============================================================
// RINCIAN ACUAN HARGA — isi baris expand (desktop & kartu mobile)
// ============================================================
// Menerima daftar entri gabungan (historis + master + manual sesi) dan
// merender tabel kecil. formManual = form "Tambah Acuan" aktif utk baris ini.
export function AcuanRincian({ entries, formManual, onManualChange, onManualSubmit, onManualCancel, manualError }) {
  const hasManualForm = !!formManual
  return (
    <div className="acuan-rincian">
      {entries.length ? (
        <table className="acuan-table">
          <thead>
            <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
              <th style={{ padding: '4px 8px' }}>Vendor</th>
              <th style={{ padding: '4px 8px', width: '130px', textAlign: 'right' }}>Harga per Satuan</th>
              <th style={{ padding: '4px 8px', width: '70px' }}>Satuan</th>
              <th style={{ padding: '4px 8px', width: '90px' }}>Tanggal</th>
              <th style={{ padding: '4px 8px', width: '150px' }}>Sumber</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.key} style={{ borderBottom: '1px solid #e1e7e4' }}>
                <td style={{ padding: '4px 8px', fontWeight: 600 }}>
                  {e.vendor || <span className="muted">Tidak dicatat</span>}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {rupiah(e.price)}
                </td>
                <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{e.unit || '—'}</td>
                <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                  {e.date ? format(String(e.date).slice(0, 10)) : <span className="muted">—</span>}
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <span className="acuan-badge acuan-badge-historis" title="Harga terealisasi dari pembelian yang benar-benar diterima (harga satuan material, tanpa ongkir/admin)">✅ Historis</span>
                  {e.source === 'MASTER' && (
                    <span className="acuan-badge acuan-badge-master" title="Acuan harga yang sudah ada di master material (tanpa tanggal/vendor)">📍 Master</span>
                  )}
                  {e.source === 'MANUAL' && (
                    <span className="acuan-badge acuan-badge-manual" title="Entri manual sesi ini — BELUM TERSIMPAN (pembekuan migrasi DB)">✍️ Manual — belum tersimpan</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted" style={{ fontSize: '12px', margin: '4px 0 6px' }}>Belum ada acuan harga.</p>
      )}
      {entries.some(e => e.source === 'MANUAL') && (
        <small style={{ display: 'block', color: '#b45309', fontSize: '10.5px', marginTop: '4px' }}>
          ⚠️ Entri Manual berstatus <b>belum tersimpan</b> (demo penyimpanan menunggu keputusan skema).
        </small>
      )}
      {/* Prototype "Tambah Acuan" — PENYIMPANAN BELUM AKTIF (migrasi DB dibekukan).
          Form tampil & memvalidasi, submit hanya menambah entri sumber MANUAL
          bertanda "belum tersimpan" — JANGAN dianggap ledger persisten. */}
      {hasManualForm ? (
        <form
          className="acuan-manual-form"
          onSubmit={e => { e.preventDefault(); onManualSubmit?.() }}
          style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '8px', background: '#fdf8ea', border: '1px dashed #f0dcb4', borderRadius: '6px', padding: '8px 10px' }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', fontWeight: 600, color: '#485653' }}>
            Vendor
            <select
              value={formManual.vendorId || ''}
              onChange={e => onManualChange?.({ ...formManual, vendorId: e.target.value })}
              style={{ padding: '3px 6px', fontSize: '11px', minWidth: '160px' }}
            >
              <option value="">-- Pilih Vendor --</option>
              {(formManual.vendorOptions || []).map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', fontWeight: 600, color: '#485653' }}>
            Harga (Rp)
            <input
              type="text"
              inputMode="numeric"
              placeholder="Contoh: 25.000"
              value={formManual.harga || ''}
              onChange={e => onManualChange?.({ ...formManual, harga: e.target.value })}
              style={{ padding: '3px 6px', fontSize: '11px', width: '110px' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', fontWeight: 600, color: '#485653' }}>
            Satuan
            <select
              value={formManual.satuan || ''}
              onChange={e => onManualChange?.({ ...formManual, satuan: e.target.value })}
              style={{ padding: '3px 6px', fontSize: '11px' }}
            >
              <option value="">-- Satuan --</option>
              {ACUAN_SATUAN_OPTIONS.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="outline" style={{ padding: '5px 10px', fontSize: '11px', fontWeight: 600 }}>
            + Simpan Acuan
          </button>
          <button type="button" className="outline" style={{ padding: '5px 10px', fontSize: '11px' }} onClick={onManualCancel}>
            Batal
          </button>
          {manualError && <small style={{ color: '#9e2a2b', fontWeight: 600, width: '100%' }}>{manualError}</small>}
        </form>
      ) : null}
    </div>
  )
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal, ctx) {
  if (h === 'name') {
    // t_090127ad: kolom Acuan Harga dipindah ke rincian expandable — di bawah
    // nama ada tombol toggle "+ Acuan Harga" / "▲ Tutup Acuan". Nama material
    // TETAP bersih: tanpa suffix vendor/kategori.
    const { expandedAcuan, setExpandedAcuan } = ctx || {}
    // Data lama tanpa id: rincian tidak bisa dibuka (shell menyimpan state
    // by id) — tombol expand tidak dirender, mencegah `null === null`
    // membuka baris expand secara diam-diam (bug ditangkap harness).
    const hasId = !!r.id
    const isOpen = hasId && expandedAcuan === r.id
    return (
      <div className="cell-name-wrap">
        <div className="cell-name" title={String(rawVal || '')}>{format(rawVal)}</div>
        {hasId && (
          <button
            type="button"
            className="acuan-toggle"
            onClick={e => { e.stopPropagation(); setExpandedAcuan?.(isOpen ? null : r.id) }}
            title="Rincian acuan harga per vendor (historis & manual)"
          >
            {isOpen ? '▲ Tutup Acuan' : '+ Acuan Harga'}
          </button>
        )}
      </div>
    )
  }
  if (h === 'current_stock') {
    return (
      // Sprint 1 — stok BHP: badge merah mencolok bila menipis.
      isStokMenipis(r) ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{stokText(r.current_stock)}</span>
          <span style={{
            display: 'inline-block', width: 'fit-content',
            background: '#dc2626', color: '#fff', border: '1px solid #b91c1c',
            borderRadius: '10px', padding: '2px 8px', fontSize: '10px',
            fontWeight: 800, whiteSpace: 'nowrap'
          }}>
            🔴 Stok Menipis
          </span>
        </div>
      ) : (
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {isBhpMaterial(r) ? stokText(r.current_stock) : <span className="muted">—</span>}
        </span>
      )
    )
  }
  if (h === 'min_stock') {
    return (
      <span style={{ whiteSpace: 'nowrap' }}>
        {isBhpMaterial(r) && Number(r.min_stock) > 0 ? stokText(r.min_stock) : <span className="muted">—</span>}
      </span>
    )
  }
  // Kolom harga_acuan DIHAPUS dari daftar (t_090127ad) — bila kolom ini
  // somehow masih dirender (mis. halaman lain memakai headersFor material),
  // tampilkan dash; nilai existing TIDAK dihapus dari data.
  if (h === 'harga_acuan') {
    return <span className="muted">—</span>
  }
  return null
}

// --- Aksi per baris (desktop): edit (stok/min) + hapus ---
export function rowActions(r, ctx) {
  const { title, page, setEditRow, onDelete } = ctx
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
        {page === 'materials' && (
          <button
            type="button"
            className="btn-edit icon-btn"
            onClick={() => setEditRow(r)}
            title={`Edit ${r.name || title} (ubah stok / batas minimum)`}
          >
            ✏️
          </button>
        )}
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

// --- Baris perluasan: rincian acuan harga per vendor (t_090127ad) ---
export function rowExpand(r, ctx) {
  const { H, columns, expandedAcuan, acuanEntries, setAcuanForm, acuanForm, acuanFormError, onAcuanSubmit, openAcuanForm } = ctx
  // Data lama tanpa id: tidak bisa membuka rincian (toggle juga tidak
  // dirender) — `null === null` tidak boleh membuka baris expand default.
  if (!r?.id || expandedAcuan !== r.id) return null
  const entries = acuanEntries ? acuanEntries(r) : []
  const mat = r
  return (
    <tr className="acuan-expand-row">
      <td colSpan={columns.length + 2} style={{ background: '#fbfdfc', padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#1f3a34' }}>
            💰 Acuan Harga — {mat.name || mat.kode}
            {materialUnit(mat) && (
              <span className="muted" style={{ fontWeight: 500 }}> (satuan acuan mengikuti satuan material: <b>{materialUnit(mat)}</b>)</span>
            )}
          </div>
          {/* Aksi "Tambah Acuan" (manual): hanya dari dalam rincian terbuka.
              Prototype — entri sumber MANUAL BELUM TERSIMPAN ke DB. */}
          {!acuanForm && (
            <button
              type="button"
              className="outline"
              style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600 }}
              onClick={() => openAcuanForm?.(r)}
              title="Tambah acuan harga manual untuk vendor tertentu (prototype — belum tersimpan permanen)"
            >
              ＋ Tambah Acuan
            </button>
          )}
        </div>
        <AcuanRincian
          entries={entries}
          formManual={acuanForm?.materialId === r.id ? acuanForm : null}
          onManualChange={f => setAcuanForm?.(f)}
          onManualSubmit={() => onAcuanSubmit?.(r)}
          onManualCancel={() => setAcuanForm?.(null)}
          manualError={acuanForm?.materialId === r.id ? acuanFormError : ''}
        />
      </td>
    </tr>
  )
}

// --- Kartu mobile ---
export function mobileCard(r, ctx) {
  const { page, setEditRow, onDelete, expandedAcuan, setExpandedAcuan, acuanEntries, setAcuanForm, acuanForm, acuanFormError, onAcuanSubmit, openAcuanForm } = ctx
  // Material tanpa id (data lama): rincian tidak bisa dibuka — konsisten desktop.
  const isOpen = !!r.id && expandedAcuan === r.id
  const entries = isOpen && acuanEntries ? acuanEntries(r) : []
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.kode || '—'}</b>
          <div className="mobile-card-sub">{r.name}</div>
        </div>
        <span className="badge status-APPROVED" style={{ fontSize: '11px' }}>
          {r.qty ?? 0} {r.satuan || ''}
        </span>
      </div>
      {isStokMenipis(r) && (
        <div style={{ margin: '0 14px 8px', background: '#dc2626', color: '#fff', borderRadius: '8px', padding: '6px 10px', fontSize: '11px', fontWeight: 800, textAlign: 'center' }}>
          🔴 Stok Menipis — {stokText(r.current_stock)} (batas min {stokText(r.min_stock)})
        </div>
      )}
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Kategori:</span>
          <span className="mobile-val">{r.category || '—'}</span>
        </div>
        {isBhpMaterial(r) && (
          <>
            <div className="mobile-card-row">
              <span className="mobile-label">Stok Saat Ini:</span>
              <span className="mobile-val" style={{ fontWeight: 700, color: isStokMenipis(r) ? '#b91c1c' : undefined }}>{stokText(r.current_stock)}</span>
            </div>
            <div className="mobile-card-row">
              <span className="mobile-label">Batas Min:</span>
              <span className="mobile-val">{Number(r.min_stock) > 0 ? stokText(r.min_stock) : '—'}</span>
            </div>
          </>
        )}
        {/* t_090127ad: baris "Acuan Harga:" statis DIHAPUS dari kartu —
            diganti tombol expand di bawah (konsisten dgn desktop). */}
      </div>
      <button
        type="button"
        className="acuan-toggle"
        style={{ margin: '0 14px', width: 'fit-content' }}
        onClick={e => { e.stopPropagation(); setExpandedAcuan?.(isOpen ? null : r.id) }}
        title="Rincian acuan harga per vendor (historis & manual)"
      >
        {isOpen ? '▲ Tutup Acuan' : '+ Acuan Harga'}
      </button>
      {isOpen && (
        <div style={{ margin: '8px 14px 0', background: '#fbfdfc', border: '1px solid #e1e7e4', borderRadius: '8px', padding: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#1f3a34' }}>
              💰 Acuan Harga{materialUnit(r) ? ` — per ${materialUnit(r)}` : ''}
            </div>
            {!acuanForm && (
              <button
                type="button"
                className="outline"
                style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600 }}
                onClick={() => openAcuanForm?.(r)}
                title="Tambah acuan harga manual untuk vendor tertentu (prototype — belum tersimpan permanen)"
              >
                ＋ Tambah Acuan
              </button>
            )}
          </div>
          <AcuanRincian
            entries={entries}
            formManual={acuanForm?.materialId === r.id ? acuanForm : null}
            onManualChange={f => setAcuanForm?.(f)}
            onManualSubmit={() => onAcuanSubmit?.(r)}
            onManualCancel={() => setAcuanForm?.(null)}
            manualError={acuanForm?.materialId === r.id ? acuanFormError : ''}
          />
        </div>
      )}
      <div className="mobile-card-actions">
        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
          <button
            type="button"
            className="outline"
            onClick={() => setEditRow(r)}
            style={{ flex: 1, padding: '8px', fontSize: '12px' }}
          >
            ✏️ Edit
          </button>
          <button
            type="button"
            className="btn-delete"
            onClick={() => onDelete(page, r)}
            style={{ flex: 1, padding: '8px', fontSize: '12px' }}
          >
            Hapus Material
          </button>
        </div>
      </div>
    </>
  )
}
