const http=require('http'),fs=require('fs'),path=require('path');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.vert':'text/plain; charset=utf-8','.frag':'text/plain; charset=utf-8','.glsl':'text/plain; charset=utf-8'};
http.createServer((q,r)=>{let f=q.url.split('?')[0];if(f==='/')f='/index.html';
const p=path.join(__dirname,path.normalize(f));
fs.readFile(p,(e,d)=>{if(e){r.writeHead(404);return r.end('not found');}
r.writeHead(200,{'content-type':types[path.extname(p)]||'application/octet-stream','cache-control':'no-cache'});r.end(d);});
}).listen(8000,'0.0.0.0');
