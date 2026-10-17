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
//
// ============================================================
// t_e626b674 (arahan DAT):
//   1. KATEGORI MULTI — kategori material vendor tampil sbg badge/chips rapi
//      (bukan teks kecil abu-abu redup), mendukung multi-kategori (string
//      koma / array / JSON). Chip Noir: soft neutral, border halus,
//      rounded-full, font 11px bold. Parser SATU-SUMBER di
//      modules/vendors/categories.js (format lama tunggal tetap terbaca).
//   2. HAPUS DI-DISCOURAGE — tombol merah besar "Hapus Vendor" diganti link
//      teks kecil abu-abu di pojok bawah kartu (tanpa background merah),
//      dan konfirmasi bertingkat (PERINGATAN riwayat transaksi & acuan
//      harga material) dijalankan SEBELUM deleteItem pages/index.js.
//      Di desktop, tombol hapus jadi ikon ✕ muted kecil — bukan tombol merah.
// ============================================================
import React from 'react'
import { WaContact, StoreLink } from '../../components/Common'
import { parseVendorCategories } from './categories'

// ============================================================
// CHIP KATEGORI VENDOR (t_e626b674)
// Setiap kategori = pill mandiri. Value diparse dari bentuk apapun
// (array / JSON string / string koma / scalar lama).
// ============================================================
function vendorCategoryChips(value, opts = {}) {
  const cats = parseVendorCategories(value)
  if (!cats.length) {
    return (
      <span
        className="vendor-cat-chips vendor-cat-empty"
        title="Belum ada kategori material di-set (edit vendor utk memilih)"
      >
        {opts.emptyLabel || 'Tanpa Kategori'}
      </span>
    )
  }
  return (
    <span className="vendor-cat-chips">
      {cats.map(c => (
        <span key={c} className="vendor-cat-chip" title={c}>{c}</span>
      ))}
    </span>
  )
}

// ============================================================
// KONFIRMASI BERTINGKAT SEBELUM HAPUS (safety barrier, t_e626b674)
// Dipanggil dari kartu mobile & aksi desktop SEBELUM onDelete shell.
// Vendor berrelasi dgn riwayat transaksi pengadaan (pr_items.vendor_id) &
// acuan harga material — hapus SET NULL/CASCADE di level DB, jadi user
// HARUS melewati 2 gerbang konfirmasi yang menjelaskan dampaknya.
// Return true = lanjut ke onDelete, false = batal.
// ============================================================
export function confirmDeleteVendor(r) {
  const nama = r?.name || 'vendor ini'
  const gerbang1 = window.confirm(
    'PERINGATAN: Menghapus vendor dapat mempengaruhi riwayat transaksi pengadaan ' +
    'dan acuan harga material terkait.\n\n' +
    `Apakah Anda benar-benar yakin ingin menghapus "${nama}"?`
  )
  if (!gerbang1) return false
  const gerbang2 = window.confirm(
    'Konfirmasi terakhir: vendor yang sudah dipakai di Purchase Request / ' +
    'penerimaan barang TIDAK sebaiknya dihapus demi jejak audit pengadaan.\n\n' +
    `Tekan OK untuk MENGHAPUS PERMANEN "${nama}", atau Cancel untuk membatalkan.`
  )
  return gerbang2
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal) {
  if (h === 'phone') return <WaContact value={rawVal} />
  if (h === 'store_link') return <StoreLink value={rawVal} />
  // t_e626b674: kolom kategori dirender sbg chips multi-kategori —
  // bukan teks polos mentah (fallback generik).
  if (h === 'supplier_category') return vendorCategoryChips(rawVal)
  return null
}

// --- Aksi per baris (desktop) ---
// t_e626b674: hapus TIDAK menyolok — icon button muted kecil (✕) ber-border
// halus, dgn konfirmasi bertingkat sama seperti kartu mobile.
export function rowActions(r, ctx) {
  const { title, page, onDelete } = ctx
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
        <button
          type="button"
          className="btn-delete-muted"
          onClick={() => { if (confirmDeleteVendor(r)) onDelete(page, r) }}
          title={`Hapus ${r.name || title} (permanen — perlu konfirmasi 2x)`}
          aria-label={`Hapus ${r.name || title}`}
        >
          ✕
        </button>
      </div>
    </td>
  )
}

// --- Kartu mobile ---
// t_e626b674:
//   - kategori tampil sbg chips di header kartu (bukan teks abu redup saja);
//   - TIDAK ada lagi tombol merah full-width "Hapus Vendor" — diganti link
//     teks kecil abu-abu di pojok kanan bawah kartu (fontSize 11px, warna
//     #94a3b8, tanpa background), dgn konfirmasi bertingkat.
export function mobileCard(r, ctx) {
  const { page, onDelete } = ctx
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.name}</b>
          <div className="mobile-card-sub vendor-cat-row">
            {vendorCategoryChips(r.supplier_category, { emptyLabel: 'Kategori belum di-set' })}
          </div>
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
      {/* Aksi sekunder di-discourage: link teks kecil muted pojok bawah,
          BUKAN tombol merah mencolok. Konfirmasi bertingkat dijalankan dulu. */}
      <div className="vendor-card-footnote">
        <button
          type="button"
          className="vendor-delete-link"
          onClick={() => { if (confirmDeleteVendor(r)) onDelete(page, r) }}
          title="Hapus vendor permanen (perlu konfirmasi 2x)"
        >
          Hapus Vendor
        </button>
      </div>
    </>
  )
}
