# Laporan Bagian 2 — Receiving, Vendor Pembelian, Handover, Retur (t_7bc6246b)

Tanggal: 21 Okt 2026 · Branch `feat/receipt-ledger-t_7bc6246b` @ `413441b`
Base: `origin/main` **4a92bec** (produksi) · Push terverifikasi `git ls-remote`

---

## 1. Ringkasan

Blueprint bagian 2 ("proses yang bisa dibuat lebih singkat") dieksekusi pada
**kode produksi aktual**, bukan pada branch lama. Empat penyederhanaan:

| # | Penyederhanaan | File |
|---|---|---|
| 1 | PR multivendor → pembelian per vendor/nota, jejak PR tetap | `modules/receivings/page.jsx` |
| 2 | Satu form Terima Barang per item (datang/rusak/tujuan/retur/foto opsional) | `modules/handovers/receiptForm.jsx` |
| 3 | Alokasi tukang prefill Handover; konfirmasi fisik terpisah per item | `modules/handovers/confirmForm.jsx` |
| 4 | Retur dari item rusak tanpa ketik ulang | `modules/handovers/returnForm.jsx` |

**Tidak ada** SQL dijalankan, tidak ada deploy, tidak ada perubahan auth/RLS,
tidak ada data legacy dihapus, nomor proyek draft-vs-issued tidak diaktifkan.

---

## 2. Keputusan penting: branch lama TIDAK dipakai

Branch `feat/receiving-simplify/t_7bc6246b` (commit `b1b8810`) berisi
`modules/receivings/receiptForm.jsx`, `view.jsx`, `receiptSave.js` — **file itu
sudah tidak ada di produksi**. Sejak `t_9109cf5e` modul Pembelian menjadi
halaman sendiri (`page.jsx`) dan seluruh UI fisik pindah ke Handover
(arahan DAT 18 Okt: *"physical UI lives ONLY in Handover now"*).

Karena itu: logika murni, kontrak RPC, dan capability probe **dipakai ulang
dari branch lama** (dengan koreksi), tetapi UI ditulis ulang untuk integrasi
sekarang. Kalau branch lama di-merge apa adanya, aplikasi akan pecah.

### Koreksi yang dilakukan atas branch lama

| # | Temuan | Perbaikan |
|---|---|---|
| 1 | `receiptLogic.js:51` menghitung `sisa` dari `quantity_received` (QTY BELI) | `qty_arrived` (QTY DATANG) — sesuai `COMPATIBILITY_CUTOVER.md` |
| 2 | `v_receipt_progress` dianggap opsional | **WAJIB** untuk `ready` (tanpa view, form salah hitung sisa) |
| 3 | `problemPlan` memblokir retur multi-item karena "skema belum ada" | saat `returnReady`, retur per barang dibuka (bukan diblokir) |
| 4 | Mock harness mengembalikan `[]` untuk tabel tak dikenal | mock menjawab **PGRST205** — kalau tidak, capability probe menyimpulkan "siap" padahal tidak |
| 5 | Retur bisa dicatat dua kali (bug review run 101) | `return_lines` wajib dibaca; tak terbaca → modal menolak |

---

## 3. Bukti pengujian

### 3.1 RPC terhadap PostgreSQL NYATA (bukan mock) — **47 PASS / 0 FAIL**

Menutup persis alasan run 101 memblok: *"Path READY belum pernah diuji
terhadap tabel sungguhan."*

Cluster PostgreSQL 16 terisolasi (`initdb` sendiri, port 55434), database
`receipt_ledger_t7bc`, memakai **migrasi 00..04 milik `t_03b41644`**.
Payload event dibentuk **modul aplikasi verbatim** (hasil transform SWC).
RPC dipanggil lewat `pg` dengan nama parameter PostgREST.

| Bukti | Hasil |
|---|---|
| signature `p_receiving_id/p_events/p_meta` diterima | ok, `applied=2` |
| `qty_arrived`=6 sementara `quantity_received` **tetap 10** | dua arti tidak tercampur |
| submit ulang → `applied=0`, `already_applied=2`, event tetap 2 | idempoten nyata |
| over-receipt → `reason=over_receipt`, nol tulisan | validasi server |
| `handover_confirm` → CAS + 2 `handover_items` + `qty_handed_over=1` | tersimpan |
| konfirmasi kedua → `already=true`, baris tetap 2 | anti dobel |
| quota tukang dilanggar → **CAS rollback** (`diserahkan_at` NULL) | atomik |
| retur kedua melebihi saldo → `over_return`, `return_lines` tetap 1 | anti double-cost |
| retur tidak mengubah `quantity_received`/`qty_arrived` | anti double-cost |
| anon **0 grant**, RLS aktif 4 tabel, **0 policy tulis** | tulis hanya RPC |

Jalankan ulang: `python3 scripts/receipt-ledger-db-test/run.py` — sekarang juga
menjalankan matriks retur (5) dan resolusi retur (6): **47 + 14 PASS / 0 FAIL**.

### 3.2 UI nyata (jsdom interaktif) — **123 PASS / 0 FAIL**

`python3 scripts/receipt-physical-test/run.py`

Membuktikan: satu form per item; foto opsional tidak memblokir; sisa dari
`qty_arrived`; mode LEGACY nol tulisan; mode READY → tepat satu RPC;
double-click → satu RPC; over-receipt ditolak sebelum RPC; prefill konfirmasi
= alokasi − sudah diserahkan; retur tidak menawarkan event yang sudah diretur;
riwayat retur tak terbaca → modal menolak; tombol Terima Barang ada di banner
**dan** aksi baris; kontrak DAT "tepat 3 aksi fisik" tetap utuh.

### 3.3 Regresi

| Suite | Hasil |
|---|---|
| handover-flow-test | logic 61/61 · queue 66/66 · render 73/73 |
| handover-compact-test | queue_ui 89/89 · purchase_scope 50/52 (status quo main) |
| purchase-flow-test | logic 218/218 · render 105/105 |
| flow-logic 29 · fase2-save 56 · approval-queue 60 · vendors 25 | hijau |
| material-acuan 96 · pr-estimator 49+14 · pr-group 31+59 | hijau |
| `next build` | hijau |

**`purchase_scope_test` B4c/B4c2 gagal 2** — sudah ada di `origin/main`
sebelum perubahan ini (diverifikasi dengan `git stash`), bukan regresi.

**Assertion yang diubah:** `purchase-flow-test` C11b/C11e. Keduanya mengunci
perilaku yang **berlawanan** dengan arahan DAT (semua barang lintas toko masuk
SATU nota → nota berlabel satu vendor padahal isinya campuran). Diganti
assertion yang lebih ketat: nota dibuka per vendor, isi konsisten dengan
vendornya, dan sisa vendor tetap diantrekan.

---

## 4. Status live — aplikasi masih LEGACY (jujur)

### 4.1 Dua defect ditemukan pada review run 188 dan SUDAH diperbaiki

Review independen (menjalankan modul terkompilasi dengan input tidak lazim,
bukan menambah assertion di jalur yang sudah "benar") menemukan dua defect yang
**menyala hari ini di mode LEGACY** — keduanya tidak terlihat oleh harness yang
sudah hijau:

| # | Defect | Dampak | Fix |
|---|---|---|---|
| 1 | `<PurchaseForm>` tanpa `key` → `useState` tidak re-init saat antrean pindah vendor | UI bilang "Lanjut nota vendor berikutnya", tapi form tetap vendor + barang + nomor nota #1. Simpan lagi = nota kedua untuk vendor yang SAMA; barang vendor berikutnya tidak pernah jadi nota | `key` deterministik (`vendorId` + daftar baris) |
| 2 | Satu-satunya `<PhysicalModalHost>` dirender di dalam banner, banner `return null` saat antrean kosong | Tombol 📥 di aksi baris tetap aktif tapi tidak berefek sama sekali (tanpa pesan) bila semua handover sudah `diserahkan_at` | Host dirender di luar guard antrean |

Harness pengunci (permanen, bisa dijalankan ulang):

```
node scripts/purchase-flow-test/repro_vendor_queue_advance.mjs   9 PASS / 0 FAIL
node scripts/receipt-physical-test/repro_host_v3.mjs              8 PASS / 0 FAIL
node scripts/receipt-physical-test/probe_confirm_partial.mjs      7 PASS / 0 FAIL
```

### 4.2 Defect ditemukan pada review run 195 (tindakan retur) — SUDAH diperbaiki

Review run 195 menguji **sambungan** modal retur → RPC pada PostgreSQL nyata,
bukan menambah assertion di jalur yang sudah hijau. Dua defect menyala begitu
migrasi dijalankan (mode READY):

| # | Defect | Bukti (PG nyata) | Fix |
|---|---|---|---|
| 3 | Dropdown "Tindakan" selalu 4 pilihan untuk semua baris | Event `PENDING` + pilih **Dibuang** → RPC menolak `discard_not_confirmed`. Admin melihat tombol aktif, menekan Simpan, **pasti gagal** | `allowedResolutionsFor()` → hanya tindakan sah; yang tidak sah **dijelaskan** |
| 4 | Barang **sudah dibuang** masih ditawari "Kembalikan ke supplier" | Event `DISCARDED` + pilih **RETURN** → RPC **menerima** dan mengubah `retur_status` jadi `PENDING` (barang yang sudah dibuang seolah menunggu dikembalikan) | Event `DISCARDED` hanya boleh `DISCARD`; gabungan status berbeda tidak bisa disimpan (UI minta dipisah) |

Harness pengunci:

```
probe_retur_resolution.mjs   14 PASS / 0 FAIL   (PG16 nyata, migrasi 00..04)
T6a–T6k                      11 assertion        (jsdom, RED dulu di kode lama)
```

Bukti RED: pada kode `0a423ac` lima assertion T6 gagal (`Dibuang` muncul di
daftar untuk event PENDING; `RETURN` muncul untuk event DISCARDED).

### 4.3 Defect ditemukan pada review run 199 (batas kedatangan & koreksi) — SUDAH diperbaiki

Review run 199 menguji **rantai form → payload → RPC** (PG16 nyata + migrasi
00..04), bukan menambah assertion di jalur yang sudah hijau. Empat defect
menyala begitu migrasi dijalankan (mode READY):

| # | Defect | Bukti | Fix |
|---|---|---|---|
| 5 | Pilihan retur (`SUPPLIER`/`DIBUANG`) saat **rusak = 0** → event terkirim `PENDING/DISCARDED` dengan `retur_qty 0` | RPC `receipt_apply_events` menolak `retur_without_qty`. `validateForm.valid=true`, `validateEventDrafts.ok=true` — admin menekan Simpan lalu **pasti gagal** | Validasi menolak pilihan retur tanpa qty rusak; `buildEventDrafts` menormalkan status ke `NONE` bila rusak 0; `validateEventDrafts` mencerminkan aturan server |
| 6 | Baris **cangkang Approval** (`quantity_received = 0`) tampil di form dengan `sisa = qty pesanan` | RPC **menerima** kedatangannya: `BELI 0 / DATANG 5`. **Di data live 6 dari 6 baris `receiving_items` ber-qty 0** | `buildRows` menandai `notBought`; `validateItem` menolak; `buildSavePlan` tidak pernah memuatnya; UI memberi label "Belum dibeli" |
| 7 | `sisa` dihitung dari **qty pesanan PR**, bukan qty BELI baris nota | Nota membeli 3 dari pesanan 5 menawarkan sisa 5 → `DATANG 5 > BELI 3` diterima. Untuk beli langsung tanpa PR, `sisa = null` → **tanpa batas sama sekali** | Batas atas = `quantity_received` baris; bila NULL (data lama) pakai qty pesanan + UI menandai `boughtKnown:false` |
| 8 | **Koreksi** isian pada submit ulang hilang tanpa peringatan | `client_event_id` = `rcpt:{rec}:{item}:{prevCum}->{prevCum+datang}`. Qty datang sama + rusak/tujuan berbeda → id sama → RPC `applied=0, already_applied=1`, perubahan tidak tersimpan, UI hanya bilang "sudah pernah tercatat" | `findSameEvents()` membandingkan isian dengan event tersimpan: identik → replay (aman); berbeda → **ditolak** dengan kolom yang berbeda disebut, karena RPC koreksi belum ada di kontrak schema owner |

Harness pengunci:

```
probe_receipt_guards.mjs     18 PASS / 0 FAIL   (PG16 nyata, migrasi 00..04)
R8a–R8f, R9a–R9d             10 assertion        (logika murni, jsdom)
S1a–S1e, S2a–S2c, S3a–S3b     8 assertion        (jsdom, jalur simpan asli)
```

Bukti RED: pada kode `bc200b0` probe yang sama memberi **6 PASS / 12 FAIL**
(G1a/G1b/G1d/G1e, G2a–G2d, G3a/G3b/G3d/G3e gagal), dan tidak ada satu pun
assertion yang dilonggarkan — tiga di antaranya (`R3d`, `R7b`, `R8a`) justru
diperketat karena perilaku lama yang "benar" ternyata mengunci arti yang salah.

**Temuan proses (kejujuran harness).** Mock `receipt_apply_events` selalu
menjawab `ok:true`, sehingga ketiga defect pertama **tidak mungkin terlihat**
di jsdom. Mock kini menolak `retur_status != NONE` dengan `retur_qty <= 0`
seperti server sungguhan, dan mock `select` menghormati filter
`client_event_id` (sebelumnya mengembalikan SEMUA baris sehingga setiap submit
akan tampak "sudah ada").

### 4.4 Batasan skema yang TETAP ada (bukan bug UI)

**Satu dokumen Serah Terima = satu waktu penyerahan.** `handover_confirm`
melakukan CAS pada SATU dokumen (`diserahkan_at`). Setelah dokumen disimpan,
baris yang belum diserahkan **tidak bisa ditambahkan ke dokumen itu** —
panggilan kedua menjawab `already=true`, nol tulisan. Sisanya dicatat lewat
**dokumen Serah Terima baru** untuk penerimaan yang sama (kuota tukang
dihitung per event lintas dokumen, dibuktikan di PostgreSQL nyata oleh
`probe_handover_partial.mjs` H3). Ini konsekuensi kontrak RPC milik
`t_03b41644`; UI sekarang **mengatakannya sebelum simpan**, bukan setelah.

**Koreksi penerimaan belum ada.** `receiving_events.reversal_of` ada di skema,
tetapi tidak ada RPC penulisnya. Akibatnya keputusan retur yang diambil saat
barang dicatat datang **tidak bisa diubah** sesudahnya: `client_event_id`
deterministik membuat "isian ulang" menghasilkan event baru (kedatangan
bertambah) atau replay yang diabaikan. Dibuktikan di PostgreSQL nyata oleh
`probe_retur_deadend.mjs`.

### 4.5 Dua jalan buntu yang diperbaiki di run 202

Keduanya ditemukan dengan menguji **rantai keputusan** (apa yang ditawarkan UI →
apa yang diterima server), bukan dengan menambah assertion di jalur yang sudah
hijau. Harness run 199 (153 jsdom, 47+14+18 DB) **hijau sebelum perbaikan** —
pola yang sama dengan run 101/188/190/195/199.

| # | Defect | Bukti sebelum fix | Sesudah |
|---|---|---|---|
| E | **Satu barang yang belum tiba memblokir SELURUH serah terima.** `validateHandoverLines` menolak qty 0 sebagai error, jadi 2 barang yang sudah diterima tukang tidak bisa dicatat. Admin terdorong mengisi angka palsu supaya bisa menyimpan. | `probe_handover_partial` H2: `ok=false`, `lines=[]` walau 2 baris lain valid | qty kosong = **dilewati**; `skipped` + `remainder` dilaporkan, peringatan "dokumen terkunci → catat di dokumen baru" tampil **sebelum** simpan |
| F | **Modal retur menyuruh hal yang mustahil.** Panel "Belum bisa diretur" berbunyi *"Buka Terima Barang … pilih Kembalikan ke supplier — setelah itu barisnya muncul di sini"*. Instruksi itu tidak bisa dijalankan: tidak ada RPC koreksi, dan id deterministik membuat isian ulang = event baru / replay. | `probe_retur_deadend` R1–R4: event lama tetap `NONE`, event baru muncul dengan DATANG bertambah, tidak ada fungsi koreksi di katalog | panel menjelaskan keputusan retur **tidak bisa diubah lagi**, menyebut koreksi penerimaan belum didukung, dan tetap menyarankan pilihan yang benar untuk kedatangan berikutnya |

Bukti RED → GREEN (bukan klaim): `receipt_physical_test` pada kode **sebelum**
perbaikan → **5 FAIL** (C6a–C6e) dan **3 FAIL** (T5m–T5o); sesudah → **153 PASS / 0 FAIL**.


Probe read-only (`node scripts/receipt-physical-test/probe_live.mjs`, anon key):

```
receiving_events    PGRST205   handover_items      PGRST205
return_lines        PGRST205   v_receipt_progress  PGRST205
ready = false · returnReady = false · mode UI = LEGACY
```

Data live utuh: receivings 6 · receiving_items 6 · handovers 1 ·
purchase_requests 16 · pr_items 60 · vendors 22.

**Artinya:** hari ini yang aktif adalah (1) pemecahan nota per vendor dan
(2) seluruh alur dokumen Handover yang sudah ada. Form per barang, konfirmasi
per item, dan retur **belum menyimpan** — tombolnya menampilkan alasan, bukan
klaim palsu.

---

## 5. Batasan & blocker

| Hal | Status |
|---|---|
| DDL ke Supabase | **belum** — `applied=0`; owner tunggal `t_03b41644`, butuh credential + backup/restore drill |
| RLS terhadap user Novi nyata | belum diuji E2E (policy diuji mekanis) |
| Fixture DB | sintetis, bukan dump produksi |
| Nomor proyek draft-vs-issued | tidak diaktifkan (belum diputuskan DAT) |
| Deploy | belum — menunggu review Brooklyn |
| Browser PC | **tidak dipakai** (sesuai batas `t_491eece0`) |
| `v_receipt_progress` grant | **BELUM ada** untuk role `authenticated` di paket migrasi `t_03b41644` — lihat 5.1 |

### 5.1 Temuan run 202 untuk schema owner: grant view belum ada

Diuji di cluster PG16 setelah migrasi 00..04 (bukan opini):

```
set role authenticated; select count(*) from public.v_receipt_progress;
  ERROR: permission denied for view v_receipt_progress
```

Empat tabel ledger punya `GRANT SELECT … TO authenticated`; **view tidak**.
`information_schema.role_table_grants` untuk `v_receipt_progress` hanya berisi
`postgres` — nol grant untuk `authenticated`.

Dampak nyata: `receiptCapability.probeTable('v_receipt_progress', …)` menerima
error `permission denied` (bukan PGRST205), sehingga `progress.ok=false` →
`ready=false` **selamanya**, walaupun DDL sudah dijalankan. Artinya mode READY
tidak akan pernah menyala tanpa grant ini. Ini **bukan** sesuatu yang bisa
diperbaiki dari kode aplikasi (dan tidak boleh: grant adalah keputusan schema
owner), jadi dilaporkan ke `t_03b41644` — bukan ditambal di sini.

Catatan lain yang juga diverifikasi: RPC (`receipt_apply_events`,
`handover_confirm`, `return_create`) **bisa** dipanggil sebagai
`authenticated` (bukan permission denied), dan keempat tabel ledger bisa
dibaca. Jadi yang kurang hanya grant pada view.

### 5.2 Temuan run 206 — 5 defect yang membuat fitur MUSTAHIL terlihat

Run 202 menutup dua jalan buntu. Run 206 menguji **rantai tampilan**, bukan
hanya rantai simpan: apa yang benar-benar bisa DILIHAT pengguna setelah data
tersimpan. Lima defect ditemukan; semuanya diperbaiki di commit run 206.

| # | Defect | Bukti sebelum fix | Sesudah |
|---|---|---|---|
| G | **`handover_items` tidak pernah dibaca halaman.** `pages/index.js` `loadAll` hanya memuat tabel `handovers`; `display.rincianInfo()` menunggu `handover.items` yang tidak pernah diisi. Jadi walau RPC `handover_confirm` menulis rincian, daftar/detail/modal SELALU berbunyi "Rincian barang belum tersedia". | `probe_handover_items_visible` P5/P6/P8 gagal pada kode lama; `Object.keys(handoverRow)` dari `select('*')` tidak punya `items` | `loadAll` membaca `handover_items` (best-effort, tidak memblokir halaman) dan menempelkan `items` hanya bila ada barisnya. Diuji di PG16 nyata: **11 PASS / 0 FAIL** |
| H | **Tombol penutup "Tandai Diserahkan" mati di mode READY.** `actionPlan` menilai `summary.done` dari `pr_items.status` (DI_GUDANG/DI_TUKANG). Alokasi ke tukang sekarang dicatat di `receiving_events.tujuan_tukang` dan TIDAK mengubah status pr_items → tombol selalu "Belum ada barang yang didistribusikan", sehingga konfirmasi per barang mustahil dibuka dari antrean. | probe A1: `disabled=true`, title "Belum ada barang yang didistribusikan (gudang/tukang)" walau 2 barang sudah dialokasikan | Di mode READY gerbang aksi TERIMA diserahkan ke modal konfirmasi (yang punya jalur untuk semua keadaan: baris prefill / header-only / tolak jelas). probe A1–A3 hijau |
| I | **Tombol ✓ di baris melewati konfirmasi per barang.** `view.rowActions` memanggil `onMarkHandoverDelivered` langsung (window.confirm + tulis header). Di mode READY itu mengunci dokumen (CAS `diserahkan_at`) tanpa menulis rincian — rincian untuk dokumen itu tidak akan pernah bisa dicatat. | probe B2/B3: `legacyCalled=1`, modal tidak terbuka | ✓ (desktop + mobile) membuka modal konfirmasi yang sama; konfirmasi header tetap tersedia di dalam modal saat skema belum ada |
| J | **Modal retur menuduh data rusak saat admin belum memilih apa pun.** Dengan semua centang dilepas, `allowed` kosong → panel "tidak punya tindakan yang sah — datanya tidak konsisten: berstatus sudah dibuang tetapi konfirmasi buang tidak tercatat", padahal datanya normal. | probe C2: pesan itu muncul untuk 1 baris PENDING yang sehat | Panel diagnostik hanya tampil bila ADA baris terpilih; keadaan "belum memilih" dijelaskan apa adanya (`return-none-selected`) |
| K | **Nama berkas lokal dikirim sebagai `foto_ref`.** `buildEventDrafts` mengirim `file.name` ("IMG_20261021_0912.jpg"), padahal `foto_ref` di kontrak schema = path/ID arsip. Baris DB tampak punya bukti foto padahal berkas tidak pernah diunggah; UI tidak pernah menyatakannya (hanya muncul sebagai "konflik" saat submit ulang). | probe D2: `foto_ref="IMG_20261021_0912.jpg"` di payload RPC | `foto_ref` hanya diisi bila ada referensi nyata (`foto.ref`); peringatan "tidak ikut tersimpan" tampil per baris SEBELUM simpan |

Bukti RED → GREEN: `receipt_physical_test` pada kode **sebelum** perbaikan →
**7 FAIL** (S3a, S3b, X1a, X2b, X2c, X3a, X3b); sesudah → **167 PASS / 0 FAIL**.
Probe adversarial (`probe_run206_adversarial.mjs`, 16 cek) dijalankan otomatis
oleh `run.py` di sandbox yang sama.

**Batasan yang tetap (jujur):** unggah foto ke arsip Drive/Storage **belum
ada**, jadi `foto_ref` selalu `null` dan UI mengatakannya. Ini bukan regresi —
sebelumnya aplikasi *mengirim nama berkas* yang membuatnya tampak tersimpan.

### 5.3 Temuan run 208 — permukaan input per barang yang TIDAK menyimpan

Run 206 memperbaiki rantai tampilan. Run 208 menguji **permukaan layar mana
saja yang masih menerima isian per barang**, dan apakah isian itu tersimpan.
Harness run 206 hijau (167 jsdom + 16 probe + 125 DB) **sebelum** perbaikan —
pola yang sama seperti tujuh run sebelumnya.

| # | Defect | Bukti sebelum fix | Sesudah |
|---|---|---|---|
| L | **Panel "🧪 Prototype" masih hidup di layar detail Handover.** `view.rowExpand` merender `PrototypePanel` di SETIAP baris yang punya `receiving_items`. Panel menerima qty + penerima, lalu menampilkan **"Rencana tercatat (sesi ini)"** — konfirmasi visual bahwa sesuatu tercatat — padahal NOL tulisan DB dan hilang saat reload. | probe P1–P4: panel ada, input `proto-qty`/`proto-add` ada, tombol "Catat (sesi)" ada, teks "Rencana tercatat" muncul | Panel dihapus dari render. Fungsi murni `display.validatePrototypeRow/prototypeTotals` TIDAK dihapus (masih diuji sebagai catatan desain) tetapi tidak lagi bisa diisi pengguna. |
| M | **Angka "diterima" di panel itu = QTY BELI.** Dropdown prototype menampilkan `receiving_items.quantity_received` (10) sebagai "diterima", padahal qty DATANG hanya 6. Semantik yang justru diperbaiki seluruh card ini (`COMPATIBILITY_CUTOVER.md`). | probe Q1: "10 Sak diterima" tampil untuk nota beli 10 / datang 6 | Hilang bersama panel (Q1 hijau). Label di tempat lain tetap "qty beli di nota" (bukan "diterima") |
| N | **Dua jalur untuk satu pekerjaan di layar yang sama.** Di mode READY, panel prototype bersaing dengan konfirmasi NYATA (`confirmForm` → RPC `handover_confirm`) di halaman yang sama — yang satu membuang data. | probe (versi pertama): panel tetap tampil walau `handover.items` hasil konfirmasi nyata sudah ada | Hanya jalur nyata yang tersisa |
| O | **Pesan usang "belum aktif di versi ini (menunggu persetujuan perbaikan skema)".** `display.rincianInfo` memakai kalimat itu untuk handover yang belum punya baris rincian. Sejak skema + UI per barang ada, itu TIDAK BENAR: fiturnya aktif, hanya DATANYA belum dicatat. Admin diarahkan menunggu migrasi yang sudah selesai. | probe R1/R2: notice persis kalimat itu | Notice menjelaskan **cara mencatat** (konfirmasi fisik per barang) dan membedakan "belum dikonfirmasi" dari "tidak terhubung ke penerimaan" |
| P | **Detail antrean selalu bilang "jumlah serah terima per item belum tercatat terpisah".** Benar di mode LEGACY, SALAH di READY — di sana rincian benar-benar ditulis `handover_items` dan dibaca halaman. Pesan "belum ada" untuk fitur yang sudah berjalan. | probe S1/S2 (READY): panel rincian tetap berbunyi "belum tercatat terpisah" | Pesan dipilih per mode: READY → menjelaskan rincian dicatat lewat konfirmasi fisik per barang; LEGACY → pesan lama dipertahankan (probe T1/T2) |

Bukti RED → GREEN: probe `probe_run208_prototype.mjs` (15 cek) dijalankan pada
kode **`c5781fc`** (sebelum fix) → **8 FAIL** (P1, P2, P3, Q1, R1, R2, S1, S2);
pada kode sesudah fix → **15 PASS / 0 FAIL**. Probe dijalankan otomatis oleh
`scripts/receipt-physical-test/run.py`.

**Assertion yang diubah (2, keduanya mengunci perilaku yang salah):**

| Suite | Assertion | Alasan |
|---|---|---|
| `handover-flow-test/render_test` | R3h/R3i/R3j/R3k (prototype tampil, isi qty, "tercatat di sesi") | Mengunci panel yang membuang data. Diganti R3h–R3k baru: panel TIDAK dirender, tidak ada input tanpa penyimpanan, notice menyebut cara mencatat, nol mutasi DB |
| `handover-flow-test/logic_test` | H2d ("notice menyebut skema belum aktif") | Mengunci pesan usang. Diganti H2d/H2d2: notice menjelaskan cara mencatat & tidak menyuruh menunggu skema |

**Catatan penting untuk reviewer:** ini bukan "menambah assertion di jalur yang
sudah benar". Yang diuji adalah **permukaan layar yang tidak pernah diperiksa
harness mana pun** — panel prototype tidak punya assertion render sama sekali
sebelum run 208 (hanya fungsi murninya yang diuji di `logic_test` H4a–H4l,
dan itu tetap hijau karena fungsinya memang benar; yang salah adalah
**merendernya ke pengguna**).

---

### 5.4 Temuan review run 212 — 3 defect yang HANYA aktif saat READY (R1/R2/R3)

Review independen run 212 memblok task ini dengan dua MAJOR + satu MEDIUM.
Semuanya **laten di `origin/main`** dan **dipersenjatai** oleh aktivasi READY
di branch ini — jadi wajib ditutup **sebelum** migrasi/grant dijalankan.

| # | Defect | Akar masalah | Perbaikan |
|---|---|---|---|
| **R1** | Jendela `capability = null` (probe belum selesai) menulis `status=CONFIRMED` + `diserahkan_at` **tanpa** satu pun baris `handover_items`, lalu mengunci dokumen permanen (CAS `diserahkan_at IS NULL`) | `const ready = !!capability?.ready` menyamakan `null` dengan LEGACY. Dua form lain aman; hanya `confirmForm` yang jalur LEGACY-nya **menulis** | `capabilityState()` dengan **tiga** keadaan: `unknown` (null) / `error` (probe gagal) / `legacy` / `ready`. Saat `unknown`/`error`: input LEGACY tidak dirender, tombol tulis **disabled** + label "Memeriksa kesiapan skema…", dan `submit()` menolak menulis |
| **R1b** | Probe **gagal** (RLS/jaringan) juga disimpulkan LEGACY — padahal `permission denied` pada `v_receipt_progress` adalah blocker nyata card ini | `probeTable()` menganggap SEMUA error selain "tabel tidak ada" sebagai "belum siap" | Error non-konklusif ditandai `indeterminate` → `probeFailed:true`; UI menampilkan "pemeriksaan GAGAL + sebabnya", tetap **nol tulisan** |
| **R2** | `ACT_GUDANG`/`ACT_TUKANG` di mode READY menulis `pr_items.status` untuk **SEMUA** baris nota → menimpa tujuan per barang dari ledger (Cat Duco tujuan Tukang ikut jadi DI_GUDANG) | Run 206 hanya memasang gerbang `ledgerReady` untuk `ACT_TERIMA` | Gerbang `ledgerReady` yang sama untuk gudang/tukang: tombol **tetap terlihat** tetapi nonaktif dengan alasan terbaca, **plus** pertahanan kedua di `run()` sehingga klik programatik pun ditolak. LEGACY tidak berubah (tetap satu-satunya jalur) |
| **R3** | Label "Masuk **Stok** Gudang" mengklaim stok bertambah, padahal `actions.kirimKeGudang` tidak memanggil RPC `receive_to_warehouse` (`materials.current_stock` tidak berubah) | Label & pesan sukses menjanjikan efek yang tidak terjadi | Label → "Tandai Masuk Gudang"; pesan sukses menyatakan eksplisit **"Stok material TIDAK bertambah dari sini"** |

**Bukti RED → GREEN (bukan klaim).** Probe baru
`scripts/receipt-physical-test/probe_run215_review_fixes.mjs` (39 cek) dijalankan
pada **dua** pohon:

| Pohon | Hasil |
|---|---|
| `340a319` (kandidat sebelum fix, worktree terpisah) | **16 PASS / 25 FAIL** — A2/A3/A4/A5/A6/A7/A10/A11 (R1), B1–B4 (R1b), D2–D11 (R2), F1/F5 (R3) |
| sesudah fix | **41 PASS / 0 FAIL** |

Probe ini juga mengunci hal yang **tidak boleh** ikut berubah: LEGACY asli
(`ready:false` hasil probe) tetap punya input nama penerima, tombol tulis aktif,
dan tetap menulis header (C1–C5); aksi borongan LEGACY tetap aktif dan tetap
menulis `DI_GUDANG` (E1–E3).

**Probe reviewer run 212 dijalankan ulang di pohon fix** — keempatnya sekarang
gagal **hanya** pada assertion yang mendokumentasikan defect (inversi yang
benar): `capstate` 9P/5F (S3a/S3b/S5a/S5b/S5c), `capunknown` 8P/6F
(U1a/U1c/U1d/U2a/U2c/U2e), `bulk` 5P/4F (K1c/K1d/K1e/K2c), `bulk2` 5P/2F
(M1a/M1b). Tidak ada assertion yang dilonggarkan — probe milik reviewer
sengaja **tidak** diubah.

**Lanjutan R2 yang ikut ditutup:** `summarizeDistribution`/`distributionLabel`
membaca `pr_items.status` — dimensi yang di READY **tidak lagi ditulis siapa
pun**, jadi ringkasan kartu akan selalu berbunyi "0 dari N barang
didistribusikan". Di READY ringkasan diganti kalimat yang mengarahkan ke
sumber yang benar ("Distribusi dicatat per barang — lihat Terima Barang
(tujuan) & konfirmasi fisik"); di LEGACY label lama dipertahankan apa adanya.
Dikunci D10/D11.

**Perbaikan tambahan yang ditemukan saat memperbaiki R1:** `loading`
diinisialisasi `useState(ready)`. Saat capability berubah `null → ready` dalam
satu mount (persis alur `physicalHost`), `loading` tetap `false` selama satu
render sehingga panel "tidak ada alokasi tukang" + tombol header-only **sempat
aktif** sebelum baris termuat. Kini `loading` diturunkan (`ready && !loaded`),
jadi tidak ada frame yang mengklaim "tidak ada baris" sebelum pemuatan selesai.

---

## 6. Runtime

| Kegiatan | Perkiraan |
|---|---|
| `next build` | ~60–90 s |
| `receipt-ledger-db-test` (initdb + 5 migrasi + 47 + 14 + 18 + 15 + 20 + 11 cek) | ~70 s |
| `receipt-physical-test` (167 assertion + 16 probe adversarial) | ~25 s |
| handover-flow + compact + purchase-flow | ~90 s total |
| probe live read-only | < 5 s |

---

## 7. Langkah berikut (untuk reviewer / schema owner)

1. **Brooklyn**: review diff `4a92bec..fabe5fa` (21 file, +3385/−34).
2. **`t_03b41644`**: jalankan migrasi setelah backup + restore drill lulus.
3. Setelah migrasi: `node scripts/receipt-physical-test/probe_live.mjs` →
   harus berubah `ready=true, returnReady=true` **tanpa deploy**.
4. Merge + deploy, lalu transaksi nyata pertama oleh Novi (bukan fixture).
5. Rollback: `99_rollback_all.sql` sebelum ada transaksi; setelah ada
   transaksi gunakan restore snapshot (lihat `COMPATIBILITY_CUTOVER.md §6`).
