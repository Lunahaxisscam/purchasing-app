// ============================================================
// mock client untuk harness lean-admin-test
// ============================================================
// In-memory DB + pencatat operasi. Dipakai untuk MEMBUKTIKAN service
// boundary: tidak ada insert/update ke approval_steps & receivings, tidak ada
// perubahan qty pr_items, idempotensi submit, dan preservasi catatan.
// Ini BUKTI UNIT (bukan bukti live/DB E2E) — lihat catatan di laporan.

export let db = {
  purchase_requests: [],
  pr_items: [],
  approval_steps: [],
  receivings: [],
  receiving_items: [],
  profiles: []
}

export const __ops = []
export let __injectedErrors = {}

export function __setInjectedError(key, msg) {
  __injectedErrors[key] = msg
}

export function __reset(seed = {}) {
  __ops.length = 0
  __injectedErrors = {}
  db = {
    purchase_requests: JSON.parse(JSON.stringify(seed.purchase_requests || [])),
    pr_items: JSON.parse(JSON.stringify(seed.pr_items || [])),
    approval_steps: JSON.parse(JSON.stringify(seed.approval_steps || [])),
    receivings: JSON.parse(JSON.stringify(seed.receivings || [])),
    receiving_items: JSON.parse(JSON.stringify(seed.receiving_items || [])),
    profiles: JSON.parse(JSON.stringify(seed.profiles || []))
  }
}

function clone(o) { return o ? JSON.parse(JSON.stringify(o)) : o }

export function createMockSupabase() {
  return {
    from(table) {
      let fCol = null, fVal = null, neqCol = null, neqVal = null, orderCol = null, orderAsc = true, limitVal = null

      const match = (row) => {
        if (fCol !== null && String(row[fCol]) !== String(fVal)) return false
        if (neqCol !== null && String(row[neqCol]) === String(neqVal)) return false
        return true
      }
      const read = () => {
        let rows = (db[table] || []).filter(match)
        if (orderCol) {
          rows = [...rows].sort((a, b) => {
            if (a[orderCol] < b[orderCol]) return orderAsc ? -1 : 1
            if (a[orderCol] > b[orderCol]) return orderAsc ? 1 : -1
            return 0
          })
        }
        if (limitVal !== null) rows = rows.slice(0, limitVal)
        return clone(rows)
      }

      const chain = {
        select(cols = '*') { __ops.push({ op: 'select', table, cols }); return chain },
        eq(col, val) { fCol = col; fVal = val; __ops.push({ op: 'eq', table, col, val }); return chain },
        neq(col, val) { neqCol = col; neqVal = val; __ops.push({ op: 'neq', table, col, val }); return chain },
        in(col, vals) { __ops.push({ op: 'in', table, col, vals }); fCol = col; fVal = (vals || [])[0]; return chain },
        order(col, opts = {}) { orderCol = col; orderAsc = opts.ascending !== false; __ops.push({ op: 'order', table, col }); return chain },
        limit(n) { limitVal = n; __ops.push({ op: 'limit', table, n }); return chain },
        async single() {
          __ops.push({ op: 'single', table })
          if (__injectedErrors[`${table}.select`]) return { data: null, error: { message: __injectedErrors[`${table}.select`] } }
          const rows = read()
          if (!rows.length) return { data: null, error: { message: 'Row not found' } }
          return { data: rows[0], error: null }
        },
        then(resolve, reject) {
          const p = (async () => {
            if (__injectedErrors[`${table}.select`]) return { data: null, error: { message: __injectedErrors[`${table}.select`] } }
            return { data: read(), error: null }
          })()
          return p.then(resolve, reject)
        },
        update(payload) {
          __ops.push({ op: 'update', table, payload: clone(payload) })
          const u = {
            eq(col, val) { fCol = col; fVal = val; __ops.push({ op: 'eq', table, col, val }); return u },
            neq(col, val) { neqCol = col; neqVal = val; return u },
            then(resolve, reject) {
              const p = (async () => {
                if (__injectedErrors[`${table}.update`]) return { data: null, error: { message: __injectedErrors[`${table}.update`] } }
                let n = 0
                for (const row of (db[table] || [])) if (match(row)) { Object.assign(row, clone(payload)); n++ }
                return { data: null, error: null, count: n }
              })()
              return p.then(resolve, reject)
            }
          }
          return u
        },
        insert(payload) {
          __ops.push({ op: 'insert', table, payload: clone(payload) })
          const items = Array.isArray(payload) ? payload : [payload]
          const ins = {
            select() { return ins },
            async single() {
              if (__injectedErrors[`${table}.insert`]) return { data: null, error: { message: __injectedErrors[`${table}.insert`] } }
              const created = items.map((it, i) => ({ id: it.id || `gen-${table}-${Date.now()}-${i}`, ...clone(it) }))
              if (!db[table]) db[table] = []
              db[table].push(...created)
              return { data: clone(created[0]), error: null }
            },
            then(resolve, reject) {
              const p = (async () => {
                if (__injectedErrors[`${table}.insert`]) return { data: null, error: { message: __injectedErrors[`${table}.insert`] } }
                const created = items.map((it, i) => ({ id: it.id || `gen-${table}-${Date.now()}-${i}`, ...clone(it) }))
                if (!db[table]) db[table] = []
                db[table].push(...created)
                return { data: clone(created), error: null }
              })()
              return p.then(resolve, reject)
            }
          }
          return ins
        },
        delete() {
          __ops.push({ op: 'delete', table })
          const d = {
            eq(col, val) { fCol = col; fVal = val; __ops.push({ op: 'eq', table, col, val }); return d },
            then(resolve, reject) {
              const p = (async () => {
                const before = (db[table] || []).length
                db[table] = (db[table] || []).filter(r => !match(r))
                return { data: null, error: null, count: before - db[table].length }
              })()
              return p.then(resolve, reject)
            }
          }
          return d
        }
      }
      return chain
    },
    async rpc(fn, args) {
      __ops.push({ op: 'rpc', fn, args })
      if (__injectedErrors[`rpc.${fn}`]) return { data: null, error: { message: __injectedErrors[`rpc.${fn}`] } }
      if (fn === 'next_pr_number') return { data: 'PR-900', error: null }
      return { data: { ok: true }, error: null }
    }
  }
}

/** Operasi tulis apa pun (insert/update/delete) pada tabel tertentu. */
export function writesTo(table) {
  return __ops.filter(o => ['insert', 'update', 'delete'].includes(o.op) && o.table === table)
}
