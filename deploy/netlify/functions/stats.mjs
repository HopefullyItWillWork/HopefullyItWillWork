/* The stats feed's status and manual controls.

   GET /api/stats                   -> the index: every night stored, when it was
                                       last checked, and any corrections found
   GET /api/stats?day=YYYY-MM-DD    -> one night's box scores
   GET /api/stats?test=YYYY-MM-DD   -> fetch that night from ESPN and return it
                                       WITHOUT storing it. Any season type, so a
                                       preseason night proves the pipe works.
   POST /api/stats?run=1            -> run the nightly job now. Throttled to once
                                       every five minutes; re-reading public box
                                       scores is harmless, but nobody needs to
                                       hammer ESPN from the league's account.

   No auth, like the rest of /api: everything here is public NBA data. */

import { store, read } from "./lib/league.mjs";
import { runFeed, fetchNight } from "./lib/feed.mjs";
import { dayKey } from "./lib/stats.mjs";

const H = { "content-type": "application/json", "cache-control": "no-store" };
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: H });

export default async (req) => {
  const url = new URL(req.url);
  const s = store();
  try {
    if (req.method === "POST" && url.searchParams.get("run")) {
      const idx = (await read(s, "daily-index")).data;
      const last = idx && idx.lastRun && Date.parse(idx.lastRun.at);
      if (last && Date.now() - last < 5 * 60 * 1000)
        return json({ ok: false, reason: "ran less than five minutes ago", lastRun: idx.lastRun }, 429);
      return json({ ok: true, run: await runFeed(s, { force: !!url.searchParams.get("force") }) });
    }
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

    const test = url.searchParams.get("test");
    if (isDay(test)) {
      const night = await fetchNight(test, null);       // null: every season type
      return json({ ok: true, stored: false, games: Object.keys(night.games).length,
        players: Object.keys(night.players).length, night });
    }
    const day = url.searchParams.get("day");
    if (isDay(day)) return json(await read(s, dayKey(day)));
    return json(await read(s, "daily-index"));
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/stats" };
