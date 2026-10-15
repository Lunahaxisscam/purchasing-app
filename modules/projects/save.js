// ============================================================
// modules/projects/save.js — logika simpan Project
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
// ============================================================
import { insertAndFinish } from '../shared/saveHelpers'

export async function save(ctx) {
  const { form } = ctx
  const data = {
    kode: form.kode || null,
    code: form.kode || null,
    name: form.name,
    status: form.status
  }
  await insertAndFinish(ctx, { table: 'projects', data })
}
