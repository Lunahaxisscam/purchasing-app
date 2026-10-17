# Kontrak Handover — Distribusi Fisik Dipadatkan (t_b03c5228 / S2-7)

Tanggal: 18 Okt 2026 · Owner: **bamboo-tech** · Arahan: DAT (S2/7)
Status migrasi DB: **TIDAK ADA SQL DIJALANKAN**. Tidak ada kolom/tabel baru.
Kontrak `actions.js` dan `logic.js` **tidak diubah** (lihat §5).

---

## 1. Batas tanggung jawab (satu kalimat)

**Purchase = mencatat nota toko & uang keluar, berhenti saat barang dibeli.**
**Handover = satu-satunya tempat keputusan fisik barang: gudang, tukang, atau
bermasalah.** Tidak ada tombol/kontrol distribusi fisik di Purchase, dan tidak
ada status teknis yang ditampilkan ke user di Handover.

---

## 2. Tampilan Handover (antrean distribusi fisik)

Satu kartu antrean = satu dokumen `handovers` yang belum punya `diserahkan_at`.
Isi kartu, dari atas ke bawah:

| Bagian | Isi | Catatan |
|---|---|---|
| Header | penerima (`received_by`), ringkasan progres, badge **Tujuan** | Tujuan ditulis sebagai kalimat (`Gudang` / `Tukang` / `Langsung ke lapangan`), **bukan** kode DB |
| **3 aksi fisik** | `📦 Masuk Stok Gudang` · `👷 Serah Terima ke Tukang` · `⚠ Bermasalah` | Dua aksi pertama memakai gaya tombol aksi; **Bermasalah sengaja tidak ditonjolkan** (border putus-putus, font 11.5px, tanpa warna aksi) sesuai arahan DAT |
| Panel Bermasalah | `↩ Retur ke Supplier` / `💸 Refund` (atau alasan penolakan) | Hanya muncul setelah tombol Bermasalah ditekan |
| Langkah penutup | `✅ Tandai Diserahkan` + input "Diterima oleh" (opsional) | Dipisah dari baris aksi: ini **bukti penerimaan**, bukan langkah distribusi |
| Rincian barang | `▾ Rincian barang` (collapsed) | Nama barang + qty beli + label "qty beli di nota"; data tanpa rincian → **"Rincian barang belum tersedia"** |

### 2.1 Mengapa "Tandai Diserahkan" bukan aksi keempat

Aksi distribusi mengubah **letak** barang (gudang/tukang). `diserahkan_at`
mengubah **klaim bahwa barang sudah diterima di lokasi** — dimensi berbeda
(kontrak `t_b418827b`: bukti fisik = `diserahkan_at`, bukan status CONFIRMED).
Menaruhnya sejajar dengan gudang/tukang membuat user mengira "sudah diserahkan"
adalah alternatif dari "kirim ke tukang". Karena itu ia jadi langkah penutup,
dan tetap memakai `runHandoverAction(ACT_TERIMA, …)` yang sama.

### 2.2 Status teknis yang disembunyikan (nilai DB tetap dipakai)

| Nilai DB | Dulu tampil | Sekarang |
|---|---|---|
| `receivings.alokasi` = `KE_GUDANG`/`KE_TUKANG`/`LANGSUNG_LAPANGAN` | kode mentah di badge & detail | `Tujuan: Gudang` / `Tukang` / `Langsung ke lapangan` (`alokasiLabel()`) |
| `pr_items.status` = `DI_GUDANG`/`DI_TUKANG` | tidak pernah tampil sebagai teks; hanya dipakai menghitung ringkasan | tetap: ringkasan "N barang didistribusikan" |
| `receivings.status`/`kendala` = `RETUR`/`REFUND`/`RUSAK` | tidak tampil di Handover | `⚠ Nota bermasalah` (satu label manusia, desktop + mobile) |

Kode tidak pernah ditampilkan, tetapi **tidak pernah dihapus atau diubah** dari
sumbernya. `logic.js` tetap membaca nilai-nilai itu untuk penjaga tombol.

### 2.3 Aksi nonaktif selalu punya alasan

Tidak ada tombol mati tanpa penjelasan. Setiap tombol nonaktif membawa
`title` berisi kalimat penyebab, contoh:

- "Nota sudah ditandai masuk gudang."
- "Nota ini dialokasikan ke gudang, bukan ke tukang."
- "Belum ada barang yang didistribusikan (gudang/tukang)."
- "Belum terhubung ke nota pembelian — distribusi fisik dicatat dari nota di modul Purchase."

---

## 3. Aksi "Bermasalah" (Retur / Refund)

### 3.1 Sumber data — memakai yang sudah ada

`receivings.status` + `receivings.kendala` (sudah ada di DB, sudah ditulis
`pages/index.js → updateReceivingStatus`). **Tidak ada field/kolom baru.**
Nilai yang dipakai hanya `RETUR` dan `REFUND` — nilai yang sudah dikenal sistem
(`lib/constants.js → receivingStatusOptions`).

### 3.2 Jalur tulis — delegasi, bukan duplikasi

`queue.jsx` **tidak** memanggil Supabase. Ia memanggil
`ctx.onReceivingStatusChange(receiving, 'RETUR' | 'REFUND')` — handler shell
yang sudah ada (`pages/index.js`). Konsekuensi:

- satu jalur tulis status nota di seluruh aplikasi;
- guard yang sudah ada di handler ikut berlaku (mis. nota multi-item ditolak);
- `queue.jsx` tidak menambah ketergantungan DB baru dan tetap bisa diuji
  tanpa DB (dibuktikan `A9e`: nol `update`/`insert` dari file ini).

### 3.3 Kapan aksi ditolak (dan apa yang user lihat)

| Kondisi | Perilaku | Alasan yang ditampilkan |
|---|---|---|
| Handover tanpa `receiving_id` (data lama/orphan) | panel menampilkan alasan | "Dokumen ini belum terhubung ke nota pembelian — masalah barang dicatat dari modul Purchase." |
| Nota sudah bermasalah | panel menampilkan alasan | "Nota ini sudah ditandai bermasalah (Retur/Refund) — tidak bisa ditandai dua kali." |
| Handler shell tidak ada (mis. render terisolasi) | panel menampilkan alasan | "Aksi bermasalah tidak tersedia di tampilan ini …" |
| Nota tanpa rincian barang | panel menampilkan alasan | "Nota ini belum punya rincian barang …" |
| Nota multi-item | panel menampilkan alasan | "Nota multi-item: Retur/Refund dicatat per barang, dan penyimpanan per barang belum aktif (menunggu persetujuan skema)." |

Baris terakhir bukan pilihan gaya: `updateReceivingStatus` di shell **menolak**
mengubah status parent untuk nota multi-item (bisa meng-override kondisi barang
anak). Menampilkan tombol di sana akan memberi ilusi tersimpan.

### 3.4 Nota bermasalah menutup distribusi

Bila nota sudah Retur/Refund, aksi gudang & tukang dinonaktifkan dengan alasan.
Ini **tidak menutup jalur yang sebenarnya ada**: RPC `receive_to_warehouse`
sudah menolak nota Retur/Refund. Lapisan ini hanya membuat penolakan itu
terbaca sebelum user menekan tombol.

---

## 4. Fallback data lama (dijaga, bukan dihapus)

| Kasus | Dulu | Sekarang |
|---|---|---|
| Handover tanpa `receiving_id` | kartu tampil; tombol gudang/tukang **aktif** dan aksi "berhasil" tanpa mengubah apa pun (`loadContext` → `receiving: null`) | kartu tetap tampil; tombol nonaktif dengan alasan terbaca |
| Handover tanpa rincian barang | label "Rincian barang belum tersedia" | sama (tidak berubah) |
| `status` lama `CONFIRMED` tanpa `diserahkan_at` | catatan kecil "Status lama …" | sama (tidak berubah) |
| Nota lama tanpa `alokasi` | badge kosong / `—` | badge tidak dirender (tidak mengarang tujuan) |

Perbaikan baris pertama adalah defect nyata yang ditemukan saat kerja kartu ini:
aksi yang mengklaim sukses tanpa menulis apa pun. Nonaktif + alasan lebih jujur
daripada tombol yang "berhasil" palsu.

---

## 5. Kontrak yang TIDAK diubah

| File | Status | Bukti |
|---|---|---|
| `modules/handovers/logic.js` | **tidak diubah** — tetap satu-satunya sumber aturan aksi (`actionPlan`, `canAct*`, `summarizeDistribution`, `distributionLabel`) | `queue_test` 66/66 tetap lulus; `B5h` |
| `modules/handovers/actions.js` | **tidak diubah** — tetap satu-satunya penulis DB aksi gudang/tukang/terima | `queue_test` 66/66; `B5g` |
| `migrations/` | tidak disentuh | `B4`/`F1` |
| `modules/receivings/*` | tidak diubah kartu ini (milik S1) — diverifikasi ulang bahwa Purchase tidak punya kontrol fisik | `purchase_scope_test` 52/52 |

Lapisan tampilan di atas `actionPlan` (penutupan aksi untuk nota bermasalah /
tanpa nota) berada di `queue.jsx` **setelah** `actionPlan` dipanggil — jadi
aturan murni tetap di `logic.js`, dan tidak ada perilaku DB yang berubah.

---

## 6. Verifikasi

| Harness | Cakupan | Hasil |
|---|---|---|
| `scripts/handover-compact-test/run.py` → `queue_ui_test.mjs` (**baru**) | `queue.jsx` + `view.jsx` asli di jsdom interaktif: visibilitas 3 aksi, status teknis disembunyikan, label jujur, fallback legacy, Bermasalah lewat handler shell, tidak ada field fisik ganda | **86 lulus, 0 gagal** |
| `scripts/handover-compact-test/run.py` → `purchase_scope_test.mjs` (**baru**) | `page.jsx` Purchase asli: tidak ada kontrol fisik, status/kendala tidak tampil, jalur simpan tidak menulis kolom fisik | **52 lulus, 0 gagal** |
| `scripts/handover-compact-test/e2e_runtime_test.mjs` (**baru**) | Chrome sungguhan via CDP pada `/__smoke`: 3 tombol benar-benar terlihat & satu baris, kode status tidak bocor, nol overflow horizontal di 1440/1280/390/360 | **31 lulus, 0 gagal** |
| `scripts/handover-flow-test/run.py` | regresi Handover lama (logic/queue/render) | 61 + 66 + 73 — 0 gagal |
| `scripts/purchase-flow-test/run.py` | regresi Purchase | 178 + 90 — 0 gagal |
| `scripts/pr-purchase-compact-test/run.py` | regresi S1 (izin file diperluas ke `queue.jsx`/`view.jsx`, lihat §7) | 20 + 130 — 0 gagal |
| `scripts/pr-estimator-test` / `pr-group-test` / `showmore-list-test` / `fase2-save-test` / `approval-queue-test` | regresi lintas modul | 48+47+14 / 31+54 / 49 / 56 / 56 — 0 gagal |
| `ENABLE_SMOKE=1 npx next build` | build + render semua modul | hijau |

---

## 7. Catatan untuk reviewer (Brooklyn)

1. **Satu assertion lama di `pr-purchase-compact-test/render_test.mjs` diubah,
   bukan dilonggarkan.** Assertion itu menuntut `modules/handovers/` **tidak
   berubah sama sekali** — benar untuk kartu S1, tapi mustahil untuk kartu S2
   yang memang pemilik `modules/handovers/queue.jsx` + `view.jsx`. Yang
   dipertahankan: migrasi terlarang, materials/vendors terlarang, dan
   `modules/handovers/` dibatasi **hanya** dua file UX itu (jadi
   `actions.js`/`logic.js` tetap terkunci oleh assertion yang sama).
2. **Bermasalah tidak menulis DB sendiri.** Kalau reviewer ingin alur retur
   yang benar-benar per barang (bukan status nota), itu butuh
   `receiving_events`/`handover_items` — masih beku di
   `docs/handover-gap-proposal.md`. Kartu ini tidak menjalankan migrasi.
3. **`/__smoke` tidak punya `receivings.alokasi`.** Badge "Tujuan:" karena itu
   tidak muncul di smoke — diuji lewat jsdom dengan data ber-alokasi (A4) dan
   e2e memastikan tidak ada tujuan yang dikarang (2h).
4. **`.filter-tabs` modul lain masih bergulir horizontal di HP** (temuan S1,
   di luar kepemilikan file kartu ini) — tidak diubah.
