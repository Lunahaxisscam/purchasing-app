// ============================================================
// modules/shared/sortRows.js
// Pengurutan kolom tabel — diekstrak VERBATIM dari ModuleView.js.
// Nilai virtual (items_qty / vendor_name / estimasi_harga utk PR) tetap
// dihitung dari helper item modul terkait.
// ============================================================

export function sortRows(displayRows, { sortKey, sortDir, page, requestItemRows, approvalItemQtys }) {
  if (sortKey) {
    const dir = sortDir === 'desc' ? -1 : 1
    const valOf = (row) => {
      if (sortKey === 'kode') return row.kode || row.code
      // Kolom QTY (Approval & PR) = nilai virtual: pakai qty item pertama utk sortir.
      if (sortKey === 'items_qty') {
        const q = page === 'requests' ? (requestItemRows(row)[0] || {}).qtyText : approvalItemQtys(row)[0]
        const m = String(q || '').match(/^([\d.,]+)/)
        return m ? Number(String(m[1]).replace(',', '.')) : null
      }
      // Kolom Vendor (PR) = nilai virtual dari item pertama.
      if (sortKey === 'vendor_name' && page === 'requests') {
        return (requestItemRows(row)[0] || {}).vendor || ''
      }
      // Kolom Estimasi Harga (PR) = nilai virtual dari item pertama.
      if (sortKey === 'estimasi_harga' && page === 'requests') {
        const p = (requestItemRows(row)[0] || {}).estPrice
        return p === null || p === undefined ? null : p
      }
      return row[sortKey]
    }
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
  return displayRows
}
