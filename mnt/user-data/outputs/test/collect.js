// Tests the collector against a MOCK upstream (shapes from community docs, NOT real provider data).
const http=require("http"),fs=require("fs"),os=require("os"),path=require("path"),{spawn}=require("child_process");
let failNba=false;
const mock=http.createServer((req,res)=>{const k=req.url.split("?")[0];
 const j=o=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(o))};
 if(k.endsWith("/scoreboard")){if(failNba&&k.includes("/basketball/nba/")){res.writeHead(500);return res.end("x")}
  return j({events:[{id:"1",shortName:"A @ B",date:"2026-11-08T00:00Z",status:{type:{state:"post",shortDetail:"Final"}},competitions:[{competitors:[{homeAway:"home",score:"1",team:{displayName:"B",abbreviation:"B"}},{homeAway:"away",score:"0",team:{displayName:"A",abbreviation:"A"}}]}]}]})}
 if(k.endsWith("/basketball/nba/teams"))return j({sports:[{leagues:[{teams:[{team:{id:"13",displayName:"Los Angeles Lakers",abbreviation:"LAL"}}]}]}]});
 if(k.endsWith("/basketball/nba/teams/13/roster"))return j({athletes:[{id:"1966",fullName:"LeBron James",position:{abbreviation:"SF"}},{id:"3",fullName:"Luka Doncic",position:{abbreviation:"PG"}}]});
 if(k.endsWith("/athletes/1966/gamelog"))return j({names:["points","assists","totalRebounds"],events:{a:{gameDate:"2026-11-02T01:00Z",atVs:"vs",opponent:{abbreviation:"BOS"}}},seasonTypes:[{displayName:"Regular Season",categories:[{events:[{eventId:"a",stats:["30","10","8"]}]}]}]});
 if(k.endsWith("/basketball/nba/standings"))return j({children:[{name:"East",standings:{entries:[{team:{displayName:"Boston"},stats:[{name:"wins",displayValue:"5"}]}]}}]});
 res.writeHead(404);res.end("nf")});
let pass=0,bad=0;const T=(n,c)=>{c?pass++:bad++;console.log((c?"PASS ":"FAIL ")+n)};
mock.listen(8797,async()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),"col-")),tr=path.join(out,"t.json");
 fs.writeFileSync(tr,JSON.stringify({players:[{sport:"nba",name:"lebron james"},{sport:"mlb",name:"Aaron Judge"},{sport:"soccer",name:"X"}]}));
 const run=mode=>new Promise(res=>{const c=spawn("node",["scripts/collect.js"],{env:{...process.env,OUT:out,MODE:mode,TRACKED:tr,MOCK_BASE:"http://localhost:8797",CACHE_DIR:path.join(out,"c")}});let o="";c.stdout.on("data",d=>o+=d);c.stderr.on("data",d=>o+=d);c.on("close",code=>res({status:code,out:o}))});
 const rj=f=>JSON.parse(fs.readFileSync(path.join(out,f),"utf8"));
 let r=await run("fast");T("fast run exits 0",r.status===0);
 T("scoreboard snapshot is the API envelope",rj("scoreboard/nba.json").ok===true&&rj("scoreboard/nba.json").data.games[0].home.abbr==="B");
 T("fast run does not collect standings/players",!fs.existsSync(path.join(out,"standings/nba.json")));
 r=await run("full");T("full run exits 0 with partial failures",r.status===0);
 T("standings written",rj("standings/nba.json").data.groups[0].entries[0].team==="Boston");
 T("tracked player gamelog written (id resolved by name)",rj("players/nba/1966.json").data.games[0].stats.points===30&&rj("players/nba/1966.json").data.games[0].stats.PRA===48);
 T("player index = roster directory (searchable) incl. tracked",rj("players/nba/index.json").data.players.length===2&&rj("players/nba/index.json").data.players.some(p=>p.name==="Luka Doncic")&&rj("players/mlb/index.json").data.players.length===0);
 const man=rj("manifest.json");
 T("failed dataset recorded in manifest (mlb search 404)",!!man.datasets["players/mlb/Aaron Judge"]?.error);
 T("unsupported sport recorded, no crash",!!man.datasets["players/soccer/X"]?.error);
 const before=fs.readFileSync(path.join(out,"scoreboard/nba.json"),"utf8");failNba=true;
 r=await run("fast");const after=fs.readFileSync(path.join(out,"scoreboard/nba.json"),"utf8");
 T("provider failure keeps previous good snapshot",before===after&&!!rj("manifest.json").datasets["scoreboard/nba"].error);
 T("manifest records last good update time",!!rj("manifest.json").datasets["scoreboard/nba"].updatedAt);
 console.log(`\n${pass} passed, ${bad} failed`);mock.close();process.exit(bad?1:0)});
