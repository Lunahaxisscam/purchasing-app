// ============================================================
// BROWSER SHOT (t_6e6d00b0) — render Planning.js ASLI di browser nyata
// Memakai React UMD + CSS globals.css ASLI, supaya layout/CSS clip/hidden
// benar-benar diuji di mesin layout browser (bukan jsdom).
// Menghasilkan /tmp/planning-shot.html yang bisa dibuka browser.
//
// Jalankan: node scripts/planning-budget-test/browser_shot.mjs
//   lalu buka file:///tmp/planning-shot.html (title = PANEL_INPUTS=4 | HAS_PANEL=true)
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const REPO = path.resolve(new URL('../../', import.meta.url).pathname)
const swc = require('next/dist/build/swc')

function compileToCjs(file) {
  const src = fs.readFileSync(file, 'utf8')
  return swc.transformSync(src, {
    filename: file,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } },
    module: { type: 'commonjs' }
  }).code
}

const planningCjs = compileToCjs(path.join(REPO, 'components/Planning.js'))
const constantsCjs = compileToCjs(path.join(REPO, 'lib/constants.js'))
const css = fs.readFileSync(path.join(REPO, 'styles/globals.css'), 'utf8')

const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="data:text/css;base64,${Buffer.from(css).toString('base64')}">
<style>body{background:#f8f9fa;margin:0}</style>
</head><body>
<div id="root"></div>
<script src="file://${REPO}/node_modules/react/umd/react.development.js"></script>
<script src="file://${REPO}/node_modules/react-dom/umd/react-dom.development.js"></script>
<script>
window.__mockState = { projects:[{id:'p1',kode:'99',name:'Baroni',status:'ON_GOING'}], plans:[{id:'pl1',project_id:'p1',area:'Dapur',item_name:'Kabinet Atas',labor_cost:20000000,status:'Perencanaan',progress:50}], costs:[{project_no:'99',revenue:100000000,cumulative_cost:45000000,petty_cash:8000000}], failPlans:false, failCosts:false };
window.__supa = {
  from(table){ const q={ select(){return q}, eq(){return q}, order(){return q}, limit(){return q}, maybeSingle(){return q}, single(){return q}, then(res){ const data = table==='project_plans'?window.__mockState.plans:(table==='project_cost_summary'?window.__mockState.costs:window.__mockState.projects); return Promise.resolve({data,error:null}).then(res) } }; return q },
  auth:{ getSession(){return Promise.resolve({data:{session:{user:{id:'u1'}}}})}, onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}, signInWithPassword(){return Promise.resolve({error:null})} }
};
</script>
<script>window.__mods={};window.__cache={};
function __define(name,f){window.__mods[name]=f;}
function require(name){
  if(window.__cache[name])return window.__cache[name];
  if(name==='react')return window.__cache[name]=window.React;
  if(name==='react-dom'||name==='react-dom/client')return window.__cache[name]=window.ReactDOM;
  if(name.indexOf('supabaseClient')>=0)return window.__cache[name]={supabase:window.__supa};
  if(window.__mods[name]){var m={exports:{}};window.__mods[name](m,m.exports,require);return window.__cache[name]=m.exports;}
  if(name.indexOf('constants')>=0)return window.__cache[name]=require('lib/constants.js');
  throw new Error('unknown '+name);
}
</script>
<script>
__define('lib/constants.js', function(module, exports, require){
${constantsCjs}
});
</script>
<script>
__define('components/Planning.js', function(module, exports, require){
${planningCjs}
});
</script>
<script>
var Planning = require('components/Planning.js').default;
var root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(Planning, { rows:{projects:window.__mockState.projects}, session:{user:{id:'u1'}}, say:function(){}, setPage:function(){}, refresh:function(){} }));
setTimeout(function(){
  var r = document.querySelector('input[name="budgetMode"][value="custom"]');
  if(r){ r.click(); }
  setTimeout(function(){
    var n = document.querySelectorAll('.budget-pct-grid input.custom-pct-input').length;
    document.title = 'PANEL_INPUTS=' + n + ' | HAS_PANEL=' + !!document.querySelector('.budget-pct-panel');
    console.log(document.title);
  }, 300);
}, 300);
</script>
</body></html>`

fs.writeFileSync('/tmp/planning-shot.html', html)
console.log('WROTE /tmp/planning-shot.html')
