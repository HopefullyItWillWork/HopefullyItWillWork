/* Scoring — a scheduled function, not an endpoint.

   Runs at :45 past each hour the stats job runs (UTC 09:45–13:45), so every
   run scores whatever the stats run half an hour earlier stored, including
   the corrections it picked up. Rescoring the window is cheap and changes
   nothing when nothing changed. Everything is in lib/scorerun.mjs. */

import { store } from "./lib/league.mjs";
import { runScore } from "./lib/scorerun.mjs";

export default async () => {
  const out = await runScore(store());
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "45 9-13 * * *" };
