const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..'),UP=require(root+'/public/upah-kasbon-sync.js');
const source=fs.readFileSync(root+'/public/upah-kasbon-prototype.html','utf8');
const main=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/bootMaster\(\)\s*$/,'');
const nodes=new Map();const element=()=>({value:'',textContent:'',innerHTML:'',style:{},classList:{toggle(){},add(){}},addEventListener(){},querySelectorAll(){return[]},reset(){},insertAdjacentHTML(p,h){this.innerHTML+=h}});
let selected={};
const document={body:element(),getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)},querySelectorAll(q){return (selected[q]||[]).map(value=>({value}))},addEventListener(){}};
const c={window:{parent:{__UPAH_READ_ONLY__:true},UpahSync:UP,UpahTotalanHistory:require(root+'/public/upah-totalan-history.js')},document,console,localStorage:{getItem(){throw Error('no cache')},setItem(){throw Error('no writes')}},setTimeout(){return 0},clearTimeout(){},Map,Set};
vm.createContext(c);vm.runInContext(fs.readFileSync(root+'/public/upah-penyesuaian.js','utf8'),c);vm.runInContext(main,c);
const db=JSON.parse(fs.readFileSync(process.argv[2])),mapped={};for(const [a,b] of Object.entries({tukangs:'upah_tukang',projects:'upah_projects',items:'upah_items',kasbon:'upah_kasbon',totalans:'upah_totalan',totalanProjects:'upah_totalan_projects',totalanKasbon:'upah_totalan_kasbon',adjustments:'upah_penyesuaian'}))mapped[a]=db[b];
const state=UP.stateFromDb(mapped),before=JSON.stringify(state);
for(const d of state.tukangs){state.activeKey=d.key;c.testState=state;vm.runInContext('state=testState;render()',c);const v=c.sisaHakPeriodeBerjalan(d);assert.equal(nodes.get('cardHak').textContent,c.fmtRp(v.totalAktif));assert.equal(nodes.get('cardKasbon').textContent,c.fmtRp(v.kasbonBelum));assert.equal(nodes.get('cardSisa').textContent,c.fmtRp(v.sisa));assert.doesNotMatch(nodes.get('cardHakSub').textContent,/arsip|522|56 proyek/);assert.equal((nodes.get('totalanTableWrap').innerHTML.match(/class="history-document"/g)||[]).length,d.totalans.length);console.log('PASS actual render',d.name,[...['cardHak','cardKasbon','cardSisa'].map(k=>nodes.get(k).textContent)].join(' / '),'history',d.totalans.length);}
for(const signed of [100,-100,-2000]){
 const d={key:'test',name:'Test',projects:[{id:'p',status:'Selesai'}],upahItems:[{projectId:'p',upahRincian:1000}],kasbon:[{id:'k',jenis:'Kasbon',nominal:200}],totalans:[],adjustments:[{id:'a',status:'ACTIVE',nominal:signed}]};
 c.testState={activeKey:'test',tukangs:[d]};vm.runInContext('state=testState',c);document.getElementById('tNo').value='NEW';document.getElementById('tTanggal').value='2026-10-28';document.getElementById('tBayar').value='0';selected={'#tProjects input[type=checkbox]:checked':['p'],'#tKasbon input[type=checkbox]:checked':['k']};
 const p=c.previewTotalan();assert.equal(p.saldoAkhir,c.sisaHakPeriodeBerjalan(d).sisa);assert.equal(p.openingAdjustment,signed);console.log('PASS actual form preview parity',signed,p.saldoAkhir);
}
// Read-only preview rejects business writes before transport.
(async()=>{let sent=0;const window={location:{href:'http://100.91.244.41:3088/'},fetch:async()=>{sent++;return {ok:true}}};vm.runInNewContext(fs.readFileSync(root+'/public/upah-preview-readonly.js','utf8'),{window,URL,Error});for(const method of ['POST','PATCH','PUT','DELETE'])await assert.rejects(window.upahPreviewReadFetch('https://wuurovgjflrhczlsbixm.supabase.co/rest/v1/upah_projects',{method}),/baca-saja/);assert.equal(sent,0);console.log('PASS read-only transport: 4 rejected writes, zero sent');})().catch(e=>{console.error(e);process.exit(1)});
