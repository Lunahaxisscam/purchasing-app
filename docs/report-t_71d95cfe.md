# Laporan Eksekusi — t_71d95cfe (S3/7)

**Card:** [S3/7] Implementasikan RAP internal versi minimum
**Owner:** bamboo-tech · **Tanggal:** 18 Okt 2026
**Branch:** `feat/ops-workflow-t_cde1b8ad` (base: `main` @ `18fb594`)
**Kontrak & keputusan:** `docs/rap-contract.md`

---

## 1. Hasil dalam satu paragraf

Modul **RAP (Rencana Anggaran Pelaksana)** versi minimum sudah jadi dan **bisa
dibuka** sebagai halaman Admin Suite (`RAP (Rencana Pelaksanaan)`, tepat setelah
Budgeting). Alur yang benar-benar jalan: pilih proyek → buat draft dari acuan
RAB (tempel **JSON RAB & BOQ**, atau tarik baris **WBS Budgeting** yang hanya
berisi upah dan dinyatakan begitu di layar) → edit qty & harga satuan
**rencana** → label versi (`RAP-01`, `RAP-02`, …) + status eksplisit
(Draft→Diajukan→Disetujui/Ditolak→Digantikan) → **perbandingan RAB vs RAP**
per baris + total + daftar pekerjaan RAB yang belum masuk RAP → pemeriksaan
draft (penghalang vs peringatan) → **payload handoff PR** yang bentuknya sama
dengan jalur simpan PR existing (nomor PR tidak dikarang, `pr_id` tidak
dikarang, nol penulisan) → backup/pulihkan JSON. Modul **tidak menulis apa pun
ke database**: tidak ada tabel, RPC, maupun migrasi — karena itu mode
**DRAFT_ONLY eksplisit** dengan banner permanen "belum tersimpan di server",
bukan fake persistence. Verifikasi: **115 assertion unit + 66 render jsdom
interaktif + 44 wiring/kontrak + 40 e2e Chrome nyata** (4 viewport, nol
overflow, nol request mutasi), build `smoke` hijau, dan **12 harness regresi
lama hijau**.

---

## 2. Yang dikerjakan (per file)

### `modules/rap/model.js` (baru, logika murni — bebas React & Supabase)
- Konversi harga RAB **ribuan → rupiah penuh** di SATU tempat
  (`rabPriceToRupiah`), klem ≥ 0, non-angka → 0 (bukan NaN).
- `parseNumberInput` menolak minus/parenthesis eksplisit; menerima
  `1.500.000` dan `2,5`.
- Baris kanonik dengan **dua set angka**: `rab_qty`/`rab_unit_price` (acuan)
  dan `planned_qty`/`planned_unit_price` (rencana) + `price_source` jujur
  (`RAB`, `RAB_TANPA_HARGA`, `WBS_UPAH`, `WBS_TANPA_UPAH`, `MANUAL`).
- `rapTotals` memakai **snapshot** `rap.rab_lines` sebagai acuan, sehingga
  menghapus baris RAP **tidak** mengecilkan "nilai RAB" (selisih tidak bisa
  tampak lebih kecil dari kenyataan). Tanpa acuan: `diffPct = null`,
  `overBudget = false` — bukan Infinity/NaN, dan bukan klaim "lebih".
- `compareRapToRab`: per baris (`OVER`/`UNDER`/`SAME`), `missingInRap`
  (pekerjaan terlewat), `extraInRap` (lingkup tambahan), ringkasan total.
- `validateRap`: **penghalang** (proyek kosong, versi kosong, qty ≤ 0, baris
  dobel, tanpa baris) vs **peringatan** (harga 0, harga RAB tidak tersedia,
  total melebihi RAB). Baris dobel ditolak supaya tidak dobel hitung.
- `setRapStatus` + tabel transisi eksplisit; transisi terlarang (mis.
  `DRAFT → DISETUJUI`) ditolak dengan alasan terbaca; riwayat mencatat pelaku.
- `buildPrHandoff`: payload `purchase_requests` + `pr_items` sesuai kontrak
  `modules/requests/save.js`; `pr_number: null`, tanpa `pr_id`,
  `meta.writes = 0`, `meta.delivered = false`. Qty ≤ 0 **ditolak** (tidak
  dipaksa jadi 1 seperti shortcut Budgeting lama).
- `rapToSnapshot`/`rapFromSnapshot`: backup JSON manual; hasil pulih SELALU
  kembali `persisted: false` walau berkasnya mengaku `persisted: true`.

### `modules/rap/budgetingBridge.js` (baru — jembatan BACA-SAJA)
- `rabLinesFromBoqPayload`: payload RAB & BOQ v5 (+ legacy v1) → baris acuan;
  versi tak dikenal / tanpa `items` **ditolak** dengan alasan, tidak ditebak.
- `rabLinesFromWbsPlans`: `project_plans` (WBS) → baris acuan dengan
  `price_source: 'WBS_UPAH'` + peringatan eksplisit bahwa angkanya **hanya
  upah, bukan nilai kontrak penuh** (dan `WBS_TANPA_UPAH` untuk upah 0).
- `loadWbsPlans`: satu `select` tanpa rpc/insert/update; **error tidak
  diubah menjadi array kosong** yang menyamar sebagai "proyek belum punya WBS".
- `RAP_CAPABILITY`: `persistence: 'DRAFT_ONLY'`, `table: null`,
  `canSave: false`, alasan "migrasi dibekukan" — dipakai UI supaya tidak bisa
  "lupa" menyebutnya.

### `modules/rap/store.js` (baru)
Store sesi `DRAFT_ONLY` (draft, versi otomatis, transisi status, validasi,
`upsertSnapshot`) + jejak `writes` yang **harus selalu kosong**.

### `modules/rap/view.jsx` (baru — halaman)
Banner kejujuran permanen, toolbar proyek/versi/status, panel sumber acuan
(JSON RAB / WBS), 4 kartu ringkasan (acuan RAB, rencana RAP, selisih, baris
perlu perhatian), tabel baris dengan qty & harga rencana editable, panel
pemeriksaan, panel perbandingan + daftar baris RAB yang belum tercakup, panel
handoff PR (payload JSON ditampilkan), panel backup/pulihkan. Styled-jsx
ter-scope (tanpa override global).

### `modules/rap/README.md`, `docs/rap-contract.md`, `docs/report-t_71d95cfe.md` (baru)
Ringkasan modul, kontrak lengkap (model data, satuan, aturan perbandingan,
state machine, kontrak handoff PR, wiring, usulan skema `rap_versions` yang
**belum dijalankan**), dan laporan ini.

### Wiring ke shell (file CORE — dinyatakan eksplisit)
- `lib/constants.js`: item `['rap', 'RAP (Rencana Pelaksanaan)']` di Admin
  Suite **tepat setelah Budgeting** (RAP membaca WBS dari sana) + `labels.rap`.
- `modules/registry.js`: entri `id: 'rap'`, `adminOnly: true`,
  `source: 'core'`, `files` kepemilikan modul.
- `pages/index.js`: import `RapModule`, cabang render `page === 'rap'` dengan
  guard `role === 'admin'` + fallback "Halaman ini khusus administrator"
  (pola RAB & BOQ), dan `'rap'` dikecualikan dari tombol `↻ Perbarui` global.
- `pages/__smoke.js`: section `#mod-rap` supaya build smoke ikut merender
  modul (error render tertangkap saat build).
- `docs/owners.md`: baris kepemilikan modul RAP.

### `scripts/rap-test/` (baru)
`run.py` (sandbox `/tmp/rap-verify`, salin verbatim, SWC, mock Supabase
perekam), `unit_test.mjs` (115), `render_test.mjs` (66, jsdom interaktif),
`wiring_test.mjs` (44, statis), `e2e_runtime_test.mjs` (40, Chrome CDP),
`mock-supabaseClient.mjs`.

---

## 3. Keputusan yang perlu diketahui reviewer

1. **Tidak ada persistence, dan itu dinyatakan di 4 tempat** (banner UI,
   `RAP_CAPABILITY`, `persisted/persistence` pada dokumen, `store.mode`).
   Alternatif "simpan ke localStorage" sengaja **ditolak**: itu akan membuat
   aplikasi mengaku menyimpan padahal tidak.
2. **Acuan RAB disimpan sebagai snapshot terpisah** (`rab_lines`) — bukan
   dihitung ulang dari baris RAP yang sedang diedit. Tanpa ini, menghapus satu
   baris RAP akan "menghapus" nilai RAB juga dan menyembunyikan selisih nyata.
3. **Perbandingan memakai nilai dasar baris (qty × harga satuan), bukan grand
   total quotation RAB.** Grand total sudah kena markup/PPN (harga jual),
   sedangkan RAP adalah biaya pelaksanaan — membandingkannya akan apel-vs-jeruk.
4. **WBS Budgeting hanya berisi upah** (kolom `labor_cost`), tidak ada harga
   material. Modul tidak menambal angka itu; ia memberi label
   `acuan WBS (upah saja)` + peringatan. Total acuan dari WBS **bukan** nilai
   kontrak penuh.
5. **Qty invalid di handoff PR ditolak**, bukan dipaksa 1. Shortcut Budgeting
   lama (`components/Planning.js`) memaksa 1 supaya PR tidak qty 0 — di RAP
   angka rencana adalah kontrak, jadi memaksa angka akan menyembunyikan salah
   input.
6. **RAB & BOQ tidak punya ID baris**, jadi pencocokan memakai
   `nama pekerjaan + satuan`. Nama/satuan berbeda = baris berbeda (muncul
   sebagai "hilang"/"tambahan" untuk diperiksa manusia), bukan ditebak.
7. **`components/Planning.js` tidak disentuh.** Kartu mengizinkan "existing
   Budgeting integration points you can isolate"; yang dipakai hanya **baca**
   `project_plans` lewat klien sesi (RLS admin).
8. **Wiring di file CORE dikerjakan, bukan diserahkan sebagai TODO.** Tanpa
   wiring, modul tidak bisa dibuka sama sekali sehingga tidak ada nilainya.
   Empat file CORE berubah dan itu dinyatakan di sini + di kontrak §8, dengan
   assertion kepemilikan `pr-purchase-compact-test` **diperluas keempat file
   itu** (bukan dilonggarkan untuk file modul S1/S2).

---

## 4. Bukti verifikasi

| Harness | Assertion | Hasil |
|---|---|---|
| `python3 scripts/rap-test/run.py` → unit | 115 | **0 gagal** |
| `python3 scripts/rap-test/run.py` → render (jsdom interaktif) | 66 | **0 gagal** |
| `python3 scripts/rap-test/run.py` → wiring/kontrak | 44 | **0 gagal** |
| `node scripts/rap-test/e2e_runtime_test.mjs http://127.0.0.1:3311` (Chrome CDP, `/__smoke` → `#mod-rap`) | 40 | **0 gagal** |
| `npm run smoke` (`ENABLE_SMOKE=1 next build`) | — | hijau |
| `handover-flow-test` | logic 61 + queue 66 + render 73 | hijau |
| `handover-compact-test` | 87 + 52 | hijau |
| `purchase-flow-test` | 178 + 90 | hijau |
| `pr-purchase-compact-test` | 20 + 130 | hijau |
| `pr-estimator-test` | 48 + 47 + 14 | hijau |
| `pr-group-test` | 31 + 54 | hijau |
| `showmore-list-test` | 49 | hijau |
| `fase2-save-test` | 56 | hijau |
| `approval-queue-test` | 56 | hijau |
| `sales-invoice-test` | 34 | hijau |
| `material-acuan-test` | — | hijau |
| `rab-boq-test` | 19/20 | **1 gagal — PRE-EXISTING**, lihat §5 |
| `ui-olive-tokens-test` | 34/35 | **1 gagal — PRE-EXISTING**, lihat §5 |

E2E Chrome membuktikan hal yang jsdom tidak bisa: modul benar-benar ter-render
di dalam aplikasi (`#mod-rap`), banner terlihat, tombol punya tinggi klik
layak, dan **tidak ada overflow horizontal di 360 / 390 / 768 / 1440**.
Ditemukan & diperbaiki satu defect nyata di tengah jalan: `<pre>` payload JSON
melebarkan halaman sampai **1101px di layar 360px** — diperbaiki dengan
`min-width: 0` pada grid item + `max-width: 100%` pada `<pre>`, lalu diukur
ulang di 4 viewport.

---

## 5. Temuan di luar scope (jujur, tidak diperbaiki)

1. **`scripts/rab-boq-test` E7 gagal — PRE-EXISTING.** Assertion mencari string
   `"'rab_boq', 'settings']"` di `pages/index.js`, padahal commit `18fb594`
   (Sales Invoice) sudah menyisipkan `'sales_invoice'` sehingga menjadi
   `'rab_boq', 'sales_invoice', 'settings']`. Gagal **sebelum** kartu ini
   menyentuh file tersebut. Perbaikan satu baris assertion itu milik pemilik
   modul; saya tidak melonggarkannya diam-diam.
2. **`scripts/ui-olive-tokens-test` gagal karena `font-weight: 750`** di
   `styles/globals.css` (2 kemunculan, sudah ada di `main` — `git show
   main:styles/globals.css` membuktikan keduanya). Tidak ada hubungannya dengan
   RAP (modul RAP memakai `font-weight: 700/800`).
3. **Belum ada tabel RAP** → tidak ada riwayat lintas sesi, tidak ada
   persetujuan yang mengikat, tidak ada audit trail server. Usulan skema
   `rap_versions` (aditif, RLS admin-only) ada di kontrak §9, **belum
   dijalankan**, dan masih menyisakan 3 pertanyaan desain sebelum aman.
4. **RAB & BOQ tidak menyimpan payload ke server** (client-only, lihat
   `modules/rab-boq/README.md`), jadi RAP hanya bisa menerima JSON yang
   ditempel/diimpor manual. Tidak ada jalur otomatis RAB → RAP.
5. **RAP belum mengirim apa pun ke PR.** Handoff masih berupa payload yang
   ditampilkan; penulisan tetap di modul Purchase Request. Menautkan langsung
   berarti menulis ke `purchase_requests`/`pr_items` dari modul lain — di luar
   batas kartu ("only existing Budgeting integration points you can isolate").

---

## 6. Tidak disentuh

`migrations/` (nol file baru/berubah), `modules/requests/*`,
`modules/receivings/*`, `modules/handovers/*`, `modules/materials/*`,
`modules/vendors/*`, `modules/projects/*`, `modules/rab-boq/*`,
`modules/sales-invoice/*`, `modules/shared/*`, `components/*` (termasuk
`components/Planning.js`), `lib/workflow.js`, `lib/purchaseNote.js`,
`lib/telegramAlert.js`, `styles/globals.css`, `package.json`.

Satu assertion di `scripts/pr-purchase-compact-test/render_test.mjs` diubah
(daftar file yang diizinkan berubah diperluas ke 4 file CORE wiring) — perubahan
itu **memperketat** makna: file modul S1/S2 tetap terkunci seperti sebelumnya.
