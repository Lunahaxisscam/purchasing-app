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
      ['receivings', 'Purchase'],
      ['handovers', 'Handover']
    ]
  },
  {
    items: [
      ['past_projects', 'Past Project']
    ]
  },
  {
    // Modul khusus ADMIN — sidebar menyaring section ini berdasarkan role.
    adminOnly: true,
    items: [
      ['finance', 'Finance'],
      ['settings', 'Settings']
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
  receivings: 'Purchase',
  handovers: 'Handover',
  past_projects: 'Past Project',
  finance: 'Finance',
  settings: 'Settings'
}

// ============================================================
// Kode material per kategori (revisi 9 Okt 2026).
// Tiap kategori punya prefix + nomor urut 4 digit sendiri (contoh PLY-0001).
// Material baru otomatis memakai format ini; material lama dimigrasi dengan
// mempertahankan urutan lamanya.
// ============================================================
export const MATERIAL_KODE_PREFIXES = {
  'Plywood & Board': 'PLY',
  'HPL & Edging': 'HPL',
  'WPC & Panel': 'WPC',
  'Hardware & Fitting': 'HWF',
  'Kelistrikan & Lampu': 'KEL',
  'Aluminium & Profil': 'ALM',
  'Bahan Habis Pakai': 'BHP'
}

// Kategori tak dikenal -> prefix cadangan 'MAT' (pengaman).
export function prefixForCategory(category) {
  const key = String(category || '').trim()
  return MATERIAL_KODE_PREFIXES[key] || 'MAT'
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
  // pr_items tidak punya created_at; pakai sort_order supaya urutan item SELALU
  // stabil sesuai urutan input (tanpa ORDER BY, PostgreSQL bisa mengubah urutan
  // setelah row di-update). NullsLast di-handle di pemanggil.
  if (table === 'pr_items') return { column: 'sort_order', ascending: true }
  return { column: 'created_at', ascending: false }
}

export function headersFor(page, rows) {
  const defaults = {
    projects: ['kode', 'name', 'status', 'created_at'],
    past_projects: ['kode', 'name', 'status', 'created_at'],
    vendors: ['name', 'phone', 'store_link', 'supplier_category'],
    materials: ['kode', 'name', 'category', 'qty', 'satuan', 'harga_acuan'],
    requests: ['priority', 'pr_number', 'project_name', 'title', 'items_qty', 'materials_summary', 'vendor_name', 'estimasi_harga', 'status'],
    approvals: ['pr_number', 'project_name', 'title', 'items', 'items_qty', 'step_number', 'status', 'note', 'decided_at'],
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
  if (x === 'harga_acuan') return 'Acuan Harga'
  if (x === 'items_qty') return 'Qty'
  if (x === 'estimasi_harga') return 'Estimasi Harga' 
  if (x === 'vendor_name') return 'Vendor' 
  if (x === 'contact') return 'Kontak'
  if (x === 'phone') return 'Kontak WA'
  if (x === 'store_link') return 'Link Toko'
  if (x === 'supplier_category') return 'Kategori Material' 
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

// ============================================================
// Helper Receiving — Nominal Riil & Foto/Nota (Poin 3).
// Data tersimpan terstruktur di kolom `note` tabel receivings:
//   [Nominal: Rp X.XXX.XXX] [Nota: url] [Catatan Tambahan]
// ============================================================

export function formatRibuan(n) {
  const digits = String(n ?? '').replace(/[^\d]/g, '')
  if (!digits) return '0'
  return new Intl.NumberFormat('id-ID').format(Number(digits))
}

// Format live saat user mengetik nominal: hanya angka, otomatis titik ribuan.
export function formatNominalInput(v) {
  const digits = String(v ?? '').replace(/[^\d]/g, '').slice(0, 15)
  return digits ? new Intl.NumberFormat('id-ID').format(Number(digits)) : ''
}

export function rupiah(n) {
  return `Rp ${formatRibuan(n)}`
}

// Ekstrak Nominal / Nota / Catatan dari kolom note (aman untuk data lama
// yang belum terstruktur — teks lamanya masuk ke `extra` apa adanya).
export function parseReceivingNote(note) {
  const s = String(note || '')
  const nomMatch = s.match(/\[Nominal:\s*Rp\s*([\d.,]+)\s*\]/i)
  const notaMatch = s.match(/\[Nota:\s*([^\]]+)\]/i)
  let nominal = null
  if (nomMatch) {
    const digits = nomMatch[1].replace(/[^\d]/g, '')
    if (digits) nominal = Number(digits)
  }
  const notaUrl = notaMatch ? notaMatch[1].trim() : ''
  const extra = s
    .replace(/\[Nominal:[^\]]*\]/ig, ' ')
    .replace(/\[Nota:[^\]]*\]/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { nominal, notaUrl, extra }
}

// Susun ulang kolom note dari input form (nominal terformat "450.000" pun aman).
export function buildReceivingNote({ nominal, nota, extra } = {}) {
  const parts = []
  const digits = String(nominal ?? '').replace(/[^\d]/g, '')
  if (digits && Number(digits) > 0) parts.push(`[Nominal: Rp ${formatRibuan(digits)}]`)
  const notaStr = String(nota || '').trim()
  if (notaStr) parts.push(`[Nota: ${notaStr}]`)
  const extraStr = String(extra || '').trim()
  if (extraStr) parts.push(extraStr)
  return parts.length ? parts.join(' ') : null
}

// Teks nota -> href aman: hanya http(s) atau domain tanpa spasi.
// Nomor resi biasa (bukan URL) dikembalikan '' supaya tidak jadi link ngawur.
export function notaHref(value) {
  const s = String(value || '').trim()
  if (!s || /\s/.test(s)) return ''
  if (/^https?:\/\//i.test(s)) return s
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s)) return `https://${s}`
  return ''
}

// ============================================================
// Format waktu untuk modul Settings & Finance (Drive sync).
// ============================================================

// Waktu lengkap ala Indonesia: "10 Okt 2026, 00.05"
export function formatDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.')
  return `${tgl}, ${jam}`
}

// Jarak waktu relatif: "baru saja", "5 menit lalu", "2 jam lalu", "3 hari lalu".
export function timeAgo(v) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 0) return 'baru saja'
  const mnt = Math.floor(diff / 60000)
  if (mnt < 1) return 'baru saja'
  if (mnt < 60) return `${mnt} menit lalu`
  const jam = Math.floor(mnt / 60)
  if (jam < 24) return `${jam} jam lalu`
  const hari = Math.floor(jam / 24)
  return `${hari} hari lalu`
}
