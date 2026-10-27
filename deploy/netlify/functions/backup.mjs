/* A full backup of the league database — every blob in the store, as stored.

   GET  /api/backup               -> { ok, keys: [...] }  every key, sorted
   POST /api/backup  { keys }     -> { ok, blobs: { key: value } }  up to 60 at a time

   The page's "Export league as JSON" (Commissioner tab) lists the keys and then
   fetches them in batches, because a full season of nightly box scores, lineup
   history and score files is several megabytes and a function response is capped
   at 6MB. Values come back parsed when they are JSON and as text otherwise; the
   encrypted club boxes stay ciphertext.

   Read-only, and no more open than /api/state already is: nothing here writes. */

import { store } from "./lib/league.mjs";
import { getListed } from "./lib/lineups.mjs";

const H = { "content-type": "application/json", "cache-control": "no-store" };
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: H });
const MAXKEYS = 60;

export default async (req) => {
  const s = store();
  try {
    if (req.method === "GET") {
      const { blobs } = await s.list();
      return json({ ok: true, keys: blobs.map((b) => b.key).sort() });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      const keys = Array.isArray(body && body.keys) ? body.keys.filter((k) => typeof k === "string").slice(0, MAXKEYS) : [];
      if (!keys.length) return json({ ok: false, error: "keys required" }, 400);
      const out = {};
      await Promise.all(keys.map(async (k) => {
        /* getListed: keys from list() can hold a literal "?" (lib/lineups.mjs). */
        const v = await getListed(s, k).catch(() => null);
        if (v == null) { out[k] = null; return; }
        try { out[k] = JSON.parse(v); } catch { out[k] = v; }
      }));
      return json({ ok: true, blobs: out });
    }
    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
};

export const config = { path: "/api/backup" };
