// Catatan (Blossom t_0b304478): `label` ditambahkan HANYA sebagai judul grup
// di sidebar. Nama menu (item) TIDAK diubah agar alur/role/schema tetap sama.
export const navSections = [
  {
    label: 'Operasional',
    items: [
      ['dashboard', 'Dashboard'],
      // t_31871b64 (Sprint 1, arahan DAT): Projects & Past Project
      // digabung jadi SATU menu. Rute 'projects' tetap jadi target
      // navigasi, sedangkan RUTE 'past_projects' TETAP TERDAFTAR di
      // objek `labels` (di bawah) dan tetap punya item sendiri di grup
      // "Arsip" supaya ID navigasi lama tetap jalan — permintaan itu
      // bagian dari acceptance criteria ("all existing nav IDs still
      // work"). Yang hilang hanya satu baris menu yang mengarah ke
      // tampilan terpisah; datanya tidak berubah.
      ['projects', 'Projects'],
      ['vendors', 'Vendors'],
      ['materials', 'Materials']
    ]
  },
  {
    label: 'Pengadaan',
    items: [
      ['requests', 'Purchase Request'],
      ['approvals', 'Approval'],
      // t_31871b64 (Sprint 1, arahan DAT): label terlihat "Purchase" ->
      // "Pembelian". ID route/permission/alur/schema TIDAK disentuh.
      ['receivings', 'Pembelian'],
      // t_31871b64 (Sprint 1, arahan DAT): label terlihat "Handover" ->
      // "Serah Terima". ID route/permission/alur/schema TIDAK disentuh.
      ['handovers', 'Serah Terima']
    ]
  },
  // t_31871b64 (Sprint 1, arahan DAT): grup "Arsip" DIHAPUS — menu
  // "Past Project" digabung ke modul Projects sebagai tab "Selesai".
  // RUTE 'past_projects' TIDAK dihapus: tetap terdaftar di objek `modules`
  // & `labels` di bawah (ID navigasi lama tetap valid — acceptance criteria),
  // dan halaman lama tetap dirender sebagai modul Projects dengan tab
  // "Selesai" aktif. Yang hilang hanya satu baris menu terpisah.
  {
    label: 'Admin Suite',
    // Modul khusus ADMIN — sidebar menyaring section ini berdasarkan role.
    adminOnly: true,
    items: [
      // t_18564dce run 58 (feedback DAT screenshot 1792153990878): RAB & BOQ
      // menjadi item PERTAMA di bawah heading ADMIN SUITE.
      ['rab_boq', 'RAB & BOQ'],
      // t_ff3a96cf (arahan DAT "buka dulu modulnya, termin menyusul"):
      // modul shell Invoice Penjualan — tahap awal, tanpa termin/penomoran.
      ['sales_invoice', 'Invoice Penjualan'],
      // t_02e5f5fd: modul "Stok Workshop" — read-only, admin-only.
      // Rute baru (tidak menggantikan rute lama mana pun); menunya hanya
      // muncul untuk admin karena berada di grup adminOnly ini.
      ['stock', 'Stok Workshop'],
      // t_7253b859: modul "Customer CRM" — read-only, admin-only.
      // Rute baru; menu hanya muncul untuk admin karena berada di grup
      // adminOnly ini. Tidak ada tabel/penulisan DB: customer dari form
      // adalah draf memori halaman (lihat modules/crm/README.md).
      ['crm', 'Customer CRM'],
      // t_62e41e91: modul "Actual Labor & Stok" — read-only, admin-only.
      // Satu halaman: Actual Labor (upah tukang tercatat vs estimasi
      // rencana) + Workshop Stock. Tidak ada penulisan DB dan formula
      // finance tidak disentuh (lihat modules/labor-stock/README.md).
      ['labor_stock', 'Actual Labor & Stok'],
      ['planning', 'Budgeting'],
      ['project_finance', 'Project Finance'],
      ['finance', 'Finance'],
      ['tukang_upah', 'Upah Tukang'],
      ['settings', 'Settings']
    ]
  }
]

export const modules = navSections.flatMap(s => s.items)

// ============================================================
// RENAME LABEL TAMPAK (t_31871b64 — Sprint 1, arahan DAT)
// ============================================================
// Hanya TEKS YANG TERLIHAT yang diubah; ID route, permission, alur, dan
// schema TIDAK disentuh. Anggota di bawah ini sengaja TIDAK dirilis sebagai
// konstanta terpisah: perubahan label harus terjadi di SATU tempat agar
// tidak ada label duplikat yang bisa drift.
//
//   receivings : 'Purchase'  -> 'Pembelian'
//   handovers  : 'Handover'  -> 'Serah Terima'
//
// Kompatibilitas dijaga: sidebar, judul halaman, judul modal Tambah/Edit,
// dan pesan sukses save SEMUA memakai `labels[...]` (lihat components/
// Sidebar.js, pages/index.js, components/CreateModal.js, modules/shared/
// saveHelpers.js) — jadi tidak ada satu pun string 'Purchase' / 'Handover'
// yang perlu disisipkan manual. Rute 'receivings' & 'handovers' tetap
// sama; modul Purchase (halaman dua tab, t_9109cf5e) dan modul Handover
// (antrean distribusi, t_ca7ecb65) tidak berubah sama sekali.
//
// CATATAN: label 'Pembelian' TIDAK dipakai sebagai kata ganti "proses
// pengadaan" di dalam modul Purchase — tab di dalamnya tetap "Siap Dibeli"
// & "Riwayat Pembelian" sesuai test purchase-flow-test.
export const labels = {
  projects: 'Project',
  vendors: 'Vendor',
  materials: 'Material',
  requests: 'Purchase Request',
  approvals: 'Approval',
  receivings: 'Pembelian',
  handovers: 'Serah Terima',
  past_projects: 'Past Project',
  planning: 'Budgeting',
  project_finance: 'Project Finance',
  finance: 'Finance',
  tukang_upah: 'Upah Tukang',
  // Modul RAB & BOQ (t_18564dce) — kalkulator BOQ standalone, admin-only.
  // Label halaman; modul tidak tersentuh ModuleView (halaman source:'core').
  rab_boq: 'RAB & BOQ',
  // Modul Invoice Penjualan (t_ff3a96cf) — shell tahap awal, admin-only.
  sales_invoice: 'Invoice Penjualan',
  // Modul Stok Workshop (t_02e5f5fd) — read-only, admin-only.
  stock: 'Stok Workshop',
  // Modul Customer CRM (t_7253b859) — read-only, admin-only.
  crm: 'Customer CRM',
  // Modul Actual Labor & Stok (t_62e41e91) — read-only, admin-only.
  // Halaman source:'core' (dirender pages/index.js): Actual Labor
  // (tukang_projects.total_upah = aktual, dibanding project_plans.labor_cost
  // = estimasi) + Workshop Stock (rows.materials). Tidak ada penulisan DB,
  // tidak ada migrasi, formula finance tidak disentuh.
  labor_stock: 'Actual Labor & Stok',
  settings: 'Settings'
}

// ============================================================
// Kode material per kategori (revisi 9 Okt 2026).
// Tiap kategori punya prefix + nomor urut 4 digit sendiri (contoh PLY-0001).
// Material baru otomatis memakai format ini; material lama dimigrasi dengan
// mempertahankan urutan lamanya.
// ============================================================
export const MATERIAL_KODE_PREFIXES = {
  'Plywood & Board': 'PLY',
  'HPL & Edging': 'HPL',
  'WPC & Panel': 'WPC',
  'Hardware & Fitting': 'HWF',
  'Kelistrikan & Lampu': 'KEL',
  'Aluminium & Profil': 'ALM',
  'Bahan Habis Pakai': 'BHP'
}

// Kategori tak dikenal -> prefix cadangan 'MAT' (pengaman).
export function prefixForCategory(category) {
  const key = String(category || '').trim()
  return MATERIAL_KODE_PREFIXES[key] || 'MAT'
}

export const statusOptions = [
  { value: 'NOT_START', label: 'Not Start' },
  { value: 'ON_GOING', label: 'On Going' },
  { value: 'DONE', label: 'Done' }
]

export const receivingStatusOptions = [
  { value: 'NORMAL', label: '✓ Normal' },
  { value: 'RETUR', label: '⚠️ Retur' },
  { value: 'REFUND', label: '⚠️ Refund' }
]

export function isReceivingKendala(s) {
  if (!s) return false
  const up = String(s).toUpperCase()
  return up === 'RETUR' || up === 'REFUND' || up === 'RUSAK' || up.startsWith('KENDALA')
}

export function prettyReceivingStatus(s) {
  const up = String(s || '').toUpperCase()
  if (up === 'NORMAL') return '✓ Normal'
  if (up === 'RETUR' || up === 'KENDALA_RETUR') return '⚠️ Retur'
  if (up === 'REFUND') return '⚠️ Refund'
  if (up === 'RUSAK' || up === 'KENDALA_RUSAK') return '⚠️ Rusak'
  if (up === 'SELESAI') return '✓ Diterima (status lama)'
  if (up === 'MASUK_GUDANG') return '📦 Masuk Gudang (status lama)'
  if (up === 'OTW') return 'OTW (status lama)'
  if (up === 'MENUNGGU_BARANG') return '⏳ Menunggu Barang (status lama)'
  if (up === 'PENDING') return 'Pending (status lama)'
  const match = receivingStatusOptions.find(o => o.value === s)
  if (match) return match.label
  return s
}

export function normalizeStatus(s) {
  if (!s) return 'NOT_START'
  const up = String(s).toUpperCase().trim().replace(/[\s-]+/g, '_')
  if (up === 'DONE') return 'DONE'
  if (up === 'ON_GOING' || up === 'ONGOING' || up === 'ACTIVE') return 'ON_GOING'
  if (up === 'NOT_START' || up === 'NOT_STARTED' || up === 'PLANNING') return 'NOT_START'
  return up
}

export function prettyStatus(s) {
  const norm = normalizeStatus(s)
  const found = statusOptions.find(o => o.value === norm)
  return found ? found.label : s
}

export function orderSpecFor(table) {
  if (table === 'materials') return { column: 'kode', ascending: true }
  if (table === 'approval_steps') return { column: 'step_number', ascending: true }
  // pr_items tidak punya created_at; pakai sort_order supaya urutan item SELALU
  // stabil sesuai urutan input (tanpa ORDER BY, PostgreSQL bisa mengubah urutan
  // setelah row di-update). NullsLast di-handle di pemanggil.
  if (table === 'pr_items') return { column: 'sort_order', ascending: true }
  return { column: 'created_at', ascending: false }
}

export function headersFor(page, rows) {
  const defaults = {
    projects: ['kode', 'name', 'status', 'created_at'],
    past_projects: ['kode', 'name', 'status', 'created_at'],
    vendors: ['name', 'phone', 'store_link', 'supplier_category'],
  // t_090127ad (arahan DAT): kolom "Acuan Harga" DIHILANGKAN dari daftar
  // Material (desktop & mobile) — tampilannya dipindah ke rincian expandable
  // di bawah nama material (tombol "+ Acuan Harga" / "▲ Tutup Acuan",
  // modules/materials/view.jsx). FIELD materials.harga_acuan TETAP ADA di DB
  // dan nilai existing TIDAK dihapus/diubah; ia tetap terbaca di rincian
  // (sumber MASTER) dan tetap dipakai fallback estimasi harga PR.
    // t_31871b64 (Sprint 1, arahan DAT): kolom 'kode' DIHILANGKAN dari
  // daftar Material — kode kini tampil sebagai sublabel di bawah nama
  // material (lihat renderCell 'name' di modules/materials/view.jsx) agar
  // tabel lebih ringkas. FIELD materials.kode TIDAK dihapus dari DB, nilainya
  // tetap tersimpan & terbaca; pencarian/acuan/show-more/export tetap jalan.
  materials: ['name', 'category', 'qty', 'satuan', 'current_stock', 'min_stock'],
    requests: ['priority', 'pr_number', 'project_name', 'title', 'items_qty', 'materials_summary', 'vendor_name', 'estimasi_harga', 'status'],
    approvals: ['pr_number', 'project_name', 'title', 'items', 'items_qty', 'step_number', 'status', 'note', 'decided_at'],
    // t_5196b689 (arahan DAT): daftar Purchase menampilkan ringkasan nama/
    // jumlah item (kolom VIRTUAL 'items' — diisi receiving_items), bukan cuma
    // invoice/status. Nilai DB tidak berubah; 'note' tetap untuk nominal/nota.
    // t_9109cf5e: modul Purchase kini halaman sendiri (dua tab). Daftar kolom
    // ini dipertahankan hanya untuk ekspor data; UI tidak membacanya lagi.
    receivings: ['invoice_no', 'project_name', 'items', 'status', 'received_date', 'note'],
    // Kolom 'bukti_foto' adalah kolom VIRTUAL (bukan kolom DB): isinya
    // diekstrak dari penanda [FotoBukti: …] di kolom note oleh
    // modules/handovers/view.jsx — sehingga user/mandor melihat foto bukti
    // serah terima langsung di tabel Handover.
    // Kolom 'items' (VIRTUAL, t_b418827b): rincian barang penyerahan. Belum
    // ada tabel handover_items (menunggu izin DAT) — data lama tanpa rincian
    // diberi label "Rincian barang belum tersedia", TIDAK menebak jumlah
    // dari data Purchase yang bisa berubah.
    handovers: ['project_name', 'items', 'received_by', 'status', 'handover_date', 'bukti_foto', 'note']
  }
  if (['materials', 'vendors', 'projects', 'past_projects', 'requests', 'approvals', 'receivings', 'handovers'].includes(page)) {
    return defaults[page]
  }
  return rows[0]
    ? Object.keys(rows[0]).filter(x => !['id', 'password'].includes(x)).slice(0, 6)
    : defaults[page]
}

export function pretty(x) {
  if (x === 'kode') return 'Kode'
  if (x === 'name') return 'Nama'
  if (x === 'category') return 'Kategori'
  if (x === 'qty') return 'Qty'
  if (x === 'current_stock') return 'Stok Saat Ini'
  if (x === 'min_stock') return 'Batas Min'
  if (x === 'satuan' || x === 'unit') return 'Satuan'
  if (x === 'harga_acuan') return 'Acuan Harga'
  if (x === 'items_qty') return 'Qty'
  if (x === 'estimasi_harga') return 'Estimasi Harga' 
  if (x === 'vendor_name') return 'Vendor' 
  // t_31871b64 (Sprint 1, arahan DAT): label kontak DISERAGAMKAN antara
  // form, kartu mobile, dan header tabel — satu nama untuk satu makna.
  if (x === 'contact') return 'Email / Kontak Lain'
  if (x === 'phone') return 'Kontak WA'
  if (x === 'store_link') return 'Link Toko'
  if (x === 'supplier_category') return 'Kategori Material' 
  if (x === 'pr_number') return 'No. PR'
  if (x === 'project_name') return 'Project'
  if (x === 'title') return 'Judul Kebutuhan'
  if (x === 'materials_summary' || x === 'items') return 'Item Material'
  if (x === 'step_number') return 'Step'
  if (x === 'delivery_note') return 'Surat Jalan / PO'
  if (x === 'invoice_no') return 'No. Invoice'
  if (x === 'received_date') return 'Tgl Terima'
  if (x === 'handover_date') return 'Tgl Serah Terima'
  if (x === 'received_by') return 'Diterima Oleh'
  if (x === 'priority') return 'Prioritas'
  if (x === 'status') return 'Status'
  if (x === 'notes' || x === 'note') return 'Catatan'
  if (x === 'decided_at') return 'Waktu Putusan'
  return String(x).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ============================================================
// Modul Budgeting (khusus admin) — status progress item WBS.
// ============================================================
export const PLANNING_STATUSES = ['Perencanaan', 'Fabrikasi WS', 'Finishing', 'Instalasi', 'Selesai']

export const PLANNING_STATUS_STYLE = {
  'Perencanaan':  { background: '#f0f1ea', color: '#4b523a', border: '1px solid #d5d9ce' },  // abu-olive
  'Fabrikasi WS': { background: '#eef0e6', color: '#3f4433', border: '1px solid #cfd3bd' },  // olive muda
  'Finishing':    { background: '#fdf5e8', color: '#945719', border: '1px solid #f0dcb4' },  // amber hangat
  'Instalasi':    { background: '#f1ecdf', color: '#7a6231', border: '1px solid #e0d3b6' },  // sand gelap
  'Selesai':      { background: '#e7f2ec', color: '#1b6348', border: '1px solid #bfdccd' }   // hijau sukses
}

export function planningStatusStyle(status) {
  return PLANNING_STATUS_STYLE[status] || PLANNING_STATUS_STYLE['Perencanaan']
}

// Persentase rapi: 12.3456 -> "12,35%"
export function persen(v, digits = 2) {
  const n = Number(v)
  if (!isFinite(n)) return '—'
  return `${n.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

// Format v/unit: 3.2 -> "3,2 m1" (koma desimal Indonesia)
export function volumeText(volume, unit) {
  const v = Number(volume)
  const volStr = isFinite(v)
    ? v.toLocaleString('id-ID', { maximumFractionDigits: 3 })
    : String(volume ?? '')
  return `${volStr} ${unit || ''}`.trim()
}

// ============================================================
// Minimum Stock BHP (Sprint 1).
// Bahan Habis Pakai = kategori 'Bahan Habis Pakai' / kode berawalan 'BHP'.
// Stok menipis bila: min_stock > 0 DAN current_stock <= min_stock.
// ============================================================
export function isBhpMaterial(m) {
  if (!m) return false
  const kat = String(m.category || '').trim().toLowerCase()
  if (kat === 'bahan habis pakai') return true
  // Prefix BHP wajib diikuti '-' + digit (BHP-0013) — 'BHPX-1' bukan BHP.
  return /^BHP-\d/i.test(String(m.kode || m.code || '').trim())
}

export function isStokMenipis(m) {
  if (!m || !isBhpMaterial(m)) return false
  const cur = Number(m.current_stock)
  const min = Number(m.min_stock)
  return isFinite(min) && min > 0 && isFinite(cur) && cur <= min
}

// Angka stok rapi utk tampilan ('' / null → '—', desimal pakai koma).
export function stokText(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n)) return String(v)
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
}

export function format(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d.toLocaleDateString('id-ID')
  }
  return String(v)
}

// ============================================================
// Helper Receiving — Nominal Riil & Foto/Nota (Poin 3).
// Data tersimpan terstruktur di kolom `note` tabel receivings:
//   [Nominal: Rp X.XXX.XXX] [Nota: url] [Catatan Tambahan]
// ============================================================

export function formatRibuan(n) {
  // Number murni: bulatkan dulu supaya hasil perkalian desimal (mis. 43300000*0.7
  // = 30309999.999999996) tidak meledak jadi 30 kuadriliun saat digit-nya di-strip.
  if (typeof n === 'number' && isFinite(n)) {
    return new Intl.NumberFormat('id-ID').format(Math.round(n))
  }
  const digits = String(n ?? '').replace(/[^\d]/g, '')
  if (!digits) return '0'
  return new Intl.NumberFormat('id-ID').format(Number(digits))
}

// Format live saat user mengetik nominal: hanya angka, otomatis titik ribuan.
export function formatNominalInput(v) {
  const digits = String(v ?? '').replace(/[^\d]/g, '').slice(0, 15)
  return digits ? new Intl.NumberFormat('id-ID').format(Number(digits)) : ''
}

export function rupiah(n) {
  return `Rp ${formatRibuan(n)}`
}

// Ekstrak Nominal / Nota / Catatan dari kolom note (aman untuk data lama
// yang belum terstruktur — teks lamanya masuk ke `extra` apa adanya).
export function parseReceivingNote(note) {
  const s = String(note || '')
  const nomMatch = s.match(/\[Nominal:\s*Rp\s*([\d.,]+)\s*\]/i)
  const notaMatch = s.match(/\[Nota:\s*([^\]]+)\]/i)
  let nominal = null
  if (nomMatch) {
    const digits = nomMatch[1].replace(/[^\d]/g, '')
    if (digits) nominal = Number(digits)
  }
  const notaUrl = notaMatch ? notaMatch[1].trim() : ''
  const extra = s
    .replace(/\[Nominal:[^\]]*\]/ig, ' ')
    .replace(/\[Nota:[^\]]*\]/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { nominal, notaUrl, extra }
}

// Susun ulang kolom note dari input form (nominal terformat "450.000" pun aman).
export function buildReceivingNote({ nominal, nota, extra } = {}) {
  const parts = []
  const digits = String(nominal ?? '').replace(/[^\d]/g, '')
  if (digits && Number(digits) > 0) parts.push(`[Nominal: Rp ${formatRibuan(digits)}]`)
  const notaStr = String(nota || '').trim()
  if (notaStr) parts.push(`[Nota: ${notaStr}]`)
  const extraStr = String(extra || '').trim()
  if (extraStr) parts.push(extraStr)
  return parts.length ? parts.join(' ') : null
}

// ============================================================
// Handover — bukti foto serah terima (fitur 15 Okt 2026).
// Foto disimpan sebagai data-URL base64 DI DALAM kolom note dengan penanda
// [FotoBukti: …] — pola yang sama dengan [Nominal]/[Nota] pada penerimaan,
// sehingga tidak perlu kolom/relasi DB baru. Data lama tanpa penanda tetap
// aman: seluruh teks lamanya masuk ke `extra` apa adanya.
// ============================================================

// Batas ukuran file bukti foto (client-side): 2MB = 2 * 1024 * 1024 byte.
export const HANDOVER_FOTO_MAX_BYTES = 2 * 1024 * 1024

// Ukuran byte sebenarnya dari sebuah data-URL base64.
// Padding '=' tidak dihitung sebagai byte data (penting supaya file tepat
// 2MB tidak tertolak 1 byte gara-gara pembulatan).
export function dataUrlByteSize(dataUrl) {
  const s = String(dataUrl || '')
  const comma = s.indexOf(',')
  if (!/^data:/i.test(s) || comma < 0) return 0
  const b64 = s.slice(comma + 1)
  const pad = (b64.match(/=+$/) || [''])[0].length
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad)
}

// Validasi ukuran file bukti foto (client-side, dipakai form & save).
// Mengembalikan pesan peringatan; string kosong = file valid.
export function validateHandoverFotoSize(sizeBytes) {
  const n = Number(sizeBytes)
  if (!isFinite(n) || n <= 0) return ''
  if (n > HANDOVER_FOTO_MAX_BYTES) {
    const mb = (n / (1024 * 1024)).toFixed(2).replace('.', ',')
    return `⚠️ Ukuran file ${mb} MB melebihi batas maksimal 2MB. Pilih foto yang lebih kecil.`
  }
  return ''
}

// Susun ulang kolom note handover dari input form (foto + catatan).
export function buildHandoverNote({ foto, extra } = {}) {
  const parts = []
  const fotoStr = String(foto || '').trim()
  if (fotoStr) parts.push(`[FotoBukti: ${fotoStr}]`)
  const extraStr = String(extra || '').trim()
  if (extraStr) parts.push(extraStr)
  return parts.length ? parts.join(' ') : null
}

// Handover (t_b418827b): "Sudah Diserahkan" = BUKTI FISIK penyerahan, yaitu
// ada `diserahkan_at`. Status CONFIRMED lama tanpa diserahkan_at TIDAK dihitung
// sudah diserahkan (bukti live A3) — jangan pernah mengklaim serah terima
// hanya karena alokasi/status dipilih.
export function isHandoverDelivered(h) {
  return !!(h && h.diserahkan_at)
}

// Ekstrak Bukti Foto / catatan dari kolom note handover (aman untuk data lama
// yang belum terstruktur — teks lamanya masuk ke `extra` apa adanya).
export function parseHandoverNote(note) {
  const s = String(note || '')
  const fotoMatch = s.match(/\[FotoBukti:\s*([^\]]+)\]/i)
  const foto = fotoMatch ? fotoMatch[1].trim() : ''
  const extra = s
    .replace(/\[FotoBukti:[^\]]*\]/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { foto, extra }
}

// Teks nota -> href aman: hanya http(s) atau domain tanpa spasi.
// Nomor resi biasa (bukan URL) dikembalikan '' supaya tidak jadi link ngawur.
export function notaHref(value) {
  const s = String(value || '').trim()
  if (!s || /\s/.test(s)) return ''
  if (/^https?:\/\//i.test(s)) return s
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s)) return `https://${s}`
  return ''
}

// ============================================================
// Format waktu untuk modul Settings & Finance (Drive sync).
// ============================================================

// Waktu lengkap ala Indonesia: "10 Okt 2026, 00.05"
export function formatDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.')
  return `${tgl}, ${jam}`
}

// Jarak waktu relatif: "baru saja", "5 menit lalu", "2 jam lalu", "3 hari lalu".
export function timeAgo(v) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 0) return 'baru saja'
  const mnt = Math.floor(diff / 60000)
  if (mnt < 1) return 'baru saja'
  if (mnt < 60) return `${mnt} menit lalu`
  const jam = Math.floor(mnt / 60)
  if (jam < 24) return `${jam} jam lalu`
  const hari = Math.floor(jam / 24)
  return `${hari} hari lalu`
}
