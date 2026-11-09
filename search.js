// Directory search + box score normalization against a MOCK upstream.
// Player/team names below are TEST FIXTURES, not real provider data. Shapes follow community docs for ESPN/MLB/NHL.
const http=require("http"),fs=require("fs"),os=require("os"),path=require("path"),{spawn}=require("child_process");
const ath=(id,name,pos,extra={})=>({id,fullName:name,displayName:name,jersey:"1",position:{abbreviation:pos},headshot:{href:"https://img/"+id+".png"},...extra});
const teamsOf=(n)=>({sports:[{leagues:[{teams:n.map(([id,name,abbr])=>({team:{id,displayName:name,abbreviation:abbr,logos:[{href:"https://logo/"+id}]}}))}]}]});
const ROST={
 "/basketball/nba/teams/13/roster":{athletes:[ath("1966","LeBron James","SF"),ath("3","Luka Dončić","PG")]},
 "/basketball/nba/teams/9/roster":{athletes:[ath("3975","Stephen Curry","PG"),ath("3112335","Nikola Jokić","C")]},
 "/football/nfl/teams/12/roster":{athletes:[{position:"offense",items:[ath("3139477","Patrick Mahomes","QB")]},{position:"defense",items:[ath("77","Chris Jones","DT")]}]},
 "/soccer/esp.1/teams/86/roster":{athletes:[ath("231388","Kylian Mbappé","F"),ath("5","Lamine Yamal","F")]},
 "/soccer/eng.1/teams/382/roster":{athletes:[ath("4","Erling Haaland","F")]},
 "/soccer/usa.1/teams/20232/roster":{athletes:[ath("45843","Lionel Messi","F")]},
 "/soccer/ksa.1/teams/1/roster":{athletes:[ath("20","Cristiano Ronaldo","F")]},
};
const TEAMS={"/basketball/nba/teams":[["13","Los Angeles Lakers","LAL"],["9","Golden State Warriors","GS"]],"/football/nfl/teams":[["12","Kansas City Chiefs","KC"]],
 "/soccer/esp.1/teams":[["86","Real Madrid","RMA"]],"/soccer/eng.1/teams":[["382","Manchester City","MCI"]],"/soccer/usa.1/teams":[["20232","Inter Miami CF","MIA"]],"/soccer/ksa.1/teams":[["1","Al Nassr","NAS"]]};
const stat=(name,label,v)=>({name,label,displayValue:v});
const NBA_GAME={header:{league:{name:"NBA"},competitions:[{date:"2026-11-08T01:00Z",status:{type:{state:"in",detail:"Q3 5:12"},displayClock:"5:12",period:3},competitors:[{homeAway:"home",score:"80",team:{id:"9",displayName:"Golden State Warriors",abbreviation:"GS",logos:[{href:"l9"}]}},{homeAway:"away",score:"77",team:{id:"13",displayName:"Los Angeles Lakers",abbreviation:"LAL",logos:[{href:"l13"}]}}]}]},
 boxscore:{teams:[{team:{id:"13"},statistics:[stat("fieldGoalsMade-fieldGoalsAttempted","FG","30-60"),stat("fieldGoalPct","FG%","50"),stat("totalRebounds","Rebounds","30"),stat("pointsInPaint","Points in Paint","40")]},{team:{id:"9"},statistics:[stat("fieldGoalsMade-fieldGoalsAttempted","FG","28-61"),stat("fieldGoalPct","FG%","45.9"),stat("totalRebounds","Rebounds","33"),stat("pointsInPaint","Points in Paint","36")]}],
 players:[{team:{id:"13",displayName:"Los Angeles Lakers"},statistics:[{name:"",labels:["MIN","PTS","REB"],athletes:[{athlete:{id:"1966",displayName:"LeBron James"},starter:true,stats:["30","25","8"]},{athlete:{id:"7",displayName:"Bench Guy"},starter:false,didNotPlay:true,reason:"COACH'S DECISION",stats:[]}]}]},{team:{id:"9",displayName:"Golden State Warriors"},statistics:[{name:"",labels:["MIN","PTS","REB"],athletes:[{athlete:{id:"3975",displayName:"Stephen Curry"},starter:true,stats:["31","28","5"]}]}]}]}};
const SOC_GAME={header:{league:{name:"Premier League"},competitions:[{date:"2026-11-08T15:00Z",status:{type:{state:"post",detail:"FT"},displayClock:"90'+4'",period:2},competitors:[{homeAway:"home",score:"2",team:{id:"382",displayName:"Manchester City",abbreviation:"MCI"}},{homeAway:"away",score:"1",team:{id:"360",displayName:"Man United",abbreviation:"MAN"}}]}]},
 boxscore:{teams:[{team:{id:"382"},statistics:[stat("possessionPct","Possession","61"),stat("totalShots","Shots","15"),stat("shotsOnTarget","On Target","6")]},{team:{id:"360"},statistics:[stat("possessionPct","Possession","39"),stat("totalShots","Shots","8"),stat("shotsOnTarget","On Target","3")]}]},
 rosters:[{team:{id:"382"},roster:[{athlete:{id:"4",displayName:"Erling Haaland"},starter:true,stats:[{name:"totalGoals",abbreviation:"G",displayValue:"1"},{name:"shotsOnTarget",abbreviation:"ST",displayValue:"3"}]},{athlete:{id:"9",displayName:"Sub Player"},starter:false,subbedIn:true,stats:[{name:"totalGoals",abbreviation:"G",displayValue:"0"}]}]},{team:{id:"360"},roster:[]}]};
const mock=http.createServer((req,res)=>{const u=new URL(req.url,"http://x"),k=u.pathname;let m;
 const j=o=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(o))};
 if(m=k.match(/^\/site\.api\.espn\.com\/apis\/site\/v2\/sports(.*)$/)){const r=m[1];
  if(TEAMS[r])return j(teamsOf(TEAMS[r]));if(ROST[r])return j(ROST[r]);
  if(r==="/basketball/nba/summary")return j(NBA_GAME);if(r==="/soccer/eng.1/summary")return j(SOC_GAME)}
 if(k==="/statsapi.mlb.com/api/v1/teams")return j({teams:[{id:147,name:"New York Yankees",abbreviation:"NYY"}]});
 if(k==="/statsapi.mlb.com/api/v1/teams/147/roster")return j({roster:[{person:{id:592450,fullName:"Aaron Judge"},position:{abbreviation:"RF"},jerseyNumber:"99"}]});
 if(k==="/api-web.nhle.com/v1/standings/now")return j({standings:[{teamAbbrev:{default:"EDM"},teamName:{default:"Edmonton Oilers"},teamLogo:"l"}]});
 if(k==="/api-web.nhle.com/v1/roster/EDM/current")return j({forwards:[{id:8478402,firstName:{default:"Connor"},lastName:{default:"McDavid"},positionCode:"C",sweaterNumber:97,headshot:"h"}],defensemen:[],goalies:[]});
 res.writeHead(404);res.end("nf")});
let pass=0,bad=0;const T=(n,c)=>{c?pass++:bad++;console.log((c?"PASS ":"FAIL ")+n)};
mock.listen(8796,async()=>{
 const cd=fs.mkdtempSync(path.join(os.tmpdir(),"c-"));
 const srv=spawn("node",["server.js"],{env:{...process.env,PORT:8795,NO_WARM:"1",MOCK_BASE:"http://localhost:8796",CACHE_DIR:cd},stdio:"ignore"});
 await new Promise(r=>setTimeout(r,600));
 const get=async p=>{const r=await fetch("http://localhost:8795"+p);return{s:r.status,j:await r.json()}};
 const names=async(sp,q)=>(await get(`/api/${sp}/players?q=${encodeURIComponent(q)}`)).j.data?.players?.map(p=>p.name)||[];
 try{
  T("NBA: full name",(await names("nba","LeBron James"))[0]==="LeBron James");
  T("NBA: last name only",(await names("nba","curry"))[0]==="Stephen Curry");
  T("NBA: accent-free query finds Dončić",(await names("nba","Luka Doncic"))[0]==="Luka Dončić");
  T("NBA: accented query finds Jokić",(await names("nba","Nikola Jokić"))[0]==="Nikola Jokić"&&(await names("nba","jokic"))[0]==="Nikola Jokić");
  T("NBA: partial / prefix",(await names("nba","lebr"))[0]==="LeBron James"&&(await names("nba","Steph"))[0]==="Stephen Curry");
  T("NBA: misspelling (Lebrone Jammes)",(await names("nba","Lebrone Jammes"))[0]==="LeBron James");
  T("NFL: grouped roster shape parsed",(await names("nfl","mahomes"))[0]==="Patrick Mahomes"&&(await names("nfl","chris jones")).length===1);
  T("Soccer: Mbappe (no accent)",(await names("soccer","Mbappe"))[0]==="Kylian Mbappé");
  T("Soccer: Messi, Ronaldo, Haaland, Yamal across leagues",(await names("soccer","messi"))[0]==="Lionel Messi"&&(await names("soccer","cristiano ronaldo"))[0]==="Cristiano Ronaldo"&&(await names("soccer","haaland"))[0]==="Erling Haaland"&&(await names("soccer","yamal"))[0]==="Lamine Yamal");
  T("Soccer: misspelling Haland",(await names("soccer","Haland"))[0]==="Erling Haaland");
  T("MLB native roster directory",(await names("mlb","judge"))[0]==="Aaron Judge");
  T("NHL native roster directory",(await names("nhl","mcdavid"))[0]==="Connor McDavid");
  let r=await get("/api/nba/players?q=luka");const pl=r.j.data.players[0];
  T("result has photo, team, league, sport, position",pl.photo&&pl.team==="Los Angeles Lakers"&&pl.league==="NBA"&&pl.sport==="nba"&&pl.pos==="PG");
  T("directory meta reports completeness",r.j.meta.directory.complete===true&&r.j.meta.directory.teamsLoaded===2);
  T("no match returns empty list, not error",(await names("nba","zzzzqq")).length===0);
  r=await get("/api/nba/players/1966");T("player profile from directory",r.j.data.name==="LeBron James"&&r.j.data.gamelogAvailable===true);
  r=await get("/api/soccer/players/231388");T("soccer profile flags no game log",r.j.data.gamelogAvailable===false);
  r=await get("/api/soccer/players/231388/gamelog");T("soccer gamelog -> 501 with reason",r.s===501&&/soccer/i.test(r.j.error));
  r=await get("/api/nba/teams?q=lakers");T("team search",r.j.data.teams.length===1&&r.j.data.teams[0].name==="Los Angeles Lakers");
  r=await get("/api/nba/teams/13/roster");T("team roster",r.j.data.players.length===2&&r.j.data.team.abbr==="LAL");
  r=await get("/api/soccer/teams?q=nassr");T("soccer team search spans leagues",r.j.data.teams[0]?.league==="Saudi Pro League");
  r=await get("/api/nba/games/401");const g=r.j.data;
  T("NBA game header + live status",g.status.state==="live"&&g.status.clock==="5:12"&&g.home.name==="Golden State Warriors"&&g.away.logo==="l13");
  const rows=Object.fromEntries(g.teamStats.rows.map(x=>[x.label,x]));
  T("NBA team stats side-by-side, requested order",g.teamStats.rows[0].label==="Points"&&rows["Field Goals"].away==="30-60"&&rows["Field Goals"].home==="28-61"&&rows["Points in the Paint"].home==="36");
  T("NBA missing stats reported unavailable, not invented",g.teamStats.unavailable.includes("Fast-Break Points")&&g.teamStats.unavailable.includes("Steals"));
  const lakers=g.players.teams.find(t=>t.team.name.includes("Lakers"));
  T("NBA player table: starters, DNP reason, columns",lakers.groups[0].columns.map(c=>c.label).join()==="MIN,PTS,REB"&&lakers.groups[0].rows[0].starter===true&&lakers.groups[0].rows[1].dnp===true&&lakers.groups[0].rows[1].reason==="COACH'S DECISION"&&lakers.homeAway==="away");
  r=await get("/api/epl/games/700");const sg=r.j.data;
  T("Soccer game: completed + team stats",sg.status.state==="completed"&&sg.teamStats.rows[0].label==="Possession"&&sg.teamStats.rows[0].home==="61"&&sg.teamStats.unavailable.includes("Expected Goals (xG)"));
  const mc=sg.players.teams[0].groups[0];
  T("Soccer players: starter/sub + stat columns",mc.rows[0].starter&&mc.rows[1].subbedIn&&mc.columns[0].label==="G"&&mc.rows[0].stats.shotsOnTarget==="3");
  r=await get("/api/nba/games/401");T("second game call served from cache",r.j.meta.cache==="hit");
 }catch(e){console.log("ERROR",e);bad++}
 console.log(`\n${pass} passed, ${bad} failed`);srv.kill();mock.close();process.exit(bad?1:0)});
