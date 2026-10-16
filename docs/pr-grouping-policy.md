# Pengelompokan Item per Kategori Material — PR & Approval (t_48f6b336)

> Status: SIAP REVIEW — bit-dev, 17 Okt 2026.
> Arahan DAT (screenshot PR-007): "kelompokkan item barang dalam setiap PR
> menurut kategori; berlaku juga modul Approval."

## 1. Sumber kategori — SATU aturan, tanpa tebakan

Kategori item **selalu** dari **master material via `pr_items.material_id`**:

```
pr_items.material_id  →  materials.category   (relasi tersimpan di DB)
```

- **BUKAN** `vendor.supplier_category` (vendor tidak menentukan kategori material).
- **BUKAN** tebakan nama/prefix (nama item & kode tetap nama saja).
- Tanpa `material_id`, material hilang dari master, atau kategori kosong →
  grup **"Belum Berkategori"** (jujur — tidak mengarang kategori dari nama).
- Data legacy (PR tanpa rincian `pr_items`, fallback ringkasan teks) tidak
  punya relasi → seluruhnya masuk "Belum Berkategori".

Nama kategori tampil **apa adanya** dari master (Plywood & Board, HPL & Edging,
Hardware & Fitting, Bahan Habis Pakai, WPC & Panel, Kelistrikan & Lampu,
Aluminium & Profil, dan kategori master lain yang ada di DB) — tidak ada
hardcode daftar kategori di kode UI.

## 2. Bentuk tampilan

### Desktop — daftar PR (`modules/requests/view.jsx`)
- Master-detail rowSpan dipertahankan. Setiap **item = 1 baris fisik**
  (Qty · Item · Vendor · Estimasi sejajar — tidak drift saat wrap).
- Baris **heading kategori** disisipkan sebagai pemisah grup: tampil SEKALI
  di awal grup, `colSpan` di area item (Qty+Item+Vendor+Estimasi). Baris
  heading memakai kelas `pr-group-row` + `pr-group-cell`/`pr-group-label`.
- Sel parent (Prioritas, No.PR+catatan+tanggal, Project, Judul Kebutuhan,
  Status, Aksi) tetap **satu dokumen** — rowSpan mencakup heading + item +
  baris Total Estimasi. Tidak ada PR terpisah, tidak ada perubahan nomor/
  status/alur.
- Baris **Total Estimasi** (t_ac0b39c0) tetap SATU di bawah item terakhir,
  nilai snapshot tersimpan — **tidak berubah karena pengelompokan**.
- **Geometri baris total** (verifikasi run 93): kolom parent rowSpan menutup
  kolom kiri (0..3) & kanan (Status+Aksi) baris ini, jadi label `colSpan=3`
  (Qty..Vendor) + nilai (kolom Estimasi Harga, sejajar subtotal item) SUDAH
  menutup grid 10 kolom. Filler `<td colSpan={2}>` lama di ujung kanan
  (sisa t_ac0b39c0) menciptakan 2 kolom hantu — strip kosong terlihat di
  kanan kolom Aksi (grid 12 vs header 10) — dihapus & dijaga test grid
  (`scripts/pr-group-test/grid_audit.mjs`, dijalankan di render_test untuk
  PR multi-kategori/1 kategori/legacy, batch Show More 12 PR, & Approval).

### Desktop — Approval (`modules/approvals/view.jsx`)
- **Baru: master-detail row-per-child.** Sebelumnya kolom Items (nama) dan QTY
  adalah dua kolom terpisah yang saling meleset saat teks wrap; kini
  nama + qty berada di baris fisik yang sama, dengan heading kategori
  sebagai pemisah grup (sumber kategori & urutan sama persis dengan PR).
- Kolom lain (No.PR, Project, Judul, Step, Status, Catatan, Waktu Putusan,
  Aksi) tetap satu dokumen (rowSpan). **Kolom Aksi ikut rowSpan** (verifikasi
  geometri run 93) — tanpa itu kolom Aksi hanya menutup baris pertama dan
  baris item menyisakan lubang grid.
- **Panel perluasan material** (tombol "▼ Material") kini menampilkan tabel
  per grup kategori (blok `.ap-group-block` dengan heading + subtotal
  kategori). Markup per item (Kode, Nama, Qty, Satuan, Subtotal, Status, Aksi
  — tombol ✓ Setujui / 🛒 Sudah Order) tidak berubah.
- **Subtotal kategori** hanya muncul bila ada nominal valid dari snapshot
  (`estimated_price × qty` per item; item tanpa harga di-skip — bukan dianggap
  0). Tidak pernah menjumlah qty dengan satuan berbeda. Total Estimasi PR
  tetap SATU di akhir panel dan tidak berubah.
- **Baris Total Estimasi desktop** (verifikasi geometri run 93): label
  `colSpan = itemAreaSpan-1` (kolom Item SAJA) + nilai di **kolom Qty**
  (sejajar dgn qty item) — parent Step/Status/Catatan/Waktu/Aksi sudah
  menutup kolom kanan via rowSpan, jadi label tidak boleh melebar ke sana.
  Versi awal (label colSpan area-item + 2 & filler colSpan 2) menggeser nilai
  ke kolom Aksi + menciptakan 2 kolom hantu di ujung kanan (grid 12 vs
  header 10) — sudah diperbaiki & dijaga test grid.
- Approval legacy tanpa rincian `pr_items` → satu baris dash (perilaku lama).

### Mobile (PR & Approval)
- Kartu mobile mengelompokkan item di dalam `.mobile-items-box` dengan
  `.mobile-group-label` per kategori (label sama, pemisah visual berbeda).
- Per item tetap: nama — qty · vendor · subtotal/belum ada harga.
- Kartu mobile Approval kini juga menampilkan **Total Estimasi** (sebelumnya
  belum ada) — snapshot, read-only, label "belum lengkap" bila ada item tanpa
  harga. Tombol aksi tidak berubah.

## 3. Urutan (ordering) — stabil & deterministik

- Urutan grup = **kemunculan pertama** kategori dalam urutan item asli
  (`pr_items` datang terurut `sort_order` dari `loadAll`).
- Urutan item **di dalam grup** = urutan asli (stabil, tidak di-sort ulang).
- Kategori "Belum Berkategori" muncul di posisi sesuai item pertamanya (bukan
  dipaksa ke akhir) — jujur terhadap urutan input.

## 4. Yang TIDAK diubah (jaga-jaga)

- Tidak ada perubahan DB/schema/migrasi/master data/kategorisasi tersimpan.
- Tidak ada perubahan alur approval, nomor PR, status, langkah, tombol.
- Tidak ada perubahan form PR / save boundary (`modules/requests/form.jsx`,
  `save.js` tidak disentuh).
- `Show More` tetap menghitung **parent PR** (bukan heading/grup/item): limit
  10 PR tetap memotong di batas dokumen PR.
- Filter antrean Approval default tetap "⏳ Menunggu" (t_0a35264f).
- Aturan catatan approval (t_1fe52e80) tidak tersentuh.

## 5. File yang diubah

| File | Perubahan |
|---|---|
| `modules/requests/view.jsx` | Helper grouping (`UNCATEGORIZED_LABEL`, `groupItemsByCategory`, `groupHeadingText`, `materialMapFrom`, `attachMaterialIds`), `desktopRow` + grup, `mobileCard` + grup |
| `modules/approvals/view.jsx` | `desktopRow` master-detail baru (row-per-child + grup), panel perluasan per grup + subtotal kategori, `mobileCard` + grup + Total Estimasi |
| `styles/globals.css` | Append-only: `.pr-group-row`, `.pr-group-cell`, `.pr-group-label`, `.ap-item-name`, `.ap-group-block`, `.ap-group-heading`, `.mobile-item-group`, `.mobile-group-label` |
| `scripts/showmore-list-test/render_test.mjs` | Penyesuaian kontrak fisik (2 assertion): heading kategori menambah baris fisik dalam PR; Show More tetap per parent |
| `scripts/approval-queue-test/render_test.mjs` | Penyesuaian hitungan baris → hitungan PR unik (rowSpan parent / baris legacy) |
| `scripts/pr-group-test/*` | Harness baru: unit (31) + render jsdom (54, termasuk penjaga geometri grid `grid_audit.mjs`) + isolated build |

## 6. Verifikasi

- `python3 scripts/pr-group-test/run.py` → **85/85** (unit 31 + render 54,
  termasuk penjaga geometri grid)
- Verifikasi geometri NYATA (run 93): algoritma slot tabel diukur di Chrome
  sungguhan (CDP, viewport 1440px) pada build sandbox — sebelum perbaikan:
  grid 12 vs header 10 (2 kolom hantu) di PR & Approval + nilai Total
  Estimasi Approval jatuh di kolom Aksi + kolom Aksi approval tanpa rowSpan;
  setelah perbaikan: grid 10/10 seimbang di semua baris, nilai total di
  kolom yang benar (PR: Estimasi Harga; Approval: Qty), Aksi ikut rowSpan,
  tanpa overflow kanan (dicek rect per sel + screenshot).
- Regresi: pr-estimator 108/108, showmore 49/49, approval-queue 56/56,
  material-acuan 93/93, fase2-save 54/54, vendors-toolbar 25/25,
  receipt-flow 66/66, flow-logic 29/29, handover-flow 51/51
- Isolated build OK — BUILD_ID `BwZ34ebkedDP2lLbFBZOb`; `.next` aktif
  **tidak berubah** (live build terkoordinasi, tidak ditimpa saat worker
  lain berjalan).

## 7. Batasan yang diketahui (jujur)

- Kategori mengikuti `material_id` yang tersimpan saat PR dibuat/diedit. PR
  lama yang itemnya tidak punya `material_id` tampil di "Belum Berkategori"
  sampai PR diedit (memilih ulang item) — tidak ada backfill otomatis (DB
  tidak disentuh).
- Nama item yang sama di dua kategori berbeda muncul di dua grup — itu benar
  sesuai relasi material masing-masing.
- Subtotal kategori disembunyikan bila tidak ada satu pun harga valid di grup
  (tidak pernah menampilkan 0 palsu).
