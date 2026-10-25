/**
 * Local draft persistence (browser localStorage or any Storage-compatible map).
 *
 * Keys are namespaced with `noir-invoice-generator/v1:` so this app can never
 * collide with the purchasing app or any other tool on the same origin.
 * Storage here is strictly a draft shelf: it is not a ledger, it does not
 * mark invoices as issued/paid, and clearing site data removes drafts.
 */

import { computeTotals, newId, normalizeInvoice, validateForFinal } from './model.js';
import { formatRupiah } from './money.js';

export const DRAFT_PREFIX = 'noir-invoice-generator/v1:draft:';
export const DRAFT_INDEX_KEY = 'noir-invoice-generator/v1:index';
export const EXPORT_FORMAT = 'noir-invoice-draft';
export const EXPORT_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function readJson(store, key) {
  const raw = store.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readIndex(store) {
  const raw = readJson(store, DRAFT_INDEX_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((e) => e && typeof e.id === 'string');
}

function writeIndex(store, entries) {
  const unique = new Map();
  entries.forEach((e) => unique.set(e.id, e));
  store.setItem(DRAFT_INDEX_KEY, JSON.stringify([...unique.values()]));
}

function summarize(invoice) {
  const totals = computeTotals(invoice);
  const completeness = validateForFinal(invoice, totals);
  return {
    id: invoice.id,
    invoiceNo: invoice.invoiceNo || '',
    billTo: invoice.billTo?.projectOwner || '',
    invoiceDate: invoice.invoiceDate || '',
    grandTotal: formatRupiah(totals.grandTotal),
    grandTotalRaw: totals.grandTotal.toString(),
    lineCount: totals.lines.filter((l) => !l.blank).length,
    isDraft: !completeness.ok,
    updatedAt: invoice.updatedAt,
    createdAt: invoice.createdAt,
  };
}

/**
 * Create or update a draft. Returns the stored invoice.
 * Incomplete invoices are allowed on purpose — they are drafts.
 */
export function saveDraft(store, invoice) {
  const clean = normalizeInvoice(invoice);
  const id = clean.id || newId('inv');
  const existing = loadDraft(store, id);
  const stamped = {
    ...clean,
    id,
    createdAt: existing?.invoice.createdAt || clean.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  store.setItem(DRAFT_PREFIX + id, JSON.stringify(stamped));
  const index = readIndex(store).filter((e) => e.id !== id);
  index.unshift(summarize(stamped));
  writeIndex(store, index);
  return stamped;
}

/** Load one draft; corrupt payloads are pruned and reported as null. */
export function loadDraft(store, id) {
  if (!id) return null;
  const raw = readJson(store, DRAFT_PREFIX + id);
  if (!raw || typeof raw !== 'object') {
    store.removeItem(DRAFT_PREFIX + id);
    writeIndex(store, readIndex(store).filter((e) => e.id !== id));
    return null;
  }
  const invoice = normalizeInvoice(raw);
  const totals = computeTotals(invoice);
  return { invoice, totals, completeness: validateForFinal(invoice, totals) };
}

export function deleteDraft(store, id) {
  store.removeItem(DRAFT_PREFIX + id);
  writeIndex(store, readIndex(store).filter((e) => e.id !== id));
}

/** Index-first listing; falls back to scanning keys if the index is missing. */
export function listDrafts(store) {
  let index = readIndex(store);
  if (index.length === 0) {
    const recovered = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(DRAFT_PREFIX)) {
        const raw = readJson(store, key);
        if (raw && typeof raw === 'object') recovered.push(summarize(normalizeInvoice(raw)));
        else store.removeItem(key);
      }
    }
    if (recovered.length) {
      writeIndex(store, recovered);
      index = recovered;
    }
  }
  return index
    .filter((entry) => readJson(store, DRAFT_PREFIX + entry.id))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Export one draft as a versioned JSON envelope. */
export function exportJson(store, id) {
  const loaded = loadDraft(store, id);
  if (!loaded) throw new Error('Draft tidak ditemukan untuk diekspor.');
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: nowIso(),
      app: 'noir-invoice-generator',
      invoice: loaded.invoice,
    },
    null,
    2,
  );
}

/**
 * Import a JSON backup. Always assigns a fresh internal id by default so an
 * import can never silently overwrite an unrelated draft.
 */
export function importJson(store, text, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `File bukan JSON yang valid: ${err.message}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Isi file JSON tidak dikenali.' };
  }

  let payload;
  if (parsed.format === EXPORT_FORMAT) {
    payload = parsed.invoice;
  } else if (typeof parsed.format === 'string' && parsed.format !== EXPORT_FORMAT) {
    return { ok: false, error: `Format file "${parsed.format}" bukan backup invoice Noir.` };
  } else if (parsed.invoice && typeof parsed.invoice === 'object' && !parsed.lines) {
    payload = parsed.invoice;
  } else {
    payload = parsed;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'File tidak berisi objek invoice.' };
  }
  if (!Array.isArray(payload.lines)) {
    return { ok: false, error: 'File tidak berisi daftar baris invoice (lines).' };
  }

  const invoice = normalizeInvoice(payload);
  if (!options.keepId) invoice.id = newId('inv');
  const saved = saveDraft(store, invoice);
  return { ok: true, invoice: saved };
}

/** Storage availability probe with a readable reason for file:// limits. */
export function detectStorage(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || !win.localStorage) {
    return { available: false, store: null, reason: 'localStorage tidak tersedia di lingkungan ini.' };
  }
  try {
    const probe = '__noir_probe__';
    win.localStorage.setItem(probe, '1');
    win.localStorage.removeItem(probe);
    return { available: true, store: win.localStorage, reason: '' };
  } catch (err) {
    return {
      available: false,
      store: null,
      reason:
        'Penyimpanan browser diblokir. Pada file:// beberapa browser menolak localStorage; jalankan lewat "npm run dev" / "npm run preview" (http://localhost).',
      error: String(err && err.message ? err.message : err),
    };
  }
}
