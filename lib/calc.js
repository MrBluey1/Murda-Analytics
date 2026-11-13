"use strict";
// Locally calculated statistics. Every function returns null (never a guess) when an input is missing.
// FORMULAS documents each one for the Sources & Methodology page. Provider-supplied figures (EPA, CPOE, OPS as returned by the MLB API, etc.) are NOT computed here.
const d = (a, b) => (a == null || b == null || !b) ? null : a / b;
const r = (v, p = 3) => v == null || !Number.isFinite(v) ? null : +v.toFixed(p);
const FORMULAS = {
  ts_pct: { sport: "basketball", label: "True Shooting %", formula: "PTS / (2 × (FGA + 0.44 × FTA))", needs: ["points", "fieldGoalsAttempted", "freeThrowsAttempted"] },
  efg_pct: { sport: "basketball", label: "Effective FG %", formula: "(FGM + 0.5 × 3PM) / FGA", needs: ["fieldGoalsMade", "threePointFieldGoalsMade", "fieldGoalsAttempted"] },
  ast_to: { sport: "basketball", label: "Assist/Turnover", formula: "AST / TO", needs: ["assists", "turnovers"] },
  per36: { sport: "basketball", label: "Per 36 minutes", formula: "stat / MIN × 36", needs: ["minutes"] },
  iso: { sport: "baseball", label: "Isolated power", formula: "SLG − AVG", needs: ["slg", "avg"] },
  k_pct: { sport: "baseball", label: "Strikeout rate", formula: "SO / PA", needs: ["strikeOuts", "plateAppearances"] },
  bb_pct: { sport: "baseball", label: "Walk rate", formula: "BB / PA", needs: ["baseOnBalls", "plateAppearances"] },
  k9: { sport: "baseball", label: "K/9", formula: "9 × SO / IP", needs: ["strikeOuts", "inningsPitched"] },
  bb9: { sport: "baseball", label: "BB/9", formula: "9 × BB / IP", needs: ["baseOnBalls", "inningsPitched"] },
  sh_pct: { sport: "hockey", label: "Shooting %", formula: "Goals / Shots", needs: ["goals", "shots"] },
  pts_pg: { sport: "hockey", label: "Points per game", formula: "Points / GP", needs: ["points", "gamesPlayed"] },
  comp_pct: { sport: "football", label: "Completion %", formula: "CMP / ATT", needs: ["completions", "attempts"] },
  ypa: { sport: "football", label: "Yards per attempt", formula: "Pass yards / ATT", needs: ["passingYards", "attempts"] },
  anya: { sport: "football", label: "Adjusted net yards/attempt", formula: "(Pass yds + 20×TD − 45×INT − sack yds) / (ATT + sacks)", needs: ["passingYards", "passingTds", "interceptions", "sackYards", "attempts", "sacks"] },
  passer_rating: { sport: "football", label: "NFL passer rating", formula: "Standard NFL formula: ((a+b+c+d)/6)×100 with each term clamped to 0–2.375", needs: ["completions", "attempts", "passingYards", "passingTds", "interceptions"] },
  ypc: { sport: "football", label: "Yards per carry", formula: "Rush yds / carries", needs: ["rushingYards", "carries"] },
  catch_rate: { sport: "football", label: "Catch rate", formula: "Receptions / targets", needs: ["receptions", "targets"] },
  per90: { sport: "soccer", label: "Per 90 minutes", formula: "stat / minutes × 90", needs: ["minutes"] },
  win_pct: { sport: "all", label: "Win %", formula: "wins / matches" },
  first_serve_pct: { sport: "tennis", label: "1st serve %", formula: "1stIn / serve points", needs: ["svpt", "firstIn"] },
  first_serve_won: { sport: "tennis", label: "1st serve points won %", formula: "1stWon / 1stIn", needs: ["firstWon", "firstIn"] },
  second_serve_won: { sport: "tennis", label: "2nd serve points won %", formula: "2ndWon / (serve points − 1stIn)", needs: ["secondWon", "svpt", "firstIn"] },
  bp_saved: { sport: "tennis", label: "Break points saved %", formula: "saved / faced", needs: ["bpSaved", "bpFaced"] },
  bp_converted: { sport: "tennis", label: "Break points converted %", formula: "(opp. BP faced − opp. BP saved) / opp. BP faced", needs: ["oppBpFaced", "oppBpSaved"] },
};
const basketball = t => ({
  ts_pct: r(d(t.points, t.fieldGoalsAttempted == null || t.freeThrowsAttempted == null ? null : 2 * (t.fieldGoalsAttempted + 0.44 * t.freeThrowsAttempted))),
  efg_pct: r(d(t.fieldGoalsMade == null || t.threePointFieldGoalsMade == null ? null : t.fieldGoalsMade + 0.5 * t.threePointFieldGoalsMade, t.fieldGoalsAttempted)),
  fg_pct: r(d(t.fieldGoalsMade, t.fieldGoalsAttempted)), tp_pct: r(d(t.threePointFieldGoalsMade, t.threePointFieldGoalsAttempted)), ft_pct: r(d(t.freeThrowsMade, t.freeThrowsAttempted)),
  ast_to: r(d(t.assists, t.turnovers), 2),
  pts_per36: t.minutes ? r(t.points / t.minutes * 36, 1) : null, reb_per36: t.minutes && t.totalRebounds != null ? r(t.totalRebounds / t.minutes * 36, 1) : null, ast_per36: t.minutes && t.assists != null ? r(t.assists / t.minutes * 36, 1) : null,
});
const hockey = t => ({ sh_pct: r(d(t.goals, t.shots)), pts_pg: r(d(t.points, t.gamesPlayed), 2), sv_pct: r(d(t.saves != null ? t.saves : (t.shotsAgainst != null && t.goalsAgainst != null ? t.shotsAgainst - t.goalsAgainst : null), t.shotsAgainst)) });
const baseball = t => {
  const o = {};
  if (t.plateAppearances) { o.k_pct = r(d(t.strikeOuts, t.plateAppearances)); o.bb_pct = r(d(t.baseOnBalls, t.plateAppearances)); }
  if (t.slg != null && t.avg != null) o.iso = r(t.slg - t.avg);
  if (t.inningsPitched) { o.k9 = r(d(t.strikeOuts == null ? null : 9 * t.strikeOuts, t.inningsPitched), 2); o.bb9 = r(d(t.baseOnBalls == null ? null : 9 * t.baseOnBalls, t.inningsPitched), 2); }
  return o;
};
const football = t => {
  const clamp = x => Math.max(0, Math.min(2.375, x)), a = t.attempts;
  const pr = a && [t.completions, t.passingYards, t.passingTds, t.interceptions].every(v => v != null)
    ? r((clamp((t.completions / a - 0.3) * 5) + clamp((t.passingYards / a - 3) * 0.25) + clamp(t.passingTds / a * 20) + clamp(2.375 - t.interceptions / a * 25)) / 6 * 100, 1) : null;
  const denom = a != null && t.sacks != null ? a + t.sacks : null;
  return { comp_pct: r(d(t.completions, a)), ypa: r(d(t.passingYards, a), 2), passer_rating: pr,
    anya: denom && [t.passingYards, t.passingTds, t.interceptions, t.sackYards].every(v => v != null) ? r((t.passingYards + 20 * t.passingTds - 45 * t.interceptions - t.sackYards) / denom, 2) : null,
    ypc: r(d(t.rushingYards, t.carries), 2), catch_rate: r(d(t.receptions, t.targets)) };
};
const per90 = (v, minutes) => v == null || !minutes ? null : r(v / minutes * 90, 2);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
module.exports = { FORMULAS, basketball, hockey, baseball, football, per90, mean, sd, r, d };
