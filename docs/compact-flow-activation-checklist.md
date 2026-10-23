# Aktivasi ledger Serah Terima — checklist & keputusan yang dibutuhkan

Status per 24 Okt 2026 (branch `feat/compact-pr-purchase-handover`, staging :3001).

## 1. Yang sudah selesai & terverifikasi (bukti nyata)

| Lapisan | Bukti | Hasil |
|---|---|---|
| Logika PR/Pembelian/Serah Terima | `docs/compact-flow-logic.log` | 20 lulus, 0 gagal |
| Render SSR | `docs/compact-flow-render.log` | 6 lulus |
| Interaksi jsdom | `docs/compact-flow-runtime.log` | 3 lulus |
| Alur services (return PR, resubmit) | `docs/compact-flow-services.log` | 4 lulus |
| Regresi save 44 jalur | `docs/compact-flow-save-regression.log` | 56 lulus, 0 gagal |
| Scope Purchase vs Handover | `docs/compact-flow-handover-regression.log` | queue_ui 89/89, purchase_scope **53/53** |
| SQL atomik (PostgreSQL lokal) | `scripts/compact-flow-test/db.sql` | PASS: return PR, kunci edit, intake gudang, replay idempoten, penarikan, overdraft, direct issue, cost, overdistribution, penerima wajib |
| Konkurensi 2 penarikan rebutan | `scripts/compact-flow-test/concurrency.py` | 1 lolos / 1 ditolak, stok akhir 1; anon tidak boleh RPC, authenticated tidak boleh INSERT langsung |
| Build produksi | `npx next build` | sukses, staging menyajikan buildId `T-rjEQGSqSaQL8nLjYHuh` (HTTP 200) |

Perbaikan test yang dikerjakan pada run ini: `purchase_scope_test` B4c/B4c2 dulu
menggrep nama variabel pada hasil kompilasi SWC (`.insert(row)`), sehingga merah
palsu saat SWC menamai ulang `row` -> `row1`. Diganti menjadi uji PERILAKU:
jalur `savePurchaseWithClient` benar-benar dijalankan pada mock perekam, lalu
payload INSERT diperiksa (`alokasi: null`, `masuk_gudang: false`) dan dipastikan
tidak ada UPDATE yang menulis kolom fisik. Ditambah B4c3.

## 2. Kondisi database yang dipakai app (probe read-only, bukan tebakan)

`python3 scripts/compact-flow-test/probe_ledger_readiness.py`

```
konektivitas materials      : HTTP 200
tabel ops_transfers         : HTTP 404 PGRST205 -> BELUM ADA
tabel ops_stock_lots        : HTTP 404 PGRST205 -> BELUM ADA
tabel ops_stock_allocations : HTTP 404 PGRST205 -> BELUM ADA
rpc   ops_transfer_apply    : HTTP 404 PGRST202 -> BELUM ADA
rpc   pr_return_for_revision: HTTP 404 PGRST202 -> BELUM ADA
```

Artinya: database app (Supabase `wuurovgjflrhczlsbixm`) = database PRODUKSI,
dan ledger belum ada di sana. Karena itu tombol konfirmasi serah terima &
"Ambil dari Gudang" sengaja **fail-closed**: tidak menulis stok, tidak menulis
project cost, dan memberi pesan jujur. Tidak ada data yang ditebak.

## 3. Apa isi migrasi `migrations/2026-10-23_compact_ops_flow.DRAFT.sql`

Menambah (aditif, tanpa mengubah kolom/tabel lama):

- Tabel: `ops_transfers` (ledger pergerakan), `ops_stock_lots` (lot FIFO),
  `ops_stock_allocations` (pemakaian lot). RLS aktif; SELECT hanya untuk
  `authenticated`; INSERT/UPDATE/DELETE dicabut dari `anon` + `authenticated`
  (tulis HANYA lewat RPC).
- RPC `ops_transfer_apply(...)` — SECURITY DEFINER, satu transaksi:
  validasi sisa, idempoten via `event_key` (advisory lock), cek proyek aktif +
  penerima untuk TUKANG, stok tidak boleh minus, cost proyek dihitung sekali
  (barang yang sudah masuk gudang tidak dihitung dua kali).
- RPC `pr_return_for_revision(...)` — "Kembalikan ke PR" dengan alasan wajib.
- **Trigger penjaga** `compact_pr_guard` (PR/PR item terkunci saat bukan
  DRAFT/REVISI) dan `compact_purchase_guard` (tidak bisa membeli melebihi sisa
  kebutuhan PR).

## 4. Risiko yang harus diputuskan DAT (ini yang menahan aktivasi)

Tiga hal ini MENGUBAH perilaku aplikasi produksi, jadi tidak boleh saya
jalankan sendiri:

1. **Trigger `compact_pr_guard`** — PR yang sudah Submitted tidak bisa diedit
   lewat jalur mana pun (termasuk skrip/DB). Diperlukan sesuai permintaan
   "submitted terkunci", tapi kalau ada alur lama yang mengedit PR submitted,
   alur itu akan ditolak.
2. **Trigger `compact_purchase_guard`** — menolak pembelian yang melebihi qty
   PR. Nota lama yang terlanjur melebihi qty PR akan menolak edit berikutnya
   sampai direkonsiliasi.
3. **Kebijakan nilai stok** — migrasi memakai lot FIFO berbasis harga beli
   nyata. Stok gudang lama yang belum punya lot bernilai akan **ditolak**
   untuk diambil (bukan dinilai dengan angka karangan). Ini kebijakan akuntansi
   yang perlu persetujuan Brooklyn/Finance, bukan keputusan teknis.

## 5. Dua opsi aktivasi

**Opsi A — migrasi aditif ke Supabase produksi (paling cepat, 1 langkah).**
Prasyarat: backup/snapshot Supabase dulu, lalu jalankan migrasi di SQL Editor.
Sesudah itu jalankan verifikasi §6. Rollback: drop 3 tabel + 2 fungsi + 2
trigger (tidak menyentuh tabel lama), tercantum di §7.

**Opsi B — database staging terpisah (paling aman, lebih lama).**
Butuh instance Supabase baru (project terpisah/biaya) atau PostgREST lokal +
emulasi auth. Keuntungan: uji end-to-end tanpa menyentuh data produksi.
Kekurangan: butuh kredensial/biaya baru dan waktu setup.

Rekomendasi saya: **Opsi A setelah backup**, karena migrasinya murni aditif dan
tidak mengubah tabel yang sudah dipakai; risiko utama ada di dua trigger, dan
keduanya justru aturan yang DAT minta.

## 6. Verifikasi wajib setelah aktivasi (saya jalankan, bukan diasumsikan)

1. `python3 scripts/compact-flow-test/probe_ledger_readiness.py` -> semua ADA.
2. Uji transaksi self-cleaning di produksi: buat 1 nota uji + 1 penerimaan
   kecil, serahkan sebagian ke Gudang, ambil dari Gudang ke proyek uji,
   lalu hapus semua baris uji dan pastikan `materials.current_stock` kembali
   ke nilai awal (laporkan angka awal & akhir).
3. Cek `anon` tetap ditolak pada RPC dan INSERT langsung ke `ops_transfers`.
4. Ulang alur nyata di staging :3001 (PR -> Pembelian -> Serah Terima) dan
   pastikan UI tidak lagi menampilkan "backend belum aktif".

## 7. Rollback (kalau aktivasi bermasalah)

```sql
drop trigger if exists compact_purchase_guard on public.receiving_items;
drop trigger if exists compact_pr_item_guard on public.pr_items;
drop trigger if exists compact_pr_guard on public.purchase_requests;
drop function if exists public.compact_purchase_pr_guard();
drop function if exists public.compact_pr_edit_guard();
drop function if exists public.ops_transfer_apply(text,text,uuid,uuid,text,numeric,uuid,text);
drop function if exists public.pr_return_for_revision(uuid,text);
drop table if exists public.ops_stock_allocations;
drop table if exists public.ops_stock_lots;
drop table if exists public.ops_transfers;
```

Catatan: rollback ini hanya membuang objek BARU. Tidak ada kolom tabel lama
yang diubah, jadi aplikasi kembali ke perilaku sebelumnya tanpa kehilangan data.
