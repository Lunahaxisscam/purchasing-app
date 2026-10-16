// ============================================================
// MOCK supabaseClient untuk harness receipt-flow-test (bukan file produksi).
// - Merekam SEMUA operasi (insert/update/select/rpc) ke __state.calls
// - Mengemulasi compare-and-swap pada receiving_items seperti server:
//     update(...).eq('id',x).eq('quantity_received',v).select()
//     update(...).eq('id',x).or('quantity_received.eq.0,quantity_received.is.null').select()
//   -> 1 baris dikembalikan bila snapshot cocok, 0 baris bila tidak.
// - NULL quantity_received diperlakukan sebagai 0 (perilaku data lama).
// - insert receiving_items menghasilkan id unik + mendukung error 23505 palsu.
// ============================================================

export const __state = {
  rows: new Map(),      // id -> row (tabel receiving_items saja)
  calls: [],            // {op, table, ...}
  failInsertOnce: false,
  nextError: null
}

export function __reset({ rows = [], failInsertOnce = false } = {}) {
  __state.rows = new Map(rows.map(r => [r.id, { ...r }]))
  __state.calls = []
  __state.failInsertOnce = failInsertOnce
  __state.nextError = null
}

export function __callsOf(op, table) {
  return __state.calls.filter(c => c.op === op && (!table || c.table === table))
}

function terminal(st) {
  if (st.op === 'insert') {
    if (__state.failInsertOnce) {
      __state.failInsertOnce = false
      return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
    }
    const row = { id: `gen-${__state.rows.size + 1}-${Math.random().toString(36).slice(2, 7)}`, ...st.data }
    if (st.table === 'receiving_items') __state.rows.set(row.id, { ...row })
    return { data: [row], error: null }
  }
  if (st.op === 'update') {
    if (st.table === 'receiving_items') {
      const idF = st.filters.find(f => f.col === 'id')
      const row = idF ? __state.rows.get(idF.val) : null
      if (!row) return { data: [], error: null }
      const current = row.quantity_received === null || row.quantity_received === undefined ? 0 : Number(row.quantity_received)
      const qtyF = st.filters.find(f => f.col === 'quantity_received')
      let match = true
      if (qtyF) match = current === Number(qtyF.val)
      else if (st.orExpr) match = current === 0
      if (!match) return { data: [], error: null }
      Object.assign(row, st.data)
      return { data: [{ ...row }], error: null }
    }
    return { data: [{}], error: null }
  }
  // select
  if (st.table === 'receiving_items' && st.inFilter) {
    const ids = new Set(st.inFilter.vals)
    const data = [...__state.rows.values()]
      .filter(r => ids.has(r.id))
      .map(r => ({ id: r.id, quantity_received: r.quantity_received }))
    return { data, error: null }
  }
  return { data: [], error: null }
}

function makeBuilder(table) {
  const st = { table, op: null, data: null, filters: [], orExpr: null, inFilter: null }
  const api = {
    select() {
      if (!st.op) st.op = 'select'
      if (st.op !== 'update') __state.calls.push({ op: 'select', table })
      return api
    },
    insert(d) { st.op = 'insert'; st.data = d; __state.calls.push({ op: 'insert', table, data: d }); return api },
    update(d) {
      st.op = 'update'; st.data = d
      __state.calls.push({ op: 'update', table, data: d, filters: st.filters, or: st.orExpr })
      return api
    },
    delete() { st.op = 'delete'; return api },
    eq(col, val) { st.filters.push({ col, val }); return api },
    neq() { return api },
    is() { return api },
    in(col, vals) { st.inFilter = { col, vals }; return api },
    or(expr) { st.orExpr = expr; return api },
    not() { return api },
    order() { return api },
    limit() { return api },
    single() { return Promise.resolve(terminal(st)) },
    maybeSingle() { return Promise.resolve(terminal(st)) },
    then(resolve, reject) { return Promise.resolve(terminal(st)).then(resolve, reject) },
    catch(reject) { return Promise.resolve(terminal(st)).catch(reject) }
  }
  return api
}

export const supabase = {
  from: (table) => makeBuilder(table),
  rpc: async (fn, args) => {
    __state.calls.push({ op: 'rpc', fn, args })
    return { data: null, error: null }
  }
}
