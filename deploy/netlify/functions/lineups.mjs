/* Lineup history — see lib/lineups.mjs for why it exists.

   POST /api/lineups              body { club, s:{C,G1..U6}, by }
                                  -> records the lineup, stamped with the
                                     server's time. Called by the page after
                                     every lineup save.
   GET  /api/lineups?day=YYYY-MM-DD
                                  -> every entry that day, grouped by club.

   POST /api/lineups?override=1   body { from, pin, club, day, s, by }
                                  -> the commissioner (or a deputy, by PIN) sets a club's
                                     lineup for a whole NIGHT after the fact. It beats every
                                     ordinary save that day (lineupAt), and the night is
                                     rescored and the rolling stats rebuilt before the
                                     call returns, so this one call is "set it and refresh".

   No auth on the ordinary save, like the rest of /api: the honour-system PINs live in the page. The
   clock is the part that matters, and the client never supplies it. */

import { store, isCommissioner } from "./lib/league.mjs";
import { runScore, runPstats } from "./lib/scorerun.mjs";
import { ensureIds } from "./lib/clubids.mjs";
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
      if (url.searchParams.get("override")) {
        if (!(await isCommissioner(s, String(body.from || ""), String(body.pin || ""))))
          return json({ ok: false, error: "commissioner only" }, 403);
        const day = String(body.day || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ ok: false, error: "day=YYYY-MM-DD required" }, 400);
        const teams = await ensureIds(s);
        if (!teams[club]) return json({ ok: false, error: `no club named ${club}` }, 404);
        await recordLineup(s, TZ(), { club, cid: teams[club].id, s: body.s, day,
          by: String(body.by || body.from || "").slice(0, 60), src: "override" });
        const out = { ok: true, day };
        try { out.score = await runScore(s, { only: day }); out.pstats = await runPstats(s, { days: [day] }); }
        catch (e) { out.rescore = "failed: " + String((e && e.message) || e); }
        return json(out);
      }
      /* Only a club that exists. A typo or a stale tab after a rename must not
         start a history under a name scoring will never look up. */
      const teams = await ensureIds(s);
      if (!teams[club]) return json({ ok: false, error: `no club named ${club}` }, 404);
      const entry = await recordLineup(s, TZ(), { club, cid: teams[club].id, s: body.s, by: String(body.by || "").slice(0, 60) });
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
