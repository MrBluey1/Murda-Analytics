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
 if(k==="/site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/3/gamelog"){const ev={},evs=[];for(let i=0;i<12;i++){ev["e"+i]={gameDate:`2026-10-${10+i}T01:00Z`,atVs:i%2?"@":"vs",opponent:{abbreviation:"OPP"+i}};evs.push({eventId:"e"+i,stats:[String(20+i*2%9),String(6+i%4),String(7+i%5)]})}
  return j({names:["points","totalRebounds","assists"],events:ev,seasonTypes:[{displayName:"Regular Season",categories:[{events:evs}]}]})}
 const sbEv=(id,st,det)=>({id,shortName:"X",date:"2026-11-08T01:00Z",status:{type:{state:st,shortDetail:det}},competitions:[{competitors:[{homeAway:"home",score:"80",team:{id:"9",displayName:"Golden State Warriors",abbreviation:"GS",logo:"https://logo/9"}},{homeAway:"away",score:"77",team:{id:"13",displayName:"Los Angeles Lakers",abbreviation:"LAL",logo:"https://logo/13"}}]}]});
 if(k==="/site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard")return j({events:[sbEv("401","in","Q3 5:12")]});
 if(k==="/site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard")return j({events:[sbEv("700","post","FT")]});
 res.writeHead(404);res.end("nf")});
mock.listen(8796,()=>console.log("mock up"));
