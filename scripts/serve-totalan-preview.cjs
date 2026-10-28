/* Static-only staging. No API routes and no database write capability. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../public');
const aliases = new Set(['/', '/index.html', '/parent.html', '/staging-parent.html']);
const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
http.createServer((req,res) => {
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Read only');return;}
  let name;
  try {name=decodeURIComponent(new URL(req.url,'http://preview').pathname);}catch {res.writeHead(400);res.end();return;}
  if(aliases.has(name))name='/upah-live-preview.html';
  const file=path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep) || name.split('/').some(x=>x.startsWith('.'))){res.writeHead(403);res.end();return;}
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','X-Upah-Staging':'totalan-layout-1'});
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  });
}).listen(3088,'100.91.244.41',()=>console.log('Totalan staging read-only http://100.91.244.41:3088/'));
