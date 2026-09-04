import { getStore } from "@netlify/blobs";

/* GET /api/schedule?day=YYYY-MM-DD  ->  { day, tips:{ DEN:"19:00", ... }, ... }

   Tonight's tip-off times, so a GM's lineup locks when his own player's game
   starts and nobody has to type a schedule in. The whole season comes from the
   NBA's own static feed in one request:

     https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json

   That file is several megabytes and changes rarely, so it is fetched at most
   once a day and only the derived part is kept: for every date, the tip-off
   time of each club playing, already converted to league time. That is about
   30KB for a season, in its own blob key, read by nobody who cares about
   contracts.

   Every failure returns 200 with an empty `tips` and a `reason`. A missing
   schedule must degrade to "nothing is locked", never to a broken lineup
   screen — the same rule the mail functions follow. */

const H = { "content-type": "application/json", "cache-control": "no-store" };
const TZ = () => process.env.LEAGUE_TZ || "America/New_York";
const SRC = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json";
const MAXAGE = 20 * 60 * 60 * 1000;            // re-fetch once a day, near enough

const store = () => getStore({ name: "league-ledger", consistency: "strong" });

/* The league date and the wall-clock time of an instant, both in league time.
   A 10pm Pacific tip-off is after midnight UTC and belongs to the day before. */
function inTZ(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ(), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ(), hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { day, time };
}

/* The feed down to what the lock needs: day -> club -> "HH:MM". A club plays
   once a night, so the earlier of two entries wins and a doubleheader that is
   not one cannot push a lock later than the game a GM is watching. */
function condense(json) {
  const out = {};
  const dates = (json && json.leagueSchedule && json.leagueSchedule.gameDates) || [];
  for (const gd of dates) {
    for (const g of gd.games || []) {
      const t = inTZ(g.gameDateTimeUTC);
      if (!t) continue;
      const codes = [g.homeTeam && g.homeTeam.teamTricode, g.awayTeam && g.awayTeam.teamTricode];
      for (const c of codes) {
        if (!c) continue;
        out[t.day] = out[t.day] || {};
        if (!out[t.day][c] || t.time < out[t.day][c]) out[t.day][c] = t.time;
      }
    }
  }
  return out;
}

async function cached(s) {
  try {
    const raw = await s.get("nbasched");
    const v = raw ? JSON.parse(raw) : null;
    if (v && v.byDay && Date.now() - (v.at || 0) < MAXAGE) return v;
    return v || null;                          // stale is still better than nothing
  } catch { return null; }
}

export default async (req) => {
  const url = new URL(req.url);
  const day = (url.searchParams.get("day") || "").match(/^\d{4}-\d{2}-\d{2}$/)
    ? url.searchParams.get("day")
    : new Intl.DateTimeFormat("en-CA", { timeZone: TZ(), year: "numeric",
        month: "2-digit", day: "2-digit" }).format(new Date());

  const s = store();
  let have = await cached(s);
  const fresh = have && Date.now() - (have.at || 0) < MAXAGE;

  if (!fresh) {
    try {
      const r = await fetch(SRC, { headers: {
        // The CDN answers a plain request, but the stats hosts want these and
        // sending them costs nothing.
        "user-agent": "Mozilla/5.0 (compatible; LeagueLedger/1.0)",
        "referer": "https://www.nba.com/",
        "accept": "application/json" } });
      if (r.ok) {
        const byDay = condense(await r.json());
        if (Object.keys(byDay).length) {
          have = { at: Date.now(), byDay };
          await s.set("nbasched", JSON.stringify(have));
        }
      }
    } catch { /* fall through to whatever was cached */ }
  }

  if (!have || !have.byDay) {
    return new Response(JSON.stringify({ day, tips: {}, reason: "no schedule available" }),
      { headers: H });
  }
  return new Response(JSON.stringify({
    day, tips: have.byDay[day] || {}, fetchedAt: have.at,
    stale: Date.now() - (have.at || 0) >= MAXAGE, tz: TZ()
  }), { headers: H });
};

export const config = { path: "/api/schedule" };
