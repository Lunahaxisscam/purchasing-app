import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url), swc=require('next/dist/build/swc'), root=process.cwd(), cache=new Map()
async function load(file){file=resolve(root,file);if(cache.has(file))return cache.get(file);let src=readFileSync(file,'utf8');const specs=[...src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(m=>m[1]);for(const spec of new Set(specs)){let p=resolve(dirname(file),spec);if(!/\.[cm]?jsx?$/.test(p))p+='.js';let url=await load(p);src=src.split("'"+spec+"'").join("'"+url+"'").split('"'+spec+'"').join('"'+url+'"')}; const url='data:text/javascript;base64,'+Buffer.from(src).toString('base64');cache.set(file,url);return url}
const lean=await import(await load('modules/requests/leanRequest.js'))
const purchase=await import(await load('modules/receivings/purchaseLogic.js'))
let fail=0,pass=0
function test(name,fn){try{fn();console.log('PASS',name);pass++}catch(e){console.log('FAIL',name,e.message);fail++}}
test('returned lean request is no longer buyable',()=>assert.equal(lean.isLeanRequest({status:'REVISI',notes:'[Jalur: LEAN]'}),false))
test('submitted label is consistent',()=>assert.equal(lean.requestStatusLabel({status:'SUBMITTED',notes:'[Jalur: LEAN]'}),'Submitted'))
test('revision label is consistent',()=>assert.equal(lean.requestStatusLabel({status:'REVISI',notes:'[Jalur: LEAN]'}),'Perlu Revisi'))
test('revision overrides legacy approved item in buying queue',()=>assert.equal(purchase.isBuyable({request:{status:'REVISI'},item:{status:'APPROVED'}}),false))
const fixture={requests:[{id:'p',status:'SUBMITTED',notes:'[Jalur: LEAN]'}],prItems:[{id:'i',pr_id:'p',quantity:5,unit:'pcs',item_name:'Engsel',estimated_price:20000}],receivings:[{id:'r',status:'DIBELI'}],receivingItems:[{id:'ri',receiving_id:'r',pr_item_id:'i',quantity_received:3}]}
test('5 requested 3 bought leaves 2 in buying queue',()=>{const [r]=purchase.buildReadyRows(fixture);assert.equal(r.qtyPr,5);assert.equal(r.qtyBought,3);assert.equal(r.qtySisa,2)})
test('fractional remaining is never rounded up to one',()=>assert.equal(purchase.buildReadyRows({...fixture,receivingItems:[{...fixture.receivingItems[0],quantity_received:4.75}]})[0].qtySisa,0.25))
test('returned PR does not reappear with a leftover lean marker',()=>assert.equal(purchase.buildReadyRows({...fixture,requests:[{...fixture.requests[0],status:'REVISI'}]}).length,0))
test('revision with retained lean marker resubmits instead of early alreadySubmitted',()=>assert.ok(!readFileSync('modules/requests/submitLean.js','utf8').includes('if (isLeanMarked(latest.notes)) {')))
test('edit save checks fresh database status before mutations',()=>assert.match(readFileSync('modules/requests/save.js','utf8'),/verifyRequestEditable/))
const workflow=await import(await load('modules/requests/workflow.js'))
const distribution=await import(await load('modules/handovers/compactLogic.js'))
test('submitted PR is not editable',()=>assert.equal(workflow.canEditRequest({status:'SUBMITTED'}),false))
test('revision PR is editable',()=>assert.equal(workflow.canEditRequest({status:'REVISI'}),true))
test('active is not a document status and includes submitted',()=>assert.equal(workflow.isActiveRequest({status:'SUBMITTED'}),true))
test('closed request is not active',()=>assert.equal(workflow.isActiveRequest({status:'SUBMITTED',notes:'[Tutup: selesai]'}),false))
test('distribution uses bought quantity and sums split destinations',()=>{const [r]=distribution.distributionRows({...fixture,receivingItems:fixture.receivingItems,transfers:[{source:'PURCHASE',receiving_item_id:'ri',quantity:1,destination:'GUDANG'}]});assert.equal(r.bought,3);assert.equal(r.delivered,1);assert.equal(r.remaining,2)})
test('warehouse overdraw fails validation',()=>assert.match(distribution.validateTransfer({source:'WAREHOUSE',destination:'TUKANG',quantity:3,available:2,materialId:'m',projectId:'p',receiver:'A'}),/melebihi/))
test('tukang requires project and receiver',()=>assert.match(distribution.validateTransfer({source:'PURCHASE',destination:'TUKANG',quantity:1,available:2}),/proyek/))
test('unknown destination rejected',()=>assert.match(distribution.validateTransfer({source:'PURCHASE',destination:'UNKNOWN',quantity:1,available:2}),/valid/))
for(const [label,result,expected] of [['fresh submitted',{data:{id:'p',status:'SUBMITTED'},error:null},false],['fresh revision',{data:{id:'p',status:'REVISI'},error:null},true],['database read failure',{data:null,error:{message:'offline'}},false]]){
 const c={from:()=>({select:()=>({eq:()=>({single:async()=>result})})})}
 const actual=await workflow.verifyRequestEditable(c,'p');test(label+' edit boundary',()=>assert.equal(actual.ok,expected))
}
console.log(JSON.stringify({pass,fail}));process.exitCode=fail?1:0
