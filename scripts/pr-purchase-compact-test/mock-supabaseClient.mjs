// ============================================================
// MOCK supabaseClient untuk harness pr-purchase-compact-test (BUKAN produksi).
// - Merekam SEMUA operasi (insert/update/select/delete/rpc) ke __state.calls
// - Mengemulasi tabel purchase_requests / pr_items / receivings /
//   receiving_items / handovers secukupnya supaya alur PR & Purchase bisa
//   diuji tanpa DB.
// ============================================================

export const __state = {
  tables: new Map(),     // table -> Map(id -> row)
  calls: [],
  seq: 0
}

function tableOf(name) {
  if (!__state.tables.has(name)) __state.tables.set(name, new Map())
  return __state.tables.get(name)
}

export function __reset({ tables = {} } = {}) {
  __state.tables = new Map()
  for (const [t, rows] of Object.entries(tables)) {
    const m = new Map()
    for (const r of rows) m.set(r.id, { ...r })
    __state.tables.set(t, m)
  }
  __state.calls = []
  __state.seq = 0
}

export function __rows(table) {
  return [...tableOf(table).values()]
}

export function __callsOf(op, table) {
  return __state.calls.filter(c => c.op === op && (!table || c.table === table))
}

function nextId(prefix) {
  __state.seq += 1
  return `${prefix}-${__state.seq}`
}

function matches(row, filters) {
  return (filters || []).every(f => {
    const v = row[f.col]
    if (f.op === 'isNull') return v === null || v === undefined
    return String(v ?? '') === String(f.val ?? '')
  })
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
    insert(d) {
      st.op = 'insert'
      st.data = d
      __state.calls.push({ op: 'insert', table, data: d })
      return api
    },
    update(d) {
      st.op = 'update'
      st.data = d
      __state.calls.push({ op: 'update', table, data: d, filters: st.filters })
      return api
    },
    delete() { st.op = 'delete'; __state.calls.push({ op: 'delete', table, filters: st.filters }); return api },
    eq(col, val) { st.filters.push({ col, val }); return api },
    neq(col, val) { st.filters.push({ col, val, op: 'neq' }); return api },
    is(col, val) { st.filters.push({ col, val, op: val === null ? 'isNull' : 'is' }); return api },
    in(col, vals) { st.inFilter = { col, vals }; return api },
    or() { return api },
    not() { return api },
    order() { return api },
    limit(n) { st.limit = n; return api },
    single() { st.single = true; return Promise.resolve(terminal(st)) },
    maybeSingle() { st.single = true; return Promise.resolve(terminal(st)) },
    then(resolve, reject) { return Promise.resolve(terminal(st)).then(resolve, reject) },
    catch(reject) { return Promise.resolve(terminal(st)).catch(reject) }
  }
  return api
}

function terminal(st) {
  if (st.op === 'insert') {
    const list = Array.isArray(st.data) ? st.data : [st.data]
    const inserted = []
    for (const d of list) {
      const row = { id: d.id || nextId(st.table.slice(0, 3)), ...d }
      tableOf(st.table).set(row.id, row)
      inserted.push({ ...row })
    }
    // PostgREST: insert().select() SELALU mengembalikan array; .single()
    // mengembalikan satu objek. Dua bentuk ini dibedakan supaya pemanggil
    // yang memakai data?.[0]?.id (purchaseSave) berperilaku seperti produksi.
    return { data: st.single ? (inserted[0] || null) : inserted, error: null }
  }
  if (st.op === 'update') {
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
    if (fn === 'next_pr_number') return { data: 'PR-777', error: null }
    return { data: null, error: null }
  }
}
