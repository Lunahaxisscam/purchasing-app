/**
 * Integer-rupiah arithmetic helpers.
 *
 * All monetary values are handled as integer rupiah (BigInt internally) so that
 * no floating point drift can ever reach an invoice total. Decimal input (qty,
 * tax rate) is parsed into a scaled BigInt first.
 */

const SCALE_QTY = 1000n; // 3 decimal places for quantity
const SCALE_RATE = 1000000n; // 6 decimal places for tax rate

/** Strip everything that is not a digit, minus sign, comma or dot. */
export function normalizeNumericInput(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim().replace(/\s|Rp|IDR/gi, '');
}

/** True when `body` is a valid grouped integer, e.g. "1.234.567" or "43300000". */
function isValidGroupedInt(body) {
  if (/^\d+$/.test(body)) return true;
  return /^\d{1,3}(?:[.,]\d{3})+$/.test(body);
}

/**
 * Parse a user typed decimal into a scaled BigInt.
 * Accepts "1.500,25" (id), "1500.25" (en), "1,5", "-200000", "43.300.000".
 * Returns null when the text is not a valid number.
 */
export function parseDecimalToScaled(raw, scale) {
  const text = normalizeNumericInput(raw);
  if (text === '') return null;
  if (!/^-?[\d.,]+$/.test(text)) return null;

  let negative = false;
  let body = text;
  if (body.startsWith('-')) {
    negative = true;
    body = body.slice(1);
  }
  if (body === '' || body === '.' || body === ',') return null;

  const decimals = String(scale).length - 1; // 1000n -> 3

  let intPart;
  let fracPart = '';

  if (decimals === 0) {
    // Integer rupiah: every separator is a thousands separator, and the
    // grouping must be consistent so "1.2.3.4," is rejected.
    if (!isValidGroupedInt(body)) return null;
    intPart = body.replace(/[.,]/g, '');
  } else {
    const lastDot = body.lastIndexOf('.');
    const lastComma = body.lastIndexOf(',');
    let decimalSep = null;
    if (lastDot >= 0 && lastComma >= 0) {
      decimalSep = lastDot > lastComma ? '.' : ',';
    } else if (lastComma >= 0 || lastDot >= 0) {
      const sep = lastComma >= 0 ? ',' : '.';
      const parts = body.split(sep);
      const head = parts[0];
      const tail = parts[1];
      // Ambiguity rule: "1.234" / "1,234" is thousands grouping, while
      // "2,5" / "0,125" is a decimal. A separator followed by exactly 3
      // digits and a 1-3 digit head is treated as grouping only when there
      // are no further separators AND the head is not "0".
      const isGrouping =
        parts.length === 2 && tail.length === 3 && head.length >= 1 && head.length <= 3 && head !== '0';
      decimalSep = isGrouping ? null : sep;
    }

    if (decimalSep) {
      const idx = body.lastIndexOf(decimalSep);
      intPart = body.slice(0, idx);
      fracPart = body.slice(idx + 1);
      if (intPart === '') intPart = '0';
      if (!isValidGroupedInt(intPart)) return null;
      if (fracPart !== '' && !/^\d+$/.test(fracPart)) return null;
      if (fracPart.length > decimals) return null;
      intPart = intPart.replace(/[.,]/g, '');
    } else {
      if (!isValidGroupedInt(body)) return null;
      intPart = body.replace(/[.,]/g, '');
    }
  }

  const padded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const value = BigInt(intPart) * scale + BigInt(padded === '' ? '0' : padded);
  return negative ? -value : value;
}

/** Parse rupiah text into integer rupiah (BigInt). */
export function parseRupiah(raw) {
  const scaled = parseDecimalToScaled(raw, 1n);
  if (scaled === null) return null;
  return scaled;
}

/** Parse quantity into a BigInt scaled by 1000. */
export function parseQty(raw) {
  return parseDecimalToScaled(raw, SCALE_QTY);
}

/** Round-half-away-from-zero division for BigInt. */
export function divRound(numerator, denominator) {
  if (denominator === 0n) throw new Error('division by zero');
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** amount = round(qty * unitPrice) in integer rupiah. */
export function lineAmount(qtyScaled, unitPrice) {
  return divRound(qtyScaled * unitPrice, SCALE_QTY);
}

/** tax = round(base * ratePercent / 100) */
export function taxFromPercent(base, rateScaled) {
  return divRound(base * rateScaled, 100n * SCALE_RATE);
}

/** Group digits with dots, id-ID style. */
export function groupDigits(intString) {
  return intString.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 1234567 -> "1.234.567" ; -200000 -> "(200.000)" */
export function formatRupiah(value) {
  const v = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value) || 0));
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const body = groupDigits(abs.toString());
  return negative ? `(${body})` : body;
}

/** Format a qty scaled by 1000 back to a short literal ("1", "2,5"). */
export function formatQty(qtyScaled) {
  if (qtyScaled === null || qtyScaled === undefined) return '';
  const negative = qtyScaled < 0n;
  const abs = negative ? -qtyScaled : qtyScaled;
  const int = abs / SCALE_QTY;
  const frac = abs % SCALE_QTY;
  let out = int.toString();
  if (frac !== 0n) {
    out += ',' + frac.toString().padStart(3, '0').replace(/0+$/, '');
  }
  return negative ? '-' + out : out;
}

/** Format a scaled rate (6dp) as a compact percent literal. */
export function formatRate(rateScaled) {
  if (rateScaled === null || rateScaled === undefined) return '';
  const negative = rateScaled < 0n;
  const abs = negative ? -rateScaled : rateScaled;
  const int = abs / SCALE_RATE;
  const frac = abs % SCALE_RATE;
  let out = int.toString();
  if (frac !== 0n) {
    out += ',' + frac.toString().padStart(6, '0').replace(/0+$/, '');
  }
  return negative ? '-' + out : out;
}

export const SCALES = { qty: SCALE_QTY, rate: SCALE_RATE };
