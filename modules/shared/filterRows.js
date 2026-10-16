// ============================================================
// modules/shared/filterRows.js
// Logika filter baris per modul — diekstrak VERBATIM dari ModuleView.js.
// Fungsi murni: tidak menyentuh state React.
// ============================================================
import { normalizeStatus, isReceivingKendala, isStokMenipis, isHandoverDelivered } from '../../lib/constants'

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
  handoverFilter
}) {
  let displayRows = rows
  if (page === 'projects') {
    if (projectFilter === 'all') displayRows = allProjects
    else if (projectFilter === 'NOT_START') displayRows = allProjects.filter(p => normalizeStatus(p.status) === 'NOT_START')
    else if (projectFilter === 'ON_GOING') displayRows = allProjects.filter(p => normalizeStatus(p.status) === 'ON_GOING')
    else displayRows = allProjects.filter(p => normalizeStatus(p.status) !== 'DONE')
  } else if (page === 'requests') {
    if (prFilter === 'DRAFT') displayRows = rows.filter(r => r.status === 'DRAFT')
    else if (prFilter === 'SUBMITTED') displayRows = rows.filter(r => r.status === 'SUBMITTED')
    else if (prFilter === 'APPROVED') displayRows = rows.filter(r => r.status === 'APPROVED')
    else if (prFilter === 'REVISI') displayRows = rows.filter(r => r.status === 'REVISI')
    else if (prFilter === 'REJECTED') displayRows = rows.filter(r => r.status === 'REJECTED')
    else if (prFilter === 'URGENT') displayRows = rows.filter(r => r.priority === 'URGENT')
    // 'all' (default saat modul dibuka): sembunyikan PR yang sudah APPROVED —
    // arahan DAT. Tab 'APPROVED' tetap tersedia untuk melihat riwayat approval.
    else displayRows = rows.filter(r => r.status !== 'APPROVED')
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
