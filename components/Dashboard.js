import React from 'react'
import { exportWorkbook } from '../lib/workflow'
import { headersFor } from '../lib/constants'

export default function Dashboard({ rows, activeProjects, pastProjects, setPage }) {
  const cards = [
    ['projects', 'Project aktif', activeProjects.length],
    ['past_projects', 'Past Project', pastProjects.length],
    ['requests', 'Purchase Request', rows.requests?.length || 0],
    ['approvals', 'Menunggu approval', rows.approvals?.filter(a => a.status === 'PENDING').length || 0],
    ['receivings', 'Purchase', rows.receivings?.length || 0]
  ]
  return (
    <>
      <div className="cards">
        {cards.map(([k, t, count]) => (
          <button className="card" onClick={() => setPage(k)} key={k}>
            <span>{t}</span>
            <strong>{count}</strong>
            <small>Lihat detail →</small>
          </button>
        ))}
      </div>
      <div className="panel">
        <h2>Aktivitas terbaru</h2>
        <p className="muted">Data terbaru akan tampil di masing-masing menu. Gunakan Purchase Request untuk memulai pengadaan.</p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
          <button
            type="button"
            className="outline"
            style={{ fontSize: '12px', padding: '8px 12px' }}
            onClick={() => exportWorkbook([
              ['Projects', rows.projects || [], headersFor('projects', rows.projects || [])],
              ['Vendors', rows.vendors || [], headersFor('vendors', rows.vendors || [])],
              ['Materials', rows.materials || [], headersFor('materials', rows.materials || [])],
              ['Purchase Request', rows.requests || [], ['priority', 'pr_number', 'project_name', 'title', 'materials_summary', 'status', 'notes', 'created_at']],
              ['PR Items', (rows.pr_items || []).map(it => ({
                ...it,
                vendor_name: (rows.vendors || []).find(v => v.id === it.vendor_id)?.name || ''
              })), ['pr_id', 'material_id', 'item_name', 'kode', 'unit', 'quantity', 'estimated_price', 'status', 'supplier_category', 'vendor_name']],
              ['Approval', rows.approvals || [], ['pr_number', 'project_name', 'title', 'step_number', 'status', 'note', 'decided_at']],
              ['Receiving', rows.receivings || [], ['invoice_no', 'project_name', 'delivery_note', 'status', 'received_date', 'note', 'alokasi', 'masuk_gudang', 'tukang_at']],
              ['Receiving Items', rows.receiving_items || [], ['receiving_id', 'pr_item_id', 'item_name', 'quantity_received', 'unit', 'note', 'created_at']],
              ['Handover', rows.handovers || [], ['project_name', 'received_by', 'status', 'handover_date', 'note', 'diserahkan_at']]
            ], 'Purchasing-Seluruh-Data')}
          >
            📦 Export Semua Data (Excel)
          </button>
        </div>
      </div>
    </>
  )
}
