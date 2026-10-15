// ============================================================
// modules/handovers/save.js — logika simpan Handover
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
// ============================================================
import { insertAndFinish } from '../shared/saveHelpers'

export async function save(ctx) {
  const { form } = ctx
  const data = {
    receiving_id: form.receiving_id || null,
    project_id: form.project_id || null,
    received_by: form.received_by,
    status: form.handover_status || 'CONFIRMED',
    handover_date: form.handover_date || new Date().toISOString().slice(0, 10),
    note: form.notes || null
  }
  await insertAndFinish(ctx, { table: 'handovers', data })
}
