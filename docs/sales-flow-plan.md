# Alur Penjualan (Sales Flow) — Rencana Eksekusi

Status: **PLANNING** (belum ada kode/tabel yang diubah). Disusun 24 Okt 2026
berdasarkan keputusan DAT + kondisi nyata database (probe read-only).

## 1. Keputusan DAT yang sudah pasti

| # | Topik | Keputusan |
|---|---|---|
| 1 | Customer CRM | Cukup 4 hal: **nama, WA, project, status (Prospek/Customer)** |
| 2 | Relasi customer ↔ project | **1 customer boleh banyak project** — tetap SATU akun customer (project menempel ke customer, bukan customer diduplikasi) |
| 3 | RAB & BOQ | **Disimpan ke database sebagai ARSIP.** Tidak mengubah alur apa pun (tidak memicu status, tidak memicu nomor proyek, tidak memotong stok/cost). Gunanya: **bisa dipanggil saat membuat invoice** |
| 4 | Termin | **DP 50% · Term 2 40% · Pelunasan 10%** |
| 5 | Prospek → Customer | Menunggu konfirmasi terakhir (usulan: saat invoice **diterbitkan**) |

## 2. Kondisi database sekarang (hasil probe)

| Tabel | Status |
|---|---|
| `projects` | ADA — 11 baris. Kolom: `id, name, status, kode, code, created_at` |
| `project_closings` | ADA — 0 baris |
| `customers` | **BELUM ADA** |
| `rab` / `boq` / `rab_items` | **BELUM ADA** |
| `sales_invoices` | **BELUM ADA** |
| `invoice_payments` | **BELUM ADA** |

Artinya: seluruh UI penjualan sudah ada, tetapi **belum ada satu pun tabel penjualan**.
Modul CRM & RAB saat ini hanya menyimpan draft di memori halaman (hilang saat refresh).

## 3. Rancangan tabel

### 3.1 `customers` (baru)
```
id            uuid pk
nama          text not null
wa            text            -- nomor WhatsApp, boleh kosong
status        text not null   -- 'PROSPEK' | 'CUSTOMER'
customer_since timestamptz    -- diisi otomatis saat status berubah jadi CUSTOMER
created_at, updated_at
```
Catatan: **tidak** ada kolom project di sini — project menempel dari sisi `projects`.

### 3.2 `projects` (tambah 1 kolom)
```
customer_id   uuid null references customers(id) on delete set null
```
Alasan `set null` (bukan cascade): menghapus customer tidak boleh menghapus
proyek yang sudah punya riwayat pembelian/upah.

### 3.3 `rab` (baru — ARSIP)
```
id, nomor (auto RAB-YYYY-NNN), customer_id, project_id (opsional),
judul, tanggal, status ('DRAFT'|'FINAL'), total_material, total_jasa,
total, catatan, created_by, created_at, updated_at
```
### 3.4 `rab_items` (baru)
```
id, rab_id (cascade), urutan, nama_item, spesifikasi, qty, satuan,
harga_satuan, subtotal
```
Aturan: RAB **tidak** menggerakkan apa pun. Tidak ada trigger ke `projects`,
tidak ada efek ke stok/cost. Murni arsip + sumber data invoice.

### 3.5 `sales_invoices` (baru)
```
id, invoice_no (unik, dari server), customer_id, project_id (opsional),
rab_id (opsional — jejak asal tagihan), issue_date, due_date,
nominal, tax_rate, tax_amount, grand_total,
status ('DRAFT'|'TERBIT'|'TERKIRIM'|'LUNAS'|'BATAL'),
catatan, created_by, created_at, updated_at
```
### 3.6 `invoice_terms` (baru)
```
id, invoice_id (cascade), urutan, label, persen, nominal, status ('BELUM'|'LUNAS'),
paid_at, payment_id
```
Preset default saat invoice dibuat: **DP 50% · Term 2 40% · Pelunasan 10%**,
nominal dihitung dari grand_total, sisa pembulatan dibebankan ke termin terakhir.
Persen boleh diubah per invoice (proyek tertentu kadang beda).

### 3.7 `invoice_payments` (baru)
```
id, invoice_id, term_id (opsional), tanggal_bayar, nominal, metode,
referensi, bukti (data-URL/URL), dicatat_oleh, created_at
```
Satu invoice bisa punya banyak pembayaran. Status termin & invoice dihitung
dari total pembayaran (bukan diketik manual).

## 4. Alur yang dituju

```
CUSTOMER (Prospek)
   │  nama + WA
   ▼
RAB / BOQ  ──► disimpan sebagai ARSIP (tidak menggerakkan apa pun)
   │
   │  saat bikin invoice: pilih sumber
   │     ( ) ketik manual   (•) ambil dari RAB → total & item terisi
   ▼
INVOICE PENJUALAN (DRAFT → TERBIT)
   │  TERBIT  → nomor invoice dialokasikan server
   │          → status customer PROSPEK ➜ CUSTOMER   (usulan)
   ▼
TERMIN: DP 50% · Term 2 40% · Pelunasan 10%
   │  tiap termin dicatat pembayarannya (nominal + bukti)
   ▼
PIUTANG (sisa tagihan + jatuh tempo)
   ▼
CLOSING PROYEK (revenue invoice vs cost material+tukang)
```

## 5. Urutan kerja (bertahap, tiap tahap bisa dicek)

**Tahap 1 — Customer CRM (paling kecil, langsung berguna)**
- Migrasi tabel `customers` + kolom `projects.customer_id`.
- Modul CRM: list customer (nama, WA, status) + daftar project di bawahnya;
  form tambah/edit; ubah status Prospek ↔ Customer.
- Verifikasi: buat customer uji → pasang 2 project → cek tampil 1 akun dengan 2 project → hapus (self-cleaning).

**Tahap 2 — RAB & BOQ jadi arsip**
- Migrasi `rab` + `rab_items`.
- Tombol **Simpan** di modul RAB (sekarang hanya kalkulator) + daftar arsip RAB.
- Verifikasi: simpan RAB → refresh halaman → data masih ada.

**Tahap 3 — Invoice tersambung database**
- Migrasi `sales_invoices` + `invoice_terms` (+ RPC alokasi nomor invoice).
- Form invoice: pilih customer dari CRM, pilih RAB (opsional) → total & item terisi,
  termin otomatis 50/40/10.
- Verifikasi: bikin invoice → terbit → termin terbentuk 3 baris dengan nominal benar.

**Tahap 4 — Pembayaran & piutang**
- Migrasi `invoice_payments` + RPC catat pembayaran (atomic, anti dobel).
- Status termin & invoice dihitung dari pembayaran; kartu piutang + jatuh tempo.

**Tahap 5 — Sambung ke laporan**
- Revenue invoice masuk ke Project Finance / Closing (pembanding cost).
- Ini yang menyentuh angka Finance → perlu persetujuan Brooklyn/Finance dulu.

## 6. Yang TIDAK dilakukan
- Tidak mengubah alur PR/Pembelian/Serah Terima yang sudah live.
- Tidak menyentuh data produksi tanpa uji self-cleaning (buat → cek → hapus).
- RAB tidak memicu perubahan status/angka apa pun (sesuai keputusan DAT).
- Tidak menyambung revenue ke Finance sebelum tahap 5 disetujui.

## 7. Pertanyaan yang masih terbuka
1. Prospek → Customer: saat invoice **diterbitkan** (usulan) atau saat **pembayaran pertama masuk**?
2. Nomor proyek terbit kapan — saat deal RAB, saat invoice terbit, atau saat DP masuk?
