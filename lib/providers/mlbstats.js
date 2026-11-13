"use strict";
// MLB Stats API: season-by-season + career stats, bio, league leaders. Official fields (avg, obp, slg, ops, era, whip) are shown as published; extra rates are calculated locally.
const { getJSON, cachedFetch, num } = require("../http"), { adv, unavailable, curYear } = require("./util"), calc = require("../calc");
const B = "https://statsapi.mlb.com/api/v1", INFO = { provider: "mlb-statsapi", source: "statsapi.mlb.com", license: "MLB Stats API: personal/non-commercial use per MLB terms; copyright MLB Advanced Media" };
const ip = s => { if (s == null) return null; const [a, b] = String(s).split("."); return +a + (+b || 0) / 3; };
const J = (p, ttl) => cachedFetch("mlb:" + p, ttl, () => getJSON(B + p), INFO);
const hitKeys = ["gamesPlayed", "atBats", "hits", "doubles", "triples", "homeRuns", "runs", "rbi", "baseOnBalls", "strikeOuts", "stolenBases", "plateAppearances", "totalBases"], pitKeys = ["gamesPlayed", "gamesStarted", "wins", "losses", "saves", "strikeOuts", "baseOnBalls", "hits", "earnedRuns", "homeRuns"];
function row(split, group) {
  const s = split.stat || {}, o = {}, keys = group === "pitching" ? pitKeys : hitKeys; keys.forEach(k => { const v = num(s[k]); if (v != null) o[k] = v; });
  if (group === "pitching") { if (s.inningsPitched != null) o.inningsPitched = ip(s.inningsPitched); } else if (s.avg) { /* rates below */ }
  const official = group === "pitching" ? { era: s.era, whip: s.whip } : { avg: s.avg, obp: s.obp, slg: s.slg, ops: s.ops };
  const t = { ...o, avg: num(s.avg), slg: num(s.slg) };
  const calcd = calc.baseball(t);
  const advList = group === "pitching"
    ? [adv("era", "ERA", num(official.era), "official"), adv("whip", "WHIP", num(official.whip), "official"), adv("k9", "K/9", calcd.k9, "calculated"), adv("bb9", "BB/9", calcd.bb9, "calculated")]
    : [adv("avg", "AVG", num(official.avg), "official"), adv("obp", "OBP", num(official.obp), "official"), adv("slg", "SLG", num(official.slg), "official"), adv("ops", "OPS", num(official.ops), "official"), adv("iso", "ISO", calcd.iso, "calculated"), adv("k_pct", "K%", calcd.k_pct, "calculated"), adv("bb_pct", "BB%", calcd.bb_pct, "calculated")];
  return { stats: o, advanced: advList };
}
async function profile(id) {
  const [bio, ...grp] = await Promise.all([J(`/people/${id}?hydrate=currentTeam`, 864e5), ...["hitting", "pitching"].map(g => Promise.all([J(`/people/${id}/stats?stats=yearByYear&group=${g}`, 6 * 36e5), J(`/people/${id}/stats?stats=career&group=${g}`, 6 * 36e5)]))]);
  const p = bio.data.people?.[0]; if (!p) return null;
  const seasons = [], careers = {};
  ["hitting", "pitching"].forEach((g, i) => {
    const [yy, cc] = grp[i], splits = (yy.data.stats?.[0]?.splits || []).filter(s => s.sport?.id === 1 || !s.sport || s.league?.name);
    for (const s of splits) { const r0 = row(s, g); seasons.push({ season: s.season, team: s.team?.name || "", league: s.league?.name || "MLB", group: g, kind: "official", ...r0 }); }
    const c = cc.data.stats?.[0]?.splits?.[0]; if (c) careers[g] = { kind: "official", ...row(c, g) };
  });
  seasons.sort((a, b) => b.season.localeCompare(a.season));
  return { id: String(id), name: p.fullName, pos: p.primaryPosition?.abbreviation, team: p.currentTeam?.name, dob: p.birthDate, country: p.birthCountry, bats: p.batSide?.code, throws: p.pitchHand?.code, debut: p.mlbDebutDate, sport: "mlb", seasons, career: careers,
    extraUnavailable: [unavailable("OPS+, wRC+, wOBA, WAR, FIP", "These need league and park context (or a season-specific constant) that is not downloaded. They are not estimated."), unavailable("Statcast (exit velocity, xwOBA)", "Not integrated in this version")], meta: bio.meta };
}
async function leaders(season = curYear(2)) {
  const cats = [["homeRuns", "Home runs", "hitting"], ["battingAverage", "Batting average", "hitting"], ["runsBattedIn", "RBI", "hitting"], ["hits", "Hits", "hitting"], ["earnedRunAverage", "ERA", "pitching"], ["strikeouts", "Strikeouts (pitching)", "pitching"]], out = [];
  for (const g of ["hitting", "pitching"]) { const use = cats.filter(c => c[2] === g);
    const { data, meta } = await J(`/stats/leaders?leaderCategories=${use.map(c => c[0]).join(",")}&season=${season}&sportId=1&limit=10&statGroup=${g}`, 6 * 36e5);
    for (const l of data.leagueLeaders || []) { const c = use.find(x => x[0] === l.leaderCategory); if (c) out.push({ key: c[0], label: `${c[1]} ${season}`, entries: (l.leaders || []).map(e => ({ rank: e.rank, id: String(e.person?.id), name: e.person?.fullName, team: e.team?.name, value: num(e.value) })) }); } }
  return { season, categories: out, meta: { ...INFO, fetchedAt: new Date().toISOString() } };
}
module.exports = { profile, leaders, INFO };
