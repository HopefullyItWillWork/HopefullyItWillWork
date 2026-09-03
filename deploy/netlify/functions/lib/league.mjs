/* Shared helpers for the two mail functions.

   Lives under lib/ deliberately: Netlify treats every top-level file in the
   functions directory as its own function, and a subdirectory only becomes one
   if it contains a file named after it. lib/league.mjs is therefore bundled
   into whatever imports it and never gets an endpoint of its own. */

import { getStore } from "@netlify/blobs";

export const store = () => getStore({ name: "league-ledger", consistency: "strong" });

export async function read(s, key) {
  const raw = await s.get(key);
  return raw ? JSON.parse(raw) : { rev: 0, data: null };
}

export { esc, wrap, siteUrl, dayIn, timeIn, yesterdayIn, movesOn, prettyDay, digestBody }
  from "./format.mjs";

/* ---- sending ----------------------------------------------------------
   Resend, over plain fetch — no SDK, so package.json keeps its single
   dependency. Configuration is entirely environment variables, set in Netlify
   under Site configuration → Environment variables:

     RESEND_API_KEY   required. Nothing is sent without it.
     MAIL_FROM        required. e.g. "League Ledger <ledger@yourdomain.com>".
                      The domain has to be verified with Resend first.
     SITE_URL         optional. Used for links back into the app.

   With no key configured every send returns {ok:false, reason:"not configured"}
   and the caller carries on. That is the deliberate default: a fresh deploy
   never mails anyone until someone sets the key. */

export const mailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

export async function sendMail({ to, subject, html, text }) {
  if (!mailConfigured()) return { ok: false, reason: "not configured" };
  if (!to) return { ok: false, reason: "no address" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [to],
        subject,
        html,
        ...(text ? { text } : {}),
      }),
    });
    if (r.ok) return { ok: true };
    return { ok: false, reason: `resend ${r.status}`, detail: (await r.text()).slice(0, 300) };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
}

/* ---- a spend ceiling --------------------------------------------------
   /api/notify has no real authentication — the PINs it checks are readable by
   anyone who can reach /api/state, exactly as CLAUDE.md says. So the ceiling is
   not a security control, it is a cost control: a script that finds the endpoint
   can annoy nine people for one day, not run up a bill. Counts reset daily. */
const CAP = Number(process.env.MAIL_DAILY_CAP || 200);

export async function underCap(s, n = 1) {
  const today = new Date().toISOString().slice(0, 10);
  const cur = await read(s, "mailcount");
  const d = cur.data && cur.data.date === today ? cur.data : { date: today, count: 0 };
  if (d.count + n > CAP) return false;
  d.count += n;
  await s.set("mailcount", JSON.stringify({ rev: cur.rev + 1, data: d }));
  return true;
}
