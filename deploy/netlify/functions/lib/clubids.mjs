/* Club ids: the I/O half of lib/clubs.mjs.

   ensureIds   gives every club in `rosters` an id, with a revision check (the
               same way the waiver run writes rosters), and returns the rosters.
   migrateIds  files everything already stored under an id: lineup history
               (luh/…) gets `cid`, and the score indexes are re-keyed from club
               names to ids. Legacy names are resolved through the rename
               journal exactly once, here, and never again — after this, a rename
               cannot touch them. `dry` only reports.
   Both are safe to run any number of times. */

import { stampIds, clubCtx, keyOf, nameFor } from "./clubs.mjs";
import { getListed, listedKey } from "./lineups.mjs";

async function readKey(s, key) {
  const raw = await s.get(key);
  return raw ? JSON.parse(raw) : { rev: 0, data: null };
}

export async function ensureIds(s) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ros = await readKey(s, "rosters");
    const teams = ros.data;
    if (!teams) return {};
    if (Object.values(teams).every((t) => !t || t.id)) return teams;
    const next = stampIds(null, JSON.parse(JSON.stringify(teams)));
    const now = await readKey(s, "rosters");
    if (now.rev !== ros.rev) continue;
    await s.set("rosters", JSON.stringify({ rev: ros.rev + 1, data: next, at: new Date().toISOString() }));
    return next;
  }
  return (await readKey(s, "rosters")).data || {};
}

export async function ctxFor(s) {
  const cfg = (await readKey(s, "settings")).data || {};
  return clubCtx(await ensureIds(s), cfg.renames);
}

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

export async function migrateIds(s, { dry = false, seasonKeys = [], skipLineups = false } = {}) {
  const ctx = await ctxFor(s);
  const report = { clubs: Object.fromEntries(Object.entries(ctx.byName)), lineups: { changed: 0, total: 0, names: {} },
    scores: {}, unresolved: [] };
  const seen = (names, ref, id) => { names[ref] = id ? nameFor(id, ctx) : null; };

  /* Lineup history: stamp `cid` on every entry that has none. */
  const { blobs } = skipLineups ? { blobs: [] } : await s.list({ prefix: "luh/" });
  for (const b of blobs) {
    let e; try { e = JSON.parse(await getListed(s, b.key)); } catch { continue; }
    if (!e) continue;
    report.lineups.total++;
    if (e.cid && ctx.nameOf[e.cid]) continue;
    const id = keyOf(e.club, ctx, e.at);
    seen(report.lineups.names, e.club, ctx.nameOf[id] ? id : null);
    if (!ctx.nameOf[id]) { report.unresolved.push({ kind: "lineup", club: e.club, at: e.at }); continue; }
    report.lineups.changed++;
    if (!dry) await s.set(listedKey(b.key), JSON.stringify({ ...e, cid: id }));
  }

  /* Score indexes: re-key each night's totals by id. */
  const keys = ["score-pre", ...seasonKeys.map((k) => "score-" + k)];
  for (const key of keys) {
    const idx = await readKey(s, key);
    if (!idx.data || !idx.data.days) continue;
    let changed = 0;
    const days = {};
    for (const [day, night] of Object.entries(idx.data.days)) {
      const at = isDay(day) ? day + "T23:59:59.999Z" : undefined;
      const row = {};
      for (const [ref, t] of Object.entries(night || {})) {
        const id = keyOf(ref, ctx, at);
        if (id == null) continue;
        if (id !== ref) { changed++; seen((report.scores[key] = report.scores[key] || { names: {} }).names, ref, ctx.nameOf[id] ? id : null); }
        if (!ctx.nameOf[id]) report.unresolved.push({ kind: key, day, club: ref });
        row[id] = t;
      }
      days[day] = row;
    }
    (report.scores[key] = report.scores[key] || { names: {} }).changed = changed;
    if (changed && !dry)
      await s.set(key, JSON.stringify({ rev: (idx.rev || 0) + 1, data: { ...idx.data, days }, at: new Date().toISOString() }));
  }
  return report;
}
