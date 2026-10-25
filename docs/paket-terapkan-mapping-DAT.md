# Paket Terapkan Mapping Upah → Project ID — SQL siap-paste (keputusan FINAL DAT)

Kartu: `t_d72b0ef7` · Branch: `feat/mapping-exec` · Basis: `b9ca327` (runbook `t_2ded4a16`)
Pemilik eksekusi: **DAT** (Supabase SQL Editor) · Penyusun: Bamboo
Sumber keputusan: `mapping-keputusan-upah-project-id.xlsx` (57 baris) **+ konfirmasi DAT 26 Okt**
yang merevisi 5 baris (lihat §1.5).

| Item | Nilai |
|---|---|
| Status paket | **SIAP PASTE — BELUM DIJALANKAN.** Tidak ada satu pun SQL di dokumen ini yang sudah dijalankan ke Supabase oleh agen. |
| Sifat pekerjaan | Hanya dokumen + SQL di repo git. Tidak ada koneksi DB, tidak ada tulis data, tidak ada perubahan staging. |
| Target hasil | **45 tautan**, **6 baris NULL** (TUNDA), **6 baris non-proyek**, **3 master baru** (`73A`, `73B`, `90B`) |
| Waktu eksekusi | ±45 menit (termasuk freeze & verifikasi) |
| Rollback | `PASTE R` — mengembalikan seluruh tautan dari log, tanpa menyentuh baris/angka modul |

---

## 0. Baca ini dulu (3 menit)

### 0.1 Siapa menjalankan apa

DAT menyalin **satu PASTE per langkah** ke Supabase SQL Editor, berurutan 1 → 7. Setiap PASTE
punya tiga bagian: **tujuan**, **SQL**, dan **hasil yang diharapkan**. Kalau hasilnya tidak
sama dengan yang tertulis, **berhenti** — jangan "dibetulkan" dengan mengubah SQL.

Agen (Bamboo) **tidak** mengeksekusi apa pun. Dokumen ini adalah paket yang sudah diuji ulang
di PostgreSQL 16.15 lokal dengan fixture 96 master + 57 baris upah (bukti: Lampiran E).

### 0.2 Angka target (hafalkan empat angka ini)

| Kelompok | Jumlah | Perlakuan | Akibat di `upah_projects.project_id` |
|---|---|---|---|
| A — otomatis cocok | **29** | `approved` → kode masing-masing | tertaut |
| B — nomor kembar | **6** | `approved` → `69a, 72a, 78a, 80a, 81a, 90` | tertaut |
| C — nama beda | **2** | #3 → `47` (approved) · #22 → **NULL** (65 ditolak) | 1 tertaut, 1 NULL |
| D — tanpa nomor | **14** | 6 tautan langsung + 3 lewat master baru + 5 NULL | 9 tertaut, 5 NULL |
| E — jasa | **6** | `rejected` (non-proyek) | tidak ditautkan |
| **Total** | **57** | | **45 tertaut · 12 belum terhubung** |

Angka yang dipakai sebagai gerbang di SQL:

| Angka | Arti | Muncul di |
|---|---|---|
| **29 / 6 / 2 / 14 / 6** | kelas antrian (kode / kembar / nama beda / tanpa nomor / jasa) | PASTE 3e & gerbang PASTE 4.1 |
| **42 / 3 / 6 / 6** | keputusan: tautan langsung / menunggu master baru / dibiarkan NULL / non-proyek | PASTE 4.3 & 4.10 |
| **45** | total tautan yang ditulis batch | PASTE 5.4, 6, 7 |
| **12** | sisa "Belum terhubung" setelah selesai (6 TUNDA + 6 jasa) | PASTE 6.4, 7 |

### 0.3 Freeze ±45 menit — wajib, bukan saran

Kirim ke admin sebelum PASTE 1 (sesuaikan bahasanya):

> Selama ±45 menit ke depan, **jangan menambah / mengedit / menghapus** apa pun di modul
> **Upah & Kasbon** (proyek upah, rincian upah, kasbon, totalan) dan di modul **Projects**.
> Kami sedang menautkan proyek upah lama ke Project ID. Membaca/melihat tidak masalah.
> Saya kabari lagi kalau sudah selesai.

Yang boleh berjalan: modul lain (Pembelian, Penjualan, Finance baca).
Yang ditahan: input upah, edit/hapus proyek upah, kasbon, totalan, tambah/ubah master `projects`.

Alasannya: guard di SQL hanya melindungi baris yang **sudah** punya tautan. Kalau admin
menambah/mengedit proyek upah di tengah proses, jumlah baris berubah dan gerbang angka
(45/12) tidak lagi cocok — proses akan berhenti di tengah dengan pesan STOP.

Selesai = PASTE 7 lulus (atau PASTE R selesai). Setelah itu kabari admin bahwa modul bebas dipakai.

### 0.4 Tiga hal yang paling perlu diperhatikan

1. **Jangan lompati PASTE 5.** PASTE 4 mencatat 3 baris sebagai "menunggu master baru"
   (`73A`, `73B`, `90B`) tanpa UUID. Kalau PASTE 5 dilewati, PASTE 6 akan berhenti dengan
   `baris siap tulis = 42, seharusnya 45` — itu **bukan** kerusakan, itu guard yang bekerja.
2. **Angka 29/6/2/14/6 berasal dari snapshot 20 Okt.** Kalau data live berbeda (ada proyek
   baru, nama berubah, nominal berubah), PASTE 4 berhenti sendiri di gerbang 4.1. **Jangan**
   mengubah angka di SQL agar lolos — hentikan proses dan laporkan ke Brooklyn/DAT.
3. **Pilot `[83] Josh - Mabes` = Rp 9.230.000.** Angka ini diperiksa **sebelum** menulis
   (PASTE 6.1a) dan **sesudah** menulis (PASTE 7c). Kalau berbeda, baris live bukan proyek yang
   sama dengan snapshot → STOP, jangan batch.

Tambahan yang sering ditanyakan: setelah selesai, badge "Belum terhubung" **tidak** menjadi 0.
Yang benar adalah **12** = 6 baris TUNDA (#14, #15, #22, #29, #37, #43) + 6 baris jasa.
Itu hasil yang sah, bukan kegagalan.

### 0.5 Urutan paste

| PASTE | Isi | Menulis? | Gerbang |
|---|---|---|---|
| 1 | Backup `upah_projects_backup_20261026` + `upah_mapping_control` + diagnostik A1a–A1g | ya (tabel baru) | ada kriteria lulus yang gagal |
| 2 | Migrasi `2026-10-25_upah_projects_project_id.DRAFT.sql` (idempotent) | DDL aditif | error / rollback |
| 3 | `upah_mapping_source` (57 baris) + `upah_project_link_review` + antrian usulan | ya (tabel kerja) | kelas ≠ 29/6/2/14/6 |
| 4 | Catat 57 keputusan DAT (42+3+6+6) | ya (tabel review) | salah satu dari 4 gerbang |
| 5 | Buat 3 master baru + tautkan #25/#57/#42 | ya (3 baris `projects`) | kode tidak unik |
| 6 | Batch 45 tautan + log audit | ya (`upah_projects.project_id`) | guard 0–3 / verifikasi |
| 7 | Verifikasi A8 + view A7 + pilot `[83]` | DDL view | ada `false` di lembar lulus |
| R | Rollback (hanya kalau perlu) | ya (kembalikan tautan) | — |

### 0.6 Aturan umum saat menyalin

- **Satu PASTE = satu kali klik Run.** Jangan memotong blok di tengah, jangan menjalankan
  dua PASTE sekaligus.
- PASTE 4, 5, 6, R dibungkus `begin; … commit;`. Kalau ada satu statement gagal, **seluruh
  PASTE batal** (tidak ada yang setengah jadi). Baca pesan errornya, jangan diulang membabi buta.
- Pesan `NOTICE: … already exists, skipping` **bukan** error — itu tanda PASTE diulang dan aman.
- Jangan mengubah nilai apa pun di dalam SQL (kode, nama, angka gerbang). Kalau ada yang
  terasa salah, itu justru yang harus dilaporkan.

### 0.7 Kalau ada yang gagal

1. **Stop.** Jangan lanjut ke PASTE berikutnya.
2. Screenshot / copy **teks error lengkap** + hasil query terakhir.
3. Catat: PASTE ke berapa, nama blok (mis. `PASTE 4.5`), dan angka yang muncul.
4. Laporkan ke Brooklyn/DAT. Kalau sudah terlanjur menulis (PASTE 6 selesai tapi PASTE 7
   tidak lulus), jalankan **PASTE R** dulu supaya modul kembali ke keadaan awal.

---

## 1. Keputusan FINAL DAT yang mengikat

### 1.1 Tautkan (45 baris)

| Sumber keputusan | Baris | Target |
|---|---|---|
| A — otomatis cocok (29) | #1, #2, #4, #5, #7–#11, #21, #23, #26–#28, #30, #33, #35, #41, #45–#51, #53–#56 | kode di kolom `KODE` Excel (`99, 49, 52, 21, 17, 53, 57, 55, 58, 63, 66, 74, 75, 76, 79, 71, 70, 88, 92, 87, 85, 95, 96, 89, 83, 61, 94, 91` + `75` untuk baris kedua) |
| B — kembar (6) | #32, #34, #36, #39, #40, #52 | `78a`, `72a`, `69a`, `81a`, `80a`, `90` |
| C — nama beda (1) | #3 `Project Cosmos` | `47` (Kalvina - Kedoya) — DAT setuju nomor |
| D — ganti tujuan (6) | #6 `Project Sunter Hijau 8` | `54` (Windy - Sunter Hijau) |
| | #12 `Project Nerin 1` | `59` (Robby - Giantara Serpong City) |
| | #13 `Project Nerin 5` | `60` (Juli - Giantara Serpong) |
| | #20 `Project Barbershop` | `95` (Andri - Barbershop Pekayon) — master 95 dipakai 2 baris upah, **sah** |
| | #24 `Project Sunter Hijau Utama` | `68` (Ko Tepen - Sunter) |
| | #38 `Project Barbershop Pintu` | `64` (Andri - Barbershop) — **keputusan DAT 26 Okt** |
| D — lewat master baru (3) | #25 `Everbeau` | `73B` (dibuat di PASTE 5) |
| | #57 `Project Everbeau - kaca` | `73A` (dibuat di PASTE 5) |
| | #42 `Cendana Botanic` | `90B` (dibuat di PASTE 5) — **keputusan DAT 26 Okt** |

### 1.2 Master baru yang dibuat (3 baris, `projects`)

| Kode | Nama awal | Status | Catatan |
|---|---|---|---|
| `73A` | `73A. Everbeau - kaca` | `ON_GOING` | DAT boleh mengubah nama/status kapan pun di modul Projects |
| `73B` | `73B. Everbeau` | `ON_GOING` | idem |
| `90B` | `90B. Cendana Botanic` | `ON_GOING` | idem — **bukan** `90a` (90a = Cendana Botanic - Breeze 7-32, sudah dipakai baris lain) |

Relasi memakai `projects.id` (UUID), bukan kode/nama. Jadi mengganti nama atau status master
**tidak merusak** tautan upah. Master bertambah 96 → **99** baris; itu memang diharapkan.

### 1.3 Enam baris yang dibiarkan NULL (TUNDA)

| # | Nama di modul | Alasan |
|---|---|---|
| 14 | `Project Park Serpong - Cendana` | TUNDA (keputusan DAT 26 Okt) |
| 15 | `Project Rosini -` | TUNDA (bukan 105) |
| 22 | `Project Flaminggo` | Usulan `65` **ditolak** DAT; tidak ada pengganti |
| 29 | `Park Serpong 9 - 15` | TUNDA |
| 37 | `Project Pademangan` | TUNDA |
| 43 | `Project Springhill` | TUNDA |

### 1.4 Enam baris non-proyek (jasa)

#16 `Service Park Serpong` · #17 `Service Tokyo` · #18 `Service TA` · #19 `Service Bintaro` ·
#31 `Servis` · #44 `Servisan 2` → `rejected`, tidak ditautkan ke proyek mana pun.

### 1.5 Yang berubah dari body tiket awal (supaya tidak ada yang bingung)

| Baris | Body tiket lama | Keputusan FINAL 26 Okt |
|---|---|---|
| #22 Flaminggo | 65 tanpa keputusan → NULL | **65 ditolak** → NULL (tetap NULL, tapi sekarang eksplisit) |
| #38 Barbershop Pintu | NULL | **→ 64 approved** |
| #42 Cendana Botanic | NULL (Tunda) | **→ 90B (master baru) approved** |
| #15 Rosini | NULL | NULL (TUNDA, bukan 105) |
| Jumlah tautan | 43 | **45** |
| Master baru | 2 (`73A`, `73B`) | **3** (`73A`, `73B`, `90B`) |
| Sisa "Belum terhubung" | 8 + 6 | **6 + 6 = 12** |

---

## PASTE 1 — Backup, angka kontrol, dan diagnostik

**Tujuan.** Menyimpan salinan utuh `upah_projects`, mencatat angka kontrol yang nanti dipakai
membuktikan "tidak ada angka modul yang berubah", dan memastikan bentuk database sesuai
asumsi paket ini.

```sql
-- ============================================================
-- PASTE 1a — BACKUP + ANGKA KONTROL
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

-- ============================================================
-- PASTE 1b — DIAGNOSTIK (READ-ONLY, tidak menulis apa pun)
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

**Hasil yang diharapkan.**

| Blok | Yang harus terlihat | Lulus kalau |
|---|---|---|
| A0.1 | `CREATE TABLE` untuk `upah_projects_backup_20261026` | tabel dibuat (bukan error) |
| A0.2 | `INSERT 0 1` | satu baris kontrol tersimpan |
| A0.3 | satu baris kontrol | `jumlah_proyek` = jumlah baris `upah_projects` live (snapshot **57**); `total_hak` = total upah tercatat (snapshot **Rp 530.256.600**). **Screenshot baris ini** — ini pembanding PASTE 7 |
| A1a | daftar kolom | `project_id` ada, `data_type = uuid`, `is_nullable = YES` |
| A1b | constraint + index | `upah_projects_project_id_fkey` dengan `convalidated = t`; index `upah_projects_project_id_idx` = `btree (project_id)` |
| A1c | 1 baris | `total` = 57, `belum_terhubung` = 57, `terhubung` = 0 (kalau sudah ada tautan, **catat angkanya** — guard PASTE 6 akan melindunginya) |
| A1d | daftar orphan | **0 baris** |
| A1e | 2 query | master **96** baris · `kode_kosong` 1 · `kode_berhuruf` 7 · **kode ganda 0 baris** |
| A1f | 3 baris | `upah_totalan.final` = 1; dua view boleh 0 (dibuat di PASTE 2) |
| A1g | daftar tabel | **7 baris** (`upah_tukang` … `upah_totalan_kasbon`) |

> **Penting — error yang memang diharapkan.** Kalau kolom `project_id` **belum pernah** dibuat,
> A1c dan A1d akan gagal dengan `ERROR: column "project_id" does not exist` (kode 42703).
> Itu **normal**: lanjutkan ke PASTE 2, lalu **ulangi PASTE 1 bagian A1a–A1g** setelah migrasi.
> Yang tidak boleh: A1a menunjukkan `project_id` bertipe `text`/`bigint` — itu **STOP**.

**Kalau gagal → stop & catat.**

- `ERROR: relation "upah_projects_backup_20261026" already exists` → backup sudah pernah dibuat.
  **Jangan timpa.** Cek `select count(*) from public.upah_projects_backup_20261026;`. Kalau dari
  hari yang sama, lanjut. Kalau dari hari lain, ganti angka `20261026` di **A0.1 saja** menjadi
  tanggal hari ini, lalu jalankan ulang A0.1–A0.3.
- `ERROR: permission denied` → DAT tidak berjalan sebagai owner/`postgres`. Hentikan, minta akses
  yang benar. Jangan mencoba menembus RLS.
- `kode ganda > 0` di A1e → **STOP**. Kunci pencocokan (kode) tidak unik; PASTE 4/5 akan menolak
  juga. Laporkan kode mana yang ganda.
- A1d > 0 baris → **STOP**. Ada `project_id` yang menunjuk master yang sudah dihapus.
- A1f `upah_totalan.final` = 0 → **STOP**. Migrasi `2026-10-24_LOCK_totalan_historis_pujon.sql`
  belum jalan.
- A1g < 7 baris → **STOP**. Modul Upah & Kasbon belum lengkap.

Catat di laporan: PASTE 1, blok yang gagal, teks error, dan angka yang muncul.

---

## PASTE 2 — Migrasi kolom relasi (idempotent)

**Tujuan.** Memastikan kolom `project_id`, foreign key ke `projects(id)`, index, dan dua view
dasar ada — tanpa mengubah satu baris data pun.

Jalankan **seluruh isi** berkas `migrations/2026-10-25_upah_projects_project_id.DRAFT.sql`.
Blok di bawah ini **sama persis** dengan berkas di repo (berkas tetap sumber kebenaran; kalau
berbeda, pakai berkasnya).

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

**Hasil yang diharapkan.**

- Output berakhir dengan `COMMIT`, tanpa `ERROR`.
- Jalankan ulang **A1a + A1b** dari PASTE 1: `project_id` bertipe `uuid`, FK
  `upah_projects_project_id_fkey` `convalidated = t`, index `btree (project_id)` ada.
- **A1c tidak berubah** dari sebelum PASTE 2 (tidak ada baris data yang tersentuh).
- Aman dijalankan dua kali: yang kedua hanya menghasilkan `NOTICE … already exists, skipping`.

**Kalau gagal → stop & catat.**

- Error apa pun → transaksi otomatis rollback, **tidak ada yang setengah jadi**. Jangan diulang
  sebelum errornya dibaca.
- `ERROR: constraint … is not valid` / VALIDATE gagal → ada baris dengan `project_id` yang tidak
  ada di `projects`. Jalankan A1d, laporkan barisnya.
- `ERROR: syntax error at or near "security_invoker"` → Postgres < 15. Laporkan versinya;
  jangan membuat view tanpa opsi itu atas inisiatif sendiri.

Catat di laporan: PASTE 2, teks error lengkap, dan hasil A1a/A1b sesudahnya.

---

## PASTE 3 — Staging 57 baris + antrian usulan + verifikasi kelas

**Tujuan.** Menyimpan pasangan nomor–nama–total dari sheet 20 Okt ke tabel staging, membangun
antrian satu-baris-per-proyek-upah, lalu membuktikan kelas keputusannya **persis 29/6/2/14/6**
sebelum ada satu keputusan pun dicatat.

```sql
-- ============================================================
-- PASTE 3a — TABEL STAGING NOMOR (57 baris snapshot 20 Okt 2026)
-- Tujuan: menyimpan pasangan nomor-nama-total per baris sheet supaya
--         pencocokan memakai nomor (bukan tebakan nama).
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

-- Isi ulang dari nol supaya tidak ada duplikat kalau PASTE ini diulang.
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
-- PASTE 3b. VERIFIKASI STAGING vs LIVE
-- Semua harus 0 selisih. Kalau tidak: STOP (lihat catatan di dokumen).
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
select t.kode as tukang_kode, up.project_name, up.total_manual, up.project_id
from public.upah_projects up
join public.upah_tukang t on t.id = up.tukang_id
left join public.upah_mapping_source s
       on lower(btrim(s.tukang_kode)) = lower(btrim(t.kode))
      and lower(btrim(s.source_name))  = lower(btrim(up.project_name))
where s.id is null
order by 1, 2;

-- A2c.4  Total upah per tukang: staging vs modul (selisih harus 0).
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

-- ============================================================
-- PASTE 3c — TABEL ANTRIAN USULAN (upah_project_link_review)
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
  updated_at        timestamptz default now(),
  -- kolom audit khusus paket ini (dipakai PASTE 4)
  sumber            text,
  butuh_master_baru boolean not null default false,
  kategori_dat      text
);

-- kolom baru kalau tabel ini sudah pernah dibuat versi lama
alter table public.upah_project_link_review add column if not exists saran text;
alter table public.upah_project_link_review add column if not exists decision text;
alter table public.upah_project_link_review add column if not exists sumber text;
alter table public.upah_project_link_review add column if not exists butuh_master_baru boolean not null default false;
alter table public.upah_project_link_review add column if not exists kategori_dat text;
alter table public.upah_project_link_review
  drop constraint if exists upah_project_link_review_decision_check;
alter table public.upah_project_link_review
  add constraint upah_project_link_review_decision_check
  check (decision in ('approved', 'rejected', 'manual'));
alter table public.upah_project_link_review
  drop constraint if exists upah_project_link_review_kategori_dat_check;
alter table public.upah_project_link_review
  add constraint upah_project_link_review_kategori_dat_check
  check (kategori_dat is null or kategori_dat in ('A', 'B', 'C', 'D', 'E'));

create index if not exists upah_project_link_review_method_idx
  on public.upah_project_link_review (method, status);

-- ============================================================
-- PASTE 3d — ISI ANTRIAN (satu baris per proyek upah)
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

-- ============================================================
-- PASTE 3e — REKAP KELAS (gerbang angka 29/6/2/14/6)
-- Hasil harus PERSIS: kode 29 | kode_kembar 6 | kode_nama_beda 2 |
--                     tanpa_kandidat 14 | non_proyek 6 | total 57.
-- Kalau beda: STOP. Jangan jalankan PASTE 4.
-- ============================================================
select method,
       count(*) as jumlah,
       case method when 'kode'           then 29
                   when 'kode_kembar'    then 6
                   when 'kode_nama_beda' then 2
                   when 'tanpa_kandidat' then 14
                   when 'non_proyek'     then 6 end as harusnya,
       count(*) = case method when 'kode'           then 29
                              when 'kode_kembar'    then 6
                              when 'kode_nama_beda' then 2
                              when 'tanpa_kandidat' then 14
                              when 'non_proyek'     then 6 end as lulus
from public.upah_project_link_review
group by method
order by method;

-- Satu baris ringkas: semua kolom harus true.
select count(*) = 57                                                as total_57,
       count(*) filter (where method = 'kode')           = 29      as kode_29,
       count(*) filter (where method = 'kode_kembar')    = 6       as kembar_6,
       count(*) filter (where method = 'kode_nama_beda') = 2       as nama_beda_2,
       count(*) filter (where method = 'tanpa_kandidat') = 14      as tanpa_nomor_14,
       count(*) filter (where method = 'non_proyek')     = 6       as jasa_6
from public.upah_project_link_review;
```

**Hasil yang diharapkan.**

A2c — staging vs live (semua harus persis):

| Cek | Harus |
|---|---|
| A2c.1 `asep` | 1 baris · 1 bernomor · 0 tanpa nomor · **Rp 10.345.000** |
| A2c.1 `pujon` | 56 baris · 36 bernomor · 20 tanpa nomor · **Rp 519.911.600** |
| A2c.1 total | **57 baris / 37 bernomor / 20 tanpa nomor / Rp 530.256.600** |
| A2c.2 (staging tanpa pasangan di modul) | **0 baris** |
| A2c.3 (baris modul tanpa pasangan di staging) | **0 baris** |
| A2c.4 (total staging vs modul) | `selisih = 0` untuk `asep` **dan** `pujon` |

A4c — kelas antrian (`PASTE 3e`), harus **semua `t`**:

| method | jumlah | harusnya |
|---|---|---|
| `kode` | 29 | 29 |
| `kode_kembar` | 6 | 6 |
| `kode_nama_beda` | 2 | 2 |
| `tanpa_kandidat` | 14 | 14 |
| `non_proyek` | 6 | 6 |
| **total** | **57** | 57 |

> **Kalau angka kelas BEDA dari 29/6/2/14/6 → STOP.** Jangan jalankan PASTE 4, jangan
> "menyesuaikan" SQL. Artinya data live sudah berbeda dari snapshot 20 Okt (proyek baru, nama
> berubah, atau nominal berubah). Kirim hasil A2c.1–A2c.4 + A4c ke Brooklyn/DAT, lalu tunggu
> instruksi. PASTE 4 juga akan menolak berjalan sendiri (gerbang 4.1) — itu disengaja.

**Kalau gagal → stop & catat.**

- A2c.2 > 0 → nama proyek di modul sudah diubah atau barisnya dihapus. Cocokkan manual; jangan
  mengubah `upah_projects`. Laporkan barisnya (tukang + nama + nominal).
- A2c.3 > 0 → ada proyek upah yang tidak ada di sheet (biasanya dibuat setelah 20 Okt). **STOP**,
  laporkan; menambahkannya ke staging berarti mengubah lingkup paket ini.
- A2c.4 ≠ 0 → nominal di sheet berubah. **STOP**, laporkan selisihnya per tukang.
- `ERROR: function upah_proposal_norm … already exists` → tidak mungkin (memakai
  `create or replace`), tapi kalau muncul, jalankan ulang blok itu saja.
- Antrian ≠ 57 baris → ada baris `upah_projects` yang tidak masuk. Cek A2c.3.

Catat di laporan: PASTE 3, angka A2c.1–A2c.4, dan tabel A4c apa adanya.

---

## PASTE 4 — Catat 57 keputusan DAT

**Tujuan.** Menulis keputusan final DAT (42 tautan langsung, 3 menunggu master baru, 6 NULL,
6 non-proyek) ke tabel review — **tanpa** menautkan satu baris pun ke `upah_projects`.

```sql
-- ============================================================
-- PASTE 4 — CATAT KEPUTUSAN FINAL DAT (sumber: Excel 26 Okt 2026)
-- Tujuan: mencatat 57 keputusan DAT ke upah_project_link_review.
--         PASTE ini TIDAK menautkan satu baris pun ke upah_projects.
-- Sifat : MENULIS tabel review saja (bukan tabel modul).
-- Aman diulang: baris yang sudah berstatus 'applied' tidak diubah.
-- ============================================================
begin;

-- 4.0  Kolom audit (idempoten; aman walau PASTE 3 sudah membuatnya).
alter table public.upah_project_link_review add column if not exists sumber text;
alter table public.upah_project_link_review add column if not exists butuh_master_baru boolean not null default false;
alter table public.upah_project_link_review add column if not exists kategori_dat text;
alter table public.upah_project_link_review
  drop constraint if exists upah_project_link_review_kategori_dat_check;
alter table public.upah_project_link_review
  add constraint upah_project_link_review_kategori_dat_check
  check (kategori_dat is null or kategori_dat in ('A', 'B', 'C', 'D', 'E'));

-- 4.1  GERBANG 1 — angka kelas antrian WAJIB 29/6/2/14/6 (snapshot 20 Okt).
do $$
declare r record;
begin
  select count(*) filter (where method = 'kode')           as a,
         count(*) filter (where method = 'kode_kembar')    as b,
         count(*) filter (where method = 'kode_nama_beda') as c,
         count(*) filter (where method = 'tanpa_kandidat') as d,
         count(*) filter (where method = 'non_proyek')     as e,
         count(*)                                          as total
    into r
  from public.upah_project_link_review;

  if (r.a, r.b, r.c, r.d, r.e, r.total) is distinct from (29, 6, 2, 14, 6, 57) then
    raise exception 'STOP PASTE 4: kelas antrian % / % / % / % / % (total %), seharusnya 29/6/2/14/6 (total 57). Data live BERBEDA dari snapshot 20 Okt. Jangan lanjut — kirim rekap ini ke Brooklyn/DAT.',
      r.a, r.b, r.c, r.d, r.e, r.total;
  end if;
end $$;

-- 4.2  Tabel keputusan (57 baris, persis daftar di Lampiran A dokumen).
create temp table if not exists dat_keputusan (
  no          int primary key,
  tukang_kode text not null,
  nama_snapshot text not null,
  kategori    text not null,
  aksi        text not null check (aksi in ('tautkan', 'tautkan_master_baru', 'biarkan', 'non_proyek')),
  kode_tujuan text,
  catatan     text
) on commit drop;

truncate dat_keputusan;

insert into dat_keputusan (no, tukang_kode, nama_snapshot, kategori, aksi, kode_tujuan, catatan) values
  (1, 'asep', 'Santi - Baroni Utara 1/87', 'A', 'tautkan', '99', 'A - otomatis cocok'),
  (2, 'pujon', 'Project Intercon', 'A', 'tautkan', '49', 'A - otomatis cocok'),
  (3, 'pujon', 'Project Cosmos', 'C', 'tautkan', '47', 'C - nama beda; DAT setuju nomor 47'),
  (4, 'pujon', 'Project Radio Dalam', 'A', 'tautkan', '52', 'A - otomatis cocok'),
  (5, 'pujon', 'Project Jessie', 'A', 'tautkan', '21', 'A - otomatis cocok'),
  (6, 'pujon', 'Project Sunter Hijau 8', 'D', 'tautkan', '54', 'D - ganti: 54. Windy - Sunter Hijau'),
  (7, 'pujon', 'Project Cendana Icon', 'A', 'tautkan', '17', 'A - otomatis cocok'),
  (8, 'pujon', 'Project Park Serpong', 'A', 'tautkan', '53', 'A - otomatis cocok'),
  (9, 'pujon', 'Project Gatsu', 'A', 'tautkan', '57', 'A - otomatis cocok'),
  (10, 'pujon', 'Project Duren Sawit', 'A', 'tautkan', '55', 'A - otomatis cocok'),
  (11, 'pujon', 'Project Meranti', 'A', 'tautkan', '58', 'A - otomatis cocok'),
  (12, 'pujon', 'Project Nerin 1', 'D', 'tautkan', '59', 'D - ganti: 59. Robby - Giantara Serpong City'),
  (13, 'pujon', 'Project Nerin 5', 'D', 'tautkan', '60', 'D - ganti: 60. Juli - Giantara Serpong'),
  (14, 'pujon', 'Project Park Serpong - Cendana', 'D', 'biarkan', null, 'D - TUNDA (keputusan DAT 26 Okt)'),
  (15, 'pujon', 'Project Rosini -', 'D', 'biarkan', null, 'D - TUNDA (keputusan DAT 26 Okt)'),
  (16, 'pujon', 'Service Park Serpong', 'E', 'non_proyek', null, 'E - jasa'),
  (17, 'pujon', 'Service Tokyo', 'E', 'non_proyek', null, 'E - jasa'),
  (18, 'pujon', 'Service TA', 'E', 'non_proyek', null, 'E - jasa'),
  (19, 'pujon', 'Service Bintaro', 'E', 'non_proyek', null, 'E - jasa'),
  (20, 'pujon', 'Project Barbershop', 'D', 'tautkan', '95', 'D - ganti: 95. Andri - Barbershop Pekayon'),
  (21, 'pujon', 'Project Dulcet', 'A', 'tautkan', '63', 'A - otomatis cocok'),
  (22, 'pujon', 'Project Flaminggo', 'C', 'biarkan', null, 'C - usulan 65 DITOLAK DAT; tanpa pengganti'),
  (23, 'pujon', 'Project Casa de Parco', 'A', 'tautkan', '66', 'A - otomatis cocok'),
  (24, 'pujon', 'Project Sunter Hijau Utama', 'D', 'tautkan', '68', 'D - ganti: 68. Ko Tepen - Sunter'),
  (25, 'pujon', 'Everbeau', 'D', 'tautkan_master_baru', '73B', 'D - ganti: 73B (master baru)'),
  (26, 'pujon', 'Cityzen North 3 -17', 'A', 'tautkan', '74', 'A - otomatis cocok'),
  (27, 'pujon', 'Cove 2 - 27', 'A', 'tautkan', '75', 'A - otomatis cocok'),
  (28, 'pujon', 'Cove 2 - 76', 'A', 'tautkan', '76', 'A - otomatis cocok'),
  (29, 'pujon', 'Park Serpong 9 - 15', 'D', 'biarkan', null, 'D - TUNDA (keputusan DAT 26 Okt)'),
  (30, 'pujon', 'Osaka PIK', 'A', 'tautkan', '79', 'A - otomatis cocok'),
  (31, 'pujon', 'Servis', 'E', 'non_proyek', null, 'E - jasa'),
  (32, 'pujon', 'Park Serpong Flo 7 -66', 'B', 'tautkan', '78a', 'B - kembar; DAT setuju 78a'),
  (33, 'pujon', 'Barbershop HI - 2', 'A', 'tautkan', '71', 'A - otomatis cocok'),
  (34, 'pujon', 'Project Apt Baywalk', 'B', 'tautkan', '72a', 'B - kembar; DAT setuju 72a'),
  (35, 'pujon', 'Project Cisauk', 'A', 'tautkan', '70', 'A - otomatis cocok'),
  (36, 'pujon', 'Peak Springhill', 'B', 'tautkan', '69a', 'B - kembar; DAT setuju 69a'),
  (37, 'pujon', 'Project Pademangan', 'D', 'biarkan', null, 'D - TUNDA (keputusan DAT 26 Okt)'),
  (38, 'pujon', 'Project Barbershop Pintu', 'D', 'tautkan', '64', 'D - ganti: 64. Andri - Barbershop (keputusan DAT 26 Okt)'),
  (39, 'pujon', 'Project Skyhouse BSD', 'B', 'tautkan', '81a', 'B - kembar; DAT setuju 81a'),
  (40, 'pujon', 'Project Charm 23 - 56', 'B', 'tautkan', '80a', 'B - kembar; DAT setuju 80a'),
  (41, 'pujon', 'Project Cove 2 - 27', 'A', 'tautkan', '75', 'A - otomatis cocok (fase ke-2, sah)'),
  (42, 'pujon', 'Cendana Botanic', 'D', 'tautkan_master_baru', '90B', 'D - ganti: 90B (master baru, keputusan DAT 26 Okt)'),
  (43, 'pujon', 'Project Springhill', 'D', 'biarkan', null, 'D - TUNDA (keputusan DAT 26 Okt)'),
  (44, 'pujon', 'Servisan 2', 'E', 'non_proyek', null, 'E - jasa'),
  (45, 'pujon', 'Project Bekasi', 'A', 'tautkan', '88', 'A - otomatis cocok'),
  (46, 'pujon', 'Project Panola', 'A', 'tautkan', '92', 'A - otomatis cocok'),
  (47, 'pujon', 'Project Semanan', 'A', 'tautkan', '87', 'A - otomatis cocok'),
  (48, 'pujon', 'Project Rempoa', 'A', 'tautkan', '85', 'A - otomatis cocok'),
  (49, 'pujon', 'Project Barbershop Pekayon', 'A', 'tautkan', '95', 'A - otomatis cocok'),
  (50, 'pujon', 'Project Leo Sunter', 'A', 'tautkan', '96', 'A - otomatis cocok'),
  (51, 'pujon', 'Project Cove 2-21', 'A', 'tautkan', '89', 'A - otomatis cocok'),
  (52, 'pujon', 'Project Steffi', 'B', 'tautkan', '90', 'B - kembar; DAT setuju 90'),
  (53, 'pujon', 'Proyek Josh - Mabes', 'A', 'tautkan', '83', 'A - otomatis cocok'),
  (54, 'pujon', 'Proyek Sunter Hijau - Eric', 'A', 'tautkan', '61', 'A - otomatis cocok'),
  (55, 'pujon', 'Project Reivan Trail 10-20', 'A', 'tautkan', '94', 'A - otomatis cocok'),
  (56, 'pujon', 'Brigitta Cove 12-32', 'A', 'tautkan', '91', 'A - otomatis cocok'),
  (57, 'pujon', 'Project Everbeau - kaca', 'D', 'tautkan_master_baru', '73A', 'D - ganti: 73A (master baru)');

-- 4.3  GERBANG 2 — isi tabel keputusan harus 42 tautan langsung + 3 menunggu
--      master baru + 6 dibiarkan + 6 non-proyek = 57.
do $$
declare r record;
begin
  select count(*) filter (where aksi = 'tautkan')             as langsung,
         count(*) filter (where aksi = 'tautkan_master_baru') as master_baru,
         count(*) filter (where aksi = 'biarkan')             as dibiarkan,
         count(*) filter (where aksi = 'non_proyek')          as jasa,
         count(*)                                             as total
    into r
  from dat_keputusan;

  if (r.langsung, r.master_baru, r.dibiarkan, r.jasa, r.total) is distinct from (42, 3, 6, 6, 57) then
    raise exception 'STOP PASTE 4: tabel keputusan berisi % / % / % / % (total %), seharusnya 42/3/6/6 (total 57). SQL PASTE 4 tidak utuh — salin ulang dari dokumen.',
      r.langsung, r.master_baru, r.dibiarkan, r.jasa, r.total;
  end if;
end $$;

-- 4.4  GERBANG 3 — setiap baris keputusan harus cocok TEPAT 1 baris review,
--      dan tidak boleh ada baris review yang tidak ada di daftar keputusan.
do $$
declare v_bad int; v_extra int;
begin
  select count(*) into v_bad
  from (
    select d.no
    from dat_keputusan d
    left join public.upah_project_link_review r
      on lower(btrim(r.tukang_kode))   = lower(btrim(d.tukang_kode))
     and lower(btrim(r.nama_snapshot)) = lower(btrim(d.nama_snapshot))
    group by d.no
    having count(r.upah_project_id) <> 1
  ) x;

  if v_bad > 0 then
    raise exception 'STOP PASTE 4: % baris keputusan tidak ketemu / kembar di upah_project_link_review (nama di modul berubah?). Jalankan A2c.2/A2c.3 dan laporkan.', v_bad;
  end if;

  select count(*) into v_extra
  from public.upah_project_link_review r
  left join dat_keputusan d
    on lower(btrim(r.tukang_kode))   = lower(btrim(d.tukang_kode))
   and lower(btrim(r.nama_snapshot)) = lower(btrim(d.nama_snapshot))
  where d.no is null;

  if v_extra > 0 then
    raise exception 'STOP PASTE 4: ada % baris di antrian yang TIDAK ada di daftar keputusan (proyek baru setelah 20 Okt?). Jangan lanjut — laporkan ke Brooklyn/DAT.', v_extra;
  end if;
end $$;

-- 4.5  GERBANG 4 — setiap kode tujuan 'tautkan' harus ada DAN unik di master.
--      (Ini juga yang menangkap kalau kode 64 tidak ada di master live.)
do $$
declare v_msg text;
begin
  select string_agg(x.kode || ' -> ' || x.n || ' baris master', ', ') into v_msg
  from (
    select d.kode_tujuan as kode, count(distinct p.id) as n
    from dat_keputusan d
    left join public.projects p
      on lower(btrim(p.kode)) = lower(btrim(d.kode_tujuan))
    where d.aksi = 'tautkan'
    group by d.kode_tujuan
    having count(distinct p.id) <> 1
  ) x;

  if v_msg is not null then
    raise exception 'STOP PASTE 4: kode tujuan tidak ada atau tidak unik di master projects: %. Perbaiki master dulu, jangan paksa.', v_msg;
  end if;
end $$;

-- 4.6  TULIS — 42 tautan langsung (29 A + 6 B + #3 + 5 D + #38).
update public.upah_project_link_review r
   set decision          = 'approved',
       status            = 'decided',
       decided_by        = 'DAT',
       decided_at        = now(),
       sumber            = 'excel-20261026',
       kategori_dat      = d.kategori,
       butuh_master_baru = false,
       master_project_id = p.id,
       master_kode       = p.kode,
       master_name       = p.name,
       note              = 'DAT excel-20261026 · ' || d.catatan,
       updated_at        = now()
  from dat_keputusan d
  join public.projects p on lower(btrim(p.kode)) = lower(btrim(d.kode_tujuan))
 where d.aksi = 'tautkan'
   and lower(btrim(r.tukang_kode))   = lower(btrim(d.tukang_kode))
   and lower(btrim(r.nama_snapshot)) = lower(btrim(d.nama_snapshot))
   and r.status in ('suggested', 'decided');

-- 4.7  TULIS — 3 baris yang menunggu master baru (73A, 73B, 90B).
--      master_project_id sengaja NULL: PASTE 5 yang mengisi setelah master dibuat.
update public.upah_project_link_review r
   set decision          = 'approved',
       status            = 'decided',
       decided_by        = 'DAT',
       decided_at        = now(),
       sumber            = 'excel-20261026',
       kategori_dat      = d.kategori,
       butuh_master_baru = true,
       master_project_id = null,
       master_kode       = d.kode_tujuan,
       master_name       = null,
       note              = 'DAT excel-20261026 · ' || d.catatan || ' — MENUNGGU master baru (PASTE 5)',
       updated_at        = now()
  from dat_keputusan d
 where d.aksi = 'tautkan_master_baru'
   and lower(btrim(r.tukang_kode))   = lower(btrim(d.tukang_kode))
   and lower(btrim(r.nama_snapshot)) = lower(btrim(d.nama_snapshot))
   and r.status in ('suggested', 'decided');

-- 4.8  TULIS — 6 baris dibiarkan NULL ("Belum terhubung").
update public.upah_project_link_review r
   set decision          = 'rejected',
       status            = 'decided',
       decided_by        = 'DAT',
       decided_at        = now(),
       sumber            = 'excel-20261026',
       kategori_dat      = d.kategori,
       butuh_master_baru = false,
       master_project_id = null,
       master_kode       = null,
       master_name       = null,
       note              = 'DAT excel-20261026 · ' || d.catatan || ' — dibiarkan Belum terhubung',
       updated_at        = now()
  from dat_keputusan d
 where d.aksi = 'biarkan'
   and lower(btrim(r.tukang_kode))   = lower(btrim(d.tukang_kode))
   and lower(btrim(r.nama_snapshot)) = lower(btrim(d.nama_snapshot))
   and r.status in ('suggested', 'decided');

-- 4.9  TULIS — 6 baris jasa = non-proyek (tidak ditautkan).
update public.upah_project_link_review r
   set decision          = 'rejected',
       status            = 'decided',
       decided_by        = 'DAT',
       decided_at        = now(),
       sumber            = 'excel-20261026',
       kategori_dat      = d.kategori,
       butuh_master_baru = false,
       master_project_id = null,
       master_kode       = null,
       master_name       = null,
       note              = 'DAT excel-20261026 · non_proyek (jasa) — tidak ditautkan',
       updated_at        = now()
  from dat_keputusan d
 where d.aksi = 'non_proyek'
   and lower(btrim(r.tukang_kode))   = lower(btrim(d.tukang_kode))
   and lower(btrim(r.nama_snapshot)) = lower(btrim(d.nama_snapshot))
   and r.status in ('suggested', 'decided');

-- 4.10 VERIFIKASI — hasil harus 42 | 3 | 6 | 6 | 0 | 57 | 57.
select count(*) filter (where decision = 'approved' and not butuh_master_baru) as tautan_langsung,
       count(*) filter (where decision = 'approved' and butuh_master_baru)     as menunggu_master_baru,
       count(*) filter (where decision = 'rejected' and kategori_dat in ('C','D')) as dibiarkan_null,
       count(*) filter (where decision = 'rejected' and kategori_dat = 'E')    as non_proyek,
       count(*) filter (where decision is null)                               as belum_diputuskan,
       count(*)                                                               as total,
       count(*) filter (where decided_by = 'DAT' and sumber = 'excel-20261026') as berlabel_dat
from public.upah_project_link_review;

-- 4.11 VERIFIKASI — sebaran per kategori DAT (harus A 29 | B 6 | C 2 | D 14 | E 6).
select kategori_dat, decision, butuh_master_baru, count(*) as jumlah
from public.upah_project_link_review
group by 1, 2, 3
order by 1, 2, 3;

-- 4.12 VERIFIKASI — 3 baris yang masih menunggu master baru.
select r.tukang_kode, r.nama_snapshot, r.master_kode, r.decision, r.butuh_master_baru
from public.upah_project_link_review r
where r.butuh_master_baru
order by r.master_kode;

commit;
```

**Hasil yang diharapkan.**

`PASTE 4.10` — satu baris, harus persis:

| tautan_langsung | menunggu_master_baru | dibiarkan_null | non_proyek | belum_diputuskan | total | berlabel_dat |
|---|---|---|---|---|---|---|
| **42** | **3** | **6** | **6** | **0** | **57** | **57** |

`PASTE 4.11` — sebaran per kategori:

| kategori_dat | decision | butuh_master_baru | jumlah |
|---|---|---|---|
| A | approved | f | 29 |
| B | approved | f | 6 |
| C | approved | f | 1 |
| C | rejected | f | 1 |
| D | approved | f | 6 |
| D | approved | t | **3** |
| D | rejected | f | 5 |
| E | rejected | f | 6 |

`PASTE 4.12` — tiga baris yang menunggu master baru: `73A` (Project Everbeau - kaca),
`73B` (Everbeau), `90B` (Cendana Botanic).

**Kalau gagal → stop & catat.** Empat gerbang di PASTE 4 punya pesan sendiri:

| Pesan | Arti | Tindakan |
|---|---|---|
| `STOP PASTE 4: kelas antrian … seharusnya 29/6/2/14/6` | data live beda dari snapshot | **STOP**, lapor Brooklyn. Jangan ubah angka di SQL |
| `STOP PASTE 4: tabel keputusan berisi … seharusnya 42/3/6/6` | SQL PASTE 4 tersalin tidak utuh | salin ulang seluruh blok dari dokumen ini |
| `STOP PASTE 4: N baris keputusan tidak ketemu / kembar` | nama proyek di modul berubah | jalankan A2c.2/A2c.3, laporkan; jangan edit `upah_projects` |
| `STOP PASTE 4: ada N baris di antrian yang TIDAK ada di daftar keputusan` | ada proyek upah baru setelah 20 Okt | **STOP**, lapor Brooklyn |
| `STOP PASTE 4: kode tujuan tidak ada atau tidak unik … 64 -> 0 baris master` | master tujuan belum ada / ganda | perbaiki master dulu (mis. buat `64. Andri - Barbershop`), jangan paksa |

Catat di laporan: PASTE 4, pesan error, dan output 4.10/4.11/4.12.

---

## PASTE 5 — Buat 3 master baru, lalu tautkan 3 baris

**Tujuan.** Membuat master `projects` yang belum ada (`73A`, `73B`, `90B`) dengan guard
"hanya kalau belum ada", lalu mengisi `master_project_id` untuk #25, #57, dan #42 dengan UUID
hasil pembacaan kode (bukan UUID hafalan).

```sql
-- ============================================================
-- PASTE 5 — BUAT 3 MASTER BARU (73A, 73B, 90B) + TAUTKAN 3 BARIS
-- Tujuan: membuat master projects yang belum ada, lalu mengisi
--         master_project_id untuk #25, #57, #42.
-- Sifat : MENULIS 3 baris BARU di public.projects (aditif, guard
--         "where not exists") + 3 baris di tabel review.
--         TIDAK mengubah baris master yang sudah ada.
-- Aman diulang: kalau kode sudah ada, INSERT dilewati.
--
-- CATATAN UNTUK DAT: nama & status 3 baris ini BOLEH diubah kapan pun
-- lewat modul Projects (mis. nama final "Everbeau" / "Cendana Botanic").
-- Relasi upah memakai projects.id (UUID), bukan kode/nama, jadi
-- mengganti nama/status TIDAK merusak tautan.
-- ============================================================
begin;

-- 5.1  INSERT guard — hanya membuat yang belum ada.
insert into public.projects (id, kode, code, name, status)
select gen_random_uuid(), v.kode, v.kode, v.name, 'ON_GOING'
from (values ('73A', '73A. Everbeau - kaca'),
             ('73B', '73B. Everbeau'),
             ('90B', '90B. Cendana Botanic')) as v(kode, name)
where not exists (
  select 1 from public.projects p
  where lower(btrim(p.kode)) = lower(btrim(v.kode))
);

-- 5.2  GERBANG — setelah INSERT, tiap kode harus ada TEPAT 1 baris master.
--      Gagal di sini = kode tidak unik di master; JANGAN lanjut.
do $$
declare v_msg text;
begin
  select string_agg(x.kode || ' -> ' || x.n || ' baris', ', ') into v_msg
  from (
    select v.kode, count(distinct p.id) as n
    from (values ('73A'), ('73B'), ('90B')) as v(kode)
    left join public.projects p on lower(btrim(p.kode)) = lower(btrim(v.kode))
    group by v.kode
    having count(distinct p.id) <> 1
  ) x;

  if v_msg is not null then
    raise exception 'STOP PASTE 5: kode master baru tidak unik / gagal dibuat: %. Periksa manual di modul Projects, jangan paksa.', v_msg;
  end if;
end $$;

-- 5.3  TAUTKAN 3 baris review ke UUID master yang baru dibaca dari kode.
update public.upah_project_link_review r
   set master_project_id = p.id,
       master_kode       = p.kode,
       master_name       = p.name,
       butuh_master_baru = false,
       note              = r.note || ' · master dibuat & ditautkan di PASTE 5',
       updated_at        = now()
  from (values ('pujon', 'Everbeau',               '73B'),
               ('pujon', 'Project Everbeau - kaca', '73A'),
               ('pujon', 'Cendana Botanic',         '90B')) as v(tukang_kode, nama_snapshot, kode)
  join public.projects p on lower(btrim(p.kode)) = lower(btrim(v.kode))
 where r.butuh_master_baru = true
   and r.decision = 'approved'
   and lower(btrim(r.tukang_kode))   = lower(btrim(v.tukang_kode))
   and lower(btrim(r.nama_snapshot)) = lower(btrim(v.nama_snapshot));

-- 5.4  VERIFIKASI — harus: 0 menunggu, 3 tertaut, master 96 -> 99.
select count(*) filter (where butuh_master_baru)                    as masih_menunggu,   -- 0
       count(*) filter (where butuh_master_baru = false
                          and decision = 'approved'
                          and master_project_id is not null)        as siap_ditautkan,   -- 45
       (select count(*) from public.projects)                       as total_master      -- 99
from public.upah_project_link_review;

-- 5.5  Bukti 3 baris: kode master + nama + UUID.
select r.nama_snapshot, r.master_kode, r.master_name, r.master_project_id
from public.upah_project_link_review r
where r.master_kode in ('73A', '73B', '90B')
order by r.master_kode;

commit;
```

**Hasil yang diharapkan.**

- `INSERT 0 3` pada 5.1 (kalau diulang: `INSERT 0 0` — aman, tidak membuat duplikat).
- `UPDATE 3` pada 5.3.
- `PASTE 5.4`: **`masih_menunggu = 0`**, **`siap_ditautkan = 45`**, **`total_master = 99`**
  (96 master lama + 3 baru).
- `PASTE 5.5`: tiga baris dengan `master_kode` `73A`, `73B`, `90B` dan `master_project_id`
  (UUID) terisi.

> Nama dan status 3 master itu **boleh diubah kapan pun** lewat modul Projects (mis. menjadi
> "Everbeau" saja). Relasi memakai UUID, jadi mengganti nama/status **tidak merusak** tautan.
> Kalau nanti ada yang menanyakan "kenapa kode 90B ada padahal master lama cuma sampai 90a" —
> jawabannya ada di §1.2: `90a` = Cendana Botanic - Breeze 7-32 (sudah dipakai baris lain),
> `90B` = proyek Cendana Botanic yang diputuskan DAT.

**Kalau gagal → stop & catat.**

- `STOP PASTE 5: kode master baru tidak unik / gagal dibuat: …` → ada kode `73A`/`73B`/`90B`
  lebih dari satu baris di master (atau INSERT ditolak constraint). **STOP**, jangan lanjut;
  laporkan isi `select id, kode, name, status from public.projects where lower(btrim(kode)) in ('73a','73b','90b');`
- `UPDATE 0` pada 5.3 → tiga baris review tidak ketemu (nama berubah) atau `butuh_master_baru`
  sudah `false`. Cek `select nama_snapshot, master_kode, butuh_master_baru from public.upah_project_link_review where master_kode in ('73A','73B','90B');`
- `total_master` ≠ 99 → ada master lain yang dibuat/dihapus di luar proses ini. **STOP**,
  laporkan; angka 99 dipakai sebagai bukti di PASTE 7.

Catat di laporan: PASTE 5, hasil 5.4/5.5, dan nama final ketiga master.

---

## PASTE 6 — Batch: tulis 45 tautan + log audit

**Tujuan.** Menulis `upah_projects.project_id` untuk 45 baris yang sudah diputuskan, dengan
5 guard, log audit per baris (`old_project_id`, `batch`, `decided_by`), dan verifikasi bahwa
jumlah "belum terhubung" turun tepat sebanyak baris yang ditulis.

```sql
-- ============================================================
-- PASTE 6 — BATCH: TERAPKAN 45 TAUTAN (42 langsung + 3 master baru)
-- Tujuan: menulis upah_projects.project_id untuk 45 baris yang sudah
--         diputuskan DAT, plus log audit per baris.
-- Sifat : MENULIS upah_projects.project_id + upah_project_link_log.
--         TIDAK menyentuh upah_items / upah_kasbon / upah_totalan* /
--         projects (master sudah dibuat di PASTE 5).
-- Aman diulang: baris yang sudah tertaut ke tujuan yang sama dilewati.
-- ============================================================
begin;

-- 6.0  Tabel log audit (idempoten) + kolom keputusan.
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
alter table public.upah_project_link_log add column if not exists decided_by text;
alter table public.upah_project_link_log add column if not exists sumber text;
create index if not exists upah_project_link_log_batch_idx
  on public.upah_project_link_log (batch, upah_project_id);

-- 6.1  SATU TRANSAKSI: pre-flight pilot + 5 guard + tulis + verifikasi.
do $$
declare
  v_batch  text := 'mapping-20261026';
  v_ready  int;
  v_applied int;
  v_rows   int;
  v_logged int;
  v_before int;
  v_after  int;
  v_over   int;
  v_nolink int;
  v_n      int;
  v_total  numeric;
begin
  -- (a) PRE-FLIGHT PILOT [83]: harus tepat 1 baris, totalnya 9.230.000.
  select count(*) into v_n
  from public.upah_project_link_review r
  where r.master_kode = '83' and r.decision = 'approved';

  if v_n <> 1 then
    raise exception 'STOP: pilot [83] harus tepat 1 baris approved, ditemukan %', v_n;
  end if;

  select coalesce(up.total_manual, it.total_rincian, 0) into v_total
  from public.upah_project_link_review r
  join public.upah_projects up on up.id = r.upah_project_id
  left join (select project_id, sum(upah_rincian) as total_rincian
               from public.upah_items group by project_id) it on it.project_id = up.id
  where r.master_kode = '83' and r.decision = 'approved';

  if v_total is distinct from 9230000 then
    raise exception 'STOP: pilot [83] total upah = %, seharusnya 9230000. Baris live bukan proyek yang sama dengan snapshot — jangan batch, laporkan ke Brooklyn/DAT.', v_total;
  end if;

  -- (b) GUARD 0: keadaan antrian harus 45 siap tulis (atau sudah selesai).
  select count(*) filter (where status = 'decided' and decision = 'approved' and master_project_id is not null),
         count(*) filter (where status = 'applied' and decision = 'approved' and master_project_id is not null)
    into v_ready, v_applied
  from public.upah_project_link_review;

  if v_ready = 0 and v_applied = 45 then
    raise notice 'BATCH %: sudah pernah diterapkan (45 tautan applied). Tidak ada yang dikerjakan ulang.', v_batch;
    return;
  end if;

  if v_ready <> 45 then
    raise exception 'STOP: baris siap tulis = %, seharusnya 45. Kalau angkanya 42, PASTE 5 (3 master baru) belum dijalankan. Jangan lanjut sebelum 45.', v_ready;
  end if;

  if v_applied <> 0 then
    raise exception 'STOP: sudah ada % baris berstatus applied — proses ini pernah berjalan sebagian. Jalankan PASTE R (rollback) dulu, lalu ulangi PASTE 4-6.', v_applied;
  end if;

  -- (c) GUARD 1: approved tanpa tujuan tidak boleh diterapkan diam-diam.
  select count(*) into v_nolink
  from public.upah_project_link_review
  where status = 'decided'
    and decision = 'approved'
    and master_project_id is null;

  if v_nolink > 0 then
    raise exception 'STOP: % baris approved tanpa master_project_id — PASTE 5 belum dijalankan / gagal.', v_nolink;
  end if;

  -- (d) GUARD 2: jangan pernah menimpa tautan lama yang berbeda.
  select count(*) into v_over
  from public.upah_project_link_review r
  join public.upah_projects up on up.id = r.upah_project_id
  where r.status = 'decided'
    and r.decision = 'approved'
    and r.master_project_id is not null
    and up.project_id is not null
    and up.project_id is distinct from r.master_project_id;

  if v_over > 0 then
    raise exception 'STOP: % baris akan MENIMPA tautan lama. Tidak ada yang ditulis. Bandingkan dengan A1c, laporkan sebelum memutuskan apa pun.', v_over;
  end if;

  -- (e) GUARD 3: tidak boleh ada sisa yang belum diputuskan.
  select count(*) into v_rows
  from public.upah_project_link_review
  where decision is null;

  if v_rows > 0 then
    raise exception 'STOP: % baris belum punya decision (ulangi PASTE 4).', v_rows;
  end if;

  -- (f) TULIS LOG (keadaan sebelum) — hanya baris yang benar-benar berubah.
  select count(*) filter (where project_id is null) into v_before
  from public.upah_projects;

  insert into public.upah_project_link_log
    (upah_project_id, old_project_id, new_project_id, method, actor, batch, decided_by, sumber)
  select up.id, up.project_id, r.master_project_id, r.method, current_user, v_batch, 'DAT', 'excel-20261026'
  from public.upah_project_link_review r
  join public.upah_projects up on up.id = r.upah_project_id
  where r.status = 'decided'
    and r.decision = 'approved'
    and r.master_project_id is not null
    and up.project_id is distinct from r.master_project_id;
  get diagnostics v_logged = row_count;

  -- (g) TULIS TAUTAN.
  update public.upah_projects up
     set project_id = r.master_project_id
    from public.upah_project_link_review r
   where up.id = r.upah_project_id
     and r.status = 'decided'
     and r.decision = 'approved'
     and r.master_project_id is not null
     and up.project_id is distinct from r.master_project_id;

  select count(*) filter (where project_id is null) into v_after
  from public.upah_projects;

  -- (h) VERIFIKASI: penurunan "belum terhubung" harus sama dengan jumlah log.
  if v_before - v_after <> v_logged then
    raise exception 'STOP: verifikasi gagal — belum-terhubung turun %, log %. Tidak ada yang ditulis (satu transaksi).', v_before - v_after, v_logged;
  end if;

  if v_logged <> 45 then
    raise exception 'STOP: tautan yang ditulis % baris, seharusnya 45. Tidak ada yang ditulis (satu transaksi).', v_logged;
  end if;

  -- (i) Tandai review sudah diterapkan.
  update public.upah_project_link_review
     set status = 'applied', updated_at = now()
   where status = 'decided'
     and decision = 'approved'
     and master_project_id is not null;

  raise notice 'BATCH %: % tautan ditulis. Belum terhubung % -> %', v_batch, v_logged, v_before, v_after;
end $$;

-- 6.2  Ringkasan per batch (harus 1 baris: mapping-20261026 = 45).
select batch, count(*) as baris, min(at) as mulai, max(at) as selesai
from public.upah_project_link_log
group by batch
order by mulai;

-- 6.3  Sepuluh baris log terakhir (bukti old_project_id / decided_by).
select upah_project_id, old_project_id, new_project_id, method, decided_by, sumber, at
from public.upah_project_link_log
where batch = 'mapping-20261026'
order by id desc
limit 10;

-- 6.4  Hitungan baris setelah batch (harus: total 57, terhubung 45, belum 12).
select count(*)                                      as total,
       count(*) filter (where project_id is not null) as terhubung,
       count(*) filter (where project_id is null)     as belum_terhubung
from public.upah_projects;

commit;
```

**Hasil yang diharapkan.**

- `NOTICE: BATCH mapping-20261026: 45 tautan ditulis. Belum terhubung 57 -> 12`
- `PASTE 6.2`: **satu** baris — `mapping-20261026 | 45`.
- `PASTE 6.3`: 10 baris log terakhir, `decided_by = DAT`, `sumber = excel-20261026`,
  `old_project_id` kosong (belum pernah tertaut).
- `PASTE 6.4`: `total = 57`, `terhubung = 45`, `belum_terhubung = 12`.

Kalau PASTE 6 dijalankan dua kali, yang kedua hanya memberi
`NOTICE: BATCH …: sudah pernah diterapkan (45 tautan applied). Tidak ada yang dikerjakan ulang.`
— tidak ada tautan ganda, tidak ada log ganda.

**Kalau gagal → stop & catat.** Tidak ada yang ditulis kalau salah satu guard menolak
(satu transaksi). Pesan dan artinya:

| Pesan | Arti | Tindakan |
|---|---|---|
| `STOP: pilot [83] harus tepat 1 baris approved` | baris 83 tidak/kembar di antrian | cek PASTE 4.12/4.11, lapor |
| `STOP: pilot [83] total upah = X, seharusnya 9230000` | baris live bukan proyek yang sama dengan snapshot | **STOP**, jangan batch, lapor Brooklyn |
| `STOP: baris siap tulis = 42, seharusnya 45` | PASTE 5 belum dijalankan | jalankan PASTE 5, lalu ulangi PASTE 6 |
| `STOP: sudah ada N baris berstatus applied` | proses pernah berjalan sebagian | jalankan PASTE R, lalu ulangi PASTE 4–6 |
| `STOP: N baris approved tanpa master_project_id` | ada tujuan yang kosong | lengkapi lewat PASTE 5 / PASTE 4 |
| `STOP: N baris akan MENIMPA tautan lama` | ada baris yang sudah punya `project_id` lain | **STOP**, bandingkan dengan A1c, lapor sebelum memutuskan |
| `STOP: N baris belum punya decision` | PASTE 4 belum lengkap | ulangi PASTE 4 |
| `STOP: verifikasi gagal — belum-terhubung turun X, log Y` | log dan tabel tidak sinkron | **STOP**, lapor; tidak ada yang ditulis |
| `STOP: tautan yang ditulis N baris, seharusnya 45` | ada baris yang sudah tertaut ke tujuan yang sama | cek A1c; kalau memang sudah benar, lapor sebelum melanjutkan |

Catat di laporan: PASTE 6, NOTICE yang muncul, dan output 6.2/6.4.

---

## PASTE 7 — Verifikasi penuh + view Project Finance + pilot `[83]`

**Tujuan.** Membuktikan angka modul tidak berubah, semua tautan sah, pilot `[83]` tetap
Rp 9.230.000, dan menyiapkan empat view agregasi untuk blok "Upah tercatat" di Project Finance.

```sql
-- ============================================================
-- PASTE 7a — LEMBAR LULUS (satu baris, semua kolom harus TRUE)
-- Kalau ada satu saja yang FALSE: JANGAN lanjut ke PASTE 7b.
-- Jalankan PASTE R (rollback), lalu laporkan angka yang muncul.
-- ============================================================
with c as (
  select * from public.upah_mapping_control order by id desc limit 1
),
per_proyek as (
  select up.id, up.project_id,
         coalesce(up.total_manual, it.total_rincian, 0) as total
  from public.upah_projects up
  left join (select project_id, sum(upah_rincian) as total_rincian
               from public.upah_items group by project_id) it on it.project_id = up.id
),
v1 as (
  select sum(total)                                              as total_modul,
         sum(total) filter (where project_id is not null)         as terhubung,
         sum(total) filter (where project_id is null)             as belum,
         sum(total) - sum(total) filter (where project_id is not null)
                    - sum(total) filter (where project_id is null) as selisih
  from per_proyek
),
v2 as (
  select count(*)                                       as total,
         count(*) filter (where project_id is not null)  as terhubung,
         count(*) filter (where project_id is null)      as belum
  from public.upah_projects
),
v3 as (
  select count(*) as orphan
  from public.upah_projects up
  left join public.projects p on p.id = up.project_id
  where up.project_id is not null and p.id is null
),
live as (
  select count(*) as jumlah_proyek,
         (select count(*) from public.upah_items) as jumlah_item,
         (select coalesce(sum(upah_rincian), 0) from public.upah_items) as total_rincian,
         (select coalesce(sum(total_manual), 0) from public.upah_projects) as total_manual,
         (select coalesce(sum(coalesce(up.total_manual, it.total_rincian, 0)), 0)
            from public.upah_projects up
            left join (select project_id, sum(upah_rincian) as total_rincian
                         from public.upah_items group by project_id) it on it.project_id = up.id) as total_hak,
         (select count(*) from public.upah_kasbon) as jumlah_kasbon,
         (select coalesce(sum(nominal), 0) from public.upah_kasbon) as total_kasbon,
         (select count(*) from public.upah_totalan) as jumlah_totalan,
         (select coalesce(sum(pembayaran_aktual), 0) from public.upah_totalan) as total_pembayaran
  from public.upah_projects
),
v6 as (
  select count(*) filter (where selisih <> 0) as item_gagal
  from (
    select 'jumlah_proyek' as item, live.jumlah_proyek::numeric - c.jumlah_proyek::numeric as selisih from c, live
    union all select 'jumlah_item', live.jumlah_item - c.jumlah_item from c, live
    union all select 'total_rincian', live.total_rincian - c.total_rincian from c, live
    union all select 'total_manual', live.total_manual - c.total_manual from c, live
    union all select 'total_hak', live.total_hak - c.total_hak from c, live
    union all select 'jumlah_kasbon', live.jumlah_kasbon - c.jumlah_kasbon from c, live
    union all select 'total_kasbon', live.total_kasbon - c.total_kasbon from c, live
    union all select 'jumlah_totalan', live.jumlah_totalan - c.jumlah_totalan from c, live
    union all select 'total_pembayaran', live.total_pembayaran - c.total_pembayaran from c, live
  ) x
),
pilot as (
  select coalesce(up.total_manual, it.total_rincian, 0) as total
  from public.upah_projects up
  join public.projects p on p.id = up.project_id
  left join (select project_id, sum(upah_rincian) as total_rincian
               from public.upah_items group by project_id) it on it.project_id = up.id
  where p.kode = '83'
)
select (select selisih = 0 from v1)                 as lulus_rekonsiliasi_selisih_0,
       (select terhubung = 45 from v2)              as lulus_terhubung_45,
       (select belum = 12 from v2)                  as lulus_belum_terhubung_12,
       (select orphan = 0 from v3)                  as lulus_orphan_0,
       (select item_gagal = 0 from v6)              as lulus_kontrol_step0_9_item,
       (select total = 9230000 from pilot)          as lulus_pilot_83_9230000,
       (select count(*) = 1 from pilot)             as lulus_pilot_tepat_1_baris,
       (select total_modul from v1)                 as total_modul,
       (select terhubung from v1)                   as rupiah_terhubung,
       (select belum from v1)                       as rupiah_belum_terhubung;

-- ============================================================
-- PASTE 7b — VERIFIKASI RINCI (READ-ONLY)
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

-- ============================================================
-- PASTE 7c — PILOT [83] Josh - Mabes (baca ulang setelah batch)
-- Harus TEPAT 1 baris, kode 83, total_upah = 9230000.
-- ============================================================
select p.kode, p.name as master, up.project_name as nama_snapshot,
       coalesce(up.total_manual, it.total_rincian, 0) as total_upah,
       up.project_id, up.updated_at
from public.upah_projects up
join public.projects p on p.id = up.project_id
left join (select project_id, sum(upah_rincian) as total_rincian
             from public.upah_items group by project_id) it on it.project_id = up.id
where p.kode = '83';

-- ============================================================
-- PASTE 7d — VIEW PROJECT FINANCE (A7) (A7)
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

`PASTE 7a` — **lembar lulus**, satu baris, **semua kolom harus `t`**:

| Kolom | Arti | Harus |
|---|---|---|
| `lulus_rekonsiliasi_selisih_0` | total modul = terhubung + belum | `t` |
| `lulus_terhubung_45` | 45 baris punya `project_id` | `t` |
| `lulus_belum_terhubung_12` | 12 baris tetap NULL (6 TUNDA + 6 jasa) | `t` |
| `lulus_orphan_0` | tidak ada tautan ke master yang hilang | `t` |
| `lulus_kontrol_step0_9_item` | 9 angka kontrol STEP 0 tidak berubah | `t` |
| `lulus_pilot_83_9230000` | total upah proyek 83 | `t` |
| `lulus_pilot_tepat_1_baris` | 83 hanya satu baris | `t` |

Nilai pendamping: `total_modul` = angka kontrol STEP 0 (snapshot **Rp 530.256.600**),
`rupiah_terhubung` + `rupiah_belum_terhubung` = `total_modul` (snapshot: 511.102.350 + 19.154.250).

`PASTE 7b` — rincian:

| Cek | Harus |
|---|---|
| V1 rekonsiliasi | `selisih = 0` |
| V2 jumlah baris | `total 57`, `terhubung 45`, `belum_terhubung 12` |
| V2 status review | `applied/approved 45`, `decided/rejected 12` |
| V3 orphan | `0` |
| V4 satu master dipakai beberapa proyek upah | laporan, **bukan error**: `75` (2 baris: `Cove 2 - 27` + `Project Cove 2 - 27`) dan `95` (2 baris: `Project Barbershop` + `Project Barbershop Pekayon`) |
| V5 totalan final | laporan proyek yang ikut totalan terkunci |
| V6 angka kontrol | **9 baris, semua `selisih = 0`** |
| V7 sisa belum terhubung | **12 baris**: #14, #15, #22, #29, #37, #43 + 6 jasa |

`PASTE 7c` — pilot: **tepat 1 baris**, `kode = 83`, `master = Josh - Mabes`,
`total_upah = 9230000`, `project_id` terisi.

`PASTE 7d` — view: **4 view** terdaftar (`v_upah_kasbon_allocation`, `v_upah_totalan_allocation`,
`v_upah_project_finance`, `v_upah_kasbon_unallocated`); isi `v_upah_project_finance`
**43 baris** (45 tautan, tapi 2 master dipakai 2 baris upah); proyek `83` tampil
`saldo_status = 'belum_teralokasi'` — **itu benar** (ikut totalan lintas proyek), bukan error.

**Kalau gagal → stop & catat.**

- Ada satu `false` di 7a → **jangan** memperbaiki manual. Jalankan **PASTE R**, lalu laporkan
  kolom mana yang `false` beserta angkanya.
- V1 ≠ 0 → ada baris hilang/tergandakan. Rollback, lapor.
- V3 > 0 → tautan ke master yang tidak ada. Rollback, lapor.
- V6 ada selisih ≠ 0 → ada perubahan di luar mapping (mis. admin mengedit saat proses).
  Rollback, selidiki penyebabnya — jangan diabaikan.
- V2 `terhubung` ≠ 45 atau `belum` ≠ 12 → rollback, lapor.
- Pilot ≠ 9.230.000 → rollback, lapor (baris live bukan proyek yang sama dengan snapshot).
- `ERROR: relation "v_upah_project_actual" does not exist` → PASTE 2 belum sukses. Ulangi PASTE 2.
- `ERROR: syntax error at or near "security_invoker"` → Postgres < 15. Laporkan versinya.

Catat di laporan: PASTE 7, seluruh kolom 7a, output V1–V7, hasil 7c, dan daftar 4 view.

---

## PASTE R — Rollback (hanya kalau PASTE 7 tidak lulus)

**Tujuan.** Mengembalikan seluruh `project_id` yang ditulis batch `mapping-20261026` ke nilai
sebelumnya memakai `old_project_id` di log — tanpa menyentuh baris, item, kasbon, totalan,
atau master.

```sql
-- ============================================================
-- PASTE R — ROLLBACK (hanya kalau PASTE 7 tidak lulus)
-- Tujuan: mengembalikan upah_projects.project_id ke keadaan sebelum
--         batch 'mapping-20261026', memakai old_project_id di log.
-- Sifat : MENULIS upah_projects.project_id (kembali ke nilai lama).
--         Baris, item, kasbon, totalan, dan master TIDAK disentuh.
-- Aman diulang: baris yang sudah kembali ke nilai lama dilewati.
-- ============================================================
begin;

do $$
declare
  v_batch    text := 'mapping-20261026';
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

-- R.2  Bukti setelah rollback (harus kembali: terhubung 0, belum 57).
select count(*)                                       as total,
       count(*) filter (where project_id is not null)  as terhubung,
       count(*) filter (where project_id is null)      as belum_terhubung
from public.upah_projects;

-- R.3  OPSIONAL — hapus 3 master yang dibuat PASTE 5, HANYA kalau benar-benar
--      ingin kembali ke keadaan awal. Hapus tanda komentar di 4 baris berikut.
--      Aman: hanya menghapus kalau TIDAK ada upah_projects yang menunjuk ke sana.
-- delete from public.projects p
--  where lower(btrim(p.kode)) in ('73a', '73b', '90b')
--    and not exists (select 1 from public.upah_projects up where up.project_id = p.id);

commit;
```

**Hasil yang diharapkan.**

- `NOTICE: ROLLBACK mapping-20261026: 45 baris dikembalikan ke tautan sebelumnya`
- `PASTE R.2`: `total 57`, `terhubung 0`, `belum_terhubung 57` (kembali ke keadaan sebelum batch).
- Status review kembali `decided` (bukan `applied`), sehingga PASTE 6 bisa diulang setelah
  masalahnya diperbaiki.
- Tiga master `73A`/`73B`/`90B` **tetap ada** (default). Kalau ingin benar-benar kembali ke
  keadaan awal, hapus tanda komentar di blok R.3 — blok itu hanya menghapus master yang
  **tidak** dipakai baris upah mana pun.

**Kalau gagal → stop & catat.**

- `0 baris dikembalikan` → nama batch salah atau log kosong. Cek
  `select batch, count(*) from public.upah_project_link_log group by 1;` lalu laporkan.
- Setelah rollback, `belum_terhubung` ≠ 57 → ada tautan yang dibuat **di luar** batch ini
  (mis. lewat UI). Itu bukan kerusakan; catat barisnya dan laporkan sebelum mengulang.

---

## Lampiran A — 57 baris keputusan (yang tertanam di SQL PASTE 4)

Tabel ini **identik** dengan blok `insert into dat_keputusan …` di PASTE 4. Kalau ada baris di
sini yang tidak ada di SQL (atau sebaliknya), SQL-nya tidak utuh — salin ulang.

| # | Tukang | Nama di modul (snapshot) | Kategori | Aksi | Target |
|---|---|---|---|---|---|
| 1 | asep | Santi - Baroni Utara 1/87 | A | tautkan | `99` |
| 2 | pujon | Project Intercon | A | tautkan | `49` |
| 3 | pujon | Project Cosmos | C | tautkan | `47` |
| 4 | pujon | Project Radio Dalam | A | tautkan | `52` |
| 5 | pujon | Project Jessie | A | tautkan | `21` |
| 6 | pujon | Project Sunter Hijau 8 | D | tautkan | `54` |
| 7 | pujon | Project Cendana Icon | A | tautkan | `17` |
| 8 | pujon | Project Park Serpong | A | tautkan | `53` |
| 9 | pujon | Project Gatsu | A | tautkan | `57` |
| 10 | pujon | Project Duren Sawit | A | tautkan | `55` |
| 11 | pujon | Project Meranti | A | tautkan | `58` |
| 12 | pujon | Project Nerin 1 | D | tautkan | `59` |
| 13 | pujon | Project Nerin 5 | D | tautkan | `60` |
| 14 | pujon | Project Park Serpong - Cendana | D | biarkan NULL | — |
| 15 | pujon | Project Rosini - | D | biarkan NULL | — |
| 16 | pujon | Service Park Serpong | E | non-proyek | — |
| 17 | pujon | Service Tokyo | E | non-proyek | — |
| 18 | pujon | Service TA | E | non-proyek | — |
| 19 | pujon | Service Bintaro | E | non-proyek | — |
| 20 | pujon | Project Barbershop | D | tautkan | `95` |
| 21 | pujon | Project Dulcet | A | tautkan | `63` |
| 22 | pujon | Project Flaminggo | C | biarkan NULL | — |
| 23 | pujon | Project Casa de Parco | A | tautkan | `66` |
| 24 | pujon | Project Sunter Hijau Utama | D | tautkan | `68` |
| 25 | pujon | Everbeau | D | tautkan *(+master baru)* | `73B` |
| 26 | pujon | Cityzen North 3 -17 | A | tautkan | `74` |
| 27 | pujon | Cove 2 - 27 | A | tautkan | `75` |
| 28 | pujon | Cove 2 - 76 | A | tautkan | `76` |
| 29 | pujon | Park Serpong 9 - 15 | D | biarkan NULL | — |
| 30 | pujon | Osaka PIK | A | tautkan | `79` |
| 31 | pujon | Servis | E | non-proyek | — |
| 32 | pujon | Park Serpong Flo 7 -66 | B | tautkan | `78a` |
| 33 | pujon | Barbershop HI - 2 | A | tautkan | `71` |
| 34 | pujon | Project Apt Baywalk | B | tautkan | `72a` |
| 35 | pujon | Project Cisauk | A | tautkan | `70` |
| 36 | pujon | Peak Springhill | B | tautkan | `69a` |
| 37 | pujon | Project Pademangan | D | biarkan NULL | — |
| 38 | pujon | Project Barbershop Pintu | D | tautkan | `64` |
| 39 | pujon | Project Skyhouse BSD | B | tautkan | `81a` |
| 40 | pujon | Project Charm 23 - 56 | B | tautkan | `80a` |
| 41 | pujon | Project Cove 2 - 27 | A | tautkan | `75` |
| 42 | pujon | Cendana Botanic | D | tautkan *(+master baru)* | `90B` |
| 43 | pujon | Project Springhill | D | biarkan NULL | — |
| 44 | pujon | Servisan 2 | E | non-proyek | — |
| 45 | pujon | Project Bekasi | A | tautkan | `88` |
| 46 | pujon | Project Panola | A | tautkan | `92` |
| 47 | pujon | Project Semanan | A | tautkan | `87` |
| 48 | pujon | Project Rempoa | A | tautkan | `85` |
| 49 | pujon | Project Barbershop Pekayon | A | tautkan | `95` |
| 50 | pujon | Project Leo Sunter | A | tautkan | `96` |
| 51 | pujon | Project Cove 2-21 | A | tautkan | `89` |
| 52 | pujon | Project Steffi | B | tautkan | `90` |
| 53 | pujon | Proyek Josh - Mabes | A | tautkan | `83` |
| 54 | pujon | Proyek Sunter Hijau - Eric | A | tautkan | `61` |
| 55 | pujon | Project Reivan Trail 10-20 | A | tautkan | `94` |
| 56 | pujon | Brigitta Cove 12-32 | A | tautkan | `91` |
| 57 | pujon | Project Everbeau - kaca | D | tautkan *(+master baru)* | `73A` |

Rekap: **45 tautan** (29 A + 6 B + 1 C + 6 D langsung + 3 D lewat master baru) ·
**6 NULL** (#14, #15, #22, #29, #37, #43) · **6 non-proyek** (#16–#19, #31, #44).

---

## Lampiran B — objek database yang dibuat/diubah paket ini

| Objek | Jenis | Dibuat di | Isi | Setelah selesai |
|---|---|---|---|---|
| `upah_projects.project_id` | kolom + FK + index | PASTE 2 | relasi ke master | **jangan** di-drop (inti hasil) |
| `v_upah_project_actual`, `v_upah_project_unlinked` | view | PASTE 2 | agregasi + daftar kerja | jangan (dipakai aplikasi) |
| `upah_projects_backup_20261026` | tabel | PASTE 1 | salinan utuh sebelum proses | simpan sebagai arsip |
| `upah_mapping_control` | tabel | PASTE 1 | 9 angka kontrol | boleh (arsip) |
| `upah_mapping_source` | tabel staging | PASTE 3 | 57 baris nomor sheet | boleh (arsip) |
| `upah_project_link_review` | tabel | PASTE 3 | 57 keputusan + jejak audit | **simpan** |
| `upah_project_link_log` | tabel | PASTE 6 | log 45 tautan (`old_project_id`, `batch`, `decided_by`) | **simpan** |
| `upah_proposal_norm(text)` | fungsi | PASTE 3 | normalisasi nama untuk kandidat | boleh |
| `v_upah_kasbon_allocation`, `v_upah_totalan_allocation`, `v_upah_project_finance`, `v_upah_kasbon_unallocated` | view | PASTE 7 | bahan Project Finance (D5) | jangan |
| 3 baris `projects` (`73A`, `73B`, `90B`) | data master | PASTE 5 | proyek yang belum ada di master | jangan (dipakai relasi) |

Tidak ada `DROP`, `DELETE`, atau `UPDATE` ke `upah_items`, `upah_kasbon`, `upah_totalan*`.
Satu-satunya `TRUNCATE` adalah ke `upah_mapping_source` (tabel staging buatan sendiri).
Satu-satunya penulisan ke `projects` adalah 3 baris **baru** di PASTE 5 (tidak mengubah baris lama).

---

## Lampiran C — checklist setelah PASTE 7 lulus

**Modul Upah & Kasbon**

- [ ] Badge "Belum terhubung" = **12** (6 TUNDA + 6 jasa) — **bukan 0**.
- [ ] Proyek `[83] Josh - Mabes` menampilkan badge `[83] Josh - Mabes · ON_GOING`.
- [ ] Edit proyek 83 → selector Project ID terisi → simpan → **reload** → tautan tetap.
- [ ] Proyek yang di-TUNDA (#14, #15, #22, #29, #37, #43) **tetap** "Belum terhubung".
- [ ] Enam baris Service/Servis **tetap** "Belum terhubung" (memang non-proyek).
- [ ] Jumlah item & total per proyek tidak berubah (bandingkan V6).
- [ ] `75` dan `95` masing-masing dipakai 2 baris upah — sah, dua fase.

**Modul Projects**

- [ ] `73A. Everbeau - kaca`, `73B. Everbeau`, `90B. Cendana Botanic` muncul di daftar
      dengan status `ON_GOING` (boleh diubah nama/status kapan pun).

**Project Finance (menyusul — tiket UI D5)**

- [ ] Empat view ada dan bisa dibaca admin.
- [ ] Blok "Upah tercatat" belum tentu tampil: UI-nya dikerjakan di tiket terpisah
      (`docs/mapping-project-finance-ui-spec.md`). Datanya **sudah siap** setelah PASTE 7.
- [ ] Proyek tanpa upah → "belum ada upah tercatat", bukan Rp 0.
- [ ] Proyek dengan totalan lintas proyek → saldo "belum bisa dihitung" (NULL), bukan angka.

**Keamanan**

- [ ] `GET /rest/v1/upah_projects` dengan anon key tetap **401**.
- [ ] Login admin tetap bisa membaca modul.

---

## Lampiran D — kalau DAT ingin mengulang dari nol

1. Rollback tautan: **PASTE R** (`mapping-20261026`). Kalau PASTE R.3 diaktifkan, 3 master
   baru juga dihapus — kalau tidak, master tetap ada dan PASTE 5 hanya akan `INSERT 0 0`.
2. Hapus antrian & keputusan (hanya tabel kerja; `upah_projects` tidak disentuh):
   ```sql
   delete from public.upah_project_link_review;
   ```
3. Ulangi **PASTE 3 → PASTE 7**.

Kalau hanya ingin mengulang **keputusan** (tanpa membatalkan tautan):
```sql
update public.upah_project_link_review
   set decision = null, status = 'suggested', decided_by = null, decided_at = null,
       sumber = null, butuh_master_baru = false, kategori_dat = null, updated_at = now()
 where status = 'decided';
```
lalu ulangi PASTE 4 → 7. (Baris yang sudah `applied` tidak ikut ter-reset — itu disengaja.)

---

## Lampiran E — bukti uji (lokal, PostgreSQL 16.15, bukan Supabase)

Paket ini dijalankan **berurutan dari nol** pada PostgreSQL 16.15 lokal dengan fixture:
96 baris master `projects` (termasuk `64`, `67a`, `69a`, `72a`, `78a`, `80a`, `81a`, `90a`,
1 kode kosong) + 57 baris `upah_projects` (nominal persis snapshot) + item + kasbon + 1 totalan
final lintas proyek.

| # | Uji | Hasil |
|---|---|---|
| 1 | PASTE 1 (A0 + A1a–A1g) | ✅ backup + 1 baris kontrol (57 proyek, hak 530.256.600); A1e 96/1/7/0; A1g 7 tabel. A1c/A1d error 42703 **sebelum** PASTE 2 — sesuai dokumen |
| 2 | PASTE 2 migrasi | ✅ COMMIT; dijalankan **2×** tanpa error (idempotent) |
| 3 | PASTE 3 A2c | ✅ asep 1/1/0/10.345.000 · pujon 56/36/20/519.911.600 · A2c.2/A2c.3 = 0 · A2c.4 selisih 0 |
| 4 | PASTE 3 A4c | ✅ 29 / 6 / 2 / 14 / 6 — total 57, semua `lulus = t` |
| 5 | PASTE 4 | ✅ 42 / 3 / 6 / 6 / 0 / 57 / 57; kategori A29 B6 C1+1 D6+3+5 E6 |
| 6 | PASTE 5 | ✅ `INSERT 0 3`, `UPDATE 3`, 0 menunggu / 45 siap / **99** master |
| 7 | PASTE 6 | ✅ `NOTICE: 45 tautan ditulis. Belum terhubung 57 -> 12`; log 45 baris `decided_by=DAT` |
| 8 | PASTE 6 diulang | ✅ `NOTICE: sudah pernah diterapkan` — 0 tautan baru, log tetap 45 |
| 9 | PASTE 7a | ✅ 7 kolom lulus semua `t`; total 530.256.600 = 511.102.350 + 19.154.250 |
| 10 | PASTE 7b | ✅ V1 selisih 0 · V2 57/45/12 · V3 orphan 0 · V6 9 item selisih 0 · V4 laporan 75 & 95 |
| 11 | PASTE 7c pilot | ✅ tepat 1 baris, `83`, total **9.230.000** |
| 12 | PASTE 7d view | ✅ 4 view; `v_upah_project_finance` 43 baris; 83 `belum_teralokasi` |
| 13 | PASTE R rollback | ✅ 45 baris dikembalikan → terhubung 0 / belum 57 |
| 14 | PASTE 6 setelah rollback | ✅ 45 tautan ditulis ulang (57 → 12) |
| 15 | Guard: master `64` dihapus | ✅ `STOP PASTE 4: kode tujuan tidak ada atau tidak unik … 64 -> 0 baris master` |
| 16 | Guard: PASTE 5 dilewati | ✅ `STOP: baris siap tulis = 42, seharusnya 45` |

Yang **tidak** bisa diuji lokal: RLS Supabase (anon 401), perilaku `security_invoker` dengan
policy admin-only, dan angka `upah_projects` yang sebenarnya. Ketiganya diverifikasi di live
oleh PASTE 1, PASTE 3, dan Lampiran C.
