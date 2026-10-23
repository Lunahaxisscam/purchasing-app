-- AKTIVASI 24 Okt 2026 — atas keputusan DAT: poin 1 (kunci PR) DIIZINKAN,
-- poin 2 (trigger batas beli) dan poin 3 (kebijakan nilai stok lama) DILEWATI.
-- Turunan langsung dari 2026-10-23_compact_ops_flow.DRAFT.sql tanpa bagian
-- `compact_purchase_pr_guard` (trigger pada receiving_items).
-- Aditif: tidak mengubah kolom/tabel lama. Rollback ada di
-- docs/compact-flow-activation-checklist.md §7.
-- Inventory uses purchase-cost FIFO lots; unknown historic stock is not silently valued.
begin;
create table if not exists public.ops_transfers (
 id uuid primary key default gen_random_uuid(), event_key text not null unique,
 source text not null check(source in ('PURCHASE','WAREHOUSE')),
 receiving_item_id uuid references public.receiving_items(id) on delete restrict,
 material_id uuid references public.materials(id) on delete restrict,
 destination text not null check(destination in ('GUDANG','TUKANG')),
 quantity numeric not null check(quantity>0), unit text,
 project_id uuid references public.projects(id) on delete restrict, receiver text,
 stock_value numeric not null default 0, project_cost numeric not null default 0,
 created_by uuid not null, created_at timestamptz not null default now(),
 check(destination<>'TUKANG' or (project_id is not null and nullif(btrim(receiver),'') is not null)),
 check(source<>'WAREHOUSE' or (destination='TUKANG' and material_id is not null)),
 check(source<>'PURCHASE' or receiving_item_id is not null)
);
create table if not exists public.ops_stock_lots (
 id uuid primary key default gen_random_uuid(), transfer_id uuid not null unique references public.ops_transfers(id) on delete restrict,
 material_id uuid not null references public.materials(id) on delete restrict,
 remaining numeric not null check(remaining>=0), unit_cost numeric not null check(unit_cost>=0),
 created_at timestamptz not null default now()
);
create table if not exists public.ops_stock_allocations (
 transfer_id uuid not null references public.ops_transfers(id) on delete restrict,
 lot_id uuid not null references public.ops_stock_lots(id) on delete restrict,
 quantity numeric not null check(quantity>0), unit_cost numeric not null,
 primary key(transfer_id,lot_id)
);
alter table public.ops_transfers enable row level security;
alter table public.ops_stock_lots enable row level security;
alter table public.ops_stock_allocations enable row level security;
revoke all on public.ops_transfers,public.ops_stock_lots,public.ops_stock_allocations from anon,authenticated;
grant select on public.ops_transfers,public.ops_stock_lots,public.ops_stock_allocations to authenticated;
drop policy if exists ops_transfer_read on public.ops_transfers;
create policy ops_transfer_read on public.ops_transfers for select to authenticated using(auth.uid() is not null);
drop policy if exists ops_lot_read on public.ops_stock_lots;
create policy ops_lot_read on public.ops_stock_lots for select to authenticated using(auth.uid() is not null);
drop policy if exists ops_alloc_read on public.ops_stock_allocations;
create policy ops_alloc_read on public.ops_stock_allocations for select to authenticated using(auth.uid() is not null);

create or replace function public.pr_return_for_revision(p_pr_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.purchase_requests%rowtype;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','Silakan login.'); end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>300 then return jsonb_build_object('ok',false,'error','Alasan revisi wajib, maksimal 300 karakter.'); end if;
 select * into p from purchase_requests where id=p_pr_id for update;
 if not found then return jsonb_build_object('ok',false,'error','PR tidak ditemukan.'); end if;
 if p.status='REVISI' then return jsonb_build_object('ok',true,'already',true); end if;
 if p.status not in ('SUBMITTED','APPROVED') then return jsonb_build_object('ok',false,'error','Status PR tidak dapat dikembalikan.'); end if;
 update purchase_requests set status='REVISI',notes=coalesce(notes,'')||E'\nRevisi dari Pembelian ('||now()::text||'): '||p_reason where id=p_pr_id;
 return jsonb_build_object('ok',true,'status','REVISI');
end $$;

-- Defense in depth: even direct clients cannot edit submitted PR content/items.
-- Lock parent row for child writes to serialize against submit/return.
create or replace function public.compact_pr_edit_guard() returns trigger
language plpgsql set search_path=public as $$
declare s text; pid uuid; purchased numeric;
begin
 if tg_table_name='purchase_requests' then
  if tg_op='DELETE' then
   if old.status not in ('DRAFT','REVISI') then raise exception 'PR terkunci. Kembalikan dari Pembelian untuk revisi.'; end if;
   if exists(select 1 from receiving_items ri join pr_items pi on pi.id=ri.pr_item_id where pi.pr_id=old.id and ri.quantity_received>0) then raise exception 'PR memiliki riwayat pembelian dan tidak dapat dihapus.'; end if;
   return old;
  end if;
  if old.status not in ('DRAFT','REVISI') and
     (new.title,new.project_id,new.pr_number,new.priority,new.materials_summary) is distinct from
     (old.title,old.project_id,old.pr_number,old.priority,old.materials_summary)
  then raise exception 'PR terkunci. Kembalikan dari Pembelian untuk revisi.'; end if;
  return new;
 end if;
 pid:=case when tg_op='DELETE' then old.pr_id else new.pr_id end;
 select status into s from purchase_requests where id=pid for update;
 if s not in ('DRAFT','REVISI') and (tg_op<>'UPDATE' or
    (new.item_name,new.material_id,new.quantity,new.unit,new.estimated_price,new.vendor_id,new.pr_id,new.sort_order) is distinct from
    (old.item_name,old.material_id,old.quantity,old.unit,old.estimated_price,old.vendor_id,old.pr_id,old.sort_order))
 then raise exception 'PR terkunci. Kembalikan dari Pembelian untuk revisi.'; end if;
 if tg_op in ('DELETE','UPDATE') then
  select coalesce(sum(quantity_received),0) into purchased from receiving_items where pr_item_id=old.id;
  if purchased>0 and (tg_op='DELETE' or new.quantity<purchased or
     (new.material_id,new.item_name,new.unit,new.pr_id) is distinct from (old.material_id,old.item_name,old.unit,old.pr_id))
  then raise exception 'Item sudah dibeli: identitas harus tetap dan jumlah tidak boleh kurang dari pembelian.'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists compact_pr_guard on public.purchase_requests;
create trigger compact_pr_guard before update or delete on public.purchase_requests for each row execute function public.compact_pr_edit_guard();
drop trigger if exists compact_pr_item_guard on public.pr_items;
create trigger compact_pr_item_guard before insert or update or delete on public.pr_items for each row execute function public.compact_pr_edit_guard();

create or replace function public.ops_transfer_apply(
 p_event_key text,p_source text,p_receiving_item_id uuid,p_material_id uuid,
 p_destination text,p_quantity numeric,p_project_id uuid,p_receiver text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare ri public.receiving_items%rowtype; pr public.pr_items%rowtype; rec public.receivings%rowtype;
 m public.materials%rowtype; existing public.ops_transfers%rowtype;
 mid uuid; total numeric; price numeric; value numeric:=0; remain numeric; take_qty numeric;
 tid uuid:=gen_random_uuid(); lot record; u text; matched text[];
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'error','Silakan login.'); end if;
 if nullif(btrim(p_event_key),'') is null or length(p_event_key)>160 then return jsonb_build_object('ok',false,'error','Identitas transaksi tidak valid.'); end if;
 perform pg_advisory_xact_lock(hashtext('ops-event:'||p_event_key));
 select * into existing from ops_transfers where event_key=p_event_key;
 if found then
  if (existing.source,existing.receiving_item_id,existing.material_id,existing.destination,existing.quantity,existing.project_id,existing.receiver)
    is distinct from (p_source,p_receiving_item_id,coalesce(p_material_id,existing.material_id),p_destination,p_quantity,p_project_id,nullif(btrim(p_receiver),''))
  then return jsonb_build_object('ok',false,'error','Identitas transaksi dipakai payload berbeda.'); end if;
  return jsonb_build_object('ok',true,'already',true,'id',existing.id);
 end if;
 if p_source is null or p_destination is null or p_source not in ('PURCHASE','WAREHOUSE') or p_destination not in ('GUDANG','TUKANG') or p_quantity is null or p_quantity<=0 or p_quantity::text in ('NaN','Infinity','-Infinity') then return jsonb_build_object('ok',false,'error','Jumlah atau tujuan tidak valid.'); end if;
 if p_destination='TUKANG' and (nullif(btrim(p_receiver),'') is null or p_project_id is null or not exists(select 1 from projects where id=p_project_id and coalesce(status,'')<>'DONE')) then return jsonb_build_object('ok',false,'error','Pilih proyek aktif dan penerima.'); end if;
 if p_source='PURCHASE' then
  select * into ri from receiving_items where id=p_receiving_item_id for update;
  if not found then return jsonb_build_object('ok',false,'error','Barang pembelian tidak ditemukan.'); end if;
  select * into rec from receivings where id=ri.receiving_id;
  if rec.status<>'DIBELI' and coalesce(rec.note,'') !~* '\[Tahap:\s*DIBELI\]' and nullif(btrim(rec.invoice_no),'') is null then return jsonb_build_object('ok',false,'error','Pembelian belum selesai.'); end if;
  -- Fail closed on legacy physical allocations: no unsafe guessed backfill.
  if rec.masuk_gudang or rec.tukang_at is not null or exists(select 1 from handovers where receiving_id=ri.receiving_id and diserahkan_at is not null) then return jsonb_build_object('ok',false,'error','Barang memiliki distribusi lama. Rekonsiliasi dahulu untuk mencegah pencatatan ganda.'); end if;
  select coalesce(sum(quantity),0) into total from ops_transfers where receiving_item_id=ri.id and source='PURCHASE';
  if total+p_quantity>ri.quantity_received then return jsonb_build_object('ok',false,'error','Jumlah melebihi sisa barang pembelian.'); end if;
  select * into pr from pr_items where id=ri.pr_item_id;
  mid:=pr.material_id;
  if p_material_id is not null and mid is not null and p_material_id<>mid then return jsonb_build_object('ok',false,'error','Material tidak cocok dengan barang pembelian.'); end if;
  mid:=coalesce(mid,p_material_id); u:=ri.unit;
  matched:=regexp_match(coalesce(ri.note,''),'\[Harga:\s*([0-9.]+)\]','i');
  price:=matched[1]::numeric;
  if price is null or price<=0 then return jsonb_build_object('ok',false,'error','Harga beli aktual belum tercatat.'); end if;
  value:=round(p_quantity*price);
 else
  if p_destination<>'TUKANG' or p_receiving_item_id is not null then return jsonb_build_object('ok',false,'error','Pengambilan gudang harus diserahkan ke tukang.'); end if;
  mid:=p_material_id;
 end if;
 if p_destination='GUDANG' or p_source='WAREHOUSE' then
  select * into m from materials where id=mid for update;
  if not found then return jsonb_build_object('ok',false,'error','Pilih material master yang sesuai.'); end if;
  if p_source='PURCHASE' and lower(btrim(coalesce(u,'')))<>lower(btrim(coalesce(m.satuan,m.unit,''))) then return jsonb_build_object('ok',false,'error','Satuan pembelian dan stok berbeda. Rekonsiliasi dahulu.'); end if;
  if p_source='WAREHOUSE' then
   if m.current_stock is null or m.current_stock<p_quantity then return jsonb_build_object('ok',false,'error','Stok gudang tidak mencukupi.'); end if;
   select coalesce(sum(remaining),0) into total from ops_stock_lots where material_id=mid;
   if total<p_quantity then return jsonb_build_object('ok',false,'error','Saldo stok lama belum memiliki nilai/lot terverifikasi. Rekonsiliasi dahulu.'); end if;
   u:=coalesce(m.satuan,m.unit); value:=0; remain:=p_quantity;
   for lot in select * from ops_stock_lots where material_id=mid and remaining>0 order by created_at,id for update loop
    take_qty:=least(remain,lot.remaining); value:=value+take_qty*lot.unit_cost; remain:=remain-take_qty; exit when remain=0;
   end loop;
   value:=round(value);
  end if;
 end if;
 insert into ops_transfers(id,event_key,source,receiving_item_id,material_id,destination,quantity,unit,project_id,receiver,stock_value,project_cost,created_by)
 values(tid,p_event_key,p_source,p_receiving_item_id,mid,p_destination,p_quantity,u,p_project_id,nullif(btrim(p_receiver),''),value,case when p_destination='TUKANG' then value else 0 end,auth.uid());
 if p_destination='GUDANG' then
  update materials set current_stock=coalesce(current_stock,0)+p_quantity where id=mid;
  insert into ops_stock_lots(transfer_id,material_id,remaining,unit_cost) values(tid,mid,p_quantity,price);
 elsif p_source='WAREHOUSE' then
  remain:=p_quantity;
  for lot in select * from ops_stock_lots where material_id=mid and remaining>0 order by created_at,id for update loop
   take_qty:=least(remain,lot.remaining);
   update ops_stock_lots set remaining=remaining-take_qty where id=lot.id;
   insert into ops_stock_allocations values(tid,lot.id,take_qty,lot.unit_cost);
   remain:=remain-take_qty; exit when remain=0;
  end loop;
  update materials set current_stock=current_stock-p_quantity where id=mid;
 end if;
 return jsonb_build_object('ok',true,'id',tid,'project_cost',case when p_destination='TUKANG' then value else 0 end);
end $$;
revoke all on function public.pr_return_for_revision(uuid,text) from public,anon;
grant execute on function public.pr_return_for_revision(uuid,text) to authenticated;
revoke all on function public.ops_transfer_apply(text,text,uuid,uuid,text,numeric,uuid,text) from public,anon;
grant execute on function public.ops_transfer_apply(text,text,uuid,uuid,text,numeric,uuid,text) to authenticated;
commit;
