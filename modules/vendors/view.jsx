// ============================================================
// modules/vendors/view.jsx — Vendor
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Vendor diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// Feedback DAT: filter pills ('Semua', 'Ada Telepon', 'Ada Kontak/Email')
// DIHAPUS — toolbar Vendor harus bersih (hanya search bar + tombol Tambah).
// File ini sengaja TIDAK mengekspor `filters(ctx)` lagi; dispatcher
// renderModuleFilters() otomatis merender null (tanpa container filter).
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
// ============================================================
import React from 'react'
import { WaContact, StoreLink } from '../../components/Common'

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal) {
  if (h === 'phone') return <WaContact value={rawVal} />
  if (h === 'store_link') return <StoreLink value={rawVal} />
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

// --- Kartu mobile ---
export function mobileCard(r, ctx) {
  const { page, onDelete } = ctx
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.name}</b>
          <div className="mobile-card-sub">{r.supplier_category || 'Vendor'}</div>
        </div>
      </div>
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Kontak WA:</span>
          <span className="mobile-val"><WaContact value={r.phone} /></span>
        </div>
        <div className="mobile-card-row">
          <span className="mobile-label">Link Toko:</span>
          <span className="mobile-val"><StoreLink value={r.store_link} /></span>
        </div>
      </div>
      <div className="mobile-card-actions">
        <button
          type="button"
          className="btn-delete"
          onClick={() => onDelete(page, r)}
          style={{ width: '100%' }}
        >
          Hapus Vendor
        </button>
      </div>
    </>
  )
}
