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
const ODDSEVENT={id:"OE1",home_team:"Golden State Warriors",away_team:"Los Angeles Lakers",commence_time:new Date(Date.now()+6*36e5).toISOString(),sport_key:"basketball_nba"};
const out=(book,key,player,point,over,under)=>[{name:"Over",description:player,price:over,point},{name:"Under",description:player,price:under,point}];
const ODDSDATA={...ODDSEVENT,bookmakers:[{key:"dk",title:"DraftKings",last_update:"2026-11-09T18:00:00Z",markets:[{key:"player_points",last_update:"2026-11-09T18:00:00Z",outcomes:[...out("dk","p","LeBron James",25.5,-110,-110),...out("dk","p","Stephen Curry",28.5,-115,-105),...out("dk","p","Unknown Guy",10.5,-110,-110)]}]},
 {key:"fd",title:"FanDuel",last_update:"2026-11-09T18:05:00Z",markets:[{key:"player_points",outcomes:[...out("fd","p","LeBron James",25.5,-105,-115),...out("fd","p","Stephen Curry",29.5,-110,-110)]}]}]};
let oddsCalls={events:0,odds:0};
const mock=http.createServer((req,res)=>{const u=new URL(req.url,"http://x"),k=u.pathname;let m;const j=(o,h={})=>{res.writeHead(200,{"content-type":"application/json",...h});res.end(JSON.stringify(o))};
 if(m=k.match(/^\/api\.the-odds-api\.com\/v4\/sports\/basketball_nba\/(.*)$/)){
  if(m[1]==="events"){oddsCalls.events++;return j([ODDSEVENT])}
  if(m[1]==="events/OE1/odds"){oddsCalls.odds++;return j(ODDSDATA,{"x-requests-last":"5","x-requests-remaining":"495"})}}
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
 if(k==="/site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard")return j({events:[{id:"1",shortName:"LAL @ GS",date:"2026-11-08T03:00Z",status:{type:{state:"post",shortDetail:"Final"}},competitions:[{odds:[{provider:{name:"DraftKings"},details:"GS -3.5",overUnder:221.5}],competitors:[{homeAway:"home",score:"109",team:{id:"9",displayName:"Golden State Warriors",abbreviation:"GS"}},{homeAway:"away",score:"107",team:{id:"13",displayName:"Los Angeles Lakers",abbreviation:"LAL"}}]}]}]});
 res.writeHead(404);res.end("nf")});
mock.listen(8793,()=>console.log("mock up"));
