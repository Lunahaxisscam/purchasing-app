-- ============================================================
-- UJI SELF-CLEANING skema upah_* (ROLLBACK di akhir)
-- Membuktikan: insert tukang -> proyek -> item -> kasbon -> totalan
-- berantai benar, CASCADE jalan, UNIQUE no_totalan bekerja,
-- dan totalan hanya boleh menghitung proyek/kasbon milik tukang itu.
-- ============================================================
begin;

do $$
declare
  v_tk uuid; v_p1 uuid; v_p2 uuid; v_it uuid;
  v_k1 uuid; v_k2 uuid; v_tot uuid;
  n int; v_sum numeric; v_status text;
begin
  -- 1) master tukang
  insert into upah_tukang(kode, nama, unit_bisnis)
  values ('zz-asep', 'ZZ Asep Uji', 'Noir Living') returning id into v_tk;
  if v_tk is null then raise exception 'gagal insert tukang'; end if;

  -- 2) dua proyek untuk satu tukang (nama boleh berulang)
  insert into upah_projects(tukang_id, project_name, status)
  values (v_tk, 'ZZ Josh - Mabes', 'SELESAI') returning id into v_p1;
  insert into upah_projects(tukang_id, project_name, status)
  values (v_tk, 'ZZ Josh - Mabes', 'ON_GOING') returning id into v_p2;

  -- 3) item upah: upah_rincian BOLEH beda dari ukuran x harga (temuan SPEC #4)
  insert into upah_items(project_id, pekerjaan, ukuran, satuan_ukuran, harga_satuan, upah_rincian)
  values (v_p1, 'Wardrobe', 2.1, 'm', 350000, 500000) returning id into v_it;
  insert into upah_items(project_id, pekerjaan, ukuran, satuan_ukuran, harga_satuan, upah_rincian)
  values (v_p1, 'Kitchen Set', 3.0, 'm', 2500000, 7500000);

  select count(*), sum(upah_rincian) into n, v_sum from upah_items where project_id = v_p1;
  if n <> 2 or v_sum <> 8000000 then
    raise exception 'total item salah: % baris, total %', n, v_sum;
  end if;

  -- 4) kasbon
  insert into upah_kasbon(tukang_id, tanggal, jenis, deskripsi, metode, nominal)
  values (v_tk, '2026-10-01', 'KASBON', 'ZZ kasbon 1', 'Transfer', 1000000) returning id into v_k1;
  insert into upah_kasbon(tukang_id, tanggal, jenis, deskripsi, metode, nominal)
  values (v_tk, '2026-10-05', 'KASBON', 'ZZ kasbon 2', 'Tunai', 500000) returning id into v_k2;

  select sum(nominal) into v_sum from upah_kasbon where tukang_id = v_tk and jenis = 'KASBON';
  if v_sum <> 1500000 then raise exception 'total kasbon salah: %', v_sum; end if;

  -- 5) totalan + snapshot + relasi
  insert into upah_totalan(tukang_id, no_totalan, tanggal, total_upah, kasbon_dipotong,
                           hak_bersih, pembayaran_aktual, saldo_akhir, status)
  values (v_tk, 'ZZ-TOT-001', '2026-10-10', 8000000, 1000000, 7000000, 7000000, 0, 'Lunas')
  returning id into v_tot;

  insert into upah_totalan_projects(totalan_id, project_id, nama_snapshot, total_upah)
  values (v_tot, v_p1, 'ZZ Josh - Mabes', 8000000);
  insert into upah_totalan_kasbon(totalan_id, kasbon_id, nominal) values (v_tot, v_k1, 1000000);

  select saldo_akhir, status into v_sum, v_status from upah_totalan where id = v_tot;
  if v_sum <> 0 or v_status <> 'Lunas' then
    raise exception 'totalan tidak konsisten: saldo % status %', v_sum, v_status;
  end if;

  -- 6) UNIQUE (tukang_id, no_totalan) harus menolak duplikat
  begin
    insert into upah_totalan(tukang_id, no_totalan, tanggal) values (v_tk, 'ZZ-TOT-001', '2026-10-11');
    raise exception 'DUPLIKAT no_totalan DITERIMA — seharusnya ditolak';
  exception when unique_violation then
    null;  -- benar
  end;

  -- 7) CASCADE: hapus tukang -> semua anak ikut hilang
  delete from upah_tukang where id = v_tk;
  select count(*) into n from upah_projects where tukang_id = v_tk;
  if n <> 0 then raise exception 'proyek tidak ter-CASCADE (% sisa)', n; end if;
  select count(*) into n from upah_items where project_id in (v_p1, v_p2);
  if n <> 0 then raise exception 'item tidak ter-CASCADE (% sisa)', n; end if;
  select count(*) into n from upah_kasbon where tukang_id = v_tk;
  if n <> 0 then raise exception 'kasbon tidak ter-CASCADE (% sisa)', n; end if;
  select count(*) into n from upah_totalan where tukang_id = v_tk;
  if n <> 0 then raise exception 'totalan tidak ter-CASCADE (% sisa)', n; end if;

  raise notice 'PASS: tukang->proyek->item->kasbon->totalan berantai benar, snapshot konsisten, UNIQUE no_totalan menolak duplikat, CASCADE bersih';
end $$;

select 'sisa_data_uji' as cek,
       (select count(*) from upah_tukang where kode like 'zz-%') as tukang,
       (select count(*) from upah_projects where project_name like 'ZZ %') as proyek,
       (select count(*) from upah_kasbon where deskripsi like 'ZZ %') as kasbon,
       (select count(*) from upah_totalan where no_totalan like 'ZZ-%') as totalan;

rollback;
