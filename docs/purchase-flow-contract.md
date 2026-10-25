# Kontrak Modul Purchase — Belanja Admin (t_9109cf5e)

Tanggal: 17 Okt 2026 · Owner: **bamboo-tech** · Arahan: DAT (rombak besar
modul Purchase — tahap belanja admin).
Status migrasi DB: **TIDAK ADA SQL DIJALANKAN** oleh task ini. Semua penulisan
memakai kolom/tabel yang sudah ada; kebutuhan kolom baru dicatat di §6.

---

## 1. Batas tanggung jawab (satu kalimat)

**Purchase = admin belanja kantor mencatat nota toko & uang keluar. Berhenti
sampai barang dibeli.** Distribusi fisik barang (gudang / tukang / bermasalah)
= modul **Handover**.

Konsekuensi: tombol *Masuk Stok Gudang*, *Serah Terima ke Tukang*, dropdown
status nota (Retur/Refund) **dihapus total** dari modul Purchase — bukan
disembunyikan. Barang yang selesai dibeli otomatis membuat **satu dokumen
Handover `DRAFT`** sehingga masuk antrean distribusi fisik di modul Handover.

## 2. Dua tab

| Tab | Isi | Sumber data |
|---|---|---|
| **Siap Dibeli** | Barang yang sudah **APPROVED** di modul Approval dan **belum dibeli penuh**. Bisa difilter per **Toko/Vendor** atau per **Proyek**; bisa dicentang beberapa barang untuk dibeli bersamaan ke toko yang sama. Bila pernah dibeli sebagian, kolom Qty PR menampilkan **"sisa N"** dan qty default form = sisa (kebutuhan proyek tidak hilang diam-diam). | `pr_items` (status APPROVED/ORDERED) − jumlah yang sudah dibeli (`quantity_received` pada baris penerimaan yang menunjuk item itu) |
| **Riwayat Pembelian** | Nota belanja yang sudah selesai: tanggal, no. nota, toko, jumlah barang, total rupiah, lampiran bukti (bisa dibuka). | `receivings` berkategori `PURCHASED` (status `DIBELI` atau penanda `[Tahap: DIBELI]`) + `LEGACY` (nota lama bernomor) |

Aturan klasifikasi nota (`classifyNota` di `purchaseLogic.js`):

- `PURCHASED` — status `DIBELI` **atau** catatan memuat `[Tahap: DIBELI]`.
- `LEGACY` — nota lama yang benar-benar mencatat uang keluar: `invoice_no`
  terisi, **atau** bertanggal + bernominal. Ditampilkan dengan label kecil
  **"nota lama"**; harga satuan per barang tidak dikarang (tampil "—").
- `DRAFT` — cangkang nota otomatis dari Approval (belum dibeli).
  **Tidak ditampilkan di tab mana pun**; barangnya tetap ada di Siap Dibeli.

> **`delivery_note` bukan bukti nota.** `ensure_item_in_purchase` mengisi
> `delivery_note` dengan `"PO <no PR> - <judul>"`, jadi kolom itu terisi pada
> **setiap** PR yang baru disetujui. Kalau dipakai sebagai penanda nota, tab
> Riwayat menampilkan baris hantu (tanpa nomor/toko/total) sebelum ada uang
> keluar — terlihat di data produksi (2 cangkang tampil sebagai "nota lama").
> Karena itu klasifikasi hanya memakai `invoice_no`, atau tanggal + nominal.

Rincian barang satu nota = **hanya baris `quantity_received > 0`**. Baris qty 0
adalah sisa cangkang untuk barang yang belum dibeli; kalau ikut ditampilkan,
nota seolah membeli barang yang tidak ada di nota toko ("Sekrup x0") dan jumlah
itemnya membengkak.

## 3. Dialog "Proses Pembelian" (satu nota = satu toko)

| Field | Aturan |
|---|---|
| Toko / Vendor | Terisi otomatis dari barang yang dicentang (toko dengan barang terbanyak), **bisa diganti** ke toko lain. Semua barang yang dicentang tetap masuk nota (tidak ada yang dibuang diam-diam); bila centang mencakup >1 toko, banner mengingatkan satu nota = satu toko |
| Tanggal belanja | Default hari ini (`YYYY-MM-DD`) |
| No. Invoice / No. Nota toko | **WAJIB**, contoh `TB-88912`. Anti dobel: kombinasi toko + nomor yang sama ditolak |
| Nama barang & satuan | Dari `pr_items` (read-only) |
| Qty beli | Default = qty PR, **boleh diubah** (beli beda qty di toko) |
| Harga satuan riil netto | **Wajib diisi** (angka > 0). Estimasi/acuan hanya ditampilkan sebagai pembanding, TIDAK pernah dipakai sebagai harga beli (defect P1 `t_e88c28fb`) |
| Subtotal material | Otomatis `qty × harga` (dibulatkan) |
| Biaya lain / ongkir | Dipisah; masuk **beban operasional WS**, bukan harga material |
| Diskon toko | Dipisah; **mengurangi** total nota |
| Total nota riil | Otomatis `material + biaya lain − diskon` |
| Lampiran (opsional) | Foto nota/struk toko + bukti transfer/pembayaran (maks **1 MB** per file, gambar diperkecil via canvas bila perlu) |
| Tombol | `✓ Selesaikan Pembelian` — satu-satunya jalur tulis |

Input **tidak menulis DB saat mengetik**; semua tersimpan sekali saat tombol
ditekan (`purchaseSave.js`), dengan ref guard + tombol disabled (anti dobel).

## 4. Penyimpanan (tanpa migrasi)

### 4.1 Header nota — tabel `receivings`

| Kolom | Nilai |
|---|---|
| `vendor_id` | toko yang dipilih |
| `invoice_no` | nomor nota toko |
| `delivery_note` | `Nota <nomor>` (kolom lama dipakai sebagai label sumber; Handover menampilkannya) |
| `received_date` | tanggal belanja |
| `status` | `DIBELI` (fallback: nilai lama + penanda tahap, lihat §4.3) |
| `purchase_request_id` / `project_id` | diisi **hanya bila** seluruh barang nota berasal dari satu PR/proyek (jejak dibaca dari baris item **atau** dari jejak form `prId`/`projectId` yang dibawa tab Siap Dibeli); FK lama tidak dikosongkan |
| `note` | catatan terstruktur (§4.2), selalu string |
| `alokasi`, `masuk_gudang`, `tukang_at` | **tidak disentuh** (urusan Handover) |

### 4.2 Kontrak catatan — `lib/purchaseNote.js`

Satu-satunya parser/penulis penanda (bukan JSON packing):

```
[Nominal: Rp 542.000]      subtotal MATERIAL (format lama — tetap dibaca
                           parseNominalFromNote di Finance/ProjectFinance)
[BiayaLain: Rp 25.000]     ongkir/biaya tambahan toko (beban operasional)
[Diskon: Rp 10.000]        diskon toko
[Nota: <url|no. resi>]     referensi nota (format lama)
[BuktiNota: <data-url>]    foto nota/struk
[BuktiTransfer: <data-url>] bukti transfer/pembayaran
[Tahap: DIBELI]            penanda tahap (fallback bila kolom status dibatasi)
<catatan bebas>
```

Data lama tanpa penanda aman: seluruh teks masuk `catatan`, angka `null`
(tidak dikarang). Nilai 0 tidak ditulis.

### 4.3 Status `DIBELI` vs CHECK constraint

Kolom `receivings.status` bisa punya CHECK constraint (skema milik task
`t_03b41644`). Alur simpan:

1. coba tulis `status = 'DIBELI'`;
2. bila Postgres menolak (`23514` / *check constraint*), tulis ulang dengan
   status lama/`NORMAL` — nota **tetap tersimpan** dan tetap ditandai
   `[Tahap: DIBELI]` di catatan;
3. pesan hasil menyebut fallback itu apa adanya (tidak mengklaim status
   kolom berubah).

Probe read-only pada DB live (17 Okt 2026): UPDATE dengan `status='DIBELI'`
pada id fiktif **diterima** (0 baris berubah) → kemungkinan tidak ada CHECK
yang menolak; fallback tetap disiapkan untuk lingkungan lain.

### 4.4 Baris barang — tabel `receiving_items`

| Kolom | Nilai |
|---|---|
| `receiving_id` | header nota |
| `pr_item_id` | item PR asal (jejak ke PR/proyek) |
| `item_name`, `unit` | dari PR |
| `quantity_received` | **qty beli** (boleh beda dari qty PR) |
| `note` | `[Harga: <harga satuan riil>]` |

Baris item **dipakai ulang** hanya bila masih cangkang kosong (qty 0) atau
memang sudah milik nota yang sedang ditulis. Alur Approval membuat cangkang
nota + baris item qty 0 (`ensure_item_in_purchase`), jadi saat membeli pertama
kali baris itu di-update (qty + harga) — tidak diduplikasi.

### 4.4b Pembelian bertahap: nota kedua TIDAK menimpa nota pertama

Satu cangkang Approval mewakili **satu PR**, sedangkan admin bisa membeli
bertahap (sebagian hari ini, sisanya besok) atau ke toko berbeda. Keduanya
menunjuk cangkang yang sama, sehingga **header yang sudah menjadi nota selesai
tidak boleh dipakai ulang**:

- Header dianggap selesai bila statusnya `DIBELI` **atau** sudah punya
  `invoice_no`.
- Dalam kasus itu nota baru dibuat sebagai header terpisah; baris item yang
  sudah mencatat pembelian nyata di nota lain **tidak dipindahkan/ditimpa** —
  baris baru dibuat, sehingga nota lama tetap punya rincian barangnya.
- Satu barang boleh punya beberapa baris pembelian (nota, tanggal, dan harga
  berbeda) — itu justru sumber acuan harga historis yang jujur.

Tanpa penjagaan ini, nota hari ini ditimpa nota besok: nomor nota, toko,
tanggal, dan nominal nota pertama hilang dari Riwayat — uang yang sudah keluar
lenyap dari catatan (diuji `B7` di `logic_test.mjs`).

### 4.5 Acuan harga historis

`modules/materials/acuan.js → receivingItemActualPrice(ri)` membaca
`unit_price`/`price_actual`/`actual_unit_price`/`price` (bila schema owner
menambahkannya) **atau** penanda `[Harga: n]`. Entri berlabel
**✅ Historis (pembelian)** hanya bila harga itu ada; tanpa harga → tetap
`PR_ESTIMATE` (estimasi PR terdahulu, tidak dipromosikan). Total nota
(`[Nominal]`) **tidak pernah** dipakai sebagai harga satuan.

### 4.6 Antrean Handover

Setelah nota + barang tersimpan, dibuat **satu** dokumen `handovers`
(`status='DRAFT'`, `receiving_id` nota, `project_id` bila tunggal,
`received_by='Belum ditentukan'`, tanpa `diserahkan_at`). Idempoten: nota yang
sudah punya dokumen handover tidak dibuatkan lagi. Kegagalan langkah ini
**tidak membatalkan nota** (uang sudah keluar) dan dilaporkan dengan pesan
yang meminta dokumen serah terima dibuat manual.

## 5. Verifikasi

| Harness | Cakupan | Hasil |
|---|---|---|
| `scripts/purchase-flow-test/run.py` → `logic_test.mjs` | logika murni + kontrak catatan + acuan historis + simpan (mock DB) | 178 lulus |
| `scripts/purchase-flow-test/run.py` → `render_test.mjs` | `page.jsx` + `purchaseForm.jsx` asli di jsdom interaktif (klik/ketik/submit nyata) | 90 lulus |
| `scripts/purchase-flow-test/e2e_runtime_test.mjs` | Chrome headless CDP pada `/__smoke` (desktop + mobile 390px) | 45 lulus |
| `scripts/handover-flow-test/e2e_runtime_test.mjs` | regresi Handover + memastikan Purchase tidak menyisakan aksi lama | 43 lulus |
| `npm run build` / `npm run smoke` | build Next.js hijau | ✓ |

Regresi yang dikunci harness (semua **gagal** pada commit `e25b26e`, lulus
setelah perbaikan):

| Uji | Perilaku yang dijaga |
|---|---|
| `A6b` | cangkang Approval (`delivery_note` = `"PO …"`) tidak tampil sebagai nota di Riwayat; nota lama bernomor / bertanggal+nominal tetap tampil |
| `A6c` | rincian nota hanya baris `quantity_received > 0` (tidak ada "Sekrup x0") |
| `B7` | beli bertahap dari PR yang sama: nota kedua **tidak** menimpa nota pertama (2 nota, 2 total, rincian tidak tercampur) |
| `B8` | nota tanpa cangkang tetap menyimpan `purchase_request_id`/`project_id` dan proyek pada dokumen Handover |

## 6. Gap yang masih terbuka (butuh keputusan schema owner)

| # | Gap | Dampak sekarang | Solusi |
|---|---|---|---|
| P1 | Tidak ada kolom harga satuan per baris penerimaan | harga riil disimpan sebagai penanda `[Harga: n]` di `receiving_items.note` | kolom `unit_price numeric` di `receiving_items` (kode sudah membaca kolom lebih dulu) |
| P2 | Tidak ada kolom biaya lain / diskon / lampiran di header nota | disimpan sebagai penanda di `receivings.note` | kolom `extra_cost`, `discount`, `receipt_url`, `payment_proof_url` |
| P3 | Lampiran berupa data-URL di kolom teks (belum ada bucket Storage) | foto besar dibatasi 1 MB + diperkecil di klien | bucket Storage + kolom referensi |
| P4 | `receivings.status` belum tentu punya nilai `DIBELI` | fallback penanda `[Tahap: DIBELI]` | perluas CHECK/ENUM status |
| P5 | Rincian barang per dokumen Handover masih header-level | Handover menampilkan rincian dari baris nota; konfirmasi fisik tetap per dokumen | tabel `handover_items` (lihat `docs/handover-gap-proposal.md`) |
| P6 | Satu nota hanya satu toko (belanja lintas toko = beberapa nota) | UI memberi petunjuk saat centang mencakup >1 toko; semua barang tetap ikut nota, admin bisa ganti toko di form | keputusan bisnis bila butuh satu nota multi-toko |

## 7. Yang secara eksplisit TIDAK dilakukan task ini

- Tidak ada `INSERT/UPDATE/DELETE` ke database produksi (semua verifikasi
  memakai mock; satu-satunya sentuhan DB adalah SELECT read-only untuk
  inventarisasi skema).
- Tidak ada file migrasi/SQL baru.
- Tidak menghapus data lama: nota lama tetap tampil di Riwayat (label "nota
  lama"), cangkang otomatis dibiarkan apa adanya.
- Tidak mengubah alur PR/Approval/Handover (hanya menerima hasilnya).
