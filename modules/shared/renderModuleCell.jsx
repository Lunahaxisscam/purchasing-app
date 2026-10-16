// ============================================================
// modules/shared/renderModuleCell.jsx — DISPATCHER MODUL
// ============================================================
// Shell ModuleView HANYA memanggil fungsi di file ini; ia tidak perlu tahu
// detail modul mana pun. Menambah modul baru = tambah 1 entri di MODULES +
// folder modules/<id>/ — tanpa menyentuh modul lain.
// ============================================================
import * as projects from '../projects/view'
import * as vendors from '../vendors/view'
import * as materials from '../materials/view'
import * as requests from '../requests/view'
import * as approvals from '../approvals/view'
import * as receivings from '../receivings/view'
import * as handovers from '../handovers/view'

// projects & past_projects berbagi modul yang sama (kolom identik).
const MODULES = {
  projects,
  past_projects: projects,
  vendors,
  materials,
  requests,
  approvals,
  receivings,
  handovers
}

// Kelas <table> khusus per modul (undefined = tabel standar).
const TABLE_CLASS = {
  materials: 'materials-table',
  requests: 'requests-table',
  approvals: 'approvals-table'
}

export function renderModuleTableClass(page) {
  return TABLE_CLASS[page]
}

// Banner di atas toolbar (mis. peringatan stok menipis). null = tanpa banner.
export function renderModuleBanner(page, ctx) {
  const m = MODULES[page]
  return (m && m.banner) ? m.banner(ctx) : null
}

// Kelas baris khusus (mis. row-stok-menipis). null = tanpa kelas.
export function renderModuleRowClass(page, r) {
  const m = MODULES[page]
  return (m && m.rowClass) ? m.rowClass(r) : null
}

// Filter tabs per modul. null = modul tanpa filter.
export function renderModuleFilters(page, ctx) {
  const m = MODULES[page]
  return (m && m.filters) ? m.filters(ctx) : null
}

// Header kolom khusus (mis. ikon prioritas PR). null = pakai label biasa.
export function renderModuleHeader(page, h) {
  const m = MODULES[page]
  return (m && m.header) ? m.header(h) : null
}

// Cell tabel desktop. null = bukan kolom modul ini (shell lanjut ke generik).
export function renderModuleCell(page, h, r, rawVal, ctx) {
  const m = MODULES[page]
  return (m && m.renderCell) ? m.renderCell(h, r, rawVal, ctx) : null
}

// Baris desktop khusus modul (mis. master-detail PR). null = baris generik.
export function renderModuleDesktopRow(page, r, ctx) {
  const m = MODULES[page]
  return (m && m.desktopRow) ? m.desktopRow(r, ctx) : null
}

// Aksi per baris (kolom "Aksi"). null = modul tanpa aksi.
export function renderModuleRowActions(page, r, ctx) {
  const m = MODULES[page]
  return (m && m.rowActions) ? m.rowActions(r, ctx) : null
}

// Baris perluasan (material approval / item purchase). null = tidak ada.
export function renderModuleRowExpand(page, r, ctx) {
  const m = MODULES[page]
  return (m && m.rowExpand) ? m.rowExpand(r, ctx) : null
}

// Kartu mobile. null = shell memakai kartu generik.
export function renderModuleMobileCard(page, r, ctx) {
  const m = MODULES[page]
  return (m && m.mobileCard) ? m.mobileCard(r, ctx) : null
}

// Modal khusus modul (mis. form Terima Barang di Purchase). null = tidak ada.
// Dipanggil SEKALI per render halaman (bukan per baris).
export function renderModuleModal(page, ctx) {
  const m = MODULES[page]
  return (m && m.receiptForm) ? m.receiptForm(ctx) : null
}
