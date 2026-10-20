// ============================================================
// mock-supabase.mjs — MOCK BEREKAM (bukan DB) untuk uji kebijakan Approval OFF
// ============================================================
// Semua operasi dicatat ke `__ops` supaya test bisa membuktikan TIDAK ADA
// query/write ke `approval_steps` saat modul Approval dimatikan.
// Ini MOCK berlabel: tidak ada koneksi jaringan, tidak ada transaksi nyata.
// ============================================================

export let db = {}
export const __ops = []

export function __reset(seed = {}) {
  __ops.length = 0
  db = JSON.parse(JSON.stringify(seed || {}))
}

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v))
}

export function opsOn(table) {
  return __ops.filter(o => o.table === table)
}

export function writeOps() {
  return __ops.filter(o => ['insert', 'update', 'delete', 'upsert', 'rpc'].includes(o.op))
}

function table(name) {
  if (!db[name]) db[name] = []
  return db[name]
}

export function createMockSupabase() {
  return {
    from(name) {
      const state = { filters: [], order: null, limit: null }
      const match = (row) => state.filters.every(([col, val]) => String(row[col]) === String(val))

      const chain = {
        select(cols = '*') {
          __ops.push({ op: 'select', table: name, cols })
          return chain
        },
        eq(col, val) {
          state.filters.push([col, val])
          __ops.push({ op: 'eq', table: name, col, val })
          return chain
        },
        neq(col, val) {
          __ops.push({ op: 'neq', table: name, col, val })
          return chain
        },
        or(cond) {
          __ops.push({ op: 'or', table: name, cond })
          return chain
        },
        order(col, opts = {}) {
          state.order = { col, asc: opts.ascending !== false }
          __ops.push({ op: 'order', table: name, col })
          return chain
        },
        limit(n) {
          state.limit = n
          __ops.push({ op: 'limit', table: name, n })
          return chain
        },
        async single() {
          __ops.push({ op: 'single', table: name })
          const rows = table(name).filter(match)
          if (!rows.length) return { data: null, error: { message: 'Row not found' } }
          return { data: clone(rows[0]), error: null }
        },
        then(resolve, reject) {
          const p = (async () => {
            let rows = table(name).filter(match)
            if (state.order) {
              const { col, asc } = state.order
              rows = [...rows].sort((a, b) => (a[col] < b[col] ? (asc ? -1 : 1) : (a[col] > b[col] ? (asc ? 1 : -1) : 0)))
            }
            if (state.limit !== null) rows = rows.slice(0, state.limit)
            return { data: clone(rows), error: null }
          })()
          return p.then(resolve, reject)
        },
        update(payload) {
          __ops.push({ op: 'update', table: name, payload: clone(payload) })
          const up = {
            eq(col, val) {
              state.filters.push([col, val])
              __ops.push({ op: 'eq', table: name, col, val })
              return up
            },
            or(cond) {
              __ops.push({ op: 'or', table: name, cond })
              return up
            },
            then(resolve, reject) {
              const p = (async () => {
                let n = 0
                for (const row of table(name)) {
                  if (match(row)) { Object.assign(row, clone(payload)); n++ }
                }
                return { data: null, error: null, count: n }
              })()
              return p.then(resolve, reject)
            }
          }
          return up
        },
        insert(payload) {
          __ops.push({ op: 'insert', table: name, payload: clone(payload) })
          const ins = {
            select() { return ins },
            async single() {
              const created = { id: `gen-${table(name).length + 1}`, ...clone(payload) }
              table(name).push(created)
              return { data: clone(created), error: null }
            },
            then(resolve, reject) {
              const p = (async () => {
                const items = Array.isArray(payload) ? payload : [payload]
                const created = items.map((it, i) => ({ id: it.id || `gen-${table(name).length + i + 1}`, ...clone(it) }))
                table(name).push(...created)
                return { data: clone(created), error: null }
              })()
              return p.then(resolve, reject)
            }
          }
          return ins
        },
        delete() {
          __ops.push({ op: 'delete', table: name })
          const del = {
            eq(col, val) {
              state.filters.push([col, val])
              __ops.push({ op: 'eq', table: name, col, val })
              return del
            },
            then(resolve, reject) {
              const p = (async () => {
                const before = table(name).length
                db[name] = table(name).filter(r => !match(r))
                return { data: null, error: null, count: before - db[name].length }
              })()
              return p.then(resolve, reject)
            }
          }
          return del
        }
      }
      return chain
    },
    async rpc(fn, args) {
      __ops.push({ op: 'rpc', fn, args: clone(args) })
      if (fn === 'next_pr_number') return { data: 'PR-999', error: null }
      return { data: { ok: true }, error: null }
    }
  }
}
