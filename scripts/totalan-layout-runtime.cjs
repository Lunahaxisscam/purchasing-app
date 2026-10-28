const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');
const UP=require(root+'/public/upah-kasbon-sync.js'),UI=require(root+'/public/upah-totalan-history.js');
const input=process.argv[2];assert.ok(input,'pass read-only DB snapshot path');
const db=JSON.parse(fs.readFileSync(input));
const mapped={}; for(const [a,b] of Object.entries({tukangs:'upah_tukang',projects:'upah_projects',items:'upah_items',kasbon:'upah_kasbon',totalans:'upah_totalan',totalanProjects:'upah_totalan_projects',totalanKasbon:'upah_totalan_kasbon',adjustments:'upah_penyesuaian'}))mapped[a]=db[b];
const source=fs.readFileSync(root+'/public/upah-kasbon-prototype.html','utf8');
const main=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/bootMaster\(\)\s*$/,'');
const nodes=new Map();const element=()=>({value:'',textContent:'',innerHTML:'',style:{},classList:{toggle(){},add(){}},addEventListener(){},querySelectorAll(){return[]},reset(){},insertAdjacentHTML(){}});
const document={body:element(),getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)},querySelectorAll(){return[]},addEventListener(){}};
let timers=0;
const c={window:{parent:{__UPAH_READ_ONLY__:true},UpahSync:UP,UpahTotalanHistory:UI},document,console,localStorage:{getItem(){throw Error('no local cache')},setItem(){throw Error('no local writes')}},setTimeout(){timers++;return 0},clearTimeout(){},Map,Set};
vm.createContext(c);vm.runInContext(fs.readFileSync(root+'/public/upah-penyesuaian.js','utf8'),c);vm.runInContext(main,c);
const state=UP.stateFromDb(mapped);const d=state.tukangs.find(d=>/pujon/i.test(d.name));assert.ok(d);state.activeKey=d.key;
for(const opening of [-100,0,100]){
 const signed={projects:[{id:'p',name:'P',status:'Selesai'}],upahItems:[{projectId:'p',upahRincian:1000}],kasbon:[{id:'k',jenis:'Kasbon',tanggal:'2026-01-01',nominal:200}],totalans:[{id:'t',no:'T',tanggal:'2026-01-02',projectIds:['p'],kasbonIds:['k'],openingAdjustment:opening,pembayaranAktual:800+opening}]};
 const t=c.hitungTotalans(signed)[0];assert.equal(t.hakBersih,800+opening);assert.equal(t.saldoAkhir,0);
 assert.ok(UI.render(t,signed,{money:String,date:String,projectTotal:()=>1000}).includes('Lunas'));
}
c.testState=state;vm.runInContext('state=testState; renderTotalans()',c);
const totals=c.hitungTotalans(d);assert.equal(totals.length,5);
const rows=[];
for(const t of totals){
 const actual=db.upah_totalan.find(x=>x.id===t.id);const v=UI.summary(t);
 assert.equal(t.totalUpah,actual.total_upah);assert.equal(t.hakBersih,actual.hak_bersih);assert.equal(t.kasbonDipotong,actual.kasbon_dipotong);assert.equal(t.pembayaranAktual,actual.pembayaran_aktual);
 assert.equal(v.opening,actual.opening_adjustment);
 assert.equal(v.ending,actual.carried_residual!==0?actual.residual_before_carry:actual.saldo_akhir);
 assert.equal(t.totalUpah+v.opening-t.kasbonDipotong,t.hakBersih,'opening counted once');
 assert.equal(t.hakBersih-t.pembayaranAktual,v.ending);
 assert.equal(v.status,actual.carried_residual!==0?'Selesai / Ditutup':'Lunas');
 assert.equal(t.potonganDetail.reduce((s,k)=>s+k.nominal,0),t.kasbonDipotong,'detail matches kasbon header');
 rows.push({no:t.no,opening:v.opening,gross:t.totalUpah,kasbon:t.kasbonDipotong,net:v.net,cash:t.pembayaranAktual,ending:v.ending,status:v.status,projects:t.projectIds.length,kasbonRows:t.potonganDetail.length});
}
assert.equal((nodes.get('totalanTableWrap').innerHTML.match(/class="history-document"/g)||[]).length,5);
for(const t of totals){ c.testId=t.id;vm.runInContext('slipTotalanId=testId;renderSlip()',c);assert.ok(nodes.get('slip').innerHTML.includes(UI.summary(t).status)); }
const oldTimers=timers;vm.runInContext('saveState();persistNow()',c);assert.equal(timers,oldTimers,'read-only never schedules persistence');
const before=JSON.stringify(db);vm.runInContext('renderTotalans()',c);assert.equal(JSON.stringify(db),before);
if(process.env.QA_HTML){
 const base=source.match(/<style>([\s\S]*?)<\/style>/)[1];
 const style=fs.readFileSync(root+'/public/upah-totalan-history.css','utf8');
 const t=totals.find(t=>t.no==='TOT-004');
 const html=UI.render(t,d,{money:c.fmtRp,date:c.fmtTgl,projectTotal:id=>c.totalUpahProyek(d.upahItems,id,d.projectOverrides[id])});
 fs.writeFileSync(process.env.QA_HTML,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Snapshot QA — bukan sesi aplikasi</title><style>'+base+'\n'+style+'</style><main><p class="note">QA visual · Snapshot GET database utama · Bukan sesi aplikasi terautentikasi</p>'+html+'</main>',{mode:0o600});
}
console.log(JSON.stringify({result:'PASS actual prototype render + slip for all 5 Pujon histories; no writes/cache',rows},null,2));
// Preserve null through DB reload; final and serializer protections stay unchanged.
const legacy=structuredClone(mapped);legacy.totalans=legacy.totalans.map(t=>({...t,residual_before_carry:null}));
for(const dataset of UP.stateFromDb(legacy).tukangs)for(const t of dataset.totalans)assert.equal(t.residualBeforeCarry,null);
// Network gate: denied methods must make ZERO native fetch calls. Auth still works normally.
(async()=>{
 const calls=[];const window={location:{href:'http://100.91.244.41:3088/'},fetch:async(...x)=>{calls.push(x);return {ok:true}}};
 vm.runInNewContext(fs.readFileSync(root+'/public/upah-preview-readonly.js','utf8'),{window,URL,Error});
 for(const method of ['POST','PATCH','PUT','DELETE'])for(const route of ['/rest/v1/upah_totalan','/rest/v1/rpc/upah_carry_totalan_residual','/functions/v1/x'])await assert.rejects(window.upahPreviewReadFetch('https://wuurovgjflrhczlsbixm.supabase.co'+route,{method}),/baca-saja/);
 assert.equal(calls.length,0);await window.upahPreviewReadFetch('https://wuurovgjflrhczlsbixm.supabase.co/rest/v1/upah_totalan',{method:'GET'});await window.upahPreviewReadFetch('https://wuurovgjflrhczlsbixm.supabase.co/auth/v1/token',{method:'POST'});assert.equal(calls.length,2);
 console.log('PASS null reload + mutation network guard (12 denied calls never sent), normal GET/auth allowed');
})().catch(e=>{console.error(e);process.exit(1)});
