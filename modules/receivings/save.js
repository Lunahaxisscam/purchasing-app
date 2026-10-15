// ============================================================
// modules/receivings/save.js — logika simpan Purchase / Receiving
// ============================================================
// Diekstrak VERBATIM dari CreateModal.save() (Fase 2 modularisasi).
// ============================================================
import { buildReceivingNote } from '../../lib/constants'
import { insertAndFinish } from '../shared/saveHelpers'

export async function save(ctx) {
  const { form } = ctx
  const st = String(form.receiving_status || 'NORMAL').toUpperCase()
  const data = {
    purchase_request_id: form.pr_id || null,
    project_id: form.project_id || null,
    delivery_note: form.delivery_note,
    invoice_no: form.invoice_no || null,
    status: st,
    kendala: st === 'RETUR' ? 'RETUR' : (st === 'REFUND' ? 'REFUND' : null),
    received_date: form.received_date || new Date().toISOString().slice(0, 10),
    note: buildReceivingNote({ nominal: form.nominal, nota: form.nota_link, extra: form.notes })
  }
  await insertAndFinish(ctx, { table: 'receivings', data })
}
