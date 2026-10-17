// ============================================================
// B. STORE — IDEMPOTENSI, ALOKASI NOMOR, NEGATIVE CASES
// ============================================================
// Fokus defect nyata di jalur simpan (S4) + temuan P0 review Brooklyn:
//   1) POST ulang (retry) membuat invoice kedua,
//   2) nomor proyek di-insert SEBELUM invoice → proyek yatim,
//   3) status langsung TERKIRIM padahal belum dikirim,
//   4) LUNAS tanpa pembayaran terverifikasi,
//   5) invoice terbit masih bisa diubah nominalnya,
//   6) dua permintaan bersamaan mendapat nomor invoice yang sama,
//   7) P0: MUTASI SEBELUM VALIDASI — {to:'TERBIT', fields} pada invoice
//      TERKIRIM mengubah nominal beku lebih dulu, lalu gagal NOT_A_DRAFT,
//   8) race penerbitan: dua issue bersamaan mengganti nomor / dua proyek,
//   9) insertProject sukses tapi link gagal → proyek yatim (kompensasi),
//  10) gate RPC (fail closed) & gate format nomor (NL<yymm><XXX> vs INV/NL).
//
// Fake Supabase client di bawah MENEGAKKAN unique constraint seperti DB
// sungguhan (invoice_no, idempotency_key, projects.kode) dan mencatat setiap
// update/insert/delete, supaya "nol update" bisa dibuktikan — bukan diasumsikan.
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const S = await import(pathToFileURL(path.join(SB, 'modules/sales-invoice/store.js')).href)
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
async function rejects(no, name, fn, code) {
  try {
    await fn()
    fail++; failures.push(no); console.log(`  FAIL ${no} ${name} | tidak melempar error`)
    return null
  } catch (err) {
    const got = err && err.code
    if (code && Array.isArray(code) ? !code.includes(got) : (code && got !== code)) {
      fail++; failures.push(no); console.log(`  FAIL ${no} ${name} | kode=${got} (harap ${code}) msg=${err.message}`)
    } else { pass++; console.log(`  ok ${no} ${name} (${got})`) }
    return err
  }
}

function tmpStore(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-store-'))
  return S.createFileStore({ file: path.join(dir, 'sales_invoices.json'), ...extra })
}

// ------------------------------------------------------------
// FAKE SUPABASE CLIENT (chainable + unique constraint + audit log)
// ------------------------------------------------------------
function fakeClient(opts = {}) {
  const db = {
    sales_invoices: opts.invoices ? opts.invoices.slice() : [],
    projects: opts.projects ? opts.projects.slice() : [{ id: 'p1', kode: '105', code: '105', name: 'Lia', status: 'ON_GOING' }]
  }
  const ctl = {
    failInvoiceUpdate: false,
    failInvoiceInsert: false,
    failProjectInsert: false,
    failLinkUpdate: false,   // update invoice yang menautkan proyek gagal
    failProjectDelete: false,
    emptyPeriodRead: false,  // simulasi dua instance membaca max bersamaan
    invoiceUpdates: 0,
    invoiceWrites: 0,        // update + insert pada sales_invoices
    projectInserts: 0,
    projectDeletes: 0,
    log: []                  // { table, op, payload }
  }
  const uniq = {
    sales_invoices: [['invoice_no'], ['idempotency_key']],
    projects: [['kode']]
  }

  function conflict(table, row, ignoreRow = null) {
    for (const cols of uniq[table] || []) {
      if (cols.some(c => row[c] === null || row[c] === undefined)) continue
      const dup = db[table].some(r => r !== row && r !== ignoreRow && cols.every(c => String(r[c]) === String(row[c])))
      if (dup) return { code: '23505', message: `duplicate key value violates unique constraint "${table}_${cols.join('_')}_key"` }
    }
    return null
  }

  function run(st) {
    const table = st.table
    const rows = db[table] || (db[table] = [])
    if (st.op === 'select') {
      let out = rows.slice()
      for (const [c, v] of st.filters) out = out.filter(r => String(r[c]) === String(v))
      if (st.like) {
        if (ctl.emptyPeriodRead && table === 'sales_invoices') return { data: [], error: null }
        const [c, pattern] = st.like
        const prefix = pattern.replace(/%$/, '')
        out = out.filter(r => String(r[c] || '').startsWith(prefix))
      }
      return { data: out, error: null }
    }
    if (st.op === 'insert') {
      const list = st.payload
      if (table === 'sales_invoices' && ctl.failInvoiceInsert) {
        return { data: null, error: { code: 'XX000', message: 'simulasi gagal simpan invoice' } }
      }
      if (table === 'projects' && ctl.failProjectInsert) {
        return { data: null, error: { code: 'XX000', message: 'simulasi gagal simpan proyek' } }
      }
      const inserted = []
      for (const row of list) {
        const c = conflict(table, row)
        if (c) return { data: null, error: c }
        const rec = { ...row }
        if (table === 'projects' && !rec.id) rec.id = `proj_${rows.length + 1}`
        rows.push(rec)
        inserted.push(rec)
        if (table === 'projects') ctl.projectInserts++
        else ctl.invoiceWrites++
        ctl.log.push({ table, op: 'insert', payload: rec })
      }
      return { data: inserted, error: null }
    }
    if (st.op === 'update') {
      if (table === 'sales_invoices' && ctl.failInvoiceUpdate) {
        return { data: null, error: { code: 'XX000', message: 'simulasi gagal update invoice' } }
      }
      if (table === 'sales_invoices' && ctl.failLinkUpdate && st.payload && st.payload.project_issued === true) {
        return { data: null, error: { code: 'XX000', message: 'simulasi gagal menautkan proyek ke invoice' } }
      }
      let target = rows.slice()
      for (const [c, v] of st.filters) target = target.filter(r => String(r[c]) === String(v))
      if (target.length === 0) return { data: [], error: null }
      // DB sungguhan menegakkan unique index juga pada UPDATE.
      for (const r of target) {
        const c = conflict(table, { ...r, ...st.payload }, r)
        if (c) return { data: null, error: c }
      }
      for (const r of target) Object.assign(r, st.payload)
      if (table === 'sales_invoices') { ctl.invoiceUpdates++; ctl.invoiceWrites++ }
      ctl.log.push({ table, op: 'update', payload: st.payload, matched: target.length })
      return { data: target, error: null }
    }
    if (st.op === 'delete') {
      if (table === 'projects' && ctl.failProjectDelete) {
        return { data: null, error: { code: 'XX000', message: 'simulasi gagal hapus proyek' } }
      }
      let target = rows.slice()
      for (const [c, v] of st.filters) target = target.filter(r => String(r[c]) === String(v))
      for (const r of target) {
        const i = rows.indexOf(r)
        if (i >= 0) rows.splice(i, 1)
      }
      if (table === 'projects') ctl.projectDeletes++
      ctl.log.push({ table, op: 'delete', matched: target.length })
      return { data: target, error: null }
    }
    return { data: null, error: { message: 'op tidak dikenal' } }
  }

  function from(table) {
    const st = { table, op: 'select', payload: null, filters: [], like: null }
    const api = {
      select() { return api },
      order() { return api },
      limit() { return api },
      eq(c, v) { st.filters.push([c, v]); return api },
      like(c, v) { st.like = [c, v]; return api },
      insert(list) { st.op = 'insert'; st.payload = list; return api },
      update(patch) { st.op = 'update'; st.payload = patch; return api },
      delete() { st.op = 'delete'; return api },
      then(res, rej) { return Promise.resolve(run(st)).then(res, rej) }
    }
    return api
  }

  return { client: { from }, db, ctl }
}

const VALID = {
  customer_name: 'Jessica Wong',
  customer_phone: '08123456789',
  project_address: 'Gading Serpong',
  project_name: 'Fit-Out Master Bedroom',
  rab_reff: 'BOQ-001',
  nominal: 85000000,
  tax_rate: 11,
  issue_date: '2026-10-17',
  due_date: '2026-10-31',
  status: 'DRAFT',
  project_intent: { mode: 'new', code: '106' }
}
const norm = (over = {}) => C.normalizeNewInvoice({ ...VALID, ...over }).value
const snapshot = (row) => JSON.parse(JSON.stringify(row))

// ---------- B1. DRAFT ----------
{
  const store = tmpStore()
  const r = await S.createInvoice(store, norm(), { idempotencyKey: 'k1' })
  check('B1a', 'draft dibuat dengan status DRAFT', 'DRAFT', r.invoice.status)
  check('B1b', 'draft TIDAK punya nomor invoice', null, r.invoice.invoice_no)
  check('B1c', 'draft TIDAK punya nomor proyek', null, r.invoice.project_code)
  ok('B1d', 'draft tidak menandai proyek terbit', r.invoice.project_issued === false)
  ok('B1e', 'draft belum punya issued_at', r.invoice.issued_at === null)
  ok('B1f', 'peringatan menyebut nomor dialokasikan saat terbit', /saat penerbitan/i.test(r.warnings.join(' ')), r.warnings.join('|'))
  check('B1g', 'tersimpan 1 baris', 1, (await store.list()).length)
}

// ---------- B2. IDEMPOTENSI ----------
{
  const store = tmpStore()
  const first = await S.createInvoice(store, norm(), { idempotencyKey: 'same-key' })
  const second = await S.createInvoice(store, norm(), { idempotencyKey: 'same-key' })
  check('B2a', 'retry dengan key sama mengembalikan invoice yang SAMA', first.invoice.id, second.invoice.id)
  ok('B2b', 'retry ditandai replayed', second.replayed === true)
  check('B2c', 'tidak ada duplikat di store', 1, (await store.list()).length)

  const third = await S.createInvoice(store, norm(), { idempotencyKey: 'other-key' })
  ok('B2d', 'key berbeda membuat invoice baru', third.invoice.id !== first.invoice.id)
  check('B2e', 'dua invoice berbeda key', 2, (await store.list()).length)

  const different = norm({ nominal: 1 })
  await rejects('B2f', 'key sama dengan isi berbeda ditolak', () =>
    S.createInvoice(store, different, { idempotencyKey: 'same-key' }), 'IDEMPOTENCY_KEY_REUSED')

  const reopened = S.createFileStore({ file: store.file })
  const replay = await S.createInvoice(reopened, norm(), { idempotencyKey: 'same-key' })
  ok('B2g', 'idempotensi bertahan setelah restart', replay.replayed === true && replay.invoice.id === first.invoice.id)
  check('B2h', 'tetap 2 invoice setelah restart', 2, (await reopened.list()).length)
}

// ---------- B3. PENERBITAN (format authoritative Buku: NL<yymm><XXX>) ----------
{
  const store = tmpStore()
  const draft = (await S.createInvoice(store, norm())).invoice
  const issued = await S.issueInvoice(store, draft.id)
  check('B3a', 'nomor invoice format Buku (NL<yymm><XXX>)', 'NL2610001', issued.invoice.invoice_no)
  check('B3b', 'status menjadi TERBIT (bukan TERKIRIM)', 'TERBIT', issued.invoice.status)
  ok('B3c', 'TERBIT belum berarti terkirim', issued.invoice.sent_at === null)
  ok('B3d', 'issued_at terisi', !!issued.invoice.issued_at)
  check('B3e', 'format nomor aktif dicatat di record', 'legacy-buku', issued.invoice.number_format)

  const d2 = (await S.createInvoice(store, norm({ customer_name: 'Budi' }))).invoice
  const i2 = await S.issueInvoice(store, d2.id)
  check('B3f', 'invoice berikutnya dapat urut 002', 'NL2610002', i2.invoice.invoice_no)

  // RESET TAHUNAN: bulan baru pada tahun yang sama meneruskan urutan,
  // sedangkan tahun baru mulai dari 001.
  const d3 = (await S.createInvoice(store, norm({ issue_date: '2026-11-02' }))).invoice
  const i3 = await S.issueInvoice(store, d3.id)
  check('B3g', 'bulan baru tahun sama meneruskan urutan tahunan', 'NL2611003', i3.invoice.invoice_no)
  const d4 = (await S.createInvoice(store, norm({ issue_date: '2027-01-05' }))).invoice
  const i4 = await S.issueInvoice(store, d4.id)
  check('B3h', 'tahun baru mulai dari 001 (reset tahunan)', 'NL2701001', i4.invoice.invoice_no)

  await rejects('B3i', 'menerbitkan invoice yang sudah terbit ditolak', () =>
    S.issueInvoice(store, draft.id), 'NOT_A_DRAFT')

  ok('B3j', 'peringatan proyek belum terbit (mode pratinjau)',
    /nomor proyek TIDAK diterbitkan/i.test(issued.warnings.join(' ')), issued.warnings.join('|'))
  ok('B3k', 'project_issued tetap false di mode pratinjau', issued.invoice.project_issued === false)
}

// ---------- B4. TIDAK ADA PROYEK YATIM ----------
{
  const { client, db, ctl } = fakeClient()
  const store = S.createSupabaseStore(client)
  const draft = (await S.createInvoice(store, norm())).invoice
  check('B4a', 'draf tersimpan lewat store supabase', 1, db.sales_invoices.length)
  check('B4b', 'belum ada proyek dibuat saat draf', 0, ctl.projectInserts)

  ctl.failInvoiceUpdate = true
  await rejects('B4c', 'penerbitan gagal saat simpan invoice gagal', () => S.issueInvoice(store, draft.id), 'UPDATE_FAILED')
  check('B4d', 'TIDAK ada proyek yatim saat invoice gagal', 0, ctl.projectInserts)

  ctl.failInvoiceUpdate = false
  const issued = await S.issueInvoice(store, draft.id)
  check('B4e', 'setelah pulih, invoice terbit bernomor', 'NL2610001', issued.invoice.invoice_no)
  check('B4f', 'proyek baru diterbitkan TEPAT satu', 1, ctl.projectInserts)
  check('B4g', 'kode proyek terpakai dari intent', '106', db.projects[1].kode)
  ok('B4h', 'project_issued true setelah proyek terbit', issued.invoice.project_issued === true)
  check('B4i', 'project_id tertaut ke invoice', db.projects[1].id, issued.invoice.project_id)
}

// ---------- B4x. INVOICE TETAP SAH WALAU INSERT PROYEK GAGAL ----------
{
  const { client, db, ctl } = fakeClient()
  const store = S.createSupabaseStore(client)
  const draft = (await S.createInvoice(store, norm())).invoice
  ctl.failProjectInsert = true
  const issued = await S.issueInvoice(store, draft.id)
  check('B4x1', 'invoice tetap terbit dengan nomor', 'NL2610001', issued.invoice.invoice_no)
  ok('B4x2', 'project_issued jujur false', issued.invoice.project_issued === false)
  ok('B4x3', 'peringatan menyebut nomor proyek gagal', /gagal diterbitkan/i.test(issued.warnings.join(' ')), issued.warnings.join('|'))
  check('B4x4', 'tidak ada proyek setengah jadi', 1, db.projects.length)
}

// ---------- B4y. P0: INSERT PROYEK SUKSES TAPI LINK GAGAL → KOMPENSASI ----------
// Temuan audit concurrency: proyek sudah masuk Master Project, tautan ke
// invoice gagal → proyek yatim. Sekarang: dihapus (best-effort) + jujur.
{
  const { client, db, ctl } = fakeClient()
  const store = S.createSupabaseStore(client)
  const draft = (await S.createInvoice(store, norm())).invoice
  ctl.failLinkUpdate = true
  const res = await S.issueInvoice(store, draft.id)

  check('B4y1', 'invoice tetap terbit (nomor sah)', 'NL2610001', res.invoice.invoice_no)
  check('B4y2', 'proyek yang baru dibuat DIHAPUS (tidak yatim)', 1, db.projects.length)
  check('B4y3', 'penghapusan kompensasi benar-benar dipanggil', 1, ctl.projectDeletes)
  ok('B4y4', 'project_issued jujur false', res.invoice.project_issued === false)
  ok('B4y5', 'peringatan menyebut kompensasi, bukan klaim transaksional',
    /kompensasi/i.test(res.warnings.join(' ')) && /bukan transaksi/i.test(res.warnings.join(' ')), res.warnings.join('|'))
  ok('B4y6', 'error tautan disimpan di invoice untuk audit', /gagal menautkan/i.test(String(res.invoice.project_issue_error || '')), String(res.invoice.project_issue_error))
  ok('B4y7', 'capabilities TIDAK mengklaim transaksional', store.capabilities.transactional === false)
}

// ---------- B4z. KOMPENSASI GAGAL → DILAPORKAN, TIDAK DIAM ----------
{
  const { client, db, ctl } = fakeClient()
  const store = S.createSupabaseStore(client)
  const draft = (await S.createInvoice(store, norm())).invoice
  ctl.failLinkUpdate = true
  ctl.failProjectDelete = true
  const res = await S.issueInvoice(store, draft.id)
  check('B4z1', 'proyek tetap ada karena penghapusan gagal', 2, db.projects.length)
  ok('B4z2', 'peringatan menyebut PERBAIKAN MANUAL + id proyek',
    /PERBAIKAN MANUAL|manual/i.test(res.warnings.join(' ')), res.warnings.join('|'))
  ok('B4z3', 'tidak mengklaim sukses', res.invoice.project_issued === false)
}

// ---------- B5. KODE PROYEK BENTROK (409 + saran) ----------
{
  const { client, db } = fakeClient({ projects: [
    { id: 'p1', kode: '105', code: '105', name: 'Lia' },
    { id: 'p2', kode: '106', code: '106', name: 'Sudah Ada' }
  ] })
  const store = S.createSupabaseStore(client)
  const draft = (await S.createInvoice(store, norm())).invoice
  try {
    await S.issueInvoice(store, draft.id)
    fail++; failures.push('B5a'); console.log('  FAIL B5a kode proyek bentrok seharusnya ditolak')
  } catch (err) {
    ok('B5a', 'kode proyek bentrok ditolak', err.code === 'DUPLICATE_PROJECT_CODE', err.code)
    check('B5b', 'server menyarankan nomor berikutnya', '107', err.suggested_code)
  }
  const after = db.sales_invoices.find(r => r.id === draft.id)
  check('B5c', 'invoice TIDAK terbit saat kode bentrok', 'DRAFT', after.status)
  ok('B5d', 'nomor invoice tidak terpakai sia-sia', after.invoice_no === null)
}

// ---------- B6. TERKIRIM & LUNAS ----------
{
  const store = tmpStore()
  const draft = (await S.createInvoice(store, norm())).invoice
  const issued = (await S.issueInvoice(store, draft.id)).invoice

  await rejects('B6a', 'TERBIT -> DISETUJUI tidak diizinkan (lompat)', () =>
    S.patchInvoice(store, { id: issued.id, to: 'DISETUJUI' }), 'INVALID_TRANSITION')

  const sent = await S.patchInvoice(store, { id: issued.id, to: 'TERKIRIM', evidence: { sent_channel: 'WhatsApp' } })
  check('B6b', 'status menjadi TERKIRIM', 'TERKIRIM', sent.invoice.status)
  check('B6c', 'kanal pengiriman tersimpan', 'WhatsApp', sent.invoice.sent_channel)
  ok('B6d', 'sent_at terisi', !!sent.invoice.sent_at)

  await rejects('B6e', 'LUNAS dengan nominal kurang ditolak', () =>
    S.patchInvoice(store, {
      id: issued.id, to: 'LUNAS',
      evidence: { paid_amount: 50000000, paid_at: '2026-10-20', payment_ref: 'TRF-1', verified_by: 'admin-1' }
    }), 'PAYMENT_AMOUNT_MISMATCH')

  await rejects('B6f', 'LUNAS dengan nominal 0 ditolak', () =>
    S.patchInvoice(store, {
      id: issued.id, to: 'LUNAS',
      evidence: { paid_amount: 0, paid_at: '2026-10-20', payment_ref: 'TRF-1', verified_by: 'admin-1' }
    }), 'EVIDENCE_REQUIRED')

  const paid = await S.patchInvoice(store, {
    id: issued.id, to: 'LUNAS',
    evidence: { paid_amount: 94350000, paid_at: '2026-10-20', payment_ref: 'TRF-9911', verified_by: 'admin-1' }
  })
  check('B6g', 'LUNAS dengan pembayaran penuh diterima', 'LUNAS', paid.invoice.status)
  check('B6h', 'referensi pembayaran tersimpan', 'TRF-9911', paid.invoice.payment_ref)
  check('B6i', 'verifikator pembayaran tersimpan', 'admin-1', paid.invoice.payment_verified_by)

  await rejects('B6j', 'LUNAS tidak bisa diubah lagi', () =>
    S.patchInvoice(store, { id: issued.id, to: 'BATAL' }), 'TERMINAL_STATUS')
}

// ---------- B7. INVOICE TERBIT BEKU ----------
{
  const store = tmpStore()
  const draft = (await S.createInvoice(store, norm())).invoice
  const fixed = await S.patchInvoice(store, { id: draft.id, to: 'TERBIT', patch: { nominal: 90000000 } })
  check('B7a', 'koreksi draf ikut terhitung ulang', 99900000, fixed.invoice.grand_total)
  check('B7b', 'invoice terbit dengan nilai terkoreksi', 90000000, fixed.invoice.nominal)

  await rejects('B7c', 'ubah nominal invoice terbit ditolak', () =>
    S.patchInvoice(store, { id: draft.id, to: 'TERKIRIM', patch: { nominal: 1 }, evidence: { sent_channel: 'Email' } }),
    'ISSUED_INVOICE_FROZEN')
  check('B7d', 'nominal tidak berubah setelah percobaan', 90000000, (await store.getById(draft.id)).nominal)
}

// ---------- B8. BATAL ----------
{
  const store = tmpStore()
  const draft = (await S.createInvoice(store, norm())).invoice
  const issued = (await S.issueInvoice(store, draft.id)).invoice
  const voided = await S.patchInvoice(store, { id: issued.id, to: 'BATAL' })
  check('B8a', 'status BATAL', 'BATAL', voided.invoice.status)
  ok('B8b', 'nomor invoice TIDAK didaur ulang', voided.invoice.invoice_no === 'NL2610001')
  ok('B8c', 'peringatan nomor tetap terpakai', /tetap tercatat/i.test(voided.warnings.join(' ')), voided.warnings.join('|'))

  const d2 = (await S.createInvoice(store, norm({ customer_name: 'X' }))).invoice
  const i2 = await S.issueInvoice(store, d2.id)
  check('B8d', 'nomor berikutnya tetap 002 (tidak mendaur ulang)', 'NL2610002', i2.invoice.invoice_no)

  await rejects('B8e', 'BATAL tidak bisa dihidupkan lagi', () =>
    S.patchInvoice(store, { id: issued.id, to: 'TERKIRIM', evidence: { sent_channel: 'Email' } }), 'TERMINAL_STATUS')
}

// ---------- B9. BALAPAN NOMOR ----------
// Instance lain sudah memakai urut 1 dan pembacaan periode "buta"
// (emptyPeriodRead), jadi alokasi pertama pasti bentrok; retry → urut 2.
{
  const { client, db, ctl } = fakeClient({ invoices: [
    { id: 'other', invoice_no: 'NL2610001', status: 'TERBIT', created_at: '2026-10-17T00:00:00Z' }
  ] })
  const store = S.createSupabaseStore(client, { maxAttempts: 5 })
  const draft = (await S.createInvoice(store, norm())).invoice
  ctl.emptyPeriodRead = true
  const issued = await S.issueInvoice(store, draft.id)
  check('B9a', 'balapan nomor diselesaikan dengan urutan berikutnya', 'NL2610002', issued.invoice.invoice_no)
  check('B9b', 'total invoice tetap 2 (tidak ada duplikat)', 2, db.sales_invoices.length)
}

// ---------- B10. RESOLUSI STORE (fail closed) ----------
{
  const prod = S.resolveStorePlan({ NODE_ENV: 'production', SALES_INVOICE_STORE: 'file' })
  check('B10a', 'produksi menolak store file', 'blocked', prod.kind)
  check('B10b', 'alasan blokir file di produksi', 'FILE_STORE_FORBIDDEN_IN_PRODUCTION', prod.blocker)

  const prodAuto = S.resolveStorePlan({ NODE_ENV: 'production' })
  check('B10c', 'produksi tanpa kredensial = blocked', 'blocked', prodAuto.kind)
  check('B10d', 'blokir karena kredensial', 'MISSING_CREDENTIALS', prodAuto.blocker)

  const dev = S.resolveStorePlan({ NODE_ENV: 'development' })
  check('B10e', 'dev tanpa kredensial = pratinjau file', 'file-preview', dev.kind)

  const withCreds = S.resolveStorePlan({ NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' })
  check('B10f', 'produksi dengan kredensial = supabase', 'supabase', withCreds.kind)

  const forcedFileDev = S.resolveStorePlan({ NODE_ENV: 'development', SALES_INVOICE_STORE: 'file' })
  check('B10g', 'dev boleh memaksa file', 'file-preview', forcedFileDev.kind)

  const status = S.storeStatus(tmpStore())
  ok('B10h', 'status store pratinjau menyatakan tidak durable', status.durable === false && status.writes_local_json === true)
  ok('B10i', 'status TIDAK mengklaim transaksional', status.transactional === false)
}

// ---------- B11. SCHEMA BELUM ADA ----------
{
  const brokenClient = {
    from() {
      const api = {
        select() { return api }, order() { return api }, limit() { return api; },
        eq() { return api }, like() { return api },
        then(resolve) {
          return resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.sales_invoices' in the schema cache" } })
        }
      }
      return api
    }
  }
  const store = S.createSupabaseStore(brokenClient)
  try {
    await store.list()
    fail++; failures.push('B11a'); console.log('  FAIL B11a seharusnya melempar SCHEMA_UNAVAILABLE')
  } catch (err) {
    check('B11a', 'tabel belum ada → SCHEMA_UNAVAILABLE', 'SCHEMA_UNAVAILABLE', err.code)
    check('B11b', 'status HTTP 503 + penanda blocker', [503, 'SCHEMA_UNAVAILABLE'], [err.status, err.blocker])
  }
}

// ---------- B12. IDEMPOTENSI DI STORE SUPABASE ----------
{
  const { client, db } = fakeClient()
  const store = S.createSupabaseStore(client)
  const a = await S.createInvoice(store, norm(), { idempotencyKey: 'sb-key' })
  const b = await S.createInvoice(store, norm(), { idempotencyKey: 'sb-key' })
  check('B12a', 'replay supabase mengembalikan invoice sama', a.invoice.id, b.invoice.id)
  check('B12b', 'hanya satu baris tersimpan', 1, db.sales_invoices.length)
}

// ============================================================
// B13. P0 REVIEW BROOKLYN — VALIDASI SEBELUM MUTASI
// ============================================================
// Temuan TERBUKTI: normalizeTransition({id,to:'TERBIT',fields:{nominal:999}})
// pada record TERKIRIM nominal 100 → patchInvoice menulis nominal 999 DULU,
// lalu issueInvoice melempar NOT_A_DRAFT. Respons gagal, nominal BEKU berubah.
// Uji: TERBIT / TERKIRIM / LUNAS / BATAL → TERBIT + fields = NOL update,
// data identik byte-per-byte.
{
  const statuses = ['TERBIT', 'TERKIRIM', 'LUNAS', 'BATAL']
  for (const st of statuses) {
    const { client, db, ctl } = fakeClient()
    const store = S.createSupabaseStore(client)
    // Record siap pakai dengan status yang diuji, nominal 100 (angka kecil
    // supaya setiap perubahan kelihatan).
    db.sales_invoices.push({
      id: `si_${st}`,
      status: st,
      invoice_no: 'NL2610009',
      customer_name: 'Beku Co',
      nominal: 100,
      tax_rate: 0,
      tax_amount: 0,
      grand_total: 100,
      project_intent: { mode: 'none', code: '', project_id: '' },
      issue_date: '2026-10-17',
      created_at: '2026-10-17T00:00:00Z'
    })
    const before = snapshot(db.sales_invoices.find(r => r.id === `si_${st}`))
    const writesBefore = ctl.invoiceWrites

    const err = await rejects(`B13-${st}`, `${st} → TERBIT + fields ditolak`, () =>
      S.patchInvoice(store, { id: `si_${st}`, to: 'TERBIT', patch: { nominal: 999 } }),
      ['NOT_A_DRAFT', 'TERMINAL_STATUS'])

    ok(`B13-${st}-b`, `${st}: kode penolakan jujur (${err && err.code})`, !!err && !/^ISSUE/.test(err.code))
    check(`B13-${st}-c`, `${st}: NOL penulisan ke sales_invoices`, 0, ctl.invoiceWrites - writesBefore)
    check(`B13-${st}-d`, `${st}: data identik setelah penolakan`, before, snapshot(db.sales_invoices.find(r => r.id === `si_${st}`)))
    ok(`B13-${st}-e`, `${st}: nominal tetap 100 (tidak beku-berubah)`,
      db.sales_invoices.find(r => r.id === `si_${st}`).nominal === 100)
    ok(`B13-${st}-f`, `${st}: tidak ada proyek/ nomor baru`,
      ctl.projectInserts === 0 && db.sales_invoices.find(r => r.id === `si_${st}`).invoice_no === 'NL2610009')
  }

  // Variasi: target selain TERBIT (TERKIRIM) + fields pada invoice terbit.
  const { client, db, ctl } = fakeClient()
  const store = S.createSupabaseStore(client)
  db.sales_invoices.push({
    id: 'si_frozen', status: 'TERBIT', invoice_no: 'NL2610001', customer_name: 'X',
    nominal: 100, tax_rate: 0, tax_amount: 0, grand_total: 100, issue_date: '2026-10-17',
    project_intent: { mode: 'none', code: '', project_id: '' }, created_at: '2026-10-17T00:00:00Z'
  })
  const before = snapshot(db.sales_invoices[0])
  const w0 = ctl.invoiceWrites
  await rejects('B13x1', 'TERBIT → TERKIRIM + fields ditolak (beku)', () =>
    S.patchInvoice(store, { id: 'si_frozen', to: 'TERKIRIM', patch: { nominal: 5 }, evidence: { sent_channel: 'Email' } }),
    'ISSUED_INVOICE_FROZEN')
  check('B13x2', 'nol penulisan untuk percobaan beku', 0, ctl.invoiceWrites - w0)
  check('B13x3', 'data identik', before, snapshot(db.sales_invoices[0]))

  // Variasi: LUNAS dengan bukti kurang pada invoice TERKIRIM → nol tulis.
  const f2 = fakeClient()
  const s2 = S.createSupabaseStore(f2.client)
  f2.db.sales_invoices.push({
    id: 'si_sent', status: 'TERKIRIM', invoice_no: 'NL2610002', customer_name: 'Y',
    nominal: 100, tax_rate: 0, tax_amount: 0, grand_total: 100, issue_date: '2026-10-17',
    project_intent: { mode: 'none', code: '', project_id: '' }, created_at: '2026-10-17T00:00:00Z'
  })
  const before2 = snapshot(f2.db.sales_invoices[0])
  await rejects('B13y1', 'LUNAS nominal kurang ditolak tanpa menulis', () =>
    S.patchInvoice(s2, { id: 'si_sent', to: 'LUNAS', evidence: { paid_amount: 10, paid_at: '2026-10-20', payment_ref: 'T' } }),
    'PAYMENT_AMOUNT_MISMATCH')
  check('B13y2', 'nol penulisan pada penolakan pembayaran', 0, f2.ctl.invoiceWrites)
  check('B13y3', 'data identik', before2, snapshot(f2.db.sales_invoices[0]))

  // Variasi: field yang tidak boleh di-patch (status/nomor/total) ditolak.
  await rejects('B13z1', 'patch ke invoice_no dari klien ditolak', () =>
    S.patchInvoice(s2, { id: 'si_sent', to: 'BATAL', patch: { invoice_no: 'NL2619999' } }),
    'FIELD_NOT_PATCHABLE')
  check('B13z2', 'invoice_no tidak berubah', 'NL2610002', f2.db.sales_invoices[0].invoice_no)
}

// ============================================================
// B14. RACE PENERBITAN — CAS, SATU NOMOR, SATU PROYEK
// ============================================================
// Dua issueInvoice bersamaan pada draf yang sama: hanya satu yang boleh
// menang. Yang kalah harus gagal jujur (tidak mengganti nomor, tidak
// membuat proyek kedua).
{
  const { client, db, ctl } = fakeClient()
  const store = S.createSupabaseStore(client)
  const draft = (await S.createInvoice(store, norm())).invoice

  const results = await Promise.allSettled([
    S.issueInvoice(store, draft.id),
    S.issueInvoice(store, draft.id)
  ])
  const fulfilled = results.filter(r => r.status === 'fulfilled')
  const rejected = results.filter(r => r.status === 'rejected')

  check('B14a', 'tepat satu penerbitan berhasil', 1, fulfilled.length)
  check('B14b', 'tepat satu penerbitan kalah', 1, rejected.length)
  ok('B14c', 'yang kalah gagal dengan kode jujur',
    rejected.length === 1 && ['NOT_A_DRAFT', 'ISSUE_CONFLICT'].includes(rejected[0].reason && rejected[0].reason.code),
    rejected.length === 1 ? String(rejected[0].reason && rejected[0].reason.code) : 'n/a')
  check('B14d', 'hanya SATU proyek dibuat', 1, ctl.projectInserts)
  check('B14e', 'invoice tetap satu baris', 1, db.sales_invoices.length)
  check('B14f', 'nomor invoice tidak terganti', 'NL2610001', db.sales_invoices[0].invoice_no)
  check('B14g', 'proyek tertaut tepat satu', 1, db.sales_invoices[0].project_issued ? 1 : 0)
}

// CAS langsung: updateIf menolak bila status sudah berubah.
{
  const { client, db, ctl } = fakeClient()
  const store = S.createSupabaseStore(client)
  const draft = (await S.createInvoice(store, norm())).invoice
  db.sales_invoices[0].status = 'TERKIRIM'
  const w0 = ctl.invoiceWrites
  const res = await store.updateIf(draft.id, { status: 'DRAFT' }, { status: 'TERBIT', invoice_no: 'NL2610999' })
  ok('B14h', 'CAS gagal (null) bila status sudah berubah', res === null)
  check('B14i', 'CAS yang kalah tidak menulis apa pun', 0, ctl.invoiceWrites - w0)
  check('B14j', 'nomor invoice tidak dipakai', null, db.sales_invoices[0].invoice_no)
}

// Satu proyek hanya untuk satu invoice (first-invoice → single project).
{
  const { client, db, ctl } = fakeClient()
  const store = S.createSupabaseStore(client)
  const a = (await S.createInvoice(store, norm())).invoice
  await S.issueInvoice(store, a.id)
  check('B14k', 'invoice pertama menerbitkan proyek 106', '106', db.sales_invoices[0].project_code)

  // Invoice kedua meminta kode proyek yang SAMA → ditolak sebelum menulis.
  const b = (await S.createInvoice(store, norm({ customer_name: 'Kedua' }))).invoice
  const w0 = ctl.invoiceWrites
  await rejects('B14l', 'kode proyek yang sudah diklaim invoice lain ditolak', () =>
    S.issueInvoice(store, b.id), ['DUPLICATE_PROJECT_CODE', 'PROJECT_ALREADY_CLAIMED'])
  check('B14m', 'invoice kedua tetap draf tanpa nomor', null, db.sales_invoices.find(r => r.id === b.id).invoice_no)
  check('B14n', 'tetap hanya SATU proyek baru', 1, ctl.projectInserts)
  ok('B14o', 'percobaan kedua tidak menulis invoice kedua', ctl.invoiceWrites - w0 <= 0, `writes=${ctl.invoiceWrites - w0}`)
}

// ============================================================
// B15. GATE RPC (fail closed) — jangan klaim transaksional
// ============================================================
{
  const { client, db, ctl } = fakeClient()
  const store = S.createSupabaseStore(client, { requireRpc: true, hasIssueRpc: false })
  const draft = (await S.createInvoice(store, norm())).invoice
  const err = await rejects('B15a', 'wajib RPC tapi RPC tidak ada → ditolak', () =>
    S.issueInvoice(store, draft.id), 'ISSUE_REQUIRES_RPC')
  check('B15b', 'status 503 (fail closed)', 503, err && err.status)
  check('B15c', 'nol proyek, nol nomor', [0, null], [ctl.projectInserts, db.sales_invoices[0].invoice_no])
  ok('B15d', 'capabilities jujur: atomicSequence false', store.capabilities.atomicSequence === false)
  ok('B15e', 'capabilities jujur: requireRpc true', store.capabilities.requireRpc === true)
  ok('B15f', 'pesan menyebut SALES_INVOICE_REQUIRE_RPC', /SALES_INVOICE_REQUIRE_RPC/.test(err.message), err.message)
}

// ============================================================
// B16. GATE FORMAT NOMOR (Buku authoritative vs INV/NL belum disepakati)
// ============================================================
{
  const envDefault = {}
  const r1 = C.resolveInvoiceNumberFormat(envDefault)
  check('B16a', 'default = format Buku (authoritative)', 'legacy-buku', r1.format)
  ok('B16b', 'default disepakati (agreed true)', r1.agreed === true)

  const r2 = C.resolveInvoiceNumberFormat({ SALES_INVOICE_NO_FORMAT: 'inv-nl' })
  ok('B16c', 'INV/NL tanpa ACK = BLOCKED', r2.blocked === true && r2.format === null)
  check('B16d', 'kode gate format', 'NUMBER_FORMAT_NOT_AGREED', r2.code)
  ok('B16e', 'pesan menyebut belum disepakati', /belum disepakati/i.test(r2.message), r2.message)

  const r3 = C.resolveInvoiceNumberFormat({ SALES_INVOICE_NO_FORMAT: 'inv-nl', SALES_INVOICE_NO_FORMAT_ACK: '1' })
  check('B16f', 'INV/NL dengan ACK diizinkan', 'inv-nl', r3.format)
  ok('B16g', 'tetap ditandai belum disepakati (discrepancy)', r3.agreed === false && r3.discrepancy === true)

  const r4 = C.resolveInvoiceNumberFormat({ SALES_INVOICE_NO_FORMAT: 'ngawur' })
  check('B16h', 'format tidak dikenal ditolak', 'NUMBER_FORMAT_UNKNOWN', r4.code)

  // Format nomor
  check('B16i', 'format Buku: NL2610001', 'NL2610001', C.formatInvoiceNoFor('legacy-buku', { period: '2026', month: '10', seq: 1 }))
  check('B16j', 'format INV/NL tetap bisa dibentuk', 'INV/NL/2026/10/001', C.formatInvoiceNoFor('inv-nl', { period: '2026-10', seq: 1 }))
  check('B16k', 'parse nomor Buku', { format: 'legacy-buku', period: '2026', year: 2026, month: 10, seq: 1 },
    C.parseLegacyInvoiceNo('NL2610001'))
  ok('B16l', 'parse nomor INV/NL tidak salah format', C.parseAnyInvoiceNo('INV/NL/2026/10/001').format === 'inv-nl')
  ok('B16m', 'nomor ngawur tidak diparse', C.parseAnyInvoiceNo('INV-2026-001') === null)

  // Reset tahunan: urutan tahun lalu tidak mempengaruhi tahun ini.
  check('B16n', 'reset tahunan: 2027 mulai 001', 1,
    C.nextSequenceForFormat([{ invoice_no: 'NL2612012' }], 'legacy-buku', '2027'))
  check('B16o', 'urutan tahun berjalan = max+1', 13,
    C.nextSequenceForFormat([{ invoice_no: 'NL2612012' }], 'legacy-buku', '2026'))

  // Gate di store: format terblokir → penerbitan ditolak SEBELUM menulis.
  const { client, db, ctl } = fakeClient()
  const blocked = C.resolveInvoiceNumberFormat({ SALES_INVOICE_NO_FORMAT: 'inv-nl' })
  const store = S.createSupabaseStore(client, { numbering: blocked })
  const draft = (await S.createInvoice(store, norm())).invoice
  const err = await rejects('B16p', 'format belum disepakati → penerbitan ditolak', () =>
    S.issueInvoice(store, draft.id), 'NUMBER_FORMAT_NOT_AGREED')
  ok('B16q', 'pesan menyebut format authoritative Buku', /NL<yymm><XXX>|Buku/i.test(err.message), err.message)
  check('B16r', 'nol nomor & nol proyek saat gate menolak', [null, 0], [db.sales_invoices[0].invoice_no, ctl.projectInserts])

  // Nomor existing TIDAK dimigrasi: dua format hidup berdampingan.
  const mixed = [
    { invoice_no: 'NL2601001' },
    { invoice_no: 'NL2601002' },
    { invoice_no: 'INV/NL/2026/01/001' }
  ]
  check('B16s', 'sebaran format dilaporkan apa adanya', { 'legacy-buku': 2, 'inv-nl': 1, unknown: 0 },
    S.summarizeNumberFormats(mixed))
  ok('B16t', 'tidak ada penulisan ulang nomor lama', mixed[0].invoice_no === 'NL2601001' && mixed[2].invoice_no === 'INV/NL/2026/01/001')
}

console.log(`\n=== B. STORE: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('Gagal: ' + failures.join(', ')); process.exit(1) }
