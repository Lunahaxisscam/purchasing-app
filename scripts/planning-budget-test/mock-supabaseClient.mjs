// Mock lib/supabaseClient untuk verifikasi RENDER panel (tanpa jaringan / tanpa DB).
// Data uji disuntik lewat __mockState sebelum render.
// Dipakai oleh verify_panel_render.py (di-copy ke sandbox sebagai lib/supabaseClient.js).

export const __mockState = {
  plans: [],
  costs: [],
  failPlans: false,
  failCosts: false
}

function resultFor(table) {
  if (table === 'project_plans') {
    return __mockState.failPlans
      ? { data: null, error: { message: 'mock: gagal memuat project_plans' } }
      : { data: __mockState.plans, error: null }
  }
  if (table === 'project_cost_summary') {
    return __mockState.failCosts
      ? { data: null, error: { message: 'mock: gagal memuat project_cost_summary' } }
      : { data: __mockState.costs, error: null }
  }
  return { data: [], error: null }
}

// Query builder thenable: mendukung .select().order()/.eq()/.not()/.limit()
// dan langsung bisa di-await (meniru PostgREST builder Supabase).
function builder(table) {
  const q = {
    select: () => q,
    order: () => q,
    eq: () => q,
    not: () => q,
    limit: () => q,
    insert: () => q,
    update: () => q,
    delete: () => q,
    single: () => Promise.resolve(resultFor(table)),
    then: (resolve, reject) => Promise.resolve(resultFor(table)).then(resolve, reject)
  }
  return q
}

export const supabase = {
  from: (table) => builder(table),
  rpc: () => Promise.resolve({ data: null, error: null })
}
