/* Scoring's I/O: which nights to (re)score, reading their inputs, writing the
   results. The rule itself is lib/score.mjs.

   Two things are written:
     score-<season>      { season, at, days: { date: { club: totals } }, lastRun }
                         The whole season's per-night club totals in one blob —
                         about 170 nights × 9 clubs, small. Standings, the
                         15-day chart and the over-920 warning all read this.
     score-YYYY-MM-DD    one night in full: who counted, who did not, and
                         anyone in the box scores nobody started. For checking.

   Every run rescores the nights the stats feed re-reads (last night plus five),
   oldest first, because a stat correction or a late lineup save in an early
   night changes how many games every later night starts from. Nights before
   the window are settled and left alone. Any stored night not yet scored at all
   is caught up too, so a missed morning repairs itself. */

import { scoreNight } from "./score.mjs";
import { keyOf, resolveEntry } from "./clubs.mjs";
import { ctxFor, migrateIds } from "./clubids.mjs";
import { lineupsOn } from "./lineups.mjs";
import { dayKey } from "./stats.mjs";
import { applyFixes, fixesOn } from "./statfix.mjs";
import { compactNight, windowsFrom } from "./pstats.mjs";

const BUDGET = 22000;

async function readKey(s, key) {
  const raw = await s.get(key);
  return raw ? JSON.parse(raw) : { rev: 0, data: null };
}
async function writeKey(s, key, prev, data) {
  await s.set(key, JSON.stringify({ rev: (prev.rev || 0) + 1, data, at: new Date().toISOString() }));
}

/* A stored night with the commissioner's corrections laid over it (statfix.mjs). */
async function readNight(s, day, fx) {
  const night = (await readKey(s, dayKey(day))).data;
  return night ? applyFixes(night, fixesOn(fx, day)) : night;
}

/* "2026–27" or "2026-27" → "2026-27"; the blob key and the date span. */
export function seasonOf(cfg) {
  const m = /(\d{4})\D+(\d{2})/.exec(String((cfg && cfg.season) || ""));
  if (!m) return null;
  const y = +m[1];
  return { key: `${m[1]}-${m[2]}`, from: `${y}-09-01`, to: `${y + 1}-08-31` };
}

/* The first run after club ids arrive files all the old history under them
   (lib/clubids.mjs). After that only new records exist and they carry ids, so a
   marker stops it re-reading every lineup blob. Score indexes are cheap and are
   always checked. */
async function ensureMigrated(s, seasonKey) {
  try {
    const done = (await readKey(s, "clubids-migrated")).data;
    if (done) {
      const keys = seasonKey ? [seasonKey] : [];
      /* Just the score indexes: lineup blobs written since carry ids. */
      await migrateIds(s, { seasonKeys: keys, skipLineups: true });
      return;
    }
    await migrateIds(s, { seasonKeys: seasonKey ? [seasonKey] : [] });
    await s.set("clubids-migrated", JSON.stringify({ rev: 1, data: { at: new Date().toISOString() } }));
  } catch { /* scoring still resolves legacy names on the fly */ }
}

export async function runScore(s, { only = null, now = Date.now } = {}) {
  const start = now();
  const cfg = (await readKey(s, "settings")).data || {};
  const season = seasonOf(cfg);
  if (!season) return { ok: false, reason: "no season in settings" };
  const cap = parseInt(cfg.gamecap, 10) > 0 ? parseInt(cfg.gamecap, 10) : 920;
  const alias = cfg.alias || {}, espn = cfg.espn || {}, renames = Array.isArray(cfg.renames) ? cfg.renames : [];
  const ctx = await ctxFor(s);
  const resolve = (ref, at, alt) => alt === undefined ? keyOf(ref, ctx, at) : resolveEntry(ctx, ref, alt, at);
  /* Anything stored under a club's old name is filed under its id first, so the
     rescoring below never has to guess from the rename journal again. */
  await ensureMigrated(s, season.key);

  const feed = ((await readKey(s, "daily-index")).data) || {};
  const fx = (await readKey(s, "statfix")).data;
  const stored = Object.keys(feed.days || {})
    .filter((d) => d >= season.from && d <= season.to && feed.days[d].stored && !feed.days[d].pre).sort();
  const window = new Set((feed.lastRun && feed.lastRun.window) || []);

  const key = "score-" + season.key;
  const prevIdx = await readKey(s, key);
  const idx = prevIdx.data || { season: season.key, days: {} };
  idx.days = idx.days || {};

  const todo = (only ? [only] : stored.filter((d) => window.has(d) || !idx.days[d])).sort();
  const done = [], left = [], errors = [], notes = {};
  for (const day of todo) {
    if (now() - start > BUDGET) { left.push(day); continue; }
    try {
      const night = await readNight(s, day, fx);
      if (!night) { delete idx.days[day]; continue; }
      const lineups = await lineupsOn(s, day);
      /* Games already counted before this night, by club, from the index —
         which by now holds every earlier night, including ones rescored a
         moment ago in this same run. */
      const gpBefore = {};
      for (const [d, clubs] of Object.entries(idx.days)) {
        if (d >= day) continue;
        for (const [c, t] of Object.entries(clubs)) {
          const now = resolve(c, d + "T23:59:59.999Z");   // a night scored before a rename
          if (now) gpBefore[now] = (gpBefore[now] || 0) + (t.GP || 0);
        }
      }
      const r = scoreNight({ night, lineups, gpBefore, cap, alias, espn, renames, resolve });
      idx.days[day] = Object.fromEntries(Object.entries(r.clubs).map(([c, x]) => [c, x.totals]));
      const prevNight = await readKey(s, "score-" + day);
      await writeKey(s, "score-" + day, prevNight, { day, cap, ...r });
      notes[day] = { unmatched: r.unmatched.length, noTip: r.noTip.length,
        over: Object.values(r.clubs).reduce((a, x) => a + x.over.length, 0) };
      done.push(day);
    } catch (e) {
      errors.push({ day, error: String((e && e.message) || e) });
    }
  }
  idx.lastRun = { at: new Date().toISOString(), done, left, errors, notes, ms: now() - start };
  await writeKey(s, key, prevIdx, idx);
  return idx.lastRun;
}

/* Rolling player stats (lib/pstats.mjs): every stored night in the season's
   date span — the feed's window again (corrections), plus any night plog does
   not have yet — goes into plog-<season>, then every window is recomputed into
   pstats-<season>, which GET /api/score?stats=<window> serves. Preseason nights
   are kept flagged `pre`; the windows only use them until a regular-season
   night exists. */
export async function runPstats(s, { now = Date.now, days = [] } = {}) {
  const start = now();
  const cfg = (await readKey(s, "settings")).data || {};
  const season = seasonOf(cfg);
  if (!season) return { ok: false, reason: "no season in settings" };
  const feed = ((await readKey(s, "daily-index")).data) || {};
  const fx = (await readKey(s, "statfix")).data;
  const window = new Set((feed.lastRun && feed.lastRun.window) || []);
  const prevLog = await readKey(s, "plog-" + season.key);
  const plog = prevLog.data || { season: season.key, nights: {} };
  plog.nights = plog.nights || {};
  const todo = Object.keys(feed.days || {})
    .filter((d) => d >= season.from && d <= season.to && feed.days[d].stored && (window.has(d) || !plog.nights[d] || days.includes(d)))
    .sort();
  const done = [], left = [], errors = [];
  for (const day of todo) {
    if (now() - start > BUDGET) { left.push(day); continue; }
    try {
      const night = await readNight(s, day, fx);
      if (!night) continue;
      plog.nights[day] = compactNight(night, !!feed.days[day].pre);
      done.push(day);
    } catch (e) { errors.push({ day, error: String((e && e.message) || e) }); }
  }
  await writeKey(s, "plog-" + season.key, prevLog, plog);
  const prevStats = await readKey(s, "pstats-" + season.key);
  const w = windowsFrom(plog);
  const lastRun = { at: new Date().toISOString(), done, left, errors, ms: now() - start };
  await writeKey(s, "pstats-" + season.key, prevStats, { ...w, lastRun });
  return lastRun;
}

/* The preseason tournament: the same scoring over the tournament's nights, kept
   apart in `score-pre`. No game cap — it is four nights — and every night is
   rescored each run, because there are only a handful. Each night is also
   written as score-YYYY-MM-DD, so the Results box on My Team shows it. */
export async function runPre(s, { now = Date.now } = {}) {
  const start = now();
  const cfg = (await readKey(s, "settings")).data || {};
  const p = cfg.pre;
  if (!p || !/^\d{4}-\d{2}-\d{2}$/.test(p.from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(p.to || ""))
    return { ok: false, reason: "no tournament in settings" };
  const alias = cfg.alias || {}, espn = cfg.espn || {}, renames = Array.isArray(cfg.renames) ? cfg.renames : [];
  const ctx = await ctxFor(s);
  /* `alt` is the club name a lineup entry was saved under. If the entry's id is
     not a club that exists (the club was given a fresh id at some point, which
     orphans everything filed under the old one), fall back to the name, or the
     club's whole lineup is lost and every starter scores as bench. */
  const resolve = (ref, at, alt) => alt === undefined ? keyOf(ref, ctx, at) : resolveEntry(ctx, ref, alt, at);
  await ensureMigrated(s, null);
  const feed = ((await readKey(s, "daily-index")).data) || {};
  const fx = (await readKey(s, "statfix")).data;
  const nights = Object.keys(feed.days || {}).filter((d) => d >= p.from && d <= p.to && feed.days[d].stored).sort();

  const prevIdx = await readKey(s, "score-pre");
  const idx = { from: p.from, to: p.to, days: {} };
  const done = [], left = [], errors = [];
  for (const day of nights) {
    if (now() - start > BUDGET) { left.push(day); if (prevIdx.data && prevIdx.data.days && prevIdx.data.days[day]) idx.days[day] = prevIdx.data.days[day]; continue; }
    try {
      const night = await readNight(s, day, fx);
      if (!night) continue;
      const r = scoreNight({ night, lineups: await lineupsOn(s, day), gpBefore: {}, cap: 1e9, alias, espn, renames, resolve });
      idx.days[day] = Object.fromEntries(Object.entries(r.clubs).map(([c, x]) => [c, x.totals]));
      const prevNight = await readKey(s, "score-" + day);
      await writeKey(s, "score-" + day, prevNight, { day, cap: null, pre: true, ...r });
      done.push(day);
    } catch (e) {
      errors.push({ day, error: String((e && e.message) || e) });
    }
  }
  idx.lastRun = { at: new Date().toISOString(), done, left, errors, ms: now() - start };
  await writeKey(s, "score-pre", prevIdx, idx);
  return idx.lastRun;
}
