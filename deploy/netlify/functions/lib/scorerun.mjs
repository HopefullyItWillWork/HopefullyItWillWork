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

import { scoreNight, currentName } from "./score.mjs";
import { lineupsOn } from "./lineups.mjs";
import { dayKey } from "./stats.mjs";

const BUDGET = 22000;

async function readKey(s, key) {
  const raw = await s.get(key);
  return raw ? JSON.parse(raw) : { rev: 0, data: null };
}
async function writeKey(s, key, prev, data) {
  await s.set(key, JSON.stringify({ rev: (prev.rev || 0) + 1, data, at: new Date().toISOString() }));
}

/* "2026–27" or "2026-27" → "2026-27"; the blob key and the date span. */
export function seasonOf(cfg) {
  const m = /(\d{4})\D+(\d{2})/.exec(String((cfg && cfg.season) || ""));
  if (!m) return null;
  const y = +m[1];
  return { key: `${m[1]}-${m[2]}`, from: `${y}-09-01`, to: `${y + 1}-08-31` };
}

export async function runScore(s, { only = null, now = Date.now } = {}) {
  const start = now();
  const cfg = (await readKey(s, "settings")).data || {};
  const season = seasonOf(cfg);
  if (!season) return { ok: false, reason: "no season in settings" };
  const cap = parseInt(cfg.gamecap, 10) > 0 ? parseInt(cfg.gamecap, 10) : 920;
  const alias = cfg.alias || {}, espn = cfg.espn || {}, renames = Array.isArray(cfg.renames) ? cfg.renames : [];

  const feed = ((await readKey(s, "daily-index")).data) || {};
  const stored = Object.keys(feed.days || {})
    .filter((d) => d >= season.from && d <= season.to && feed.days[d].stored).sort();
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
      const night = (await readKey(s, dayKey(day))).data;
      if (!night) { delete idx.days[day]; continue; }
      const lineups = await lineupsOn(s, day);
      /* Games already counted before this night, by club, from the index —
         which by now holds every earlier night, including ones rescored a
         moment ago in this same run. */
      const gpBefore = {};
      for (const [d, clubs] of Object.entries(idx.days)) {
        if (d >= day) continue;
        for (const [c, t] of Object.entries(clubs)) {
          const now = currentName(c, renames);      // a night scored before a rename
          if (now) gpBefore[now] = (gpBefore[now] || 0) + (t.GP || 0);
        }
      }
      const r = scoreNight({ night, lineups, gpBefore, cap, alias, espn, renames });
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
