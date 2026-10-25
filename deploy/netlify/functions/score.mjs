/* Scores and standings.

   GET  /api/score                 -> { season, days:{date:{club:totals}}, lastRun,
                                        standings:[…] } — everything the page needs
   GET  /api/score?day=YYYY-MM-DD  -> one night in full: who counted for each club,
                                      who was over the game cap, who nobody started
   POST /api/score?run=1           -> rescore now (throttled to once per five minutes)
   POST /api/score?run=1&day=D     -> rescore just that night
   GET  /api/score?pre=1           -> the preseason tournament: { from, to, days, standings }
   POST /api/score?run=1&pre=1     -> rescore the tournament now
   GET  /api/score?ids=1           -> what every stored club name resolves to (dry run)
   POST /api/score?ids=1           -> file the stored history under club ids now
   GET  /api/score?stats=d15       -> one rolling window, per game: { asOf, pre, w, players:{<nameKey>:{n,t,g,s}} }
                                      (d7, d15, d30 or szn; lib/pstats.mjs)
   POST /api/score?run=1&stats=1   -> rebuild the rolling stats now
   GET  /api/score?log=<nameKey>[,<nameKey>…]
                                   -> a player's last five games: { games:[{day,t,s}] } newest first
                                      (the first key that has any line wins; preseason only if no
                                      regular-season night exists yet)

   Standings are computed on read from the per-night totals, so they can never
   disagree with them. */

import { store, read } from "./lib/league.mjs";
import { runScore, runPre, runPstats, seasonOf } from "./lib/scorerun.mjs";
import { seasonStandings } from "./lib/score.mjs";
import { daysByName, byClubName } from "./lib/clubs.mjs";
import { ctxFor, migrateIds } from "./lib/clubids.mjs";

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
    if (req.method === "GET" && url.searchParams.get("log")) {
      const keys = String(url.searchParams.get("log")).split(",").map((k) => k.trim()).filter(Boolean).slice(0, 6);
      const plog = (await read(s, "plog-" + season.key)).data || { nights: {} };
      const all = Object.entries(plog.nights || {});
      const reg = all.filter(([, n]) => !n.pre);
      const nights = (reg.length ? reg : all).sort((a, b) => b[0].localeCompare(a[0]));
      for (const k of keys) {
        const games = [];
        for (const [day, n] of nights) {
          const x = n.p && n.p[k];
          if (x) games.push({ day, t: x.t || "", s: x.s });
          if (games.length >= 5) break;
        }
        if (games.length) return json({ ok: true, games });
      }
      return json({ ok: true, games: [] });
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
    /* Club ids (lib/clubs.mjs): GET shows what every stored name resolves to
       without changing anything; POST files the history under the ids now. The
       ids themselves are never in a response meant for the page — only names. */
    if (url.searchParams.get("ids")) {
      if (req.method === "POST") return json({ ok: true, ...(await migrateIds(s, { seasonKeys: [season.key] })) });
      if (req.method === "GET") {
        const r = await migrateIds(s, { dry: true, seasonKeys: [season.key] });
        return json({ ok: true, clubs: Object.keys(r.clubs), lineups: r.lineups, scores: r.scores, unresolved: r.unresolved });
      }
    }
    if (req.method === "GET" && url.searchParams.get("pre")) {
      const idx = (await read(s, "score-pre")).data || { days: {} };
      const ctx = await ctxFor(s);
      const days = daysByName(idx.days, ctx);
      return json({ ...idx, days, pre: cfg.pre || null, standings: seasonStandings(days, cfg.renames, ctx.live) });
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
    if (isDay(day)) {
      const n = await read(s, "score-" + day);
      if (n.data && n.data.clubs) n.data = { ...n.data, clubs: byClubName(n.data.clubs, await ctxFor(s), day + "T23:59:59.999Z") };
      return json(n);
    }

    const idx = (await read(s, key)).data || { season: season.key, days: {} };
    const ctx = await ctxFor(s);
    const days = daysByName(idx.days, ctx);
    return json({ ...idx, days, cap: parseInt(cfg.gamecap, 10) || 920,
      standings: seasonStandings(days, cfg.renames, ctx.live) });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/score" };
