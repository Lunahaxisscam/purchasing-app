// ============================================================
// modules/registry.js — MANIFEST MODUL (Fase 1 + Fase 2 modularisasi)
// ============================================================
// Ini adalah "satu pintu" daftar modul aplikasi. Setiap modul punya folder
// sendiri di modules/<id>/ dan boleh dikerjakan oleh agent berbeda TANPA
// menyentuh file modul lain.
//
// KONTRAK MODUL (semua field wajib diisi bila menambah modul baru):
//   id        : kunci unik modul; sama dengan `page` di sidebar & labels
//   label     : judul modul (dipakai header & tombol tambah)
//   adminOnly : true bila modul hanya untuk role admin
//   source    : lokasi komponen
//                 'core'      -> dirender langsung oleh pages/index.js
//                 'module'    -> dirender oleh components/ModuleView.js
//                 'dashboard' -> halaman dashboard
//   files     : daftar file yang menjadi tanggung jawab modul (dokumentasi
//               kepemilikan; dipakai docs/owners.md & review PR)
//
// ATURAN (lihat docs/owners.md):
//   1. 1 file = 1 owner. File di modules/<id>/ hanya boleh diubah agent pemilik
//      modul itu. File core (pages/index.js, lib/*, modules/registry.js,
//      modules/shared/*) hanya boleh diubah Tech Lead.
//   2. Data ownership: tiap modul punya tabel + RLS sendiri; modul lain hanya
//      membaca via view/RPC read-only.
//   3. Migrasi yang sudah merge TIDAK BOLEH diedit.
// ============================================================

export const modules = [
  // --- Modul inti (dirender oleh ModuleView) ---
  // CATATAN: `files` HANYA berisi file kepemilikan modul (folder modules/<id>/).
  // File CORE (ModuleView.js, CreateModal.js, registry.js, modules/shared/*)
  // tidak dicantumkan di sini — file itu milik Tech Lead (lihat docs/owners.md).
  {
    id: 'projects',
    label: 'Project',
    adminOnly: false,
    source: 'module',
    files: ['modules/projects/view.jsx', 'modules/projects/form.jsx', 'modules/projects/save.js']
  },
  {
    id: 'vendors',
    label: 'Vendor',
    adminOnly: false,
    source: 'module',
    files: ['modules/vendors/view.jsx', 'modules/vendors/form.jsx', 'modules/vendors/save.js']
  },
  {
    id: 'materials',
    label: 'Material',
    adminOnly: false,
    source: 'module',
    files: ['modules/materials/view.jsx', 'modules/materials/form.jsx', 'modules/materials/save.js']
  },
  {
    id: 'requests',
    label: 'Purchase Request',
    adminOnly: false,
    source: 'module',
    files: ['modules/requests/view.jsx', 'modules/requests/form.jsx', 'modules/requests/save.js']
  },
  {
    id: 'approvals',
    label: 'Approval',
    adminOnly: false,
    source: 'module',
    files: ['modules/approvals/view.jsx']
  },
  {
    id: 'receivings',
    // t_31871b64 (Sprint 1, arahan DAT): label terlihat 'Purchase' ->
    // 'Pembelian'. id modul, permission, source, files TIDAK berubah.
    label: 'Pembelian',
    adminOnly: false,
    // t_9109cf5e (arahan DAT): Purchase punya HALAMAN SENDIRI (dua tab: Siap
    // Dibeli & Riwayat Pembelian + dialog Proses Pembelian), dirender langsung
    // pages/index.js — bukan tabel generik ModuleView. Karena itu source =
    // 'core'. Tombol gudang/tukang/retur/refund dari alur lama DIHAPUS;
    // distribusi fisik barang pindah ke modul Handover.
    source: 'core',
    files: [
      'modules/receivings/page.jsx',
      'modules/receivings/purchaseForm.jsx',
      'modules/receivings/purchaseLogic.js',
      'modules/receivings/purchaseSave.js',
      'modules/receivings/attachments.js',
      'lib/purchaseNote.js',
      'scripts/purchase-flow-test/run.py'
    ]
  },
  {
    id: 'handovers',
    // t_31871b64 (Sprint 1, arahan DAT): label terlihat 'Handover' ->
    // 'Serah Terima'. id modul, permission, source, files TIDAK berubah.
    label: 'Serah Terima',
    adminOnly: false,
    source: 'module',
    files: [
      'modules/handovers/view.jsx',
      'modules/handovers/form.jsx',
      'modules/handovers/save.js',
      // t_b418827b: logika murni (semantik bukti fisik, rincian/legacy label,
      // prototype per-item) + konfirmasi fisik idempoten (CAS diserahkan_at).
      'modules/handovers/display.js',
      'modules/handovers/confirm.js',
      // t_ca7ecb65: antrean distribusi fisik — logika murni (penjaga aksi),
      // penulis DB (3 aksi), dan banner React.
      'modules/handovers/logic.js',
      'modules/handovers/actions.js',
      'modules/handovers/queue.jsx',
      'scripts/handover-flow-test/run.py'
    ]
  },
  {
    id: 'past_projects',
    label: 'Past Project',
    adminOnly: false,
    source: 'module',
    files: ['modules/projects/view.jsx']
  },

  // --- Halaman inti non-tabel ---
  {
    id: 'dashboard',
    label: 'Dashboard',
    adminOnly: false,
    source: 'dashboard',
    files: ['components/Dashboard.js']
  },

  // --- Modul admin (folder masing-masing, sudah terpisah sejak awal) ---
  {
    id: 'planning',
    label: 'Budgeting',
    adminOnly: true,
    source: 'core',
    files: ['components/Planning.js', 'migrations/2026-10-10_planning_closing.sql']
  },
  {
    id: 'project_finance',
    label: 'Project Finance',
    adminOnly: true,
    source: 'core',
    files: ['components/ProjectFinance.js']
  },
  {
    id: 'finance',
    label: 'Finance',
    adminOnly: true,
    source: 'core',
    files: ['components/Finance.js']
  },
  {
    id: 'tukang_upah',
    label: 'Upah Tukang',
    adminOnly: true,
    source: 'core',
    files: ['components/TukangUpah.js']
  },
  {
    // RAB & BOQ (t_18564dce) — port modul DAT perhitungan-rab-otomatis-2.html.
    // Halaman source:'core' (dirender pages/index.js, BUKAN tabel ModuleView)
    // karena UI-nya kalkulator full-page, bukan tabel CRUD. Admin-only:
    // guard menu (registry adminOnly), guard render (pages/index.js), dan
    // guard data (insert projects lewat sesi Supabase + RLS). Tidak ada
    // endpoint/API server baru — semua ekspor (JSON/CSV/PDF) terjadi
    // client-side di browser admin.
    id: 'rab_boq',
    label: 'RAB & BOQ',
    adminOnly: true,
    source: 'core',
    files: [
      'modules/rab-boq/view.jsx',
      'modules/rab-boq/boqCalc.js',
      'modules/rab-boq/lib.js',
      'modules/rab-boq/pdf.js',
      'modules/rab-boq/csvExport.js',
      'modules/rab-boq/CreateProjectModal.jsx',
      'modules/rab-boq/README.md',
      'scripts/rab-boq-test/run.py'
    ]
  },
  {
    // Invoice Penjualan / Sales Invoice (t_ff3a96cf → diperkeras t_22865fc4).
    // Menu + halaman admin-only. Halaman source:'core' (dirender
    // pages/index.js, bukan tabel ModuleView) — pola RAB & BOQ.
    //
    // S4 (t_22865fc4) mengubah kontrak penyimpanan secara mendasar:
    //   * pages/api/sales-invoices.js sekarang WAJIB lolos verifyAdmin
    //     (JWT Supabase diverifikasi + peran dari tabel profiles) untuk
    //     GET/POST/PATCH — guard peran di UI saja tidak dianggap keamanan.
    //   * Store Supabase = kanonik; file JSON lokal hanya pratinjau
    //     non-produksi dan DITOLAK di produksi (fail closed).
    //   * Invoice lahir sebagai DRAFT tanpa nomor; nomor invoice & nomor
    //     proyek dialokasikan server saat TERBIT. Idempotency-Key mencegah
    //     duplikat saat retry.
    //   * Lihat docs/sales-invoice-contract.md (handoff Supabase §3).
    id: 'sales_invoice',
    label: 'Invoice Penjualan',
    adminOnly: true,
    source: 'core',
    files: [
      'modules/sales-invoice/view.jsx',
      'modules/sales-invoice/CreateInvoiceModal.jsx',
      'modules/sales-invoice/pdf.js',
      'modules/sales-invoice/contract.js',
      'modules/sales-invoice/store.js',
      'modules/sales-invoice/auth.js',
      'modules/sales-invoice/apiClient.js',
      'modules/sales-invoice/README.md',
      'pages/api/sales-invoices.js',
      'docs/sales-invoice-contract.md',
      'docs/report-t_fca26349.md',
      'scripts/sales-invoice-test/run.py'
    ]
  },
  {
    // RAP — Rencana Anggaran Pelaksana (t_71d95cfe). Rencana internal tim
    // pelaksana yang DITURUNKAN dari RAB: qty & harga satuan versi sendiri,
    // label versi + status, dan perbandingan RAB vs RAP. Halaman
    // source:'core' (dirender pages/index.js, bukan tabel ModuleView).
    // TIDAK ADA tabel DB (freeze migrasi) -> mode DRAFT_ONLY: draft hidup di
    // sesi + backup JSON manual, dan UI menyatakan "belum tersimpan di
    // server". Lihat docs/rap-contract.md.
    id: 'rap',
    label: 'RAP (Rencana Pelaksanaan)',
    adminOnly: true,
    source: 'core',
    files: [
      'modules/rap/view.jsx',
      'modules/rap/model.js',
      'modules/rap/budgetingBridge.js',
      'modules/rap/store.js',
      'modules/rap/README.md',
      'docs/rap-contract.md',
      'scripts/rap-test/run.py'
    ]
  },
  {
    // Modul "Stok Workshop" (t_02e5f5fd) — READ-ONLY, admin-only.
    // Halaman sendiri (source:'core', dirender pages/index.js) seperti
    // RAB & BOQ & Invoice Penjualan: tampilannya kumpulan kartu ringkas,
    // bukan tabel CRUD. TIDAK ada tabel DB baru, tidak ada penulisan:
    // hanya membaca rows.materials (katalog master). Angka stok berasal
    // dari materials.current_stock (ditulis RPC receive_to_warehouse) —
    // TIDAK pernah diturunkan dari status PR/header, dan yang tidak ada
    // ditandai "Tidak tersedia". Detail keterbatasan: modules/stock/logic.js.
    id: 'stock',
    label: 'Stok Workshop',
    adminOnly: true,
    source: 'core',
    files: [
      'modules/stock/view.jsx',
      'modules/stock/logic.js',
      'scripts/stock-view-test/run.py'
    ]
  },
  {
    // Modul "Perbandingan RAB vs RAP vs Aktual" (t_a5ba5f73) — READ-ONLY,
    // admin-only. Halaman sendiri (source:'core', dirender pages/index.js)
    // seperti RAB & BOQ & Stok Workshop. Tidak ada tabel DB baru, tidak ada
    // penulisan: draft RAP hidup di memori halaman saja (React state), reset
    // saat ganti proyek. Acuan RAB datang lewat prop (fixture/JSON) karena
    // repo menyimpan RAB di memori halaman, bukan tabel boq_items; AKTUAL
    // dibaca dari rows.receivings + rows.receiving_items. Aturan kejujuran:
    // tidak ada aktual -> "Belum ada aktual" BUKAN Rp 0; pagu tidak dikirim
    // -> "Pagu belum diketahui" BUKAN "aman"; yang dibandingkan nilai dasar
    // baris (qty x harga), bukan grand total quotation yang sudah markup/PPN.
    // Detail: modules/rap-compare/README.md.
    id: 'rap_compare',
    label: 'Perbandingan RAB/RAP/Aktual',
    adminOnly: true,
    source: 'core',
    files: [
      'modules/rap-compare/view.jsx',
      'modules/rap-compare/logic.js',
      'modules/rap-compare/README.md',
      'scripts/rap-compare-test/run.py'
    ]
  },
  {
    // Modul "Customer CRM" (t_7253b859) — READ-ONLY, admin-only.
    // Halaman sendiri (source:'core', dirender pages/index.js) seperti
    // Stok Workshop & Perbandingan RAB/RAP/Aktual. TIDAK ada tabel DB baru,
    // TIDAK ada RPC, TIDAK ada migrasi, TIDAK ada penulisan: customer dari
    // form hidup sebagai DRAF memori halaman dan diberi label "Draf halaman".
    // Sumber data = prop `customers` dari host (atau rows.customers); tidak
    // dikirim -> capability 'unavailable' dengan panel penjelasan, BUKAN
    // daftar kosong yang terlihat seperti bug. Kontak kosong = "Tidak
    // tersedia" (bukan string kosong); hitungan relasi invoice yang tidak
    // dikirim host = "tidak dikirim", BUKAN 0. Tidak ada customer contoh.
    // Detail: modules/crm/README.md.
    id: 'crm',
    label: 'Customer CRM',
    adminOnly: true,
    source: 'core',
    files: [
      'modules/crm/view.jsx',
      'modules/crm/selector.jsx',
      'modules/crm/logic.js',
      'modules/crm/README.md',
      'scripts/crm-test/run.py'
    ]
  },
  {
    // Modul "Actual Labor & Workshop Stock" (t_62e41e91) — READ-ONLY,
    // admin-only. Halaman sendiri (source:'core', dirender pages/index.js)
    // seperti Stok Workshop, Perbandingan RAB/RAP/Aktual, dan Customer CRM.
    // TIDAK ada tabel DB baru, TIDAK ada RPC, TIDAK ada migrasi, TIDAK ada
    // penulisan, dan formula finance TIDAK disentuh: halaman ini hanya
    // menghadirkan dua ringkasan yang sudah ada di repo.
    //   1) ACTUAL LABOR  — tukang_projects.total_upah (aktual, hasil sync
    //      Google Sheets tim finance) dibandingkan dengan project_plans.
    //      labor_cost (estimasi). Estimasi dan aktual TIDAK pernah
    //      dijumlahkan/ditukar; sumber tidak dikirim -> panel penjelasan,
    //      BUKAN angka 0; nilai tidak ada -> "Tidak tersedia".
    //   2) WORKSHOP STOCK — ringkasan rows.materials (membaca kembali
    //      modules/stock/logic.js supaya aturan "bukan 0" konsisten).
    // Detail: modules/labor-stock/README.md.
    id: 'labor_stock',
    label: 'Actual Labor & Stok',
    adminOnly: true,
    source: 'core',
    files: [
      'modules/labor-stock/view.jsx',
      'modules/labor-stock/logic.js',
      'modules/labor-stock/README.md',
      'scripts/labor-stock-test/run.py'
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    adminOnly: true,
    source: 'core',
    files: ['components/Settings.js']
  }
]

export const moduleById = Object.fromEntries(modules.map(m => [m.id, m]))

// Modul yang dirender oleh ModuleView (tabel generik).
export const moduleViewPages = modules.filter(m => m.source === 'module').map(m => m.id)
