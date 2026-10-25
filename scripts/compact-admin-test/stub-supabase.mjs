// ============================================================
// STUB Supabase — HANYA untuk harness compact-admin-test.
// ------------------------------------------------------------
// Modul Admin Suite memuat data lewat lib/supabaseClient. Di harness
// (tanpa .env, tanpa jaringan, tanpa DB) klien itu `null`, sehingga tabel
// tidak pernah ter-render. Stub ini mengembalikan FIXTURE dari mock.mjs
// supaya tabel nyata (header + baris + footer) ikut diuji.
//
// Tidak ada koneksi jaringan, tidak ada tulis DB, tidak ada kredensial.
// ============================================================
import MOCK from './mock.mjs'

const TABLE_DATA = {
  tukang_dashboards: [
    {
      tukang_key: 'asep',
      tukang_name: 'Asep Sunandar',
      synced_at: '2026-10-18T03:00:00Z',
      total_row: { total_upah: 4500000, total_kasbon: 500000, sisa_bersih: 4000000, pelunasan: 1000000, status: 'Berjalan' },
      batches: [
        { no: 1, periode: '01–15 Oktober 2026', proyek: '[83] Mabes Polri Renovasi Lantai 3 Sayap Barat', total_upah: 2500000, total_kasbon: 300000, sisa_bersih: 2200000, pelunasan: 500000, metode: 'Transfer Bank Mandiri', saldo_berjalan: 1700000, status: 'Berjalan' }
      ]
    }
  ],
  sync_status: [
    { id: 'tukang_upah', last_synced_at: '2026-10-18T03:00:00Z', last_status: 'OK', last_message: 'ok' },
    { id: 'rekap_cost', last_synced_at: '2026-10-18T03:00:00Z', last_status: 'OK', last_message: 'ok' }
  ],
  tukang_projects: MOCK.tukang_projects,
  tukang_kasbon: [
    { id: 'k1', tukang_key: 'asep', tanggal: '2026-10-05', jenis: 'Kasbon', deskripsi: 'Kasbon kebutuhan keluarga', metode: 'Tunai', nominal: 500000, bukti: '' }
  ],
  tukang_upah_items: [
    { id: 'ui1', tukang_key: 'asep', project_name: '[83] Mabes Polri Renovasi Lantai 3 Sayap Barat', pekerjaan: 'Pasang partisi gypsum', ukuran: 24, harga_satuan: 75000, upah_rincian: 1800000, total_proyek: 1800000, catatan: '' }
  ],
  project_cost_summary: MOCK.project_cost_summary,
  project_closings: [
    { id: 'cl1', project_id: 'p2', project_no: '99', project_name: 'Baroni Residence — Fit Out Ruang Tamu dan Dapur', revenue: 180000000, total_cost: 120000000, margin: 60000000, margin_pct: 33.3, labor_ratio: 18.5, closed_at: '2026-10-10T00:00:00Z', closed_by: 'admin@noirliving.test' }
  ],
  project_plans: MOCK.project_plans,
  activity_logs: [
    { id: 'al1', created_at: '2026-10-18T02:00:00Z', user_email: 'admin@noirliving.test', action: 'UPDATE', entity: 'purchase_requests', detail: 'Status PR-001 diubah dari DRAFT menjadi SUBMITTED oleh admin@noirliving.test pada 18 Oktober 2026 pukul 09.00 WIB.' }
  ],
  materials: MOCK.materials,
  customers: MOCK.customers,
  leads: MOCK.leads
}

const RPC_DATA = {
  admin_list_users: {
    ok: true,
    users: [
      { id: 'u1', email: 'admin@noirliving.test', full_name: 'Administrator Utama Noir Living', role: 'admin', created_at: '2026-01-01T00:00:00Z' },
      { id: 'u2', email: 'operator.gudang@noirliving.test', full_name: 'Operator Gudang', role: 'user', created_at: '2026-02-01T00:00:00Z' }
    ]
  }
}

function result(rows) {
  const q = {
    select: () => q,
    order: () => q,
    eq: () => q,
    neq: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: Array.isArray(rows) ? (rows[0] || null) : rows, error: null }),
    single: () => Promise.resolve({ data: Array.isArray(rows) ? (rows[0] || null) : rows, error: null }),
    insert: () => q,
    update: () => q,
    delete: () => q,
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject)
  }
  return q
}

export const supabase = {
  from(table) {
    return result(TABLE_DATA[table] || [])
  },
  rpc(name) {
    return Promise.resolve({ data: RPC_DATA[name] || { ok: true, users: [] }, error: null })
  },
  auth: {
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  }
}

export default supabase
