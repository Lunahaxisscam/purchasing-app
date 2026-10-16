import React, { useState, useEffect, useMemo } from 'react'
import Create from './CreateModal'
import { headersFor, pretty, format, labels } from '../lib/constants'
import { makeItemHelpers } from '../modules/shared/itemHelpers'
import { filterRows } from '../modules/shared/filterRows'
import { sortRows } from '../modules/shared/sortRows'
import {
  PAGE_SIZE, limitRows, shownLabel
} from '../modules/shared/visibleRows'
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
  // Antrean Approval default "Menunggu" (PENDING) — arahan DAT (t_0a35264f):
  // modul Approval yang baru dibuka TIDAK lagi menampilkan riwayat APPROVED
  // lebih dulu. Riwayat (Disetujui/Revisi/Ditolak/Semua) tetap bisa dibuka
  // eksplisit lewat tab-nya masing-masing.
  const [approvalFilter, setApprovalFilter] = useState('PENDING')
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
  // Arahan DAT (t_cf05c96f): daftar modul jangan panjang ke bawah — default
  // tampil 10 data, sisanya dibuka lewat tombol "Show More" (+10) di bawah
  // tabel/kartu. Hanya membatasi TAMPILAN: filter/search/sort tetap bekerja
  // di SELURUH dataset (lihat displayRows & limitRows di bawah), data tidak
  // diubah, dan ini bukan server pagination.
  const [listLimit, setListLimit] = useState(PAGE_SIZE)
  const title = labels[page]

  // Reset urutan, popup catatan & limit daftar saat pindah modul (set kolom
  // tiap modul berbeda; limit juga WAJIB kembali ke 10 sesuai arahan DAT)
  useEffect(() => {
    setSortKey(null)
    setSortDir('asc')
    setOpenNoteId(null)
    setListLimit(PAGE_SIZE)
    // Arahan DAT (t_0a35264f): setiap pindah modul lalu masuk/buka ulang
    // Approval, antrean SELALU kembali ke "Menunggu" (PENDING) — bukan filter
    // terakhir yang dipakai. Modul lain mempertahankan filter terakhirnya.
    if (page === 'approvals') setApprovalFilter('PENDING')
  }, [page])

  // Arahan DAT (t_cf05c96f): limit kembali ke 10 setiap kali filter tab /
  // pencarian / urutan berubah — pengguna selalu mulai dari potongan awal.
  useEffect(() => {
    setListLimit(PAGE_SIZE)
  }, [projectFilter, receivingFilter, prFilter, approvalFilter, materialFilter, vendorFilter, handoverFilter, searchQuery, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  // Helper item lintas modul (PR/Approval/Receiving) — modules/shared/itemHelpers.js
  const H = useMemo(() => makeItemHelpers({ allPrItems, allVendors, allMaterials, allReceivingItems, allRequests }), [allPrItems, allVendors, allMaterials, allReceivingItems, allRequests])
  const { prItemsForPr } = H

  // Filter & sortir baris per modul (dimemoize agar tidak kalkulasi ulang pada setiap render biasa)
  const displayRows = useMemo(() => {
    let list = filterRows({
      page, rows, allProjects,
      projectFilter, receivingFilter, prFilter, approvalFilter,
      materialFilter, vendorFilter, handoverFilter
    })

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(row => {
        return Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
      })
    }

    return sortRows(list, {
      sortKey, sortDir, page,
      requestItemRows: H.requestItemRows,
      approvalItemQtys: H.approvalItemQtys
    })
  }, [
    page, rows, allProjects,
    projectFilter, receivingFilter, prFilter, approvalFilter,
    materialFilter, vendorFilter, handoverFilter,
    searchQuery, sortKey, sortDir, H
  ])

  // Arahan DAT (t_cf05c96f): potong TAMPILAN setelah filter+search+sort —
  // hitungan tab/banner (dari ctx.rows) & hasil pencarian tetap memakai
  // SELURUH dataset; hanya jumlah baris yang dirender yang dibatasi.
  const { visible: visibleRows, total: totalRows, shown: shownRows, hasMore } = useMemo(
    () => limitRows(displayRows, page, listLimit),
    [displayRows, page, listLimit]
  )

  const columns = headersFor(page, displayRows)
  const hasDeleteAction = ['vendors', 'materials', 'requests', 'receivings', 'handovers', 'projects', 'past_projects'].includes(page)

  // Empty state jelas per konteks — arahan DAT (t_0a35264f): antrean Approval
  // "Menunggu" yang kosong TIDAK boleh fallback menampilkan data APPROVED;
  // tampilkan pesan tegas bahwa tidak ada yang perlu disetujui.
  const emptyMessage = page === 'approvals' && approvalFilter === 'PENDING'
    ? 'Tidak ada pengajuan yang perlu disetujui.'
    : 'Belum ada data.'

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
    listLimit, setListLimit,
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
      {/* Feedback DAT: toolbar Vendor tampil BERSIH — teks counter
          "{n} data tersedia" dan container filter kosong tidak dirender
          (filter pills Vendor sudah dihapus di modules/vendors/view.jsx).
          Sisa: search bar + tombol + Tambah Vendor. justifyContent
          flex-end menjaga posisi aksi tetap di kanan seperti modul lain. */}
      <div className="toolbar" style={page === 'vendors' ? { justifyContent: 'flex-end' } : undefined}>
        {page !== 'vendors' && (
          <div>
            <p className="muted">
              {displayRows.length} data tersedia {page === 'past_projects' && '(Project dengan status DONE)'}
            </p>
            {renderModuleFilters(page, ctx)}
          </div>
        )}
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
            {visibleRows.length ? (
              visibleRows.map((r, i) => {
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
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* ===== MOBILE CARDS VIEW (Khusus Layar HP <= 900px) ===== */}
      <div className="mobile-cards-view">
        {visibleRows.length ? (
          visibleRows.map((r, i) => {
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
          <div className="panel empty">{emptyMessage}</div>
        )}
      </div>

      {/* ===== DAFTAR RINGKAS + SHOW MORE (Arahan DAT t_cf05c96f) =====
          Footer bersama di bawah tabel desktop & kartu mobile. Muncul hanya
          bila MASIH ada data yang belum tampil; indikator "Menampilkan X
          dari Y" memakai total hasil filter (bukan sekadar potongan). */}
      {hasMore && (
        <div className="list-show-more">
          <span className="list-shown-indicator">{shownLabel(shownRows, totalRows)}</span>
          <div className="list-show-more-actions">
            <button
              type="button"
              className="outline"
              onClick={() => setListLimit(l => l + PAGE_SIZE)}
            >
              ▼ Show More / Tampilkan Lebih Banyak
            </button>
            {shownRows > PAGE_SIZE && (
              <button
                type="button"
                className="outline"
                onClick={() => setListLimit(PAGE_SIZE)}
                title="Kembali menampilkan 10 data pertama"
              >
                ▲ Ringkas
              </button>
            )}
          </div>
        </div>
      )}

    </>
  )
}
