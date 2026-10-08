/* GET /api/schedule?day=YYYY-MM-DD  ->  { day, tips:{ DEN:"19:00", ... }, ... }

   Tonight's tip-off times, so a GM's lineup locks when his own player's game
   starts and nobody has to type a schedule in.

   Source: ESPN's scoreboard for that one date — the same feed the nightly stats
   job reads (lib/stats.mjs). This used to read the NBA's season file on
   cdn.nba.com, which answers 403 to Netlify's servers, so it never returned a
   schedule and no lineup ever locked.

   One small request per date, cached under `sched-YYYY-MM-DD` and refreshed
   every 30 minutes on the day, because start times move and games get
   postponed. Codes are ESPN's (GS, NY, SA, UTAH, WSH, NO); the page's TRICODE
   table already folds those into the NBA's own.

   Every failure returns 200 with an empty `tips` and a `reason`. A missing
   schedule must degrade to "nothing is locked", never to a broken lineup
   screen — the same rule the mail functions follow. */

import { store } from "./lib/league.mjs";
import { SB, ymd, tipsFrom } from "./lib/stats.mjs";

const H = { "content-type": "application/json", "cache-control": "no-store" };
const TZ = () => process.env.LEAGUE_TZ || "America/New_York";
const MAXAGE = 30 * 60 * 1000;

const todayIn = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz,
  year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default async (req) => {
  const url = new URL(req.url);
  const asked = url.searchParams.get("day") || "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : todayIn(TZ());
  const s = store();
  const key = "sched-" + day;

  let have = null;
  try { const raw = await s.get(key); have = raw ? JSON.parse(raw) : null; } catch { have = null; }
  /* A past day cannot change any more, so a cached copy of one is final. */
  const settled = have && day < todayIn(TZ());
  const fresh = have && (settled || Date.now() - (have.at || 0) < MAXAGE);

  if (!fresh) {
    try {
      const r = await fetch(`${SB}?dates=${ymd(day)}`, { headers: {
        "user-agent": "Mozilla/5.0 (compatible; LeagueLedger/1.0)", accept: "application/json" } });
      if (r.ok) {
        have = { at: Date.now(), tips: tipsFrom(await r.json(), TZ()) };
        await s.set(key, JSON.stringify(have));
      }
    } catch { /* fall through to whatever was cached */ }
  }

  if (!have) {
    return new Response(JSON.stringify({ day, tips: {}, reason: "no schedule available" }), { headers: H });
  }
  return new Response(JSON.stringify({
    day, tips: have.tips || {}, fetchedAt: have.at,
    stale: !settled && Date.now() - (have.at || 0) >= MAXAGE, tz: TZ()
  }), { headers: H });
};

export const config = { path: "/api/schedule" };
