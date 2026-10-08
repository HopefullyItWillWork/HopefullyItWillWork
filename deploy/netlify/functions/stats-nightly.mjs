/* The nightly stats feed — a scheduled function, not an endpoint.

   Runs hourly through the early morning (UTC 09:15–13:15, so 5:15–9:15am
   Eastern in summer, 4:15–8:15 in winter). The first run normally does all of
   it; the later ones re-check anything that was not final yet or did not fit in
   the first run's time budget, and cost almost nothing when there is nothing
   left. Everything it does is in lib/feed.mjs, shared with /api/stats. */

import { store } from "./lib/league.mjs";
import { runFeed } from "./lib/feed.mjs";

export default async () => {
  const out = await runFeed(store());
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "15 9-13 * * *" };
