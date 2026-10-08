/* The nightly stats feed — a scheduled function, not an endpoint.

   Runs hourly through the early morning (UTC 09:15–13:15, so 5:15–9:15am
   Eastern in summer, 4:15–8:15 in winter). The first run carries every club's
   lineup into the day (lib/lineups.mjs) and normally does all the stats; the
   later ones re-check anything that was not final yet or did not fit in the
   first run's time budget, and cost almost nothing when there is nothing left.
   The stats half is lib/feed.mjs, shared with /api/stats. */

import { store, read } from "./lib/league.mjs";
import { runFeed, TZ } from "./lib/feed.mjs";
import { carryLineups } from "./lib/lineups.mjs";

export default async () => {
  const s = store();
  /* Carry every club's lineup into today before anything else, so a lineup
     nobody touched still has an entry for tonight's games. Once a club has
     an entry today this does nothing for it, so the later runs are free. */
  let carried = [];
  try { carried = await carryLineups(s, TZ(), (await read(s, "rosters")).data); }
  catch (e) { carried = ["error: " + String((e && e.message) || e)]; }
  const out = { ...(await runFeed(s)), carried };
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "15 9-13 * * *" };
