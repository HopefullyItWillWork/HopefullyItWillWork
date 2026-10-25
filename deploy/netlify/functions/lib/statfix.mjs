/* Commissioner corrections to a night's box scores.

   The feed re-reads the last six nights every run and rewrites a night whenever
   ESPN's copy changed, so a correction written into `daily-YYYY-MM-DD` itself
   would be overwritten. Corrections are therefore kept apart, in the `statfix`
   blob, and laid over the stored night every time scoring or the rolling stats
   read it. Nothing the feed stores is ever edited.

     statfix = { rev, data: { days: { 'YYYY-MM-DD': [ { n, t?, s:{…}, del?, by, at } ] } } }

   `n` is the player's name (matched through nameKey, like everywhere else), `s`
   holds only the stat keys being corrected, `del` removes his line for the night
   (he did not play), and `t` (an NBA club code) is needed only to add a line for a
   man ESPN has no row for, so scoring knows whose tip-off it was. Pure and
   import-light: testable with no Netlify runtime. */

import { nameKey } from "./nba.mjs";

export const STATKEYS = ["MP", "FG", "FGA", "FT", "FTA", "P3", "TRB", "AST", "STL", "BLK", "TOV", "PTS"];

/* One correction, cleaned; or { error }. */
export function cleanFix(f) {
  const n = String((f && f.n) || "").trim().slice(0, 80);
  if (!nameKey(n)) return { error: "a player name is required" };
  if (f.del) return { fix: { n, del: true } };
  const s = {};
  for (const k of STATKEYS) {
    const v = f.s && f.s[k];
    if (v == null || v === "") continue;
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0 || x > 200) return { error: `${k} must be a number from 0 to 200` };
    s[k] = Math.round(x * 100) / 100;
  }
  if (!Object.keys(s).length) return { error: "change at least one stat" };
  const t = String((f && f.t) || "").trim().toUpperCase().slice(0, 4);
  return { fix: { n, ...(t ? { t } : {}), s } };
}

/* A night with its corrections applied; the stored record is not touched. */
export function applyFixes(night, fixes) {
  if (!night || !fixes || !fixes.length) return night;
  const players = { ...(night.players || {}) };
  for (const f of fixes) {
    const key = nameKey(f.n);
    const id = Object.keys(players).find((i) => nameKey(players[i].n) === key);
    if (f.del) { if (id) delete players[id]; continue; }
    if (id) players[id] = { ...players[id], s: { ...players[id].s, ...f.s }, fixed: true };
    else if (f.t) players["fix-" + key] = { n: f.n, t: f.t, s: { ...f.s }, fixed: true };
  }
  return { ...night, players };
}

export const fixesOn = (data, day) => ((data && data.days && data.days[day]) || []);
