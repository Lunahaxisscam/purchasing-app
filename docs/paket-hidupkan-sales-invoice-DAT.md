# Paket Hidupkan Sales Invoice — SQL siap-paste untuk DAT

Kartu: `t_4765d061` · Branch: `feat/mapping-exec` · Basis: `c4032d1`
Pemilik eksekusi: **DAT** (Supabase SQL Editor) · Penyusun: Bamboo
Sumber kontrak: `docs/sales-invoice-contract.md` — DDL resmi ada di **§5** (di body tiket disebut "§3";
§3 di file kontrak adalah *penomoran*, bukan DDL).

| Item | Nilai |
|---|---|
| Status paket | **SIAP PASTE — BELUM DIJALANKAN.** Tidak ada satu pun SQL di dokumen ini yang sudah dijalankan ke Supabase oleh agen. |
| Sifat pekerjaan | Dokumen + SQL di repo git. Tidak ada koneksi DB, tidak ada tulis data, tidak ada perubahan kode staging. |
| Yang dibuat | **1 tabel baru** `public.sales_invoices`, **1 policy** RLS, **4 index** (3 otomatis dari constraint + 1 partial unique), **0 sequence**, **0 trigger** |
| Waktu eksekusi | ±10–15 menit (termasuk verifikasi UI) |
| Rollback | `PASTE R` — `drop table` dengan guard yang menolak jalan bila tabel sudah berisi baris |

---

## 0. Baca ini dulu (3 menit)

### 0.1 Siapa menjalankan apa

DAT menyalin **satu PASTE per langkah** ke Supabase SQL Editor, berurutan 1 → 4. Setiap PASTE punya
tiga bagian: **tujuan**, **SQL**, dan **hasil yang diharapkan**. Kalau hasilnya tidak sama dengan yang
tertulis, **berhenti** — jangan "dibetulkan" dengan mengubah SQL.

Agen (Bamboo) **tidak** mengeksekusi apa pun. SQL di dokumen ini sudah diuji ulang di PostgreSQL 16.15
lokal (bukan Supabase) dengan fixture tiruan `profiles` + `projects` — bukti di **Lampiran C**.

### 0.2 Apa yang dibuat paket ini — dan apa yang TIDAK disentuh

> **Paket ini tidak menyentuh tabel apa pun selain membuat objek BARU `sales_invoices`
> (+ index dan policy; tidak ada sequence karena kontrak tidak memakainya).** Tidak ada
> `ALTER`/`UPDATE`/`DELETE` pada tabel lain, tidak ada backfill, tidak ada migrasi data.

Konsekuensinya: **tidak perlu backup tabel apa pun** — termasuk `tukang_*`/`upah_*`, yang tidak
disentuh sama sekali oleh paket ini. Satu-satunya perubahan database adalah objek baru di atas.

| Objek | Aksi | Catatan |
|---|---|---|
| `public.sales_invoices` | **CREATE** (baru) | 41 kolom, 11 constraint |
| `sales_invoices_admin_all` | **CREATE** policy | admin-only, pola sama dengan `upah_*` |
| 4 index | **CREATE** | `pkey`, `invoice_no` unique, `idempotency_key` unique, `project_code` partial unique |
| `public.projects` | **tidak disentuh** | hanya dirujuk sebagai FK (`project_id … on delete set null`) |
| `public.profiles` | **tidak disentuh** | hanya dibaca policy untuk cek `role = 'admin'` |
| `upah_*`, `sales_customers`, `materials`, `vendors`, dll | **tidak disentuh** | dibuktikan dengan angka kontrol PASTE 1 vs PASTE 4 |
| Sequence | **tidak ada** | kontrak tidak memakai sequence (lihat §1.2) |
| Trigger | **tidak ada** | `updated_at` diisi aplikasi, bukan trigger |

### 0.3 Tiga hal yang paling perlu diperhatikan

1. **PASTE 2c (kolom `store`) itu WAJIB, jangan dilewati.** Kontrak §5 tidak memuat kolom `store`,
   tetapi kode menulisnya di setiap INSERT/UPDATE. Tanpa kolom itu, tombol **Simpan** langsung gagal
   `502` (`PGRST204`). Detail: §1.4.
2. **Isi "Jatuh Tempo" pada draf.** Kalau kolom itu dibiarkan kosong, UI mengirim `due_date = ""` dan
   PostgreSQL menolak (`22007 invalid input syntax for type date`) → Simpan gagal `502`. Ini bug kode
   (bukan skema) — lihat **K2** di §1.4 dan langkah aplikasi setelah PASTE 4. Paket ini **tidak**
   mengubah kode; kalau DAT ingin permanen, perlu kartu perbaikan kode terpisah.
3. **Jangan set `SALES_INVOICE_REQUIRE_RPC=1`.** RPC transaksional `sales_invoice_issue` belum ada;
   flag itu membuat **Terbitkan** gagal `503 ISSUE_REQUIRES_RPC` (fail closed by design).

Tambahan yang sering ditanyakan: setelah PASTE 4, **tidak ada** nomor invoice yang "hilang" atau
"mundur". Penomoran dihitung aplikasi dari baris yang ada (`max+1` per tahun) — bukan sequence DB.

### 0.4 Urutan paste

| PASTE | Isi | Menulis? | Gerbang / kriteria lulus |
|---|---|---|---|
| 1 | Pre-check: tabel sudah ada? prasyarat? angka kontrol modul lain | **tidak** (read-only) | verdict harus `LANJUT` |
| 2 | DDL kontrak §5 + kolom `store` (2c) | ya (DDL) | `CREATE TABLE` + `ALTER TABLE` tanpa error |
| 3 | RLS + policy admin-only + unique index `project_code` | ya (DDL) | policy & index terbentuk |
| 4 | Verifikasi: REST probe (a), struktur DB (b), uji UI (c) | **tidak** | `200` + `[]` (atau `401 42501` — lihat 4a); 41 kolom; 11 constraint; 4 index; 0 baris |
| R | Rollback (hanya kalau perlu) | ya (`DROP`) | tabel hilang, tidak ada sisa |

### 0.5 Aturan umum saat menyalin

- **Satu PASTE = satu kali klik Run.** Jangan memotong blok di tengah, jangan menjalankan dua PASTE sekaligus.
- PASTE 2, 3, R dibungkus `begin; … commit;`. Kalau ada satu statement gagal, **seluruh PASTE batal**.
- Pesan `NOTICE: … does not exist, skipping` **bukan** error — itu tanda PASTE diulang dan aman.
- Jangan mengubah nilai apa pun di dalam SQL. Kalau ada yang terasa salah, itu yang harus dilaporkan.
- **PASTE 2 sengaja TIDAK idempoten**: kalau diulang, ia berhenti dengan `STOP: public.sales_invoices
  sudah ada`. Itu perilaku yang benar (jangan menimpa), bukan kerusakan.

### 0.6 Kalau ada yang gagal

1. **Stop.** Jangan lanjut ke PASTE berikutnya.
2. Copy **teks error lengkap** + hasil query terakhir (screenshot boleh).
3. Catat: PASTE ke berapa, dan angka/`code` yang muncul.
4. Laporkan ke Brooklyn/DAT. Kalau sudah terlanjur membuat tabel tapi verifikasi tidak lulus, jalankan
   **PASTE R** (aman selama tabel masih kosong).

---

## 1. Hasil verifikasi silang dari kode (read-only, tanpa menjalankan apa pun)

### 1.1 Apakah gate `503 SCHEMA_UNAVAILABLE` terbuka otomatis? — **YA**

| Pertanyaan | Jawaban | Bukti |
|---|---|---|
| Dari mana `503` berasal? | Bukan flag, tapi **error PostgREST** saat tabel tidak ada (`PGRST205` / `42P01`) yang dipetakan ke `SCHEMA_UNAVAILABLE` | `modules/sales-invoice/store.js:150-157` |
| Apakah ada env flag "schema siap"? | **Tidak ada.** Tidak ada cache/flag di kode; setiap request query langsung ke tabel | `store.js:166-205` |
| Backend mana yang dipakai? | `SALES_INVOICE_STORE` default `auto`: ada kredensial Supabase → **supabase** | `store.js:432-461` |
| Staging punya kredensial? | **Ya** — saat paket ini disusun, `.env.local` staging berisi `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (tanpa service role) → plan = `supabase`, store memakai **sesi admin terverifikasi** (RLS tetap menegakkan) | `pages/api/sales-invoices.js:68-101` |
| Jadi perlu ubah env? | **Tidak.** Cukup tabelnya ada. (Opsional: pin `SALES_INVOICE_STORE=supabase` supaya tidak bergantung pada `auto`.) | — |
| Perlu restart app? | **Tidak.** Reload halaman sudah cukup (fetch berjalan saat mount). Kalau REST masih `404` > 1 menit, lihat PASTE 4a catatan schema cache. | `view.jsx:141-166` |

Catatan kecil: pesan error 503 di kode menyebut "lihat docs/sales-invoice-contract.md **§3**", padahal
DDL ada di **§5**. Itu salah rujuk di teks pesan (tidak memengaruhi fungsi). Jangan bingung saat melihat
banner merahnya.

### 1.2 Penomoran: **aplikasi (max+1)**, bukan sequence DB

| Fakta | Bukti |
|---|---|
| Tidak ada `sequence` di DDL kontrak | `docs/sales-invoice-contract.md` §5 — tidak ada `create sequence` |
| Nomor dihitung saat **Terbitkan**, dari baris yang sudah ada di periode itu | `store.js:806-811` → `numbersInPeriod()` + `nextSequenceForFormat()` |
| Periode format Buku = **tahun** (`NL<yy><mm><urut3>`, urut reset 1 Jan) | `contract.js:198-213`, `contract.js:222-239` |
| Pengaman balapan = **unique index `invoice_no`** + retry (bukan lock) | `store.js:828-832`; constraint `sales_invoices_invoice_no_key` |
| Nomor tidak didaur ulang setelah BATAL | `store.js` (void hanya set `voided_at`); baris tetap terhitung di `max+1` |
| Nomor resmi **tidak** pernah dikirim klien | `contract.js:353-356` (`INVOICE_NO_SERVER_ASSIGNED`) |

**Generator vs nomor resmi — dua ruang nomor yang berbeda, tidak bentrok:**

| | Generator (tab "Generator") | Daftar Invoice (tab "Daftar Invoice") |
|---|---|---|
| Apa itu | iframe `public/noir-invoice/index.html` — alat standalone | modul yang menulis ke tabel `sales_invoices` |
| Penyimpanan | **localStorage per-origin**, tanpa Supabase | tabel Supabase |
| Nomor | dikarang di alat itu, **tidak masuk DB** | dialokasikan server saat **Terbitkan** (`NL…`) |
| Siapa yang "sah" | **tidak sah** — hanya alat bantu bikin PDF | **nomor resmi** (satu-satunya yang tercatat) |

Konsekuensi praktis: nomor yang dibuat di Generator **tidak** akan "bentrok" di database (ia tidak pernah
masuk DB), tetapi bisa **dobel secara bisnis** kalau nomor yang sama dipakai untuk dua dokumen yang
beredar. Aturan aman: Generator = draf/pratinjau lokal; nomor yang dikirim ke klien hanya dari baris
yang sudah **TERBIT** di Daftar.

### 1.3 RLS kontrak vs pola admin-only `upah_*` — **semantik sama, satu perbedaan kecil**

| Aspek | Kontrak §5 (`sales_invoices`) | `migrations/2026-10-24_upah_kasbon_master.sql:155-167` |
|---|---|---|
| RLS | `enable row level security` | `enable row level security` |
| Policy | `for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role='admin'))` + `with check` sama | `for all to authenticated using (…) with check (…)` |
| Role policy | **tanpa `TO`** → berlaku untuk `PUBLIC` (anon + authenticated) | eksplisit `TO authenticated` |
| Grant | tidak diatur (mengandalkan default Supabase) | `REVOKE ALL … FROM anon` + `GRANT … TO authenticated` |
| Efek untuk anon | `auth.uid()` = NULL → `EXISTS` false → **0 baris** (HTTP 200 `[]`) | ditolak di level grant (`401 permission denied`) |
| Efek untuk admin | lolos | lolos |
| Efek untuk user non-admin | 0 baris / ditolak `WITH CHECK` | idem |

Kesimpulan: **tidak ada celah** — data tetap hanya bisa dibaca/ditulis admin. Bedanya hanya *bentuk
penolakan* untuk anon (200 kosong vs 401). Kontrak sengaja dibiarkan apa adanya supaya REST probe di
PASTE 4a menghasilkan `200 + []` seperti yang diminta. Kalau DAT ingin menyamakan dengan `upah_*`
(lebih rapi), ada blok opsional di **Lampiran D** — tapi itu mengubah hasil probe menjadi `401`.

### 1.4 Dua selisih kode vs kontrak yang mengubah isi paket

| # | Temuan | Bukti | Akibat kalau dibiarkan | Tindakan di paket ini |
|---|---|---|---|---|
| **K1** | Kode menulis kolom **`store`** yang **tidak ada** di DDL §5 | `contract.js:580` (`composeInvoice`), `store.js:586` (createInvoice), `store.js:826` (issueInvoice) | **Simpan draf gagal `502`** — PostgREST `PGRST204 Could not find the 'store' column` | **PASTE 2c**: `alter table … add column if not exists store text;` (aditif, 1 kolom) |
| **K2** | UI mengirim `due_date = ""` bila Jatuh Tempo kosong; kolomnya `date` | `CreateInvoiceModal.jsx:132` + `contract.js:567` | **Simpan draf gagal `502`** — `22007 invalid input syntax for type date: ""` (diuji lokal, Lampiran C-3) | **Tidak diubah di DB** (tidak bisa: cast gagal sebelum trigger). Workaround: **isi Jatuh Tempo**. Perbaikan permanen = kartu kode terpisah |

Selain dua di atas, **semua** kolom yang ditulis kode ada di kontrak §5 — sudah dicek satu per satu
(`schema_version`, `project_intent`, `project_claim`, `project_issue_error`, `number_format`,
`payment_verified_at`, `idempotency_key`, `request_fingerprint`, dst).

---

## PASTE 1 — Pre-check + angka kontrol (READ-ONLY)

**Tujuan.** Memastikan `sales_invoices` belum ada (kalau sudah: STOP, jangan timpa), memastikan
prasyaratnya ada, dan mencatat angka kontrol modul lain supaya bisa dibuktikan tidak ada yang berubah.

```sql
-- ============================================================
-- PASTE 1 — PRE-CHECK (READ-ONLY; tidak menulis apa pun)
-- ============================================================

-- 1a. VERDICT
select
  case
    when to_regclass('public.sales_invoices') is not null
      then 'STOP - public.sales_invoices SUDAH ADA. Jangan jalankan PASTE 2. Lapor ke Brooklyn/DAT.'
    when exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relname = 'sales_invoices'
        and n.nspname not in ('pg_catalog', 'information_schema')
    ) then 'STOP - ada objek bernama sales_invoices di schema lain. Lapor.'
    else 'LANJUT - sales_invoices belum ada. PASTE 2 aman dijalankan.'
  end as verdict;

-- 1b. Kalau ternyata sudah ada: berapa barisnya?
--     0 = tabel kosong (masih bisa dibuang), >0 = SUDAH ADA INVOICE NYATA (jangan disentuh)
select
  case when to_regclass('public.sales_invoices') is null then null
       else (xpath('/row/c/text()',
              query_to_xml('select count(*) as c from public.sales_invoices', false, true, '')))[1]::text::bigint
  end as baris_sales_invoices;

-- 1c. Prasyarat: dua objek yang dirujuk paket ini harus ada
select o.nama,
       to_regclass('public.' || o.nama) is not null as ada,
       case when to_regclass('public.' || o.nama) is null then 'HILANG - STOP' else 'ok' end as status
from (values ('profiles'), ('projects')) o(nama)
order by 1;

-- 1d. ANGKA KONTROL modul lain (catat angkanya; PASTE 4 harus menunjukkan angka yang sama)
select t.nama,
       case when to_regclass('public.' || t.nama) is null then null
            else (xpath('/row/c/text()',
                   query_to_xml(format('select count(*) as c from public.%I', t.nama), false, true, '')))[1]::text::bigint
       end as jumlah
from (values
  ('projects'), ('sales_customers'), ('upah_projects'), ('upah_tukang'),
  ('upah_kasbon'), ('upah_totalan'), ('materials'), ('vendors')
) t(nama)
order by 1;

-- 1e. Angka kontrol objek: jumlah tabel & sequence di schema public
--     Sesudah PASTE 2/3: tabel +1, sequence TETAP (paket ini tidak membuat sequence).
select c.relkind,
       count(*) as jumlah
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S', 'p')
group by c.relkind
order by c.relkind;
```

**Hasil yang diharapkan**

| Query | Yang harus muncul |
|---|---|
| 1a | satu baris: `LANJUT - sales_invoices belum ada. PASTE 2 aman dijalankan.` |
| 1b | satu baris **kosong** (NULL) — artinya tabel belum ada |
| 1c | 2 baris: `profiles | t | ok` dan `projects | t | ok` |
| 1d | 8 baris angka (mis. `projects | 99`). **Tulis angka ini di kertas** — dipakai di PASTE 4 |
| 1e | baris `r` (jumlah tabel di schema `public`) dan — kalau ada — baris `S` (sequence). Catat angkanya. Project Supabase yang semua PK-nya `gen_random_uuid()` biasanya **tidak** punya baris `S`; itu normal |

**Kalau gagal → stop & catat**

- Verdict `STOP - … SUDAH ADA` → **berhenti**. Jalankan 1b: kalau `> 0`, tabel itu **sudah berisi
  invoice nyata** — jangan drop, jangan timpa. Lapor ke Brooklyn/DAT dengan angka dari 1b.
- 1c ada `HILANG - STOP` → database bukan database yang diharapkan (mis. salah project Supabase).
  Berhenti; jangan lanjut.
- Query 1d/1e error `relation does not exist` → berarti ada nama tabel yang berbeda di project ini.
  Catat nama yang error, lapor. (Jangan mengubah daftar tabel sendiri.)

---

## PASTE 2 — DDL tabel `sales_invoices` (kontrak §5) + kolom `store`

**Tujuan.** Membuat tabel `sales_invoices` persis seperti kontrak §5 (semua constraint ikut), ditambah
**satu** kolom `store` yang wajib ada karena ditulis kode (temuan K1).

```sql
-- ============================================================
-- PASTE 2 — DDL tabel sales_invoices (kontrak §5) + 1 kolom wajib
-- ============================================================
begin;

-- 2a. GUARD: hentikan kalau tabel sudah ada (jangan menimpa)
do $$
begin
  if to_regclass('public.sales_invoices') is not null then
    raise exception 'STOP: public.sales_invoices sudah ada. PASTE 2 dibatalkan (tidak ada yang ditulis). Lapor ke Brooklyn/DAT.';
  end if;
end $$;

-- 2b. DDL resmi kontrak §5 (verbatim)
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

-- 2c. TAMBAHAN PAKET (bukan di kontrak §5, WAJIB): kolom `store`.
--     modules/sales-invoice/contract.js:580 (composeInvoice) dan
--     modules/sales-invoice/store.js:586,826 menulis `store` pada setiap
--     INSERT/UPDATE. Tanpa kolom ini PostgREST menolak (PGRST204) dan
--     "Simpan draf" gagal 502.
alter table public.sales_invoices add column if not exists store text;

commit;
```

**Hasil yang diharapkan**

- SQL Editor menampilkan sukses (`Success. No rows returned` atau sejenisnya) tanpa `ERROR`.
- Tidak ada `NOTICE` yang mencurigakan. `NOTICE … already exists, skipping` hanya muncul kalau PASTE
  diulang (tidak mungkin di sini karena guard 2a akan lebih dulu menghentikan).

**Kalau gagal → stop & catat**

| Error | Arti | Tindakan |
|---|---|---|
| `STOP: public.sales_invoices sudah ada…` | Tabel sudah ada (PASTE 1 seharusnya sudah menangkap) | **Stop.** Jalankan PASTE 1b. Kalau `0` baris, lapor sebelum melakukan apa pun |
| `relation "projects" does not exist` | Prasyarat hilang / salah project | **Stop.** Jangan buat tabel `projects` sendiri |
| `permission denied for schema public` | Role SQL Editor bukan owner | **Stop.** Minta DAT/owner menjalankan |
| `syntax error at or near …` / `unterminated quoted string` | Blok terpotong saat copy | **Stop.** Copy ulang **utuh** dari `begin;` sampai `commit;` |

---

## PASTE 3 — RLS + policy admin-only + index

**Tujuan.** Mengaktifkan RLS, memasang policy admin-only sesuai kontrak §5, dan membuat unique index
yang menjamin satu kode proyek hanya boleh dipakai satu invoice.

```sql
-- ============================================================
-- PASTE 3 — RLS admin-only + policy + index (kontrak §5)
-- ============================================================
begin;

-- 3a. RLS aktif
alter table public.sales_invoices enable row level security;

-- 3b. Policy admin-only (teks kontrak §5; DROP IF EXISTS supaya bisa diulang)
drop policy if exists sales_invoices_admin_all on public.sales_invoices;
create policy sales_invoices_admin_all on public.sales_invoices
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 3c. Satu proyek hanya boleh diterbitkan oleh satu invoice
create unique index if not exists sales_invoices_project_code_key
  on public.sales_invoices (project_code) where project_code is not null;

commit;
```

**Hasil yang diharapkan**

- `ALTER TABLE`, `DROP POLICY` (boleh `NOTICE … does not exist, skipping`), `CREATE POLICY`,
  `CREATE INDEX` — semuanya sukses.
- Tiga index lain (`pkey`, `invoice_no`, `idempotency_key`) **tidak** dibuat di sini: mereka otomatis
  dari constraint di PASTE 2. Total index setelah PASTE 3 = **4**.

**Kalau gagal → stop & catat**

| Error | Arti | Tindakan |
|---|---|---|
| `function auth.uid() does not exist` | Dijalankan di database non-Supabase | **Stop.** Paket ini hanya untuk Supabase |
| `must be owner of table sales_invoices` | Role tidak berhak | **Stop.** Minta owner menjalankan |
| `syntax error at or near "policy"` | Blok terpotong | **Stop.** Copy ulang utuh |

---

## PASTE 4 — Verifikasi (3 bagian)

**Tujuan.** Membuktikan tabel benar-benar hidup: bisa diakses REST (a), strukturnya lengkap (b), dan
modul di aplikasi berjalan dari draf sampai batal (c).

### 4a. REST probe dengan **anon key** (bukan service role)

Ambil dari Supabase Dashboard → **Project Settings → API**: `Project URL` dan `anon public` key.
Ganti dua placeholder di bawah.

```bash
export SB_URL="https://<PROJECT-REF>.supabase.co"
export SB_ANON="<ANON_KEY>"      # Project Settings -> API -> anon public (JANGAN service role)

curl -i "$SB_URL/rest/v1/sales_invoices?select=id&limit=1&apikey=$SB_ANON"
```

Alternatif tanpa terminal (browser): buka
`https://<PROJECT-REF>.supabase.co/rest/v1/sales_invoices?select=id&limit=1&apikey=<ANON_KEY>`

**Hasil yang diharapkan**

```
HTTP/2 200
content-type: application/json; charset=utf-8
content-range: */0

[]
```

| Yang muncul | Arti | Tindakan |
|---|---|---|
| `200` + `[]` | **LULUS** — tabel ada, RLS menyembunyikan baris dari anon (memang begitu) | lanjut 4b |
| `404` + `{"code":"PGRST205"…}` | Tabel belum terlihat oleh PostgREST (belum dibuat **atau** schema cache basi) | Jalankan `notify pgrst, 'reload schema';` di SQL Editor, tunggu ±30 detik, ulangi. Masih 404 → PASTE 2 tidak ter-commit: ulangi PASTE 1 |
| `401`/`403` + `42501 permission denied for table profiles` | Tabel **ada**, tapi policy tidak bisa membaca `profiles` sebagai anon (project ini mencabut grant anon di `profiles`) | **LULUS dengan catatan** — buktikan lewat 4b; kalau mau probe `200`, lihat Lampiran D |
| `200` + array **berisi baris** | Tabel sudah ada isinya | **STOP** — jangan timpa; lapor |
| `503` / `522` | Supabase pause/restart, bukan masalah skema | Tunggu, ulangi |

### 4b. Struktur tabel (read-only, SQL Editor)

```sql
-- 4b-1. Kolom (harus 41 baris; `store` ada di urutan terakhir)
select count(*) as jumlah_kolom from information_schema.columns
where table_schema = 'public' and table_name = 'sales_invoices';

select ordinal_position as no, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'sales_invoices'
order by ordinal_position;

-- 4b-2. Constraint (harus 11 baris: 1 pkey, 2 unique, 1 fkey, 7 check)
select contype, count(*) as jumlah
from pg_constraint where conrelid = 'public.sales_invoices'::regclass group by contype order by contype;

select conname, contype, pg_get_constraintdef(oid) as definisi
from pg_constraint
where conrelid = 'public.sales_invoices'::regclass
order by contype, conname;

-- 4b-3. Index (harus 4 baris)
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'sales_invoices' order by 1;

-- 4b-4. RLS + policy (harus relrowsecurity = true, 1 policy cmd=ALL)
select relname, relrowsecurity, relforcerowsecurity
from pg_class where oid = 'public.sales_invoices'::regclass;

select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'sales_invoices';

-- 4b-5. Isi tabel (harus 0)
select count(*) as baris from public.sales_invoices;

-- 4b-6. Angka kontrol diulang (harus SAMA dengan PASTE 1d/1e; tabel +1, sequence tetap)
select t.nama,
       case when to_regclass('public.' || t.nama) is null then null
            else (xpath('/row/c/text()',
                   query_to_xml(format('select count(*) as c from public.%I', t.nama), false, true, '')))[1]::text::bigint
       end as jumlah
from (values
  ('projects'), ('sales_customers'), ('upah_projects'), ('upah_tukang'),
  ('upah_kasbon'), ('upah_totalan'), ('materials'), ('vendors')
) t(nama)
order by 1;

select c.relkind, count(*) as jumlah
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S', 'p')
group by c.relkind
order by c.relkind;
```

**Hasil yang diharapkan (angka pasti)**

| Cek | Harus |
|---|---|
| jumlah kolom | **41** (40 dari kontrak §5 + `store`) |
| kolom terakhir | `store | text | YES | (null)` |
| constraint | **11** = `c` 7, `f` 1, `p` 1, `u` 2 |
| constraint bernama | `draft_has_no_number`, `issued_has_number`, `terkirim_needs_channel`, `lunas_needs_proof` **semua ada** |
| index | **4**: `sales_invoices_pkey`, `…_invoice_no_key`, `…_idempotency_key_key`, `sales_invoices_project_code_key` |
| RLS | `relrowsecurity = true`, 1 policy `sales_invoices_admin_all`, `cmd = ALL` |
| baris | **0** |
| angka kontrol 4b-6 | **identik** dengan PASTE 1d; `r` bertambah **1**, `S` (sequence) **tidak berubah** |

**Kalau gagal → stop & catat**

- Kolom **40** (tanpa `store`) → PASTE 2c terlewat. Jalankan hanya baris 2c, lalu ulangi 4b-1.
- Constraint **< 11** → PASTE 2 terpotong. **Jangan** menambah constraint manual satu-satu; jalankan
  PASTE R lalu ulangi PASTE 2 utuh.
- `relrowsecurity = false` atau policy 0 baris → PASTE 3 tidak jalan. Ulangi PASTE 3 (aman diulang).
- Baris **> 0** → ada yang menulis sebelum verifikasi. Catat isinya, lapor.

### 4c. Uji UI (alur penuh: draf → terbit → batal)

Prasyarat: login sebagai **admin** (`profiles.role = 'admin'`).

| # | Langkah | Hasil yang diharapkan |
|---|---|---|
| 1 | Buka aplikasi staging, login admin, sidebar **Admin Suite → Invoice Penjualan** | Halaman modul terbuka. (Tidak ada URL langsung — navigasi berupa state di halaman utama) |
| 2 | Lihat banner | **Banner merah hilang.** Yang muncul: banner hijau `Tersimpan di Supabase (supabase). Nomor invoice dialokasikan server.` dan banner hijau `Format nomor: Buku (Obsidian) NL<yymm><XXX>…` |
| 3 | Klik **+ Buat Invoice Penjualan** | Modal draf terbuka |
| 4 | Isi: Nama customer, Nominal (> 0), **Tanggal terbit**, **Jatuh tempo (WAJIB — lihat K2)**, PPN boleh 0 | — |
| 5 | Pilih **⚪ Tanpa nomor proyek (invoice umum)** — untuk pilot, supaya `projects` tidak bertambah | Radio ketiga terpilih |
| 6 | **Simpan** | Baris muncul di Daftar dengan status **DRAF**, kolom nomor **kosong**, tombol `⬆ Terbitkan` tersedia |
| 7 | Klik **⬆ Terbitkan** | Status jadi **TERBIT**, nomor resmi muncul (mis. `NL2610001`), `issued_at` terisi |
| 8 | Klik **✕ Batalkan** → konfirmasi | Status **BATAL**; nomor **tetap tercatat** (tidak didaur ulang) |
| 9 | Cek DB: `select id, status, invoice_no, project_code, store from public.sales_invoices order by created_at desc;` | 1 baris: status `BATAL`, `invoice_no` terisi, `store = 'supabase'` |

**Kalau gagal → stop & catat**

| Gejala | Kemungkinan | Tindakan |
|---|---|---|
| Banner merah masih muncul, teks `Tabel "sales_invoices" belum ada…` | Schema cache / halaman lama | Reload halaman. Masih? jalankan `notify pgrst, 'reload schema';` lalu reload |
| Banner kuning `PRATINJAU LOKAL — data hanya di file JSON…` | Store jatuh ke `file-preview` (kredensial tidak terbaca) | **Stop.** Cek `.env.local`: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` ada? (tanpa itu, jangan lanjut) |
| Simpan → `502` + `Could not find the 'store' column` | PASTE 2c terlewat | Jalankan 2c, ulangi |
| Simpan → `502` + `invalid input syntax for type date: ""` | Jatuh Tempo kosong (K2) | Isi Jatuh Tempo, ulangi |
| Simpan → `401`/`403` | Sesi bukan admin / JWT kedaluwarsa | Login ulang sebagai admin |
| Terbitkan → `503 ISSUE_REQUIRES_RPC` | `SALES_INVOICE_REQUIRE_RPC=1` terpasang | Hapus flag itu (RPC belum ada), reload |
| Terbitkan → `409 DUPLICATE_PROJECT_CODE` | Mode "proyek baru" dengan kode yang sudah dipakai | Pakai saran kode dari pesan, atau pilih "Tanpa nomor proyek" |
| Terbitkan → `409 PROJECT_ALREADY_CLAIMED` | Kode proyek sudah tertaut invoice lain | Pilih mode "Tautkan ke proyek existing" atau kode lain |

---

## Sesudah PASTE 4 — langkah aplikasi (tanpa ubah kode)

1. **Tidak ada env yang wajib diubah.** Gate 503 berasal dari error PostgREST, jadi hilang sendiri
   begitu tabel ada. Reload halaman modul sudah cukup.
2. **Opsional (disarankan): pin backend.** Set `SALES_INVOICE_STORE=supabase` di `.env.local` staging
   supaya tidak bergantung pada `auto` (kalau kredensial suatu saat hilang, app **gagal** alih-alih
   diam-diam pindah ke file JSON pratinjau). Perlu restart proses Next.js.
3. **Jangan set** `SALES_INVOICE_REQUIRE_RPC=1` (RPC belum ada → Terbitkan 503) dan **jangan set**
   `SALES_INVOICE_NO_FORMAT=inv-nl` tanpa `SALES_INVOICE_NO_FORMAT_ACK=1` (penerbitan ditolak
   `NUMBER_FORMAT_NOT_AGREED`).
4. **Tidak perlu build ulang.** Yang berubah hanya skema DB; tidak ada file aplikasi yang berubah.
5. **K1/K2 tetap ada di kode.** K1 sudah ditutup oleh PASTE 2c. K2 (Jatuh Tempo kosong) hanya bisa
   ditutup dengan perubahan kode — usulkan kartu terpisah: `due_date: dueDate || null` di
   `CreateInvoiceModal.jsx` + `composeInvoice`.

---

## PASTE R — Rollback

> ⚠️ **JANGAN drop kalau tabel sudah berisi invoice nyata.** `drop table` menghapus **semua** baris,
> termasuk nomor invoice yang sudah dikirim ke klien. Nomor yang sudah beredar tidak bisa
> "dikembalikan" dari mana pun. Rollback ini hanya aman untuk tabel **baru dan kosong** (kondisi
> setelah PASTE 3, sebelum ada invoice dipakai).

**R1 — cek dulu (read-only):**

```sql
select count(*) as baris,
       min(created_at) as pertama,
       max(created_at) as terakhir
from public.sales_invoices;

select id, status, invoice_no, customer_name, created_at
from public.sales_invoices
order by created_at desc
limit 20;
```

Kalau `baris > 0`: **berhenti**. Baris itu data nyata (atau baris uji yang kamu buat sendiri — lihat R2b).

**R2 — drop (dengan guard yang menolak bila masih ada baris):**

```sql
begin;

do $$
declare n bigint;
begin
  if to_regclass('public.sales_invoices') is null then
    raise notice 'sales_invoices tidak ada - tidak ada yang perlu di-rollback.';
    return;
  end if;
  execute 'select count(*) from public.sales_invoices' into n;
  if n > 0 then
    raise exception 'STOP: sales_invoices berisi % baris. JANGAN drop. Ekspor dulu, atau hapus hanya baris uji (R2b).', n;
  end if;
end $$;

drop table if exists public.sales_invoices;

commit;
```

`drop table` otomatis menghapus **4 index** dan **1 policy** milik tabel itu. **Tidak ada sequence**
yang perlu di-drop (paket ini tidak membuat sequence).

**R2b — hanya kalau baris yang tersisa adalah baris UJI yang kamu buat sendiri saat pilot:**

```sql
-- Ganti dengan UUID baris uji yang kamu catat dari R1. JANGAN pakai WHERE yang luas.
delete from public.sales_invoices where id = '<uuid-baris-uji>';
```

lalu ulangi **R2**.

**Hasil yang diharapkan:** `DROP TABLE`, dan
`select to_regclass('public.sales_invoices');` → `NULL`.

Kalau guard menolak, DAT akan melihat **dua** pesan: `STOP: sales_invoices berisi N baris…` lalu
`current transaction is aborted, commands ignored until end of transaction block`. Itu **satu**
kejadian: guard menolak, dan `drop table` di transaksi yang sama otomatis diabaikan. **Tidak ada yang
ter-drop.**

**Kalau gagal → stop & catat:** error `cannot drop table … because other objects depend on it` berarti
ada objek lain (view/FK) yang dibuat di luar paket ini — **jangan** pakai `cascade`; catat nama objeknya
dan lapor.

---

## Lampiran A — objek database yang dibuat paket ini

| Objek | Jenis | Nama | Dibuat di |
|---|---|---|---|
| Tabel | tabel | `public.sales_invoices` | PASTE 2b |
| Kolom tambahan | kolom | `store text` | PASTE 2c |
| Constraint | pkey | `sales_invoices_pkey` | PASTE 2b |
| Constraint | unique | `sales_invoices_invoice_no_key` | PASTE 2b |
| Constraint | unique | `sales_invoices_idempotency_key_key` | PASTE 2b |
| Constraint | fkey | `sales_invoices_project_id_fkey` → `projects(id)` | PASTE 2b |
| Constraint | check | `sales_invoices_status_check` | PASTE 2b |
| Constraint | check | `sales_invoices_nominal_check` | PASTE 2b |
| Constraint | check | `sales_invoices_tax_rate_check` | PASTE 2b |
| Constraint | check | `draft_has_no_number` | PASTE 2b |
| Constraint | check | `issued_has_number` | PASTE 2b |
| Constraint | check | `terkirim_needs_channel` | PASTE 2b |
| Constraint | check | `lunas_needs_proof` | PASTE 2b |
| Index | partial unique | `sales_invoices_project_code_key` | PASTE 3c |
| Policy | RLS | `sales_invoices_admin_all` | PASTE 3b |
| Sequence | — | **tidak ada** | — |
| Trigger | — | **tidak ada** | — |

---

## Lampiran B — checklist setelah PASTE 4 lulus

- [ ] PASTE 1 verdict = `LANJUT`
- [ ] PASTE 2 sukses (tabel + kolom `store`)
- [ ] PASTE 3 sukses (RLS + policy + 4 index)
- [ ] 4a: REST probe `200` + `[]` (atau `401 42501` dengan catatan — lihat tabel 4a)
- [ ] 4b: 41 kolom, 11 constraint, 4 index, RLS true, 1 policy, 0 baris
- [ ] 4b-6: angka kontrol **sama** dengan PASTE 1 (tabel +1, sequence tetap)
- [ ] 4c: banner merah hilang → draf → DRAF → Terbitkan (nomor terbit) → Batalkan (BATAL)
- [ ] `store = 'supabase'` pada baris hasil uji
- [ ] Baris uji dibersihkan (kalau tidak dipakai) atau dibiarkan sebagai invoice contoh — **catat keputusan**
- [ ] Kabari admin: modul Invoice Penjualan sudah aktif

---

## Lampiran C — bukti uji lokal (PostgreSQL 16.15, bukan Supabase)

SQL di dokumen ini dijalankan apa adanya di cluster PostgreSQL 16.15 lokal dengan fixture tiruan
(`profiles`, `projects`, `sales_customers`, `upah_*`, `materials`, `vendors`; fungsi `auth.uid()`
distub). Yang dibuktikan:

| # | Uji | Hasil |
|---|---|---|
| C-1 | PASTE 1 pada DB kosong | verdict `LANJUT`, 8 angka kontrol, prasyarat `ok` |
| C-2 | PASTE 2 + 3 | tabel dibuat; **41 kolom**, **11 constraint** (7 check, 1 fkey, 1 pkey, 2 unique), **4 index**, `relrowsecurity = true`, policy `sales_invoices_admin_all` (`cmd = ALL`) |
| C-3 | INSERT draf **dengan** `due_date = ''` (persis payload modal saat Jatuh Tempo kosong) | **ERROR 22007** `invalid input syntax for type date: ""` → dasar temuan **K2** |
| C-4 | INSERT draf dengan `due_date = NULL` (payload lengkap `composeInvoice`, termasuk `store`) | **INSERT 0 1** |
| C-5 | TERBITKAN (`update … where status='DRAFT'`, CAS) | `UPDATE 1`, nomor `NL2610001`, `store = 'supabase'` |
| C-6 | VOID (`TERBIT → BATAL`) | `UPDATE 1`, `voided_at` terisi |
| C-7 | DRAFT + `invoice_no` | ditolak `draft_has_no_number` ✔ |
| C-8 | TERBIT tanpa nomor | ditolak `issued_has_number` ✔ |
| C-9 | TERKIRIM tanpa kanal | ditolak `terkirim_needs_channel` ✔ |
| C-10 | LUNAS tanpa bukti | ditolak `lunas_needs_proof` ✔ |
| C-11 | Dua invoice dengan `project_code` sama | ditolak `sales_invoices_project_code_key` ✔ |
| C-12 | RLS: admin (JWT admin) | 1 baris terlihat |
| C-13 | RLS: user non-admin (JWT user) | 0 baris |
| C-14 | RLS: anon tanpa JWT, grant standar Supabase | 0 baris (HTTP 200 `[]`) |
| C-15 | PASTE R pada tabel berisi 1 baris | guard **menolak** (`STOP: … berisi 1 baris`) |
| C-16 | PASTE R setelah baris uji dihapus | `DROP TABLE`, `to_regclass` → `NULL` |

Catatan: C-3/C-4 memakai kolom `due_date date` yang sama seperti kontrak; hasilnya tidak bisa "diakali"
dengan trigger BEFORE INSERT karena cast tipe sudah gagal sebelum trigger dijalankan.

---

## Lampiran D — opsional: pengerasan grant ala `upah_*` (JANGAN saat pilot)

Kontrak §5 membiarkan policy berlaku untuk `PUBLIC` (anon + authenticated). Semantiknya tetap
admin-only, tetapi `upah_*` lebih ketat: policy hanya untuk `authenticated`, dan `anon` dicabut
grant-nya. Kalau DAT ingin menyamakan:

```sql
-- OPSIONAL. Jalankan HANYA setelah PASTE 4 lulus dan pilot selesai.
begin;
alter policy sales_invoices_admin_all on public.sales_invoices to authenticated;
revoke all on public.sales_invoices from anon;
grant select, insert, update, delete on public.sales_invoices to authenticated;
commit;
```

**Akibat yang harus diketahui sebelum menjalankan:**

- REST probe 4a dengan anon key **berubah** dari `200 + []` menjadi `401` (`42501 permission denied
  for table sales_invoices`). Itu **bukan** kerusakan — artinya anon ditolak lebih awal.
- Aplikasi tetap jalan: store memakai sesi admin terverifikasi (`authenticated`), bukan anon.
- Rollback pengerasan ini: `alter policy … to public;` + `grant all on public.sales_invoices to anon;`
  (atau cukup PASTE R kalau tabel memang mau dibuang).

Diuji lokal (C-14b): setelah blok ini, `set role anon` → `permission denied for table sales_invoices`.
