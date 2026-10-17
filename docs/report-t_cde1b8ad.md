# Laporan Eksekusi — t_cde1b8ad (S1/7)

**Card:** [S1/7] Ringkas alur PR dan Purchase tanpa mengubah schema
**Owner:** bamboo-tech · **Tanggal:** 18 Okt 2026
**Branch:** `feat/ops-workflow-t_cde1b8ad` (base: `main` @ `18fb594`)
**Dokumen kontrak & keputusan:** `docs/pr-purchase-compact-contract.md`

---

## 1. Hasil dalam satu paragraf

Alur PR & Purchase sudah dipadatkan sesuai arahan DAT tanpa menyentuh schema:
form PR kini hanya meminta **Project · Judul · Prioritas · Material · Qty ·
Estimasi**, pemilih toko dipindah secara visual ke Purchase (dilipat, bukan
dihapus — alasannya di §3), catatan jadi opsional-terlipat, dan daftar PR
memberi label jujur **"Rencana Toko"**. Modul Purchase dipadatkan ke **Toko ·
No. Nota · Tanggal · Total · Bukti · Catatan** (Siap Dibeli 8→6 kolom,
Riwayat 9→6 kolom, informasi dipindah ke sel gabungan/rincian — tidak ada yang
hilang), status/kendala nota tidak tampil di UI utama, alokasi fisik tetap
milik Handover. Dua penyebab overflow nyata di layar HP ditemukan lewat
pengukuran di Chrome sungguhan dan diperbaiki; hasil akhir **6/6 viewport
bersih** dan **7 harness hijau** (satu di antaranya baru, 150 assertion).

---

## 2. Perubahan per file

### `modules/requests/form.jsx`
- Field utama = 6 hal di atas. Ditambah satu baris konteks alur.
- Pemilih Kategori/Vendor per item → `<details class="pr-item-toko">`
  (default tertutup, ringkasan menyebut vendor tersimpan, ada keterangan
  "toko aktual dicatat di Purchase").
- Catatan → `<details class="pr-notes-box">`, default tertutup, **terbuka
  otomatis bila PR sudah punya catatan** (data lama tidak tampak hilang).
- Total Estimasi: `<table>` 6 kolom → baris flex `.pr-total-row`
  (**perbaikan overflow dialog**, lihat §4).
- Tabel item dapat kelas `.pr-items-table` + styled-jsx ter-scope.
- Kontainer item: `overflowX: auto` ditambahkan.

### `modules/requests/view.jsx`
- Header kolom `vendor_name` → **"Rencana Toko"** dengan tooltip yang
  menyatakan toko AKTUAL ada di modul Purchase. Isi sel tidak berubah.

### `modules/requests/save.js`
- **Perilaku tidak diubah.** Ditambah blok dokumentasi kontrak (mengapa
  `vendor_id`/`supplier_category` tetap ditulis, mengapa gate
  `isVendorEligible` tetap ada, mengapa catatan tetap disimpan).

### `modules/receivings/page.jsx`
- Tabel Siap Dibeli 8 → 6 kolom: kode+satuan masuk sel **Barang**, No. PR
  masuk sel **Proyek**.
- Tabel Riwayat 9 → 6 kolom: Material & Biaya Lain turun jadi **baris rincian
  kecil di bawah Total Nota** (label tetap terbaca; rincian penuh tetap ada di
  "▼ Rincian").
- Footer "Proses Pembelian" hanya dirender bila ada barang dicentang.
- Status/kendala nota tetap tidak ditampilkan (ditegaskan + diuji).

### `modules/receivings/purchaseForm.jsx`
- Urutan baca: identitas (Toko·Nota·Tanggal) → barang → **TOTAL** → bukti →
  catatan.
- Ongkir & diskon → `<details>` "Tambahan & potongan (opsional)", otomatis
  terbuka bila sudah ada nilai. Rumus total tidak berubah.
- Tabel item 5 → 4 kolom (Satuan menempel di bawah input Qty).
- styled-jsx ter-scope menetralkan aturan mobile global (tabel muat di HP).

### `scripts/pr-purchase-compact-test/` (baru, 5 file)
`run.py` (sandbox SWC + mock supabase perekam), `mock-supabaseClient.mjs`,
`save_test.mjs` (20 assertion), `render_test.mjs` (130 assertion),
`overflow_check.mjs` (Chrome nyata via CDP, 6 viewport).

### `docs/pr-purchase-compact-contract.md` (baru)
Kontrak & keputusan lengkap + catatan untuk worker S2/7.

---

## 3. Keputusan yang perlu diketahui reviewer

**a) Pemilih toko di PR dilipat, tidak dihapus.** Menghapus total akan
membuat PR lama yang vendornya sudah non-aktif **tidak bisa disimpan** (gate
`isVendorEligible` di `save.js` masih berlaku, dan tidak ada cara
mengosongkan vendor dari UI) — jalan buntu. Dilipat = tujuan visual tercapai,
data lama tetap bisa dikoreksi, tidak ada buntu.

**b) "Vendor" di daftar PR diganti label "Rencana Toko".** Data yang
tersimpan adalah rencana, bukan supplier aktual. Label lama berisiko dibaca
sebagai supplier aktual (defect P1 `t_e88c28fb`).

**c) Status/kendala nota: tidak ditampilkan, tidak dihapus.** Modul Purchase
tidak pernah menulis/menghapus `receivings.status` atau `receivings.kendala`.
Nota berstatus RETUR **tetap muncul** di Riwayat sebagai nota (data tidak
disembunyikan) — hanya label kendalanya yang tidak tampil. Penyaringan
"nota bermasalah" tetap ada di Handover.

**d) Penawar aturan CSS global dipasang ter-scope, bukan di `globals.css`.**
`styles/globals.css` bukan file milik card ini. styled-jsx ter-scope
(`:global(...)` di dalam komponen) hanya memengaruhi tabel di komponen itu
sendiri. Kalau aturan global itu nanti dirapikan, tambalan ini bisa dihapus
(sudah dicatat di §7 dokumen kontrak).

---

## 4. Overflow: temuan & angka

Diukur di Chrome 152 headless via CDP pada `/__smoke` (build `ENABLE_SMOKE=1`).

| Temuan | Sebelum | Sesudah |
|---|---|---|
| `dialog` form PR di viewport 390px | konten **885px** di kotak **370px** → seluruh dialog bergulir horizontal | konten **361px** → pas, tidak bergulir |
| Tabel item dialog Purchase di 390px | **820px** (dipaksa `table{min-width:820px}`) | **323px** = lebar kontainer, tanpa geser |
| Tabel item form PR di 390px | **820px** | muat (styled-jsx ter-scope) |
| `documentElement.scrollWidth` vs `clientWidth` | — | **sama** di 1440/1280/768/412/390/360 |

Penyebab tabel PR dulu: `<table>` "Total Estimasi" 6 kolom **di luar**
kontainer scroll dengan min-content ≈820px.

Sisa kontainer yang masih bergulir di `/__smoke` = `.filter-tabs` milik modul
**Materials / Approvals / Handovers** (sudah ada sebelum card ini, di luar
kepemilikan file card ini — dilaporkan, tidak diubah).

---

## 5. Bukti verifikasi (dijalankan ulang setelah perubahan terakhir)

```
scripts/pr-purchase-compact-test   SAVE 20 LULUS / RENDER 130 LULUS / 0 GAGAL   ← baru
scripts/pr-estimator-test          UNIT 48 / RENDER 47 / SAVE 14  / 0 GAGAL
scripts/pr-group-test              UNIT 31 / RENDER 54            / 0 GAGAL
scripts/purchase-flow-test         178 + 90                       / 0 GAGAL
scripts/fase2-save-test            56                             / 0 GAGAL
scripts/approval-queue-test        56                             / 0 GAGAL
scripts/showmore-list-test         49                             / 0 GAGAL
npx next build                     hijau
ENABLE_SMOKE=1 npx next build      hijau
overflow_check.mjs (6 viewport)    6/6 bersih
```

Assertion lama yang **diperbarui** (bukan dilonggarkan):
`pr-estimator-test/render_test.mjs` — mencari `.pr-total-row` (baris flex)
alih-alih `<tr>`, karena itulah perbaikan overflow-nya; assertion "Total di
luar area scroll" tetap ada. Ditambah 1 assertion baru di sana: "Total
memakai baris flex, bukan tabel lebar".

---

## 6. Yang TIDAK dikerjakan (di luar batas / butuh keputusan)

- Tidak ada migrasi / kolom / tabel baru. Tidak ada formula atau permission
  yang diubah.
- `modules/handovers/*`, `modules/materials/*`, `modules/vendors/*`,
  `styles/globals.css`, `components/*`, `lib/*`, `modules/shared/*` — **tidak
  disentuh**.
- `.filter-tabs` yang masih bergulir di modul lain: dilaporkan, tidak diubah.
- Ringkasan "nota bermasalah" di Purchase: keputusan produk baru (tidak
  diminta card ini).

---

## 7. Catatan lingkungan (penting untuk worker berikutnya)

- Worktree `agent-1-ops` sebelumnya berada di branch `feat/ops-workflow`
  (commit `99d6afc`, **tertinggal 4 hari** dari `main`). Card ini dikerjakan
  di branch baru `feat/ops-workflow-t_cde1b8ad` dari **`main` @ `18fb594`**
  supaya tidak berbasis kode basi.
- Perubahan `components/Planning.js` yang belum ter-commit di worktree itu
  **bukan milik card ini** — disimpan di `git stash` (`stash@{0}`, pesan
  "wip Planning.js (bukan milik card t_cde1b8ad)") dan tidak dibawa ke commit.
  `scripts/planning-budget-test/` dipindah ke `/tmp/ops-wt-backup/` agar
  checkout bersih.
