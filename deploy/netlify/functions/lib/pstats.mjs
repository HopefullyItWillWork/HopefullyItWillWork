/* Rolling player stats: 7, 15 and 30 days, and the season so far.

   Pure — imports only lib/nba.mjs for nameKey — so it is testable with inline
   data (tests/pstats.test.js). lib/scorerun.mjs runPstats() does the reading and
   writing, once a morning after scoring.

   Two blobs:
     plog-<season>   every night's box-score lines, compact, keyed by date:
                     { nights: { "2026-10-21": { pre:false, p: { <nameKey>: {n,t,s} } } } }
                     It is the raw material; corrections inside the feed's window
                     simply overwrite a night.
     pstats-<season> the windows the page reads, per game:
                     { asOf, pre, windows: { d7|d15|d30|szn: { <nameKey>: {n,t,g,s} } } }

   Players are keyed by nameKey() of ESPN's spelling, the same key the page's
   espnTeamOf()/espnPosOf() resolve a roster name to, so a roster name finds its
   line through the same route.

   Windows are CALENDAR days back from the latest night on file, not "last N
   games": 7d is every night after asOf minus 7. That is what fantasy sites mean
   by it and it is what makes a player who sat out look cold.

   Until the regular season has a night, the windows are built from preseason
   (tournament) nights instead and `pre` says so — that is what lets the screens
   be checked before October 20. The first regular-season night takes over. */

import { nameKey } from "./nba.mjs";

/* The stat keys the page's pstat() reads (RATER's), plus minutes. */
export const KEYS = ["FG", "FGA", "FT", "FTA", "P3", "TRB", "AST", "STL", "BLK", "TOV", "PTS", "MP"];
export const WINDOWS = { d7: 7, d15: 15, d30: 30, szn: null };

/* One stored night (lib/stats.mjs shape) → the compact form kept in plog. */
export function compactNight(night, pre) {
  const p = {};
  for (const x of Object.values((night && night.players) || {})) {
    if (!x || !x.n) continue;
    const s = {};
    for (const k of KEYS) s[k] = +(x.s && x.s[k]) || 0;
    p[nameKey(x.n)] = { n: x.n, t: x.t || "", s };
  }
  return { pre: !!pre, p };
}

const minus = (day, n) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const r2 = (v) => Math.round(v * 100) / 100;

/* plog → every window, per game. A player's club (`t`) is the one from his most
   recent night in the window. */
export function windowsFrom(plog) {
  const all = Object.entries((plog && plog.nights) || {});
  const reg = all.filter(([, n]) => !n.pre);
  const use = (reg.length ? reg : all).sort((a, b) => a[0].localeCompare(b[0]));
  if (!use.length) return { asOf: null, pre: false, windows: {} };
  const asOf = use[use.length - 1][0];
  const windows = {};
  for (const [w, days] of Object.entries(WINDOWS)) {
    const from = days ? minus(asOf, days) : "";
    const tot = {};
    for (const [day, night] of use) {
      if (day <= from) continue;
      for (const [key, x] of Object.entries(night.p || {})) {
        const into = (tot[key] = tot[key] || { n: x.n, t: x.t, g: 0, s: Object.fromEntries(KEYS.map((k) => [k, 0])) });
        into.g += 1; into.n = x.n; into.t = x.t || into.t;
        for (const k of KEYS) into.s[k] += x.s[k] || 0;
      }
    }
    for (const x of Object.values(tot)) for (const k of KEYS) x.s[k] = r2(x.s[k] / x.g);
    windows[w] = tot;
  }
  return { asOf, pre: !reg.length, windows };
}
