/* Last night's numbers for one club, for the daily digest. Reads what the
   morning's scoring wrote (lib/scorerun.mjs): the night in full for the
   starters, and the season's nights for the standings — once including last
   night and once without it, so the email can say whether the club moved.
   Returns null when the night was not scored. */

import { seasonOf } from "./scorerun.mjs";
import { seasonStandings } from "./score.mjs";

/* Its own reader rather than league.mjs's, so this file imports no Netlify
   package and tests can run it against an in-memory store. */
async function read(s, key) {
  const raw = await s.get(key);
  return raw ? JSON.parse(raw) : { rev: 0, data: null };
}

export async function digestStats(s, club, day, cache = {}) {
  if (!cache.base) {
    const cfg = (await read(s, "settings")).data || {};
    const season = seasonOf(cfg);
    const idx = season ? (await read(s, "score-" + season.key)).data : null;
    const night = (await read(s, "score-" + day)).data;
    const clubs = Object.keys((await read(s, "rosters")).data || {});
    const days = (idx && idx.days) || {};
    const before = Object.fromEntries(Object.entries(days).filter(([d]) => d < day));
    cache.base = { cfg, night, days, clubs,
      now: seasonStandings(days, cfg.renames, clubs),
      was: seasonStandings(before, cfg.renames, clubs) };
  }
  const { night, cfg, now, was, days } = cache.base;
  const c = night && night.clubs && night.clubs[club];
  if (!night || !days[day] || !c) return null;
  const me = now.find((r) => r.club === club), prev = was.find((r) => r.club === club);
  const anyBefore = Object.keys(days).some((d) => d < day);
  return {
    day, counted: c.counted || [], over: c.over || [], reused: c.reused || [],
    totals: c.totals || {}, gpAfter: (c.gpBefore || 0) + ((c.totals && c.totals.GP) || 0),
    cap: parseInt(cfg.gamecap, 10) || 920,
    rank: me ? me.rank : null, of: now.length, pts: me ? me.pts : 0,
    rankWas: anyBefore && prev ? prev.rank : null,
  };
}
