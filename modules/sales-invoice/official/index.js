// ============================================================
// modules/sales-invoice/official/index.js — pintu masuk PDF template resmi
// ============================================================
// Satu fungsi dipakai UI: bangun PDF A4 template Noir dari record Invoice
// Penjualan. Aset (logo + font) diambil dari /invoice-assets di public.
// ============================================================
import { buildInvoicePdf } from './invoicePdf.js'
import { loadPdfAssets } from './assets.js'
import { toOfficialInvoice } from './adapter.js'

export { toOfficialInvoice, parsePaymentTerms } from './adapter.js'

/**
 * @param {object} record baris Invoice Penjualan
 * @param {object} [opts] { issuer, payment, signature, mode: 'final'|'draft', assets }
 * @returns {Promise<{bytes: Uint8Array, pageCount: number, invoice: object}>}
 */
export async function buildOfficialInvoicePdf(record, opts = {}) {
  const assets = opts.assets || (await loadPdfAssets())
  const invoice = toOfficialInvoice(record, opts)
  const mode = opts.mode === 'draft' ? 'draft' : 'final'
  const res = await buildInvoicePdf({
    invoice,
    logoBytes: assets.logoBytes,
    fontRegular: assets.fontRegular,
    fontBold: assets.fontBold,
    mode,
    watermark: mode === 'draft' ? 'DRAF' : null
  })
  return { ...res, invoice }
}

export function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'invoice.pdf'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
