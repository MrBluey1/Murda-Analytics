# Murda Analytics

Multi-sport player research, box scores, head-to-head history and sportsbook lines. Personal-use tool; data comes from unofficial public sources.

## Run
1. Put all files in one folder (keep `scripts`, `config`, `test` as subfolders). Delete the old `edge-analytics.html` if you still have it.
2. In that folder: `node server.js` (Node 18+), then open http://localhost:8787 and press Ctrl+F5.
3. The first start builds player directories in the background (a few minutes, cached 24h).

## Real sportsbook lines (optional, free)
Without a key the Picks panel shows "Line unavailable". It never invents lines.
1. Create a free account at https://the-odds-api.com (no credit card). Free plan: 500 credits/month.
2. Copy `.env.example` to `.env` and paste the key after `ODDS_API_KEY=`.
3. Restart `node server.js`.
How credits are spent: each game's player-prop pull costs one credit per market (NBA = 7). Murda loads at most 2 games, refreshes a game at most every 6 hours, auto-refreshes about once a day, and stops at 400 credits per month. The key stays on the server and is never sent to the browser.

## Features added in this version
- Soccer match history built from ESPN match box scores (Messi and every player in 7 leagues).
- H2H tab on every player (basketball, soccer, others where the log has opponent data).
- Popular / Trending / Form trends picks (needs the odds key for lines).
- Quarter scoring on game pages, quarter-trend averages, and per-quarter player points (verified against the box score before display).
- Time-zone-correct dates: the UTC timestamp is the source of truth, shown in your device time zone.

## Tests
`node test/run.js`, `node test/search.js`, `node test/features.js`, `node test/collect.js`, `python3 test/ui.py`, `python3 test/ui2.py` (the last two need Playwright). All use mock data, never real providers.
