/* "Why did this club score nothing?" — everything the scoring job sees for one
   club on one night, in one answer, so a missing score is diagnosed from facts
   instead of guessed at. Read-only. GET /api/score?diag=1&club=<name>&day=<date>. */

import { applyFixes, fixesOn } from "./statfix.mjs";
import { ctxFor } from "./clubids.mjs";
import { lineupsOn } from "./lineups.mjs";
import { scoreNight, keysFor } from "./score.mjs";
import { resolveEntry, keyOf } from "./clubs.mjs";
import { nameKey } from "./nba.mjs";
import { dayKey } from "./stats.mjs";

async function readKey(s, key) {
  const raw = await s.get(key);
  return raw ? JSON.parse(raw) : { rev: 0, data: null };
}

export async function diagnose(s, { club, day }) {
  const cfg = (await readKey(s, "settings")).data || {};
  const alias = cfg.alias || {}, espn = cfg.espn || {}, renames = Array.isArray(cfg.renames) ? cfg.renames : [];
  const ctx = await ctxFor(s);
  const out = { club, day };

  /* 1. Who is this club, to the server? */
  const id = ctx.byName[club] || keyOf(club, ctx);
  out.clubId = ctx.nameOf[id] ? id : null;
  out.serverClubs = Object.entries(ctx.teams).map(([n, t]) => ({ name: n, id: t && t.id, live: ctx.live.includes(n) }));
  out.renames = renames.filter((r) => r && (r.from === club || r.to === club || (id && ctx.byName[r.from] === id))).slice(-6);
  const t = ctx.teams[club] || (out.clubId && ctx.teams[ctx.nameOf[out.clubId]]) || null;
  out.serverLineup = t && t.lu && t.lu.s ? Object.values(t.lu.s).filter(Boolean) : null;
  if (!out.clubId) { out.problem = "The server has no club by that name, or by any name it was renamed from."; return out; }

  /* 2. The lineup history it would score from. */
  const lineups = await lineupsOn(s, day);
  const mine = [];
  for (const [saved, list] of Object.entries(lineups)) for (const e of list || []) {
    const to = resolveEntry(ctx, e.cid, e.club || saved, e.at);
    if (to === out.clubId) mine.push({ at: e.at, src: e.src || "save", savedAs: e.club || saved, cid: e.cid || "",
      starters: Object.values(e.s || {}).filter(Boolean) });
  }
  out.lineupEntries = mine.sort((a, b) => a.at.localeCompare(b.at));
  out.lineupEntriesElsewhere = Object.entries(lineups).map(([n, l]) => ({ savedAs: n, entries: (l || []).length }));

  /* 3. The box scores, and what scoring makes of them. */
  const raw = (await readKey(s, dayKey(day))).data;
  if (!raw) { out.problem = "No box scores are stored for that night."; return out; }
  const fx = (await readKey(s, "statfix")).data;
  const night = applyFixes(raw, fixesOn(fx, day));
  out.box = { games: Object.keys(night.games || {}).length, players: Object.keys(night.players || {}).length,
    gamesWithTip: Object.values(night.games || {}).filter((g) => g && g.tip).length };
  const res = scoreNight({ night, lineups, gpBefore: {}, cap: 1e9, alias, espn, renames,
    resolve: (ref, at, alt) => alt === undefined ? keyOf(ref, ctx, at) : resolveEntry(ctx, ref, alt, at) });
  const c = res.clubs[out.clubId];
  out.scored = c ? { counted: c.counted.map((x) => x.n), reused: c.reused.map((x) => x.n), totals: c.totals } : null;

  /* 4. For the last lineup in force: each starter, found in the box score or not. */
  const last = mine.length ? mine[mine.length - 1] : null;
  if (last) {
    const have = new Map(Object.values(night.players || {}).map((p) => [nameKey(p.n), p]));
    out.starterCheck = last.starters.map((n) => {
      const hit = [...keysFor(n, alias, espn)].map((k) => have.get(k)).find(Boolean);
      return { name: n, inBoxScore: !!hit, boxName: hit ? hit.n : null };
    });
  }
  out.unmatchedBoxPlayers = res.unmatched.length;
  out.noTip = res.noTip.length;
  if (!mine.length) out.problem = "No lineup entry for this club resolves to it on that night — scoring has nothing to start anyone from.";
  else if (out.scored && !out.scored.counted.length) out.problem = "Lineups were found but no starter matched a box-score line that night.";
  return out;
}
