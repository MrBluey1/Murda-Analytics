
"use strict";

// Murda Analytics — Sports Data Collector
// Environment variables:
// OUT     = output directory (default: out)
// MODE    = "fast" or "full" (default: fast)
// TRACKED = tracked players configuration (default: tracked.json)

const fs = require("fs");
const path = require("path");
const api = require("./api");

const ROOT = __dirname;
const OUT = path.resolve(ROOT, process.env.OUT || "out");
const MODE = process.env.MODE || "fast";
const TRACKED = path.resolve(
  ROOT,
  process.env.TRACKED || "tracked.json"
);

const SCORE = [
  "nba", "wnba", "nfl", "ncaaf", "ncaab",
  "mlb", "nhl", "epl", "laliga", "mls", "ucl"
];

const STANDINGS = [...SCORE, "f1"];

const PLAYER_SPORTS = [
  "nba", "wnba", "nfl", "ncaaf",
  "ncaab", "mlb", "nhl"
];

const now = new Date().toISOString();

const norm = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

if (typeof api.handle !== "function") {
  throw new Error(
    'api.js must export a handle function using module.exports = { handle };'
  );
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readOutput(file) {
  return readJSON(path.join(OUT, file));
}

function writeJSON(file, data) {
  const destination = path.join(OUT, file);

  fs.mkdirSync(path.dirname(destination), {
    recursive: true
  });

  fs.writeFileSync(
    destination,
    JSON.stringify(data, null, 2)
  );
}

// Calls the same API handlers used by the application.
async function call(endpoint) {
  return new Promise((resolve) => {
    let settled = false;
    let statusCode = 200;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const res = {
      code: 200,

      writeHead(code) {
        statusCode = code;
        this.code = code;
      },

      end(body) {
        let parsed;

        try {
          if (Buffer.isBuffer(body)) {
            body = body.toString("utf8");
          }

          parsed =
            typeof body === "string"
              ? JSON.parse(body)
              : body;

          if (!parsed || typeof parsed !== "object") {
            throw new Error("Invalid API response");
          }
        } catch (error) {
          parsed = {
            ok: false,
            error: `Invalid JSON response: ${error.message}`
          };
        }

        finish({
          code: this.code || statusCode,
          body: parsed
        });
      }
    };

    try {
      Promise.resolve(
        api.handle(
          { method: "GET" },
          res,
          new URL(`http://localhost${endpoint}`)
        )
      ).catch((error) => {
        finish({
          code: 500,
          body: {
            ok: false,
            error: error.message || "API request failed"
          }
        });
      });
    } catch (error) {
      finish({
        code: 500,
        body: {
          ok: false,
          error: error.message || "API request failed"
        }
      });
    }
  });
}

// Preserve previous successful snapshots when a request fails.
const manifest = readOutput("manifest.json") || {
  datasets: {}
};

manifest.datasets ||= {};
manifest.generatedAt = now;
manifest.mode = MODE;

async function grab(name, endpoint, file) {
  const dataset =
    manifest.datasets[name] ||
    (manifest.datasets[name] = {});

  dataset.lastAttempt = now;

  const result = await call(endpoint);
  const body = result.body;

  if (body && body.ok) {
    writeJSON(file, body);

    dataset.updatedAt =
      body.meta?.fetchedAt || now;

    dataset.status =
      body.meta?.status || "success";

    delete dataset.error;

    return body;
  }

  dataset.error =
    body?.error || `HTTP ${result.code}`;

  console.error(
    `Failed: ${name} — ${dataset.error}`
  );

  return null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  console.log("Starting Murda Analytics collector...");
  console.log(`Mode: ${MODE}`);
  console.log(`Output: ${OUT}`);
  console.log(`Tracked config: ${TRACKED}`);

  // Collect scoreboards.
  let successfulScoreboards = 0;

  for (const sport of SCORE) {
    const result = await grab(
      `scoreboard/${sport}`,
      `/api/${sport}/scoreboard`,
      `scoreboard/${sport}.json`
    );

    if (result) successfulScoreboards++;
  }

  // Do not publish an entirely failed scoreboard collection.
  if (successfulScoreboards === 0) {
    throw new Error(
      "All scoreboard requests failed. Previous snapshots were preserved."
    );
  }

  // Full collection includes standings and tracked players.
  if (MODE === "full") {
    console.log("Collecting standings...");

    for (const sport of STANDINGS) {
      await grab(
        `standings/${sport}`,
        `/api/${sport}/standings`,
        `standings/${sport}.json`
      );
    }

    console.log("Collecting tracked players...");

    const tracked = readJSON(TRACKED) || {
      players: []
    };

    const indexes = {};

    for (const player of tracked.players || []) {
      const sport = player.sport;
      const name = player.name;

      if (!sport || !name) {
        console.warn("Skipping invalid tracked player:", player);
        continue;
      }

      if (!PLAYER_SPORTS.includes(sport)) {
        manifest.datasets[`players/${sport}/${name}`] = {
          error: "Sport has no player data source"
        };
        continue;
      }

      let id = player.id
        ? String(player.id)
        : null;

      let metadata = {
        name,
        team: "",
        pos: ""
      };

      const previousIndex =
        readOutput(`players/${sport}/index.json`);

      const previousPlayer =
        (previousIndex?.data?.players || []).find(
          (entry) => norm(entry.name) === norm(name)
        );

      // Resolve player ID if one was not provided.
      if (!id) {
        const search = await call(
          `/api/${sport}/players?q=${encodeURIComponent(name)}`
        );

        const players = search.body?.ok
          ? search.body.data?.players || []
          : [];

        const match =
          players.find(
            (entry) => norm(entry.name) === norm(name)
          ) ||
          (players.length === 1 ? players[0] : null);

        if (match) {
          id = String(match.id);
          metadata = match;
        } else if (previousPlayer) {
          // Keep the previous known ID if search temporarily fails.
          id = String(previousPlayer.id);
          metadata = previousPlayer;
        } else {
          manifest.datasets[`players/${sport}/${name}`] = {
            lastAttempt: now,
            error: search.body?.ok
              ? players.length
                ? `Ambiguous player match (${players.length} results). Add an ID to tracked.json.`
                : "No matching player found."
              : search.body?.error || "Player search failed."
          };

          continue;
        }
      } else if (previousPlayer) {
        metadata = previousPlayer;
      }

      // Collect the player's game log.
      await grab(
        `players/${sport}/${id}`,
        `/api/${sport}/players/${encodeURIComponent(id)}/gamelog`,
        `players/${sport}/${id}.json`
      );

      // Only index players with an existing snapshot.
      if (
        fs.existsSync(
          path.join(OUT, `players/${sport}/${id}.json`)
        )
      ) {
        indexes[sport] ||= new Map();

        indexes[sport].set(id, {
          id,
          name: metadata.name || name,
          team: metadata.team || "",
          pos: metadata.pos || ""
        });
      }
    }

    // Write player indexes.
    for (const sport of PLAYER_SPORTS) {
      writeJSON(
        `players/${sport}/index.json`,
        {
          ok: true,
          data: {
            players: [
              ...(indexes[sport]?.values() || [])
            ]
          },
          meta: {
            provider: "collector",
            status: "historical",
            fetchedAt: now,
            note: "Only players listed in tracked.json are collected."
          }
        }
      );
    }
  }

  // Save manifest.
  writeJSON("manifest.json", manifest);

  const errors = Object.entries(manifest.datasets)
    .filter(([, dataset]) => dataset.error);

  console.log("\nCollection complete.");
  console.log(
    `Mode: ${MODE} | Scoreboards: ${successfulScoreboards}/${SCORE.length} | Datasets: ${Object.keys(manifest.datasets).length} | Errors: ${errors.length}`
  );

  errors.slice(0, 15).forEach(([name, dataset]) => {
    console.log(`  ! ${name}: ${dataset.error}`);
  });
}

main().catch((error) => {
  console.error("Collector failed:", error);
  process.exitCode = 1;
});
