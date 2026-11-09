"use strict";
// Normalized sports API. Zero dependencies (Node 18+). Used by server.js under /api/*.
// All upstream sources are free, keyless and UNOFFICIAL unless noted; they can change without notice.
const MIN_GAP = 250, TIMEOUT = 10000;           // per-host spacing (ms) and request timeout
const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc = encodeURIComponent;
const cache = new Map(), inflight = new Map(), lastCall = new Map(), health = {};
const SITE = "https://site.api.espn.com/apis/site/v2/sports/";
const SITEV2 = "https://site.api.espn.com/apis/v2/sports/";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/";

const LEAGUES = {
  nba:   { name: "NBA", espn: "basketball/nba", players: "espn", basketball: true },
  wnba:  { name: "WNBA", espn: "basketball/wnba", players: "espn", basketball: true },
  nfl:   { name: "NFL", espn: "football/nfl", players: "espn" },
  ncaaf: { name: "NCAA Football", espn: "football/college-football", players: "espn", note: "ESPN college athlete game logs are unverified" },
  ncaab: { name: "NCAA Basketball", espn: "basketball/mens-college-basketball", players: "espn", basketball: true, note: "ESPN college athlete game logs are unverified" },
  mlb:   { name: "MLB", espn: "baseball/mlb", players: "mlb" },
  nhl:   { name: "NHL", espn: "hockey/nhl", players: "nhl" },
  epl:   { name: "Premier League", espn: "soccer/eng.1", players: null, why: "No verified free soccer player game-log source yet" },
  laliga:{ name: "La Liga", espn: "soccer/esp.1", players: null, why: "No verified free soccer player game-log source yet" },
  mls:   { name: "MLS", espn: "soccer/usa.1", players: null, why: "No verified free soccer player game-log source yet" },
  ucl:   { name: "Champions League", espn: "soccer/uefa.champions", players: null, why: "No verified free soccer player game-log source yet" },
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
  const side = x => x && { id: x.team?.id ?? x.id ?? null, name: x.team?.displayName ?? x.athlete?.displayName ?? x.displayName ?? null, abbr: x.team?.abbreviation ?? null, score: x.score ?? null, winner: x.winner ?? null };
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

/* ---------- router ---------- */
exports.cache = cache; exports.health = health;
exports.handle = async (req, res, u) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }); return res.end(); }
  const p = u.pathname.split("/").filter(Boolean).slice(1), q = Object.fromEntries(u.searchParams);
  if (p[0] === "sports") return send(res, 200, { ok: true, data: [
    ...Object.entries(LEAGUES).map(([k, L]) => ({ key: k, name: L.name, scoreboard: !!L.espn, teams: !!L.espn, standings: !!L.espn || L.native === "f1", players: !!L.players, playerProvider: L.players || null, notes: L.note || L.why || null })),
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
    if (!L.espn) return unsup("No team list for this sport");
    return serve(res, "espn", `teams:${p[0]}`, 864e5, async () => { const d = await upstream(`${SITE}${L.espn}/teams`);
      return { teams: (d.sports?.[0]?.leagues?.[0]?.teams || []).map(t => ({ id: t.team.id, name: t.team.displayName, abbr: t.team.abbreviation, logo: t.team.logos?.[0]?.href || null })) }; });
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
    if (!p[2]) {
      if (!q.q || q.q.trim().length < 2) return send(res, 400, { ok: false, error: "Provide ?q= with at least 2 characters" });
      const s = q.q.trim().toLowerCase();
      if (L.players === "mlb") return serve(res, "mlb-statsapi", `s:mlb:${s}`, 36e5, () => mlb.search(s));
      if (L.players === "nhl") return serve(res, "nhl-web-api", `s:nhl:${s}`, 36e5, () => nhl.search(s));
      return serve(res, "espn", `s:espn:${s}`, 36e5, () => upstream(`https://site.web.api.espn.com/apis/common/v3/search?query=${enc(s)}&limit=25&mode=prefix&region=us&lang=en`), { transform: raw => normSearch(raw, L) });
    }
    const id = p[2], sub = p[3], prov = L.players === "espn" ? "espn" : L.players === "mlb" ? "mlb-statsapi" : "nhl-web-api";
    if (sub === "gamelog" || sub === "stats") {
      const { k, load } = loadLog(p[0], L, id, q);
      return serve(res, prov, k, 3e5, load, { transform: sub === "stats" ? computeAverages : x => x, status: () => "historical",
        note: sub === "stats" ? "Averages computed from the retrieved game log, not a provider-published figure" : "Completed games only; in-progress game stats are not guaranteed" });
    }
    return unsup("Use /players?q=, /players/{id}/gamelog or /players/{id}/stats");
  }
  if (what === "games" && p[2]) {
    if (!L.espn) return unsup("No game detail for this sport");
    return serve(res, "espn", `g:${p[0]}:${p[2]}`, d => d.state === "in" ? 20e3 : 3e5, async () => { const d = await upstream(`${SITE}${L.espn}/summary?event=${enc(p[2])}`), st = d.header?.competitions?.[0]?.status?.type || {};
      return { id: p[2], state: st.state, detail: st.detail, teams: d.boxscore?.teams || [], players: d.boxscore?.players || [] }; },
      { status: d => d.state === "in" ? "live" : d.state === "post" ? "completed" : "scheduled" });
  }
  return send(res, 404, { ok: false, error: "Unknown endpoint", meta: { status: "unavailable" } });
};
