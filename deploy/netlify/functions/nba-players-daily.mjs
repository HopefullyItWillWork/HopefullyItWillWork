/* Refresh who plays for which NBA club, every day at 15:00 UTC (11am Eastern
   in summer, 10am in winter): after the overnight transactions, before any
   game. Everything is in lib/nba.mjs; /api/players also refreshes on demand. */

import { store } from "./lib/league.mjs";
import { freshPlayers } from "./lib/nba.mjs";

export default async () => {
  const got = await freshPlayers(store(), 0);
  return new Response(JSON.stringify({ at: got.at, teams: got.teams,
    players: Object.keys(got.players || {}).length, error: got.error || null }),
    { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "0 15 * * *" };
