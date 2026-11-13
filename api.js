"use strict";
// Normalized sports API. Zero dependencies (Node 18+). Used by server.js under /api/*.
// All upstream sources are free, keyless and UNOFFICIAL unless noted; they can change without notice.
const fs = require("fs"), path = require("path");
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, ".cache");
const MIN_GAP = 250, TIMEOUT = 10000;           // per-host spacing (ms) and request timeout
const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc = encodeURIComponent;
const lastHdr = new Map(), cache = new Map(), inflight = new Map(), lastCall = new Map(), health = {};
const SITE = "https://site.api.espn.com/apis/site/v2/sports/";
const SITEV2 = "https://site.api.espn.com/apis/v2/sports/";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/";

const SOCCER_DIR = [["eng.1", "Premier League"], ["esp.1", "La Liga"], ["ger.1", "Bundesliga"], ["ita.1", "Serie A"], ["fra.1", "Ligue 1"], ["usa.1", "MLS"], ["ksa.1", "Saudi Pro League"]];
const USE_SOCCER = "Use the 'soccer' key for soccer players and teams";
const LEAGUES = {
  nba:   { name: "NBA", espn: "basketball/nba", players: "espn", dir: "espn", basketball: true },
  wnba:  { name: "WNBA", espn: "basketball/wnba", players: "espn", dir: "espn", basketball: true },
  nfl:   { name: "NFL", espn: "football/nfl", players: "espn", dir: "espn" },
  ncaaf: { name: "NCAA Football", espn: "football/college-football", players: "espn", dir: "espn", note: "ESPN college athlete game logs are unverified; directory build needs hundreds of requests" },
  ncaab: { name: "NCAA Basketball", espn: "basketball/mens-college-basketball", players: "espn", dir: "espn", basketball: true, note: "ESPN college athlete game logs are unverified; directory build needs hundreds of requests" },
  mlb:   { name: "MLB", espn: "baseball/mlb", players: "mlb", dir: "mlb" },
  nhl:   { name: "NHL", espn: "hockey/nhl", players: "nhl", dir: "nhl" },
  soccer:{ name: "Soccer", players: "espn", dir: "espn", soccer: true, note: "Directory spans 7 domestic leagues (not UEFA competitions). No free verified player season/game-log source; match box scores carry per-game player stats" },
  epl:   { name: "Premier League", espn: "soccer/eng.1", players: null, why: USE_SOCCER },
  laliga:{ name: "La Liga", espn: "soccer/esp.1", players: null, why: USE_SOCCER },
  bundesliga: { name: "Bundesliga", espn: "soccer/ger.1", players: null, why: USE_SOCCER },
  seriea:{ name: "Serie A", espn: "soccer/ita.1", players: null, why: USE_SOCCER },
  ligue1:{ name: "Ligue 1", espn: "soccer/fra.1", players: null, why: USE_SOCCER },
  mls:   { name: "MLS", espn: "soccer/usa.1", players: null, why: USE_SOCCER },
  saudi: { name: "Saudi Pro League", espn: "soccer/ksa.1", players: null, why: USE_SOCCER },
  ucl:   { name: "Champions League", espn: "soccer/uefa.champions", players: null, why: USE_SOCCER },
  f1:    { name: "Formula 1", players: "jolpica", external: true, note: "Race results and standings (Jolpica). OpenF1 telemetry not built." },
  tennis:{ name: "Tennis", players: "sackmann", external: true, note: "Historical ATP/WTA dataset (Jeff Sackmann, CC BY-NC-SA, non-commercial)" },
  cricket:{ name: "Cricket", players: "cricsheet", external: true, note: "Needs the Cricsheet dataset imported (see README)" },
  powerlifting:{ name: "Powerlifting", players: "openpowerlifting", external: true, note: "Needs the OpenPowerlifting dataset imported (see README)" },
  golf:  { name: "Golf", players: "thesportsdb", external: true, infoOnly: true, note: "Profile + image only (TheSportsDB free tier)" },
  rugby: { name: "Rugby", players: "thesportsdb", external: true, infoOnly: true, note: "Profile + image only (TheSportsDB free tier)" },
  other: { name: "Other sports", players: "thesportsdb", external: true, infoOnly: true, note: "Profile + image only (TheSportsDB free tier)" },
};
const UNSUPPORTED = {};

async function upstream(url) {
  const u = new URL(url), h = u.host;
  const gap = Math.max(0, (lastCall.get(h) || 0) + MIN_GAP - Date.now());
  lastCall.set(h, Date.now() + gap); if (gap) await sleep(gap);
  const target = process.env.MOCK_BASE ? `${process.env.MOCK_BASE}/${h}${u.pathname}${u.search}` : url;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(target, { headers: { "user-agent": "murda-analytics-personal/1.0", accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`upstream ${h} HTTP ${r.status}`);
    const j = await r.json(); lastHdr.set(h, Object.fromEntries(r.headers.entries()));
    health[h] = { ...health[h], lastOk: new Date().toISOString() };
    return j;
  } catch (e) {
    health[h] = { ...health[h], lastError: { at: new Date().toISOString(), message: e.message } };
    throw e;
  } finally { clearTimeout(t); }
}

// TTL cache with in-flight de-duplication and stale-if-error.
async function cached(key, ttl, load, staleFor = 3600e3) {
  const e = cache.get(key);
  if (e && Date.now() < e.exp) return { data: e.data, cache: "hit", at: e.at };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const data = await load(), at = Date.now();
      cache.set(key, { data, at, exp: at + (typeof ttl === "function" ? ttl(data) : ttl) });
      if (cache.size > 600) cache.delete(cache.keys().next().value);   // bound memory
      return { data, cache: "miss", at };
    } catch (err) {
      if (e && Date.now() - e.at < staleFor) return { data: e.data, cache: "stale", at: e.at, error: err.message };
      throw err;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p); return p;
}

function send(res, code, body) {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function serve(res, provider, key, ttl, load, { transform = x => x, status = () => "historical", note } = {}) {
  try {
    const r = await cached(key, ttl, load), data = transform(r.data);
    send(res, 200, { ok: true, data, meta: { provider, cache: r.cache, stale: r.cache === "stale", fetchedAt: new Date(r.at).toISOString(), status: status(data), ...(note ? { note } : {}), ...(r.error ? { upstreamError: r.error } : {}) } });
  } catch (e) { send(res, 502, { ok: false, error: e.message, meta: { provider, status: "unavailable" } }); }
}

/* ---------- normalizers ---------- */
function normScore(raw) {
  const side = x => x && { id: x.team?.id ?? x.id ?? null, name: x.team?.displayName ?? x.athlete?.displayName ?? x.displayName ?? null, abbr: x.team?.abbreviation ?? null, logo: x.team?.logo ?? x.team?.logos?.[0]?.href ?? null, score: x.score ?? null, winner: x.winner ?? null };
  return { games: (raw.events || []).map(e => {
    const c = e.competitions?.[0] || {}, cs = c.competitors || [], t = e.status?.type || {};
    return { id: e.id, name: e.shortName || e.name, startTime: e.date, state: t.state === "in" ? "live" : t.state === "post" ? "completed" : "scheduled", detail: t.shortDetail || t.detail || "",
      home: side(cs.find(x => x.homeAway === "home")), away: side(cs.find(x => x.homeAway === "away")) };
  }) };
}
function normSearch(raw, L) {
  const slug = L.espn.split("/")[1];
  const items = raw.items || (raw.results || []).flatMap(r => r.contents || []) || [];
  return { players: items.filter(i => i.type === "player" && (i.league || i.defaultLeagueSlug) === slug).map(i => ({
    id: String(i.id ?? (/a:(\d+)/.exec(i.uid || "") || [])[1] ?? ""), name: i.displayName || i.name, team: i.subtitle || "", pos: i.position || "" })).filter(p => p.id) };
}
function normEspnLog(raw, L) {
  const names = raw.names || [], meta = raw.events || {}, games = [];
  for (const st of raw.seasonTypes || []) for (const cat of st.categories || []) for (const ev of cat.events || []) {
    const m = meta[ev.eventId] || {}, stats = {};
    names.forEach((n, i) => {
      const v = ev.stats?.[i]; if (v == null) return;
      if (typeof v === "string" && /^\d+-\d+$/.test(v) && n.includes("-")) { const [a, b] = n.split("-"), [x, y] = v.split("-"); stats[a] = +x; stats[b] = +y; }
      else { const num = Number(v); stats[n] = v !== "" && Number.isFinite(num) ? num : v; }
    });
    games.push({ id: String(ev.eventId), startTime: m.gameDate || null, date: m.gameDate ? etDate(m.gameDate) : "", dateOnly: false, opponent: m.opponent?.abbreviation || m.opponent?.displayName || "", opponentId: m.opponent?.id != null ? String(m.opponent.id) : "", opponentName: m.opponent?.displayName || "", home: m.atVs === "vs", result: m.gameResult || null, seasonType: st.displayName || null, stats });
  }
  return finishLog(games, L);
}
function finishLog(games, L) {
  games.sort((a, b) => (a.startTime || a.date).localeCompare(b.startTime || b.date));
  let derived = [];
  if (L.basketball) for (const g of games) {
    const s = g.stats, r = s.totalRebounds ?? s.rebounds, p = s.points, a = s.assists;
    if ([p, r, a].every(Number.isFinite)) { s.PRA = p + r + a; s.PR = p + r; s.PA = p + a; s.RA = r + a; derived = ["PRA", "PR", "PA", "RA"]; }
  }
  const keys = new Set(); games.forEach(g => Object.entries(g.stats).forEach(([k, v]) => typeof v === "number" && keys.add(k)));
  return { games, statKeys: [...keys], derived };
}
const etDate = iso => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso)); } catch { return ""; } };
const numStats = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => typeof v === "number"));

/* ---------- native adapters ---------- */
const mlb = {
  async search(q) { const d = await upstream(`https://statsapi.mlb.com/api/v1/people/search?names=${enc(q)}`);
    return { players: (d.people || []).slice(0, 15).map(p => ({ id: String(p.id), name: p.fullName, team: p.currentTeam?.name || "", pos: p.primaryPosition?.abbreviation || "" })) }; },
  async log(id, q, L) {
    const now = new Date(), season = q.season || (now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear());
    for (const g of q.group ? [q.group] : ["hitting", "pitching"]) {
      const d = await upstream(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&group=${g}&season=${season}`);
      const sp = d.stats?.[0]?.splits || [];
      if (sp.length) return { group: g, ...finishLog(sp.map(x => ({ id: String(x.game?.gamePk ?? x.date), startTime: null, date: x.date, dateOnly: true, opponent: x.opponent?.name || "", opponentId: x.opponent?.id != null ? String(x.opponent.id) : "", opponentName: x.opponent?.name || "", home: !!x.isHome, result: null, seasonType: null,
        stats: { ...numStats(x.stat), ...(x.stat.inningsPitched != null ? { innings: (([a, b]) => +a + (+b || 0) / 3)(String(x.stat.inningsPitched).split(".")) } : {}) } })), L) };
    }
    return { group: null, ...finishLog([], L) };
  } };
const nhl = {
  async search(q) { const d = await upstream(`https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=15&q=${enc(q)}`);
    return { players: d.map(p => ({ id: String(p.playerId), name: p.name, team: p.teamAbbrev || "", pos: p.positionCode || "" })) }; },
  async log(id, q, L) { const d = await upstream(`https://api-web.nhle.com/v1/player/${id}/game-log/${q.season ? q.season + "/2" : "now"}`);
    return finishLog((d.gameLog || []).map(x => { const s = numStats(x); if (s.shotsAgainst != null && s.goalsAgainst != null) s.saves = s.shotsAgainst - s.goalsAgainst;
      return { id: String(x.gameId), startTime: null, date: x.gameDate, dateOnly: true, opponent: x.opponentAbbrev, opponentId: x.opponentAbbrev || "", opponentName: x.opponentAbbrev || "", home: x.homeRoadFlag === "H", result: null, seasonType: null, stats: s }; }), L); } };

function loadLog(key, L, id, q) {
  const k = `gl:${key}:${id}:${q.season || ""}:${q.group || ""}:${q.opponentId || ""}:${q.limit || ""}`;
  const load = L.soccer ? () => soccerLog(id, q, L) : key === "nfl" ? () => nflLog(id, q, L) : L.players === "mlb" ? () => mlb.log(id, q, L) : L.players === "nhl" ? () => nhl.log(id, q, L)
    : async () => normEspnLog(await upstream(`${WEB}${L.espn}/athletes/${enc(id)}/gamelog${q.season ? "?season=" + enc(q.season) : ""}`), L);
  return { k, load };
}
const avg = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null;
function computeAverages(log) {
  const out = (games) => Object.fromEntries(log.statKeys.map(k => [k, avg(games.map(g => g.stats[k]).filter(Number.isFinite))]));
  return { games: log.games.length, season: out(log.games), last5: out(log.games.slice(-5)), last10: out(log.games.slice(-10)) };
}

/* ---------- player/team directory (built from team rosters, searched locally) ---------- */
const fold = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").replace(/[łŁ]/g, "l").replace(/[øØ]/g, "o").replace(/æ/gi, "ae").replace(/ß/g, "ss").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
function score(q, qt, f, toks) {
  if (f === q) return 100; if (f.startsWith(q)) return 90;
  let tot = 0;
  for (const t of qt) {
    let best = 0;
    for (const n of toks) {
      if (n === t) best = Math.max(best, 30);
      else if (n.startsWith(t)) best = Math.max(best, 24);
      else if (t.length >= 3 && n.includes(t)) best = Math.max(best, 12);
      else if (t.length >= 4) { const m = t.length >= 7 ? 2 : 1; if (lev(t, n, m) <= m || lev(t, n.slice(0, t.length + 1), m) <= m) best = Math.max(best, 10); }
    }
    if (!best) return 0; tot += best;
  }
  return 40 + tot / qt.length;
}
const espnPaths = L => L.soccer ? SOCCER_DIR.map(([s, n]) => ({ path: "soccer/" + s, league: n })) : [{ path: L.espn, league: L.name }];
async function listTeams(L) {
  if (L.dir === "mlb") { const d = await upstream("https://statsapi.mlb.com/api/v1/teams?sportId=1");
    return (d.teams || []).map(t => ({ id: String(t.id), name: t.name, abbr: t.abbreviation, logo: `https://www.mlbstatic.com/team-logos/${t.id}.svg`, league: "MLB" })); }
  if (L.dir === "nhl") { const d = await upstream("https://api-web.nhle.com/v1/standings/now");
    return (d.standings || []).map(s => ({ id: s.teamAbbrev?.default, name: s.teamName?.default, abbr: s.teamAbbrev?.default, logo: s.teamLogo || null, league: "NHL" })).filter(t => t.id); }
  const out = []; let lastErr;
  for (const { path: pp, league } of espnPaths(L)) {
    try { const d = await upstream(`${SITE}${pp}/teams?limit=500`);
      for (const x of d.sports?.[0]?.leagues?.[0]?.teams || []) out.push({ id: String(x.team.id), name: x.team.displayName, abbr: x.team.abbreviation, logo: x.team.logos?.[0]?.href || null, league, path: pp }); }
    catch (e) { lastErr = e; }
  }
  if (!out.length && lastErr) throw lastErr;
  return out;
}
async function loadRoster(key, L, t) {
  const mk = o => ({ sport: key, team: t.name, teamId: t.id, league: t.league, path: t.path, ...o });
  if (L.dir === "mlb") { const d = await upstream(`https://statsapi.mlb.com/api/v1/teams/${t.id}/roster?rosterType=active`);
    return (d.roster || []).map(r => mk({ id: String(r.person.id), name: r.person.fullName, pos: r.position?.abbreviation || "", jersey: r.jerseyNumber || "",
      photo: `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/${r.person.id}/headshot/67/current` })); }
  if (L.dir === "nhl") { const d = await upstream(`https://api-web.nhle.com/v1/roster/${t.id}/current`);
    return [...(d.forwards || []), ...(d.defensemen || []), ...(d.goalies || [])].map(r => mk({ id: String(r.id), name: `${r.firstName?.default || ""} ${r.lastName?.default || ""}`.trim(), pos: r.positionCode || "", jersey: r.sweaterNumber ?? "", photo: r.headshot || null })); }
  const d = await upstream(`${SITE}${t.path}/teams/${t.id}/roster`), flat = [];
  for (const a of d.athletes || []) Array.isArray(a.items) ? flat.push(...a.items) : flat.push(a);   // some sports group athletes by position
  return flat.map(a => mk({ id: String(a.id), name: a.fullName || a.displayName, pos: a.position?.abbreviation || a.position?.displayName || "", jersey: a.jersey || "", photo: a.headshot?.href || null })).filter(x => x.id && x.name);
}
const dirs = new Map(), dirFile = k => path.join(CACHE_DIR, `dir-${k}.json`);
function ensureDir(key, L) {
  let st = dirs.get(key);
  if (st && st.builtAt && Date.now() - st.builtAt > 864e5) { dirs.delete(key); st = null; }
  if (st) return st;
  st = { players: new Map(), teams: [], teamsTotal: 0, teamsLoaded: 0, complete: false, builtAt: null, errors: [] }; dirs.set(key, st);
  try { const f = JSON.parse(fs.readFileSync(dirFile(key), "utf8"));
    if (Date.now() - f.builtAt < 864e5 && f.players?.length) { f.players.forEach(x => st.players.set(x.id, x)); st.teams = f.teams || []; st.teamsTotal = st.teamsLoaded = st.teams.length; st.complete = true; st.builtAt = f.builtAt; return st; } } catch {}
  st.promise = (async () => {
    try {
      st.teams = await listTeams(L); st.teamsTotal = st.teams.length;
      for (const t of st.teams) { try { for (const pl of await loadRoster(key, L, t)) st.players.set(pl.id, pl); } catch (e) { st.errors.push(`${t.name}: ${e.message}`); } st.teamsLoaded++; }
      st.complete = true; st.builtAt = Date.now();
      if (st.players.size) { try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(dirFile(key), JSON.stringify({ builtAt: st.builtAt, teams: st.teams, players: [...st.players.values()] })); } catch {} }
      else dirs.delete(key);   // nothing loaded: allow a retry on the next request
    } catch (e) { st.errors.push(e.message); st.complete = true; dirs.delete(key); }
  })();
  return st;
}
async function searchDir(key, L, raw, limit = 25) {
  const st = ensureDir(key, L), q = fold(raw), qt = q.split(" ").filter(Boolean), deadline = Date.now() + 10000;
  const run = () => {
    const hits = [];
    for (const pl of st.players.values()) { pl._f = pl._f || fold(pl.name); const sc = score(q, qt, pl._f, pl._f.split(" ")); if (sc) hits.push([sc, pl]); }
    hits.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
    const seen = new Set(), out = [];
    for (const [, pl] of hits) { const k = `${pl._f}|${pl.team}|${pl.league}`; if (seen.has(k)) continue; seen.add(k); const { _f, ...rest } = pl; out.push(rest); if (out.length >= limit) break; }
    return out;
  };
  let res = run();
  while (!st.complete && res.length < 3 && Date.now() < deadline) { await sleep(250); res = run(); }
  return { players: res, directory: { complete: st.complete, teamsLoaded: st.teamsLoaded, teamsTotal: st.teamsTotal, players: st.players.size, errors: st.errors.slice(0, 3) } };
}
const getTeams = (key, L) => cached(`teams:${key}`, 864e5, async () => ({ teams: await listTeams(L) }));
exports.warm = async keys => { for (const k of keys) { try { await exports.directory(k); } catch {} } };
exports.directory = async key => { const L = LEAGUES[key], st = ensureDir(key, L); if (st.promise) await st.promise; return [...st.players.values()].map(({ _f, ...r }) => r); };

/* ---------- game detail (box score) normalization ---------- */
const rx = (...a) => a.map(([l, r]) => [l, r]);
const WANT = {
  basketball: rx(["Field Goals", /^fieldGoalsMade-fieldGoalsAttempted$|^FG$/i], ["Field Goal %", /^fieldGoalPct$|^FG%$/i], ["3-Pointers", /^threePointFieldGoalsMade-threePointFieldGoalsAttempted$|^3PT$/i], ["3-Point %", /^threePointFieldGoalPct$|^3P%$/i],
    ["Free Throws", /^freeThrowsMade-freeThrowsAttempted$|^FT$/i], ["Free Throw %", /^freeThrowPct$|^FT%$/i], ["Total Rebounds", /^totalRebounds$|^rebounds$|^REB$/i], ["Offensive Rebounds", /offensiveRebounds|^OREB$/i], ["Defensive Rebounds", /defensiveRebounds|^DREB$/i],
    ["Assists", /^assists$|^AST$/i], ["Steals", /^steals$|^STL$/i], ["Blocks", /^blocks$|^BLK$/i], ["Turnovers", /^turnovers$|^totalTurnovers$|^TO$/i], ["Personal Fouls", /^fouls$|^personalFouls$|^PF$/i],
    ["Points in the Paint", /pointsInPaint|points in paint/i], ["Fast-Break Points", /fastBreakPoints|fast ?break/i]),
  soccer: rx(["Possession", /possession/i], ["Total Shots", /^totalShots$|^shots$/i], ["Shots on Target", /shotsOnTarget|on target/i], ["Shots off Target", /shotsOffTarget|off target/i], ["Expected Goals (xG)", /expectedGoals|^xG$/i],
    ["Corners", /corner/i], ["Fouls", /^foulsCommitted$|^fouls$/i], ["Yellow Cards", /yellowCards/i], ["Red Cards", /redCards/i], ["Offsides", /offsides/i], ["Passes Completed", /^accuratePasses$|passes completed/i],
    ["Pass Accuracy", /^passPct$|pass accuracy|pass %/i], ["Saves", /^saves$/i], ["Big Chances", /bigChance/i]),
};
function buildTeamStats(raw, home, away, type) {
  const bt = raw.boxscore?.teams || [], pick = t => bt.find(x => String(x.team?.id) === String(t?.id));
  const hs = pick(home)?.statistics || [], as = pick(away)?.statistics || [];
  if (!hs.length && !as.length) return { available: false, rows: [], unavailable: [], note: "The provider returned no team statistics for this game." };
  const keys = [], seen = new Set(); [...as, ...hs].forEach(s => { const k = s.name || s.label; if (k && !seen.has(k)) { seen.add(k); keys.push(k); } });
  const get = (arr, k) => arr.find(s => (s.name || s.label) === k);
  let rows = keys.map(k => { const a = get(as, k), h = get(hs, k); return { key: k, label: (h || a).label || (h || a).displayName || k, home: h?.displayValue ?? null, away: a?.displayValue ?? null }; });
  const ordered = [], used = new Set(), missing = [];
  if (type === "basketball" && (home?.score != null || away?.score != null)) ordered.push({ key: "_score", label: "Points", home: home?.score ?? null, away: away?.score ?? null, requested: true });
  for (const [label, re] of WANT[type] || []) {
    const r = rows.find(r => !used.has(r.key) && [r.key, r.label].some(x => re.test(x || "")));
    if (r) { used.add(r.key); ordered.push({ ...r, label, requested: true }); } else missing.push(label);
  }
  return { available: true, rows: [...ordered, ...rows.filter(r => !used.has(r.key))], unavailable: missing };
}
function buildPlayers(raw, home, away, type) {
  const teams = [], ref = t => ({ id: t?.id ?? null, name: t?.displayName || t?.name || "", abbr: t?.abbreviation || "", logo: t?.logos?.[0]?.href || t?.logo || null });
  const side = id => String(id) === String(home?.id) ? "home" : String(id) === String(away?.id) ? "away" : null;
  if (type === "soccer") {
    for (const r of raw.rosters || []) {
      const cols = [], seen = new Set();
      const rows = (r.roster || []).map(x => {
        const stats = {}; for (const s of x.stats || []) { const k = s.name || s.abbreviation; if (!k) continue; stats[k] = s.displayValue ?? s.value ?? null; if (!seen.has(k)) { seen.add(k); cols.push({ key: k, label: s.abbreviation || s.shortDisplayName || k, title: s.displayName || k }); } }
        return { id: String(x.athlete?.id || ""), name: x.athlete?.displayName || x.athlete?.fullName || "", jersey: x.jersey || x.athlete?.jersey || "", pos: x.position?.abbreviation || "", starter: !!x.starter, subbedIn: !!x.subbedIn, subbedOut: !!x.subbedOut, stats };
      });
      teams.push({ team: ref(r.team), homeAway: side(r.team?.id), groups: [{ name: "", columns: cols, rows }] });
    }
  } else for (const bp of raw.boxscore?.players || []) {
    const groups = (bp.statistics || []).map(g => ({ name: g.name || g.type || "", columns: (g.labels || []).map((l, i) => ({ key: String(i), label: l, title: g.descriptions?.[i] || l })),
      rows: (g.athletes || []).map(a => ({ id: String(a.athlete?.id || ""), name: a.athlete?.displayName || "", jersey: a.athlete?.jersey || "", pos: a.athlete?.position?.abbreviation || "", starter: !!a.starter, dnp: !!a.didNotPlay, reason: a.reason || "",
        stats: Object.fromEntries((a.stats || []).map((v, i) => [String(i), v])) })) }));
    teams.push({ team: ref(bp.team), homeAway: side(bp.team?.id), groups });
  }
  return { available: teams.some(t => t.groups.some(g => g.rows.length)), teams, note: "Players the provider lists with no stats yet (or who did not play) show blank values." };
}
function periodInfo(L) {
  const e = L.espn || "";
  if (e.includes("mens-college-basketball")) return { reg: 2, unit: "H" };
  if (e.startsWith("basketball") || e.startsWith("football")) return { reg: 4, unit: "Q" };
  if (e.startsWith("hockey")) return { reg: 3, unit: "P" };
  if (e.startsWith("soccer")) return { reg: 2, unit: "H" };
  if (e.startsWith("baseball")) return { reg: 9, unit: "" };
  return { reg: 0, unit: "" };
}
function buildPeriods(hc, home, away, L) {
  const ls = t => (hc.competitors || []).find(c => String(c.team?.id) === String(t?.id))?.linescores || [];
  const h = ls(home), a = ls(away), n = Math.max(h.length, a.length);
  if (!n) return { available: false, note: "The provider did not include period scores for this game." };
  const { reg, unit } = periodInfo(L), v = x => { const n = Number(x?.displayValue ?? x?.value); return Number.isFinite(n) ? n : null; };
  const labels = Array.from({ length: n }, (_, i) => i < reg || !reg ? `${i + 1}${unit}` : `OT${i - reg + 1 > 1 ? i - reg + 1 : ""}`);
  return { available: true, labels, home: Array.from({ length: n }, (_, i) => v(h[i])), away: Array.from({ length: n }, (_, i) => v(a[i])), final: { home: home?.score ?? null, away: away?.score ?? null } };
}
// Player points per quarter, computed from play-by-play scoring plays (shooter = first participant). Verified against box score points.
function buildQuarterPoints(raw, L, playersBlock) {
  if (!L.basketball) return { available: false, note: "Quarter-level player stats are only computed for basketball." };
  const plays = raw.plays || [];
  if (!plays.length) return { available: false, note: "The provider did not include play-by-play for this game, so player quarter points cannot be computed." };
  const by = {};
  for (const p of plays) {
    const per = p.period?.number, a = p.participants?.[0]?.athlete, pts = Number(p.scoreValue);
    if (!p.scoringPlay || !pts || !per || !a?.id) continue;
    const o = by[a.id] = by[a.id] || {}; o[per] = (o[per] || 0) + pts;
  }
  let checked = 0, bad = 0;
  for (const t of playersBlock.teams) for (const g of t.groups) {
    const col = g.columns.find(c => c.label === "PTS"); if (!col) continue;
    for (const r of g.rows) { const box = Number(r.stats[col.key]); if (!Number.isFinite(box)) continue; const tot = Object.values(by[r.id] || {}).reduce((x, y) => x + y, 0); checked++; if (tot !== box) bad++; else r.qpts = by[r.id] || {}; }
  }
  const verified = checked > 0 && bad === 0;
  if (!verified) for (const t of playersBlock.teams) for (const g of t.groups) for (const r of g.rows) delete r.qpts;
  return { available: Object.keys(by).length > 0 && verified, verified, checked, mismatches: bad, source: "computed from play-by-play scoring plays", note: verified ? "Computed from play-by-play and matched to every player's box-score points." : `Not shown: play-by-play totals did not match the box score for ${bad} of ${checked} players, so they cannot be trusted.` };
}
function normGame(raw, id, L) {
  const hc = raw.header?.competitions?.[0] || {}, st = hc.status?.type || raw.header?.status?.type || {}, type = (L.espn || "").split("/")[0];
  const comp = (hc.competitors || []).map(c => ({ id: c.team?.id ?? null, name: c.team?.displayName || c.team?.name || "", abbr: c.team?.abbreviation || "", logo: c.team?.logos?.[0]?.href || c.team?.logo || null, score: c.score ?? null, homeAway: c.homeAway, winner: c.winner ?? null }));
  const home = comp.find(c => c.homeAway === "home") || comp[1] || null, away = comp.find(c => c.homeAway === "away") || comp[0] || null;
  const players = buildPlayers(raw, home, away, type);
  return { id, league: raw.header?.league?.name || L.name, startTime: hc.date || null, date: hc.date || null, sportType: type,
    status: { state: st.state === "in" ? "live" : st.state === "post" ? "completed" : "scheduled", detail: st.detail || st.shortDetail || "", clock: hc.status?.displayClock ?? null, period: hc.status?.period ?? null },
    home, away, periods: buildPeriods(hc, home, away, L), teamStats: buildTeamStats(raw, home, away, type), players, quarterPoints: buildQuarterPoints(raw, L, players) };
}

/* ---------- schedules, soccer game logs (from match box scores), H2H, quarter trends ---------- */
const getSummary = (pp, id, done) => cached(`sum:${pp}:${id}`, done ? 30 * 864e5 : 20e3, () => upstream(`${SITE}${pp}/summary?event=${enc(id)}`));
async function teamSchedule(pp, teamId, season) {
  const r = await cached(`sched:${pp}:${teamId}:${season || ""}`, 216e5, () => upstream(`${SITE}${pp}/teams/${teamId}/schedule${season ? `?season=${enc(season)}` : ""}`));
  const sc = x => { const v = x?.score; return v == null ? null : Number(typeof v === "object" ? v.value ?? v.displayValue : v); };
  return (r.data.events || []).map(e => {
    const c = e.competitions?.[0] || {}, st = c.status?.type || e.status?.type || {}, cs = c.competitors || [], me = cs.find(x => String(x.team?.id) === String(teamId)), op = cs.find(x => x !== me);
    return { id: String(e.id), startTime: e.date || c.date || null, completed: !!st.completed || st.state === "post", home: me?.homeAway === "home",
      opponent: { id: op?.team?.id != null ? String(op.team.id) : "", abbr: op?.team?.abbreviation || "", name: op?.team?.displayName || "" }, score: { me: sc(me), opp: sc(op) } };
  }).filter(e => e.id).sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
}
async function soccerLog(id, q, L) {
  const st = ensureDir("soccer", L); let e = st.players.get(id); const t0 = Date.now();
  while (!e && !st.complete && Date.now() - t0 < 8000) { await sleep(250); e = st.players.get(id); }
  if (!e) throw new Error("Player is not in the soccer directory (still loading, not on a current roster of the 7 covered leagues, or unknown id)");
  const pp = e.path || "soccer/" + (SOCCER_DIR.find(([, n]) => n === e.league) || [])[0];
  let ev = (await teamSchedule(pp, e.teamId, q.season)).filter(x => x.completed);
  if (q.opponentId) ev = ev.filter(x => x.opponent.id === String(q.opponentId));
  ev = ev.slice(-Math.min(+q.limit || 15, 40));
  const games = []; let failed = 0;
  for (const x of ev) {
    try {
      const raw = (await getSummary(pp, x.id, true)).data; let row = null;
      for (const r of raw.rosters || []) for (const pl of r.roster || []) if (String(pl.athlete?.id) === String(id)) row = pl;
      const stats = {}; for (const s of row?.stats || []) { const v = Number(s.displayValue ?? s.value); if (s.name && Number.isFinite(v)) stats[s.name] = v; }
      games.push({ id: x.id, startTime: x.startTime, date: x.startTime ? etDate(x.startTime) : "", dateOnly: false, opponent: x.opponent.abbr || x.opponent.name, opponentId: x.opponent.id, opponentName: x.opponent.name, home: x.home,
        result: x.score.me == null ? null : x.score.me > x.score.opp ? "W" : x.score.me < x.score.opp ? "L" : "D", seasonType: e.league, competition: e.league, dnp: !row, starter: row ? !!row.starter : null, stats });
    } catch { failed++; }
  }
  return { ...finishLog(games, L), team: e.team, league: e.league, failedMatches: failed, matchesConsidered: ev.length,
    note: `Built from ESPN match box scores of ${e.team}'s completed ${e.league} matches (last ${ev.length} from ESPN's team schedule). Matches where the player was not in the squad are marked did-not-play. Minutes appear only if ESPN includes them.` };
}
function seasonsFor(key, n) {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1; let base;
  if (key === "nba" || key === "ncaab") base = m >= 9 ? y + 1 : y;          // ESPN names these by ending year
  else if (key === "nhl") base = m >= 9 ? y : y - 1;                          // start year; API wants e.g. 20252026
  else if (key === "soccer") base = m >= 7 ? y : y - 1;
  else if (key === "nfl" || key === "ncaaf") base = m >= 3 ? y : y - 1;
  else base = m >= 2 ? y : y - 1;                                             // mlb, wnba
  return Array.from({ length: n }, (_, i) => key === "nhl" ? `${base - i}${base - i + 1}` : String(base - i));
}
async function h2h(key, L, id, q, opp) {
  const seasons = seasonsFor(key, Math.min(+q.seasons || 3, 6)), all = [], failed = [];
  for (const sn of seasons) {
    try { const lq = { season: sn, ...(L.soccer ? { opponentId: opp.id, limit: 40 } : {}) }, { k, load } = loadLog(key, L, id, lq);
      all.push(...(await cached(k, 3e5, load)).data.games.map(g => ({ ...g, season: sn }))); }
    catch (e) { failed.push({ season: sn, error: e.message }); }
  }
  const inRange = g => (!q.from || g.date >= q.from) && (!q.to || g.date <= q.to);
  const isOpp = g => (g.opponentId && String(g.opponentId) === String(opp.id)) || (g.opponentName && fold(g.opponentName) === fold(opp.name)) || (g.opponent && (fold(g.opponent) === fold(opp.abbr) || identity.teamKey(g.opponent) === identity.teamKey(opp.abbr)));
  const played = all.filter(g => !g.dnp && inRange(g)), games = played.filter(isOpp);
  const keys = new Set(); games.forEach(g => Object.entries(g.stats).forEach(([k, v]) => typeof v === "number" && keys.add(k)));
  const avgOf = (gs, k) => avg(gs.map(g => g.stats[k]).filter(Number.isFinite));
  const mk = gs => Object.fromEntries([...keys].map(k => [k, avgOf(gs, k)]));
  const recent = games.slice(-3);
  return { opponent: opp, seasonsChecked: seasons, failedSeasons: failed, games, statKeys: [...keys], count: games.length, averages: mk(games), recent3: mk(recent),
    baseline: L.soccer ? null : mk(played), baselineGames: L.soccer ? null : played.length,
    note: `Dates are US Eastern calendar dates. ${L.soccer ? "Soccer H2H only covers meetings in the player's current league schedule." : "Baseline = the player's average over all games in the seasons checked."}` };
}
async function teamQuarters(key, L, t, q) {
  const sched = (await teamSchedule(t.path || L.espn, t.id, q.season)).filter(e => e.completed).slice(-Math.min(+q.games || 10, 20)), rows = [];
  for (const e of sched) {
    try { const g = normGame((await getSummary(t.path || L.espn, e.id, true)).data, e.id, L); if (!g.periods.available) continue;
      const me = String(g.home?.id) === String(t.id) ? "home" : "away", other = me === "home" ? "away" : "home";
      rows.push({ id: e.id, startTime: e.startTime, opponent: e.opponent.abbr || e.opponent.name, home: e.home, labels: g.periods.labels, scored: g.periods[me], allowed: g.periods[other] }); } catch {}
  }
  const { reg } = periodInfo(L), quarters = [];
  for (let i = 0; i < reg; i++) { const sc = rows.map(r => r.scored[i]).filter(Number.isFinite), al = rows.map(r => r.allowed[i]).filter(Number.isFinite);
    quarters.push({ label: rows[0]?.labels[i] || `${i + 1}`, scored: avg(sc), allowed: avg(al), games: sc.length }); }
  const half = (a, b, k) => { const v = rows.map(r => r[k][a] + r[k][b]).filter(Number.isFinite); return v.length ? avg(v) : null; };   // from raw per-game sums, not rounded averages
  return { team: t, games: rows.length, quarters, firstHalf: reg >= 2 ? { scored: half(0, 1, "scored"), allowed: half(0, 1, "allowed") } : null, secondHalf: reg === 4 ? { scored: half(2, 3, "scored"), allowed: half(2, 3, "allowed") } : null, rows,
    note: "Averages use regulation periods only (overtime excluded). Built from each game's period scores." };
}

/* ---------- usage tracking (local research activity only) ---------- */
const jf = n => path.join(CACHE_DIR, n);
const readJ = (n, d) => { try { return JSON.parse(fs.readFileSync(jf(n), "utf8")); } catch { return d; } };
const writeJ = (n, o) => { try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(jf(n), JSON.stringify(o)); } catch {} };
const trackUsage = (key, id, name, stat) => { const u = readJ("usage.json", { players: {}, stats: {} });
  if (id) { const k = `${key}:${id}`, o = u.players[k] || { n: 0, name }; o.n++; o.name = name || o.name; o.t = Date.now(); u.players[k] = o; }
  if (stat) { const k = `${key}:${stat}`; u.stats[k] = { n: (u.stats[k]?.n || 0) + 1 }; }
  writeJ("usage.json", u); return u; };
exports.usage = () => readJ("usage.json", { players: {}, stats: {} });

/* ---------- provider adapters (lib/), profiles, predictions, universal search, leaders, sources ---------- */
const PR = { jolpica: require("./lib/providers/jolpica"), sackmann: require("./lib/providers/sackmann"), nflverse: require("./lib/providers/nflverse"), thesportsdb: require("./lib/providers/thesportsdb"), mlbstats: require("./lib/providers/mlbstats"),
  nhlstats: require("./lib/providers/nhlstats"), footballdata: require("./lib/providers/footballdata"), cricsheet: require("./lib/providers/cricsheet"), opl: require("./lib/providers/openpowerlifting") };
const REG = require("./lib/registry"), calcM = require("./lib/calc"), predictM = require("./lib/predict"), identity = require("./lib/identity"), { adv, unavailable } = require("./lib/providers/util"), { provenance } = require("./lib/http");
const EXT_NAME = { jolpica: "jolpica", sackmann: "sackmann", cricsheet: "cricsheet", openpowerlifting: "openpowerlifting", thesportsdb: "thesportsdb" };
const provName = L => L.external ? EXT_NAME[L.players] : L.players === "mlb" ? "mlb-statsapi" : L.players === "nhl" ? "nhl-web-api" : "espn";
const envl = (res, data, meta = {}) => send(res, 200, { ok: true, data, meta: { status: "historical", fetchedAt: new Date().toISOString(), ...meta } });
const fail = (res, code, msg) => send(res, code, { ok: false, error: msg, meta: { status: "unavailable" } });
async function extLog(key, L, id, q) {
  if (L.players === "jolpica") return PR.jolpica.gamelog(id, q);
  if (L.players === "sackmann") return PR.sackmann.gamelog(id, q);
  if (L.players === "cricsheet") { const g = PR.cricsheet.gamelog(id, q); if (!g) throw new Error("Unknown cricket player, or the Cricsheet dataset has not been imported (see README)"); return g; }
  if (L.players === "openpowerlifting") { const g = PR.opl.gamelog(id); if (!g) throw new Error("Unknown lifter, or the OpenPowerlifting dataset has not been imported (see README)"); return g; }
  throw new Error("No statistics source for this sport (profile information only)");
}
async function nflLog(id, q, L) {
  const st = ensureDir("nfl", L); let e = st.players.get(id); const t0 = Date.now();
  while (!e && !st.complete && Date.now() - t0 < 8000) { await sleep(250); e = st.players.get(id); }
  if (!e) throw new Error("Player is not in the NFL directory");
  const abbr = st.teams.find(t => t.id === e.teamId)?.abbr || "", m = await PR.nflverse.matchEntry({ name: e.name, team: abbr, pos: e.pos });
  if (m.match) { const lg = await PR.nflverse.gamelog(m.match.id, q); return { ...lg, linked: { espn: id, nflverse: m.match.id, basis: m.basis } }; }
  const lg = normEspnLog(await upstream(`${WEB}${L.espn}/athletes/${enc(id)}/gamelog${q.season ? "?season=" + enc(q.season) : ""}`), L);
  return { ...lg, note: `No confident nflverse match (${m.reason}); showing ESPN's game log instead (unverified format).`, linked: null };
}
async function getLog(key, L, id, q) { if (L.external) return extLog(key, L, id, q); const { k, load } = loadLog(key, L, id, q); return (await cached(k, 3e5, load)).data; }
const sumKeys = (games, keys) => { const t = {}; for (const k of keys) { const v = games.map(g => g.stats[k]).filter(Number.isFinite); if (v.length) t[k] = v.reduce((a, b) => a + b, 0); } return t; };
async function basketballProfile(key, L, id, e) {
  const seasons = [];
  for (const sn of seasonsFor(key, 3)) {
    const gp = ((await getLog(key, L, id, { season: sn })).games || []).filter(g => !g.dnp); if (!gp.length) continue;
    const t = sumKeys(gp, ["points", "totalRebounds", "assists", "steals", "blocks", "turnovers", "minutes", "fieldGoalsMade", "fieldGoalsAttempted", "threePointFieldGoalsMade", "threePointFieldGoalsAttempted", "freeThrowsMade", "freeThrowsAttempted"]), n = gp.length, c = calcM.basketball(t), pg = k => t[k] != null ? calcM.r(t[k] / n, 1) : null;
    seasons.push({ season: key === "nba" || key === "ncaab" ? `${sn - 1}-${String(sn).slice(2)}` : String(sn), team: e?.team || "", league: L.name, games: n, kind: "calculated",
      stats: Object.fromEntries(Object.entries({ gamesPlayed: n, minutesPerGame: pg("minutes"), pointsPerGame: pg("points"), reboundsPerGame: pg("totalRebounds"), assistsPerGame: pg("assists"), stealsPerGame: pg("steals"), blocksPerGame: pg("blocks"), turnoversPerGame: pg("turnovers") }).filter(([, v]) => v != null)),
      advanced: [adv("fg_pct", "FG%", c.fg_pct, "calculated", { formula: "FGM / FGA" }), adv("tp_pct", "3P%", c.tp_pct, "calculated", { formula: "3PM / 3PA" }), adv("ft_pct", "FT%", c.ft_pct, "calculated", { formula: "FTM / FTA" }), adv("efg_pct", "", c.efg_pct, "calculated"), adv("ts_pct", "", c.ts_pct, "calculated"), adv("ast_to", "", c.ast_to, "calculated"), adv("pts_per36", "Points per 36 min", c.pts_per36, "calculated", { formula: "PTS / MIN × 36" })] });
  }
  return { seasons, career: null, careerNote: "Per-game averages are calculated from ESPN game logs for the last 3 seasons only (not a full career).", extraUnavailable: [unavailable("PER, usage rate, offensive/defensive/net rating", "Need team and possession totals, which game logs do not contain. Not estimated."), unavailable("Win shares, BPM, VORP", "Need league-wide and team context; not available from free sources used here.")] };
}
async function soccerProfile(id, e, L) {
  const lg = await soccerLog(id, { limit: 40 }, L), gp = lg.games.filter(g => !g.dnp), n = gp.length;
  const t = sumKeys(gp, ["totalGoals", "goalAssists", "totalShots", "shotsOnTarget", "yellowCards", "redCards", "foulsCommitted", "saves"].concat(lg.statKeys.filter(k => /minute/i.test(k)))), mins = t.minutes ?? t.minutesPlayed ?? null;
  return { seasons: n ? [{ season: "Current season (matches in ESPN's schedule)", team: lg.team, league: lg.league, games: n, kind: "calculated", stats: { appearances: n, starts: gp.filter(g => g.starter).length, ...t },
    advanced: [adv("goals_per_match", "Goals per match", t.totalGoals != null ? calcM.r(t.totalGoals / n, 2) : null, "calculated", { formula: "goals / appearances" }), adv("shot_accuracy", "Shot accuracy", calcM.d(t.shotsOnTarget, t.totalShots) != null ? calcM.r(calcM.d(t.shotsOnTarget, t.totalShots), 3) : null, "calculated", { formula: "shots on target / shots" }),
      adv("goals_per90", "Goals per 90", calcM.per90(t.totalGoals, mins), "calculated", { formula: "goals / minutes × 90", reason: "ESPN did not supply minutes played" }), adv("assists_per90", "Assists per 90", calcM.per90(t.goalAssists, mins), "calculated", { formula: "assists / minutes × 90", reason: "ESPN did not supply minutes played" })] }] : [],
    career: null, careerNote: lg.note, extraUnavailable: [unavailable("Expected goals (xG) and expected assists (xA)", "Not provided by any free source used here. Not estimated."), unavailable("Key passes, progressive passes/carries, chances created", "Not in the match roster data ESPN exposes for free")] };
}
async function profileFor(key, L, id, q) {
  if (L.external) {
    if (L.players === "jolpica") { const pf = await PR.jolpica.profile(id); return pf && { ...pf, identity: { murdaId: identity.murdaId(key, "jolpica", id), providers: { jolpica: id } } }; }
    if (L.players === "sackmann") { const pf = await PR.sackmann.profile(id, q); return pf && { ...pf, identity: { murdaId: identity.murdaId(key, "sackmann", id), providers: { sackmann: id } } }; }
    if (L.players === "thesportsdb") { const pf = await PR.thesportsdb.profile(id); return pf && { ...pf, sport: key, identity: { murdaId: identity.murdaId(key, "thesportsdb", id), providers: { thesportsdb: id } } }; }
    const get = L.players === "cricsheet" ? PR.cricsheet.get(id) : PR.opl.get(id); if (!get) return null;
    const lg = await extLog(key, L, id, q); return { ...get, sport: key, seasons: [], personalBests: lg.personalBests || null, careerNote: lg.note, identity: { murdaId: identity.murdaId(key, L.players, id), providers: { [L.players]: id } } };
  }
  const st = L.dir ? ensureDir(key, L) : null; let e = st?.players.get(id); const t0 = Date.now();
  while (!e && st && !st.complete && Date.now() - t0 < 8000) { await sleep(250); e = st.players.get(id); }
  const basics = e ? { id, name: e.name, team: e.team, pos: e.pos, league: e.league, photo: e.photo || null, sport: key } : { id, sport: key };
  const idn = (prov, extra = {}) => ({ murdaId: identity.murdaId(key, prov, id), providers: { [prov]: id, ...extra } });
  if (L.players === "mlb") { const pf = await PR.mlbstats.profile(id); return pf && { ...pf, photo: basics.photo, identity: idn("mlb-statsapi") }; }
  if (L.players === "nhl") { const pf = await PR.nhlstats.profile(id); return pf && { ...pf, identity: idn("nhl-web-api") }; }
  if (!e) return null;
  if (key === "nfl") {
    const abbr = st.teams.find(t => t.id === e.teamId)?.abbr || "", m = await PR.nflverse.matchEntry({ name: e.name, team: abbr, pos: e.pos });
    if (!m.match) return { ...basics, seasons: [], identity: idn("espn"), unlinked: `Not linked to nflverse: ${m.reason}. Names alone are never merged.` };
    const pf = await PR.nflverse.profile(m.match.id, q);
    return { ...basics, ...(pf || { seasons: [], careerNote: "nflverse has no regular-season stats for this player in the recent seasons checked." }), name: e.name, team: e.team, pos: e.pos, photo: basics.photo, identity: { ...idn("espn", { nflverse: m.match.id }), linkBasis: m.basis } };
  }
  if (L.basketball && key !== "ncaab") return { ...basics, ...(await basketballProfile(key, L, id, e)), identity: idn("espn") };
  if (L.soccer) return { ...basics, ...(await soccerProfile(id, e, L)), identity: idn("espn") };
  return { ...basics, seasons: [], careerNote: "Season statistics are not built for this league yet.", identity: idn("espn") };
}
async function predictFor(key, L, id, q) {
  const lg = await getLog(key, L, id, {}), games = (lg.games || []).filter(g => !g.dnp);
  if (!q.stat || !lg.statKeys.includes(q.stat)) { const e = new Error(`Unknown stat '${q.stat || ""}'. Available: ${lg.statKeys.join(", ")}`); e.code = 400; throw e; }
  const vals = games.map(g => g.stats[q.stat]).filter(Number.isFinite), th = q.threshold != null && q.threshold !== "" ? Number(q.threshold) : null; let h = null;
  if (q.opponent && L.espn && !L.soccer) { const opp = (await getTeams(key, L)).data.teams.find(t => t.id === String(q.opponent)); if (opp) { const hh = await h2h(key, L, id, { seasons: 3 }, opp), b = hh.baseline?.[q.stat]; if (hh.count && b) h = { n: hh.count, avg: hh.averages[q.stat], baseline: b }; } }
  const side = k => games.filter(g => g.home === k).map(g => g.stats[q.stat]).filter(Number.isFinite);
  return { stat: q.stat, ...predictM.estimate(vals, { threshold: Number.isFinite(th) ? th : null, h2h: h, home: q.venue === "home" ? true : q.venue === "away" ? false : null, homeVals: side(true), awayVals: side(false) }), source: lg.note || null };
}
async function extSearch(key, L, q, qs) {
  if (L.players === "jolpica") return PR.jolpica.search(q);
  if (L.players === "sackmann") { const lg = fold(qs.league || qs.tour || ""); return PR.sackmann.search(q, lg === "wta" ? "wta" : lg === "atp" ? "atp" : undefined); }
  if (L.players === "cricsheet") return PR.cricsheet.search(q);
  if (L.players === "openpowerlifting") return PR.opl.search(q);
  return (await PR.thesportsdb.search(q)).filter(x => key === "other" ? !["golf", "rugby"].includes(x.sport) : x.sport === key);
}
const ALL_KEYS = ["nba", "wnba", "nfl", "mlb", "nhl", "soccer", "f1", "tennis"];
async function universalSearch(q, qs) {
  const loading = [];
  const only = qs.sport && qs.sport !== "all" ? [qs.sport] : null;
  const keys = only || [...ALL_KEYS, ...(PR.cricsheet.available() ? ["cricket"] : []), ...(PR.opl.available() ? ["powerlifting"] : [])];
  const tasks = keys.filter(k => LEAGUES[k]).map(async k => { const L = LEAGUES[k]; let r; if (L.external) r = await extSearch(k, L, q, qs); else { const sd = await searchDir(k, L, q, 25); if (!sd.directory.players && sd.directory.errors.length) throw new Error(sd.directory.errors[0]); if (!sd.directory.complete) loading.push(k); r = sd.players; } return { key: k, rows: r.map(x => ({ ...x, sport: k, provider: provName(L), murdaId: identity.murdaId(k, provName(L), x.id) })) }; });
  if (!only) tasks.push((async () => ({ key: "info", rows: (await PR.thesportsdb.search(q)).map(x => { const k = ["golf", "rugby"].includes(x.sport) ? x.sport : "other"; return { ...x, sport: k, provider: "thesportsdb", murdaId: identity.murdaId(k, "thesportsdb", x.id) }; }) }))());
  const rs = await Promise.allSettled(tasks), providers = [], main = [], info = [];
  rs.forEach((r, i) => { const k = r.status === "fulfilled" ? r.value.key : (keys[i] || "info"); providers.push(r.status === "fulfilled" ? { key: k, ok: true, count: r.value.rows.length } : { key: k, ok: false, error: r.reason?.message }); if (r.status === "fulfilled") (k === "info" ? info : main).push(...r.value.rows); });
  // TheSportsDB rows are dropped only when an existing row is clearly the same athlete (same name AND team or birth date); otherwise both are kept, never merged on name alone.
  const dup = x => main.some(m => fold(m.name) === fold(x.name) && ((m.team && x.team && fold(m.team) === fold(x.team)) || (m.dob && x.dob && String(m.dob).slice(0, 10) === String(x.dob).slice(0, 10))));
  let out = [...main, ...info.filter(x => !dup(x))];
  if (qs.league) out = out.filter(x => fold(x.league) === fold(qs.league));
  const fq = fold(q); out.sort((a, b) => ((fold(b.name) === fq) - (fold(a.name) === fq)) || ((!!a.info) - (!!b.info)));
  return { players: out.slice(0, 60), providers, loading };
}
async function insightsFor(key, qs) {
  switch (key) {
    case "mlb": return PR.mlbstats.leaders(); case "nhl": return PR.nhlstats.leaders(); case "nfl": return PR.nflverse.leaders(); case "f1": return PR.jolpica.leaders();
    case "tennis": return PR.sackmann.leaders(fold(qs.league || "") === "wta" ? "wta" : "atp"); case "soccer": return PR.footballdata.leaders(qs.league || "Premier League");
    default: return { categories: [], message: "No free, verified leaders source is integrated for this sport yet." };
  }
}
function sourcesInfo() {
  const prov = provenance(), nameToProv = { "api.jolpi.ca": "jolpica", "statsapi.mlb.com": "mlb-statsapi", "api-web.nhle.com": "nhl-web-api", "site.api.espn.com": "espn", "site.web.api.espn.com": "espn" };
  const last = {}; for (const [h, v] of Object.entries(health)) if (nameToProv[h] && v.lastOk) last[nameToProv[h]] = v.lastOk;
  return { providers: REG.PROVIDERS.map(p => ({ ...p, lastFetched: prov[p.id]?.lastFetched || last[p.id] || null, configured: p.id === "football-data" ? PR.footballdata.configured() : p.id === "cricsheet" ? PR.cricsheet.available() : p.id === "openpowerlifting" ? PR.opl.available() : undefined })),
    formulas: Object.entries(calcM.FORMULAS).map(([k, v]) => ({ key: k, ...v })), model: predictM_DOC,
    labels: { official: "Value as published by the provider", provided: "Model value computed and published by the data provider (e.g. nflverse EPA/CPOE)", calculated: "Calculated locally by Murda Analytics from raw provider data using the formula shown", unavailable: "Required data is not available from the free sources used. Nothing is estimated." },
    verification: "All integrations are covered by automated tests that use sample data in each provider's documented format. They have not been run against the live services from the build environment, so field names may need adjustment." };
}
const predictM_DOC = "Model estimate = 0.40×average of last 5 games + 0.35×last 10 + 0.25×all games in the data; range = ±1 standard deviation; optional opponent and home/away adjustments are shrunk toward 1 for small samples. It is a transparent statistical estimate, not a guarantee, and never uses betting lines.";


async function externalRoute(res, key, L, p, q) {
  const what = p[1], id = p[2], sub = p[3], prov = provName(L);
  try {
    if (what === "players" && !id) { if (fold(q.q || "").length < 2) return fail(res, 400, "Provide ?q= with at least 2 characters"); return envl(res, { players: (await extSearch(key, L, q.q, q)).map(x => ({ ...x, sport: key, murdaId: identity.murdaId(key, prov, x.id) })) }, { provider: prov, status: "roster" }); }
    if (what !== "players" || !id) return fail(res, 404, "Unknown endpoint");
    if (!sub || sub === "profile") { const pf = await profileFor(key, L, id, q); return pf ? envl(res, pf, { provider: prov, status: "historical" }) : fail(res, 404, "No profile data for this athlete"); }
    if (sub === "gamelog") return envl(res, await extLog(key, L, id, q), { provider: prov, status: "historical" });
    if (sub === "stats") return envl(res, computeAverages(await extLog(key, L, id, q)), { provider: prov, status: "historical", note: "Averages computed from the retrieved data" });
    if (sub === "predict") return envl(res, await predictFor(key, L, id, q), { provider: prov, status: "model" });
    if (sub === "h2h" && L.players === "sackmann") { if (!q.opponent) return fail(res, 400, "Provide ?opponent=<player id>"); return envl(res, await PR.sackmann.h2h(id, q.opponent, q), { provider: prov, status: "historical" }); }
    return fail(res, 501, "This endpoint is not available for this sport");
  } catch (e) { return fail(res, e.code === 400 ? 400 : 502, e.message); }
}
/* ---------- router ---------- */
exports.cache = cache; exports.health = health;
exports.handle = async (req, res, u) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }); return res.end(); }
  const p = u.pathname.split("/").filter(Boolean).slice(1), q = Object.fromEntries(u.searchParams);
  if (p[0] === "sports") return send(res, 200, { ok: true, data: [
    ...Object.entries(LEAGUES).map(([k, L]) => ({ key: k, name: L.name, scoreboard: !!L.espn, teams: !!L.espn, standings: !!L.espn || L.native === "f1", directory: !!L.dir, players: !!L.players, playerProvider: L.players || null, notes: L.note || L.why || null })),
    ...Object.entries(UNSUPPORTED).map(([k, why]) => ({ key: k, name: k, supported: false, notes: why }))] });
  if (p[0] === "health") return send(res, 200, { ok: true, data: { hosts: health, cacheEntries: cache.size } });
  if (p[0] === "usage") { if (p[1] === "track") trackUsage(q.sport, q.id, q.name, q.stat); return send(res, 200, { ok: true, data: readJ("usage.json", { players: {}, stats: {} }) }); }
  if (p[0] === "registry") return envl(res, { sports: REG.SPORTS.map(s => ({ ...s, datasetReady: s.key === "cricket" ? PR.cricsheet.available() : s.key === "powerlifting" ? PR.opl.available() : undefined, footballDataConfigured: s.key === "soccer" ? PR.footballdata.configured() : undefined })), providers: REG.PROVIDERS }, { status: "config" });
  if (p[0] === "sources") return envl(res, sourcesInfo(), { status: "config" });
  if (p[0] === "search") {
    if (fold(q.q || "").length < 2) return fail(res, 400, "Provide ?q= with at least 2 characters");
    try { const r = await universalSearch(q.q, q); return envl(res, { players: r.players }, { status: "roster", providers: r.providers, directoriesLoading: r.loading }); } catch (e) { return fail(res, 502, e.message); }
  }
  if (p[0] === "insights") { try { return envl(res, await insightsFor(q.sport || "nba", q), { status: "historical" }); } catch (e) { return fail(res, 502, e.message); } }
  const L = LEAGUES[p[0]];
  if (!L) return send(res, 404, { ok: false, error: `Unknown sport '${p[0]}'`, meta: { status: "unavailable" } });
  if (L.external) return externalRoute(res, p[0], L, p, q);
  const unsup = why => send(res, 501, { ok: false, error: why, meta: { status: "unavailable" } });
  const what = p[1];
  if (what === "leaders") { try { return envl(res, await insightsFor(p[0], q)); } catch (e) { return fail(res, 502, e.message); } }
  const live = d => d.games.some(g => g.state === "live");

  if (what === "scoreboard") {
    if (!L.espn) return unsup("No scoreboard for this sport");
    const date = /^\d{8}$/.test(q.date || "") ? `?dates=${q.date}` : "";
    return serve(res, "espn", `sb:${p[0]}:${q.date || ""}`, d => live(d) ? 15e3 : 120e3, async () => normScore(await upstream(`${SITE}${L.espn}/scoreboard${date}`)),
      { status: d => live(d) ? "live" : !d.games.length ? "no_games" : d.games.every(g => g.state === "completed") ? "completed" : "scheduled" });
  }
  if (what === "teams") {
    if (!L.espn && !L.soccer) return unsup("No team list for this sport");
    if (p[2] && p[3] === "roster") {
      try { const tl = (await getTeams(p[0], L)).data.teams, t = tl.find(x => x.id === p[2] && (!q.path || x.path === q.path));
        if (!t) return send(res, 404, { ok: false, error: "Unknown team id", meta: { status: "unavailable" } });
        return serve(res, L.dir, `roster:${p[0]}:${t.path || ""}:${t.id}`, 36e5, async () => ({ team: t, players: await loadRoster(p[0], L, t) }), { status: () => "roster" });
      } catch (e) { return send(res, 502, { ok: false, error: e.message, meta: { status: "unavailable" } }); }
    }
    if (p[2] && p[3] === "quarters") {
      if (!L.basketball) return unsup("Quarter trends are implemented for basketball only");
      try { const t = (await getTeams(p[0], L)).data.teams.find(x => x.id === p[2]); if (!t) return send(res, 404, { ok: false, error: "Unknown team id", meta: { status: "unavailable" } });
        return serve(res, "espn", `qt:${p[0]}:${t.id}:${q.games || ""}:${q.season || ""}`, 6e5, () => teamQuarters(p[0], L, t, q), { status: () => "historical" }); }
      catch (e) { return send(res, 502, { ok: false, error: e.message, meta: { status: "unavailable" } }); }
    }
    const fq = fold(q.q || "");
    return serve(res, L.dir, `teams:${p[0]}`, 864e5, async () => ({ teams: await listTeams(L) }), { transform: d => ({ teams: fq ? d.teams.filter(t => fold(t.name + " " + t.abbr).includes(fq)) : d.teams }), status: () => "roster" });
  }
  if (what === "standings") {
    if (L.native === "f1") return serve(res, "jolpica", "std:f1", 9e5, async () => { const d = await upstream("https://api.jolpi.ca/ergast/f1/current/driverStandings.json");
      const l = d.MRData?.StandingsTable?.StandingsLists?.[0]; return { season: l?.season, round: l?.round, entries: (l?.DriverStandings || []).map(s => ({ position: +s.position, points: +s.points, wins: +s.wins, driver: `${s.Driver.givenName} ${s.Driver.familyName}`, team: s.Constructors?.[0]?.name })) }; });
    if (!L.espn) return unsup("No standings for this sport");
    return serve(res, "espn", `std:${p[0]}`, 9e5, async () => { const d = await upstream(`${SITEV2}${L.espn}/standings`);
      const groups = (d.children || [d]).map(c => ({ name: c.name || c.abbreviation || "League", entries: (c.standings?.entries || []).map(e => ({ team: e.team?.displayName, stats: Object.fromEntries((e.stats || []).map(s => [s.name, s.displayValue ?? s.value])) })) }));
      return { groups }; });
  }
  if (what === "players") {
    if (!L.players) return unsup(L.why || "No verified player data source for this sport");
    const dmeta = d => ({ provider: "roster-directory", status: "roster", fetchedAt: new Date().toISOString(), directory: d });
    if (!p[2]) {
      if (!q.q || fold(q.q).length < 2) return send(res, 400, { ok: false, error: "Provide ?q= with at least 2 characters" });
      try { const r = await searchDir(p[0], L, q.q, Math.min(+q.limit || 25, 50)); return send(res, 200, { ok: true, data: { players: r.players }, meta: dmeta(r.directory) }); }
      catch (e) { return send(res, 502, { ok: false, error: e.message, meta: { status: "unavailable" } }); }
    }
    const id = p[2], sub = p[3], prov = L.players === "espn" ? "espn" : L.players === "mlb" ? "mlb-statsapi" : "nhl-web-api";
    if (!sub) {
      const st = ensureDir(p[0], L); let e = st.players.get(id); const t0 = Date.now();
      while (!e && !st.complete && Date.now() - t0 < 8000) { await sleep(250); e = st.players.get(id); }
      if (!e) return send(res, 404, { ok: false, error: "Player not in the directory (still loading, retired/inactive, or unknown id)", meta: { status: "unavailable" } });
      const { _f, ...rest } = e; return send(res, 200, { ok: true, data: { ...rest, gamelogAvailable: !L.soccer }, meta: dmeta({ complete: st.complete }) });
    }
    if (sub === "profile") { try { const pf = await profileFor(p[0], L, id, q); return pf ? envl(res, pf, { provider: prov, status: "historical" }) : fail(res, 404, "No profile data for this player"); } catch (e) { return fail(res, 502, e.message); } }
    if (sub === "predict") { try { return envl(res, await predictFor(p[0], L, id, q), { provider: prov, status: "model" }); } catch (e) { return fail(res, e.code === 400 ? 400 : 502, e.message); } }
    if (sub === "gamelog" || sub === "stats") {
      const { k, load } = loadLog(p[0], L, id, q);
      return serve(res, prov, k, 3e5, load, { transform: sub === "stats" ? computeAverages : x => x, status: () => "historical",
        note: sub === "stats" ? "Averages computed from the retrieved game log, not a provider-published figure" : "Completed games only; in-progress game stats are not guaranteed" });
    }
    if (sub === "h2h") {
      if (!q.opponent) return send(res, 400, { ok: false, error: "Provide ?opponent=<team id> (from /teams)" });
      let opp; try { opp = (await getTeams(p[0], L)).data.teams.find(t => t.id === String(q.opponent) && (!q.path || t.path === q.path)); } catch (e) { return send(res, 502, { ok: false, error: e.message, meta: { status: "unavailable" } }); }
      if (!opp) return send(res, 404, { ok: false, error: "Unknown opponent team id", meta: { status: "unavailable" } });
      return serve(res, prov, `h2h:${p[0]}:${id}:${opp.id}:${q.seasons || ""}:${q.from || ""}:${q.to || ""}`, 3e5, () => h2h(p[0], L, id, q, opp), { status: () => "historical" });
    }
    return unsup("Use /players?q=, /players/{id}, /players/{id}/gamelog, /stats or /h2h");
  }
  if (what === "games" && p[2]) {
    if (!L.espn) return unsup("No game detail for this sport");
    return serve(res, "espn", `g:${p[0]}:${p[2]}`, d => d.status.state === "live" ? 20e3 : d.status.state === "completed" ? 36e5 : 60e3,
      async () => normGame(await upstream(`${SITE}${L.espn}/summary?event=${enc(p[2])}`), p[2], L), { status: d => d.status.state });
  }
  return send(res, 404, { ok: false, error: "Unknown endpoint", meta: { status: "unavailable" } });
};
