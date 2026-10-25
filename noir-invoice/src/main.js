/**
 * App controller: wires the form, the preview and the local draft store.
 * No network, no accounts, no backend.
 */

import './styles.css';
import { formatRupiah } from './lib/money.js';
import {
  applyDefaultTermSchedule,
  computeTotals,
  createEmptyInvoice,
  createLine,
  createTerm,
  normalizeInvoice,
  validateForFinal,
} from './lib/model.js';
import {
  deleteDraft,
  detectStorage,
  exportJson,
  importJson,
  listDrafts,
  loadDraft,
  saveDraft,
} from './lib/storage.js';
import {
  readInvoiceFromForm,
  renderDrafts,
  renderIssues,
  renderLines,
  renderPreview,
  renderTerms,
  writeInvoiceToForm,
} from './ui/render.js';

const root = document.documentElement;
const storageInfo = detectStorage(window);

let invoice = createEmptyInvoice();
let totals = computeTotals(invoice);
let dirty = false;
let busy = false;

const $ = (sel) => document.querySelector(sel);

function banner(message, kind = 'error') {
  const el = $('#banner');
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle('is-ok', kind === 'ok');
}

function setStorageStatus() {
  const el = $('#storage-status');
  const note = $('#storage-note');
  if (storageInfo.available) {
    el.textContent = 'draft lokal aktif';
    el.className = 'pill pill-ok';
    note.textContent =
      'Draft disimpan di localStorage browser ini (origin ini saja). Menghapus data situs atau memakai mode privat akan menghapus draft — ekspor JSON untuk cadangan.';
  } else {
    el.textContent = 'penyimpanan tidak tersedia';
    el.className = 'pill pill-warn';
    note.textContent = storageInfo.reason;
  }
}

function refreshDrafts() {
  const drafts = storageInfo.available ? listDrafts(storageInfo.store) : [];
  renderDrafts(document, drafts, invoice.id, {
    onOpen: (id) => {
      const loaded = loadDraft(storageInfo.store, id);
      if (!loaded) {
        banner('Draft tidak bisa dibuka (mungkin sudah terhapus).');
        refreshDrafts();
        return;
      }
      invoice = loaded.invoice;
      writeInvoiceToForm(document, invoice);
      renderTerms(document, invoice, { onRemove: removeTerm });
      syncAll();
      switchTab('invoice');
      banner(`Draft ${invoice.invoiceNo || '(tanpa nomor)'} dibuka.`, 'ok');
    },
    onExport: (id) => {
      try {
        downloadText(exportJson(storageInfo.store, id), `${safeName(invoice.invoiceNo || id)}.json`, 'application/json');
      } catch (err) {
        banner(`Gagal ekspor: ${err.message}`);
      }
    },
    onDelete: (id) => {
      if (!window.confirm('Hapus draft ini dari penyimpanan lokal? Tindakan ini tidak bisa dibatalkan.')) return;
      deleteDraft(storageInfo.store, id);
      if (invoice.id === id) {
        invoice = createEmptyInvoice();
        writeInvoiceToForm(document, invoice);
        renderTerms(document, invoice, { onRemove: removeTerm });
      }
      syncAll();
      banner('Draft dihapus.', 'ok');
    },
  });
}

function safeName(text) {
  return (
    String(text || 'invoice')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'invoice'
  );
}

async function loadPdfAssetsLazy() {
  const mod = await import('./pdf/assets.js');
  return mod.loadPdfAssets();
}

function downloadBytes(bytes, filename, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function downloadText(text, filename, type) {
  downloadBytes(new TextEncoder().encode(text), filename, type);
}

function syncAll() {
  totals = computeTotals(invoice);
  renderLines(document, invoice, totals, { onRemove: removeLine });
  renderTerms(document, invoice, { onRemove: removeTerm });
  const check = renderPreview(document, invoice, totals);
  renderIssues(document, check);
  refreshDrafts();
  updateTaxVisibility();
  updateScheduleVisibility();
  dirty = true;
}

function updateTaxVisibility() {
  const enabled = $('#tax\\.enabled')?.checked;
  const fields = $('#tax-fields');
  if (fields) fields.hidden = !enabled;
  const mode = $('#tax\\.mode')?.value === 'amount' ? 'amount' : 'percent';
  document.querySelectorAll('[data-tax-mode]').forEach((el) => {
    el.hidden = el.dataset.taxMode !== mode;
  });
}

function updateScheduleVisibility() {
  const enabled = $('#paymentSchedule\\.enabled')?.checked;
  const fields = $('#schedule-fields');
  if (fields) fields.hidden = !enabled;
}

function removeLine(id) {
  invoice.lines = invoice.lines.filter((l) => l.id !== id);
  if (invoice.lines.length === 0) invoice.lines = [createLine()];
  syncAll();
}

function removeTerm(id) {
  invoice.paymentSchedule.terms = invoice.paymentSchedule.terms.filter((t) => t.id !== id);
  syncAll();
}

function onFormInput() {
  invoice = readInvoiceFromForm(document, invoice);
  totals = computeTotals(invoice);
  // Auto 50/40/10 ke termin bila masih kosong & schedule aktif
  const withTerms = applyDefaultTermSchedule(invoice, totals);
  if (withTerms !== invoice) {
    invoice = withTerms;
    renderTerms(document, invoice, { onRemove: removeTerm });
    writeInvoiceToForm(document, invoice);
  }
  renderPreview(document, invoice, totals);
  renderIssues(document, validateForFinal(invoice, totals));
  // Live totals in the line table without re-creating inputs (keeps focus).
  document.querySelectorAll('#lines .line-row').forEach((row, i) => {
    const cell = row.querySelector('.line-amount');
    const rowTotals = totals.lines[i];
    if (!cell) return;
    if (rowTotals && rowTotals.amount !== null) {
      cell.textContent = formatRupiah(rowTotals.amount);
      cell.classList.toggle('is-negative', rowTotals.amount < 0n);
    } else {
      cell.textContent = '—';
      cell.classList.remove('is-negative');
    }
  });
  dirty = true;
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === name));
}

async function save() {
  if (!storageInfo.available) {
    banner(storageInfo.reason);
    return;
  }
  invoice = readInvoiceFromForm(document, invoice);
  const saved = saveDraft(storageInfo.store, invoice);
  invoice = normalizeInvoice(saved);
  dirty = false;
  syncAll();
  banner(`Draft disimpan lokal: ${invoice.invoiceNo || '(tanpa nomor)'} — ${new Date().toLocaleTimeString('id-ID')}`, 'ok');
}

async function exportPdf() {
  if (busy) return;
  invoice = readInvoiceFromForm(document, invoice);
  totals = computeTotals(invoice);
  const check = validateForFinal(invoice, totals);
  const mode = check.ok ? 'final' : 'draft';
  if (!check.ok) {
    const proceed = window.confirm(
      `Invoice belum lengkap untuk dokumen final:\n\n- ${check.errors.slice(0, 6).join('\n- ')}${
        check.errors.length > 6 ? `\n… dan ${check.errors.length - 6} lainnya` : ''
      }\n\nTetap unduh PDF sebagai DRAF (bertanda air DRAF)?`,
    );
    if (!proceed) return;
  }
  busy = true;
  const btn = $('#btn-pdf');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Menyiapkan PDF…';
  try {
    const [{ buildInvoicePdf }, assets] = await Promise.all([import('./pdf/invoicePdf.js'), loadPdfAssetsLazy()]);
    const { bytes, pageCount } = await buildInvoicePdf({
      invoice,
      ...assets,
      mode,
      watermark: mode === 'draft' ? 'DRAF' : null,
    });
    const name = `${safeName(invoice.invoiceNo || 'draf')}${mode === 'draft' ? '-DRAF' : ''}.pdf`;
    downloadBytes(bytes, name, 'application/pdf');
    banner(`PDF ${mode === 'draft' ? 'DRAF' : 'final'} dibuat: ${name} (${pageCount} halaman, ${Math.round(bytes.length / 1024)} KB)`, 'ok');
  } catch (err) {
    console.error(err);
    banner(`Gagal membuat PDF: ${err.message}`);
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = label;
  }
}

function wire() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  document.addEventListener('input', (e) => {
    if (!e.target.closest('.form-panel')) return;
    if (e.target.closest('#lines') || e.target.closest('#terms')) return;
    onFormInput();
  });
  document.addEventListener('change', (e) => {
    if (!e.target.closest('.form-panel')) return;
    if (e.target.id === 'tax.enabled' || e.target.id === 'tax.mode') updateTaxVisibility();
    if (e.target.id === 'paymentSchedule.enabled') updateScheduleVisibility();
    if (e.target.closest('#lines') || e.target.closest('#terms')) {
      invoice = readInvoiceFromForm(document, invoice);
      totals = computeTotals(invoice);
      renderPreview(document, invoice, totals);
      renderIssues(document, validateForFinal(invoice, totals));
      dirty = true;
      return;
    }
    onFormInput();
  });

  // Live recalculation for the line table, without rebuilding inputs.
  document.addEventListener('input', (e) => {
    if (!e.target.closest('#lines') && !e.target.closest('#terms')) return;
    invoice = readInvoiceFromForm(document, invoice);
    totals = computeTotals(invoice);
    const row = e.target.closest('.line-row');
    if (row) {
      const index = [...document.querySelectorAll('#lines .line-row')].indexOf(row);
      const rowTotals = totals.lines[index];
      const cell = row.querySelector('.line-amount');
      if (cell) {
        if (rowTotals && rowTotals.amount !== null) {
          cell.textContent = formatRupiah(rowTotals.amount);
          cell.classList.toggle('is-negative', rowTotals.amount < 0n);
        } else {
          cell.textContent = '—';
          cell.classList.remove('is-negative');
        }
      }
    }
    renderPreview(document, invoice, totals);
    renderIssues(document, validateForFinal(invoice, totals));
    dirty = true;
  });

  $('#btn-add-line').addEventListener('click', () => {
    invoice = readInvoiceFromForm(document, invoice);
    invoice.lines.push(createLine());
    syncAll();
    const rows = document.querySelectorAll('#lines .line-row');
    rows[rows.length - 1]?.querySelector('[data-field="desc"]')?.focus();
  });

  $('#btn-add-adjustment').addEventListener('click', () => {
    invoice = readInvoiceFromForm(document, invoice);
    invoice.lines.push(createLine({ kind: 'adjustment', qty: '1', unit: 'ls' }));
    syncAll();
    const rows = document.querySelectorAll('#lines .line-row');
    rows[rows.length - 1]?.querySelector('[data-field="desc"]')?.focus();
  });

  $('#btn-add-term').addEventListener('click', () => {
    invoice = readInvoiceFromForm(document, invoice);
    invoice.paymentSchedule.terms.push(createTerm());
    syncAll();
  });

  $('#btn-new').addEventListener('click', () => {
    if (dirty && !window.confirm('Buang perubahan yang belum disimpan dan mulai invoice baru?')) return;
    invoice = createEmptyInvoice();
    writeInvoiceToForm(document, invoice);
    syncAll();
    switchTab('invoice');
    banner('Invoice baru (kosong). Nomor invoice diisi manual.', 'ok');
  });

  $('#btn-save').addEventListener('click', save);
  $('#btn-pdf').addEventListener('click', exportPdf);
  $('#btn-refresh-drafts').addEventListener('click', () => {
    refreshDrafts();
    banner('Daftar draft dimuat ulang.', 'ok');
  });

  $('#btn-export').addEventListener('click', () => {
    invoice = readInvoiceFromForm(document, invoice);
    if (!storageInfo.available) {
      // Still allow exporting the in-memory invoice without a store.
      const payload = JSON.stringify(
        { format: 'noir-invoice-draft', version: 1, exportedAt: new Date().toISOString(), app: 'noir-invoice-generator', invoice },
        null,
        2,
      );
      downloadText(payload, `${safeName(invoice.invoiceNo || 'draft')}.json`, 'application/json');
      return;
    }
    const saved = saveDraft(storageInfo.store, invoice);
    invoice = normalizeInvoice(saved);
    downloadText(exportJson(storageInfo.store, invoice.id), `${safeName(invoice.invoiceNo || invoice.id)}.json`, 'application/json');
    refreshDrafts();
    banner('Backup JSON diekspor (draft juga disimpan lokal).', 'ok');
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (!storageInfo.available) {
      banner(storageInfo.reason);
      e.target.value = '';
      return;
    }
    const res = importJson(storageInfo.store, text);
    e.target.value = '';
    if (!res.ok) {
      banner(`Impor gagal: ${res.error}`);
      return;
    }
    invoice = res.invoice;
    writeInvoiceToForm(document, invoice);
    syncAll();
    switchTab('invoice');
    banner(`Draft diimpor: ${invoice.invoiceNo || '(tanpa nomor)'}.`, 'ok');
  });

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

function boot() {
  setStorageStatus();
  wire();
  writeInvoiceToForm(document, invoice);
  syncAll();
  dirty = false;
  if (!storageInfo.available) {
    banner(storageInfo.reason);
  }
}

boot();
