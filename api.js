"use strict";
// Normalized sports API. Zero dependencies (Node 18+). Used by server.js under /api/*.
// All upstream sources are free, keyless and UNOFFICIAL unless noted; they can change without notice.
const fs = require("fs"), path = require("path");
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, ".cache");
const MIN_GAP = 250, TIMEOUT = 10000;           // per-host spacing (ms) and request timeout
const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc = encodeURIComponent;
const cache = new Map(), inflight = new Map(), lastCall = new Map(), health = {};
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
  f1:    { name: "Formula 1", native: "f1", players: null, why: "Standings only (Jolpica/Ergast community API)" },
};
// Not supported (reason shown by /api/sports): tennis, golf, cricket – ESPN nests their data differently and no verified free source was found.
const UNSUPPORTED = { tennis: "ESPN tennis scoreboards nest matches under tournaments; not implemented", golf: "leaderboard format, not implemented", cricket: "no verified free source" };

async function upstream(url) {
  const u = new URL(url), h = u.host;
  const gap = Math.max(0, (lastCall.get(h) || 0) + MIN_GAP - Date.now());
  lastCall.set(h, Date.now() + gap); if (gap) await sleep(gap);
  const target = process.env.MOCK_BASE ? `${process.env.MOCK_BASE}/${h}${u.pathname}${u.search}` : url;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(target, { headers: { "user-agent": "edge-analytics-personal/1.0", accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`upstream ${h} HTTP ${r.status}`);
    const j = await r.json();
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
    games.push({ id: String(ev.eventId), date: (m.gameDate || "").slice(0, 10), opponent: m.opponent?.abbreviation || m.opponent?.displayName || "", home: m.atVs === "vs", result: m.gameResult || null, seasonType: st.displayName || null, stats });
  }
  return finishLog(games, L);
}
function finishLog(games, L) {
  games.sort((a, b) => a.date.localeCompare(b.date));
  let derived = [];
  if (L.basketball) for (const g of games) {
    const s = g.stats, r = s.totalRebounds ?? s.rebounds, p = s.points, a = s.assists;
    if ([p, r, a].every(Number.isFinite)) { s.PRA = p + r + a; s.PR = p + r; s.PA = p + a; s.RA = r + a; derived = ["PRA", "PR", "PA", "RA"]; }
  }
  const keys = new Set(); games.forEach(g => Object.entries(g.stats).forEach(([k, v]) => typeof v === "number" && keys.add(k)));
  return { games, statKeys: [...keys], derived };
}
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
      if (sp.length) return { group: g, ...finishLog(sp.map(x => ({ id: String(x.game?.gamePk ?? x.date), date: x.date, opponent: x.opponent?.name || "", home: !!x.isHome, result: null, seasonType: null,
        stats: { ...numStats(x.stat), ...(x.stat.inningsPitched != null ? { innings: (([a, b]) => +a + (+b || 0) / 3)(String(x.stat.inningsPitched).split(".")) } : {}) } })), L) };
    }
    return { group: null, ...finishLog([], L) };
  } };
const nhl = {
  async search(q) { const d = await upstream(`https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=15&q=${enc(q)}`);
    return { players: d.map(p => ({ id: String(p.playerId), name: p.name, team: p.teamAbbrev || "", pos: p.positionCode || "" })) }; },
  async log(id, q, L) { const d = await upstream(`https://api-web.nhle.com/v1/player/${id}/game-log/${q.season ? q.season + "/2" : "now"}`);
    return finishLog((d.gameLog || []).map(x => { const s = numStats(x); if (s.shotsAgainst != null && s.goalsAgainst != null) s.saves = s.shotsAgainst - s.goalsAgainst;
      return { id: String(x.gameId), date: x.gameDate, opponent: x.opponentAbbrev, home: x.homeRoadFlag === "H", result: null, seasonType: null, stats: s }; }), L); } };

function loadLog(key, L, id, q) {
  const k = `gl:${key}:${id}:${q.season || ""}:${q.group || ""}`;
  const load = L.players === "mlb" ? () => mlb.log(id, q, L) : L.players === "nhl" ? () => nhl.log(id, q, L)
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
  const mk = o => ({ sport: key, team: t.name, teamId: t.id, league: t.league, ...o });
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
function normGame(raw, id, L) {
  const hc = raw.header?.competitions?.[0] || {}, st = hc.status?.type || raw.header?.status?.type || {}, type = (L.espn || "").split("/")[0];
  const comp = (hc.competitors || []).map(c => ({ id: c.team?.id ?? null, name: c.team?.displayName || c.team?.name || "", abbr: c.team?.abbreviation || "", logo: c.team?.logos?.[0]?.href || c.team?.logo || null, score: c.score ?? null, homeAway: c.homeAway, winner: c.winner ?? null }));
  const home = comp.find(c => c.homeAway === "home") || comp[1] || null, away = comp.find(c => c.homeAway === "away") || comp[0] || null;
  return { id, league: raw.header?.league?.name || L.name, date: hc.date || null, sportType: type,
    status: { state: st.state === "in" ? "live" : st.state === "post" ? "completed" : "scheduled", detail: st.detail || st.shortDetail || "", clock: hc.status?.displayClock ?? null, period: hc.status?.period ?? null },
    home, away, teamStats: buildTeamStats(raw, home, away, type), players: buildPlayers(raw, home, away, type) };
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
  const L = LEAGUES[p[0]];
  if (!L) return send(res, 404, { ok: false, error: `Unknown sport '${p[0]}'`, meta: { status: "unavailable" } });
  const unsup = why => send(res, 501, { ok: false, error: why, meta: { status: "unavailable" } });
  const what = p[1];
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
    if (sub === "gamelog" || sub === "stats") {
      if (L.soccer) return unsup("No verified free source for soccer player season stats or game logs. Per-match player stats appear in game box scores.");
      const { k, load } = loadLog(p[0], L, id, q);
      return serve(res, prov, k, 3e5, load, { transform: sub === "stats" ? computeAverages : x => x, status: () => "historical",
        note: sub === "stats" ? "Averages computed from the retrieved game log, not a provider-published figure" : "Completed games only; in-progress game stats are not guaranteed" });
    }
    return unsup("Use /players?q=, /players/{id}, /players/{id}/gamelog or /players/{id}/stats");
  }
  if (what === "games" && p[2]) {
    if (!L.espn) return unsup("No game detail for this sport");
    return serve(res, "espn", `g:${p[0]}:${p[2]}`, d => d.status.state === "live" ? 20e3 : d.status.state === "completed" ? 36e5 : 60e3,
      async () => normGame(await upstream(`${SITE}${L.espn}/summary?event=${enc(p[2])}`), p[2], L), { status: d => d.status.state });
  }
  return send(res, 404, { ok: false, error: "Unknown endpoint", meta: { status: "unavailable" } });
};
