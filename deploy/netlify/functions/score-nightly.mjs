/* Scoring — a scheduled function, not an endpoint.

   Runs at :45 past each hour the stats job runs (UTC 09:45–13:45), so every
   run scores whatever the stats run half an hour earlier stored, including
   the corrections it picked up. Rescoring the window is cheap and changes
   nothing when nothing changed. Everything is in lib/scorerun.mjs. */

import { runScore, runPre, runPstats, seasonOf } from "./lib/scorerun.mjs";
import { recordDrift } from "./lib/live.mjs";
import { store, read } from "./lib/league.mjs";

export default async () => {
  const s = store();
  const out = await runScore(s);
  /* The preseason tournament, when there is one; a failure there never touches
     the season's scoring above. */
  try { out.pre = await runPre(s); } catch (e) { out.pre = { error: String((e && e.message) || e) }; }
  /* Rolling 7/15/30-day and season stats for the Players tab (lib/pstats.mjs). */
  /* How far last night's live numbers were from the morning's (lib/live.mjs). */
  try { const sn = seasonOf((await read(s, "settings")).data || {}); out.drift = await recordDrift(s, sn && sn.key); }
  catch (e) { out.drift = { error: String((e && e.message) || e) }; }
  try { out.pstats = await runPstats(s); } catch (e) { out.pstats = { error: String((e && e.message) || e) }; }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "45 9-13 * * *" };
