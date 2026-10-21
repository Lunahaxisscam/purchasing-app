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

---

## 7. Urutan aktivasi (setelah schema owner menjalankan DDL)

```
1. backup consistent + restore drill lulus        (BACKUP_RUNBOOK_v2)
2. apply migrasi 00→05 + readback SQL              (MIGRATION_MANIFEST §5)
3. probe aplikasi (TTL 60s) → ready=true, returnReady=true   [tanpa deploy]
4. merge branch ini + patch COMPATIBILITY_CUTOVER §3
5. deploy
6. transaksi NYATA pertama oleh Novi (bukan fixture)
```

Langkah 3 aman sebelum langkah 4: selama build produksi belum memuat
`receiptCapability`, tidak ada UI yang memakai tabel baru.
