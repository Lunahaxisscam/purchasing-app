// ============================================================
// modules/sales-invoice/view.jsx — MODUL INVOICE PENJUALAN (Sales Invoice)
// ============================================================
// Modul Invoice Penjualan Admin Suite (Noir Living).
// Alur Bisnis:
//   CRM (Identitas Customer) -> RAB Final Disetujui -> Sales Invoice ->
//   Penerbitan Nomor Proyek Baru di Master Project (Mandat DAT).
// ============================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import CreateInvoiceModal from './CreateInvoiceModal'
import { buildSalesInvoicePdf, downloadPdf } from './pdf'

export const INVOICE_COLUMNS = [
  { key: 'invoice_no', label: 'No. Invoice' },
  { key: 'customer_name', label: 'Customer (CRM)' },
  { key: 'rab_reff', label: 'RAB Final / Disetujui' },
  { key: 'nominal', label: 'Nominal' },
  { key: 'status', label: 'Status Dokumen' }
]

export function invoiceStatusBadge(status) {
  const s = String(status || '').trim()
  if (!s) return { label: '—', tone: 'muted' }
  const known = {
    DRAFT: 'draft',
    TERKIRIM: 'sent',
    DISETUJUI: 'approved',
    DITOLAK: 'rejected',
    LUNAS: 'paid',
    BATAL: 'void'
  }
  const tone = known[String(s).toUpperCase()]
  return { label: s.toUpperCase(), tone: tone || 'muted' }
}

export function formatNominal(v) {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !isFinite(n)) return '—'
  return `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
}

export default function SalesInvoiceModule({ invoices = null, allProjects = [], projects = [], say }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)

  const effectiveProjects = useMemo(() => {
    return (allProjects && allProjects.length > 0) ? allProjects : (projects || [])
  }, [allProjects, projects])

  // Load invoices from API or props
  const fetchInvoices = useCallback(async () => {
    // If explicit props provided and non-null, use them
    if (Array.isArray(invoices)) {
      setItems(invoices)
      setLoading(false)
      return
    }

    try {
      if (typeof window !== 'undefined') {
        const res = await fetch('/api/sales-invoices')
        if (res.ok) {
          const json = await res.json()
          if (json.ok && Array.isArray(json.invoices)) {
            setItems(json.invoices)
            setLoading(false)
            return
          }
        }
      }
    } catch (err) {
      console.warn('Fallback to props invoices:', err)
    }

    setItems([])
    setLoading(false)
  }, [invoices])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  const handleInvoiceCreated = (newInv) => {
    setItems(prev => [newInv, ...prev])
  }

  const handleStatusChange = async (id, newStatus) => {
    setUpdatingId(id)
    try {
      const res = await fetch('/api/sales-invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus })
      })
      const json = await res.json()
      if (res.ok && json.ok) {
        setItems(prev => prev.map(inv => inv.id === id ? { ...inv, status: newStatus } : inv))
        if (say) say(`✓ Status invoice ${json.invoice.invoice_no} diubah ke ${newStatus}`)
      }
    } catch (err) {
      console.error('Failed to update status:', err)
    } finally {
      setUpdatingId(null)
    }
  }

  const handleExportPdf = (invoice) => {
    try {
      const bytes = buildSalesInvoicePdf(invoice)
      const filename = `Invoice_${(invoice.invoice_no || 'NL').replace(/\//g, '-')}_${invoice.customer_name || 'Client'}.pdf`
      downloadPdf(bytes, filename)
      if (say) say(`✓ PDF invoice ${invoice.invoice_no} berhasil diunduh.`)
    } catch (err) {
      console.error('PDF generation error:', err)
      alert('Gagal membuat dokumen PDF invoice: ' + err.message)
    }
  }

  // Filter & Search
  const filtered = useMemo(() => {
    return items.filter(inv => {
      if (filterStatus !== 'ALL') {
        if (String(inv.status || '').toUpperCase() !== filterStatus) return false
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const hay = `${inv.invoice_no} ${inv.customer_name} ${inv.project_name} ${inv.project_code} ${inv.rab_reff}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, filterStatus, search])

  // KPI Calculations
  const kpi = useMemo(() => {
    let totalNominal = 0
    let pendingCount = 0
    let paidCount = 0
    for (const inv of items) {
      totalNominal += Number(inv.grand_total || inv.nominal || 0)
      const st = String(inv.status || '').toUpperCase()
      if (st === 'TERKIRIM' || st === 'DISETUJUI') pendingCount++
      if (st === 'LUNAS') paidCount++
    }
    return {
      totalCount: items.length,
      totalNominal,
      pendingCount,
      paidCount
    }
  }, [items])

  return (
    <div className="si-root" data-testid="sales-invoice-root">
      {/* HEADER SECTION */}
      <div className="si-intro">
        <div className="si-intro-copy">
          <strong>Invoice Penjualan</strong>
          <span>
            Alur bisnis: CRM (identitas customer) &rarr; RAB final yang disetujui
            customer &rarr; Invoice &rarr; penerbitan nomor Master Project.
          </span>
        </div>
        <div className="si-header-actions">
          <span className="si-badge-fase">Tahap pembukaan modul</span>
          <button
            type="button"
            className="si-btn-create"
            onClick={() => setIsModalOpen(true)}
          >
            + Buat Invoice Penjualan
          </button>
        </div>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="si-kpi-grid">
        <div className="si-kpi-card">
          <span className="si-kpi-lbl">Total Invoice</span>
          <b className="si-kpi-val">{kpi.totalCount}</b>
          <small className="si-kpi-sub">seluruh dokumen</small>
        </div>
        <div className="si-kpi-card">
          <span className="si-kpi-lbl">Total Nilai Tagihan</span>
          <b className="si-kpi-val">{formatNominal(kpi.totalNominal)}</b>
          <small className="si-kpi-sub">termasuk PPN jika ada</small>
        </div>
        <div className="si-kpi-card">
          <span className="si-kpi-lbl">Menunggu Pembayaran</span>
          <b className="si-kpi-val si-c-warn">{kpi.pendingCount}</b>
          <small className="si-kpi-sub">status terkirim / disetujui</small>
        </div>
        <div className="si-kpi-card">
          <span className="si-kpi-lbl">Lunas / Selesai</span>
          <b className="si-kpi-val si-c-ok">{kpi.paidCount}</b>
          <small className="si-kpi-sub">pembayaran terverifikasi</small>
        </div>
      </div>

      {/* TOOLBAR & SEARCH */}
      <div className="si-toolbar">
        <div className="si-filter-tabs">
          {[
            { id: 'ALL', label: 'Semua' },
            { id: 'DRAFT', label: 'Draft' },
            { id: 'TERKIRIM', label: 'Terkirim' },
            { id: 'DISETUJUI', label: 'Disetujui' },
            { id: 'LUNAS', label: 'Lunas' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`si-tab-btn ${filterStatus === tab.id ? 'active' : ''}`}
              onClick={() => setFilterStatus(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="si-search-wrap">
          <input
            type="text"
            placeholder="🔍 Cari invoice, customer, proyek..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* TABLE PANEL */}
      <div className="si-panel">
        <div className="si-panel-head">
          <strong>Daftar Invoice Penjualan</strong>
          <span>{filtered.length} invoice ditampilkan</span>
        </div>

        {loading ? (
          <div className="si-empty">
            <p>Memuat data invoice penjualan…</p>
          </div>
        ) : filtered.length > 0 ? (
          <div className="si-table-wrap">
            <table className="si-table">
              <thead>
                <tr>
                  <th>No. Invoice</th>
                  <th>Tanggal</th>
                  <th>Customer (CRM)</th>
                  <th>Proyek &amp; No. Proyek</th>
                  <th>RAB Reff</th>
                  <th className="si-num">Nominal Tagihan</th>
                  <th>Status Dokumen</th>
                  <th style={{ textAlign: 'center' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const badge = invoiceStatusBadge(inv.status)
                  const pCode = inv.project_code ? `[${inv.project_code}] ` : ''
                  return (
                    <tr key={inv.id || inv.invoice_no}>
                      <td>
                        <strong className="si-inv-num">{inv.invoice_no}</strong>
                      </td>
                      <td>
                        <div>{inv.issue_date || '—'}</div>
                        {inv.due_date && <small className="si-due-txt">JT: {inv.due_date}</small>}
                      </td>
                      <td>
                        <strong>{inv.customer_name}</strong>
                        {inv.customer_phone && <div className="si-subtxt">{inv.customer_phone}</div>}
                      </td>
                      <td>
                        <div>
                          {pCode ? <span className="si-proj-code">{pCode}</span> : null}
                          <span>{inv.project_name || '—'}</span>
                        </div>
                        {inv.project_address && <div className="si-subtxt">{inv.project_address}</div>}
                      </td>
                      <td>
                        <span className="si-rab-pill">{inv.rab_reff || 'BOQ-001'}</span>
                      </td>
                      <td className="si-num">
                        <strong>{formatNominal(inv.grand_total || inv.nominal)}</strong>
                        {inv.tax_amount > 0 && (
                          <div className="si-subtxt">Termasuk PPN ({formatNominal(inv.tax_amount)})</div>
                        )}
                      </td>
                      <td>
                        <span className={`si-badge si-badge-${badge.tone}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td>
                        <div className="si-row-actions">
                          <button
                            type="button"
                            className="si-act-btn si-act-pdf"
                            title="Unduh PDF Resmi Invoice"
                            onClick={() => handleExportPdf(inv)}
                          >
                            📄 PDF
                          </button>

                          {inv.status !== 'LUNAS' && (
                            <button
                              type="button"
                              className="si-act-btn si-act-pay"
                              title="Tandai Pembayaran Lunas"
                              disabled={updatingId === inv.id}
                              onClick={() => handleStatusChange(inv.id, 'LUNAS')}
                            >
                              ✓ Lunas
                            </button>
                          )}

                          {inv.status === 'DRAFT' && (
                            <button
                              type="button"
                              className="si-act-btn si-act-send"
                              title="Tandai Invoice Terkirim ke Klien"
                              disabled={updatingId === inv.id}
                              onClick={() => handleStatusChange(inv.id, 'TERKIRIM')}
                            >
                              ✉ Terkirim
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="si-empty" data-testid="si-empty">
            <div className="si-empty-icon" aria-hidden="true">🧾</div>
            <strong>Belum ada invoice penjualan</strong>
            <p>
              Pengaturan penagihan/termin akan ditambahkan berikutnya.
              Invoice penjualan diterbitkan ketika penawaran RAB / BOQ telah disetujui oleh klien.
              Saat invoice pertama dibuat, sistem akan otomatis menerbitkan nomor proyek resmi di Master Project.
            </p>
            <div className="si-empty-action">
              <button
                type="button"
                className="si-btn-create"
                onClick={() => setIsModalOpen(true)}
              >
                + Buat Invoice Penjualan Pertama
              </button>
            </div>
            <div className="si-empty-note">
              <b>Alur Bisnis Noir Living:</b> CRM (Customer) &rarr; RAB Disetujui &rarr; Sales Invoice &rarr; Penerbitan Nomor Master Project.
            </div>
          </div>
        )}
      </div>

      {/* MODAL BUAT INVOICE */}
      <CreateInvoiceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSaved={handleInvoiceCreated}
        projects={effectiveProjects}
        existingInvoices={items}
        say={say}
      />

      <style>{`
        .si-root { padding: 0; }
        .si-intro { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin:0 0 16px; }
        .si-intro-copy strong { display:block; font-size:15px; color:var(--text-main); font-weight:700; }
        .si-intro-copy span { display:block; margin-top:3px; font-size:12.5px; color:var(--text-muted); max-width:640px; line-height:1.5; }
        .si-header-actions { display:flex; align-items:center; gap:10px; }
        .si-badge-fase { display:inline-flex; align-items:center; font-size:11px; font-weight:700; color:#4b523a; background:#f0f1ea; border:1px solid #d5d9ce; border-radius:999px; padding:4px 10px; }
        .si-btn-create {
          background: #4b523a; color: #fff; border: 1px solid #3d432e;
          border-radius: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600;
          cursor: pointer; transition: all 0.15s;
        }
        .si-btn-create:hover { background: #3d432e; box-shadow: 0 2px 6px rgba(0,0,0,0.12); }

        /* KPI GRID */
        .si-kpi-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px; margin-bottom: 16px;
        }
        .si-kpi-card {
          background: var(--card-bg, #fff); border: 1px solid var(--border-light, #e0e2db);
          border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column;
        }
        .si-kpi-lbl { font-size: 11px; color: var(--text-muted, #666); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .si-kpi-val { font-size: 18px; color: var(--text-main, #222); font-weight: 800; margin: 4px 0 2px; }
        .si-kpi-sub { font-size: 11px; color: #888; }
        .si-c-warn { color: #d97706; }
        .si-c-ok { color: #16a34a; }

        /* TOOLBAR */
        .si-toolbar {
          display: flex; justify-content: space-between; align-items: center; gap: 12px;
          margin-bottom: 14px; flex-wrap: wrap;
        }
        .si-filter-tabs { display: flex; gap: 6px; }
        .si-tab-btn {
          background: #f4f5f1; border: 1px solid #dcdfd6; border-radius: 6px;
          padding: 5px 12px; font-size: 12px; color: #555; cursor: pointer;
        }
        .si-tab-btn.active {
          background: #4b523a; color: #fff; border-color: #4b523a; font-weight: 600;
        }
        .si-search-wrap input {
          border: 1px solid #cfd3c7; border-radius: 6px; padding: 6px 12px;
          font-size: 12px; width: 240px; outline: none; background: #fff;
        }
        .si-search-wrap input:focus { border-color: #4b523a; }

        /* TABLE */
        .si-panel { background:var(--card-bg, #fff); border:1px solid var(--border-light, #e0e2db); border-radius:12px; overflow:hidden; }
        .si-panel-head { display:flex; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border-light, #e0e2db); background:#fcfdfb; font-size:12.5px; }
        .si-table-wrap { overflow-x: auto; }
        .si-table { width:100%; border-collapse:collapse; font-size:12.5px; }
        .si-table th { text-align:left; font-size:11px; text-transform:uppercase; color:var(--text-muted, #666); background:#f5f6f2; padding:10px 14px; border-bottom:1px solid #e0e2db; }
        .si-table td { padding:12px 14px; border-bottom:1px solid #f0f2eb; vertical-align:middle; }
        .si-table tr:hover td { background: #fafbf9; }
        .si-num { text-align:right; font-variant-numeric:tabular-nums; }
        .si-inv-num { font-size:13px; color:#2a3024; }
        .si-due-txt { display:block; font-size:10.5px; color:#c2410c; margin-top:2px; }
        .si-subtxt { font-size:11px; color:#777; margin-top:2px; }
        .si-proj-code {
          background: #eef2ea; color: #3b4233; font-weight: 700;
          font-size: 11px; padding: 2px 5px; border-radius: 4px; margin-right: 4px;
        }
        .si-rab-pill {
          background: #fdfaf2; color: #b45309; border: 1px solid #fed7aa;
          font-size: 11px; padding: 2px 7px; border-radius: 999px; font-weight: 600;
        }

        /* BADGES */
        .si-badge { display:inline-block; font-size:10.5px; font-weight:700; border-radius:999px; padding:3px 8px; }
        .si-badge-draft { background:#f0f1ea; color:#4b523a; border:1px solid #d5d9ce; }
        .si-badge-sent { background:#fef3c7; color:#92400e; border:1px solid #fde68a; }
        .si-badge-approved { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; }
        .si-badge-paid { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; font-weight:800; }
        .si-badge-void { background:#f3f4f6; color:#9ca3af; text-decoration:line-through; }
        .si-badge-muted { background:#f3f4f6; color:#6b7280; }

        /* ROW ACTIONS */
        .si-row-actions { display: flex; gap: 6px; justify-content: center; }
        .si-act-btn {
          border-radius: 5px; padding: 4px 8px; font-size: 11px; font-weight: 600;
          cursor: pointer; border: 1px solid transparent; transition: all 0.15s;
        }
        .si-act-pdf { background: #fdf6e7; color: #b45309; border-color: #fed7aa; }
        .si-act-pdf:hover { background: #fef08a; color: #854d0e; }
        .si-act-pay { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
        .si-act-pay:hover { background: #dcfce7; }
        .si-act-send { background: #f0f9ff; color: #0369a1; border-color: #bae6fd; }
        .si-act-send:hover { background: #e0f2fe; }

        /* EMPTY STATE */
        .si-empty { padding: 48px 20px; text-align: center; }
        .si-empty-icon { font-size: 36px; margin-bottom: 8px; }
        .si-empty strong { display: block; font-size: 15px; color: #333; margin-bottom: 6px; }
        .si-empty p { font-size: 12.5px; color: #666; max-width: 520px; margin: 0 auto 16px; line-height: 1.5; }
        .si-empty-note {
          margin: 14px auto 0; font-size: 11.5px; color: #6b6f66;
          background: #f7f8f5; border: 1px dashed #d5d9ce; border-radius: 8px;
          padding: 8px 12px; max-width: 560px;
        }
        .si-empty-action { margin-top: 14px; }
      `}</style>
    </div>
  )
}
