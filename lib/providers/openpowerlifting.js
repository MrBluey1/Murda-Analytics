"use strict";
// Powerlifting via OpenPowerlifting's open CSV export. Dataset-based: download openpowerlifting-latest.zip from openpowerlifting.gitlab.io/opl-csv/, UNZIP it, copy the CSV to data/openpowerlifting/openpowerlifting.csv, then run: node scripts/import-datasets.js openpowerlifting
// License: OpenPowerlifting data is public domain (CC0), attribution to OpenPowerlifting is appreciated. Dots/Wilks/Goodlift values are the ones PUBLISHED in the CSV (not recomputed here).
const fs = require("fs"), path = require("path"), readline = require("readline"), { parseCSV, num, fold } = require("../http"), { finish } = require("./util");
const DIR = () => path.join(process.env.DATA_DIR || path.join(__dirname, "..", "..", "data"), "openpowerlifting");
const INFO = { provider: "openpowerlifting", source: "openpowerlifting.org open CSV", license: "OpenPowerlifting data: public domain / CC0; credit OpenPowerlifting" };
async function buildIndex(csvPath = path.join(DIR(), "openpowerlifting.csv")) {
  const rl = readline.createInterface({ input: fs.createReadStream(csvPath), crlfDelay: Infinity }); let head = null; const by = new Map(); let n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue; const cells = parseCSV(line)[0]; if (!head) { head = cells; continue; }
    const o = {}; head.forEach((k, i) => o[k] = cells[i]); if (!o.Name) continue;
    const key = o.Name + "|" + (o.Sex || ""); const a = by.get(key) || { id: Buffer.from(key).toString("base64url"), name: o.Name, sex: o.Sex, country: o.Country, meets: [] };
    a.meets.push({ date: o.Date, meet: o.MeetName, fed: o.Federation, country: o.MeetCountry, equipment: o.Equipment, event: o.Event, bw: num(o.BodyweightKg), wc: o.WeightClassKg, squat: num(o.Best3SquatKg), bench: num(o.Best3BenchKg), deadlift: num(o.Best3DeadliftKg), total: num(o.TotalKg), place: o.Place, dots: num(o.Dots), wilks: num(o.Wilks), goodlift: num(o.Goodlift), tested: o.Tested });
    by.set(key, a); n++;
  }
  const out = { builtAt: new Date().toISOString(), rows: n, athletes: [...by.values()] }; fs.writeFileSync(path.join(DIR(), "index.json"), JSON.stringify(out)); return out;
}
let cache = null; const load = () => { if (cache) return cache; try { cache = JSON.parse(fs.readFileSync(path.join(DIR(), "index.json"), "utf8")); } catch { cache = null; } return cache; };
const available = () => !!load();
function search(q) { const ix = load(); if (!ix) return []; const toks = fold(q).split(" ").filter(Boolean);
  return ix.athletes.filter(a => toks.every(t => fold(a.name).includes(t))).slice(0, 25).map(a => ({ id: a.id, name: a.name, team: a.country || "", pos: a.sex === "F" ? "Female lifter" : "Lifter", league: "Powerlifting (OpenPowerlifting)", photo: null })); }
function gamelog(id) {
  const a = load()?.athletes.find(x => x.id === id); if (!a) return null;
  const games = a.meets.filter(m => m.total != null || m.squat != null || m.bench != null || m.deadlift != null).map(m => ({ id: `${m.date}-${m.meet}`, startTime: null, date: m.date, dateOnly: true, opponent: m.meet, opponentId: "", opponentName: m.meet, home: false, result: m.place, seasonType: m.event, competition: `${m.fed} · ${m.equipment}`,
    stats: Object.fromEntries(Object.entries({ squat: m.squat, bench: m.bench, deadlift: m.deadlift, total: m.total, bodyweight: m.bw, dots: m.dots, wilks: m.wilks, goodlift: m.goodlift }).filter(([, v]) => v != null)) }));
  const best = k => Math.max(...games.map(g => g.stats[k] ?? -Infinity)), pb = {}; ["squat", "bench", "deadlift", "total"].forEach(k => { const v = best(k); if (Number.isFinite(v)) pb[k] = v; });
  return { ...finish(games), personalBests: pb, note: "Meet results from the OpenPowerlifting export. Dots, Wilks and Goodlift are the values published in that dataset (not recomputed). Personal bests are the maximum across listed meets (all equipment/divisions mixed)." };
}
const get = id => { const a = load()?.athletes.find(x => x.id === id); return a ? { id: a.id, name: a.name, team: a.country || "", sex: a.sex, meets: a.meets.length } : null; };
module.exports = { buildIndex, search, gamelog, available, get, INFO };
