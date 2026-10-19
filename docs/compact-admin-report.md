# Compact Admin Suite — Finance & seluruh Admin Suite fit layar

Task: `t_b6ff3dc1` · Workspace: `/home/ubuntu/dev-workspaces/purchasing-compact-admin`
Branch: `feat/compact-admin-20261019` · Baseline: `fe9862c`

---

## 1. Ringkasan

Semua modul Admin Suite (Dashboard, RAB & BOQ, Invoice Penjualan, Stok Workshop,
Customer CRM, Actual Labor & Stok, Marketing, Budgeting, RAP, Perbandingan
RAB/RAP/Aktual, Project Finance, Finance, Upah Tukang, Settings) sekarang memakai
**lapisan compact** yang membuat tabel, toolbar, form, dan kartu **muat di
container** tanpa scroller horizontal — bukan dengan menyembunyikan luapan.

Tidak ada perubahan pada formula, model, store, save, auth, SQL, output PDF,
format nomor, budget limit, maupun capability read-only.

---

## 2. Berkas yang berubah

| Berkas | Jenis | Isi |
|---|---|---|
| `components/compact-admin.module.css` | **baru** | CSS module (scoped `.root`) — satu-satunya sumber gaya compact |
| `components/CompactRoot.js` | **baru** | wrapper presentasi + penanda tabel (`data-label`, `data-stack`, `data-compact`) |
| `components/Dashboard.js` | edit kecil | bungkus root + `CompactRoot` |
| `components/Finance.js` | edit kecil | bungkus root |
| `components/Planning.js` | edit kecil | bungkus root + select proyek `width:100%` (dari `minWidth:280px`) |
| `components/ProjectFinance.js` | edit kecil | bungkus root + select proyek `width:100%` |
| `components/TukangUpah.js` | edit kecil | bungkus root + select tukang `width:100%` |
| `components/Settings.js` | edit kecil | bungkus root |
| `modules/{stock,crm,marketing,labor-stock,rap-compare,sales-invoice,rap,rab-boq}/view.jsx` | edit kecil | bungkus root; `rap` & `sales-invoice` juga menghapus `overflow-x:auto` lokal di wadah tabel |
| `scripts/compact-admin-test/*` | **baru** | harness (lihat §5) |
| `scripts/{stock-view,crm,labor-stock,rap,rap-compare,sales-invoice,sales-invoice-payment,growth-kpi,marketing,fn-repro,planning-budget}-test/run*.py` | edit mekanis | adapter sandbox (lihat §5.3) |

**Tidak disentuh:** `styles/globals.css`, `pages/*`, `components/Sidebar.js`,
`components/ModuleView.js`, `components/CreateModal.js`, `lib/*`,
`modules/registry.js`, seluruh folder ops/daemon, dan file PDF/export.

### Diff fungsional (bukan presentasi)

Hanya tiga baris berikut yang mengubah nilai selain pembungkusan root:

```
components/Planning.js:685        minWidth: '280px'  ->  width: '100%', maxWidth: '360px'
components/ProjectFinance.js:195  minWidth: '280px'  ->  width: '100%', maxWidth: '360px'
components/TukangUpah.js:239      minWidth: '280px'  ->  width: '100%', maxWidth: '360px'
```

Ketiganya adalah **inline style lebar select**, bukan logika. Tidak ada
statement fungsional (fetch/save/hitung) yang berubah — seluruh diff di file
logic hanya `<>` → `<CompactRoot>` dan `</>` → `</CompactRoot>` plus satu baris
`import`.

---

## 3. Cara kerja lapisan compact

1. **`CompactRoot`** membungkus root tiap modul, menambahkan kelas scope CSS
   module, lalu (di `useEffect` + `MutationObserver`) menandai setiap `<table>`:
   - `data-stack="1"|"wide"` → pemicu mode stacked berlabel;
   - `data-compact` → penanda tabel boleh dinormalkan lebar kolomnya;
   - `data-col-narrow` / `data-col-actions` → kolom "No"/aksi proporsional;
   - `td[data-label]` = judul kolom asli (dibaca dari `<thead>`), termasuk
     penggabungan untuk `colspan` di baris TOTAL;
   - `td[data-num]` untuk sel moneter (rata kanan + tabular-nums);
   - `td[data-empty]` untuk sel pengisi kosong (tidak dirender saat stacked).

   Dekorasi ini **hanya menambah atribut**: teks, angka, urutan, dan tombol
   tidak berubah. Diuji idempoten (`innerHTML` identik sebelum/sesudah).

2. **CSS module** menetralkan aturan globals yang memaksa scroll:
   - `.table { overflow-x: auto !important }` → `overflow: visible !important`
     (selector `.root.root` agar menang tanpa bergantung urutan bundel);
   - `table.requests-table { min-width: 1250px !important }` →
     `.root.root table { min-width: 0 !important; table-layout: fixed }`;
   - `.filter-tabs { overflow-x:auto; flex-wrap:nowrap }` → wrap;
   - lebar kolom inline (mis. `width:260px` pada 10 kolom) dinormalkan.

3. **Mode stacked berlabel (≤1400px)** mengubah tiap baris menjadi blok:
   `LABEL (uppercase kecil) | NILAI`, satu baris tabel = satu kartu. Semua
   kolom tetap ada — tidak ada yang dipotong. Ambang 1400px dihitung dari
   geometri nyata: viewport 1440 − sidebar 254 − padding konten 88 ≈ 1098px
   area tabel, sehingga tabel 8–10 kolom uang tidak lagi terbaca sebagai tabel.

4. **Dokumen cetak/PDF tidak tersentuh.** Dekorator melewati
   `.print-portal`, `.print-dialog`, `.print-modal`, `.print-table`,
   `.print-info`, dan editor `.boq-table-wrap`; aturan `@media print` di
   `globals.css` tidak diubah. Output PDF/export tetap dokumen aslinya.

5. **Editor RAB & BOQ** memakai aturan sendiri (label `td::before` sudah ada
   sejak awal) — ditambah: workspace 1 kolom ≤1280px, header dokumen wrap,
   grid cost-row lebih rapat, tabel `fixed` + proporsi kolom asli dipertahankan.

---

## 4. Matriks modul

| # | Modul | Root di-scope | Tabel berlabel | Tab/state yang diuji |
|---|---|---|---|---|
| 1 | Dashboard | ✅ | – (kartu) | kartu metrik + shortcut admin |
| 2 | RAB & BOQ | ✅ | ✅ native BOQ | editor + tambah baris + breakdown |
| 3 | Invoice Penjualan | ✅ | ✅ | daftar + modal Buat Invoice |
| 4 | Stok Workshop | ✅ | – (kartu) | kartu material + filter |
| 5 | Customer CRM | ✅ | ✅ | daftar + drawer detail |
| 6 | Actual Labor & Stok | ✅ | ✅ | tabel labor + kartu stok |
| 7 | Marketing | ✅ | – (papan) | papan stage + kartu lead |
| 8 | Budgeting | ✅ | ✅ | WBS + panel budget percent custom |
| 9 | RAP | ✅ | ✅ | toolbar + baris editor (qty/harga/hapus) |
| 10 | Perbandingan RAB/RAP/Aktual | ✅ | ✅ | tabel + drawer detail |
| 11 | Project Finance | ✅ | ✅ | tab Revenue/Tukang/Material |
| 12 | Finance | ✅ | ✅ | Ringkasan + Cost Drive + Closing |
| 13 | Upah Tukang | ✅ | ✅ | Dashboard batch + Per Proyek |
| 14 | Settings | ✅ | ✅ | Log Aktivitas + Akun/Pengguna |

Verifikasi **kode/DOM (jsdom)**: 14/14 modul lulus (lihat §5.1).
Verifikasi **geometri piksel di browser**: **UNVERIFIED** (lihat §6).

---

## 5. Tes yang dijalankan

### 5.1 Harness compact (baru) — 113 assertion, 0 gagal

```
node scripts/compact-admin-test/compact_admin_test.mjs
```

- **A. Kontrak CSS (statis)**: file ada, scope `.root`, `table[data-stack]`,
  `content: attr(data-label)`, `table-layout: fixed`, **tidak ada**
  `overflow-x: auto` / `overflow-x: hidden` pada wadah tabel, filter-tabs
  wrap, tabular-nums, media query 1400px & 1024px, aturan BOQ ada,
  `globals.css` tidak diimpor/diubah, `@media print` utuh.
- **B. Render nyata** (esbuild + jsdom + React asli, fixture read-only):
  untuk tiap modul — render tanpa exception, root memakai scope compact,
  setiap tabel "diputuskan" (stacked / compact-only / tidak ada yang
  terlewat), setiap sel berisi punya `data-label`, tidak ada label kosong
  pada sel data, dekorasi idempoten (`innerHTML` identik), dan setiap pemicu
  state (tab/modal/tambah baris) benar-benar ditemukan sebelum diukur.
- Fixture: `scripts/compact-admin-test/mock.mjs` + `stub-supabase.mjs`
  (read-only, tanpa jaringan/DB/kredensial).

### 5.2 Regresi modul (harness lama, setelah adapter)

| Harness | Hasil |
|---|---|
| `stock-view-test` | exit 0 (53/53 render) |
| `crm-test` | exit 0 (88 lulus) |
| `labor-stock-test` | exit 0 (99 lulus) |
| `rap-test` | exit 0 (50 lulus) |
| `rap-compare-test` | exit 0 (82 lulus) |
| `sales-invoice-test` | exit 0 (A 92 · B 160 · C+D 93 · E+F+G 93) |
| `sales-invoice-payment-test` | exit 0 (51 lulus) |
| `growth-kpi-test` | exit 0 |
| `fn-repro` (Finance/Planning/ProjectFinance) | exit 0 (46 ok) |
| `planning-budget-test/verify_panel_render` | exit 0 (60 lulus) |
| `planning-budget-test/verify_custom_mode` | exit 0 (40 lulus) |
| `marketing-test` | exit 0 (kontrak + UI) |
| `rab-boq-test` | exit 0 |

Dua harness **pra-ada** yang gagal karena masalah lama, bukan regresi task ini:

- `rab-boq-render-test`: assertion F1/F2 membaca `styles/globals.css` dari
  `/home/ubuntu/purchasing-app` (repo lain) dan mengharapkan
  `.nav-group-label { font-weight:800; color:var(--ivory) }`. File itu di
  repo ini bernilai `700` / `#64748b` **sebelum** task ini (globals tidak
  disentuh — `git diff fe9862c -- styles/` kosong).
- `s7-compact-test`: assertion "globals.css tidak punya blok identik
  duplikat" gagal pada ~200 blok duplikat yang sudah ada di baseline.
- `ui-olive-tokens-test`: 1 gagal (`font-weight:750` di globals, sudah ada).

### 5.3 Adapter harness lama

Modul kini mengimpor `CompactRoot` yang mengimpor CSS module. Harness lama
menyalin closure file per modul ke sandbox `/tmp/...` dan menjalankannya
dengan Node ESM → `ERR_MODULE_NOT_FOUND` / tidak bisa memuat `.css`.

`scripts/compact-admin-test/adapt_legacy_harness.py` menambal **persiapan
sandbox** secara idempoten (menyalin `CompactRoot.js`, mengganti import CSS
module dengan objek kelas inline pada salinan di sandbox). **Assertion test
tidak diubah.** Jalankan ulang kapan pun setelah menarik perubahan:
`python3 scripts/compact-admin-test/adapt_legacy_harness.py`.

### 5.4 Build

```
flock /home/ubuntu/dev-workspaces/.purchasing-build.lock \
  -c 'ENABLE_SMOKE=1 NODE_OPTIONS=--max-old-space-size=768 npx next build'
```

Hasil: **✓ Compiled successfully** (exit 0), semua rute termasuk `/__smoke`
dan `/__mobile` ter-prerender. Build dijalankan serial via lock; `.next` yang
sedang disajikan tidak disentuh.

---

## 6. Runtime geometry — UNVERIFIED (jujur)

Mandat DAT: **browser VPS tidak boleh diaktifkan/di-install diam-diam.**
Karena itu pengukuran piksel nyata (`scrollWidth` vs `clientWidth`) **tidak
dijalankan** di lingkungan ini, dan hasilnya **tidak diklaim lulus**.

Yang sudah disiapkan supaya bisa diverifikasi siapa pun yang punya browser:

```
# 1) Di PC/browser yang SUDAH ada (bukan VPS), buka aplikasi lalu:
#    chrome --remote-debugging-port=9222
node scripts/compact-admin-test/runtime_geometry.mjs http://127.0.0.1:9222 http://localhost:3000

# 2) Tanpa Node: cetak probe, tempel di DevTools console
node scripts/compact-admin-test/runtime_geometry.mjs --print-probe
```

Probe mengukur, untuk 14 modul × 7 viewport (360/390/412/768/1024/1280/1440):

- `document.documentElement.scrollWidth <= clientWidth + 1`;
- setiap container terlihat (`main/section/.content/.panel/.table/*-table-wrap/
  .cards/.toolbar/.filter-tabs/.modal/.dialog/.si-modal-card`) `scrollWidth <=
  clientWidth + 1` — **tidak ada scroller samping**;
- tidak ada teks wajib terpotong (`overflow hidden` + `scrollWidth > clientWidth`);
- target sentuh ≥ 40px dan font input ≥ 16px pada ≤1024px.

Status eksplisit: **geometri runtime UNVERIFIED** di lingkungan agent ini.
Yang terverifikasi adalah kontrak CSS + struktur DOM + build (§5).

---

## 7. Kebutuhan global untuk Bamboo (integrator)

Lapisan compact **tidak** mengubah `globals.css`. Agar aturan lama tidak
bertabrakan dengan permintaan user (tanpa scroll kiri-kanan), integrator
sebaiknya (opsional, di file miliknya sendiri):

1. `styles/globals.css` — turunkan/ hapus aturan yang memaksa scroll pada
   tabel admin: `table.requests-table { min-width:1250px !important }`,
   `table.approvals-table { min-width:1180px !important }`,
   `table.materials-table { min-width:920px !important }`, dan
   `.table { overflow-x: auto !important }`. Selama masih ada, modul milik
   worker lain (PR/Approval/Material/Purchase/Serah Terima) tetap akan
   punya scroller samping di dalam `.table`.
2. `styles/globals.css` — `.filter-tabs` di `@media (max-width:1024px)`
   memaksa `flex-wrap: nowrap; overflow-x: auto`. Modul yang belum punya
   lapisan compact akan tetap berupa baris geser.
3. `pages/_app.js` — viewport meta sudah tunggal (tidak perlu diubah).
4. Bila integrator ingin seluruh aplikasi konsisten, pola
   `compact-admin.module.css` dapat dijadikan lapisan global (tanpa scope
   `.root`) — tetapi itu keputusan integrator, bukan task ini.

Tidak ada kebutuhan DB/migrasi/seed.

---

## 8. Batasan & catatan

- Mode stacked berlabel aktif ≤1400px. Di atas 1400px tabel tetap tabel
  rapat (fixed layout, kolom proporsional) — tanpa scroller.
- `rab-boq-render-test` F1/F2 dan `s7-compact-test` gagal karena kondisi
  baseline (lihat §5.2), bukan karena perubahan task ini.
- Harness lama memakai sandbox `/tmp/...` sesuai pola repo; skrip adapter
  hanya menulis di sandbox, bukan di repo.
- Tidak ada klaim "reviewer independen". Ini laporan implementasi.
