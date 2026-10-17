// ============================================================
// A. KONTRAK MURNI — status, nomor invoice, validasi, uang
// ============================================================
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const SB = process.cwd()
const C = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/contract.js')).href)

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

// ---------- A1. STATUS ----------
check('A1a', 'status dikenal lengkap', 7, C.ALL_STATUSES.length)
ok('A1b', 'TERBIT termasuk status terbit', C.isIssuedStatus('TERBIT'))
ok('A1c', 'DRAFT bukan status terbit', !C.isIssuedStatus('DRAFT'))
check('A1d', 'DRAFT hanya boleh ke TERBIT/BATAL', ['TERBIT', 'BATAL'], C.allowedTransitions('DRAFT'))
ok('A1e', 'DRAFT -> TERKIRIM DITOLAK (tidak boleh lompat)', !C.checkTransition('DRAFT', 'TERKIRIM').ok)
ok('A1e2', 'TERBIT -> LUNAS diizinkan (gerbangnya bukti bayar)', C.checkTransition('TERBIT', 'LUNAS').ok)
ok('A1e3', 'TERBIT -> DISETUJUI ditolak', !C.checkTransition('TERBIT', 'DISETUJUI').ok)
ok('A1f', 'DRAFT -> LUNAS DITOLAK', !C.checkTransition('DRAFT', 'LUNAS').ok)
check('A1g', 'kode penolakan DRAFT->LUNAS', 'INVALID_TRANSITION', C.checkTransition('DRAFT', 'LUNAS').code)
ok('A1h', 'LUNAS final (tidak bisa ke mana pun)', C.allowedTransitions('LUNAS').length === 0)
ok('A1i', 'BATAL final', !C.checkTransition('BATAL', 'TERKIRIM').ok)
check('A1j', 'kode penolakan dari status final', 'TERMINAL_STATUS', C.checkTransition('LUNAS', 'BATAL').code)
ok('A1k', 'transisi sah TERKIRIM -> LUNAS', C.checkTransition('TERKIRIM', 'LUNAS').ok)
ok('A1l', 'status tidak dikenal ditolak', !C.checkTransition('DRAFT', 'DIBAYAR').ok)
check('A1m', 'kode status tujuan tak dikenal', 'UNKNOWN_TARGET_STATUS', C.checkTransition('DRAFT', 'DIBAYAR').code)
ok('A1n', 'noop (status sama) ditolak', !C.checkTransition('TERKIRIM', 'TERKIRIM').ok)
ok('A1o', 'normalisasi status lowercase', 'TERKIRIM', C.normalizeStatus(' terkirim '))

// ---------- A2. NOMOR INVOICE ----------
check('A2a', 'format nomor invoice', 'INV/NL/2026/10/007', C.formatInvoiceNo('2026-10', 7))
ok('A2b', 'parse nomor invoice', C.parseInvoiceNo('INV/NL/2026/10/007').seq === 7)
check('A2c', 'periode dari tanggal', '2026-10', C.invoicePeriod('2026-10-17'))
ok('A2d', 'nomor tidak sesuai format ditolak parse', C.parseInvoiceNo('INV-2026-001') === null)
check('A2e', 'urutan berikutnya = max+1 pada periode sama', 4, C.nextSequenceFromExisting([
  { invoice_no: 'INV/NL/2026/10/001' },
  { invoice_no: 'INV/NL/2026/10/003' },
  { invoice_no: 'INV/NL/2026/09/099' },
  { invoice_no: null }
], '2026-10'))
check('A2f', 'periode lain tidak mempengaruhi urutan', 1, C.nextSequenceFromExisting([
  { invoice_no: 'INV/NL/2026/09/099' }
], '2026-10'))
ok('A2g', 'format periode salah ditolak (throw)', (() => { try { C.formatInvoiceNo('2026/10', 1); return false } catch { return true } })())
ok('A2h', 'urutan 0 ditolak (throw)', (() => { try { C.formatInvoiceNo('2026-10', 0); return false } catch { return true } })())

// ---------- A3. NOMOR PROYEK ----------
check('A3a', 'kode proyek berikutnya = max+1', '106', C.nextNumericProjectCode([{ kode: '83' }, { kode: '105' }]))
check('A3b', 'fallback tanpa proyek', '106', C.nextNumericProjectCode([]))
check('A3c', 'kode non-numerik diabaikan', '12', C.nextNumericProjectCode([{ kode: '11' }, { kode: 'AB-9' }]))
ok('A3d', 'kode proyek terpakai terdeteksi', C.isProjectCodeTaken([{ kode: '106' }], '106'))
ok('A3e', 'kode proyek terpakai case-insensitive', C.isProjectCodeTaken([{ code: 'ab-1' }], 'AB-1'))

// ---------- A4. VALIDASI PEMBUATAN ----------
const base = {
  customer_name: 'Jessica Wong',
  nominal: 85000000,
  tax_rate: 11,
  issue_date: '2026-10-17',
  due_date: '2026-10-31',
  project_intent: { mode: 'new', code: '106' }
}
const good = C.normalizeNewInvoice(base)
ok('A4a', 'payload valid diterima', good.ok, JSON.stringify(good.errors))
check('A4b', 'status awal DIPAKSA DRAFT', 'DRAFT', good.value.status)
check('A4c', 'tax_amount dihitung server', 9350000, good.value.tax_amount)
check('A4d', 'grand_total dihitung server', 94350000, good.value.grand_total)

const lied = C.normalizeNewInvoice({ ...base, tax_amount: 1, grand_total: 5 })
check('A4e', 'tax_amount karangan klien diabaikan', 9350000, lied.value.tax_amount)
check('A4f', 'grand_total karangan klien diabaikan', 94350000, lied.value.grand_total)

const noName = C.normalizeNewInvoice({ ...base, customer_name: '   ' })
ok('A4g', 'nama customer kosong ditolak', !noName.ok)
check('A4h', 'kode error nama kosong', 'REQUIRED', noName.errors[0].code)

ok('A4i', 'nominal 0 ditolak', !C.normalizeNewInvoice({ ...base, nominal: 0 }).ok)
ok('A4j', 'nominal negatif ditolak', !C.normalizeNewInvoice({ ...base, nominal: -5 }).ok)
ok('A4k', 'nominal bukan angka ditolak', !C.normalizeNewInvoice({ ...base, nominal: 'abc' }).ok)
ok('A4l', 'PPN > 100 ditolak', !C.normalizeNewInvoice({ ...base, tax_rate: 150 }).ok)
ok('A4m', 'jatuh tempo sebelum terbit ditolak', !C.normalizeNewInvoice({ ...base, due_date: '2026-10-01' }).ok)
check('A4n', 'kode error jatuh tempo', 'DUE_BEFORE_ISSUE',
  C.normalizeNewInvoice({ ...base, due_date: '2026-10-01' }).errors[0].code)
ok('A4o', 'tanggal format salah ditolak', !C.normalizeNewInvoice({ ...base, issue_date: '17/10/2026' }).ok)

// Status awal selain DRAFT harus DITOLAK (bukan diturunkan diam-diam)
const forced = C.normalizeNewInvoice({ ...base, status: 'TERKIRIM' })
ok('A4p', 'POST dengan status TERKIRIM ditolak', !forced.ok)
check('A4q', 'kode error status awal', 'INITIAL_STATUS_MUST_BE_DRAFT', forced.errors[0].code)
const forcedDraft = C.normalizeNewInvoice({ ...base, status: 'DRAFT' })
ok('A4r', 'POST dengan status DRAFT eksplisit diterima', forcedDraft.ok)

// Nomor invoice dari klien harus DITOLAK
const clientNo = C.normalizeNewInvoice({ ...base, invoice_no: 'INV/NL/2026/10/999' })
ok('A4s', 'invoice_no dari klien ditolak', !clientNo.ok)
check('A4t', 'kode error invoice_no', 'INVOICE_NO_SERVER_ASSIGNED', clientNo.errors[0].code)

// Mode proyek
ok('A4u', 'mode existing tanpa project_id ditolak',
  !C.normalizeNewInvoice({ ...base, project_intent: { mode: 'existing' } }).ok)
ok('A4v', 'mode proyek ngawur ditolak',
  !C.normalizeNewInvoice({ ...base, project_intent: { mode: 'hantu' } }).ok)
ok('A4w', 'kode proyek dengan karakter aneh ditolak',
  !C.normalizeNewInvoice({ ...base, project_intent: { mode: 'new', code: '10 6;drop' } }).ok)

// ---------- A5. VALIDASI TRANSISI ----------
const tSent = C.normalizeTransition({ id: 'si_1', status: 'TERKIRIM' })
ok('A5a', 'TERKIRIM tanpa kanal ditolak', !tSent.ok)
check('A5b', 'kode error kanal', 'EVIDENCE_REQUIRED', tSent.errors[0].code)
const tSentOk = C.normalizeTransition({ id: 'si_1', status: 'TERKIRIM', evidence: { sent_channel: 'WhatsApp' } })
ok('A5c', 'TERKIRIM dengan kanal diterima', tSentOk.ok)
check('A5d', 'kanal tersimpan', 'WhatsApp', tSentOk.value.evidence.sent_channel)

const tPaid = C.normalizeTransition({ id: 'si_1', status: 'LUNAS' })
ok('A5e', 'LUNAS tanpa bukti ditolak', !tPaid.ok)
ok('A5f', 'LUNAS tanpa bukti menyebut semua field', tPaid.errors.length >= 3, JSON.stringify(tPaid.errors.map(e => e.code)))
const tPaidOk = C.normalizeTransition({
  id: 'si_1', status: 'LUNAS',
  evidence: { paid_amount: 94350000, paid_at: '2026-10-20', payment_ref: 'TRF-9911', verified_by: 'palsu-dari-klien' }
})
ok('A5g', 'LUNAS dengan bukti lengkap diterima', tPaidOk.ok)
ok('A5h', 'verified_by dari body TIDAK dipakai', tPaidOk.value.evidence.verified_by === undefined)

ok('A5i', 'transisi tanpa id ditolak', !C.normalizeTransition({ status: 'BATAL' }).ok)
ok('A5j', 'transisi status ngawur ditolak', !C.normalizeTransition({ id: 'x', status: 'DIBAYAR' }).ok)

// ---------- A6. FIELD BEKU ----------
check('A6a', 'field beku setelah terbit', ['nominal', 'grand_total'], C.frozenFieldsTouched({ nominal: 1, grand_total: 2 }))
check('A6b', 'field tidak beku tidak dilaporkan', [], C.frozenFieldsTouched({ notes: 'x' }))
check('A6c', 'invoice_no termasuk field beku', true, C.IMMUTABLE_AFTER_ISSUE.includes('invoice_no'))

// ---------- A7. COMPOSE ----------
const rec = C.composeInvoice(
  { customer_name: 'A', nominal: 1000000, tax_rate: 11, project_intent: { mode: 'new', code: '106' } },
  { id: 'si_x', status: 'DRAFT', invoice_no: 'INV/NL/2026/10/001' }
)
check('A7a', 'draft TIDAK membawa nomor invoice', null, rec.invoice_no)
ok('A7b', 'draft tanpa issued_at', rec.issued_at === null)
check('A7c', 'total tetap dihitung', 1110000, rec.grand_total)
const recIssued = C.composeInvoice(
  { customer_name: 'A', nominal: 1000000, tax_rate: 11 },
  { id: 'si_y', status: 'TERBIT', invoice_no: 'INV/NL/2026/10/001' }
)
check('A7d', 'status terbit membawa nomor', 'INV/NL/2026/10/001', recIssued.invoice_no)
ok('A7e', 'status terbit punya issued_at', !!recIssued.issued_at)
ok('A7f', 'status terbit belum terkirim', recIssued.sent_at === null)

console.log(`\n=== A. KONTRAK: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('Gagal: ' + failures.join(', ')); process.exit(1) }
