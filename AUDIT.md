# Murda Analytics: validation checklist (what was actually verified)

"Mock" = automated tests against sample responses written in each provider's documented format (test/*.js, test/ui*.py in real Chromium). **No real provider was reachable from the build environment**, so nothing is verified against a live service.

| Sport / league | Search | Profile (season/career) | Game log | H2H | Box score | Advanced | Leaders | Verified against live provider |
|---|---|---|---|---|---|---|---|---|
| NBA, WNBA | ESPN roster directory (mock OK) | 3 seasons calculated from logs (mock OK) | ESPN (mock OK) | mock OK | mock OK | TS%, eFG%, per-36, A/TO calculated; PER/usage/ORtg/WS/BPM/VORP unavailable | no | **no** |
| NFL | ESPN directory + nflverse link (mock OK) | nflverse seasons (mock OK) | nflverse weekly (mock OK) | mock OK | mock OK | passer rating, ANY/A, Y/A, YPC calculated; EPA/CPOE "provider model" | calculated from nflverse (mock OK) | **no** |
| College FB / BB | ESPN directory (not run: hundreds of requests) | not built | ESPN, unverified | - | mock path | - | no | **no** |
| MLB | MLB roster directory (mock OK) | official AVG/OBP/SLG/OPS/ERA/WHIP + K%, BB%, ISO calculated (mock OK) | MLB API (mock OK) | mock OK | via ESPN | OPS+, wRC+, wOBA, WAR, FIP, Statcast unavailable | MLB API (mock OK) | **no** |
| NHL | NHL roster directory (mock OK) | official totals + shooting % calculated (mock OK) | NHL API (mock OK) | mock OK | via ESPN | Corsi, Fenwick, xG unavailable | NHL API (mock OK) | **no** |
| Soccer (7 leagues) | ESPN directory (mock OK) | current season from match box scores (mock OK) | box scores (mock OK) | mock OK | mock OK | xG, xA, key passes, progressive actions unavailable; per-90 only if minutes supplied | football-data.org (free key, mock OK) | **no** |
| Formula 1 | Jolpica drivers (mock OK) | official standings per season, career from them (mock OK) | race results (mock OK) | n/a | n/a | wins/podiums/poles/fastest laps/positions gained calculated | standings (mock OK) | **no** |
| Tennis ATP/WTA | Sackmann players (mock OK) | per-season win %, serve %, BP %, surface splits calculated (mock OK) | match rows (mock OK) | player-vs-player (mock OK) | n/a | all calculated from raw counts | wins/aces (mock OK) | **no** |
| Cricket | Cricsheet index (needs import; unit tested) | via log | batting/bowling per match | n/a | n/a | strike rate, economy, average calculated | no | **no** |
| Powerlifting | OPL index (needs import; unit tested) | personal bests | meets; Dots/Wilks/Goodlift as published | n/a | n/a | published values only | no | **no** |
| Golf, Rugby, other | TheSportsDB (mock OK) | bio + image only | none (no free verified stats source) | n/a | n/a | n/a | n/a | **no** |

## Not integrated (and why) - also on the in-app Sources page
SportsDataverse (wraps ESPN endpoints already used), Kaggle (login + per-dataset licenses), nba_api/stats.nba.com (unofficial, blocks automation), pbpstats (no verified free API), Retrosheet (event files not downloaded), OpenF1 (historical-only free tier; telemetry views not built), football-data.co.uk (not downloaded).

## Honest status
Every integration was exercised only against sample data in each provider's documented format. Real provider responses may differ in field names. Run the live checks below and report anything that fails.

## Live check (after `node server.js`)
1. /api/registry and /api/sources
2. /api/search?q=lebron , /api/search?q=messi , /api/search?q=djokovic
3. /api/f1/players?q=verstappen , /api/tennis/players?q=alcaraz
4. /api/nfl/players?q=mahomes then /api/nfl/players/<id>/profile
5. /api/mlb/players/592450/profile , /api/nhl/players/8478402/profile
6. /api/insights?sport=mlb , /api/health
