// ============================================================
// mock-supabaseClient.mjs — MOCK Supabase untuk HARNESS API (BUKAN produksi)
// ============================================================
// Turunan dari mock harness konektor (t_310dfb07) + kemampuan yang dibutuhkan
// jalur baca API:
//   * select(cols, { count:'exact' }) -> count total SEBELUM limit/range
//   * ilike(col, pattern) dengan escape `\%` dan `\_` (literal, bukan wildcard)
//   * range(from, to) untuk pagination nyata
//   * order(col, { ascending })
//
// Semua operasi DICATAT sehingga tes bisa membuktikan "nol aktivitas DB"
// pada permintaan yang seharusnya ditolak sebelum DB.
// ============================================================

export const __state = {
  tables: new Map(),
  calls: [],
  seq: 0,
  failInsertTable: null,
  failUpdateTable: null,
  rejectDibeliStatus: false,
  missingTables: new Set(),
  corruptOnRead: null,
  rpcResults: new Map(),
  rpcFailTimes: new Map()
}

function tableOf(name) {
  if (!__state.tables.has(name)) __state.tables.set(name, new Map())
  return __state.tables.get(name)
}

export function __reset({ tables = {}, ...opts } = {}) {
  __state.tables = new Map()
  for (const [t, rows] of Object.entries(tables)) {
    const m = new Map()
    for (const r of rows) m.set(r.id, { ...r })
    __state.tables.set(t, m)
  }
  __state.calls = []
  __state.seq = 0
  __state.failInsertTable = opts.failInsertTable || null
  __state.failUpdateTable = opts.failUpdateTable || null
  __state.rejectDibeliStatus = !!opts.rejectDibeliStatus
  __state.missingTables = new Set(opts.missingTables || [])
  __state.corruptOnRead = opts.corruptOnRead || null
  __state.rpcResults = new Map(Object.entries(opts.rpcResults || {}))
  __state.rpcFailTimes = new Map(Object.entries(opts.rpcFailTimes || {}))
}

export function __rows(table) { return [...tableOf(table).values()].map(r => ({ ...r })) }
export function __callsOf(op, table) {
  return __state.calls.filter(c => c.op === op && (!table || c.table === table))
}

function nextId(prefix) {
  __state.seq += 1
  return `${prefix}-${String(__state.seq).padStart(3, '0')}`
}

function matches(row, filters) {
  return (filters || []).every(f => {
    const v = row[f.col]
    if (f.op === 'isNull') return v === null || v === undefined
    if (f.op === 'ilike') {
      // Terjemahkan pola ber-escape menjadi regex literal (case-insensitive).
      const pat = String(f.val ?? '')
      let re = ''
      for (let i = 0; i < pat.length; i++) {
        const ch = pat[i]
        if (ch === '\\' && i + 1 < pat.length) { re += pat[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++; continue }
        if (ch === '%') { re += '.*'; continue }
        if (ch === '_') { re += '.'; continue }
        re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }
      return new RegExp(`^${re}$`, 'i').test(String(v ?? ''))
    }
    return String(v ?? '') === String(f.val ?? '')
  })
}

function missingError(table) {
  if (__state.missingTables.has(table)) {
    return { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }
  }
  return null
}

function runSelect(st) {
  const missing = missingError(st.table)
  if (missing) return { error: missing }
  let rows = __rows(st.table).filter(r => matches(r, st.filters))
  if (st.inFilter) {
    const set = new Set(st.inFilter.vals.map(String))
    rows = rows.filter(r => set.has(String(r[st.inFilter.col])))
  }
  if (__state.corruptOnRead && __state.corruptOnRead.table === st.table) {
    const c = __state.corruptOnRead
    rows = rows.map(r => ((!c.id || String(r.id) === String(c.id)) ? { ...r, ...c.patch } : r))
  }
  const total = rows.length

  if (st.order) {
    const { column, ascending } = st.order
    rows = rows.slice().sort((a, b) => {
      const x = a[column], y = b[column]
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (x < y ? -1 : 1) * (ascending ? 1 : -1)
    })
  }
  if (st.range) {
    const [from, to] = st.range
    rows = rows.slice(from, to + 1)
  } else if (st.limit) {
    rows = rows.slice(0, st.limit)
  }
  return { data: rows, count: total }
}

function makeBuilder(table) {
  const st = { table, op: null, data: null, filters: [], inFilter: null, limit: null, range: null, order: null, wantCount: false }
  const api = {
    select(cols, opts) {
      if (!st.op) st.op = 'select'
      if (opts && opts.count === 'exact') st.wantCount = true
      if (st.op === 'select') __state.calls.push({ op: 'select', table, cols: String(cols || '') })
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
    delete() { st.op = 'delete'; __state.calls.push({ op: 'delete', table }); return api },
    eq(col, val) { st.filters.push({ col, val }); return api },
    in(col, vals) { st.inFilter = { col, vals }; return api },
    is(col, val) { st.filters.push({ col, val, op: val === null ? 'isNull' : 'is' }); return api },
    neq(col, val) { st.filters.push({ col, val, op: 'neq' }); return api },
    ilike(col, val) { st.filters.push({ col, val, op: 'ilike' }); return api },
    or() { return api },
    not() { return api },
    order(col, opts) {
      st.order = { column: col, ascending: !(opts && opts.ascending === false) }
      return api
    },
    limit(n) { st.limit = n; return api },
    range(from, to) { st.range = [from, to]; return api },
    single() { return Promise.resolve(terminal(st)) },
    maybeSingle() { return Promise.resolve(terminal(st)) },
    then(resolve, reject) { return Promise.resolve(terminal(st)).then(resolve, reject) },
    catch(reject) { return Promise.resolve(terminal(st)).catch(reject) }
  }
  return api
}

function terminal(st) {
  const missing = missingError(st.table)
  if (missing) return { data: null, error: missing }

  if (st.op === 'select') {
    const r = runSelect(st)
    if (r.error) return { data: null, error: r.error }
    return { data: r.data, error: null, count: st.wantCount ? r.count : null }
  }

  if (st.op === 'insert') {
    const f = __state.failInsertTable
    if (f && f.table === st.table) {
      if (f.when === 'always') return { data: null, error: { code: '23503', message: 'insert ditolak (simulasi)' } }
      if (f.when === 'afterHeader') {
        const n = __callsOf('insert', st.table).length
        if (n >= (f.after || 1)) return { data: null, error: { code: '23503', message: 'insert ditolak (simulasi tengah)' } }
      }
    }
    if (__state.rejectDibeliStatus && st.table === 'receivings' && String(st.data?.status || '') === 'DIBELI') {
      return { data: null, error: { code: '23514', message: 'violates check constraint "receivings_status_check"' } }
    }
    const list = Array.isArray(st.data) ? st.data : [st.data]
    const inserted = []
    for (const d of list) {
      if (st.table === 'bakpau_events') {
        const dup = __rows(st.table).find(r => r.dedup_key === d.dedup_key)
        if (dup) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "bakpau_events_dedup_key_uniq"' } }
      }
      const row = { id: d.id || nextId(st.table.slice(0, 3)), ...d }
      tableOf(st.table).set(row.id, row)
      inserted.push({ ...row })
    }
    return { data: inserted, error: null }
  }

  if (st.op === 'update') {
    const f = __state.failUpdateTable
    if (f && f.table === st.table) return { data: null, error: { code: 'XX000', message: 'update ditolak (simulasi)' } }
    if (__state.rejectDibeliStatus && st.table === 'receivings' && String(st.data?.status || '') === 'DIBELI') {
      return { data: null, error: { code: '23514', message: 'violates check constraint "receivings_status_check"' } }
    }
    const rows = __rows(st.table).filter(r => matches(r, st.filters))
    for (const r of rows) Object.assign(tableOf(st.table).get(r.id), st.data)
    return { data: rows.map(r => ({ ...tableOf(st.table).get(r.id) })), error: null }
  }

  if (st.op === 'delete') {
    const rows = __rows(st.table).filter(r => matches(r, st.filters))
    for (const r of rows) tableOf(st.table).delete(r.id)
    return { data: rows, error: null }
  }
  return { data: [], error: null }
}

export const supabase = {
  from: table => makeBuilder(table),
  rpc: async (fn, args) => {
    __state.calls.push({ op: 'rpc', fn, args })
    const fails = __state.rpcFailTimes.get(fn) || 0
    if (fails > 0) {
      __state.rpcFailTimes.set(fn, fails - 1)
      return { data: { ok: false, error: 'simulasi: telegram api gagal' }, error: null }
    }
    const queue = __state.rpcResults.get(fn)
    if (queue && queue.length) {
      const next = queue.shift()
      return { data: next, error: null }
    }
    return { data: { ok: true, status: 200 }, error: null }
  }
}
