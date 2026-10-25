# Runbook Final — Mapping Upah & Kasbon ↔ Project ID (eksekusi DAT)

Kartu: `t_2ded4a16` · Branch: `feat/mapping-exec` · Basis: `48ebb9c` (proposal `t_5e8e6056` yang sudah disetujui)
Repo: `/home/ubuntu/dev-workspaces/purchasing-upah-kasbon-projectid`
Pemilik eksekusi: **DAT** (SQL Editor Supabase) · Penyusun: Bamboo

Status: **PAKET EKSEKUSI — belum dijalankan.** Tidak ada satu pun SQL di dokumen ini yang
sudah dijalankan ke Supabase live oleh agen. Tidak ada baris data yang ditulis, tidak ada
kode staging yang diubah. Seluruh angka di sini berasal dari snapshot sheet 20 Okt 2026
yang **diuji ulang** terhadap master `projects` terkini (§0.3).

Lima keputusan DAT yang mengikat dokumen ini (dari proposal §7):

| # | Keputusan | Isi yang dipakai di runbook |
|---|---|---|
| D1 | Kunci pencocokan | `projects.kode` **teks persis** (trim + case-insensitive). Nama hanya kandidat. `67a` ≠ `67`. Kembar `XX/XXa` → manusia. |
| D2 | 20 baris tanpa nomor | 6 baris `Service/Servis` = non-proyek; 14 baris lain = daftar keputusan DAT |
| D3 | Pelaksana | Opsi A: DAT menempel SQL di Supabase SQL Editor |
| D4 | Pilot | P1 `[83] Josh - Mabes` → P2 `[61]` → P3 `[101]` |
| D5 | Project Finance | Blok read-only, saldo `NULL` apa adanya, **tanpa** kolom pro-rata |

---

## 0. Baca ini dulu (5 menit)

### 0.1 Apa yang akan berubah, dan apa yang tidak

| Objek | Berubah? | Keterangan |
|---|---|---|
| `upah_projects.project_id` | **ya** — inti pekerjaan | hanya baris yang DAT setujui; `NULL` tetap `NULL` |
| `upah_projects` (kolom lain) | tidak | `project_name`, `total_manual`, `status` tidak disentuh |
| `upah_items` | **tidak** | runbook ini tidak punya satu pun `insert/update/delete` ke sini |
| `upah_kasbon`, `upah_totalan*` | **tidak** | idem |
| `projects` (master) | **tidak** | tidak ada pembuatan/perubahan master dari proses ini |
| RLS / policy | tidak | tidak ada perubahan hak akses |
| Kode aplikasi / staging | tidak | tiket ini hanya menulis dokumen di repo |
| Objek baru | ya, aditif | `upah_mapping_source`, `upah_project_link_review`, `upah_project_link_log`, `upah_mapping_control`, `upah_projects_backup_20261026`, 4 view, 1 fungsi helper |

### 0.2 Angka kunci (hasil uji ulang, lihat §0.3)

| Kelompok | Jumlah | Perlakuan |
|---|---|---|
| Bernomor, master tunggal, nama nyambung → `kode` | **29** | boleh sekali jalan (STEP 6 T6.1) |
| Bernomor, nomor punya kembaran `XXa` → `kode_kembar` | **6** | DAT pilih `X` atau `Xa` (69, 72, 78, 80, 81, 90) |
| Bernomor, nama beda → `kode_nama_beda` | **2** | DAT spot-check (47, 65) |
| Tanpa nomor, bukan jasa → daftar keputusan | **14** | DAT putuskan per baris |
| Tanpa nomor, jasa → `non_proyek` | **6** | konfirmasi: tidak ditautkan |
| **Total baris upah (snapshot)** | **57** | 37 bernomor + 20 tanpa nomor |

Konsekuensi yang perlu DAT sadari: kalau DAT menolak semua 14 baris tanpa nomor, hasil akhir
adalah **37 baris tertaut dan 20 baris tetap "Belum terhubung"**. Itu hasil yang sah — bukan
kegagalan. Angka 37 = jumlah baris yang nomornya memang ada di sumber.

### 0.3 Verifikasi ulang snapshot terhadap master terkini

**Metode.** `GET /rest/v1/projects?select=id,kode,code,name,status` dengan anon key →
**HTTP 200**, **96 baris**. Klasifikasi 57 baris snapshot dijalankan ulang dengan **dua cara
independen** dan hasilnya dibandingkan baris-per-baris:

1. SQL runbook ini sendiri (dijalankan pada PostgreSQL 16 lokal dengan master hasil tarikan
   REST di atas + 57 baris snapshot sebagai fixture),
2. implementasi Python terpisah dari aturan §1.2 proposal.

Hasil: **0 perbedaan** antara keduanya, dan **angka sama dengan proposal**:

| Kelompok | Proposal (20/25 Okt) | Uji ulang (master terkini) | Status |
|---|---|---|---|
| `kode` | 29 | **29** | sama |
| `kode_kembar` | 6 | **6** | sama |
| `kode_nama_beda` | 2 | **2** | sama |
| tanpa nomor non-jasa | 14 | **14** | sama |
| `non_proyek` (jasa) | 6 | **6** | sama |
| total | 57 | **57** | sama |

**Fakta master terkini** (yang dipakai sebagai pembanding):

| Item | Nilai | Catatan |
|---|---|---|
| Baris `projects` | 96 | 0 kode ganda |
| Kode berhuruf | 7 | `67a, 69a, 72a, 78a, 80a, 81a, 90a` |
| Kode kosong | 1 | baris bernama `2024` |
| Nama kosong | 7 | `24.`, `43.`, `67.`, `69.`, `72.`, `78.`, `81.` |
| Pasangan kembar `XX`/`XXa` | 7 | 6 di antaranya dipakai sheet (semua masuk `kode_kembar`) |
| Nomor snapshot yang tidak ketemu di master | **0 dari 37** | — |

**Baris yang berubah sejak 20 Okt: TIDAK ADA** pada tingkat yang mempengaruhi mapping.
Yang berubah hanyalah ukuran master (11 baris saat audit 20 Okt → 96 baris sekarang), dan
perubahan itu **sudah** tercermin di angka di atas: 34 nomor Pujon yang dulu "tidak ada di
master" sekarang semuanya ketemu. Kalau nanti STEP 4 di live menghasilkan angka berbeda dari
tabel di atas, **berhenti** dan laporkan — itu berarti data live berbeda dari snapshot.

### 0.4 Yang DAT harus perhatikan sebelum STEP 1

1. **Snapshot ≠ live.** Semua angka di dokumen ini berasal dari sheet 20 Okt. Yang
   membuktikan live sama adalah **STEP 3 (A2c)**. Kalau A2c.2/A2c.3/A2c.4 tidak 0, jangan
   lanjut — perbaiki staging dulu.
2. **6 baris kembar tidak pernah otomatis.** `69`, `72`, `78`, `81` menunjuk baris master yang
   **namanya kosong**; nama sebenarnya ada di `69a/72a/78a/81a`. Template STEP 6 memilih `Xa`
   untuk keempatnya, `80a` (nama sheet persis sama dengan 80a) dan `90`. **Periksa ulang
   pilihan itu** — salah pilih = upah menempel ke baris placeholder.
3. **2 baris nama beda** (`47 Project Cosmos` → `47. Kalvina - Kedoya`, `65 Project Flaminggo`
   → `65. Wendy - Flamingo GS`): nomor tetap penentu, tetapi keduanya wajib dilihat mata
   manusia sebelum di-approve.
4. **14 baris tanpa nomor**: template T6.5(d) menolak semuanya sekaligus (masih **dikomentari**
   — jalankan hanya kalau DAT memang memutuskan begitu); kalau DAT tahu proyeknya, tautkan
   lewat template manual T6.5(b), satu baris per UPDATE. Tidak ada pembagian pro-rata, tidak
   ada tebakan nama.
5. **Pilot 83 = Rp 9.230.000** (sama dengan `CLOSING → Mabes → B7 Biaya Tukang`). Kalau angka
   yang muncul beda, **STOP** sebelum batch — artinya baris live bukan proyek yang sama.
6. **Freeze itu wajib.** Guard di runbook hanya melindungi baris yang sudah punya tautan.
   Kalau admin menambah/mengedit proyek upah saat batch berjalan, hasilnya bisa tidak sesuai
   daftar keputusan.
7. **Yang tidak dilakukan runbook ini:** tidak menulis ke `upah_items`, `upah_kasbon`,
   `upah_totalan*`, `projects`; tidak mengubah RLS; tidak menyentuh kode aplikasi/staging.
   Satu-satunya kolom data yang berubah adalah `upah_projects.project_id`.

---

## 1. Freeze (lakukan sebelum STEP 0)

Kirim ke admin (contoh, sesuaikan):

> Selama ±1 jam ke depan, **jangan menambah / mengedit / menghapus** apa pun di modul
> **Upah & Kasbon** (proyek upah, rincian upah, kasbon, totalan) dan di modul **Projects**.
> Kami sedang menautkan proyek upah lama ke Project ID. Membaca/melihat tidak masalah.
> Saya kabari lagi kalau sudah selesai.

Yang boleh berjalan: modul lain (Pembelian, Penjualan, Finance baca).
Yang ditahan: input upah, edit nama proyek upah, hapus proyek upah, kasbon, totalan,
tambah/ubah master `projects`.

Selesai = STEP 9 lulus (atau rollback selesai). Setelah itu kabari admin bahwa modul bebas
dipakai lagi.

---

## 2. Peta langkah

| STEP | Nama | Blok SQL | Waktu | Gerbang (jangan lanjut kalau gagal) |
|---|---|---|---|---|
| 0 | Backup + angka kontrol | A0 | 2 mnt | backup gagal dibuat |
| 1 | Diagnostik | A1a–A1g | 5 mnt | ada kriteria lulus yang tidak terpenuhi |
| 2 | Migrasi (DRAFT, idempotent) | `migrations/2026-10-25_upah_projects_project_id.DRAFT.sql` | 2 mnt | error / rollback |
| 3 | Staging nomor dari sheet | A2 + A2c | 10 mnt | A2c ada selisih |
| 4 | Antrian usulan | A3 + A3b | 5 mnt | angka kelas ≠ 29/6/2/14/6 |
| 5 | Daftar keputusan DAT | A3c | 5 mnt | ada kelas tak dikenal (E) |
| 6 | Catat keputusan | A4 (T6.1–T6.7) | 20 mnt | masih ada `decision` kosong |
| 7 | Pilot P1 `[83]` | A5-pilot + A8 ringkas | 10 mnt | total ≠ 9.230.000 / rekonsiliasi ≠ 0 |
| 8 | Batch semua keputusan | A5-batch | 5 mnt | guard menolak |
| 9 | Verifikasi penuh | A8 | 10 mnt | selisih ≠ 0 / orphan > 0 |
| 10 | View Project Finance | A7 | 5 mnt | view gagal dibuat |
| R | Rollback (kalau perlu) | A6 | 5 mnt | — |

Semua blok SQL di bawah **sudah dijalankan berurutan** pada PostgreSQL 16 lokal dengan
fixture yang meniru data ini (bukti di Lampiran L6). Yang tidak bisa diuji lokal: RLS
Supabase dan angka `upah_projects` yang sebenarnya — dua hal itu justru yang diverifikasi
STEP 1 dan STEP 3 di live.

---

## STEP 0 — Backup + angka kontrol (A0)

**Tujuan.** Menyimpan salinan utuh `upah_projects` dan mencatat angka kontrol, supaya STEP 9
bisa membuktikan tidak ada angka modul yang berubah.

```sql
-- ============================================================
-- STEP 0 — BACKUP + ANGKA KONTROL
-- Tujuan: menyimpan salinan utuh upah_projects dan mencatat angka
--         kontrol yang nanti dipakai STEP 9 untuk membuktikan
--         "tidak ada angka yang berubah".
-- Sifat : MENULIS, tetapi hanya membuat tabel BARU (backup + control).
--         Tidak mengubah satu baris pun di tabel modul.
-- ============================================================

-- A0.1  Salinan penuh tabel target.
--       Sengaja TANPA "if not exists": kalau tabel backup sudah ada,
--       query ini GAGAL — itu disengaja supaya backup lama yang sah
--       tidak pernah tertimpa. Kalau gagal: ganti angka 20261026
--       di nama tabel menjadi tanggal hari ini, lalu jalankan ulang.
create table public.upah_projects_backup_20261026 as
select * from public.upah_projects;

-- A0.2  Angka kontrol (disimpan sebagai baris tabel, bukan dihafal).
create table if not exists public.upah_mapping_control (
  id               bigserial primary key,
  label            text not null,
  captured_at      timestamptz not null default now(),
  jumlah_proyek    bigint,
  jumlah_item      bigint,
  total_rincian    numeric,
  total_manual     numeric,
  total_hak        numeric,
  jumlah_kasbon    bigint,
  total_kasbon     numeric,
  jumlah_totalan   bigint,
  total_pembayaran numeric
);

insert into public.upah_mapping_control
  (label, jumlah_proyek, jumlah_item, total_rincian, total_manual, total_hak,
   jumlah_kasbon, total_kasbon, jumlah_totalan, total_pembayaran)
select
  'STEP0 ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
  (select count(*) from public.upah_projects),
  (select count(*) from public.upah_items),
  (select coalesce(sum(upah_rincian), 0) from public.upah_items),
  (select coalesce(sum(total_manual), 0) from public.upah_projects),
  (select coalesce(sum(coalesce(up.total_manual, it.total_rincian, 0)), 0)
     from public.upah_projects up
     left join (select project_id, sum(upah_rincian) as total_rincian
                  from public.upah_items group by project_id) it
            on it.project_id = up.id),
  (select count(*) from public.upah_kasbon),
  (select coalesce(sum(nominal), 0) from public.upah_kasbon),
  (select count(*) from public.upah_totalan),
  (select coalesce(sum(pembayaran_aktual), 0) from public.upah_totalan);

-- A0.3  Tampilkan & SIMPAN hasilnya (screenshot / copy ke laporan).
select * from public.upah_mapping_control order by id desc limit 1;
```

**Hasil yang diharapkan.**
- `CREATE TABLE` (bukan error) untuk `upah_projects_backup_20261026`.
- `INSERT 0 1` dan satu baris kontrol dengan `jumlah_proyek` = jumlah baris `upah_projects`
  live (snapshot: **57**), `total_hak` = total upah tercatat.
- **Catat/screenshot baris kontrol itu.** Angka inilah pembanding STEP 9.

**Kalau gagal.**
- `ERROR: relation "upah_projects_backup_20261026" already exists` → backup sudah pernah
  dibuat. **Jangan timpa.** Cek isinya (`select count(*) from public.upah_projects_backup_20261026;`).
  Kalau dari hari yang sama, lanjut saja. Kalau dari hari lain, ganti nama tabel menjadi
  `upah_projects_backup_<tanggal hari ini>` lalu jalankan ulang.
- `ERROR: permission denied` → DAT tidak sedang berjalan sebagai owner/`postgres`.
  Hentikan; minta akses yang benar. Jangan coba menembus RLS.

---

## STEP 1 — Diagnostik (A1a–A1g, read-only)

**Tujuan.** Memastikan bentuk database sesuai yang diasumsikan runbook **sebelum** ada yang
ditulis.

```sql
-- ============================================================
-- STEP 1 — DIAGNOSTIK (READ-ONLY, tidak menulis apa pun)
-- Jalankan A1a..A1g satu per satu, bandingkan dengan kolom
-- "kriteria lulus" di runbook. Ada satu yang gagal = STOP.
-- ============================================================

-- A1a. Struktur kolom upah_projects
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'upah_projects'
order by ordinal_position;

-- A1b. Constraint (FK) pada upah_projects
select c.conname,
       c.contype,
       c.convalidated,
       pg_get_constraintdef(c.oid) as definisi
from pg_constraint c
where c.conrelid = 'public.upah_projects'::regclass
order by c.conname;

-- A1b. Index pada upah_projects
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'upah_projects'
order by indexname;

-- A1c. Kondisi tautan sekarang (error 42703 = kolom project_id belum ada)
select count(*)                                        as total,
       count(*) filter (where project_id is null)      as belum_terhubung,
       count(*) filter (where project_id is not null)  as terhubung
from public.upah_projects;

-- A1d. Orphan: project_id menunjuk master yang tidak ada (harus 0)
select up.id, up.project_name, up.project_id
from public.upah_projects up
left join public.projects p on p.id = up.project_id
where up.project_id is not null and p.id is null;

-- A1e. Integritas master projects
select count(*)                                                  as total_master,
       count(*) filter (where btrim(coalesce(kode, '')) = '')     as kode_kosong,
       count(*) filter (where kode ~ '[^0-9]')                    as kode_berhuruf,
       count(*) filter (where kode ~ '^[0-9]+$')                  as kode_angka_murni
from public.projects;

-- A1e. Kode ganda (harus 0 baris)
select lower(btrim(kode)) as kode, count(*) as jumlah
from public.projects
where btrim(coalesce(kode, '')) <> ''
group by 1
having count(*) > 1;

-- A1f. Kolom & objek yang dipakai STEP 9 / STEP 10
select 'upah_totalan.final' as objek, count(*) as ada
from information_schema.columns
where table_schema = 'public' and table_name = 'upah_totalan' and column_name = 'final'
union all
select 'view v_upah_project_actual', count(*) from pg_views
where schemaname = 'public' and viewname = 'v_upah_project_actual'
union all
select 'view v_upah_project_finance', count(*) from pg_views
where schemaname = 'public' and viewname = 'v_upah_project_finance';

-- A1g. Tabel modul upah_* yang wajib ada (harus 7 baris)
select c.relname as tabel
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('upah_tukang','upah_projects','upah_items','upah_kasbon',
                    'upah_totalan','upah_totalan_projects','upah_totalan_kasbon')
  and c.relkind = 'r'
order by 1;
```

**Kriteria lulus** (bandingkan satu per satu; semua harus lulus):

| Blok | Yang dilihat | Lulus kalau | Kalau tidak lulus |
|---|---|---|---|
| A1a | kolom `project_id` | ada, `data_type = uuid`, `is_nullable = YES` | kolom tidak ada → **boleh lanjut** (STEP 2 menambahkannya). Tipe lain (`text`/`bigint`) → **STOP** |
| A1b | constraint | `upah_projects_project_id_fkey`, `convalidated = true` | belum ada → boleh lanjut (STEP 2 membuat + validate) |
| A1b | index | `upah_projects_project_id_idx` = `btree (project_id)` | belum ada → boleh lanjut (STEP 2 membuat) |
| A1c | jumlah tautan | `total` = jumlah proyek upah (snapshot 57); `belum_terhubung` = `total` bila belum pernah ditautkan | kalau sudah ada yang `terhubung`, catat angkanya — guard STEP 7/8 akan melindunginya |
| A1d | orphan | **0 baris** | ada baris → **STOP**, perbaiki dulu (ada `project_id` menunjuk master yang sudah dihapus) |
| A1e | master | 96 baris, 1 kode kosong, 7 kode berhuruf, **0 kode ganda** | kode ganda > 0 → **STOP** (kunci pencocokan tidak unik) |
| A1f | objek pendukung | `upah_totalan.final` = 1; view boleh 0 | `final` = 0 → **STOP** (migrasi `2026-10-24_LOCK_totalan_historis_pujon.sql` belum jalan) |
| A1g | tabel modul | **7 baris** (`upah_tukang` … `upah_totalan_kasbon`) | kurang → **STOP**, modul belum lengkap |

**Kalau ada yang gagal:** jangan jalankan STEP 2. Screenshot hasil query yang gagal, kirim ke
Brooklyn/DAT beserta nama bloknya (mis. "A1e: ada 2 kode ganda"). Tidak ada yang perlu
di-rollback karena STEP 1 tidak menulis apa pun.

---

## STEP 2 — Migrasi (DRAFT yang sudah final, idempotent)

**Tujuan.** Memastikan kolom `project_id`, FK, index, dan dua view dasar ada — tanpa mengubah
data.

Jalankan **seluruh isi** `migrations/2026-10-25_upah_projects_project_id.DRAFT.sql`. Blok di
bawah ini isinya **sama persis** dengan berkas di repo (berkas tetap sumber kebenaran; kalau
berbeda, pakai berkasnya). File dibungkus `begin; … commit;` dan idempotent: aman dijalankan
walau kolomnya sudah ada.

```sql
-- ============================================================
-- DRAFT — JANGAN DIJALANKAN TANPA PERSETUJUAN DAT
-- ============================================================
-- Tiket  : t_55fc911c — Upah & Kasbon: Project ID pada proyek (v2)
-- Tanggal: 25 Oktober 2026
-- Sifat  : ADITIF + IDEMPOTENT. Tidak mengubah/menghapus data.
--          TIDAK dijalankan pada database live oleh agen.
--
-- HASIL REVIEW migrations/2026-10-24_upah_kasbon_master.sql
-- ------------------------------------------------------------
-- Kolom `upah_projects.project_id UUID REFERENCES public.projects(id)
-- ON DELETE SET NULL` SUDAH ada di CREATE TABLE (baris 47). Jadi untuk
-- database yang dibuat dari migrasi itu, kontrak FK sudah benar.
-- Yang BELUM tertutup:
--   (a) `CREATE TABLE IF NOT EXISTS` tidak menambah kolom/FK bila tabel
--       sudah terlanjur dibuat sebelum kolom itu ada (database lama).
--   (b) Tidak ada index pada project_id -> agregasi per proyek (Project
--       Finance) memakai seq scan.
--   (c) Belum ada kontrak agregasi siap pakai + daftar kerja proyek yang
--       belum tertaut (untuk migrasi data lama secara MANUAL).
--
-- Yang dilakukan draft ini:
--   1) pastikan kolom project_id ada (ADD COLUMN IF NOT EXISTS)
--   2) pastikan FK ke public.projects(id) ada (tambah bila belum, NOT VALID
--      lalu VALIDATE — gagal VALIDATE = rollback, bukan data rusak)
--   3) index upah_projects(project_id)
--   4) komentar kolom (dokumentasi kontrak)
--   5) view agregasi upah per master project  -> bahan Project Finance
--      view daftar proyek belum tertaut        -> bahan migrasi manual DAT
--
-- ATURAN DATA LAMA (arahan DAT):
--   Proyek tanpa project_id TIDAK ditebak dari nama. Backfill hanya boleh
--   lewat keputusan manusia; view v_upah_project_unlinked menyediakan
--   daftar kerjanya. Nama yang "mirip" bukan relasi.
--
-- ROLLBACK (bila suatu saat perlu dibatalkan):
--   drop view if exists public.v_upah_project_unlinked;
--   drop view if exists public.v_upah_project_actual;
--   drop index if exists public.upah_projects_project_id_idx;
--   alter table public.upah_projects drop constraint if exists upah_projects_project_id_fkey;
--   -- kolom project_id JANGAN di-drop bila sudah berisi tautan.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) Kolom relasi utama ke master Projects
-- ------------------------------------------------------------
alter table public.upah_projects
  add column if not exists project_id uuid;

comment on column public.upah_projects.project_id is
  'RELASI utama ke public.projects(id). project_name tetap snapshot historis. '
  'NULL = belum terhubung (data lama) — tidak boleh diisi dengan pencocokan nama.';

-- ------------------------------------------------------------
-- 2) FK ke public.projects(id) — tegaskan bila belum ada
--    NOT VALID dulu supaya DDL tidak gagal karena baris lama; VALIDATE
--    di akhir membuat seluruh transaksi gagal (rollback) bila ada orphan.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'upah_projects_project_id_fkey'
      and conrelid = 'public.upah_projects'::regclass
  ) then
    alter table public.upah_projects
      add constraint upah_projects_project_id_fkey
      foreign key (project_id) references public.projects(id)
      on delete set null
      not valid;
  end if;
end $$;

alter table public.upah_projects
  validate constraint upah_projects_project_id_fkey;

-- ------------------------------------------------------------
-- 3) Index untuk agregasi per proyek (Project Finance / rekap)
-- ------------------------------------------------------------
create index if not exists upah_projects_project_id_idx
  on public.upah_projects (project_id);

-- ------------------------------------------------------------
-- 4) Kontrak agregasi: total upah aktual per master project
--    Aturan angka SAMA dengan modul (logic.js):
--      total proyek = total_manual bila diisi, jika tidak = SUM(upah_rincian)
--    Hanya baris yang SUDAH tertaut (project_id not null).
--    security_invoker = true -> RLS tabel dasar tetap berlaku (PG15+/Supabase).
-- ------------------------------------------------------------
create or replace view public.v_upah_project_actual
with (security_invoker = true) as
select
  up.project_id                                                   as master_project_id,
  count(*)                                                        as jumlah_proyek_upah,
  count(distinct up.tukang_id)                                    as jumlah_tukang,
  count(*) filter (where up.total_manual is not null)             as jumlah_total_manual,
  coalesce(sum(coalesce(up.total_manual, it.total_rincian, 0)), 0) as total_upah_aktual
from public.upah_projects up
left join (
  select project_id, sum(upah_rincian) as total_rincian
  from public.upah_items
  group by project_id
) it on it.project_id = up.id
where up.project_id is not null
group by up.project_id;

comment on view public.v_upah_project_actual is
  'Total upah AKTUAL per master project (hanya proyek yang sudah tertaut). '
  'total_manual menimpa SUM(upah_rincian), sama dengan aturan modul Upah & Kasbon.';

-- ------------------------------------------------------------
-- 5) Daftar kerja: proyek upah yang BELUM terhubung ke master
--    Untuk ditautkan MANUAL oleh DAT (tidak ada backfill otomatis).
-- ------------------------------------------------------------
create or replace view public.v_upah_project_unlinked
with (security_invoker = true) as
select
  up.id             as upah_project_id,
  up.tukang_id,
  tk.kode           as tukang_kode,
  tk.nama           as tukang_nama,
  up.project_name   as nama_snapshot,
  up.status,
  up.created_at
from public.upah_projects up
join public.upah_tukang tk on tk.id = up.tukang_id
where up.project_id is null;

comment on view public.v_upah_project_unlinked is
  'Proyek upah tanpa project_id ("Belum terhubung"). Daftar kerja migrasi manual; '
  'nama TIDAK boleh dipakai untuk menebak relasi.';

-- ------------------------------------------------------------
-- 6) Hak akses view (RLS tetap via security_invoker)
-- ------------------------------------------------------------
revoke all on public.v_upah_project_actual from anon;
revoke all on public.v_upah_project_unlinked from anon;
grant select on public.v_upah_project_actual to authenticated;
grant select on public.v_upah_project_unlinked to authenticated;

commit;

-- ============================================================
-- QUERY DIAGNOSTIK (READ-ONLY — jalankan terpisah, tidak mengubah data)
-- ============================================================
-- (a) Berapa proyek upah yang belum tertaut?
--   select count(*) filter (where project_id is null) as belum_terhubung,
--          count(*) filter (where project_id is not null) as terhubung,
--          count(*) as total
--   from public.upah_projects;
--
-- (b) Cek orphan SEBELUM validate constraint (harus 0 baris):
--   select up.id, up.project_name, up.project_id
--   from public.upah_projects up
--   left join public.projects p on p.id = up.project_id
--   where up.project_id is not null and p.id is null;
--
-- (c) Satu master project dipakai beberapa proyek upah (bisa sah: beda
--     tukang / tahap). Periksa bila tidak diharapkan:
--   select project_id, count(*) as jumlah
--   from public.upah_projects
--   where project_id is not null
--   group by project_id having count(*) > 1;
--
-- (d) Kandidat nama mirip untuk review MANUAL (BUKAN untuk backfill):
--   select up.id, up.project_name, p.id as kandidat_master_id, p.kode, p.name
--   from public.upah_projects up
--   join public.projects p on lower(trim(p.name)) = lower(trim(up.project_name))
--   where up.project_id is null;
--   -- Hasil query ini hanya SARAN. Jangan update tanpa keputusan DAT.
-- ============================================================
```

Isi ringkas file itu:

1. `alter table public.upah_projects add column if not exists project_id uuid;`
2. FK `upah_projects_project_id_fkey` → `public.projects(id)` `on delete set null`
   (`NOT VALID` lalu `VALIDATE` — gagal validate = rollback total, bukan data rusak)
3. index `upah_projects_project_id_idx`
4. komentar kolom (kontrak: `NULL` = belum terhubung, tidak boleh diisi hasil tebakan)
5. view `v_upah_project_actual` (total upah aktual per master, hanya yang tertaut)
6. view `v_upah_project_unlinked` (daftar kerja "Belum terhubung")

**Hasil yang diharapkan.**
- Output berakhir dengan `COMMIT`, tanpa `ERROR`.
- Jalankan ulang **A1a + A1b**: `project_id` ada bertipe `uuid`, FK `convalidated = true`,
  index `btree (project_id)` ada.
- Tidak ada baris data yang berubah (A1c tetap sama dengan sebelum STEP 2).

**Kalau gagal.**
- Error apa pun → transaksi otomatis rollback, **tidak ada yang setengah jadi**. Jangan
  diulang sebelum errornya dibaca; kirim teks error ke Brooklyn/DAT.
- `ERROR: constraint ... is not valid` / validate gagal → ada baris dengan `project_id` yang
  tidak ada di `projects` (orphan). Jalankan A1d, laporkan barisnya.
- Kalau `security_invoker` tidak dikenal (Postgres < 15) → view gagal dibuat. Laporkan; versi
  Supabase saat ini PG15+, jadi ini seharusnya tidak terjadi.

---

## STEP 3 — Isi tabel staging nomor dari sheet (A2 + A2c)

**Tujuan.** Menyimpan pasangan **nomor–nama–total** per baris sheet "List Proyek" kolom A,
supaya pencocokan memakai nomor (bukan tebakan nama).

```sql
-- ============================================================
-- STEP 3 — TABEL STAGING NOMOR (dari sheet "List Proyek" kolom A)
-- Tujuan: menyimpan pasangan nomor-nama per baris sheet supaya
--         pencocokan tidak menebak dari nama.
-- Sifat : MENULIS, hanya ke tabel staging milik proses ini.
-- ============================================================

create table if not exists public.upah_mapping_source (
  id          bigserial primary key,
  tukang_kode text not null,
  source_no   text,
  source_name text not null,
  total_upah  numeric,
  baris_sheet int,
  catatan     text,
  created_at  timestamptz default now()
);

-- Isi ulang dari nol supaya tidak ada duplikat kalau STEP ini diulang.
truncate public.upah_mapping_source restart identity;

-- 57 baris snapshot 20 Okt 2026 (Asep 1, Pujon 56).
-- Kolom: tukang_kode, source_no (kolom A sheet), source_name (kolom B),
--        total_upah (kolom C), baris_sheet (nomor baris asli di sheet).
insert into public.upah_mapping_source (tukang_kode, source_no, source_name, total_upah, baris_sheet) values
  ('asep', '99', 'Santi - Baroni Utara 1/87', 10345000, 3),
  ('pujon', '49', 'Project Intercon', 37415000, 3),
  ('pujon', '47', 'Project Cosmos', 5441500, 4),
  ('pujon', '52', 'Project Radio Dalam', 7940000, 5),
  ('pujon', '21', 'Project Jessie', 6185000, 6),
  ('pujon', null, 'Project Sunter Hijau 8', 9028000, 7),
  ('pujon', '17', 'Project Cendana Icon', 300000, 8),
  ('pujon', '53', 'Project Park Serpong', 4230000, 9),
  ('pujon', '57', 'Project Gatsu', 20299800, 10),
  ('pujon', '55', 'Project Duren Sawit', 31741500, 11),
  ('pujon', '58', 'Project Meranti', 9631000, 12),
  ('pujon', null, 'Project Nerin 1', 25258950, 13),
  ('pujon', null, 'Project Nerin 5', 22337000, 14),
  ('pujon', null, 'Project Park Serpong - Cendana', 720000, 15),
  ('pujon', null, 'Project Rosini -', 550000, 16),
  ('pujon', null, 'Service Park Serpong', 1000000, 17),
  ('pujon', null, 'Service Tokyo', 250000, 18),
  ('pujon', null, 'Service TA', 1000000, 19),
  ('pujon', null, 'Service Bintaro', 1500000, 20),
  ('pujon', null, 'Project Barbershop', 6800000, 21),
  ('pujon', '63', 'Project Dulcet', 2770000, 22),
  ('pujon', '65', 'Project Flaminggo', 5984250, 23),
  ('pujon', '66', 'Project Casa de Parco', 2601500, 24),
  ('pujon', null, 'Project Sunter Hijau Utama', 6694000, 25),
  ('pujon', null, 'Everbeau', 2475000, 26),
  ('pujon', '74', 'Cityzen North 3 -17', 8884350, 27),
  ('pujon', '75', 'Cove 2 - 27', 10421500, 28),
  ('pujon', '76', 'Cove 2 - 76', 702000, 29),
  ('pujon', null, 'Park Serpong 9 - 15', 3375000, 30),
  ('pujon', '79', 'Osaka PIK', 11380000, 31),
  ('pujon', null, 'Servis', 2300000, 32),
  ('pujon', '78', 'Park Serpong Flo 7 -66', 4770000, 33),
  ('pujon', '71', 'Barbershop HI - 2', 9660000, 34),
  ('pujon', '72', 'Project Apt Baywalk', 3565000, 35),
  ('pujon', '70', 'Project Cisauk', 4537000, 36),
  ('pujon', '69', 'Peak Springhill', 6580000, 37),
  ('pujon', null, 'Project Pademangan', 675000, 38),
  ('pujon', null, 'Project Barbershop Pintu', 900000, 39),
  ('pujon', '81', 'Project Skyhouse BSD', 11603000, 40),
  ('pujon', '80', 'Project Charm 23 - 56', 8725000, 41),
  ('pujon', '75', 'Project Cove 2 - 27', 2425000, 42),
  ('pujon', null, 'Cendana Botanic', 2645750, 43),
  ('pujon', null, 'Project Springhill', 950000, 44),
  ('pujon', null, 'Servisan 2', 850000, 45),
  ('pujon', '88', 'Project Bekasi', 2795000, 46),
  ('pujon', '92', 'Project Panola', 2225000, 47),
  ('pujon', '87', 'Project Semanan', 21842000, 48),
  ('pujon', '85', 'Project Rempoa', 18778000, 49),
  ('pujon', '95', 'Project Barbershop Pekayon', 4250000, 50),
  ('pujon', '96', 'Project Leo Sunter', 1363500, 51),
  ('pujon', '89', 'Project Cove 2-21', 3425000, 52),
  ('pujon', '90', 'Project Steffi', 5197000, 53),
  ('pujon', '83', 'Proyek Josh - Mabes', 9230000, 54),
  ('pujon', '61', 'Proyek Sunter Hijau - Eric', 123729000, 55),
  ('pujon', '94', 'Project Reivan Trail 10-20', 7356000, 56),
  ('pujon', '91', 'Brigitta Cove 12-32', 10120000, 57),
  ('pujon', null, 'Project Everbeau - kaca', 2500000, 58);

-- ------------------------------------------------------------
-- A2c. VERIFIKASI STAGING vs LIVE (wajib; semua harus 0 selisih)
-- ------------------------------------------------------------

-- A2c.1  Jumlah baris per tukang. Harus: asep 1 / pujon 56 / total 57,
--        bernomor 37, tanpa nomor 20.
select tukang_kode,
       count(*)                                                          as baris,
       count(*) filter (where btrim(coalesce(source_no, '')) <> '')       as bernomor,
       count(*) filter (where btrim(coalesce(source_no, '')) = '')        as tanpa_nomor,
       sum(total_upah)                                                   as total_upah
from public.upah_mapping_source
group by 1
order by 1;

-- A2c.2  Baris staging yang TIDAK ketemu di upah_projects (harus 0 baris).
--        Kalau ada: nama di modul sudah diubah / baris sudah dihapus.
--        Perbaiki source_name di staging (atau catat pengecualiannya), jangan lanjut.
select s.tukang_kode, s.source_no, s.source_name, s.total_upah, s.baris_sheet
from public.upah_mapping_source s
left join public.upah_tukang t
       on lower(btrim(t.kode)) = lower(btrim(s.tukang_kode))
left join public.upah_projects up
       on up.tukang_id = t.id
      and lower(btrim(up.project_name)) = lower(btrim(s.source_name))
where up.id is null
order by 1, 4, 3;

-- A2c.3  Baris upah_projects yang TIDAK ada di staging (harus 0 baris).
--        Kalau ada: proyek baru setelah 20 Okt -> tambahkan barisnya ke
--        tabel staging lebih dulu (nomornya dari sheet), baru lanjut.
select t.kode as tukang_kode, up.project_name, up.total_manual, up.project_id
from public.upah_projects up
join public.upah_tukang t on t.id = up.tukang_id
left join public.upah_mapping_source s
       on lower(btrim(s.tukang_kode)) = lower(btrim(t.kode))
      and lower(btrim(s.source_name))  = lower(btrim(up.project_name))
where s.id is null
order by 1, 2;

-- A2c.4  Total upah per tukang: staging vs modul (selisih harus 0).
--        Kalau tidak 0: nominal di sheet berubah setelah snapshot ->
--        perbarui total_upah di staging dari sheet hari ini.
with stage as (
  select lower(btrim(tukang_kode)) as tukang_kode, sum(total_upah) as total
  from public.upah_mapping_source group by 1
),
modul as (
  select lower(btrim(t.kode)) as tukang_kode,
         sum(coalesce(up.total_manual, it.total_rincian, 0)) as total
  from public.upah_projects up
  join public.upah_tukang t on t.id = up.tukang_id
  left join (select project_id, sum(upah_rincian) as total_rincian
               from public.upah_items group by project_id) it
         on it.project_id = up.id
  group by 1
)
select coalesce(s.tukang_kode, m.tukang_kode) as tukang_kode,
       s.total as total_staging,
       m.total as total_modul,
       coalesce(s.total, 0) - coalesce(m.total, 0) as selisih
from stage s
full join modul m on m.tukang_kode = s.tukang_kode
order by 1;
```

**Hasil yang diharapkan.**

| Cek | Angka yang diharapkan |
|---|---|
| A2c.1 `asep` | 1 baris, 1 bernomor, 0 tanpa nomor, total **Rp 10.345.000** |
| A2c.1 `pujon` | 56 baris, 36 bernomor, 20 tanpa nomor, total **Rp 519.911.600** |
| A2c.1 total | **57 baris / 37 bernomor / 20 tanpa nomor / Rp 530.256.600** |
| A2c.2 (staging tanpa pasangan di modul) | **0 baris** |
| A2c.3 (baris modul tanpa pasangan di staging) | **0 baris** |
| A2c.4 (total staging vs modul) | `selisih = 0` untuk **asep** dan **pujon** |

**Catatan penting soal isi INSERT.**
- 57 baris di atas adalah **snapshot 20 Okt 2026** (Asep 1, Pujon 56). Nomor diambil dari
  kolom A, nama dari kolom B, total dari kolom C.
- Baris tanpa nomor **tetap dimasukkan** dengan `source_no = null`. Kalau dilewati, baris itu
  tidak akan pernah masuk antrian dan bisa terlupakan.
- Di tab Asep ada satu baris liar di baris ke-55 sheet: kolom A berisi `83`, kolom B dan C
  kosong. Baris itu **tidak** dimasukkan (tidak punya nama/total). Jangan ikut menyalinnya.
- **Kalau live berbeda** (ada proyek baru, nama berubah, nominal berubah), A2c akan
  menunjukkannya. Perbaiki tabel staging (tambah baris / betulkan `source_name` /
  perbarui `total_upah`), lalu **jalankan STEP 3 ulang dari awal** (blok ini men-truncate
  staging, jadi tidak ada duplikat).

**Kalau gagal.**
- A2c.2 > 0 → nama di modul sudah diubah atau barisnya sudah dihapus. Cocokkan manual; ubah
  `source_name` di staging agar sama dengan `upah_projects.project_name` (atau catat sebagai
  pengecualian dan lewati baris itu dengan sengaja). **Jangan lanjut** sebelum 0.
- A2c.3 > 0 → ada proyek upah yang tidak ada di sheet (biasanya dibuat setelah 20 Okt).
  Tambahkan barisnya ke staging dengan nomor dari sheet hari ini; kalau nomornya tidak ada,
  masukkan `source_no = null` supaya masuk daftar keputusan.
- A2c.4 ≠ 0 → nominal di sheet berubah. Perbarui `total_upah` di staging dari sheet hari ini,
  atau (kalau memang nominal modul yang berubah) catat selisihnya dan hentikan proses.

---

## STEP 4 — Antrian usulan (A3 + A3b)

**Tujuan.** Mengubah 57 baris + master menjadi satu baris usulan per proyek upah, berlabel
kelas keputusan.

```sql
-- ============================================================
-- STEP 4a — TABEL ANTRIAN USULAN
-- Tujuan: satu baris per proyek upah berisi usulan + kelas keputusan,
--         supaya DAT memutuskan di satu tempat (bukan di 57 layar).
-- Sifat : MENULIS, hanya tabel kerja milik proses ini.
-- ============================================================

-- helper normalisasi nama (hanya untuk kandidat; bukan penentu relasi)
create or replace function public.upah_proposal_norm(p_text text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(coalesce(p_text, '')), '^(proyek|project)\s+', ''),
               '^\d+\s*[.)-]\s*', ''),
             '[^a-z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

create table if not exists public.upah_project_link_review (
  upah_project_id   uuid primary key references public.upah_projects(id) on delete cascade,
  tukang_kode       text,
  nama_snapshot     text,
  source_no         text,
  source_name       text,
  master_project_id uuid references public.projects(id) on delete set null,
  master_kode       text,
  master_name       text,
  method            text not null,
  status            text not null default 'suggested',
  saran             text,
  decision          text check (decision in ('approved', 'rejected', 'manual')),
  decided_by        text,
  decided_at        timestamptz,
  note              text,
  updated_at        timestamptz default now()
);

-- kolom baru kalau tabel ini sudah pernah dibuat versi lama
alter table public.upah_project_link_review add column if not exists saran text;
alter table public.upah_project_link_review add column if not exists decision text;
alter table public.upah_project_link_review
  drop constraint if exists upah_project_link_review_decision_check;
alter table public.upah_project_link_review
  add constraint upah_project_link_review_decision_check
  check (decision in ('approved', 'rejected', 'manual'));

create index if not exists upah_project_link_review_method_idx
  on public.upah_project_link_review (method, status);
```

```sql
-- ============================================================
-- STEP 4b — ISI ANTRIAN (satu baris per proyek upah)
-- Tujuan: mengubah 57 baris staging + master menjadi usulan berkelas.
-- Sifat : MENULIS tabel review. TIDAK menyentuh upah_projects.
-- Aman diulang: baris yang sudah diputuskan DAT tidak ditimpa.
-- ============================================================

insert into public.upah_project_link_review
  (upah_project_id, tukang_kode, nama_snapshot, source_no, source_name,
   master_project_id, master_kode, master_name, method, status, saran, note)
with up as (
  select up.id as upah_project_id, t.kode as tukang_kode, up.project_name
  from public.upah_projects up
  join public.upah_tukang t on t.id = up.tukang_id
),
src as (
  select lower(btrim(tukang_kode)) as tukang_kode,
         lower(btrim(source_name))  as nama_key,
         (array_agg(distinct btrim(source_no))
            filter (where btrim(coalesce(source_no, '')) <> ''))[1] as nomor,
         (array_agg(source_name))[1] as source_name,
         count(distinct btrim(source_no))
            filter (where btrim(coalesce(source_no, '')) <> '') as n_nomor
  from public.upah_mapping_source
  group by 1, 2
),
hit as (
  select up.*, s.nomor, s.source_name, coalesce(s.n_nomor, 0) as n_nomor,
         k.n as n_kode, k.id as kode_id, k.kode as kode_kode, k.name as kode_name,
         sib.n as n_sibling, sib.kode as sib_kode, sib.name as sib_name,
         nm.n as n_nama,
         (up.project_name ~* '^(service|servis)') as nama_jasa,
         (s.nomor is not null and exists (
            select 1
            from unnest(string_to_array(public.upah_proposal_norm(up.project_name), ' ')) tk
            where tk <> ''
              and tk = any (string_to_array(public.upah_proposal_norm(k.name), ' '))
         )) as nama_nyambung
  from up
  left join src s
    on s.tukang_kode = lower(btrim(up.tukang_kode))
   and s.nama_key    = lower(btrim(up.project_name))
  left join lateral (
    select count(*) as n,
           (array_agg(p.id))[1]   as id,
           (array_agg(p.kode))[1] as kode,
           (array_agg(p.name))[1] as name
    from public.projects p
    where lower(btrim(coalesce(p.kode, ''))) = lower(btrim(s.nomor))
  ) k on true
  left join lateral (
    select count(*) as n,
           (array_agg(p.kode))[1] as kode,
           (array_agg(p.name))[1] as name
    from public.projects p
    where lower(btrim(coalesce(p.kode, ''))) = lower(btrim(s.nomor)) || 'a'
  ) sib on true
  left join lateral (
    select count(*) as n
    from public.projects p
    where public.upah_proposal_norm(p.name) = public.upah_proposal_norm(up.project_name)
      and public.upah_proposal_norm(p.name) <> ''
  ) nm on true
),
-- kandidat nama untuk baris TANPA nomor: hanya SARAN, tidak pernah menautkan.
-- Dinilai dari jumlah kata (>=4 huruf, bukan "project/proyek") yang sama persis.
cand as (
  select u.project_name, p.kode, p.name,
         (select count(*)
            from unnest(string_to_array(public.upah_proposal_norm(u.project_name), ' ')) tk
           where length(tk) >= 4
             and tk not in ('project', 'proyek')
             and tk = any (string_to_array(public.upah_proposal_norm(p.name), ' '))) as ov
  from (select distinct project_name from up) u
  cross join public.projects p
),
best as (
  select c.project_name,
         array_to_string(
           (array_agg(format('%s [%s]', c.kode, c.name) order by c.kode))[1:3], ' | ') as saran,
         count(*) as n_kandidat
  from cand c
  where c.ov > 0
    and c.ov = (select max(c2.ov) from cand c2 where c2.project_name = c.project_name)
  group by c.project_name
)
select hit.upah_project_id, hit.tukang_kode, hit.project_name, hit.nomor, hit.source_name,
       case when hit.n_nomor = 1 and hit.n_kode = 1 then hit.kode_id end,
       case when hit.n_nomor = 1 and hit.n_kode = 1 then hit.kode_kode end,
       case when hit.n_nomor = 1 and hit.n_kode = 1 then hit.kode_name end,
       case when hit.n_nomor > 1 then 'konflik_nomor_sumber'
            when hit.n_nomor = 1 and hit.n_kode = 1 and hit.n_sibling > 0 then 'kode_kembar'
            when hit.n_nomor = 1 and hit.n_kode = 1 and hit.nama_nyambung then 'kode'
            when hit.n_nomor = 1 and hit.n_kode = 1 then 'kode_nama_beda'
            when hit.n_nomor = 1 and hit.n_kode > 1 then 'ambigu_kode'
            when hit.n_nomor = 1 then 'kode_tidak_ada'
            when hit.n_nomor = 0 and hit.nama_jasa then 'non_proyek'
            when hit.n_nomor = 0 and hit.n_nama = 1 then 'nama_kandidat'
            when hit.n_nomor = 0 and hit.n_nama > 1 then 'nama_ambigu'
            else 'tanpa_kandidat' end,
       'suggested',
       case when hit.n_nomor = 0 then coalesce(b.saran, 'tidak ada kandidat nama') end,
       case when hit.n_nomor > 1 then 'satu nama punya lebih dari satu nomor di staging'
            when hit.n_sibling > 0
              then 'kode ' || hit.nomor || ' punya varian ' || hit.sib_kode
                   || ' (' || hit.sib_name || ') — pilih salah satu'
            when hit.n_nomor = 1 and hit.n_kode = 1 and not hit.nama_nyambung
              then 'nomor cocok, nama beda: sheet "' || hit.project_name
                   || '" vs master "' || hit.kode_name || '"'
       end
from hit
left join best b on b.project_name = hit.project_name
on conflict (upah_project_id) do update
   set tukang_kode       = excluded.tukang_kode,
       nama_snapshot     = excluded.nama_snapshot,
       source_no         = excluded.source_no,
       source_name       = excluded.source_name,
       master_project_id = excluded.master_project_id,
       master_kode       = excluded.master_kode,
       master_name       = excluded.master_name,
       method            = excluded.method,
       saran             = excluded.saran,
       note              = excluded.note,
       updated_at        = now()
 where public.upah_project_link_review.status = 'suggested';
```

**Hasil yang diharapkan** (A4c — rekap seluruh kelas):

| method | jumlah | arti |
|---|---|---|
| `kode` | **29** | nomor cocok + nama nyambung → boleh batch |
| `kode_kembar` | **6** | nomor punya varian `XXa` → DAT pilih |
| `kode_nama_beda` | **2** | nomor cocok, nama beda → DAT spot-check |
| `tanpa_kandidat` | **14** | tanpa nomor, bukan jasa → DAT putuskan |
| `non_proyek` | **6** | jasa/operasional → konfirmasi |
| **total** | **57** | — |

**Kalau gagal.**
- Total ≠ 57 → ada baris `upah_projects` yang tidak masuk antrian. Jalankan A2c.3; biasanya
  karena nama di staging tidak sama dengan nama di modul.
- Angka kelas berbeda dari tabel di atas → **STOP**. Data live berbeda dari snapshot; jangan
  meng-approve apa pun sebelum selisihnya dijelaskan (kirim rekap A4c ke Brooklyn/DAT).
- `ERROR: function upah_proposal_norm already exists` → jalankan ulang; blok ini memakai
  `create or replace`.

---

## STEP 5 — Daftar keputusan DAT (A3c)

**Tujuan.** Menampilkan **hanya** baris yang butuh keputusan, dikelompokkan, dengan saran dan
pilihan yang sah — supaya DAT tidak perlu membaca 57 baris.

```sql
-- ============================================================
-- STEP 5 — DAFTAR KEPUTUSAN DAT (READ-ONLY)
-- Tujuan: satu tampilan berisi SEMUA baris yang butuh keputusan,
--         dikelompokkan, lengkap dengan saran & pilihan yang sah.
-- Sifat : hanya membaca. Tidak ada yang berubah kalau dijalankan.
-- ============================================================

with sib as (
  select r.upah_project_id,
         (array_agg(p.kode))[1] as sib_kode,
         (array_agg(p.name))[1] as sib_name
  from public.upah_project_link_review r
  join public.projects p
    on lower(btrim(p.kode)) = lower(btrim(r.master_kode)) || 'a'
  where r.method = 'kode_kembar'
  group by r.upah_project_id
),
d as (
  select r.upah_project_id as review_id,
         r.tukang_kode      as tukang,
         r.nama_snapshot    as project_name,
         r.method,
         case when r.method = 'kode_kembar'    then 1
              when r.method = 'kode_nama_beda' then 2
              when r.method = 'non_proyek'     then 4
              when r.method in ('tanpa_kandidat', 'nama_kandidat', 'nama_ambigu') then 3
              else 5 end as urut,
         case when r.method = 'kode_kembar'    then 'A. kode_kembar'
              when r.method = 'kode_nama_beda' then 'B. kode_nama_beda'
              when r.method = 'non_proyek'     then 'D. non_proyek (jasa)'
              when r.method in ('tanpa_kandidat', 'nama_kandidat', 'nama_ambigu')
                                               then 'C. tanpa_nomor_non_jasa'
              else 'E. lainnya (' || r.method || ')' end as kategori,
         -- SARAN
         case when r.method = 'kode_kembar'
                then r.master_kode || ' [' || coalesce(nullif(btrim(r.master_name), ''), '(nama kosong)') || ']'
                     || '   ATAU   '
                     || coalesce(s.sib_kode, r.master_kode || 'a') || ' ['
                     || coalesce(s.sib_name, '?') || ']'
              when r.method = 'kode_nama_beda'
                then r.master_kode || ' [' || r.master_name || ']'
              when r.method = 'non_proyek' then '— (tidak ditautkan)'
              else coalesce(r.saran, 'tidak ada kandidat nama') end as saran,
         -- ALASAN
         case when r.method = 'kode_kembar'
                then 'nomor ' || r.source_no || ' punya dua baris master; baris '
                     || r.master_kode || ' bernama '
                     || coalesce(nullif(btrim(r.master_name), ''), 'KOSONG')
                     || ', nama sebenarnya ada di ' || coalesce(s.sib_kode, r.master_kode || 'a')
              when r.method = 'kode_nama_beda'
                then 'nomor ' || r.source_no || ' cocok, nama beda: sheet "'
                     || r.nama_snapshot || '" vs master "' || r.master_name || '"'
              when r.method = 'non_proyek'
                then 'baris jasa/operasional (diawali Service/Servis) — biaya jasa, bukan proyek'
              when r.method = 'nama_kandidat'
                then 'tanpa nomor; nama persis sama dengan master ' || r.master_kode || ' (kandidat, bukan relasi)'
              when r.method = 'nama_ambigu'
                then 'tanpa nomor; nama persis sama dengan lebih dari satu master'
              when r.source_no is null or btrim(r.source_no) = ''
                then 'tidak ada nomor di sheet (kolom A kosong); tidak ada nama master yang persis sama'
              else 'perlu diperiksa: ' || coalesce(r.note, r.method) end as alasan,
         -- PILIHAN yang sah
         case when r.method = 'kode_kembar'
                then 'approved = pakai ' || r.master_kode
                     || '  |  manual + master_project_id = id ' || coalesce(s.sib_kode, r.master_kode || 'a')
                     || '  |  rejected'
              when r.method = 'kode_nama_beda' then 'approved = pakai ' || r.master_kode || '  |  rejected'
              when r.method = 'non_proyek' then 'rejected (konfirmasi: tidak ditautkan)'
              else 'manual + master_project_id = <id master>  |  rejected (biarkan belum terhubung)'
         end as pilihan
  from public.upah_project_link_review r
  left join sib s on s.upah_project_id = r.upah_project_id
  where r.status = 'suggested'
    and r.method <> 'kode'          -- 29 baris 'kode' bukan keputusan: diproses di STEP 6
)
select kategori, review_id, tukang, project_name, saran, alasan, pilihan
from d
order by urut, tukang, project_name;

-- A4b. Rekap jumlah per kelas (untuk laporan; angka yang diharapkan:
--      A=6, B=2, C=14, D=6, E=0, total 28)
select case when method = 'kode_kembar'    then 'A. kode_kembar'
            when method = 'kode_nama_beda' then 'B. kode_nama_beda'
            when method = 'non_proyek'     then 'D. non_proyek (jasa)'
            when method in ('tanpa_kandidat', 'nama_kandidat', 'nama_ambigu')
                                           then 'C. tanpa_nomor_non_jasa'
            else 'E. lainnya (' || method || ')' end as kategori,
       count(*) as jumlah
from public.upah_project_link_review
where status = 'suggested' and method <> 'kode'
group by 1
order by 1;

-- A4c. Rekap seluruh kelas (termasuk yang boleh batch) — harus 57 baris total
select method, status, count(*) as jumlah
from public.upah_project_link_review
group by 1, 2
order by 3 desc, 1;
```

**Hasil yang diharapkan.** 28 baris, empat kelompok:

| Kategori | Jumlah | Isi tampilan |
|---|---|---|
| A. `kode_kembar` | **6** | dua kandidat (X dan Xa) + nama masing-masing |
| B. `kode_nama_beda` | **2** | nomor + nama sheet + nama master |
| C. `tanpa_nomor_non_jasa` | **14** | nama + saran kandidat (kalau ada) |
| D. `non_proyek` (jasa) | **6** | hanya konfirmasi |
| E. lainnya | **0** | kalau muncul: kelas baru, tangani manual |

Rincian yang diharapkan (semua ini juga ada di Lampiran L3):

**A. `kode_kembar` — 6 baris, DAT pilih salah satu**

| Tukang | No | Nama di sheet | Kandidat X | Kandidat Xa |
|---|---|---|---|---|
| pujon | 69 | Peak Springhill | 69 — 69. | 69a — 69. Kevin Maranu - The Peak Springhill |
| pujon | 72 | Project Apt Baywalk | 72 — 72. | 72a — 72. Kevin Maranu - Apt Baywalk |
| pujon | 78 | Park Serpong Flo 7 -66 | 78 — 78. | 78a — 78. Flo 7 - 66 |
| pujon | 80 | Project Charm 23 - 56 | 80 — 80. XYZ Charm 23 - 56 | 80a — 80. Charm 23 - 56 |
| pujon | 81 | Project Skyhouse BSD | 81 — 81. | 81a — 81. Aan - Apt Skyhouse BSD |
| pujon | 90 | Project Steffi | 90 — 90. Steffi - Sunter | 90a — 90. Cendana Botanic - Breeze 7 - 32 |

**B. `kode_nama_beda` — 2 baris**

| Tukang | No | Nama di sheet | Master yang cocok |
|---|---|---|---|
| pujon | 47 | Project Cosmos | 47 — 47. Kalvina - Kedoya |
| pujon | 65 | Project Flaminggo | 65 — 65. Wendy - Flamingo GS |

**C. `tanpa_nomor_non_jasa` — 14 baris**

| Tukang | Nama di sheet | Saran kandidat (bukan relasi) |
|---|---|---|
| pujon | Cendana Botanic | 90a [90. Cendana Botanic - Breeze 7 - 32] |
| pujon | Everbeau | 42 [42. Dwi - Everbeau] \| 73 [73. Dwi - Everbeau] |
| pujon | Park Serpong 9 - 15 | 53 [53. Calvin - Park Serpong Prive 7] |
| pujon | Project Barbershop | 64 [64. Andri - Barbershop] \| 95 [95. Andri - Barbershop Pekayon] |
| pujon | Project Barbershop Pintu | 64 [64. Andri - Barbershop] \| 95 [95. Andri - Barbershop Pekayon] |
| pujon | Project Everbeau - kaca | 42 [42. Dwi - Everbeau] \| 73 [73. Dwi - Everbeau] |
| pujon | Project Nerin 1 | tidak ada kandidat |
| pujon | Project Nerin 5 | tidak ada kandidat |
| pujon | Project Pademangan | tidak ada kandidat |
| pujon | Project Park Serpong - Cendana | 53 [53. Calvin - Park Serpong Prive 7] |
| pujon | Project Rosini - | tidak ada kandidat |
| pujon | Project Springhill | 69a [69. Kevin Maranu - The Peak Springhill] |
| pujon | Project Sunter Hijau 8 | 54 [54. Windy - Sunter Hijau] \| 61 [Eric - Sunter Hijau] |
| pujon | Project Sunter Hijau Utama | 54 [54. Windy - Sunter Hijau] \| 61 [Eric - Sunter Hijau] |

**D. `non_proyek` (jasa) — 6 baris**

| Tukang | Nama di sheet | Total |
|---|---|---|
| pujon | Service Bintaro | Rp 1.500.000 |
| pujon | Service Park Serpong | Rp 1.000.000 |
| pujon | Service TA | Rp 1.000.000 |
| pujon | Service Tokyo | Rp 250.000 |
| pujon | Servis | Rp 2.300.000 |
| pujon | Servisan 2 | Rp 850.000 |

> **Cara membaca kolom `saran`.** Untuk baris tanpa nomor, `saran` dihitung dari kata nama
> yang sama persis dengan nama master (kata ≥4 huruf, "project/proyek" diabaikan). Ini
> **bantuan membaca**, bukan relasi. Dua kandidat ditampilkan kalau sama kuat (mis. `Everbeau`
> → 42 dan 73; `Project Sunter Hijau 8` → 54 dan 61). Kalau tidak ada yang sama persis,
> tertulis "tidak ada kandidat nama" — dan itu jawaban yang sah.

**Kalau gagal.**
- Baris E (`lainnya`) muncul → berarti ada `kode_tidak_ada`, `ambigu_kode`,
  `konflik_nomor_sumber`, `nama_kandidat`, atau `nama_ambigu`. Jangan diabaikan: baca `alasan`
  di baris itu, lalu putuskan lewat template STEP 6 (bisa `manual` bila DAT tahu tujuannya,
  atau `rejected`).
- Jumlah kelompok berbeda dari tabel → kembali ke STEP 4, jangan memutuskan apa pun.

---

## STEP 6 — Catat keputusan DAT (A4)

**Tujuan.** Mengisi kolom `decision` — **satu-satunya kolom yang DAT ubah manual**. STEP ini
tidak menautkan apa pun; ia hanya mencatat keputusan.

Arti `decision`:

| Nilai | Arti | Akibat di STEP 8 |
|---|---|---|
| `approved` | setujui usulan apa adanya | ditautkan ke `master_project_id` yang tertera |
| `manual` | setujui, tetapi tujuannya diganti | ditautkan ke `master_project_id` yang DAT isi |
| `rejected` | tidak ditautkan (termasuk konfirmasi jasa) | tetap "Belum terhubung" |

```sql
-- ============================================================
-- STEP 6 — CATAT KEPUTUSAN DAT
-- Tujuan: mengisi kolom `decision` (satu-satunya kolom yang DAT
--         ubah manual). TIDAK ada tautan yang ditulis di STEP ini.
-- Sifat : MENULIS tabel review saja.
--
-- Arti decision:
--   approved = setujui usulan apa adanya (tautkan ke master_project_id tertera)
--   manual   = setujui tetapi tujuannya diganti (WAJIB isi master_project_id)
--   rejected = tidak ditautkan (termasuk konfirmasi baris jasa/non-proyek)
-- ============================================================

-- T6.1  29 baris "kode" (nomor cocok + nama nyambung) — boleh sekali jalan.
update public.upah_project_link_review
   set decision    = 'approved',
       status      = 'decided',
       decided_by  = 'DAT',
       decided_at  = now(),
       note        = coalesce(note, 'batch: nomor cocok + nama nyambung')
 where status = 'suggested'
   and method = 'kode';

-- T6.2  2 baris "kode_nama_beda" — SETELAH DAT memeriksa nama sheet vs master
--       di STEP 5. Kalau ada yang tidak yakin, ubah dulu jadi rejected.
update public.upah_project_link_review
   set decision    = 'approved',
       status      = 'decided',
       decided_by  = 'DAT',
       decided_at  = now(),
       note        = coalesce(note, 'nomor cocok; beda nama sudah diperiksa DAT')
 where status = 'suggested'
   and method = 'kode_nama_beda';

-- T6.3  6 baris jasa = konfirmasi non-proyek (tidak ditautkan).
update public.upah_project_link_review
   set decision    = 'rejected',
       status      = 'decided',
       decided_by  = 'DAT',
       decided_at  = now(),
       note        = 'non_proyek: biaya jasa, tidak ditautkan'
 where status = 'suggested'
   and method = 'non_proyek';

-- T6.4  6 baris kode_kembar: DAT memilih X atau Xa.
--       Kolom "pilih" di bawah = usulan dari nama; UBAH kalau DAT memutuskan lain.
--       (80: nama sheet "Project Charm 23 - 56" persis = 80a; kalau unitnya XYZ -> ganti '80')
update public.upah_project_link_review r
   set decision          = 'manual',
       master_project_id = p.id,
       master_kode       = p.kode,
       master_name       = p.name,
       status            = 'decided',
       decided_by        = 'DAT',
       decided_at        = now(),
       note              = 'kode_kembar: DAT memilih ' || p.kode
  from (values ('69', '69a'),
               ('72', '72a'),
               ('78', '78a'),
               ('80', '80a'),
               ('81', '81a'),
               ('90', '90')) as v(no, pilih)
  join public.projects p on lower(btrim(p.kode)) = lower(btrim(v.pilih))
 where r.method   = 'kode_kembar'
   and r.source_no = v.no
   and r.status    = 'suggested';

-- T6.5  14 baris tanpa nomor: DAT memutuskan SATU PER SATU.
--       (a) lihat daftar + review_id + kandidat:
select r.upah_project_id, r.tukang_kode, r.nama_snapshot, r.saran
from public.upah_project_link_review r
where r.status = 'suggested'
  and r.method in ('tanpa_kandidat', 'nama_kandidat', 'nama_ambigu')
order by r.tukang_kode, r.nama_snapshot;

--       (b) TEMPLATE menautkan manual satu baris (salin, ganti 2 nilai):
-- update public.upah_project_link_review
--    set decision          = 'manual',
--        master_project_id = (select id   from public.projects where kode = '<KODE_MASTER>'),
--        master_kode       = '<KODE_MASTER>',
--        master_name       = (select name from public.projects where kode = '<KODE_MASTER>'),
--        status            = 'decided',
--        decided_by        = 'DAT',
--        decided_at        = now(),
--        note              = 'tanpa nomor: DAT tautkan manual'
--  where upah_project_id = '<REVIEW_ID>'::uuid
--    and status = 'suggested';

--       (c) TEMPLATE menolak satu baris (biarkan "Belum terhubung"):
-- update public.upah_project_link_review
--    set decision = 'rejected', status = 'decided', decided_by = 'DAT',
--        decided_at = now(), note = 'tanpa nomor: bukan proyek / belum diputuskan'
--  where upah_project_id = '<REVIEW_ID>'::uuid
--    and status = 'suggested';

--       (d) TEMPLATE menolak SEMUA sisa tanpa nomor sekaligus (hanya kalau DAT
--           memutuskan tidak ada satu pun yang ditautkan). Hapus tanda komentar
--           di 5 baris berikut untuk menjalankannya.
-- update public.upah_project_link_review
--    set decision = 'rejected', status = 'decided', decided_by = 'DAT',
--        decided_at = now(), note = 'tanpa nomor: tidak ditautkan'
--  where status = 'suggested'
--    and method in ('tanpa_kandidat', 'nama_kandidat', 'nama_ambigu');

-- T6.6  PEMERIKSAAN: semua baris harus sudah punya decision.
--       Harus 0 baris "belum diputuskan" dan total 57.
select coalesce(decision, '(belum)') as decision, count(*) as jumlah
from public.upah_project_link_review
group by 1
order by 1;

-- T6.7  Yang akan ditautkan oleh STEP 8 (approved + manual dengan tujuan jelas).
select decision, method, count(*) as jumlah
from public.upah_project_link_review
where decision in ('approved', 'manual')
  and master_project_id is not null
group by 1, 2
order by 1, 2;
```

**Hasil yang diharapkan** (T6.6 dan T6.7):

| decision | jumlah | isi |
|---|---|---|
| `approved` | **31** | 29 `kode` + 2 `kode_nama_beda` |
| `manual` | **6** | 6 `kode_kembar` (pilihan DAT) |
| `rejected` | **20** | 6 jasa + 14 tanpa nomor (kalau DAT menolak semua) |
| `(belum)` | **0** | wajib 0 sebelum STEP 7 |

Total selalu 57. Kalau DAT menautkan sebagian dari 14 baris tanpa nomor, `manual` naik dan
`rejected` turun dengan jumlah yang sama.

**Kalau gagal.**
- Masih ada `(belum)` → selesaikan baris itu lewat template T6.5 (b)/(c)/(d). STEP 8 akan
  menolak berjalan selama masih ada yang kosong (guard 3).
- `approved`/`manual` bertambah tanpa DAT sadar → jangan lanjut; jalankan
  `select * from public.upah_project_link_review where decision is not null order by decided_at desc limit 20;`
  untuk melihat apa yang berubah, lalu betulkan dengan template per baris.
- T6.4 mengenai 0 baris → `source_no` di staging bukan `'69'`/`'72'`/… (mis. ada spasi).
  Cek `select source_no from public.upah_project_link_review where method='kode_kembar';`

---

## STEP 7 — Pilot P1 `[83] Josh - Mabes` (A5 versi 1 baris)

**Tujuan.** Membuktikan satu tautan dari ujung ke ujung (nomor → tautan → angka cocok dengan
CLOSING) sebelum menyentuh 36 baris lain.

```sql
-- ============================================================
-- STEP 7 — PILOT P1: [83] Josh - Mabes (TEPAT 1 BARIS)
-- Tujuan: membuktikan satu tautan dari ujung ke ujung sebelum batch.
-- Sifat : MENULIS upah_projects.project_id untuk SATU baris + log.
--         Tidak menyentuh upah_items / kasbon / totalan / projects.
-- ============================================================

create table if not exists public.upah_project_link_log (
  id              bigserial primary key,
  upah_project_id uuid not null,
  old_project_id  uuid,
  new_project_id  uuid,
  method          text,
  actor           text,
  batch           text,
  at              timestamptz default now()
);
create index if not exists upah_project_link_log_batch_idx
  on public.upah_project_link_log (batch, upah_project_id);

do $$
declare
  v_batch  text := 'pilot-83-20261026';
  v_kode   text := '83';
  v_target uuid;
  v_rows   int;
  v_logged int;
  v_before int;
  v_after  int;
  v_over   int;
  v_nama   text;
  v_total  numeric;
begin
  select id, name into v_target, v_nama
  from public.projects
  where lower(btrim(kode)) = lower(btrim(v_kode));

  if v_target is null then
    raise exception 'STOP: master dengan kode % tidak ditemukan', v_kode;
  end if;

  -- guard 1: jangan pernah menimpa tautan yang sudah ada dan berbeda
  select count(*) into v_over
  from public.upah_project_link_review r
  join public.upah_projects up on up.id = r.upah_project_id
  where r.status = 'decided'
    and r.decision in ('approved', 'manual')
    and r.master_project_id = v_target
    and up.project_id is not null
    and up.project_id is distinct from r.master_project_id;

  if v_over > 0 then
    raise exception 'STOP: % baris akan MENIMPA tautan lama', v_over;
  end if;

  -- guard 2: pilot harus tepat satu baris
  select count(*) into v_rows
  from public.upah_project_link_review r
  where r.status = 'decided'
    and r.decision in ('approved', 'manual')
    and r.master_project_id = v_target;

  if v_rows <> 1 then
    raise exception 'STOP: pilot harus tepat 1 baris yang disetujui ke [%], ditemukan %', v_kode, v_rows;
  end if;

  select count(*) filter (where project_id is null) into v_before
  from public.upah_projects;

  insert into public.upah_project_link_log
    (upah_project_id, old_project_id, new_project_id, method, actor, batch)
  select up.id, up.project_id, r.master_project_id, r.method, current_user, v_batch
  from public.upah_project_link_review r
  join public.upah_projects up on up.id = r.upah_project_id
  where r.status = 'decided'
    and r.decision in ('approved', 'manual')
    and r.master_project_id = v_target
    and up.project_id is distinct from r.master_project_id;
  get diagnostics v_logged = row_count;

  update public.upah_projects up
     set project_id = r.master_project_id
    from public.upah_project_link_review r
   where up.id = r.upah_project_id
     and r.status = 'decided'
     and r.decision in ('approved', 'manual')
     and r.master_project_id = v_target
     and up.project_id is distinct from r.master_project_id;

  select count(*) filter (where project_id is null) into v_after
  from public.upah_projects;

  if v_before - v_after <> v_logged then
    raise exception 'STOP: verifikasi gagal — belum-terhubung turun %, log %',
      v_before - v_after, v_logged;
  end if;

  update public.upah_project_link_review
     set status = 'applied', updated_at = now()
   where status = 'decided'
     and decision in ('approved', 'manual')
     and master_project_id = v_target;

  select coalesce(up.total_manual, it.total_rincian, 0) into v_total
  from public.upah_projects up
  left join (select project_id, sum(upah_rincian) as total_rincian
               from public.upah_items group by project_id) it on it.project_id = up.id
  where up.id = (select upah_project_id from public.upah_project_link_review
                  where master_project_id = v_target and status = 'applied' limit 1);

  raise notice 'PILOT OK: [%] % — % baris ditautkan, total upah baris itu = %',
    v_kode, v_nama, v_logged, v_total;
end $$;

-- 7b. Bukti pilot: baris yang baru tertaut + totalnya
select p.kode, p.name as master, up.project_name as nama_snapshot,
       coalesce(up.total_manual, it.total_rincian, 0) as total_upah,
       up.project_id, up.updated_at
from public.upah_projects up
join public.projects p on p.id = up.project_id
left join (select project_id, sum(upah_rincian) as total_rincian
             from public.upah_items group by project_id) it on it.project_id = up.id
where p.kode = '83';

-- 7c. Log batch pilot (harus 1 baris)
select * from public.upah_project_link_log where batch = 'pilot-83-20261026';

-- 7d. Rekonsiliasi angka setelah pilot (selisih HARUS 0)
with per_proyek as (
  select up.id, up.project_id,
         coalesce(up.total_manual, it.total_rincian, 0) as total
  from public.upah_projects up
  left join (select project_id, sum(upah_rincian) as total_rincian
               from public.upah_items group by project_id) it
         on it.project_id = up.id
)
select sum(total)                                              as total_modul,
       sum(total) filter (where project_id is not null)         as terhubung,
       sum(total) filter (where project_id is null)             as belum_terhubung,
       sum(total)
         - sum(total) filter (where project_id is not null)
         - sum(total) filter (where project_id is null)         as selisih
from per_proyek;

-- 7e. Hitungan baris: belum-terhubung harus turun TEPAT 1 dari sebelumnya
select count(*) filter (where project_id is null)     as belum_terhubung,
       count(*) filter (where project_id is not null) as terhubung
from public.upah_projects;
```

**Hasil yang diharapkan.**
- `NOTICE: PILOT OK: [83] Josh - Mabes — 1 baris ditautkan, total upah baris itu = 9230000`
- 7b: **1 baris** dengan `kode = 83`, `total_upah = 9230000`, `project_id` terisi.
- 7c: **1 baris** log dengan `batch = 'pilot-83-20261026'`, `old_project_id` kosong.
- 7d: rekonsiliasi `selisih = 0`; 7e: `belum_terhubung` turun tepat 1 (snapshot: 57 → 56,
  `terhubung` = 1).
- Checklist UI (Lampiran L5, bagian "Modul Upah & Kasbon"), minimal:
  - buka proyek 83 → badge berubah dari "Belum terhubung" menjadi `[83] Josh - Mabes · ON_GOING`;
  - edit proyek 83 → selector menunjukkan Project ID terpilih → simpan → **reload** → tautan tetap;
  - jumlah item & total proyek 83 **tidak berubah** (9.230.000);
  - proyek lain **tetap** "Belum terhubung".

**Kalau gagal.**
- `STOP: pilot harus tepat 1 baris …` → jumlah baris yang disetujui ke master 83 bukan 1.
  Cek `select * from public.upah_project_link_review where master_kode='83';` — biasanya ada
  baris lain yang ikut ter-approve, atau baris 83 belum diputuskan.
- `STOP: … akan MENIMPA tautan lama` → baris itu sudah punya `project_id` lain (mungkin pernah
  ditautkan manual). **Jangan paksa.** Laporkan; kalau memang harus diganti, lakukan satu baris
  lewat UI modul, bukan lewat runbook ini.
- Total ≠ 9.230.000 → **STOP**. Artinya baris live bukan proyek yang sama dengan snapshot
  (nominal berubah / nama proyek dipakai proyek lain). Kirim angka yang muncul ke Brooklyn/DAT.
- Rekonsiliasi ≠ 0 → rollback pilot: jalankan A6 dengan `v_batch := 'pilot-83-20261026'`.
- Tautan tidak muncul di UI setelah reload → cek `select project_id from public.upah_projects where id = …;`
  Kalau kolomnya terisi tetapi UI tidak menampilkan, itu masalah tampilan (bukan data) —
  laporkan, jangan mengulang STEP 7.

---

## STEP 8 — Batch: terapkan semua keputusan (A5 penuh)

**Tujuan.** Menulis `project_id` untuk semua baris yang sudah diputuskan (29 `kode` +
2 `kode_nama_beda` + 6 `kode_kembar` pilihan DAT, ditambah baris `manual` lain bila ada).

```sql
-- ============================================================
-- STEP 8 — BATCH: terapkan semua baris yang sudah diputuskan
-- Tujuan: menulis project_id untuk seluruh baris approved/manual.
-- Sifat : MENULIS upah_projects.project_id + log. Tidak menyentuh
--         upah_items / upah_kasbon / upah_totalan* / projects.
-- Aman diulang: baris yang sudah tertaut ke tujuan yang sama dilewati.
-- ============================================================

do $$
declare
  v_batch  text := 'mapping-20261026';
  v_rows   int;
  v_logged int;
  v_before int;
  v_after  int;
  v_over   int;
  v_nolink int;
begin
  -- guard 1: keputusan "approved/manual" tanpa tujuan = tidak boleh diterapkan diam-diam
  select count(*) into v_nolink
  from public.upah_project_link_review
  where status = 'decided'
    and decision in ('approved', 'manual')
    and master_project_id is null;

  if v_nolink > 0 then
    raise exception 'STOP: % baris approved/manual tanpa master_project_id — lengkapi dulu di STEP 6', v_nolink;
  end if;

  -- guard 2: jangan pernah menimpa tautan lama yang berbeda
  select count(*) into v_over
  from public.upah_project_link_review r
  join public.upah_projects up on up.id = r.upah_project_id
  where r.status = 'decided'
    and r.decision in ('approved', 'manual')
    and r.master_project_id is not null
    and up.project_id is not null
    and up.project_id is distinct from r.master_project_id;

  if v_over > 0 then
    raise exception 'STOP: % baris akan MENIMPA tautan lama', v_over;
  end if;

  -- guard 3: tidak boleh ada sisa yang belum diputuskan
  select count(*) into v_rows
  from public.upah_project_link_review
  where decision is null;

  if v_rows > 0 then
    raise exception 'STOP: % baris belum punya decision (lihat STEP 6)', v_rows;
  end if;

  select count(*) filter (where project_id is null) into v_before
  from public.upah_projects;

  insert into public.upah_project_link_log
    (upah_project_id, old_project_id, new_project_id, method, actor, batch)
  select up.id, up.project_id, r.master_project_id, r.method, current_user, v_batch
  from public.upah_project_link_review r
  join public.upah_projects up on up.id = r.upah_project_id
  where r.status = 'decided'
    and r.decision in ('approved', 'manual')
    and r.master_project_id is not null
    and up.project_id is distinct from r.master_project_id;
  get diagnostics v_logged = row_count;

  update public.upah_projects up
     set project_id = r.master_project_id
    from public.upah_project_link_review r
   where up.id = r.upah_project_id
     and r.status = 'decided'
     and r.decision in ('approved', 'manual')
     and r.master_project_id is not null
     and up.project_id is distinct from r.master_project_id;

  select count(*) filter (where project_id is null) into v_after
  from public.upah_projects;

  if v_before - v_after <> v_logged then
    raise exception 'STOP: verifikasi gagal — belum-terhubung turun %, log %',
      v_before - v_after, v_logged;
  end if;

  update public.upah_project_link_review
     set status = 'applied', updated_at = now()
   where status = 'decided'
     and decision in ('approved', 'manual')
     and master_project_id is not null;

  raise notice 'BATCH %: % tautan ditulis. belum-terhubung % -> %',
    v_batch, v_logged, v_before, v_after;
end $$;

-- 8b. Ringkasan hasil per batch
select batch, count(*) as baris, min(at) as mulai, max(at) as selesai
from public.upah_project_link_log
group by batch
order by mulai;
```

**Hasil yang diharapkan.**
- `NOTICE: BATCH mapping-20261026: 36 tautan ditulis. belum-terhubung 56 -> 20`
  (36 karena pilot sudah menulis 1; total tertaut = **37**, sisa **20**).
  Kalau DAT menolak sebagian baris, angkanya menyesuaikan — yang wajib benar:
  **belum-terhubung turun tepat sebanyak baris di log batch**, dan total tertaut =
  jumlah baris `applied` di STEP 9 V2.
- 8b: dua baris batch — `pilot-83-20261026` (1 baris) dan `mapping-20261026` (36 baris).

**Kalau gagal.**
- `STOP: … baris belum punya decision` → kembali ke STEP 6.
- `STOP: … baris approved/manual tanpa master_project_id` → ada keputusan tanpa tujuan.
  Lengkapi `master_project_id` (template T6.5b) atau ubah jadi `rejected`.
- `STOP: … akan MENIMPA tautan lama` → **tidak ada** yang ditulis (seluruh blok batal).
  Artinya ada baris yang sudah punya tautan berbeda. Bandingkan dengan A1c; laporkan sebelum
  memutuskan apa pun.
- `STOP: verifikasi gagal — belum-terhubung turun X, log Y` → jumlah tautan baru tidak sama
  dengan jumlah log. Tidak ada yang ditulis (satu transaksi). Laporkan angkanya.

---

## STEP 9 — Verifikasi penuh (A8)

**Tujuan.** Membuktikan angka modul tidak berubah dan semua tautan sah.

```sql
-- ============================================================
-- STEP 9 — VERIFIKASI (READ-ONLY)
-- Tujuan: membuktikan angka modul tidak berubah dan tautan lengkap.
-- Sifat : hanya membaca. Kalau ada yang tidak lulus -> A6 (rollback).
-- ============================================================

-- V1. Rekonsiliasi: total modul = terhubung + belum terhubung (selisih HARUS 0)
with per_proyek as (
  select up.id, up.project_id,
         coalesce(up.total_manual, it.total_rincian, 0) as total
  from public.upah_projects up
  left join (select project_id, sum(upah_rincian) as total_rincian
               from public.upah_items group by project_id) it
         on it.project_id = up.id
)
select sum(total)                                              as total_modul,
       sum(total) filter (where project_id is not null)         as terhubung,
       sum(total) filter (where project_id is null)             as belum_terhubung,
       sum(total)
         - sum(total) filter (where project_id is not null)
         - sum(total) filter (where project_id is null)         as selisih
from per_proyek;

-- V2. Jumlah baris & tautan (harus: total 57, terhubung = jumlah baris applied)
select count(*)                                        as total,
       count(*) filter (where project_id is null)       as belum_terhubung,
       count(*) filter (where project_id is not null)   as terhubung
from public.upah_projects;

select status, decision, count(*) as jumlah
from public.upah_project_link_review
group by 1, 2
order by 1, 2;

-- V3. Orphan (harus 0)
select count(*) as orphan
from public.upah_projects up
left join public.projects p on p.id = up.project_id
where up.project_id is not null and p.id is null;

-- V4. Satu master dipakai beberapa proyek upah (laporan, bukan error)
select p.kode, p.name, count(*) as jumlah,
       string_agg(up.project_name, ' | ' order by up.project_name) as proyek_upah
from public.upah_projects up
join public.projects p on p.id = up.project_id
group by p.kode, p.name
having count(*) > 1
order by 3 desc, 1;

-- V5. Proyek yang ikut totalan FINAL (dikunci) — hanya laporan
select p.kode, up.project_name, tt.no_totalan, tt.tanggal, tt.status
from public.upah_totalan_projects tp
join public.upah_projects up on up.id = tp.project_id
join public.upah_totalan tt on tt.id = tp.totalan_id
left join public.projects p on p.id = up.project_id
where tt.final = true
order by tt.tanggal desc;

-- V6. Angka kontrol STEP 0 vs sekarang (semua selisih HARUS 0)
with c as (
  select * from public.upah_mapping_control order by id desc limit 1
),
live as (
  select count(*) as jumlah_proyek,
         (select count(*) from public.upah_items) as jumlah_item,
         (select coalesce(sum(upah_rincian), 0) from public.upah_items) as total_rincian,
         (select coalesce(sum(total_manual), 0) from public.upah_projects) as total_manual,
         (select coalesce(sum(coalesce(up.total_manual, it.total_rincian, 0)), 0)
            from public.upah_projects up
            left join (select project_id, sum(upah_rincian) as total_rincian
                         from public.upah_items group by project_id) it
                   on it.project_id = up.id) as total_hak,
         (select count(*) from public.upah_kasbon) as jumlah_kasbon,
         (select coalesce(sum(nominal), 0) from public.upah_kasbon) as total_kasbon,
         (select count(*) from public.upah_totalan) as jumlah_totalan,
         (select coalesce(sum(pembayaran_aktual), 0) from public.upah_totalan) as total_pembayaran
  from public.upah_projects
)
select 'jumlah_proyek' as item, c.jumlah_proyek::numeric as kontrol, live.jumlah_proyek::numeric as sekarang,
       live.jumlah_proyek::numeric - c.jumlah_proyek::numeric as selisih from c, live
union all select 'jumlah_item', c.jumlah_item, live.jumlah_item, live.jumlah_item - c.jumlah_item from c, live
union all select 'total_rincian', c.total_rincian, live.total_rincian, live.total_rincian - c.total_rincian from c, live
union all select 'total_manual', c.total_manual, live.total_manual, live.total_manual - c.total_manual from c, live
union all select 'total_hak', c.total_hak, live.total_hak, live.total_hak - c.total_hak from c, live
union all select 'jumlah_kasbon', c.jumlah_kasbon, live.jumlah_kasbon, live.jumlah_kasbon - c.jumlah_kasbon from c, live
union all select 'total_kasbon', c.total_kasbon, live.total_kasbon, live.total_kasbon - c.total_kasbon from c, live
union all select 'jumlah_totalan', c.jumlah_totalan, live.jumlah_totalan, live.jumlah_totalan - c.jumlah_totalan from c, live
union all select 'total_pembayaran', c.total_pembayaran, live.total_pembayaran, live.total_pembayaran - c.total_pembayaran from c, live;

-- V7. Baris yang masih "Belum terhubung" (harus = yang DAT tolak/biarkan)
select t.kode as tukang, up.project_name, r.method, r.decision, r.note
from public.upah_projects up
join public.upah_tukang t on t.id = up.tukang_id
left join public.upah_project_link_review r on r.upah_project_id = up.id
where up.project_id is null
order by 1, 2;
```

**Kriteria lulus.**

| Cek | Lulus kalau |
|---|---|
| V1 rekonsiliasi | `selisih = 0` (total modul = terhubung + belum terhubung) |
| V2 jumlah baris | `total` = jumlah baris live (snapshot 57); `terhubung` = jumlah baris `applied` |
| V2 status | `applied/approved` 31, `applied/manual` 6, `decided/rejected` 20 (angka mengikuti keputusan DAT) |
| V3 orphan | **0** |
| V4 satu master beberapa proyek upah | laporan (bukan error). Snapshot: **75** dipakai 2 baris (`Cove 2 - 27`, `Project Cove 2 - 27`) — sah, dua fase |
| V5 totalan final | laporan proyek yang ikut totalan terkunci (snapshot: 83 di `T-001`) |
| V6 angka kontrol | **semua selisih = 0** untuk 9 item: jumlah proyek, jumlah item, total rincian, total manual, total hak, jumlah kasbon, nominal kasbon, jumlah totalan, total pembayaran |
| V7 sisa belum terhubung | daftar baris + alasan keputusannya (harus cocok dengan keputusan DAT) |

**Kalau gagal.**
- V1 ≠ 0 → ada baris yang hilang/tergandakan. **Rollback** (A6) lalu laporkan; jangan
  memperbaiki manual.
- V3 > 0 → ada tautan ke master yang tidak ada. Rollback.
- V6 ada selisih ≠ 0 → ada perubahan di luar mapping (mis. admin mengedit saat proses).
  **Rollback** lalu selidiki penyebabnya — bukan diabaikan.
- V2 `terhubung` ≠ jumlah `applied` → jalankan A6 (rollback) karena log dan tabel tidak
  sinkron.

---

## STEP 10 — View Project Finance (A7)

**Tujuan.** Menyediakan angka upah/kasbon per master untuk blok "Upah tercatat" di Project
Finance. Dijalankan **setelah** backfill, karena view ini membaca `project_id` yang sudah terisi.

> Migrasi STEP 2 hanya membuat 2 view dasar (`v_upah_project_actual`,
> `v_upah_project_unlinked`). Empat view di bawah ini **belum** ada dan dibuat di sini.

```sql
-- ============================================================
-- STEP 10 — VIEW PROJECT FINANCE (A7)
-- Tujuan: menyediakan angka upah/kasbon per master project untuk
--         blok "Upah tercatat" di Project Finance.
-- Sifat : DDL aditif (view). Tidak menulis/mengubah data.
-- Aman diulang: create or replace.
-- ============================================================

-- 1) Kasbon -> master project, HANYA bila totalan pemotongnya menyentuh
--    tepat satu master dan tidak ada proyek belum tertaut.
create or replace view public.v_upah_kasbon_allocation
with (security_invoker = true) as
with scope as (
  select tk.id as totalan_kasbon_id, tk.kasbon_id, tk.totalan_id, tk.nominal,
         count(distinct up.project_id) filter (where up.project_id is not null) as n_master,
         count(*) filter (where up.project_id is null) as n_tanpa_tautan,
         (array_agg(distinct up.project_id) filter (where up.project_id is not null))[1] as master_id
  from public.upah_totalan_kasbon tk
  left join public.upah_totalan_projects tp on tp.totalan_id = tk.totalan_id
  left join public.upah_projects up on up.id = tp.project_id
  group by tk.id, tk.kasbon_id, tk.totalan_id, tk.nominal
)
select totalan_kasbon_id, kasbon_id, totalan_id, nominal,
       case when n_master = 1 and n_tanpa_tautan = 0 then master_id end as master_project_id,
       case when n_master = 1 and n_tanpa_tautan = 0 then 'per_proyek'
            when n_master = 0 then 'tanpa_proyek_tertaut'
            else 'lintas_proyek' end as cakupan
from scope;

-- 2) Pembayaran per totalan (aturan atribusi sama)
create or replace view public.v_upah_totalan_allocation
with (security_invoker = true) as
with scope as (
  select tt.id as totalan_id, tt.no_totalan, tt.pembayaran_aktual,
         count(distinct up.project_id) filter (where up.project_id is not null) as n_master,
         count(*) filter (where up.project_id is null) as n_tanpa_tautan,
         (array_agg(distinct up.project_id) filter (where up.project_id is not null))[1] as master_id
  from public.upah_totalan tt
  left join public.upah_totalan_projects tp on tp.totalan_id = tt.id
  left join public.upah_projects up on up.id = tp.project_id
  group by tt.id, tt.no_totalan, tt.pembayaran_aktual
)
select totalan_id, no_totalan, pembayaran_aktual,
       case when n_master = 1 and n_tanpa_tautan = 0 then master_id end as master_project_id,
       case when n_master = 1 and n_tanpa_tautan = 0 then 'per_proyek'
            when n_master = 0 then 'tanpa_proyek_tertaut'
            else 'lintas_proyek' end as cakupan
from scope;

-- 3) Ringkasan per master (dipakai Project Finance)
create or replace view public.v_upah_project_finance
with (security_invoker = true) as
with hak as (
  select master_project_id, jumlah_proyek_upah, jumlah_tukang, total_upah_aktual
  from public.v_upah_project_actual
),
kasbon as (
  select master_project_id, sum(nominal) as kasbon_teralokasi, count(*) as jumlah_kasbon
  from public.v_upah_kasbon_allocation
  where master_project_id is not null
  group by master_project_id
),
bayar as (
  select master_project_id, sum(pembayaran_aktual) as pembayaran_teralokasi, count(*) as jumlah_totalan
  from public.v_upah_totalan_allocation
  where master_project_id is not null
  group by master_project_id
),
lintas as (
  select up.project_id as master_project_id,
         count(*) filter (where a.cakupan <> 'per_proyek') as jumlah_totalan_lintas
  from public.upah_totalan_projects tp
  join public.upah_projects up on up.id = tp.project_id
  join public.v_upah_totalan_allocation a on a.totalan_id = tp.totalan_id
  where up.project_id is not null
  group by up.project_id
)
select p.id as master_project_id, p.kode, p.name, p.status,
       h.jumlah_proyek_upah, h.jumlah_tukang, h.total_upah_aktual,
       k.kasbon_teralokasi, k.jumlah_kasbon,
       b.pembayaran_teralokasi, b.jumlah_totalan,
       coalesce(l.jumlah_totalan_lintas, 0) as jumlah_totalan_lintas,
       case when h.total_upah_aktual is null then null
            when coalesce(l.jumlah_totalan_lintas, 0) > 0 then null
            else h.total_upah_aktual - coalesce(k.kasbon_teralokasi, 0)
                                   - coalesce(b.pembayaran_teralokasi, 0)
       end as saldo_upah,
       case when h.total_upah_aktual is null then 'belum_ada_upah'
            when coalesce(l.jumlah_totalan_lintas, 0) > 0 then 'belum_teralokasi'
            else 'lengkap' end as saldo_status
from public.projects p
left join hak    h on h.master_project_id = p.id
left join kasbon k on k.master_project_id = p.id
left join bayar  b on b.master_project_id = p.id
left join lintas l on l.master_project_id = p.id;

-- 4) Kasbon yang belum bisa ditempelkan ke proyek (per tukang).
--    Satu entri kasbon bisa dipotong di >1 totalan -> dijumlah per kasbon
--    dulu supaya tidak terhitung dua kali.
create or replace view public.v_upah_kasbon_unallocated
with (security_invoker = true) as
with alloc as (
  select kasbon_id,
         sum(nominal) filter (where master_project_id is not null) as nominal_per_proyek,
         sum(nominal) filter (where master_project_id is null)     as nominal_belum
  from public.v_upah_kasbon_allocation
  group by kasbon_id
)
select t.kode as tukang_kode, t.nama as tukang_nama,
       sum(k.nominal) filter (where upper(k.jenis) = 'KASBON') as total_kasbon,
       sum(case when upper(k.jenis) = 'KASBON' then coalesce(a.nominal_per_proyek, 0) else 0 end)
         as kasbon_per_proyek,
       sum(case when upper(k.jenis) = 'KASBON'
                then case when a.kasbon_id is null then k.nominal
                          else coalesce(a.nominal_belum, 0) end
                else 0 end)
         as kasbon_belum_teralokasi
from public.upah_tukang t
join public.upah_kasbon k on k.tukang_id = t.id
left join alloc a on a.kasbon_id = k.id
group by t.kode, t.nama;

-- 5) Hak akses: anon tidak boleh, admin (authenticated) boleh
revoke all on public.v_upah_kasbon_allocation   from anon;
revoke all on public.v_upah_totalan_allocation  from anon;
revoke all on public.v_upah_project_finance     from anon;
revoke all on public.v_upah_kasbon_unallocated  from anon;
grant select on public.v_upah_kasbon_allocation  to authenticated;
grant select on public.v_upah_totalan_allocation to authenticated;
grant select on public.v_upah_project_finance    to authenticated;
grant select on public.v_upah_kasbon_unallocated to authenticated;

-- 6) Bukti view terpasang (harus 4 baris)
select viewname
from pg_views
where schemaname = 'public'
  and viewname in ('v_upah_kasbon_allocation', 'v_upah_totalan_allocation',
                   'v_upah_project_finance', 'v_upah_kasbon_unallocated')
order by 1;

-- 7) Isi ringkasan (hanya proyek yang punya upah)
select kode, name, total_upah_aktual, kasbon_teralokasi, pembayaran_teralokasi,
       saldo_upah, saldo_status
from public.v_upah_project_finance
where total_upah_aktual is not null
order by kode;

-- 8) Kasbon di luar proyek
select * from public.v_upah_kasbon_unallocated order by tukang_kode;
```

**Hasil yang diharapkan.**
- 4 view terdaftar: `v_upah_kasbon_allocation`, `v_upah_totalan_allocation`,
  `v_upah_project_finance`, `v_upah_kasbon_unallocated`.
- Isi `v_upah_project_finance`: hanya proyek yang punya upah (snapshot: **36 baris**).
  Proyek 83 tampil `saldo_status = 'belum_teralokasi'` (karena ikut totalan lintas proyek) —
  **itu benar**, bukan error.
- `v_upah_kasbon_unallocated`: `total_kasbon = kasbon_per_proyek + kasbon_belum_teralokasi`
  per tukang. Snapshot uji: Asep 500.000 = 500.000 + 0; Pujon 3.000.000 = 1.000.000 + 2.000.000.
- `anon` tetap tidak bisa membaca view (revoke).

**Kalau gagal.**
- `ERROR: relation "v_upah_project_actual" does not exist` → STEP 2 belum sukses. Ulangi STEP 2.
- `ERROR: syntax error at or near "security_invoker"` → Postgres < 15. Buat view tanpa opsi
  itu, lalu `grant select … to authenticated` (sudah ada di blok). Laporkan versinya.
- Angka `saldo_upah` terlihat aneh → baca `saldo_status`: `belum_ada_upah` = belum ada upah
  tertaut; `belum_teralokasi` = ada totalan lintas proyek sehingga saldo **memang** tidak
  bisa dihitung (NULL, bukan 0). Jangan "memperbaiki" dengan pembagian rata.

---

## Rollback (A6) — kapan dan bagaimana

**Dipakai kalau:** V1 ≠ 0, V3 > 0, V6 ada selisih, atau ada tautan yang jelas salah proyek.

Yang dikembalikan **hanya tautan** (`project_id`), memakai `old_project_id` dari log batch.
Baris, item, kasbon, totalan tidak disentuh. Setelah rollback, status review kembali
`decided` sehingga bisa diperbaiki lalu diterapkan ulang.

```sql
-- ============================================================
-- ROLLBACK (A6) — hanya dipakai kalau STEP 9 tidak lulus
-- Tujuan: mengembalikan project_id ke keadaan sebelum batch tertentu.
-- Sifat : MENULIS upah_projects.project_id (kembali ke old_project_id).
-- KAPAN DIPAKAI:
--   - rekonsiliasi V1 selisih <> 0
--   - ada tautan yang jelas salah proyek
--   - V3 orphan > 0
-- Yang dikembalikan hanya tautan; baris, item, kasbon, totalan tidak disentuh.
-- ============================================================

do $$
declare
  v_batch    text := 'mapping-20261026';   -- ganti 'pilot-83-20261026' untuk membatalkan pilot
  v_restored int;
begin
  with first_log as (
    select distinct on (upah_project_id) upah_project_id, old_project_id
    from public.upah_project_link_log
    where batch = v_batch
    order by upah_project_id, id          -- log paling awal = keadaan sebelum batch
  )
  update public.upah_projects up
     set project_id = l.old_project_id
    from first_log l
   where up.id = l.upah_project_id
     and up.project_id is distinct from l.old_project_id;
  get diagnostics v_restored = row_count;

  update public.upah_project_link_review
     set status = 'decided', updated_at = now()
   where upah_project_id in (
     select upah_project_id from public.upah_project_link_log where batch = v_batch
   );

  raise notice 'ROLLBACK %: % baris dikembalikan ke tautan sebelumnya', v_batch, v_restored;
end $$;

-- Bukti setelah rollback
select count(*)                                        as total,
       count(*) filter (where project_id is null)       as belum_terhubung,
       count(*) filter (where project_id is not null)   as terhubung
from public.upah_projects;
```

**Hasil yang diharapkan.** `ROLLBACK <batch>: N baris dikembalikan`, dan jumlah
`belum_terhubung` kembali seperti sebelum batch (snapshot: 56 setelah membatalkan batch;
57 kalau pilot juga dibatalkan).

**Kalau gagal.** `0 baris dikembalikan` → nama batch salah. Lihat daftar batch:
`select batch, count(*) from public.upah_project_link_log group by 1;`

---

## Lampiran L1 — 57 baris staging (isi INSERT STEP 3)

Sumber: tab `List Proyek` (Asep & Pujon), snapshot 20 Okt 2026. `baris_sheet` = nomor baris
asli di sheet.

| # | Tukang | No (kolom A) | Nama (kolom B) | Total (kolom C) |
|---|---|---|---|---|
| 1 | asep | 99 | Santi - Baroni Utara 1/87 | Rp 10.345.000 |
| 2 | pujon | 49 | Project Intercon | Rp 37.415.000 |
| 3 | pujon | 47 | Project Cosmos | Rp 5.441.500 |
| 4 | pujon | 52 | Project Radio Dalam | Rp 7.940.000 |
| 5 | pujon | 21 | Project Jessie | Rp 6.185.000 |
| 6 | pujon | *(kosong)* | Project Sunter Hijau 8 | Rp 9.028.000 |
| 7 | pujon | 17 | Project Cendana Icon | Rp 300.000 |
| 8 | pujon | 53 | Project Park Serpong | Rp 4.230.000 |
| 9 | pujon | 57 | Project Gatsu | Rp 20.299.800 |
| 10 | pujon | 55 | Project Duren Sawit | Rp 31.741.500 |
| 11 | pujon | 58 | Project Meranti | Rp 9.631.000 |
| 12 | pujon | *(kosong)* | Project Nerin 1 | Rp 25.258.950 |
| 13 | pujon | *(kosong)* | Project Nerin 5 | Rp 22.337.000 |
| 14 | pujon | *(kosong)* | Project Park Serpong - Cendana | Rp 720.000 |
| 15 | pujon | *(kosong)* | Project Rosini - | Rp 550.000 |
| 16 | pujon | *(kosong)* | Service Park Serpong | Rp 1.000.000 |
| 17 | pujon | *(kosong)* | Service Tokyo | Rp 250.000 |
| 18 | pujon | *(kosong)* | Service TA | Rp 1.000.000 |
| 19 | pujon | *(kosong)* | Service Bintaro | Rp 1.500.000 |
| 20 | pujon | *(kosong)* | Project Barbershop | Rp 6.800.000 |
| 21 | pujon | 63 | Project Dulcet | Rp 2.770.000 |
| 22 | pujon | 65 | Project Flaminggo | Rp 5.984.250 |
| 23 | pujon | 66 | Project Casa de Parco | Rp 2.601.500 |
| 24 | pujon | *(kosong)* | Project Sunter Hijau Utama | Rp 6.694.000 |
| 25 | pujon | *(kosong)* | Everbeau | Rp 2.475.000 |
| 26 | pujon | 74 | Cityzen North 3 -17 | Rp 8.884.350 |
| 27 | pujon | 75 | Cove 2 - 27 | Rp 10.421.500 |
| 28 | pujon | 76 | Cove 2 - 76 | Rp 702.000 |
| 29 | pujon | *(kosong)* | Park Serpong 9 - 15 | Rp 3.375.000 |
| 30 | pujon | 79 | Osaka PIK | Rp 11.380.000 |
| 31 | pujon | *(kosong)* | Servis | Rp 2.300.000 |
| 32 | pujon | 78 | Park Serpong Flo 7 -66 | Rp 4.770.000 |
| 33 | pujon | 71 | Barbershop HI - 2 | Rp 9.660.000 |
| 34 | pujon | 72 | Project Apt Baywalk | Rp 3.565.000 |
| 35 | pujon | 70 | Project Cisauk | Rp 4.537.000 |
| 36 | pujon | 69 | Peak Springhill | Rp 6.580.000 |
| 37 | pujon | *(kosong)* | Project Pademangan | Rp 675.000 |
| 38 | pujon | *(kosong)* | Project Barbershop Pintu | Rp 900.000 |
| 39 | pujon | 81 | Project Skyhouse BSD | Rp 11.603.000 |
| 40 | pujon | 80 | Project Charm 23 - 56 | Rp 8.725.000 |
| 41 | pujon | 75 | Project Cove 2 - 27 | Rp 2.425.000 |
| 42 | pujon | *(kosong)* | Cendana Botanic | Rp 2.645.750 |
| 43 | pujon | *(kosong)* | Project Springhill | Rp 950.000 |
| 44 | pujon | *(kosong)* | Servisan 2 | Rp 850.000 |
| 45 | pujon | 88 | Project Bekasi | Rp 2.795.000 |
| 46 | pujon | 92 | Project Panola | Rp 2.225.000 |
| 47 | pujon | 87 | Project Semanan | Rp 21.842.000 |
| 48 | pujon | 85 | Project Rempoa | Rp 18.778.000 |
| 49 | pujon | 95 | Project Barbershop Pekayon | Rp 4.250.000 |
| 50 | pujon | 96 | Project Leo Sunter | Rp 1.363.500 |
| 51 | pujon | 89 | Project Cove 2-21 | Rp 3.425.000 |
| 52 | pujon | 90 | Project Steffi | Rp 5.197.000 |
| 53 | pujon | 83 | Proyek Josh - Mabes | Rp 9.230.000 |
| 54 | pujon | 61 | Proyek Sunter Hijau - Eric | Rp 123.729.000 |
| 55 | pujon | 94 | Project Reivan Trail 10-20 | Rp 7.356.000 |
| 56 | pujon | 91 | Brigitta Cove 12-32 | Rp 10.120.000 |
| 57 | pujon | *(kosong)* | Project Everbeau - kaca | Rp 2.500.000 |

Total: Asep **Rp 10.345.000** (1 baris) + Pujon **Rp 519.911.600** (56 baris) =
**Rp 530.256.600**.

---

## Lampiran L2 — 29 baris yang boleh batch (`method = 'kode'`)

| Tukang | No | Nama di sheet | Master |
|---|---|---|---|
| pujon | 17 | Project Cendana Icon | 17 — 17. Cendana Icon |
| pujon | 21 | Project Jessie | 21 — 21. Jessie - Metland Menteng |
| pujon | 49 | Project Intercon | 49 — 49. Yans - Intercon |
| pujon | 52 | Project Radio Dalam | 52 — 52. Wido - Radio Dalam |
| pujon | 53 | Project Park Serpong | 53 — 53. Calvin - Park Serpong Prive 7 |
| pujon | 55 | Project Duren Sawit | 55 — 55. Andruw - Duren Sawit |
| pujon | 57 | Project Gatsu | 57 — 57. Nisha - Gatsu Office |
| pujon | 58 | Project Meranti | 58 — 58. Iva - Meranti SS |
| pujon | 61 | Proyek Sunter Hijau - Eric | 61 — Eric - Sunter Hijau |
| pujon | 63 | Project Dulcet | 63 — 63. Karina - Dulcet Booth |
| pujon | 66 | Project Casa de Parco | 66 — 66. Judith-Cassa de Parco |
| pujon | 70 | Project Cisauk | 70 — 70. Leon - Citra Garden Serpong Cisauk |
| pujon | 71 | Barbershop HI - 2 | 71 — 71. Andri - Haircules HI |
| pujon | 74 | Cityzen North 3 -17 | 74 — 74. Cityzen North 3-17 - ok |
| pujon | 75 | Cove 2 - 27 | 75 — 75. Cove 2 - 27 - ok |
| pujon | 75 | Project Cove 2 - 27 | 75 — 75. Cove 2 - 27 - ok |
| pujon | 76 | Cove 2 - 76 | 76 — 76. Cove 2 - 76 - ok |
| pujon | 79 | Osaka PIK | 79 — 79. Dima - Osaka PIK |
| pujon | 83 | Proyek Josh - Mabes | 83 — Josh - Mabes |
| pujon | 85 | Project Rempoa | 85 — 85. Yola - Rempoa |
| pujon | 87 | Project Semanan | 87 — 87. Derry - Semanan |
| pujon | 88 | Project Bekasi | 88 — 88. Devina - Dahlia A7 Bekasi |
| pujon | 89 | Project Cove 2-21 | 89 — 89. Eveline - Cove 2 21 |
| pujon | 91 | Brigitta Cove 12-32 | 91 — 91. Brigitta - Cove 12-32 |
| pujon | 92 | Project Panola | 92 — 92. Felin - Panola 17 GS |
| pujon | 94 | Project Reivan Trail 10-20 | 94 — 94. Reivan - XYZ Trail 10/20 |
| pujon | 95 | Project Barbershop Pekayon | 95 — 95. Andri - Barbershop Pekayon |
| pujon | 96 | Project Leo Sunter | 96 — 96. Leo - Sunter |
| asep | 99 | Santi - Baroni Utara 1/87 | 99 — Santi - Baroni Utara 1/87 |

---

## Lampiran L3 — 28 baris keputusan

Sudah dirinci di STEP 5 (tabel A–D). Ringkasnya: 6 kembar, 2 nama beda, 14 tanpa nomor,
6 jasa.

---

## Lampiran L4 — objek database yang dibuat/diubah runbook

| Objek | Jenis | Dibuat di | Isi | Boleh di-drop setelah selesai? |
|---|---|---|---|---|
| `upah_projects.project_id` | kolom + FK + index | STEP 2 | relasi ke master | **jangan** (inti hasil) |
| `v_upah_project_actual`, `v_upah_project_unlinked` | view | STEP 2 | agregasi + daftar kerja | jangan (dipakai aplikasi) |
| `upah_projects_backup_20261026` | tabel | STEP 0 | salinan utuh sebelum proses | boleh, setelah yakin (arsip) |
| `upah_mapping_control` | tabel | STEP 0 | angka kontrol | boleh |
| `upah_mapping_source` | tabel staging | STEP 3 | 57 baris nomor sheet | boleh (arsip) |
| `upah_project_link_review` | tabel | STEP 4 | keputusan per baris | **simpan** (jejak audit) |
| `upah_project_link_log` | tabel | STEP 7 | log per batch (rollback) | **simpan** (jejak audit) |
| `upah_proposal_norm(text)` | fungsi | STEP 4 | normalisasi nama untuk kandidat | boleh |
| 4 view finance | view | STEP 10 | bahan Project Finance | jangan (dipakai UI) |

Tidak ada `DROP`, `TRUNCATE`, atau `DELETE` ke tabel modul di seluruh runbook ini. Satu-satunya
`TRUNCATE` adalah ke `upah_mapping_source` (tabel staging buatan sendiri, di STEP 3).

---

## Lampiran L5 — checklist UI setelah STEP 8

**Modul Upah & Kasbon**

- [ ] Sebelum STEP 8: banner "N proyek Belum terhubung" menampilkan N0. Catat.
- [ ] Setelah STEP 8: N turun **tepat sebanyak** baris yang ditautkan (N0 − N1 = jumlah baris).
- [ ] Buka proyek 83 → badge `[83] Josh - Mabes · ON_GOING` (bukan "Belum terhubung").
- [ ] Edit proyek 83 → selector menunjukkan Project ID terpilih → simpan → **reload** → tetap.
- [ ] Proyek yang di-`rejected` **tetap** "Belum terhubung".
- [ ] Proyek yang namanya persis sama dengan master tetapi tanpa nomor **tetap** "Belum terhubung".
- [ ] Jumlah item & total per proyek tidak berubah (bandingkan dengan V6).

**Project Finance** (setelah tiket UI dikerjakan — lihat `docs/mapping-project-finance-ui-spec.md`)

- [ ] Pilih 83 → blok "Upah tercatat" muncul, hak = total proyek di modul Upah.
- [ ] Proyek tanpa upah → "belum ada upah tercatat", **bukan Rp 0**.
- [ ] Proyek dengan totalan lintas proyek → saldo "belum bisa dihitung", bukan angka.
- [ ] Margin (Gross Profit) **tidak berubah** (masih memakai estimasi WBS).
- [ ] Footer "kasbon belum teralokasi" ≤ total kasbon tukang.

**Keamanan**

- [ ] `GET /rest/v1/upah_projects` dengan anon key tetap **401**.
- [ ] Login admin tetap bisa membaca modul.

---

## Lampiran L6 — bukti uji (lokal, bukan Supabase)

Runbook ini dijalankan berurutan pada **PostgreSQL 16.15 lokal** dengan fixture: 96 baris
master hasil tarikan REST hari ini + 57 baris snapshot + 56 item + 3 kasbon + 3 totalan
(termasuk satu totalan lintas proyek dan satu totalan final).

| # | Uji | Hasil |
|---|---|---|
| 1 | A0 backup + kontrol | ✅ tabel backup + 1 baris kontrol (57 proyek, 56 item, hak 530.256.600) |
| 2 | A1a–A1g | ✅ 7 tabel modul, 0 orphan, 96 master, 0 kode ganda |
| 3 | STEP 2 migrasi | ✅ kolom + FK `convalidated` + index + 2 view; dijalankan **2×** tanpa error |
| 4 | A2 + A2c | ✅ 57 baris (37 bernomor / 20 tanpa), A2c.2/A2c.3 = 0, A2c.4 selisih 0 |
| 5 | A3b | ✅ 29 `kode`, 6 `kode_kembar`, 2 `kode_nama_beda`, 14 `tanpa_kandidat`, 6 `non_proyek` |
| 6 | Klasifikasi ulang (Python, independen) | ✅ **0 perbedaan** dengan hasil SQL |
| 7 | A3c daftar keputusan | ✅ 28 baris: 6 / 2 / 14 / 6, tidak ada kelas E |
| 8 | A4 keputusan | ✅ approved 31, manual 6, rejected 20, `(belum)` 0 |
| 9 | A5 pilot 83 | ✅ 1 baris, total **9.230.000**, log 1 baris |
| 10 | A5 batch | ✅ 36 tautan, belum-terhubung 56 → 20 (total tertaut 37) |
| 11 | A8 V1 | ✅ `selisih = 0` (total 530.256.600 = 438.447.900 + 91.808.700) |
| 12 | A8 V6 | ✅ 9 item kontrol, semua selisih 0 |
| 13 | A8 V3 orphan | ✅ 0 |
| 14 | A7 views | ✅ 4 view; 36 baris finance; kasbon belum teralokasi 2.000.000 (Pujon) |
| 15 | Guard "belum diputuskan" | ✅ batch menolak: `STOP: 14 baris belum punya decision` |
| 16 | Guard "tepat 1 baris" (pilot) | ✅ menolak saat 0 baris |
| 17 | Guard "menimpa tautan lama" | ✅ menolak: `STOP: 1 baris akan MENIMPA tautan lama` |
| 18 | A6 rollback | ✅ 36 baris kembali NULL (terhubung 37 → 1), lalu batch diulang → 37 lagi |
| 19 | Idempotensi batch | ✅ dijalankan ulang: 0 tautan baru, angka tetap |

Yang **tidak** bisa diuji lokal: RLS Supabase (anon 401), perilaku `security_invoker` dengan
policy admin-only, dan angka `upah_projects` yang sebenarnya. Ketiganya diverifikasi di live
oleh STEP 1, STEP 3, dan Lampiran L5.

---

## Lampiran L7 — bersih-bersih setelah semuanya selesai (opsional)

```sql
-- tabel staging & helper tidak dipakai aplikasi.
-- review + log SEBAIKNYA DISIMPAN sebagai jejak audit.
-- drop function if exists public.upah_proposal_norm(text);
-- drop table if exists public.upah_mapping_source;
-- drop table if exists public.upah_mapping_control;
-- drop table if exists public.upah_projects_backup_20261026;   -- setelah yakin
```

---

## Lampiran L8 — kalau DAT ingin mengulang dari nol

Urutan aman untuk mengulang (tanpa kehilangan data modul):

1. Rollback tautan: A6 dengan batch `mapping-20261026` lalu `pilot-83-20261026`.
2. `delete from public.upah_project_link_review;` (hanya tabel kerja; `upah_projects` tidak disentuh)
3. Ulangi STEP 3 → STEP 9.

Kalau hanya ingin mengulang **keputusan** (tanpa membatalkan tautan):
`update public.upah_project_link_review set decision=null, status='suggested', decided_by=null, decided_at=null where status='decided';`
lalu ulangi STEP 6.
