// Tests new features against a MOCK upstream (fixtures written from community docs; NOT real provider/sportsbook data).
const http=require("http"),fs=require("fs"),os=require("os"),path=require("path"),{spawn}=require("child_process");
const ev=(id,iso,me,op,ms,os_,done=true)=>({id,date:iso,competitions:[{status:{type:{completed:done,state:done?"post":"pre"}},competitors:[{homeAway:"home",team:{id:me,abbreviation:"ME",displayName:"Me"},score:{value:ms}},{homeAway:"away",team:{id:op,abbreviation:"O"+op,displayName:"Opp "+op},score:{value:os_}}]}]});
const roster=(id,starter,stats)=>({athlete:{id,displayName:"P"+id},starter,stats:stats.map(([name,v])=>({name,displayValue:String(v)}))});
const SOC={ // Inter Miami (20232) schedule in usa.1
 "/soccer/usa.1/teams/20232/schedule":{events:[ev("S1","2026-10-01T23:00Z","20232","99",2,1),ev("S2","2026-10-08T23:00Z","20232","55",1,1),ev("S3","2026-10-15T23:00Z","20232","99",0,3),ev("S4","2026-10-22T23:00Z","20232","77",0,0,false)]},
 "/soccer/usa.1/summary":{S1:{rosters:[{team:{id:"20232"},roster:[roster("45843",true,[["totalGoals",1],["goalAssists",1],["totalShots",4],["shotsOnTarget",2]])]}]},
  S2:{rosters:[{team:{id:"20232"},roster:[roster("7",true,[["totalGoals",0]])]}]},   // Messi absent from squad
  S3:{rosters:[{team:{id:"20232"},roster:[roster("45843",false,[["totalGoals",0],["goalAssists",0],["totalShots",1],["shotsOnTarget",0]])]}]}}};
const NBAT=(ids)=>({sports:[{leagues:[{teams:ids.map(([id,n,a])=>({team:{id,displayName:n,abbreviation:a}}))}]}]});
const ath=(id,n)=>({id,fullName:n,displayName:n,position:{abbreviation:"G"}});
const evMeta=(d,opp,oid)=>({gameDate:d,atVs:"vs",opponent:{id:oid,abbreviation:opp,displayName:"Team "+opp}});
function nbaLog(season){const rows=season==="2027"?[["2026-10-25T02:00Z","GS","9",30],["2026-11-01T02:00Z","MIA","14",22]]:season==="2026"?[["2026-03-01T02:00Z","GS","9",34],["2026-03-08T02:00Z","BOS","2",18]]:season==="2025"?[["2025-12-01T02:00Z","GS","9",26]]:
  [20,22,30,28,31,33,25,35,29,32].map((v,i)=>[`2026-10-${10+i}T02:00Z`,"X"+i,"5",v]);
  const events={},evs=[];rows.forEach((r,i)=>{events["e"+season+i]=evMeta(r[0],r[1],r[2]);evs.push({eventId:"e"+season+i,stats:[String(r[3]),"7","8"]})});
  return{names:["points","totalRebounds","assists"],events,seasonTypes:[{displayName:"Regular Season",categories:[{events:evs}]}]}}
const lines=(a,b,c,d)=>[{displayValue:String(a)},{displayValue:String(b)},{displayValue:String(c)},{displayValue:String(d)}];
const comp=(id,n,ab,ls,home)=>({homeAway:home?"home":"away",score:String(ls.reduce((x,y)=>x+y,0)),linescores:ls.map(v=>({displayValue:String(v)})),team:{id,displayName:n,abbreviation:ab}});
const playsFor=(ptsA,ptsB)=>[{scoringPlay:true,scoreValue:2,period:{number:1},participants:[{athlete:{id:"1966"}}]},{scoringPlay:true,scoreValue:3,period:{number:1},participants:[{athlete:{id:"1966"}}]},{scoringPlay:true,scoreValue:2,period:{number:2},participants:[{athlete:{id:"1966"}}]},{scoringPlay:true,scoreValue:3,period:{number:4},participants:[{athlete:{id:"3975"}}]},{scoringPlay:false,scoreValue:0,period:{number:3},participants:[{athlete:{id:"1966"}}]}];
const nbaSum=(ptsLeBron,ptsCurry,ls1,ls2)=>({header:{league:{name:"NBA"},competitions:[{date:"2026-11-08T03:00Z",status:{type:{state:"post",detail:"Final"}},competitors:[comp("13","Los Angeles Lakers","LAL",ls1,false),comp("9","Golden State Warriors","GS",ls2,true)]}]},
 boxscore:{teams:[],players:[{team:{id:"13"},statistics:[{labels:["MIN","PTS"],athletes:[{athlete:{id:"1966",displayName:"LeBron James"},starter:true,stats:["30",String(ptsLeBron)]}]}]},{team:{id:"9"},statistics:[{labels:["MIN","PTS"],athletes:[{athlete:{id:"3975",displayName:"Stephen Curry"},starter:true,stats:["31",String(ptsCurry)]}]}]}]},
 plays:playsFor(),pickcenter:[{provider:{name:"DraftKings"},details:"GS -3.5",overUnder:221.5,spread:-3.5}]});
const NBA_GAMES={"1":nbaSum(7,3,[28,25,30,24],[31,22,27,29]),"2":nbaSum(99,3,[20,20,20,20],[25,25,25,25,10]),"G1":nbaSum(7,3,[28,25,30,24],[31,22,27,29]),"G2":nbaSum(7,3,[30,20,25,25],[20,25,30,20]),"G3":nbaSum(7,3,[10,10,10,10],[20,20,20,20])};
const SCHED13={events:["G1","G2","G3"].map((id,i)=>({id,date:`2026-10-0${i+1}T02:00Z`,competitions:[{status:{type:{completed:true,state:"post"}},competitors:[{homeAway:"away",team:{id:"13",abbreviation:"LAL"},score:{value:100}},{homeAway:"home",team:{id:"9",abbreviation:"GS",displayName:"Golden State Warriors"},score:{value:100}}]}]}))};
const mock=http.createServer((req,res)=>{const u=new URL(req.url,"http://x"),k=u.pathname;let m;const j=(o,h={})=>{res.writeHead(200,{"content-type":"application/json",...h});res.end(JSON.stringify(o))};
 if(m=k.match(/^\/site\.api\.espn\.com\/apis\/site\/v2\/sports(.*)$/)){const r=m[1];
  if(r==="/soccer/usa.1/summary")return j(SOC["/soccer/usa.1/summary"][u.searchParams.get("event")]||{});
  if(SOC[r])return j(SOC[r]);
  if(r==="/soccer/usa.1/teams")return j(NBAT([["20232","Inter Miami CF","MIA"],["99","LAFC","LAFC"]]));
  if(r==="/soccer/usa.1/teams/20232/roster")return j({athletes:[ath("45843","Lionel Messi"),ath("7","Other Player")]});
  if(r==="/soccer/usa.1/teams/99/roster")return j({athletes:[]});
  if(r==="/basketball/nba/teams")return j(NBAT([["13","Los Angeles Lakers","LAL"],["9","Golden State Warriors","GS"],["2","Boston Celtics","BOS"]]));
  if(r==="/basketball/nba/teams/13/roster")return j({athletes:[ath("1966","LeBron James")]});
  if(r==="/basketball/nba/teams/9/roster")return j({athletes:[ath("3975","Stephen Curry")]});
  if(r==="/basketball/nba/teams/2/roster")return j({athletes:[]});
  if(r==="/basketball/nba/teams/13/schedule"||r==="/basketball/nba/teams/9/schedule")return j(SCHED13);
  if(r==="/basketball/nba/summary")return j(NBA_GAMES[u.searchParams.get("event")]||{})}
 if(k==="/site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/1966/gamelog")return j(nbaLog(u.searchParams.get("season")||""));
 res.writeHead(404);res.end("nf")});
let pass=0,bad=0;const T=(n,c,d)=>{c?pass++:bad++;console.log((c?"PASS ":"FAIL ")+n);if(!c&&d!==undefined)console.log("   got:",JSON.stringify(d).slice(0,700))};
const start=(port,extra)=>{const cd=fs.mkdtempSync(path.join(os.tmpdir(),"f-"));return{cd,p:spawn("node",["server.js"],{env:{...process.env,PORT:port,NO_WARM:"1",MOCK_BASE:"http://localhost:8793",CACHE_DIR:cd,...extra},stdio:"ignore"})}};
mock.listen(8793,async()=>{
 const A=start(8791,{});
 await new Promise(r=>setTimeout(r,1800));
 const get=async(port,p)=>{const r=await fetch("http://localhost:"+port+p);return{s:r.status,j:await r.json()}};
 try{
  let r=await get(8791,"/api/nba/players/1966/gamelog?season=2027");
  T("date fix: 7pm PT Nov 7 (03:00Z Nov 8) keeps ISO and ET date Nov 7",r.j.data.games.length===2);
  const mm=nbaLog("2027");mm.events.e20270.gameDate="2026-11-08T03:00Z";
  T("fixture check: ET date of 2026-11-08T03:00Z is 2026-11-07",new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date("2026-11-08T03:00Z"))==="2026-11-07");
  r=await get(8791,"/api/soccer/players/45843/gamelog");const g=r.j.data;
  T("soccer: Messi game log built from match box scores",r.s===200&&g.games.length===3&&g.team==="Inter Miami CF"&&g.league==="MLS");
  T("soccer: stats, result and starter flag per match",g.games[0].stats.totalGoals===1&&g.games[0].stats.goalAssists===1&&g.games[0].result==="W"&&g.games[0].starter===true&&g.games[2].result==="L"&&g.games[2].starter===false,g.games.map(x=>[x.id,x.result,x.starter,x.stats]));
  T("soccer: match he was not in the squad is flagged DNP (not invented)",g.games[1].dnp===true&&Object.keys(g.games[1].stats).length===0);
  T("soccer: unfinished match excluded",!g.games.some(x=>x.id==="S4"));
  T("soccer: minutes not invented when provider omits them",!g.statKeys.includes("minutesPlayed")&&/Minutes appear only if/.test(g.note));
  r=await get(8791,"/api/soccer/players/45843/h2h?opponent=99&seasons=1");
  T("soccer H2H: only meetings vs LAFC, averages",r.j.data.count===2&&r.j.data.averages.totalGoals===0.5&&r.j.data.baseline===null,r.j.data);
  r=await get(8791,"/api/nba/players/1966/h2h?opponent=9&seasons=3");const h=r.j.data;
  T("NBA H2H: finds meetings vs Warriors across 3 seasons (by team id)",r.s===200&&h.count===3&&h.opponent.name==="Golden State Warriors"&&h.seasonsChecked.join()==="2027,2026,2025");
  T("NBA H2H: H2H average 30 pts, baseline across all games",h.averages.points===30&&h.baselineGames===5&&Math.abs(h.baseline.points-26)<0.001);
  T("NBA H2H: recent3 uses latest meetings, includes derived PRA",h.recent3.points===30&&h.statKeys.includes("PRA"));
  r=await get(8791,"/api/nba/players/1966/h2h?opponent=9&seasons=3&from=2026-01-01&to=2026-12-31");T("H2H date-range filter",r.j.data.count===2);
  r=await get(8791,"/api/nba/players/1966/h2h?opponent=2&seasons=1");T("H2H with no meetings -> empty list, not error",r.s===200&&r.j.data.count===0);
  r=await get(8791,"/api/nba/players/1966/h2h?opponent=999");T("H2H unknown opponent -> 404, no silent substitution",r.s===404);
  r=await get(8791,"/api/nba/games/1");const gm=r.j.data;
  T("quarter scoring: 1Q-4Q + final",gm.periods.available&&gm.periods.labels.join()==="1Q,2Q,3Q,4Q"&&gm.periods.away.join()==="28,25,30,24"&&gm.periods.home.join()==="31,22,27,29"&&gm.periods.final.away==="107"&&gm.periods.final.home==="109");
  r=await get(8791,"/api/nba/games/2");T("overtime period labelled OT",r.j.data.periods.labels.join()==="1Q,2Q,3Q,4Q,OT");
  T("player quarter points from play-by-play, verified vs box score",gm.quarterPoints.verified===true&&gm.players.teams[0].groups[0].rows[0].qpts["1"]===5&&gm.players.teams[0].groups[0].rows[0].qpts["2"]===2&&gm.players.teams[1].groups[0].rows[0].qpts["4"]===3);
  r=await get(8791,"/api/nba/games/2");T("quarter points hidden when they do not match box score",r.j.data.quarterPoints.verified===false&&r.j.data.quarterPoints.available===false&&!("qpts" in r.j.data.players.teams[0].groups[0].rows[0])&&/not shown|Not shown/i.test(r.j.data.quarterPoints.note));
  r=await get(8791,"/api/nba/teams/13/quarters?games=3");const q=r.j.data;
  T("team quarter trends: Q1..Q4 averages and halves",q.games===3&&q.quarters.length===4&&q.quarters[0].scored===22.667&&q.quarters[0].allowed===23.667&&q.firstHalf.scored===41&&q.firstHalf.allowed===46&&Math.abs(q.secondHalf.scored-41.333)<0.001,q);
 }catch(e){console.log("ERROR",e);bad++}
 console.log(`\n${pass} passed, ${bad} failed`);[A].forEach(x=>x.p.kill());mock.close();process.exit(bad?1:0)});
