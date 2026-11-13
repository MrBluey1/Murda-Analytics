"use strict";
// NHL web API (undocumented, unofficial): bio, season-by-season and career totals, leaders.
const { getJSON, cachedFetch, num } = require("../http"), { adv, unavailable } = require("./util"), calc = require("../calc");
const B = "https://api-web.nhle.com/v1", INFO = { provider: "nhl-web-api", source: "api-web.nhle.com", license: "NHL data via undocumented public endpoints: personal use, may change or disappear; copyright NHL" };
const J = (p, ttl) => cachedFetch("nhl:" + p, ttl, () => getJSON(B + p), INFO), nm = x => x?.default || x || "";
function row(t, goalie) {
  const k = goalie ? ["gamesPlayed", "wins", "losses", "shutouts", "goalsAgainstAvg", "savePctg", "shotsAgainst", "goalsAgainst", "saves"] : ["gamesPlayed", "goals", "assists", "points", "plusMinus", "pim", "shots", "powerPlayGoals", "powerPlayPoints", "shorthandedGoals", "gameWinningGoals", "avgToi"];
  const o = {}; k.forEach(x => { const v = typeof t[x] === "string" && /^\d+:\d+$/.test(t[x]) ? (+t[x].split(":")[0] + +t[x].split(":")[1] / 60) : num(t[x]); if (v != null) o[x] = typeof v === "number" ? +v.toFixed(3) : v; });
  const c = calc.hockey(o);
  return { stats: o, advanced: goalie ? [adv("savePctg", "Save %", num(t.savePctg), "official"), adv("goalsAgainstAvg", "GAA", num(t.goalsAgainstAvg), "official")] : [adv("sh_pct", "Shooting %", c.sh_pct, "calculated"), adv("pts_pg", "Points per game", c.pts_pg, "calculated")] };
}
async function profile(id) {
  const { data: p, meta } = await J(`/player/${encodeURIComponent(id)}/landing`, 6 * 36e5), goalie = p.position === "G";
  if (!p.playerId && !p.firstName) return null;
  const seasons = (p.seasonTotals || []).filter(s => s.leagueAbbrev === "NHL" && s.gameTypeId === 2).map(s => ({ season: `${String(s.season).slice(0, 4)}-${String(s.season).slice(4)}`, team: nm(s.teamName), league: "NHL", kind: "official", ...row(s, goalie) })).sort((a, b) => b.season.localeCompare(a.season));
  const c = p.careerTotals?.regularSeason;
  return { id: String(id), name: `${nm(p.firstName)} ${nm(p.lastName)}`.trim(), pos: p.position, team: p.currentTeamAbbrev, photo: p.headshot || null, dob: p.birthDate, country: p.birthCountry, sport: "nhl", seasons, career: c ? { skater: { kind: "official", ...row(c, goalie) } } : {},
    extraUnavailable: [unavailable("Corsi, Fenwick, expected goals", "Need shot-attempt / event data that is not downloaded in this version"), unavailable("Goals saved above expected", "Needs shot-quality models; not available from free endpoints used here")], meta };
}
async function leaders() {
  const cats = [["goals", "Goals"], ["assists", "Assists"], ["points", "Points"]], out = [];
  for (const [c, label] of cats) { try { const { data } = await J(`/skater-stats-leaders/current?categories=${c}&limit=10`, 6 * 36e5); out.push({ key: c, label, entries: (data[c] || []).map((e, i) => ({ rank: i + 1, id: String(e.id), name: `${nm(e.firstName)} ${nm(e.lastName)}`.trim(), team: e.teamAbbrev, value: num(e.value) })) }); } catch {} }
  return { categories: out, meta: { ...INFO, fetchedAt: new Date().toISOString() } };
}
module.exports = { profile, leaders, INFO };
