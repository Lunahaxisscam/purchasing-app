# Laporan — t_3b877fb5 (BROOKLYN P1): Gerbang BOM RAP→PR & tolak nilai negatif sebelum normalisasi

**Branch:** `feat/ops-workflow-t_cde1b8ad` (base `097e918` + commit P0 `ce4ef3a`, `8171d0c`)
**Assignee:** bamboo-tech · **Status:** implementasi + uji selesai, **belum** push/main, **tanpa** DDL/migrasi
**Kepemilikan disentuh:** `modules/rap/{model,budgetingBridge,store,view}.js(x)`,
`scripts/rap-test/*`, `docs/rap-contract.md`, `modules/rap/README.md`, laporan ini.
**Tidak** menyentuh `modules/registry.js`, `lib/constants.js`, `pages/index.js`,
`components/ModuleView.js`, `components/Sidebar.js`, `styles/globals.css`, dan
**tidak** menyentuh komponen compare milik Bit.

---

## 1. Temuan Brooklyn yang direproduksi (sebelum perbaikan)

Pada `097e918`, `modules/rap/model.js`:

| Fixture | Perilaku lama (SALAH) |
|---|---|
| `buildPrHandoff` dengan `{item_name:'Wardrobe barang jadi', material_id:null, unit:'unit', planned_qty:1, planned_unit_price:5000000}` | `ok: true`, `pr_items` berisi **furniture jadi** → melanggar gerbang BOM eksplisit |
| `planned_unit_price: -100` | `ok: true`, `estimated_price: 0`, `validateRap().ok === true` — karena `normalizeLine` melakukan `Math.max(0, …)` **sebelum** validasi |

Akar masalah:

1. `buildPrHandoff` tidak punya konsep **jenis baris**. Setiap baris RAP dianggap
   material, jadi baris pekerjaan/barang jadi BOQ langsung menjadi `pr_items`.
2. `normalizeLine` meng-coerce: `Math.max(0, roundRupiah(plannedPrice))` dan
   `plannedPrice === null ? 0`. Nilai negatif/kosong menjadi `0` sehingga
   pemeriksaan `price < 0` / `price === null` di `validateRap` **tidak pernah
   tercapai**. Validasi berjalan pada angka yang sudah "dibersihkan".
3. `rabPriceToRupiah` juga meng-clamp (`Math.max(0, n) * 1000`), jadi payload RAB
   berharga negatif pun lolos sebagai 0.

---

## 2. Perbaikan

### 2.1 Jenis baris eksplisit, tanpa heuristik nama (`line_kind`)

```
LINE_KIND = MATERIAL | WORK_ITEM | LABOR | UNSPECIFIED
```

- Baris dari JSON RAB & BOQ → `WORK_ITEM` (pekerjaan/barang jadi).
- Baris dari WBS Budgeting → `WORK_ITEM` (pekerjaan dengan estimasi upah).
- Baris material baku **hanya** lahir dari pemilihan di master material
  (`budgetingBridge.newMaterialLine` / pemilih material di UI).
- `UNSPECIFIED` (belum ditandai) **memblokir** handoff.

Tidak ada satu baris kode yang menebak material dari `item_name`
(dijaga assertion `E14` di wiring test).

### 2.2 Gerbang BOM pada `buildPrHandoff` (fail-closed)

Baris hanya masuk PR bila **semua** benar:

| # | Syarat | Pesan bila gagal (contoh) |
|---|---|---|
| 1 | `line_kind === 'MATERIAL'` | `Baris "Wardrobe barang jadi" bertipe "Pekerjaan / barang jadi (BOQ)" — PR MATERIAL hanya menerima baris MATERIAL BAKU (BOM). Pecah … dari gambar kerja/BOM; RAP tidak memecah otomatis dan tidak menebak material dari nama barang.` |
| 2 | `material_id` ada **dan** ditemukan di katalog `materials` | `material_id "m-ghost" … tidak ditemukan di master material — tautan tidak terverifikasi.` |
| 3 | `unit` **sama** dengan satuan master | `Satuan baris "…" ("m2") BEDA dengan satuan master material ("Lembar"). Konversi satuan tidak dikarang …` |
| 4 | `planned_qty` angka > 0 | `Qty rencana "…" tidak valid ("-3") — ditolak, bukan diubah jadi 1.` |
| 5 | harga terisi, ≥ 0, bukan bukan-angka | `Harga rencana "…" negatif (-100) — DITOLAK dan TIDAK dijadikan 0.` |
| 6 | harga < ~500× `materials.harga_acuan` | `Harga "…" Rp 120.000.000 ≈ 1000× acuan master Rp 120.000 — kemungkinan SALAH SKALA (ribuan vs rupiah).` (≥ 10× → peringatan) |
| 7 | acuan RAB ada (`rab_reff`), kecuali `rab_basis='MANUAL_NO_RAB'` | `Acuan RAB yang disetujui belum ada (reff/revisi kosong) — …` |
| 8 | katalog `materials` termuat | `Katalog master material belum dimuat — material_id, satuan, dan skala harga TIDAK bisa diverifikasi.` |

**Fail-closed:** ada satu penghalang → `ok:false`, `items: []`, `request: null`.
Baris yang lolos tetap dilaporkan di `gate.verified_items` (transparansi pratinjau).

**Bukan alokasi resmi:** `meta.approval = 'NONE'`, `meta.rap_status_official =
false`, `meta.handoff_basis = 'RAP_DRAFT'`, dan `request.notes` memuat
"PRATINJAU alokasi DRAFT, BUKAN alokasi resmi/persetujuan".

Kontrak payload **tidak berubah**: `PR_REQUEST_FIELDS` dan
`PR_ITEM_PAYLOAD_FIELDS` sama persis dengan jalur `modules/requests/save.js`
(diuji G44/G45/G46). `pr_number` tetap `null`, `pr_id` tetap tidak dikarang.

### 2.3 Tolak nilai negatif/NaN **sebelum** koersi

`model.js` tidak lagi memakai `Math.max(0, …)` untuk uang/qty. Tiap field angka
menyimpan tiga hal:

```
planned_unit_price        -> angka hanya bila valid (>= 0), selain itu null
planned_unit_price_state  -> OK | ZERO | MISSING | NEGATIVE | NOT_NUMBER
planned_unit_price_raw    -> nilai mentah apa adanya ("-100" tetap "-100")
```

- `inspectNumber()` = satu-satunya pembaca nilai mentah (menolak `NaN`,
  `Infinity`, `"-100"`, `"(-100)"`, `true`).
- `validateRap` memeriksa **state**, bukan angka hasil koersi → `-100`
  menghasilkan **penghalang** ("negatif … DITOLAK, tidak dijadikan 0").
- Kosong (`''`) → `MISSING` → penghalang ("kosong BUKAN nol").
- `0` yang **diketik manusia** tetap `0`, boleh lanjut, tetapi ditandai
  "belum lengkap" (peringatan) dan item PR ditandai belum lengkap.
- `rabPriceToRupiah(-500)` → `null` (dulu `0`); bridge **menolak** baris RAB
  berharga negatif dengan alasan, bukan menolkannya.
- `store.changeStatus` **menggerbang** `DIAJUKAN`/`DISETUJUI` lewat
  `validateRap` dan selalu mengembalikan `official:false, persisted:false`.

### 2.4 Label sumber acuan (tidak ada klaim "apel-vs-apel")

`describeRabBaseline(rap)` → `{ kind, label, note, comparable_with_rap_cost:
false, verified_source, reff, revision, bases }`:

| kind | Sumber | Label |
|---|---|---|
| `RAB_SELL_PRICE` | JSON RAB & BOQ | "HARGA JUAL RAB & BOQ (penawaran)" |
| `WBS_LABOR_ONLY` | `project_plans.labor_cost` | "WBS Budgeting — UPAH saja" |
| `MANUAL` | diisi manual | "Manual (tanpa acuan RAB)" |
| `MIXED` | campuran | "Campuran / sumber tidak seragam" |
| `NONE` | tak ada harga acuan | "Tidak ada acuan" (selisih TIDAK DIKETAHUI) |

`comparable_with_rap_cost` **selalu false** (belum ada acuan biaya terverifikasi
di aplikasi). Label tampil di: kartu KPI, panel perbandingan, peringatan
over-budget, dan catatan payload PR. Peringatan over-budget kini berbunyi
"MELEBIHI <label sumber> …" + "margin habis/negatif", bukan klaim perbandingan
biaya.

### 2.5 UI (`view.jsx`)

- Kolom **Jenis baris** per baris (select) — penandaan dilakukan manusia.
- Baris `MATERIAL` memakai **pemilih master material** (bukan input nama bebas);
  nama/kode/satuan mengikuti master.
- Tombol "+ Baris material (BOM)" dan "+ Baris manual" terpisah.
- Input harga/qty menampilkan **nilai mentah** (`-100` tetap `-100`) + hint
  "ditolak: -100 (negatif)".
- Panel "Pratinjau payload PR material": label "PRATINJAU — BUKAN alokasi resmi,
  0 tulisan DB", penghitung `dipilih/terverifikasi/ditolak/katalog`, daftar
  alasan penolakan, `meta.approval = TIDAK ADA (draft)`.
- Banner "Draft saja — belum tersimpan di server" dipertahankan; status diberi
  label "Label kerja LOKAL — bukan persetujuan resmi".
- Katalog material dibaca **satu** `select` (`loadMaterialsCatalog`), gagal baca
  ditampilkan apa adanya (bukan "belum ada material").

---

## 3. Uji (semua dijalankan di sandbox /tmp/rap-verify + repo, tanpa DB)

| Suite | Assertion | Hasil |
|---|---|---|
| `unit_test.mjs` | **214** | **0 gagal** |
| `render_test.mjs` (jsdom, komponen asli) | **107** | **0 gagal** |
| `wiring_test.mjs` (statis, kontrak nol-tulis) | **50** | **0 gagal** |
| `e2e_runtime_test.mjs` (Chrome nyata, `/__smoke`) | **50** | **0 gagal** |
| `next build` (`ENABLE_SMOKE=1`) | — | hijau |

### Fixture negatif wajib (persis dari laporan Brooklyn)

| Fixture | Hasil sekarang | Assertion |
|---|---|---|
| `{item_name:'Wardrobe barang jadi', material_id:null, unit:'unit', planned_qty:1, planned_unit_price:5000000}` | `ok:false`, `items: []`, alasan "bukan MATERIAL BAKU" + langkah perbaikan | G1–G6, E3 |
| `planned_unit_price: -100` | `ok:false`, `items: []`, `validateRap.ok === false`, state `NEGATIVE`, raw `-100` dipertahankan | G7–G10, E10–E15, 3b1–3b5 |
| Satuan baris ≠ master | DITOLAK | G23/G24, G15 |
| Harga ≈ 1000× `harga_acuan` | DITOLAK ("SALAH SKALA"); 10× → peringatan | G25–G27, G16 |
| Tanpa acuan RAB (`rab_reff` kosong) | DITOLAK; `MANUAL_NO_RAB` → boleh + peringatan jujur | G28/G29, G2a/G2b |
| Baris material BOM **benar** (positif) | **DITERIMA**: 1 item, `material_id`/`kode`/`unit` dari master | G11–G22, G4–G12 |
| Katalog belum dimuat | DITOLAK (tanpa verifikasi) | G30/G31 |

### Bukti "tidak ada tulisan DB"

- `wiring_test` E1–E4: tidak ada `.insert(`, `.update(`, `.delete(`, `.rpc(`
  di keempat file modul; E9: tidak ada `from('rap…')`.
- `render_test` E15, G13: `mock.__ops` **nol** operasi tulis saat pratinjau PR.
- `e2e` 4g: **nol** request mutasi Supabase selama alur browser nyata.
- `store.writes` selalu kosong (unit K4/K8/K12).

---

## 4. Regresi suite lain (dijalankan, tidak ada yang saya perbaiki)

`scripts/sales-invoice-test/run_regression.py`: **12 suite hijau, 1 merah**.

| Suite | Status |
|---|---|
| sales-invoice-test, rap-test, handover-compact, handover-flow, purchase-flow, pr-purchase-compact, pr-estimator, pr-group, approval-queue, fase2-save, showmore-list, material-acuan | GREEN |
| **rab-boq-test** | RED — `E7 exclude dari tombol refresh global` |

**Analisis jujur status merah (bukan regresi saya):**

- `rab-boq-test` E7 mencari literal `"'rab_boq', 'settings']"` di
  `pages/index.js`. String itu **sudah tidak ada di base `097e918`**
  (`git show 097e918:pages/index.js | grep -c "'rab_boq', 'settings']"` = **0**);
  array-nya kini `[..., 'rab_boq', 'sales_invoice', 'rap', 'settings']` karena
  RAP & Sales Invoice disisipkan sebelum `settings`. Assertion-nya **stale**,
  bukan akibat perubahan saya (saya tidak menyentuh `pages/index.js`).
- `rab-boq-render-test` F1/F2 (`font-weight >= 800`, `var(--ivory)` pada heading
  sidebar) juga merah karena perubahan `styles/globals.css`/`Sidebar.js` di luar
  kepemilikan saya — file itu tidak ada di diff saya.

Keduanya **tidak** saya ubah karena di luar kepemilikan modul RAP dan perbaikan
literal assertion milik pemilik suite RAB & BOQ.

---

## 5. Batas yang dijaga (eksplisit)

- **Tanpa DDL/migrasi**, tanpa tabel baru, tanpa RPC.
- **Tanpa tulisan DB** dari modul RAP (semua baca-saja: `project_plans`,
  `materials`).
- **Tanpa push / tanpa merge ke main.**
- **Tidak** menyentuh komponen compare milik Bit, `pages/index.js`,
  `lib/constants.js`, `modules/registry.js`, `components/ModuleView.js`.
- Kontrak API `buildPrHandoff` **kompatibel ke belakang pada bentuk payload**;
  satu perubahan kontrak yang disengaja: pemanggil **wajib** mengirim
  `{ materials }` (katalog) — tanpa itu handoff DITOLAK. Ini perubahan yang
  diinginkan (fail-closed) dan sudah diumumkan di `docs/rap-contract.md` §7b
  untuk integrator.

## 6. Yang MASIH terbuka (bukan klaim selesai)

1. Belum ada tabel `rap_versions` → RAP tetap `DRAFT_ONLY`; "Disetujui" hanya
   label lokal. Approval resmi butuh skema + RPC (izin DAT).
2. Pemetaan BOM (pekerjaan → material baku) masih **manual** oleh user; belum ada
   impor BOM/gambar kerja. Itu keputusan produk, bukan tebakan otomatis.
3. Acuan **biaya** terverifikasi belum ada di aplikasi, sehingga
   `comparable_with_rap_cost` selalu `false` (disengaja).
4. Integrasi branch & staging adalah tugas `t_35cd0354` (integrator), bukan
   kartu ini.
