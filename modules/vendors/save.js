// ============================================================
// modules/vendors/save.js — logika simpan Vendor
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
// ============================================================
import { insertAndFinish } from '../shared/saveHelpers'

export async function save(ctx) {
  const { form } = ctx
  const data = {
    name: form.name,
    phone: form.phone || null,
    store_link: form.store_link || null,
    supplier_category: form.supplier_category || null,
    contact: form.contact || null
  }
  await insertAndFinish(ctx, { table: 'vendors', data })
}
