"use strict";
// Tennis via Jeff Sackmann's open datasets (tennis_atp / tennis_wta). License: CC BY-NC-SA 4.0 -> non-commercial, attribution, share-alike.
const { getText, cachedFetch, csvObjects, num, fold } = require("../http"), { finish, curYear } = require("./util"), calc = require("../calc");
const RAW = "https://raw.githubusercontent.com/JeffSackmann", TOURS = { atp: "tennis_atp", wta: "tennis_wta" };
const INFO = { provider: "sackmann", source: "github.com/JeffSackmann/tennis_atp, tennis_wta", license: "CC BY-NC-SA 4.0 (Jeff Sackmann / Tennis Abstract): attribution required, non-commercial use only, share-alike" };
const players = tour => cachedFetch(`sack:players:${tour}`, 7 * 864e5, async () => csvObjects(await getText(`${RAW}/${TOURS[tour]}/master/${tour}_players.csv`)).map(p => ({ id: `${tour}_${p.player_id}`, name: `${p.name_first || ""} ${p.name_last || ""}`.trim(), country: p.ioc, hand: p.hand, dob: p.dob && p.dob.length === 8 ? `${p.dob.slice(0, 4)}-${p.dob.slice(4, 6)}-${p.dob.slice(6)}` : null, height: num(p.height) })), INFO);
async function matches(tour, year) {
  const cur = year >= curYear();
  try { return (await cachedFetch(`sack:matches:${tour}:${year}`, cur ? 12 * 36e5 : 365 * 864e5, async () => csvObjects(await getText(`${RAW}/${TOURS[tour]}/master/${tour}_matches_${year}.csv`)), INFO)).data; }
  catch (e) { if (e.status === 404) return []; throw e; }
}
const dateOf = s => s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : "";
async function search(q, tour) {
  const fq = fold(q), toks = fq.split(" ").filter(Boolean), out = [], tours = tour ? [tour] : ["atp", "wta"];
  for (const t of tours) {
    const pl = (await players(t)).data, y = curYear(), recent = new Set();
    for (const yy of [y, y - 1]) (await matches(t, yy)).forEach(m => { recent.add(m.winner_id); recent.add(m.loser_id); });
    for (const p of pl) { const f = fold(p.name); if (toks.length && toks.every(x => f.includes(x))) out.push({ id: p.id, name: p.name, team: p.country || "", pos: "Player", league: t.toUpperCase(), photo: null, dob: p.dob, current: recent.has(p.id.split("_")[1]) }); }
  }
  return out.sort((a, b) => (b.current - a.current) || a.name.localeCompare(b.name)).slice(0, 25);
}
function perMatch(pid, m) {
  const win = m.winner_id === pid, p = win ? "w" : "l", o = win ? "l" : "w", g = k => num(m[`${p}_${k}`]), go = k => num(m[`${o}_${k}`]);
  const svpt = g("svpt"), in1 = g("1stIn"), st = {
    win: win ? 1 : 0, aces: g("ace"), doubleFaults: g("df"), servePoints: svpt, firstServeIn: in1, firstServeWon: g("1stWon"), secondServeWon: g("2ndWon"), bpSaved: g("bpSaved"), bpFaced: g("bpFaced"),
    oppBpFaced: go("bpFaced"), oppBpSaved: go("bpSaved"), minutes: num(m.minutes), ownRank: num(m[win ? "winner_rank" : "loser_rank"]), opponentRank: num(m[win ? "loser_rank" : "winner_rank"]) };
  st.firstServePct = calc.r(calc.d(in1, svpt) * 100, 1); st.firstServeWonPct = calc.r(calc.d(st.firstServeWon, in1) * 100, 1);
  st.secondServeWonPct = calc.r(calc.d(st.secondServeWon, svpt != null && in1 != null ? svpt - in1 : null) * 100, 1);
  return { st, win };
}
async function gamelog(id, q = {}) {
  const [tour, pid] = id.split("_"), season = +q.season || curYear(), games = [];
  for (const m of await matches(tour, season)) {
    if (m.winner_id !== pid && m.loser_id !== pid) continue;
    const { st, win } = perMatch(pid, m), opp = win ? "loser" : "winner";
    games.push({ id: `${m.tourney_id}-${m.match_num}`, startTime: null, date: dateOf(m.tourney_date), dateOnly: true, opponent: m[`${opp}_name`], opponentId: `${tour}_${m[`${opp}_id`]}`, opponentName: m[`${opp}_name`], home: false, result: win ? "W" : "L", seasonType: m.tourney_name, competition: `${m.surface || "?"} · ${m.round}`, surface: m.surface, stats: st, order: num(m.match_num) || 0 });
  }
  return { ...finish(games), season, note: `Match rows from Jeff Sackmann's ${tour.toUpperCase()} data for ${season}. Dates are the tournament START date (the dataset has no per-match date). Serve percentages are calculated from the raw counts; missing counts stay unavailable.` };
}
function aggregate(games) {
  const s = {}, add = k => games.reduce((a, g) => g.stats[k] == null ? a : a + g.stats[k], 0), has = k => games.some(g => g.stats[k] != null);
  s.matches = games.length; s.wins = games.filter(g => g.stats.win === 1).length; s.winPct = calc.r(calc.d(s.wins, s.matches) * 100, 1);
  for (const k of ["aces", "doubleFaults"]) if (has(k)) s[k + "PerMatch"] = calc.r(add(k) / games.filter(g => g.stats[k] != null).length, 2);
  const withServe = games.filter(g => g.stats.servePoints > 0), sv = k => withServe.reduce((a, g) => a + (g.stats[k] || 0), 0);
  if (withServe.length) { s.firstServePct = calc.r(sv("firstServeIn") / sv("servePoints") * 100, 1); s.firstServeWonPct = calc.r(sv("firstServeWon") / sv("firstServeIn") * 100, 1); s.secondServeWonPct = calc.r(sv("secondServeWon") / (sv("servePoints") - sv("firstServeIn")) * 100, 1); }
  const bf = sv("bpFaced"); if (withServe.length && bf > 0) s.bpSavedPct = calc.r(sv("bpSaved") / bf * 100, 1);
  const ob = sv("oppBpFaced"); if (withServe.length && ob > 0) s.bpConvertedPct = calc.r((ob - sv("oppBpSaved")) / ob * 100, 1);
  s.surface = {}; for (const su of [...new Set(games.map(g => g.surface).filter(Boolean))]) { const gs = games.filter(g => g.surface === su); s.surface[su] = { matches: gs.length, winPct: calc.r(gs.filter(g => g.stats.win).length / gs.length * 100, 1) }; }
  return s;
}
async function profile(id, q = {}) {
  const [tour, pid] = id.split("_"), p = (await players(tour)).data.find(x => x.id === id); if (!p) return null;
  const n = Math.min(+q.seasons || 8, 25), y = curYear(), seasons = [];
  for (let yy = y; yy > y - n; yy--) { const g = (await gamelog(id, { season: yy })).games; if (g.length) seasons.push({ season: String(yy), team: p.country, league: tour.toUpperCase(), stats: aggregate(g), kind: "calculated" }); }
  return { id, name: p.name, dob: p.dob, country: p.country, hand: p.hand, height: p.height, sport: "tennis", seasons, career: null, careerNote: `Season rows cover the last ${n} season(s) only; a full career table would need every year downloaded.`, meta: { ...INFO, fetchedAt: new Date().toISOString() } };
}
async function h2h(id, oppId, q = {}) {
  const [tour, pid] = id.split("_"), n = Math.min(+q.seasons || 10, 25), y = curYear(), games = [];
  for (let yy = y; yy > y - n; yy--) games.push(...(await gamelog(id, { season: yy })).games.filter(g => g.opponentId === oppId));
  games.sort((a, b) => a.date.localeCompare(b.date));
  const wins = games.filter(g => g.stats.win).length, by = {}; games.forEach(g => { const k = g.surface || "?"; by[k] = by[k] || { w: 0, l: 0 }; g.stats.win ? by[k].w++ : by[k].l++; });
  return { count: games.length, wins, losses: games.length - wins, bySurface: by, games, seasonsChecked: n, note: "Meetings from the last " + n + " seasons of Sackmann's data; dates are tournament start dates." };
}
async function leaders(tour = "atp") {
  const y = curYear(), ms = await matches(tour, y), wins = {}, names = {};
  ms.forEach(m => { wins[m.winner_id] = (wins[m.winner_id] || 0) + 1; names[m.winner_id] = m.winner_name; });
  const aces = {}; ms.forEach(m => { const a = num(m.w_ace), b = num(m.l_ace); if (a != null) aces[m.winner_id] = (aces[m.winner_id] || 0) + a; if (b != null) { aces[m.loser_id] = (aces[m.loser_id] || 0) + b; names[m.loser_id] = m.loser_name; } });
  const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v], i) => ({ rank: i + 1, id: `${tour}_${id}`, name: names[id] || id, team: "", value: v }));
  return { season: y, meta: { ...INFO, fetchedAt: new Date().toISOString() }, categories: [{ key: "wins", label: `${tour.toUpperCase()} match wins ${y} (in dataset)`, entries: top(wins) }, { key: "aces", label: `Aces ${y} (matches with serve stats)`, entries: top(aces) }] };
}
module.exports = { search, gamelog, profile, h2h, leaders, aggregate, INFO };
