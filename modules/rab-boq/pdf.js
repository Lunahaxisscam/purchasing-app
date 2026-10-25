// ============================================================
// modules/rab-boq/pdf.js — PORT PDF BINARY BUILDER dari source HTML
// ============================================================
// buildBoqPdf() disalin dari source line 947-1220 dengan adaptasi minimal:
//  - parameter (payload, items) bukan DOM; totals dihitung via calcTotals()
//    (fungsi inti calculateTotals line 854-872 — angka identik).
//  - `download(bytes, ...)` dipisah: fungsi ini MENGEMBALIKAN Uint8Array;
//    caller (view.jsx) yang memanggil downloadBlob().
//  - fontName param pada drawText dipertahankan (F3/F4 Times utk notes).
// TIDAK ada perubahan layout/warna/teks PDF.
// ============================================================
import { num, calcCostArea, calcCostPart, calcItem, breakdownTotal, effectivePrice, calcTotals, thousand, rupiahFromK } from './boqCalc'

export function buildBoqPdf(payload, items) {
  var totals = calcTotals({
    items: items,
    marginMode: payload.marginMode,
    marginRate: payload.marginRate,
    discountType: payload.discountType,
    adjustmentEnabled: payload.adjustmentEnabled,
    taxEnabled: payload.taxEnabled,
    taxRate: payload.taxRate
  })
  var PAGE_W = 595.28
  var PAGE_H = 841.89
  var MARGIN = 34
  var BOTTOM = 48
  var OLIVE = [0.588, 0.608, 0.486]
  var OLIVE_DARK = [0.239, 0.267, 0.208]
  var OLIVE_SOFT = [0.906, 0.914, 0.871]
  var INK = [0.125, 0.145, 0.122]
  var MUTED = [0.400, 0.439, 0.392]
  var LINE = [0.745, 0.769, 0.714]
  var WHITE = [1, 1, 1]
  var pages = []
  var page
  var y = 0
  var cols = [22, 84, 58, 140, 35, 36, 65, 87.28]
  var tableX = MARGIN
  var tableW = PAGE_W - MARGIN * 2

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
      if (textWidth(candidate, size, false) <= maxWidth || !current) {
        current = candidate
      } else {
        lines.push(current)
        current = word
      }
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
    cmd += n(x) + ' ' + n(PAGE_H - top - h) + ' ' + n(w) + ' ' + n(h) + ' re '
    cmd += fill && stroke ? 'B' : (fill ? 'f' : 'S')
    page.push(cmd + ' Q')
  }
  function rule(x1, top1, x2, top2, stroke, lineWidth) {
    page.push('q ' + color(stroke || LINE, true) + ' ' + n(lineWidth || 0.6) + ' w ' + n(x1) + ' ' + n(PAGE_H - top1) + ' m ' + n(x2) + ' ' + n(PAGE_H - top2) + ' l S Q')
  }
  function drawText(value, x, top, size, bold, fill, align, boxWidth, fontName) {
    var textValue = cleanText(value)
    var drawX = x
    if (align === 'right') drawX = x + boxWidth - textWidth(textValue, size, bold)
    if (align === 'center') drawX = x + (boxWidth - textWidth(textValue, size, bold)) / 2
    page.push('BT ' + color(fill || INK, false) + ' /' + (fontName || (bold ? 'F2' : 'F1')) + ' ' + n(size) + ' Tf ' + n(drawX) + ' ' + n(PAGE_H - top - size) + ' Td (' + pdfString(textValue) + ') Tj ET')
  }
  function drawLines(lines, x, top, size, leading, bold, fill, align, boxWidth, fontName) {
    lines.forEach(function (lineText, index) { drawText(lineText, x, top + index * leading, size, bold, fill, align, boxWidth, fontName) })
  }
  function field(label, value, x, top, width, height, maxLines) {
    rect(x, top, width, height, null, LINE, 0.5)
    drawText(label.toUpperCase(), x + 7, top + 5, 6.2, true, MUTED)
    var valueLines = wrap(value || '-', width - 14, 8.5, maxLines || 2)
    drawLines(valueLines, x + 7, top + 16, 8.5, 10, true, INK)
  }
  function formattedDate(value) {
    if (!value) return '-'
    var parts = String(value).split('-')
    return parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : value
  }
  function drawDocumentHeader(isContinuation) {
    if (isContinuation) {
      drawText('Noir Living', MARGIN, 26, 10, true, OLIVE_DARK)
      drawText('BUILD ON QUANTITY - CONTINUED', MARGIN, 42, 13, true, INK)
      drawText((payload.boqReff || '-') + '  |  ' + (payload.revisionNumber || '-'), PAGE_W - MARGIN - 220, 31, 8, true, MUTED, 'right', 220)
      rule(MARGIN, 61, PAGE_W - MARGIN, 61, OLIVE_DARK, 1.2)
      y = 76
      return
    }
    rect(MARGIN, 28, tableW, 82, OLIVE, null)
    drawText('n.', MARGIN + 20, 48, 24, true, WHITE)
    drawText('IR', MARGIN + 27, 72, 11, true, WHITE)
    drawText('Interior Design & Build', MARGIN + 78, 57, 12, true, WHITE)
    var titleBlockX = PAGE_W - MARGIN - 300
    var titleBlockWidth = 280
    drawText('NOIR LIVING', titleBlockX, 42, 8, true, WHITE, 'right', titleBlockWidth)
    drawText('Interior Design & Build', titleBlockX, 53, 7.5, false, WHITE, 'right', titleBlockWidth)
    drawText('Build On Quantity', titleBlockX, 66, 20, true, WHITE, 'right', titleBlockWidth)
    drawText(payload.revisionNumber || 'REV00', titleBlockX, 94, 7.5, true, WHITE, 'right', titleBlockWidth)

    var leftWidth = tableW * 0.58
    var rightWidth = tableW - leftWidth
    var infoTop = 122
    var infoRowHeight = 30
    field('Customer Name', payload.clientName, MARGIN, infoTop, leftWidth, infoRowHeight, 1)
    field('Project Reff No', payload.projectReffNo, MARGIN + leftWidth, infoTop, rightWidth, infoRowHeight, 1)
    field('Project Location', payload.projectLocation, MARGIN, infoTop + infoRowHeight, leftWidth, infoRowHeight, 1)
    field('BOQ Reff', payload.boqReff, MARGIN + leftWidth, infoTop + infoRowHeight, rightWidth, infoRowHeight, 1)
    field('Project Name', payload.projectName, MARGIN, infoTop + infoRowHeight * 2, leftWidth, infoRowHeight, 1)
    field('Quotation Date', formattedDate(payload.estimateDate), MARGIN + leftWidth, infoTop + infoRowHeight * 2, rightWidth, infoRowHeight, 1)
    drawText('in thousand IDR (000)', MARGIN, 226, 8, true, OLIVE_DARK)
    y = 244
  }
  function drawTableHeader() {
    var labels = ['NO', 'ITEM', 'AREA', 'GENERAL SPECS.', 'Vol', 'MEA', 'PRICE', 'TOTAL']
    var x = tableX
    rect(tableX, y, tableW, 25, OLIVE_SOFT, OLIVE_DARK, 0.8)
    labels.forEach(function (label, index) {
      if (index > 0) rule(x, y, x, y + 25, LINE, 0.45)
      drawText(label, x, y + 8, 6.8, true, INK, 'center', cols[index])
      x += cols[index]
    })
    y += 25
  }
  function startContentPage(isContinuation) {
    addPage()
    drawDocumentHeader(isContinuation)
    drawTableHeader()
  }
  function ensureSpace(height, tableRequired) {
    if (y + height <= PAGE_H - BOTTOM) return
    addPage()
    drawDocumentHeader(true)
    if (tableRequired) drawTableHeader()
  }
  function drawItemRow(item, index) {
    var itemLines = wrap(item.item || '-', cols[1] - 10, 7.6, 5)
    var areaLines = wrap(item.area || '-', cols[2] - 10, 7.4, 5)
    var specLines = wrap(item.specs || '-', cols[3] - 10, 7.4, 6)
    var coreLines = Math.max(itemLines.length, areaLines.length, specLines.length, 1)
    var coreHeight = Math.max(24, 10 + coreLines * 9)
    var rowHeight = coreHeight
    ensureSpace(rowHeight, true)
    var x = tableX
    rect(tableX, y, tableW, rowHeight, null, LINE, 0.5)
    cols.slice(0, -1).forEach(function (width) { x += width; rule(x, y, x, y + coreHeight, LINE, 0.4) })
    drawText(index + 1, tableX, y + 9, 7.2, true, MUTED, 'center', cols[0])
    var starts = [tableX + cols[0], tableX + cols[0] + cols[1], tableX + cols[0] + cols[1] + cols[2]]
    drawLines(itemLines, starts[0] + 5, y + 7, 7.6, 9, true, INK)
    drawLines(areaLines, starts[1] + 5, y + 7, 7.4, 9, false, INK)
    drawLines(specLines, starts[2] + 5, y + 7, 7.4, 9, false, INK)
    var numericX = tableX + cols[0] + cols[1] + cols[2] + cols[3]
    drawText(thousand(num(item.qty)), numericX + 3, y + 9, 7.2, false, INK, 'right', cols[4] - 6)
    numericX += cols[4]
    drawText(item.unit || '-', numericX, y + 9, 7.2, false, INK, 'center', cols[5])
    numericX += cols[5]
    drawText(thousand(effectivePrice(item)), numericX + 3, y + 9, 7.2, false, INK, 'right', cols[6] - 6)
    numericX += cols[6]
    drawText(thousand(calcItem(item)), numericX + 3, y + 9, 7.2, true, OLIVE_DARK, 'right', cols[7] - 6)
    y += rowHeight
  }
  function drawNotes() {
    if (!payload.activeNotes || !payload.activeNotes.length) return
    function notesHeading(continued) {
      drawText(continued ? 'NOTES - CONTINUED' : 'NOTES', MARGIN, y, 7.5, true, OLIVE_DARK, null, null, 'F4')
      rule(MARGIN, y + 12, PAGE_W - MARGIN, y + 12, OLIVE_DARK, 0.7)
      y += 19
    }
    ensureSpace(40, false)
    y += 14
    notesHeading(false)
    payload.activeNotes.forEach(function (note, index) {
      var lines = wrap(note, tableW - 30, 6.3)
      var noteHeight = Math.max(16, lines.length * 8 + 6)
      if (y + noteHeight > PAGE_H - BOTTOM) {
        addPage()
        drawDocumentHeader(true)
        notesHeading(true)
      }
      drawText((index + 1) + '.', MARGIN + 2, y + 2, 6.3, true, OLIVE_DARK, null, null, 'F4')
      drawLines(lines, MARGIN + 22, y + 2, 6.3, 8, false, MUTED, null, null, 'F3')
      y += noteHeight
    })
  }
  function drawSummary() {
    var summaryHeight = 116
    ensureSpace(summaryHeight + 20, false)
    y += 16
    var width = 268
    var x = PAGE_W - MARGIN - width
    var rowH = 20
    var profitLabel = payload.marginMode === 'gross' ? 'Gross margin' : (payload.marginMode === 'discount' ? 'Discount' : 'Markup')
    var rows = [['Work total', totals.base]]
    var showAdjustment = payload.showAdjustmentPdf === true
    var showTax = payload.taxEnabled === true
    if (showAdjustment && Math.abs(totals.margin) > 0.000001) {
      var usesNominalAdjustment = payload.marginMode !== 'gross' && payload.discountType === 'nominal'
      var adjustmentLabel = usesNominalAdjustment ? profitLabel + ' (' + rupiahFromK(Math.abs(totals.margin)) + ')' : profitLabel + ' (' + thousand(payload.marginRate) + '%)'
      rows.push([adjustmentLabel, totals.margin])
    }
    if (showTax) rows.push(['PPN (' + thousand(payload.taxRate) + '%)', totals.tax])
    rows.forEach(function (entry, index) {
      rect(x, y + index * rowH, width, rowH, index % 2 ? OLIVE_SOFT : null, LINE, 0.45)
      drawText(entry[0], x + 8, y + index * rowH + 6, 7.6, index === 0, INK)
      drawText('Rp' + thousand(entry[1] * 1000), x + 8, y + index * rowH + 6, 7.6, true, INK, 'right', width - 16)
    })
    var grandTop = y + rows.length * rowH
    rect(x, grandTop, width, 38, OLIVE_DARK, null)
    drawText('QUOTATION TOTAL', x + 8, grandTop + 7, 7.2, true, WHITE)
    drawText(rupiahFromK(totals.grand), x + 8, grandTop + 19, 12.5, true, WHITE, 'right', width - 16)
    y = grandTop + 38
    drawText('Prices are shown in full IDR in the summary.', x, y + 6, 6.5, false, MUTED, 'right', width)
  }
  function buildPdfBinary() {
    pages.forEach(function (commands, index) {
      commands.push('BT ' + color(MUTED, false) + ' /F1 6.5 Tf ' + n(MARGIN) + ' 22 Td (' + pdfString('Noir Living  |  ' + (payload.boqReff || 'BOQ')) + ') Tj ET')
      commands.push('BT ' + color(MUTED, false) + ' /F1 6.5 Tf ' + n(PAGE_W - MARGIN - 70) + ' 22 Td (' + pdfString('Page ' + (index + 1) + ' / ' + pages.length) + ') Tj ET')
    })
    var objects = []
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
    var kids = []
    pages.forEach(function (_, index) { kids.push((7 + index * 2) + ' 0 R') })
    objects[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>'
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
    objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>'
    objects[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>'
    pages.forEach(function (commands, index) {
      var pageId = 7 + index * 2
      var contentId = pageId + 1
      var stream = commands.join('\n')
      objects[pageId] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ' + contentId + ' 0 R >>'
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

  startContentPage(false)
  if (!items.length) {
    ensureSpace(34, true)
    rect(tableX, y, tableW, 34, null, LINE, 0.5)
    drawText('No work items yet.', tableX, y + 12, 8, false, MUTED, 'center', tableW)
    y += 34
  } else {
    items.forEach(function (item, index) { drawItemRow(item, index) })
  }
  drawNotes()
  drawSummary()
  return buildPdfBinary()
}

// Download helper browser-only (source line 933-943). Dipanggil dari view.
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
