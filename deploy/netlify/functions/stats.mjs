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

   GET  /api/stats?fixes=1          -> the commissioner's corrections (lib/statfix.mjs)
   POST /api/stats?fix=1            -> { from, pin, day, action:'set'|'remove', n, t?, s?, del? }
                                       lay a correction over one player's night (or
                                       take it off), then rescore that night. Only
                                       the commissioner login or a deputy, by PIN.

   No auth on the reads, like the rest of /api: everything here is public NBA data. */

import { store, read, isCommissioner } from "./lib/league.mjs";
import { runFeed, fetchNight } from "./lib/feed.mjs";
import { dayKey } from "./lib/stats.mjs";
import { cleanFix } from "./lib/statfix.mjs";
import { nameKey } from "./lib/nba.mjs";
import { rescoreNight } from "./lib/scorerun.mjs";

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
    if (req.method === "POST" && url.searchParams.get("fix")) return await postFix(s, req);
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    if (url.searchParams.get("fixes")) return json(await read(s, "statfix"));

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

async function postFix(s, req) {
  let b;
  try { b = await req.json(); } catch { return json({ ok: false, reason: "bad json" }, 400); }
  if (!(await isCommissioner(s, String(b.from || ""), String(b.pin || ""))))
    return json({ ok: false, reason: "commissioner only" }, 403);
  const day = String(b.day || "");
  if (!isDay(day)) return json({ ok: false, reason: "day=YYYY-MM-DD required" }, 400);
  const prev = await read(s, "statfix");
  const data = prev.data || { days: {} };
  data.days = data.days || {};
  const list = (data.days[day] || []).slice();
  const key = nameKey(b.n);
  const rest = list.filter((f) => nameKey(f.n) !== key);
  if (b.action === "remove") {
    if (rest.length) data.days[day] = rest; else delete data.days[day];
  } else {
    const c = cleanFix(b);
    if (c.error) return json({ ok: false, reason: c.error }, 400);
    data.days[day] = [...rest, { ...c.fix, by: String(b.from).slice(0, 60), at: new Date().toISOString() }];
  }
  await s.set("statfix", JSON.stringify({ rev: (prev.rev || 0) + 1, data, at: new Date().toISOString() }));
  /* Rescore the night and rebuild the rolling windows so the fix shows at once. */
  const out = { ok: true, fixes: data.days[day] || [] };
  try { Object.assign(out, await rescoreNight(s, day)); }
  catch (e) { out.rescore = "failed: " + String((e && e.message) || e); }
  return json(out);
}
