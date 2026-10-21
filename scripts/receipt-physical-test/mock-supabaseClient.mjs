// ============================================================
// MOCK supabaseClient untuk harness handover-flow-test (bukan file produksi).
// - Merekam SEMUA operasi (insert/update/select/rpc) ke __state.calls
// - Mengemulasi compare-and-swap pada handovers seperti server:
//     update(...).eq('id',x).is('diserahkan_at', null).select()
//   -> 1 baris dikembalikan bila diserahkan_at masih NULL, 0 baris bila tidak.
// - MENGEMULASI PRIMARY KEY `handovers.id`: INSERT dengan id yang SUDAH ADA
//   ditolak 23505. Ini bukan bantuan untuk lulus: sejak run 245 penjaga
//   dokumen ganda BERGANTUNG pada constraint itu (id slot deterministik), jadi
//   mock yang selalu menerima INSERT akan membuat uji "dua penulis bersamaan"
//   lolos secara palsu. Tanpa emulasi ini, harness berbohong.
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
  replayReceipt: false,    // RPC receipt_apply_events menjawab already_applied (submit ulang)
  replayHandover: false,   // RPC handover_confirm menjawab already=true
  rpcError: null,          // error RPC sekali pakai (mis. over_receipt)
  calls: [],              // {op, table, ...}
  nextError: null,
  // Waktu INSERT yang dipakai mock untuk `created_at` (default: sekarang).
  // Dipakai probe balapan untuk memaksa urutan kanonik yang deterministik.
  insertStamp: null,
  // Hook sekali pakai yang dijalankan TEPAT sebelum INSERT (meniru sesi lain
  // yang commit di antara SELECT penjaga dan INSERT kita).
  beforeInsert: null,
  // Sesi LAIN yang INSERT-nya BELUM COMMIT (meniru kunci index PostgreSQL).
  // Baris di sini TIDAK terlihat oleh SELECT (belum commit), tetapi id-nya
  // SUDAH memegang PRIMARY KEY — jadi INSERT kita dengan id yang sama harus
  // DITOLAK 23505, persis seperti PostgreSQL sesudah sesi itu commit.
  // `pendingRows[id]` = baris yang akan terlihat begitu sesi itu "commit".
  pendingIds: [],
  pendingRows: {},
  // Bila diisi, `nextError` hanya berlaku untuk tabel ini.
  nextErrorTable: null
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
  __state.replayReceipt = false
  __state.replayHandover = false
  __state.rpcError = null
  __state.calls = []
  __state.nextError = null
  __state.insertStamp = null
  __state.beforeInsert = null
  __state.pendingIds = []
  __state.pendingRows = {}
  __state.nextErrorTable = null
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
  // `nextErrorTable` (opsional): error HANYA untuk tabel itu. Tanpa ini, probe
  // yang memaksa "baca DB gagal" tidak bisa menargetkan query tertentu —
  // capability probe (tabel ledger) akan memakan error-nya lebih dulu dan
  // pemeriksaan yang ingin diuji justru berjalan sukses (uji palsu).
  if (__state.nextError && (!__state.nextErrorTable || __state.nextErrorTable === st.table)) {
    const err = __state.nextError
    __state.nextError = null
    __state.nextErrorTable = null
    return { data: null, error: err }
  }
  if (st.op === 'insert') {
    const size = __state.handovers.size + __state.receivings.size + __state.prItems.size + __state.receivingItems.size
    // Hook balapan: meniru sesi LAIN yang commit TEPAT sebelum INSERT ini.
    // Dipakai probe run 242/243 untuk membuktikan penarikan diri (withdraw)
    // bekerja — bukan untuk membuat uji "lulus" secara palsu.
    if (typeof __state.beforeInsert === 'function') {
      const hook = __state.beforeInsert
      __state.beforeInsert = null
      hook(st)
    }
    // `created_at` di database default now() — tanpa ini urutan kanonik
    // dokumen (created_at → handover_date → id) tidak bisa diemulasi dan
    // "dokumen yang lebih awal" menjadi tidak deterministik.
    const stamp = { created_at: __state.insertStamp || new Date().toISOString() }
    const row = { id: `gen-${size}-${Math.random().toString(36).slice(2, 7)}`, ...stamp, ...st.data }
    const store = storeOf(st.table)
    // PRIMARY KEY emulation (handovers.id): INSERT dengan id yang sudah ada
    // ditolak 23505 — sama seperti PostgreSQL. Penjaga slot run 245 bergantung
    // pada perilaku ini.
    if (st.table === 'handovers' && store && store.has(row.id)) {
      return {
        data: null,
        error: {
          code: '23505',
          message: `duplicate key value violates unique constraint "handovers_pkey"`,
          details: `Key (id)=(${row.id}) already exists.`,
          hint: null
        }
      }
    }
    // Sesi lain yang belum commit: id-nya sudah memegang PRIMARY KEY walau
    // barisnya belum terlihat oleh SELECT. Di PostgreSQL INSERT kita akan
    // MENUNGGU sampai sesi itu commit, lalu ditolak 23505 — dan pada saat itu
    // barisnya SUDAH terlihat. Itu persis yang dimodelkan di sini: id keluar
    // dari `pendingIds`, barisnya masuk store, lalu INSERT kita ditolak.
    // (Tanpa ini, uji "dua penulis bersamaan" hanya membuktikan id-nya sama,
    // bukan bahwa database menolak yang kedua — atau malah menggantung.)
    if (st.table === 'handovers' && (__state.pendingIds || []).includes(row.id)) {
      const pend = __state.pendingRows && __state.pendingRows[row.id]
      __state.pendingIds = __state.pendingIds.filter(x => x !== row.id)
      if (pend && store) store.set(pend.id, { ...pend })
      return {
        data: null,
        error: {
          code: '23505',
          message: `duplicate key value violates unique constraint "handovers_pkey"`,
          details: `Key (id)=(${row.id}) already exists.`,
          hint: null
        }
      }
    }
    if (store) store.set(row.id, { ...row })
    return { data: [row], error: null }
  }
  if (st.op === 'delete') {
    const store = storeOf(st.table)
    if (!store) return { data: [], error: null }
    const idF = st.filters.find(f => f.col === 'id')
    const isF = st.filters.find(f => f.col === 'diserahkan_at' && f.isNull)
    const row = idF ? store.get(idF.val) : null
    if (!row) return { data: [], error: null }
    // CAS: `.delete().eq('id',x).is('diserahkan_at', null)` hanya menghapus
    // baris yang BELUM diserahkan — sama seperti perilaku yang dituntut
    // `duplicateGuardDb.insertUniqueActiveHandover` saat menarik diri.
    if (isF && row.diserahkan_at !== null && row.diserahkan_at !== undefined) return { data: [], error: null }
    store.delete(row.id)
    return { data: [{ ...row }], error: null }
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
      // t_7bc6246b run 199: pembeda REPLAY vs KOREKSI mencari event tersimpan
      // lewat client_event_id. Tanpa filter ini mock mengembalikan SEMUA baris
      // dan setiap submit dianggap "sudah ada" → hasil uji menyesatkan.
      else if (f.col === 'client_event_id' && f.vals) rows = rows.filter(r => f.vals.includes(r.client_event_id))
      else if (f.col === 'client_event_id' && f.val !== undefined) rows = rows.filter(r => r.client_event_id === f.val)
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
    if (__state.rpcError) {
      const e = __state.rpcError
      __state.rpcError = null
      return { data: null, error: e }
    }
    // Emulasi respons RPC schema owner (t_03b41644) — bentuk & nama field
    // SAMA dengan yang dikembalikan fungsi PostgreSQL, supaya modul yang
    // membaca `data.applied` / `data.already` / `data.inserted` diuji nyata.
    if (fn === 'receipt_apply_events') {
      const evs = args?.p_events || []
      // Emulasi penolakan server yang NYATA (migrasi 02 milik t_03b41644):
      // `retur_status PENDING/DISCARDED` wajib `retur_qty > 0`, kalau tidak
      // RPC menjawab ok:false reason retur_without_qty. Mock yang selalu
      // menjawab ok:true membuat harness hijau untuk alur yang di produksi
      // berakhir dengan penolakan (defect run 199).
      const badRetur = evs.find(e => {
        const st = String(e?.retur_status || 'NONE').toUpperCase()
        return st !== 'NONE' && !(Number(e?.retur_qty) > 0)
      })
      if (badRetur) {
        return {
          data: {
            ok: false,
            reason: 'retur_without_qty',
            error: `retur_status ${String(badRetur.retur_status).toUpperCase()} wajib retur_qty > 0.`,
            client_event_id: badRetur.client_event_id
          },
          error: null
        }
      }
      const applied = evs.length
      return {
        data: {
          ok: true,
          applied,
          already_applied: __state.replayReceipt ? evs.length : 0,
          event_ids: evs.map((e, i) => `ev-${i + 1}`),
          item_totals: {},
          qty_semantics: { qty_datang: 'ARRIVED', quantity_received: 'BOUGHT' }
        },
        error: null
      }
    }
    if (fn === 'handover_confirm') {
      const lines = args?.p_lines || []
      return { data: { ok: true, already: !!__state.replayHandover, inserted: __state.replayHandover ? 0 : lines.length, diserahkan_at: '2026-10-21T00:00:00Z' }, error: null }
    }
    if (fn === 'return_create') {
      return { data: { ok: true, return_case_id: 'rc-1', resolution: args?.p_resolution || 'RETURN' }, error: null }
    }
    return { data: null, error: null }
  }
}
