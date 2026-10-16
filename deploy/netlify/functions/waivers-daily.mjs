/* The waiver run — a scheduled function, not an endpoint. 14:00 UTC (10am
   Eastern in summer, 9am in winter): after the morning's stats and scoring, so
   the Monday reset reads last week's final standings. Everything is in
   lib/waiverrun.mjs and lib/waivers.mjs. */

import { store } from "./lib/league.mjs";
import { runWaivers } from "./lib/waiverrun.mjs";

export default async () => {
  const out = await runWaivers(store());
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "0 14 * * *" };
