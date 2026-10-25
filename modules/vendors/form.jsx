// ============================================================
// modules/vendors/form.jsx — form Tambah/Edit Vendor
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/CreateModal.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Field form {label} diubah
// HANYA di file ini.
//
// Kontrak: formBody(ctx) mengembalikan potongan JSX (fragment) yang dirender
// shell CreateModal. ctx berisi form, setForm, field, isEdit, editRow, dst.
// yang disediakan shell — lihat components/CreateModal.js.
//
// ============================================================
// t_e626b674 (arahan DAT): KATEGORI MULTI-SELECT.
// Dropdown tunggal diganti CHECKLIST kategori material (sumber sama dengan
// master Material: materialCategories dari shell CreateModal). Admin bisa
// memilih LEBIH DARI 1 kategori utk 1 vendor.
// Format simpan kompatibel: string dipisah koma di kolom scalar
// vendors.supplier_category (parser di modules/vendors/categories.js;
// eligibility estimator juga sudah membaca format koma + array).
// Data lama (kategori tunggal / "A, B" / array) tetap ter-prefill benar.
// ============================================================
import React from 'react'
import { parseVendorCategories } from './categories'

export function formBody(ctx) {
  const { form, setForm, field, materialCategories } = ctx
  const selected = parseVendorCategories(form.supplier_category)
  // Pencocokan case-insensitive: kategori lama mungkin beda kapital dgn
  // master list — jangan sampai "hpl & edging" tidak tercentang/terhapus.
  const sameCat = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
  const hasCat = (c) => selected.some(x => sameCat(x, c))
  const toggleCat = (c) => {
    const next = hasCat(c) ? selected.filter(x => !sameCat(x, c)) : [...selected, c]
    setForm({ ...form, supplier_category: next.join(', ') })
  }
  return (
    <>
      {field('name', 'Nama Vendor', 'text', true)}
      {/* t_31871b64 (Sprint 1, arahan DAT): label kontak DISERAGAMKAN —
          satu nama untuk satu makna di form, kartu mobile, dan header tabel
          (lihat pretty() di lib/constants.js):
            phone      -> 'Kontak WA'
            store_link -> 'Link Toko'
          Kolom DB TIDAK berubah; hanya teks label yang seragam. */}
      {field('phone', 'Kontak WA', 'text', false)}
      {field('store_link', 'Link Toko', 'text', false)}
      {/* ============================================================
          KATEGORI MATERIAL YANG DISUPLAI — CHECKLIST MULTI-SELECT
          (t_e626b674). Checkbox bergaya Noir: tiap kategori = satu baris
          pill dgn checkbox; kategori terpilih ditandai chip aktif.
          Simpan: join ', ' — kompatibel dgn kolom existing & estimator.
          ============================================================ */}
      <div className="vendor-cat-checklist" role="group" aria-label="Kategori material yang disuplai vendor ini">
        <span className="vendor-cat-checklist-label">Kategori Material yang Disuplai Vendor Ini</span>
        <span className="vendor-cat-checklist-hint">
          {selected.length
            ? `${selected.length} kategori dipilih — boleh lebih dari satu`
            : 'Belum ada kategori dipilih (boleh lebih dari satu)'}
        </span>
        {(materialCategories || []).map(c => {
          const checked = hasCat(c)
          return (
            <label key={c} className={`vendor-cat-option${checked ? ' is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleCat(c)}
              />
              <span className="vendor-cat-option-text">{c}</span>
              {checked && <span className="vendor-cat-option-mark">✓</span>}
            </label>
          )
        })}
      </div>
      {/* t_31871b64 (Sprint 1, arahan DAT): email / kontak lain DIPINDAH ke
          bagian LANJUTAN dan tetap OPSIONAL — vendor yang hanya punya WA
          tidak perlu mengisi. Native <details>: tanpa state tambahan,
          tetap terbaca oleh screen reader. Kolom DB `contact` tidak berubah. */}
      <details className="vendor-form-advanced">
        <summary className="vendor-form-advanced-summary">Lanjutan (opsional)</summary>
        <div className="vendor-form-advanced-body">
          {field('contact', 'Email / Kontak Lain', 'text', false)}
          <p className="vendor-form-advanced-hint">
            Boleh dikosongkan — cukup Kontak WA bila itu satu-satunya cara menghubungi vendor.
          </p>
        </div>
      </details>
    </>
  )
}
