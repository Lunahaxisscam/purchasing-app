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
  rpcFailTimes: new Map(),
  missingRpc: new Set(),
  failAtomic: null,
  atomicResultPatch: null,
  failSelectTable: null
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
  // Simulasi RPC atomik: fungsi belum di-apply, gagal di tengah transaksi,
  // atau balasan yang tidak konsisten.
  __state.missingRpc = new Set(opts.missingRpc || [])
  __state.failAtomic = opts.failAtomic || null
  __state.atomicResultPatch = opts.atomicResultPatch || null
  __state.failSelectTable = opts.failSelectTable || null
  // Urutan baris ber-kunci kembar dibuat TIDAK stabil antar-panggilan,
  // meniru kebebasan Postgres. Dipakai tes regresi pagination.
  __state.unstableTies = !!opts.unstableTies
  __state.rng = opts.rng || Math.random
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

  // Emulasi bahaya NYATA: Postgres tidak menjamin urutan untuk nilai kunci
  // yang kembar, dan urutannya bisa BERBEDA antar-request. JS Array.sort
  // stabil, jadi tanpa emulasi ini mock SELALU lolos walau tiebreaker hilang
  // (itu sebabnya regresi pagination tidak pernah tertangkap di mock).
  // `unstableTies` memberi setiap baris peringkat acak per-panggilan, lalu
  // dipakai sebagai kunci terakhir — persis efek "urutan tak tentu".
  if (__state.unstableTies) {
    rows = rows.map(r => ({ ...r, __tieRank: __state.rng() }))
  }

  if (st.orders.length) {
    rows = rows.slice().sort((a, b) => {
      for (const { column, ascending } of st.orders) {
        const x = a[column], y = b[column]
        if (x === y) continue
        if (x === null || x === undefined) return 1
        if (y === null || y === undefined) return -1
        return (x < y ? -1 : 1) * (ascending ? 1 : -1)
      }
      if (__state.unstableTies) return a.__tieRank - b.__tieRank
      return 0
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
  const st = { table, op: null, data: null, filters: [], inFilter: null, limit: null, range: null, orders: [], wantCount: false }
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
      // PostgREST mengizinkan `.order()` dirantai: kunci pertama prioritas
      // utama, berikutnya menjadi pemecah seri. Mock harus meniru itu,
      // kalau tidak tes pagination tidak akan pernah menangkap order kembar.
      st.orders.push({ column: col, ascending: !(opts && opts.ascending === false) })
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
  if (__state.failSelectTable === st.table && st.op === 'select') {
    return { data: null, error: { code: '42P01', message: `relation "${st.table}" does not exist at character 15` } }
  }

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

// ------------------------------------------------------------
// SIMULASI RPC ATOMIK `bakpau_save_purchase_atomic`
// ------------------------------------------------------------
// Mock harus meniru SEMANTIK TRANSAKSI, bukan hanya "mengembalikan 200":
//   * snapshot seluruh tabel diambil di awal;
//   * setiap penolakan (duplicate/konflik/invalid) -> snapshot dipulihkan
//     (rollback total, termasuk klaim ledger);
//   * sukses -> satu header + N baris + dua baris ledger 'recorded'.
// Dengan begitu tes "gagal di tengah -> nol tulisan" benar-benar diuji.
const ATOMIC_FN = 'bakpau_save_purchase_atomic'

function snapshotTables() {
  const snap = new Map()
  for (const [name, m] of __state.tables) {
    snap.set(name, new Map([...m].map(([k, v]) => [k, { ...v }])))
  }
  return snap
}

function restoreTables(snap) {
  __state.tables = new Map([...snap].map(([k, m]) => [k, new Map([...m].map(([kk, vv]) => [kk, { ...vv }]))]))
}

function atomicTx(args) {
  const p = args?.p_payload
  const deny = (code, extra = {}) => ({ data: { ok: false, code, ...extra }, error: null })

  if (!p || typeof p !== 'object') return deny('invalid_payload')
  if (Number(p.contract_version) !== 1) return deny('invalid_payload')
  if (!String(p.event_key || '').trim() || !String(p.channel || '').trim()) return deny('invalid_payload')
  if (!/^[0-9a-f]{64}$/.test(String(p.evidence_hash || ''))) return deny('invalid_payload')
  const items = Array.isArray(p.items) ? p.items : []
  if (!items.length || items.length > 80) return deny('invalid_payload')
  for (const it of items) {
    if (!String(it?.item_name || '').trim()) return deny('invalid_payload')
    if (!(Number(it?.quantity_received) > 0)) return deny('invalid_payload')
    if (!/\[Harga:\s*[0-9]/.test(String(it?.note || ''))) return deny('invalid_payload')
  }
  const h = p.header || {}
  if (!String(h.vendor_id || '').trim()) return deny('invalid_payload')

  // Kunci event (dedup) — atomik lewat "unique".
  const evtKey = `evt:${p.event_key}`
  if (__rows('bakpau_events').some(r => r.dedup_key === evtKey)) {
    const prev = __rows('bakpau_events').find(r => r.dedup_key === evtKey)
    return deny('duplicate_event', { receiving_id: prev?.receiving_id || null, event_key: p.event_key })
  }
  // Bukti lintas kanal -> ditolak (dipulihkan oleh rollback di pemanggil).
  const evdKey = `evd:${p.evidence_hash}`
  if (__rows('bakpau_events').some(r => r.dedup_key === evdKey)) {
    return { data: null, error: { code: 'BK002', message: 'duplicate_evidence' } }
  }
  // Nota ganda vendor+nomor.
  const invoiceNo = String(h.invoice_no || '').trim() || `BK-${nextId('inv').toUpperCase()}`
  const conflict = __rows('receivings').find(r =>
    String(r.vendor_id) === String(h.vendor_id)
    && String(r.invoice_no) === invoiceNo
    && (/\[Tahap:\s*DIBELI\]/.test(String(r.note || '')) || String(r.status || '').toUpperCase() === 'DIBELI'))
  if (conflict) return { data: null, error: { code: 'BK001', message: 'conflict_invoice' } }

  const rid = `00000000-0000-4000-8000-${String(__state.seq).padStart(12, '0')}`
  __state.seq += 1
  const headerRow = {
    id: rid,
    vendor_id: h.vendor_id,
    invoice_no: invoiceNo,
    delivery_note: String(h.delivery_note_label || `Nota ${invoiceNo}`),
    received_date: h.received_date,
    note: h.note || '',
    kendala: null,
    purchase_request_id: h.purchase_request_id || null,
    project_id: h.project_id || null,
    status: h.status || 'DIBELI',
    alokasi: null,
    masuk_gudang: false,
    created_at: new Date().toISOString()
  }
  tableOf('receivings').set(rid, headerRow)
  for (const it of items) {
    const iid = nextId('ritem')
    tableOf('receiving_items').set(iid, {
      id: iid,
      receiving_id: rid,
      pr_item_id: it.pr_item_id || null,
      item_name: it.item_name,
      unit: it.unit || null,
      quantity_received: Number(it.quantity_received),
      note: it.note || null,
      created_at: new Date().toISOString()
    })
  }
  const nowIso = new Date().toISOString()
  for (const key of [evtKey, evdKey]) {
    tableOf('bakpau_events').set(key, {
      id: key,
      dedup_key: key,
      kind: key.startsWith('evt:') ? 'event' : 'evidence',
      status: 'recorded',
      payload: { channel: p.channel },
      receiving_id: rid,
      created_at: nowIso,
      updated_at: nowIso
    })
  }
  return {
    data: {
      ok: true,
      code: 'recorded',
      receiving_id: rid,
      invoice_no: invoiceNo,
      is_internal_ref: !String(h.invoice_no || '').trim(),
      item_count: items.length,
      total: Number(h.total),
      material: Number(h.material),
      biaya_lain: Number(h.biaya_lain),
      diskon: Number(h.diskon),
      event_key: p.event_key,
      evidence_hash: p.evidence_hash,
      channel: p.channel,
      items: items.map((it, i) => ({
        line_no: i + 1,
        item_name: it.item_name,
        unit: it.unit || null,
        quantity_received: Number(it.quantity_received),
        project_id: it.project_id || null,
        pr_item_id: it.pr_item_id || null
      }))
    },
    error: null
  }
}

export const supabase = {
  from: table => makeBuilder(table),
  rpc: async (fn, args) => {
    __state.calls.push({ op: 'rpc', fn, args })
    if (fn === ATOMIC_FN) {
      // "Fungsi belum di-apply" -> PostgREST menjawab PGRST202.
      if (__state.missingRpc.has(fn)) {
        return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}(p_payload)` } }
      }
      const snap = snapshotTables()
      const out = atomicTx(args)
      // Gagal di tengah transaksi (simulasi): header sempat ditulis lalu
      // baris gagal -> RAISE -> rollback total.
      if (out.data?.ok === true && __state.failAtomic === 'after_header') {
        restoreTables(snap)
        return { data: null, error: { code: '23503', message: 'insert baris ditolak (simulasi di tengah transaksi)' } }
      }
      if (out.data?.ok === true && __state.atomicResultPatch) {
        Object.assign(out.data, __state.atomicResultPatch)
      }
      // RAISE EXCEPTION (error) ATAU penolakan sah -> rollback total.
      if (out.error || out.data?.ok !== true) restoreTables(snap)
      return out
    }
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
