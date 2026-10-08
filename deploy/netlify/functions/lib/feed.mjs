/* The nightly stats feed's I/O half: fetch, store, report. Shared by the
   scheduled job (stats-nightly.mjs) and the status endpoint (stats.mjs), so a
   manual run does exactly what the night does.

   Every run re-reads last night plus the WINDOW nights before it, because the
   NBA corrects box scores for days afterwards. A night is rewritten only when
   something in it actually changed, and the change is listed in `daily-index`,
   so a correction is visible rather than silent.

   Scheduled functions get about 30 seconds. One night is one scoreboard plus up
   to fifteen box scores of ~450KB each, so a full window usually fits, but a
   run stops starting new nights once BUDGET is spent and the next hourly run
   picks up the rest — newest first, so last night is never the one left over. */

import { SB, SUMMARY, WINDOW, dayKey, ymd, windowDays, gamesFrom, parseBox, diffDay, seasonTypes }
  from "./stats.mjs";

const BUDGET = 22000;
const HEAD = { "user-agent": "Mozilla/5.0 (compatible; LeagueLedger/1.0)", accept: "application/json" };

export const TZ = () => process.env.LEAGUE_TZ || "America/New_York";
export const todayIn = (tz) => new Intl.DateTimeFormat("en-CA", {
  timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function getJSON(url, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: HEAD, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url.split("?")[0]}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function readKey(s, key) {
  const raw = await s.get(key);
  return raw ? JSON.parse(raw) : { rev: 0, data: null };
}
async function writeKey(s, key, prev, data) {
  await s.set(key, JSON.stringify({ rev: (prev.rev || 0) + 1, data, at: new Date().toISOString() }));
}

/* One night, fetched fresh. Throws if the scoreboard or any box score fails, so
   a half-read night is never stored over a complete one. */
export async function fetchNight(day, types) {
  const games = gamesFrom(await getJSON(`${SB}?dates=${ymd(day)}`), types);
  const players = {}, meta = {};
  const boxes = await Promise.all(games.filter((g) => g.final)
    .map(async (g) => [g, parseBox(await getJSON(`${SUMMARY}?event=${g.id}`))]));
  for (const g of games) meta[g.id] = { final: g.final, home: g.home, away: g.away };
  for (const [, box] of boxes) Object.assign(players, box);
  return { date: day, games: meta, players };
}

/* The run. `force` re-fetches nights already checked today. Returns the summary
   it also stores on the index. */
export async function runFeed(s, { force = false, now = Date.now } = {}) {
  const start = now();
  const types = seasonTypes(process.env.STATS_TYPES);
  const today = todayIn(TZ());
  const days = windowDays(windowDays(today, 1)[1], WINDOW);    // yesterday and the WINDOW before it

  const idxPrev = await readKey(s, "daily-index");
  const idx = idxPrev.data || { days: {} };
  idx.days = idx.days || {};

  const done = [], left = [], errors = [];
  for (const day of days) {
    const had = idx.days[day];
    /* Checked today and every game was final: nothing new can arrive before
       tomorrow's run, so skip it. */
    if (!force && had && had.checked === today && had.allFinal) { done.push(day); continue; }
    if (now() - start > BUDGET) { left.push(day); continue; }
    try {
      const fresh = await fetchNight(day, types);
      const prev = await readKey(s, dayKey(day));
      /* A night that had games cannot lose all of them. An empty scoreboard for
         a stored night is ESPN having a bad moment, not a correction. */
      if (prev.data && Object.keys(prev.data.games || {}).length && !Object.keys(fresh.games).length)
        throw new Error("scoreboard came back empty for a night already stored; kept the stored copy");
      const changes = prev.data ? diffDay(prev.data, fresh) : [];
      const gameIds = Object.keys(fresh.games);
      const allFinal = gameIds.every((id) => fresh.games[id].final);
      const changed = !prev.data || changes.length
        || JSON.stringify(prev.data.games) !== JSON.stringify(fresh.games);
      if (changed && (gameIds.length || prev.data)) {
        await writeKey(s, dayKey(day), prev, { ...fresh, at: new Date().toISOString() });
      }
      idx.days[day] = {
        checked: today, allFinal, games: gameIds.length,
        players: Object.keys(fresh.players).length,
        stored: !!(gameIds.length || prev.data),
        /* Corrections are kept per night, newest last, so the history of a night
           is readable: the first fill is not a correction, later changes are. */
        corrections: [...((had && had.corrections) || []),
          ...(prev.data && changes.length ? [{ at: new Date().toISOString(), changes }] : [])],
      };
      done.push(day);
    } catch (e) {
      errors.push({ day, error: String((e && e.message) || e) });
    }
  }

  /* Keep the index from growing for ever: a season is about 170 nights. */
  const keys = Object.keys(idx.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete idx.days[k];

  idx.lastRun = { at: new Date().toISOString(), today, window: days, done, left, errors,
    types: [...types], ms: now() - start };
  await writeKey(s, "daily-index", idxPrev, idx);
  return idx.lastRun;
}
