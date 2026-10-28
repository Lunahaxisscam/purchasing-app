/**
 * Invoice domain model: defaults, normalisation, totals, validation.
 * Pure functions only — no DOM, no storage, no PDF.
 */

import {
  formatQty,
  formatRate,
  formatRupiah,
  lineAmount,
  parseQty,
  parseRupiah,
  parseDecimalToScaled,
  SCALES,
  taxFromPercent,
} from './money.js';

export const SCHEMA_VERSION = 1;

/** Theme identity is an allowlist, never an asset path or arbitrary CSS. */
export function templateIdentity(raw = {}) {
  return { templateId: raw.templateId === 'kabineku' ? 'kabineku' : 'noir', templateVersion: 1 };
}

/** Change presentation only; retain every business field verbatim. */
export function selectTemplate(invoice, templateId) {
  return { ...invoice, ...templateIdentity({ templateId }) };
}

export function newId(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createLine(overrides = {}) {
  return {
    id: newId('line'),
    kind: 'item', // 'item' | 'adjustment'
    desc: '',
    note: '',
    qty: '1',
    unit: 'ls',
    unitPrice: '',
    ...overrides,
  };
}

export function createTerm(overrides = {}) {
  return {
    id: newId('term'),
    label: '',
    percent: '',
    amount: '',
    ...overrides,
  };
}

/**
 * Empty invoice. Every identity field is intentionally blank: no customer,
 * bank account, project or invoice number from the reference workbook is
 * pre-filled, because none of those values are verified for reuse.
 */
export function createEmptyInvoice(now = new Date()) {
  const iso = todayIso(now);
  return {
    schemaVersion: SCHEMA_VERSION,
    ...templateIdentity(),
    id: newId('inv'),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    invoiceNo: '', // kept literal, never reformatted or auto-generated
    invoiceDate: iso,
    dueDate: '',
    billTo: {
      projectOwner: '',
      address: '',
      projectRef: '',
    },
    issuer: {
      name: '',
      address: '',
      contact: '',
    },
    lines: [createLine()],
    paymentSchedule: {
      enabled: false,
      totalProject: '',
      terms: [
        createTerm({ label: 'Term 1', percent: '50' }),
        createTerm({ label: 'Term 2', percent: '40' }),
        createTerm({ label: 'Term 3', percent: '10' }),
      ],
    },
    tax: {
      enabled: false,
      mode: 'percent', // 'percent' | 'amount'
      rate: '',
      amount: '',
      label: '',
    },
    payment: {
      transferVia: '',
      bankLines: '',
      instructions: '',
    },
    signature: {
      signerName: '',
      signerTitle: '',
    },
    notes: '',
  };
}

function str(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** Coerce arbitrary (possibly imported/old) data into the current shape. */
export function normalizeInvoice(raw) {
  const base = createEmptyInvoice(new Date());
  if (!raw || typeof raw !== 'object') return base;
  const out = {
    ...base,
    ...templateIdentity(raw),
    id: str(raw.id, base.id),
    createdAt: str(raw.createdAt, base.createdAt),
    updatedAt: str(raw.updatedAt, base.updatedAt),
    invoiceNo: str(raw.invoiceNo),
    invoiceDate: str(raw.invoiceDate),
    dueDate: str(raw.dueDate),
    notes: str(raw.notes),
    billTo: {
      projectOwner: str(raw.billTo?.projectOwner),
      address: str(raw.billTo?.address),
      projectRef: str(raw.billTo?.projectRef),
    },
    issuer: {
      name: str(raw.issuer?.name),
      address: str(raw.issuer?.address),
      contact: str(raw.issuer?.contact),
    },
    lines: Array.isArray(raw.lines)
      ? raw.lines.map((l) => ({
          id: str(l?.id, newId('line')),
          kind: l?.kind === 'adjustment' ? 'adjustment' : 'item',
          desc: str(l?.desc),
          note: str(l?.note),
          qty: str(l?.qty, '1'),
          unit: str(l?.unit, 'ls'),
          unitPrice: str(l?.unitPrice),
        }))
      : [],
    paymentSchedule: {
      enabled: Boolean(raw.paymentSchedule?.enabled),
      totalProject: str(raw.paymentSchedule?.totalProject),
      terms: Array.isArray(raw.paymentSchedule?.terms)
        ? raw.paymentSchedule.terms.map((t) => ({
            id: str(t?.id, newId('term')),
            label: str(t?.label),
            percent: str(t?.percent),
            amount: str(t?.amount),
          }))
        : [],
    },
    tax: {
      enabled: Boolean(raw.tax?.enabled),
      mode: raw.tax?.mode === 'amount' ? 'amount' : 'percent',
      rate: str(raw.tax?.rate),
      amount: str(raw.tax?.amount),
      label: str(raw.tax?.label),
    },
    payment: {
      transferVia: str(raw.payment?.transferVia),
      bankLines: str(raw.payment?.bankLines),
      instructions: str(raw.payment?.instructions),
    },
    signature: {
      signerName: str(raw.signature?.signerName),
      signerTitle: str(raw.signature?.signerTitle),
    },
  };
  return out;
}

/**
 * Compute all money values. Returns integer BigInt rupiah.
 * Never throws: invalid input is reported in `issues` and skipped.
 */
export function computeTotals(invoice) {
  const issues = [];
  const lines = [];
  let subtotal = 0n;
  let adjustments = 0n;
  let adjustmentCount = 0;

  (invoice.lines || []).forEach((line, index) => {
    const label = `Baris ${index + 1}`;
    const desc = str(line.desc).trim();
    const note = str(line.note);
    const unit = str(line.unit);
    const priceText = str(line.unitPrice).trim();
    const qtyText = str(line.qty).trim();
    const isBlank = !desc && !note && !priceText;
    const qty = parseQty(line.qty);
    const price = parseRupiah(line.unitPrice);
    const row = {
      id: line.id,
      index,
      kind: line.kind === 'adjustment' ? 'adjustment' : 'item',
      desc,
      note,
      unit,
      qtyScaled: qty,
      unitPrice: price,
      amount: null,
      blank: isBlank,
      errors: [],
    };
    if (!isBlank) {
      if (qty === null || qtyText === '') row.errors.push(`${label}: qty tidak valid`);
      if (price === null || priceText === '') row.errors.push(`${label}: harga tidak valid`);
    }
    if (qty !== null && price !== null && !isBlank) {
      row.amount = lineAmount(qty, price);
      if (row.kind === 'adjustment') {
        adjustments += row.amount;
        adjustmentCount += 1;
      } else {
        subtotal += row.amount;
      }
    }
    row.errors.forEach((e) => issues.push(e));
    lines.push(row);
  });

  const total = subtotal + adjustments;

  let tax = 0n;
  let taxLabel = '';
  if (invoice.tax?.enabled) {
    if (invoice.tax.mode === 'amount') {
      const amount = parseRupiah(invoice.tax.amount);
      if (amount === null) {
        issues.push('Pajak: nominal tidak valid');
      } else {
        tax = amount;
      }
      taxLabel = str(invoice.tax.label).trim() || 'Tax';
    } else {
      const rate = parseDecimalToScaled(invoice.tax.rate, SCALES.rate);
      if (rate === null) {
        issues.push('Pajak: tarif tidak valid');
      } else {
        tax = taxFromPercent(total, rate);
      }
      const rateText = rate === null ? str(invoice.tax.rate) : formatRate(rate);
      taxLabel = str(invoice.tax.label).trim() || `Tax Rate (${rateText}%)`;
    }
  }

  const grandTotal = total + tax;

  return {
    lines,
    subtotal,
    adjustments,
    adjustmentCount,
    total,
    tax,
    taxLabel,
    taxEnabled: Boolean(invoice.tax?.enabled),
    grandTotal,
    issues,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value) {
  if (!DATE_RE.test(str(value))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const MONTHS_ID_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

/** "2026-05-02" -> "02-Mei-26" (source cell format d-mmm-yy, Indonesian month). */
export function formatDateShort(iso) {
  if (!isValidIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}-${MONTHS_ID_SHORT[m - 1]}-${String(y).slice(-2)}`;
}

/** "2026-05-02" -> "2 Mei 2026" for long form display. */
export function formatDateLong(iso) {
  if (!isValidIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
}

/**
 * Auto-fill termin nominal dari Grand Total — default 50 / 40 / 10, sisa dibulatkan ke termin terakhir.
 * Murni helper (tidak mengubah Grand Total). Dipanggil UI setelah Grand Total stabil.
 */
export function applyDefaultTermSchedule(invoice, totals, presets = [50n, 40n, 10n]) {
  if (!invoice?.paymentSchedule?.terms) return invoice
  const grandTotal = totals?.grandTotal ?? 0n
  if (!invoice.paymentSchedule.enabled || grandTotal <= 0n) return invoice
  const terms = invoice.paymentSchedule.terms
  if (terms.length !== presets.length) return invoice
  // Hanya isi bila amount masih kosong (jangan menimpa input manual yang sudah ada)
  const allEmpty = terms.every((t) => !String(t.amount || '').trim())
  if (!allEmpty) return invoice
  let sum = 0n
  const next = terms.map((t, i) => {
    const last = i === terms.length - 1
    const amt = last ? grandTotal - sum : (grandTotal * presets[i]) / 100n
    sum += amt
    const text = amt.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return { ...t, amount: text }
  })
  return { ...invoice, paymentSchedule: { ...invoice.paymentSchedule, terms: next } }
}

/**
 * Validation for a final (non-draft) PDF.
 * Drafts may be saved/exported while incomplete.
 */
export function validateForFinal(invoice, totals = computeTotals(invoice)) {
  const errors = [];
  const warnings = [];

  if (!str(invoice.invoiceNo).trim()) errors.push('Nomor invoice masih kosong (diisi manual, format bebas).');
  if (!str(invoice.invoiceDate).trim()) errors.push('Tanggal invoice masih kosong.');
  else if (!isValidIsoDate(invoice.invoiceDate)) errors.push('Tanggal invoice tidak valid (YYYY-MM-DD).');
  if (invoice.dueDate && !isValidIsoDate(invoice.dueDate)) errors.push('Tanggal jatuh tempo tidak valid (YYYY-MM-DD).');
  if (!str(invoice.billTo?.projectOwner).trim()) errors.push('Nama penerima tagihan (Bill To) masih kosong.');
  if (!str(invoice.issuer?.name).trim()) errors.push('Nama penerbit masih kosong.');

  const usable = totals.lines.filter((l) => l.desc && l.amount !== null);
  if (usable.length === 0) errors.push('Minimal satu baris dengan uraian dan nominal yang valid.');

  totals.lines.forEach((l, i) => {
    if (!l.desc && (l.amount !== null || str(invoice.lines[i]?.unitPrice).trim())) {
      errors.push(`Baris ${i + 1}: uraian masih kosong.`);
    }
  });

  if (!str(invoice.payment?.transferVia).trim() && !str(invoice.payment?.bankLines).trim()) {
    warnings.push('Instruksi pembayaran (transfer via / rekening) masih kosong; PDF akan menampilkan penanda kosong.');
  }
  if (!str(invoice.signature?.signerName).trim()) {
    warnings.push('Nama penandatangan masih kosong.');
  }
  if (totals.grandTotal <= 0n) {
    warnings.push('Grand total nol atau negatif — periksa kembali nominal.');
  }
  if (totals.issues.length) {
    errors.push(...totals.issues);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Money helpers re-exported for the UI. */
export const money = { formatRupiah, formatQty, formatRate };
