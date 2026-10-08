/* The nightly stats feed's pure half: turning ESPN's JSON into the league's
   own shape, and deciding which days to (re)fetch. Imports nothing, so a test
   can load it directly with no Netlify runtime, exactly like format.mjs.

   Source: ESPN's public site API. Free, no key. The NBA's own CDN
   (cdn.nba.com) answers 403 to Netlify's servers, which is also why
   /api/schedule comes back empty.

     scoreboard  https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD
     box score   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=<id>

   `dates` is an Eastern-time date, the same calendar the league runs on, so a
   10pm Pacific tip-off lands on the night it was played.

   One stored record per league date, under the blob key `daily-YYYY-MM-DD`
   (state.mjs strips "/" from keys, so not `daily/…`):

     { date, at, games: { <espnId>: { final, home, away, tip } },
       players: { <espnId>: { n, t, s: { MP,FG,FGA,FT,FTA,P3,TRB,AST,STL,BLK,TOV,PTS } } } }

   `s` uses the same keys as RATER's per-game line, so anything that already
   reads a player's `s` can read a night's box score unchanged. Players who did
   not play are left out: no row means no game. */

export const SB = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
export const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary";

/* Last night plus this many before it are re-fetched every run. The NBA
   corrects box scores for a few days after a game — a rebound credited to the
   wrong man, an assist added on review — and re-reading the window is how those
   corrections reach the league. */
export const WINDOW = 5;

export const dayKey = (d) => "daily-" + d;
export const ymd = (d) => d.replace(/-/g, "");

/* The league date `n` days before `day` (YYYY-MM-DD), by calendar arithmetic
   at noon UTC so no time zone or DST change can shift it. */
export function daysBefore(day, n) {
  const t = new Date(day + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
}

/* Newest first: last night is the one people are waiting on, so a run that is
   cut short has still done it. */
export function windowDays(yesterday, back = WINDOW) {
  const out = [];
  for (let i = 0; i <= back; i++) out.push(daysBefore(yesterday, i));
  return out;
}

/* Which ESPN season types count. 1 preseason, 2 regular season, 3 postseason,
   5 play-in. Only the regular season by default; STATS_TYPES="1,2" lets the
   preseason through for testing the pipe before opening night. */
export function seasonTypes(env) {
  const raw = String(env || "2");
  const set = new Set(raw.split(",").map((x) => parseInt(x, 10)).filter((x) => x > 0));
  return set.size ? set : new Set([2]);
}

/* Scoreboard → the games on that date that count, with whether each is final. */
export function gamesFrom(scoreboard, types) {
  const out = [];
  for (const e of (scoreboard && scoreboard.events) || []) {
    const ty = e.season && e.season.type;
    if (types && !types.has(ty)) continue;
    const st = (e.status && e.status.type) || {};
    const comp = (e.competitions && e.competitions[0]) || {};
    const side = (h) => {
      const c = (comp.competitors || []).find((x) => x.homeAway === h);
      return (c && c.team && c.team.abbreviation) || "";
    };
    out.push({ id: String(e.id), final: !!st.completed, home: side("home"), away: side("away"),
      tip: e.date || comp.date || null });
  }
  return out;
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const pair = (v) => {
  const [m, a] = String(v || "").split("-");
  return [num(m), num(a)];
};

/* One game's box score → { <espnId>: { n, t, s } }. Columns are found by key
   name, never by position, so ESPN reordering them cannot shift a stat into
   the wrong category. A player marked didNotPlay, or with no stats at all, is
   left out. */
export function parseBox(summary) {
  const out = {};
  const teams = (summary && summary.boxscore && summary.boxscore.players) || [];
  for (const tm of teams) {
    const abbr = (tm.team && tm.team.abbreviation) || "";
    const st = (tm.statistics && tm.statistics[0]) || {};
    const keys = st.keys || [];
    const at = (k) => keys.indexOf(k);
    const iMin = at("minutes"), iPts = at("points"),
      iFg = at("fieldGoalsMade-fieldGoalsAttempted"),
      i3 = at("threePointFieldGoalsMade-threePointFieldGoalsAttempted"),
      iFt = at("freeThrowsMade-freeThrowsAttempted"),
      iReb = at("rebounds"), iAst = at("assists"), iTo = at("turnovers"),
      iStl = at("steals"), iBlk = at("blocks");
    for (const a of st.athletes || []) {
      const v = a.stats || [];
      if (a.didNotPlay || !v.length) continue;
      const id = a.athlete && a.athlete.id;
      if (!id) continue;
      const [fg, fga] = pair(v[iFg]), [p3] = pair(v[i3]), [ft, fta] = pair(v[iFt]);
      out[String(id)] = {
        n: a.athlete.displayName || "",
        t: abbr,
        s: { MP: num(v[iMin]), FG: fg, FGA: fga, FT: ft, FTA: fta, P3: p3,
             TRB: num(v[iReb]), AST: num(v[iAst]), STL: num(v[iStl]),
             BLK: num(v[iBlk]), TOV: num(v[iTo]), PTS: num(v[iPts]) },
      };
    }
  }
  return out;
}

/* What changed between the stored night and the fresh one, per player, so the
   run can report corrections rather than silently overwriting them. */
export function diffDay(before, after) {
  const a = (before && before.players) || {}, b = (after && after.players) || {};
  const out = [];
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id], y = b[id];
    if (!x || !y) { out.push({ id, n: (y || x).n, what: x ? "removed" : "added" }); continue; }
    const cats = Object.keys(y.s).filter((k) => x.s[k] !== y.s[k]);
    if (cats.length) out.push({ id, n: y.n, what: cats.map((k) => `${k} ${x.s[k]}→${y.s[k]}`).join(", ") });
  }
  return out;
}

/* Tonight's tip-offs for the lineup lock: { <ESPN team code>: "HH:MM" } in
   league time. Every season type counts here — a preseason game still has a
   start time — and a postponed or cancelled game is left out, because a game
   that is not being played must not lock anybody. A club playing twice in a
   day (it does not happen, but the feed cannot promise it) keeps the earlier
   time, so a lock can never land later than the game a GM is watching. */
export function tipsFrom(scoreboard, tz) {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const out = {};
  for (const e of (scoreboard && scoreboard.events) || []) {
    const name = String((e.status && e.status.type && e.status.type.name) || "");
    if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(name)) continue;
    const t = new Date(e.date);
    if (isNaN(t)) continue;
    const hm = fmt.format(t);
    const comp = (e.competitions && e.competitions[0]) || {};
    for (const c of comp.competitors || []) {
      const code = c.team && c.team.abbreviation;
      if (code && (!out[code] || hm < out[code])) out[code] = hm;
    }
  }
  return out;
}
