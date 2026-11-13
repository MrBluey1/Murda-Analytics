"use strict";
// Shared HTTP layer for the provider adapters: per-host throttling + hourly budget, retries with exponential backoff
// (honours 429 Retry-After), in-flight de-duplication, and a disk cache with provenance + stale-if-error.
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const CACHE = () => process.env.CACHE_DIR || path.join(__dirname, "..", ".cache");
const LIMITS = { "api.jolpi.ca": { gap: 260, perHour: 480 }, "www.thesportsdb.com": { gap: 2100, perHour: 1700 }, "api.football-data.org": { gap: 6200, perHour: 500 }, default: { gap: 250 } };
const hosts = new Map(), mem = new Map(), inflight = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function throttle(host) {
  const L = LIMITS[host] || LIMITS.default, h = hosts.get(host) || hosts.set(host, { next: 0, start: Date.now(), n: 0 }).get(host), now = Date.now();
  if (now - h.start > 36e5) { h.start = now; h.n = 0; }
  if (L.perHour && h.n >= L.perHour) { const e = new Error(`Local hourly request budget for ${host} reached (${L.perHour}/h); cached data is still served`); e.code = "BUDGET"; throw e; }
  const wait = Math.max(0, h.next - now); h.next = Math.max(now, h.next) + L.gap; h.n++; if (wait) await sleep(wait);
}
async function fetchRaw(url, { headers = {}, retries = 3, timeout = 30000 } = {}) {
  const u = new URL(url); let attempt = 0;
  for (;;) {
    await throttle(u.host);
    const target = process.env.MOCK_BASE ? `${process.env.MOCK_BASE}/${u.host}${u.pathname}${u.search}` : url;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(target, { headers: { "user-agent": "murda-analytics-personal/1.0", ...headers }, signal: ctl.signal, redirect: "follow" });
      if (r.status === 429 || r.status >= 500) {
        if (attempt < retries) { const ra = Number(r.headers.get("retry-after")); await sleep(ra > 0 ? Math.min(ra, 60) * 1000 : Math.pow(2, attempt) * 400); attempt++; continue; }
        throw new Error(`${u.host} HTTP ${r.status}`);
      }
      if (!r.ok) { const e = new Error(`${u.host} HTTP ${r.status}`); e.status = r.status; throw e; }
      return r;
    } catch (e) { if (e.name === "AbortError" && attempt < retries) { attempt++; continue; } throw e; } finally { clearTimeout(t); }
  }
}
const getJSON = async (url, o) => (await fetchRaw(url, o)).json();
const getText = async (url, o) => (await fetchRaw(url, o)).text();
// cachedFetch: returns { data, meta:{provider,source,license,fetchedAt,cache} }. ttl in ms.
async function cachedFetch(key, ttl, loader, info = {}) {
  const f = path.join(CACHE(), "p-" + crypto.createHash("sha1").update(key).digest("hex") + ".json");
  let e = mem.get(key); if (!e) { try { e = JSON.parse(fs.readFileSync(f, "utf8")); mem.set(key, e); } catch {} }
  if (e && Date.now() - e.at < ttl) return { data: e.data, meta: { ...e.meta, cache: "hit" } };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const data = await loader(), at = Date.now(), meta = { ...info, fetchedAt: new Date(at).toISOString() }, rec = { at, data, meta };
      mem.set(key, rec); try { fs.mkdirSync(CACHE(), { recursive: true }); fs.writeFileSync(f, JSON.stringify(rec)); touch(info.provider, meta); } catch {}
      return { data, meta: { ...meta, cache: "miss" } };
    } catch (err) { if (e) return { data: e.data, meta: { ...e.meta, cache: "stale", upstreamError: err.message } }; throw err; }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, p); return p;
}
function touch(provider, meta) {
  if (!provider) return; const pf = path.join(CACHE(), "provenance.json"); let o = {}; try { o = JSON.parse(fs.readFileSync(pf, "utf8")); } catch {}
  o[provider] = { lastFetched: meta.fetchedAt, source: meta.source, license: meta.license, fetches: (o[provider]?.fetches || 0) + 1 }; try { fs.writeFileSync(pf, JSON.stringify(o)); } catch {}
}
function provenance() { try { return JSON.parse(fs.readFileSync(path.join(CACHE(), "provenance.json"), "utf8")); } catch { return {}; } }
function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function csvObjects(text) { const r = parseCSV(text), h = r.shift() || []; return r.map(x => { const o = {}; h.forEach((k, i) => o[k] = x[i]); return o; }); }
const num = v => { if (v == null || v === "" || v === "NA") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const fold = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").replace(/[łŁ]/g, "l").replace(/[øØ]/g, "o").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
module.exports = { provenance, fetchRaw, getJSON, getText, cachedFetch, parseCSV, csvObjects, num, fold, sleep, CACHE };
