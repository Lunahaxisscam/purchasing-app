// SINTETIS, isolated harness only. Never connects to the business DB.
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const sb = process.env.BAKPAU_TEST_SANDBOX
if (!sb) throw new Error('BAKPAU_TEST_SANDBOX is required')
const load = rel => import(pathToFileURL(path.join(sb, rel)).href)
const AP = await load('dist/lib/bakpau/atomicPurchase.mjs')
const C = await load('dist/lib/bakpau/apiCreate.mjs')
const mock = await load('dist/lib/supabaseClient.mjs')
const F = await load('api_fixtures.mjs')
let passed = 0, failed = 0
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS', name) }
  catch (e) { failed++; console.log('FAIL', name, e.message) }
}
const payload = F.validCreatePayload()
const valid = C.validateStructuredPayload(payload)
assert.equal(valid.ok, true)
const resolved = C.resolveStructuredNota({ nota: valid.nota, masters: F.MASTERS })
const boundary = { nota: { tanggal: payload.purchase.date, material: 240000, total: 240000, biayaLain: 0, diskon: 0, items: [{qty:2,harga:120000,subtotal:240000}] } }
function argsFor(header, r = resolved) {
 return AP.buildAtomicRpcArgs({resolved:r,nota:valid,boundary,header,eventKey:'sintetis:event',evidenceHash:'sintetis-hash',channel:'bakpau-api',now:0})
}
await test('single explicit line project is retained on header without header default', () => {
 const r = {...resolved,projectId:null}
 assert.equal(argsFor({projectId:F.PROJECTS[0].id},r).header.project_id,F.PROJECTS[0].id)
})
await test('explicit mixed-project null overrides default header project', () => {
 assert.equal(argsFor({projectId:null}).header.project_id,null)
})
await test('legacy caller without project override retains default project', () => {
 assert.equal(argsFor({}).header.project_id,F.PROJECTS[0].id)
})
await test('retry with committed id but failed readback cannot claim successful replay', async () => {
 let reads = 0
 const client = {
  rpc: async () => ({ data: {ok:false,code:'duplicate_event',receiving_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},error:null }),
  from: () => { reads++; throw new Error('SINTETIS readback unavailable') }
 }
 const out = await C.createPurchaseFromExtraction({client,validated:valid,masters:F.MASTERS,notify:false})
 assert.equal(out.ok,false)
 assert.equal(out.reason,'readback_failed')
 assert.ok(reads > 0, 'duplicate replay must read the exact committed id')
})
function reset() {mock.__reset({tables:{projects:F.PROJECTS,vendors:F.VENDORS,purchase_requests:F.REQUESTS,pr_items:F.PR_ITEMS,receiving_items:[],receivings:[],bakpau_events:[],handovers:[]}})}
async function create(body) {
 const validated=C.validateStructuredPayload(body)
 assert.equal(validated.ok,true)
 return C.createPurchaseFromExtraction({client:mock.supabase,validated,masters:F.MASTERS,notify:false})
}
await test('actual create caller persists line-only single-project header and strict readback',async()=>{
 reset();const p=F.validCreatePayload();delete p.purchase.projectId
 const out=await create(p)
 assert.equal(out.ok,true);assert.equal(out.status,'tercatat')
 assert.equal(mock.__rows('receivings')[0].project_id,F.PROJECTS[0].id)
})
await test('actual create caller rejects mixed explicit line allocations before writing',async()=>{
 reset();const p=F.validCreatePayload()
 p.purchase.items=[{...p.purchase.items[0],qty:1},{...p.purchase.items[0],qty:1,projectId:F.PROJECTS[1].id}]
 const out=await create(p)
 assert.equal(out.ok,false);assert.equal(out.reason,'invalid_payload')
 assert.equal(mock.__rows('receivings').length,0)
 assert.equal(mock.__rows('receiving_items').length,0)
 assert.equal(mock.__rows('bakpau_events').length,0)
})
await test('verified duplicate replay returns original id without second RPC write',async()=>{
 reset();const p=F.validCreatePayload();const first=await create(p);const second=await create(p)
 assert.equal(first.ok,true);assert.equal(second.ok,true)
 assert.equal(second.status,'ignored_duplicate_event');assert.equal(second.receivingId,first.receivingId)
 assert.equal(second.readback.verified,true)
 assert.equal(mock.__rows('receivings').length,1)
})
await test('reused key with changed price and total fails exact persisted evidence readback',async()=>{
 reset();const p=F.validCreatePayload();assert.equal((await create(p)).ok,true)
 p.purchase.items[0].harga=130000;p.purchase.statedTotal=260000
 const out=await create(p)
 assert.equal(out.ok,false);assert.equal(out.reason,'readback_failed')
 assert.equal(mock.__rows('receivings').length,1)
})
console.log(JSON.stringify({passed,failed,synthetic:true}))
process.exitCode = failed ? 1 : 0
