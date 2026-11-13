"use strict";
// football-data.org v4: standings + top scorers. Needs a FREE token (register at football-data.org, no card) in FOOTBALL_DATA_KEY. Optional: everything else works without it.
// Free plan covers a limited set of competitions (not assumed here) and 10 requests/minute.
const { getJSON, cachedFetch, num } = require("../http");
const INFO = { provider: "football-data", source: "api.football-data.org v4", license: "football-data.org free tier: attribution required, personal/non-commercial use, 10 req/min" };
const key = () => process.env.FOOTBALL_DATA_KEY || "";
const configured = () => !!key();
const COMP = { "Premier League": "PL", "La Liga": "PD", Bundesliga: "BL1", "Serie A": "SA", "Ligue 1": "FL1", "Champions League": "CL" };
const J = (p, ttl) => cachedFetch("fd:" + p, ttl, () => getJSON("https://api.football-data.org/v4" + p, { headers: { "X-Auth-Token": key() } }), INFO);
async function leaders(league = "Premier League") {
  if (!configured()) return { configured: false, categories: [], message: "Add a free FOOTBALL_DATA_KEY (football-data.org, no card) to load top scorers and tables." };
  const code = COMP[league]; if (!code) return { configured: true, categories: [], message: `${league} is not mapped to a football-data.org competition` };
  const { data, meta } = await J(`/competitions/${code}/scorers?limit=10`, 6 * 36e5);
  return { configured: true, meta, categories: [{ key: "goals", label: `Top scorers · ${league}`, entries: (data.scorers || []).map((s, i) => ({ rank: i + 1, id: String(s.player?.id), name: s.player?.name, team: s.team?.name, value: num(s.goals), extra: s.assists != null ? `${s.assists} assists` : "" })) }] };
}
async function standings(league = "Premier League") {
  if (!configured()) return { configured: false, rows: [] };
  const { data, meta } = await J(`/competitions/${COMP[league]}/standings`, 6 * 36e5);
  return { configured: true, meta, rows: (data.standings?.[0]?.table || []).map(t => ({ position: t.position, team: t.team?.name, played: t.playedGames, won: t.won, draw: t.draw, lost: t.lost, points: t.points, gf: t.goalsFor, ga: t.goalsAgainst, gd: t.goalDifference })) };
}
module.exports = { leaders, standings, configured, INFO };
