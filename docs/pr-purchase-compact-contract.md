# PR & Purchase Dipadatkan — Tanpa Perubahan Schema (t_cde1b8ad)

Tanggal: 18 Okt 2026 · Owner: **bamboo-tech** · Arahan: DAT (S1/7 — ringkas
alur PR dan Purchase)
Status migrasi DB: **TIDAK ADA SQL DIJALANKAN.** Tidak ada file `migrations/`
yang ditambah/diubah. Semua penulisan memakai kolom & tabel yang sudah ada.

---

## 1. Ringkasan satu paragraf

Form PR dipangkas ke enam hal yang memang dibutuhkan lapangan (**Project ·
Judul · Prioritas · Material · Qty · Estimasi**), pemilihan **toko/vendor
aktual dipindah ke modul Purchase**, dan **catatan dilipat** (opsional).
Modul Purchase dipadatkan ke enam hal yang ada di nota (**Toko · No. Nota ·
Tanggal · Total · Bukti · Catatan**), **status/kendala nota tidak lagi tampil
di UI utama**, dan **alokasi fisik tetap milik modul Handover**. Tidak ada
kolom DB, formula, permission, atau file modul lain yang berubah; data lama
tetap utuh dan tetap terbaca.

---

## 2. PR — apa yang berubah (dan apa yang TIDAK)

| Aspek | Sebelum | Sesudah | Data |
|---|---|---|---|
| Field utama | Project, Judul, Prioritas, Material, Qty, Estimasi **+ pemilih Kategori & Vendor per item** | Project, Judul, Prioritas, Material, Qty, Estimasi | — |
| Pemilih toko per item | Terbuka di setiap baris item | **Dilipat** di `<details>` "🏷️ Rencana toko (opsional)" | `pr_items.vendor_id`, `pr_items.supplier_category` **tetap ditulis** |
| Catatan | Field terbuka di bawah form | `<details>` "📝 Catatan (opsional)", default **tertutup**; terbuka otomatis bila PR sudah punya catatan | `purchase_requests.notes` **tetap ditulis** (fallback judul, perilaku lama) |
| Kolom daftar "Vendor" | Label "Vendor" (terbaca seperti supplier aktual) | Label **"Rencana Toko"** + tooltip "toko AKTUAL dicatat di modul Purchase" | tidak berubah (kolom hanya baca) |
| Konteks alur | tidak ada | satu baris penjelas: "PR = permintaan barang… Toko/vendor aktual dipilih di modul Purchase" | — |

### 2.1 Mengapa pemilih toko TIDAK dihapus total (keputusan + alasan)

Arahan berbunyi "vendor aktual dipindahkan secara visual ke Purchase". Yang
dipindah adalah **toko aktual** (nota belanja). `pr_items.vendor_id` adalah
konsep berbeda: *rencana* toko dari data lama, dan ia **dipakai estimator
harga** (`modules/requests/estimator.js`) untuk memprioritaskan entri HISTORIS
vendor tersebut.

Konsekuensi kalau kontrolnya dibuang total: `modules/requests/save.js` masih
menjalankan gate `isVendorEligible(vendor, kategori material)`. PR lama yang
menyimpan vendor yang **sudah tidak aktif** untuk kategori material itu akan
**selalu ditolak saat disimpan**, tanpa jalan keluar di UI (tidak ada cara
mengosongkan vendor). Itu jalan buntu, bukan penyederhanaan.

Karena itu kontrolnya **dilipat, bukan dihapus**, dan:
- ringkasan lipatan menyebut nama vendor tersimpan → data lama terlihat;
- ada catatan "N item menyimpan rencana toko dari data lama — nilainya
  dipertahankan";
- item baru menyimpan `null` karena PR tidak lagi menanyakan toko.

### 2.2 Kontrak simpan PR tidak berubah (diverifikasi)

`modules/requests/save.js` **tidak diubah perilakunya** — hanya ditambah
dokumentasi kontrak. Yang dibuktikan harness (`scripts/pr-purchase-compact-test`):

- `pr_items` tetap memuat `vendor_id` & `supplier_category` di setiap baris;
- item tanpa toko → `null` (bukan kolom hilang, bukan string kosong);
- gate vendor tidak-eligible **masih menolak** + pesan menyebut kategori;
- `notes` tetap tersimpan (fallback judul bila kosong);
- mode edit **tidak** menghapus vendor tersimpan (update, bukan delete+insert).

---

## 3. Purchase — apa yang berubah (dan apa yang TIDAK)

| Aspek | Sebelum | Sesudah | Data |
|---|---|---|---|
| Tabel "Siap Dibeli" | 8 kolom (checkbox, Barang, **Satuan**, Qty PR, Proyek, **No. PR**, Toko, Estimasi) | 6 kolom (checkbox, **Barang+kode+satuan**, **Qty**, **Proyek+No. PR**, Toko, Estimasi) | tidak berubah |
| Tabel "Riwayat" | 9 kolom (Tanggal, No. Nota, Toko, Barang, **Material**, **Biaya Lain**, Total, Bukti, Aksi) | 6 kolom (Tanggal, No. Nota, Toko+proyek, **Total + rincian biaya**, Bukti, Aksi) | tidak berubah |
| Status nota / kendala (Retur/Refund/Rusak) | tidak tampil (sudah dihapus di t_9109cf5e) — **ditegaskan lagi** di sini | tetap tidak tampil; `receivings.status` & `receivings.kendala` **tidak pernah ditulis/dihapus** modul ini | utuh |
| Tombol "Proses Pembelian" footer | tampil selalu (tombol primer kembar, sering nonaktif) | hanya tampil bila ada barang dicentang | — |
| Dialog nota | 3 kolom identitas + tabel item 5 kolom + total + biaya + bukti + catatan | identitas (Toko·Nota·Tanggal) → barang (4 kolom) → **TOTAL** → bukti → catatan; ongkir/diskon **dilipat** | rumus tidak berubah |
| Alokasi fisik (gudang/tukang) | bukan di sini (Handover) | tetap bukan di sini | — |

**Rumus total TIDAK diubah:** `total = material + biaya lain − diskon`
(`purchaseLogic.computeTotals`). Yang berubah hanya *di mana* input ongkir &
diskon berada (di dalam `<details>`, otomatis terbuka bila sudah ada nilai).

---

## 4. Overflow di layar sempit — akar masalah & perbaikan

Acceptance card menyebut "no body overflow". Pemeriksaan di Chrome sungguhan
(`scripts/pr-purchase-compact-test/overflow_check.mjs`, 6 viewport) menemukan
**dua** penyebab nyata yang bukan sekadar kosmetik:

### 4.1 Tabel "Total Estimasi PR" di form PR (penyebab utama)

Total di form PR dulu `<table>` 6 kolom **di luar** kontainer scroll. Lebar
min-content-nya ≈**820px** merambat ke grid `.dialog` → **seluruh dialog form
PR bergulir horizontal** di layar 390px (dialog 370px, konten 885px).

Perbaikan: Total jadi **baris flex** `.pr-total-row` — isi & posisi sama
(tetap di luar area scroll item, kontrak review run 86 tetap dipenuhi), tapi
tidak punya min-content lebar. Terukur: `dialog.scrollWidth` **885px → 361px**.

### 4.2 Aturan mobile global ber-`!important` menahan tabel di 820px

`styles/globals.css` (file bersama, **bukan milik card ini**) punya:

```css
@media (max-width: 900px) {
  table { min-width: 820px; }
  th { padding: 12px 14px !important; white-space: nowrap !important; }
  td { padding: 12px 14px !important; }
}
```

`!important` mengalahkan inline style, jadi tabel item (PR maupun dialog
Purchase) dipaksa 820px dan harus digeser ke samping di HP. Penawarnya
dipasang sebagai **styled-jsx ter-scope di dalam file modul sendiri** — tidak
ada satu baris pun `styles/globals.css` yang diubah:

- `modules/requests/form.jsx` → `:global(.material-picker-box .pr-items-table)`
- `modules/receivings/purchaseForm.jsx` → `:global(.dialog-purchase .purchase-items-table)`

Efek terukur (viewport 390px): tabel item Purchase **820px → 323px** (pas
dengan kontainernya, tanpa geser), tabel item PR juga tidak lagi 820px.

Hasil akhir: **6/6 viewport bersih** (1440, 1280, 768, 412, 390, 360) untuk
tab Siap Dibeli, tab Riwayat, dan dialog Proses Pembelian.
`documentElement.scrollWidth === clientWidth` di semua viewport.

> Sisa kontainer yang masih bisa digeser di halaman `/__smoke` adalah
> `.filter-tabs` milik modul **Materials / Approvals / Handovers** — sudah ada
> sebelum card ini dan berada di luar kepemilikan file card ini (dilaporkan,
> tidak diubah).

---

## 5. Yang TIDAK diubah (batas kepemilikan dipatuhi)

- **DB schema**: tidak ada migrasi, tidak ada kolom/tabel baru.
- **Formula**: `computeTotals`, `prEstimateTotals`, `computeItem` tidak disentuh.
- **Permission / RLS**: tidak disentuh.
- **`modules/handovers/*`**: tidak disentuh (alokasi fisik tetap di sana).
- **`modules/materials/*`, `modules/vendors/*`**: tidak disentuh.
- **`styles/globals.css`**: tidak disentuh (penawar ditaruh ter-scope di modul).
- **`components/CreateModal.js`, `components/ModuleView.js`, `lib/*`,
  `modules/shared/*`**: tidak disentuh (file core, milik Tech Lead).

File yang berubah hanya:

```
modules/requests/form.jsx            (form PR ringkas)
modules/requests/view.jsx            (label kolom "Rencana Toko")
modules/requests/save.js             (dokumentasi kontrak; perilaku sama)
modules/receivings/page.jsx          (tabel & footer dipadatkan)
modules/receivings/purchaseForm.jsx  (urutan baca + lipatan biaya + tabel muat HP)
scripts/pr-purchase-compact-test/*   (harness baru, 5 file)
docs/pr-purchase-compact-contract.md (dokumen ini)
```

---

## 6. Verifikasi (semua dijalankan ulang setelah perubahan terakhir)

| Harness | Hasil |
|---|---|
| `scripts/pr-purchase-compact-test/run.py` (baru) | **150 lulus, 0 gagal** (20 save + 130 render) |
| `scripts/pr-estimator-test/run.py` | 48 unit + 47 render + 14 save — **0 gagal** |
| `scripts/pr-group-test/run.py` | 31 unit + 54 render — **0 gagal** |
| `scripts/purchase-flow-test/run.py` | 178 logika/simpan + 90 render — **0 gagal** |
| `scripts/fase2-save-test/run.py` | 56 lulus — 0 gagal |
| `scripts/approval-queue-test/run.py` | 56 lulus — 0 gagal |
| `scripts/showmore-list-test/run.py` | 49 lulus — 0 gagal |
| `npx next build` (desktop) | hijau |
| `ENABLE_SMOKE=1 npx next build` (smoke) | hijau |
| `overflow_check.mjs` (Chrome nyata, 6 viewport) | **6/6 bersih** |

Catatan: dua assertion lama di `pr-estimator-test/render_test.mjs` dan
`pr-purchase-compact-test/render_test.mjs` yang mencari `<tr>` "Total
Estimasi" **diperbarui** menjadi mencari `.pr-total-row` (baris flex) — karena
itulah perbaikan overflow-nya. Assertion "Total di luar area scroll" (kontrak
review run 86) tetap ada dan tetap lulus.

---

## 7. Untuk worker berikutnya (S2/7 dst.)

1. **`receivings.status` & `receivings.kendala` masih ada di DB dan masih
   ditulis** oleh `pages/index.js` (`updateReceivingStatus`) — tapi modul
   Purchase tidak lagi menampilkan atau menyentuhnya. Kalau S2 (Handover /
   audit ledger) butuh "nota bermasalah", sumbernya `receivings.kendala`,
   **jangan** menambah field baru di Purchase.
2. **`pr_items.vendor_id` = rencana toko, `receivings.vendor_id` = toko
   aktual.** Jangan pernah menggabungkan keduanya dalam satu laporan tanpa
   label — itu persis defect P1 yang diperbaiki di `t_e88c28fb`.
3. **Jangan hapus kontrol "Rencana toko" dari form PR** kecuali gate
   `isVendorEligible` di `modules/requests/save.js` juga dicabut — kalau tidak,
   PR lama ber-vendor non-aktif jadi tidak bisa disimpan (jalan buntu).
4. Kalau `styles/globals.css` suatu saat dirapikan (aturan `table { min-width:
   820px }` di mobile dibuat scoped), **hapus** blok styled-jsx penawar di
   `modules/requests/form.jsx` & `modules/receivings/purchaseForm.jsx` —
   keduanya hanya tambalan untuk aturan global itu.
5. **Belum dikerjakan (butuh keputusan DAT, bukan blocker):**
   label status nota di Purchase sengaja tidak ditampilkan; bila DAT ingin
   ringkasan "nota bermasalah" di Purchase, itu keputusan produk baru, bukan
   bagian card ini.
