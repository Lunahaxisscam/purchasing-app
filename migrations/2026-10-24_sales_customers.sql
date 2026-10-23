-- ============================================================
-- Tahap 1 Alur Penjualan — CUSTOMER CRM (24 Okt 2026)
-- ============================================================
-- Keputusan DAT:
--   * Customer cukup: nama, WA, status (PROSPEK | CUSTOMER).
--   * 1 customer boleh punya BANYAK project, tetap SATU akun customer.
--     Karena itu relasi disimpan di sisi `projects.customer_id`, BUKAN
--     kolom project di tabel customer.
--   * Prospek berubah jadi CUSTOMER saat invoice DITERBITKAN (dilakukan
--     aplikasi pada Tahap 3; kolom `customer_since` sudah disiapkan di sini
--     supaya tidak perlu migrasi lagi).
--
-- Sifat migrasi: ADITIF. Tidak ada kolom/tabel lama yang diubah atau dihapus.
-- `projects.customer_id` memakai ON DELETE SET NULL: menghapus customer tidak
-- boleh menghapus proyek yang sudah punya riwayat pembelian/upah.
-- ============================================================
begin;

create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  nama           text not null,
  wa             text,
  status         text not null default 'PROSPEK',
  customer_since timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint customers_status_check check (status in ('PROSPEK', 'CUSTOMER')),
  constraint customers_nama_check check (nullif(btrim(nama), '') is not null)
);

-- WA dinormalkan di aplikasi (hanya digit, 62 -> 0) supaya "0812-345",
-- "62812 345", dan "+62 812 345" dianggap sama saat mencari duplikat.
create index if not exists customers_nama_idx on public.customers (lower(btrim(nama)));
create index if not exists customers_status_idx on public.customers (status);

alter table public.projects
  add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists projects_customer_idx on public.projects (customer_id);

-- updated_at otomatis
create or replace function public.fn_customers_touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  -- customer_since diisi SEKALI saat status pertama kali jadi CUSTOMER.
  if new.status = 'CUSTOMER' and new.customer_since is null then
    new.customer_since := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_customers_touch on public.customers;
create trigger trg_customers_touch
  before update on public.customers
  for each row execute function public.fn_customers_touch_updated_at();

drop trigger if exists trg_customers_touch_ins on public.customers;
create trigger trg_customers_touch_ins
  before insert on public.customers
  for each row execute function public.fn_customers_touch_updated_at();

-- ------------------------------------------------------------
-- RLS: hanya user login (admin & user internal) yang boleh baca.
-- Tulis lewat aplikasi (authenticated) — modul CRM admin-only di UI,
-- tetapi RLS tetap penjaga terakhir: anon TIDAK boleh apa pun.
-- ------------------------------------------------------------
alter table public.customers enable row level security;

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated using (auth.uid() is not null);

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert to authenticated with check (auth.uid() is not null);

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers
  for delete to authenticated using (auth.uid() is not null);

revoke all on public.customers from anon;
grant select, insert, update, delete on public.customers to authenticated;

commit;
