// ============================================================
// modules/sales-invoice/pdf.js — NATIVE PDF BUILDER INVOICE PENJUALAN
// ============================================================
// Zero-dependency PDF-1.4 binary generator untuk Sales Invoice Noir Living.
// Memproduksi dokumen A4 standar berformat profesional dengan kop resmi,
// rincian penawaran RAB, identitas customer CRM, nomor proyek resmi,
// dan instruksi pembayaran bank.
// ============================================================

export function buildSalesInvoicePdf(invoice) {
  const PAGE_W = 595.28 // A4 width pt
  const PAGE_H = 841.89 // A4 height pt
  const MARGIN = 38
  const CONTENT_W = PAGE_W - MARGIN * 2

  // Brand color palette (Noir Living Luxury Palette)
  const OLIVE_DARK = [0.22, 0.25, 0.19]
  const OLIVE_ACCENT = [0.45, 0.48, 0.35]
  const GOLD_BRASS = [0.72, 0.58, 0.18]
  const TEXT_MAIN = [0.12, 0.14, 0.12]
  const TEXT_MUTED = [0.42, 0.45, 0.40]
  const LINE_COLOR = [0.82, 0.84, 0.80]
  const BG_PANEL = [0.96, 0.96, 0.94]
  const WHITE = [1, 1, 1]

  const objects = []
  let pageStreams = []
  let stream = ''

  function escapePdf(text) {
    return String(text || '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
  }

  function rgb(color) {
    return `${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)}`
  }

  function rect(x, y, w, h, fill = null, stroke = null, lineWidth = 1) {
    const pdfY = PAGE_H - y - h
    stream += 'q\n'
    if (fill) stream += `${rgb(fill)} rg\n`
    if (stroke) {
      stream += `${rgb(stroke)} RG\n`
      stream += `${lineWidth} w\n`
    }
    stream += `${x.toFixed(2)} ${pdfY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re\n`
    if (fill && stroke) stream += 'B\n'
    else if (fill) stream += 'f\n'
    else if (stroke) stream += 'S\n'
    stream += 'Q\n'
  }

  function drawText(text, x, y, size = 10, bold = false, color = TEXT_MAIN, align = 'left', boxW = null) {
    const pdfY = PAGE_H - y - size
    const font = bold ? '/F2' : '/F1'
    let printX = x
    const clean = escapePdf(text)

    // approximate char width
    const approxW = clean.length * size * (bold ? 0.55 : 0.48)
    if (align === 'center' && boxW) {
      printX = x + Math.max(0, (boxW - approxW) / 2)
    } else if (align === 'right' && boxW) {
      printX = x + Math.max(0, boxW - approxW)
    }

    stream += 'BT\n'
    stream += `${font} ${size} Tf\n`
    stream += `${rgb(color)} rg\n`
    stream += `1 0 0 1 ${printX.toFixed(2)} ${pdfY.toFixed(2)} Tm\n`
    stream += `(${clean}) Tj\n`
    stream += 'ET\n'
  }

  function formatRp(val) {
    const n = Number(val) || 0
    return 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 0 })
  }

  // --- BEGIN PAGE 1 ---
  stream = ''

  // 1. TOP HEADER BRANDING
  rect(MARGIN, 36, CONTENT_W, 64, BG_PANEL, LINE_COLOR, 1)

  // Brass accent line
  rect(MARGIN, 36, 6, 64, GOLD_BRASS)

  // Company Name & Subtitle
  drawText('NOIR LIVING ATELIER', MARGIN + 18, 48, 16, true, OLIVE_DARK)
  drawText('Interior Architecture & Luxury Living Solutions', MARGIN + 18, 68, 8.5, false, TEXT_MUTED)
  drawText('Studio: Jakarta, Indonesia · Tel: +62 812-9900-8800 · www.noirliving.id', MARGIN + 18, 81, 7.5, false, TEXT_MUTED)

  // Big Title Right
  drawText('INVOICE', MARGIN + CONTENT_W - 140, 48, 22, true, GOLD_BRASS, 'right', 130)
  drawText('PENJUALAN', MARGIN + CONTENT_W - 140, 72, 10, true, OLIVE_DARK, 'right', 130)

  // 2. INVOICE META & CUSTOMER DETAILS
  const yMeta = 118
  // Left: Bill To
  rect(MARGIN, yMeta, CONTENT_W * 0.56, 100, [0.98, 0.98, 0.98], LINE_COLOR, 0.75)
  rect(MARGIN, yMeta, CONTENT_W * 0.56, 22, [0.93, 0.94, 0.91], LINE_COLOR, 0.75)
  drawText('TAGIHAN KEPADA (CUSTOMER CRM):', MARGIN + 12, yMeta + 6, 8, true, OLIVE_DARK)

  drawText(invoice.customer_name || '—', MARGIN + 12, yMeta + 30, 11, true, TEXT_MAIN)
  if (invoice.customer_phone) {
    drawText('Kontak: ' + invoice.customer_phone, MARGIN + 12, yMeta + 46, 8.5, false, TEXT_MUTED)
  }
  if (invoice.project_address) {
    drawText('Lokasi: ' + invoice.project_address, MARGIN + 12, yMeta + 59, 8.5, false, TEXT_MUTED)
  }
  const projLabel = invoice.project_code
    ? `Proyek: [${invoice.project_code}] ${invoice.project_name || ''}`
    : `Proyek: ${invoice.project_name || '—'}`
  drawText(projLabel, MARGIN + 12, yMeta + 74, 9, true, OLIVE_DARK)

  // Right: Document Meta
  const metaX = MARGIN + CONTENT_W * 0.58
  const metaW = CONTENT_W * 0.42
  rect(metaX, yMeta, metaW, 100, [0.98, 0.98, 0.98], LINE_COLOR, 0.75)
  rect(metaX, yMeta, metaW, 22, [0.93, 0.94, 0.91], LINE_COLOR, 0.75)
  drawText('RINCIAN DOKUMEN:', metaX + 12, yMeta + 6, 8, true, OLIVE_DARK)

  drawText('No. Invoice:', metaX + 12, yMeta + 30, 8.5, false, TEXT_MUTED)
  drawText(invoice.invoice_no || '—', metaX + 80, yMeta + 30, 9, true, TEXT_MAIN)

  drawText('Tanggal:', metaX + 12, yMeta + 46, 8.5, false, TEXT_MUTED)
  drawText(invoice.issue_date || '—', metaX + 80, yMeta + 46, 8.5, false, TEXT_MAIN)

  drawText('Jatuh Tempo:', metaX + 12, yMeta + 61, 8.5, false, TEXT_MUTED)
  drawText(invoice.due_date || '30 Hari', metaX + 80, yMeta + 61, 8.5, false, TEXT_MAIN)

  drawText('Ref. RAB / BOQ:', metaX + 12, yMeta + 76, 8.5, false, TEXT_MUTED)
  drawText(invoice.rab_reff || 'BOQ Disetujui', metaX + 80, yMeta + 76, 8.5, true, GOLD_BRASS)

  // 3. TABLE OF LINE ITEMS
  const yTable = 236
  const rowH = 26
  // Table Header
  rect(MARGIN, yTable, CONTENT_W, 24, OLIVE_DARK)
  drawText('NO', MARGIN + 10, yTable + 7, 8, true, WHITE)
  drawText('DESKRIPSI PEKERJAAN & PENAWARAN', MARGIN + 40, yTable + 7, 8, true, WHITE)
  drawText('REFERENSI', MARGIN + 310, yTable + 7, 8, true, WHITE)
  drawText('JUMLAH (IDR)', MARGIN + CONTENT_W - 110, yTable + 7, 8, true, WHITE, 'right', 100)

  // Item 1: Main Project Contract from RAB
  let curY = yTable + 24
  rect(MARGIN, curY, CONTENT_W, 36, [1, 1, 1], LINE_COLOR, 0.5)
  drawText('1', MARGIN + 12, curY + 12, 9, false, TEXT_MAIN)
  drawText(invoice.project_name || 'Pekerjaan Interior & Fit-Out Sesuai Penawaran Disetujui', MARGIN + 40, curY + 8, 9.5, true, TEXT_MAIN)
  drawText('Berdasarkan Rincian Penawaran RAB / Dokumen Desain Atelier', MARGIN + 40, curY + 22, 7.5, false, TEXT_MUTED)
  drawText(invoice.rab_reff || 'BOQ-001', MARGIN + 310, curY + 12, 8.5, false, TEXT_MUTED)
  drawText(formatRp(invoice.nominal), MARGIN + CONTENT_W - 120, curY + 12, 9.5, true, TEXT_MAIN, 'right', 110)

  curY += 36

  // Optional empty line for neat spacing
  rect(MARGIN, curY, CONTENT_W, 20, [0.99, 0.99, 0.99], LINE_COLOR, 0.5)
  curY += 20

  // 4. SUMMARY BOX
  const sumW = 220
  const sumX = MARGIN + CONTENT_W - sumW
  const sumY = curY + 12

  rect(sumX, sumY, sumW, 82, BG_PANEL, LINE_COLOR, 1)

  drawText('Subtotal Penawaran:', sumX + 12, sumY + 12, 8.5, false, TEXT_MUTED)
  drawText(formatRp(invoice.nominal), sumX + sumW - 12, sumY + 12, 8.5, false, TEXT_MAIN, 'right', 110)

  if (invoice.tax_amount && invoice.tax_amount > 0) {
    drawText(`PPN (${invoice.tax_rate || 11}%):`, sumX + 12, sumY + 28, 8.5, false, TEXT_MUTED)
    drawText(formatRp(invoice.tax_amount), sumX + sumW - 12, sumY + 28, 8.5, false, TEXT_MAIN, 'right', 110)
  } else {
    drawText('Pajak / PPN:', sumX + 12, sumY + 28, 8.5, false, TEXT_MUTED)
    drawText('Termasuk', sumX + sumW - 12, sumY + 28, 8.5, false, TEXT_MUTED, 'right', 110)
  }

  // Grand Total Highlight
  rect(sumX, sumY + 48, sumW, 34, OLIVE_DARK)
  drawText('TOTAL TAGIHAN:', sumX + 12, sumY + 58, 9, true, GOLD_BRASS)
  drawText(formatRp(invoice.grand_total || invoice.nominal), sumX + sumW - 12, sumY + 57, 12, true, WHITE, 'right', 140)

  // 5. PAYMENT INSTRUCTIONS (Left of summary)
  const payX = MARGIN
  const payW = CONTENT_W - sumW - 18
  const payY = sumY
  rect(payX, payY, payW, 82, [0.98, 0.98, 0.98], LINE_COLOR, 0.75)
  rect(payX, payY, payW, 20, [0.93, 0.94, 0.91], LINE_COLOR, 0.75)
  drawText('INSTRUKSI PEMBAYARAN TRANSFER BANK:', payX + 10, payY + 5, 8, true, OLIVE_DARK)

  drawText('Bank Tujuan: Bank Central Asia (BCA)', payX + 10, payY + 26, 8.5, true, TEXT_MAIN)
  drawText('Nomor Rekening: 527-189-9900', payX + 10, payY + 39, 9.5, true, GOLD_BRASS)
  drawText('Atas Nama: PT NOIR LIVING INDONESIA', payX + 10, payY + 52, 8.5, true, TEXT_MAIN)
  drawText('* Cantumkan No. Invoice pada berita transfer dan kirimkan bukti pembayaran.', payX + 10, payY + 66, 7.5, false, TEXT_MUTED)

  // 6. NOTES & SIGNATURE
  const yBottom = payY + 98
  rect(MARGIN, yBottom, payW, 90, [0.99, 0.99, 0.99], LINE_COLOR, 0.5)
  drawText('CATATAN / TERMS & CONDITIONS:', MARGIN + 10, yBottom + 8, 8, true, OLIVE_DARK)
  drawText('1. Dokumen ini adalah tagihan resmi dari penawaran RAB yang telah disetujui.', MARGIN + 10, yBottom + 24, 7.5, false, TEXT_MUTED)
  drawText('2. Penerbitan invoice ini memvalidasi pendaftaran Nomor Proyek Resmi di Master Project.', MARGIN + 10, yBottom + 36, 7.5, false, TEXT_MUTED)
  drawText('3. Pelaksanaan pekerjaan proyek dimulai sesuai dengan jadwal dan termin yang disepakati.', MARGIN + 10, yBottom + 48, 7.5, false, TEXT_MUTED)
  if (invoice.notes) {
    drawText('Catatan Khusus: ' + invoice.notes, MARGIN + 10, yBottom + 64, 8, true, TEXT_MAIN)
  }

  // Signature Block Right
  const sigX = sumX
  const sigY = yBottom
  rect(sigX, sigY, sumW, 90, [1, 1, 1], LINE_COLOR, 0.5)
  drawText('Hormat Kami,', sigX + sumW / 2, sigY + 12, 8.5, false, TEXT_MUTED, 'center', 100)
  drawText('PT NOIR LIVING INDONESIA', sigX + sumW / 2, sigY + 24, 8.5, true, OLIVE_DARK, 'center', 140)

  // Signature line
  rect(sigX + 24, sigY + 68, sumW - 48, 1, LINE_COLOR)
  drawText('Direksi / Authorized Signature', sigX + sumW / 2, sigY + 74, 8, false, TEXT_MUTED, 'center', 120)

  // Footer stamp
  drawText('Noir Living Atelier · Generated by Hermes Agent System · Document ID: ' + (invoice.id || 'NL-INV'), MARGIN, PAGE_H - 24, 7, false, TEXT_MUTED)

  pageStreams.push(stream)

  // --- SERIALIZE PDF 1.4 ---
  function buildPdfBinary() {
    let binary = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
    const objOffsets = []

    function addObj(content) {
      objOffsets.push(binary.length)
      binary += `${objOffsets.length} 0 obj\n${content}\nendobj\n`
      return objOffsets.length
    }

    // 1: Catalog
    addObj('<< /Type /Catalog /Pages 2 0 R >>')

    // 2: Pages (placeholder, filled below)
    const pagesObjIdx = 2
    objOffsets.push(binary.length)
    binary += '2 0 obj\n' // will be overwritten later via index
    const pagesPos = binary.length - '2 0 obj\n'.length

    // 3 & 4: Fonts (Helvetica & Helvetica-Bold)
    addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

    // 5+: Page and Content streams
    const pageObjIds = []
    pageStreams.forEach(pStream => {
      const streamLen = pStream.length
      const streamObjId = addObj(`<< /Length ${streamLen} >>\nstream\n${pStream}\nendstream`)
      const pageObjId = addObj(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
        `/Contents ${streamObjId} 0 R >>`
      )
      pageObjIds.push(pageObjId)
    })

    // Now update Pages object
    const pagesBody = `<< /Type /Pages /Kids [${pageObjIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`
    // Reconstruct binary with correct Pages obj
    binary = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
    const newOffsets = []

    function addObjFinal(content) {
      newOffsets.push(binary.length)
      binary += `${newOffsets.length} 0 obj\n${content}\nendobj\n`
    }

    addObjFinal('<< /Type /Catalog /Pages 2 0 R >>')
    addObjFinal(pagesBody)
    addObjFinal('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    addObjFinal('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

    pageStreams.forEach(pStream => {
      const streamLen = pStream.length
      const sId = newOffsets.length + 1
      addObjFinal(`<< /Length ${streamLen} >>\nstream\n${pStream}\nendstream`)
      addObjFinal(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
        `/Contents ${sId} 0 R >>`
      )
    })

    const xrefOffset = binary.length
    binary += `xref\n0 ${newOffsets.length + 1}\n0000000000 65535 f \n`
    for (let i = 0; i < newOffsets.length; i++) {
      binary += `${String(newOffsets[i]).padStart(10, '0')} 00000 n \n`
    }
    binary += `trailer\n<< /Size ${newOffsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) & 255
    }
    return bytes
  }

  return buildPdfBinary()
}

export function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'Sales_Invoice_Noir_Living.pdf'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
