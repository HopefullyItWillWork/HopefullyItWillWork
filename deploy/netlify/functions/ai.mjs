/* POST /api/ai — the league assistant.

     {club, pin, context, messages:[{role,content}]}  ->  {ok, reply, model}

   The same honour-system bar as /api/notify: a club name plus its PIN, or the
   commissioner login, both looked up in the rosters slice rather than trusted
   from the request. As CLAUDE.md says of the PINs, that stops accidents and
   casual mischief, not a league-mate who reads the source. The real protection
   is the daily ceiling below, which is a cost control.

   The league context is built by the APP and posted here, not assembled on the
   server. Every cap rule in this league — capRoom(), mleLeft(), bidCeiling(),
   contracted(), birdRight() — is already implemented in index.html against a
   migrated copy of the state, and a second implementation here would be a
   second set of answers to keep in step with the first. See aiContext(). The
   server's job is the key, the ceiling and the ceilings on size.

   Nothing here writes league state. The worst a caller can do with a borrowed
   PIN is spend somebody's daily quota and read back a paragraph of text about a
   league whose database is already world-readable. */

import { store, read } from "./lib/league.mjs";
import { askAI, aiConfigured, aiCap, aiModel } from "./lib/ai.mjs";

const H = { "content-type": "application/json", "cache-control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: H });

/* A ceiling on answers a day for the whole league, counted in its own blob key
   exactly as the mail counter is, and for the same reason: /api/ai has no real
   authentication, so this is a cost control rather than a security one. A
   script that finds the endpoint can spend a day's answers; it cannot spend
   more than that, and on a free tier it cannot spend money at all.

   AIDEF.cap in lib/ai.mjs says how the default figure is arrived at — it is
   sized to the model's daily TOKEN budget and has to be raised by hand when a
   bigger one is configured. Counts reset daily. */
async function underCap(s) {
  const today = new Date().toISOString().slice(0, 10);
  const cur = await read(s, "aicount");
  const d = cur.data && cur.data.date === today ? cur.data : { date: today, count: 0 };
  if (d.count + 1 > aiCap()) return false;
  d.count += 1;
  await s.set("aicount", JSON.stringify({ rev: cur.rev + 1, data: d }));
  return true;
}

export default async (req) => {
  /* The app asks this at boot to decide whether to draw the panel at all: a
     control that renders, binds its handler and then refuses is worse than one
     that is not there, which is the argument the shut auction room makes. It
     answers nothing about the league and needs no PIN. */
  if (req.method === "GET") return json({ ok: true, configured: aiConfigured(), model: aiConfigured() ? aiModel() : "" });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!aiConfigured()) return json({ ok: false, reason: "not configured" });

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const s = store();
  const teams = (await read(s, "rosters")).data || {};
  const cfg = (await read(s, "settings")).data || {};

  const club = String(body.club || "");
  const pin = String(body.pin || "");
  const asComm = club === "__comm__" && pin && pin === String(cfg.commPin || "");
  if (!asComm) {
    const c = teams[club];
    if (!c) return json({ ok: false, reason: "unknown club" }, 403);
    if (!c.pin || pin !== String(c.pin)) return json({ ok: false, reason: "bad pin" }, 403);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ ok: false, reason: "nothing to ask" }, 400);

  if (!(await underCap(s)))
    return json({ ok: false, reason: "the league has reached its daily limit of answers" });

  const r = await askAI({ context: body.context, messages });
  return json(r.ok ? { ok: true, reply: r.reply, model: r.model } : { ok: false, reason: r.reason });
};

export const config = { path: "/api/ai" };
