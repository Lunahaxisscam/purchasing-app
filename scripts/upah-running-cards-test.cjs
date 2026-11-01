const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=require('node:path').join(__dirname,'..');
const html=fs.readFileSync(root+'/public/upah-kasbon-prototype.html','utf8');
const code=html.slice(html.indexOf('function toNum('),html.indexOf('/* ===== Akhir salinan logic.js'));
const c={};vm.createContext(c);vm.runInContext(code,c);
const base=()=>({projects:[{id:'p',status:'Selesai'}],upahItems:[{projectId:'p',upahRincian:1000}],kasbon:[{id:'k',jenis:'Kasbon',nominal:200}],totalans:[]});
let count=0;function check(name,s,w,k,r){const before=JSON.stringify(s),v=c.sisaHakPeriodeBerjalan(s);assert.deepEqual([v.totalAktif,v.kasbonBelum,v.sisa],[w,k,r],name);assert.equal(JSON.stringify(s),before);count++;console.log('PASS',name);return v}
check('partial open',base(),1000,200,800);
let s=base();s.totalans=[{id:'t',final:true,projectIds:['p'],kasbonIds:['k'],snapshot:{saldo_akhir:0}}];check('all closed zero',s,0,0,0);
s.projects[0].arsipManual=false;check('final cannot reopen via archive flag',s,0,0,0);
for(const n of [100,-100]){s=base();s.adjustments=[{id:'a',status:'ACTIVE',nominal:n},{id:'b',status:'CONSUMED',nominal:500},{id:'c',status:'REVERSED',nominal:500}];check('active signed '+n,s,1000+n,200,800+n);let t=c.hitungTotalans({...s,totalans:[{id:'preview',projectIds:['p'],kasbonIds:['k'],openingAdjustment:n}]})[0];assert.equal(t.saldoAkhir,c.sisaHakPeriodeBerjalan(s).sisa);}
s=base();s.kasbon.push({id:'pay',jenis:'Pelunasan',nominal:9999},{id:'zero',jenis:'Kasbon',nominal:0});assert.equal(check('pelunasan excluded / zero tickets',s,1000,200,800).jumlahKasbon,1);
s=base();s.totalans=[{id:'t',final:false,projectIds:['p'],kasbonIds:['k'],openingAdjustment:-100,pembayaranAktual:300}];check('unfinalized keeps wages and kasbon; net uses reconciled residual',s,1000,200,400);
s=base();s.kasbon[0].nominal=2000;check('negative not clamped',s,1000,2000,-1000);
s=base();s.projectOverrides={p:500};check('effective agreed override once',s,500,200,300);
s=base();s.projects[0].status='On Going';check('ongoing stays',s,1000,200,800);s.projects[0].arsipManual=true;check('held manual archive excluded',s,0,200,-200);
const moduleCode=fs.readFileSync(root+'/modules/upah-kasbon/logic.js','utf8').replace(/export /g,'');const m={};vm.createContext(m);vm.runInContext(moduleCode,m);assert.equal(JSON.stringify(m.sisaHakPeriodeBerjalan(base())),JSON.stringify(c.sisaHakPeriodeBerjalan(base())));
if(process.argv[2]){const db=JSON.parse(fs.readFileSync(process.argv[2])),UP=require(root+'/public/upah-kasbon-sync.js'),mapped={};for(const [a,b] of Object.entries({tukangs:'upah_tukang',projects:'upah_projects',items:'upah_items',kasbon:'upah_kasbon',totalans:'upah_totalan',totalanProjects:'upah_totalan_projects',totalanKasbon:'upah_totalan_kasbon',adjustments:'upah_penyesuaian'}))mapped[a]=db[b];for(const d of UP.stateFromDb(mapped).tukangs){let v=c.sisaHakPeriodeBerjalan(d);console.log('FRESH',d.name,JSON.stringify(v));assert.equal(JSON.stringify(v),JSON.stringify(m.sisaHakPeriodeBerjalan(d)),'module and served inline parity');if(d.name==='Pujon'){assert.equal(v.totalAktif,0);assert.equal(v.kasbonBelum,0);assert.equal(v.sisa,0);const simulated={...d,projects:d.projects.filter(p=>d.totalans.some(t=>t.final&&t.projectIds.includes(p.id)))};check('simulation only: no remaining open Pujon projects',simulated,0,0,0);}}}
console.log('PASS',count,'fixtures + module/inline parity');
