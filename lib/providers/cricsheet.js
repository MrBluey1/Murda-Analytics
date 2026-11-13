"use strict";
// Cricket via Cricsheet ball-by-ball JSON. Dataset-based: download a *_json.zip from cricsheet.org/downloads, UNZIP it into data/cricsheet/, then run: node scripts/import-datasets.js cricsheet
// License: Cricsheet data is CC BY 4.0-style open data with required attribution (see cricsheet.org). Cite "Cricsheet".
const fs = require("fs"), path = require("path"), { fold } = require("../http"), { finish } = require("./util"), calc = require("../calc");
const DIR = () => path.join(process.env.DATA_DIR || path.join(__dirname, "..", "..", "data"), "cricsheet"), IDX = () => path.join(DIR(), "index.json");
const INFO = { provider: "cricsheet", source: "cricsheet.org ball-by-ball JSON", license: "Cricsheet open data: attribution to Cricsheet required; see cricsheet.org/about" };
const NOT_BOWLER = new Set(["run out", "retired hurt", "retired out", "obstructing the field"]);
function parseMatch(m, file) {
  const info = m.info || {}, reg = info.registry?.people || {}, date = (info.dates || [])[0] || "", rows = new Map();
  const get = (name, team) => { const k = reg[name] || name; if (!rows.has(k)) rows.set(k, { id: k, name, team, bat: { runs: 0, balls: 0, fours: 0, sixes: 0, out: 0, faced: false }, bowl: { balls: 0, runs: 0, wickets: 0, bowled: false } }); return rows.get(k); };
  for (const inn of m.innings || []) {
    const bt = inn.team, bw = (info.teams || []).find(t => t !== bt) || "";
    for (const ov of inn.overs || []) for (const d of ov.deliveries || []) {
      const ex = d.extras || {}, legal = !ex.wides && !ex.noballs, b = get(d.batter, bt), bo = get(d.bowler, bw);
      b.bat.faced = true; if (!ex.wides) b.bat.balls++; b.bat.runs += d.runs?.batter || 0; if (d.runs?.batter === 4 && !(d.runs?.non_boundary)) b.bat.fours++; if (d.runs?.batter === 6) b.bat.sixes++;
      bo.bowl.bowled = true; if (legal) bo.bowl.balls++; bo.bowl.runs += (d.runs?.total || 0) - (ex.byes || 0) - (ex.legbyes || 0);
      for (const w of d.wickets || []) { get(w.player_out, bt).bat.out = 1; if (!NOT_BOWLER.has(w.kind)) bo.bowl.wickets++; }
    }
  }
  return [...rows.values()].map(r => ({ ...r, date, match: file, event: info.event?.name || info.match_type || "", opponent: "", gender: info.gender, type: info.match_type, outcome: info.outcome?.winner || info.outcome?.result || "" }));
}
function buildIndex(dir = DIR()) {
  const files = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f)), players = new Map();
  for (const f of files) {
    let m; try { m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    for (const r of parseMatch(m, f)) { const p = players.get(r.id) || { id: r.id, name: r.name, teams: new Set(), rows: [] }; p.teams.add(r.team); p.rows.push({ date: r.date, match: r.match, event: r.event, type: r.type, team: r.team, bat: r.bat.faced ? r.bat : null, bowl: r.bowl.bowled ? r.bowl : null }); players.set(r.id, p); }
  }
  const out = { builtAt: new Date().toISOString(), matches: files.length, players: [...players.values()].map(p => ({ id: p.id, name: p.name, teams: [...p.teams], rows: p.rows })) };
  fs.writeFileSync(IDX(), JSON.stringify(out)); return out;
}
let cache = null; const load = () => { if (cache) return cache; try { cache = JSON.parse(fs.readFileSync(IDX(), "utf8")); } catch { cache = null; } return cache; };
const available = () => !!load();
function search(q) { const ix = load(); if (!ix) return []; const toks = fold(q).split(" ").filter(Boolean);
  return ix.players.filter(p => toks.every(t => fold(p.name).includes(t))).slice(0, 25).map(p => ({ id: p.id, name: p.name, team: p.teams[0] || "", pos: "Player", league: "Cricket (Cricsheet)", photo: null })); }
function gamelog(id, q = {}) {
  const ix = load(), p = ix?.players.find(x => x.id === id); if (!p) return null;
  const games = p.rows.filter(r => !q.type || r.type === q.type).map(r => { const b = r.bat, w = r.bowl, st = {};
    if (b) { st.runs = b.runs; st.ballsFaced = b.balls; st.fours = b.fours; st.sixes = b.sixes; st.dismissed = b.out; if (b.balls) st.strikeRate = calc.r(b.runs / b.balls * 100, 1); }
    if (w) { st.wickets = w.wickets; st.runsConceded = w.runs; st.legalBalls = w.balls; if (w.balls) { st.overs = +(Math.floor(w.balls / 6) + (w.balls % 6) / 10).toFixed(1); st.economy = calc.r(w.runs / (w.balls / 6), 2); } }
    return { id: r.match, startTime: null, date: r.date, dateOnly: true, opponent: r.event, opponentId: "", opponentName: r.event, home: false, result: null, seasonType: r.type, stats: st, order: 0 }; });
  const bat = p.rows.filter(r => r.bat), tot = bat.reduce((a, r) => ({ runs: a.runs + r.bat.runs, balls: a.balls + r.bat.balls, outs: a.outs + r.bat.out }), { runs: 0, balls: 0, outs: 0 });
  return { ...finish(games), note: `Computed from Cricsheet ball-by-ball files (${ix.matches} matches indexed). Batting average = runs / dismissals${tot.outs ? ` (career in this dataset: ${calc.r(tot.runs / tot.outs, 2)})` : " (not defined with 0 dismissals)"}. Bowler runs exclude byes and leg-byes.` };
}
const get = id => { const p = load()?.players.find(x => x.id === id); return p ? { id: p.id, name: p.name, team: p.teams[0] || "", teams: p.teams } : null; };
module.exports = { buildIndex, search, gamelog, available, parseMatch, get, INFO };
