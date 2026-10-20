import React from 'react'
import { exportWorkbook } from '../lib/workflow'
import { headersFor, parseHandoverNote } from '../lib/constants'
// t_50b783de (Approval OFF): kartu "Menunggu approval" dan sheet ekspor
// Approval hanya dirender bila modul Approval aktif (satu kebijakan terpusat).
import { isApprovalEnabled, isLaborStockEnabled, isMarketingEnabled } from '../lib/constants'
import CompactRoot from './CompactRoot'

// Ikon kartu metrik (stroke SVG) — menggantikan emoji agar terlihat rapi
// dan konsisten di semua platform. Murni visual.
const CARD_ICONS = {
  projects: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  past_projects: <path d="M3 8h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM2 4h20v4H2zM10 13h4" />,
  requests: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 13h6M9 17h6" />,
  approvals: <path d="M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  receivings: <path d="M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />,
  planning: <path d="M3 3v18h18M7 15l3-4 3 3 5-7" />,
  project_finance: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  finance: <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  tukang_upah: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  rab_boq: <path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 11h3M8 15h3M15 11v6M13 15h4" />,
  sales_invoice: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />,
  rap: <path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h4" />,
  rap_compare: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  stock: <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" />,
  crm: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  labor_stock: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
}

function CardIcon({ id }) {
  const d = CARD_ICONS[id]
  if (!d) return null
  return (
    <span className="card-ico" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
        strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        {d}
      </svg>
    </span>
  )
}

export default function Dashboard({ rows, activeProjects, pastProjects, setPage, role = 'user' }) {
  const approvalOn = isApprovalEnabled()
  const pendingApprovals = approvalOn ? (rows.approvals?.filter(a => a.status === 'PENDING').length || 0) : 0

  // [key, label, nilai, tone, hint]
  const cards = [
    ['projects', 'Project aktif', activeProjects.length, 'tone-neutral', `${pastProjects.length} past project`],
    ['requests', 'Purchase Request', rows.requests?.length || 0, 'tone-neutral', 'lihat semua PR'],
    // t_50b783de: kartu pintasan Approval HILANG dari dashboard saat OFF —
    // bukan CSS-hidden, memang tidak dimasukkan ke daftar kartu (tidak ada
    // tombol yang bisa diklik menuju modul nonaktif).
    ...(approvalOn
      ? [['approvals', 'Menunggu approval', pendingApprovals, pendingApprovals > 0 ? 'tone-warn' : 'tone-ok',
          pendingApprovals > 0 ? 'perlu tindakan' : 'tidak ada antrean']]
      : []),
    ['receivings', 'Pembelian', rows.receivings?.length || 0, 'tone-neutral', 'penerimaan barang'],
    // t_31871b64 (Sprint 1, arahan DAT): menu "Past Project" digabung ke
    // Projects (tab Aktif/Selesai). Kartu dashboard jadi satu dan mengarah
    // ke modul 'projects'. Rute lama 'past_projects' tetap terdaftar dan
    // membuka tab Selesai, jadi link/bookmark lama masih bekerja.
    ['projects', 'Project selesai', pastProjects.length, 'tone-neutral', 'tab Selesai di Project']
  ]

  // Modul tambahan khusus admin
  // Modul tambahan khusus admin
  const adminCards = role === 'admin' ? [
    ['rab_boq', 'RAB & BOQ', 'Kalkulator', 'tone-neutral'],
    ['sales_invoice', 'Invoice Penjualan', 'Baru', 'tone-neutral'],
    // t_35cd0354 (integrasi): modul baru WAJIB bisa DIBUKA dari UI, bukan
    // stub yang hanya hidup lewat manipulasi state. Semua rute di bawah
    // dirender pages/index.js (source:'core') dengan guard admin.
    ['rap', 'RAP (Rencana Pelaksanaan)', 'DRAFT_ONLY', 'tone-neutral'],
    ['rap_compare', 'Perbandingan RAB/RAP/Aktual', 'Read-only', 'tone-neutral'],
    // t_da4a9ef8 (B3): Stok Workshop sudah digabung ke Material. Kartu ini
    // dipertahankan sebagai jalur lama (ID navigasi lama tetap bekerja) dan
    // akan dialihkan ke Material oleh navAliasFor — labelnya jujur menyebut
    // tujuan barunya, bukan menjanjikan halaman terpisah.
    ['stock', 'Stok (di Material)', 'Gabungan', 'tone-neutral', 'Stok ada di Material'],
    ['crm', 'Customer CRM', 'Read-only', 'tone-neutral'],
    // t_6a18a263 (arahan DAT): kartu pintasan Actual Labor & Stok HILANG
    // dari dashboard — sama seperti pola Approval OFF, kartunya memang
    // tidak dimasukkan ke daftar (bukan disembunyikan lewat CSS), jadi
    // tidak ada tombol yang mengarah ke modul nonaktif. Kode modul &
    // datanya tetap ada (reversible); upah tukang tetap terlihat di
    // Project Finance.
    ...(isLaborStockEnabled()
      ? [['labor_stock', 'Actual Labor & Stok', 'Read-only', 'tone-neutral']]
      : []),
    // t_6a18a263 (arahan DAT): kartu pintasan Marketing / Lead Pipeline
    // HILANG dari dashboard dengan pola yang sama seperti di atas.
    ...(isMarketingEnabled()
      ? [['marketing', 'Marketing / Lead Pipeline', 'Read-only', 'tone-neutral']]
      : []),
    ['planning', 'Budgeting', 'Rencana', 'tone-neutral'],
    ['project_finance', 'Project Finance', 'Laba/rugi', 'tone-neutral'],
    ['finance', 'Finance', 'Ringkasan', 'tone-neutral'],
    ['tukang_upah', 'Upah Tukang', 'Upah', 'tone-neutral'],
    ['settings', 'Settings', 'Admin', 'tone-neutral']
  ] : []
  return (
    <CompactRoot className="dashboard-compact">
      <div className="cards">
        {cards.map(([k, t, count, tone, hint]) => (
          <button className={`card ${tone}`} onClick={() => setPage(k)} key={k} type="button">
            <div className="card-top">
              <span className="card-label">{t}</span>
              <CardIcon id={k} />
            </div>
            <strong>{count}</strong>
            <small className="card-hint">{hint} <span className="card-arrow">→</span></small>
          </button>
        ))}
      </div>

      {adminCards.length > 0 && (
        <div className="panel admin-shortcuts">
          <div className="panel-head">
            <h2>Admin Suite</h2>
            <span className="badge-admin">★ Khusus admin</span>
          </div>
          <div className="shortcut-grid">
            {adminCards.map(([k, t, sub]) => (
              <button className="shortcut" onClick={() => setPage(k)} key={k} type="button">
                <CardIcon id={k} />
                <span className="shortcut-text">
                  <b>{t}</b>
                  <small>{sub}</small>
                </span>
                <span className="shortcut-arrow">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>Aktivitas terbaru</h2>
        </div>
        <p className="muted">Data terbaru akan tampil di masing-masing menu. Gunakan Purchase Request untuk memulai pengadaan.</p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
          <button
            type="button"
            className="outline btn-export-all"
            onClick={() => exportWorkbook([
              ['Projects', rows.projects || [], headersFor('projects', rows.projects || [])],
              ['Vendors', rows.vendors || [], headersFor('vendors', rows.vendors || [])],
              ['Materials', rows.materials || [], headersFor('materials', rows.materials || [])],
              ['Purchase Request', rows.requests || [], ['priority', 'pr_number', 'project_name', 'title', 'materials_summary', 'status', 'notes', 'created_at']],
              ['PR Items', (rows.pr_items || []).map(it => ({
                ...it,
                vendor_name: (rows.vendors || []).find(v => v.id === it.vendor_id)?.name || ''
              })), ['pr_id', 'material_id', 'item_name', 'kode', 'unit', 'quantity', 'estimated_price', 'status', 'supplier_category', 'vendor_name']],
              // t_50b783de: sheet Approval hanya ada bila modul Approval aktif.
              ...(approvalOn
                ? [['Approval', rows.approvals || [], ['pr_number', 'project_name', 'title', 'step_number', 'status', 'note', 'decided_at']]]
                : []),
              ['Pembelian', rows.receivings || [], ['invoice_no', 'project_name', 'delivery_note', 'status', 'received_date', 'note', 'alokasi', 'masuk_gudang', 'tukang_at']],
              ['Item Pembelian', rows.receiving_items || [], ['receiving_id', 'pr_item_id', 'item_name', 'quantity_received', 'unit', 'note', 'created_at']],
              // Kolom note handover bisa memuat bukti foto base64 (maks 2MB) —
              // JANGAN ikutkan ke sel Excel (batas 32.767 karakter/sel). Yang
              // diekspor cukup catatan teksnya + penanda keberadaan foto.
              // t_31871b64 (Sprint 1, arahan DAT): nama sheet ikut rename
              // terlihat 'Handover' -> 'Serah Terima'.
              ['Serah Terima', (rows.handovers || []).map(h => {
                const { foto, extra } = parseHandoverNote(h.note)
                return { ...h, note: [extra, foto ? '(ada bukti foto di aplikasi)' : ''].filter(Boolean).join(' ') }
              }), ['project_name', 'received_by', 'status', 'handover_date', 'note', 'diserahkan_at']]
            ], 'Purchasing-Seluruh-Data')}
          >
            Export Semua Data (Excel)
          </button>
        </div>
      </div>
    </CompactRoot>
  )
}
