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
