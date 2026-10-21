// MOCK supabaseClient untuk test Fase 2 (bukan file produksi).
// REVISI run 239: rantai `select().eq(...).is(...)` WAJIB bisa dipakai —
// `modules/handovers/save.js` memeriksa dokumen Serah Terima yang masih aktif
// (`.is('diserahkan_at', null)`) SEBELUM insert. Mock lama mengembalikan objek
// hasil langsung dari `.eq()`, sehingga rantai itu melempar TypeError dan
// menyamarkan perilaku produksi (gagal di tipe, bukan di logika).
// Sekarang builder-nya chainable seperti @supabase/supabase-js asli.
export const __calls = []
export const __state = { nextResult: null, failFirstInsert: false, insertCount: 0 }

function makeChain(table) {
  // Hasil default untuk rantai select: array kosong (tidak ada dokumen aktif).
  function makeSelect() {
    const filters = []
    const api = {
      eq(col, val) { filters.push({ op: 'eq', col, val }); __calls.push({ op: 'eq', table, col, val }); return api },
      is(col, val) { filters.push({ op: 'is', col, val }); __calls.push({ op: 'is', table, col, val }); return api },
      in(col, vals) { filters.push({ op: 'in', col, vals }); return api },
      order() { return api },
      limit() { return api },
      maybeSingle: async () => __state.nextResult || { data: null, error: null },
      single: async () => __state.nextResult || { data: null, error: null },
      then: (r) => Promise.resolve(__state.nextResult || { data: [], error: null }).then(r),
      catch: (r) => Promise.resolve(__state.nextResult || { data: [], error: null }).catch(r)
    }
    return api
  }

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
      const api2 = {
        eq: (col, val) => { __calls.push({ op: 'eq', table, col, val }); return api2 },
        is: (col, val) => { __calls.push({ op: 'is', table, col, val }); return api2 },
        select: () => api2,
        then: (r) => Promise.resolve(__state.nextResult || { data: null, error: null }).then(r),
        catch: (r) => Promise.resolve(__state.nextResult || { data: null, error: null }).catch(r)
      }
      return api2
    },
    delete() {
      __calls.push({ op: 'delete', table })
      const api3 = {
        eq: (col, val) => { __calls.push({ op: 'eq', table, col, val }); return api3 },
        then: (r) => Promise.resolve(__state.nextResult || { data: null, error: null }).then(r),
        catch: (r) => Promise.resolve(__state.nextResult || { data: null, error: null }).catch(r)
      }
      return api3
    },
    select() {
      __calls.push({ op: 'select', table })
      return makeSelect()
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
