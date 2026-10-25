// ============================================================
// modules/sales-invoice/official/adapter.js
// ============================================================
// Menjembatani DUA model yang selama ini terpisah:
//   (1) record Invoice Penjualan di database (`invoice_no`, `customer_name`,
//       `nominal`, `tax_rate`, `payment_terms`, …) — sumber kebenaran
//       penagihan, dan
//   (2) model invoice milik generator resmi (`billTo`, `lines`,
//       `paymentSchedule`, `tax`, `payment`, `signature`) yang dipakai
//       renderer PDF template Noir.
//
// ATURAN KEJUJURAN (sama dengan modul lain): adapter TIDAK mengarang data.
//   - Baris item hanya dibuat dari `project_name` + `nominal` yang benar-benar
//     tercatat; tidak ada item fiktif, tidak ada harga karangan.
//   - Termin hanya aktif bila `payment_terms` berisi pola yang bisa dibaca
//     ("Term 1 50%", "DP 30%", dst). Teks bebas tetap dicetak apa adanya
//     sebagai catatan pembayaran, bukan ditebak menjadi persentase.
//   - Penerbit/pembayaran hanya diisi bila pemanggil memberi data
//     terverifikasi (Settings). Kosong = renderer mencetak penanda jujur.
// ============================================================
import { createEmptyInvoice, createLine, createTerm } from './model.js'

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()

// "Term 1 50%" / "DP 30%" / "Term2: 40 %" -> [{label, percent}]
export function parsePaymentTerms(text) {
  const raw = String(text || '')
  if (!raw.trim()) return []
  const out = []
  const re = /([A-Za-z][A-Za-z0-9 .\-/]{0,24}?)\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/g
  let m
  while ((m = re.exec(raw)) !== null) {
    const label = clean(m[1]).replace(/[:\-=]+$/, '').trim() || `Term ${out.length + 1}`
    const percent = Number(String(m[2]).replace(',', '.'))
    if (isFinite(percent) && percent > 0 && percent <= 100) out.push({ label, percent: String(percent) })
  }
  return out
}

/**
 * record Invoice Penjualan -> model invoice generator resmi.
 * @param {object} record baris invoice (DB atau payload server)
 * @param {object} [opts] { issuer, payment, signature }
 */
export function toOfficialInvoice(record = {}, opts = {}) {
  const inv = createEmptyInvoice(new Date(record.issue_date || Date.now()))
  const nominal = Number(record.nominal) || 0
  const taxRate = Number(record.tax_rate) || 0
  const title = clean(record.project_name) || clean(record.rab_reff) || 'Tagihan pekerjaan'

  inv.invoiceNo = clean(record.invoice_no)
  inv.invoiceDate = clean(record.issue_date) || inv.invoiceDate
  inv.dueDate = clean(record.due_date)
  inv.billTo = {
    projectOwner: clean(record.customer_name),
    address: clean(record.project_address),
    projectRef: clean(record.rab_reff) || clean(record.project_name)
  }

  // Satu baris tagihan = pekerjaan yang tercatat. Nominal dari record, bukan
  // hasil hitung ulang, supaya dokumen tidak pernah berbeda dari nilai yang
  // disetujui server.
  const line = createLine({
    kind: 'item',
    desc: title,
    note: clean(record.notes),
    qty: '1',
    unit: 'ls',
    unitPrice: nominal ? String(Math.round(nominal)) : ''
  })
  inv.lines = [line]

  const terms = parsePaymentTerms(record.payment_terms)
  if (terms.length) {
    // Nominal termin = persen x Grand Total (nominal + PPN), sisa pembulatan
    // dibebankan ke termin terakhir supaya jumlahnya tetap sama dengan total.
    const grand = Math.round(nominal + Math.round(nominal * (taxRate / 100)))
    let used = 0
    const withAmount = terms.map((t, i) => {
      const last = i === terms.length - 1
      const amt = last ? grand - used : Math.round((grand * Number(t.percent)) / 100)
      used += amt
      return createTerm({
        label: t.label,
        percent: t.percent,
        amount: amt ? amt.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') : ''
      })
    })
    inv.paymentSchedule = {
      enabled: true,
      totalProject: nominal ? String(Math.round(nominal)) : '',
      terms: withAmount
    }
  } else {
    inv.paymentSchedule = { enabled: false, totalProject: '', terms: [createTerm({ label: 'Term 1', percent: '' })] }
  }

  inv.tax = taxRate > 0
    ? { enabled: true, mode: 'percent', rate: String(taxRate), amount: '', label: 'PPN' }
    : { enabled: false, mode: 'percent', rate: '', amount: '', label: '' }

  const payment = opts.payment && typeof opts.payment === 'object' ? opts.payment : {}
  inv.payment = {
    transferVia: clean(payment.bank_name),
    bankLines: [clean(payment.account_number), clean(payment.account_holder)].filter(Boolean).join('\n'),
    instructions: clean(record.payment_terms) || clean(record.notes)
  }

  const issuer = opts.issuer && typeof opts.issuer === 'object' ? opts.issuer : {}
  inv.issuer = {
    name: clean(issuer.legal_name),
    address: clean(issuer.address),
    contact: [clean(issuer.phone), clean(issuer.email), clean(issuer.website)].filter(Boolean).join(' · ')
  }

  const sig = opts.signature && typeof opts.signature === 'object' ? opts.signature : {}
  inv.signature = { signerName: clean(sig.signerName), signerTitle: clean(sig.signerTitle) }

  inv.notes = clean(record.notes)
  return inv
}
