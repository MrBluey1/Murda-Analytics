"use strict";
// Collects snapshots by calling the SAME api.js handlers the local server uses, and writes the JSON envelopes to files.
// Env: OUT (output dir), MODE ("fast" = scoreboards only, "full" = + standings + tracked players), TRACKED (config path).
const fs = require("fs"), path = require("path"), api = require("../api");
const OUT = process.env.OUT || "data-out", MODE = process.env.MODE || "fast";
const TRACKED = process.env.TRACKED || path.join(__dirname, "../config/tracked.json");
const SCORE = ["nba", "wnba", "nfl", "ncaaf", "ncaab", "mlb", "nhl", "epl", "laliga", "mls", "ucl"];
const STANDINGS = [...SCORE, "f1"], PLAYER_SPORTS = ["nba", "wnba", "nfl", "ncaaf", "ncaab", "mlb", "nhl"];
const now = new Date().toISOString(), norm = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const rd = f => readJ(path.join(OUT, f));
const wr = (f, o) => { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };
function call(p) {
  return new Promise(resolve => {
    const res = { code: 200, writeHead(c) { this.code = c; }, end(b) { let j; try { j = JSON.parse(b); } catch { j = { ok: false, error: "bad json from api" }; } resolve({ code: this.code, body: j }); } };
    api.handle({ method: "GET" }, res, new URL("http://local" + p)).catch(e => resolve({ code: 500, body: { ok: false, error: e.message } }));
  });
}
const man = rd("manifest.json") || { datasets: {} };
man.generatedAt = now; man.mode = MODE;
// Never overwrite a good file with an error: on failure keep the previous snapshot and record the error.
async function grab(name, p, file) {
  const ds = man.datasets[name] = man.datasets[name] || {};
  ds.lastAttempt = now;
  const r = await call(p);
  if (r.body.ok) { wr(file, r.body); ds.updatedAt = r.body.meta.fetchedAt; ds.status = r.body.meta.status; delete ds.error; return r.body; }
  ds.error = r.body.error || `HTTP ${r.code}`; return null;
}
(async () => {
  let okScores = 0;
  for (const k of SCORE) if (await grab(`scoreboard/${k}`, `/api/${k}/scoreboard`, `scoreboard/${k}.json`)) okScores++;
  if (!okScores) { console.error("All scoreboard requests failed; not publishing."); process.exit(1); }
  if (MODE === "full") {
    for (const k of STANDINGS) await grab(`standings/${k}`, `/api/${k}/standings`, `standings/${k}.json`);
    const tracked = readJ(TRACKED) || { players: [] }, idx = {};
    for (const t of tracked.players || []) {
      const L = t.sport; if (!PLAYER_SPORTS.includes(L)) { man.datasets[`players/${L}/${t.name}`] = { error: "sport has no player data source" }; continue; }
      let id = t.id && String(t.id), meta = { name: t.name, team: "", pos: "" };
      const prev = (rd(`players/${L}/index.json`)?.data?.players || []).find(p => norm(p.name) === norm(t.name));
      if (!id) {
        const s = await call(`/api/${L}/players?q=${encodeURIComponent(t.name)}`);
        const list = s.body.ok ? s.body.data.players : [];
        const pick = list.find(p => norm(p.name) === norm(t.name)) || (list.length === 1 ? list[0] : null);
        if (pick) { id = pick.id; meta = pick; }
        else if (prev) { id = prev.id; meta = prev; }   // transient search failure: keep known id
        else { man.datasets[`players/${L}/${t.name}`] = { lastAttempt: now, error: s.body.ok ? (list.length ? `ambiguous (${list.length} matches); add "id" to config` : "no match found") : s.body.error }; continue; }
      } else if (prev) meta = prev;
      await grab(`players/${L}/${id}`, `/api/${L}/players/${id}/gamelog`, `players/${L}/${id}.json`);
      if (fs.existsSync(path.join(OUT, `players/${L}/${id}.json`))) (idx[L] = idx[L] || new Map()).set(id, { id, name: meta.name, team: meta.team || "", pos: meta.pos || "" });
    }
    for (const L of PLAYER_SPORTS) wr(`players/${L}/index.json`, { ok: true, data: { players: [...(idx[L]?.values() || [])] }, meta: { provider: "collector", status: "historical", fetchedAt: now, note: "Only players listed in config/tracked.json are collected" } });
  }
  wr("manifest.json", man);
  const errs = Object.entries(man.datasets).filter(([, d]) => d.error);
  console.log(`mode=${MODE} scoreboards ok=${okScores}/${SCORE.length} datasets=${Object.keys(man.datasets).length} errors=${errs.length}`);
  errs.slice(0, 15).forEach(([n, d]) => console.log("  !", n, "-", d.error));
})();
