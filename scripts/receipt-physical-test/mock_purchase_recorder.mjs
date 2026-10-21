// ============================================================
// MOCK supabaseClient untuk probe run 246 (BUKAN file produksi).
// Sama seperti scripts/purchase-flow-test/mock-supabaseClient.mjs, ditambah:
//   - `upsert()` (dipakai jalur alokasi bila ada)
//   - `gte/lte/ilike` supaya builder tidak pecah di rantai baru
// Tujuan: merekam payload PERSIS yang dikirim ke receiving_items /
// receiving_item_allocations, lalu menyimpan baris di "tabel" supaya bisa
// dibaca ULANG seperti sesudah reload.
// ============================================================

export const __state = {
  tables: new Map(),
  calls: [],
  nextError: null,
  rejectDibeliStatus: false,
  failInsertTable: null,
  failInsertMode: 'first',
  failSelect: false,
  failUpdate: false,
  seq: 0
}

function tableOf(name) {
  if (!__state.tables.has(name)) __state.tables.set(name, new Map())
  return __state.tables.get(name)
}

export function __reset({ tables = {}, rejectDibeliStatus = false, failInsertTable = null, failSelect = false } = {}) {
  __state.tables = new Map()
  for (const [t, rows] of Object.entries(tables)) {
    const m = new Map()
    for (const r of rows) m.set(r.id, { ...r })
    __state.tables.set(t, m)
  }
  __state.calls = []
  __state.nextError = null
  __state.rejectDibeliStatus = rejectDibeliStatus
  __state.failInsertTable = failInsertTable
  __state.failInsertMode = 'first'
  __state.failSelect = !!failSelect
  __state.failUpdate = false
  __state.seq = 0
}

export function __rows(table) { return [...tableOf(table).values()] }
export function __callsOf(op, table) {
  return __state.calls.filter(c => c.op === op && (!table || c.table === table))
}

function nextId(prefix) { __state.seq += 1; return `${prefix}-${__state.seq}` }

function matches(row, filters) {
  return (filters || []).every(f => {
    const v = row[f.col]
    if (f.op === 'isNull') return v === null || v === undefined
    if (f.op === 'neq') return String(v ?? '') !== String(f.val ?? '')
    return String(v ?? '') === String(f.val ?? '')
  })
}

function applyCheckConstraint(table, data) {
  if (__state.rejectDibeliStatus && table === 'receivings' && String(data?.status || '').toUpperCase() === 'DIBELI') {
    return { code: '23514', message: 'new row for relation "receivings" violates check constraint "receivings_status_check"' }
  }
  return null
}

function runSelect(st) {
  const rows = __rows(st.table)
  let out = rows.filter(r => matches(r, st.filters))
  if (st.inFilter) {
    const set = new Set(st.inFilter.vals.map(String))
    out = out.filter(r => set.has(String(r[st.inFilter.col])))
  }
  if (st.limit) out = out.slice(0, st.limit)
  return out.map(r => ({ ...r }))
}

function makeBuilder(table) {
  const st = { table, op: null, data: null, filters: [], inFilter: null, limit: null, columns: null }
  const api = {
    select(cols) {
      if (!st.op) st.op = 'select'
      if (typeof cols === 'string') st.columns = cols
      if (st.op === 'select') __state.calls.push({ op: 'select', table, columns: cols })
      return api
    },
    insert(d) { st.op = 'insert'; st.data = d; __state.calls.push({ op: 'insert', table, data: d }); return api },
    update(d) { st.op = 'update'; st.data = d; __state.calls.push({ op: 'update', table, data: d, filters: st.filters }); return api },
    upsert(d, opts) { st.op = 'upsert'; st.data = d; __state.calls.push({ op: 'upsert', table, data: d, opts }); return api },
    delete() { st.op = 'delete'; __state.calls.push({ op: 'delete', table, filters: st.filters }); return api },
    eq(col, val) { st.filters.push({ col, val }); return api },
    neq(col, val) { st.filters.push({ col, val, op: 'neq' }); return api },
    is(col, val) { st.filters.push({ col, val, op: val === null ? 'isNull' : 'is' }); return api },
    in(col, vals) { st.inFilter = { col, vals }; return api },
    gte() { return api }, lte() { return api }, gt() { return api }, lt() { return api },
    ilike() { return api }, or() { return api }, not() { return api }, order() { return api },
    limit(n) { st.limit = n; return api },
    single() { return Promise.resolve(terminal(st)) },
    maybeSingle() { return Promise.resolve(terminal(st)) },
    then(resolve, reject) { return Promise.resolve(terminal(st)).then(resolve, reject) },
    catch(reject) { return Promise.resolve(terminal(st)).catch(reject) }
  }
  return api
}

function terminal(st) {
  if (st.op === 'select' && __state.failSelect) {
    __state.failSelect = false
    return { data: null, error: { code: 'PGRST301', message: 'select gagal: simulasi jaringan putus' } }
  }
  if (st.op === 'insert' || st.op === 'upsert') {
    if (__state.failInsertTable === st.table && (__state.failInsertMode || 'first') === 'first') {
      __state.failInsertTable = null
      return { data: null, error: { code: '23503', message: 'insert or update violates foreign key constraint' } }
    }
    if (__state.failInsertTable === st.table && __state.failInsertMode === 'second') {
      const n = __callsOf(st.op, st.table).length
      if (n >= 2) {
        __state.failInsertTable = null
        return { data: null, error: { code: '23503', message: 'insert or update violates foreign key constraint' } }
      }
    }
    const check = applyCheckConstraint(st.table, st.data)
    if (check) return { data: null, error: check }
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
    if (__state.failUpdate) {
      __state.failUpdate = false
      return { data: null, error: { code: 'XXOOO', message: 'update gagal: simulasi konflik tulis' } }
    }
    const check = applyCheckConstraint(st.table, st.data)
    if (check) return { data: null, error: check }
    const rows = __rows(st.table).filter(r => matches(r, st.filters))
    for (const r of rows) Object.assign(tableOf(st.table).get(r.id), st.data)
    return { data: rows.map(r => ({ ...tableOf(st.table).get(r.id) })), error: null }
  }
  if (st.op === 'delete') {
    const rows = __rows(st.table).filter(r => matches(r, st.filters))
    for (const r of rows) tableOf(st.table).delete(r.id)
    return { data: rows, error: null }
  }
  return { data: runSelect(st), error: null }
}

export const supabase = {
  from: (table) => makeBuilder(table),
  rpc: async (fn, args) => {
    __state.calls.push({ op: 'rpc', fn, args })
    return { data: null, error: null }
  }
}
