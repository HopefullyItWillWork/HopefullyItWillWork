/* The waiver run's I/O: read rosters, settings and the season's standings, run
   lib/waivers.mjs, write rosters back with a revision check (the page's
   three-way merge then takes the server's copy of every club the run touched),
   append the moves to the log, and keep the weekly order and the run history
   in the `waivers` blob:
     { week: <Monday>, order: [club…], runs: [{at, day, results, cleared, skipped}] }  (last 30 runs) */

import { processWaivers, weeklyOrder, mondayOf, onWaivers, seasonKey, allOnWaivers } from "./waivers.mjs";
import { seasonStandings } from "./score.mjs";
import { seasonOf } from "./scorerun.mjs";
import { recordLineup } from "./lineups.mjs";

const TZ = () => process.env.LEAGUE_TZ || "America/New_York";
export const todayIn = (tz = TZ()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function readKey(s, key) {
  const raw = await s.get(key);
  return raw ? JSON.parse(raw) : { rev: 0, data: null };
}

/* This week's order: the stored one if it is this week's, else a fresh reset
   from the standings (worst first). Pure apart from the reads. */
export async function currentOrder(s, cfg, teams, today = todayIn()) {
  const week = mondayOf(today);
  const w = (await readKey(s, "waivers")).data || {};
  const clubs = Object.keys(teams || {});
  if (w.week === week && Array.isArray(w.order)) {
    const order = w.order.filter((c) => clubs.includes(c));
    for (const c of clubs.slice().sort()) if (!order.includes(c)) order.push(c);
    return { week, order, runs: w.runs || [], fresh: false };
  }
  const season = seasonOf(cfg);
  let standings = [];
  if (season) {
    const idx = (await readKey(s, "score-" + season.key)).data;
    if (idx && idx.days) standings = seasonStandings(idx.days, cfg.renames, clubs);
  }
  const draft = (cfg.draft && Array.isArray(cfg.draft.order)) ? cfg.draft.order : [];
  return { week, order: weeklyOrder(clubs, standings, draft), runs: w.runs || [], fresh: true };
}

/* What the page shows on League › Waivers. */
export async function waiverState(s) {
  const cfg = (await readKey(s, "settings")).data || {};
  const teams = (await readKey(s, "rosters")).data || {};
  const today = todayIn();
  const o = await currentOrder(s, cfg, teams, today);
  return { today, week: o.week, order: o.order, all: allOnWaivers(cfg, today),
    on: onWaivers(teams, seasonKey(cfg.season)).map(({ n, p, from, till }) => ({ n, p, from, till })),
    runs: (o.runs || []).slice(-10).reverse() };
}

export async function runWaivers(s, { by = "Waivers" } = {}) {
  const today = todayIn();
  for (let attempt = 0; attempt < 3; attempt++) {
    const cfg = (await readKey(s, "settings")).data || {};
    const ros = await readKey(s, "rosters");
    if (!ros.data) return { ok: false, reason: "no rosters" };
    const o = await currentOrder(s, cfg, ros.data, today);
    const r = processWaivers({ teams: ros.data, cfg, order: o.order, today, by });
    const changed = JSON.stringify(r.teams) !== JSON.stringify(ros.data);
    if (changed) {
      /* Revision check, as PUT /api/state does: if a GM wrote in between, read
         again and run again rather than overwrite him. */
      const now = await readKey(s, "rosters");
      if (now.rev !== ros.rev) continue;
      await s.set("rosters", JSON.stringify({ rev: ros.rev + 1, data: r.teams, at: new Date().toISOString() }));
      /* A club that dropped a starter has a new lineup: record it with the
         server's clock, as the page's logLineup() would, so tonight's scoring
         does not start the man it no longer has. */
      for (const res of r.results) {
        const t = res.drop && r.teams[res.to];
        if (t && t.lu && t.lu.s) {
          try { await recordLineup(s, TZ(), { club: res.to, s: t.lu.s, by: by, src: "waivers" }); } catch { /* the morning carry catches it */ }
        }
      }
      if (r.log.length) {
        const lg = await readKey(s, "log");
        const list = Array.isArray(lg.data) ? lg.data : [];
        await s.set("log", JSON.stringify({ rev: (lg.rev || 0) + 1, data: [...r.log.slice().reverse(), ...list].slice(0, 5000) }));
      }
    }
    const run = { at: new Date().toISOString(), day: today, results: r.results, cleared: r.cleared, skipped: r.skipped };
    const prev = await readKey(s, "waivers");
    const runs = [...(((prev.data || {}).runs) || []), run].slice(-30);
    await s.set("waivers", JSON.stringify({ rev: (prev.rev || 0) + 1, data: { week: o.week, order: r.order, runs } }));
    return { ok: true, ...run, order: r.order };
  }
  return { ok: false, reason: "rosters kept changing; try again" };
}
