"use strict";
// Local model estimate for a player's next result in one stat. This is a transparent weighted-average model, NOT a forecast guarantee.
// estimate = 0.40×avg(last 5) + 0.35×avg(last 10) + 0.25×avg(all games in the data)  (weights renormalised when fewer games exist)
// range = estimate ± 1 sample standard deviation (about 68% of past results if roughly bell-shaped)
// pOver = share of the last 20 results above the threshold ("empirical") and a normal-curve estimate from (estimate, sd)
// opponent adjustment (optional): estimate × (1 + w×(H2H avg / baseline avg − 1)), w = n/(n+5) so small samples barely move it
// venue adjustment (optional): estimate × (1 + 0.5×(venue avg / overall avg − 1)) when both venue splits have ≥5 games
const { mean, sd, r } = require("./calc");
const phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), p = 0.3989423 * Math.exp(-z * z / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
function estimate(vals, { threshold = null, h2h = null, home = null, homeVals = [], awayVals = [] } = {}) {
  const n = vals.length; if (n < 5) return { available: false, reason: `Needs at least 5 games; only ${n} found.` };
  const parts = [[0.4, vals.slice(-5)], [0.35, vals.slice(-10)], [0.25, vals]], wsum = parts.reduce((s, p) => s + p[0], 0);
  let est = parts.reduce((s, [w, a]) => s + w * mean(a), 0) / wsum; const base = est, notes = [];
  if (h2h && h2h.n >= 1 && h2h.baseline > 0) { const w = h2h.n / (h2h.n + 5); est *= 1 + w * (h2h.avg / h2h.baseline - 1); notes.push(`opponent-adjusted using ${h2h.n} previous meeting(s)`); }
  const side = home == null ? null : home ? homeVals : awayVals;
  if (side && homeVals.length >= 5 && awayVals.length >= 5 && mean(vals) > 0) { est *= 1 + 0.5 * (mean(side) / mean(vals) - 1); notes.push(`${home ? "home" : "away"} split applied`); }
  const s = sd(vals), last20 = vals.slice(-20);
  const out = { available: true, kind: "model estimate", samples: n, estimate: r(est, 2), baseEstimate: r(base, 2), low: s == null ? null : r(est - s, 2), high: s == null ? null : r(est + s, 2), stdDev: r(s, 2),
    consistency: s == null || !mean(vals) ? null : r(Math.max(0, 1 - s / Math.abs(mean(vals))), 2), adjustments: notes,
    method: "Weighted recent average (40% last 5, 35% last 10, 25% all games). Not a guarantee of any outcome." };
  if (threshold != null) { out.threshold = threshold; out.pOverEmpirical = r(last20.filter(v => v > threshold).length / last20.length, 2); out.pOverNormal = s ? r(1 - phi((threshold - est) / s), 2) : null; }
  return out;
}
module.exports = { estimate };
