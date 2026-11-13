"use strict";
const finish = games => {
  games.sort((a, b) => String(a.startTime || a.date || "").localeCompare(String(b.startTime || b.date || "")) || (a.order || 0) - (b.order || 0));
  const keys = new Set(); games.forEach(g => Object.entries(g.stats).forEach(([k, v]) => typeof v === "number" && keys.add(k)));
  return { games, statKeys: [...keys], derived: [] };
};
const curYear = (startMonth = 1) => { const d = new Date(); return d.getMonth() + 1 >= startMonth ? d.getFullYear() : d.getFullYear() - 1; };
module.exports = { finish, curYear };
const { FORMULAS } = require("../calc");
// kind: "official" (value as published by the provider) | "provided" (provider-computed model value, e.g. EPA) | "calculated" (computed locally from raw data)
const adv = (key, label, value, kind, extra = {}) => value == null ? { key, label, value: null, kind: "unavailable", reason: extra.reason || "Required inputs not provided by the data source" } : { key, label: (FORMULAS[key] && FORMULAS[key].label) || label, value, kind, formula: extra.formula || (FORMULAS[key] && FORMULAS[key].formula) || null, note: extra.note || null };
const unavailable = (label, reason) => ({ key: label, label, value: null, kind: "unavailable", reason });
module.exports.adv = adv; module.exports.unavailable = unavailable;
