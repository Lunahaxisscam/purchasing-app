/**
 * Page geometry, palette and text measurement for the Noir invoice PDF.
 *
 * The proportions come from the reference workbook (RAB_source.xlsx, tabs
 * "Inv DP" / "Inv T2" / "Inv T3"): column widths A..I are 7.0 / 9.14 / 22.43 /
 * 9.14 / (default 8.43) / (default 8.43) / 9.86 / 16.86 / 18.29 characters,
 * with B:E merged for the description column. Those ratios are preserved here
 * and scaled onto an A4 content width.
 */

export const PAGE = {
  width: 595.28, // A4 portrait, points
  height: 841.89,
  marginX: 48,
  marginTop: 44,
  marginBottom: 46,
};

export const CONTENT_WIDTH = PAGE.width - PAGE.marginX * 2;

/** Brand palette sampled from the workbook: header fill FF959676. */
export const PALETTE = {
  brand: [0x95 / 255, 0x96 / 255, 0x76 / 255],
  brandDark: [0x7a / 255, 0x7b / 255, 0x5f / 255],
  ink: [0.09, 0.09, 0.08],
  inkSoft: [0.33, 0.33, 0.31],
  rule: [0.55, 0.55, 0.5],
  ruleLight: [0.82, 0.82, 0.79],
  paper: [1, 1, 1],
  white: [1, 1, 1],
  warn: [0.55, 0.16, 0.13],
  placeholder: [0.62, 0.62, 0.58],
};

/**
 * Column ratios taken verbatim from the workbook's `column_dimensions`
 * (character widths) on tabs "Inv DP" / "Inv T2" / "Inv T3":
 *   A=7.0  B=9.14  C=22.43  D=9.14  E=13.0  F=13.0  G=9.86  H=16.86  I=18.29
 * with the description merged across B:E (B13:E13 … B27:E27) and Qty living in
 * F. Total = 118.72 chars, which is the ratio basis used below.
 * A=No, B:E=Desc, F=Qty, G=Mea, H=Price, I=Amount
 */
const COLUMN_RATIOS = {
  no: 7.0,
  desc: 9.14 + 22.43 + 9.14 + 13.0, // B..E merged
  qty: 13.0, // F
  unit: 9.86, // G
  price: 16.86, // H
  amount: 18.29, // I
};
const RATIO_TOTAL = Object.values(COLUMN_RATIOS).reduce((a, b) => a + b, 0); // 118.72

export const COLUMNS = (() => {
  const scale = CONTENT_WIDTH / RATIO_TOTAL;
  const no = COLUMN_RATIOS.no * scale;
  const desc = COLUMN_RATIOS.desc * scale;
  const qty = COLUMN_RATIOS.qty * scale;
  const unit = COLUMN_RATIOS.unit * scale;
  const price = COLUMN_RATIOS.price * scale;
  const amount = COLUMN_RATIOS.amount * scale;
  const x0 = PAGE.marginX;
  const xNo = x0;
  const xDesc = xNo + no;
  const xQty = xDesc + desc;
  const xUnit = xQty + qty;
  const xPrice = xUnit + unit;
  const xAmount = xPrice + price;
  return {
    no: { x: xNo, width: no },
    desc: { x: xDesc, width: desc },
    qty: { x: xQty, width: qty },
    unit: { x: xUnit, width: unit },
    price: { x: xPrice, width: price },
    amount: { x: xAmount, width: amount },
    right: xAmount + amount,
  };
})();

export const CELL_PAD = 5;

/**
 * Wrap text to a pixel width. Honours explicit newlines, collapses runs of
 * spaces, and hard-splits words that are wider than the column so nothing is
 * ever dropped.
 */
export function wrapText(text, font, size, maxWidth) {
  const raw = String(text ?? '');
  if (raw === '') return [];
  const paragraphs = raw.replace(/\r\n?/g, '\n').split('\n');
  const out = [];

  const widthOf = (s) => {
    try {
      return font.widthOfTextAtSize(s, size);
    } catch {
      return s.length * size * 0.5;
    }
  };

  for (const paragraph of paragraphs) {
    const collapsed = paragraph.replace(/[ \t]+/g, ' ').trim();
    if (collapsed === '') {
      out.push('');
      continue;
    }
    const words = collapsed.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (widthOf(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== '') {
        out.push(current);
        current = '';
      }
      if (widthOf(word) <= maxWidth) {
        current = word;
        continue;
      }
      // Hard split a single over-long token (URL, SKU, no-space text).
      let chunk = '';
      for (const ch of Array.from(word)) {
        const next = chunk + ch;
        if (chunk !== '' && widthOf(next) > maxWidth) {
          out.push(chunk);
          chunk = ch;
        } else {
          chunk = next;
        }
      }
      current = chunk;
    }
    if (current !== '') out.push(current);
  }
  return out;
}

/** Truncate with ellipsis only for single-line chrome (never for line items). */
export function ellipsize(text, font, size, maxWidth) {
  const s = String(text ?? '');
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${s.slice(0, mid)}…`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
}

/** Split a long value into at most `max` lines with an ellipsis on the last. */
export function clampLines(text, font, size, maxWidth, max = 2) {
  const lines = wrapText(text, font, size, maxWidth);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = ellipsize(`${kept[max - 1]} ${lines.slice(max).join(' ')}`.trim(), font, size, maxWidth);
  return kept;
}

/** "IDR 43.300.000" helper matching the source payment-schedule wording. */
export function idr(valueText) {
  return `IDR ${valueText}`;
}
