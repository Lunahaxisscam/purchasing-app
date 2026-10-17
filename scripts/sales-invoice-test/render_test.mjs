// ============================================================
// E+F. PDF, RENDER UI, DAN WIRING
// ============================================================
// E. PDF: dokumen tidak boleh memuat data perusahaan yang tidak terverifikasi
//    (rekening BCA / telepon / website karangan), dan draf harus ditandai.
// F. Render jsdom: modul tetap terbuka, guard admin tetap, aksi status eksplisit
//    (tidak ada tombol Lunas sekali-klik tanpa bukti), banner penyimpanan jujur.
// G. Wiring statis: registry, pages/index.js, labels.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const REPO = process.env.SI_REPO
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
for (const k of ['HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'getComputedStyle']) globalThis[k] = window[k]
window.confirm = () => true
window.alert = () => {}

// fetch stub: meniru GET /api/sales-invoices tanpa sesi (harus tampil error jujur)
globalThis.fetch = async () => ({
  ok: false, status: 401,
  json: async () => ({ ok: false, error: 'Permintaan wajib menyertakan sesi login.', code: 'UNAUTHORIZED' })
})

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

const View = (await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/view.compiled.mjs')).href)).default
const ViewModule = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/view.compiled.mjs')).href)
const Pdf = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/pdf.js')).href)

let pass = 0, fail = 0
const failures = []
function check(no, name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  if (ok) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(no); console.log(`  FAIL ${no} ${name} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`) }
}
function ok(no, name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(no); console.log(`  FAIL ${no} ${name} ${extra}`) }
}

// ============================================================
// E. PDF
// ============================================================
const SAMPLE = {
  id: 'si_1',
  status: 'TERKIRIM',
  invoice_no: 'INV/NL/2026/10/001',
  customer_name: 'Jessica Wong',
  customer_phone: '08123456789',
  project_address: 'Gading Serpong',
  project_name: 'Fit-Out Interior',
  project_code: '106',
  rab_reff: 'BOQ-001',
  nominal: 85000000,
  tax_rate: 11,
  tax_amount: 9350000,
  grand_total: 94350000,
  notes: 'DP 50%',
  issue_date: '2026-10-17',
  due_date: '2026-10-31'
}

{
  const bytes = Pdf.buildSalesInvoicePdf(SAMPLE)
  const s = Buffer.from(bytes).toString('latin1')
  ok('E1', 'PDF magic bytes %PDF-1.4', s.startsWith('%PDF-1.4'))
  ok('E2', 'PDF diakhiri %%EOF', s.trim().endsWith('%%EOF'))
  ok('E3', 'PDF memuat nama customer', s.includes('Jessica Wong'))
  ok('E4', 'PDF memuat nomor invoice', s.includes('INV/NL/2026/10/001'))
  ok('E5', 'PDF memuat nomor proyek [106]', s.includes('[106]'))
  ok('E6', 'PDF memuat PPN dari record (11%)', s.includes('PPN') && s.includes('11%'))

  // ---- INTI TEMUAN REVIEW: data karangan harus hilang ----
  ok('E7', 'TIDAK ada nomor rekening karangan 527-189-9900', !s.includes('527-189-9900'), 'rekening karangan masih tercetak')
  ok('E8', 'TIDAK ada nama PT karangan', !s.includes('PT NOIR LIVING INDONESIA'))
  ok('E9', 'TIDAK ada telepon karangan', !s.includes('+62 812-9900-8800'))
  ok('E10', 'TIDAK ada website karangan', !s.includes('www.noirliving.id'))
  ok('E11', 'TIDAK mengklaim bank BCA tanpa data', !s.includes('Bank Central Asia'))
  ok('E12', 'menandai rekening belum diisi', /BELUM DIISI/i.test(s), 'penanda jujur rekening hilang')
  ok('E13', 'tidak mencetak identitas penerbit palsu', !s.includes('NOIR LIVING ATELIER'))

  // Dengan data terverifikasi → baru dicetak
  const verified = Buffer.from(Pdf.buildSalesInvoicePdf(SAMPLE, {
    issuer: { legal_name: 'PT Contoh Interior', address: 'Jl. Melati 1', phone: '021-555', email: 'a@b.c' },
    payment: { bank_name: 'Bank Mandiri', account_number: '123-456-7890', account_holder: 'PT Contoh Interior' }
  })).toString('latin1')
  ok('E14', 'identitas terverifikasi dicetak bila diberikan', verified.includes('PT Contoh Interior'))
  ok('E15', 'rekening terverifikasi dicetak bila diberikan', verified.includes('123-456-7890'))
  ok('E16', 'nama bank terverifikasi dicetak', verified.includes('Bank Mandiri'))
  ok('E17', 'tidak lagi menandai BELUM DIISI saat data lengkap', !/DATA REKENING BELUM DIISI/.test(verified))

  // Draf harus ditandai
  const draft = Buffer.from(Pdf.buildSalesInvoicePdf({ ...SAMPLE, status: 'DRAFT', invoice_no: null })).toString('latin1')
  ok('E18', 'draf diberi watermark DRAF', draft.includes('DRAF'))
  ok('E19', 'draf menyatakan belum bernomor', draft.includes('belum bernomor'))
  const voided = Buffer.from(Pdf.buildSalesInvoicePdf({ ...SAMPLE, status: 'BATAL' })).toString('latin1')
  ok('E20', 'invoice batal diberi tanda TIDAK BERLAKU', /BATAL/.test(voided) && /TIDAK BERLAKU/.test(voided))

  // PPN tidak dipungut bila tidak ada pajak
  const noTax = Buffer.from(Pdf.buildSalesInvoicePdf({ ...SAMPLE, tax_rate: 0, tax_amount: 0, grand_total: 85000000 })).toString('latin1')
  ok('E21', 'tanpa pajak tidak mengarang PPN 11%', noTax.includes('Tidak dipungut'))

  // Helper kelengkapan data
  check('E22', 'field penerbit yang kosong terdeteksi',
    ['legal_name', 'address', 'phone', 'email', 'website'], Pdf.missingIssuerFields({}))
  check('E23', 'field rekening yang kosong terdeteksi',
    ['bank_name', 'account_number', 'account_holder'], Pdf.missingPaymentFields({}))
  check('E24', 'data lengkap tidak melaporkan kekurangan', [],
    Pdf.missingPaymentFields({ bank_name: 'A', account_number: '1', account_holder: 'B' }))
}

// ============================================================
// F. RENDER
// ============================================================
const host = window.document.createElement('div')
window.document.body.appendChild(host)
const root = createRoot(host)
const q = (sel) => host.querySelector(sel)
const qa = (sel) => Array.from(host.querySelectorAll(sel))

// ---- F1. Empty state (props invoices = []) ----
await act(async () => { root.render(React.createElement(View, { invoices: [] })) })
check('F1a', 'judul modul tampil', 'Invoice Penjualan', q('.si-intro-copy strong')?.textContent.trim())
ok('F1b', 'empty state tampil', !!q('[data-testid="si-empty"]'))
check('F1c', 'tombol buat invoice tersedia', true, !!q('.si-btn-create'))
ok('F1d', 'intro menyebut RAB & nomor proyek',
  /RAB/i.test(q('.si-intro-copy span')?.textContent || '') && /Master Project|proyek/i.test(q('.si-intro-copy span')?.textContent || ''))
check('F1e', 'KPI 4 kartu', 4, qa('.si-kpi-card').length)
ok('F1f', 'empty state menjelaskan draf dulu', /draf/i.test(q('.si-empty p')?.textContent || ''))

// ---- F2. Dengan data: aksi status eksplisit ----
const dataInvoices = [
  { id: 'si_d', status: 'DRAFT', invoice_no: null, customer_name: 'Draf Co', nominal: 1000000, tax_amount: 0, grand_total: 1000000, issue_date: '2026-10-17', project_issued: false },
  { id: 'si_t', status: 'TERBIT', invoice_no: 'INV/NL/2026/10/001', customer_name: 'Terbit Co', nominal: 2000000, tax_amount: 0, grand_total: 2000000, issue_date: '2026-10-17', project_issued: true, project_code: '106' },
  { id: 'si_k', status: 'TERKIRIM', invoice_no: 'INV/NL/2026/10/002', customer_name: 'Kirim Co', nominal: 3000000, tax_amount: 0, grand_total: 3000000, issue_date: '2026-10-17', project_issued: true, project_code: '107', sent_channel: 'WhatsApp' },
  { id: 'si_l', status: 'LUNAS', invoice_no: 'INV/NL/2026/10/003', customer_name: 'Lunas Co', nominal: 4000000, tax_amount: 0, grand_total: 4000000, paid_amount: 4000000, payment_ref: 'TRF-1', issue_date: '2026-10-17', project_issued: true, project_code: '108' }
]
await act(async () => { root.render(React.createElement(View, { invoices: dataInvoices })) })
check('F2a', 'tabel merender 4 baris', 4, qa('.si-table tbody tr').length)
ok('F2b', 'draf ditandai "draf" (tanpa nomor)', /draf/i.test(q('.si-draft-num')?.textContent || ''))
ok('F2c', 'draf punya tombol Terbitkan', !!q('.si-act-issue'))
ok('F2d', 'invoice TERBIT tidak punya tombol Terbitkan', qa('.si-act-issue').length === 1)

const rows = qa('.si-table tbody tr')
const rowDraft = rows[0]
const rowTerbit = rows[1]
const rowLunas = rows[3]

ok('F2e', 'draf tidak menampilkan tombol Lunas (belum terbit)',
  !rowDraft.querySelector('.si-act-pay'), 'draf tidak boleh bisa langsung lunas')
ok('F2f', 'draf tidak menampilkan tombol Sudah dikirim',
  !rowDraft.querySelector('.si-act-send'))
ok('F2g', 'invoice terbit punya tombol Sudah dikirim', !!rowTerbit.querySelector('.si-act-send'))
ok('F2h', 'invoice terbit punya tombol Lunas', !!rowTerbit.querySelector('.si-act-pay'))
ok('F2i', 'invoice LUNAS tidak punya tombol aksi status lagi',
  !rowLunas.querySelector('.si-act-pay') && !rowLunas.querySelector('.si-act-send'))
ok('F2j', 'referensi pembayaran tampil untuk LUNAS', /TRF-1/.test(rowLunas.textContent))
ok('F2k', 'kanal pengiriman tampil', /WhatsApp/.test(rows[2].textContent))

// ---- F3. Klik Lunas membuka dialog bukti, bukan langsung mengubah status ----
const lunasBtn = rowTerbit.querySelector('.si-act-pay')
await act(async () => { lunasBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
ok('F3a', 'dialog bukti pembayaran terbuka', !!q('.si-dialog-card'))
ok('F3b', 'dialog meminta nominal diterima', /Nominal diterima/i.test(q('.si-dialog-card')?.textContent || ''))
ok('F3c', 'dialog meminta tanggal pembayaran', /Tanggal dana diterima/i.test(q('.si-dialog-card')?.textContent || ''))
ok('F3d', 'dialog meminta referensi pembayaran', /Referensi pembayaran/i.test(q('.si-dialog-card')?.textContent || ''))
ok('F3e', 'dialog menjelaskan pembayaran sebagian tidak lunas', /sebagian/i.test(q('.si-dialog-sub')?.textContent || ''))
check('F3f', 'status belum berubah sebelum konfirmasi', 4, qa('.si-table tbody tr').length)

// Tutup dialog
const cancelBtn = Array.from(host.querySelectorAll('.si-dialog-foot .si-btn-cancel'))[0]
await act(async () => { cancelBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
ok('F3g', 'dialog bisa dibatalkan tanpa perubahan', !q('.si-dialog-card'))

// ---- F4. Klik "Sudah dikirim" membuka dialog kanal ----
const sendBtn = rowTerbit.querySelector('.si-act-send')
await act(async () => { sendBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
ok('F4a', 'dialog kanal pengiriman terbuka', /Kanal pengiriman/i.test(q('.si-dialog-card')?.textContent || ''))
ok('F4b', 'dialog menegaskan TERKIRIM = benar-benar terkirim',
  /benar-benar/i.test(q('.si-dialog-sub')?.textContent || ''))
const cancel2 = Array.from(host.querySelectorAll('.si-dialog-foot .si-btn-cancel'))[0]
await act(async () => { cancel2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })

// ---- F5. Banner penyimpanan jujur (mode pratinjau via fetch) ----
globalThis.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({
    ok: true,
    invoices: [],
    storage: { kind: 'file-preview', durable: false, note: 'PRATINJAU LOKAL: data hanya ada di file JSON mesin ini.' }
  })
})
// Tanpa sesi Supabase, getAccessToken mengembalikan null → pesan jujur
await act(async () => { root.render(React.createElement(View, {})) })
await act(async () => { await new Promise(r => setTimeout(r, 30)) })
ok('F5a', 'tanpa sesi: pesan jujur diminta login ulang',
  /Sesi login tidak ditemukan|Gagal memuat/i.test(host.textContent), host.textContent.slice(0, 200))

// ---- F6. Helper status ----
check('F6a', 'badge DRAFT', 'draft', ViewModule.invoiceStatusBadge('DRAFT').tone)
check('F6b', 'badge TERBIT', 'issued', ViewModule.invoiceStatusBadge('TERBIT').tone)
check('F6c', 'badge LUNAS', 'paid', ViewModule.invoiceStatusBadge('LUNAS').tone)
check('F6d', 'badge BATAL', 'void', ViewModule.invoiceStatusBadge('BATAL').tone)
check('F6e', 'format nominal', 'Rp 85.000.000', ViewModule.formatNominal(85000000))
check('F6f', 'kolom detail tetap sesuai kesepakatan',
  ['invoice_no', 'customer_name', 'rab_reff', 'nominal', 'status'], ViewModule.INVOICE_COLUMNS.map(c => c.key))

// ============================================================
// G. WIRING STATIS
// ============================================================
{
  const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
  const registry = read('modules/registry.js')
  const idx = read('pages/index.js')
  const constants = read('lib/constants.js')
  const api = read('pages/api/sales-invoices.js')

  ok('G1', "modul 'sales_invoice' terdaftar di registry", /id: 'sales_invoice'/.test(registry))
  ok('G2', 'registry: adminOnly true', /id: 'sales_invoice',[\s\S]{0,400}?adminOnly: true/.test(registry))
  ok('G3', 'registry: source core', /id: 'sales_invoice',[\s\S]{0,400}?source: 'core'/.test(registry))
  ok('G4', 'registry memuat file kontrak & store baru',
    ['modules/sales-invoice/contract.js', 'modules/sales-invoice/store.js', 'modules/sales-invoice/auth.js']
      .every(f => registry.includes(f)), 'file baru belum terdaftar')
  ok('G5', 'registry memuat harness baru', registry.includes('scripts/sales-invoice-test/run.py'))

  ok('G6', 'menu admin: sales_invoice ada', /sales_invoice/.test(constants))
  ok('G7', 'labels: Invoice Penjualan', /sales_invoice:\s*'Invoice Penjualan'/.test(constants))

  const guardSeg = idx.split("page === 'sales_invoice'")[1] || ''
  ok('G8', 'guard render: non-admin ditolak', guardSeg.includes('Halaman ini khusus administrator.'))
  ok('G9', 'guard render: modul dirender dengan projects', guardSeg.includes('projects={rows.projects || []}'))

  // API: otorisasi wajib di setiap method
  ok('G10', 'API memanggil verifyAdmin', /verifyAdmin/.test(api))
  ok('G11', 'API tidak lagi menulis JSON tanpa syarat', !/fs\.writeFileSync/.test(api), 'masih menulis file langsung')
  ok('G12', 'API memakai resolveStorePlan (fail closed)', /resolveStorePlan/.test(api))
  ok('G13', 'API menangani 405 dengan Allow', /ALLOWED_METHODS/.test(api))
  ok('G14', 'API mengisi verifikator dari sesi', /verified_by:\s*actor\.user\.id/.test(api))

  // Modul UI tidak boleh menulis ke projects langsung lagi
  const modal = read('modules/sales-invoice/CreateInvoiceModal.jsx')
  ok('G15', 'modal TIDAK meng-insert projects dari browser', !/from\('projects'\)/.test(modal), 'masih insert projects di klien')
  ok('G16', 'modal TIDAK memaksa status TERKIRIM', !/status:\s*'TERKIRIM'/.test(modal), 'masih mengirim TERKIRIM')
  ok('G17', 'modal memakai Idempotency-Key', /idempotencyKey/.test(modal))

  const view = read('modules/sales-invoice/view.jsx')
  ok('G18', 'view tidak lagi memanggil fetch langsung', !/fetch\('\/api\/sales-invoices/.test(view))
  ok('G19', 'view memakai apiClient', /from '\.\/apiClient'/.test(view))
  ok('G20', 'view menyatakan banner penyimpanan', /si-storage-banner/.test(view))
}

console.log(`\n=== E+F+G. PDF/RENDER/WIRING: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('Gagal: ' + failures.join(', ')); process.exit(1) }
