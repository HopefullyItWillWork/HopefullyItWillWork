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
export function windowsFrom(plog, injlog = null) {
  const all = Object.entries((plog && plog.nights) || {});
  const reg = all.filter(([, n]) => !n.pre);
  const use = (reg.length ? reg : all).sort((a, b) => a[0].localeCompare(b[0]));
  if (!use.length) return { asOf: null, pre: false, windows: {}, teams: {}, miss: {} };
  const asOf = use[use.length - 1][0];
  const windows = {}, teams = {}, miss = {};
  const clubs = clubsOf(use, injlog);
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
    const m = missedIn(use.filter(([day]) => day > from), clubs, injlog);
    teams[w] = m.teams; miss[w] = m.miss;
  }
  return { asOf, pre: !reg.length, windows, teams, miss };
}

/* Games missed (2026-11-18). A player's club is the one on his newest line this
   season, else the one the injury log last gave him (a man out since opening
   night has no line at all). `teams[w]` is how many nights each NBA club played
   in the window — a night counts as a club's when anyone on it carries that
   club — and `miss[w][key] = {m, o}`: nights his club played and he did not
   appear, and how many of those he was listed on ESPN's injury report
   (lib/injlog.mjs; only from the day the log started). Only players with a miss
   are listed; the page works out everyone else from `teams`. A man traded
   within the window is counted against his new club's nights: close enough,
   and it never goes below zero. */
export function clubsOf(use, injlog) {
  const club = {};
  const days = Object.keys((injlog && injlog.days) || {}).sort();
  for (const d of days) for (const [k, x] of Object.entries(injlog.days[d] || {})) if (x && x.t) club[k] = x.t;
  for (const [, night] of use) for (const [k, x] of Object.entries(night.p || {})) if (x.t) club[k] = x.t;
  return club;
}
export function missedIn(nights, clubs, injlog) {
  const teams = {}, miss = {};
  const inj = (injlog && injlog.days) || {};
  for (const [day, night] of nights) {
    const played = new Set();
    for (const x of Object.values(night.p || {})) if (x && x.t) played.add(x.t);
    for (const t of played) teams[t] = (teams[t] || 0) + 1;
    const listed = inj[day] || {};
    for (const [k, t] of Object.entries(clubs)) {
      if (!played.has(t) || (night.p && night.p[k])) continue;
      const x = (miss[k] = miss[k] || { m: 0, o: 0 });
      x.m++; if (listed[k]) x.o++;
    }
  }
  return { teams, miss };
}

/* A player's last `n` games for the player card (2026-11-18), counting the nights
   his NBA club played without him: those come back as {day, t, dnp:true}, so a
   missed game shows as an empty row instead of vanishing. `nights` is plog's
   entries, newest first. His club is the one on his newest line; with no line at
   all, the club the page sends (`team`), so a man out all season still shows his
   club's games. A night counts as his club's when anyone on it carries that club. */
export function lastGames(nights, keys, team = "", n = 5, injlog = null) {
  const inj = (injlog && injlog.days) || {};
  for (const k of keys) {
    let club = "";
    for (const [, night] of nights) { const x = night.p && night.p[k]; if (x && x.t) { club = x.t; break; } }
    if (!club && !team) continue;
    club = club || team;
    const games = [];
    let seen = false;
    for (const [day, night] of nights) {
      const x = night.p && night.p[k];
      if (x) { seen = true; games.push({ day, t: x.t || "", s: x.s }); }
      else if (Object.values(night.p || {}).some((y) => y && y.t === club)) {
        const why = inj[day] && inj[day][k];
        games.push(why ? { day, t: club, dnp: true, why: why.s } : { day, t: club, dnp: true });
      }
      if (games.length >= n) break;
    }
    if (seen || team) return games;
  }
  return [];
}
