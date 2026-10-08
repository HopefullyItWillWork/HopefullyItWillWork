/* Scores and standings.

   GET  /api/score                 -> { season, days:{date:{club:totals}}, lastRun,
                                        standings:[…] } — everything the page needs
   GET  /api/score?day=YYYY-MM-DD  -> one night in full: who counted for each club,
                                      who was over the game cap, who nobody started
   POST /api/score?run=1           -> rescore now (throttled to once per five minutes)
   POST /api/score?run=1&day=D     -> rescore just that night

   Standings are computed on read from the per-night totals, so they can never
   disagree with them. */

import { store, read } from "./lib/league.mjs";
import { runScore, seasonOf } from "./lib/scorerun.mjs";
import { seasonStandings } from "./lib/score.mjs";

const H = { "content-type": "application/json", "cache-control": "no-store" };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: H });
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

export default async (req) => {
  const s = store();
  const url = new URL(req.url);
  try {
    const cfg = (await read(s, "settings")).data || {};
    const season = seasonOf(cfg);
    if (!season) return json({ ok: false, reason: "no season in settings" });
    const key = "score-" + season.key;

    if (req.method === "POST" && url.searchParams.get("run")) {
      const idx = (await read(s, key)).data;
      const last = idx && idx.lastRun && Date.parse(idx.lastRun.at);
      if (last && Date.now() - last < 5 * 60 * 1000)
        return json({ ok: false, reason: "ran less than five minutes ago", lastRun: idx.lastRun }, 429);
      const day = url.searchParams.get("day");
      return json({ ok: true, run: await runScore(s, { only: isDay(day) ? day : null }) });
    }
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

    const day = url.searchParams.get("day");
    if (isDay(day)) return json(await read(s, "score-" + day));

    const idx = (await read(s, key)).data || { season: season.key, days: {} };
    const clubs = Object.keys((await read(s, "rosters")).data || {});
    return json({ ...idx, cap: parseInt(cfg.gamecap, 10) || 920,
      standings: seasonStandings(idx.days, cfg.renames, clubs) });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/score" };
