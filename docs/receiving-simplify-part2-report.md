# Bagian 2 — Receiving, Pembelian per Vendor, Handover, Retur (t_7bc6246b)

Tanggal: 17 Okt 2026 · Owner: **bamboo-tech**
Kontrak skema: `docs/receiving-events-contract.md` (permintaan ke schema owner
**reviewer_resek**, task **t_03b41644**)
Status: **tidak ada migrasi/SQL dijalankan**, **tidak ada DB ditulis**,
**tidak ada deploy produksi**. Semua bukti dari harness sandbox + probe read-only.

Branch: `feat/receiving-simplify/t_7bc6246b` (rebase di atas `origin/main`
`3870ef7`, commit `eb169da`, sudah di-push & diverifikasi `git ls-remote` =
hash lokal). **Belum merge ke `main`/belum deploy** — menunggu review Brooklyn.

---

## 0. Ringkas: apa yang berubah & apa yang TIDAK

| Area | Sebelum | Sesudah (task ini) |
|---|---|---|
| Kondisi/tujuan per barang | divalidasi di form, submit **diblok** dengan pesan gap, nol tulisan | sama saat skema belum ada; **siap simpan permanen** lewat 1 RPC begitu tabel ledger ada (capability probe) |
| Retur barang rusak | belum ada jalur; retur = ketik ulang item/qty | modal retur yang **mengambil baris dari catatan rusak** (tanpa ketik ulang), status retur tersimpan, anti double-cost |
| Serah terima ke tukang | tombol ✓ langsung menandai header (tanpa rincian) | modal **konfirmasi fisik per barang**: baris diprefill dari alokasi tukang − yang sudah diserahkan, penerima hanya verifikasi qty; header-only tetap tersedia saat skema belum ada |
| PR multi-vendor | semua item PR masuk satu nota (vendor bercampur) | tombol **✂ Pecah per Vendor** (memakai kolom existing `receivings.vendor_id` + jejak `purchase_request_id`), guard histori, idempoten |
| Kejujuran status | klaim "tersimpan" hanya untuk qty kumulatif | banner + label dari **capability probe** read-only; tanpa tabel → tidak ada klaim |

**Tidak diubah:** `receivings.status` tetap dimensi nota (bukan kondisi barang);
ringkasan parent tetap read-only turunan item (tidak bisa meng-override line
items); `quantity_received`/histori/idempotensi/role/foto opsional dipertahankan;
nomor proyek draft-vs-issued **tidak** diaktifkan; tidak ada auth/RLS diubah;
tidak ada data legacy dihapus.

---

## 1. File baru

| File | Isi |
|---|---|
| `docs/receiving-events-contract.md` | kontrak tabel/RPC/RLS/backfill/rollback + capability probe (untuk t_03b41644) |
| `modules/receivings/receiptCapability.js` | probe skema **read-only** (SELECT limit 1) + cache 60s + pesan jujur |
| `modules/receivings/receiptEventLogic.js` | logika murni: draft event, validasi mirror constraint DB, agregat, retur tanpa ketik ulang, prefill handover, grouping vendor, guard pecah nota |
| `modules/receivings/receiptEventSave.js` | satu jalur tulis via RPC (`receipt_apply_events`, `handover_confirm`, `return_create`) + read model |
| `modules/receivings/receiptSplit.js` | rencana + eksekusi pemecahan nota per vendor (guard histori, readback, idempoten) |
| `modules/receivings/returnForm.jsx` | modal retur dari barang rusak |
| `modules/handovers/confirmForm.jsx` | modal konfirmasi fisik serah terima per barang |
| `scripts/receiving-events-test/` | harness baru: logic 99 cek, render jsdom 43 cek, e2e CDP 15 cek, probe live read-only |

## 2. File yang diubah

| File | Perubahan |
|---|---|
| `modules/receivings/receiptForm.jsx` | dua mode (READY/LEGACY) dari capability; mode READY kirim satu RPC; mode LEGACY identik kontrak lama (blok + nol tulisan); foto hanya nama file (arsip Drive belum aktif) |
| `modules/receivings/receiptLogic.js` | `bulkActionState(items, {ready})` — teks alasan tidak lagi bilang "menunggu skema" saat skema sudah ada |
| `modules/receivings/view.jsx` | banner status penyimpanan; tombol `↩ Retur Rusak` (hanya mode READY); tombol `✂ Pecah per Vendor` (hanya nota multi-vendor belum bergerak); modal retur |
| `modules/handovers/view.jsx` | tombol ✓ membuka modal konfirmasi per barang saat READY; jalur header saat LEGACY (desktop + mobile) |
| `modules/shared/renderModuleCell.jsx` | `renderModuleModal` merender SEMUA ekspor modal terdaftar (`MODAL_EXPORTS`) |
| `components/ModuleView.js` | state `returnRow`, `handoverConfirmRow`, `capability` + probe saat mount; ctx diperluas |
| `modules/registry.js`, `docs/owners.md` | kepemilikan file baru + kontrak modal/ctx |

**Catatan kepemilikan:** `components/ModuleView.js`, `modules/shared/*`, `modules/registry.js`, `docs/owners.md` adalah file CORE (Tech Lead). Task ini milik bamboo-tech (Tech Lead), jadi perubahan kontrak ctx di atas sah — dan didokumentasikan di `docs/owners.md`.

---

## 3. Reuse, bukan reimplementasi (arahan task)

Diperiksa & dipakai ulang apa adanya dari task sebelumnya — **tidak ada duplikasi logika**:

| Dari | Yang dipakai ulang |
|---|---|
| **t_5196b689** (`docs/receipt-flow-contract.md`) | `receiptLogic.js` (`buildRows`/`validateItem`/`validateForm`/`buildSavePlan`), `receiptSave.js` (CAS legacy), `loadItemsFromPr`, modal `receiptForm.jsx` — hanya ditambah mode READY, tidak ditulis ulang |
| **t_b418827b** (`docs/handover-gap-proposal.md`) | `display.js` (semantik `diserahkan_at`, label "Rincian barang belum tersedia", `validatePrototypeRow`/`prototypeTotals`), `confirm.js` (CAS header, tetap jalur LEGACY), `save.js` (edit metadata terkunci) |
| **t_48f6b336** | kategori material per `material_id` — tidak disentuh; grouping vendor memakai `pr_items.vendor_id` (relasi yang sudah ada) |
| **t_ac0b39c0 / t_e88c28fb** | label sumber harga (HISTORIS/MASTER/MANUAL) tidak disentuh; tidak ada perubahan estimator |
| **t_090127ad** | acuan manual sesi tidak disentuh |

Tidak ada file milik reviewer (`modules/rab-boq/*`, `modules/sales-invoice/*`) yang diubah. Tidak ada worker aktif yang di-overwrite: pekerjaan dilakukan di worktree terpisah `/tmp/receiving-wt` pada branch `feat/receiving-simplify/t_7bc6246b`; `main` (3870ef7) tidak disentuh dan preview 3001 tidak di-restart.

---

## 4. Kontrak perilaku yang dijaga (bukti test)

### 4.1 Receiving — satu form, dimensi terpisah
- `datang ≠ rusak ≠ tujuan(ws/tukang) ≠ retur`; `baik = datang − rusak`;
  `Σtujuan ≤ baik`; tukang ⇒ nama penerima; buang ⇒ konfirmasi (foto opsional).
  (A1, A3, C5–C6, E4)
- **Over-receipt tetap diblok** (`Σ datang ≤ sisa pesanan`) — belum ada kebijakan
  over-receipt, jadi tidak diterima diam-diam. (A3h, C3)
- `quantity_received` tetap kumulatif dan di-**maintain RPC** dari Σ `qty_datang`
  (satu penulis, bukan UI). (C1c, C1d, E4f)
- Idempotensi: `client_event_id` deterministik + `ON CONFLICT DO NOTHING`;
  submit ganda/retry → `already_applied`, qty **tidak** bertambah dua kali.
  (A2, C2, C5d)
- Tanpa tabel ledger: submit dimensi per barang **diblok**, **nol tulisan**
  (bukan packing ke `note`). (C6h, E1h, E1i)

### 4.2 Retur — tanpa ketik ulang, tanpa double-cost
- Baris retur diambil dari event dengan `qty_rusak > 0` dikurangi yang sudah
  diretur; item/qty/satuan tidak diketik ulang. (A5, E2d, E2j)
- **Anti double-retur** (temuan review run 101): `returnForm` sekarang membaca
  `return_lines` dulu (`loadReturnedByEvent`) dan hanya menawarkan
  `sisa = qty_rusak − Σ return_lines.qty`. Event yang sudah berstatus retur
  tanpa rincian pengembalian tidak ditawarkan. Sebelumnya membuka modal dua kali
  mencatat qty rusak 2 menjadi **4**; sekarang tetap 2 dan hanya 1 `return_case`.
  Bila `return_lines` tidak bisa dibaca, modal **menolak** menampilkan baris.
  (A5a, A5c, C7a–C7e)
- `return_lines` merujuk `receiving_event_id`; `quantity_received` **tidak**
  berubah (nol update `receiving_items`). (C6d)
- Status `PENDING` = *menunggu dikembalikan*, bukan *sudah dikembalikan*. (A1e)

### 4.3 Handover — prefill alokasi, konfirmasi fisik terpisah
- Prefill = `tujuan_tukang − Σ handover_items` lintas dokumen (tanpa hitung
  ganda); penerima boleh beda per baris. (A6, A8, E2b4–E2b6)
- Konfirmasi menulis `status=CONFIRMED` + `diserahkan_at` **dan** `handover_items`
  dalam satu RPC; CAS `diserahkan_at IS NULL` + unique
  `(handover_id, receiving_event_id)` → konfirmasi ulang tidak menggandakan.
  (C5, E2b8–E2b11, E2c)
- Konfirmasi header-only (tanpa rincian) tetap tersedia saat skema belum ada,
  dengan pesan bahwa rincian belum tersimpan. (E1b, R1–R6 handover 51/51)

### 4.4 PR multi-vendor → pembelian per vendor/nota
- Grouping stabil per vendor. (A7a, A7i)
- **Barang tanpa vendor memblokir pemecahan** (temuan review run 101): dulu
  grup "vendor belum ditentukan" ikut dihitung sebagai grup ke-2, sehingga
  tombol muncul, nota asal dilabeli satu vendor, dan barang yatim tidak pernah
  dipindah — sementara pesan sukses tetap dilaporkan. Sekarang pemecahan
  **ditolak** dengan alasan spesifik ("lengkapi vendor di PR dulu"), nol tulisan.
  (D2c, D2d)
- **Nota asal tidak boleh diganti vendornya diam-diam**: bila nota sudah punya
  `vendor_id`, grup vendor itulah yang memakai nota asal; label yang tidak cocok
  dengan isi nota → ditolak. (D2e, D2f)
- Nota asal dipakai ulang untuk vendor pemilik nota; nota baru untuk vendor lain;
  **jejak PR tetap** di `purchase_request_id`. (D1b–D1e, D3c–D3d)
- Guard: nota sudah masuk gudang / sudah ke tukang / sudah ada qty diterima →
  **ditolak** dengan alasan jujur (histori tidak dipindah). (A7f–A7h, D2a)
- Idempoten: nota (PR, vendor) sudah ada → dipakai ulang, tidak membuat nota
  baru. (D4a)
- **Readback** setelah eksekusi: setiap item harus berada di nota vendornya,
  kalau tidak → dilaporkan gagal (bukan klaim sukses). (D3e)

### 4.5 Role & foto
- Tidak ada perubahan role/auth. Semua tulis ledger lewat RPC `SECURITY DEFINER`
  yang di kontrak diminta `REVOKE ... FROM PUBLIC, anon`.
- Foto bukti tetap **opsional**; arsip Drive belum aktif → yang disimpan hanya
  nama file sebagai rujukan, UI menyatakan jujur "belum tersimpan permanen".

---

## 5. Capability probe (kenapa ini penting)

`getReceiptCapability()` melakukan 3 SELECT read-only (limit 1) ke
`receiving_events`, `handover_items`, `v_receipt_progress`, lalu:

- **ready=false** → UI mode legacy: banner kuning, tombol Retur disembunyikan,
  submit dimensi per barang diblok, nol tulisan.
- **ready=true** → UI mode baru: banner hijau, retur & konfirmasi per barang aktif.

Bukti live (read-only, 17 Okt):

```
TIDAK   receiving_events  (PGRST205) Could not find the table 'public.receiving_events'
TIDAK   handover_items    (PGRST205) Could not find the table 'public.handover_items'
TIDAK   return_lines      (PGRST205) Could not find the table 'public.return_lines'
TIDAK   v_receipt_progress (PGRST205)
CAPABILITY ready = false | returnReady = false  → mode LEGACY
```

Jadi **di produksi saat ini aplikasi berjalan di mode legacy**: tidak ada satu
pun klaim "kondisi/tujuan/retur tersimpan". Begitu t_03b41644 menerapkan
migrasi aditif + RPC, probe otomatis berpindah ke mode READY tanpa deploy ulang
(cache 60 detik).

---

## 6. Yang dibutuhkan dari schema owner (t_03b41644)

Ringkas dari `docs/receiving-events-contract.md`:

1. `receiving_events` (append-only; `client_event_id unique`, check constraint
   rusak≤datang, tujuan≤baik, tukang⇒penerima, buang⇒konfirmasi).
2. `handover_items` (unique `(handover_id, receiving_event_id)`).
3. `return_cases` + `return_lines` (unique `(return_case_id, receiving_event_id)`).
4. RPC `receipt_apply_events`, `handover_confirm`, `return_create`
   (SECURITY DEFINER, advisory lock per receiving, `REVOKE FROM PUBLIC, anon`).
5. View opsional `v_receipt_progress`.
6. RLS: SELECT untuk `authenticated` mengikuti induk; **tanpa** policy tulis
   (tulis hanya via RPC). **`return_lines` WAJIB bisa dibaca** user yang berhak —
   tanpanya modal retur tidak bisa menghitung sisa dan akan menolak menampilkan
   baris (anti double-retur).
7. `quantity_received` **tidak** diubah oleh migrasi; backfill event hanya
   eksplisit oleh admin dengan `source='BACKFILL'` dan `qty_rusak = NULL`
   (tidak diketahui) — tidak ada fabrikasi.

**Urutan aktivasi yang aman** (karena probe punya dua tingkat):
`receiving_events` + `handover_items` → penerimaan & serah terima per barang
aktif; tambahkan `return_lines` → tombol Retur baru muncul. Tidak perlu deploy
ulang (cache probe 60 detik).

**Nama RPC & kolom di dokumen itu adalah kontrak yang sudah dipakai kode
aplikasi** (`receiptEventSave.js`). Bila schema owner memilih nama berbeda,
perubahan hanya di satu file itu (bukan di UI).

---

## 7. Verifikasi (angka nyata, runtime nyata)

Angka di bawah adalah hasil **run 101 (review Brooklyn, 17 Okt)** — dijalankan
ulang dari nol di worktree `/tmp/receiving-wt` pada commit `afe44db` + commit
perbaikan review.

| Harness | Hasil |
|---|---|
| `scripts/receiving-events-test/run.py` (baru) | **logic 108/108**, **render 43/43** |
| `scripts/receiving-events-test/e2e_runtime_test.mjs` (baru) | **15/15** (Chrome headless CDP, server `next start` port 3131) |
| `scripts/receipt-flow-test/run.py` | logic **105/105**, render **66/66**, e2e **16/16** |
| `scripts/handover-flow-test/run.py` | logic **61/61**, render **51/51**, e2e **47/47** |
| `scripts/flow-logic-test` | 29/29 |
| `scripts/fase2-save-test` | 54/54 |
| `scripts/showmore-list-test` | 49/49 |
| `scripts/approval-queue-test` | 56/56 |
| `scripts/vendors-toolbar-test` | 25/25 |
| `scripts/material-acuan-test` | 93/93 |
| `scripts/pr-estimator-test` | unit 48/48, render 46/46, save 14/14 |
| `scripts/pr-group-test` | unit 31/31, render 54/54 |
| `scripts/flow-gap-repro-test` | 14/25 gap terbukti (status quo; GAP yang jadi milik task ini tetap konsisten) |
| `npx next build` (produksi) | hijau (`BUILD_ID b956VViDVCMSyLhqGcJgN`) |
| `ENABLE_SMOKE=1 npx next build` + `next start -p 3131` | hijau, `/__smoke` 200 (`BUILD_ID tdHb2zr8o9GFHS_H0aJ6P`) |

Runtime: build ~60–75 s; harness logic+render ~35 s; e2e CDP ~25 s per suite.

**Perubahan pada harness lama (2 file, hanya mock):** mock
`receipt-flow-test` dan `handover-flow-test` kini menjawab `PGRST205` untuk
tabel yang tidak ada (seperti PostgREST sungguhan). Tanpa itu, mock "mengarang"
skema lengkap sehingga capability probe salah menyimpulkan mode READY. Tidak
ada assertion yang dilonggarkan.

**Perbaikan dari review run 101** (3 commit terpisah, lihat §10): 2 bug
fungsional ditemukan lewat probe independen terhadap modul terkompilasi
(bukan lewat harness yang sudah ada), lalu ditutup + diuji. Assertion lama yang
**sengaja diubah** hanya A5a/A5c, karena keduanya mengunci perilaku yang salah
(menganggap event berstatus `PENDING` masih boleh diretur lagi).

---

## 8. Batasan yang masih ada (jujur)

1. **Tidak ada penyimpanan per barang di produksi hari ini.** Semua jalur
   READY menunggu migrasi t_03b41644. UI menyatakan ini eksplisit (banner,
   pesan gap, label retur disembunyikan).
2. **Pecah per vendor tidak memindahkan header `receivings.purchase_request_id`**
   (tetap satu PR → banyak nota). Ini memang desainnya, tetapi artinya
   laporan Finance yang menjumlah per PR akan melihat beberapa nota untuk satu
   PR — belum diubah di task ini (di luar scope Finance).
3. **Pecah per vendor hanya untuk nota yang belum menerima barang.** Nota yang
   sudah bergerak harus diselesaikan lewat koreksi/reversal (belum ada
   mekanismenya) — bukan dengan memindah item.
4. **Retur tidak membuat jurnal keuangan.** Retur hanya status logistik; refund
   uang / pengganti dicatat sebagai penerimaan baru atau di Finance (belum
   diintegrasikan, sesuai kontrak anti double-cost).
5. **Foto bukti belum tersimpan** (arsip Drive belum aktif, t_79391975); hanya
   nama file yang dirujuk.
6. **Over-receipt masih diblok** (belum ada kebijakan eksplisit DAT).
7. `v_receipt_progress` opsional: bila tidak dibuat, UI menghitung agregat dari
   event (lebih banyak baris terbaca, tetap benar).
8. Nomor proyek draft-vs-issued **tidak** disentuh.
9. **Pecah per vendor menolak nota yang masih punya barang tanpa vendor.**
   Ini disengaja: memecah tanpa vendor lengkap akan menempelkan label vendor
   pada nota yang isinya bercampur. Konsekuensinya tombol tidak muncul sampai
   vendor dilengkapi di PR — perbaikan data harus dilakukan di PR, bukan di
   nota pembelian.
10. **Retur bergantung pada `return_lines` yang bisa dibaca.** Selama schema
    owner belum membuat tabel itu, tombol Retur sengaja disembunyikan
    (`returnReady=false`) meski `receiving_events`/`handover_items` sudah ada.
11. **Pecah per vendor belum punya pembatalan/undo.** Setelah item dipindah ke
    nota vendor lain, membatalkan harus manual (belum ada mekanisme reversal).

---

## 9. Cara menjalankan ulang verifikasi

```bash
# logic + render (sandbox, tanpa DB)
python3 scripts/receiving-events-test/run.py

# e2e browser nyata (butuh build smoke + server)
ENABLE_SMOKE=1 npx next build
npx next start -p 3131 &
PORT=3131 node scripts/receiving-events-test/e2e_runtime_test.mjs

# probe skema live (READ-ONLY, aman diulang)
node scripts/receiving-events-test/probe_live.mjs
```

**Catatan operasional (temuan run 101):** server `next start` harus dijalankan
**setelah** build selesai. Bila server dijalankan sebelum build ulang, ia
menyajikan `_buildManifest.js`/chunk lama dan browser menerima **400** untuk
chunk tersebut — halaman tampak ter-render (SSR) tetapi React tidak pernah
hydrate, sehingga banner capability tidak muncul dan e2e gagal secara
menyesatkan. Selalu restart server setelah `next build`.

---

## 10. Riwayat review (run 101 — Brooklyn)

Review independen menemukan **2 bug fungsional** yang tidak tertangkap harness
yang ada, karena harness menguji jalur yang "sudah benar" tanpa menguji input
yang merusak. Keduanya sudah diperbaiki, diuji, dan didokumentasikan.

### BUG-1 (MAJOR) — "Pecah per Vendor" melabeli nota dengan vendor yang salah

- **Reproduksi:** nota berisi 2 barang, satu bervendor `v-A`, satu **tanpa
  vendor**. `buildSplitPlan` menghitung grup `"__TANPA_VENDOR__"` sebagai grup
  ke-2, sehingga `groups.length === 2` lolos guard.
- **Akibat:** nota asal di-`update` menjadi `vendor_id = v-A` + `delivery_note`
  diberi label "Toko A", padahal masih memuat barang tanpa vendor. Barang yatim
  itu **tidak pernah dipindah** (loop `continue` untuk `!vendorId`), dan readback
  tidak memeriksanya (hanya grup dengan vendor). UI tetap melaporkan
  "Nota dipecah menjadi N pembelian per vendor".
- **Dampak data:** `receivings.vendor_id` salah → pencocokan harga/retur per
  vendor salah. Belum menyala di data live hari ini (0 dari 5 nota memenuhi
  syarat), tetapi menyala begitu vendor PR terisi sebagian.
- **Perbaikan:** guard `tanpaVendor` **sebelum** guard jumlah grup, dengan pesan
  spesifik yang menyebut nama barang. `realGroups` (hanya vendor nyata) dipakai
  untuk plan. Nota asal tidak boleh diganti vendornya: bila `receiving.vendor_id`
  sudah terisi, grup vendor itulah yang memakai nota asal; label yang tidak
  cocok dengan isi → ditolak.
- **Bukti:** `D2c`, `D2d`, `D2e`, `D2f` + re-probe independen 16/16.

### BUG-2 (MAJOR) — retur yang sama bisa dicatat dua kali

- **Reproduksi:** `returnForm.jsx` memanggil `returLinesFromEvents(events)` —
  **tanpa** argumen `alreadyReturned` — padahal komentar modul menjanjikan
  "dikurangi yang sudah pernah diretur". Fungsi juga tidak menyaring
  `retur_status`.
- **Akibat:** buka modal retur → catat; buka lagi → baris yang sama ditawarkan
  lagi dengan qty penuh → tercatat lagi. Qty rusak 2 menjadi **4**, dua
  `return_case`. Ini persis kelas bug *double-cost* yang kontrak §9/anti
  double-cost janjikan tidak terjadi.
- **Perbaikan:** `loadReturnedByEvent()` baru membaca `Σ return_lines.qty` per
  event; modal hanya menawarkan `sisa`. `returLinesFromEvents` juga menolak
  menawarkan event yang sudah berstatus retur tanpa rincian pengembalian. Bila
  `return_lines` tidak terbaca, modal **menolak** menampilkan baris.
  Capability probe menambah flag `returnReady` (butuh `return_lines`) sehingga
  tombol Retur tidak pernah aktif tanpa sumber riwayat.
- **Bukti:** `A5a`, `A5c`, `C7a–C7e` + re-probe independen 16/16.

### Catatan proses

- Kedua bug ditemukan dengan **menjalankan modul terkompilasi langsung** dengan
  input yang tidak lazim (bukan dengan menjalankan ulang harness). Harness yang
  ada 100% hijau sebelum perbaikan — itu sendiri temuan: jumlah assertion bukan
  bukti kebenaran.
- Assertion lama `A5a`/`A5c` mengunci perilaku yang salah dan **sengaja diubah**
  (bukan dilonggarkan) — keduanya sekarang menuntut event berstatus retur TIDAK
  ditawarkan lagi.
- Tidak ada SQL dijalankan, tidak ada data live ditulis, tidak ada merge/deploy.
