"use strict";
// NFL via nflverse-data (GitHub releases). License: CC BY 4.0. FTN charting data (separately licensed) is NOT used.
const { getText, cachedFetch, csvObjects, num, fold } = require("../http"), { finish, curYear, adv, unavailable } = require("./util"), calc = require("../calc"), identity = require("../identity");
const BASE = "https://github.com/nflverse/nflverse-data/releases/download/player_stats/stats_player_week_", GAMES = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const INFO = { provider: "nflverse", source: "github.com/nflverse/nflverse-data (player_stats release)", license: "CC BY 4.0 (nflverse). Cite nflverse; FTN charting data is not used." };
const pick = (r, ...ks) => { for (const k of ks) if (r[k] !== undefined && r[k] !== "") return num(r[k]); return null; };
async function season(y) {
  const cur = y >= curYear(3);
  try {
    return (await cachedFetch(`nflverse:ps:${y}`, cur ? 12 * 36e5 : 365 * 864e5, async () => csvObjects(await getText(`${BASE}${y}.csv`)).filter(r => r.player_id).map(r => ({
      id: r.player_id, name: r.player_display_name || r.player_name, pos: r.position, team: r.team || r.recent_team, opp: r.opponent_team, week: num(r.week), stype: r.season_type,
      completions: pick(r, "completions"), attempts: pick(r, "attempts"), passingYards: pick(r, "passing_yards"), passingTds: pick(r, "passing_tds"), interceptions: pick(r, "passing_interceptions", "interceptions"),
      sacks: pick(r, "sacks_suffered", "sacks"), sackYards: pick(r, "sack_yards_lost", "sack_yards"), passingEpa: pick(r, "passing_epa"), passingCpoe: pick(r, "passing_cpoe"), passingAirYards: pick(r, "passing_air_yards"), passingYac: pick(r, "passing_yards_after_catch"),
      carries: pick(r, "carries"), rushingYards: pick(r, "rushing_yards"), rushingTds: pick(r, "rushing_tds"), rushingEpa: pick(r, "rushing_epa"),
      receptions: pick(r, "receptions"), targets: pick(r, "targets"), receivingYards: pick(r, "receiving_yards"), receivingTds: pick(r, "receiving_tds"), receivingAirYards: pick(r, "receiving_air_yards"), receivingYac: pick(r, "receiving_yards_after_catch"), receivingEpa: pick(r, "receiving_epa"),
      targetShare: pick(r, "target_share"), airYardsShare: pick(r, "air_yards_share"), fantasyPoints: pick(r, "fantasy_points"), fantasyPointsPpr: pick(r, "fantasy_points_ppr") })), INFO)).data;
  } catch (e) { if (e.status === 404) return []; throw e; }
}
async function schedule() { try { return (await cachedFetch("nflverse:games", 12 * 36e5, async () => csvObjects(await getText(GAMES)).map(g => ({ season: num(g.season), week: num(g.week), day: g.gameday, home: g.home_team, away: g.away_team })), { ...INFO, source: "github.com/nflverse/nfldata (games.csv)" })).data; } catch { return []; } }
async function players() {
  const y = curYear(3), rows = await season(y), use = rows.length ? rows : await season(y - 1), m = new Map();
  for (const r of use) m.set(r.id, { id: r.id, name: r.name, team: r.team, pos: r.pos });
  return [...m.values()];
}
async function search(q) { const toks = fold(q).split(" ").filter(Boolean); return (await players()).filter(p => toks.every(t => fold(p.name).includes(t))).slice(0, 25).map(p => ({ ...p, league: "NFL", photo: null })); }
const matchEntry = async entry => identity.match(entry, await players());
const NUM = ["completions", "attempts", "passingYards", "passingTds", "interceptions", "sacks", "sackYards", "passingEpa", "passingCpoe", "passingAirYards", "passingYac", "carries", "rushingYards", "rushingTds", "rushingEpa", "receptions", "targets", "receivingYards", "receivingTds", "receivingAirYards", "receivingYac", "receivingEpa", "targetShare", "airYardsShare", "fantasyPoints", "fantasyPointsPpr"];
async function gamelog(id, q = {}) {
  const y = +q.season || curYear(3), rows = (await season(y)).filter(r => r.id === id), sch = await schedule(), games = [];
  for (const r of rows) {
    const g = sch.find(s => s.season === y && s.week === r.week && (s.home === r.team || s.away === r.team)), st = {};
    NUM.forEach(k => { if (r[k] != null) st[k] = r[k]; });
    if (r.attempts > 0) { const f = calc.football(r); ["comp_pct", "ypa", "passer_rating", "anya"].forEach(k => { if (f[k] != null) st[k] = f[k]; }); }
    if (r.carries > 0) { const f = calc.football(r); if (f.ypc != null) st.ypc = f.ypc; }
    games.push({ id: `${y}-${r.stype}-${r.week}`, startTime: null, date: g?.day || "", dateOnly: true, label: `Wk ${r.week}${r.stype && r.stype !== "REG" ? " " + r.stype : ""}`, order: (r.stype === "REG" ? 0 : 100) + r.week, opponent: r.opp || "", opponentId: r.opp || "", opponentName: r.opp || "", home: g ? g.home === r.team : false, result: null, seasonType: r.stype, stats: st });
  }
  return { ...finish(games), season: y, note: `Weekly player stats from nflverse (${y}). EPA, CPOE and air yards are published by nflverse (model values). Passer rating, Y/A, ANY/A and YPC are calculated locally per game.` };
}
async function profile(id, q = {}) {
  const n = Math.min(+q.seasons || 5, 15), y0 = curYear(3), seasons = []; let name = "", pos = "";
  for (let y = y0; y > y0 - n; y--) {
    const rows = (await season(y)).filter(r => r.id === id && r.stype === "REG"); if (!rows.length) continue;
    name = rows[0].name; pos = rows[0].pos;
    const sum = k => rows.some(r => r[k] != null) ? rows.reduce((a, r) => a + (r[k] || 0), 0) : null, t = {}; NUM.forEach(k => { t[k] = sum(k); });
    const f = calc.football(t), att = t.attempts || 0, cpoeW = att ? rows.reduce((a, r) => a + (r.passingCpoe != null ? r.passingCpoe * (r.attempts || 0) : 0), 0) / att : null;
    const ts = rows.filter(r => r.targetShare != null).map(r => r.targetShare);
    seasons.push({ season: String(y), team: rows[rows.length - 1].team, league: "NFL", games: rows.length, kind: "calculated", stats: Object.fromEntries(["completions", "attempts", "passingYards", "passingTds", "interceptions", "carries", "rushingYards", "rushingTds", "targets", "receptions", "receivingYards", "receivingTds", "fantasyPointsPpr"].map(k => [k, t[k]]).filter(([, v]) => v != null)),
      advanced: [adv("comp_pct", "", f.comp_pct, "calculated"), adv("ypa", "", f.ypa, "calculated"), adv("passer_rating", "", f.passer_rating, "calculated"), adv("anya", "", f.anya, "calculated"), adv("ypc", "", f.ypc, "calculated"), adv("catch_rate", "", f.catch_rate, "calculated"),
        adv("passingEpa", "Passing EPA (sum of weekly)", t.passingEpa != null ? calc.r(t.passingEpa, 1) : null, "provided", { note: "Weekly EPA published by nflverse, summed here" }),
        adv("rushingEpa", "Rushing EPA (sum of weekly)", t.rushingEpa != null ? calc.r(t.rushingEpa, 1) : null, "provided"), adv("receivingEpa", "Receiving EPA (sum of weekly)", t.receivingEpa != null ? calc.r(t.receivingEpa, 1) : null, "provided"),
        adv("cpoe", "CPOE (attempt-weighted mean of weekly values)", att && cpoeW != null ? calc.r(cpoeW, 2) : null, "calculated", { formula: "Σ(weekly CPOE × attempts) / Σ attempts", note: "Approximation of the season value" }),
        adv("targetShare", "Target share (mean of weekly)", ts.length ? calc.r(calc.mean(ts), 3) : null, "calculated", { formula: "mean of weekly target_share", note: "Unweighted mean of weekly values" })] });
  }
  if (!seasons.length) return null;
  return { id, name, pos, sport: "nfl", seasons, career: null, extraUnavailable: [unavailable("Snap counts / success rate / win probability", "Not computed in this version; they need play-by-play or snap-count files that are not downloaded."), unavailable("Fantasy points (standard)", "Only PPR fantasy points are summed")], meta: { ...INFO, fetchedAt: new Date().toISOString() } };
}
async function leaders() {
  const y = curYear(3), rows = (await season(y)).filter(r => r.stype === "REG"), by = new Map();
  for (const r of rows) { const o = by.get(r.id) || { id: r.id, name: r.name, team: r.team, t: {} }; NUM.forEach(k => { if (r[k] != null) o.t[k] = (o.t[k] || 0) + r[k]; }); o.team = r.team; by.set(r.id, o); }
  const top = (k, label) => ({ key: k, label: `${label} ${y}`, entries: [...by.values()].filter(o => o.t[k] > 0).sort((a, b) => b.t[k] - a.t[k]).slice(0, 10).map((o, i) => ({ rank: i + 1, id: o.id, name: o.name, team: o.team, value: calc.r(o.t[k], 1) })) });
  return { season: y, meta: { ...INFO, fetchedAt: new Date().toISOString() }, categories: [top("passingYards", "Passing yards"), top("rushingYards", "Rushing yards"), top("receivingYards", "Receiving yards"), top("passingTds", "Passing TDs"), top("passingEpa", "Passing EPA")] };
}
module.exports = { search, gamelog, profile, leaders, matchEntry, players, INFO };
