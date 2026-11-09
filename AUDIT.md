# Validation checklist (what was actually verified)

"Mock" = tested against fake provider responses I wrote from community documentation (test/*.js, test/ui.py in real Chromium).
"Real" = tested against the live provider. **No real provider was reachable from my environment, so every Real column is NOT VERIFIED.**
Run it yourself: first start `node server.js`, then try the "Live check" steps at the bottom.

| Sport / league | Directory + search | Profile | Team search + roster | Scoreboard (live/upcoming/final) | Box score: team tab | Box score: player tab | Game log / season stats | Real |
|---|---|---|---|---|---|---|---|---|
| NBA | mock OK | mock OK | mock OK | mock OK | mock OK | mock OK | mock OK (PRA/PR/PA/RA derived) | not verified |
| WNBA | same code path as NBA | same | same | same | same | same | same | not verified |
| NFL | mock OK (position-grouped roster shape) | mock | mock | same path | generic stats pass-through | multi-group tables | same path as NBA | not verified |
| MLB | mock OK (statsapi roster) | mock | mock | via ESPN scoreboard | generic | generic | mock logic only | not verified |
| NHL | mock OK (api-web roster) | mock | mock | via ESPN scoreboard | generic | generic | mock logic only | not verified |
| NCAA Football / Basketball | same code, NOT run: needs hundreds of requests to build | - | - | same path | generic | generic | **unverified, may not exist** | not verified |
| Soccer (EPL, La Liga, Bundesliga, Serie A, Ligue 1, MLS, Saudi Pro League) | mock OK (7 league directory) | mock OK | mock OK | mock OK | mock OK | mock OK (starters/subs) | **not available (no free verified source)** | not verified |
| Champions League | scoreboard + box score only (no player directory) | - | - | same path | same path | same path | - | not verified |
| Formula 1 | - | - | - | - | - | - | standings only (Jolpica) | not verified |
| Tennis, Golf, Cricket | **not supported** | | | | | | | |

## Known gaps
- Stats you listed that ESPN may not send (xG, big chances, fast-break points, key passes, etc.) are shown as "n/a" / listed as "Not provided", never estimated.
- Soccer minutes played, key passes etc. appear only if ESPN includes them in the match roster stats.
- MLB directory = active 26-man rosters (not minor leaguers or injured-list players).

## Live check (5 minutes, after `node server.js`)
1. http://localhost:8787/api/nba/players?q=lebron  -> should list LeBron James (first request waits while the NBA directory builds).
2. http://localhost:8787/api/soccer/players?q=mbappe
3. http://localhost:8787/api/nba/scoreboard -> note a game id, then http://localhost:8787/api/nba/games/<id>
4. http://localhost:8787/api/health  -> shows which provider hosts succeeded or failed.
Paste me anything that errors or looks wrong.
