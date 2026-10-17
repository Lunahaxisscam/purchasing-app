// ============================================================
// MOCK supabaseClient — harness receiving-events-test (BUKAN file produksi)
// ============================================================
// Mengemulasi PostgREST + RPC yang dipakai alur per barang:
//   - capability probe  : from(t).select(cols).limit(1)  → 404 PGRST205
//                         bila tabel belum "ada" (default)
//   - baca event        : from('receiving_events').select().eq().order()
//   - baca handover_items: from('handover_items').select().in()
//   - rpc receipt_apply_events : dedupe client_event_id + update
//                                receiving_items.quantity_received = Σ datang
//   - rpc handover_confirm     : CAS diserahkan_at + insert handover_items
//   - rpc return_create        : insert return_cases/return_lines
// Semua panggilan direkam di __state.calls supaya test bisa membuktikan
// "nol tulisan" pada jalur yang diblokir.
// ============================================================

export const __state = {
  tables: new Set(),            // tabel yang "ada" di skema
  rows: new Map(),              // 'table:id' -> row
  events: [],                   // receiving_events tersimpan
  handoverItems: [],            // handover_items tersimpan
  returnCases: [],
  returnLines: [],
  calls: [],
  rpcResult: null,              // override hasil RPC berikutnya (uji error)
  nextError: null
}

export function __reset({ tables = [], receivingItems = [], events = [], handoverItems = [], handovers = [], rpcResult = null } = {}) {
  __state.tables = new Set(tables)
  __state.rows = new Map()
  for (const r of receivingItems) __state.rows.set('receiving_items:' + r.id, { ...r })
  for (const h of handovers) __state.rows.set('handovers:' + h.id, { ...h })
  __state.events = events.map(e => ({ ...e }))
  __state.handoverItems = handoverItems.map(h => ({ ...h }))
  __state.returnCases = []
  __state.returnLines = []
  __state.calls = []
  __state.rpcResult = rpcResult
  __state.nextError = null
}

export const __callsOf = (op, table) =>
  __state.calls.filter(c => c.op === op && (!table || c.table === table))

export const __rpcCalls = (fn) =>
  __state.calls.filter(c => c.op === 'rpc' && (!fn || c.fn === fn))

const MISSING = (t) => ({ code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` })

function exists(t) { return __state.tables.has(t) }

function selectRows(table, st) {
  if (!exists(table)) return { data: null, error: MISSING(table) }
  if (table === 'receiving_events') {
    let list = __state.events.slice()
    for (const f of st.filters) {
      if (f.col === 'receiving_id') list = list.filter(e => e.receiving_id === f.val)
    }
    return { data: list, error: null }
  }
  if (table === 'handover_items') {
    let list = __state.handoverItems.slice()
    if (st.inFilter) {
      const set = new Set(st.inFilter.vals)
      list = list.filter(h => set.has(h[st.inFilter.col]))
    }
    for (const f of st.filters) {
      if (f.col === 'handover_id') list = list.filter(h => h.handover_id === f.val)
    }
    return { data: list, error: null }
  }
  if (table === 'receiving_items') {
    let list = [...__state.rows.entries()].filter(([k]) => k.startsWith('receiving_items:')).map(([, v]) => v)
    if (st.inFilter) {
      const set = new Set(st.inFilter.vals)
      list = list.filter(r => set.has(r[st.inFilter.col]))
    }
    for (const f of st.filters) {
      if (f.col === 'id') list = list.filter(r => r.id === f.val)
    }
    return { data: list.map(r => ({ id: r.id, receiving_id: r.receiving_id, quantity_received: r.quantity_received })), error: null }
  }
  if (table === 'return_lines') {
    let list = [...__state.rows.entries()].filter(([k]) => k.startsWith('return_lines:')).map(([, v]) => v)
    if (st.inFilter) {
      const set = new Set(st.inFilter.vals)
      list = list.filter(r => set.has(r[st.inFilter.col]))
    }
    return { data: list, error: null }
  }
  if (table === 'receivings') {
    let list = [...__state.rows.entries()].filter(([k]) => k.startsWith('receivings:')).map(([, v]) => v)
    for (const f of st.filters) {
      if (f.col === 'id') list = list.filter(r => r.id === f.val)
    }
    return { data: list, error: null }
  }
  if (table === 'handovers') {
    let list = [...__state.rows.entries()].filter(([k]) => k.startsWith('handovers:')).map(([, v]) => v)
    for (const f of st.filters) {
      if (f.col === 'id') list = list.filter(r => r.id === f.val)
    }
    return { data: list, error: null }
  }
  return { data: [], error: null }
}

// --- RPC emulation -------------------------------------------------------
function rpcReceiptApply(args) {
  const receivingId = args.p_receiving_id
  const events = Array.isArray(args.p_events) ? args.p_events : []
  const seen = new Set(__state.events.map(e => e.client_event_id))
  let applied = 0, already = 0
  const ids = []
  for (const ev of events) {
    if (seen.has(ev.client_event_id)) { already++; continue }
    const row = {
      id: 'ev-' + (__state.events.length + 1),
      receiving_id: receivingId,
      ...ev
    }
    __state.events.push(row)
    seen.add(ev.client_event_id)
    ids.push(row.id)
    applied++
  }
  // Σ qty_datang per item → quantity_received (D3 kontrak)
  const totals = new Map()
  for (const e of __state.events.filter(e => e.receiving_id === receivingId)) {
    const k = e.receiving_item_id
    totals.set(k, (totals.get(k) || 0) + Number(e.qty_datang || 0))
  }
  for (const [itemId, qty] of totals) {
    const row = __state.rows.get('receiving_items:' + itemId)
    if (row) row.quantity_received = qty
  }
  return {
    data: { ok: true, applied, already_applied: already, event_ids: ids, item_totals: [...totals].map(([k, v]) => ({ receiving_item_id: k, qty_datang: v })) },
    error: null
  }
}

function rpcHandoverConfirm(args) {
  const h = __state.rows.get('handovers:' + args.p_handover_id)
  if (!h) return { data: { ok: false, error: 'Handover tidak ada' }, error: null }
  const lines = Array.isArray(args.p_lines) ? args.p_lines : []
  if (h.diserahkan_at) {
    return { data: { ok: true, already: true, inserted: 0, diserahkan_at: h.diserahkan_at }, error: null }
  }
  h.status = 'CONFIRMED'
  h.diserahkan_at = '2026-10-17T09:00:00.000Z'
  let inserted = 0
  for (const l of lines) {
    const dup = __state.handoverItems.some(x => x.handover_id === h.id && x.receiving_event_id === l.receiving_event_id)
    if (dup) continue
    __state.handoverItems.push({ id: 'hi-' + (__state.handoverItems.length + 1), handover_id: h.id, ...l })
    inserted++
  }
  return { data: { ok: true, inserted, diserahkan_at: h.diserahkan_at }, error: null }
}

function rpcReturnCreate(args) {
  const lines = Array.isArray(args.p_lines) ? args.p_lines : []
  const c = { id: 'rc-' + (__state.returnCases.length + 1), receiving_id: args.p_receiving_id, resolution: args.p_resolution, reason: args.p_reason, status: 'PENDING_SUPPLIER' }
  __state.returnCases.push(c)
  for (const l of lines) {
    __state.returnLines.push({ id: 'rl-' + (__state.returnLines.length + 1), return_case_id: c.id, ...l })
    const ev = __state.events.find(e => e.id === l.receiving_event_id)
    if (ev) ev.retur_status = args.p_resolution === 'DISCARD' ? 'DISCARDED' : 'PENDING'
  }
  return { data: { ok: true, return_case_id: c.id, lines }, error: null }
}

function makeBuilder(table) {
  const st = { table, op: null, data: null, filters: [], inFilter: null, limitN: null }
  const api = {
    select() { if (!st.op) st.op = 'select'; __state.calls.push({ op: 'select', table, filters: st.filters }); return api },
    insert(d) {
      st.op = 'insert'; st.data = d
      __state.calls.push({ op: 'insert', table, data: d })
      if (table === 'receivings') {
        const row = { id: 'new-rec-' + (__state.rows.size + 1), ...d }
        __state.rows.set('receivings:' + row.id, row)
        return { select: () => ({ then: (r) => Promise.resolve({ data: [row], error: null }).then(r) }), then: (r) => Promise.resolve({ data: [row], error: null }).then(r) }
      }
      return api
    },
    update(d) {
      st.op = 'update'; st.data = d
      __state.calls.push({ op: 'update', table, data: d, filters: st.filters, or: st.orExpr })
      return api
    },
    delete() { st.op = 'delete'; __state.calls.push({ op: 'delete', table }); return api },
    eq(col, val) { st.filters.push({ col, val }); return api },
    neq() { return api },
    is() { return api },
    in(col, vals) { st.inFilter = { col, vals }; return api },
    or(expr) { st.orExpr = expr; return api },
    not() { return api },
    order() { return api },
    limit(n) { st.limitN = n; return api },
    single() { return Promise.resolve(terminal(st)) },
    maybeSingle() { return Promise.resolve(terminal(st)) },
    then(resolve, reject) { return Promise.resolve(terminal(st)).then(resolve, reject) },
    catch(reject) { return Promise.resolve(terminal(st)).catch(reject) }
  }
  return api
}

function terminal(st) {
  if (st.op === 'insert') {
    if (st.table === 'receiving_items') {
      const row = { id: 'gen-' + (__state.rows.size + 1), ...st.data }
      __state.rows.set('receiving_items:' + row.id, row)
      return { data: [row], error: null }
    }
    return { data: [{ id: 'gen-' + Math.random().toString(36).slice(2, 7), ...st.data }], error: null }
  }
  if (st.op === 'update') {
    const idF = st.filters.find(f => f.col === 'id')
    const key = idF ? `${st.table}:${idF.val}` : null
    const row = key ? __state.rows.get(key) : null
    if (st.table === 'receiving_items' && row) {
      const current = row.quantity_received === null || row.quantity_received === undefined ? 0 : Number(row.quantity_received)
      const qtyF = st.filters.find(f => f.col === 'quantity_received')
      let match = true
      if (qtyF) match = current === Number(qtyF.val)
      else if (st.orExpr) match = current === 0
      if (!match) return { data: [], error: null }
      Object.assign(row, st.data)
      return { data: [{ ...row }], error: null }
    }
    if (row) { Object.assign(row, st.data); return { data: [{ ...row }], error: null } }
    // pemindahan item (receiving_id) atau tabel tanpa row tercatat
    return { data: [{}], error: null }
  }
  return selectRows(st.table, st)
}

export const supabase = {
  from: (table) => makeBuilder(table),
  rpc: async (fn, args) => {
    __state.calls.push({ op: 'rpc', fn, args })
    if (__state.rpcResult) {
      const res = __state.rpcResult
      __state.rpcResult = null
      return res
    }
    if (fn === 'receipt_apply_events') return rpcReceiptApply(args)
    if (fn === 'handover_confirm') return rpcHandoverConfirm(args)
    if (fn === 'return_create') return rpcReturnCreate(args)
    return { data: null, error: null }
  }
}
