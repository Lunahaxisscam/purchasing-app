import { describe, expect, it } from 'vitest';
import {
  computeTotals,
  createEmptyInvoice,
  createLine,
  formatDateShort,
  isValidIsoDate,
  normalizeInvoice,
  validateForFinal,
} from '../src/lib/model.js';

function invoiceWith(overrides) {
  const inv = createEmptyInvoice(new Date('2026-05-02T00:00:00Z'));
  return { ...inv, ...overrides };
}

describe('createEmptyInvoice', () => {
  it('starts blank with no borrowed identity, number or bank data', () => {
    const inv = createEmptyInvoice(new Date('2026-05-02T00:00:00Z'));
    expect(inv.invoiceNo).toBe('');
    expect(inv.billTo.projectOwner).toBe('');
    expect(inv.issuer.name).toBe('');
    expect(inv.payment.bankLines).toBe('');
    expect(inv.payment.transferVia).toBe('');
    expect(inv.signature.signerName).toBe('');
    expect(inv.tax.enabled).toBe(false);
    expect(inv.tax.rate).toBe('');
    expect(inv.paymentSchedule.enabled).toBe(false);
    expect(JSON.stringify(inv)).not.toMatch(/Yosua|JANICE|527-113|Mangga/i);
  });

  it('has a single empty line and 3 empty payment terms', () => {
    const inv = createEmptyInvoice();
    expect(inv.lines).toHaveLength(1);
    expect(inv.paymentSchedule.terms).toHaveLength(3);
    expect(inv.lines[0].desc).toBe('');
    expect(inv.lines[0].qty).toBe('1');
  });
});

describe('computeTotals', () => {
  it('sums item lines and treats adjustments as signed', () => {
    const inv = invoiceWith({
      lines: [
        createLine({ desc: 'Term 3', qty: '1', unitPrice: '4.330.000' }),
        createLine({ kind: 'adjustment', desc: 'Adjustment Cermin Kamar Mandi', unitPrice: '-200.000' }),
        createLine({ kind: 'adjustment', desc: 'Adjustment Credenza TV', unitPrice: '-350.000' }),
        createLine({ kind: 'adjustment', desc: 'Additional Full Body Mirror', unitPrice: '400.000' }),
      ],
    });
    const t = computeTotals(inv);
    expect(t.subtotal).toBe(4330000n);
    expect(t.adjustments).toBe(-150000n);
    expect(t.adjustmentCount).toBe(3);
    expect(t.total).toBe(4180000n);
    expect(t.grandTotal).toBe(4180000n);
    expect(t.issues).toEqual([]);
  });

  it('keeps decimal qty exact', () => {
    const inv = invoiceWith({ lines: [createLine({ desc: 'Kain', qty: '2,5', unitPrice: '125.000' })] });
    const t = computeTotals(inv);
    expect(t.lines[0].amount).toBe(312500n);
    expect(t.total).toBe(312500n);
  });

  it('no tax by default, and enabling tax without a rate adds nothing but an issue', () => {
    const inv = invoiceWith({ lines: [createLine({ desc: 'X', unitPrice: '1000000' })] });
    expect(computeTotals(inv).grandTotal).toBe(1000000n);

    const withTax = invoiceWith({
      lines: [createLine({ desc: 'X', unitPrice: '1000000' })],
      tax: { enabled: true, mode: 'percent', rate: '', amount: '', label: '' },
    });
    const t = computeTotals(withTax);
    expect(t.tax).toBe(0n);
    expect(t.grandTotal).toBe(1000000n);
    expect(t.issues.join(' ')).toMatch(/tarif/i);
  });

  it('applies a user supplied percent rate', () => {
    const inv = invoiceWith({
      lines: [createLine({ desc: 'X', unitPrice: '1000000' })],
      tax: { enabled: true, mode: 'percent', rate: '11', amount: '', label: '' },
    });
    const t = computeTotals(inv);
    expect(t.tax).toBe(110000n);
    expect(t.grandTotal).toBe(1110000n);
    expect(t.taxLabel).toBe('Tax Rate (11%)');
  });

  it('applies a user supplied fixed tax amount', () => {
    const inv = invoiceWith({
      lines: [createLine({ desc: 'X', unitPrice: '1000000' })],
      tax: { enabled: true, mode: 'amount', rate: '', amount: '55.000', label: 'PPh' },
    });
    const t = computeTotals(inv);
    expect(t.tax).toBe(55000n);
    expect(t.grandTotal).toBe(1055000n);
    expect(t.taxLabel).toBe('PPh');
  });

  it('reports invalid numeric rows instead of silently dropping them', () => {
    const inv = invoiceWith({ lines: [createLine({ desc: 'X', unitPrice: 'abc' })] });
    const t = computeTotals(inv);
    expect(t.total).toBe(0n);
    expect(t.issues.join(' ')).toMatch(/harga tidak valid/i);
  });

  it('ignores empty rows without adding issues', () => {
    const inv = invoiceWith({ lines: [createLine(), createLine({ desc: 'X', unitPrice: '1000' })] });
    const t = computeTotals(inv);
    expect(t.issues).toEqual([]);
    expect(t.total).toBe(1000n);
  });
});

describe('invoice number is literal', () => {
  it('keeps NL26/005/02 exactly as typed', () => {
    const inv = invoiceWith({ invoiceNo: 'NL26/005/02' });
    expect(inv.invoiceNo).toBe('NL26/005/02');
    expect(normalizeInvoice(inv).invoiceNo).toBe('NL26/005/02');
  });

  it('does not invent a number when empty', () => {
    const inv = createEmptyInvoice();
    expect(inv.invoiceNo).toBe('');
    expect(normalizeInvoice(inv).invoiceNo).toBe('');
  });
});

describe('validation', () => {
  it('blocks a final PDF when required identity is missing', () => {
    const inv = createEmptyInvoice();
    const res = validateForFinal(inv);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/Nomor invoice/);
    expect(res.errors.join(' ')).toMatch(/Bill To|penerima/i);
    expect(res.errors.join(' ')).toMatch(/penerbit/i);
  });

  it('passes when required fields are filled, warning about blank payment info', () => {
    const inv = invoiceWith({
      invoiceNo: 'NL26/005/02',
      billTo: { projectOwner: 'PT Contoh Sintetis', address: 'Jl. Contoh 1', projectRef: 'Proyek Demo' },
      issuer: { name: 'Noir Studio (contoh)', address: 'Jakarta', contact: 'halo@example.test' },
      lines: [createLine({ desc: 'Down Payment', unitPrice: '21.650.000' })],
    });
    const res = validateForFinal(inv);
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/pembayaran/i);
  });

  it('rejects impossible dates', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('02-05-2026')).toBe(false);
  });

  it('formats dates with Indonesian month abbreviations', () => {
    expect(formatDateShort('2026-05-02')).toBe('02-Mei-26');
    expect(formatDateShort('2026-10-08')).toBe('08-Okt-26');
  });
});

describe('normalizeInvoice', () => {
  it('survives garbage input', () => {
    const inv = normalizeInvoice({ lines: 'nope', billTo: null, tax: 5 });
    expect(Array.isArray(inv.lines)).toBe(true);
    expect(inv.billTo.projectOwner).toBe('');
    expect(inv.tax.enabled).toBe(false);
  });

  it('keeps unknown extra fields out of the shape but preserves core values', () => {
    const inv = normalizeInvoice({ invoiceNo: 'X/1', lines: [{ desc: 'A', unitPrice: '1000', extra: 'drop' }] });
    expect(inv.invoiceNo).toBe('X/1');
    expect(inv.lines[0].desc).toBe('A');
    expect(inv.lines[0].extra).toBeUndefined();
  });
});
