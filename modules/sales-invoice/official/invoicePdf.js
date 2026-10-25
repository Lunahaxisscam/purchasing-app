/**
 * Noir invoice PDF renderer (A4 portrait).
 *
 * Produces a real PDF file (no window.print of the dashboard). Layout follows
 * the reference workbook tabs "Inv DP" / "Inv T2" / "Inv T3":
 *   olive brand band with the Noir mark, BILL TO block, Invoice Date / No on
 *   the right, a No / Desc / Qty / Mea / Price / Amount table, payment
 *   schedule, Total / Tax Rate / Grand Total, Transfer via block, signature.
 *
 * Long descriptions wrap and rows paginate with the table header repeated, so
 * no item is ever sliced off. Totals and payment instructions are pushed to a
 * fresh page when they do not fit.
 */

import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { COLUMNS, CELL_PAD, CONTENT_WIDTH, PAGE, PALETTE } from './layout.js';
import { computeTotals, formatDateShort } from './model.js';
import { formatQty, formatRate, formatRupiah, parseDecimalToScaled, SCALES } from './money.js';
import { wrapText } from './layout.js';

const FONT_SIZE = {
  bandTitle: 19,
  bandMeta: 8,
  label: 9.5,
  body: 9,
  tableHead: 8.6,
  cell: 8.6,
  cellNote: 7.6,
  small: 7.6,
  totalLabel: 9,
  totalValue: 10,
  watermark: 78,
};

const ROW_PAD_Y = 5.2;
const LINE_GAP = 1.35;

const color = (c) => rgb(c[0], c[1], c[2]);

function asText(value) {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * @param {object} params
 * @param {object} params.invoice normalised invoice
 * @param {Uint8Array} params.logoBytes JPEG bytes of the Noir mark
 * @param {Uint8Array} params.fontRegular TTF bytes (Carlito/Calibri metrics)
 * @param {Uint8Array} params.fontBold TTF bytes
 * @param {'final'|'draft'|'sample'} [params.mode]
 * @param {string} [params.watermark] explicit watermark text
 * @param {Date} [params.now] fixed timestamp for reproducible output
 * @returns {Promise<{bytes: Uint8Array, pageCount: number, warnings: string[]}>}
 */
export async function buildInvoicePdf({
  invoice,
  logoBytes,
  fontRegular,
  fontBold,
  mode = 'draft',
  watermark,
  now = new Date(),
}) {
  if (!invoice) throw new Error('invoice wajib diisi');
  if (!fontRegular || !fontBold) throw new Error('font PDF tidak tersedia');

  const totals = computeTotals(invoice);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontRegular, { subset: false });
  const bold = await doc.embedFont(fontBold, { subset: false });
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const logo = logoBytes ? await doc.embedJpg(logoBytes) : null;

  const mark = watermark ?? (mode === 'draft' ? 'DRAF' : mode === 'sample' ? 'CONTOH' : null);
  const warnings = [];

  const brand = color(PALETTE.brand);
  const ink = color(PALETTE.ink);
  const inkSoft = color(PALETTE.inkSoft);
  const rule = color(PALETTE.rule);
  const ruleLight = color(PALETTE.ruleLight);
  const white = color(PALETTE.white);
  const placeholder = color(PALETTE.placeholder);
  const warn = color(PALETTE.warn);

  const footerReserve = 46;
  const pages = [];

  function addPage() {
    const page = doc.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    drawWatermark(page); // behind all content
    return page;
  }

  let page = addPage();
  let y = 0;

  const bandHeight = 96;

  function drawBand(target) {
    target.drawRectangle({
      x: 0,
      y: PAGE.height - bandHeight,
      width: PAGE.width,
      height: bandHeight,
      color: brand,
    });
    if (logo) {
      const size = 62;
      target.drawImage(logo, {
        x: PAGE.marginX,
        y: PAGE.height - bandHeight / 2 - size / 2,
        width: size,
        height: size,
      });
    }
    const rightX = PAGE.width - PAGE.marginX;
    const title = 'INVOICE';
    const titleWidth = bold.widthOfTextAtSize(title, FONT_SIZE.bandTitle);
    target.drawText(title, {
      x: rightX - titleWidth,
      y: PAGE.height - 34,
      size: FONT_SIZE.bandTitle,
      font: bold,
      color: white,
    });

    let metaY = PAGE.height - 50;
    const issuerName = asText(invoice.issuer?.name).trim();
    const issuerAddr = asText(invoice.issuer?.address).trim();
    const issuerContact = asText(invoice.issuer?.contact).trim();
    if (issuerName) {
      const line = fitLine(issuerName, bold, FONT_SIZE.bandMeta, CONTENT_WIDTH * 0.55);
      target.drawText(line.text, {
        x: rightX - line.width,
        y: metaY,
        size: FONT_SIZE.bandMeta,
        font: bold,
        color: white,
      });
      metaY -= 11;
    }
    for (const chunk of [issuerAddr, issuerContact]) {
      if (!chunk) continue;
      const line = fitLine(chunk, font, FONT_SIZE.bandMeta - 0.4, CONTENT_WIDTH * 0.55);
      target.drawText(line.text, {
        x: rightX - line.width,
        y: metaY,
        size: FONT_SIZE.bandMeta - 0.4,
        font,
        color: white,
      });
      metaY -= 10;
    }
    return PAGE.height - bandHeight;
  }

  function fitLine(value, fnt, size, maxWidth) {
    const raw = asText(value).replace(/\s+/g, ' ').trim();
    if (fnt.widthOfTextAtSize(raw, size) <= maxWidth) {
      return { text: raw, width: fnt.widthOfTextAtSize(raw, size) };
    }
    let lo = 0;
    let hi = raw.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fnt.widthOfTextAtSize(`${raw.slice(0, mid)}…`, size) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    const clipped = `${raw.slice(0, lo)}…`;
    return { text: clipped, width: fnt.widthOfTextAtSize(clipped, size) };
  }

  function drawFooter(target, pageIndex, totalPages) {
    const yLine = PAGE.marginBottom - 12;
    target.drawLine({
      start: { x: PAGE.marginX, y: yLine + 12 },
      end: { x: PAGE.width - PAGE.marginX, y: yLine + 12 },
      thickness: 0.6,
      color: ruleLight,
    });
    const left = asText(invoice.invoiceNo).trim() ? `Invoice ${asText(invoice.invoiceNo).trim()}` : 'Tanpa nomor invoice (draf)';
    target.drawText(fitLine(left, font, 7.2, CONTENT_WIDTH * 0.5).text, {
      x: PAGE.marginX,
      y: yLine,
      size: 7.2,
      font,
      color: inkSoft,
    });
    const right = `Halaman ${pageIndex + 1} dari ${totalPages}`;
    const w = font.widthOfTextAtSize(right, 7.2);
    target.drawText(right, {
      x: PAGE.width - PAGE.marginX - w,
      y: yLine,
      size: 7.2,
      font,
      color: inkSoft,
    });
  }

  function drawWatermark(target) {
    if (!mark) return;
    const text = String(mark).toUpperCase();
    const size = FONT_SIZE.watermark;
    const width = bold.widthOfTextAtSize(text, size);
    const angle = 32;
    const rad = (angle * Math.PI) / 180;
    const cx = PAGE.width / 2;
    const cy = PAGE.height / 2;
    target.drawText(text, {
      x: cx - (width / 2) * Math.cos(rad),
      y: cy - (width / 2) * Math.sin(rad) - size * 0.35,
      size,
      font: bold,
      color: brand,
      opacity: 0.12,
      rotate: degrees(angle),
    });
  }

  function drawContinuationHeader(target, pageNo) {
    const h = 34;
    target.drawRectangle({ x: 0, y: PAGE.height - h, width: PAGE.width, height: h, color: brand });
    if (logo) {
      target.drawImage(logo, { x: PAGE.marginX, y: PAGE.height - h + 5, width: 24, height: 24 });
    }
    const left = 'INVOICE';
    target.drawText(left, {
      x: PAGE.marginX + 32,
      y: PAGE.height - h + 12,
      size: 11,
      font: bold,
      color: white,
    });
    const no = asText(invoice.invoiceNo).trim();
    const right = no ? `No. ${no}` : 'Draf tanpa nomor';
    const w = font.widthOfTextAtSize(right, 8);
    target.drawText(right, {
      x: PAGE.width - PAGE.marginX - w,
      y: PAGE.height - h + 13,
      size: 8,
      font,
      color: white,
    });
    return PAGE.height - h - 6;
  }

  // ---------------------------------------------------------------- page 1
  y = drawBand(page);

  // "DRAF"/"CONTOH" chip so the document status is unmistakable.
  if (mark) {
    const label = mode === 'sample' ? 'CONTOH — DATA SINTETIS, BUKAN TAGIHAN NYATA' : 'DRAF — BELUM DOKUMEN FINAL';
    const size = 7.4;
    const w = bold.widthOfTextAtSize(label, size) + 12;
    const h = 15;
    page.drawRectangle({
      x: PAGE.width - PAGE.marginX - w,
      y: y - h - 10,
      width: w,
      height: h,
      color: mode === 'sample' ? warn : brand,
      opacity: mode === 'sample' ? 0.92 : 0.85,
    });
    page.drawText(label, {
      x: PAGE.width - PAGE.marginX - w + 6,
      y: y - h - 10 + 4.4,
      size,
      font: bold,
      color: white,
    });
  }

  y -= 30;

  // ------------------------------------------------------------ bill to block
  const labelX = PAGE.marginX;
  const valueX = PAGE.marginX + 74;
  const valueWidth = CONTENT_WIDTH * 0.52 - 74;
  const rightX = PAGE.width - PAGE.marginX;

  page.drawText('BILL TO', { x: labelX, y, size: 10, font: bold, color: ink });
  y -= 15;

  const ownerLines = wrapText(asText(invoice.billTo?.projectOwner).trim() || '—', bold, FONT_SIZE.body, valueWidth);
  const addrLines = wrapText(asText(invoice.billTo?.address).trim() || '—', font, FONT_SIZE.body, valueWidth);

  const ownerLabelY = y;
  page.drawText('Project Owner:', { x: labelX, y, size: FONT_SIZE.label, font: bold, color: ink });
  let ownerY = y;
  ownerLines.forEach((line, i) => {
    page.drawText(line, { x: valueX, y: ownerY - i * (FONT_SIZE.body + LINE_GAP), size: FONT_SIZE.body, font: bold, color: ink });
  });
  const ownerBlockHeight = Math.max(1, ownerLines.length) * (FONT_SIZE.body + LINE_GAP);

  const addrLabelY = ownerLabelY - ownerBlockHeight - 4;
  page.drawText('Address:', { x: labelX, y: addrLabelY, size: FONT_SIZE.label, font: bold, color: ink });
  addrLines.forEach((line, i) => {
    page.drawText(line, {
      x: valueX,
      y: addrLabelY - i * (FONT_SIZE.body + LINE_GAP),
      size: FONT_SIZE.body,
      font,
      color: ink,
    });
  });

  // Right column: Invoice Date / Invoice No (source G10/I10, G11/I11).
  // Each label+value pair is right-aligned as a unit so the block reads as a
  // tight column against the page margin instead of a scattered two-column gap.
  const dateText = formatDateShort(invoice.invoiceDate) || '—';
  const noText = asText(invoice.invoiceNo).trim() || '—';
  function drawMetaRow(label, value, rowY, muted = false) {
    const valueWidth = font.widthOfTextAtSize(value, FONT_SIZE.body);
    page.drawText(value, {
      x: rightX - valueWidth,
      y: rowY,
      size: FONT_SIZE.body,
      font: muted ? font : font,
      color: muted ? placeholder : ink,
    });
    page.drawText(label, {
      x: rightX - valueWidth - 8 - bold.widthOfTextAtSize(label, FONT_SIZE.label),
      y: rowY,
      size: FONT_SIZE.label,
      font: bold,
      color: ink,
    });
  }
  drawMetaRow('Invoice Date:', dateText, ownerLabelY);
  drawMetaRow('Invoice No:', noText, ownerLabelY - 15);
  if (invoice.dueDate) drawMetaRow('Due Date:', formatDateShort(invoice.dueDate), ownerLabelY - 30);

  const leftBlockBottom = addrLabelY - Math.max(1, addrLines.length) * (FONT_SIZE.body + LINE_GAP);
  y = Math.min(leftBlockBottom, ownerLabelY - 34) - 16;

  // --------------------------------------------------------------- table head
  const headHeight = 19;

  function drawTableHead(target, topY) {
    target.drawRectangle({
      x: PAGE.marginX,
      y: topY - headHeight,
      width: CONTENT_WIDTH,
      height: headHeight,
      color: brand,
    });
    const baseline = topY - headHeight + 6;
    target.drawText('No', { x: COLUMNS.no.x + CELL_PAD, y: baseline, size: FONT_SIZE.tableHead, font: bold, color: white });
    target.drawText('Desc', { x: COLUMNS.desc.x + CELL_PAD, y: baseline, size: FONT_SIZE.tableHead, font: bold, color: white });
    const qtyText = 'Qty';
    target.drawText(qtyText, {
      x: COLUMNS.qty.x + COLUMNS.qty.width / 2 - bold.widthOfTextAtSize(qtyText, FONT_SIZE.tableHead) / 2,
      y: baseline,
      size: FONT_SIZE.tableHead,
      font: bold,
      color: white,
    });
    const meaText = 'Mea';
    target.drawText(meaText, {
      x: COLUMNS.unit.x + COLUMNS.unit.width / 2 - bold.widthOfTextAtSize(meaText, FONT_SIZE.tableHead) / 2,
      y: baseline,
      size: FONT_SIZE.tableHead,
      font: bold,
      color: white,
    });
    const priceText = 'Price';
    target.drawText(priceText, {
      x: COLUMNS.price.x + COLUMNS.price.width - CELL_PAD - bold.widthOfTextAtSize(priceText, FONT_SIZE.tableHead),
      y: baseline,
      size: FONT_SIZE.tableHead,
      font: bold,
      color: white,
    });
    const amountText = 'Amount';
    target.drawText(amountText, {
      x: COLUMNS.amount.x + COLUMNS.amount.width - CELL_PAD - bold.widthOfTextAtSize(amountText, FONT_SIZE.tableHead),
      y: baseline,
      size: FONT_SIZE.tableHead,
      font: bold,
      color: white,
    });
    return topY - headHeight;
  }

  y = drawTableHead(page, y);

  // ------------------------------------------------------------------- rows
  const descWidth = COLUMNS.desc.width - CELL_PAD * 2;
  const noteFont = font;
  const rows = totals.lines.filter((line) => !line.blank);
  let rowNumber = 0;

  const ensureSpace = (needed, { tableHead = true } = {}) => {
    if (y - needed >= footerReserve) return false;
    page = addPage();
    y = drawContinuationHeader(page, pages.length);
    if (tableHead) y = drawTableHead(page, y);
    return true;
  };

  if (rows.length === 0) {
    ensureSpace(26);
    page.drawText('Belum ada baris invoice.', {
      x: COLUMNS.desc.x + CELL_PAD,
      y: y - 14,
      size: FONT_SIZE.cell,
      font: italic,
      color: placeholder,
    });
    page.drawLine({
      start: { x: PAGE.marginX, y: y - 24 },
      end: { x: PAGE.marginX + CONTENT_WIDTH, y: y - 24 },
      thickness: 0.6,
      color: ruleLight,
    });
    y -= 24;
  }

  for (const row of rows) {
    rowNumber += 1;
    const descLines = wrapText(row.desc, font, FONT_SIZE.cell, descWidth);
    const noteLines = row.note ? wrapText(row.note, noteFont, FONT_SIZE.cellNote, descWidth) : [];
    const qtyText = row.qtyScaled === null ? asText(invoice.lines[row.index]?.qty) : formatQty(row.qtyScaled);
    const priceText = row.unitPrice === null ? asText(invoice.lines[row.index]?.unitPrice) : formatRupiah(row.unitPrice);
    const amountText = row.amount === null ? '—' : formatRupiah(row.amount);
    const descStep = FONT_SIZE.cell + LINE_GAP;
    const noteStep = FONT_SIZE.cellNote + LINE_GAP;
    const headerRoom = ROW_PAD_Y * 2 + descStep; // first chunk needs at least this

    // A row taller than a whole page (a very long unbroken description) is
    // split across pages in chunks instead of overflowing off the bottom.
    let descCursor = 0;
    let noteCursor = 0;
    let firstChunk = true;
    let guard = 0;

    while (descCursor < descLines.length || noteCursor < noteLines.length || firstChunk) {
      guard += 1;
      if (guard > 200) throw new Error('pagination guard tripped');

      const available = y - footerReserve;
      const maxDescLines = Math.max(0, Math.floor((available - ROW_PAD_Y * 2 - (firstChunk ? 0 : 0)) / descStep));
      const remainingDesc = descLines.length - descCursor;
      const remainingNote = noteLines.length - noteCursor;

      // Everything fits: draw the whole row and stop.
      const wholeHeight = ROW_PAD_Y * 2 + Math.max(1, remainingDesc) * descStep + remainingNote * noteStep;
      if (available >= wholeHeight && (descCursor === 0 && noteCursor === 0)) {
        drawRowChunk({
          descChunk: descLines,
          noteChunk: noteLines,
          qtyText,
          priceText,
          amountText,
          topY: y,
          height: wholeHeight,
          showMeta: true,
          rowNumber,
          unitText: row.unit || '',
        });
        y -= wholeHeight;
        break;
      }

      if (available < headerRoom) {
        page = addPage();
        y = drawContinuationHeader(page, pages.length);
        y = drawTableHead(page, y);
        firstChunk = false;
        continue;
      }

      // Take as many description lines as fit, keeping room for notes if any.
      let takeDesc = Math.min(remainingDesc, Math.max(1, maxDescLines));
      if (remainingDesc === 0 && remainingNote > 0) takeDesc = 0;
      let budgetLines = available - ROW_PAD_Y * 2 - takeDesc * descStep;
      let takeNote = Math.min(remainingNote, Math.max(0, Math.floor(budgetLines / noteStep)));
      if (takeDesc === 0 && takeNote === 0) takeNote = 1;

      const descChunk = descLines.slice(descCursor, descCursor + takeDesc);
      const noteChunk = noteLines.slice(noteCursor, noteCursor + takeNote);
      const height = ROW_PAD_Y * 2 + Math.max(1, descChunk.length) * descStep + noteChunk.length * noteStep;

      drawRowChunk({
        descChunk,
        noteChunk,
        qtyText,
        priceText,
        amountText,
        topY: y,
        height,
        showMeta: firstChunk,
        rowNumber,
        unitText: row.unit || '',
        continued: !firstChunk,
      });
      y -= height;
      descCursor += takeDesc;
      noteCursor += takeNote;
      firstChunk = false;

      if (descCursor >= descLines.length && noteCursor >= noteLines.length) break;

      // More of this row to draw: continue on the next page.
      page = addPage();
      y = drawContinuationHeader(page, pages.length);
      y = drawTableHead(page, y);
    }
  }

  function drawRowChunk({
    descChunk,
    noteChunk,
    qtyText,
    priceText,
    amountText,
    topY,
    height,
    showMeta,
    rowNumber: num,
    unitText = '',
    continued = false,
  }) {
    const baseline = topY - ROW_PAD_Y - FONT_SIZE.cell;
    const numText = continued ? `${num} cont.` : String(num);
    page.drawText(numText, {
      x: COLUMNS.no.x + COLUMNS.no.width / 2 - font.widthOfTextAtSize(numText, FONT_SIZE.cell) / 2,
      y: baseline,
      size: FONT_SIZE.cell,
      font,
      color: continued ? inkSoft : ink,
    });

    descChunk.forEach((line, i) => {
      page.drawText(line, {
        x: COLUMNS.desc.x + CELL_PAD,
        y: baseline - i * (FONT_SIZE.cell + LINE_GAP),
        size: FONT_SIZE.cell,
        font,
        color: ink,
      });
    });
    let noteBaseline = baseline - Math.max(1, descChunk.length) * (FONT_SIZE.cell + LINE_GAP);
    noteChunk.forEach((line) => {
      page.drawText(line, {
        x: COLUMNS.desc.x + CELL_PAD,
        y: noteBaseline,
        size: FONT_SIZE.cellNote,
        font: noteFont,
        color: inkSoft,
      });
      noteBaseline -= FONT_SIZE.cellNote + LINE_GAP;
    });

    if (showMeta) {
      const centerIn = (col, text) =>
        col.x + col.width / 2 - font.widthOfTextAtSize(text, FONT_SIZE.cell) / 2;
      page.drawText(qtyText, {
        x: centerIn(COLUMNS.qty, qtyText),
        y: baseline,
        size: FONT_SIZE.cell,
        font,
        color: ink,
      });
      page.drawText(unitText, {
        x: centerIn(COLUMNS.unit, unitText),
        y: baseline,
        size: FONT_SIZE.cell,
        font,
        color: ink,
      });
      page.drawText(priceText, {
        x: COLUMNS.price.x + COLUMNS.price.width - CELL_PAD - font.widthOfTextAtSize(priceText, FONT_SIZE.cell),
        y: baseline,
        size: FONT_SIZE.cell,
        font,
        color: ink,
      });
      page.drawText(amountText, {
        x: COLUMNS.amount.x + COLUMNS.amount.width - CELL_PAD - font.widthOfTextAtSize(amountText, FONT_SIZE.cell),
        y: baseline,
        size: FONT_SIZE.cell,
        font,
        color: ink,
      });
    } else {
      // Continuation chunk: the row number is suffixed with "↳" above, so no
      // extra label is needed (and none would fit without overlapping text).
    }

    page.drawLine({
      start: { x: PAGE.marginX, y: topY - height },
      end: { x: PAGE.marginX + CONTENT_WIDTH, y: topY - height },
      thickness: 0.5,
      color: ruleLight,
    });
  }

  // Project reference line — mirrors the source "for project ..." line (B15).
  const projectRef = asText(invoice.billTo?.projectRef).trim();
  if (projectRef) {
    const lines = wrapText(`for project ${projectRef}`, font, FONT_SIZE.cellNote, CONTENT_WIDTH - 40);
    ensureSpace(lines.length * 10 + 12, { tableHead: false });
    let py = y - 10;
    lines.forEach((line) => {
      page.drawText(line, { x: PAGE.marginX + 8, y: py, size: FONT_SIZE.cellNote, font, color: inkSoft });
      py -= FONT_SIZE.cellNote + LINE_GAP;
    });
    y = py - 2;
  }

  // ------------------------------------------------------- summary + payment
  const summaryLabelX = COLUMNS.price.x;
  const summaryValueRight = COLUMNS.right;

  const schedule = invoice.paymentSchedule || {};
  const scheduleLines = [];
  if (schedule.enabled) {
    const totalProject = asText(schedule.totalProject).trim();
    if (totalProject) scheduleLines.push({ text: `Total Project: IDR ${totalProject}`, bold: false });
    (schedule.terms || []).forEach((term, idx) => {
      const amount = asText(term.amount).trim();
      const label = asText(term.label).trim() || `Term ${idx + 1}`;
      const percent = asText(term.percent).trim();
      if (!amount && !percent && !asText(term.label).trim()) return;
      const pct = percent ? ` (${percent}%)` : '';
      scheduleLines.push({ text: `${label}${pct}: IDR ${amount || '—'}`, bold: false });
    });
  }

  const taxRateText = (() => {
    if (!invoice.tax?.enabled) return null;
    if (invoice.tax.mode === 'amount') return null;
    const scaled = parseDecimalToScaled(invoice.tax.rate, SCALES.rate);
    return scaled === null ? asText(invoice.tax.rate) : `${formatRate(scaled)}%`;
  })();

  // Source rows H27 "Total", H28 "Tax Rate", H29 "Grand Total". The tax row
  // carries the rate in its label and the computed tax as its value so the
  // reader never sees the same rate printed twice.
  const taxRowLabel = (() => {
    if (!totals.taxEnabled) return 'Tax Rate';
    if (totals.taxLabel) return totals.taxLabel;
    return taxRateText ? `Tax Rate (${taxRateText})` : 'Tax Rate';
  })();
  const summaryRows = [{ label: 'Total', value: formatRupiah(totals.total), strong: false }];
  summaryRows.push({
    label: taxRowLabel,
    value: totals.taxEnabled ? formatRupiah(totals.tax) : '0%',
    strong: false,
  });
  summaryRows.push({ label: 'Grand Total', value: formatRupiah(totals.grandTotal), strong: true });

  const transferVia = asText(invoice.payment?.transferVia).trim();
  const bankLines = asText(invoice.payment?.bankLines).trim();
  const instructions = asText(invoice.payment?.instructions).trim();
  const notes = asText(invoice.notes).trim();
  const signerName = asText(invoice.signature?.signerName).trim();
  const signerTitle = asText(invoice.signature?.signerTitle).trim();

  const bankWrap = bankLines ? wrapText(bankLines, font, FONT_SIZE.small, CONTENT_WIDTH * 0.6) : [];
  const instrWrap = instructions ? wrapText(instructions, font, FONT_SIZE.small, CONTENT_WIDTH * 0.7) : [];
  const notesWrap = notes ? wrapText(notes, font, FONT_SIZE.small, CONTENT_WIDTH * 0.78) : [];
  const scheduleWrapCount = scheduleLines.reduce(
    (acc, line) => acc + Math.max(1, wrapText(line.text, font, FONT_SIZE.small, COLUMNS.price.x - PAGE.marginX - 8).length),
    0,
  );

  // Everything from the totals block to the signature is drawn as one closing
  // group: it either fits on the current page or moves to a fresh one, so the
  // grand total is never orphaned from its payment instructions.
  const closingHeight = (() => {
    const summaryH = summaryRows.length * 16 + 8;
    const scheduleH = scheduleLines.length ? scheduleWrapCount * (FONT_SIZE.small + 2.4) + 18 : 0;
    let h = Math.max(summaryH, scheduleH) + 22;
    h += 20; // transfer chip
    h += bankWrap.length ? bankWrap.length * (FONT_SIZE.small + 2.4) : FONT_SIZE.small + 2.4;
    if (instructions) h += 4 + instrWrap.length * (FONT_SIZE.small + 2.4);
    if (notes) h += 16 + notesWrap.length * (FONT_SIZE.small + 2.4);
    h += 78; // signature block
    return h;
  })();

  ensureSpace(closingHeight, { tableHead: false });
  const blockTop = y;

  if (scheduleLines.length) {
    let sy = blockTop - 12;
    page.drawText('Payment Schedule:', { x: PAGE.marginX, y: sy, size: FONT_SIZE.label, font: bold, color: ink });
    sy -= 14;
    scheduleLines.forEach((line) => {
      const wrapped = wrapText(line.text, font, FONT_SIZE.small, COLUMNS.price.x - PAGE.marginX - 8);
      wrapped.forEach((wl) => {
        page.drawText(wl, { x: PAGE.marginX + 4, y: sy, size: FONT_SIZE.small, font, color: inkSoft });
        sy -= FONT_SIZE.small + 2.4;
      });
    });
  }

  let ty = blockTop - 12;
  summaryRows.forEach((row) => {
    const isStrong = row.strong;
    const size = isStrong ? FONT_SIZE.totalValue : FONT_SIZE.totalLabel;
    const fnt = isStrong ? bold : font;
    const labelW = fnt.widthOfTextAtSize(row.label, size);
    page.drawText(row.label, {
      x: summaryLabelX + COLUMNS.price.width - CELL_PAD - labelW,
      y: ty,
      size,
      font: fnt,
      color: ink,
    });
    const valueText = fitLine(row.value, fnt, size, COLUMNS.amount.width - CELL_PAD * 2).text;
    page.drawText(valueText, {
      x: summaryValueRight - CELL_PAD - fnt.widthOfTextAtSize(valueText, size),
      y: ty,
      size,
      font: fnt,
      color: ink,
    });
    if (isStrong) {
      page.drawLine({
        start: { x: summaryLabelX, y: ty + 9 },
        end: { x: summaryValueRight, y: ty + 9 },
        thickness: 0.9,
        color: rule,
      });
      page.drawLine({
        start: { x: summaryLabelX, y: ty - 5 },
        end: { x: summaryValueRight, y: ty - 5 },
        thickness: 0.9,
        color: rule,
      });
    }
    ty -= isStrong ? 20 : 15;
  });

  const summaryBottom = blockTop - Math.max(summaryRows.length * 16 + 8, scheduleWrapCount * (FONT_SIZE.small + 2.4) + 18) - 10;

  // ------------------------------------------------------- transfer + notes
  let py = summaryBottom - 8;

  // Olive label chip like cell B28 in the source ("Transfer via" on FF959676).
  const chipText = 'Transfer via';
  const chipW = bold.widthOfTextAtSize(chipText, 8.2) + 12;
  page.drawRectangle({ x: PAGE.marginX, y: py - 3, width: chipW, height: 14, color: brand });
  page.drawText(chipText, { x: PAGE.marginX + 6, y: py + 1.2, size: 8.2, font: bold, color: white });
  const viaText = transferVia || '__________________';
  page.drawText(viaText, {
    x: PAGE.marginX + chipW + 8,
    y: py + 1.2,
    size: FONT_SIZE.small,
    font: bold,
    color: transferVia ? ink : placeholder,
  });
  py -= 16;

  if (bankWrap.length) {
    bankWrap.forEach((line) => {
      page.drawText(line, { x: PAGE.marginX + 4, y: py, size: FONT_SIZE.small, font, color: ink });
      py -= FONT_SIZE.small + 2.4;
    });
  } else {
    page.drawText('(rekening belum diisi — bukan rekening contoh)', {
      x: PAGE.marginX + 4,
      y: py,
      size: FONT_SIZE.small - 0.4,
      font: italic,
      color: placeholder,
    });
    py -= FONT_SIZE.small + 2.4;
  }

  if (instrWrap.length) {
    py -= 4;
    instrWrap.forEach((line) => {
      page.drawText(line, { x: PAGE.marginX + 4, y: py, size: FONT_SIZE.small, font, color: inkSoft });
      py -= FONT_SIZE.small + 2.4;
    });
  }

  if (notesWrap.length) {
    py -= 10;
    page.drawText('Catatan:', { x: PAGE.marginX, y: py, size: 8.2, font: bold, color: ink });
    py -= 12;
    notesWrap.forEach((line) => {
      page.drawText(line, { x: PAGE.marginX + 4, y: py, size: FONT_SIZE.small, font, color: inkSoft });
      py -= FONT_SIZE.small + 2.4;
    });
  }

  // ---------------------------------------------------------------- signature
  // Flows directly below the transfer/notes block, matching the source
  // workbook where "Your sincerely," sits at H34 just under the bank block.
  const sigRight = PAGE.width - PAGE.marginX;
  const sigWidth = 150;
  let sy = py - 18;
  page.drawText('Yours sincerely,', {
    x: sigRight - sigWidth,
    y: sy,
    size: FONT_SIZE.small,
    font,
    color: inkSoft,
  });
  sy -= 42;
  page.drawLine({
    start: { x: sigRight - sigWidth, y: sy },
    end: { x: sigRight, y: sy },
    thickness: 0.7,
    color: rule,
  });
  sy -= 12;
  const nameLine = fitLine(signerName || '(nama penandatangan belum diisi)', bold, 8.6, sigWidth);
  page.drawText(nameLine.text, {
    x: sigRight - nameLine.width,
    y: sy,
    size: 8.6,
    font: bold,
    color: signerName ? ink : placeholder,
  });
  if (signerTitle) {
    sy -= 11;
    const titleLine = fitLine(signerTitle, font, 7.6, sigWidth);
    page.drawText(titleLine.text, {
      x: sigRight - titleLine.width,
      y: sy,
      size: 7.6,
      font,
      color: inkSoft,
    });
  }

  // --------------------------------------------------- watermark + footers
  const totalPages = pages.length;
  pages.forEach((p, index) => {
    drawFooter(p, index, totalPages);
  });

  doc.setTitle(`Invoice ${asText(invoice.invoiceNo).trim() || '(draft)'} — Noir`);
  doc.setAuthor(asText(invoice.issuer?.name).trim() || 'Noir Invoice Generator');
  doc.setSubject('Invoice (A4, template Noir)');
  doc.setCreator('noir-invoice-generator');
  doc.setProducer('noir-invoice-generator (pdf-lib)');
  const stamp = now instanceof Date ? now : new Date(now);
  doc.setCreationDate(stamp);
  doc.setModificationDate(stamp);

  if (totals.issues.length) warnings.push(...totals.issues);

  const bytes = await doc.save();
  return { bytes, pageCount: totalPages, warnings, totals };
}
