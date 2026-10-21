# Kontrak Ledger Penerimaan & Retur per Barang — t_7bc6246b

Tanggal: 21 Okt 2026 · Branch: `feat/receipt-ledger-t_7bc6246b` (base `origin/main` 4a92bec)
Status DB: **tidak ada SQL dijalankan oleh task ini.** Skema milik `t_03b41644`.

---

## 1. Kenapa dokumen ini ada

Aplikasi **tidak boleh** mengklaim "tersimpan" untuk dimensi yang belum punya
tabel. Dokumen ini menetapkan:

1. **semantik qty** (tiga angka terpisah, tidak boleh tercampur),
2. **nama tabel/kolom/RPC** yang dipanggil kode (harus sama 1:1 dengan migrasi),
3. **mode LEGACY vs READY** dan siapa yang menentukan,
4. **jalur tulis** (satu RPC, tidak ada insert langsung dari client).

---

## 2. Semantik qty — sumber bug yang sudah terbukti

| Kolom | Arti | Penulis |
|---|---|---|
| `receiving_items.quantity_received` | **QTY BELI** | `purchaseSave.js` (modul Pembelian) |
| `receiving_items.qty_arrived` | **QTY DATANG** (Σ `receiving_events.qty_datang`) | RPC `receipt_apply_events` |
| `receiving_items.qty_handed_over` | **QTY DISERAHKAN** (Σ `handover_items.qty_diserahkan`) | RPC `handover_confirm` |

**Aturan wajib:** `sisa pesanan = pr_items.quantity − qty_arrived`.
Memakai `quantity_received` di sini menghasilkan: nota dibeli 10 tapi belum
datang → tampil "sudah diterima 10" → sisa 0 → barang tidak bisa dibeli lagi.
Rincian: `COMPATIBILITY_CUTOVER.md` (workspace `t_03b41644`).

Kode di branch ini mematuhi aturan itu:
`receiptLogic.buildRows()` membaca `qty_arrived`;
`receiptCapability` mewajibkan view `v_receipt_progress` ada sebelum mode READY.

---

## 3. Objek yang dipanggil kode

### 3.1 Tabel & view

| Objek | Kolom yang dibaca/ditulis kode |
|---|---|
| `receiving_events` | `id, client_event_id, receiving_id, receiving_item_id, pr_item_id, item_name, unit, qty_datang, qty_rusak, tujuan_ws, tujuan_tukang, penerima_tukang, retur_status, retur_qty, discard_confirmed, foto_ref, source, created_at` |
| `handover_items` | `id, handover_id, receiving_event_id, receiving_item_id, pr_item_id, item_name, qty_diserahkan, satuan, penerima, catatan, created_at` |
| `return_lines` | `id, return_case_id, receiving_event_id, qty` |
| `v_receipt_progress` | `receiving_item_id, qty_datang, qty_rusak, qty_baik, belum_diserahkan, qty_bought, qty_arrived, qty_handed_over, tujuan_tukang` |

Nama kolom view **wajib persis** — `receiptCapability.js` memprobe daftar itu.

### 3.2 RPC (satu-satunya jalur tulis)

| RPC | Parameter | Dipanggil dari |
|---|---|---|
| `receipt_apply_events` | `p_receiving_id`, `p_events` (jsonb array), `p_meta` | `receiptEventSave.applyReceiptEvents` |
| `handover_confirm` | `p_handover_id`, `p_lines` (jsonb array) | `receiptEventSave.confirmHandoverLines` |
| `return_create` | `p_receiving_id`, `p_lines`, `p_resolution`, `p_reason` | `receiptEventSave.createReturnCase` |

Tabel ledger **tidak punya policy tulis**: client hanya SELECT, semua tulis
lewat RPC SECURITY DEFINER (grant `authenticated`, cabut `anon`).

### 3.3 Idempotensi

`client_event_id` deterministik:
`rcpt:<receivingId>:<receivingItemId>:<prevCum>-><prevCum+datang>`

Isian sama → id sama → `ON CONFLICT (client_event_id) DO NOTHING` → retry,
double-click, dan dua user tidak menggandakan qty. **Dibuktikan pada
PostgreSQL nyata** (bukan mock): submit ulang → `applied=0`,
`already_applied=2`, `qty_arrived` tetap.

### 3.4 SALDO RETUR = `retur_qty`, BUKAN `qty_rusak`

Ini bukan detail gaya: `return_create` menolak event dengan `retur_qty <= 0`
(`reason=no_retur_balance`) dan memakai `retur_qty` sebagai plafon
(`over_return`). `qty_rusak` hanya *fakta fisik*; `retur_qty` adalah *saldo
yang boleh diretur*.

| Keadaan event | `qty_rusak` | `retur_qty` | Boleh diretur? |
|---|---|---|---|
| rusak, pilihan **"Tentukan nanti"** (default form) | 2 | **0** | **TIDAK** |
| rusak, pilihan **"Kembalikan ke supplier"** | 2 | 2 | ya, maks 2 |
| rusak, pilihan **"Dibuang"** | 2 | 2 | ya, maks 2 (butuh `discard_confirmed`) |
| retur sebagian sudah tercatat 1 | 2 | 2 | ya, sisa 1 |

Karena itu `returPlan()` (bukan `qty_rusak`) menentukan baris yang ditawarkan
modal retur, dan barang rusak yang belum punya saldo **dilaporkan** di panel
"Belum bisa diretur" — tidak disembunyikan, tidak ditawarkan lalu ditolak
server. Data lama tanpa kolom `retur_qty` di-fallback ke `qty_rusak` supaya
tidak hilang.

Konsekuensi untuk operator: memilih "Tentukan nanti" berarti barang rusak
**belum bisa diretur**. Form Terima Barang menampilkan peringatan saat itu
terjadi, supaya keputusan diambil di tempat yang benar.

---

## 4. Mode LEGACY vs READY

Ditentukan **hanya** oleh `getReceiptCapability()` (probe SELECT limit 1, TTL 60s):

| Flag | Syarat | Efek UI |
|---|---|---|
| `ready` | `receiving_events` ∧ `handover_items` ∧ `v_receipt_progress` terbaca | form Terima Barang menyimpan via RPC; konfirmasi per item aktif |
| `returnReady` | `ready` ∧ `return_lines` terbaca | tombol/modal Retur aktif |
| keduanya false | — | submit diblok dengan pesan gap, **nol tulisan**; konfirmasi jatuh ke header (`confirm.js`); banner menyebut alasan |

### 4.1 Enam keadaan, bukan dua (run 231)

`ready` dan `returnReady` **tidak boleh** dipakai langsung oleh layar. Keduanya
mengukur objek yang **terpisah** (layer retur adalah file migrasi sendiri), jadi
satu boolean tidak cukup. `capabilityState(cap)` mengembalikan:

| State | Syarat | Yang boleh terjadi |
|---|---|---|
| `unknown` | probe belum selesai (`cap === null`) | **NOL tulisan**; tombol tulis nonaktif |
| `error` | probe gagal non-konklusif (RLS/jaringan `42501` dst.) | **NOL tulisan**; sebabnya ditampilkan |
| `partial` | sebagian objek ledger terbaca, `ready=false` | **NOL tulisan**; jangan sebut "belum aktif" |
| `legacy` | tidak satu pun objek ledger terbaca | jalur lama (header) — satu-satunya yang tersisa |
| `ready_no_return` | `ready=true` **∧** `returnReady=false` | penerimaan + serah terima per barang **BOLEH**; **retur DITUTUP** dengan sebab benar |
| `ready` | `ready=true` ∧ `returnReady=true` | semua dimensi |

Dua predikat dipakai semua layar:

```js
coreLedgerReady(cap)  // true di 'ready' dan 'ready_no_return'
returnLayerReady(cap) // true HANYA di 'ready'
```

**`ready_no_return` itu nyata**, dua jalan masuk: (a) `01,02,04` dijalankan
sebelum `03_return_layer.sql`; (b) `03` sudah jalan tetapi `SELECT return_lines`
ditolak GRANT/RLS `42501` — kelas blocker yang sama dengan
`GRANT SELECT v_receipt_progress`. Di keadaan itu `cap.returnProbeFailed`
membedakan "tabel belum ada" dari "ADA tetapi tidak bisa dibaca", supaya admin
tidak disuruh menunggu migrasi untuk masalah hak akses.

**Status live per 21 Okt 2026 (probe read-only, anon key):**

```
receiving_events    PGRST205 (tidak ada)
handover_items      PGRST205 (tidak ada)
return_lines        PGRST205 (tidak ada)
v_receipt_progress  PGRST205 (tidak ada)
→ ready=false, returnReady=false, mode UI = LEGACY
```

Data live utuh: receivings 6 · receiving_items 6 · handovers 1 ·
purchase_requests 16 · pr_items 60 · vendors 22.

---

## 5. Bukti pengujian

| Harness | Cakupan | Hasil |
|---|---|---|
| `scripts/receipt-ledger-db-test/` | RPC **nyata** di PostgreSQL 16 terisolasi + migrasi 00..04 schema owner, **plus** matriks retur ujung-ke-ujung | **47 PASS / 0 FAIL** + matriks 4/4 |
| `scripts/receipt-physical-test/` | jsdom interaktif: form Terima Barang, konfirmasi, retur, pintu masuk, logika murni | **112 PASS / 0 FAIL** |
| `scripts/handover-flow-test/` | regresi Handover | 61 / 66 / 73 lulus |
| `scripts/handover-compact-test/` | kontrak 3 aksi fisik + scope Purchase | 89/89 (+ 50/52 status quo main) |
| `scripts/purchase-flow-test/` | regresi Pembelian | 218 / 105 lulus |

DB test membuktikan antara lain: `quantity_received` tetap 10 saat
`qty_arrived` 6; over-receipt ditolak server; konfirmasi kedua `already`;
quota tukang ditolak → CAS ikut rollback; retur kedua ditolak; anon 0 grant.

**Matriks retur (`probe_retur_matrix.mjs`)** menjawab pertanyaan berbeda:
untuk tiap pilihan di form Terima Barang, apakah baris yang **ditawarkan**
modal benar-benar **diterima** RPC? Hasil: 4/4 jalur bersaldo diterima;
"Tentukan nanti" (saldo 0) tidak ditawarkan dan dilaporkan sebagai belum bisa
diretur. Sebelum perbaikan run 190, jalur default ini menawarkan qty lalu
ditolak server `no_retur_balance`.

### 3.5 Defect run 190 (ditemukan setelah harness hijau)

| # | Defect | Dampak | Fix |
|---|---|---|---|
| 1 | `returLinesFromEvents` memakai `qty_rusak`, bukan `retur_qty` | Barang rusak berstatus "Tentukan nanti" ditawarkan di modal retur; RPC menolak `no_retur_balance` → tombol aktif tapi selalu gagal | `returPlan()` memakai saldo `retur_qty`; baris tanpa saldo dilaporkan terpisah + peringatan di form Terima Barang |
| 2 | Konfirmasi READY dengan 0 baris alokasi tukang: tombol submit membaca `validation.ok` (selalu false) dan tidak ada input header | Handover tanpa alokasi tukang — termasuk **data lama tanpa `receiving_id`** — MUSTAHIL dikonfirmasi di mode READY, padahal mode LEGACY bisa. Teks form menyuruh "konfirmasi header saja" tanpa jalan | Jalur eksplisit "Tandai Sudah Diserahkan (tanpa rincian)" + nama penerima wajib; `markHandoverDelivered` kini benar-benar menyimpan `received_by` |
| 3 | Fixture harness memakai `qty_rusak=2, retur_qty=0` | Harness hijau untuk alur yang di produksi berakhir dengan penolakan server — mock lebih longgar dari RPC | Fixture diperbaiki; ditambah T5a–T5k + C5a–C5j yang mengunci ketiga perilaku |

Ketiganya **aktif hanya setelah migrasi** (mode READY). Mode LEGACY tidak
terpengaruh karena modal retur tidak bisa dibuka tanpa `return_lines`.

### 3.6 Defect run 195 — TINDAKAN retur harus mengikuti status barang

Saldo retur saja belum cukup: modal juga menawarkan **tindakan**
(RETURN / REPLACE / REFUND / DISCARD) yang tidak selalu sah untuk baris itu.

| Keadaan event | `retur_status` | `discard_confirmed` | Tindakan yang sah |
|---|---|---|---|
| dipilih "Kembalikan ke supplier" | `PENDING` | false | `RETURN`, `REPLACE`, `REFUND` |
| dipilih "Dibuang" | `DISCARDED` | true | `DISCARD` |
| data tidak konsisten | `DISCARDED` | false | **tidak ada** — dilaporkan, bukan ditawari |

Kontrak ini **wajib** diikuti UI karena `return_create`:

- menolak `DISCARD` bila `discard_confirmed` event masih false
  (`reason=discard_not_confirmed`);
- menerima `RETURN` untuk event `DISCARDED` dan **mengubah `retur_status`
  menjadi `PENDING`** — kalau UI menawarkannya, barang yang sudah dibuang
  seolah kembali menunggu dikembalikan (kontradiksi data).

Implementasi: `allowedResolutionsFor()` per baris + `commonResolutions()`
(irisan untuk baris terpilih). Bila irisan kosong (mis. satu barang dibuang +
satu menunggu dikembalikan), form **menolak menyimpan** dan meminta retur
dipisah — bukan mengirim permintaan yang pasti ditolak. Tindakan yang tidak
ditawarkan **dijelaskan** di panel, tidak disembunyikan diam-diam.

Dikunci oleh `probe_retur_resolution.mjs` (14 cek pada PG nyata) + T6a–T6k
(jsdom). Bila schema owner mengubah aturan RPC, ubah fungsi itu **dan** probe
dalam commit yang sama.

### 3.7 Defect run 199 — BATAS KEDATANGAN & KOREKSI

Tiga aturan yang sebelumnya tidak ada di UI maupun di dokumen ini. Semuanya
diturunkan dari perilaku RPC yang sebenarnya (bukan preferensi tampilan) dan
dikunci `probe_receipt_guards.mjs` (18 cek, PG nyata).

| # | Aturan | Kenapa (perilaku server) |
|---|---|---|
| 1 | **Batas atas kedatangan = `receiving_items.quantity_received` (QTY BELI baris ini)**, bukan `pr_items.quantity` | RPC memvalidasi over-receipt terhadap qty pesanan PR, sehingga nota yang membeli 3 dari pesanan 5 bisa dicatat DATANG 5. Untuk baris beli langsung (`pr_item_id` NULL) server tidak punya batas sama sekali |
| 2 | **Baris dengan `quantity_received = 0` adalah barang BELUM DIBELI** dan tidak boleh dicatat datang | Baris cangkang Approval punya qty pesanan > 0, sehingga tampak seperti barang yang menunggu diterima; RPC menerima `qty_datang` untuk baris itu (di data live 6 dari 6 baris ber-qty 0) |
| 3 | **`retur_status != NONE` wajib `retur_qty > 0`** | RPC menolak `retur_without_qty`. Form mengirim `PENDING/DISCARDED` dengan `retur_qty = rusak`, jadi pilihan retur saat rusak 0 selalu ditolak |

Konsekuensi untuk form: `validateItem` menolak ketiganya **sebelum** RPC, dan
`buildEventDrafts` menormalkan `retur_status` ke `NONE` bila `qty_rusak = 0`
sehingga payload tidak pernah membawa kombinasi yang ditolak server.

#### 3.7.1 Koreksi vs replay (idempotensi)

`client_event_id` deterministik = `rcpt:{receiving}:{item}:{prevCum}->{prevCum+datang}`.
Artinya submit ulang dengan **qty datang sama** menghasilkan id yang sama
walaupun `rusak`/tujuan/penerima **berbeda**. RPC menjawab
`applied=0, already_applied=N` dan **tidak menulis perubahan** — jadi
"idempoten" ≠ "bisa dikoreksi".

Kontrak yang dipakai UI:

| Keadaan | Perilaku |
|---|---|
| Event dengan `client_event_id` itu **belum ada** | Kirim ke RPC (jalur normal) |
| Sudah ada dan **seluruh dimensi identik** | Replay: kirim ke RPC, server menjawab `already_applied`; UI bilang "tidak digandakan" |
| Sudah ada dan **ada dimensi berbeda** | **Ditolak di klien** (`code=CORRECTION_UNSUPPORTED`) dengan daftar kolom yang berbeda + nilai tersimpan. Nol tulisan, nol klaim |
| Sudah ada, user memilih **foto baru** | Ditolak dengan alasan yang sama: event pertama tidak pernah ditimpa |
| Sudah ada, user **tidak** memilih foto | Bukan konflik (form tidak memuat ulang lampiran lama) |

### Foto: `foto_ref` = referensi arsip, BUKAN nama berkas (run 206)

`receiving_events.foto_ref` menyimpan **path/ID arsip** (Drive/Storage),
sesuai `DATA_DICTIONARY_v2` schema owner. Nama berkas di perangkat admin
(`IMG_20261021_0912.jpg`) **bukan** referensi: berkas itu tidak pernah
diunggah, dan menyimpannya membuat baris DB tampak punya bukti foto padahal
tidak ada yang bisa dibuka.

Kontrak yang dipakai UI sekarang:

| Keadaan | Nilai `foto_ref` | Yang dikatakan UI |
|---|---|---|
| Tidak ada berkas dipilih | `null` | — (foto memang opsional) |
| Berkas dipilih, unggah belum tersedia | `null` | "berkas ini **tidak ikut tersimpan**" per baris, SEBELUM simpan |
| Ada referensi arsip nyata (`foto.ref`) | string referensi | — |

Unggah ke arsip **belum diimplementasikan** (`modules/receivings/attachments.js`
mencatat bahwa bucket Storage kosong). Sampai itu ada, satu-satunya nilai
jujur adalah `null`; UI tidak boleh diam saja saat admin memilih berkas.
Kalau nanti unggah aktif, isi `entry.foto.ref` dengan hasil unggah — bukan
nama berkas.

Koreksi sungguhan **belum didukung**: skema punya `receiving_events.reversal_of`
tetapi belum ada RPC pembalik/pengoreksi di paket `t_03b41644`. Sampai RPC itu
ada, UI menolak dengan penjelasan — bukan menerima lalu diam-diam mengabaikan.
Bila schema owner menambah RPC koreksi, ganti `findSameEvents()` dengan
pemanggilan RPC tersebut dan perbarui probe ini.

---

## 6. Yang TIDAK dibuktikan (jujur)

- RLS terhadap **sesi user Novi nyata** — policy diuji mekanis (grant/role),
  bukan login E2E.
- Migrasi **belum di produksi** (`applied=0`); aplikasi tetap LEGACY.
- Cluster uji memakai fixture sintetis, bukan dump produksi.
- Nomor proyek draft-vs-issued **tidak** diaktifkan (belum diputuskan DAT).
- **Penghapusan lewat SQL langsung / API service-role tetap bisa merusak
  `receiving_items.qty_handed_over`** — penjaga hapus ada di aplikasi, bukan
  trigger database (lihat §8).

---

## 8. Penghapusan: bukti fisik tidak boleh lenyap (run 237)

Lensa ini tidak pernah dipakai 13 run sebelumnya (101…236): semuanya menguji
**simpan**, **tampil**, dan **kesiapan**. Tombol 🗑️ ada di setiap baris tanpa
syarat, dan `deleteItem` di `pages/index.js` melakukan
`delete from handovers where id = …`.

Dibuktikan di PostgreSQL NYATA (`probe_run237_delete.mjs`, 16/16):

| # | Akibat penghapusan dokumen yang sudah diserahkan |
|---|---|
| D1 | `handover_items` ikut terhapus lewat `on delete cascade` → **bukti fisik hilang permanen** |
| D2 | `receiving_items.qty_handed_over` **tidak dikoreksi** → 5 padahal rincian 0 |
| D3 | `v_receipt_progress.belum_diserahkan` kembali penuh → barang yang sudah diterima tampil "belum diserahkan" |
| D4 | kuota tukang **terbuka lagi** → dokumen baru diterima RPC untuk barang yang sama (penyerahan ganda) |
| D5 | `check_receipt_qty_consistency()` sendiri menandai `qty_handed_over_mismatch` |

Penjaga sekarang ada di **aplikasi** (`modules/handovers/deleteGuard.js`),
dipakai dua lapis: tombol (desktop + kartu mobile) nonaktif dengan sebab
terbaca, dan `deleteDecision()` di shell **sebelum** optimistic update maupun
`.delete()` — jadi jalur non-tombol ikut tertutup.

Definisi "bukti" mengikuti kontrak aplikasi sendiri (`display.js`):
`diserahkan_at` **atau** ada baris rincian. Status `CONFIRMED`/`SELESAI`
**tanpa** keduanya adalah status basi (bukan bukti) — boleh dihapus, tetapi
dengan peringatan eksplisit, supaya penjaga tidak lebih ketat dari kontraknya.

Hapus **nota** (Pembelian) yang masih dirujuk serah terima **apa pun** sudah
ditolak database (`handovers_receiving_id_fkey`, **tidak** cascade — diuji di
`probe_run237_fk_scope.mjs`). Aplikasi sekarang menolaknya lebih dulu dengan
sebab yang bisa dibaca, bukan pesan mentah `23503`.

**Batas yang diakui:** tidak ada trigger/RLS yang menolak DELETE di level
database (itu milik schema owner `t_03b41644`); `pages/api/seed-simulation.js`
masih bisa menghapus massal bila dipanggil dengan token maintenance. Keduanya
dicatat, tidak diklaim tertutup. Rekomendasi untuk schema owner: trigger
`before delete on handovers` yang menolak bila `diserahkan_at is not null`
atau ada `handover_items`, atau `on delete restrict` pada
`handover_items.handover_id` + RPC koreksi yang menyinkronkan
`qty_handed_over`.

---

## 7. Urutan aktivasi (setelah schema owner menjalankan DDL)

```
1. backup consistent + restore drill lulus        (BACKUP_RUNBOOK_v2)
2. apply migrasi 00→05 + readback SQL              (MIGRATION_MANIFEST §5)
3. probe aplikasi (force) → ready=true, returnReady=true   [tanpa deploy]
4. merge branch ini + patch COMPATIBILITY_CUTOVER §3
5. deploy
6. transaksi NYATA pertama oleh Novi (bukan fixture)
```

Langkah 3 aman sebelum langkah 4: selama build produksi belum memuat
`receiptCapability`, tidak ada UI yang memakai tabel baru.

### 7.1 Kalau langkah 4–5 BELUM jalan (aktivasi tanpa deploy)

Langkah 3 bisa terjadi saat build produksi **belum** memuat branch ini — artinya
tabel baru sudah ada tetapi UI yang memakainya belum. Itu tidak berbahaya.

Yang **berbahaya** adalah urutan sebaliknya: build yang **sudah** memuat
`receiptCapability` dipakai Novi, lalu migrasi dijalankan **belum** selesai /
baru selesai **sesudah** layar terbuka. Dulu capability adalah **snapshot**:
`queue.jsx` memanggil `getReceiptCapability()` sekali saat mount dan cache modul
berlaku 60 detik, jadi layar yang sudah terbuka tetap memegang `legacy` untuk
skema yang sudah hidup. `legacy` satu-satunya keadaan yang masih menulis jalur
lama, sehingga snapshot basi bisa:

- menimpa `pr_items.status` lewat aksi borongan (tujuan per barang bertentangan), dan
- mengunci dokumen tanpa rincian (`diserahkan_at` di-set; CAS membuatnya permanen).

Karena itu sekarang:

1. **Probe selalu `force: true`** di antrean — saat mount, saat isi antrean
   berubah, saat tab kembali fokus/terlihat, dan lewat tombol
   **"🔄 Periksa ulang kesiapan skema"**. **Tidak perlu reload halaman.**
2. **Sebelum jalur tulis lama menulis**, capability diperiksa ulang
   (`force: true`) tepat di titik tulis — aksi borongan, pembukaan form header,
   tombol Konfirmasi di form header yang sudah terbuka, dan penandaan
   Retur/Refund header. Bila hasilnya bukan `legacy`, tulisannya **nol** dan
   admin diberi sebab (`staleWriteMessage`).
3. Snapshot segar itu langsung dipakai seluruh layar, jadi banner dan semua
   kartu tidak pernah berbeda pendapat.

Konsekuensi urutan yang benar:

```
fix (branch ini) → backup → migrasi → probe segar (tanpa reload) → deploy
```

**Migrasi boleh dijalankan saat aplikasi dipakai**, asalkan build yang aktif
sudah memuat perbaikan ini. Build lama (tanpa perbaikan) tetap harus di-reload
sesudah migrasi — tetapi build lama juga belum pernah bisa `ready`, jadi tidak
ada jalur tulis baru yang terbuka di sana.

---

## 9. Dua dokumen untuk satu penerimaan (run 239)

Lensa ini tidak pernah dipakai 16 run sebelumnya (101…237): semuanya menguji
**simpan**, **tampil**, **kesiapan**, **retur**, **waktu/snapshot**, dan
**hapus**. Yang belum diuji: **DUA DOKUMEN pada SATU PENERIMAAN**.

### 9.1 Kenapa ini bisa terjadi (bukan skenario karangan)

1. `purchaseSave.js` membuat SATU dokumen DRAFT otomatis per nota — tetapi
   idempoten **hanya** untuk pembuatan otomatis itu (`select` dulu, baru
   `insert`).
2. Modul Handover punya tombol **"+ Tambah Serah Terima"** yang memilih
   Penerimaan dari daftar. `save.js` mode TAMBAH **tidak** memeriksa apakah
   penerimaan itu sudah punya dokumen yang belum diserahkan → dokumen DRAFT
   kedua bisa dibuat dari UI.
3. `handover_confirm` mengunci `handover:<id>` — **per DOKUMEN**, dan cek kuota
   dijalankan **sebelum** baris `receiving_items` di-`UPDATE` (baris itulah yang
   baru memberi row lock). Dua dokumen = dua kunci berbeda = **tidak saling
   menunggu**.

### 9.2 Bukti di PostgreSQL nyata (`probe_run239_dupdoc.mjs`, 21/21)

| # | Hasil |
|---|---|
| S1 | `handovers` menerima **2 dokumen DRAFT** untuk satu `receiving_id` (memang tidak ada unique index — dan tidak boleh ada, karena serah terima bertahap sah) |
| S2 | **KONTROL berurutan** (commit dulu): dokumen kedua **DITOLAK** `Melebihi alokasi` → aturan kuotanya benar |
| S3 | **BERSAMAAN** (dua koneksi, dua dokumen): **KEDUA** `ok:true`, rincian menjadi **10** untuk kuota tukang **5**, tanpa satu pun error |
| S4 | `v_receipt_progress.belum_diserahkan` menjadi **NEGATIF (−5)**; `qty_handed_over` (5) tidak lagi cocok dengan rincian (10); `check_receipt_qty_consistency()` menandai `qty_handed_over_mismatch` |
| S5 | Sebabnya presisi: transaksi kedua **memegang kunci advisory-nya sendiri** (dokumen berbeda), lalu **menunggu di row lock `receiving_items`** — yaitu **sesudah** cek kuota lewat. Serialisasinya ADA tetapi TERLAMBAT |

### 9.3 Invarian yang ditegakkan aplikasi

> Untuk satu `receiving_id` hanya boleh ada **SATU** dokumen yang **belum
> diserahkan** (`diserahkan_at` kosong) pada satu waktu.

Bukan "satu dokumen selamanya": serah terima **bertahap** sah dan sudah
didokumentasikan (`probe_handover_partial.mjs` H3) — dokumen pertama
dikonfirmasi sebagian → terkunci (CAS) → sisa dicatat lewat dokumen **baru**
untuk penerimaan yang sama. Yang tidak sah adalah **dua dokumen AKTIF
sekaligus**.

`modules/handovers/duplicateGuard.js` (murni, teruji) dipakai **empat lapis**:

| Lapis | Fungsi | Efek |
|---|---|---|
| `save.js` mode TAMBAH | `handoverCreateGuard` | Membaca DB (bukan `rows` memori — bisa basi) **sebelum** insert; gagal baca = **fail closed**, nol tulisan |
| `queue.jsx` | `duplicateInfoFor` + `confirmDuplicateGuard` | Tombol penutup **nonaktif** + badge; jalur tulis `run()`/`submitTerima` **menolak sendiri** |
| `view.jsx` | `confirmDuplicateGuard` | Tombol ✓ desktop **dan** kartu mobile nonaktif (🔒), klik tidak membuka modal |
| `physicalHost.jsx` | `confirmDuplicateGuard` | **Satu choke point**: modal dibuka programatik pun yang dirender adalah penolakan, **bukan** form konfirmasi |

Dokumen **kanonik** = yang paling awal dibuat (urutan deterministik
`created_at` → `handover_date` → `id`), sehingga semua layar dan semua render
menunjuk dokumen yang **sama**. Dokumen kanonik tetap boleh dikonfirmasi,
**dengan peringatan** bahwa ada duplikat yang harus dihapus sesudahnya.

### 9.4 RED → GREEN

| Probe | `5b8ff92` (sebelum) | kandidat |
|---|---|---|
| `probe_run239_dup_ui.mjs` | **13 PASS / 24 FAIL** | **37 PASS / 0 FAIL** |
| `probe_run239_dupdoc.mjs` (PG16) | — (defect-nya didokumentasikan) | **21 PASS / 0 FAIL** |

Pada pohon sebelum fix, probe UI mencatat **perilaku nyatanya**: `save.js`
meng-insert dokumen kedua dan menjawab **"Serah Terima berhasil ditambahkan."**,
tombol ✓ membuka modal konfirmasi, dan `physicalHost` merender **form**.

### 9.5 Batas yang diakui

- Ini penjaga **APLIKASI**. Panggilan RPC langsung (SQL manual / service-role)
  tetap bisa membuat dokumen kedua lalu mengonfirmasinya.
- Perbaikan di level database ada di tangan schema owner `t_03b41644`, dua
  pilihan (pilih salah satu):
  1. **Kunci per PENERIMAAN**: `pg_advisory_xact_lock(hashtext('handover:rec:' || v_ho.receiving_id))`
     di `handover_confirm` — dua dokumen pada penerimaan yang sama jadi
     berurutan, dan cek kuota dokumen kedua melihat tulisan yang pertama.
  2. **Ambil row lock LEBIH DULU**: `select … from receiving_items where id = any(…) for update`
     **sebelum** loop validasi kuota, sehingga cek kuota terjadi sesudah
     serialisasi.
  Opsi 2 lebih murah (tanpa kunci tambahan) tetapi harus mengunci **semua**
  baris yang terlibat sebelum validasi; opsi 1 lebih sederhana dan sesuai pola
  `receipt:`/`return:` yang sudah dipakai.
- Tidak ada unique index yang ditambahkan: `(receiving_id) where diserahkan_at is null`
  **tidak bisa** dipakai karena serah terima bertahap sah, dan partial unique
  index akan memblokir dokumen baru yang sah setelah dokumen lama diserahkan
  **hanya bila** predikatnya tepat — itu keputusan schema owner, bukan aplikasi.

---

## 9A. Penjaga yang SAMA, tetapi membaca DATABASE (run 243)

Review independen run 242 membuktikan bahwa §9 di atas **belum menegakkan**
invariannya dalam dua keadaan nyata di lapangan. Empat temuan (V1–V4) dan
perbaikannya:

| # | Temuan run 242 (di pohon `323bfed`) | Perbaikan run 243 |
|---|---|---|
| **V1** | Semua 8 titik panggil penjaga konfirmasi memakai `ctx.rows` (hasil `loadAll()` saat halaman dimuat). Halaman tanpa realtime & tanpa refresh saat tab kembali fokus → dokumen yang dibuat admin lain **tidak terlihat**; dokumen duplikat bisa dikonfirmasi (`probe_run242_stalerows` S2/S3, `stale_write2` W2: `diserahkan_at` terisi pada dokumen non-kanonik) | `guardConfirmFresh()` membaca `handovers` **dari DB** tepat sebelum menulis. Dipakai di `physicalHost` (satu choke point), `queue.run()`, `queue.submitTerima`, `view.rowActions`, `view.mobileCard`. `ctx.rows` **hanya** untuk tampilan (badge/tombol) |
| **V2** | `save.js` = SELECT-lalu-INSERT tanpa kunci. Dua sesi bersamaan sama-sama lolos (`probe_run242_duprace`: kedua insert diterima, nol error, 2 dokumen aktif) | `insertUniqueActiveHandover()`: baca DB → INSERT → **baca DB LAGI** → bila ada dokumen aktif yang lebih awal, baris yang baru dibuat **menarik dirinya sendiri** (CAS `diserahkan_at IS NULL`) |
| **V3** | Rantai penuh: dua dokumen → **KEDUA** `handover_confirm` diterima → rincian 2× kuota, `belum_diserahkan` negatif (`probe_run242_chain2`) | Ditutup dari dua arah: konvergensi pada pembuatan (V2) **dan** penolakan konfirmasi non-kanonik dari DB (V1) |
| **V4** | Form Tambah menawarkan **semua** penerimaan, termasuk yang sudah punya dokumen aktif; admin baru ditolak setelah menekan Simpan | `loadActiveReceivingIds()` menandai + menonaktifkan pilihan itu (`🔒 … sudah ada Serah Terima aktif`); kegagalan probe dinyatakan jujur, bukan pura-pura aman |

### 9A.1 Kenapa INSERT → VERIFIKASI → TARIK DIRI itu benar

Tanpa DDL (card ini tidak boleh menjalankan SQL) dan tanpa unique index
(§9.5), dua INSERT bersamaan tetap **mungkin** terjadi. Yang bisa dijamin
aplikasi adalah **konvergensi**, bukan tidak adanya jendela:

> Setiap penulis membaca ulang **sesudah commit-nya sendiri**, memakai urutan
> kanonik yang **sama** (`created_at` → `handover_date` → `id`), lalu yang
> bukan kanonik menghapus barisnya sendiri.

**Tidak mungkin dua-duanya bertahan.** Agar A tidak melihat B, baca A harus
sebelum commit B; agar B tidak melihat A, baca B harus sebelum commit A.
Karena baca A sesudah commit A dan baca B sesudah commit B, kedua syarat itu
berarti `commit A < commit B < baca B < commit A` — kontradiksi. Jadi paling
sedikit satu penulis **selalu** melihat yang lain, dan karena urutannya total,
hanya **satu** yang bertahan.

### 9A.2 Keadaan yang ditampilkan saat pemeriksaan belum/tidak bisa dilakukan

`physicalHost` tidak pernah merender form konfirmasi sebelum keputusan ada:

| Keadaan | Yang dirender | Boleh menulis? |
|---|---|---|
| `dup === null` (pemeriksaan berjalan) | panel `handover-confirm-dup-checking` | **Tidak** |
| `dup.failed` (baca DB gagal / RLS) | panel `handover-confirm-dup-check-failed` + tombol **🔄 Periksa ulang** | **Tidak** |
| `dup.ok === false` (duplikat) | panel `handover-confirm-dup-blocked` | **Tidak** |
| `dup.ok === true` | form konfirmasi per barang | Ya (RPC tetap memutuskan kuota) |

### 9A.3 RED → GREEN

| Probe | `323bfed` (sebelum) | run 243 |
|---|---|---|
| `probe_run243_dupfresh.mjs` | **14 PASS / 33 FAIL** | **47 PASS / 0 FAIL** |
| `receipt-physical-test` (167) + probe 206/208/215/222/233/234/237/239 | hijau | hijau (tidak ada regresi) |

Probe 242 milik reviewer dijalankan ulang **apa adanya** pada pohon run 243
untuk memastikan temuan mereka benar-benar tertutup, bukan diakali.

### 9A.4 Batas yang diakui (tidak disembunyikan)

- **Jendela singkat "dua baris sempat ada" tetap ada** (insert → verify →
  delete = 3 round-trip). Yang hilang bukan jendela itu, melainkan **keadaan
  akhir ganda**. Bila peramban penulis yang kalah mati di antara insert dan
  verify, baris duplikat bisa tertinggal — karena itu lapis kedua (V1) tetap
  wajib: konfirmasi dokumen non-kanonik **ditolak dari DB**, sehingga sisa
  duplikat tidak bisa menjadi penyerahan fisik ganda.
- Perbaikan sejati di level database tetap milik schema owner `t_03b41644`
  (§9.5 opsi 1/2: kunci `handover:rec:<receiving_id>` atau row lock
  `receiving_items` **sebelum** cek kuota). Rekomendasi itu **tidak berubah**
  dan **tidak diklaim selesai** di sini.
- Penarikan diri memakai `delete` ber-CAS pada baris yang **baru saja dibuat
  sendiri** (bukan ID dari input pengguna). Jalur itu diperiksa oleh
  `probe_run237_shell_wiring` W7: setiap `.delete()` pada `handovers` di
  `components/ modules/ lib/` harus menunjuk `inserted.id` **dan** memakai
  `.is('diserahkan_at', null)`; kalau tidak, probe GAGAL.
- Diuji di jsdom + mock perekam (bukan Supabase nyata) untuk jalur aplikasi;
  dua koneksi bersamaan diuji di PG16 **lokal** (`probe_run242_duprace` milik
  reviewer, bukan probe ini). Latensi/pooler Supabase hanya **memperbesar**
  jendela, dan justru itu yang ditutup oleh verifikasi-sesudah-commit.
