/**
 * DOM rendering for the form + preview. All functions take a root element and
 * plain data, so they can be exercised in jsdom without a real browser.
 */

import { computeTotals, formatDateShort, validateForFinal, templateIdentity } from '../lib/model.js';
import { formatQty, formatRupiah } from '../lib/money.js';

/** Escape an id for use in a CSS selector (jsdom does not ship CSS.escape). */
function idSelector(id) {
  const escaped = String(id).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  return `#${escaped}`;
}

/** The document that owns `root` (root itself may be the document). */
function docOf(root) {
  return root.ownerDocument || root;
}

export function readInvoiceFromForm(root, current) {
  const get = (id) => root.querySelector(idSelector(id));
  const val = (id) => (get(id) ? get(id).value : '');
  const checked = (id) => Boolean(get(id)?.checked);

  const lines = [...root.querySelectorAll('#lines .line-row')].map((row) => ({
    id: row.dataset.id,
    kind: row.dataset.kind === 'adjustment' ? 'adjustment' : 'item',
    desc: row.querySelector('[data-field="desc"]').value,
    note: row.querySelector('[data-field="note"]')?.value || '',
    qty: row.querySelector('[data-field="qty"]').value,
    unit: row.querySelector('[data-field="unit"]').value,
    unitPrice: row.querySelector('[data-field="unitPrice"]').value,
  }));

  const terms = [...root.querySelectorAll('#terms .term-row')].map((row) => ({
    id: row.dataset.id,
    label: row.querySelector('[data-field="label"]').value,
    percent: row.querySelector('[data-field="percent"]').value,
    amount: row.querySelector('[data-field="amount"]').value,
  }));

  return {
    ...current,
    invoiceNo: val('invoiceNo'),
    invoiceDate: val('invoiceDate'),
    dueDate: val('dueDate'),
    notes: val('notes'),
    billTo: {
      projectOwner: val('billTo.projectOwner'),
      address: val('billTo.address'),
      projectRef: val('billTo.projectRef'),
    },
    issuer: {
      name: val('issuer.name'),
      address: val('issuer.address'),
      contact: val('issuer.contact'),
    },
    lines,
    paymentSchedule: {
      enabled: checked('paymentSchedule.enabled'),
      totalProject: val('paymentSchedule.totalProject'),
      terms,
    },
    tax: {
      enabled: checked('tax.enabled'),
      mode: get('tax.mode')?.value === 'amount' ? 'amount' : 'percent',
      rate: val('tax.rate'),
      amount: val('tax.amount'),
      label: val('tax.label'),
    },
    payment: {
      transferVia: val('payment.transferVia'),
      bankLines: val('payment.bankLines'),
      instructions: val('payment.instructions'),
    },
    signature: {
      signerName: val('signature.signerName'),
      signerTitle: val('signature.signerTitle'),
    },
  };
}

export function writeInvoiceToForm(root, invoice) {
  const set = (id, value) => {
    const el = root.querySelector(idSelector(id));
    if (el) el.value = value ?? '';
  };
  const setChecked = (id, value) => {
    const el = root.querySelector(idSelector(id));
    if (el) el.checked = Boolean(value);
  };

  set('invoiceNo', invoice.invoiceNo);
  set('invoiceDate', invoice.invoiceDate);
  set('dueDate', invoice.dueDate);
  set('notes', invoice.notes);
  set('billTo.projectOwner', invoice.billTo.projectOwner);
  set('billTo.address', invoice.billTo.address);
  set('billTo.projectRef', invoice.billTo.projectRef);
  set('issuer.name', invoice.issuer.name);
  set('issuer.address', invoice.issuer.address);
  set('issuer.contact', invoice.issuer.contact);
  set('tax.rate', invoice.tax.rate);
  set('tax.amount', invoice.tax.amount);
  set('tax.label', invoice.tax.label);
  set('payment.transferVia', invoice.payment.transferVia);
  set('payment.bankLines', invoice.payment.bankLines);
  set('payment.instructions', invoice.payment.instructions);
  set('signature.signerName', invoice.signature.signerName);
  set('signature.signerTitle', invoice.signature.signerTitle);
  set('paymentSchedule.totalProject', invoice.paymentSchedule.totalProject);
  setChecked('tax.enabled', invoice.tax.enabled);
  setChecked('paymentSchedule.enabled', invoice.paymentSchedule.enabled);
  const modeEl = root.querySelector('#tax\\.mode');
  if (modeEl) modeEl.value = invoice.tax.mode;
}

export function renderLines(root, invoice, totals, { onRemove } = {}) {
  const container = root.querySelector('#lines');
  container.textContent = '';
  invoice.lines.forEach((line, index) => {
    const row = docOf(root).createElement('div');
    row.className = `line-row${line.kind === 'adjustment' ? ' is-adjustment' : ''}`;
    row.dataset.id = line.id;
    row.dataset.kind = line.kind;

    const descWrap = docOf(root).createElement('div');
    descWrap.className = 'line-desc';
    if (line.kind === 'adjustment') {
      const tag = docOf(root).createElement('span');
      tag.className = 'line-kind';
      tag.textContent = 'adjustment';
      descWrap.append(tag);
    }
    const desc = docOf(root).createElement('input');
    desc.type = 'text';
    desc.dataset.field = 'desc';
    desc.placeholder = line.kind === 'adjustment' ? 'mis. Diskon kontrak' : 'uraian pekerjaan / barang';
    desc.value = line.desc;
    desc.setAttribute('aria-label', `Uraian baris ${index + 1}`);

    const note = docOf(root).createElement('input');
    note.type = 'text';
    note.dataset.field = 'note';
    note.placeholder = 'catatan kecil (opsional)';
    note.value = line.note;
    note.setAttribute('aria-label', `Catatan baris ${index + 1}`);

    descWrap.append(desc, note);

    const qty = input(root, 'qty', line.qty, `Qty baris ${index + 1}`);
    const unit = input(root, 'unit', line.unit, `Satuan baris ${index + 1}`);
    const price = input(root, 'unitPrice', line.unitPrice, `Harga baris ${index + 1}`);

    const amount = docOf(root).createElement('div');
    amount.className = 'line-amount';
    const rowTotals = totals.lines[index];
    if (rowTotals && rowTotals.amount !== null) {
      amount.textContent = formatRupiah(rowTotals.amount);
      if (rowTotals.amount < 0n) amount.classList.add('is-negative');
    } else {
      amount.textContent = '—';
    }

    const remove = docOf(root).createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-danger btn-icon line-remove';
    remove.textContent = '×';
    remove.title = `Hapus baris ${index + 1}`;
    remove.setAttribute('aria-label', `Hapus baris ${index + 1}`);
    remove.addEventListener('click', () => onRemove?.(line.id));

    row.append(descWrap, qty, unit, price, amount, remove);
    container.append(row);
  });
}

function input(root, field, value, label) {
  const el = docOf(root).createElement('input');
  el.type = 'text';
  el.dataset.field = field;
  el.value = value ?? '';
  el.setAttribute('aria-label', label);
  el.autocomplete = 'off';
  if (field === 'qty' || field === 'unitPrice') el.inputMode = 'decimal';
  return el;
}

export function renderTerms(root, invoice, { onRemove } = {}) {
  const container = root.querySelector('#terms');
  container.textContent = '';
  invoice.paymentSchedule.terms.forEach((term, index) => {
    const row = docOf(root).createElement('div');
    row.className = 'term-row';
    row.dataset.id = term.id;

    const mk = (field, val, label, inputMode) => {
      const el = docOf(root).createElement('input');
      el.type = 'text';
      el.dataset.field = field;
      el.value = val ?? '';
      el.setAttribute('aria-label', `${label} termin ${index + 1}`);
      el.autocomplete = 'off';
      if (inputMode) el.inputMode = inputMode;
      return el;
    };

    const remove = docOf(root).createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-danger btn-icon';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Hapus termin ${index + 1}`);
    remove.addEventListener('click', () => onRemove?.(term.id));

    row.append(
      mk('label', term.label, 'Label'),
      mk('percent', term.percent, 'Persen', 'decimal'),
      mk('amount', term.amount, 'Nominal', 'decimal'),
      remove,
    );
    container.append(row);
  });
}

export function renderPreview(root, invoice, totals) {
  const { templateId } = templateIdentity(invoice);
  const kabineku = templateId === 'kabineku';
  root.querySelector('#paper').dataset.template = templateId;
  root.querySelector('#pv-noir-logo').hidden = kabineku;
  root.querySelector('#pv-kabineku-logo').hidden = !kabineku;
  root.querySelectorAll('.template-cards [data-template]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.template === templateId));
  });
  const text = (id, value) => {
    const el = root.querySelector(idSelector(id));
    if (el) el.textContent = value;
  };

  const issuerLines = [invoice.issuer.name, invoice.issuer.address, invoice.issuer.contact].filter((v) => v && v.trim());
  text('pv-issuer', issuerLines.join('\n') || 'Penerbit belum diisi');
  text('pv-owner', invoice.billTo.projectOwner || '—');
  text('pv-address', invoice.billTo.address || '—');
  text('pv-date', formatDateShort(invoice.invoiceDate) || '—');
  text('pv-no', invoice.invoiceNo || '—');
  const dueRow = root.querySelector('#pv-due-row');
  if (dueRow) dueRow.hidden = !invoice.dueDate;
  text('pv-due', formatDateShort(invoice.dueDate) || '—');

  const tbody = root.querySelector('#pv-lines');
  tbody.textContent = '';
  let n = 0;
  totals.lines.forEach((row) => {
    if (row.blank) return;
    n += 1;
    const tr = docOf(root).createElement('tr');
    if (row.kind === 'adjustment') tr.className = 'is-adjustment';
    const cells = [
      String(n),
      row.desc || '—',
      row.qtyScaled === null ? '—' : formatQty(row.qtyScaled),
      row.unit || '',
      row.unitPrice === null ? '—' : formatRupiah(row.unitPrice),
      row.amount === null ? '—' : formatRupiah(row.amount),
    ];
    cells.forEach((value, i) => {
      const td = docOf(root).createElement('td');
      if (i === 1) {
        td.textContent = value;
        if (row.note) {
          const span = docOf(root).createElement('span');
          span.className = 'note';
          span.textContent = row.note;
          td.append(span);
        }
      } else {
        td.textContent = value;
      }
      tr.append(td);
    });
    tbody.append(tr);
  });
  if (n === 0) {
    const tr = docOf(root).createElement('tr');
    const td = docOf(root).createElement('td');
    td.colSpan = 6;
    td.textContent = 'Belum ada baris invoice.';
    td.style.color = 'var(--ink-mute)';
    tr.append(td);
    tbody.append(tr);
  }

  const projectRef = invoice.billTo.projectRef.trim();
  text('pv-project', projectRef ? `for project ${projectRef}` : '');

  const schedule = root.querySelector('#pv-schedule');
  schedule.textContent = '';
  if (invoice.paymentSchedule.enabled) {
    const h = docOf(root).createElement('h5');
    h.textContent = 'Payment Schedule:';
    schedule.append(h);
    if (invoice.paymentSchedule.totalProject.trim()) {
      const d = docOf(root).createElement('div');
      d.textContent = `Total Project: IDR ${invoice.paymentSchedule.totalProject.trim()}`;
      schedule.append(d);
    }
    invoice.paymentSchedule.terms.forEach((term, i) => {
      if (!term.label.trim() && !term.amount.trim() && !term.percent.trim()) return;
      const d = docOf(root).createElement('div');
      const pct = term.percent.trim() ? ` (${term.percent.trim()}%)` : '';
      d.textContent = `${term.label.trim() || `Term ${i + 1}`}${pct}: IDR ${term.amount.trim() || '—'}`;
      schedule.append(d);
    });
  }

  const summary = root.querySelector('#pv-summary');
  summary.textContent = '';
  const taxLabel = totals.taxEnabled ? totals.taxLabel || 'Tax' : 'Tax Rate';
  const rows = [
    { label: 'Total', value: formatRupiah(totals.total), strong: false },
    { label: taxLabel, value: totals.taxEnabled ? formatRupiah(totals.tax) : '0%', strong: false },
    { label: 'Grand Total', value: formatRupiah(totals.grandTotal), strong: true },
  ];
  rows.forEach((row) => {
    const div = docOf(root).createElement('div');
    div.className = `row${row.strong ? ' is-strong' : ''}`;
    const l = docOf(root).createElement('span');
    l.textContent = row.label;
    const v = docOf(root).createElement('span');
    v.textContent = row.value;
    div.append(l, v);
    summary.append(div);
  });

  text('pv-via', invoice.payment.transferVia || '__________________');
  text('pv-bank', invoice.payment.bankLines || '(rekening belum diisi — bukan rekening contoh)');
  text('pv-instructions', invoice.payment.instructions || '');
  text('pv-notes', invoice.notes ? `Catatan: ${invoice.notes}` : '');
  text('pv-signer', invoice.signature.signerName || '(nama penandatangan belum diisi)');
  text('pv-signer-title', invoice.signature.signerTitle || '');
  text('pv-footer-left', invoice.invoiceNo ? `Invoice ${invoice.invoiceNo}` : 'Tanpa nomor invoice (draf)');

  const status = root.querySelector('#pv-status');
  const check = validateForFinal(invoice, totals);
  status.textContent = check.ok ? 'SIAP — FIELD WAJIB TERISI' : 'DRAF — BELUM DOKUMEN FINAL';
  status.classList.toggle('is-final', check.ok);

  const badge = root.querySelector('#draft-badge');
  badge.textContent = check.ok ? 'SIAP' : 'DRAF';
  badge.classList.toggle('pill-final', check.ok);
  badge.classList.toggle('pill-draft', !check.ok);

  return check;
}

export function renderIssues(root, check) {
  const box = root.querySelector('#issues');
  const items = [...check.errors, ...check.warnings.map((w) => `Peringatan: ${w}`)];
  if (items.length === 0) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.hidden = false;
  box.textContent = '';
  const h = docOf(root).createElement('h4');
  h.textContent = check.errors.length ? `Belum bisa jadi PDF final (${check.errors.length} masalah)` : 'Catatan';
  box.append(h);
  const ul = docOf(root).createElement('ul');
  check.errors.forEach((e) => {
    const li = docOf(root).createElement('li');
    li.textContent = e;
    ul.append(li);
  });
  check.warnings.forEach((w) => {
    const li = docOf(root).createElement('li');
    li.className = 'warn-item';
    li.textContent = `Peringatan: ${w}`;
    ul.append(li);
  });
  box.append(ul);
}

export function renderDrafts(root, drafts, currentId, handlers = {}) {
  const container = root.querySelector('#drafts');
  const count = root.querySelector('#draft-count');
  if (count) count.textContent = String(drafts.length);
  container.textContent = '';
  if (drafts.length === 0) {
    const empty = docOf(root).createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Belum ada draft tersimpan. Isi form lalu tekan “Simpan draft”.';
    container.append(empty);
    return;
  }
  drafts.forEach((draft) => {
    const card = docOf(root).createElement('div');
    card.className = `draft-card${draft.id === currentId ? ' is-current' : ''}`;
    card.dataset.id = draft.id;

    const main = docOf(root).createElement('div');
    main.className = 'draft-main';
    const title = docOf(root).createElement('div');
    title.className = 'draft-title';
    const no = docOf(root).createElement('span');
    no.textContent = draft.invoiceNo || '(tanpa nomor)';
    title.append(no);
    const pill = docOf(root).createElement('span');
    pill.className = `pill ${draft.isDraft ? 'pill-warn' : 'pill-ok'}`;
    pill.textContent = draft.isDraft ? 'draf' : 'lengkap';
    title.append(pill);

    const meta = docOf(root).createElement('div');
    meta.className = 'draft-meta';
    const parts = [
      draft.billTo || '(penerima belum diisi)',
      draft.invoiceDate || 'tanpa tanggal',
      `total ${draft.grandTotal}`,
      `${draft.lineCount} baris`,
      new Date(draft.updatedAt).toLocaleString('id-ID'),
    ];
    meta.textContent = parts.join(' · ');

    main.append(title, meta);

    const actions = docOf(root).createElement('div');
    actions.className = 'draft-actions';
    const mkBtn = (label, cls, fn) => {
      const b = docOf(root).createElement('button');
      b.type = 'button';
      b.className = `btn btn-ghost ${cls}`;
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    actions.append(
      mkBtn('Buka', '', () => handlers.onOpen?.(draft.id)),
      mkBtn('Ekspor', '', () => handlers.onExport?.(draft.id)),
      mkBtn('Hapus', 'btn-danger', () => handlers.onDelete?.(draft.id)),
    );
    card.append(main, actions);
    container.append(card);
  });
}

export { computeTotals };
