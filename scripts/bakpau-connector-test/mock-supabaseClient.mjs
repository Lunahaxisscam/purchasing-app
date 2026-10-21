// ============================================================
// MOCK Supabase (HARNESS SAJA) — merekam semua operasi
// ============================================================
// BUKAN file produksi. Dipakai harness konektor Bakpau untuk menjalankan
// adapter + boundary pembelian yang ASLI tanpa DB.
//
// Kemampuan yang dibutuhkan skenario uji:
//   * merekam setiap insert/update/select/rpc (untuk membuktikan "nol tulisan")
//   * menolak insert/update pada tabel tertentu (simulasi gagal simpan)
//   * menolak nilai status DIBELI (CHECK constraint -> fallback penanda)
//   * gagal pada readback (baris hilang / qty berubah) -> status bukan 'tercatat'
//   * gagal pada RPC kirim notifikasi (tanpa mengulang tulisan pembelian)
//   * tabel ledger tidak ada (PGRST205) untuk uji fail-closed
// ============================================================

export const __state = {
  tables: new Map(),
  calls: [],
  seq: 0,
  // kontrol kegagalan (sekali pakai / permanen sesuai nama)
  failInsertTable: null,      // { table, when:'always'|'afterHeader' }
  failUpdateTable: null,
  rejectDibeliStatus: false,
  missingTables: new Set(),   // tabel yang dianggap TIDAK ADA (PGRST205)
  corruptOnRead: null,        // { table, id, patch } -> readback melihat nilai salah
  rpcResults: new Map(),      // fn -> array hasil berurutan
  rpcFailTimes: new Map()     // fn -> berapa kali gagal dulu
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
export function __writeCalls() {
  return __state.calls.filter(c => ['insert', 'update', 'delete', 'rpc'].includes(c.op)
    && !['bakpau_events'].includes(c.table))
}

function nextId(prefix) {
  __state.seq += 1
  return `${prefix}-${String(__state.seq).padStart(3, '0')}`
}

function matches(row, filters) {
  return (filters || []).every(f => {
    const v = row[f.col]
    if (f.op === 'isNull') return v === null || v === undefined
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
  // Simulasi data rusak saat dibaca (readback mismatch). Default: SEMUA baris
  // tabel itu (id baris hasil insert tidak bisa ditebak di muka).
  if (__state.corruptOnRead && __state.corruptOnRead.table === st.table) {
    const c = __state.corruptOnRead
    rows = rows.map(r => ((!c.id || String(r.id) === String(c.id)) ? { ...r, ...c.patch } : r))
  }
  if (st.limit) rows = rows.slice(0, st.limit)
  return { data: rows }
}

function makeBuilder(table) {
  const st = { table, op: null, data: null, filters: [], inFilter: null, limit: null }
  const api = {
    select(cols) {
      if (!st.op) st.op = 'select'
      if (st.op === 'select') __state.calls.push({ op: 'select', table })
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
    or() { return api },
    not() { return api },
    order() { return api },
    limit(n) { st.limit = n; return api },
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
    return r.error ? { data: null, error: r.error } : { data: r.data, error: null }
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
      // Unik dedup_key untuk tabel ledger (meniru UNIQUE constraint).
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
  from: table => makeBuilder(table),
  rpc: async (fn, args) => {
    if (__OPS_V1_FNS.has(fn)) return __opsV1Missing(fn)
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
