# Modul Invoice Penjualan (Sales Invoice) — Admin Suite

Task `t_ff3a96cf` — arahan DAT: *"Kamu buka dulu modulnya, nanti terminnya
menyusul ya."*

## Cakupan tahap ini (SUDAH diimplementasikan)

- **Menu + halaman admin-only yang benar-benar bisa dibuka**: item
  `Invoice Penjualan` di section Admin Suite sidebar (hanya tampil untuk
  role admin), kartu di Dashboard admin, halaman dengan judul
  "Invoice Penjualan".
- **Guard akses 3 lapis** (pola RAB & BOQ / t_18564dce):
  1. menu sidebar disembunyikan untuk non-admin (`lib/constants.js`
     section `adminOnly`),
  2. guard render di `pages/index.js` — role HANYA dari tabel
     `profiles` (server data), non-admin yang memaksa state
     `page='sales_invoice'` mendapat panel "Halaman ini khusus
     administrator",
  3. pola data mengikuti arsitektur existing: modul hanya menerima
     `invoices` via props dari data yang dimuat sesi; tidak ada endpoint
     baru, dan semua mutasi modul lain tetap tunduk RLS.
- **Daftar / empty state**: bila data invoice tersedia (props), tabel
  read-only dirender; saat ini belum ada tabel DB invoice penjualan, jadi
  halaman menampilkan empty state jujur:
  *"Belum ada invoice penjualan. Pengaturan penagihan/termin akan
  ditambahkan berikutnya."* **Tidak ada data demo.**
- **Kerangka detail** (kolom read-only, hanya bila datanya ada):
  No. Invoice, Customer (CRM), RAB Final/Disetujui, Nominal, Status
  Dokumen.

## Yang SENGAJA BELUM diimplementasikan (menunggu keputusan DAT)

| Item | Status | Alasan |
|---|---|---|
| Tombol "Buat Invoice" / form input | ❌ belum | Trigger draft vs invoice resmi **belum diputuskan**. Tanpa tombol = tidak ada jalur input palsu. |
| Termin (persen/jadwal/cicilan) | ❌ belum | Arahan DAT: "terminnya menyusul". |
| Penomoran dokumen otomatis / nomor proyek dari BOQ | ❌ belum | Belum disepakati; existing project tidak disentuh. |
| Simpan/update DB, kirim invoice, pembayaran | ❌ belum | Tidak ada invoice nyata/sends/payments pada tahap ini. |
| Tabel DB + RLS | ❌ belum | Freeze migrasi — butuh keputusan skema (lihat di bawah). |

## Catatan kebutuhan fase database (untuk keputusan berikutnya)

Bila DAT menyetujui persistence, tabel minimal yang dibutuhkan
(usulan — belum didesain final, belum dimigrasi):

- `sales_invoices`:
  - `id uuid pk`, `created_at timestamptz default now()`
  - `customer_id uuid` → sumber identitas dari **CRM** (relasi ke tabel
    customers CRM saat dibuat — catatan: modul CRM belum ada di repo;
    bila belum, simpan snapshot nama + customer_id null-able)
  - `rab_version_id uuid` → RAB **final/disetujui customer** (versi RAB
    yang disetujui, bukan draft)
  - `project_id uuid` → Master Project tempat nomor diterbitkan
  - `invoice_no text unique` → **penomoran dokumen unik** (format &
    pemicu penerbitan nomor Master Project menunggu keputusan)
  - `nominal numeric`, `status text` (draft/resmi — enum final menunggu
    keputusan trigger)
  - `issued_at timestamptz`, `created_by uuid`
- RLS admin-only (polanya sama dengan modul lain).
- **Belum** dirancang: tabel termin (butuh keputusan persentase/jadwal).

## Keamanan & jujur-UI

- Tidak ada `dangerouslySetInnerHTML`; semua render via React.
- Tidak ada data demo / seed / localStorage-as-db / klaim tersimpan.
- Tidak ada tombol yang tidak melakukan apa-apa (no fake save).
- Guard non-admin: menu disembunyikan + panel "khusus administrator" +
  tidak ada jalur data apa pun untuk non-admin.
