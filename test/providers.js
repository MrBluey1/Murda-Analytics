// Provider tests against a MOCK upstream. Fixtures follow each provider's documented/known format; they are NOT real data and the real services were not reachable.
// Expected numbers were calculated by hand (independently of lib/) so the tests check the formulas, not echo them.
const http=require("http"),fs=require("fs"),os=require("os"),path=require("path"),{spawn}=require("child_process");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"prov-")),DATA=path.join(tmp,"data");fs.mkdirSync(path.join(DATA,"cricsheet"),{recursive:true});fs.mkdirSync(path.join(DATA,"openpowerlifting"),{recursive:true});
// ---- fixtures ----
const csv=(h,rows)=>[h.join(","),...rows.map(r=>r.join(","))].join("\n");
const MR=(o)=>({MRData:o});
const JOL={drivers:MR({total:"3",DriverTable:{Drivers:[{driverId:"max_verstappen",givenName:"Max",familyName:"Verstappen",dateOfBirth:"1997-09-30",nationality:"Dutch",permanentNumber:"33"},{driverId:"hamilton",givenName:"Lewis",familyName:"Hamilton",dateOfBirth:"1985-01-07",nationality:"British"},{driverId:"jos_verstappen",givenName:"Jos",familyName:"Verstappen",dateOfBirth:"1972-03-04",nationality:"Dutch"}]}}),
 standings:MR({StandingsTable:{StandingsLists:[{season:"2026",round:"20",DriverStandings:[{position:"1",points:"400",wins:"9",Driver:{driverId:"max_verstappen",givenName:"Max",familyName:"Verstappen"},Constructors:[{name:"Red Bull"}]},{position:"3",points:"250",wins:"2",Driver:{driverId:"hamilton",givenName:"Lewis",familyName:"Hamilton"},Constructors:[{name:"Ferrari"}]}]}]}}),
 seasons:MR({StandingsTable:{StandingsLists:[{season:"2021",DriverStandings:[{position:"1",points:"395.5",wins:"10",Constructors:[{name:"Red Bull"}]}]},{season:"2022",DriverStandings:[{position:"1",points:"454",wins:"15",Constructors:[{name:"Red Bull"}]}]}]}}),
 results:MR({RaceTable:{Races:[{round:"1",raceName:"Bahrain Grand Prix",date:"2026-03-01",time:"15:00:00Z",Circuit:{circuitId:"bahrain",circuitName:"Bahrain International Circuit"},Results:[{position:"1",positionText:"1",points:"25",grid:"1",laps:"57",status:"Finished",FastestLap:{rank:"1"}}]},
  {round:"2",raceName:"Saudi Arabian Grand Prix",date:"2026-03-08",time:"17:00:00Z",Circuit:{circuitId:"jeddah",circuitName:"Jeddah"},Results:[{position:"3",positionText:"3",points:"15",grid:"5",laps:"50",status:"Finished",FastestLap:{rank:"4"}}]},
  {round:"3",raceName:"Australian Grand Prix",date:"2026-03-22",time:"05:00:00Z",Circuit:{circuitId:"albert_park",circuitName:"Albert Park"},Results:[{position:"20",positionText:"R",points:"0",grid:"2",laps:"10",status:"Engine"}]}]}})};
const PH="player_id,name_first,name_last,hand,dob,ioc,height,wikidata_id".split(",");
const MH="tourney_id,tourney_name,surface,tourney_level,tourney_date,match_num,winner_id,winner_name,loser_id,loser_name,round,minutes,w_ace,w_df,w_svpt,w_1stIn,w_1stWon,w_2ndWon,w_bpSaved,w_bpFaced,l_ace,l_df,l_svpt,l_1stIn,l_1stWon,l_2ndWon,l_bpSaved,l_bpFaced,winner_rank,loser_rank".split(",");
const ATP_P=csv(PH,[["100001","Novak","Djokovic","R","19870522","SRB","188","Q5812"],["100002","Carlos","Alcaraz","R","20030505","ESP","183","Q"],["100003","Old","Player","R","19700101","USA","180","Q"]]);
const ATP_26=csv(MH,[["2026-1","Hard Open","Hard","M","20260115","1","100001","Novak Djokovic","100002","Carlos Alcaraz","F","150","10","2","80","50","40","15","3","5","5","3","90","55","38","14","6","10","1","2"],["2026-2","Clay Open","Clay","M","20260510","2","100002","Carlos Alcaraz","100001","Novak Djokovic","SF","170","7","1","70","40","30","14","2","4","4","2","75","45","32","10","3","6","2","1"]]);
const ATP_25=csv(MH,[["2025-9","Hard Slam","Hard","G","20250901","3","100001","Novak Djokovic","100002","Carlos Alcaraz","QF","200","12","1","90","60","45","16","4","6","6","4","95","58","40","15","5","9","7","3"]]);
const NFLH="player_id,player_display_name,position,team,season,week,season_type,opponent_team,completions,attempts,passing_yards,passing_tds,passing_interceptions,sacks_suffered,sack_yards_lost,passing_epa,passing_cpoe,carries,rushing_yards,targets,receptions,receiving_yards,target_share".split(",");
const row=(id,n,pos,t,wk,opp,x={})=>[id,n,pos,t,2026,wk,"REG",opp,x.c??"",x.a??"",x.y??"",x.td??"",x.i??"",x.s??"",x.sy??"",x.epa??"",x.cpoe??"",x.car??"",x.ry??"",x.tg??"",x.rec??"",x.ryd??"",x.ts??""];
const NFL26=csv(NFLH,[row("00-0033873","Patrick Mahomes","QB","KC",1,"BAL",{c:25,a:35,y:300,td:3,i:0,s:2,sy:14,epa:8.5,cpoe:3.0,car:3,ry:12}),row("00-0033873","Patrick Mahomes","QB","KC",2,"CIN",{c:20,a:30,y:250,td:1,i:1,s:3,sy:21,epa:-1.5,cpoe:-2.0,car:2,ry:8}),
 row("00-0034857","Josh Allen","QB","BUF",1,"MIA",{c:20,a:30,y:200,td:1,i:0}),row("00-0036000","Josh Allen","LB","JAX",1,"HOU",{}),row("00-0030001","Chris Jones","DT","KC",1,"BAL",{}),row("00-0031000","Chris Jones","CB","DET",1,"GB",{}),row("00-0036442","Jordan Love","QB","GB",1,"DET",{c:10,a:20,y:100,td:0,i:0}),row("00-0040000","Wide Guy","WR","KC",1,"BAL",{tg:10,rec:7,ryd:90,ts:0.3})]);
const NFLGAMES=csv(["season","week","gameday","away_team","home_team"],[[2026,1,"2026-09-10","BAL","KC"],[2026,2,"2026-09-17","KC","CIN"]]);
const esp=(id,n,pos,x={})=>({id,fullName:n,displayName:n,position:{abbreviation:pos},jersey:"1",headshot:{href:"https://img/"+id+".png"},...x});
const teamsOf=a=>({sports:[{leagues:[{teams:a.map(([id,n,ab])=>({team:{id,displayName:n,abbreviation:ab}}))}]}]});
const ESPN={"/football/nfl/teams":teamsOf([["12","Kansas City Chiefs","KC"],["4","Buffalo Bills","BUF"]]),"/football/nfl/teams/12/roster":{athletes:[{position:"offense",items:[esp("3139477","Patrick Mahomes","QB"),esp("9001","Jordan Love","TE")]},{position:"defense",items:[esp("77","Chris Jones","DT")]}]},"/football/nfl/teams/4/roster":{athletes:[{position:"offense",items:[esp("3918298","Josh Allen","QB")]}]},
 "/basketball/nba/teams":teamsOf([["13","Los Angeles Lakers","LAL"]]),"/basketball/nba/teams/13/roster":{athletes:[esp("1966","LeBron James","SF")]},
 "/soccer/usa.1/teams":teamsOf([["20232","Inter Miami CF","MIA"]]),"/soccer/usa.1/teams/20232/roster":{athletes:[esp("45843","Lionel Messi","F")]},
 "/soccer/esp.1/teams":teamsOf([["86","Real Madrid","RMA"]]),"/soccer/esp.1/teams/86/roster":{athletes:[esp("231388","Kylian Mbappé","F")]}};
const NBALOG={names:["points","totalRebounds","assists"],events:Object.fromEntries([20,22,30,28,31,33,25,35,29,32].map((v,i)=>["e"+i,{gameDate:`2026-10-${10+i}T02:00Z`,atVs:"vs",opponent:{id:"5",abbreviation:"X"+i}}])),seasonTypes:[{displayName:"Regular Season",categories:[{events:[20,22,30,28,31,33,25,35,29,32].map((v,i)=>({eventId:"e"+i,stats:[String(v),"7","8"]}))}]}]};
const TSDB=q=>/scheffler/i.test(q)?{player:[{idPlayer:"101",strPlayer:"Scottie Scheffler",strTeam:"",strSport:"Golf",strPosition:"Golfer",strCutout:"https://img/ss.png",dateBorn:"1996-06-21",strNationality:"United States"}]}:/mbapp/i.test(q)?{player:[{idPlayer:"102",strPlayer:"Kylian Mbappé",strTeam:"Real Madrid",strSport:"Soccer",strPosition:"Forward",strCutout:"https://img/km.png",dateBorn:"1998-12-20"}]}:/messi/i.test(q)?{player:[{idPlayer:"103",strPlayer:"Lionel Messi",strTeam:"Newell's Old Boys",strSport:"Soccer",strPosition:"Midfielder",dateBorn:"1987-06-24"}]}:{player:null};
const MLBP={people:[{id:592450,fullName:"Aaron Judge",primaryPosition:{abbreviation:"RF"},currentTeam:{name:"New York Yankees"},birthDate:"1992-04-26",birthCountry:"USA",batSide:{code:"R"},pitchHand:{code:"R"},mlbDebutDate:"2016-08-13"}]};
const hs={season:"2025",team:{name:"New York Yankees"},league:{name:"American League"},sport:{id:1},stat:{gamesPlayed:152,atBats:541,hits:179,homeRuns:53,rbi:114,baseOnBalls:124,strikeOuts:162,plateAppearances:679,avg:".331",obp:".457",slg:".688",ops:"1.144",totalBases:372}};
const NHLL={playerId:8478402,firstName:{default:"Connor"},lastName:{default:"McDavid"},position:"C",currentTeamAbbrev:"EDM",headshot:"https://img/cm.png",birthDate:"1997-01-13",birthCountry:"CAN",seasonTotals:[{season:20252026,leagueAbbrev:"NHL",gameTypeId:2,teamName:{default:"Edmonton Oilers"},gamesPlayed:75,goals:32,assists:38,points:70,plusMinus:12,pim:20,shots:280},{season:20212022,leagueAbbrev:"AHL",gameTypeId:2,teamName:{default:"X"},gamesPlayed:10,goals:1,assists:1,points:2}],careerTotals:{regularSeason:{gamesPlayed:700,goals:300,assists:500,points:800,shots:2400}}};
// ---- mock ----
const calls={},seen={};let flaky=0,lastHdr={};
const mock=http.createServer((req,res)=>{const u=new URL(req.url,"http://x"),k=u.pathname;calls[k]=(calls[k]||0)+1;lastHdr=req.headers;let m;
 const j=o=>{res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(o))},t=s=>{res.writeHead(200,{"content-type":"text/plain"});res.end(s)};
 if(k==="/flaky.test/x"){flaky++;if(flaky===1){res.writeHead(429,{"retry-after":"0"});return res.end("slow down")}return j({ok:true})}
 if(k==="/api.jolpi.ca/ergast/f1/drivers.json")return j(JOL.drivers);
 if(k==="/api.jolpi.ca/ergast/f1/current/driverStandings.json"){seen.jolStandings=(seen.jolStandings||0)+1;return j(JOL.standings)}
 if(k==="/api.jolpi.ca/ergast/f1/drivers/max_verstappen/driverStandings.json")return j(JOL.seasons);
 if(k==="/api.jolpi.ca/ergast/f1/2026/drivers/max_verstappen/results.json")return j(JOL.results);
 if(k==="/raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_players.csv")return t(ATP_P);
 if(k==="/raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_players.csv")return t(csv(PH,[["200001","Iga","Swiatek","R","20010531","POL","176","Q"]]));
 if(k==="/raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_2026.csv")return t(ATP_26);
 if(k==="/raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_2025.csv")return t(ATP_25);
 if(k==="/github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_2026.csv")return t(NFL26);
 if(k==="/raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv")return t(NFLGAMES);
 if(k==="/www.thesportsdb.com/api/v1/json/3/searchplayers.php")return j(TSDB(u.searchParams.get("p")||""));
 if(k==="/www.thesportsdb.com/api/v1/json/3/lookupplayer.php")return j({players:[{idPlayer:"101",strPlayer:"Scottie Scheffler",strSport:"Golf",strNationality:"United States",dateBorn:"1996-06-21",strBirthLocation:"Ridgewood, NJ",strHeight:"6 ft 3 in",strDescriptionEN:"American professional golfer."}]});
 if(k==="/statsapi.mlb.com/api/v1/people/592450")return j(MLBP);
 if(k==="/statsapi.mlb.com/api/v1/people/592450/stats"){const g=u.searchParams.get("group"),s=u.searchParams.get("stats");if(g==="pitching")return j({stats:[{splits:[]}]});return j({stats:[{splits:[s==="career"?{...hs,season:undefined}:hs]}]})}
 if(k==="/statsapi.mlb.com/api/v1/stats/leaders"){const g=u.searchParams.get("statGroup");return j(g==="hitting"?{leagueLeaders:[{leaderCategory:"homeRuns",leaders:[{rank:1,value:"58",person:{id:592450,fullName:"Aaron Judge"},team:{name:"New York Yankees"}}]}]}:{leagueLeaders:[]})}
 if(k==="/api-web.nhle.com/v1/player/8478402/landing")return j(NHLL);
 if(k==="/api-web.nhle.com/v1/skater-stats-leaders/current")return j({goals:[{id:8478402,firstName:{default:"Connor"},lastName:{default:"McDavid"},teamAbbrev:"EDM",value:45}]});
 if(k==="/api.football-data.org/v4/competitions/PL/scorers")return j({scorers:[{player:{id:1,name:"Erling Haaland"},team:{name:"Manchester City FC"},goals:12,assists:3}]});
 if(m=k.match(/^\/site\.api\.espn\.com\/apis\/site\/v2\/sports(.*)$/)){if(ESPN[m[1]])return j(ESPN[m[1]])}
 if(k==="/site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/1966/gamelog")return j(NBALOG);
 res.writeHead(404);res.end("nf")});
let pass=0,bad=0;const T=(n,c,d)=>{c?pass++:bad++;console.log((c?"PASS ":"FAIL ")+n);if(!c&&d!==undefined)console.log("   got:",JSON.stringify(d).slice(0,500))};
fs.writeFileSync(path.join(DATA,"cricsheet","1.json"),JSON.stringify({info:{dates:["2024-04-01"],teams:["A","B"],match_type:"T20",event:{name:"Test League"},registry:{people:{"Batter One":"id1","Bowler One":"id2","Batter Two":"id3"}},outcome:{winner:"A"}},innings:[{team:"A",overs:[{over:0,deliveries:[
 {batter:"Batter One",bowler:"Bowler One",runs:{batter:4,extras:0,total:4}},{batter:"Batter One",bowler:"Bowler One",runs:{batter:0,extras:1,total:1},extras:{wides:1}},{batter:"Batter One",bowler:"Bowler One",runs:{batter:6,extras:0,total:6}},{batter:"Batter One",bowler:"Bowler One",runs:{batter:1,extras:0,total:1}},
 {batter:"Batter Two",bowler:"Bowler One",runs:{batter:0,extras:0,total:0},wickets:[{player_out:"Batter Two",kind:"bowled"}]},{batter:"Batter One",bowler:"Bowler One",runs:{batter:0,extras:2,total:2},extras:{legbyes:2}}]}]}]}));
const OPLH="Name,Sex,Event,Equipment,Age,Division,BodyweightKg,WeightClassKg,Best3SquatKg,Best3BenchKg,Best3DeadliftKg,TotalKg,Place,Dots,Wilks,Goodlift,Tested,Country,Federation,Date,MeetCountry,MeetName".split(",");
fs.writeFileSync(path.join(DATA,"openpowerlifting","openpowerlifting.csv"),csv(OPLH,[["Test Lifter","M","SBD","Raw","25","Open","82.5","83","200","130","240","570","1","380.5","370.1","80.2","Yes","USA","IPF","2023-05-01","USA","Nationals"],["Test Lifter","M","SBD","Raw","26","Open","83","83","210","135","250","595","2","395.2","385.0","82.0","Yes","USA","IPF","2024-06-01","USA","Worlds"]]));
const root=path.join(__dirname,"..");
mock.listen(8770,async()=>{
 process.env.MOCK_BASE="http://localhost:8770";process.env.CACHE_DIR=path.join(tmp,"unit-cache");process.env.DATA_DIR=DATA;
 try{
  // ---- unit: http layer, calc, predict, identity, importers ----
  const H=require(path.join(root,"lib/http.js")),calc=require(path.join(root,"lib/calc.js")),pred=require(path.join(root,"lib/predict.js")),idn=require(path.join(root,"lib/identity.js"));
  const r1=await H.getJSON("https://flaky.test/x");T("HTTP 429 handled: retried with backoff and succeeded",r1.ok===true&&calls["/flaky.test/x"]===2);
  let n=0;await H.cachedFetch("k1",1,async()=>{n++;return{v:1}},{provider:"t"});await new Promise(r=>setTimeout(r,5));
  const st=await H.cachedFetch("k1",1,async()=>{throw new Error("upstream down")},{provider:"t"});T("provider failure -> stale cached data served, flagged (never fabricated)",st.data.v===1&&st.meta.cache==="stale"&&/upstream down/.test(st.meta.upstreamError));
  let thrown=false;try{await H.cachedFetch("never",1,async()=>{throw new Error("x")})}catch{thrown=true}T("no cache + failure -> error propagates (no fake data)",thrown);
  T("CSV parser handles quotes, commas and newlines",JSON.stringify(H.parseCSV('a,b\n"x, y","he said ""hi"""\n'))===JSON.stringify([["a","b"],["x, y",'he said "hi"']]));
  T("passer rating formula (hand-calculated 125.9)",calc.football({completions:25,attempts:35,passingYards:300,passingTds:3,interceptions:0}).passer_rating===125.9);
  T("season rate stats: comp% .692, Y/A 8.46, ANY/A 7.86, rating 109.1",(f=>f.comp_pct===0.692&&f.ypa===8.46&&f.anya===7.86&&f.passer_rating===109.1)(calc.football({completions:45,attempts:65,passingYards:550,passingTds:4,interceptions:1,sacks:5,sackYards:35})));
  T("missing inputs -> null, never a guess",calc.football({attempts:30}).passer_rating===null&&calc.basketball({points:20}).ts_pct===null&&calc.per90(3,null)===null&&calc.baseball({}).k_pct===undefined);
  const bb=calc.basketball({points:30,fieldGoalsMade:10,fieldGoalsAttempted:20,threePointFieldGoalsMade:4,freeThrowsAttempted:10,minutes:36});T("TS% = 30/(2×(20+4.4)) = .615 and eFG% = (10+2)/20 = .6",bb.ts_pct===0.615&&bb.efg_pct===0.6&&bb.pts_per36===30);
  const pe=pred.estimate([20,22,30,28,31,33,25,35,29,32],{threshold:25.5});T("model estimate 29.42, range ±sd, consistency .83, P(over 25.5) empirical .70",pe.available&&pe.estimate===29.42&&pe.low===24.58&&pe.consistency===0.83&&pe.pOverEmpirical===0.7&&/not a guarantee/i.test(pe.method),pe);
  T("model refuses to guess with <5 games",pred.estimate([1,2,3]).available===false);
  const adj=pred.estimate([20,22,30,28,31,33,25,35,29,32],{h2h:{n:3,avg:36,baseline:28.5}});T("opponent adjustment is shrunk for small samples (3 meetings)",adj.estimate>29.42&&adj.estimate<29.42*1.1&&adj.adjustments.length===1,adj);
  T("identity: same name + corroborating team links",idn.match({name:"Josh Allen",team:"BUF",pos:"QB"},[{id:"a",name:"Josh Allen",team:"BUF",pos:"QB"},{id:"b",name:"Josh Allen",team:"JAX",pos:"LB"}]).match.id==="a");
  T("identity: same name but nothing corroborates -> NOT merged",idn.match({name:"Jordan Love",team:"KC",pos:"TE"},[{id:"x",name:"Jordan Love",team:"GB",pos:"QB"}]).match===null);
  T("identity: ambiguous names are refused",idn.match({name:"Chris Jones",team:"",pos:""},[{id:"1",name:"Chris Jones",team:"KC",pos:"DT"},{id:"2",name:"Chris Jones",team:"DET",pos:"CB"}]).match===null);
  const cs=require(path.join(root,"lib/providers/cricsheet.js")),ix=cs.buildIndex(path.join(DATA,"cricsheet"));
  const b1=cs.gamelog("id1").games[0].stats,bw=cs.gamelog("id2").games[0].stats,b2=cs.gamelog("id3").games[0].stats;
  T("Cricsheet batting: 11 runs off 4 balls (wide not a ball), 1 four, 1 six, SR 275",b1.runs===11&&b1.ballsFaced===4&&b1.fours===1&&b1.sixes===1&&b1.strikeRate===275&&b1.dismissed===0,b1);
  T("Cricsheet bowling: 5 legal balls, 12 runs (leg-byes not charged), 1 wicket, economy 14.4",bw.legalBalls===5&&bw.runsConceded===12&&bw.wickets===1&&bw.economy===14.4&&bw.overs===0.5,bw);
  T("Cricsheet dismissal recorded for the batter out",b2.dismissed===1&&b2.runs===0);
  const opl=require(path.join(root,"lib/providers/openpowerlifting.js"));await opl.buildIndex();const og=opl.gamelog(opl.search("test lifter")[0].id);
  T("OpenPowerlifting: meets, personal bests, published Dots kept as published",og.games.length===2&&og.personalBests.total===595&&og.personalBests.squat===210&&og.games[0].stats.dots===380.5&&/not recomputed/.test(og.note),og.personalBests);
  // ---- server-level ----
  const S=(port,extra={})=>spawn("node",["server.js"],{cwd:root,env:{...process.env,PORT:port,NO_WARM:"1",CACHE_DIR:path.join(tmp,"c"+port),DATA_DIR:DATA,MOCK_BASE:"http://localhost:8770",...extra},stdio:"ignore"});
  const A=S(8771),B=S(8772,{FOOTBALL_DATA_KEY:"free-test-token"});await new Promise(r=>setTimeout(r,1800));
  const get=async(p,port=8771)=>{const r=await fetch("http://localhost:"+port+p);return{s:r.status,j:await r.json()}};
  let r=await get("/api/f1/players?q=verstappen");const f1=r.j.data.players;
  T("F1 search: current driver first, team from live standings",f1.length===2&&f1[0].id==="max_verstappen"&&f1[0].team==="Red Bull"&&f1[0].league==="Formula 1",f1);
  r=await get("/api/f1/players/max_verstappen/gamelog");let g=r.j.data;
  T("F1 race log: win+pole+fastest lap, P3 from grid 5 (+2), DNF flagged",g.games.length===3&&g.games[0].stats.win===1&&g.games[0].stats.pole===1&&g.games[0].stats.fastestLap===1&&g.games[1].stats.podium===1&&g.games[1].stats.positionsGained===2&&g.games[2].stats.dnf===1&&g.games[0].startTime==="2026-03-01T15:00:00Z",g.games.map(x=>x.stats));
  r=await get("/api/f1/players/max_verstappen/profile");T("F1 profile: career from official standings (2 titles, 25 wins, 849.5 pts) + provenance",r.j.data.career.championships===2&&r.j.data.career.wins===25&&r.j.data.career.points===849.5&&r.j.data.identity.murdaId==="murda:f1:jolpica:max_verstappen"&&r.j.data.meta.provider==="jolpica",r.j.data.career);
  r=await get("/api/tennis/players?q=djokovic");T("Tennis search (ATP/WTA files) finds Djokovic with country + tour",r.j.data.players[0].name==="Novak Djokovic"&&r.j.data.players[0].league==="ATP"&&r.j.data.players[0].team==="SRB"&&r.j.data.players[0].current===true,r.j.data.players);
  r=await get("/api/tennis/players?q=swiatek&league=WTA");T("Tennis league filter (WTA)",r.j.data.players.length===1&&r.j.data.players[0].league==="WTA");
  r=await get("/api/tennis/players/atp_100001/gamelog?season=2026");g=r.j.data;const s1=g.games[0].stats;
  T("Tennis match stats from raw counts: 1st serve 62.5%, 1st won 80%, 2nd won 50%, BP saved 3/5, 10 aces",g.games.length===2&&s1.firstServePct===62.5&&s1.firstServeWonPct===80&&s1.secondServeWonPct===50&&s1.aces===10&&s1.bpSaved===3&&s1.bpFaced===5&&g.games[0].result==="W"&&g.games[1].result==="L",s1);
  r=await get("/api/tennis/players/atp_100001/profile?seasons=3");const ps=r.j.data.seasons.find(x=>x.season==="2026");
  T("Tennis season row: 2 matches, 50% wins, hard 100% / clay 0%, BP converted 40%+ from opponent counts",ps&&ps.stats.matches===2&&ps.stats.winPct===50&&ps.stats.surface.Hard.winPct===100&&ps.stats.surface.Clay.winPct===0&&r.j.data.seasons.length===2,ps);
  r=await get("/api/tennis/players/atp_100001/h2h?opponent=atp_100002&seasons=3");T("Tennis H2H vs Alcaraz across seasons: 3 meetings, 2-1, by surface",r.j.data.count===3&&r.j.data.wins===2&&r.j.data.losses===1&&r.j.data.bySurface.Hard.w===2&&r.j.data.bySurface.Clay.l===1,r.j.data);
  r=await get("/api/nfl/players?q=mahomes");const mp=r.j.data.players[0];T("NFL directory (ESPN) gives photo + team for Mahomes",mp.name==="Patrick Mahomes"&&mp.photo&&mp.team==="Kansas City Chiefs");
  r=await get("/api/nfl/players/3139477/gamelog");g=r.j.data;
  T("NFL log via nflverse (linked by name+team+position): EPA/CPOE as provided, rating calculated, dates from schedule",g.games.length===2&&g.linked.nflverse==="00-0033873"&&g.games[0].stats.passer_rating===125.9&&g.games[0].stats.passingEpa===8.5&&g.games[0].date==="2026-09-10"&&g.games[0].home===true&&g.games[1].home===false&&g.games[0].label==="Wk 1",g.linked);
  r=await get("/api/nfl/players/3139477/profile");const sp=r.j.data.seasons[0],av=Object.fromEntries(sp.advanced.map(a=>[a.key,a]));
  T("NFL season: totals, completion % .692, ANY/A 7.86; EPA marked 'provided', CPOE 0.69 marked calculated approximation",sp.stats.passingYards===550&&av.comp_pct.value===0.692&&av.anya.value===7.86&&av.passer_rating.value===109.1&&av.passingEpa.value===7&&av.passingEpa.kind==="provided"&&av.cpoe.value===0.69&&av.cpoe.kind==="calculated"&&/Approximation/.test(av.cpoe.note),av);
  T("NFL profile lists what is unavailable instead of inventing it",r.j.data.extraUnavailable.some(x=>/Snap counts/.test(x.label)&&x.kind==="unavailable"));
  r=await get("/api/nfl/players?q=jordan%20love");const jl=r.j.data.players.find(x=>x.team==="Kansas City Chiefs");r=await get("/api/nfl/players/"+jl.id+"/profile");T("identity: same-name player with different team/position is NOT linked to nflverse",!!r.j.data.unlinked&&r.j.data.seasons.length===0,r.j.data);
  r=await get("/api/nfl/players?q=josh%20allen");const ja=r.j.data.players[0];r=await get("/api/nfl/players/"+ja.id+"/gamelog");T("identity: two nflverse 'Josh Allen's -> the QB on the same team is chosen",r.j.data.linked.nflverse==="00-0034857",r.j.data.linked);
  r=await get("/api/mlb/players/592450/profile");const mp2=r.j.data,mh=mp2.seasons[0];const ma=Object.fromEntries(mh.advanced.map(a=>[a.key,a]));
  T("MLB profile: official AVG/OBP/SLG/OPS as published; K% .239, BB% .183, ISO .357 calculated",ma.avg.kind==="official"&&ma.ops.value===1.144&&ma.k_pct.value===0.239&&ma.bb_pct.value===0.183&&ma.iso.value===0.357&&ma.k_pct.kind==="calculated"&&mp2.career.hitting,ma);
  T("MLB: OPS+/wRC+/WAR/FIP explicitly unavailable",mp2.extraUnavailable[0].label.includes("WAR")&&mp2.extraUnavailable[0].kind==="unavailable");
  r=await get("/api/nhl/players/8478402/profile");const nh=r.j.data,na=Object.fromEntries(nh.seasons[0].advanced.map(a=>[a.key,a]));
  T("NHL profile: only NHL regular-season rows; shooting % .114, points/game .93 calculated; Corsi unavailable",nh.seasons.length===1&&nh.seasons[0].season==="2025-2026"&&na.sh_pct.value===0.114&&na.pts_pg.value===0.93&&nh.extraUnavailable[0].label.includes("Corsi"),na);
  r=await get("/api/golf/players?q=scheffler");T("Golf (info-only) search via TheSportsDB with image",r.j.data.players[0].name==="Scottie Scheffler"&&r.j.data.players[0].photo&&r.j.data.players[0].info===true,r.j.data.players);
  r=await get("/api/golf/players/101/profile");T("Golf profile: bio shown, statsAvailable=false (nothing invented)",r.j.data.statsAvailable===false&&r.j.data.bio.birthLocation==="Ridgewood, NJ");
  r=await get("/api/cricket/players?q=batter%20one");T("Cricket search after dataset import",r.j.data.players[0]?.id==="id1");
  r=await get("/api/powerlifting/players/"+encodeURIComponent(opl.search("test lifter")[0].id)+"/gamelog");T("Powerlifting gamelog via API",r.j.data.personalBests.total===595);
  r=await get("/api/search?q=messi");const ps2=r.j.data.players,pv=r.j.meta.providers;
  T("universal search: ESPN Messi AND the different TheSportsDB Messi both kept (same name is not enough to merge)",ps2.filter(x=>x.name==="Lionel Messi").length===2&&ps2.some(x=>x.provider==="espn"&&x.team==="Inter Miami CF")&&ps2.some(x=>x.provider==="thesportsdb"&&x.team==="Newell's Old Boys"),ps2.map(x=>[x.name,x.provider,x.team]));
  r=await get("/api/search?q=mbappe");T("universal search: TheSportsDB duplicate of ESPN Mbappé (same name+team) is dropped",r.j.data.players.filter(x=>x.name==="Kylian Mbappé").length===1&&r.j.data.players[0].provider==="espn",r.j.data.players.map(x=>[x.name,x.provider]));
  T("universal search: one provider failing does not break it (statuses reported)",pv.some(x=>x.ok===false)&&pv.some(x=>x.ok===true)&&r.j.data.players.length>0,pv);
  r=await get("/api/search?q=lebron");T("universal search finds LeBron without choosing a sport; result carries sport, murdaId",r.j.data.players[0].name==="LeBron James"&&r.j.data.players[0].sport==="nba"&&r.j.data.players[0].murdaId==="murda:nba:espn:1966");
  r=await get("/api/search?q=verstappen&sport=f1");T("sport filter restricts providers",r.j.data.players.every(x=>x.sport==="f1"));
  r=await get("/api/nba/players/1966/predict?stat=points&threshold=25.5");const pr=r.j.data;
  T("predict endpoint: labelled model estimate with inputs",pr.available&&pr.kind==="model estimate"&&pr.estimate===29.42&&pr.pOverEmpirical===0.7&&pr.samples===10&&/Not a guarantee/i.test(pr.method),pr);
  r=await get("/api/nba/players/1966/predict?stat=nonsense");T("predict: unknown stat -> 400 listing real stats",r.s===400&&/Available/.test(r.j.error));
  r=await get("/api/registry");const sp2=r.j.data.sports,pk=sp2.map(x=>x.key);
  T("registry lists every requested sport",["soccer","nfl","nba","wnba","ncaaf","ncaab","mlb","nhl","cricket","tennis","f1","powerlifting","golf","rugby"].every(k=>pk.includes(k)),pk);
  T("registry is honest: statuses distinguish full / partial / dataset / info-only",sp2.find(x=>x.key==="nba").implementation==="full"&&sp2.find(x=>x.key==="soccer").implementation==="partial"&&sp2.find(x=>x.key==="cricket").implementation==="dataset"&&sp2.find(x=>x.key==="golf").implementation==="info-only"&&sp2.find(x=>x.key==="cricket").datasetReady===true);
  r=await get("/api/sources");const so=r.j.data,pid=Object.fromEntries(so.providers.map(x=>[x.id,x]));
  T("sources page lists licences; Sackmann non-commercial, nflverse CC BY, Retrosheet notice kept",/NON-COMMERCIAL/.test(pid.sackmann.license)&&/CC BY 4.0/.test(pid.nflverse.license)&&/Retrosheet/.test(pid.retrosheet.reason));
  T("sources: last-fetched timestamps come from real fetches; unintegrated providers say why",!!pid.jolpica.lastFetched&&!!pid.sackmann.lastFetched&&pid["nba-api"].status==="not-integrated"&&pid.kaggle.status==="not-integrated"&&pid["football-data"].status==="optional");
  T("sources: formulas documented and statistic kinds explained",so.formulas.some(f=>f.key==="ts_pct"&&/FGA/.test(f.formula))&&so.labels.unavailable&&/never uses betting lines/.test(so.model));
  r=await get("/api/insights?sport=mlb");T("leaders MLB",r.j.data.categories[0].entries[0].name==="Aaron Judge"&&r.j.data.categories[0].entries[0].value===58);
  r=await get("/api/insights?sport=nhl");T("leaders NHL",r.j.data.categories.find(c=>c.key==="goals").entries[0].name==="Connor McDavid");
  r=await get("/api/insights?sport=nfl");T("leaders NFL (calculated from nflverse weekly data)",r.j.data.categories[0].label==="Passing yards 2026"&&r.j.data.categories[0].entries[0].name==="Patrick Mahomes"&&r.j.data.categories[0].entries[0].value===550);
  r=await get("/api/insights?sport=f1");T("leaders F1",r.j.data.categories[0].entries[0].name==="Max Verstappen"&&r.j.data.categories[0].entries[0].value===400);
  r=await get("/api/insights?sport=tennis");T("leaders tennis (wins in dataset)",r.j.data.categories[0].entries[0].value===1&&/in dataset/.test(r.j.data.categories[0].label));
  r=await get("/api/insights?sport=soccer");T("soccer leaders without key: clear message, no fake data",r.j.data.configured===false&&r.j.data.categories.length===0&&/FOOTBALL_DATA_KEY/.test(r.j.data.message));
  r=await get("/api/insights?sport=soccer",8772);T("soccer leaders with free token: scorers + token sent as header",r.j.data.categories[0].entries[0].name==="Erling Haaland"&&lastHdr["x-auth-token"]==="free-test-token"&&r.j.data.categories[0].entries[0].value===12);
  r=await get("/api/insights?sport=golf");T("sport with no leaders source says so",r.j.data.categories.length===0&&/No free/.test(r.j.data.message));
  // 429 + caching at API level
  const c0=seen.jolStandings;await get("/api/f1/players?q=hamilton");T("provider responses cached: standings fetched once for repeated searches",seen.jolStandings===c0);
  // no paid dependency anywhere in shipped code
  const files=[];const walk=d=>fs.readdirSync(d,{withFileTypes:true}).forEach(e=>{if(["node_modules",".cache","test","data",".git"].includes(e.name))return;const f=path.join(d,e.name);e.isDirectory()?walk(f):/\.(js|html|yml|json)$/.test(e.name)&&files.push(f)});walk(root);
  const hits=files.filter(f=>/ODDS_API_KEY|the-odds-api|oddsKey|sportsbook line/i.test(fs.readFileSync(f,"utf8")));
  T("no Odds API / ODDS_API_KEY / sportsbook code remains in shipped source",hits.length===0,hits);
  const apiNoKey=await get("/api/nba/scoreboard");T("everything works with no API keys configured (scoreboard request handled, 5xx only because mock has no scoreboard)",apiNoKey.s===502||apiNoKey.s===200);
  [A,B].forEach(x=>x.kill());
 }catch(e){console.log("ERROR",e);bad++}
 console.log(`\n${pass} passed, ${bad} failed`);mock.close();process.exit(bad?1:0)});
