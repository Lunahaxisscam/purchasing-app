// ============================================================
// FIXTURE / MOCK — HANYA untuk harness compact-admin-test.
// Bukan data live, tidak pernah di-commit ke rute produksi, tidak
// menyentuh DB. Bentuk kolom mengikuti kontrak modul di repo.
// Nilai sengaja dibuat panjang (nama proyek, email, catatan) supaya
// kasus "teks panjang" ikut ter-render.
// ============================================================

const MOCK = {
  projects: [
    { id: 'p1', kode: '83', code: '83', name: 'Mabes Polri Renovasi Lantai 3 Sayap Barat', status: 'ON_GOING', created_at: '2026-09-01T00:00:00Z' },
    { id: 'p2', kode: '99', code: '99', name: 'Baroni Residence — Fit Out Ruang Tamu dan Dapur', status: 'DONE', created_at: '2026-08-01T00:00:00Z' }
  ],
  vendors: [
    { id: 'v1', name: 'TB Sumber Jaya Makmur Abadi', phone: '081234567890', store_link: 'https://tokopedia.com/toko/sumber-jaya', supplier_category: 'Plywood & Board', contact: 'budi@sumberjaya.example' }
  ],
  materials: [
    { id: 'm1', kode: 'PLY-0001', code: 'PLY-0001', name: 'Triplek 9mm Meranti Grade A', category: 'Plywood & Board', qty: 10, satuan: 'Lembar', current_stock: 2, min_stock: 5, harga_acuan: 120000 },
    { id: 'm2', kode: 'BHP-0001', code: 'BHP-0001', name: 'Lem Fox Putih Kemasan Kaleng 1kg', category: 'Bahan Habis Pakai', qty: 3, satuan: 'Kaleng', current_stock: 1, min_stock: 2, harga_acuan: 45000 }
  ],
  requests: [
    { id: 'r1', pr_number: 'PR-001', project_name: '[83] Mabes', title: 'Material dinding dan plafon lantai 3', status: 'DRAFT', priority: 'URGENT', notes: 'catatan', materials_summary: '4 Lembar Triplek 9mm', created_at: '2026-10-02T00:00:00Z' }
  ],
  approvals: [
    { id: 'a1', pr_number: 'PR-001', project_name: '[83] Mabes', title: 'Material dinding', purchase_request_id: 'r1', step_number: 1, status: 'PENDING', note: 'note', decided_at: null }
  ],
  receivings: [
    { id: 'rc1', invoice_no: 'INV-1', project_id: 'p1', project_name: '[83] Mabes', status: 'NORMAL', received_date: '2026-10-04', note: 'nominal: 450.000', purchase_request_id: 'r1' }
  ],
  handovers: [],
  pr_items: [
    { id: 'pi1', pr_id: 'r1', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 4, status: 'PENDING_APPROVAL', supplier_category: 'Plywood & Board', vendor_id: 'v1', estimated_price: 120000, sort_order: 0 }
  ],
  receiving_items: [
    { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 3, note: '[Harga: 118000]' }
  ],
  customers: [
    { id: 'c1', name: 'Ibu Sarah Wijayakusuma Kusumawardhani', phone: '081298765432', email: 'sarah.wijayakusuma@perusahaan-panjang-sekali.example', address: 'Jl. Jenderal Sudirman Kavling 52-53, Jakarta Selatan 12190', source: 'Instagram', notes: 'Preferensi warna netral' }
  ],
  leads: [
    { id: 'l1', name: 'Bapak Hartono Wijaya', stage: 'Qualified', source: 'Referral', campaign: 'Kampanye Q4 2026 — Renovasi Rumah', next_action: 'Kirim RAB revisi 2', next_action_date: '2026-10-25', notes: 'butuh 3 kamar' }
  ],
  tukang_projects: [
    { id: 'tp1', tukang_key: 'asep', tukang_name: 'Asep Sunandar', project_name: '[83] Mabes Polri Renovasi Lantai 3 Sayap Barat', batch: 'Batch 2026-10', total_upah: 4500000, status: 'Berjalan' }
  ],
  project_plans: [
    { id: 'pl1', project_id: 'p1', area: 'Lantai 3', item_name: 'Pasang partisi gypsum rangka hollow', spec: 'Gypsum 9mm + hollow 4x4', volume: 24, unit: 'm2', worker_name: 'Asep Sunandar', worker_type: 'borongan', labor_cost: 3600000, status: 'Berjalan', progress: 40, target_start: '2026-10-01', target_end: '2026-10-20' }
  ],
  tukang_dashboards: [],
  project_cost_summary: [
    { project_no: '83', project_name: 'Mabes Polri Renovasi Lantai 3 Sayap Barat', project_status: 'ON_GOING', revenue: 250000000, material_cost: 95000000, labor_cost: 45000000, cumulative_cost: 140000000, current_week_expense: 12500000 }
  ],
  sales_invoices: [
    { id: 'si_d', status: 'DRAFT', invoice_no: null, customer_name: 'Draf Co', project_name: 'Fit-Out Draf', nominal: 1000000, tax_rate: 0, tax_amount: 0, grand_total: 1000000, issue_date: '2026-10-17', due_date: '', project_issued: false, project_code: null, sent_at: null, sent_channel: '', paid_amount: null, payment_ref: '' },
    { id: 'si_t', status: 'TERBIT', invoice_no: 'INV/NL/2026/10/001', customer_name: 'Ibu Sarah Wijayakusuma', project_name: 'Fit-Out Rumah Sarah', project_code: '106', project_issued: true, nominal: 2000000, tax_rate: 11, tax_amount: 220000, grand_total: 2220000, issue_date: '2026-10-17', due_date: '2026-10-31', sent_at: null, sent_channel: '', paid_amount: null, payment_ref: '' }
  ],
  boq_items: [
    { project_id: 'p1', item_name: 'Pasang partisi gypsum', qty: 24, unit: 'm2', price: 185000 },
    { project_id: 'p1', item_name: 'Pengecatan dinding interior', qty: 120, unit: 'm2', price: 65000 }
  ],
  rab_items: [
    { project_id: 'p1', item_name: 'Pasang partisi gypsum', qty: 24, unit: 'm2', price: 185000 },
    { project_id: 'p1', item_name: 'Pengecatan dinding interior', qty: 120, unit: 'm2', price: 65000 }
  ]
}

export default MOCK
