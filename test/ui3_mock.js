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
mock.listen(8793,()=>console.log("mock up"));
