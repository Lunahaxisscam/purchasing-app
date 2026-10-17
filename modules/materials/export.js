// ============================================================
// modules/materials/export.js — EXPORT DATA MATERIAL (CSV & PDF)
// ============================================================
// t_27e26b0e (arahan DAT): dua tombol export di toolbar Modul Material:
//   📥 Export CSV — file data master material siap dibuka di Excel
//     (UTF-8 + BOM, separator ';' pola rab-boq agar Excel Indonesia
//     langsung memisah kolom), nama file Master_Material_YYYY-MM-DD.csv.
//   📄 Export PDF — dokumen A4 tabel material rapi (header Noir Living,
//     tanggal ekspor, kolom No/Kode/Nama/Kategori/Satuan/Stok), pola
//     PDF binary builder client-side dari modules/rab-boq/pdf.js
//     (TANPA dependency berat).
//
// Sumber data = displayRows shell (dataset yang sudah lolos filter /
// pencarian / sortir AKTIF, TANPA potongan "Show More 10") — export
// mengikuti apa yang terlihat di daftar, bukan hanya 10 baris pertama.
// Harga Acuan Terakhir memakai resolver acuan yang sama dengan UI
// (acuanEntries — HISTORIS/MASTER/PR_ESTIMATE/MANUAL, order bestEntry
// sudah terurut terbaik dulu oleh modules/materials/acuan.js), dan
// SELALU melabeli sumbernya secara jujur: estimasi PR TIDAK pernah
// tampil sebagai harga beli aktual (P1 t_e88c28fb).
// File ini MODUL-TERISOLASI: tidak mengimpor dari modul lain.
// ============================================================
import { materialUnit } from './acuan'

// --- util kecil lokal (pola sama dgn rab-boq, salin ringan agar modul
//     tidak memakai file modul lain — lihat catatan owners.md) ---
function csvCell(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10)
}

function ribuan(v) {
  const n = Number(v)
  return isFinite(n) ? n.toLocaleString('id-ID') : String(v)
}

// Angka stok apa adanya (bukan '—' mask bila kosong — export master data:
// NaN/null/tetap '' supaya Excel tidak mengarang angka 0).
function stokCsv(v) {
  if (v === null || v === undefined || v === '') return ''
  return stokTextCsv(v)
}
function stokTextCsv(v) {
  const n = Number(v)
  return isFinite(n) ? n.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : String(v)
}

// ============================================================
// LABEL "HARGA ACUAN TERAKHIR" (jujur terhadap sumber)
// ============================================================
const ACUAN_SOURCE_TEXT = {
  HISTORIS: 'Historis (beli aktual)',
  MASTER: 'Master',
  PR_ESTIMATE: 'Estimasi PR terdahulu — BUKAN harga beli',
  MANUAL: 'Manual (belum tersimpan)'
}

function acuanLabel(entries) {
  const e = (entries || [])[0]
  if (!e) return ''
  const bits = [`Rp ${ribuan(e.price)}`]
  if (e.unit) bits.push(`/ ${e.unit}`)
  bits.push(`(${ACUAN_SOURCE_TEXT[e.source] || e.source}${e.vendor ? ' — ' + e.vendor : ''})`)
  return bits.join(' ')
}

// ============================================================
// EXPORT CSV
// ============================================================
// Kolom (arahan DAT): Kode, Nama Material, Kategori, Satuan, Stok Saat
// Ini, Min Stok, Harga Acuan Terakhir. BOM \ufeff + ';' + newline \n
// (pola rab-boq/csvExport.js).
export function buildMaterialCsv(rows, acuanEntries) {
  const header = ['Kode', 'Nama Material', 'Kategori', 'Satuan', 'Stok Saat Ini', 'Min Stok', 'Harga Acuan Terakhir']
  const lines = [header]
  ;(rows || []).forEach(r => {
    let acuan = ''
    try {
      if (acuanEntries && r?.id) acuan = acuanLabel(acuanEntries(r))
    } catch { /* acuan gagal resolve → kolom kosong, export tetap jalan */ }
    lines.push([
      r?.kode ?? '',
      r?.name ?? '',
      r?.category ?? '',
      materialUnit(r),
      stokCsv(r?.current_stock),
      stokCsv(r?.min_stock),
      acuan
    ])
  })
  return '\ufeff' + lines.map(row => row.map(csvCell).join(';')).join('\n')
}

// ============================================================
// EXPORT PDF — A4 binary builder (pola modules/rab-boq/pdf.js)
// ============================================================
// Halaman A4 (595.28 × 841.89pt), margin 34, WinAnsi Helvetica.
// Header Noir Living + tanggal ekspor + jumlah data; tabel dengan
// kolom No | Kode | Nama Material | Kategori | Satuan | Stok; baris
// wrap nama/kategori, paginasi multi-halaman dgn header lanjutan.
const PDF_W = 595.28
const PDF_H = 841.89
const PDF_MARGIN = 34
const PDF_BOTTOM = 48
const INK = [0.09, 0.11, 0.10]
const NOIR = [0.09, 0.09, 0.11]
const MUTED = [0.42, 0.44, 0.42]
const LINE = [0.78, 0.80, 0.77]
const HEAD_BG = [0.93, 0.94, 0.92]
const WHITE = [1, 1, 1]

export function buildMaterialPdf(rows, acuanEntries) {
  var data = rows || []
  var exportDate = formattedDate(dateStamp())
  var pages = []
  var page
  var y = 0
  // Kolom tabel: NO, KODE, NAMA, KATEGORI, SATUAN, STOK
  var cols = [24, 88, 226.28, 104, 44, 41]
  var tableX = PDF_MARGIN
  var tableW = PDF_W - PDF_MARGIN * 2

  function n(value) { return (Math.round(value * 100) / 100).toString() }
  function color(c, stroke) { return n(c[0]) + ' ' + n(c[1]) + ' ' + n(c[2]) + (stroke ? ' RG' : ' rg') }
  function cleanText(value) {
    return String(value == null ? '' : value)
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\u2026/g, '...')
      .replace(/[^\x20-\xFF]/g, '?')
  }
  function pdfString(value) {
    return cleanText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  }
  function textWidth(value, size, bold) {
    var factor = bold ? 0.55 : 0.50
    return cleanText(value).length * size * factor
  }
  function wrap(value, maxWidth, size, maxLines) {
    var words = cleanText(value).trim().split(/\s+/).filter(Boolean)
    if (!words.length) return ['']
    var lines = []
    var current = ''
    words.forEach(function (word) {
      var candidate = current ? current + ' ' + word : word
      if (textWidth(candidate, size, false) <= maxWidth || !current) current = candidate
      else { lines.push(current); current = word }
    })
    if (current) lines.push(current)
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines)
      lines[maxLines - 1] = lines[maxLines - 1].replace(/\.*$/, '') + '...'
    }
    return lines
  }
  function addPage() { page = []; pages.push(page) }
  function rect(x, top, w, h, fill, stroke, lineWidth) {
    var cmd = 'q '
    if (fill) cmd += color(fill, false) + ' '
    if (stroke) cmd += color(stroke, true) + ' ' + n(lineWidth || 0.6) + ' w '
    cmd += n(x) + ' ' + n(PDF_H - top - h) + ' ' + n(w) + ' ' + n(h) + ' re '
    cmd += fill && stroke ? 'B' : (fill ? 'f' : 'S')
    page.push(cmd + ' Q')
  }
  function rule(x1, top1, x2, top2, stroke, lineWidth) {
    page.push('q ' + color(stroke || LINE, true) + ' ' + n(lineWidth || 0.6) + ' w ' + n(x1) + ' ' + n(PDF_H - top1) + ' m ' + n(x2) + ' ' + n(PDF_H - top2) + ' l S Q')
  }
  function drawText(value, x, top, size, bold, fill, align, boxWidth, fontName) {
    var textValue = cleanText(value)
    var drawX = x
    if (align === 'right') drawX = x + boxWidth - textWidth(textValue, size, bold)
    if (align === 'center') drawX = x + (boxWidth - textWidth(textValue, size, bold)) / 2
    page.push('BT ' + color(fill || INK, false) + ' /' + (fontName || (bold ? 'F2' : 'F1')) + ' ' + n(size) + ' Tf ' + n(drawX) + ' ' + n(PDF_H - top - size) + ' Td (' + pdfString(textValue) + ') Tj ET')
  }
  function drawLines(lines, x, top, size, leading, bold, fill, align, boxWidth) {
    lines.forEach(function (lineText, index) { drawText(lineText, x, top + index * leading, size, bold, fill, align, boxWidth) })
  }
  function formattedDate(value) {
    if (!value) return '-'
    var parts = String(value).split('-')
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : value
  }

  function drawHeader(isContinuation) {
    if (isContinuation) {
      drawText('NOIR LIVING', PDF_MARGIN, 26, 9, true, NOIR)
      drawText('Master Material - LANJUTAN', PDF_MARGIN, 40, 11, true, INK)
      drawText('Diekspor: ' + exportDate + '  |  ' + ribuanTotal() + ' data', PDF_W - PDF_MARGIN - 240, 30, 7.5, true, MUTED, 'right', 240)
      rule(PDF_MARGIN, 52, PDF_W - PDF_MARGIN, 52, NOIR, 1.1)
      y = 64
      return
    }
    // Header blok Noir: hitam pekat + wordmark putih (tema Noir Living).
    rect(PDF_MARGIN, 30, tableW, 62, NOIR, null)
    drawText('n.', PDF_MARGIN + 18, 38, 20, true, WHITE)
    drawText('IR', PDF_MARGIN + 24, 61, 8.5, true, WHITE)
    drawText('NOIR LIVING', PDF_MARGIN + 62, 42, 12, true, WHITE)
    drawText('Interior Design & Build', PDF_MARGIN + 62, 60, 8.4, false, WHITE)
    drawText('MASTER MATERIAL', PDF_W - PDF_MARGIN - 210, 40, 12, true, WHITE, 'right', 200)
    drawText('Noir Living Indonesia', PDF_W - PDF_MARGIN - 210, 55, 7.6, false, WHITE, 'right', 200)
    // Baris info tanggal ekspor + jumlah data.
    y = 108
    drawText('TANGGAL EKSPOR', PDF_MARGIN, y, 7.5, true, MUTED)
    drawText(exportDate, PDF_MARGIN + 92, y, 8.5, true, INK)
    drawText('DATA', PDF_MARGIN + 250, y, 7.5, true, MUTED)
    drawText(ribuanTotal() + ' material', PDF_MARGIN + 285, y, 8.5, true, INK)
    y += 12
    rule(PDF_MARGIN, y, PDF_W - PDF_MARGIN, y, LINE, 0.7)
    y += 16

    function ribuanTotal() { return data.length.toLocaleString('id-ID') }
  }

  function drawTableHeader() {
    var labels = ['NO', 'KODE', 'NAMA MATERIAL', 'KATEGORI', 'SATUAN', 'STOK']
    var x = tableX
    rect(tableX, y, tableW, 22, HEAD_BG, NOIR, 0.8)
    labels.forEach(function (label, index) {
      if (index > 0) rule(x, y, x, y + 22, LINE, 0.45)
      drawText(label, x, y + 7, 7, true, INK, 'center', cols[index])
      x += cols[index]
    })
    y += 22
  }

  function ensureSpace(height, tableRequired) {
    if (y + height <= PDF_H - PDF_BOTTOM) return
    addPage()
    drawHeader(true)
    if (tableRequired) drawTableHeader()
  }

  function drawItemRow(r, index) {
    var nameLines = wrap(r?.name ?? '-', cols[2] - 10, 8, 3)
    var catLines = wrap(r?.category ?? '-', cols[3] - 10, 7.6, 3)
    var coreLines = Math.max(nameLines.length, catLines.length, 1)
    var rowHeight = Math.max(19, 8 + coreLines * 9.6)
    ensureSpace(rowHeight, true)
    var x = tableX
    rect(tableX, y, tableW, rowHeight, index % 2 ? HEAD_BG : null, LINE, 0.45)
    cols.slice(0, -1).forEach(function (width) { x += width; rule(x, y, x, y + rowHeight, LINE, 0.4) })
    drawText(index + 1, tableX, y + 6, 7.6, true, MUTED, 'center', cols[0])
    drawText(r?.kode ?? '-', tableX + cols[0], y + 6, 7.6, true, INK)
    drawLines(nameLines, tableX + cols[0] + cols[1] + 5, y + 6, 8, 9.6, false, INK)
    drawLines(catLines, tableX + cols[0] + cols[1] + cols[2] + 5, y + 6, 7.6, 9.6, false, INK)
    var satuanX = tableX + cols[0] + cols[1] + cols[2] + cols[3]
    drawText(cleanText(materialUnit(r)) || '-', satuanX, y + 6, 7.6, false, INK, 'center', cols[4])
    var stokX = satuanX + cols[4]
    var stokVal = (r?.current_stock === null || r?.current_stock === undefined || r?.current_stock === '')
      ? '-' : stokTextCsv(r.current_stock)
    drawText(stokVal, stokX + 3, y + 6, 7.6, true, INK, 'right', cols[5] - 6)
    y += rowHeight
  }

  function buildPdfBinary() {
    pages.forEach(function (commands, index) {
      commands.push('BT ' + color(MUTED, false) + ' /F1 6.5 Tf ' + n(PDF_MARGIN) + ' 22 Td (' + pdfString('Noir Living  |  Master Material  |  Diekspor ' + exportDate) + ') Tj ET')
      commands.push('BT ' + color(MUTED, false) + ' /F1 6.5 Tf ' + n(PDF_W - PDF_MARGIN - 70) + ' 22 Td (' + pdfString('Page ' + (index + 1) + ' / ' + pages.length) + ') Tj ET')
    })
    var objects = []
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
    var kids = []
    pages.forEach(function (_, index) { kids.push((7 + index * 2) + ' 0 R') })
    objects[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>'
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
    pages.forEach(function (commands, index) {
      var pageId = 7 + index * 2
      var contentId = pageId + 1
      var stream = commands.join('\n')
      objects[pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PDF_W + ' ' + PDF_H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + contentId + ' 0 R >>'
      objects[contentId] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream'
    })
    var binary = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
    var offsets = [0]
    for (var i = 1; i < objects.length; i += 1) {
      offsets[i] = binary.length
      binary += i + ' 0 obj\n' + objects[i] + '\nendobj\n'
    }
    var xref = binary.length
    binary += 'xref\n0 ' + objects.length + '\n0000000000 65535 f \n'
    for (var j = 1; j < objects.length; j += 1) binary += String(offsets[j]).padStart(10, '0') + ' 00000 n \n'
    binary += 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF'
    var bytes = new Uint8Array(binary.length)
    for (var k = 0; k < binary.length; k += 1) bytes[k] = binary.charCodeAt(k) & 255
    return bytes
  }

  // Render: header → tabel (atau empty state jelas) → biner.
  addPage()
  drawHeader(false)
  drawTableHeader()
  if (!data.length) {
    ensureSpace(30, true)
    rect(tableX, y, tableW, 30, null, LINE, 0.5)
    drawText('Belum ada data material.', tableX, y + 10, 8, false, MUTED, 'center', tableW)
    y += 30
  } else {
    data.forEach(function (r, index) { drawItemRow(r, index) })
  }
  return buildPdfBinary()
}

// ============================================================
// DOWNLOAD HELPER (browser-only) — pola sama dgn rab-boq/pdf.js
// ============================================================
export function downloadBlob(content, type, filename) {
  var blob = content instanceof Blob ? content : new Blob([content], { type: type })
  var url = URL.createObjectURL(blob)
  var link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// ============================================================
// TOMBOL TOOLBAR — dipasang shell ModuleView (page === 'materials')
// ============================================================
// rows = displayRows shell (filter/search/sort aktif, tanpa limit 10);
// acuanEntries = resolver acuan yang sama dgn UI expandable (t_090127ad).
// Fitur lain TIDAK disentuh: tombol ini tidak berinteraksi dgn state
// expand acuan / Show More / form — hanya membaca data + download.
export function MaterialExportButtons({ rows, acuanEntries }) {
  var data = rows || []
  var stamp = dateStamp()
  function exportCsv() {
    downloadBlob(buildMaterialCsv(data, acuanEntries), 'text/csv;charset=utf-8', 'Master_Material_' + stamp + '.csv')
  }
  function exportPdf() {
    downloadBlob(buildMaterialPdf(data, acuanEntries), 'application/pdf', 'Master_Material_' + stamp + '.pdf')
  }
  return (
    <>
      <button
        type="button"
        className="outline btn-export-module"
        onClick={exportCsv}
        title="Download data material (sesuai filter/pencarian aktif) sebagai CSV UTF-8 siap dibuka di Excel"
      >
        📥 Export CSV
      </button>
      <button
        type="button"
        className="outline btn-export-module"
        onClick={exportPdf}
        title="Download tabel material (sesuai filter/pencarian aktif) sebagai PDF A4 rapi bertema Noir"
      >
        📄 Export PDF
      </button>
    </>
  )
}
