# Kontrak Sales Invoice (Invoice Penjualan) — t_22865fc4 (S4)

> Status: **kontrak disepakati di kode, migrasi BELUM dijalankan.**
> Tidak ada tabel `sales_invoices` di Supabase saat dokumen ini ditulis
> (diverifikasi: `GET /rest/v1/sales_invoices` → `PGRST205`, "Could not find the
> table 'public.sales_invoices' in the schema cache"). Tidak ada migrasi yang
> ditambahkan dan tidak ada tulisan ke DB live dari kartu ini.

## 1. Masalah yang diperbaiki

`pages/api/sales-invoices.js` di `main@18fb594` menulis
`data/sales_invoices.json` **tanpa syarat**:

| Defect | Akibat nyata |
|---|---|
| Tanpa otorisasi apa pun | Siapa pun yang tahu URL bisa membaca semua tagihan, membuat invoice, dan mengubah status jadi `LUNAS`. Guard peran di UI (`pages/index.js`) hanya menyembunyikan halaman — bukan keamanan. |
| Penyimpanan file JSON di server | Di Vercel filesystem bersifat sementara dan tidak dibagi antar-instance: data "hilang" setelah deploy, dan dua instance melihat daftar berbeda. UI tetap bilang "tersimpan". |
| Read-modify-write tanpa kunci | Dua POST bersamaan → satu invoice hilang (`unshift` lalu `writeFileSync` saling menimpa). |
| Nomor invoice dikarang di klien | `generateInvoiceNumber()` menghitung dari daftar yang dimuat di browser; dua admin / dua tab mendapat nomor sama. |
| Nomor proyek di-insert DULU | `CreateInvoiceModal` meng-`insert` ke `projects` **sebelum** invoice disimpan. Kalau simpan invoice gagal → nomor proyek yatim terpakai tanpa dokumen. |
| Status lahir `TERKIRIM` | Invoice baru langsung berstatus "terkirim" padahal belum dikirim ke siapa pun. |
| `LUNAS` sekali klik | Tombol "✓ Lunas" mengubah status tanpa bukti pembayaran apa pun. |
| PDF memuat data karangan | Nomor rekening `527-189-9900`, "PT NOIR LIVING INDONESIA", telepon `+62 812-9900-8800`, dan `www.noirliving.id` dicetak di dokumen yang dikirim ke klien. |

## 2. Batas DRAFT ↔ TERBIT (mesin status)

Status: `DRAFT · TERBIT · TERKIRIM · DISETUJUI · DITOLAK · LUNAS · BATAL`

```
DRAFT ──TERBIT──▶ TERBIT ──┬──TERKIRIM──▶ TERKIRIM ──┬──DISETUJUI──▶ DISETUJUI ──LUNAS──▶ LUNAS
  │                        │                          ├──DITOLAK───▶ DITOLAK ──BATAL──▶ BATAL
  └──BATAL──▶ BATAL        ├──LUNAS──▶ LUNAS           └──LUNAS──▶ LUNAS
                           └──BATAL──▶ BATAL
```

Aturan yang ditegakkan **server** (`modules/sales-invoice/contract.js`):

- **`DRAFT`** — belum terbit. `invoice_no = null`, tidak ada nomor proyek,
  isi boleh diubah, boleh dibuang. **Tidak bisa** ke `TERKIRIM`/`LUNAS`.
- **`TERBIT`** — titik *issued*: nomor invoice dialokasikan server, nomor proyek
  (bila dipilih mode `new`) diterbitkan **setelah** invoice tersimpan. Isi
  finansial **BEKU** (`IMMUTABLE_AFTER_ISSUE`).
- **`TERKIRIM`** — hanya lewat aksi eksplisit + **wajib** `evidence.sent_channel`
  (WhatsApp / Email / cetak-serah / kurir). Tidak pernah otomatis.
- **`LUNAS`** — **wajib** `paid_amount`, `paid_at`, `payment_ref`; `paid_amount`
  harus sama dengan `grand_total` (toleransi Rp 1). Pembayaran sebagian
  **ditolak** dengan `PAYMENT_AMOUNT_MISMATCH`. `payment_verified_by` diisi dari
  sesi admin yang sudah diverifikasi — nilai dari body diabaikan.
- **`BATAL` / `LUNAS`** final. Nomor invoice **tidak didaur ulang**.

`TERBIT → LUNAS` diizinkan karena klien bisa membayar sebelum admin mencatat
pengiriman; gerbang sebenarnya untuk `LUNAS` adalah bukti pembayaran.

## 3. Handoff Supabase kanonik (BELUM dijalankan)

Skema usulan — **aditif**, RLS admin-only, pola sama dengan modul lain.
**Jangan jalankan sebelum DAT menyetujui.**

```sql
-- USULAN, BELUM DIJALANKAN
create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  schema_version int  not null default 3,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','TERBIT','TERKIRIM','DISETUJUI','DITOLAK','LUNAS','BATAL')),

  -- nomor hanya ada setelah terbit; unik per periode
  invoice_no text unique,
  invoice_period text generated always as (
    case when invoice_no is null then null
         else substring(invoice_no from '^INV/NL/(\d{4}/\d{2})/') end
  ) stored,

  -- relasi & snapshot
  customer_id uuid,                          -- CRM (nullable: modul CRM belum ada)
  rab_version_id uuid,                       -- RAB final yang disetujui
  project_id uuid references public.projects(id) on delete set null,
  project_code text,
  project_issued boolean not null default false,
  project_intent jsonb not null default '{}'::jsonb,

  -- snapshot identitas (dokumen harus bisa dicetak ulang apa adanya)
  customer_name text not null,
  customer_phone text,
  project_name text,
  project_address text,
  rab_reff text,

  -- uang (dihitung server; klien tidak dipercaya)
  nominal numeric(16,2) not null check (nominal > 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  tax_amount numeric(16,2) not null default 0,
  grand_total numeric(16,2) not null,
  notes text,
  payment_terms text,

  -- tanggal & jejak status
  issue_date date not null,
  due_date date,
  issued_at timestamptz,
  sent_at timestamptz,
  sent_channel text,
  paid_at date,
  paid_amount numeric(16,2),
  payment_ref text,
  payment_verified_by uuid,
  payment_verified_at timestamptz,
  voided_at timestamptz,

  -- idempotensi & audit
  idempotency_key text unique,
  request_fingerprint text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- gerbang bukti di level DB (bukan hanya aplikasi)
  constraint lunas_needs_proof check (
    status <> 'LUNAS' or (
      paid_amount is not null and paid_at is not null
      and payment_ref is not null and payment_verified_by is not null
    )
  ),
  constraint draft_has_no_number check (status <> 'DRAFT' or invoice_no is null),
  constraint issued_has_number check (status = 'DRAFT' or invoice_no is not null),
  constraint terkirim_needs_channel check (status <> 'TERKIRIM' or sent_channel is not null)
);

create index if not exists sales_invoices_period_idx
  on public.sales_invoices (invoice_period, invoice_no);
create index if not exists sales_invoices_status_idx
  on public.sales_invoices (status, issue_date);

alter table public.sales_invoices enable row level security;

-- Hanya admin (pola profiles) yang boleh membaca/menulis.
create policy sales_invoices_admin_all on public.sales_invoices
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
```

### Kenapa unique index saja belum cukup

`invoice_no` unik menutup **balapan** (dua permintaan dapat nomor sama → satu
gagal, dicoba ulang dengan nomor berikutnya; diuji di harness `B9`). Tapi
`max(seq)+1` tetap punya jendela balapan, jadi urutan aman yang dipakai kode:

1. baca nomor yang sudah terpakai pada periode → `max+1`;
2. `UPDATE` dengan nomor itu; unique index menolak bila kalah balapan;
3. ulangi dengan nomor berikutnya (nomor yang sudah ditolak **dilewati**,
   tidak bergantung pada pembacaan ulang yang bisa basi);
4. setelah 5 percobaan → `NUMBER_ALLOCATION_EXHAUSTED` (409).

### RPC transaksional (opsional, lebih kuat)

Bila DAT menginginkan alokasi + penerbitan proyek dalam satu transaksi:

```sql
-- USULAN, BELUM DIJALANKAN
create or replace function public.sales_invoice_issue(p_id uuid, p_project jsonb default null)
returns public.sales_invoices
language plpgsql security definer set search_path = public as $$
declare v_row public.sales_invoices; v_seq int; v_period text;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_row from sales_invoices where id = p_id for update;
  if v_row.status <> 'DRAFT' then
    raise exception 'NOT_A_DRAFT' using errcode = 'P0001';
  end if;
  v_period := to_char(v_row.issue_date, 'YYYY/MM');
  select coalesce(max(substring(invoice_no from '(\d+)$')::int), 0) + 1
    into v_seq from sales_invoices
   where invoice_no like 'INV/NL/' || v_period || '/%';
  update sales_invoices
     set status = 'TERBIT',
         invoice_no = 'INV/NL/' || v_period || '/' || lpad(v_seq::text, 3, '0'),
         issued_at = now()
   where id = p_id returning * into v_row;
  -- proyek baru diterbitkan DI DALAM transaksi yang sama
  ...
  return v_row;
end $$;
```

Kode sudah menyiapkan jalurnya: set `SALES_INVOICE_ISSUE_RPC=1` +
`SALES_INVOICE_ISSUE_RPC_NAME=sales_invoice_issue`. Selama RPC belum ada,
`createSupabaseStore` memakai jalur baca-lalu-tulis di atas.

## 4. Variabel lingkungan

| Var | Arti |
|---|---|
| `SALES_INVOICE_STORE` | `auto` (default) · `supabase` · `file`. `file` **ditolak** bila `NODE_ENV=production` dan `VERCEL_ENV` bukan `preview`/`development`. |
| `SALES_INVOICE_PREVIEW_TOKEN` | Wajib bila tidak ada kredensial Supabase. Tanpa ini endpoint menolak **semua** permintaan (503, fail closed). Header: `x-preview-token`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Dipakai server untuk mutasi setelah `verifyAdmin` lulus. Bila tidak ada, jatuh ke anon key (RLS tetap berlaku). |
| `SALES_INVOICE_ISSUE_RPC` | `1` untuk memakai RPC transaksional. |

## 5. Kontrak API

Semua respons `{ ok: true|false, ... }`. Error selalu menyertakan `code`
(+ `blocker` / `suggested_code` / `expected_amount` bila relevan).

| Method | Perilaku |
|---|---|
| `GET` | `{ ok, invoices, storage, auth }`. `storage.durable=false` → UI wajib menampilkan banner pratinjau. |
| `POST` | Membuat **DRAFT** saja. Body tanpa `status`/`invoice_no` (ditolak 400 bila dikirim). `Idempotency-Key` header → retry mengembalikan invoice lama (200, `replayed:true`). |
| `PATCH` | `{ id, status, fields?, evidence? }`. `fields` hanya untuk draf. `TERBIT` lewat jalur khusus (alokasi nomor). |
| lain | `405` + header `Allow`. |

Kode error penting: `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`INITIAL_STATUS_MUST_BE_DRAFT` (400), `INVOICE_NO_SERVER_ASSIGNED` (400),
`EVIDENCE_REQUIRED` (400), `INVALID_TRANSITION` (409),
`ISSUED_INVOICE_FROZEN` (409), `PAYMENT_AMOUNT_MISMATCH` (409),
`DUPLICATE_PROJECT_CODE` (409 + `suggested_code`),
`IDEMPOTENCY_KEY_REUSED` (409), `TERMINAL_STATUS` (409),
`SCHEMA_UNAVAILABLE` (503 + `blocker`), `STORE_UNAVAILABLE` (503).

## 6. PDF

- **Tidak ada** lagi rekening/telepon/website/nama badan usaha karangan.
- Identitas penerbit hanya dicetak dari opsi `issuer` (`legal_name`, `address`,
  `phone`, `email`, `website`); rekening dari `payment` (`bank_name`,
  `account_number`, `account_holder`). Sumber terverifikasi = Settings.
- Bila kosong, dokumen mencetak **"IDENTITAS PENERBIT BELUM DIISI"** /
  **"DATA REKENING BELUM DIISI"** dan UI memberi tahu field mana yang kurang
  (`missingIssuerFields` / `missingPaymentFields`).
- `DRAFT` diberi watermark "DRAF — BUKAN TAGIHAN SAH"; `BATAL` diberi
  "BATAL — TIDAK BERLAKU".
- PPN tidak lagi diasumsikan 11%; tarif dari record. Tanpa pajak → "Tidak dipungut".

## 7. Blocker yang masih terbuka

1. **Tabel `sales_invoices` belum ada** (PGRST205 terverifikasi). Sampai migrasi
   §3 dijalankan, `SALES_INVOICE_STORE=supabase` akan menjawab
   `503 SCHEMA_UNAVAILABLE` — bukan gagal diam-diam.
2. **Data penerbit & rekening belum tersimpan di mana pun** (tidak ada tabel
   `settings` yang memuatnya). Sampai ada, PDF jujur menandai "BELUM DIISI" dan
   invoice **tidak boleh** dikirim ke klien.
3. **Nomor proyek**: mode pratinjau tidak menerbitkan proyek sama sekali;
   invoice tetap terbit dengan `project_issued=false` + peringatan. Di Supabase,
   proyek diterbitkan setelah invoice tersimpan (tidak ada proyek yatim).
4. **Termin / pembayaran bertahap** belum ada tabelnya. Saat ini `LUNAS` hanya
   untuk pembayaran penuh; pembayaran sebagian ditolak.
5. **`modules/registry.js` / `lib/constants.js` / `pages/index.js`** adalah file
   CORE. Perubahan di kartu ini hanya menambah entri registry (file baru +
   komentar); tidak mengubah rute, label, atau alur. Perlu dikoordinasikan
   dengan perubahan CORE dari commit `79bbaf5` (Sprint S1 Bit) saat integrasi ke
   `main` — branch ini belum memuat commit tersebut.

## 8. Verifikasi

```bash
python3 scripts/sales-invoice-test/run.py
```

Mencakup 4 harness: kontrak murni, store/idempotensi (termasuk negative cases),
otorisasi + API handler (handler diuji langsung tanpa UI), serta PDF/render/wiring.
