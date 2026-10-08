/* GET /api/players  ->  { at, teams, players: { <espnId>: { n, t, pos } } }

   Which NBA club every player is on today (lib/nba.mjs). The page reads it once
   a day to know whose game locks whom. Refreshed here whenever the stored copy
   is more than six hours old, and by nba-players-daily.mjs every morning, so
   the first GM to open the lineup screen after a trade gets the new club.
   Errors fall back to the stored copy; with nothing stored, `players` is empty
   and the page uses its own table. */

import { store } from "./lib/league.mjs";
import { freshPlayers } from "./lib/nba.mjs";

const H = { "content-type": "application/json", "cache-control": "no-store" };

export default async () => {
  try {
    const got = await freshPlayers(store(), 6 * 60 * 60 * 1000);
    return new Response(JSON.stringify(got), { headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ players: {}, reason: String((e && e.message) || e) }), { headers: H });
  }
};

export const config = { path: "/api/players" };
