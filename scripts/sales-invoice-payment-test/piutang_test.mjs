// ============================================================
// C+D. PIUTANG, OVERDUE & KPI CASHFLOW — temuan audit S4/7 (t_108ebc3e)
// ============================================================
// C) Piutang/overdue: definisi outstanding, hitungan hari, batas sumber data.
// D) Cashflow & KPI: apa yang dipakai UI sebagai "omzet/lunas/piutang".
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const R = await import(pathToFileURL(path.join(SB, 'scripts/reminders/rules.js')).href)
const V = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/view.compiled.mjs')).href)

const ALL_SOURCES = ['purchase_requests', 'pr_items', 'approval_steps', 'receivings', 'receiving_items', 'handovers', 'projects', 'sales_invoices']
function src(key, available = true, rowCount = 1) {
  return { key, table: key, available, row_count: rowCount, fetched: rowCount, truncated: false, columns: [], error_code: available ? null : 'SCHEMA_UNAVAILABLE', error_message: available ? null : 'tidak ada' }
}
function sources(opts = {}) {
  return ALL_SOURCES.map(k => src(k, opts[k] !== false, opts[k] === false ? 0 : 1))
}

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

function report(ds, asOf) {
  return R.buildReport({
    dataset: ds,
    asOf,
    sources: sources(),
    thresholds: R.DEFAULT_THRESHOLDS
  })
}
function itemsOf(rep, kind) {
  return rep.items.filter(i => i.kind === kind)
}

// ============================================================
// C. PIUTANG / OVERDUE
// ============================================================
// F-C1: outstanding = daftar status, TIDAK dikurangi paid_amount. Invoice
// dengan paid_amount 50% (data dari importer apa adanya) tetap 100% piutang.
{
  const ds = { sales_invoices: [{ id: 'x1', status: 'TERKIRIM', invoice_no: 'NL2610001', grand_total: 100000000, due_date: '2026-10-01', paid_amount: 50000000 }] }
  const it = itemsOf(report(ds, '2026-10-18'), 'invoice_due')
  ok('C1', 'invoice ber-paid_amount parsial tetap outstanding penuh (sengaja)', it.length === 1)
  ok('C2', 'detail reminder TIDAK menyebut sisa tagihan setelah paid_amount',
    it.length === 1 && !/sisa|tersisa/i.test(it[0].detail || ''),
    JSON.stringify(it[0] && it[0].detail))
  finding('C3', 'piutang = nominal penuh walau sudah ada pembayaran parsial',
    'reminder tidak mengurangi paid_amount; tanpa termin tersistem, "sudah bayar 50%" tidak terlihat di piutang')
}

// F-C4 (DIPERBAIKI di paket akhir t_2e5ef03c): dulu hari "hari ini" diambil
// dari UTC sehingga di WIB pagi tanggal bergeser −1 dan invoice yang jatuh
// tempo HARI INI tidak masuk overdue. Sekarang todayISO/toDateOnly memakai
// tanggal kalender Asia/Jakarta. Assertion di bawah mengunci perilaku BENAR
// (bukti perilaku lama tersimpan di
// docs/final-package/pre-fix/s4-payment-PRE-FIX.log).
{
  const wibMorning = new Date('2026-10-18T01:00:00+07:00')  // 18 Okt 09:00 WIB
  const asOfToday = R.todayISO(wibMorning)
  check('C4', 'todayISO = tanggal kalender WIB (09:00 WIB tetap 18 Okt)', '2026-10-18', asOfToday)
  const late = R.daysBetween('2026-10-18', asOfToday)
  check('C5', 'jatuh tempo HARI INI = 0 hari (bukan -1)', 0, late)
  const it = itemsOf(report({ sales_invoices: [{ id: 'y1', status: 'TERBIT', invoice_no: 'NL2610002', customer_name: 'A', grand_total: 1000, due_date: '2026-10-18', issue_date: '2026-10-01' }] }, asOfToday), 'invoice_due')
  ok('C6', 'jatuh tempo hari ini tidak salah masuk overdue, tetap terpantau',
    it.length === 1 && !it[0].id.includes(':overdue:') && it[0].overdue_days == null,
    JSON.stringify(it.map(i => ({ id: i.id, days: i.overdue_days }))))
  // bukti arah sebaliknya: kemarin (WIB) memang overdue 1 hari
  const kemarin = itemsOf(report({ sales_invoices: [{ id: 'y2', status: 'TERBIT', invoice_no: 'NL2610003', customer_name: 'A', grand_total: 1000, due_date: '2026-10-17', issue_date: '2026-10-01' }] }, asOfToday), 'invoice_due')
  ok('C7 (tertutup)', 'jatuh tempo kemarin = overdue 1 hari di WIB pagi',
    kemarin.length === 1 && kemarin[0].id.includes(':overdue:') && kemarin[0].overdue_days === 1,
    JSON.stringify(kemarin.map(i => ({ id: i.id, days: i.overdue_days }))))
}

// F-C8: tidak ada aging bucket (0-30/31-60/61-90/>90) — hanya overdue + soon.
{
  const rep = report({ sales_invoices: [] }, '2026-10-18')
  const text = JSON.stringify(rep)
  ok('C8', 'tidak ada aging bucket 30/60/90 hari', !/aging|30|60|90 hari/.test(text))
}

// F-C9: batas baca 1000 baris — piutang di atas itu terpotong tanpa tanda.
{
  const ds = { sales_invoices: Array.from({ length: 1200 }, (_, i) => ({ id: `z${i}`, status: 'TERBIT', invoice_no: `NL26${i}`, grand_total: 1000, due_date: '2026-01-01' })) }
  const rep = report(ds, '2026-10-18')
  const it = itemsOf(rep, 'invoice_due')
  check('C9', 'semua 1200 invoice outstanding muncul di laporan (harness langsung)', 1200, it.length)
  finding('C10', 'collect.js membatasi 1000 baris (MAX 5000) — piutang besar terpotong',
    'DEFAULT_ROW_LIMIT=1000: laporan "lengkap" padahal sebagian invoice tidak pernah dibaca; tidak ada penanda "terpotong"')
}

// F-C11: DISETUJUI & TERBIT dihitung piutang walau dokumen belum dikirim.
{
  const ds = { sales_invoices: [
    { id: 't1', status: 'TERBIT', invoice_no: 'NL2610010', customer_name: 'A', grand_total: 1000000, due_date: '2026-10-01', issue_date: '2026-10-01' },
    { id: 't2', status: 'DISETUJUI', invoice_no: 'NL2610011', customer_name: 'B', grand_total: 2000000, due_date: '2026-10-01', issue_date: '2026-10-01' }
  ] }
  const it = itemsOf(report(ds, '2026-10-18'), 'invoice_due')
  check('C11', 'TERBIT & DISETUJUI masuk daftar tagihan outstanding', 2, it.length)
}

// F-C12: TERKIRIM (dokumen sudah ke klien) tidak lebih diprioritaskan daripada
// TERBIT — piutang belum tentu invoice yang sudah diserahkan ke klien.
{
  const ds = { sales_invoices: [
    { id: 'u1', status: 'TERBIT', invoice_no: 'NL2610012', customer_name: 'A', grand_total: 1000, due_date: '2026-10-01', issue_date: '2026-10-01' },
    { id: 'u2', status: 'TERKIRIM', invoice_no: 'NL2610013', customer_name: 'B', grand_total: 1000, due_date: '2026-10-01', issue_date: '2026-10-01' }
  ] }
  const it = itemsOf(report(ds, '2026-10-18'), 'invoice_due')
  ok('C12', 'tidak ada pembeda status TERKIRIM vs TERBIT di reminder',
    it.length === 2 && new Set(it.map(i => i.sub)).size === 1,
    JSON.stringify(it.map(i => i.sub)))
}

// ============================================================
// D. CASHFLOW & KPI
// ============================================================
// Sejak paket akhir t_2e5ef03c, KPI diuji terhadap FUNGSI ASLI di
// modules/sales-invoice/view.jsx (diekspor `computeInvoiceKpi`), bukan salinan
// lokal — supaya angka KPI yang diuji benar-benar angka yang dirender.
function viewKpi(items) {
  return V.computeInvoiceKpi(items)
}
{
  const items = [
    { status: 'TERBIT', grand_total: 100000000 },   // diterbitkan, belum dikirim
    { status: 'TERKIRIM', grand_total: 20000000 },  // terkirim, belum dibayar
    { status: 'DISETUJUI', grand_total: 30000000 }, // disetujui klien, belum bayar
    { status: 'DITOLAK', grand_total: 50000000 },   // DITOLAK klien
    { status: 'LUNAS', grand_total: 30000000, paid_amount: 30000000 },
    { status: 'BATAL', grand_total: 10000000 },
    { status: 'DRAFT', grand_total: 7000000 }
  ]
  const kpi = viewKpi(items)
  check('D1', 'Total Nilai Tagihan = jumlah SEMUA status (termasuk draf/batal)', 247000000, kpi.totalNominal)
  check('D2', 'DITOLAK ikut dijumlah di Total Nilai Tagihan (label sudah eksplisit)', 57000000, kpi.totalNominal - 190000000)
  check('D3', 'outstanding = 200jt (semua non-DRAFT, non-LUNAS, non-BATAL)', 200000000, kpi.outstanding)
  // D4 (DIPERBAIKI): label kartu kini menyatakan cakupannya, jadi angka ini
  // tidak lagi terbaca sebagai omzet. Yang diuji = labelnya, bukan angkanya.
  const viewSrc = fs.readFileSync(path.join(process.env.SI_REPO, 'modules/sales-invoice/view.jsx'), 'utf8')
  ok('D4 (tertutup)', 'label KPI menyatakan "termasuk draf & batal — bukan omzet"',
    /bukan omzet/.test(viewSrc) && /termasuk draf/.test(viewSrc))
  check('D5', 'LUNAS memakai paid_amount (bukan grand_total)', 30000000, kpi.paid)
  const broken = viewKpi([{ status: 'LUNAS', grand_total: 30000000, paid_amount: null }])
  check('D6', 'LUNAS tanpa paid_amount TIDAK lagi dihitung lunas', 0, broken.paid)
  check('D6b', 'jumlah invoice LUNAS tanpa bukti dilaporkan terpisah', 1, broken.lunasTanpaBukti)
  // D7 (DIPERBAIKI): fallback `paid_amount || grand_total` dihapus; UI memberi
  // tahu berapa invoice yang tidak masuk hitungan.
  ok('D7 (tertutup)', 'UI menyebut jumlah invoice LUNAS tanpa nominal bukti',
    /lunasTanpaBukti/.test(viewSrc) && /tanpa nominal bukti/.test(viewSrc))
}

// F-D8: tidak ada KPI cashflow (kas masuk per bulan) sama sekali.
{
  const src = fs.readFileSync(path.join(process.env.SI_REPO, 'modules/sales-invoice/view.jsx'), 'utf8')
  ok('D8', 'view TIDAK punya KPI kas masuk/cashflow per periode', !/cashflow|cash_flow|kas masuk|per bulan/i.test(src))
}

console.log(`\nC+D selesai: ${pass} ok, ${fail} fail, ${findingCount} finding (${[...failures, ...findingCodes].join(', ')})`)
process.exit(fail > 0 ? 1 : 0)
