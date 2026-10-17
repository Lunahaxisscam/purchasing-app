# Kontrak Sales Invoice (Invoice Penjualan) — S4 + perbaikan P0 Brooklyn

> Status: **kontrak disepakati di kode, migrasi BELUM dijalankan.**
> Tidak ada tabel `sales_invoices` di Supabase saat dokumen ini ditulis
> (diverifikasi S4: `GET /rest/v1/sales_invoices` → `PGRST205`). Tidak ada
> migrasi/DDL dan tidak ada tulisan ke DB live dari kartu S4 maupun kartu P0 ini.
>
> Kartu ini (`t_fca26349`) memperbaiki temuan P0 review Brooklyn atas
> `store.js` di `HEAD 097e918` dan **tidak** mengklaim seluruh bisnis verified.

## 0. Ringkasan perbaikan P0 (kartu ini)

| # | Temuan Brooklyn | Perbaikan | Bukti uji |
|---|---|---|---|
| 1 | `normalizeTransition({id,to:'TERBIT',fields:{nominal:999}})` pada record `TERKIRIM` menulis `nominal=999` **dulu**, lalu gagal `NOT_A_DRAFT` → data beku berubah walau respons gagal | Validasi status/transisi/isi/bukti **sebelum** satu pun penulisan (`assertTransitionAllowed` + `normalizeFieldPatch` + `preflightIssue`). Urutan: baca → validasi → preflight → tulis | `B13-TERBIT/-TERKIRIM/-LUNAS/-BATAL` (nol write + data identik), `B13x*`, `B13y*`, `D7*` (byte-identik), `H5*` (HTTP) |
| 2 | `auth.js` `roleClient` dibuat dari klien anon **tanpa JWT** (hanya verifier memakai JWT); API `defaultBuildStore` juga anon tanpa JWT | Bila service role absent → sesi user terverifikasi diteruskan ke role SELECT **dan** ke store (`createSessionClient`, header `Authorization: Bearer <user JWT>`). RLS tetap menegakkan admin; tidak ada lagi ketergantungan akses anon ke `profiles` | `D6a…D6m` (mocked client options headers untuk role + store, termasuk kasus service-role & fail-closed) |
| 3 | `store.update` tanpa expected-status CAS; dua issue bersamaan bisa mengganti nomor / menciptakan dua proyek | Semua perubahan status memakai `updateIf(id, {status: expected}, patch)`. Yang kalah balapan → `ISSUE_CONFLICT`/`CONCURRENT_MODIFICATION`, tanpa nomor & tanpa proyek baru | `B14a…B14o`, `B14h…B14j` |
| 4 | `insertProject` sukses tapi link update gagal → proyek yatim | Klaim slot proyek (`project_claim`) + kode deterministik + idempoten per kode; bila tautan gagal → **kompensasi best-effort** `deleteProject`; bila kompensasi juga gagal → peringatan jujur + `project_issue_error` berisi id proyek | `B4y1…B4y7`, `B4z1…B4z3` |
| 5 | Klaim "transaksional" tidak boleh | `capabilities.transactional` = `hasIssueRpc` saja; tanpa RPC dilaporkan `atomicSequence:false`, `projectCompensation:'best-effort'`; gate `SALES_INVOICE_REQUIRE_RPC=1` → fail closed `ISSUE_REQUIRES_RPC` (503) | `B15a…B15f`, `B10i`, `G32`, `G33` |
| 6 | First-invoice → single project | Satu kode proyek tidak bisa diklaim dua invoice (`PROJECT_ALREADY_CLAIMED`); bentrok kode insert = tautkan proyek yang ada, bukan proyek kedua | `B14k…B14o`, `B4f`, `B5a…B5d` |
| 7 | Format nomor: Buku `NLyymm<XXX>` (authoritative, reset tahunan) vs `INV/NL` (baru, **tidak disepakati**) | Default = format Buku; `INV/NL` hanya aktif dengan `SALES_INVOICE_NO_FORMAT=inv-nl` **dan** `SALES_INVOICE_NO_FORMAT_ACK=1`; nomor lama TIDAK dimigrasi; discrepancy ditampilkan di UI (`si-numbering-banner`) + `number_formats_in_use` di GET | `A9a…A9m`, `B16a…B16t`, `G21…G24` |
| 8 | PDF hanya data verified; jangan default tanggal/PPN/termin | `issue_date` wajib eksplisit (`ISSUE_DATE_REQUIRED`), PPN tanpa default 11% (kosong → 0), termin tidak dikarang, form tidak mengisi tanggal hari ini | `A8a…A8g`, `G27…G29` |

## 1. Masalah yang diperbaiki S4 (latar)

`pages/api/sales-invoices.js` di `main@18fb594` menulis
`data/sales_invoices.json` **tanpa syarat**:

| Defect | Akibat nyata |
|---|---|
| Tanpa otorisasi apa pun | Siapa pun yang tahu URL bisa membaca semua tagihan, membuat invoice, dan mengubah status jadi `LUNAS`. |
| Penyimpanan file JSON di server | Di Vercel filesystem sementara & tidak dibagi antar-instance: data "hilang" setelah deploy. |
| Read-modify-write tanpa kunci | Dua POST bersamaan → satu invoice hilang. |
| Nomor invoice dikarang di klien | Dua admin / dua tab mendapat nomor sama. |
| Nomor proyek di-insert DULU | Simpan invoice gagal → nomor proyek yatim. |
| Status lahir `TERKIRIM` | Invoice baru langsung "terkirim" padahal belum dikirim. |
| `LUNAS` sekali klik | Status lunas tanpa bukti pembayaran apa pun. |
| PDF memuat data karangan | Rekening/PT/telepon/website karangan dicetak ke klien. |

## 2. Batas DRAFT ↔ TERBIT (mesin status)

Status: `DRAFT · TERBIT · TERKIRIM · DISETUJUI · DITOLAK · LUNAS · BATAL`

```
DRAFT ──TERBIT──▶ TERBIT ──┬──TERKIRIM──▶ TERKIRIM ──┬──DISETUJUI──▶ DISETUJUI ──LUNAS──▶ LUNAS
  │                        │                          ├──DITOLAK───▶ DITOLAK ──BATAL──▶ BATAL
  └──BATAL──▶ BATAL        ├──LUNAS──▶ LUNAS           └──LUNAS──▶ LUNAS
                           └──BATAL──▶ BATAL
```

- **`DRAFT`** — `invoice_no = null`, tanpa nomor proyek, isi boleh diubah.
  Tidak bisa ke `TERKIRIM`/`LUNAS`.
- **`TERBIT`** — nomor invoice dialokasikan server; proyek (mode `new`)
  diterbitkan **setelah** invoice tersimpan. Isi finansial **BEKU**.
- **`TERKIRIM`** — wajib `evidence.sent_channel`. Tidak pernah otomatis.
- **`LUNAS`** — wajib `paid_amount`, `paid_at`, `payment_ref`; harus sama
  dengan `grand_total` (toleransi Rp 1). `payment_verified_by` diisi dari sesi.
- **`BATAL`/`LUNAS`** final; nomor invoice tidak didaur ulang.

### 2.1 Urutan operasi yang WAJIB (P0)

```
patchInvoice(store, {id, to, patch, evidence})
  1. getById
  2. assertTransitionAllowed(current, to)      # NOT_A_DRAFT / INVALID_TRANSITION / TERMINAL
  3. normalizeFieldPatch(patch, current)       # FIELD_NOT_PATCHABLE / INVALID_AMOUNT / ...
     └─ bila bukan DRAFT → ISSUED_INVOICE_FROZEN
  4. validasi bukti (TERKIRIM / LUNAS)         # EVIDENCE_REQUIRED / PAYMENT_AMOUNT_MISMATCH
  5. bila to === TERBIT:
        preflightIssue(...)                    # format nomor, gate RPC, kode proyek, klaim ganda
        baru koreksi draf (CAS) → issueInvoice
     selain itu:
        updateIf(id, {status: current.status}, patch)   # CAS; null → CONCURRENT_MODIFICATION
```

Langkah 2–4 **murni**: tidak ada satu pun panggilan `update`/`insert`.
Itulah yang menutup temuan "respons gagal tapi nominal beku sudah berubah".

## 3. Nomor invoice — format authoritative vs discrepancy

| Format | Bentuk | Periode | Status |
|---|---|---|---|
| `legacy-buku` (authoritative) | `NL<yy><mm><urut 3 digit>` — mis. `NL2610001` | **tahunan** (urut reset 1 Jan) | default, dipakai bila env kosong |
| `inv-nl` | `INV/NL/<yyyy>/<mm>/<urut 3 digit>` — mis. `INV/NL/2026/10/001` | bulanan | **belum disepakati**; butuh `SALES_INVOICE_NO_FORMAT_ACK=1` |

- Sumber authoritative: **Buku dari Obsidian** (`NLyymm<XXX>`, reset tahunan).
- `INV/NL` hanya aktif bila operator menyetel dua env sekaligus. Tanpa ACK →
  `resolveInvoiceNumberFormat()` mengembalikan `blocked:true` dan penerbitan
  ditolak `NUMBER_FORMAT_NOT_AGREED` (409) **sebelum** nomor dialokasikan.
- **Tidak ada migrasi nomor lama.** `parseAnyInvoiceNo()` membaca dua format;
  alokasi hanya menghitung nomor dengan format yang sama
  (`nextSequenceForFormat`), dan GET mengembalikan
  `number_formats_in_use: { 'legacy-buku': n, 'inv-nl': m, unknown: k }`.
  UI menampilkan banner discrepancy (`data-testid="si-numbering-banner"`).

## 4. Concurrency — apa yang dijamin, apa yang TIDAK

Dijamin (diuji):

1. **CAS status**: `updateIf(id, {status: 'DRAFT'}, ...)` — dua issue
   bersamaan: tepat satu menang, yang kalah `ISSUE_CONFLICT`/`NOT_A_DRAFT`,
   **satu** nomor, **satu** proyek (`B14a…B14g`).
2. **Unique index** `invoice_no` menutup balapan alokasi; retry melewati nomor
   yang sudah ditolak (tidak bergantung pembacaan ulang yang basi) — `B9`.
3. **Klaim slot proyek** (`project_claim`) + kode deterministik → proyek kedua
   tidak dibuat (`B4y`, `B14d`).
4. **Kompensasi best-effort**: tautan proyek gagal → `deleteProject` bila
   proyek baru dibuat oleh kita (`B4y2/B4y3`); gagal hapus → peringatan
   PERBAIKAN MANUAL + id proyek (`B4z`).

**TIDAK dijamin tanpa RPC** (jujur):

- Alokasi nomor + insert proyek + tautan **bukan satu transaksi**. Bila proses
  mati di antara langkah 3–4, proyek bisa ada tanpa tautan → terdeteksi lewat
  `project_issue_error` / peringatan, bukan hilang diam-diam.
- Karena itu `capabilities.transactional=false` dan `atomicSequence=false`
  selama `hasIssueRpc=false`. `SALES_INVOICE_REQUIRE_RPC=1` membuat penerbitan
  **fail closed** (`ISSUE_REQUIRES_RPC`, 503) sampai RPC tersedia — pilihan
  yang disarankan untuk produksi kanonik.

## 5. Handoff Supabase kanonik (BELUM dijalankan — jangan DDL dari kartu ini)

Skema usulan (aditif, RLS admin-only) — sama seperti versi S4 dengan tambahan
kolom untuk P0: `number_format`, `project_claim jsonb`, `project_issue_error`.
**Jangan jalankan sebelum DAT menyetujui.**

```sql
-- USULAN, BELUM DIJALANKAN
create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  schema_version int not null default 3,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','TERBIT','TERKIRIM','DISETUJUI','DITOLAK','LUNAS','BATAL')),
  invoice_no text unique,
  number_format text,                       -- 'legacy-buku' | 'inv-nl' (BARU, P0)
  customer_id uuid, rab_version_id uuid,
  project_id uuid references public.projects(id) on delete set null,
  project_code text,
  project_issued boolean not null default false,
  project_claim jsonb,                      -- {code, invoice_id, project_id, linked_at} (BARU, P0)
  project_issue_error text,                 -- jejak kegagalan tautan (BARU, P0)
  project_intent jsonb not null default '{}'::jsonb,
  customer_name text not null, customer_phone text,
  project_name text, project_address text, rab_reff text,
  nominal numeric(16,2) not null check (nominal > 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  tax_amount numeric(16,2) not null default 0,
  grand_total numeric(16,2) not null,
  notes text, payment_terms text,
  issue_date date not null, due_date date,
  issued_at timestamptz, sent_at timestamptz, sent_channel text,
  paid_at date, paid_amount numeric(16,2), payment_ref text,
  payment_verified_by uuid, payment_verified_at timestamptz, voided_at timestamptz,
  idempotency_key text unique, request_fingerprint text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lunas_needs_proof check (status <> 'LUNAS' or (
    paid_amount is not null and paid_at is not null
    and payment_ref is not null and payment_verified_by is not null)),
  constraint draft_has_no_number check (status <> 'DRAFT' or invoice_no is null),
  constraint issued_has_number check (status = 'DRAFT' or invoice_no is not null),
  constraint terkirim_needs_channel check (status <> 'TERKIRIM' or sent_channel is not null)
);
create unique index if not exists sales_invoices_project_code_key
  on public.sales_invoices (project_code) where project_code is not null;  -- 1 invoice → 1 proyek
alter table public.sales_invoices enable row level security;
create policy sales_invoices_admin_all on public.sales_invoices
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
```

### RPC transaksional (usulan; kode sudah menyiapkan jalurnya)

`SALES_INVOICE_ISSUE_RPC=1` + `SALES_INVOICE_ISSUE_RPC_NAME=sales_invoice_issue`.
RPC wajib: `select ... for update` pada baris invoice, tolak bila status bukan
DRAFT, alokasi nomor per format, update status, **insert proyek di transaksi
yang sama**, lalu kembalikan baris. Selama RPC belum ada, jalur baca-lalu-tulis
+ CAS + unique index + kompensasi best-effort yang dipakai — dan itu
dilaporkan sebagai non-transaksional.

## 6. Variabel lingkungan

| Var | Arti |
|---|---|
| `SALES_INVOICE_STORE` | `auto` · `supabase` · `file`. `file` ditolak di produksi. |
| `SALES_INVOICE_PREVIEW_TOKEN` | Wajib bila tanpa kredensial Supabase (header `x-preview-token`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Dipakai server setelah `verifyAdmin`. **Bila tidak ada**, sesi user terverifikasi yang dipakai (RLS tetap menegakkan admin) — bukan klien anon. |
| `SALES_INVOICE_NO_FORMAT` | `legacy-buku` (default) · `inv-nl` (butuh ACK). |
| `SALES_INVOICE_NO_FORMAT_ACK` | `1` = operator/pemilik bisnis menyetujui format `inv-nl`. |
| `SALES_INVOICE_ISSUE_RPC` | `1` = pakai RPC transaksional bila tersedia. |
| `SALES_INVOICE_REQUIRE_RPC` | `1` = penerbitan **fail closed** sampai RPC tersedia. |

## 7. Kontrak API

| Method | Perilaku |
|---|---|
| `GET` | `{ ok, invoices, storage, numbering, number_formats_in_use, auth }`. `storage.durable=false` → banner pratinjau; `numbering.blocked` → banner discrepancy. |
| `POST` | Membuat **DRAFT** saja. `Idempotency-Key` → retry 200 `replayed:true`. |
| `PATCH` | `{ id, status, fields?, evidence? }`. `fields` hanya untuk draf; field di luar daftar putih (`status`, `invoice_no`, `grand_total`, …) → `FIELD_NOT_PATCHABLE`. |
| lain | `405` + `Allow`. |

Kode error penting: `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`INITIAL_STATUS_MUST_BE_DRAFT`, `INVOICE_NO_SERVER_ASSIGNED`,
`ISSUE_DATE_REQUIRED`, `EVIDENCE_REQUIRED` (400), `INVALID_TRANSITION`,
`ISSUED_INVOICE_FROZEN`, `NOT_A_DRAFT`, `FIELD_NOT_PATCHABLE`,
`CONCURRENT_MODIFICATION`, `ISSUE_CONFLICT`, `PROJECT_ALREADY_CLAIMED`,
`DUPLICATE_PROJECT_CODE`, `NUMBER_FORMAT_NOT_AGREED`, `PAYMENT_AMOUNT_MISMATCH`
(409), `ISSUE_REQUIRES_RPC`, `SCHEMA_UNAVAILABLE`, `STORE_UNAVAILABLE` (503).

## 8. PDF

- Tidak ada rekening/telepon/website/nama badan usaha karangan.
- Identitas penerbit hanya dari opsi `issuer`; rekening dari `payment`.
  Kosong → "IDENTITAS PENERBIT BELUM DIISI" / "DATA REKENING BELUM DIISI".
- `DRAFT` → watermark "DRAF — BUKAN TAGIHAN SAH"; `BATAL` → "BATAL — TIDAK BERLAKU".
- PPN dari record; tanpa pajak → "Tidak dipungut". Termin hanya dicetak bila
  diisi admin (tidak ada default).

## 9. Blocker yang masih terbuka

1. **Tabel `sales_invoices` belum ada** → `503 SCHEMA_UNAVAILABLE`.
2. **RPC transaksional belum ada** → penerbitan non-transaksional; aktifkan
   `SALES_INVOICE_REQUIRE_RPC=1` bila bisnis butuh jaminan penuh.
3. **Format nomor**: `INV/NL` belum disepakati; default sekarang format Buku.
   Keputusan pemilik bisnis masih diperlukan bila ingin pindah format.
4. **Data penerbit & rekening belum tersimpan di mana pun** → invoice tidak
   boleh dikirim ke klien sebelum diisi.
5. **Termin / pembayaran bertahap** belum ada tabelnya (LUNAS hanya penuh).

## 10. Verifikasi

```bash
python3 scripts/sales-invoice-test/run.py          # A+B+C/D+E/F/G
python3 scripts/sales-invoice-test/run_regression.py
npx next build && ENABLE_SMOKE=1 npx next build
SI_PREVIEW_TOKEN=<token> node scripts/sales-invoice-test/e2e_runtime_test.mjs http://127.0.0.1:<port>
```

Hasil terakhir: A 92, B 160, C+D 93, E+F+G 93 (total 438 assertion) + e2e HTTP 45.
