-- UJI SELF-CLEANING (ROLLBACK) — ledger serah terima di database produksi.
-- Tidak ada satu baris pun yang tersimpan: seluruh blok di-ROLLBACK di akhir.
begin;

select set_config('request.jwt.claims',
  json_build_object('sub', (select id::text from profiles where role='admin' order by created_at limit 1),
                    'role','authenticated')::text, true);

do $$
declare
  v_uid uuid := (current_setting('request.jwt.claims',true)::json->>'sub')::uuid;
  v_proj uuid; v_mat uuid; v_pr uuid; v_pi uuid; v_rec uuid; v_ri uuid;
  r jsonb; st1 numeric; st2 numeric; cost numeric; n int;
begin
  if v_uid is null then raise exception 'Tidak ada akun admin untuk simulasi'; end if;

  insert into projects(id,name,status) values (gen_random_uuid(),'ZZ TEST SERAH TERIMA','ON_GOING') returning id into v_proj;
  insert into materials(id,name,kode,satuan,current_stock) values (gen_random_uuid(),'ZZ TEST MATERIAL','ZZ-0001','Lembar',0) returning id into v_mat;
  insert into purchase_requests(id,pr_number,project_id,status,title) values (gen_random_uuid(),'ZZ-PR-TEST',v_proj,'DRAFT','ZZ TEST') returning id into v_pr;
  insert into pr_items(id,pr_id,material_id,quantity,unit,item_name,status) values (gen_random_uuid(),v_pr,v_mat,5,'Lembar','ZZ TEST ITEM','APPROVED') returning id into v_pi;
  update purchase_requests set status='SUBMITTED' where id=v_pr;
  insert into receivings(id,purchase_request_id,status,invoice_no,note,project_id) values (gen_random_uuid(),v_pr,'DIBELI','ZZ-INV-1','[Tahap: DIBELI]',v_proj) returning id into v_rec;
  insert into receiving_items(id,receiving_id,pr_item_id,item_name,quantity_received,unit,note) values (gen_random_uuid(),v_rec,v_pi,'ZZ TEST ITEM',5,'Lembar','[Harga: 20000]') returning id into v_ri;

  -- 1) masuk gudang 3 dari 5
  r := ops_transfer_apply('zz-test-in','PURCHASE',v_ri,null,'GUDANG',3,null,null);
  if not (r->>'ok')::boolean then raise exception 'GAGAL intake gudang: %', r::text; end if;
  select current_stock into st1 from materials where id=v_mat;
  if st1 <> 3 then raise exception 'stok salah setelah intake: %', st1; end if;

  -- 2) replay event yang sama -> idempoten, stok tidak dobel
  r := ops_transfer_apply('zz-test-in','PURCHASE',v_ri,null,'GUDANG',3,null,null);
  if not (r->>'already')::boolean then raise exception 'replay tidak idempoten: %', r::text; end if;
  select current_stock into st1 from materials where id=v_mat;
  if st1 <> 3 then raise exception 'replay menggandakan stok: %', st1; end if;

  -- 3) ambil dari gudang 2 -> tukang (biaya proyek)
  r := ops_transfer_apply('zz-test-out','WAREHOUSE',null,v_mat,'TUKANG',2,v_proj,'ZZ Tester');
  if not (r->>'ok')::boolean then raise exception 'GAGAL penarikan: %', r::text; end if;
  select current_stock into st2 from materials where id=v_mat;
  if st2 <> 1 then raise exception 'stok salah setelah penarikan: %', st2; end if;
  select coalesce(sum(project_cost),0) into cost from ops_transfers where project_id=v_proj;
  if cost <> 40000 then raise exception 'project cost salah: %', cost; end if;

  -- 4) overdraw harus ditolak
  r := ops_transfer_apply('zz-test-over','WAREHOUSE',null,v_mat,'TUKANG',5,v_proj,'ZZ Tester');
  if (r->>'ok')::boolean then raise exception 'overdraft DIIZINKAN (bug)'; end if;
  select current_stock into st1 from materials where id=v_mat;
  if st1 <> 1 then raise exception 'overdraft mengubah stok: %', st1; end if;

  -- 5) serah ke tukang langsung dari pembelian (sisa 2)
  r := ops_transfer_apply('zz-test-direct','PURCHASE',v_ri,null,'TUKANG',2,v_proj,'ZZ Tester');
  if not (r->>'ok')::boolean then raise exception 'GAGAL direct issue: %', r::text; end if;

  -- 6) melebihi qty pembelian harus ditolak
  r := ops_transfer_apply('zz-test-extra','PURCHASE',v_ri,null,'GUDANG',1,null,null);
  if (r->>'ok')::boolean then raise exception 'overdistribution DIIZINKAN (bug)'; end if;

  -- 7) penerima kosong harus ditolak
  r := ops_transfer_apply('zz-test-norecv','WAREHOUSE',null,v_mat,'TUKANG',1,v_proj,'   ');
  if (r->>'ok')::boolean then raise exception 'penerima kosong DIIZINKAN (bug)'; end if;

  -- 8) PR submitted terkunci (trigger poin 1)
  begin
    update pr_items set quantity=99 where id=v_pi;
    raise exception 'PR submitted MASIH BISA diedit (trigger tidak jalan)';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%terkunci%' then raise; end if;
  end;

  select count(*) into n from ops_transfers where event_key like 'zz-test-%';
  raise notice 'PASS: intake %, replay idempoten, penarikan, cost %, overdraft ditolak, direct issue, overdistribution ditolak, penerima wajib, PR terkunci. Baris ledger uji: %', st2, cost, n;
end $$;

-- tampilkan ringkasan sebelum rollback
select 'hasil_uji' as cek, count(*) as baris_ledger from ops_transfers where event_key like 'zz-test-%';

rollback;
