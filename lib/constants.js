export const navSections = [
  {
    items: [
      ['dashboard', 'Dashboard'],
      ['projects', 'Projects'],
      ['vendors', 'Vendors'],
      ['materials', 'Materials']
    ]
  },
  {
    items: [
      ['requests', 'Purchase Request'],
      ['approvals', 'Approval'],
      ['receivings', 'Receiving'],
      ['handovers', 'Handover']
    ]
  },
  {
    items: [
      ['past_projects', 'Past Project']
    ]
  }
]

export const modules = navSections.flatMap(s => s.items)

export const labels = {
  projects: 'Project',
  vendors: 'Vendor',
  materials: 'Material',
  requests: 'Purchase Request',
  approvals: 'Approval',
  receivings: 'Receiving',
  handovers: 'Handover',
  past_projects: 'Past Project'
}

export const statusOptions = [
  { value: 'NOT_START', label: 'Not Start' },
  { value: 'ON_GOING', label: 'On Going' },
  { value: 'DONE', label: 'Done' }
]

export const receivingStatusOptions = [
  { value: 'NORMAL', label: '✓ Normal' },
  { value: 'RETUR', label: '⚠️ Retur' },
  { value: 'REFUND', label: '⚠️ Refund' }
]

export function isReceivingKendala(s) {
  if (!s) return false
  const up = String(s).toUpperCase()
  return up === 'RETUR' || up === 'REFUND' || up === 'RUSAK' || up.startsWith('KENDALA')
}

export function prettyReceivingStatus(s) {
  const up = String(s || '').toUpperCase()
  if (up === 'NORMAL') return '✓ Normal'
  if (up === 'RETUR' || up === 'KENDALA_RETUR') return '⚠️ Retur'
  if (up === 'REFUND') return '⚠️ Refund'
  if (up === 'RUSAK' || up === 'KENDALA_RUSAK') return '⚠️ Rusak'
  if (up === 'SELESAI') return '✓ Diterima (status lama)'
  if (up === 'MASUK_GUDANG') return '📦 Masuk Gudang (status lama)'
  if (up === 'OTW') return 'OTW (status lama)'
  if (up === 'MENUNGGU_BARANG') return '⏳ Menunggu Barang (status lama)'
  if (up === 'PENDING') return 'Pending (status lama)'
  const match = receivingStatusOptions.find(o => o.value === s)
  if (match) return match.label
  return s
}

export function normalizeStatus(s) {
  if (!s) return 'NOT_START'
  const up = String(s).toUpperCase().trim().replace(/[\s-]+/g, '_')
  if (up === 'DONE') return 'DONE'
  if (up === 'ON_GOING' || up === 'ONGOING' || up === 'ACTIVE') return 'ON_GOING'
  if (up === 'NOT_START' || up === 'NOT_STARTED' || up === 'PLANNING') return 'NOT_START'
  return up
}

export function prettyStatus(s) {
  const norm = normalizeStatus(s)
  const found = statusOptions.find(o => o.value === norm)
  return found ? found.label : s
}

export function orderSpecFor(table) {
  if (table === 'materials') return { column: 'kode', ascending: true }
  if (table === 'approval_steps') return { column: 'step_number', ascending: true }
  if (table === 'pr_items') return null
  return { column: 'created_at', ascending: false }
}

export function headersFor(page, rows) {
  const defaults = {
    projects: ['kode', 'name', 'status', 'created_at'],
    past_projects: ['kode', 'name', 'status', 'created_at'],
    vendors: ['name', 'phone', 'store_link', 'supplier_category'],
    materials: ['kode', 'name', 'category', 'qty', 'satuan'],
    requests: ['priority', 'pr_number', 'project_name', 'title', 'materials_summary', 'status'],
    approvals: ['pr_number', 'project_name', 'title', 'items', 'step_number', 'status', 'note', 'decided_at'],
    receivings: ['invoice_no', 'project_name', 'status', 'received_date', 'note'],
    handovers: ['project_name', 'received_by', 'status', 'handover_date', 'note']
  }
  if (['materials', 'vendors', 'projects', 'past_projects', 'requests', 'approvals', 'receivings', 'handovers'].includes(page)) {
    return defaults[page]
  }
  return rows[0]
    ? Object.keys(rows[0]).filter(x => !['id', 'password'].includes(x)).slice(0, 6)
    : defaults[page]
}

export function pretty(x) {
  if (x === 'kode') return 'Kode'
  if (x === 'name') return 'Nama'
  if (x === 'category') return 'Kategori'
  if (x === 'qty') return 'Qty'
  if (x === 'satuan' || x === 'unit') return 'Satuan'
  if (x === 'contact') return 'Kontak'
  if (x === 'phone') return 'Kontak WA'
  if (x === 'store_link') return 'Link Toko'
  if (x === 'supplier_category') return 'Supplier'
  if (x === 'pr_number') return 'No. PR'
  if (x === 'project_name') return 'Project'
  if (x === 'title') return 'Judul Kebutuhan'
  if (x === 'materials_summary' || x === 'items') return 'Item Material'
  if (x === 'step_number') return 'Step'
  if (x === 'delivery_note') return 'Surat Jalan / PO'
  if (x === 'invoice_no') return 'No. Invoice'
  if (x === 'received_date') return 'Tgl Terima'
  if (x === 'handover_date') return 'Tgl Serah Terima'
  if (x === 'received_by') return 'Diterima Oleh'
  if (x === 'priority') return 'Prioritas'
  if (x === 'status') return 'Status'
  if (x === 'notes' || x === 'note') return 'Catatan'
  if (x === 'decided_at') return 'Waktu Putusan'
  return String(x).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function format(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d.toLocaleDateString('id-ID')
  }
  return String(v)
}
