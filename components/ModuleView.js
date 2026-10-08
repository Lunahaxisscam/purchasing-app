import React, { useState, useMemo, useEffect } from 'react'
import Create from './CreateModal'
import { StoreLink, WaContact } from './Common'
import { exportWorkbook } from '../lib/workflow'
import {
  headersFor,
  pretty,
  format,
  prettyStatus,
  normalizeStatus,
  prettyReceivingStatus,
  isReceivingKendala,
  statusOptions,
  labels,
  parseReceivingNote,
  notaHref,
  rupiah
} from '../lib/constants'

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

  // --- Helper alur item (dipakai modul Approval & Receiving) ---
  // CATATAN: item dibaca dari prop terpisah (allPrItems/allReceivingItems) karena
  // `rows` pada komponen ini adalah array baris modul aktif, bukan objek semua tabel.
  const prItemsForPr = (prId) => (allPrItems || []).filter(it => it.pr_id === prId)
  const vendorName = (vendorId) => ((allVendors || []).find(v => v.id === vendorId) || {}).name || ''
  const approvalItems = (approval) => prItemsForPr(approval.purchase_request_id)
  const receivingItemsForReceiving = (recId) => (allReceivingItems || []).filter(it => it.receiving_id === recId)

  // --- Poin 2: progres penerimaan (parsial vs lengkap) ---
  const orderedQtyFor = (it) => {
    const prItem = (allPrItems || []).find(p => p.id === it.pr_item_id)
    const n = Number(prItem?.quantity)
    return isFinite(n) && n > 0 ? n : null
  }

  const itemReceiveStatus = (it) => {
    const rec = Number(it.quantity_received || 0)
    const ordered = orderedQtyFor(it)
    if (!(rec > 0)) return { key: 'BELUM', rec, ordered, text: `Belum Diterima (0 / ${ordered || 0})` }
    if (ordered === null || rec >= ordered) return { key: 'LENGKAP', rec, ordered: ordered === null ? rec : ordered, text: `✓ Lengkap (${rec} / ${ordered === null ? rec : ordered})` }
    return { key: 'PARSIAL', rec, ordered, text: `⏳ Parsial (${rec} / ${ordered} — Sisa ${ordered - rec})` }
  }

  const itemBadgeStyle = (key) => key === 'LENGKAP'
    ? { background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }
    : key === 'PARSIAL'
      ? { background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6' }
      : { background: '#f3f5f6', color: '#556260', border: '1px solid #d6dcde' }

  const receivingProgress = (recId) => {
    const items = receivingItemsForReceiving(recId)
    if (!items.length) return null
    const statuses = items.map(itemReceiveStatus)
    const doneCount = statuses.filter(s => s.key === 'LENGKAP').length
    return {
      statuses,
      doneCount,
      total: statuses.length,
      allDone: doneCount === statuses.length,
      anyReceived: statuses.some(s => s.rec > 0)
    }
  }

  // Status persetujuan per material: ORDERED (sudah dipesan) > APPROVED (disetujui) > PENDING (menunggu)
  const itemState = (it) => {
    const s = String(it?.status || '').toUpperCase()
    if (s === 'ORDERED') return 'ORDERED'
    if (s === 'APPROVED') return 'APPROVED'
    return 'PENDING'
  }

  // Baris item utk modul Approval: pakai pr_items; jika kosong (data lama),
  // fallback ke ringkasan material PR supaya barang yang perlu di-approve tetap terlihat.
  const approvalItemLines = (approval) => {
    const items = approvalItems(approval)
    if (items.length) {
      return items
        .map(it => {
          const base = `${it.quantity ?? ''} ${it.unit || ''} ${it.item_name || it.kode || ''}`.replace(/\s+/g, ' ').trim()
          const bits = []
          if (it.supplier_category) bits.push(`Supplier: ${it.supplier_category}`)
          const v = vendorName(it.vendor_id)
          if (v) bits.push(`Vendor: ${v}`)
          return bits.length ? `${base} — ${bits.join(' · ')}` : base
        })
        .filter(Boolean)
    }
    const pr = (allRequests || []).find(p => p.id === approval.purchase_request_id)
    const s = String(pr?.materials_summary || '').trim()
    if (!s) return []
    return s.split(',').map(x => x.trim()).filter(Boolean)
  }

  // Daftar baris item material sebuah PR (dipakai modul Purchase Request):
  // utamakan pr_items yang lengkap; fallback ke ringkasan teks bila item tidak ada.
  const requestItemLines = (pr) => {
    const items = prItemsForPr(pr.id)
    if (items.length) {
      return items
        .map(it => {
          const base = `${it.quantity ?? ''} ${it.unit || ''} ${it.item_name || it.kode || ''}`.replace(/\s+/g, ' ').trim()
          const bits = []
          if (it.supplier_category) bits.push(`Supplier: ${it.supplier_category}`)
          const v = vendorName(it.vendor_id)
          if (v) bits.push(`Vendor: ${v}`)
          return bits.length ? `${base} — ${bits.join(' · ')}` : base
        })
        .filter(Boolean)
    }
    const s = String(pr.materials_summary || '').trim()
    if (!s) return ['—']
    return s.split(',').map(x => x.trim()).filter(Boolean)
  }

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
    if (materialFilter === 'Lainnya') displayRows = rows.filter(r => !['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai'].includes(r.category))
    else if (materialFilter !== 'all') displayRows = rows.filter(r => r.category === materialFilter)
  } else if (page === 'vendors') {
    if (vendorFilter === 'HAS_PHONE') displayRows = rows.filter(r => !!r.phone)
    else if (vendorFilter === 'HAS_CONTACT') displayRows = rows.filter(r => !!r.contact)
  } else if (page === 'handovers') {
    if (handoverFilter === 'CONFIRMED') displayRows = rows.filter(r => r.status === 'CONFIRMED' || r.status === 'SELESAI')
    else if (handoverFilter === 'DRAFT') displayRows = rows.filter(r => r.status !== 'CONFIRMED' && r.status !== 'SELESAI')
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim()
    displayRows = displayRows.filter(row => {
      return Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
    })
  }

  // Urutkan berdasar kolom yang diklik (klik ulang untuk balik arah)
  if (sortKey) {
    const dir = sortDir === 'desc' ? -1 : 1
    const valOf = (row) => (sortKey === 'kode' ? (row.kode || row.code) : row[sortKey])
    displayRows = [...displayRows].sort((a, b) => {
      const va = valOf(a)
      const vb = valOf(b)
      if (va === null || va === undefined) return (vb === null || vb === undefined) ? 0 : 1
      if (vb === null || vb === undefined) return -1
      const sa = String(va).trim()
      const sb = String(vb).trim()
      const na = Number(sa)
      const nb = Number(sb)
      if (sa !== '' && sb !== '' && isFinite(na) && isFinite(nb)) return (na - nb) * dir
      return sa.localeCompare(sb, 'id', { numeric: true, sensitivity: 'base' }) * dir
    })
  }

  const columns = headersFor(page, displayRows)
  const hasDeleteAction = ['vendors', 'materials', 'requests', 'receivings', 'handovers', 'projects', 'past_projects'].includes(page)

  return (
    <>
      <div className="toolbar">
        <div>
          <p className="muted">
            {displayRows.length} data tersedia {page === 'past_projects' && '(Project dengan status DONE)'}
          </p>
          {page === 'projects' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${projectFilter === 'active' ? 'active' : ''}`}
                onClick={() => setProjectFilter('active')}
              >
                Aktif ({allProjects.filter(p => normalizeStatus(p.status) !== 'DONE').length})
              </button>
              <button
                type="button"
                className={`pill ${projectFilter === 'ON_GOING' ? 'active' : ''}`}
                onClick={() => setProjectFilter('ON_GOING')}
              >
                On Going ({allProjects.filter(p => normalizeStatus(p.status) === 'ON_GOING').length})
              </button>
              <button
                type="button"
                className={`pill ${projectFilter === 'NOT_START' ? 'active' : ''}`}
                onClick={() => setProjectFilter('NOT_START')}
              >
                Not Start ({allProjects.filter(p => normalizeStatus(p.status) === 'NOT_START').length})
              </button>
              <button
                type="button"
                className={`pill ${projectFilter === 'all' ? 'active' : ''}`}
                onClick={() => setProjectFilter('all')}
              >
                Semua ({allProjects.length})
              </button>
            </div>
          )}
          {page === 'requests' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${prFilter === 'all' ? 'active' : ''}`}
                onClick={() => setPrFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'DRAFT' ? 'active' : ''}`}
                onClick={() => setPrFilter('DRAFT')}
              >
                Draft ({rows.filter(r => r.status === 'DRAFT').length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'SUBMITTED' ? 'active' : ''}`}
                onClick={() => setPrFilter('SUBMITTED')}
              >
                Submitted ({rows.filter(r => r.status === 'SUBMITTED').length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'APPROVED' ? 'active' : ''}`}
                onClick={() => setPrFilter('APPROVED')}
              >
                Approved ({rows.filter(r => r.status === 'APPROVED').length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'REVISI' ? 'active' : ''}`}
                onClick={() => setPrFilter('REVISI')}
              >
                Revisi ({rows.filter(r => r.status === 'REVISI').length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'REJECTED' ? 'active' : ''}`}
                onClick={() => setPrFilter('REJECTED')}
              >
                Ditolak ({rows.filter(r => r.status === 'REJECTED').length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'URGENT' ? 'active' : ''}`}
                onClick={() => setPrFilter('URGENT')}
                style={rows.some(r => r.priority === 'URGENT') ? { borderColor: '#c93b2b', color: '#c93b2b', fontWeight: 'bold' } : {}}
              >
                🚨 Prioritas ({rows.filter(r => r.priority === 'URGENT').length})
              </button>
            </div>
          )}
          {page === 'approvals' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${approvalFilter === 'all' ? 'active' : ''}`}
                onClick={() => setApprovalFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${approvalFilter === 'PENDING' ? 'active' : ''}`}
                onClick={() => setApprovalFilter('PENDING')}
                style={rows.some(r => r.status === 'PENDING') ? { borderColor: '#d97706', color: '#d97706', fontWeight: 'bold' } : {}}
              >
                ⏳ Menunggu ({rows.filter(r => r.status === 'PENDING').length})
              </button>
              <button
                type="button"
                className={`pill ${approvalFilter === 'APPROVED' ? 'active' : ''}`}
                onClick={() => setApprovalFilter('APPROVED')}
              >
                ✓ Disetujui ({rows.filter(r => r.status === 'APPROVED').length})
              </button>
              <button
                type="button"
                className={`pill ${approvalFilter === 'REVISI' ? 'active' : ''}`}
                onClick={() => setApprovalFilter('REVISI')}
              >
                ✎ Revisi ({rows.filter(r => r.status === 'REVISI').length})
              </button>
              <button
                type="button"
                className={`pill ${approvalFilter === 'REJECTED' ? 'active' : ''}`}
                onClick={() => setApprovalFilter('REJECTED')}
              >
                ✕ Ditolak ({rows.filter(r => r.status === 'REJECTED').length})
              </button>
            </div>
          )}
          {page === 'receivings' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${receivingFilter === 'all' ? 'active' : ''}`}
                onClick={() => setReceivingFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${receivingFilter === 'NORMAL' ? 'active' : ''}`}
                onClick={() => setReceivingFilter('NORMAL')}
              >
                ✓ Normal ({rows.filter(r => !isReceivingKendala(r.status)).length})
              </button>
              <button
                type="button"
                className={`pill ${receivingFilter === 'RETUR' ? 'active' : ''}`}
                onClick={() => setReceivingFilter('RETUR')}
                style={rows.some(r => String(r.status).toUpperCase().includes('RETUR')) ? { borderColor: '#d97706', color: '#d97706', fontWeight: 'bold' } : {}}
              >
                ⚠️ Retur ({rows.filter(r => String(r.status).toUpperCase().includes('RETUR')).length})
              </button>
              <button
                type="button"
                className={`pill ${receivingFilter === 'REFUND' ? 'active' : ''}`}
                onClick={() => setReceivingFilter('REFUND')}
                style={rows.some(r => String(r.status).toUpperCase().includes('REFUND')) ? { borderColor: '#c93b2b', color: '#c93b2b', fontWeight: 'bold' } : {}}
              >
                ⚠️ Refund ({rows.filter(r => String(r.status).toUpperCase().includes('REFUND')).length})
              </button>
            </div>
          )}
          {page === 'materials' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${materialFilter === 'all' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${materialFilter === 'Plywood & Board' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('Plywood & Board')}
              >
                Plywood & Board ({rows.filter(r => r.category === 'Plywood & Board').length})
              </button>
              <button
                type="button"
                className={`pill ${materialFilter === 'HPL & Edging' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('HPL & Edging')}
              >
                HPL & Edging ({rows.filter(r => r.category === 'HPL & Edging').length})
              </button>
              <button
                type="button"
                className={`pill ${materialFilter === 'Hardware & Fitting' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('Hardware & Fitting')}
              >
                Hardware & Fitting ({rows.filter(r => r.category === 'Hardware & Fitting').length})
              </button>
              <button
                type="button"
                className={`pill ${materialFilter === 'Bahan Habis Pakai' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('Bahan Habis Pakai')}
              >
                Bahan Habis Pakai ({rows.filter(r => r.category === 'Bahan Habis Pakai').length})
              </button>
              <button
                type="button"
                className={`pill ${materialFilter === 'Lainnya' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('Lainnya')}
              >
                Lainnya ({rows.filter(r => !['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai'].includes(r.category)).length})
              </button>
            </div>
          )}
          {page === 'vendors' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${vendorFilter === 'all' ? 'active' : ''}`}
                onClick={() => setVendorFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${vendorFilter === 'HAS_PHONE' ? 'active' : ''}`}
                onClick={() => setVendorFilter('HAS_PHONE')}
              >
                Ada Telepon ({rows.filter(r => !!r.phone).length})
              </button>
              <button
                type="button"
                className={`pill ${vendorFilter === 'HAS_CONTACT' ? 'active' : ''}`}
                onClick={() => setVendorFilter('HAS_CONTACT')}
              >
                Ada Kontak/Email ({rows.filter(r => !!r.contact).length})
              </button>
            </div>
          )}
          {page === 'handovers' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${handoverFilter === 'all' ? 'active' : ''}`}
                onClick={() => setHandoverFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${handoverFilter === 'CONFIRMED' ? 'active' : ''}`}
                onClick={() => setHandoverFilter('CONFIRMED')}
              >
                ✓ Sudah Diserahkan ({rows.filter(r => r.status === 'CONFIRMED' || r.status === 'SELESAI').length})
              </button>
              <button
                type="button"
                className={`pill ${handoverFilter === 'DRAFT' ? 'active' : ''}`}
                onClick={() => setHandoverFilter('DRAFT')}
              >
                Belum Diserahkan ({rows.filter(r => r.status !== 'CONFIRMED' && r.status !== 'SELESAI').length})
              </button>
            </div>
          )}
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
        <table className={page === 'materials' ? 'materials-table' : (page === 'requests' ? 'requests-table' : (page === 'approvals' ? 'approvals-table' : undefined))}>
          <thead>
            <tr>
              {columns.map(h => (
                <th
                  key={h}
                  onClick={() => h !== 'items' && toggleSort(h)}
                  style={{ cursor: h === 'items' ? 'default' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  title={h === 'items' ? undefined : 'Klik untuk urutkan'}
                >
                  {page === 'requests' && h === 'priority' ? (
                    <span className="prio-dot prio-header" title="Prioritas — klik untuk urutkan" />
                  ) : pretty(h)}
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
              displayRows.map((r, i) => (
                <React.Fragment key={r.id || i}>
                <tr>
                  {columns.map(h => {
                    const rawVal = h === 'kode' ? (r.kode || r.code) : (h === 'qty' ? (r.qty ?? 0) : r[h])
                    return (
                      <td key={h}>
                        {['projects', 'past_projects'].includes(page) && h === 'status' ? (
                          <select
                            className={`status-select status-${normalizeStatus(r.status)}`}
                            value={normalizeStatus(r.status)}
                            onChange={e => onStatusChange(r, e.target.value)}
                          >
                            <option value="NOT_START">Not Start</option>
                            <option value="ON_GOING">On Going</option>
                            <option value="DONE">Done</option>
                          </select>
                        ) : page === 'receivings' && h === 'status' ? (() => {
                          const prog = receivingProgress(r.id)
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                              <select
                                className={`status-select ${isReceivingKendala(r.status) ? 'status-kendala' : 'status-normal'}`}
                                value={['NORMAL', 'RETUR', 'REFUND'].includes(String(r.status || '').toUpperCase()) ? String(r.status).toUpperCase() : (r.status || 'NORMAL')}
                                onChange={e => onReceivingStatusChange(r, e.target.value)}
                              >
                                {r.status && !['NORMAL', 'RETUR', 'REFUND'].includes(String(r.status).toUpperCase()) && (
                                  <option value={r.status} disabled>{prettyReceivingStatus(r.status)} (status lama)</option>
                                )}
                                <option value="NORMAL">✓ Normal</option>
                                <option value="RETUR">⚠️ Retur</option>
                                <option value="REFUND">⚠️ Refund</option>
                              </select>
                              {prog && (
                                <span style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '2px 7px',
                                  borderRadius: '10px',
                                  width: 'fit-content',
                                  whiteSpace: 'nowrap',
                                  ...(prog.allDone
                                    ? { background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }
                                    : { background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6' })
                                }}>
                                  {prog.allDone ? `✓ LENGKAP (${prog.doneCount}/${prog.total})` : `⏳ PARSIAL (${prog.doneCount}/${prog.total})`}
                                </span>
                              )}
                              {r.masuk_gudang ? (
                                <span style={{ fontSize: '11px', color: '#137333', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                  ✓ Di Stok Gudang
                                </span>
                              ) : r.tukang_at || r.alokasi === 'KE_TUKANG' ? (
                                <span style={{ fontSize: '11px', color: '#1a73e8', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                  👷 Ke Tukang (Handover)
                                </span>
                              ) : ['RETUR', 'REFUND'].includes(String(r.status || '').toUpperCase()) ? (
                                <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                  ⚠️ {prettyReceivingStatus(r.status)} — stok tidak ditambah
                                </span>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <span style={{ fontSize: '9px', color: '#71817d', fontWeight: 700, letterSpacing: '0.04em' }}>LANGKAH 2 — ALOKASI</span>
                                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      onClick={() => onMoveToWarehouse(r)}
                                      style={{
                                        background: '#e6f4ea',
                                        color: '#137333',
                                        border: '1px solid #ceead6',
                                        borderRadius: '4px',
                                        padding: '4px 7px',
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        width: 'fit-content'
                                      }}
                                      title="Tambah stok barang ke modul Materials"
                                    >
                                      📦 Masuk Stok Gudang
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => onSendToTukang(r)}
                                      style={{
                                        background: '#e8f0fe',
                                        color: '#1a73e8',
                                        border: '1px solid #d2e3fc',
                                        borderRadius: '4px',
                                        padding: '4px 7px',
                                        fontSize: '10px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        width: 'fit-content'
                                      }}
                                      title="Serah terima langsung ke tukang — masuk modul Handover"
                                    >
                                      👷 Serah Terima ke Tukang
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })() : page === 'vendors' && h === 'phone' ? (
                          <WaContact value={rawVal} />
                        ) : page === 'vendors' && h === 'store_link' ? (
                          <StoreLink value={rawVal} />
                        ) : page === 'approvals' && h === 'items' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {approvalItemLines(r).length ? approvalItemLines(r).map((line, idx) => (
                              <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, paddingLeft: '12px', textIndent: '-12px' }}>
                                • {line}
                              </span>
                            )) : <span className="muted" style={{ fontSize: '12px' }}>—</span>}
                          </div>
                        ) : page === 'requests' && h === 'pr_number' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <b>{format(rawVal)}</b>
                              <button
                                type="button"
                                className={`note-dot ${String(r.notes || '').trim() ? 'note-dot-on' : ''}`}
                                title={String(r.notes || '').trim() || 'Tidak ada catatan'}
                                aria-label="Catatan PR"
                                onClick={() => setOpenNoteId(openNoteId === r.id ? null : r.id)}
                              />
                            </div>
                            <small style={{ color: '#9aa8a4', fontSize: '10px', fontWeight: 500 }}>{format(r.created_at)}</small>
                            {openNoteId === r.id && (
                              <div className="note-pop">{String(r.notes || '').trim() || 'Tidak ada catatan.'}</div>
                            )}
                          </div>
                        ) : page === 'requests' && h === 'priority' ? (
                          <span
                            className={`prio-dot ${String(r.priority || '').toUpperCase() === 'URGENT' ? 'prio-urgent' : 'prio-normal'}`}
                            title={String(r.priority || '').toUpperCase() === 'URGENT' ? 'Prioritas' : 'Standard'}
                          />
                        ) : ['requests', 'approvals'].includes(page) && h === 'project_name' ? (
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(rawVal || '')}>
                            {format(rawVal)}
                          </div>
                        ) : page === 'receivings' && h === 'note' ? (() => {
                          const pn = parseReceivingNote(rawVal)
                          const href = notaHref(pn.notaUrl)
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '240px', whiteSpace: 'normal', lineHeight: 1.4, fontSize: '12px' }}>
                              {pn.nominal !== null && (
                                <b style={{ color: '#137333' }}>💰 {rupiah(pn.nominal)}</b>
                              )}
                              {pn.notaUrl && (
                                href ? (
                                  <a href={href} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', width: 'fit-content', background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', borderRadius: '4px', padding: '2px 7px', fontSize: '10px', fontWeight: 700, textDecoration: 'none' }}>
                                    📄 Nota / Resi
                                  </a>
                                ) : (
                                  <span style={{ width: 'fit-content', background: '#eef3f1', color: '#1f3a34', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '2px 7px', fontSize: '10px', fontWeight: 600 }}>
                                    📄 {pn.notaUrl}
                                  </span>
                                )
                              )}
                              {pn.extra ? <span>{pn.extra}</span> : (pn.nominal === null && !pn.notaUrl ? format(rawVal) : null)}
                            </div>
                          )
                        })() : ['requests', 'approvals'].includes(page) && (h === 'notes' || h === 'note') ? (
                          <div style={{ whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.4, fontSize: '12px' }}>
                            {format(rawVal)}
                          </div>
                        ) : h === 'title' ? (
                          <div
                            style={{ maxWidth: ['requests', 'approvals'].includes(page) ? '100%' : '170px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            title={String(rawVal || '')}
                          >
                            {format(rawVal)}
                          </div>
                        ) : page === 'materials' && h === 'name' ? (
                          <div className="cell-name" title={String(rawVal || '')}>{format(rawVal)}</div>
                        ) : h === 'materials_summary' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {requestItemLines(r).map((line, idx) => (
                              <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, whiteSpace: 'normal', paddingLeft: '12px', textIndent: '-12px' }}>
                                • {line}
                              </span>
                            ))}
                          </div>
                        ) : (
                          format(rawVal)
                        )}
                      </td>
                    )
                  })}
                  {page === 'approvals' && (
                    <td style={{ textAlign: 'center' }}>
                      {r.status === 'PENDING' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => onDecideApproval(r, 'APPROVED')}
                            style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                          >
                            ✓ Setujui
                          </button>
                          <button
                            type="button"
                            onClick={() => onDecideApproval(r, 'REJECTED')}
                            style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                          >
                            ✕ Tolak
                          </button>
                          <button
                            type="button"
                            onClick={() => onReviseApproval(r)}
                            style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                          >
                            ✎ Revisi
                          </button>
                        </div>
                        {approvalItemLines(r).length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedApproval(expandedApproval === r.id ? null : r.id)}
                            style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34' }}
                          >
                            {expandedApproval === r.id ? '▲ Tutup material' : `▼ Material (${approvalItemLines(r).length})`}
                          </button>
                        )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                          <span className={`badge status-${r.status}`}>{r.status}</span>
                          {approvalItemLines(r).length > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedApproval(expandedApproval === r.id ? null : r.id)}
                              style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34' }}
                            >
                              {expandedApproval === r.id ? '▲ Tutup material' : `▼ Material (${approvalItemLines(r).length})`}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                  {hasDeleteAction && (
                    <td style={{ textAlign: 'center' }}>
                      {page === 'requests' ? (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                          {['DRAFT', 'REVISI'].includes(String(r.status || '').toUpperCase()) && (
                            <button
                              type="button"
                              className="btn-finish"
                              onClick={() => onFinishPr(r)}
                              title={`Selesai — kirim ${r.pr_number || title} ke modul Approval`}
                              style={{ fontSize: '9px', padding: '3px 6px', whiteSpace: 'nowrap' }}
                            >
                              ✓ Selesai
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-edit icon-btn"
                            onClick={() => setEditRow(r)}
                            title={`Edit ${r.pr_number || title}`}
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            className="btn-delete icon-btn"
                            onClick={() => onDelete(page, r)}
                            title={`Hapus ${r.pr_number || title}`}
                          >
                            🗑️
                          </button>
                        </div>
                      ) : page === 'handovers' ? (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                          {['CONFIRMED', 'SELESAI'].includes(String(r.status || '').toUpperCase()) ? (
                            <span style={{ fontSize: '10px', color: '#137333', fontWeight: 600, whiteSpace: 'nowrap' }}>✓ Sudah diserahkan</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onMarkHandoverDelivered(r)}
                              style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                              title="Tandai serah terima sudah diserahkan"
                            >
                              ✓ Sudah Diserahkan
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-delete icon-btn"
                            onClick={() => onDelete(page, r)}
                            title={`Hapus ${title}`}
                          >
                            🗑️
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-delete"
                          onClick={() => onDelete(page, r)}
                          title={`Hapus ${title}`}
                        >
                          Hapus
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {page === 'receivings' && receivingItemsForReceiving(r.id).length > 0 && (
                  <tr>
                    <td colSpan={columns.length + 2} style={{ background: '#fbfdfc', padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#1f3a34' }}>
                          📦 Langkah 1 — Cek Fisik Item (isi qty diterima, status Parsial/Lengkap dihitung otomatis)
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedReceiving(expandedReceiving === r.id ? null : r.id)}
                          style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34' }}
                        >
                          {expandedReceiving === r.id ? '▲ Tutup item' : `▼ Lihat ${receivingItemsForReceiving(r.id).length} item`}
                        </button>
                      </div>
                      {expandedReceiving === r.id && (
                        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                              <th style={{ padding: '6px 8px', width: '40px' }}>No</th>
                              <th style={{ padding: '6px 8px' }}>Nama Item</th>
                              <th style={{ padding: '6px 8px', width: '110px' }}>Qty Dipesan (PR)</th>
                              <th style={{ padding: '6px 8px', width: '110px' }}>Qty Diterima</th>
                              <th style={{ padding: '6px 8px', width: '70px' }}>Satuan</th>
                              <th style={{ padding: '6px 8px', width: '170px' }}>Status Fisik</th>
                              <th style={{ padding: '6px 8px', width: '110px', textAlign: 'center' }}>Aksi</th>
                            </tr>
                          </thead>
                          <tbody>
                            {receivingItemsForReceiving(r.id).map((it, i) => {
                              const st = itemReceiveStatus(it)
                              return (
                                <tr key={it.id} style={{ borderBottom: '1px solid #e1e7e4' }}>
                                  <td style={{ padding: '6px 8px' }}>{i + 1}</td>
                                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{it.item_name}</td>
                                  <td style={{ padding: '6px 8px' }}>{st.ordered !== null ? `${st.ordered} ${it.unit || ''}` : '—'}</td>
                                  <td style={{ padding: '6px 8px' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      value={it.quantity_received ?? ''}
                                      placeholder="0"
                                      onChange={e => onUpdateReceivingQty(it, e.target.value)}
                                      style={{ width: '70px', padding: '3px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd8d4' }}
                                    />
                                  </td>
                                  <td style={{ padding: '6px 8px' }}>{it.unit || '—'}</td>
                                  <td style={{ padding: '6px 8px' }}>
                                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', whiteSpace: 'nowrap', ...itemBadgeStyle(st.key) }}>
                                      {st.text}
                                    </span>
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                    <button
                                      type="button"
                                      onClick={() => onMarkReceivingItemReceived(it)}
                                      style={{ background: st.key === 'PARSIAL' ? '#b45309' : '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                      title="Simpan qty & konfirmasi penerimaan fisik"
                                    >
                                      {st.key === 'PARSIAL' ? '✓ Update Terima' : '✓ Cek Fisik'}
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
                {page === 'approvals' && expandedApproval === r.id && (
                  <tr>
                    <td colSpan={columns.length + 2} style={{ background: '#fbfdfc', padding: '10px 12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: '#1f3a34' }}>
                        📋 Material — setujui per barang{r.status === 'APPROVED' ? ', lalu tandai yang sudah dipesan ke supplier' : ''}
                      </div>
                      {approvalItems(r).length === 0 ? (
                        <div>
                          {approvalItemLines(r).length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '6px' }}>
                              {approvalItemLines(r).map((line, i) => (
                                <span key={i} style={{ fontSize: '11px', lineHeight: 1.45, paddingLeft: '12px', textIndent: '-12px' }}>• {line}</span>
                              ))}
                            </div>
                          )}
                          <p className="muted" style={{ fontSize: '11px', margin: 0 }}>
                            Rincian per barang belum tersimpan untuk PR lama ini — gunakan tombol ✓ Setujui untuk menyetujui seluruh PR.
                          </p>
                        </div>
                      ) : (
                        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                              <th style={{ padding: '4px 6px', width: '90px' }}>Kode</th>
                              <th style={{ padding: '4px 6px' }}>Nama Item</th>
                              <th style={{ padding: '4px 6px', width: '70px' }}>Qty</th>
                              <th style={{ padding: '4px 6px', width: '70px' }}>Satuan</th>
                              <th style={{ padding: '4px 6px', width: '110px' }}>Status</th>
                              <th style={{ padding: '4px 6px', width: '150px', textAlign: 'center' }}>Aksi</th>
                            </tr>
                          </thead>
                          <tbody>
                            {approvalItems(r).map(it => {
                              const st = itemState(it)
                              const canApprove = st === 'PENDING' && (r.status === 'PENDING' || r.status === 'APPROVED')
                              const canOrder = st === 'APPROVED' && r.status === 'APPROVED'
                              return (
                                <tr key={it.id} style={{ borderBottom: '1px solid #e1e7e4' }}>
                                  <td style={{ padding: '4px 6px' }}><b>{it.kode || '—'}</b></td>
                                  <td style={{ padding: '4px 6px' }}>{it.item_name}</td>
                                  <td style={{ padding: '4px 6px' }}>{it.quantity}</td>
                                  <td style={{ padding: '4px 6px' }}>{it.unit || '—'}</td>
                                  <td style={{ padding: '4px 6px' }}>
                                    <span className={`badge ${st === 'ORDERED' ? 'status-APPROVED' : (st === 'APPROVED' ? 'badge-item-approved' : 'status-PENDING')}`} style={{ fontSize: '10px' }}>
                                      {st === 'ORDERED' ? '✓ Sudah Order' : (st === 'APPROVED' ? '✓ Disetujui' : '⏳ Menunggu')}
                                    </span>
                                  </td>
                                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                    {st === 'ORDERED' ? (
                                      <span style={{ fontSize: '10px', color: '#137333' }}>→ ke Receiving</span>
                                    ) : canOrder ? (
                                      <button
                                        type="button"
                                        onClick={() => onMarkPrItemOrdered(it)}
                                        style={{ background: '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                      >
                                        🛒 Sudah Order
                                      </button>
                                    ) : canApprove ? (
                                      <button
                                        type="button"
                                        onClick={() => onApproveItem(it)}
                                        style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                      >
                                        ✓ Setujui
                                      </button>
                                    ) : st === 'APPROVED' ? (
                                      <span style={{ fontSize: '10px', color: '#b45309', whiteSpace: 'nowrap' }}>⏳ Menunggu PR disetujui</span>
                                    ) : (
                                      <span style={{ fontSize: '10px', color: '#71817d' }}>—</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))
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
          displayRows.map((r, i) => (
            <div className="mobile-card" key={r.id || i}>
              {page === 'approvals' ? (
                <>
                  <div className="mobile-card-header">
                    <div>
                      <b className="mobile-card-title">{r.pr_number || 'PR'}</b>
                      <div className="mobile-card-sub">{r.project_name || 'Tanpa Project'}</div>
                    </div>
                    <span className={`badge status-${r.status}`}>{r.status}</span>
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-card-row">
                      <span className="mobile-label">Judul:</span>
                      <span className="mobile-val">{r.title || '—'}</span>
                    </div>
                    <div className="mobile-card-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                      <span className="mobile-label">Item Material ({approvalItemLines(r).length}):</span>
                      <div className="mobile-items-box">
                        {approvalItemLines(r).length ? approvalItemLines(r).map((line, idx) => (
                          <div key={idx} className="mobile-item-line">• {line}</div>
                        )) : <span className="muted">—</span>}
                      </div>
                    </div>
                    {r.note && (
                      <div className="mobile-card-note">
                        <b>Catatan:</b> {r.note}
                      </div>
                    )}
                    {r.decided_at && (
                      <div className="mobile-card-row">
                        <span className="mobile-label">Diputuskan:</span>
                        <span className="mobile-val">{format(r.decided_at)}</span>
                      </div>
                    )}
                  </div>
                  <div className="mobile-card-actions">
                    {r.status === 'PENDING' ? (
                      <div className="mobile-action-grid-3">
                        <button
                          type="button"
                          className="btn-mobile-approve"
                          onClick={() => onDecideApproval(r, 'APPROVED')}
                        >
                          ✓ Setujui
                        </button>
                        <button
                          type="button"
                          className="btn-mobile-reject"
                          onClick={() => onDecideApproval(r, 'REJECTED')}
                        >
                          ✕ Tolak
                        </button>
                        <button
                          type="button"
                          className="btn-mobile-revise"
                          onClick={() => onReviseApproval(r)}
                        >
                          ✎ Revisi
                        </button>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', fontSize: '12px', color: '#556b65', padding: '6px' }}>
                        Sudah diproses ({r.status})
                      </div>
                    )}
                  </div>
                </>
              ) : page === 'requests' ? (
                <>
                  <div className="mobile-card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        className={`prio-dot ${String(r.priority || '').toUpperCase() === 'URGENT' ? 'prio-urgent' : 'prio-normal'}`}
                        title={String(r.priority || '').toUpperCase() === 'URGENT' ? 'Prioritas' : 'Standard'}
                      />
                      <div>
                        <b className="mobile-card-title">{r.pr_number || 'PR'}</b>
                        <div className="mobile-card-sub">{format(r.created_at)}</div>
                      </div>
                    </div>
                    <span className={`badge status-${r.status}`}>{r.status}</span>
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-card-row">
                      <span className="mobile-label">Project:</span>
                      <span className="mobile-val">{r.project_name || '—'}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-label">Judul:</span>
                      <span className="mobile-val">{r.title || '—'}</span>
                    </div>
                    <div className="mobile-card-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                      <span className="mobile-label">Item Material:</span>
                      <div className="mobile-items-box">
                        {requestItemLines(r).map((line, idx) => (
                          <div key={idx} className="mobile-item-line">• {line}</div>
                        ))}
                      </div>
                    </div>
                    {String(r.notes || '').trim() && (
                      <div className="mobile-card-note">
                        <b>Catatan PR:</b> {r.notes}
                      </div>
                    )}
                  </div>
                  <div className="mobile-card-actions">
                    <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                      {['DRAFT', 'REVISI'].includes(String(r.status || '').toUpperCase()) && (
                        <button
                          type="button"
                          className="btn-finish"
                          onClick={() => onFinishPr(r)}
                          style={{ flex: 1, padding: '8px', fontSize: '12px' }}
                        >
                          ✓ Selesai
                        </button>
                      )}
                      <button
                        type="button"
                        className="outline"
                        onClick={() => setEditRow(r)}
                        style={{ padding: '8px 14px', fontSize: '12px' }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        type="button"
                        className="btn-delete"
                        onClick={() => onDelete(page, r)}
                        style={{ padding: '8px 14px', fontSize: '12px' }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </>
              ) : ['projects', 'past_projects'].includes(page) ? (
                <>
                  <div className="mobile-card-header">
                    <div>
                      <b className="mobile-card-title">{r.kode || r.code || '—'}</b>
                      <div className="mobile-card-sub">{r.name}</div>
                    </div>
                    <select
                      className={`status-select status-${normalizeStatus(r.status)}`}
                      value={normalizeStatus(r.status)}
                      onChange={e => onStatusChange(r, e.target.value)}
                    >
                      <option value="NOT_START">Not Start</option>
                      <option value="ON_GOING">On Going</option>
                      <option value="DONE">Done</option>
                    </select>
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-card-row">
                      <span className="mobile-label">Tanggal:</span>
                      <span className="mobile-val">{format(r.created_at)}</span>
                    </div>
                  </div>
                </>
              ) : page === 'vendors' ? (
                <>
                  <div className="mobile-card-header">
                    <div>
                      <b className="mobile-card-title">{r.name}</b>
                      <div className="mobile-card-sub">{r.supplier_category || 'Vendor'}</div>
                    </div>
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-card-row">
                      <span className="mobile-label">Kontak WA:</span>
                      <span className="mobile-val"><WaContact value={r.phone} /></span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-label">Link Toko:</span>
                      <span className="mobile-val"><StoreLink value={r.store_link} /></span>
                    </div>
                  </div>
                  <div className="mobile-card-actions">
                    <button
                      type="button"
                      className="btn-delete"
                      onClick={() => onDelete(page, r)}
                      style={{ width: '100%' }}
                    >
                      Hapus Vendor
                    </button>
                  </div>
                </>
              ) : page === 'materials' ? (
                <>
                  <div className="mobile-card-header">
                    <div>
                      <b className="mobile-card-title">{r.kode || '—'}</b>
                      <div className="mobile-card-sub">{r.name}</div>
                    </div>
                    <span className="badge status-APPROVED" style={{ fontSize: '11px' }}>
                      {r.qty ?? 0} {r.satuan || ''}
                    </span>
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-card-row">
                      <span className="mobile-label">Kategori:</span>
                      <span className="mobile-val">{r.category || '—'}</span>
                    </div>
                  </div>
                  <div className="mobile-card-actions">
                    <button
                      type="button"
                      className="btn-delete"
                      onClick={() => onDelete(page, r)}
                      style={{ width: '100%' }}
                    >
                      Hapus Material
                    </button>
                  </div>
                </>
              ) : page === 'receivings' ? (() => {
                const prog = receivingProgress(r.id)
                const pn = parseReceivingNote(r.note)
                const href = notaHref(pn.notaUrl)
                return (
                  <>
                    <div className="mobile-card-header">
                      <div>
                        <b className="mobile-card-title">{r.invoice_no || r.delivery_note || 'Penerimaan'}</b>
                        <div className="mobile-card-sub">{r.project_name || 'Tanpa Project'}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
                        <span className={`badge ${isReceivingKendala(r.status) ? 'status-REJECTED' : 'status-APPROVED'}`} style={{ fontSize: '10px' }}>
                          {prettyReceivingStatus(r.status)}
                        </span>
                        {prog && (
                          <span style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '8px',
                            whiteSpace: 'nowrap',
                            ...(prog.allDone
                              ? { background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }
                              : { background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6' })
                          }}>
                            {prog.allDone ? `✓ LENGKAP (${prog.doneCount}/${prog.total})` : `⏳ PARSIAL (${prog.doneCount}/${prog.total})`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mobile-card-body">
                      {r.delivery_note && (
                        <div className="mobile-card-row">
                          <span className="mobile-label">Surat Jalan:</span>
                          <span className="mobile-val">{r.delivery_note}</span>
                        </div>
                      )}
                      <div className="mobile-card-row">
                        <span className="mobile-label">Tgl Terima:</span>
                        <span className="mobile-val">{format(r.received_date)}</span>
                      </div>
                      {pn.nominal !== null && (
                        <div className="mobile-card-row">
                          <span className="mobile-label">Nominal Riil:</span>
                          <span className="mobile-val" style={{ color: '#137333', fontWeight: 700 }}>{rupiah(pn.nominal)}</span>
                        </div>
                      )}
                      {pn.notaUrl && (
                        <div className="mobile-card-row">
                          <span className="mobile-label">Nota / Resi:</span>
                          <span className="mobile-val">
                            {href ? (
                              <a href={href} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', borderRadius: '4px', padding: '2px 7px', fontSize: '10px', fontWeight: 700, textDecoration: 'none' }}>
                                📄 Buka Nota
                              </a>
                            ) : (
                              `📄 ${pn.notaUrl}`
                            )}
                          </span>
                        </div>
                      )}
                      {pn.extra && (
                        <div className="mobile-card-note">
                          <b>Catatan:</b> {pn.extra}
                        </div>
                      )}
                      {receivingItemsForReceiving(r.id).length > 0 && (
                        <div className="mobile-card-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
                          <span className="mobile-label">Item (Langkah 1 — Cek Fisik):</span>
                          <div className="mobile-items-box" style={{ width: '100%' }}>
                            {receivingItemsForReceiving(r.id).map(it => {
                              const st = itemReceiveStatus(it)
                              return (
                                <div key={it.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingBottom: '8px', marginBottom: '8px', borderBottom: '1px dashed #d5e0dc' }}>
                                  <span style={{ fontWeight: 600 }}>• {it.item_name}</span>
                                  <span style={{ fontSize: '11px', color: '#556b65' }}>Dipesan: {st.ordered ?? '—'} {it.unit || ''} · Diterima: {st.rec} {it.unit || ''}</span>
                                  <span style={{ width: 'fit-content', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', ...itemBadgeStyle(st.key) }}>
                                    {st.text}
                                  </span>
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '3px' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      value={it.quantity_received ?? ''}
                                      placeholder="0"
                                      onChange={e => onUpdateReceivingQty(it, e.target.value)}
                                      style={{ width: '65px', padding: '3px 6px', fontSize: '11px', borderRadius: '4px', border: '1px solid #cbd8d4' }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => onMarkReceivingItemReceived(it)}
                                      style={{ background: st.key === 'PARSIAL' ? '#b45309' : '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', fontWeight: 600 }}
                                    >
                                      {st.key === 'PARSIAL' ? '✓ Update' : '✓ Cek Fisik'}
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="mobile-card-actions" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {r.masuk_gudang ? (
                        <span style={{ fontSize: '12px', color: '#137333', fontWeight: 700 }}>✓ Di Stok Gudang</span>
                      ) : r.tukang_at || r.alokasi === 'KE_TUKANG' ? (
                        <span style={{ fontSize: '12px', color: '#1a73e8', fontWeight: 700 }}>👷 Ke Tukang (Handover)</span>
                      ) : ['RETUR', 'REFUND'].includes(String(r.status || '').toUpperCase()) ? (
                        <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>⚠️ {prettyReceivingStatus(r.status)} — stok tidak ditambah</span>
                      ) : (
                        <>
                          <span style={{ fontSize: '10px', color: '#71817d', fontWeight: 700, letterSpacing: '0.04em' }}>LANGKAH 2 — ALOKASI AKHIR</span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              onClick={() => onMoveToWarehouse(r)}
                              style={{ flex: 1, background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6', borderRadius: '6px', padding: '8px', fontSize: '11px', fontWeight: 700 }}
                            >
                              📦 Masuk Stok Gudang
                            </button>
                            <button
                              type="button"
                              onClick={() => onSendToTukang(r)}
                              style={{ flex: 1, background: '#e8f0fe', color: '#1a73e8', border: '1px solid #d2e3fc', borderRadius: '6px', padding: '8px', fontSize: '11px', fontWeight: 700 }}
                            >
                              👷 Serah ke Tukang
                            </button>
                          </div>
                        </>
                      )}
                      <button type="button" className="btn-delete" onClick={() => onDelete(page, r)} style={{ width: '100%' }}>
                        Hapus Penerimaan
                      </button>
                    </div>
                  </>
                )
              })() : (
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
          ))
        ) : (
          <div className="panel empty">Belum ada data.</div>
        )}
      </div>

    </>
  )
}
