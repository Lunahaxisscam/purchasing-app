const fs=require('fs'),Module=require('module'),assert=require('assert/strict'),root=process.cwd(),swc=require('next/dist/build/swc')
const {JSDOM}=require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom');const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost'});for(const k of ['window','document','navigator','HTMLElement','Event','MouseEvent'])global[k]=dom.window[k];global.IS_REACT_ACT_ENVIRONMENT=true
const React=require('react'),{createRoot}=require('react-dom/client'),{act}=require('react-dom/test-utils');let calls=[]
const mockClient={from(table){return{select(){return{order:async()=>({data:[],error:null})}}}},rpc:async(fn,args)=>{calls.push({fn,args});return {data:null,error:{message:'backend absent'}}}}
const orig=Module._extensions['.js'];for(const ext of ['.js','.jsx'])Module._extensions[ext]=function(mod,file){if(!file.startsWith(root+'/')||file.includes('/node_modules/'))return orig(mod,file);if(file.endsWith('/lib/supabaseClient.js')){mod.exports={supabase:mockClient};return}mod._compile(swc.transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,file)}
const P=require(root+'/modules/receivings/page.jsx').default,H=require(root+'/modules/handovers/compactPage.jsx');const pr={id:'p',status:'SUBMITTED',notes:'[Jalur: LEAN]',pr_number:'PR-01'},item={id:'i',pr_id:'p',quantity:5,unit:'pcs',estimated_price:100,item_name:'Engsel'}
const rows={requests:[pr],pr_items:[item],receivings:[{id:'r',status:'DIBELI',invoice_no:'N-1'}],receiving_items:[{id:'ri',receiving_id:'r',pr_item_id:'i',quantity_received:3,item_name:'Engsel',unit:'pcs',note:'[Harga: 110]'}],vendors:[{id:'v',name:'TB Contoh'}],projects:[],materials:[]};const el=document.getElementById('app'),app=createRoot(el);let pass=0
async function test(n,f){await f();pass++;console.log('PASS',n)}
function button(text){return [...el.querySelectorAll('button')].find(b=>b.textContent===text)}
;(async()=>{
await test('Beli Sisa opens remaining qty 2 without vendor in PR',async()=>{await act(async()=>app.render(React.createElement(P,{rows})));await act(async()=>button('Beli Sisa').click());assert.match(el.textContent,/Proses Pembelian/);const values=[...el.querySelectorAll('input')].map(i=>i.value);assert.ok(values.includes('2'),values.join(','));assert.doesNotMatch(el.textContent,/Lengkapi vendor di PR dulu/)})
await test('missing backend disables warehouse commit and causes zero RPC writes',async()=>{await act(async()=>app.render(React.createElement(H.TransferDialog,{target:{source:'WAREHOUSE'},materials:[{id:'m',name:'Engsel',current_stock:5,satuan:'pcs'}],projects:[],ready:false,onClose(){}})));const b=button('Konfirmasi Serah Terima');assert.equal(b.disabled,true);assert.match(el.textContent,/Backend belum aktif/);assert.equal(calls.length,0)})
await test('handover page lists purchased item and warehouse button',async()=>{await act(async()=>app.render(React.createElement(H.default,{rows})));assert.ok(button('Ambil dari Gudang'));assert.match(el.textContent,/Engsel/);assert.doesNotMatch(el.textContent,/Antrean Distribusi Fisik|Prototype/)})
await test('transfer dialog: qty default 1, proyek & material ikut PR (tanpa pilih ulang)',async()=>{
  const row={id:'ri2',item_name:'Sekrup (2 cm)',unit:'Box',remaining:3,materialId:'m1',projectId:'p1',projectName:'Baroni'}
  await act(async()=>app.render(React.createElement(H.TransferDialog,{target:{source:'PURCHASE',row},materials:[{id:'m1',name:'Sekrup (2 cm)',current_stock:3,satuan:'Box'}],projects:[{id:'p1',name:'Baroni',status:'ON_GOING'}],ready:false,onClose(){}})))
  const qty=el.querySelector('input[type="number"]')
  assert.equal(qty.value,'1','qty default harus 1, dapat: '+qty.value)
  const tujuan=[...el.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='TUKANG'))
  assert.ok(tujuan,'select tujuan tidak ada')
  await act(async()=>{tujuan.value='TUKANG';tujuan.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  const selects=[...el.querySelectorAll('select')].map(s=>[...s.options].map(o=>o.value).join('|'))
  assert.ok(!selects.some(o=>o.includes('Pilih proyek')||o.includes('Pilih material')),'proyek/material masih diminta: '+selects.join(' ;; '))
  assert.match(el.textContent,/Baroni/,'nama proyek dari PR tidak tampil')
  assert.equal(calls.length,0,'tidak boleh ada tulisan DB')
})
await act(async()=>app.unmount());console.log(JSON.stringify({pass}))
})().catch(e=>{console.error(e);process.exitCode=1})
