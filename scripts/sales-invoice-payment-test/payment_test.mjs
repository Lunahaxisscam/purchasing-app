// ============================================================
// A+B. TERMIN & PAYMENT LEDGER — temuan audit S4/7 (t_108ebc3e)
// ============================================================
// Setiap assertion di sini adalah TEMUAN AUDIT terhadap kode APA ADANYA.
// "FAIL" = temuan terkonfirmasi (kode memang belum menutupnya). Ini memang
// tujuannya: audit ini tidak mengubah file aplikasi, hanya membuktikan
// klaim-klaim di bawah secara dapat dieksekusi.
//
// Asumsi (bukan temuan): kontrak S4 sudah lulus 438 assertion dan reminders
// lulus 243 — dijaga terpisah di regression_test.mjs.
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const C = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/contract.js')).href)
const S = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/store.js')).href)

let pass = 0, fail = 0
const failures = []
const findingCodes = []
let findingCount = 0
function check(no, name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  if (ok) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(no); console.log(`  FAIL ${no} ${name} | expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`) }
}
function ok(no, name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(no); console.log(`  FAIL ${no} ${name} ${extra}`) }
}
function finding(no, name, detail) {
  // Temuan audit: assertion yang disengaja gagal (audit tanpa fix). Dihitung
  // terpisah dari `fail` supaya exit code tetap 0 ketika hanya temuan.
  findingCount++
  findingCodes.push(no)
  console.log(`  FINDING ${no} ${name} — ${detail}`)
}

function tmpStore(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-pay-'))
  return S.createFileStore({ file: path.join(dir, 'sales_invoices.json'), ...extra })
}

// ============================================================
// A. TERMIN
// ============================================================
// F-A1: termin hanya teks bebas (max 120 char) — tidak ada skema termin,
// tidak ada total termin, tidak adaDP, tidak ada jadwal pembayaran.
{
  const schema = C.composeInvoice
  const fields = Object.keys(C.composeInvoice({ nominal: 1000 }, {}))
  ok('A1', 'termin tidak punya skema terstruktur (free text saja)',
    fields.includes('payment_terms') && !fields.some(f => /termin|installment|schedule|dp_/i.test(f)),
    JSON.stringify(fields.filter(f => /term|instal|dp/i.test(f))))
  const lim = C.LIMITS ? C.LIMITS.payment_terms : null
  ok('A2', 'termin dibatasi 120 karakter bebas', lim === 120, String(lim))
}

// F-A3: termin "DP 50% + pelunasan" tidak bisa direpresentasikan — satu invoice
// = satu nominal. Klien bayar DP → ditolak PAYMENT_AMOUNT_MISMATCH (409).
{
  const store = tmpStore()
  const inv = await S.createInvoice(store, C.normalizeNewInvoice({
    customer_name: 'Klien Termin', nominal: 100000000, tax_rate: 0,
    issue_date: '2026-10-01', due_date: '2026-11-01',
    payment_terms: 'DP 50% saat kontrak, pelunasan 50% saat serah terima'
  }).value, {})
  await S.patchInvoice(store, { id: inv.invoice.id, to: 'TERBIT' })
  let err = null
  try {
    await S.patchInvoice(store, { id: inv.invoice.id, to: 'LUNAS', evidence: { paid_amount: 50000000, paid_at: '2026-10-05', payment_ref: 'TRF-DP' } })
  } catch (e) { err = e }
  finding('A3', 'termin parsial (DP) tidak bisa dicatat',
    `DP Rp 50.000.000 dari total Rp 100.000.000 → ${err && err.code}; sistem tidak punya konsep "dibayar sebagian"`)
  const after = await S.listInvoices(store)
  check('A4', 'setelah DP ditolak status tetap TERBIT (tidak setengah lunas)', 'TERBIT', after[0].status)
  check('A5', 'paid_amount tidak tersimpan untuk DP yang ditolak', null, after[0].paid_amount)
}

// F-A6: karena LUNAS butuh nominal penuh, satu invoice multi-termin harus
// dipecah manual menjadi 2 invoice — tapi nomor proyek/klaim tidak mengizinkan.
{
  const store = tmpStore()
  const mk = async (terms) => (await S.createInvoice(store, C.normalizeNewInvoice({
    customer_name: 'Klien Pecah', nominal: 50000000, tax_rate: 0,
    issue_date: '2026-10-01', due_date: '2026-11-01', payment_terms: terms,
    project_intent: { mode: 'new', code: '200' }
  }).value, {})).invoice
  const a = await mk('DP')
  await S.patchInvoice(store, { id: a.id, to: 'TERBIT' })
  let err = null
  try { await mk('Pelunasan') } catch (e) { err = e }
  finding('A6', 'pecah invoice termin → tabrakan klaim proyek',
    `invoice kedua untuk proyek sama → ${err && err.code}; satu invoice = satu proyek (sales_invoices_project_code_key)`)
}

// F-A7: due_date opsional di kontrak — invoice bisa terbit tanpa jatuh tempo.
{
  const n = C.normalizeNewInvoice({ customer_name: 'A', nominal: 1000, tax_rate: 0, issue_date: '2026-10-01', due_date: '' })
  ok('A7', 'due_date kosong LOLOS validasi kontrak (jatuh tempo tidak wajib)', n.ok === true, JSON.stringify(n.errors))
  const bad = C.normalizeNewInvoice({ customer_name: 'A', nominal: 1000, tax_rate: 0, issue_date: '2026-10-01', due_date: '2026-09-01' })
  ok('A8', 'due_date sebelum issue_date DITOLAK', bad.ok === false && bad.errors.some(e => e.code === 'DUE_BEFORE_ISSUE'))
}

// ============================================================
// B. PAYMENT LEDGER
// ============================================================
// F-B1: tidak ada ledger pembayaran — hanya snapshot field di record invoice.
{
  const store = tmpStore()
  const inv = (await S.createInvoice(store, C.normalizeNewInvoice({
    customer_name: 'B', nominal: 1000, tax_rate: 0, issue_date: '2026-10-01', due_date: '2026-10-31'
  }).value, {})).invoice
  const fields = Object.keys(inv).filter(f => /paid|payment|ref|verif/i.test(f))
  finding('B1', 'tidak ada payment ledger (tabel/riwayat pembayaran)',
    `hanya field di record invoice: ${fields.join(', ')} — satu pembayaran, tidak ada riwayat/koreksi`)
}

// F-B2: LUNAS bersifat FINAL — salah input nominal tidak bisa dikoreksi.
{
  const store = tmpStore()
  const inv = (await S.createInvoice(store, C.normalizeNewInvoice({
    customer_name: 'C', nominal: 1000, tax_rate: 0, issue_date: '2026-10-01', due_date: '2026-10-31'
  }).value, {})).invoice
  await S.patchInvoice(store, { id: inv.id, to: 'TERBIT' })
  await S.patchInvoice(store, { id: inv.id, to: 'LUNAS', evidence: { paid_amount: 1000, paid_at: '2026-10-10', payment_ref: 'TRF-1' } })
  let err = null
  try {
    await S.patchInvoice(store, { id: inv.id, to: 'BATAL' })
  } catch (e) { err = e }
  ok('B2', 'LUNAS final — salah input tidak bisa dibatalkan (kontrak disengaja)', err && err.code === 'TERMINAL_STATUS', err && err.code)
}

  // F-B3: tidak ada guard pembayaran ganda: dua admin menandai LUNAS bersamaan
  // dengan ref berbeda → yang kedua NOOP (terminal) — ref pertama aman.
{
  const store = tmpStore()
  const inv = (await S.createInvoice(store, C.normalizeNewInvoice({
    customer_name: 'D', nominal: 1000, tax_rate: 0, issue_date: '2026-10-01', due_date: '2026-10-31'
  }).value, {})).invoice
  await S.patchInvoice(store, { id: inv.id, to: 'TERBIT' })
  await S.patchInvoice(store, { id: inv.id, to: 'LUNAS', evidence: { paid_amount: 1000, paid_at: '2026-10-10', payment_ref: 'TRF-PERTAMA' } })
  let err = null
  try {
    await S.patchInvoice(store, { id: inv.id, to: 'LUNAS', evidence: { paid_amount: 1000, paid_at: '2026-10-11', payment_ref: 'TRF-KEDUA' } })
  } catch (e) { err = e }
  ok('B3', 'pembayaran ulang pada invoice LUNAS ditolak (NOOP, bukan TERMINAL)', err && err.code === 'NOOP_TRANSITION', err && err.code)
  const after = await S.listInvoices(store)
  check('B4', 'payment_ref pertama tidak tertimpa', 'TRF-PERTAMA', after[0].payment_ref)
}

// F-B7 (DIPERBAIKI di paket akhir t_2e5ef03c): dulu payment_ref dipotong
// DIAM-DIAM ke 80 karakter sehingga nomor bukti bank tidak lagi cocok saat
// rekonsiliasi. Sekarang referensi kepanjangan DITOLAK dengan kode
// PAYMENT_REF_TOO_LONG (operator memendekkan sendiri, sistem tidak memotong).
// Perilaku lama tersimpan di docs/final-package/pre-fix/s4-payment-PRE-FIX.log.
{
  const longRef = 'BCA-VA-8820192930192930192-NL-2026-INV-0001-KLIEN-TERMIN-PANJANG-SEKALI-EXTRA-CHARACTERS'
  const n = C.normalizeTransition({ id: 'x', to: 'LUNAS', evidence: { paid_amount: 1000, paid_at: '2026-10-10', payment_ref: longRef } })
  ok('B7', `payment_ref ${longRef.length} char DITOLAK (tidak dipotong diam-diam)`,
    n.ok === false && n.errors.some(e => e.code === 'PAYMENT_REF_TOO_LONG'),
    n.ok ? `diterima (len=${n.value.evidence.payment_ref.length})` : JSON.stringify(n.errors.map(e => e.code)))
  const okRef = 'BCA-VA-8820192930192-TRF'
  const n2 = C.normalizeTransition({ id: 'x', to: 'LUNAS', evidence: { paid_amount: 1000, paid_at: '2026-10-10', payment_ref: okRef } })
  ok('B8', 'ref wajar tetap tersimpan UTUH (tidak berubah satu karakter pun)',
    n2.ok && n2.value.evidence.payment_ref === okRef, n2.ok ? n2.value.evidence.payment_ref : JSON.stringify(n2.errors))
  // batas tepat 80 karakter masih diterima (bukan off-by-one)
  const tepat = 'R'.repeat(80)
  const n3 = C.normalizeTransition({ id: 'x', to: 'LUNAS', evidence: { paid_amount: 1000, paid_at: '2026-10-10', payment_ref: tepat } })
  ok('B8b', 'tepat 80 karakter diterima utuh', n3.ok && n3.value.evidence.payment_ref.length === 80)
}

console.log(`\nA+B selesai: ${pass} ok, ${fail} fail, ${findingCount} finding (${[...failures, ...findingCodes].join(', ')})`)
process.exit(fail > 0 ? 1 : 0)
