import * as XLSX from 'xlsx'

// ============================================================
// Helper ekspor & template — dipakai dari UI (client-side).
// Semua fungsi murni di browser, tidak butuh server.
// ============================================================

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function stamp() {
  return new Date().toISOString().slice(0, 10)
}

function safeRows(rows, columns) {
  return (rows || []).map(r => {
    const o = {}
    for (const c of columns) o[c] = r[c] ?? ''
    return o
  })
}

// --- Label header per kolom (konsisten dengan tabel di UI) ---
const HEADER_LABEL = {
  pr_number: 'No. PR',
  project_name: 'Project',
  title: 'Judul Kebutuhan',
  materials_summary: 'Item Material',
  priority: 'Prioritas',
  status: 'Status',
  notes: 'Catatan',
  created_at: 'Dibuat',
  step_number: 'Step',
  decided_at: 'Waktu Putusan',
  delivery_note: 'Surat Jalan / PO',
  invoice_no: 'No. Invoice',
  received_date: 'Tgl Terima',
  handover_date: 'Tgl Serah Terima',
  received_by: 'Diterima Oleh',
  name: 'Nama',
  kode: 'Kode',
  code: 'Kode',
  category: 'Kategori',
  qty: 'Qty',
  satuan: 'Satuan',
  unit: 'Satuan',
  contact: 'Kontak',
  phone: 'Telepon'
}

function toHeader(col) {
  return HEADER_LABEL[col] || String(col).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtValue(v, col) {
  if (v === null || v === undefined || v === '') return ''
  if (col === 'created_at' || col === 'decided_at' || col === 'received_date' || col === 'handover_date') {
    const d = new Date(v)
    if (!isNaN(d.getTime())) {
      return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear()
    }
  }
  return v
}

// --- Export satu modul ke Excel ---
export function exportToExcel(rows, columns, filenameBase) {
  const cols = (columns && columns.length ? columns : Object.keys((rows && rows[0]) || { a: 1 }))
    .filter(c => !['id', 'password'].includes(c))
  const data = [
    cols.map(toHeader),
    ...(rows || []).map(r => cols.map(c => fmtValue(r[c], c)))
  ]
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = cols.map(() => ({ wch: 18 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  triggerDownload(new Blob([out], { type: 'application/octet-stream' }), `${filenameBase}-${stamp()}.xlsx`)
}

// --- Export satu modul ke CSV ---
export function exportToCsv(rows, columns, filenameBase) {
  const cols = (columns && columns.length ? columns : Object.keys((rows && rows[0]) || { a: 1 }))
    .filter(c => !['id', 'password'].includes(c))
  const esc = v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`
  const lines = [cols.map(c => esc(toHeader(c))).join(',')]
  for (const r of (rows || [])) lines.push(cols.map(c => esc(fmtValue(r[c], c))).join(','))
  triggerDownload(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${filenameBase}-${stamp()}.csv`)
}

// --- Export gabungan beberapa modul (1 file, banyak sheet) ---
export function exportWorkbook(sheets, filenameBase) {
  const wb = XLSX.utils.book_new()
  for (const [name, rows, columns] of sheets) {
    const cols = (columns && columns.length ? columns : Object.keys((rows && rows[0]) || { a: 1 }))
      .filter(c => !['id', 'password'].includes(c))
    const data = [
      cols.map(toHeader),
      ...(rows || []).map(r => cols.map(c => fmtValue(r[c], c)))
    ]
    const ws = XLSX.utils.aoa_to_sheet(data)
    ws['!cols'] = cols.map(() => ({ wch: 18 }))
    const safeName = String(name).replace(/[\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet'
    XLSX.utils.book_append_sheet(wb, ws, safeName)
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  triggerDownload(new Blob([out], { type: 'application/octet-stream' }), `${filenameBase}-${stamp()}.xlsx`)
}

// ============================================================
// Template impor item PR
// ============================================================

const IMPORT_HEADERS = ['Kode Material', 'Nama Material', 'Qty', 'Satuan']

export function downloadPrImportTemplate(masterList = []) {
  const wb = XLSX.utils.book_new()
  const wsData = [IMPORT_HEADERS]
  for (const m of (masterList || []).slice(0, 400)) {
    wsData.push([m.kode || m.code || '', m.name || '', '', m.satuan || m.unit || 'Pcs'])
  }
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 10 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Data Material')

  // Sheet petunjuk
  const guide = [
    ['CARA PAKAI TEMPLATE IMPORT ITEM PURCHASE REQUEST'],
    [''],
    ['1. Isi Sheet "Data Material": kolom Kode Material, Nama Material, Qty (wajib), Satuan (opsional).'],
    ['2. Kode Material bisa dikosongkan (mengisi Nama saja) asal Nama sama persis dengan master material.'],
    ['3. Qty diisi angka, contoh: 5 / 12 / 20.5'],
    ['4. Jangan mengubah urutan/nama kolom header (baris pertama).'],
    ['5. Simpan file, lalu di form PR klik "Import Excel" dan pilih file ini.'],
    [''],
    ['Kolom wajib'],
    ['  - Qty'],
    ['Kolom opsional'],
    ['  - Kode Material (tambah akurasi pemilihan bila nama material kembar)'],
    ['  - Satuan (bila kosong, otomatis memakai satuan dari master material)'],
  ]
  const ws2 = XLSX.utils.aoa_to_sheet(guide)
  ws2['!cols'] = [{ wch: 110 }]
  XLSX.utils.book_append_sheet(wb, ws2, 'Petunjuk')

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  triggerDownload(new Blob([out], { type: 'application/octet-stream' }), `Template-Import-Item-PR-${stamp()}.xlsx`)
}

// ============================================================
// Parser impor item PR dari Excel/CSV
// ============================================================

function detectColumn(headerRow, patterns) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '').toLowerCase().trim()
    if (patterns.some(p => h === p || h.includes(p))) return i
  }
  return -1
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Baca file Excel/CSV -> daftar item PR { material_id, name, qty, satuan, kode, source }
 * Item yang cocok 100% dengan master material di-return, sisanya masuk neededReview/error.
 */
export function parsePrItemsFile(arrayBuffer, fileName, masterList = []) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return { items: [], errors: ['File tidak punya sheet yang bisa dibaca.'] }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false })
  if (!rows.length) return { items: [], errors: ['File kosong atau tidak terbaca.'] }

  // cari baris header
  let headerIdx = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const joined = rows[i].map(c => String(c || '').toLowerCase()).join(' ')
    if (joined.includes('qty') || joined.includes('kuantitas')) { headerIdx = i; break }
  }
  const header = (rows[headerIdx] || []).map(c => String(c || '').trim())

  const idxKode = detectColumn(header, ['kode material', 'kode', 'code'])
  const idxNama = detectColumn(header, ['nama material', 'nama', 'material', 'item'])
  const idxQty = detectColumn(header, ['qty', 'kuantitas', 'jumlah'])
  const idxSatuan = detectColumn(header, ['satuan', 'unit', 'uom'])

  const errors = []
  const warnings = []

  if (idxQty === -1) errors.push(`Kolom "Qty" tidak ditemukan. Header terbaca: ${header.filter(Boolean).join(', ')}`)
  if (idxNama === -1 && idxKode === -1) errors.push('Kolom "Nama Material" atau "Kode Material" tidak ditemukan.')
  if (errors.length) return { items: [], errors, warnings }

  const byKode = new Map()
  const byName = new Map()
  for (const m of (masterList || [])) {
    const k1 = String(m.kode || m.code || '').trim().toLowerCase()
    if (k1) byKode.set(k1, m)
    const k2 = normalizeName(m.name)
    if (k2 && !byName.has(k2)) byName.set(k2, m)
  }

  const items = []
  const matchedIds = new Set()

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every(c => String(c || '').trim() === '')) continue
    const nama = idxNama >= 0 ? String(row[idxNama] || '').trim() : ''
    const kode = idxKode >= 0 ? String(row[idxKode] || '').trim() : ''
    const qtyRaw = idxQty >= 0 ? row[idxQty] : ''
    const qty = Number(String(qtyRaw).replace(',', '.'))
    const satuan = idxSatuan >= 0 ? String(row[idxSatuan] || '').trim() : ''

    if ((!nama && !kode)) { warnings.push(`Baris ${i + 1}: tidak ada nama/kode material, dilewati.`); continue }
    if (!isFinite(qty) || qty <= 0) { errors.push(`Baris ${i + 1} ("${nama || kode}"): Qty tidak valid ("${qtyRaw}").`); continue }

    let mat = null
    if (kode) mat = byKode.get(kode.toLowerCase())
    if (!mat && nama) mat = byName.get(normalizeName(nama))
    if (!mat && kode) {
      // fallback: kode tanpa prefix / tanpa dash
      const k2 = normalizeName(kode)
      for (const [key, m] of byKode) { if (normalizeName(key) === k2) { mat = m; break } }
    }

    if (!mat) {
      errors.push(`Baris ${i + 1} ("${nama || kode}"): tidak ditemukan di master material.`)
      continue
    }

    if (matchedIds.has(mat.id)) {
      const prev = items.find(x => x.material_id === mat.id)
      if (prev) prev.qty = Number((Number(prev.qty) + qty).toFixed(4))
      continue
    }
    matchedIds.add(mat.id)
    items.push({
      material_id: mat.id,
      kode: mat.kode || mat.code || '—',
      name: mat.name,
      category: mat.category || '—',
      satuan: satuan || mat.satuan || mat.unit || 'Pcs',
      qty: Number(qty.toFixed(4))
    })
  }

  return { items, errors, warnings, fileName: fileName || 'file' }
}
