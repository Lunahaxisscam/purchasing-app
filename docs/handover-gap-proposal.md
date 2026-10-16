# Handover — Rincian Barang & Jumlah Aktual: Gap Skema + Proposal (t_b418827b)

Tanggal: 16 Okt 2026 · Owner: bamboo-tech · Status migrasi DB: **BEKU** (tidak ada
migration/SQL yang dijalankan). Dokumen ini melaporkan gap + usulan; **butuh izin
DAT sebelum eksekusi.**

---

## 1. Yang sudah dikerjakan (tanpa migrasi — aman & akurat)

1. **Semantik "Sudah Diserahkan" = bukti fisik.** Status CONFIRMED lama tanpa
   `diserahkan_at` (bukti live `c14802de`) TIDAK lagi ditampilkan/dihitung
   "Sudah Diserahkan". Filter tab, badge baris, kartu mobile semuanya memakai
   `diserahkan_at` (`lib/constants.js → isHandoverDelivered`).
2. **Konfirmasi fisik eksplisit & idempoten** — `modules/handovers/confirm.js`:
   menulis `status='CONFIRMED'` + `diserahkan_at` dengan compare-and-swap
   (`diserahkan_at IS NULL`), jadi retry/2 user tidak menandai dua kali dan
   re-confirm tidak diproses ulang. Tidak ada lagi jalur yang meng-klaim
   diserahkan hanya karena alokasi dipilih.
3. **Edit Handover hanya metadata.** `modules/handovers/save.js` mode edit tidak
   pernah membaca `receiving_id`/`project_id`/`status`/`diserahkan_at` dari form
   (G5 ditutup; FK & status terkunci dari record sumber). Form edit menampilkan
   ringkasan read-only Purchase/Project/Status + daftar rincian barang; dropdown
   Penerimaan/Project/Status dihapus dari mode edit.
4. **Tambah Handover (standalone)** tetap wajib memilih Penerimaan (link tidak
   boleh orphan); handover baru masuk antrean **Belum Diserahkan** (status DRAFT).
5. **Tidak menebak jumlah dari Purchase.** Data lama tanpa rincian terstruktur
   diberi label **"Rincian barang belum tersedia"** (daftar, detail, mobile).
   Rincian serah terima per item belum ditampilkan karena belum ada tempatnya —
   `quantity_received` kumulatif (termasuk rusak, bisa berubah) TIDAK dipakai
   sebagai "jumlah diserahkan".
6. **Anti-packing**: alur "Ke Tukang" tidak lagi menulis daftar qty item ke kolom
   `note` (penghapusan packing sesuai kontrak DAT).
7. **Prototype alur per-item (sesi saja)** — panel 🧪 di detail handover:
   pilih barang dari penerimaan, isi jumlah diserahkan KALI INI (parsial),
   pilih penerima (boleh beberapa), lihat sisa belum diserahkan tanpa hitung
   ganda. Entri hidup di memori sesi, **tidak menulis DB/note**.

## 2. Gap skema yang tersisa (butuh keputusan DAT)

| # | Gap | Dampak | Solusi butuh |
|---|---|---|---|
| H1 | Tidak ada tempat menyimpan **rincian barang per penyerahan** (nama, qty aktual, satuan) | Handover tetap header-level; qty per item tidak bisa dicatat/diuji | tabel `handover_items` |
| H2 | Tidak bisa membedakan **parsial vs penuh** per item lintas beberapa penyerahan | "Sisa belum diserahkan" hanya bisa dihitung setelah H1 | `handover_items` (+ qty per baris) |
| H3 | Beberapa penerima per handover | Hanya satu `received_by` per header | `handover_items.penerima` atau tabel penerima |
| H4 | Sumber angka per item | `receiving_items.quantity_received` kumulatif termasuk rusak; belum ada event `datang/rusak/tujuan` (usulan `receiving_events` di `docs/receipt-flow-contract.md`) | `receiving_events` dulu (parent), lalu `handover_items` merujuk event |
| H5 | Validasi qty saat konfirmasi fisik | Saat ini konfirmasi menulis `diserahkan_at` tanpa validasi rincian qty (belum ada rincian) | setelah H1: validasi Σqty ≤ tersedia |

## 3. Proposal minimal (selaras §H audit t_905e0e5a — BELUM dieksekusi)

```sql
-- Satu baris = satu penyerahan item pada satu dokumen handover.
-- Append-only; dokumen handover tetap satu baris header.
handover_items(
  id uuid pk,
  handover_id uuid not null references handovers(id) on delete cascade,
  receiving_item_id uuid null references receiving_items(id),  -- konteks asal (opsional)
  pr_item_id uuid null references pr_items(id),                -- opsional, utk jejak PR
  item_name text not null,
  qty_diserahkan numeric not null check (qty_diserahkan > 0),
  satuan text,
  penerima text,                -- boleh beda dari header (beberapa penerima)
  catatan text,
  created_at timestamptz default now(),
  created_by uuid
);
-- Sisa belum diserahkan per item = qty tersedia (dari receiving_events/BAIK)
--   − Σ qty_diserahkan (handover_items) — dihitung, TIDAK disimpan (anti dobel).
```

Catatan desain:
- **Tidak** ada kolom "saldo" tersimpan — sisa dihitung dari Σ penyerahan supaya
  tidak bisa dobel-hitung dan tidak perlu rekonsiliasi.
- Konfirmasi fisik (H5) setelah tabel ada: validasi tiap baris (qty > 0, Σ ≤
  tersedia, nama barang ada) lalu set `diserahkan_at`; baris item immutable.
- Data lama (1 handover live) tetap "Rincian barang belum tersedia" — tidak
  ada backfill tebakan.

## 4. Alternatif yang DITOLAK (konsisten arahan DAT)

- Packing JSON item ke kolom `note` — dilarang (tidak queryable, mudah korup).
- Menebak qty dari `receiving_items.quantity_received` saat ini — angka bisa
  berubah & bercampur barang rusak.
- Auto-CONFIRMED saat alokasi ke tukang dipilih — bukan bukti fisik.

## 5. Langkah lanjut

1. DAT meninjau proposal §3 (bersama `receiving_events` dari parent
   t_5196b689 — urutan eksekusi disarankan: `receiving_events` dulu).
2. Setelah izin: migration baru + backfill `handover_items` (kosong untuk data
   lama) + validasi qty di konfirmasi fisik + tampilan rincian nyata
   (menggantikan label "belum tersedia").
3. Selama belum: modul tetap header-level yang JUJUR (label jelas, tidak
   mengarang angka) — sesuai batas tugas.
