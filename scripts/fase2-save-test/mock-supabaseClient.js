// MOCK supabaseClient untuk test Fase 2 (bukan file produksi).
export const __calls = []
export const __state = { nextResult: null, failFirstInsert: false, insertCount: 0 }

function makeChain(table) {
  const api = {
    insert(d) {
      __state.insertCount++
      __calls.push({ op: 'insert', table, data: d })
      const failFirst = __state.failFirstInsert && __state.insertCount === 1
      const res = failFirst
        ? { data: null, error: { code: '23505', message: 'duplicate key' } }
        : (__state.nextResult || { data: null, error: null })
      const insertApi = {
        select: () => insertApi,
        single: async () => res,
        then: (r) => Promise.resolve(res).then(r),
        catch: (r) => Promise.resolve(res).catch(r)
      }
      return insertApi
    },
    update(d) {
      __calls.push({ op: 'update', table, data: d })
      return {
        eq: async (col, val) => { __calls.push({ op: 'eq', table, col, val }); return __state.nextResult || { data: null, error: null } }
      }
    },
    delete() {
      __calls.push({ op: 'delete', table })
      return {
        eq: async (col, val) => { __calls.push({ op: 'eq', table, col, val }); return __state.nextResult || { data: null, error: null } }
      }
    },
    single: async () => ({ data: { id: 'pr-1', status: 'DRAFT', notes: '' }, error: null }),
    select() {
      __calls.push({ op: 'select', table })
      return { eq: () => api, order: async () => __state.nextResult || { data: [], error: null } }
    }
  }
  return api
}

export const supabase = {
  from: (table) => makeChain(table),
  rpc: async (fn, args) => {
    __calls.push({ op: 'rpc', fn, args })
    return __state.nextResult || { data: null, error: null }
  }
}
