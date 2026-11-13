"use strict";
// TheSportsDB free V1 API (public key "3"). Free tier: ~30 requests/min, small result sets, profile info + images only (no statistics). Premium V2 endpoints are never used.
const { getJSON, cachedFetch, fold } = require("../http");
const BASE = "https://www.thesportsdb.com/api/v1/json/3", INFO = { provider: "thesportsdb", source: "thesportsdb.com API v1 (free key)", license: "TheSportsDB community data; free-tier use with attribution (thesportsdb.com). Images are user-contributed." };
const SPORTS = { Soccer: "soccer", Basketball: "basketball", "American Football": "american-football", Baseball: "baseball", "Ice Hockey": "hockey", Golf: "golf", Rugby: "rugby", Cricket: "cricket", Tennis: "tennis", Motorsport: "motorsport", Darts: "darts", Snooker: "snooker", Boxing: "boxing", Fighting: "mma", Cycling: "cycling", Athletics: "athletics", Volleyball: "volleyball", Handball: "handball", Australian_Football: "afl", Lacrosse: "lacrosse" };
const norm = p => ({ id: p.idPlayer, name: p.strPlayer, team: p.strTeam || "", pos: p.strPosition || "", sportLabel: p.strSport, sport: /rugby/i.test(p.strSport || "") ? "rugby" : /^golf$/i.test(p.strSport || "") ? "golf" : (SPORTS[p.strSport] || "other"), league: "", photo: p.strCutout || p.strThumb || p.strRender || null, dob: p.dateBorn && p.dateBorn !== "0000-00-00" ? p.dateBorn : null, country: p.strNationality || "", info: true });
async function search(q) { const { data } = await cachedFetch(`tsdb:search:${fold(q)}`, 7 * 864e5, async () => (await getJSON(`${BASE}/searchplayers.php?p=${encodeURIComponent(q)}`)).player || [], INFO); return data.map(norm); }
async function profile(id) {
  const { data, meta } = await cachedFetch(`tsdb:player:${id}`, 7 * 864e5, async () => ((await getJSON(`${BASE}/lookupplayer.php?id=${encodeURIComponent(id)}`)).players || [])[0] || null, INFO); if (!data) return null;
  return { ...norm(data), bio: { born: data.dateBorn, birthLocation: data.strBirthLocation, height: data.strHeight, weight: data.strWeight, signed: data.dateSigned, status: data.strStatus, description: (data.strDescriptionEN || "").slice(0, 900) || null }, seasons: [], statsAvailable: false, meta };
}
module.exports = { search, profile, INFO, SPORTS };
