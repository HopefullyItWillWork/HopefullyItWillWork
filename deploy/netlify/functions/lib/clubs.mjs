/* A club's permanent key.

   A club's NAME is a label and changes; `rosters[name].id` never does. Lineup
   history, scores and game counts are filed under the id, and the name is looked
   up from it when something is displayed, so a rename cannot split a club's
   stats. The id is stamped by the server (stampIds), is never drawn by the page
   and never typed by anyone. It is not secret — /api/state has no auth, like the
   PINs beside it — it is simply not part of any screen.

   Pure: imports only score.mjs's currentName. Storage is in lib/clubids.mjs. */

import { currentName } from "./score.mjs";

export const newId = () =>
  "c_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* Keep every club's id across a write; give a club without one its old id (same
   name) or a fresh one. `prev` and `next` are the rosters objects. */
export function stampIds(prev, next) {
  if (!next || typeof next !== "object") return next;
  const used = new Set();
  for (const t of Object.values(next)) if (t && t.id) used.add(t.id);
  for (const [name, t] of Object.entries(next)) {
    if (!t || typeof t !== "object" || t.id) continue;
    const old = prev && prev[name] && prev[name].id;
    t.id = old && !used.has(old) ? old : newId();
    used.add(t.id);
  }
  return next;
}

/* Lookup tables from the live rosters. */
export function clubCtx(teams, renames) {
  const byName = {}, nameOf = {};
  for (const [n, t] of Object.entries(teams || {})) if (t && t.id) { byName[n] = t.id; nameOf[t.id] = n; }
  return { teams: teams || {}, renames: Array.isArray(renames) ? renames : [], live: Object.keys(teams || {}), byName, nameOf };
}

/* Anything a stored record calls a club — an id, or a name as it was then —
   to the club's id. `at` (ISO) dates a legacy name against the rename journal.
   A name that belongs to no club today (removed) comes back as itself. */
export function keyOf(ref, ctx, at) {
  if (ref == null || ref === "") return null;
  if (ctx.nameOf[ref]) return ref;
  const now = currentName(ref, ctx.renames, ctx.live, at);
  if (!now) return null;
  return ctx.byName[now] || now;
}

/* The name to show for a key: the club's current name. */
export const nameFor = (key, ctx) => ctx.nameOf[key] || key;

/* { date: { key: totals } } with every key turned into the club's current name,
   merging anything that resolves to the same club. What the page and the
   standings read. */
export function daysByName(days, ctx) {
  const out = {};
  for (const [day, night] of Object.entries(days || {})) {
    const at = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day + "T23:59:59.999Z" : undefined;
    const row = {};
    for (const [ref, t] of Object.entries(night || {})) {
      const k = keyOf(ref, ctx, at);
      if (k == null) continue;
      const nm = nameFor(k, ctx);
      row[nm] = row[nm] ? sumTotals(row[nm], t) : t;
    }
    out[day] = row;
  }
  return out;
}

/* The same for a flat { key: anything } map (one night's `clubs`). */
export function byClubName(map, ctx, at) {
  const out = {};
  for (const [ref, v] of Object.entries(map || {})) {
    const k = keyOf(ref, ctx, at);
    if (k != null) out[nameFor(k, ctx)] = v;
  }
  return out;
}

function sumTotals(a, b) {
  const o = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (typeof v === "number") o[k] = (o[k] || 0) + v;
  return o;
}
