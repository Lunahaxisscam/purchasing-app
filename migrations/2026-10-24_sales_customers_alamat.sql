-- ============================================================
-- Tambah kolom ALAMAT pada customers (24 Okt 2026)
-- ============================================================
-- Alasan: data customer lama (Client_Database.xlsx) memuat alamat proyek.
-- Keputusan DAT: alamat DISIMPAN (bukan dibuang) supaya data lama tidak hilang.
-- Migrasi ADITIF: hanya menambah satu kolom nullable.
-- ============================================================
begin;

alter table public.customers
  add column if not exists alamat text;

comment on column public.customers.alamat is
  'Alamat proyek / lokasi customer. Opsional — boleh kosong untuk prospek baru.';

commit;
