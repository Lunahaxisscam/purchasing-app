import {isPurchasedNota} from '../../lib/purchaseNote'
export function distributionRows({receivings=[],receivingItems=[],prItems=[],requests=[],projects=[],transfers=[],handovers=[]}={}){
 const recs=new Map(receivings.filter(isPurchasedNota).map(r=>[r.id,r])),prs=new Map(prItems.map(r=>[r.id,r])),reqs=new Map(requests.map(r=>[r.id,r])),projs=new Map(projects.map(r=>[r.id,r]))
 return receivingItems.filter(i=>recs.has(i.receiving_id)&&Number(i.quantity_received)>0).map(i=>{
  const rec=recs.get(i.receiving_id),pr=prs.get(i.pr_item_id),req=reqs.get(pr?.pr_id||rec.purchase_request_id),p=projs.get(req?.project_id||rec.project_id)
  const events=transfers.filter(t=>t.source==='PURCHASE'&&t.receiving_item_id===i.id),bought=Number(i.quantity_received),delivered=events.reduce((s,t)=>s+Number(t.quantity||0),0)
  const legacy=!!rec.masuk_gudang||!!rec.tukang_at||handovers.some(h=>h.receiving_id===i.receiving_id&&h.diserahkan_at)
  return {...i,bought,delivered,remaining:Math.max(0,bought-delivered),legacy,materialId:pr?.material_id||null,projectId:p?.id||null,projectName:p?.name||'Tanpa proyek',prNumber:req?.pr_number||'Belanja langsung',invoiceNo:rec.invoice_no||rec.delivery_note||'—',events}
 })
}
export function validateTransfer({source,destination,quantity,available,projectId,receiver,materialId}={}){
 const n=Number(quantity),max=Number(available)
 if(!Number.isFinite(n)||n<=0)return 'Jumlah harus lebih dari 0.'
 if(!Number.isFinite(max)||n>max)return 'Jumlah melebihi sisa tersedia.'
 if(!['PURCHASE','WAREHOUSE'].includes(source)||!['GUDANG','TUKANG'].includes(destination))return 'Pilih sumber dan tujuan yang valid.'
 if((source==='WAREHOUSE'||destination==='GUDANG')&&!materialId)return 'Pilih material master yang sesuai.'
 if(source==='WAREHOUSE'&&destination!=='TUKANG')return 'Pengambilan gudang harus diserahkan ke tukang.'
 if(destination==='TUKANG'&&(!projectId||!String(receiver||'').trim()))return 'Pilih proyek dan isi penerima.'
 return ''
}
