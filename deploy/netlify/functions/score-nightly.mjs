/* Scoring — a scheduled function, not an endpoint.

   Runs at :45 past each hour the stats job runs (UTC 09:45–13:45), so every
   run scores whatever the stats run half an hour earlier stored, including
   the corrections it picked up. Rescoring the window is cheap and changes
   nothing when nothing changed. Everything is in lib/scorerun.mjs. */

import { store } from "./lib/league.mjs";
import { runScore, runPre } from "./lib/scorerun.mjs";

export default async () => {
  const s = store();
  const out = await runScore(s);
  /* The preseason tournament, when there is one; a failure there never touches
     the season's scoring above. */
  try { out.pre = await runPre(s); } catch (e) { out.pre = { error: String((e && e.message) || e) }; }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "45 9-13 * * *" };
