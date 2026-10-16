// ============================================================
// MOCK supabaseClient untuk harness handover-flow-test (bukan file produksi).
// - Merekam SEMUA operasi (insert/update/select/rpc) ke __state.calls
// - Mengemulasi compare-and-swap pada handovers seperti server:
//     update(...).eq('id',x).is('diserahkan_at', null).select()
//   -> 1 baris dikembalikan bila diserahkan_at masih NULL, 0 baris bila tidak.
// - insert handovers menghasilkan id unik.
// ============================================================

export const __state = {
  handovers: new Map(),   // id -> row
  calls: [],              // {op, table, ...}
  nextError: null
}

export function __reset({ handovers = [] } = {}) {
  __state.handovers = new Map(handovers.map(r => [r.id, { ...r }]))
  __state.calls = []
  __state.nextError = null
}

export function __callsOf(op, table) {
  return __state.calls.filter(c => c.op === op && (!table || c.table === table))
}

function terminal(st) {
  if (__state.nextError) {
    const err = __state.nextError
    __state.nextError = null
    return { data: null, error: err }
  }
  if (st.op === 'insert') {
    const row = { id: `gen-${__state.handovers.size + 1}-${Math.random().toString(36).slice(2, 7)}`, ...st.data }
    if (st.table === 'handovers') __state.handovers.set(row.id, { ...row })
    return { data: [row], error: null }
  }
  if (st.op === 'update') {
    if (st.table === 'handovers') {
      const idF = st.filters.find(f => f.col === 'id')
      const row = idF ? __state.handovers.get(idF.val) : null
      if (!row) return { data: [], error: null }
      // CAS: .is('diserahkan_at', null) -> hanya cocok bila masih NULL.
      const isF = st.filters.find(f => f.col === 'diserahkan_at' && f.isNull)
      if (isF) {
        if (row.diserahkan_at !== null && row.diserahkan_at !== undefined) return { data: [], error: null }
      }
      Object.assign(row, st.data)
      return { data: [{ ...row }], error: null }
    }
    return { data: [{}], error: null }
  }
  // select
  if (st.table === 'handovers') {
    return { data: [...__state.handovers.values()].map(r => ({ ...r })), error: null }
  }
  return { data: [], error: null }
}

function makeBuilder(table) {
  const st = { table, op: null, data: null, filters: [] }
  const api = {
    select() {
      if (!st.op) st.op = 'select'
      if (st.op !== 'update') __state.calls.push({ op: 'select', table })
      return api
    },
    insert(d) { st.op = 'insert'; st.data = d; __state.calls.push({ op: 'insert', table, data: d }); return api },
    update(d) {
      st.op = 'update'; st.data = d
      __state.calls.push({ op: 'update', table, data: d, filters: st.filters })
      return api
    },
    delete() { st.op = 'delete'; __state.calls.push({ op: 'delete', table }); return api },
    eq(col, val) { st.filters.push({ col, val }); return api },
    neq() { return api },
    is(col, val) { st.filters.push({ col, val, isNull: val === null }); return api },
    in() { return api },
    or() { return api },
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
