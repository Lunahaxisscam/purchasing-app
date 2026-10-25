// Mock Supabase Client untuk scripts/pr-resubmit-test
// Mensimulasikan in-memory DB & perekam operasi untuk verifikasi submit/resubmit PR.

export let db = {
  purchase_requests: [],
  pr_items: [],
  approval_steps: [],
  profiles: []
}

export const __ops = []
export let __injectedErrors = {}

export function __setInjectedError(key, errMsg) {
  __injectedErrors[key] = errMsg
}

export function __reset(seed = {}) {
  __ops.length = 0
  __injectedErrors = {}
  db = {
    purchase_requests: JSON.parse(JSON.stringify(seed.purchase_requests || [])),
    pr_items: JSON.parse(JSON.stringify(seed.pr_items || [])),
    approval_steps: JSON.parse(JSON.stringify(seed.approval_steps || [])),
    profiles: JSON.parse(JSON.stringify(seed.profiles || []))
  }
}

function clone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj
}

export function createMockSupabase() {
  return {
    from(table) {
      let filterCol = null
      let filterVal = null
      let neqCol = null
      let neqVal = null
      let limitVal = null
      let orderCol = null
      let orderAsc = true

      const chain = {
        select(cols = '*') {
          __ops.push({ op: 'select', table, cols })
          return chain
        },
        eq(col, val) {
          filterCol = col
          filterVal = val
          __ops.push({ op: 'eq', table, col, val })
          return chain
        },
        neq(col, val) {
          neqCol = col
          neqVal = val
          __ops.push({ op: 'neq', table, col, val })
          return chain
        },
        or(condition) {
          __ops.push({ op: 'or', table, condition })
          return chain
        },
        order(col, opts = {}) {
          orderCol = col
          orderAsc = opts.ascending !== false
          __ops.push({ op: 'order', table, col, opts })
          return chain
        },
        limit(num) {
          limitVal = num
          __ops.push({ op: 'limit', table, num })
          return chain
        },
        async single() {
          __ops.push({ op: 'single', table })
          if (__injectedErrors[`${table}.select`]) {
            return { data: null, error: { message: __injectedErrors[`${table}.select`] } }
          }
          let rows = db[table] || []
          if (filterCol) {
            rows = rows.filter(r => String(r[filterCol]) === String(filterVal))
          }
          if (neqCol) {
            rows = rows.filter(r => String(r[neqCol]) !== String(neqVal))
          }
          if (rows.length === 0) {
            return { data: null, error: { message: 'Row not found' } }
          }
          return { data: clone(rows[0]), error: null }
        },
        then(resolve, reject) {
          const promise = (async () => {
            if (__injectedErrors[`${table}.select`]) {
              return { data: null, error: { message: __injectedErrors[`${table}.select`] } }
            }
            let rows = db[table] || []
            if (filterCol) {
              rows = rows.filter(r => String(r[filterCol]) === String(filterVal))
            }
            if (neqCol) {
              rows = rows.filter(r => String(r[neqCol]) !== String(neqVal))
            }
            if (orderCol) {
              rows = [...rows].sort((a, b) => {
                if (a[orderCol] < b[orderCol]) return orderAsc ? -1 : 1
                if (a[orderCol] > b[orderCol]) return orderAsc ? 1 : -1
                return 0
              })
            }
            if (limitVal !== null) {
              rows = rows.slice(0, limitVal)
            }
            return { data: clone(rows), error: null }
          })()
          return promise.then(resolve, reject)
        },
        update(payload) {
          __ops.push({ op: 'update', table, payload })
          let uFilterCol = filterCol
          let uFilterVal = filterVal
          let uNeqCol = neqCol
          let uNeqVal = neqVal
          const updateChain = {
            eq(col, val) {
              uFilterCol = col
              uFilterVal = val
              __ops.push({ op: 'eq', table, col, val })
              return updateChain
            },
            neq(col, val) {
              uNeqCol = col
              uNeqVal = val
              __ops.push({ op: 'neq', table, col, val })
              return updateChain
            },
            or(condition) {
              __ops.push({ op: 'or', table, condition })
              return updateChain
            },
            then(resolve, reject) {
              const promise = (async () => {
                if (__injectedErrors[`${table}.update`]) {
                  return { data: null, error: { message: __injectedErrors[`${table}.update`] } }
                }
                const rows = db[table] || []
                let updated = 0
                for (const row of rows) {
                  let match = true
                  if (uFilterCol && String(row[uFilterCol]) !== String(uFilterVal)) match = false
                  if (uNeqCol && String(row[uNeqCol]) === String(uNeqVal)) match = false
                  if (match) {
                    Object.assign(row, clone(payload))
                    updated++
                  }
                }
                return { data: null, error: null, count: updated }
              })()
              return promise.then(resolve, reject)
            }
          }
          return updateChain
        },
        insert(payload) {
          __ops.push({ op: 'insert', table, payload })
          const items = Array.isArray(payload) ? payload : [payload]
          const insChain = {
            select(cols = '*') {
              return insChain
            },
            async single() {
              if (__injectedErrors[`${table}.insert`]) {
                return { data: null, error: { message: __injectedErrors[`table}.insert`] } }
              }
              const created = items.map((it, i) => ({ id: it.id || `gen-id-${Date.now()}-${i}`, ...clone(it) }))
              if (!db[table]) db[table] = []
              db[table].push(...created)
              return { data: clone(created[0]), error: null }
            },
            then(resolve, reject) {
              const promise = (async () => {
                if (__injectedErrors[`${table}.insert`]) {
                  return { data: null, error: { message: __injectedErrors[`${table}.insert`] } }
                }
                const created = items.map((it, i) => ({ id: it.id || `gen-id-${Date.now()}-${i}`, ...clone(it) }))
                if (!db[table]) db[table] = []
                db[table].push(...created)
                return { data: clone(created), error: null }
              })()
              return promise.then(resolve, reject)
            }
          }
          return insChain
        },
        delete() {
          __ops.push({ op: 'delete', table })
          let dFilterCol = filterCol
          let dFilterVal = filterVal
          const delChain = {
            eq(col, val) {
              dFilterCol = col
              dFilterVal = val
              __ops.push({ op: 'eq', table, col, val })
              return delChain
            },
            then(resolve, reject) {
              const promise = (async () => {
                if (__injectedErrors[`${table}.delete`]) {
                  return { data: null, error: { message: __injectedErrors[`${table}.delete`] } }
                }
                let before = (db[table] || []).length
                db[table] = (db[table] || []).filter(r => String(r[dFilterCol]) !== String(dFilterVal))
                return { data: null, error: null, count: before - db[table].length }
              })()
              return promise.then(resolve, reject)
            }
          }
          return delChain
        }
      }
      return chain
    },
    async rpc(fn, args) {
      __ops.push({ op: 'rpc', fn, args })
      if (__injectedErrors[`rpc.${fn}`]) {
        return { data: null, error: { message: __injectedErrors[`rpc.${fn}`] } }
      }
      if (fn === 'next_pr_number') return { data: 'PR-999', error: null }
      return { data: { ok: true }, error: null }
    }
  }
}
