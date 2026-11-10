// Plumbing tests against a MOCK upstream (shapes written from community docs, NOT real provider data).
const http=require("http"),{spawn}=require("child_process");
let hits={},fail=false;
const mock=http.createServer((req,res)=>{const k=req.url.split("?")[0];hits[k]=(hits[k]||0)+1;
 if(fail){res.writeHead(500);return res.end("x")}
 const j=o=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(o))};
 if(k.endsWith("/basketball/nba/scoreboard"))return j({events:[{id:"1",shortName:"LAL @ BOS",date:"2026-11-08T00:00Z",status:{type:{state:"post",shortDetail:"Final"}},competitions:[{competitors:[{homeAway:"home",score:"100",winner:true,team:{id:"2",displayName:"Boston Celtics",abbreviation:"BOS"}},{homeAway:"away",score:"90",team:{id:"13",displayName:"Los Angeles Lakers",abbreviation:"LAL"}}]}]}]});
 if(k.includes("/common/v3/search"))return j({items:[{type:"player",id:"1966",displayName:"LeBron James",league:"nba",subtitle:"Lakers"},{type:"player",id:"9",displayName:"Other",league:"nfl"},{type:"team",id:"3",displayName:"Team",league:"nba"}]});
 if(k.endsWith("/athletes/1966/gamelog"))return j({names:["minutes","fieldGoalsMade-fieldGoalsAttempted","totalRebounds","assists","points"],events:{"a":{gameDate:"2026-11-02T01:00Z",atVs:"vs",opponent:{abbreviation:"BOS"},gameResult:"W"},"b":{gameDate:"2026-11-04T01:00Z",atVs:"@",opponent:{abbreviation:"MIA"},gameResult:"L"}},seasonTypes:[{displayName:"Regular Season",categories:[{events:[{eventId:"b",stats:["35","9-18","6","8","20"]},{eventId:"a",stats:["36","10-20","8","10","30"]}]}]}]});
 res.writeHead(404);res.end("nf")});
const get=async p=>{const r=await fetch("http://localhost:8799"+p);return{s:r.status,j:await r.json()}};
let pass=0,bad=0;const T=(n,c)=>{c?pass++:bad++;console.log((c?"PASS ":"FAIL ")+n)};
mock.listen(8798,async()=>{
 const srv=spawn("node",["server.js"],{env:{...process.env,PORT:8799,MOCK_BASE:"http://localhost:8798"},stdio:"ignore"});
 await new Promise(r=>setTimeout(r,600));
 try{
  let r=await get("/api/sports");T("/api/sports lists nba + unsupported tennis",r.j.data.some(x=>x.key==="nba")&&r.j.data.some(x=>x.key==="tennis"&&x.supported===false));
  r=await get("/api/nba/scoreboard");T("scoreboard normalized",r.j.data.games[0].home.abbr==="BOS"&&r.j.data.games[0].state==="completed"&&r.j.meta.cache==="miss"&&r.j.meta.status==="completed");
  r=await get("/api/nba/scoreboard");T("second scoreboard call is a cache hit",r.j.meta.cache==="hit"&&hits["/site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"]===1);
  const rs=await Promise.all([1,2,3,4].map(()=>get("/api/nba/players?q=lebron")));T("4 concurrent searches -> 1 upstream call",hits["/site.web.api.espn.com/apis/common/v3/search"]===1);
  T("search filters to league + players only",rs[0].j.data.players.length===1&&rs[0].j.data.players[0].id==="1966");
  r=await get("/api/nba/players/1966/gamelog");const g=r.j.data.games;
  T("gamelog sorted oldest->newest, FG split, derived PRA",g[0].date==="2026-11-02"&&g[0].stats.fieldGoalsMade===10&&g[0].stats.fieldGoalsAttempted===20&&g[0].stats.PRA===48&&g[1].home===false);
  r=await get("/api/nba/players/1966/stats");T("stats averages computed (points avg 25)",r.j.data.season.points===25&&r.j.data.games===2);
  fail=true;await new Promise(r=>setTimeout(r,16));
  r=await get("/api/nba/scoreboard?date=20261107");T("upstream failure with no cache -> 502 unavailable, no crash",r.s===502&&r.j.ok===false&&r.j.meta.status==="unavailable");
  r=await get("/api/nba/players/1966/gamelog?season=2025");T("another uncached failure still handled",r.s===502);
  r=await get("/api/nba/unknown");T("unknown endpoint 404",r.s===404);
  r=await get("/api/epl/players?q=salah");T("unsupported player sport -> 501 with reason",r.s===501&&!!r.j.error);
  r=await get("/api/zzz/scoreboard");T("unknown sport 404",r.s===404);
  r=await get("/api/nba/players?q=a");T("short query 400",r.s===400);
  r=await get("/api/health");T("health reports last upstream error",!!r.j.data.hosts["site.api.espn.com"].lastError);
 }catch(e){console.log("ERROR",e);bad++}
 console.log(`\n${pass} passed, ${bad} failed`);srv.kill();mock.close();process.exit(bad?1:0)});
