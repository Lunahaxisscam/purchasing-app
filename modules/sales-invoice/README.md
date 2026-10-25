# Modul Invoice Penjualan (Sales Invoice) — Admin Suite

Riwayat: `t_ff3a96cf` (buka modul) → `t_22865fc4` (perketat persistence &
idempotensi) → `t_fca26349` (perbaikan P0 review Brooklyn: mutasi invoice beku,
RLS sesi, race penerbitan). Kontrak lengkap:
[`docs/sales-invoice-contract.md`](../../docs/sales-invoice-contract.md).

## Cakupan yang berjalan sekarang

- **Menu + halaman admin-only.** Item `Invoice Penjualan` di section Admin Suite
  (`lib/constants.js`, `adminOnly`), guard render di `pages/index.js`, dan
  **guard server** di `pages/api/sales-invoices.js`.
- **Buat invoice sebagai DRAF.** Form hanya menyimpan draf; nomor invoice dan
  nomor proyek baru terbit saat tombol **Terbitkan** ditekan.
- **Aksi status eksplisit** dengan bukti:
  * `Terbitkan` → server mengalokasikan nomor **format Buku (Obsidian)
    `NL<yymm><XXX>`**, urut 3 digit, reset tahunan;
  * `Sudah dikirim` → wajib pilih kanal (WhatsApp / Email / cetak / kurir);
  * `Lunas` → wajib nominal diterima + tanggal + referensi pembayaran, dan
    nominal harus sama dengan total tagihan;
  * `Batalkan` → nomor invoice tetap tercatat terpakai.
- **PDF** A4 native (tanpa dependensi) dengan watermark untuk draf/batal.
- **Dua banner jujur**: status penyimpanan (Supabase vs pratinjau lokal) dan
  discrepancy format nomor (`NL<yymm><XXX>` vs `INV/NL`).

## Perbaikan P0 (kartu `t_fca26349`)

| Temuan | Perbaikan |
|---|---|
| `{to:'TERBIT', fields:{nominal}}` pada invoice non-draf mengubah nominal **sebelum** gagal | Validasi status/transisi/isi/bukti **sebelum** penulisan; `fields` dibatasi daftar putih (`FIELD_NOT_PATCHABLE`) |
| `roleClient` & store dibuat dari klien anon tanpa JWT | Sesi user terverifikasi diteruskan (header `Authorization`) bila service role tidak ada → RLS tetap menegakkan admin |
| `update` tanpa CAS; dua issue bersamaan | Semua perubahan status lewat `updateIf` (CAS); kalah balapan = 409 tanpa nomor/proyek baru |
| Proyek yatim saat tautan gagal | Klaim slot proyek + kompensasi best-effort (`deleteProject`) + `project_issue_error` |
| Klaim transaksional | `capabilities.transactional` hanya true bila RPC ada; `SALES_INVOICE_REQUIRE_RPC=1` = fail closed |
| Format nomor tidak disepakati | Default format Buku; `INV/NL` butuh `SALES_INVOICE_NO_FORMAT_ACK=1`; nomor lama tidak dimigrasi |

## Yang SENGAJA belum ada

| Item | Alasan |
|---|---|
| Tabel `sales_invoices` | Migrasi **belum dijalankan** (blocker, lihat kontrak §5 & §9). |
| RPC transaksional | Belum ada; penerbitan dilaporkan **non-transaksional** dan bisa dibuat fail closed. |
| Data penerbit & rekening di PDF | Belum ada sumber terverifikasi; PDF menandai "BELUM DIISI" alih-alih mengarang. |
| Termin / pembayaran bertahap | Belum ada tabelnya; `LUNAS` hanya untuk pembayaran penuh. |
| Pengiriman otomatis (email/WA) | Status `TERKIRIM` adalah catatan manual admin, bukan pengiriman. |

## Keamanan

- Setiap method (`GET`/`POST`/`PATCH`) wajib lolos `verifyAdmin()`:
  JWT Supabase **diverifikasi** ke server auth, lalu peran dibaca dari tabel
  `profiles`. Hanya `admin` yang lulus (403 untuk peran lain, 401 tanpa sesi).
- Bila `SUPABASE_SERVICE_ROLE_KEY` tidak tersedia, peran & store memakai **sesi
  user terverifikasi** (bukan klien anon tanpa JWT) — RLS tetap berlaku.
- Tanpa kredensial Supabase, endpoint butuh `SALES_INVOICE_PREVIEW_TOKEN`
  (header `x-preview-token`); tanpa itu semua permintaan ditolak (503).
- Penyimpanan file JSON **ditolak di produksi** (fail closed).
- Uang tidak dipercaya dari klien: `tax_amount` dan `grand_total` selalu
  dihitung ulang server. Tanggal terbit wajib eksplisit; PPN & termin tidak
  diberi default.
- `payment_verified_by` diambil dari sesi admin, bukan dari body permintaan.

## Menjalankan uji

```bash
python3 scripts/sales-invoice-test/run.py
```

4 harness, 438 assertion:

| Harness | Isi |
|---|---|
| `contract_test.mjs` (92) | Mesin status, format nomor (Buku + gate INV/NL), validasi payload, uang dihitung ulang, field beku, tanpa default tanggal/PPN/termin. |
| `store_test.mjs` (160) | Idempotensi, alokasi nomor, balapan, proyek yatim & kompensasi, CAS, **P0 nol-mutasi**, race issue, gate RPC & format nomor. |
| `auth_api_test.mjs` (93) | Otorisasi 401/403/503, 405, 400/409 transisi, verifikator dari sesi, **RLS sesi user** (mocked client headers), **P0 lewat handler** (byte-identik). |
| `render_test.mjs` (93) | PDF bebas data karangan + watermark, render jsdom, banner penyimpanan & discrepancy, wiring registry/pages/constants, gate statis. |

E2E HTTP nyata: `node scripts/sales-invoice-test/e2e_runtime_test.mjs <base-url>`
(45 assertion, termasuk H5 = P0 lewat HTTP).

## Untuk mengaktifkan penyimpanan nyata

1. Setujui & jalankan migrasi di `docs/sales-invoice-contract.md` §5 (aditif, RLS admin-only).
2. Set `SALES_INVOICE_STORE=supabase` (+ `SUPABASE_SERVICE_ROLE_KEY`).
3. Isi data penerbit & rekening (sumber terverifikasi) agar PDF tidak lagi
   menandai "BELUM DIISI".
4. Pasang RPC `sales_invoice_issue` dan set `SALES_INVOICE_ISSUE_RPC=1`, lalu
   pertimbangkan `SALES_INVOICE_REQUIRE_RPC=1` supaya penerbitan benar-benar
   atomik (fail closed sampai RPC siap).
