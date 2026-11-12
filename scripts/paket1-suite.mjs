import assert from "node:assert"
import { buildEditRpcArgs } from "../lib/bakpau/apiEdit.js"
import { formatNotification } from "../lib/bakpau/notify.js"
import { isItemVoided, parseHargaFromNote } from "../lib/bakpau/itemVoid.js"
let pass=0, tests=[]
const t=(n,f)=>tests.push([n,f])
const RID="11111111-1111-4111-8111-111111111111"
const base=o=>({idempotencyKey:"t1",receiverId:"r1",patch:{},reason:"koreksi duplikat",...o})
t("void: harga 0 + [Void: 1]",()=>{const r=buildEditRpcArgs(base({receivingId:RID,items:[{itemName:"HPL",qty:2,harga:0,void:true,voidReason:"duplikat"}]}));assert.strictEqual(r.ok,true);assert.match(r.args.items[0].note,/\[Void: 1\]/)})
t("void tanpa alasan ditolak",()=>{const r=buildEditRpcArgs(base({receivingId:RID,items:[{itemName:"X",qty:1,harga:0,void:true}]}));assert.strictEqual(r.ok,false)})
t("harga 0 non-void sah",()=>{const r=buildEditRpcArgs(base({receivingId:RID,items:[{itemName:"Bonus",qty:1,harga:0}]}));assert.strictEqual(r.ok,true);assert.strictEqual(isItemVoided(r.args.items[0].note),false)})
t("nominal rebuild dari baris",()=>{const r=buildEditRpcArgs(base({receivingId:RID,patch:{note:"[Nominal: Rp 282.000] [Tahap: DIBELI]"},items:[{itemName:"H",qty:2,harga:0,void:true,voidReason:"dup"}]}));assert.match(r.args.patch.note,/\[Nominal: Rp 0\]/);assert.match(r.args.patch.note,/\[Tahap: DIBELI\]/)})
t("nominal_rebuild tanpa patch.note",()=>{const r=buildEditRpcArgs(base({receivingId:RID,items:[{itemName:"H",qty:2,harga:141000}]}));assert.strictEqual(r.args.patch.nominal_rebuild,282000)})
t("campur normal+void",()=>{const r=buildEditRpcArgs(base({receivingId:RID,items:[{itemName:"Semen",qty:10,harga:65000},{itemName:"Dup",qty:2,harga:0,void:true,voidReason:"ganda"}]}));assert.strictEqual(r.args.patch.nominal_rebuild,650000)})
t("notif: proyek dari projectId",()=>{const s=formatNotification({status:"tercatat",header:{vendorName:"Daman",projectId:"039e64df-0000-4000-8000-000000000001",projectNames:{"039e64df-0000-4000-8000-000000000001":"EA Store"}},lines:[{itemName:"HPL",projectId:"039e64df-0000-4000-8000-000000000001"}]});assert.match(s,/Proyek\s*:\s*EA Store/)})
t("notif: tanpa proyek tetap —",()=>{const s=formatNotification({status:"tercatat",header:{vendorName:"T"},lines:[{itemName:"S"}]});assert.match(s,/Proyek\s*:\s*—/)})
for(const [n,f] of tests){try{f();pass++;console.log("ok   "+n)}catch(e){console.log("FAIL "+n+" | "+e.message)}}
console.log("\nPASS "+pass+"/"+tests.length)
process.exit(pass===tests.length?0:1)

