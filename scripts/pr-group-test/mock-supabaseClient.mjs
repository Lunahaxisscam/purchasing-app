// Mock lib/supabaseClient untuk HARNESS pr-group-test (t_48f6b336).
// Perekam operasi (insert/update/delete/rpc) — TIDAK menyentuh DB/jaringan.
// Pola sama dgn pr-estimator-test/mock-supabaseClient.mjs.
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
  from: (table) => makeChain(table),
  rpc: async (fn) => {
    if (__OPS_V1_FNS.has(fn)) return __opsV1Missing(fn) __ops.push({ op: 'rpc', fn }); return { data: 'PR-777', error: null } }
}
