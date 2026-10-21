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
  receivings: new Map(),  // id -> row
  prItems: new Map(),     // id -> row
  receivingItems: new Map(), // id -> row (pr_item_id + receiving_id)
  // Ledger per barang (t_7bc6246b). DEFAULT: TIDAK ADA — meniru PostgREST
  // yang menjawab PGRST205 untuk tabel yang belum dimigrasikan. Tanpa ini,
  // mock diam-diam mengembalikan [] dan capability probe menyimpulkan
  // "skema siap" padahal tidak — persis kelas bug "mock berbohong".
  ledger: null,            // null = belum ada; {receivingEvents:[], handoverItems:[], returnLines:[], returnCases:[], progress:[]} = ada
  calls: [],              // {op, table, ...}
  nextError: null
}

export function __reset({ handovers = [], receivings = [], prItems = [], receivingItems = [], ledger = null } = {}) {
  __state.handovers = new Map(handovers.map(r => [r.id, { ...r }]))
  __state.receivings = new Map(receivings.map(r => [r.id, { ...r }]))
  __state.prItems = new Map(prItems.map(r => [r.id, { ...r }]))
  __state.receivingItems = new Map(receivingItems.map((r, i) => [r.id || `ri${i}`, { ...r }]))
  __state.ledger = ledger ? {
    receivingEvents: (ledger.receivingEvents || []).map(r => ({ ...r })),
    handoverItems: (ledger.handoverItems || []).map(r => ({ ...r })),
    returnLines: (ledger.returnLines || []).map(r => ({ ...r })),
    returnCases: (ledger.returnCases || []).map(r => ({ ...r })),
    progress: (ledger.progress || []).map(r => ({ ...r }))
  } : null
  __state.calls = []
  __state.nextError = null
}

// Tabel pendukung untuk modul Handover (distribusi fisik).
function storeOf(table) {
  if (table === 'handovers') return __state.handovers
  if (table === 'receivings') return __state.receivings
  if (table === 'pr_items') return __state.prItems
  if (table === 'receiving_items') return __state.receivingItems
  return null
}

// Tabel ledger: hanya "ada" bila __reset({ledger:...}) dipanggil.
const LEDGER_TABLES = ['receiving_events', 'handover_items', 'return_lines', 'return_cases', 'v_receipt_progress']

function ledgerRows(table) {
  if (!__state.ledger) return null
  if (table === 'receiving_events') return __state.ledger.receivingEvents
  if (table === 'handover_items') return __state.ledger.handoverItems
  if (table === 'return_lines') return __state.ledger.returnLines
  if (table === 'return_cases') return __state.ledger.returnCases
  if (table === 'v_receipt_progress') return __state.ledger.progress
  return null
}

function missingTableError(table) {
  return {
    code: 'PGRST205',
    message: `Could not find the table 'public.${table}' in the schema cache`,
    details: null,
    hint: null
  }
}

function idFilter(st) {
  const eqF = st.filters.find(f => f.col === 'id' && !f.vals)
  if (eqF) return r => r.id === eqF.val
  const inF = st.filters.find(f => f.col === 'id' && f.vals)
  if (inF) return r => inF.vals.includes(r.id)
  return null
}

export function __callsOf(op, table) {
  return __state.calls.filter(c => c.op === op && (!table || c.table === table))
}

function terminal(st, unwrap = false) {
  const res = terminalRaw(st)
  if (!unwrap) return res
  // single()/maybeSingle(): data jadi baris tunggal (null bila kosong),
  // sesuai kontrak @supabase/supabase-js asli.
  if (res.error) return { data: null, error: res.error }
  const rows = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : [])
  return { data: rows.length ? rows[0] : null, error: null }
}

function terminalRaw(st) {
  if (__state.nextError) {
    const err = __state.nextError
    __state.nextError = null
    return { data: null, error: err }
  }
  if (st.op === 'insert') {
    const size = __state.handovers.size + __state.receivings.size + __state.prItems.size + __state.receivingItems.size
    const row = { id: `gen-${size}-${Math.random().toString(36).slice(2, 7)}`, ...st.data }
    const store = storeOf(st.table)
    if (store) store.set(row.id, { ...row })
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
    // Tabel pendukung (receivings / pr_items / receiving_items).
    const store = storeOf(st.table)
    if (store) {
      const pred = idFilter(st)
      const rows = [...store.values()].filter(pred || (() => true))
      for (const r of rows) Object.assign(r, st.data)
      return { data: rows.map(r => ({ ...r })), error: null }
    }
    return { data: [{}], error: null }
  }
  // select — tabel pendukung (mengembalikan semua baris bila tanpa filter)
  const store = storeOf(st.table)
  if (store) {
    let rows = [...store.values()].map(r => ({ ...r }))
    for (const f of st.filters) {
      if (f.col === 'id' && f.vals) rows = rows.filter(r => f.vals.includes(r.id))
      else if (f.col === 'id' && f.val !== undefined) rows = rows.filter(r => r.id === f.val)
      else if (f.col === 'receiving_id') rows = rows.filter(r => r.receiving_id === f.val)
      else if (f.col === 'pr_item_id') rows = rows.filter(r => r.pr_item_id === f.val)
    }
    if (st.table === 'handovers') {
      // CAS emulasi handovers: .is('diserahkan_at', null) hanya cocok bila NULL.
      const isF = st.filters.find(f => f.col === 'diserahkan_at' && f.isNull)
      if (isF) rows = rows.filter(r => r.diserahkan_at === null || r.diserahkan_at === undefined)
    }
    return { data: rows, error: null }
  }
  // select — tabel ledger (hanya ada bila __reset({ledger}) dipanggil).
  if (LEDGER_TABLES.includes(st.table)) {
    const rows0 = ledgerRows(st.table)
    if (rows0 === null) return { data: null, error: missingTableError(st.table) }
    let rows = rows0.map(r => ({ ...r }))
    for (const f of st.filters) {
      if (f.col === 'receiving_id') rows = rows.filter(r => r.receiving_id === f.val)
      else if (f.col === 'receiving_event_id' && f.vals) rows = rows.filter(r => f.vals.includes(r.receiving_event_id))
      else if (f.col === 'receiving_event_id' && f.val !== undefined) rows = rows.filter(r => r.receiving_event_id === f.val)
      else if (f.col === 'handover_id') rows = rows.filter(r => r.handover_id === f.val)
    }
    return { data: rows, error: null }
  }
  // select (tabel tanpa store khusus: mengembalikan semua baris seperti semula)
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
    in(col, vals) { st.filters.push({ col, vals }); return api },
    neq() { return api },
    is(col, val) { st.filters.push({ col, val, isNull: val === null }); return api },
    or() { return api },
    not() { return api },
    order() { return api },
    limit() { return api },
    single() { return Promise.resolve(terminal(st, true)) },
    // maybeSingle seperti @supabase/supabase-js asli: data = baris tunggal
    // (atau null bila tidak ada), BUKAN array. Ini penting karena pemanggil
    // melakukan `data.receiving_id` — mengembalikan wrapper membuat field
    // undefined dan alur distribusi gagal diam-diam.
    maybeSingle() { return Promise.resolve(terminal(st, true)) },
    then(resolve, reject) { return Promise.resolve(terminal(st)).then(resolve, reject) },
    catch(reject) { return Promise.resolve(terminal(st)).catch(reject) }
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
    return { data: null, error: null }
  }
}
