// ============================================================
// A6b. GUARD PROYEK & LEDGER — bukti lewat fake Supabase store
// ============================================================
// Kasus A6 dilanjutkan dengan store Supabase (projectAllocation = true) supaya
// guard klaim proyek benar-benar aktif — bukan sekadar mode pratinjau.
// ============================================================
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

// --- Fake Supabase client dengan unique constraint seperti DB sungguhan ---
function fakeClient(opts = {}) {
  const db = {
    sales_invoices: opts.invoices ? opts.invoices.slice() : [],
    projects: opts.projects ? opts.projects.slice() : []
  }
  const ctl = { log: [], invoiceWrites: 0, projectInserts: 0 }
  function uniqueErr(name) {
    const e = new Error(`duplicate key value violates unique constraint "${name}"`)
    e.code = '23505'
    return e
  }
  function chain(table, mode, arg) {
    const filters = []
    let rows = null
    const state = { rows: null, single: false, _cols: '*' }
    function apply() {
      let out = db[table].slice()
      for (const f of filters) {
        if (f.op === 'eq') out = out.filter(r => String(r[f.col]) === String(f.val))
        if (f.op === 'like') out = out.filter(r => new RegExp('^' + String(f.val).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$').test(String(r[f.col] || '')))
        if (f.op === 'in') out = out.filter(r => f.vals.map(String).includes(String(r[f.col])))
      }
      if (state._cols && state._cols !== '*') {
        const cols = state._cols.split(',')
        out = out.map(r => { const o = {}; for (const c of cols) o[c] = r[c]; return o })
      }
      return out
    }
    function run() {
      if (mode === 'insert') {
        const arrRows = Array.isArray(arg) ? arg : [arg]
        for (const r of arrRows) {
          if (table === 'sales_invoices') {
            if (db.sales_invoices.some(x => x.invoice_no && r.invoice_no && x.invoice_no === r.invoice_no)) throw uniqueErr('sales_invoices_invoice_no_key')
            if (db.sales_invoices.some(x => x.idempotency_key && r.idempotency_key && x.idempotency_key === r.idempotency_key)) throw uniqueErr('sales_invoices_idempotency_key_key')
          }
          if (table === 'projects' && db.projects.some(x => x.kode && r.kode && x.kode === r.kode)) throw uniqueErr('projects_kode_key')
          db[table].push({ ...r })
          ctl.log.push({ table, op: 'insert', id: r.id })
          if (table === 'sales_invoices') ctl.invoiceWrites++
          if (table === 'projects') ctl.projectInserts++
        }
        rows = arrRows.map(r => ({ ...r }))
      }
      if (mode === 'update') {
        const patch = arg
        const target = apply()
        for (const r of target) Object.assign(r, patch)
        rows = target.map(r => ({ ...r }))
        ctl.log.push({ table, op: 'update', patch, count: target.length })
        if (table === 'sales_invoices') ctl.invoiceWrites += target.length
      }
      if (mode === 'delete') {
        const target = apply()
        db[table] = db[table].filter(r => !target.includes(r))
        rows = target.map(r => ({ ...r }))
        ctl.log.push({ table, op: 'delete', count: target.length })
      }
      if (mode === 'select') rows = apply()
      if (mode === 'upsert') {
        const arrRows = Array.isArray(arg) ? arg : [arg]
        for (const r of arrRows) {
          const i = db[table].findIndex(x => x.id === r.id)
          if (i >= 0) db[table][i] = { ...db[table][i], ...r }
          else db[table].push({ ...r })
        }
        rows = arrRows.map(r => ({ ...r }))
        ctl.log.push({ table, op: 'upsert' })
      }
      return { data: rows, error: null }
    }
    const api = {
      select(cols = '*') { state._cols = cols; mode = mode === 'select' ? 'select' : mode; return api },
      eq(col, val) { filters.push({ op: 'eq', col, val }); return api },
      like(col, val) { filters.push({ op: 'like', col, val }); return api },
      in(col, vals) { filters.push({ op: 'in', col, vals }); return api },
      order() { return api },
      limit() { return api },
      single() { state.single = true; return Promise.resolve({ data: run().data[0] || null, error: null }) },
      then(res, rej) {
        try { const r = run(); return Promise.resolve(r).then(res, rej) } catch (e) {
          if (e && e.code === '23505') return Promise.resolve({ data: null, error: e }).then(res, rej)
          throw e
        }
      }
    }
    return api
  }
  const client = {
    from(table) {
      const t = {
        select: (cols) => chain(table, 'select', null, cols),
        insert: (rows) => chain(table, 'insert', rows),
        update: (patch) => chain(table, 'update', patch),
        delete: () => chain(table, 'delete'),
        upsert: (rows) => chain(table, 'upsert', rows)
      }
      return t
    },
    rpc() { return Promise.resolve({ data: null, error: new Error('no rpc') }) },
    auth: { getUser: async () => ({ data: { user: null }, error: new Error('stub') }) }
  }
  return { client, ctl, db }
}

function sbStore(opts = {}) {
  const { client, ctl, db } = fakeClient(opts)
  const store = S.createSupabaseStore(client, {
    hasIssueRpc: false,
    numbering: C.resolveInvoiceNumberFormat({}),
    env: {}
  })
  return { store, ctl, db }
}

// ============================================================
// A6b. TERMIN PECAH 2 INVOICE → guard klaim proyek (Supabase)
// ============================================================
{
  const { store, ctl, db } = sbStore()
  const mk = async (terms) => (await S.createInvoice(store, C.normalizeNewInvoice({
    customer_name: 'Klien Pecah', nominal: 50000000, tax_rate: 0,
    issue_date: '2026-10-01', due_date: '2026-11-01', payment_terms: terms,
    project_intent: { mode: 'new', code: '201' }
  }).value, {})).invoice

  const dp = await mk('DP 50%')
  await S.patchInvoice(store, { id: dp.id, to: 'TERBIT' })

  // POST invoice kedua untuk proyek yang sama: draft masih lolos.
  let postErr = null
  let dp2 = null
  try { dp2 = await mk('Pelunasan 50%') } catch (e) { postErr = e }
  ok('A6b', 'POST invoice kedua (pelunasan) proyek sama MASIH lolos sebagai draft',
    !postErr && !!dp2, postErr ? postErr.code : 'ok')

  // TERBIT invoice kedua → guard klaim proyek menolak (proyek 201 sudah diambil).
  let terr = null
  try { await S.patchInvoice(store, { id: dp2.id, to: 'TERBIT' }) } catch (e) { terr = e }
  ok('A6c', 'TERBIT invoice kedua → guard klaim menolak (DUPLICATE_PROJECT_CODE)',
    terr && (terr.code === 'DUPLICATE_PROJECT_CODE' || terr.code === 'PROJECT_CODE_TAKEN'),
    terr ? terr.code : 'diterbit')

  // Bukti: hanya 1 proyek 201 yang tercipta, invoice kedua tetap DRAFT.
  check('A6d', 'hanya 1 proyek 201 dibuat (tanpa proyek yatim/kedua)', 1, ctl.projectInserts)
  const codes = db.projects.map(p => p.kode).sort()
  check('A6e', 'kode proyek terbuat: hanya 201', ['201'], codes)
  const drafts = db.sales_invoices.filter(i => i.status === 'DRAFT')
  check('A6f', 'invoice pelunasan tertahan di DRAFT (tidak pernah terbit)', 1, drafts.length)
  const issued = db.sales_invoices.filter(i => i.invoice_no)
  check('A6g', 'hanya 1 invoice mendapat nomor (DP)', 1, issued.length)

  finding('A6h', 'termin multi-invoice tidak terwakili: 1 invoice = 1 proyek',
    'pecah DP/pelunasan ke 2 invoice tertahan guard kode proyek; tidak ada relasi "induk termin" antar-invoice, dan DP tidak bisa dibayar sebagian (A3)')
}

// ============================================================
// B9. LEDGER: tidak ada riwayat pembayaran — paid_* hanya field tunggal
// ============================================================
{
  const { store, ctl, db } = sbStore()
  const inv = (await S.createInvoice(store, C.normalizeNewInvoice({
    customer_name: 'Ledger', nominal: 1000, tax_rate: 0, issue_date: '2026-10-01', due_date: '2026-10-31'
  }).value, {})).invoice
  await S.patchInvoice(store, { id: inv.id, to: 'TERBIT' })
  await S.patchInvoice(store, { id: inv.id, to: 'LUNAS', evidence: { paid_amount: 1000, paid_at: '2026-10-10', payment_ref: 'TRF-LEDGER' } })
  const after = (await S.listInvoices(store))[0]
  const payFields = Object.keys(after).filter(f => /paid|payment|verif/i.test(f)).sort()
  ok('B9', 'bukti bayar hanya snapshot field tunggal (bukan baris ledger)',
    payFields.length >= 4 && !payFields.includes('payments'),
    payFields.join(', '))
  finding('B10', 'tidak ada tabel/entitas payment ledger',
    `field pembayaran di invoice: ${payFields.join(', ')}; nol baris terpisah → riwayat/koreksi/refund mustahil tanpa mengubah skema`)
  ok('B11', 'bukti bayar terpasang di baris invoice (bukan tabel terpisah)',
    after.payment_ref === 'TRF-LEDGER' && after.paid_amount === 1000 && after.paid_at === '2026-10-10')
}

console.log(`\nA6b+B9+B10: ${pass} ok, ${fail} fail, ${findingCount} finding (${[...failures, ...findingCodes].join(', ')})`)
process.exit(fail > 0 ? 1 : 0)
