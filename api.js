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
const normOdds = o => o ? { provider: o.provider?.name ?? null, details: o.details ?? null, overUnder: o.overUnder ?? null, spread: o.spread ?? null, scope: "game line (spread / total), not a player prop" } : null;
function normScore(raw) {
  const side = x => x && { id: x.team?.id ?? x.id ?? null, name: x.team?.displayName ?? x.athlete?.displayName ?? x.displayName ?? null, abbr: x.team?.abbreviation ?? null, logo: x.team?.logo ?? x.team?.logos?.[0]?.href ?? null, score: x.score ?? null, winner: x.winner ?? null };
  return { games: (raw.events || []).map(e => {
    const c = e.competitions?.[0] || {}, cs = c.competitors || [], t = e.status?.type || {};
    return { id: e.id, name: e.shortName || e.name, startTime: e.date, state: t.state === "in" ? "live" : t.state === "post" ? "completed" : "scheduled", detail: t.shortDetail || t.detail || "",
      home: side(cs.find(x => x.homeAway === "home")), away: side(cs.find(x => x.homeAway === "away")), odds: normOdds(c.odds?.[0]) };
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
  const load = L.soccer ? () => soccerLog(id, q, L) : L.players === "mlb" ? () => mlb.log(id, q, L) : L.players === "nhl" ? () => nhl.log(id, q, L)
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
    home, away, odds: normOdds(raw.pickcenter?.[0] || raw.odds?.[0]), periods: buildPeriods(hc, home, away, L), teamStats: buildTeamStats(raw, home, away, type), players, quarterPoints: buildQuarterPoints(raw, L, players) };
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
  const isOpp = g => (g.opponentId && String(g.opponentId) === String(opp.id)) || (g.opponentName && fold(g.opponentName) === fold(opp.name)) || (g.opponent && fold(g.opponent) === fold(opp.abbr));
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

/* ---------- usage tracking, sportsbook lines (The Odds API, free key required), picks ---------- */
const jf = n => path.join(CACHE_DIR, n);
const readJ = (n, d) => { try { return JSON.parse(fs.readFileSync(jf(n), "utf8")); } catch { return d; } };
const writeJ = (n, o) => { try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(jf(n), JSON.stringify(o)); } catch {} };
const ODDS = {
  nba: { sport: "basketball_nba", markets: { player_points: ["points", "Points"], player_rebounds: ["totalRebounds", "Rebounds"], player_assists: ["assists", "Assists"], player_threes: ["threePointFieldGoalsMade", "3-Pointers"], player_blocks: ["blocks", "Blocks"], player_steals: ["steals", "Steals"], player_points_rebounds_assists: ["PRA", "Pts+Reb+Ast"] } },
  nhl: { sport: "icehockey_nhl", markets: { player_points: ["points", "Points"], player_assists: ["assists", "Assists"], player_shots_on_goal: ["shots", "Shots on Goal"], player_goals: ["goals", "Goals"] } },
  mlb: { sport: "baseball_mlb", markets: { batter_hits: ["hits", "Hits"], batter_home_runs: ["homeRuns", "Home Runs"], batter_total_bases: ["totalBases", "Total Bases"], pitcher_strikeouts: ["strikeOuts", "Strikeouts"] } },
};
const oddsKey = () => process.env.ODDS_API_KEY || "", BUDGET = () => +process.env.ODDS_MONTHLY_BUDGET || 400, MAXEV = () => +process.env.ODDS_MAX_EVENTS || 2;
async function oddsGet(pq, cost) {
  const u = readJ("odds-usage.json", {}), mo = new Date().toISOString().slice(0, 7), used = u.month === mo ? u.used || 0 : 0;
  if (cost && used + cost > BUDGET()) throw new Error(`Monthly odds credit budget reached (${used}/${BUDGET()} credits). Nothing was fetched.`);
  const j = await upstream(`https://api.the-odds-api.com/v4${pq}${pq.includes("?") ? "&" : "?"}apiKey=${enc(oddsKey())}`);
  const h = lastHdr.get("api.the-odds-api.com") || {}, spent = cost ? (h["x-requests-last"] != null ? Number(h["x-requests-last"]) : cost) : 0;
  writeJ("odds-usage.json", { month: mo, used: used + spent, remaining: h["x-requests-remaining"] != null ? Number(h["x-requests-remaining"]) : null, budget: BUDGET(), updatedAt: new Date().toISOString() });
  return j;
}
async function refreshProps(key, force) {
  const C = ODDS[key], store = readJ(`props-${key}.json`, { events: {} }), now = Date.now();
  const ev = await oddsGet(`/sports/${C.sport}/events?dateFormat=iso`, 0);          // listing events is free
  const soon = ev.filter(e => { const t = Date.parse(e.commence_time); return t > now && t < now + 36 * 36e5; }).sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time)).slice(0, MAXEV());
  for (const e of soon) {
    const have = store.events[e.id]; if (have && !force && now - have.fetchedAt < 216e5) continue;   // at most every 6h per event
    const d = await oddsGet(`/sports/${C.sport}/events/${e.id}/odds?regions=us&markets=${Object.keys(C.markets).join(",")}&oddsFormat=american&dateFormat=iso`, Object.keys(C.markets).length);
    store.events[e.id] = { id: e.id, home: e.home_team, away: e.away_team, commence: e.commence_time, fetchedAt: now, bookmakers: d.bookmakers || [] };
  }
  for (const id of Object.keys(store.events)) if (Date.parse(store.events[id].commence) < now - 6 * 36e5) delete store.events[id];
  store.fetchedAt = now; writeJ(`props-${key}.json`, store); return store;
}
const trackUsage = (key, id, name, stat) => { const u = readJ("usage.json", { players: {}, stats: {} });
  if (id) { const k = `${key}:${id}`, o = u.players[k] || { n: 0, name }; o.n++; o.name = name || o.name; o.t = Date.now(); u.players[k] = o; }
  if (stat) { const k = `${key}:${stat}`; u.stats[k] = { n: (u.stats[k]?.n || 0) + 1 }; }
  writeJ("usage.json", u); return u; };
async function buildPicks(key, L, opts) {
  const C = ODDS[key];
  if (!C) return { configured: false, supported: false, picks: [], message: "Sportsbook player-prop lines are only wired for NBA, NHL and MLB." };
  if (!oddsKey()) return { configured: false, supported: true, picks: [], message: "Line unavailable: no odds key is configured. Add a free key from the-odds-api.com as ODDS_API_KEY (see README) to load real sportsbook lines." };
  let store = readJ(`props-${key}.json`, null), error = null;
  const age = store ? Date.now() - store.fetchedAt : Infinity;
  try { if ((opts.refresh && age > 18e5) || age > 864e5) store = await refreshProps(key, !!opts.refresh); } catch (e) { error = e.message; }
  if (!store || !Object.keys(store.events).length) return { configured: true, supported: true, picks: [], error, message: error || "No upcoming games with prop lines were found in the next 36 hours." };
  const st = ensureDir(key, L), t0 = Date.now(); while (!st.complete && Date.now() - t0 < 20000) await sleep(250);
  const byName = new Map(); for (const pl of st.players.values()) { const f = fold(pl.name); (byName.get(f) || byName.set(f, []).get(f)).push(pl); }
  const hist = readJ("lines.json", {}), usage = readJ("usage.json", { players: {}, stats: {} }), picks = []; let unmatched = 0; const sample = [], formCache = new Map();
  for (const ev of Object.values(store.events)) {
    const groups = new Map();
    for (const b of ev.bookmakers) for (const m of b.markets || []) { if (!C.markets[m.key]) continue;
      for (const o of m.outcomes || []) { if (!o.description || o.point == null) continue; const gk = `${m.key}|${o.description}`; const g = groups.get(gk) || groups.set(gk, { market: m.key, player: o.description, books: new Map() }).get(gk);
        const bk = g.books.get(b.key) || g.books.set(b.key, { book: b.title || b.key, line: o.point, over: null, under: null, updatedAt: m.last_update || b.last_update || null }).get(b.key);
        if (/^over$/i.test(o.name)) bk.over = o.price; else if (/^under$/i.test(o.name)) bk.under = o.price; bk.line = o.point; } }
    for (const g of groups.values()) {
      const cands = (byName.get(fold(g.player)) || []).filter(c => [ev.home, ev.away].some(t => fold(t) === fold(c.team)));
      if (cands.length !== 1) { unmatched++; if (sample.length < 5) sample.push(g.player); continue; }   // never guess between players or teams
      const pl = cands[0], books = [...g.books.values()], counts = {}; books.forEach(b => counts[b.line] = (counts[b.line] || 0) + 1);
      const line = Number(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]), [statKey, mlabel] = C.markets[g.market];
      const hk = `${ev.id}|${g.market}|${pl.id}`, h = hist[hk] = hist[hk] || []; if (!h.length || h[h.length - 1].line !== line) h.push({ t: Date.now(), line });
      picks.push({ key, market: g.market, marketLabel: mlabel, statKey, line, lineMove: h.length > 1 ? +(line - h[0].line).toFixed(2) : null, movedSince: h.length > 1 ? new Date(h[0].t).toISOString() : null,
        player: { id: pl.id, name: pl.name, team: pl.team, photo: pl.photo || null, pos: pl.pos }, opponent: fold(ev.home) === fold(pl.team) ? ev.away : ev.home, game: { id: ev.id, startTime: ev.commence, home: ev.home, away: ev.away },
        books, over: books.filter(b => b.over != null).sort((a, b) => b.over - a.over)[0] || null, under: books.filter(b => b.under != null).sort((a, b) => b.under - a.under)[0] || null,
        popularity: (usage.players[`${key}:${pl.id}`]?.n || 0) + 0.5 * (usage.stats[`${key}:${statKey}`]?.n || 0), form: null, linesFetchedAt: new Date(ev.fetchedAt).toISOString() });
    }
  }
  writeJ("lines.json", hist);
  const ids = [...new Set(picks.map(p => p.player.id))].slice(0, 40);
  for (const id of ids) { try { const { k, load } = loadLog(key, L, id, {}); formCache.set(id, (await cached(k, 3e5, load)).data.games.filter(g => !g.dnp)); } catch {} }
  for (const p of picks) {
    const gs = formCache.get(p.player.id); if (!gs) continue;
    const v = gs.map(g => g.stats[p.statKey]).filter(Number.isFinite); if (v.length < 3) continue;
    const l10 = v.slice(-10), l5 = v.slice(-5), over = l10.filter(x => x > p.line).length, sa = avg(v), a5 = avg(l5);
    p.form = { games: v.length, last10: { n: l10.length, over, under: l10.filter(x => x < p.line).length, hitRateOver: +(over / l10.length).toFixed(3) }, last5Avg: a5, last10Avg: avg(l10), seasonAvg: sa, trendPct: sa ? +((a5 - sa) / sa * 100).toFixed(1) : null, recent: l10 };
    const why = []; if (v.length >= 8 && p.form.trendPct != null && Math.abs(p.form.trendPct) >= 15) why.push(`Last 5 avg ${a5} vs season ${sa} (${p.form.trendPct > 0 ? "+" : ""}${p.form.trendPct}%)`);
    if (l10.length >= 8 && (p.form.last10.hitRateOver >= 0.8 || p.form.last10.hitRateOver <= 0.2)) why.push(`${over}/${l10.length} games over ${p.line}`);
    if (p.lineMove != null && Math.abs(p.lineMove) >= 1) why.push(`Line moved ${p.lineMove > 0 ? "+" : ""}${p.lineMove} since first seen by this server`);
    p.trendReasons = why;
  }
  const u = readJ("odds-usage.json", {});
  return { configured: true, supported: true, picks, error, meta: { fetchedAt: new Date(store.fetchedAt).toISOString(), events: Object.keys(store.events).length, unmatchedProps: unmatched, unmatchedSample: sample, creditsUsedThisMonth: u.used ?? null, creditBudget: BUDGET(), creditsRemainingReported: u.remaining ?? null,
    note: "Lines are from The Odds API (US books), cached up to 6h per game. Line movement only covers changes this server has seen." } };
}
exports.usage = () => readJ("usage.json", { players: {}, stats: {} });

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
  if (p[0] === "picks") { const k = q.sport || "nba", PL = LEAGUES[k];
    if (!PL) return send(res, 404, { ok: false, error: "Unknown sport" });
    try { return send(res, 200, { ok: true, data: await buildPicks(k, PL, { refresh: q.refresh === "1" }), meta: { provider: "the-odds-api", status: "lines" } }); } catch (e) { return send(res, 502, { ok: false, error: e.message, meta: { status: "unavailable" } }); } }
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
