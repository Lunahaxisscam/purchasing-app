// ============================================================
// modules/shared/filterRows.js
// Logika filter baris per modul — diekstrak VERBATIM dari ModuleView.js.
// Fungsi murni: tidak menyentuh state React.
// ============================================================
import { normalizeStatus, isReceivingKendala, isStokMenipis, isHandoverDelivered } from '../../lib/constants'
import { isLeanMarked } from '../requests/leanRequest'
import { canEditRequest } from '../requests/workflow'

export function filterRows({
  page,
  rows,
  allProjects = [],
  projectFilter,
  receivingFilter,
  prFilter,
  approvalFilter,
  materialFilter,
  vendorFilter,
  handoverFilter,
  projectTab
}) {
  let displayRows = rows
  if (page === 'projects') {
    // t_31871b64: tab Aktif / Selesai (status DONE) di dalam modul Projects.
    // Tab memilih kelompok besar dulu; projectFilter lama tetap berlaku
    // di dalam tab tersebut (default 'active' = tampilkan SEMUA status
    // aktif, bukan hanya yang belum mulai — nama historis dipertahankan
    // agar perilaku lama tidak berubah).
    if (projectTab === 'done') displayRows = allProjects.filter(p => normalizeStatus(p.status) === 'DONE')
    else displayRows = allProjects.filter(p => normalizeStatus(p.status) !== 'DONE')
    if (projectFilter === 'all') { /* tanpa filter tambahan */ }
    else if (projectFilter === 'NOT_START') displayRows = displayRows.filter(p => normalizeStatus(p.status) === 'NOT_START')
    else if (projectFilter === 'ON_GOING') displayRows = displayRows.filter(p => normalizeStatus(p.status) === 'ON_GOING')
  } else if (page === 'requests') {
    // Draft/Revisi is the input inbox; History includes every noneditable
    // status, including unknown legacy values. These are display filters only.
    // Explicit legacy filters remain compatible with older local state.
    if (prFilter === 'HISTORY') displayRows = rows.filter(r => !canEditRequest(r))
    else if (prFilter === 'DRAFT') displayRows = rows.filter(r => String(r.status || '').toUpperCase() === 'DRAFT')
    else if (prFilter === 'SUBMITTED') displayRows = rows.filter(r => String(r.status || '').toUpperCase() === 'SUBMITTED')
    else if (prFilter === 'LEAN') displayRows = rows.filter(r => isLeanMarked(r.notes))
    else if (prFilter === 'SUBMITTED_LEGACY') displayRows = rows.filter(r => String(r.status || '').toUpperCase() === 'SUBMITTED' && !isLeanMarked(r.notes))
    else if (prFilter === 'APPROVED') displayRows = rows.filter(r => String(r.status || '').toUpperCase() === 'APPROVED')
    else if (prFilter === 'REVISI') displayRows = rows.filter(r => String(r.status || '').toUpperCase() === 'REVISI')
    else if (prFilter === 'REJECTED') displayRows = rows.filter(r => String(r.status || '').toUpperCase() === 'REJECTED')
    else if (prFilter === 'URGENT') displayRows = rows.filter(r => r.priority === 'URGENT')
    // Display only: shared requests and purchasing eligibility remain unchanged.
    else displayRows = rows.filter(canEditRequest)
  } else if (page === 'approvals') {
    if (approvalFilter === 'PENDING') displayRows = rows.filter(r => r.status === 'PENDING')
    else if (approvalFilter === 'APPROVED') displayRows = rows.filter(r => r.status === 'APPROVED')
    else if (approvalFilter === 'REVISI') displayRows = rows.filter(r => r.status === 'REVISI')
    else if (approvalFilter === 'REJECTED') displayRows = rows.filter(r => r.status === 'REJECTED')
  } else if (page === 'receivings') {
    if (receivingFilter === 'NORMAL') displayRows = rows.filter(r => !isReceivingKendala(r.status))
    else if (receivingFilter === 'RETUR') displayRows = rows.filter(r => String(r.status).toUpperCase().includes('RETUR'))
    else if (receivingFilter === 'REFUND') displayRows = rows.filter(r => String(r.status).toUpperCase().includes('REFUND'))
  } else if (page === 'materials') {
    if (materialFilter === 'STOK_MENIPIS') displayRows = rows.filter(isStokMenipis)
    else if (materialFilter === 'Lainnya') displayRows = rows.filter(r => !['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai'].includes(r.category))
    else if (materialFilter !== 'all') displayRows = rows.filter(r => r.category === materialFilter)
  } else if (page === 'vendors') {
    if (vendorFilter === 'HAS_PHONE') displayRows = rows.filter(r => !!r.phone)
    else if (vendorFilter === 'HAS_CONTACT') displayRows = rows.filter(r => !!r.contact)
  } else if (page === 'handovers') {
    // t_b418827b: "Sudah Diserahkan" = bukti fisik (`diserahkan_at`), BUKAN
    // status CONFIRMED (bisa berasal dari data lama tanpa konfirmasi fisik).
    if (handoverFilter === 'CONFIRMED') displayRows = rows.filter(isHandoverDelivered)
    else if (handoverFilter === 'DRAFT') displayRows = rows.filter(r => !isHandoverDelivered(r))
  }
  return displayRows
}
