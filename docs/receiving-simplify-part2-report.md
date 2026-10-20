# Laporan Bagian 2 — Receiving, Vendor Pembelian, Handover, Retur (t_7bc6246b)

Tanggal: 21 Okt 2026 · Branch `feat/receipt-ledger-t_7bc6246b` @ `fabe5fa`
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

Jalankan ulang: `python3 scripts/receipt-ledger-db-test/run.py`

### 3.2 UI nyata (jsdom interaktif) — **90 PASS / 0 FAIL**

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

### 4.2 Batasan yang TIDAK diperbaiki di card ini

**Serah terima tidak bisa sebagian.** `handover_confirm` melakukan CAS pada SATU
dokumen (`diserahkan_at`), jadi satu dokumen = satu waktu penyerahan. Di UI,
baris dengan qty 0 ditolak ("harus > 0"), sehingga barang yang belum tiba tidak
bisa dilewati — admin harus menyerahkan semua baris sekaligus. Ini konsekuensi
kontrak RPC milik `t_03b41644`, bukan bug UI; mengubahnya butuh keputusan schema
owner. Dikunci oleh `probe_confirm_partial.mjs`.

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

---

## 6. Runtime

| Kegiatan | Perkiraan |
|---|---|
| `next build` | ~60–90 s |
| `receipt-ledger-db-test` (initdb + 5 migrasi + 47 cek) | ~35 s |
| `receipt-physical-test` | ~20 s |
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
