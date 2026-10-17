// ============================================================
// modules/vendors/save.js — logika simpan Vendor
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
//
// t_e626b674 (arahan DAT): MULTI-KATEGORI.
// form.supplier_category kini berisi string dipisah koma (dari checklist
// multi-select di form.jsx). Disimpan APA ADANYA ke kolom scalar existing
// vendors.supplier_category — TANPA migrasi DB, kompatibel mundur:
//   - vendor lama 1 kategori: format tidak berubah;
//   - vendor multi: "Plywood & Board, HPL & Edging";
//   - eligibility estimator (modules/requests/estimator.js) sudah membaca
//     format koma + array, jadi PR otomatis ikut multi-kategori.
// Disini kategori dibersihkan (trim/dedupe) agar tidak ada ", ," kosong
// atau duplikat ejaan yang masuk DB.
// ============================================================
import { insertAndFinish } from '../shared/saveHelpers'
import { cleanCategoryList } from './categories'

export async function save(ctx) {
  const { form } = ctx
  const kategoriBersih = cleanCategoryList(String(form.supplier_category || '').split(','))
  const data = {
    name: form.name,
    phone: form.phone || null,
    store_link: form.store_link || null,
    supplier_category: kategoriBersih.length ? kategoriBersih.join(', ') : null,
    contact: form.contact || null
  }
  await insertAndFinish(ctx, { table: 'vendors', data })
}
