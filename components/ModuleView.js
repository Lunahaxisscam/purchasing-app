import React, { useState, useEffect } from 'react'
import Create from './CreateModal'
import { headersFor, pretty, format, labels } from '../lib/constants'
import { makeItemHelpers } from '../modules/shared/itemHelpers'
import { filterRows } from '../modules/shared/filterRows'
import { sortRows } from '../modules/shared/sortRows'
import { renderGenericCell } from '../modules/shared/renderGenericCell'
import {
  renderModuleTableClass,
  renderModuleBanner,
  renderModuleRowClass,
  renderModuleFilters,
  renderModuleHeader,
  renderModuleCell,
  renderModuleDesktopRow,
  renderModuleRowActions,
  renderModuleRowExpand,
  renderModuleMobileCard
} from '../modules/shared/renderModuleCell'

// ============================================================
// SHELL MODUL (Fase 1 modularisasi)
// ============================================================
// File ini adalah SHELL TIPIS: ia hanya mengurus state UI bersama (filter,
// pencarian, sortir, popup catatan, modal tambah/edit) dan merangkai tabel.
// SELURUH kode spesifik modul (cell, aksi, filter tabs, kartu mobile, banner)
// berada di modules/<modul>/view.jsx dan dipanggil lewat dispatcher
// modules/shared/renderModuleCell.jsx.
//
// Menambah kolom / mengubah perilaku satu modul = cukup edit folder modulnya.
// Shell ini hanya perlu disentuh bila mengubah kontrak bersama (mis. prop baru
// dari pages/index.js) — perubahan itu harus lewat Tech Lead (docs/owners.md).
// ============================================================
export default function Module({ page, rows, allProjects, allMaterials = [], allPrItems = [], allReceivingItems = [], allRequests = [], allReceivings = [], allVendors = [], refresh, say, onStatusChange, onReceivingStatusChange, onMoveToWarehouse, onSendToTukang, onMarkHandoverDelivered, onDecideApproval, onReviseApproval, onApproveItem, onFinishPr, onMarkPrItemOrdered, onMarkReceivingItemReceived, onUpdateReceivingQty, onDelete, setPage }) {
  const [open, setOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState('active')
  const [receivingFilter, setReceivingFilter] = useState('all')
  const [prFilter, setPrFilter] = useState('all')
  const [approvalFilter, setApprovalFilter] = useState('all')
  const [materialFilter, setMaterialFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('all')
  const [handoverFilter, setHandoverFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedApproval, setExpandedApproval] = useState(null)
  const [expandedReceiving, setExpandedReceiving] = useState(null)
  const [openNoteId, setOpenNoteId] = useState(null)
  const [editRow, setEditRow] = useState(null)
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const title = labels[page]

  // Reset urutan & popup catatan saat pindah modul (set kolom tiap modul berbeda)
  useEffect(() => {
    setSortKey(null)
    setSortDir('asc')
    setOpenNoteId(null)
  }, [page])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  // Helper item lintas modul (PR/Approval/Receiving) — modules/shared/itemHelpers.js
  const H = makeItemHelpers({ allPrItems, allVendors, allMaterials, allReceivingItems, allRequests })
  const { prItemsForPr } = H

  // Filter baris per modul — modules/shared/filterRows.js
  let displayRows = filterRows({
    page, rows, allProjects,
    projectFilter, receivingFilter, prFilter, approvalFilter,
    materialFilter, vendorFilter, handoverFilter
  })

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim()
    displayRows = displayRows.filter(row => {
      return Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
    })
  }

  // Urutkan berdasar kolom yang diklik (klik ulang untuk balik arah) — modules/shared/sortRows.js
  displayRows = sortRows(displayRows, {
    sortKey, sortDir, page,
    requestItemRows: H.requestItemRows,
    approvalItemQtys: H.approvalItemQtys
  })

  const columns = headersFor(page, displayRows)
  const hasDeleteAction = ['vendors', 'materials', 'requests', 'receivings', 'handovers', 'projects', 'past_projects'].includes(page)

  // Konteks bersama untuk semua modul: helper, state UI, dan callback halaman.
  // Modul TIDAK boleh menambah/mengubah isi ctx — kontrak ini dijaga Tech Lead.
  const ctx = {
    H, columns, page, title, rows,
    allProjects, allMaterials, allVendors, allRequests, allReceivings,
    projectFilter, setProjectFilter,
    receivingFilter, setReceivingFilter,
    prFilter, setPrFilter,
    approvalFilter, setApprovalFilter,
    materialFilter, setMaterialFilter,
    vendorFilter, setVendorFilter,
    handoverFilter, setHandoverFilter,
    openNoteId, setOpenNoteId,
    expandedApproval, setExpandedApproval,
    expandedReceiving, setExpandedReceiving,
    setEditRow,
    onStatusChange, onReceivingStatusChange, onMoveToWarehouse, onSendToTukang,
    onMarkHandoverDelivered, onDecideApproval, onReviseApproval, onApproveItem,
    onFinishPr, onMarkPrItemOrdered, onMarkReceivingItemReceived,
    onUpdateReceivingQty, onDelete, setPage
  }

  return (
    <>
      {/* Banner modul (mis. peringatan stok BHP menipis di Materials) */}
      {renderModuleBanner(page, ctx)}
      <div className="toolbar">
        <div>
          <p className="muted">
            {displayRows.length} data tersedia {page === 'past_projects' && '(Project dengan status DONE)'}
          </p>
          {renderModuleFilters(page, ctx)}
        </div>
        <div className="toolbar-actions">
          <input
            type="search"
            className="search-input"
            placeholder="🔍 Cari..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {page === 'past_projects' && (
            <button type="button" className="outline btn-back-active" onClick={() => setPage('projects')}>
              ← Ke Project Aktif
            </button>
          )}
          {['projects', 'vendors', 'materials', 'requests', 'receivings', 'handovers'].includes(page) && (
            <button type="button" className="btn-create-module" onClick={() => setOpen(true)}>
              + Tambah {title}
            </button>
          )}
        </div>
      </div>
      {(open || editRow) && (
        <Create
          page={page}
          editRow={editRow}
          editItems={editRow ? prItemsForPr(editRow.id) : []}
          allReceivings={allReceivings}
          allProjects={allProjects}
          allMaterials={allMaterials}
          allVendors={allVendors}
          existingRequests={displayRows}
          allRequestsFull={allRequests}
          close={() => { setOpen(false); setEditRow(null) }}
          refresh={refresh}
          say={say}
        />
      )}
      <div className="table-scroll-hint">
        <span>⇄</span> Geser ke kanan untuk melihat kolom lengkap & tombol aksi
      </div>
      <div className="panel table desktop-table-view">
        <table className={renderModuleTableClass(page)}>
          <thead>
            <tr>
              {columns.map(h => (
                <th
                  key={h}
                  onClick={() => h !== 'items' && toggleSort(h)}
                  style={{ cursor: h === 'items' ? 'default' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  title={h === 'items' ? undefined : 'Klik untuk urutkan'}
                >
                  {renderModuleHeader(page, h) || pretty(h)}
                  {sortKey === h ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              {(hasDeleteAction || page === 'approvals') && (
                <th style={{ width: page === 'approvals' ? '140px' : (page === 'requests' ? '150px' : '90px'), textAlign: 'center' }}>Aksi</th>
              )}
            </tr>
          </thead>
          <tbody>
            {displayRows.length ? (
              displayRows.map((r, i) => {
                // Baris desktop khusus modul (mis. master-detail PR dengan rowSpan).
                // null = pakai baris generik di bawah.
                const customRow = renderModuleDesktopRow(page, r, ctx)
                return (
                <React.Fragment key={r.id || i}>
                {customRow !== null && customRow !== undefined ? customRow : (
                <tr className={renderModuleRowClass(page, r) || undefined}>
                  {columns.map(h => {
                    const rawVal = h === 'kode' ? (r.kode || r.code) : (h === 'qty' ? (r.qty ?? 0) : r[h])
                    const moduleCell = renderModuleCell(page, h, r, rawVal, ctx)
                    return (
                      <td key={h}>
                        {moduleCell !== null && moduleCell !== undefined
                          ? moduleCell
                          : renderGenericCell(page, h, r, rawVal, ctx)}
                      </td>
                    )
                  })}
                  {renderModuleRowActions(page, r, ctx)}
                </tr>
                )}
                {renderModuleRowExpand(page, r, ctx)}
                </React.Fragment>
              )})
            ) : (
              <tr>
                <td colSpan={columns.length + (hasDeleteAction || page === 'approvals' ? 1 : 0)} className="empty">
                  Belum ada data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* ===== MOBILE CARDS VIEW (Khusus Layar HP <= 900px) ===== */}
      <div className="mobile-cards-view">
        {displayRows.length ? (
          displayRows.map((r, i) => {
            const card = renderModuleMobileCard(page, r, ctx)
            return (
            <div className="mobile-card" key={r.id || i}>
              {card !== null && card !== undefined ? card : (
                /* Generic Card Fallback */
                <>
                  <div className="mobile-card-header">
                    <b className="mobile-card-title">{r.name || r.title || r.kode || 'Item'}</b>
                    {r.status && <span className={`badge status-${r.status}`}>{r.status}</span>}
                  </div>
                  <div className="mobile-card-body">
                    {columns.filter(h => !['id', 'name', 'title', 'kode', 'status'].includes(h)).map(h => (
                      <div className="mobile-card-row" key={h}>
                        <span className="mobile-label">{pretty(h)}:</span>
                        <span className="mobile-val">{format(r[h])}</span>
                      </div>
                    ))}
                  </div>
                  {hasDeleteAction && (
                    <div className="mobile-card-actions">
                      <button
                        type="button"
                        className="btn-delete"
                        onClick={() => onDelete(page, r)}
                        style={{ width: '100%' }}
                      >
                        Hapus
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )})
        ) : (
          <div className="panel empty">Belum ada data.</div>
        )}
      </div>

    </>
  )
}
