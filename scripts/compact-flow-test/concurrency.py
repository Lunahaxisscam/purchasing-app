#!/usr/bin/env python3
"""Local PostgreSQL only: two withdrawals competing for one lot."""
import concurrent.futures,subprocess
DB='purchasing_compact_test'
def sql(s):
 r=subprocess.run(['sudo','-u','postgres','psql','-At','-v','ON_ERROR_STOP=1','-d',DB],input=s,text=True,capture_output=True)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip()
uid='99999999-9999-9999-9999-999999999999';mid='aaaaaaaa-0000-0000-0000-000000000001';ri='ffffffff-0000-0000-0000-000000000001';pid='11111111-1111-1111-1111-111111111111'
auth=f"select set_config('request.jwt.claim.sub','{uid}',false);"
sql(f"insert into profiles(id,role) values('{uid}','admin') on conflict(id) do nothing; update purchase_requests set status='SUBMITTED',notes='[Jalur: LEAN]'; update receiving_items set quantity_received=5,note='[Harga: 140000]'; update receivings set status='DIBELI'; {auth} select ops_transfer_apply('race-in','PURCHASE','{ri}',null,'GUDANG',3,null,null);")
def withdraw(n):
 return sql(auth+f"select ops_transfer_apply('race-out-{n}','WAREHOUSE',null,'{mid}','TUKANG',2,'{pid}','Test Receiver')->>'ok';").splitlines()[-1]
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as e: results=list(e.map(withdraw,[1,2]))
 assert sorted(results)==['false','true'],results
 stock=sql(f"select current_stock from materials where id='{mid}'")
 assert stock=='1',stock
 print('PASS concurrent withdrawals: one accepted, one denied; stock=1')
 grants=sql("select has_function_privilege('anon','ops_transfer_apply(text,text,uuid,uuid,text,numeric,uuid,text)','EXECUTE'),has_table_privilege('authenticated','ops_transfers','INSERT')")
 assert grants=='f|f',grants
 print('PASS anon cannot invoke transfer; authenticated cannot directly insert ledger')
finally:
 sql("delete from ops_stock_allocations; delete from ops_stock_lots; delete from ops_transfers; update materials set current_stock=0;")
