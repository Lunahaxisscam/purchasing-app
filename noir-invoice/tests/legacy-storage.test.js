import { describe, expect, it } from 'vitest';
import {
  DRAFT_INDEX_KEY,
  DRAFT_PREFIX,
  deleteDraft,
  exportJson,
  importJson,
  listDrafts,
  loadDraft,
  saveDraft,
} from '../src/lib/storage.js';
import { createEmptyInvoice, createLine } from '../src/lib/model.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    _map: map,
  };
}

function sampleInvoice() {
  const inv = createEmptyInvoice(new Date('2026-05-02T00:00:00Z'));
  return {
    ...inv,
    invoiceNo: 'NL26/005/02',
    billTo: { projectOwner: 'PT Contoh', address: 'Jl. Contoh 1', projectRef: 'Demo' },
    issuer: { name: 'Noir (contoh)', address: 'Jakarta', contact: 'x@example.test' },
    lines: [createLine({ desc: 'Down Payment', qty: '1', unitPrice: '21.650.000' })],
  };
}

describe('draft store', () => {
  it('saves, lists, loads and deletes a draft in a namespaced key', () => {
    const store = memoryStorage();
    const inv = sampleInvoice();
    const saved = saveDraft(store, inv);
    expect(saved.id).toBe(inv.id);
    expect(store._map.has(DRAFT_PREFIX + inv.id)).toBe(true);
    expect(store._map.has(DRAFT_INDEX_KEY)).toBe(true);

    const list = listDrafts(store);
    expect(list).toHaveLength(1);
    expect(list[0].invoiceNo).toBe('NL26/005/02');
    expect(list[0].grandTotal).toBe('21.650.000');

    const loaded = loadDraft(store, inv.id);
    expect(loaded.invoice.invoiceNo).toBe('NL26/005/02');
    expect(loaded.invoice.lines[0].unitPrice).toBe('21.650.000');

    deleteDraft(store, inv.id);
    expect(loadDraft(store, inv.id)).toBeNull();
    expect(listDrafts(store)).toHaveLength(0);
  });

  it('editing an existing draft keeps its id and bumps updatedAt', async () => {
    const store = memoryStorage();
    const inv = sampleInvoice();
    saveDraft(store, inv);
    const before = loadDraft(store, inv.id).invoice.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const edited = { ...inv, invoiceNo: 'NL26/005/02-REV' };
    saveDraft(store, edited);
    const after = loadDraft(store, inv.id).invoice;
    expect(after.id).toBe(inv.id);
    expect(after.invoiceNo).toBe('NL26/005/02-REV');
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    expect(listDrafts(store)).toHaveLength(1);
  });

  it('saves incomplete drafts (no invoice number) and marks them as draft', () => {
    const store = memoryStorage();
    const inv = createEmptyInvoice();
    saveDraft(store, inv);
    const loaded = loadDraft(store, inv.id);
    expect(loaded.invoice.invoiceNo).toBe('');
    expect(loaded.completeness.ok).toBe(false);
    expect(listDrafts(store)[0].invoiceNo).toBe('');
    expect(listDrafts(store)[0].isDraft).toBe(true);
  });

  it('returns null and prunes the index for corrupted entries', () => {
    const store = memoryStorage();
    const inv = sampleInvoice();
    saveDraft(store, inv);
    store.setItem(DRAFT_PREFIX + inv.id, '{not json');
    expect(loadDraft(store, inv.id)).toBeNull();
    expect(listDrafts(store)).toHaveLength(0);
  });

  it('rebuilds the index from keys when the index is lost', () => {
    const store = memoryStorage();
    const a = sampleInvoice();
    const b = { ...sampleInvoice(), id: 'inv_second', invoiceNo: 'X/2' };
    saveDraft(store, a);
    saveDraft(store, b);
    store.removeItem(DRAFT_INDEX_KEY);
    const list = listDrafts(store);
    expect(list.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('JSON backup', () => {
  it('round-trips an invoice through export/import', () => {
    const store = memoryStorage();
    const inv = sampleInvoice();
    saveDraft(store, inv);
    const json = exportJson(store, inv.id);
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe('noir-invoice-draft');
    expect(parsed.version).toBe(1);
    expect(parsed.invoice.invoiceNo).toBe('NL26/005/02');

    const other = memoryStorage();
    const imported = importJson(other, json);
    expect(imported.ok).toBe(true);
    expect(imported.invoice.invoiceNo).toBe('NL26/005/02');
    expect(imported.invoice.lines[0].desc).toBe('Down Payment');
  });

  it('assigns a new id on import by default so backups never overwrite', () => {
    const store = memoryStorage();
    const inv = sampleInvoice();
    const json = exportJson(store, saveDraft(store, inv).id);
    const imported = importJson(memoryStorage(), json);
    expect(imported.invoice.id).not.toBe(inv.id);
  });

  it('rejects malformed or foreign JSON with a readable error', () => {
    const bad = importJson(memoryStorage(), '{oops');
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/JSON/i);

    const foreign = importJson(memoryStorage(), JSON.stringify({ format: 'other', invoice: {} }));
    expect(foreign.ok).toBe(false);
    expect(foreign.error).toMatch(/format/i);
  });

  it('rejects a payload with no usable invoice object', () => {
    const res = importJson(memoryStorage(), JSON.stringify({ format: 'noir-invoice-draft', version: 1 }));
    expect(res.ok).toBe(false);
  });

  it('imports a legacy bare invoice object (no envelope)', () => {
    const inv = sampleInvoice();
    const res = importJson(memoryStorage(), JSON.stringify(inv));
    expect(res.ok).toBe(true);
    expect(res.invoice.invoiceNo).toBe('NL26/005/02');
  });
});
