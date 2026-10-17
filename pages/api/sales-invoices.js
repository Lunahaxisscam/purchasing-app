import fs from 'fs'
import path from 'path'

const DATA_FILE = path.join(process.cwd(), 'data', 'sales_invoices.json')

function readInvoices() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return []
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error('Failed to read sales_invoices.json:', err)
    return []
  }
}

function writeInvoices(invoices) {
  try {
    const dir = path.dirname(DATA_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const tmp = `${DATA_FILE}.tmp.${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(invoices, null, 2), 'utf8')
    fs.renameSync(tmp, DATA_FILE)
    return true
  } catch (err) {
    console.error('Failed to write sales_invoices.json:', err)
    return false
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const invoices = readInvoices()
    return res.status(200).json({ ok: true, invoices })
  }

  if (req.method === 'POST') {
    const body = req.body || {}
    const {
      invoice_no,
      customer_name,
      customer_phone,
      project_address,
      rab_reff,
      project_name,
      project_code,
      project_id,
      nominal,
      tax_rate,
      tax_amount,
      grand_total,
      notes,
      payment_terms,
      issue_date,
      due_date,
      status
    } = body

    if (!invoice_no || !customer_name) {
      return res.status(400).json({ ok: false, error: 'Nomor invoice dan nama customer wajib diisi.' })
    }

    const invoices = readInvoices()
    // Duplicate check
    const existing = invoices.find(inv => String(inv.invoice_no).trim().toLowerCase() === String(invoice_no).trim().toLowerCase())
    if (existing) {
      return res.status(409).json({ ok: false, error: `Nomor invoice "${invoice_no}" sudah digunakan.` })
    }

    const newInvoice = {
      id: `si_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      invoice_no: String(invoice_no).trim(),
      customer_name: String(customer_name).trim(),
      customer_phone: customer_phone ? String(customer_phone).trim() : '',
      project_address: project_address ? String(project_address).trim() : '',
      rab_reff: rab_reff ? String(rab_reff).trim() : '',
      project_name: project_name ? String(project_name).trim() : '',
      project_code: project_code ? String(project_code).trim() : '',
      project_id: project_id || null,
      nominal: Number(nominal) || 0,
      tax_rate: Number(tax_rate) || 0,
      tax_amount: Number(tax_amount) || 0,
      grand_total: Number(grand_total) || Number(nominal) || 0,
      notes: notes ? String(notes).trim() : '',
      payment_terms: payment_terms ? String(payment_terms).trim() : '',
      issue_date: issue_date || new Date().toISOString().slice(0, 10),
      due_date: due_date || '',
      status: status || 'DRAFT',
      created_at: new Date().toISOString()
    }

    invoices.unshift(newInvoice)
    if (!writeInvoices(invoices)) {
      return res.status(500).json({ ok: false, error: 'Gagal menyimpan invoice ke penyimpanan sistem.' })
    }

    return res.status(201).json({ ok: true, invoice: newInvoice })
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body || {}
    if (!id || !status) {
      return res.status(400).json({ ok: false, error: 'ID dan status wajib diisi.' })
    }

    const invoices = readInvoices()
    const idx = invoices.findIndex(inv => inv.id === id || inv.invoice_no === id)
    if (idx === -1) {
      return res.status(404).json({ ok: false, error: 'Invoice tidak ditemukan.' })
    }

    invoices[idx].status = status
    invoices[idx].updated_at = new Date().toISOString()

    if (!writeInvoices(invoices)) {
      return res.status(500).json({ ok: false, error: 'Gagal memperbarui status invoice.' })
    }

    return res.status(200).json({ ok: true, invoice: invoices[idx] })
  }

  res.setHeader('Allow', ['GET', 'POST', 'PATCH'])
  return res.status(405).json({ ok: false, error: `Method ${req.method} tidak diizinkan.` })
}
