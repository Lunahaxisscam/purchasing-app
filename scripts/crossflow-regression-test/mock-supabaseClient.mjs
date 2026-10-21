// ============================================================
// MOCK supabaseClient untuk harness crossflow-regression-test (BUKAN produksi).
// - Merekam SEMUA operasi (insert/update/select/delete/rpc) ke __state.calls
// - Mengemulasi tabel lintas flow: requests, pr_items, receivings,
//   receiving_items, handovers, projects
// - Emulasi CHECK constraint receivings.status ('DIBELI' ditolak bila
//   rejectDibeliStatus) — menguji fallback [Tahap: DIBELI].
// - Emulasi compare-and-swap (CAS) pada handovers: update + .is('diserahkan_at', null)
//   hanya cocok bila masih NULL — retry/2 user tidak menandai dua kali.
// - Emulasi unique index receiving_items(receiving_id, pr_item_id) + advisory
//   lock RPC ensure_item_in_purchase (double-click tidak bikin baris dobel).
// ============================================================

export const __state = {
  tables: new Map(),   // table -> Map(id -> row)
  calls: [],
  nextError: null,
  rejectDibeliStatus: false,
  rpcHandlers: new Map(), // fn -> async(args) => { data, error }
  seq: 0
}

const TABLES = ['requests', 'pr_items', 'receivings', 'receiving_items', 'handovers', 'projects', 'purchase_requests']

function tableOf(name) {
  if (!__state.tables.has(name)) __state.tables.set(name, new Map())
  return __state.tables.get(name)
}

export function __reset({ tables = {}, rejectDibeliStatus = false, rpcHandlers = {} } = {}) {
  __state.tables = new Map()
  for (const [t, rows] of Object.entries(tables)) {
    const m = new Map()
    for (const r of (rows || [])) m.set(r.id, { ...r })
    __state.tables.set(t, m)
  }
  __state.calls = []
  __state.nextError = null
  __state.rejectDibeliStatus = rejectDibeliStatus
  __state.rpcHandlers = new Map(Object.entries(rpcHandlers || {}))
  __state.seq = 0
}

export function __rows(table) { return [...tableOf(table).values()] }
export function __callsOf(op, table) {
  return __state.calls.filter(c => c.op === op && (!table || c.table === table))
}
export function __inserts(table) { return __callsOf('insert', table) }
export function __updates(table) { return __callsOf('update', table) }

function nextId(prefix) { __state.seq += 1; return `${prefix}-${__state.seq}` }

function matches(row, filters) {
  return (filters || []).every(f => {
    const v = row[f.col]
    if (f.op === 'isNull') return v === null || v === undefined
    return String(v ?? '') === String(f.val ?? '')
  })
}

function checkConstraint(table, data) {
  if (__state.rejectDibeliStatus && table === 'receivings' && String(data?.status || '').toUpperCase() === 'DIBELI') {
    return { code: '23514', message: 'new row for relation "receivings" violates check constraint "receivings_status_check"' }
  }
  return null
}

// Emulasi unique index receiving_items(receiving_id, pr_item_id).
function uniqueItemViolation(table, data) {
  if (table !== 'receiving_items') return null
  const dup = __rows(table).find(r =>
    String(r.receiving_id ?? '') === String(data.receiving_id ?? '') &&
    String(r.pr_item_id ?? '') === String(data.pr_item_id ?? ''))
  if (dup) return { code: '23505', message: 'duplicate key value violates unique constraint "receiving_items_receiving_id_pr_item_id_key"' }
  return null
}

function terminal(st) {
  if (__state.nextError) { const e = __state.nextError; __state.nextError = null; return { data: null, error: e } }
  if (st.op === 'insert') {
    const check = checkConstraint(st.table, st.data)
    if (check) return { data: null, error: check }
    const uniq = uniqueItemViolation(st.table, st.data)
    if (uniq) return { data: null, error: uniq }
    const list = Array.isArray(st.data) ? st.data : [st.data]
    const inserted = []
    for (const d of list) {
      const row = { id: d.id || nextId(st.table.slice(0, 3)), ...d }
      tableOf(st.table).set(row.id, row)
      inserted.push({ ...row })
    }
    return { data: inserted, error: null }
  }
  if (st.op === 'update') {
    const check = checkConstraint(st.table, st.data)
    if (check) return { data: null, error: check }
    let rows = __rows(st.table).filter(r => matches(r, st.filters))
    // Emulasi CAS handovers: .is('diserahkan_at', null) hanya cocok bila NULL.
    if (st.table === 'handovers') {
      const isF = st.filters.find(f => f.col === 'diserahkan_at' && f.op === 'isNull')
      if (isF) rows = rows.filter(r => r.diserahkan_at === null || r.diserahkan_at === undefined)
    }
    for (const r of rows) Object.assign(tableOf(st.table).get(r.id), st.data)
    return { data: rows.map(r => ({ ...tableOf(st.table).get(r.id) })), error: null }
  }
  if (st.op === 'delete') {
    const rows = __rows(st.table).filter(r => matches(r, st.filters))
    for (const r of rows) tableOf(st.table).delete(r.id)
    return { data: rows, error: null }
  }
  let rows = __rows(st.table).filter(r => matches(r, st.filters))
  if (st.limit) rows = rows.slice(0, st.limit)
  return { data: rows.map(r => ({ ...r })), error: null }
}

function makeBuilder(table) {
  const st = { table, op: null, data: null, filters: [], limit: null }
  const api = {
    select() { if (!st.op) st.op = 'select'; if (st.op === 'select') __state.calls.push({ op: 'select', table }); return api },
    insert(d) { st.op = 'insert'; st.data = d; __state.calls.push({ op: 'insert', table, data: d }); return api },
    update(d) { st.op = 'update'; st.data = d; __state.calls.push({ op: 'update', table, data: d }); return api },
    delete() { st.op = 'delete'; __state.calls.push({ op: 'delete', table }); return api },
    eq(col, val) { st.filters.push({ col, val }); return api },
    neq() { return api },
    is(col, val) { st.filters.push({ col, val, op: val === null ? 'isNull' : 'is' }); return api },
    in() { return api },
    or() { return api },
    not() { return api },
    order() { return api },
    limit(n) { st.limit = n; return api },
    single() { return Promise.resolve(terminal(st)) },
    maybeSingle() { return Promise.resolve(terminal(st)) },
    then(res, rej) { return Promise.resolve(terminal(st)).then(res, rej) },
    catch(rej) { return Promise.resolve(terminal(st)).catch(rej) }
  }
  return api
}

// --- RUN 248: jawaban JUJUR untuk fungsi kontrak v1 yang BELUM ADA ----------
// PostgREST nyata menjawab PGRST202 ("Could not find the function"), bukan
// `data:null` tanpa error. Probe capability menyimpulkan LEGACY hanya dari
// jawaban itu; `data:null` tanpa error = "tidak bisa dipastikan" (dan memang
// harus ditahan). Tanpa emulasi ini, harness LEGACY menguji jalur yang tidak
// pernah ada di database sungguhan.
const __OPS_V1_FNS = new Set(['handover_create_atomic', 'purchase_save_atomic'])
function __opsV1Missing(fn) {
  return {
    data: null,
    error: {
      code: 'PGRST202',
      message: `Could not find the function public.${fn}(p_payload) in the schema cache`
    }
  }
}

export const supabase = {
  from: (table) => makeBuilder(table),
  rpc: async (fn, args) => {
    if (__OPS_V1_FNS.has(fn)) return __opsV1Missing(fn)
    __state.calls.push({ op: 'rpc', fn, args })
    const h = __state.rpcHandlers.get(fn)
    if (h) return await h(args)
    return { data: null, error: null }
  }
}
