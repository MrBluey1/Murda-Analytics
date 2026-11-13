"use strict";
// Stable internal ids and cross-provider matching. Two records are linked ONLY when the match is unambiguous and corroborated; names alone never merge athletes.
const { fold } = require("./http");
const murdaId = (sport, provider, id) => `murda:${sport}:${provider}:${id}`;
const sameDob = (a, b) => a && b && String(a).slice(0, 10) === String(b).slice(0, 10);
const TEAM_ALIAS = { WSH: "WAS", JAC: "JAX", LAR: "LA", LV: "LV", OAK: "LV", SD: "LAC", STL: "LA", ARZ: "ARI", BLT: "BAL", CLV: "CLE", HST: "HOU", SL: "LA" };
const teamKey = t => { const x = String(t || "").toUpperCase(); return TEAM_ALIAS[x] || x; };
// entry: {name, team, pos, dob}; candidates: [{id,name,team,pos,dob}] from another provider for the SAME sport.
function match(entry, candidates) {
  const byName = candidates.filter(c => fold(c.name) === fold(entry.name));
  if (!byName.length) return { match: null, reason: "no candidate with the same name" };
  if (byName.length === 1) { const c = byName[0], ok = (entry.dob && c.dob) ? sameDob(entry.dob, c.dob) : (teamKey(entry.team) === teamKey(c.team) || (entry.pos && c.pos && fold(entry.pos) === fold(c.pos)));
    return ok ? { match: c, basis: "name + corroborating team/position/dob" } : { match: null, reason: "single name match is not corroborated by team, position or birth date" }; }
  let pool = entry.dob ? byName.filter(c => sameDob(c.dob, entry.dob)) : byName;
  if (pool.length !== 1) pool = byName.filter(c => teamKey(c.team) === teamKey(entry.team));
  if (pool.length !== 1 && entry.pos) pool = pool.filter(c => fold(c.pos) === fold(entry.pos));
  return pool.length === 1 ? { match: pool[0], basis: "name + team/position/dob disambiguation" } : { match: null, reason: `${byName.length} athletes share this name and the other fields do not single one out` };
}
module.exports = { murdaId, match, teamKey };
