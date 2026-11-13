# Murda Analytics

Free multi-sport player research: universal athlete search, profiles with season/career stats, game logs, H2H, comparisons, box scores, statistical leaders and locally calculated model estimates. Personal-use tool. No paid APIs, no subscriptions, no credit card, **no API keys required**. No betting or sportsbook data is used anywhere (the former Odds API integration has been removed).

## Run it (Windows/Mac/Linux)
1. Install Node 18+ (nodejs.org). Put every file in one folder, keeping the `lib`, `scripts`, `config`, `data`, `test` sub-folders. Delete the old `edge-analytics.html` if you still have it.
2. In that folder: `node server.js`, then open http://localhost:8787 and press Ctrl+F5.
3. First start builds player directories in the background (a few minutes, cached 24h under `.cache/`).

## Optional free extras
- **Soccer leaders/tables:** free token from football-data.org, put `FOOTBALL_DATA_KEY=...` in a `.env` file (see `.env.example`). Without it that one panel says how to enable it.
- **Cricket:** download a `*_json.zip` from cricsheet.org/downloads, unzip into `data/cricsheet/`, run `node scripts/import-datasets.js cricsheet`.
- **Powerlifting:** download openpowerlifting-latest.zip (openpowerlifting.gitlab.io/opl-csv), unzip, copy the CSV to `data/openpowerlifting/openpowerlifting.csv`, run `node scripts/import-datasets.js openpowerlifting`.

## Architecture
`api.js` (routes) -> `lib/providers/*` (one adapter per source) -> `lib/http.js` (throttling, backoff incl. HTTP 429, disk cache with provenance, stale-if-error) -> normalised JSON. `lib/registry.js` is the single source of truth for sports/providers (the UI selectors are built from `/api/registry`). `lib/calc.js` holds every locally calculated formula, `lib/predict.js` the model estimate, `lib/identity.js` cross-provider athlete matching (never merges on name alone). The **Sources** page in the app lists licenses, limits, last-fetched times, formulas and what is not integrated and why.

## Hosting / database (all free)
- **Run locally** (recommended): no database needed; data is cached as JSON files in `.cache/`.
- **GitHub snapshots** (`DEPLOY.md`): a free scheduled workflow publishes scoreboards, standings and a player search index as static JSON. Public repo required for free Pages. Snapshot mode does not include profiles, predictions or leaders.
- Not done: a hosted database (Supabase/PostgreSQL) and a serverless (Vercel Hobby) port. The app is a plain Node server; free-tier hosts pause or limit servers, so nothing is hosted for you.

## Tests (all use sample data in each provider's format, never the live services)
`node test/run.js` · `node test/search.js` · `node test/features.js` · `node test/providers.js` · `node test/collect.js` · `python3 test/ui.py` · `python3 test/ui2.py` · `python3 test/ui3.py` (the last three need Playwright + Chromium).

## Licenses to respect
Jeff Sackmann tennis data is CC BY-NC-SA 4.0 (non-commercial, attribution, share-alike). nflverse is CC BY 4.0. ESPN/NHL endpoints are unofficial and for personal use. See the Sources page.
