import { getStore } from "@netlify/blobs";

/* League storage, split by key so hot paths never collide.
     settings   league config, rarely written
     rosters    contracts, cuts, PINs
     auction    the live block — written constantly during a draft
     trades     open offers
     log        append-only transaction history

   GET  /api/state?key=auction          -> { rev, data }
   PUT  /api/state?key=auction&rev=N    -> { ok, rev }   409 if stale
   POST /api/state?key=log&append=1     -> { ok, rev }   appends, never clobbers
   GET  /api/state?key=all              -> every key in one round trip

   KEYS only gates ?key=all. Every other verb takes any cleaned key, which is how
   the strategy boards (strat-<club>), the league chat (chat) and the mail
   counters live here without being league state: they are read one at a time by
   the screens that want them, and never ride the payload the auction polls. */

const H = { "content-type": "application/json", "cache-control": "no-store" };
const KEYS = ["settings", "rosters", "auction", "trades", "log"];
const clean = (k) => String(k || "").replace(/[^a-zA-Z0-9._-]/g, "");

async function read(store, key) {
  const raw = await store.get(key);
  return raw ? JSON.parse(raw) : { rev: 0, data: null };
}

export default async (req) => {
  const store = getStore({ name: "league-ledger", consistency: "strong" });
  const url = new URL(req.url);
  const key = clean(url.searchParams.get("key") || "state");

  try {
    if (req.method === "GET") {
      if (key === "all") {
        const out = {};
        await Promise.all(KEYS.map(async (k) => { out[k] = await read(store, k); }));
        /* `&chat=<ts>&me=<club>`: how many chat posts by somebody else are newer
           than <ts>, for the Chat badge. The page asks about once a minute, so
           nobody downloads the room just to learn whether it has moved. */
        if (url.searchParams.has("chat")) {
          const since = url.searchParams.get("chat") || "", who = url.searchParams.get("me") || "";
          const c = await read(store, "chat");
          const list = Array.isArray(c.data) ? c.data : [];
          out.chat = { rev: c.rev, ts: (list[0] && list[0].ts) || "",
            n: since ? list.filter((m) => m && m.ts > since && m.by !== who).length : 0 };
        }
        return new Response(JSON.stringify(out), { headers: H });
      }
      return new Response(JSON.stringify(await read(store, key)), { headers: H });
    }

    if (req.method === "POST" && url.searchParams.get("append")) {
      /* Append-only: entries are added to the front, so two GMs writing at the
         same instant both survive and no revision check is needed. */
      const body = await req.json();
      const prev = await read(store, key);
      const list = Array.isArray(prev.data) ? prev.data : [];
      const add = Array.isArray(body.data) ? body.data : [body.data];
      const next = { rev: prev.rev + 1, data: [...add, ...list].slice(0, 5000) };
      await store.set(key, JSON.stringify(next));
      return new Response(JSON.stringify({ ok: true, rev: next.rev, count: next.data.length }), { headers: H });
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = await req.json();
      const expected = Number(url.searchParams.get("rev"));
      const prev = await read(store, key);
      if (Number.isFinite(expected) && expected !== prev.rev) {
        return new Response(
          JSON.stringify({ ok: false, conflict: true, rev: prev.rev, data: prev.data }),
          { status: 409, headers: H }
        );
      }
      const next = { rev: prev.rev + 1, data: body.data, at: new Date().toISOString() };
      await store.set(key, JSON.stringify(next));
      return new Response(JSON.stringify({ ok: true, rev: next.rev }), { headers: H });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: H });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), { status: 500, headers: H });
  }
};

export const config = { path: "/api/state" };
