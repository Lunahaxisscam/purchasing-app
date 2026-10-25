// ============================================================
// Mock lib/supabaseClient untuk HARNESS rap-test (t_71d95cfe).
// Perekam operasi: setiap insert/update/delete/rpc dicatat di __ops supaya
// harness bisa MEMBUKTIKAN modul RAP tidak menulis apa pun.
// `project_plans` mengembalikan baris WBS fixture (read-only select).
// ============================================================
export const __ops = []
export let __plans = []
export let __plansError = null
export let __materials = []
export let __materialsError = null

export function __reset(opts = {}) {
  __ops.length = 0
  __plans = opts.plans || []
  __plansError = opts.plansError || null
  __materials = opts.materials || []
  __materialsError = opts.materialsError || null
}

export const supabase = {
  from(table) {
    const api = {
      select(cols) {
        __ops.push({ op: 'select', table, cols })
        const rowsFor = () => {
          if (table === 'project_plans') return __plans
          if (table === 'materials') return __materials
          return []
        }
        const errFor = () => {
          if (table === 'project_plans') return __plansError
          if (table === 'materials') return __materialsError
          return null
        }
        const chain = {
          eq(col, val) {
            __ops.push({ op: 'eq', table, col, val })
            const err = errFor()
            if (err) return Promise.resolve({ data: null, error: { message: err } })
            const rows = table === 'project_plans'
              ? __plans.filter(p => String(p.project_id) === String(val))
              : rowsFor()
            return Promise.resolve({ data: rows, error: null })
          },
          order() { return chain },
          then(res) {
            const err = errFor()
            if (err) return Promise.resolve({ data: null, error: { message: err } }).then(res)
            return Promise.resolve({ data: rowsFor(), error: null }).then(res)
          }
        }
        return chain
      },
      insert(rows) {
        __ops.push({ op: 'insert', table, rows })
        return { select: () => ({ single: async () => ({ data: null, error: { message: 'INSERT TIDAK DIIZINKAN DI HARNESS RAP' } }) }) }
      },
      update(row) {
        __ops.push({ op: 'update', table, row })
        return { eq: async () => ({ data: null, error: { message: 'UPDATE TIDAK DIIZINKAN DI HARNESS RAP' } }) }
      },
      delete() {
        __ops.push({ op: 'delete', table })
        return { eq: async () => ({ data: null, error: { message: 'DELETE TIDAK DIIZINKAN DI HARNESS RAP' } }) }
      }
    }
    return api
  },
  rpc(name, args) {
    __ops.push({ op: 'rpc', name, args })
    return Promise.resolve({ data: null, error: { message: 'RPC TIDAK DIIZINKAN DI HARNESS RAP' } })
  },
  auth: {
    getSession: async () => ({ data: { session: { user: { email: 'admin@noir.test' } } } })
  }
}

export const isSupabaseConfigured = true
