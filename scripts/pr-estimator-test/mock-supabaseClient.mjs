// Mock lib/supabaseClient untuk HARNESS pr-estimator-test (t_ac0b39c0).
// Perekam operasi (insert/update/delete/rpc) — TIDAK menyentuh DB/jaringan.
// Pola sama dgn fase2-save-test/mock-supabaseClient.js, dgn __ops rekaman.
export const __ops = []

function makeChain(table) {
  const api = {
    insert(rows) {
      __ops.push({ op: 'insert', table, rows })
      const singleRes = { data: Array.isArray(rows) ? rows[0] : { id: 'row-1', ...rows }, error: null }
      const ins = {
        select: () => ins,
        single: async () => singleRes,
        then: (r) => Promise.resolve(singleRes).then(r),
        catch: (r) => Promise.resolve(singleRes).catch(r)
      }
      return ins
    },
    update(row) {
      __ops.push({ op: 'update', table, row })
      return {
        eq: async (col, val) => { __ops.push({ op: 'eq', table, col, val }); return { data: null, error: null } }
      }
    },
    delete() {
      __ops.push({ op: 'delete', table })
      return {
        eq: async (col, val) => { __ops.push({ op: 'eq', table, col, val }); return { data: null, error: null } }
      }
    },
    select() {
      __ops.push({ op: 'select', table })
      const sel = {
        eq: () => sel,
        order: async () => ({ data: [], error: null }),
        single: async () => { __ops.push({ op: 'single', table }); return { data: { id: 'row-1' }, error: null } },
        then: (r) => Promise.resolve({ data: [], error: null }).then(r)
      }
      return sel
    },
    order: () => api,
    limit: () => api,
    not: () => api
  }
  return api
}

export function __reset() { __ops.length = 0 }
export const __opsView = () => __ops

export const supabase = {
  from: (table) => makeChain(table),
  rpc: async (fn) => { __ops.push({ op: 'rpc', fn }); return { data: 'PR-777', error: null } }
}
