// Murda Analytics: zero-dependency local server. Run: node server.js  then open http://localhost:8787
// Serves the site, the normalized API (/api/*) and a host-whitelisted pass-through (/proxy).
try{for(const l of require("fs").readFileSync(require("path").join(__dirname,".env"),"utf8").split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,"")}}catch{}
const http=require("http"),fs=require("fs"),path=require("path"),api=require("./api");
const OK=["site.api.espn.com","site.web.api.espn.com","statsapi.mlb.com","api-web.nhle.com","search.d3.nhle.com","api.jolpi.ca"];
http.createServer(async(req,res)=>{
 const u=new URL(req.url,"http://x");
 if(u.pathname.startsWith("/api/"))return api.handle(req,res,u).catch(e=>{res.writeHead(500,{"content-type":"application/json"});res.end(JSON.stringify({ok:false,error:e.message}))});
 if(u.pathname==="/proxy"){
  try{const t=new URL(u.searchParams.get("u"));
   if(t.protocol!=="https:"||!OK.includes(t.hostname)){res.writeHead(403);return res.end("blocked host")}
   const r=await fetch(t,{headers:{"user-agent":"Mozilla/5.0 murda-analytics","accept":"application/json"}});
   res.writeHead(r.status,{"content-type":r.headers.get("content-type")||"application/json"});
   res.end(Buffer.from(await r.arrayBuffer()));
  }catch(e){res.writeHead(502);res.end(String(e))}
  return}
 const page=["murda-analytics.html","edge-analytics.html"].map(f=>path.join(__dirname,f)).find(f=>fs.existsSync(f));   // old file name kept as a fallback so nothing breaks mid-upgrade
 fs.readFile(page||"",(e,d)=>{if(e){res.writeHead(404);return res.end("murda-analytics.html not found next to server.js")}res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(d)});
}).listen(process.env.PORT||8787,()=>{console.log("Open http://localhost:"+(process.env.PORT||8787));
 if(!process.env.NO_WARM){console.log("Murda Analytics is starting. Building player directories in the background (first run takes a few minutes; cached for 24h)...");api.warm(["nba","nfl","mlb","nhl","wnba","soccer"]).then(()=>console.log("Player directories ready."))}});
