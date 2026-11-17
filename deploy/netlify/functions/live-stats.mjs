/* Live stats — a scheduled function, not an endpoint. Every five minutes from
   11 AM to 4 AM Eastern (UTC 16:00–08:59, so it covers EST and EDT). Almost every
   run outside games stops at the gate in lib/live.mjs without asking ESPN
   anything: before the first tip, on a night with no games, or once every game
   is final. GET /api/score?live=1 serves what it writes. */

import { store } from "./lib/league.mjs";
import { runLive } from "./lib/live.mjs";

export default async () => {
  let out;
  try { out = await runLive(store()); } catch (e) { out = { ok: false, error: String((e && e.message) || e) }; }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "*/5 16-23,0-8 * * *" };
