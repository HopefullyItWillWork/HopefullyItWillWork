/* Scores and standings.

   GET  /api/score                 -> { season, days:{date:{club:totals}}, lastRun,
                                        standings:[…] } — everything the page needs
   GET  /api/score?day=YYYY-MM-DD  -> one night in full: who counted for each club,
                                      who was over the game cap, who nobody started
   POST /api/score?run=1           -> rescore now (throttled to once per five minutes)
   POST /api/score?run=1&day=D     -> rescore just that night
   GET  /api/score?pre=1           -> the preseason tournament: { from, to, days, standings }
   POST /api/score?run=1&pre=1     -> rescore the tournament now
   GET  /api/score?stats=d15       -> one rolling window, per game: { asOf, pre, w, players:{<nameKey>:{n,t,g,s}} }
                                      (d7, d15, d30 or szn; lib/pstats.mjs)
   POST /api/score?run=1&stats=1   -> rebuild the rolling stats now

   Standings are computed on read from the per-night totals, so they can never
   disagree with them. */

import { store, read } from "./lib/league.mjs";
import { runScore, runPre, runPstats, seasonOf } from "./lib/scorerun.mjs";
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

    if (req.method === "POST" && url.searchParams.get("run") && url.searchParams.get("pre")) {
      const idx = (await read(s, "score-pre")).data;
      const last = idx && idx.lastRun && Date.parse(idx.lastRun.at);
      if (last && Date.now() - last < 2 * 60 * 1000)
        return json({ ok: false, reason: "ran less than two minutes ago", lastRun: idx.lastRun }, 429);
      return json({ ok: true, run: await runPre(s) });
    }
    if (req.method === "GET" && url.searchParams.get("stats")) {
      const w = String(url.searchParams.get("stats"));
      const all = (await read(s, "pstats-" + season.key)).data || {};
      return json({ asOf: all.asOf || null, pre: !!all.pre, w,
        players: (all.windows && all.windows[w]) || {}, lastRun: all.lastRun || null });
    }
    if (req.method === "POST" && url.searchParams.get("run") && url.searchParams.get("stats")) {
      return json({ ok: true, run: await runPstats(s) });
    }
    if (req.method === "GET" && url.searchParams.get("pre")) {
      const idx = (await read(s, "score-pre")).data || { days: {} };
      const clubs = Object.keys((await read(s, "rosters")).data || {});
      return json({ ...idx, pre: cfg.pre || null, standings: seasonStandings(idx.days, cfg.renames, clubs) });
    }
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
