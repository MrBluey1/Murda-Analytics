// Zero-dependency local server. Run: node server.js  then open http://localhost:8787
// Serves the site, the normalized API (/api/*) and a host-whitelisted pass-through (/proxy).
const http=require("http"),fs=require("fs"),path=require("path"),api=require("./api");
const OK=["site.api.espn.com","site.web.api.espn.com","statsapi.mlb.com","api-web.nhle.com","search.d3.nhle.com","api.jolpi.ca"];
http.createServer(async(req,res)=>{
 const u=new URL(req.url,"http://x");
 if(u.pathname.startsWith("/api/"))return api.handle(req,res,u).catch(e=>{res.writeHead(500,{"content-type":"application/json"});res.end(JSON.stringify({ok:false,error:e.message}))});
 if(u.pathname==="/proxy"){
  try{const t=new URL(u.searchParams.get("u"));
   if(t.protocol!=="https:"||!OK.includes(t.hostname)){res.writeHead(403);return res.end("blocked host")}
   const r=await fetch(t,{headers:{"user-agent":"Mozilla/5.0 edge-analytics","accept":"application/json"}});
   res.writeHead(r.status,{"content-type":r.headers.get("content-type")||"application/json"});
   res.end(Buffer.from(await r.arrayBuffer()));
  }catch(e){res.writeHead(502);res.end(String(e))}
  return}
 fs.readFile(path.join(__dirname,"edge-analytics.html"),(e,d)=>{res.writeHead(200,{"content-type":"text/html"});res.end(d)});
}).listen(process.env.PORT||8787,()=>{console.log("Open http://localhost:"+(process.env.PORT||8787));
 if(!process.env.NO_WARM){console.log("Building player directories in the background (first run takes a few minutes; cached for 24h)...");api.warm(["nba","nfl","mlb","nhl","wnba","soccer"]).then(()=>console.log("Player directories ready."))}});
