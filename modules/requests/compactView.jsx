import React from 'react'
import {format,rupiah} from '../../lib/constants'
import {requestStatusLabel,stripLeanMarkers} from './leanRequest'
import {canEditRequest} from './workflow'

export function requestFilters({rows,prFilter,setPrFilter}) {
  const labels=[['all','Aktif'],['DRAFT','Draft'],['SUBMITTED','Submitted'],['REVISI','Perlu Revisi']]
  return <div className="filter-tabs">{labels.map(([key,label])=><button key={key} className={`pill ${prFilter===key?'active':''}`} onClick={()=>setPrFilter(key)}>{label}</button>)}</div>
}
export function RequestActions({r,ctx}) {
  const editable=canEditRequest(r)
  return <div className="compact-flow-actions">{editable?<><button onClick={()=>ctx.setEditRow(r)}>Edit</button><button className="btn-finish" onClick={()=>ctx.onFinishPr(r)}>{r.status==='REVISI'?'Submit Ulang':'Submit'}</button>{r.status==='DRAFT'&&<button className="outline" onClick={()=>ctx.onDelete(ctx.page,r)}>Hapus</button>}</>:<span className="muted" title="Kembalikan dari Pembelian untuk revisi">Terkunci</span>}</div>
}
function itemsFor(r,ctx){return ctx.H.prItemsForPr(r.id)||[]}
function price(it){if(it.estimated_price===null||it.estimated_price===undefined||it.estimated_price==='')return null;const n=Number(it.estimated_price);return Number.isFinite(n)&&n>=0?n:null}
export function compactDesktopRow(r,ctx){
 const items=itemsFor(r,ctx),list=items.length?items:[{id:'empty',item_name:r.materials_summary||'Rincian belum tersedia'}],span=list.length
 return list.map((it,i)=><tr key={`${r.id}-${it.id}`} className="compact-flow-row">
 {i===0&&<td rowSpan={span}><b>{r.pr_number||'PR'}</b><small className="compact-flow-sub">{r.project_name||'—'}</small><details><summary>Detail</summary><div className="compact-flow-detail">{r.title}<br/>{format(r.created_at)}<br/>{stripLeanMarkers(r.notes)||'Tidak ada catatan'}</div></details></td>}
 <td><b>{it.item_name||it.kode||'—'}</b>{it.kode&&<small className="compact-flow-sub">{it.kode}</small>}</td>
 <td>{it.quantity!==undefined?`${it.quantity} ${it.unit||''}`:'—'}</td>
 <td>{price(it)!==null?rupiah(price(it)):'—'}</td>
 <td>{price(it)!==null&&Number.isFinite(Number(it.quantity))?rupiah(Math.round(price(it)*Number(it.quantity))):'—'}</td>
 {i===0&&<><td rowSpan={span}><span className={`badge status-${r.status}`}>{requestStatusLabel(r)}</span></td><td rowSpan={span}><RequestActions r={r} ctx={ctx}/></td></>}
 </tr>)
}
export function compactMobileCard(r,ctx){const items=itemsFor(r,ctx);return <><div className="mobile-card-header"><b>{r.pr_number}</b><span className="badge">{requestStatusLabel(r)}</span></div><div className="mobile-card-body"><b>{r.project_name||'—'}</b>{items.map(it=><div key={it.id} className="compact-flow-mobile-item"><b>{it.item_name}</b><span>{it.quantity} {it.unit} · {price(it)!==null?rupiah(price(it))+' / '+(it.unit||'unit'):'Estimasi belum ada'}</span></div>)}<details><summary>Detail PR</summary>{r.title}<br/>{stripLeanMarkers(r.notes)}</details></div><div className="mobile-card-actions"><RequestActions r={r} ctx={ctx}/></div></>}
