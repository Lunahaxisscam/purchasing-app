// ============================================================
// modules/sales-invoice/pdf.js — NATIVE PDF BUILDER INVOICE PENJUALAN
// ============================================================
// Zero-dependency PDF-1.4 generator (A4) untuk Sales Invoice.
//
// ATURAN KEJUJURAN DOKUMEN (temuan review Brooklyn, S4):
//   Dokumen ini dipakai untuk menagih klien, jadi TIDAK BOLEH memuat data
//   perusahaan yang tidak terverifikasi. Versi sebelumnya MENCETAK:
//     - "Tel: +62 812-9900-8800 · www.noirliving.id"
//     - "Nomor Rekening: 527-189-9900 / Atas Nama: PT NOIR LIVING INDONESIA"
//     - "Bank Tujuan: Bank Central Asia (BCA)"
//   Tidak satu pun berasal dari data; itu karangan yang bisa membuat klien
//   mentransfer ke rekening yang salah. Semua dihapus.
//
//   Sekarang identitas penerbit & instruksi pembayaran HANYA dicetak bila
//   diberikan eksplisit lewat opsi `issuer` / `payment` (sumber terverifikasi
//   dari Settings). Bila tidak ada, dokumen mencetak penanda jujur
//   "BELUM DIISI" dan daftar field yang harus dilengkapi — bukan tebakan.
//
// Selain itu:
//   - invoice berstatus DRAFT / BATAL diberi watermark tegas supaya tidak
//     bisa dipakai sebagai tagihan sah tanpa sengaja;
//   - label PPN tidak lagi mengasumsikan 11% (tarif diambil dari record).
// ============================================================

export const PDF_ISSUER_FIELDS = Object.freeze(['legal_name', 'address', 'phone', 'email', 'website'])
export const PDF_PAYMENT_FIELDS = Object.freeze(['bank_name', 'account_number', 'account_holder'])

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
}

// Normalisasi data penerbit. Hanya field yang benar-benar terisi yang dipakai.
export function normalizeIssuer(issuer) {
  const src = issuer && typeof issuer === 'object' ? issuer : {}
  const out = {}
  for (const f of PDF_ISSUER_FIELDS) {
    const v = clean(src[f])
    if (v) out[f] = v
  }
  return out
}

export function normalizePayment(payment) {
  const src = payment && typeof payment === 'object' ? payment : {}
  const out = {}
  for (const f of PDF_PAYMENT_FIELDS) {
    const v = clean(src[f])
    if (v) out[f] = v
  }
  return out
}

// Daftar data yang MASIH KOSONG — dipakai UI untuk memberi tahu admin apa yang
// harus dilengkapi sebelum mengirim invoice ke klien.
export function missingIssuerFields(issuer) {
  const n = normalizeIssuer(issuer)
  return PDF_ISSUER_FIELDS.filter(f => !n[f])
}

export function missingPaymentFields(payment) {
  const n = normalizePayment(payment)
  return PDF_PAYMENT_FIELDS.filter(f => !n[f])
}

export function buildSalesInvoicePdf(invoice, opts = {}) {
  const PAGE_W = 595.28 // A4 width pt
  const PAGE_H = 841.89 // A4 height pt
  const MARGIN = 38
  const CONTENT_W = PAGE_W - MARGIN * 2

  const inv = invoice && typeof invoice === 'object' ? invoice : {}
  const issuer = normalizeIssuer(opts.issuer || inv.issuer)
  const payment = normalizePayment(opts.payment || inv.payment)
  const status = clean(inv.status).toUpperCase()
  const isDraft = status === 'DRAFT'
  const isVoid = status === 'BATAL'

  // Brand color palette (Noir Living Luxury Palette)
  const OLIVE_DARK = [0.22, 0.25, 0.19]
  const GOLD_BRASS = [0.72, 0.58, 0.18]
  const TEXT_MAIN = [0.12, 0.14, 0.12]
  const TEXT_MUTED = [0.42, 0.45, 0.40]
  const TEXT_WARN = [0.70, 0.30, 0.10]
  const LINE_COLOR = [0.82, 0.84, 0.80]
  const BG_PANEL = [0.96, 0.96, 0.94]
  const WHITE = [1, 1, 1]

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
    const cleanText = escapePdf(text)

    // approximate char width
    const approxW = cleanText.length * size * (bold ? 0.55 : 0.48)
    if (align === 'center' && boxW) {
      printX = x + Math.max(0, (boxW - approxW) / 2)
    } else if (align === 'right' && boxW) {
      printX = x + Math.max(0, boxW - approxW)
    }

    stream += 'BT\n'
    stream += `${font} ${size} Tf\n`
    stream += `${rgb(color)} rg\n`
    stream += `1 0 0 1 ${printX.toFixed(2)} ${pdfY.toFixed(2)} Tm\n`
    stream += `(${cleanText}) Tj\n`
    stream += 'ET\n'
  }

  function formatRp(val) {
    const n = Number(val) || 0
    return 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 0 })
  }

  // --- BEGIN PAGE 1 ---
  stream = ''

  // 1. TOP HEADER — hanya identitas yang benar-benar tersedia.
  rect(MARGIN, 36, CONTENT_W, 64, BG_PANEL, LINE_COLOR, 1)
  rect(MARGIN, 36, 6, 64, GOLD_BRASS)

  if (issuer.legal_name) {
    drawText(issuer.legal_name, MARGIN + 18, 48, 16, true, OLIVE_DARK)
  } else {
    drawText('IDENTITAS PENERBIT BELUM DIISI', MARGIN + 18, 48, 13, true, TEXT_WARN)
  }

  const issuerLine = [issuer.address, issuer.phone, issuer.email, issuer.website].filter(Boolean).join(' · ')
  if (issuerLine) {
    drawText(issuerLine, MARGIN + 18, 68, 8, false, TEXT_MUTED)
  } else {
    drawText(
      'Lengkapi nama badan usaha, alamat, kontak di Settings sebelum dokumen ini dikirim ke klien.',
      MARGIN + 18, 68, 8, false, TEXT_WARN
    )
  }
  if (issuerLine) {
    drawText('Dokumen ini diterbitkan dari data Settings yang terverifikasi.', MARGIN + 18, 81, 7.5, false, TEXT_MUTED)
  }

  // Big Title Right
  drawText('INVOICE', MARGIN + CONTENT_W - 140, 48, 22, true, GOLD_BRASS, 'right', 130)
  drawText('PENJUALAN', MARGIN + CONTENT_W - 140, 72, 10, true, OLIVE_DARK, 'right', 130)

  // Watermark status: draf / batal tidak boleh tampak seperti tagihan sah.
  if (isDraft || isVoid) {
    drawText(isVoid ? 'BATAL — TIDAK BERLAKU' : 'DRAF — BUKAN TAGIHAN SAH', PAGE_W / 2 - 200, 300, 34, true, [0.90, 0.90, 0.88], 'center', 400)
  }

  // 2. INVOICE META & CUSTOMER DETAILS
  const yMeta = 118
  rect(MARGIN, yMeta, CONTENT_W * 0.56, 100, [0.98, 0.98, 0.98], LINE_COLOR, 0.75)
  rect(MARGIN, yMeta, CONTENT_W * 0.56, 22, [0.93, 0.94, 0.91], LINE_COLOR, 0.75)
  drawText('TAGIHAN KEPADA (CUSTOMER CRM):', MARGIN + 12, yMeta + 6, 8, true, OLIVE_DARK)

  drawText(inv.customer_name || '—', MARGIN + 12, yMeta + 30, 11, true, TEXT_MAIN)
  if (inv.customer_phone) {
    drawText('Kontak: ' + inv.customer_phone, MARGIN + 12, yMeta + 46, 8.5, false, TEXT_MUTED)
  }
  if (inv.project_address) {
    drawText('Lokasi: ' + inv.project_address, MARGIN + 12, yMeta + 59, 8.5, false, TEXT_MUTED)
  }
  const projLabel = inv.project_code
    ? `Proyek: [${inv.project_code}] ${inv.project_name || ''}`
    : `Proyek: ${inv.project_name || '—'}`
  drawText(projLabel, MARGIN + 12, yMeta + 74, 9, true, OLIVE_DARK)

  // Right: Document Meta
  const metaX = MARGIN + CONTENT_W * 0.58
  const metaW = CONTENT_W * 0.42
  rect(metaX, yMeta, metaW, 100, [0.98, 0.98, 0.98], LINE_COLOR, 0.75)
  rect(metaX, yMeta, metaW, 22, [0.93, 0.94, 0.91], LINE_COLOR, 0.75)
  drawText('RINCIAN DOKUMEN:', metaX + 12, yMeta + 6, 8, true, OLIVE_DARK)

  drawText('No. Invoice:', metaX + 12, yMeta + 30, 8.5, false, TEXT_MUTED)
  drawText(inv.invoice_no || (isDraft ? '(draf — belum bernomor)' : '—'), metaX + 80, yMeta + 30, 9, true, TEXT_MAIN)

  drawText('Tanggal:', metaX + 12, yMeta + 46, 8.5, false, TEXT_MUTED)
  drawText(inv.issue_date || '—', metaX + 80, yMeta + 46, 8.5, false, TEXT_MAIN)

  drawText('Jatuh Tempo:', metaX + 12, yMeta + 61, 8.5, false, TEXT_MUTED)
  drawText(inv.due_date || '—', metaX + 80, yMeta + 61, 8.5, false, TEXT_MAIN)

  drawText('Ref. RAB / BOQ:', metaX + 12, yMeta + 76, 8.5, false, TEXT_MUTED)
  drawText(inv.rab_reff || '—', metaX + 80, yMeta + 76, 8.5, true, GOLD_BRASS)

  // 3. TABLE OF LINE ITEMS
  const yTable = 236
  const rowH = 26
  rect(MARGIN, yTable, CONTENT_W, 24, OLIVE_DARK)
  drawText('NO', MARGIN + 10, yTable + 7, 8, true, WHITE)
  drawText('DESKRIPSI PEKERJAAN & PENAWARAN', MARGIN + 40, yTable + 7, 8, true, WHITE)
  drawText('REFERENSI', MARGIN + 310, yTable + 7, 8, true, WHITE)
  drawText('JUMLAH (IDR)', MARGIN + CONTENT_W - 110, yTable + 7, 8, true, WHITE, 'right', 100)

  let curY = yTable + 24
  rect(MARGIN, curY, CONTENT_W, 36, [1, 1, 1], LINE_COLOR, 0.5)
  drawText('1', MARGIN + 12, curY + 12, 9, false, TEXT_MAIN)
  drawText(inv.project_name || 'Pekerjaan Interior & Fit-Out', MARGIN + 40, curY + 8, 9.5, true, TEXT_MAIN)
  drawText('Berdasarkan penawaran RAB / BOQ yang disetujui', MARGIN + 40, curY + 22, 7.5, false, TEXT_MUTED)
  drawText(inv.rab_reff || '—', MARGIN + 310, curY + 12, 8.5, false, TEXT_MUTED)
  drawText(formatRp(inv.nominal), MARGIN + CONTENT_W - 120, curY + 12, 9.5, true, TEXT_MAIN, 'right', 110)

  curY += 36
  rect(MARGIN, curY, CONTENT_W, 20, [0.99, 0.99, 0.99], LINE_COLOR, 0.5)
  curY += 20

  // 4. SUMMARY BOX
  const sumW = 220
  const sumX = MARGIN + CONTENT_W - sumW
  const sumY = curY + 12

  rect(sumX, sumY, sumW, 82, BG_PANEL, LINE_COLOR, 1)

  drawText('Subtotal Penawaran:', sumX + 12, sumY + 12, 8.5, false, TEXT_MUTED)
  drawText(formatRp(inv.nominal), sumX + sumW - 12, sumY + 12, 8.5, false, TEXT_MAIN, 'right', 110)

  // PPN: tarif diambil dari record; TIDAK mengasumsikan 11%.
  const taxAmount = Number(inv.tax_amount) || 0
  const taxRate = Number(inv.tax_rate) || 0
  if (taxAmount > 0) {
    drawText(`PPN (${taxRate}%):`, sumX + 12, sumY + 28, 8.5, false, TEXT_MUTED)
    drawText(formatRp(taxAmount), sumX + sumW - 12, sumY + 28, 8.5, false, TEXT_MAIN, 'right', 110)
  } else {
    drawText('PPN:', sumX + 12, sumY + 28, 8.5, false, TEXT_MUTED)
    drawText('Tidak dipungut', sumX + sumW - 12, sumY + 28, 8.5, false, TEXT_MUTED, 'right', 110)
  }

  rect(sumX, sumY + 48, sumW, 34, OLIVE_DARK)
  drawText('TOTAL TAGIHAN:', sumX + 12, sumY + 58, 9, true, GOLD_BRASS)
  drawText(formatRp(inv.grand_total || inv.nominal), sumX + sumW - 12, sumY + 57, 12, true, WHITE, 'right', 140)

  // 5. PAYMENT INSTRUCTIONS — hanya rekening yang benar-benar terdaftar.
  const payX = MARGIN
  const payW = CONTENT_W - sumW - 18
  const payY = sumY
  rect(payX, payY, payW, 82, [0.98, 0.98, 0.98], LINE_COLOR, 0.75)
  rect(payX, payY, payW, 20, [0.93, 0.94, 0.91], LINE_COLOR, 0.75)
  drawText('INSTRUKSI PEMBAYARAN:', payX + 10, payY + 5, 8, true, OLIVE_DARK)

  const hasPayment = payment.bank_name && payment.account_number
  if (hasPayment) {
    drawText(`Bank: ${payment.bank_name}`, payX + 10, payY + 26, 8.5, true, TEXT_MAIN)
    drawText(`No. Rekening: ${payment.account_number}`, payX + 10, payY + 39, 9.5, true, GOLD_BRASS)
    if (payment.account_holder) {
      drawText(`Atas Nama: ${payment.account_holder}`, payX + 10, payY + 52, 8.5, true, TEXT_MAIN)
    }
  } else {
    drawText('DATA REKENING BELUM DIISI', payX + 10, payY + 26, 9, true, TEXT_WARN)
    drawText('Lengkapi data rekening penerima di Settings', payX + 10, payY + 39, 7.5, false, TEXT_MUTED)
    drawText('sebelum dokumen ini dikirim ke klien.', payX + 10, payY + 49, 7.5, false, TEXT_MUTED)
  }
  if (inv.payment_terms) {
    drawText('Termin: ' + inv.payment_terms, payX + 10, payY + 64, 7.5, false, TEXT_MUTED)
  }
  drawText('* Cantumkan No. Invoice pada berita transfer.', payX + 10, payY + 74, 7, false, TEXT_MUTED)

  // 6. NOTES & SIGNATURE
  const yBottom = payY + 98
  rect(MARGIN, yBottom, payW, 90, [0.99, 0.99, 0.99], LINE_COLOR, 0.5)
  drawText('CATATAN / KETENTUAN:', MARGIN + 10, yBottom + 8, 8, true, OLIVE_DARK)
  drawText('1. Dokumen ini menagih pekerjaan sesuai penawaran RAB/BOQ yang disetujui.', MARGIN + 10, yBottom + 24, 7.5, false, TEXT_MUTED)
  drawText('2. Pembayaran dinyatakan sah setelah dana diterima & diverifikasi admin.', MARGIN + 10, yBottom + 36, 7.5, false, TEXT_MUTED)
  drawText('3. Status dokumen: ' + (status || '—'), MARGIN + 10, yBottom + 48, 7.5, false, TEXT_MUTED)
  if (inv.notes) {
    drawText('Catatan Khusus: ' + inv.notes, MARGIN + 10, yBottom + 64, 8, true, TEXT_MAIN)
  }

  // Signature Block Right
  const sigX = sumX
  const sigY = yBottom
  rect(sigX, sigY, sumW, 90, [1, 1, 1], LINE_COLOR, 0.5)
  drawText('Hormat Kami,', sigX + sumW / 2, sigY + 12, 8.5, false, TEXT_MUTED, 'center', 100)
  drawText(issuer.legal_name || '—', sigX + sumW / 2, sigY + 24, 8.5, true, OLIVE_DARK, 'center', 140)
  rect(sigX + 24, sigY + 68, sumW - 48, 1, LINE_COLOR)
  drawText('Authorized Signature', sigX + sumW / 2, sigY + 74, 8, false, TEXT_MUTED, 'center', 120)

  // Footer
  drawText('Dokumen ID: ' + (inv.invoice_no || inv.id || 'DRAFT'), MARGIN, PAGE_H - 24, 7, false, TEXT_MUTED)

  pageStreams.push(stream)

  // --- SERIALIZE PDF 1.4 ---
  function buildPdfBinary() {
    let binary = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
    const pageObjIds = []

    // Pass 1: hitung ID objek (dipakai untuk referensi /Contents).
    const pageCount = pageStreams.length
    const contentIds = []
    for (let i = 0; i < pageCount; i++) contentIds.push(5 + i * 2)

    const newOffsets = []
    binary = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'

    function addObjFinal(content) {
      newOffsets.push(binary.length)
      binary += `${newOffsets.length} 0 obj\n${content}\nendobj\n`
    }

    addObjFinal('<< /Type /Catalog /Pages 2 0 R >>')
    const pagesBody = `<< /Type /Pages /Kids [${contentIds.map(id => `${id + 1} 0 R`).join(' ')}] /Count ${pageCount} >>`
    addObjFinal(pagesBody)
    addObjFinal('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    addObjFinal('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

    pageStreams.forEach((pStream, i) => {
      const streamLen = pStream.length
      const sId = newOffsets.length + 1
      addObjFinal(`<< /Length ${streamLen} >>\nstream\n${pStream}\nendstream`)
      addObjFinal(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ` +
        `/Contents ${sId} 0 R >>`
      )
      pageObjIds.push(sId)
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
  a.download = filename || 'Sales_Invoice.pdf'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
