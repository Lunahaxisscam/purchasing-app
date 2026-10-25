# PETA KEPEMILIKAN MODUL (owners.md)

> Dibuat pada Fase 1 modularisasi (15 Okt 2026) oleh Bamboo (Tech Lead).
> Disetujui arahnya oleh Brooklyn (CEO) — lihat `brooklyn_response_modularization.md`.

## Prinsip

1. **1 file = 1 owner.** File di `modules/<modul>/` hanya boleh diubah oleh agent
   pemilik modul. File core (daftar di bawah) hanya boleh diubah Tech Lead.
2. **Data ownership.** Tiap modul punya tabel + RLS sendiri; modul lain hanya
   membaca lewat view/RPC read-only — bukan query langsung lintas modul.
3. **Migrasi yang sudah merge TIDAK BOLEH diedit.** Perubahan baru = file migrasi
   baru dengan tanggal baru.
4. **Definition of Done per task:** build hijau (`npm run build`), smoke test lulus
   (`/__smoke`), migrasi idempotent, TIDAK ada file di luar folder modul yang berubah.
5. **Zero scope bleed.** Jangan mulai kerja paralel di modul baru sebelum Fase 1
   stabil dan di-merge. (Arahan Brooklyn.)

## Alur kerja multi-agent

```
Sub-agent (worktree/branch feat/<modul>/<tugas>)
  → PR Modul (1 PR = 1 modul)
  → Review Teknis Bamboo (build hijau, boundary tidak bocor)
  → Handover ke Brooklyn (audit independen / Reviewer Resek)
  → Konfirmasi DAT
  → Merge ke main / Deploy
```

- Gunakan `git worktree` per agent supaya tidak berebut working directory.
- Preview Vercel per branch untuk QA — **jangan** uji ke data produksi Supabase.
- Data uji wajib self-cleaning atau pakai data mock (lihat `/__smoke`).

## Struktur

```
purchasing-app/
├── pages/index.js                 # SHELL halaman: auth, role, render per page   [CORE]
├── components/
│   ├── ModuleView.js              # SHELL tabel generik (state UI + rangkai)     [CORE]
│   ├── CreateModal.js             # SHELL form (state form + save per modul)     [CORE]
│   ├── Sidebar.js, Dashboard.js, Login.js, Common.js                            [CORE]
│   └── <modul admin>.js           # Planning, ProjectFinance, Finance, TukangUpah, Settings
├── modules/
│   ├── registry.js                # MANIFEST MODUL (daftar + kepemilikan)        [CORE]
│   ├── shared/                    # Helper & dispatcher lintas modul             [CORE]
│   │   ├── itemHelpers.js         # Helper item PR/Approval/Receiving
│   │   ├── filterRows.js          # Filter baris per modul
│   │   ├── sortRows.js            # Sortir kolom
│   │   ├── renderGenericCell.jsx  # Cell generik (project_name, title, dll)
│   │   ├── renderModuleCell.jsx   # Dispatcher cell/aksi/expand/mobile per modul
│   │   ├── renderCreateForm.jsx   # Dispatcher form tambah/edit per modul
│   │   ├── saveHelpers.js         # Retry 23505 + ekor insert generik (Fase 2)
│   │   └── saveDispatcher.js      # Dispatcher simpan per modul (Fase 2)
│   ├── requests/                  # view.jsx + form.jsx + save.js  (Purchase Request)
│   ├── approvals/                 # view.jsx                       (Approval)
│   ├── vendors/                   # view.jsx + form.jsx + save.js  (Vendor)
│   ├── materials/                 # view.jsx + form.jsx + save.js  (Material + stok BHP)
│   ├── receivings/                # page.jsx + purchaseForm.jsx + purchaseLogic.js + purchaseSave.js + attachments.js  (Purchase/belanja)
│   ├── handovers/                 # view.jsx + form.jsx + save.js + display.js + confirm.js  (Handover)
│   ├── projects/                  # view.jsx + form.jsx + save.js  (Project + Past Project)
│   └── ...                        # planning, project-finance, finance, tukang-upah, settings
├── lib/constants.js               # Konstanta & util bersama                      [CORE]
├── lib/workflow.js                # STATE MACHINE approval — cross-cutting       [CORE, SANGAT SENSITIF]
├── lib/telegramAlert.js           # Notifikasi Telegram                           [CORE]
└── migrations/                    # 1 file per modul per tanggal (immutable)
```

## Kontrak modul

Setiap folder modul menyediakan fungsi bernama dari `view.jsx` / `form.jsx`.
Shell (`ModuleView.js`, `CreateModal.js`) HANYA memanggil lewat dispatcher
(`modules/shared/renderModuleCell.jsx`, `modules/shared/renderCreateForm.jsx`).
Modul TIDAK mengimpor shell — arah dependensi selalu shell → modul.

### `view.jsx` (semua opsional kecuali `renderCell` bila punya kolom kustom)

| Fungsi | Peran | Return null berarti |
|---|---|---|
| `banner(ctx)` | Banner di atas toolbar | tidak ada banner |
| `rowClass(r)` | Kelas `<tr>` khusus | tidak ada kelas |
| `filters(ctx)` | Filter tabs modul | tidak ada filter |
| `header(h)` | Header kolom khusus | pakai label `pretty(h)` |
| `renderCell(h, r, rawVal, ctx)` | Isi sel kolom milik modul | shell pakai `renderGenericCell` |
| `desktopRow(r, ctx)` | Baris desktop khusus (mis. master-detail rowSpan) | shell pakai baris generik |
| `rowActions(r, ctx)` | Kolom "Aksi" | modul tanpa aksi |
| `rowExpand(r, ctx)` | Baris perluasan di bawah baris | tidak ada perluasan |
| `mobileCard(r, ctx)` | Kartu mobile | shell pakai kartu generik |
| `receiptForm(ctx)` | Modal khusus modul (mis. Terima Barang), dirender SEKALI per halaman lewat `renderModuleModal` | modul tanpa modal |

### `form.jsx`

| Fungsi | Peran | Return null berarti |
|---|---|---|
| `formBody(ctx)` | Field form Tambah/Edit | modul tanpa form |

### `save.js` (Fase 2)

| Fungsi | Peran | Return null berarti |
|---|---|---|
| `save(ctx)` | Seluruh logika simpan modul (insert/update + pesan + tutup modal) | modul tanpa simpan |

Modul yang punya `save.js`: requests, materials, vendors, projects, handovers.
Purchase **tidak lagi** memakai jalur ini (t_9109cf5e — lihat bagian
"Purchase — HALAMAN SENDIRI" di bawah). Shell `CreateModal.js` memanggil
`dispatchSave(page, ctx)` dari `modules/shared/saveDispatcher.js`; bila modul
tidak terdaftar, shell menampilkan pesan "Modul X tidak didukung untuk
penyimpanan."

**ctx untuk save** berisi: `page, form, isEdit, editRow, editItems, prItemsList,
nextPrNum, allMaterials, allVendors, say, close, refresh, setSaving`.
Perubahan daftar ini = perubahan KONTRAK (lewat Tech Lead).

### Purchase — HALAMAN SENDIRI (t_9109cf5e, arahan DAT)

Modul Purchase **tidak lagi** memakai tabel generik `ModuleView` maupun
`CreateModal`. Ia dirender langsung `pages/index.js` (registry: `source:'core'`)
sebagai halaman dua tab:

| File | Peran |
|---|---|
| `modules/receivings/page.jsx` | Halaman: tab **Siap Dibeli** (barang APPROVED, filter toko/proyek, centang banyak) + tab **Riwayat Pembelian** (nota selesai, total rupiah, lampiran bukti) |
| `modules/receivings/purchaseForm.jsx` | Dialog **Proses Pembelian** per toko: tanggal, no. nota (wajib), tabel item (qty beli + harga satuan riil + subtotal), biaya lain/ongkir & diskon terpisah, total nota riil, 2 lampiran opsional, tombol "✓ Selesaikan Pembelian" |
| `modules/receivings/purchaseLogic.js` | Logika murni: baris siap dibeli, filter, draft form, subtotal/total, validasi, klasifikasi riwayat |
| `modules/receivings/purchaseSave.js` | Simpan satu nota: header + baris barang + antrean Handover (DRAFT). Anti dobel (vendor+no. nota), pakai ulang cangkang nota dari Approval, fallback bila CHECK constraint menolak status `DIBELI` |
| `modules/receivings/attachments.js` | Lampiran bukti (foto nota / bukti transfer): batas 1 MB, perkecil via canvas bila perlu |
| `lib/purchaseNote.js` | **Kontrak catatan** (satu-satunya parser/penulis penanda `[Nominal]`, `[BiayaLain]`, `[Diskon]`, `[Nota]`, `[BuktiNota]`, `[BuktiTransfer]`, `[Tahap]`, dan `[Harga: n]` per baris item) |

**Dihapus dari Purchase** (arahan DAT): tombol *Masuk Stok Gudang*,
*Serah Terima ke Tukang*, dropdown status nota, dan pilihan Retur/Refund.
File `view.jsx` / `form.jsx` / `save.js` / `receiptForm.jsx` /
`receiptLogic.js` / `receiptSave.js` lama **dihapus** — jangan dibuat ulang.
Distribusi fisik barang = modul Handover.

**Konsekuensi simpan:** nota berstatus DIBELI (atau ditandai `[Tahap: DIBELI]`
bila kolom status dibatasi CHECK constraint) → barang hilang dari Siap Dibeli,
muncul di Riwayat, dan satu dokumen Handover `DRAFT` dibuat otomatis untuk
nota itu (rincian barang dibaca dari baris nota). Harga satuan riil per barang
menjadi acuan harga **HISTORIS** di modul Material (`modules/materials/acuan.js`
→ `receivingItemActualPrice`).

### Handover — ledger fisik per barang (t_7bc6246b)

Arah DAT: **UI fisik HANYA di Handover**; Purchase berhenti di "barang dibeli".
Rincian kontrak: `docs/receiving-events-contract.md`.

- `modules/handovers/receiptForm.jsx` — **Terima Barang** per item: satu submit
  mencatat datang / rusak / tujuan (Workshop|Tukang) / retur / foto OPSIONAL.
  Menulis lewat RPC `receipt_apply_events` (idempoten). Mode LEGACY (tabel
  belum ada) memblokir submit dengan pesan gap dan **nol tulisan**.
- `modules/handovers/confirmForm.jsx` — konfirmasi fisik per item: baris
  di-prefill dari `tujuan_tukang` dikurangi yang sudah diserahkan, lalu RPC
  `handover_confirm` (CAS `diserahkan_at IS NULL`). Mode LEGACY jatuh ke
  `confirm.js` (header saja) dengan pesan jujur.
- `modules/handovers/returnForm.jsx` — retur dari event rusak tanpa mengetik
  ulang; qty yang sudah diretur (`return_lines`) tidak ditawarkan lagi. Bila
  riwayat retur tak terbaca, modal **menolak** (anti double-cost).
- `modules/handovers/physicalModal.js` + `physicalHost.jsx` — store + host
  modal (dipakai banner antrean DAN tombol baris; tidak mengubah ctx shell).
- `modules/receivings/receiptLogic.js` / `receiptEventLogic.js` — logika murni.
  **Semantik qty wajib**: `sisa = pesanan − qty_arrived` (DATANG), BUKAN
  `quantity_received` (BELI). Lihat `COMPATIBILITY_CUTOVER.md` t_03b41644.
- `modules/receivings/receiptCapability.js` — probe READ-ONLY; UI tidak pernah
  mengklaim tersimpan untuk tabel yang belum ada.
- `modules/receivings/receiptEventSave.js` — satu-satunya jalur tulis RPC.

### Handover — display/confirm (t_b418827b)

- `modules/handovers/display.js` — logika murni: semantik bukti fisik
  (`isHandoverDelivered`), label "Rincian barang belum tersedia" untuk data
  tanpa rincian terstruktur, referensi sumber, validasi prototype per-item.
- `modules/handovers/confirm.js` — konfirmasi fisik idempoten: menulis
  `diserahkan_at` dengan compare-and-swap (`diserahkan_at IS NULL`); retry/
  re-confirm tidak menandai dua kali. Dipanggil `pages/index.js`
  (`onMarkHandoverDelivered`).
- Kontrak & gap: `docs/handover-gap-proposal.md` (tabel `handover_items`
  menunggu izin DAT — jangan packing ke note).
- Purchase (t_9109cf5e): modul Purchase **tidak lagi** punya aksi gudang /
  tukang / retur / refund (arahan DAT: Purchase berhenti di "barang dibeli").
  Nota yang selesai dibeli otomatis membuat satu dokumen Handover `DRAFT`
  (`purchaseSave.js`) sehingga barang masuk antrean distribusi fisik di sini.

### `ctx` yang disediakan shell

`ctx` dirakit di `components/ModuleView.js`. Berisi:
- `H` — helper item (`modules/shared/itemHelpers.js`): `prItemsForPr`, `vendorName`,
  `approvalItems`, `receivingItemsForReceiving`, `orderedQtyFor`, `itemReceiveStatus`,
  `itemBadgeStyle`, `receivingProgress`, `itemState`, `approvalItemRows/Lines/Qtys`,
  `requestItemRows/Lines`.
- `columns`, `page`, `title`, `rows`, semua data master (`allProjects`, `allMaterials`,
  `allVendors`, `allRequests`, `allReceivings`).
- `say`, `refresh` — umpan balik & reload setelah simpan (dipakai modal modul).
- State filter: `projectFilter/setProjectFilter`, `receivingFilter/...`, dst.
- State UI: `openNoteId/setOpenNoteId`, `expandedApproval/...`,
  `receiptRow/setReceiptRow` (form Terima Barang), `setEditRow`.
- Callback halaman: `onStatusChange`, `onReceivingStatusChange`, `onMoveToWarehouse`,
  `onSendToTukang`, `onMarkHandoverDelivered`, `onDecideApproval`, `onReviseApproval`,
  `onApproveItem`, `onFinishPr`, `onMarkPrItemOrdered`, `onDelete`, `setPage`.

**Menambah field ke `ctx` adalah perubahan KONTRAK — harus lewat Tech Lead.**

## Peta kepemilikan

| Modul / Area | Folder & file | Owner | Tabel (RLS) | Status |
|---|---|---|---|---|
| **Shell halaman** | `pages/index.js` | Tech Lead | — | 🟡 beku |
| **Shell tabel** | `components/ModuleView.js` | Tech Lead | — | 🟡 beku |
| **Shell form** | `components/CreateModal.js` | Tech Lead | — | 🟡 beku |
| **Registry** | `modules/registry.js` | Tech Lead | — | 🟡 beku |
| **Shared helpers** | `modules/shared/*` | Tech Lead | — | 🟡 beku |
| **State machine approval** | `lib/workflow.js` | Tech Lead | — | 🔴 sangat sensitif |
| **Konstanta bersama** | `lib/constants.js` | Tech Lead | — | 🟡 beku |
| Purchase Request | `modules/requests/` | _agent A_ | `purchase_requests`, `pr_items` | ✅ siap paralel |
| Approval | `modules/approvals/` | _agent B_ | `approval_steps` | ✅ siap paralel |
| Vendor | `modules/vendors/` | _agent C_ | `vendors` | ✅ siap paralel |
| Material | `modules/materials/` | _agent D_ | `materials` | ✅ siap paralel |
| Purchase (belanja) | `modules/receivings/` | _agent E_ | `receivings`, `receiving_items` | ✅ halaman sendiri (t_9109cf5e) |
| Handover | `modules/handovers/` | _agent F_ | `handovers` | ✅ siap paralel |
| Project | `modules/projects/` | _agent G_ | `projects` | ✅ siap paralel |
| Budgeting | `components/Planning.js` | _agent H_ | `project_plans` | ✅ sudah terpisah |
| RAP (Rencana Anggaran Pelaksana) | `modules/rap/` | bamboo-tech (t_71d95cfe) | — (**belum ada tabel**) | ✅ halaman sendiri, DRAFT_ONLY |
| Project Finance | `components/ProjectFinance.js` | _agent H_ | (read-only) | ✅ sudah terpisah |
| Finance & Closing | `components/Finance.js` | _agent I_ | `project_closings` | ✅ sudah terpisah |
| Upah Tukang | `components/TukangUpah.js` | _agent J_ | `tukang_*` | ✅ sudah terpisah |
| Settings | `components/Settings.js` | _agent K_ | `profiles`, `user_credentials` | ✅ sudah terpisah |

> Kolom _agent_ diisi saat penugasan paralel dibuka (setelah Fase 1 di-merge).

## Catatan penting (dari review Brooklyn)

- **Staging vs Production:** preview Vercel per branch TIDAK boleh menyentuh data
  produksi Supabase. Gunakan data mock (`/__smoke`) atau akun uji yang self-cleaning.
- **State machine approval** (`lib/workflow.js`) menyangkut hak akses & limit finansial
  (mis. approval PR > Rp 5 juta). Modul DILARANG menduplikasi atau membypass aturan ini.
- **Konsistensi UI Noir Living:** tombol aksi tabel vertikal (hindari horizontal wrap),
  master-detail untuk item PR, sanitasi angka (`Math.round` sebelum display).
- **Trigger audit lintas modul:** selalu convert record ke `jsonb` dulu — pernah ada
  kasus "record new has no field" yang memblokir SEMUA insert.

## Smoke test

`pages/__smoke.js` merender SEMUA modul (desktop + mobile + form) dengan data mock —
tanpa koneksi database. Jalankan `npm run build`; error render akan menggagalkan build.
Halaman ini berguna sebagai regression harness saat memecah modul lebih lanjut.

## Fase berikutnya (belum dikerjakan)

- **Fase 3:** pisahkan data layer per modul (`modules/<modul>/api.js`) dan
  `navSections` per manifest modul (registry sudah menyiapkan `label`, `adminOnly`).
- **Fase 4:** `git worktree` + branch `feat/<modul>/<tugas>` untuk kerja paralel penuh
  (menunggu Sprint 1 masuk main + rebase, sesuai keputusan Brooklyn).

## Riwayat Fase

- **Fase 1 (selesai):** ekstraksi `ModuleView.js` (1672→266 baris) &
  `CreateModal.js` (886→251 baris) ke `modules/<modul>/view.jsx` + `form.jsx`,
  registry, shared helpers & dispatcher. Diaudit Brooklyn; 6 temuan diperbaiki.
- **Fase 2 (selesai):** ekstraksi logika `save()` ke `modules/<modul>/save.js`
  + `shared/saveHelpers.js` + `shared/saveDispatcher.js`. Shell `CreateModal.js`
  kini 251 baris, murni state form + ctx. Diverifikasi 44 test mock (npm run test:save).

## Test

| Perintah | Fungsi |
|---|---|
| `npm run build` | Build produksi (rute /__smoke = 404) |
| `npm run smoke` | Build + render semua modul dengan data mock (ENABLE_SMOKE=1) |
| `npm run test:save` | 44 test logika save per modul (mock Supabase, tanpa DB) |
