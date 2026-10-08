/* Lineup history — see lib/lineups.mjs for why it exists.

   POST /api/lineups              body { club, s:{C,G1..U6}, by }
                                  -> records the lineup, stamped with the
                                     server's time. Called by the page after
                                     every lineup save.
   GET  /api/lineups?day=YYYY-MM-DD
                                  -> every entry that day, grouped by club.

   No auth, like the rest of /api: the honour-system PINs live in the page. The
   clock is the part that matters, and the client never supplies it. */

import { store, read } from "./lib/league.mjs";
import { recordLineup, lineupsOn } from "./lib/lineups.mjs";

const H = { "content-type": "application/json", "cache-control": "no-store" };
const TZ = () => process.env.LEAGUE_TZ || "America/New_York";
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: H });

export default async (req) => {
  const s = store();
  const url = new URL(req.url);
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      const club = body && typeof body.club === "string" ? body.club : "";
      if (!club || !body.s || typeof body.s !== "object") return json({ ok: false, error: "club and s required" }, 400);
      /* Only a club that exists. A typo or a stale tab after a rename must not
         start a history under a name scoring will never look up. */
      const teams = (await read(s, "rosters")).data || {};
      if (!teams[club]) return json({ ok: false, error: `no club named ${club}` }, 404);
      const entry = await recordLineup(s, TZ(), { club, s: body.s, by: String(body.by || "").slice(0, 60) });
      return json({ ok: true, at: entry.at, day: entry.day });
    }
    if (req.method === "GET") {
      const day = url.searchParams.get("day") || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ ok: false, error: "day=YYYY-MM-DD required" }, 400);
      return json({ ok: true, day, clubs: await lineupsOn(s, day) });
    }
    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/lineups" };
