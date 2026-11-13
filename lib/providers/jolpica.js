"use strict";
// Formula 1 via Jolpica (Ergast-compatible). Limits: 4 req/s burst, 500/h sustained (jolpica-f1 docs); max 100 rows per page.
const { getJSON, cachedFetch, num, fold } = require("../http"), { finish, curYear } = require("./util"), { r } = require("../calc");
const BASE = "https://api.jolpi.ca/ergast/f1", INFO = { provider: "jolpica", source: "api.jolpi.ca/ergast/f1", license: "Jolpica-F1 open API (Ergast-compatible); see github.com/jolpica/jolpica-f1" };
const J = (p, ttl) => cachedFetch("jolpica:" + p, ttl, () => getJSON(BASE + p), INFO);
async function drivers() {
  return cachedFetch("jolpica:drivers:all", 7 * 864e5, async () => {
    const out = []; let offset = 0, total = Infinity;
    while (offset < total && offset < 3000) { const d = (await getJSON(`${BASE}/drivers.json?limit=100&offset=${offset}`)).MRData; total = +d.total; out.push(...d.DriverTable.Drivers); offset += 100; }
    return out;
  }, INFO);
}
async function currentTeams() {
  try { const d = (await J("/current/driverStandings.json", 6 * 36e5)).data.MRData.StandingsTable.StandingsLists[0]; return { season: d?.season, map: Object.fromEntries((d?.DriverStandings || []).map(s => [s.Driver.driverId, s.Constructors?.[0]?.name])) }; } catch { return { map: {} }; }
}
async function search(q) {
  const [{ data }, cur] = await Promise.all([drivers(), currentTeams()]), fq = fold(q), toks = fq.split(" ").filter(Boolean);
  return data.map(d => ({ id: d.driverId, name: `${d.givenName} ${d.familyName}`, team: cur.map[d.driverId] || "", pos: "Driver", league: "Formula 1", photo: null, dob: d.dateOfBirth, country: d.nationality, current: !!cur.map[d.driverId] }))
    .filter(d => { const f = fold(d.name); return toks.every(t => f.includes(t)); }).sort((a, b) => (b.current - a.current) || a.name.localeCompare(b.name)).slice(0, 25);
}
async function results(id, season) { return (await J(`/${season}/drivers/${encodeURIComponent(id)}/results.json?limit=100`, season >= curYear() ? 6 * 36e5 : 30 * 864e5)).data.MRData.RaceTable.Races || []; }
async function gamelog(id, q = {}) {
  const season = +q.season || curYear(3), races = await results(id, season), games = [];
  for (const r0 of races) for (const x of r0.Results || []) {
    const pos = num(x.position), fl = x.FastestLap ? num(x.FastestLap.rank) : null, finished = /^(Finished|\+\d+ Laps?)$/.test(x.status || "");
    games.push({ id: `${season}-${r0.round}`, startTime: r0.date ? `${r0.date}T${(r0.time || "00:00:00Z")}` : null, date: r0.date || "", dateOnly: !r0.time, opponent: r0.raceName, opponentId: r0.Circuit?.circuitId || "", opponentName: r0.raceName, home: false, result: x.positionText, seasonType: "Race", competition: r0.Circuit?.circuitName || "",
      stats: { finish: pos, grid: num(x.grid), points: num(x.points), laps: num(x.laps), win: pos === 1 ? 1 : 0, podium: pos != null && pos <= 3 ? 1 : 0, pole: num(x.grid) === 1 ? 1 : 0, fastestLap: fl === 1 ? 1 : 0, dnf: finished ? 0 : 1, positionsGained: num(x.grid) != null && pos != null && num(x.grid) > 0 ? num(x.grid) - pos : null } });
  }
  return { ...finish(games), season, note: `Official race results from Jolpica for ${season}. "Positions gained" = grid − finish (pit-lane starts excluded when grid is 0). Sprint races are not included.` };
}
async function profile(id) {
  const { data: all, meta } = await drivers(), d = all.find(x => x.driverId === id); if (!d) return null;
  const st = (await J(`/drivers/${encodeURIComponent(id)}/driverStandings.json?limit=100`, 864e5)).data.MRData.StandingsTable.StandingsLists || [];
  const seasons = st.map(s => ({ season: s.season, team: s.DriverStandings[0].Constructors?.map(c => c.name).join(" / ") || "", league: "Formula 1", stats: { position: num(s.DriverStandings[0].position), points: num(s.DriverStandings[0].points), wins: num(s.DriverStandings[0].wins) }, kind: "official" }));
  const career = { championships: seasons.filter(s => s.stats.position === 1).length, seasons: seasons.length, wins: seasons.reduce((a, s) => a + (s.stats.wins || 0), 0), points: r(seasons.reduce((a, s) => a + (s.stats.points || 0), 0), 1) };
  return { id, name: `${d.givenName} ${d.familyName}`, dob: d.dateOfBirth, country: d.nationality, number: d.permanentNumber, sport: "f1", seasons, career, careerKind: "calculated",
    careerNote: "Career totals are sums of Jolpica end-of-season standings (championship points and wins).", meta };
}
async function leaders() {
  const { data, meta } = await J("/current/driverStandings.json", 6 * 36e5), l = data.MRData.StandingsTable.StandingsLists[0];
  return { season: l?.season, round: l?.round, meta, categories: [{ key: "points", label: "Championship points", entries: (l?.DriverStandings || []).slice(0, 10).map(s => ({ rank: +s.position, id: s.Driver.driverId, name: `${s.Driver.givenName} ${s.Driver.familyName}`, team: s.Constructors?.[0]?.name || "", value: num(s.points) })) },
    { key: "wins", label: "Race wins", entries: (l?.DriverStandings || []).filter(s => +s.wins > 0).sort((a, b) => b.wins - a.wins).slice(0, 10).map((s, i) => ({ rank: i + 1, id: s.Driver.driverId, name: `${s.Driver.givenName} ${s.Driver.familyName}`, team: s.Constructors?.[0]?.name || "", value: num(s.wins) })) }] };
}
module.exports = { search, gamelog, profile, leaders, INFO };
