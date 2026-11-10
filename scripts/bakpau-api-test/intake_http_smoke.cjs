// Actual Next HTTP runtime; SYNTHETIC credential, no business DB access.
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const path=require('node:path');
const net=require('node:net');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
let passed=0;
async function run(enabled){
 const secret=crypto.randomBytes(32).toString('base64url');
 const token='bpk.synthtest.'+secret;
 const hash=crypto.createHash('sha256').update(secret).digest('hex');
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
 const child=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'start','-p',String(port),'-H','127.0.0.1'],{
  cwd:root,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=1536',BAKPAU_API_TOKENS:'synthtest:'+hash+':purchasing:read+purchasing:create',BAKPAU_API_CREATE_ENABLED:String(enabled),NEXT_PUBLIC_SUPABASE_URL:'https://synthetic-build-only.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-build-only-not-a-real-key',SUPABASE_SERVICE_ROLE_KEY:''},stdio:['ignore','pipe','pipe']});
 let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 const base='http://127.0.0.1:'+port;
 async function post(route,body,auth=true){const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return [r.status,await r.json()];}
 try{
  let ready=false;
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Next exited: '+log.slice(-600));try{const r=await fetch(base);if(r.status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,'Next starts');passed++;
  let [s,j]=await post('/api/bakpau/v1/purchases',{},false);assert.equal(s,401);passed++;
  [s,j]=await post('/api/bakpau/v1/read',{resource:'not-whitelisted'});assert.equal(s,400);assert.equal(j.ok,false);passed++;
  [s,j]=await post('/api/bakpau/v1/purchases',{});
  assert.equal(s,enabled?422:503);assert.equal(j.code,enabled?'invalid_payload':'create_disabled');assert.equal(j.ok,false);passed++;
  console.log('PASS HTTP mode create_enabled='+enabled+'; root 200, unauthorized 401, unknown read 400, create '+s);
 }finally{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,5000).unref()});}
}
(async()=>{await run(false);await run(true);console.log(JSON.stringify({passed,failed:0,synthetic:true,businessWrites:0}));})().catch(e=>{console.error(e.message);process.exitCode=1;});
