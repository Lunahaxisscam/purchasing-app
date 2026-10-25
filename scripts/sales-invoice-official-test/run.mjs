// Uji PDF template resmi (hasil gabungan generator) TANPA browser.
// Menghasilkan PDF nyata, lalu memeriksa: header %PDF, jumlah halaman, dan
// teks penting (nomor invoice, customer, nominal, termin) benar-benar tercetak.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()
const cache = new Map()

async function load(file) {
  file = resolve(root, file)
  if (cache.has(file)) return cache.get(file)
  let src = readFileSync(file, 'utf8')
  // Paket npm (pdf-lib, @pdf-lib/fontkit) tidak bisa di-resolve dari data: URL —
  // ganti dengan file URL hasil require.resolve.
  for (const m of [...src.matchAll(/from\s+['"]([^.'"][^'"]*)['"]/g)]) {
    const spec = m[1]
    let resolved
    try { resolved = require.resolve(spec) } catch { continue }
    const url = 'file://' + resolved
    src = src.split("'" + spec + "'").join("'" + url + "'").split('"' + spec + '"').join('"' + url + '"')
  }
  const specs = [...src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1])
  for (const spec of new Set(specs)) {
    let p = resolve(dirname(file), spec)
    if (!/\.[cm]?jsx?$/.test(p)) p += '.js'
    const url = await load(p)
    src = src.split("'" + spec + "'").join("'" + url + "'").split('"' + spec + '"').join('"' + url + '"')
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64')
  cache.set(file, url)
  return url
}

const adapter = await import(await load('modules/sales-invoice/official/adapter.js'))
const pdfMod = await import(await load('modules/sales-invoice/official/invoicePdf.js'))

const assets = {
  logoBytes: new Uint8Array(readFileSync(resolve(root, 'public/invoice-assets/noir-logo.jpg'))),
  fontRegular: new Uint8Array(readFileSync(resolve(root, 'public/invoice-assets/Carlito-Regular.ttf'))),
  fontBold: new Uint8Array(readFileSync(resolve(root, 'public/invoice-assets/Carlito-Bold.ttf')))
}

let pass = 0, fail = 0
const t = (name, fn) => { try { fn(); console.log('PASS', name); pass++ } catch (e) { console.log('FAIL', name, '—', e.message); fail++ } }

// --- 1) parsing termin: hanya pola yang benar-benar terbaca ---
const terms = adapter.parsePaymentTerms('DP 30%, Term 2: 40 %, pelunasan 30%')
t('termin terbaca dari teks bebas', () => {
  assert.equal(terms.length, 3)
  assert.equal(terms[0].percent, '30')
  assert.match(terms[0].label, /DP/i)
})
t('teks tanpa persen tidak mengarang termin', () => {
  assert.deepEqual(adapter.parsePaymentTerms('bayar setelah barang datang'), [])
})
t('persen di luar 1..100 diabaikan', () => {
  assert.deepEqual(adapter.parsePaymentTerms('DP 0%'), [])
  assert.deepEqual(adapter.parsePaymentTerms('DP 150%'), [])
})

// --- 2) adapter memetakan record -> model generator tanpa mengarang ---
const record = {
  invoice_no: 'INV/2026/0001',
  customer_name: 'Bpk. Josh',
  project_name: 'Renovasi Mabes',
  project_address: 'Jl. Mabes No. 1, Jakarta',
  rab_reff: 'RAB-83',
  issue_date: '2026-10-24',
  due_date: '2026-11-23',
  nominal: 15000000,
  tax_rate: 11,
  payment_terms: 'DP 30%, Term 2 40%, Pelunasan 30%',
  notes: 'Pembayaran via transfer'
}
const model = adapter.toOfficialInvoice(record)
t('nomor & tanggal invoice ikut record', () => {
  assert.equal(model.invoiceNo, 'INV/2026/0001')
  assert.equal(model.invoiceDate, '2026-10-24')
  assert.equal(model.dueDate, '2026-11-23')
})
t('bill to memakai customer & proyek dari record', () => {
  assert.equal(model.billTo.projectOwner, 'Bpk. Josh')
  assert.equal(model.billTo.projectRef, 'RAB-83')
})
t('nominal record jadi harga baris (tidak dihitung ulang)', () => {
  assert.equal(model.lines.length, 1)
  assert.equal(Number(model.lines[0].unitPrice), 15000000)
})
t('PPN aktif hanya karena record punya tarif', () => {
  assert.equal(model.tax.enabled, true)
  assert.equal(model.tax.rate, '11')
})
t('termin dari payment_terms jadi 3 baris', () => {
  assert.equal(model.paymentSchedule.enabled, true)
  assert.equal(model.paymentSchedule.terms.length, 3)
})
t('record tanpa tarif PPN -> PPN tidak dicetak', () => {
  const m2 = adapter.toOfficialInvoice({ ...record, tax_rate: 0 })
  assert.equal(m2.tax.enabled, false)
})

// --- 3) PDF nyata ---
const { bytes, pageCount } = await pdfMod.buildInvoicePdf({
  invoice: model, ...assets, mode: 'final', watermark: null
})
const out = resolve(root, 'docs/invoice-official-sample.pdf')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.from(bytes))

t('hasil benar-benar PDF (%PDF header)', () => {
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-')
})
t('PDF punya minimal 1 halaman', () => assert.ok(pageCount >= 1, `pageCount=${pageCount}`))
t('PDF berukuran wajar (>20 KB, bukan file kosong)', () => assert.ok(bytes.length > 20000, `${bytes.length} bytes`))
// Font di-embed sebagai subset dengan encoding sendiri, jadi teks TIDAK bisa
// dicari di stream mentah. Ekstrak dengan pdftotext (poppler) — bukti nyata
// bahwa nomor invoice benar-benar tercetak, bukan hanya "PDF terbentuk".
let text = ''
try {
  const { execSync } = require('node:child_process')
  text = execSync(`pdftotext "${out}" -`, { encoding: 'utf8' })
} catch (e) { text = '' }
t('teks dokumen bisa diekstrak (pdftotext tersedia)', () => assert.ok(text.length > 100, 'pdftotext tidak menghasilkan teks'))
t('nomor invoice tercetak di dokumen', () => assert.ok(text.includes('INV/2026/0001'), 'nomor invoice tidak ada di teks PDF'))
t('nama customer tercetak', () => assert.ok(text.includes('Bpk. Josh'), 'customer tidak ada di teks PDF'))
t('termin ikut tercetak', () => assert.ok(/Term|DP/i.test(text), 'tidak ada termin di dokumen'))
console.log(`\nPDF: ${out} (${pageCount} halaman, ${Math.round(bytes.length / 1024)} KB)`)

console.log(JSON.stringify({ pass, fail }))
process.exitCode = fail ? 1 : 0
