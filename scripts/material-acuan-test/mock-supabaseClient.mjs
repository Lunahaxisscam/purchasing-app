// Mock lib/supabaseClient untuk verifikasi RENDER acuan harga (tanpa jaringan / tanpa DB).
// Dipakai oleh run.py (di-copy ke sandbox sebagai lib/supabaseClient.mjs).
// ModuleView/CreateModal tidak memuat data dari sini (data masuk via props);
// mock hanya untuk memenuhi closure import saveHelpers/materials save.js.

function builder() {
  const q = {
    select: () => q,
    order: () => q,
    eq: () => q,
    not: () => q,
    limit: () => q,
    insert: () => q,
    update: () => q,
    delete: () => q,
    single: () => Promise.resolve({ data: null, error: null }),
    then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject)
  }
  return q
}

export const supabase = {
  from: () => builder(),
  rpc: () => Promise.resolve({ data: null, error: null })
}
