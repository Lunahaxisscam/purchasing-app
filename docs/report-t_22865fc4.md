# Laporan S4/7 — Harden Sales Invoice persistence & idempotensi

Kartu: `t_22865fc4` · Branch: `feat/ops-workflow-t_cde1b8ad` · Base: `main@18fb594`
Kontrak: [`docs/sales-invoice-contract.md`](sales-invoice-contract.md)

## Ringkas

`pages/api/sales-invoices.js` sekarang **menolak semua permintaan tanpa sesi admin
yang terverifikasi**, memakai **Supabase sebagai penyimpanan kanonik**, dan
memisahkan **draf dari terbit**. Penyimpanan file JSON tidak lagi dipakai tanpa
syarat: ia hanya pratinjau non-produksi dan **ditolak di produksi** (fail closed).

Tujuh defect nyata di jalur simpan diperbaiki, semuanya dibuktikan dengan uji
negatif (bukan hanya happy path).

## Defect yang diperbaiki (beserta buktinya)

| # | Defect di `main@18fb594` | Perbaikan | Uji |
|---|---|---|---|
| 1 | **Tanpa otorisasi apa pun.** Siapa pun bisa GET semua tagihan, POST invoice, PATCH jadi `LUNAS`. | `verifyAdmin()` di **setiap** method: JWT diverifikasi ke Supabase, peran dari tabel `profiles`, hanya `admin`. Fail closed (503) bila otorisasi belum dikonfigurasi. | C1a–C1k, C2a/b, H1 |
| 2 | **File JSON di server produksi.** Ephemeral di Vercel → data "hilang" setelah deploy, instance berbeda melihat daftar berbeda, UI tetap klaim "tersimpan". | Store dipilih eksplisit; `file` **ditolak** di produksi (`FILE_STORE_FORBIDDEN_IN_PRODUCTION`). UI menampilkan banner jujur `durable:false`. | B10a–B10h, D1c/d, H4 |
| 3 | **Read-modify-write tanpa kunci.** Dua POST bersamaan → satu invoice hilang. | Kunci `mkdir` + tulis atomic (tmp+rename) untuk store file; unique constraint + retry untuk Supabase. | B2c, B9a/b |
| 4 | **Nomor invoice dikarang di klien.** Dua admin/tab bisa dapat nomor sama. | Nomor dialokasikan **server** saat TERBIT, unik per periode, retry 5× dengan nomor yang sudah ditolak dilewati (tidak bergantung pembacaan ulang yang bisa basi). | A2a–A2h, B3a–B3f, B9a |
| 5 | **Nomor proyek di-insert DULU.** Invoice gagal → nomor proyek yatim. | Urutan dibalik: simpan invoice → **baru** terbitkan proyek. Kegagalan simpan invoice = nol proyek dibuat. Kegagalan proyek = invoice tetap sah + `project_issued:false` + peringatan. | **B4a–B4i**, B4x1–B4x4, B5a–B5d |
| 6 | **Lahir berstatus `TERKIRIM`.** Padahal belum dikirim ke siapa pun. | Invoice lahir `DRAFT`; `TERKIRIM` hanya lewat aksi eksplisit + wajib `sent_channel`. | B1a–B1e, B3b/c, B6b–B6d, D3g–D3j |
| 7 | **`LUNAS` sekali klik tanpa bukti.** | Wajib `paid_amount` + `paid_at` + `payment_ref`; nominal harus = total (toleransi Rp 1). Pembayaran sebagian ditolak `PAYMENT_AMOUNT_MISMATCH`. `payment_verified_by` dari sesi, bukan body. | B6e–B6i, D3k–D3r, A5e–A5h |
| 8 | **PDF memuat data karangan**: rekening `527-189-9900`, "PT NOIR LIVING INDONESIA", telp `+62 812-9900-8800`, `www.noirliving.id`. | Semua dihapus. Identitas/rekening hanya dicetak dari data terverifikasi; bila kosong → "BELUM DIISI" + UI menyebut field yang kurang. Draf/batal diberi watermark. | E7–E21 |

Tambahan: invoice yang sudah terbit **beku** (ubah nominal ditolak
`ISSUED_INVOICE_FROZEN`), dan `BATAL` tidak mendaur ulang nomor.

## Negative cases yang diuji (permintaan eksplisit)

- POST dengan `status: 'TERKIRIM'` → 400 `INITIAL_STATUS_MUST_BE_DRAFT` (tidak
  diturunkan diam-diam).
- POST dengan `invoice_no` dari klien → 400 `INVOICE_NO_SERVER_ASSIGNED`.
- `tax_amount`/`grand_total` karangan klien → diabaikan, dihitung ulang server.
- `nominal` 0/negatif/bukan angka, PPN > 100%, jatuh tempo sebelum terbit → 400.
- Idempotency key sama + isi berbeda → 409 `IDEMPOTENCY_KEY_REUSED`.
- Terbitkan invoice yang sudah terbit → 409 `NOT_A_DRAFT`.
- `DRAFT → TERKIRIM`, `DRAFT → LUNAS`, `TERBIT → DISETUJUI` → 409 `INVALID_TRANSITION`.
- `LUNAS`/`BATAL` final → 409 `TERMINAL_STATUS`.
- Kode proyek bentrok → 409 + `suggested_code`; invoice **tidak** terbit dan
  nomor invoice tidak terpakai.
- Tanpa JWT → 401; non-admin → 403; gagal baca `profiles` → 503; tanpa token
  pratinjau → 503; token salah → 401. Tidak ada satu pun yang menulis file.

## Verifikasi

```
sales-invoice-test  : 72 + 74 + 71 + 77 = 294 assertion, 0 gagal
e2e runtime (HTTP)  : 39 assertion, 0 gagal  ← server Next sungguhan
ENABLE_SMOKE build  : hijau
```

e2e runtime membuktikan alur penuh lewat HTTP nyata: GET tanpa sesi → **401**,
POST → 201 draf tanpa nomor, retry key sama → 200 `replayed` (bukan duplikat),
PATCH TERBIT → nomor `INV/NL/2026/10/001`, TERKIRIM tanpa kanal → 400, LUNAS
nominal kurang → 409, LUNAS lengkap → 200, LUNAS final → 409, invoice kedua
dapat nomor berbeda.

Harness regresi (12 suite): `rap-test`, `handover-compact`, `handover-flow`,
`purchase-flow`, `pr-purchase-compact` (130), `pr-estimator`, `pr-group`,
`approval-queue`, `fase2-save`, `showmore-list`, `material-acuan` — semua hijau.

**Satu suite merah:** `rab-boq-test` E7 gagal **pre-existing** — assertion mencari
string `'rab_boq', 'settings']` di `pages/index.js`, padahal daftar itu sudah
berubah sejak `ac71191` (S3 menambahkan `'rap'`). File `pages/index.js` **tidak
disentuh** oleh kartu ini. Tidak saya perbaiki karena bukan milik kartu S4.

## Keputusan desain

1. **`TERBIT` adalah status baru**, terpisah dari `TERKIRIM`. Tanpa ini, "terbit"
   dan "sudah dikirim" tidak bisa dibedakan — persis defect #6.
2. **`TERBIT → LUNAS` diizinkan** karena klien bisa membayar sebelum admin
   mencatat pengiriman; gerbang sebenarnya untuk `LUNAS` adalah **bukti
   pembayaran**, bukan status kirim.
3. **Uang selalu dihitung server.** `tax_amount` & `grand_total` dari klien
   diabaikan total.
4. **Proyek diterbitkan setelah invoice**, bukan sebelumnya. Kalau urutannya
   dibalik, kegagalan simpan meninggalkan nomor proyek terpakai tanpa dokumen.
5. **Fail closed, bukan fallback diam-diam.** Otorisasi tak terkonfigurasi → 503
   untuk semua permintaan; store file di produksi → 503; tabel belum ada → 503
   `SCHEMA_UNAVAILABLE` dengan penjelasan. Tidak ada "kalau ragu, izinkan".
6. **PDF jujur, bukan cantik.** Lebih baik dokumen bertanda "DATA REKENING BELUM
   DIISI" daripada mengarang nomor rekening yang bisa membuat klien salah
   transfer.

## Blocker (belum bisa diselesaikan di kartu ini)

1. **Tabel `sales_invoices` belum ada** — diverifikasi langsung:
   `GET /rest/v1/sales_invoices` → `PGRST205` "Could not find the table
   'public.sales_invoices' in the schema cache". Migrasi usulan ada di kontrak §3
   (**aditif, RLS admin-only, BELUM dijalankan**). Selama ini berlangsung,
   `SALES_INVOICE_STORE=supabase` menjawab 503 `SCHEMA_UNAVAILABLE` — bukan
   gagal diam-diam.
2. **Data penerbit & rekening belum punya sumber** di repo (tidak ada tabel
   `settings` yang memuatnya). Sampai diisi, PDF menandai "BELUM DIISI" dan
   invoice **tidak boleh** dikirim ke klien.
3. **Termin/pembayaran bertahap** belum ada tabelnya → `LUNAS` hanya untuk
   pembayaran penuh.
4. **Integrasi CORE.** `modules/registry.js` dan `pages/__smoke.js` berubah
   (entri registry + render smoke). Branch ini **belum memuat `79bbaf5`** (Sprint
   S1 Bit) — `79bbaf5` bukan ancestor `HEAD`. Saat integrasi ke `main`, entri
   registry `sales_invoice` perlu digabung manual dengan perubahan CORE dari
   `79bbaf5` (label "Pembelian"/"Serah Terima", merge menu Projects). Tidak ada
   rute, label, atau alur yang saya ubah selain komentar + daftar file.
5. **`scripts/pr-purchase-compact-test/render_test.mjs`** — assertion F1
   (kepemilikan file) diperluas: file `modules/sales-invoice/*` +
   `pages/api/sales-invoices.js` (milik kartu S4) dan `modules/rap/*` (milik S3,
   yang membuat assertion ini gagal pre-existing sejak `ac71191`). Larangan
   sebenarnya dipertahankan: tidak ada migrasi, `materials`/`vendors` tidak
   disentuh, `modules/handovers/actions.js` & `logic.js` tetap terkunci.

## File

**Baru:** `modules/sales-invoice/{contract,store,auth,apiClient}.js`,
`docs/sales-invoice-contract.md`, `scripts/sales-invoice-test/{contract,store,auth_api,render,e2e_runtime}_test.mjs`,
`scripts/sales-invoice-test/run_regression.py`

**Diubah:** `pages/api/sales-invoices.js` (ditulis ulang),
`modules/sales-invoice/{view.jsx,CreateInvoiceModal.jsx,pdf.js,README.md}`,
`modules/registry.js`, `pages/__smoke.js`,
`scripts/sales-invoice-test/run.py`,
`scripts/pr-purchase-compact-test/render_test.mjs`

**Tidak disentuh:** `migrations/` (nol migrasi), `data/` (file pratinjau tetap `[]`),
`lib/constants.js`, `pages/index.js`, `modules/rap/*`, `modules/requests/*`,
`modules/receivings/*`, `modules/handovers/*`, `components/*`.
