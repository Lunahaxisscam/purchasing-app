# Modul Invoice Penjualan (Sales Invoice) — Admin Suite

Riwayat: `t_ff3a96cf` (buka modul) → `t_22865fc4` (perketat persistence &
idempotensi). Kontrak lengkap: [`docs/sales-invoice-contract.md`](../../docs/sales-invoice-contract.md).

## Cakupan yang berjalan sekarang

- **Menu + halaman admin-only.** Item `Invoice Penjualan` di section Admin Suite
  (`lib/constants.js`, `adminOnly`), guard render di `pages/index.js`, dan
  **guard server** di `pages/api/sales-invoices.js`.
- **Buat invoice sebagai DRAF.** Form hanya menyimpan draf; nomor invoice dan
  nomor proyek baru terbit saat tombol **Terbitkan** ditekan.
- **Aksi status eksplisit** dengan bukti:
  * `Terbitkan` → server mengalokasikan `INV/NL/TAHUN/BULAN/URUT`;
  * `Sudah dikirim` → wajib pilih kanal (WhatsApp / Email / cetak / kurir);
  * `Lunas` → wajib nominal diterima + tanggal + referensi pembayaran, dan
    nominal harus sama dengan total tagihan;
  * `Batalkan` → nomor invoice tetap tercatat terpakai.
- **PDF** A4 native (tanpa dependensi) dengan watermark untuk draf/batal.
- **Banner penyimpanan jujur**: membedakan "tersimpan di Supabase" vs
  "pratinjau lokal (hilang saat deploy)".

## Yang SENGAJA belum ada

| Item | Alasan |
|---|---|
| Tabel `sales_invoices` | Migrasi **belum dijalankan** (blocker, lihat kontrak §3 & §7). |
| Data penerbit & rekening di PDF | Belum ada sumber terverifikasi; PDF menandai "BELUM DIISI" alih-alih mengarang. |
| Termin / pembayaran bertahap | Belum ada tabelnya; `LUNAS` hanya untuk pembayaran penuh. |
| Pengiriman otomatis (email/WA) | Status `TERKIRIM` adalah catatan manual admin, bukan pengiriman. |

## Keamanan

- Setiap method (`GET`/`POST`/`PATCH`) wajib lolos `verifyAdmin()`:
  JWT Supabase **diverifikasi** ke server auth, lalu peran dibaca dari tabel
  `profiles`. Hanya `admin` yang lulus (403 untuk peran lain, 401 tanpa sesi).
- Tanpa kredensial Supabase, endpoint butuh `SALES_INVOICE_PREVIEW_TOKEN`
  (header `x-preview-token`); tanpa itu semua permintaan ditolak (503).
- Penyimpanan file JSON **ditolak di produksi** (fail closed) — bukan menulis
  file di server yang ephemeral.
- Uang tidak dipercaya dari klien: `tax_amount` dan `grand_total` selalu
  dihitung ulang server.
- `payment_verified_by` diambil dari sesi admin, bukan dari body permintaan.

## Menjalankan uji

```bash
python3 scripts/sales-invoice-test/run.py
```

4 harness, 294 assertion:

| Harness | Isi |
|---|---|
| `contract_test.mjs` | Mesin status, format nomor, validasi payload, uang dihitung ulang, field beku. |
| `store_test.mjs` | Idempotensi (termasuk setelah restart), alokasi nomor, balapan, proyek yatim, LUNAS tanpa bukti, store fail-closed. |
| `auth_api_test.mjs` | Otorisasi 401/403/503 per method, 405, 400 validasi, 409 transisi & nominal, verifikator dari sesi. |
| `render_test.mjs` | PDF bebas data karangan + watermark, render jsdom (tombol status eksplisit), wiring registry/pages/constants. |

## Untuk mengaktifkan penyimpanan nyata

1. Setujui & jalankan migrasi di `docs/sales-invoice-contract.md` §3 (aditif, RLS admin-only).
2. Set `SALES_INVOICE_STORE=supabase` (+ `SUPABASE_SERVICE_ROLE_KEY`).
3. Isi data penerbit & rekening (sumber terverifikasi) agar PDF tidak lagi
   menandai "BELUM DIISI".
4. Opsional: pasang RPC `sales_invoice_issue` dan set `SALES_INVOICE_ISSUE_RPC=1`
   supaya alokasi nomor + penerbitan proyek satu transaksi.
