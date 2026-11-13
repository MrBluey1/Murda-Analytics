"use strict";
// One-time dataset importers.  node scripts/import-datasets.js cricsheet        (after unzipping a Cricsheet *_json.zip into data/cricsheet/)
//                              node scripts/import-datasets.js openpowerlifting (after placing the CSV at data/openpowerlifting/openpowerlifting.csv)
const which = process.argv[2];
(async () => {
  if (which === "cricsheet") { const o = require("../lib/providers/cricsheet").buildIndex(); console.log(`Cricsheet index built: ${o.matches} matches, ${o.players.length} players`); }
  else if (which === "openpowerlifting") { const o = await require("../lib/providers/openpowerlifting").buildIndex(); console.log(`OpenPowerlifting index built: ${o.rows} rows, ${o.athletes.length} athletes`); }
  else { console.log("Usage: node scripts/import-datasets.js cricsheet|openpowerlifting"); process.exit(1); }
})().catch(e => { console.error("Import failed:", e.message); process.exit(1); });
