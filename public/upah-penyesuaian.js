/* Penyesuaian hak v1 — uses only the parent's normal authenticated Supabase client. */
document.addEventListener('submit',e=>{
  if(!MASTER.ok){e.preventDefault();e.stopImmediatePropagation();notice('Aksi diblokir: database utama dan login admin belum siap.',true)}
},true);
function renderPenyesuaian(){
  const wrap=document.getElementById('totalanTableWrap'); if(!wrap)return;
  const d=D(), adjs=d.adjustments||[], active=adjs.filter(a=>a.status==='ACTIVE');
  let html='<section id="penyesuaianHak"><h3>Penyesuaian hak</h3><p class="note">Bukan kasbon atau pembayaran baru. Nilai bertanda dipakai sekali pada totalan berikutnya. Totalan final lama tetap terkunci.</p>';
  html+='<p>Hak berjalan dari penyesuaian: <b>'+fmtRp(active.reduce((s,a)=>s+Number(a.nominal),0))+'</b></p>';
  for(const a of adjs){
    const source=d.totalans.find(t=>t.id===a.source_totalan_id), dest=d.totalans.find(t=>t.id===a.destination_totalan_id);
    html+='<p>'+esc(source?.no||'Sumber')+' → '+esc(dest?.no||'Hak berjalan')+' · <b>'+fmtRp(a.nominal)+'</b> · '+esc(a.status)+' · '+esc(a.alasan)+'</p>';
  }
  for(const t of hitungTotalans(d)){
    if(t.carriedResidual)html+='<p>'+esc(t.no)+': sisa sebelum pengalihan '+fmtRp(t.residualBeforeCarry)+'; dialihkan '+fmtRp(t.carriedResidual)+'; saldo akhir '+fmtRp(t.saldoAkhir)+'</p>';
    if(t.openingAdjustment)html+='<p>'+esc(t.no)+': penyesuaian masuk '+fmtRp(t.openingAdjustment)+'</p>';
    if(!t.final && !t.carriedResidual && MASTER.ok){
      if(t.saldoAkhir!==0)html+='<button type="button" class="small" data-hak-carry="'+esc(t.id)+'">Alihkan sisa '+esc(t.no)+' ke hak berjalan</button> ';
      const eligible=active.filter(a=>{const s=d.totalans.find(x=>x.id===a.source_totalan_id);return s&&s.seq<t.seq});
      if(eligible.length&&!t.openingAdjustment)html+='<button type="button" class="small" data-hak-consume="'+esc(t.id)+'">Pakai penyesuaian aktif pada '+esc(t.no)+'</button> ';
    }
  }
  wrap.insertAdjacentHTML('beforeend',html+'</section>');
}
let hakActionBusy=false;
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-hak-carry],[data-hak-consume]');if(!b)return;
 if(hakActionBusy||!MASTER.ok||!MASTER.client){notice('Aksi diblokir: login admin dan koneksi database utama diperlukan.',true);return}
 const carry=!!b.dataset.hakCarry,id=b.dataset.hakCarry||b.dataset.hakConsume;
 if(!confirm(carry?'Alihkan sisa totalan ke hak berjalan dan kunci totalan sumber? Tidak membuat kasbon/pembayaran baru.':'Pakai penyesuaian bertanda pada totalan ini? Nilai hak bersih berubah, pembayaran tidak berubah.'))return;
 const reason=carry?prompt('Alasan pengalihan (wajib):'):null;
 if(carry&&(!reason||reason.trim().length<5)){notice('Alasan minimal 5 karakter.',true);return}
 hakActionBusy=true;b.disabled=true;clearTimeout(MASTER.timer);
 try{
  await persistNow();
  if(JSON.stringify(MASTER.last)!==JSON.stringify(state))throw Error('Perubahan belum tersimpan; aksi penyesuaian dibatalkan.');
  const d=D(),t=d.totalans.find(t=>t.id===id);if(!t||t.final)throw Error('Totalan final atau tidak ditemukan.');
  let result;
  if(carry){result=await MASTER.client.rpc('upah_carry_totalan_residual',{p_source_totalan_id:id,p_alasan:reason.trim(),p_actor:null,p_idempotency_key:'carry:totalan:'+id})}
  else{
   const ids=(d.adjustments||[]).filter(a=>a.status==='ACTIVE'&&d.totalans.some(s=>s.id===a.source_totalan_id&&s.seq<t.seq)).map(a=>a.id);
   result=await MASTER.client.rpc('upah_consume_adjustments',{p_destination_totalan_id:id,p_adjustment_ids:ids});
  }
  if(result.error)throw result.error;
  const fresh=await UP.fetchAll(MASTER.client),row=fresh.totalans.find(x=>x.id===id);
  if(!row || (carry&&result.data.status==='SUCCESS'&&(!row.final||Number(row.saldo_akhir)!==0)))throw Error('Readback belum sesuai; muat ulang sebelum mencoba lagi.');
  const key=state.activeKey;state=UP.stateFromDb(fresh);state.activeKey=key;MASTER.last=UP.clone(state);render();
  notice('Penyesuaian tersimpan dan dibaca ulang dari database utama.');
 }catch(err){notice('Penyesuaian belum selesai: '+(err.message||err),true)}
 finally{hakActionBusy=false;b.disabled=false}
});
