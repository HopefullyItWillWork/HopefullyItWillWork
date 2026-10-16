/* GET  /api/waivers         -> { today, week, order, all, on:[{n,p,from,till}], runs:[…] }
   POST /api/waivers?run=1   -> process the wire now (throttled to once per two
                                minutes) — the commissioner's button.
   The rules are lib/waivers.mjs; the I/O is lib/waiverrun.mjs. */

import { store, read } from "./lib/league.mjs";
import { waiverState, runWaivers } from "./lib/waiverrun.mjs";

const H = { "content-type": "application/json", "cache-control": "no-store" };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: H });

export default async (req) => {
  const s = store();
  const url = new URL(req.url);
  try {
    if (req.method === "POST" && url.searchParams.get("run")) {
      const w = (await read(s, "waivers")).data || {};
      const last = w.runs && w.runs.length ? Date.parse(w.runs[w.runs.length - 1].at) : 0;
      if (last && Date.now() - last < 2 * 60 * 1000) return json({ ok: false, reason: "ran less than two minutes ago" }, 429);
      return json(await runWaivers(s, { by: "Commissioner" }));
    }
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    return json(await waiverState(s));
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/waivers" };
