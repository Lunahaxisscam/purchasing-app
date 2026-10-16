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
    label: 'Purchase',
    adminOnly: false,
    source: 'module',
    files: [
      'modules/receivings/view.jsx',
      'modules/receivings/form.jsx',
      'modules/receivings/save.js',
      // Form "Terima Barang" (t_5196b689): satu pintu input qty penerimaan
      // (logika murni, simpan idempoten, komponen modal).
      'modules/receivings/receiptLogic.js',
      'modules/receivings/receiptSave.js',
      'modules/receivings/receiptForm.jsx',
      'scripts/receipt-flow-test/run.py'
    ]
  },
  {
    id: 'handovers',
    label: 'Handover',
    adminOnly: false,
    source: 'module',
    files: ['modules/handovers/view.jsx', 'modules/handovers/form.jsx', 'modules/handovers/save.js']
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
