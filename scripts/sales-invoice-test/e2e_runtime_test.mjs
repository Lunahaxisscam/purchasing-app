// ============================================================
// H. UJI RUNTIME NYATA — /api/sales-invoices di server Next sungguhan
// ============================================================
// Unit test & jsdom tidak membuktikan endpoint benar-benar menolak/menerima
// di HTTP. Skrip ini menembak server nyata.
//
// Pemakaian:
//   ENABLE_SMOKE=1 npx next build && npx next start -p 3171
//   node scripts/sales-invoice-test/e2e_runtime_test.mjs http://127.0.0.1:3171
//
// Bila server dijalankan dengan SALES_INVOICE_PREVIEW_TOKEN=<token>, set juga
// SI_PREVIEW_TOKEN=<token> di sini untuk menguji ALUR PENUH (draft → terbit →
// terkirim → lunas) lewat HTTP, termasuk idempotensi.
// ============================================================

const BASE = process.argv[2] || 'http://127.0.0.1:3171'
const TOKEN = process.env.SI_PREVIEW_TOKEN || ''

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

async function call(method, path, { body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  })
  let json = null
  try { json = await res.json() } catch (_) { json = null }
  return { status: res.status, json, headers: res.headers }
}

const VALID = {
  customer_name: 'Jessica Wong',
  nominal: 85000000,
  tax_rate: 11,
  issue_date: '2026-10-17',
  due_date: '2026-10-31',
  project_intent: { mode: 'none' }
}

console.log(`\n=== H. RUNTIME NYATA (${BASE}) ===`)

// ---- H1. Semua method menolak tanpa sesi ----
for (const m of ['GET', 'POST', 'PATCH']) {
  const r = await call(m, '/api/sales-invoices', { body: m === 'GET' ? undefined : VALID })
  check(`${m} tanpa sesi → bukan 2xx`, r.status >= 400, `status=${r.status}`)
  check(`${m} tanpa sesi tidak membocorkan daftar`, !(r.json && Array.isArray(r.json.invoices)))
}

// Tanpa kredensial Supabase + tanpa SALES_INVOICE_PREVIEW_TOKEN → fail closed
{
  const r = await call('GET', '/api/sales-invoices')
  check('endpoint menolak (401/503), bukan 200', [401, 503].includes(r.status), `status=${r.status} body=${JSON.stringify(r.json).slice(0, 160)}`)
  if (r.status === 503) {
    check('alasan 503 dijelaskan (kode)', ['AUTH_NOT_CONFIGURED', 'STORE_UNAVAILABLE'].includes(r.json?.code), JSON.stringify(r.json))
  }
}

// Token pratinjau salah → 401
{
  const r = await call('GET', '/api/sales-invoices', { headers: { 'x-preview-token': 'token-ngawur' } })
  check('token pratinjau salah ditolak', [401, 503].includes(r.status), `status=${r.status}`)
}

// POST tidak sah juga tidak boleh menulis apa pun
{
  const r = await call('POST', '/api/sales-invoices', { body: { ...VALID, status: 'TERKIRIM' } })
  check('POST tanpa sesi ditolak sebelum validasi', r.status >= 400, `status=${r.status}`)
}

// ---- H2. Method yang tidak diizinkan ----
{
  const r = await call('DELETE', '/api/sales-invoices')
  check('DELETE ditolak (401/405/503)', [401, 405, 503].includes(r.status), `status=${r.status}`)
  if (r.status === 405) {
    check('405 menyertakan header Allow', (r.headers.get('allow') || '').includes('GET'), r.headers.get('allow'))
  }
}

// ---- H3. Halaman smoke tetap dirender ----
{
  const res = await fetch(`${BASE}/__smoke`)
  const html = await res.text()
  check('/__smoke dapat dirender', res.status === 200, `status=${res.status}`)
  check('modul invoice ikut ter-render di smoke', html.includes('sales-invoice-root') || html.includes('Invoice Penjualan'))
  check('struktur modul (KPI/panel) ter-render', html.includes('si-panel') || html.includes('si-kpi-card'))
}

// ---- H4. ALUR PENUH lewat HTTP (bila token pratinjau disediakan) ----
if (!TOKEN) {
  console.log('\n  (lewat H4 alur penuh: jalankan server dengan SALES_INVOICE_PREVIEW_TOKEN)')
} else {
  const H = { 'x-preview-token': TOKEN }
  console.log('\n  --- H4. Alur penuh lewat HTTP (token pratinjau) ---')

  const list0 = await call('GET', '/api/sales-invoices', { headers: H })
  check('GET dengan token pratinjau = 200', list0.status === 200, `status=${list0.status} ${JSON.stringify(list0.json).slice(0, 200)}`)
  check('status penyimpanan menyatakan pratinjau (tidak durable)', list0.json?.storage?.durable === false, JSON.stringify(list0.json?.storage))

  const key = `e2e-${Date.now()}`
  const c1 = await call('POST', '/api/sales-invoices', { headers: { ...H, 'Idempotency-Key': key }, body: VALID })
  check('POST sah = 201', c1.status === 201, `status=${c1.status} ${JSON.stringify(c1.json).slice(0, 200)}`)
  check('invoice lahir DRAFT tanpa nomor', c1.json?.invoice?.status === 'DRAFT' && c1.json?.invoice?.invoice_no === null,
    JSON.stringify({ s: c1.json?.invoice?.status, n: c1.json?.invoice?.invoice_no }))
  const id = c1.json?.invoice?.id

  // Retry dengan key sama → tidak duplikat
  const c2 = await call('POST', '/api/sales-invoices', { headers: { ...H, 'Idempotency-Key': key }, body: VALID })
  check('retry key sama = 200 (bukan 201)', c2.status === 200, `status=${c2.status}`)
  check('retry mengembalikan invoice yang sama', c2.json?.invoice?.id === id)
  check('retry ditandai replayed', c2.json?.replayed === true)

  // Status awal selain DRAFT ditolak
  const bad = await call('POST', '/api/sales-invoices', { headers: H, body: { ...VALID, status: 'TERKIRIM' } })
  check('POST status TERKIRIM = 400', bad.status === 400, `status=${bad.status}`)
  check('kode error status awal', bad.json?.code === 'INITIAL_STATUS_MUST_BE_DRAFT', JSON.stringify(bad.json))

  // Terbitkan
  const issue = await call('PATCH', '/api/sales-invoices', { headers: H, body: { id, status: 'TERBIT' } })
  check('PATCH TERBIT = 200', issue.status === 200, `status=${issue.status} ${JSON.stringify(issue.json).slice(0, 200)}`)
  const no = issue.json?.invoice?.invoice_no
  // Format authoritative = Buku (Obsidian): NL<yymm><urut 3 digit>.
  check('nomor invoice dialokasikan server (format Buku NL<yymm><XXX>)', /^NL\d{4}\d{3,}$/.test(no || ''), String(no))
  check('format nomor tercatat di record', issue.json?.invoice?.number_format === 'legacy-buku', JSON.stringify(issue.json?.invoice?.number_format))
  check('status jadi TERBIT', issue.json?.invoice?.status === 'TERBIT')
  check('peringatan proyek belum terbit disertakan', (issue.json?.warnings || []).length > 0, JSON.stringify(issue.json?.warnings))

  // Terbitkan dua kali ditolak
  const again = await call('PATCH', '/api/sales-invoices', { headers: H, body: { id, status: 'TERBIT' } })
  check('menerbitkan dua kali ditolak (409)', again.status === 409, `status=${again.status}`)

  // TERKIRIM tanpa kanal ditolak
  const noCh = await call('PATCH', '/api/sales-invoices', { headers: H, body: { id, status: 'TERKIRIM' } })
  check('TERKIRIM tanpa kanal = 400', noCh.status === 400, `status=${noCh.status}`)
  check('kode error bukti kanal', noCh.json?.code === 'EVIDENCE_REQUIRED', JSON.stringify(noCh.json))

  const sent = await call('PATCH', '/api/sales-invoices', { headers: H, body: { id, status: 'TERKIRIM', evidence: { sent_channel: 'WhatsApp' } } })
  check('TERKIRIM dengan kanal = 200', sent.status === 200, `status=${sent.status}`)
  check('kanal tersimpan', sent.json?.invoice?.sent_channel === 'WhatsApp')

  // LUNAS tanpa bukti ditolak
  const noProof = await call('PATCH', '/api/sales-invoices', { headers: H, body: { id, status: 'LUNAS' } })
  check('LUNAS tanpa bukti = 400', noProof.status === 400, `status=${noProof.status}`)

  // LUNAS nominal kurang ditolak
  const short = await call('PATCH', '/api/sales-invoices', {
    headers: H,
    body: { id, status: 'LUNAS', evidence: { paid_amount: 1000, paid_at: '2026-10-20', payment_ref: 'TRF' } }
  })
  check('LUNAS nominal kurang = 409', short.status === 409, `status=${short.status}`)
  check('kode error nominal', short.json?.code === 'PAYMENT_AMOUNT_MISMATCH', JSON.stringify(short.json))

  // LUNAS lengkap
  const paid = await call('PATCH', '/api/sales-invoices', {
    headers: H,
    body: { id, status: 'LUNAS', evidence: { paid_amount: 94350000, paid_at: '2026-10-20', payment_ref: 'TRF-9911' } }
  })
  check('LUNAS lengkap = 200', paid.status === 200, `status=${paid.status} ${JSON.stringify(paid.json).slice(0, 200)}`)
  check('status LUNAS', paid.json?.invoice?.status === 'LUNAS')
  check('verifikator diisi dari sesi', !!paid.json?.invoice?.payment_verified_by, JSON.stringify(paid.json?.invoice?.payment_verified_by))

  // Final: tidak bisa diubah lagi
  const fin = await call('PATCH', '/api/sales-invoices', { headers: H, body: { id, status: 'BATAL' } })
  check('LUNAS final (409)', fin.status === 409, `status=${fin.status}`)

  // Invoice kedua dapat nomor berikutnya (tidak mendaur ulang)
  const c3 = await call('POST', '/api/sales-invoices', { headers: { ...H, 'Idempotency-Key': `e2e2-${Date.now()}` }, body: { ...VALID, customer_name: 'Kedua' } })
  const i3 = await call('PATCH', '/api/sales-invoices', { headers: H, body: { id: c3.json?.invoice?.id, status: 'TERBIT' } })
  check('invoice kedua dapat nomor berbeda', i3.json?.invoice?.invoice_no && i3.json?.invoice?.invoice_no !== no,
    `${i3.json?.invoice?.invoice_no} vs ${no}`)

  // ---- H5. P0 lewat HTTP: TERBIT + fields pada invoice non-draf ----
  const c4 = await call('POST', '/api/sales-invoices', { headers: { ...H, 'Idempotency-Key': `e2e3-${Date.now()}` }, body: { ...VALID, customer_name: 'Beku HTTP' } })
  const id4 = c4.json?.invoice?.id
  await call('PATCH', '/api/sales-invoices', { headers: H, body: { id: id4, status: 'TERBIT' } })
  await call('PATCH', '/api/sales-invoices', { headers: H, body: { id: id4, status: 'TERKIRIM', evidence: { sent_channel: 'Email' } } })
  const listBefore = await call('GET', '/api/sales-invoices', { headers: H })
  const beforeRow = (listBefore.json?.invoices || []).find(r => r.id === id4)

  const atk = await call('PATCH', '/api/sales-invoices', { headers: H, body: { id: id4, status: 'TERBIT', fields: { nominal: 999 } } })
  check('H5a TERKIRIM → TERBIT + fields = 409', atk.status === 409, `status=${atk.status}`)
  check('H5b kode NOT_A_DRAFT', atk.json?.code === 'NOT_A_DRAFT', JSON.stringify(atk.json))

  const listAfter = await call('GET', '/api/sales-invoices', { headers: H })
  const afterRow = (listAfter.json?.invoices || []).find(r => r.id === id4)
  check('H5c data identik setelah penolakan (JSON)', JSON.stringify(beforeRow), JSON.stringify(afterRow))
  check('H5d nominal beku tidak berubah', 85000000, afterRow?.nominal)
  check('H5e status tetap TERKIRIM', 'TERKIRIM', afterRow?.status)
}

console.log(`\n=== HASIL RUNTIME: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
