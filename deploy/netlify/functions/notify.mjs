/* POST /api/notify — the league's outgoing mail.

   Three kinds today:
     {kind:"trade",  from, pin, to, summary}   tells a GM an offer is waiting
     {kind:"test",   from, pin}                sends one message to yourself
     {kind:"all",    from, pin, subject, body} the commissioner writes the league

   The endpoint never accepts an address. It looks the recipient up in the
   rosters slice by club name, so the worst a caller can do is mail a league
   member — it cannot be turned into an open relay. The PIN check is the same
   honour-system bar as the rest of the app (CLAUDE.md: the PINs are readable by
   anyone who can reach /api/state); it stops accidents and casual mischief, not
   a league-mate who reads the source. The real protection against cost is the
   daily ceiling in lib/league.mjs. */

import { store, read, sendMail, mailConfigured, underCap } from "./lib/league.mjs";
import { esc, wrap, siteUrl } from "./lib/format.mjs";

const H = { "content-type": "application/json", "cache-control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: H });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!mailConfigured()) return json({ ok: false, reason: "not configured" });

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const s = store();
  const teams = (await read(s, "rosters")).data || {};
  const cfg = (await read(s, "settings")).data || {};

  const from = String(body.from || "");
  const pin = String(body.pin || "");
  const sender = teams[from];

  /* Commissioner sends as himself; a GM has to match his club's PIN. A club with
     no PIN set yet is unclaimed, so it cannot send. */
  const asComm = from === "__comm__" && pin && pin === String(cfg.commPin || "");
  if (!asComm) {
    if (!sender) return json({ ok: false, reason: "unknown club" }, 403);
    if (!sender.pin || pin !== String(sender.pin)) return json({ ok: false, reason: "bad pin" }, 403);
  }

  const kind = String(body.kind || "");

  if (kind === "test") {
    const to = asComm ? String(body.to || "") : from;
    const addr = (teams[to] || {}).email;
    if (!addr) return json({ ok: false, reason: "no address on file" });
    if (!(await underCap(s))) return json({ ok: false, reason: "daily send limit reached" });
    const r = await sendMail({
      to: addr,
      subject: "League Ledger — test message",
      html: wrap("It works", `<p style="margin:0">Mail from the league ledger is reaching ${esc(to)}.</p>
        <p style="margin:14px 0 0">If you turned the daily digest on, the next one arrives tomorrow morning.</p>`),
      text: `Mail from the league ledger is reaching ${to}.`,
    });
    return json(r.ok ? { ok: true } : { ok: false, reason: r.reason });
  }

  if (kind === "trade") {
    const to = String(body.to || "");
    const target = teams[to];
    if (!target) return json({ ok: false, reason: "unknown club" }, 400);
    if (!target.email) return json({ ok: false, reason: "no address on file" });
    if (!(await underCap(s))) return json({ ok: false, reason: "daily send limit reached" });

    /* The offer itself is not trusted into the markup — it is league-supplied
       text that lands in someone's inbox. */
    const gives = Array.isArray(body.gives) ? body.gives : [];
    const gets = Array.isArray(body.gets) ? body.gets : [];
    const list = (label, arr) =>
      `<p style="margin:14px 0 4px;font:700 11px/1 ui-monospace,monospace;letter-spacing:.14em;
        text-transform:uppercase;color:#7d8590">${esc(label)}</p>` +
      (arr.length
        ? `<ul style="margin:0;padding-left:18px">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
        : `<p style="margin:0;color:#7d8590">nothing</p>`);

    const r = await sendMail({
      to: target.email,
      subject: `${from} has offered you a trade`,
      html: wrap(
        `${esc(from)} wants to trade`,
        `<p style="margin:0">An offer is waiting for you on the Trades tab.</p>
         ${list(`${to} sends`, gives)}
         ${list(`${to} receives`, gets)}
         ${body.note ? `<p style="margin:16px 0 0;padding:11px 13px;background:#14161a;border-left:2px solid #c8922e">${esc(body.note)}</p>` : ""}
         <p style="margin:18px 0 0"><a href="${siteUrl()}"
           style="color:#c8922e;font-weight:700">Review the offer</a></p>`,
        "you are getting this because your club has an address on file"
      ),
      text: `${from} has offered ${to} a trade. Review it at ${siteUrl()}`,
    });
    return json(r.ok ? { ok: true } : { ok: false, reason: r.reason });
  }

  /* The commissioner's league-wide note. It is the ONE kind that writes free
     text to more than one person, so three things guard it: only the
     commissioner login may send it (a deputy's club PIN is not enough — this
     leaves the app and cannot be taken back), every address still comes from
     the rosters slice rather than the request, and the whole run is counted
     against the daily ceiling BEFORE anything is sent, so a broadcast that
     would breach it sends nothing rather than half a league.

     The body is plain text, escaped, with its line breaks kept. It is not
     markup and must never be treated as any. */
  if (kind === "all") {
    if (!asComm) return json({ ok: false, reason: "commissioner only" }, 403);
    const subject = String(body.subject || "").trim().slice(0, 160);
    const text = String(body.body || "").trim().slice(0, 4000);
    if (!subject || !text) return json({ ok: false, reason: "subject and body are both required" }, 400);

    const to = Object.keys(teams)
      .map((t) => ({ club: t, addr: (teams[t] || {}).email }))
      .filter((x) => x.addr);
    if (!to.length) return json({ ok: false, reason: "no addresses on file" });
    if (!(await underCap(s, to.length)))
      return json({ ok: false, reason: `daily send limit reached — ${to.length} would go out` });

    const para = text
      .split(/\n{2,}/)
      .map((b) => `<p style="margin:0 0 12px">${esc(b).replace(/\n/g, "<br>")}</p>`)
      .join("");

    const sent = [], failed = [];
    for (const x of to) {
      const r = await sendMail({
        to: x.addr,
        subject,
        html: wrap(subject, `${para}<p style="margin:18px 0 0"><a href="${siteUrl()}"
          style="color:#c8922e;font-weight:700">Open the league ledger</a></p>`,
          "you are getting this because your club has an address on file"),
        text,
      });
      (r.ok ? sent : failed).push(x.club);
    }
    return json({ ok: sent.length > 0, sent: sent.length, clubs: sent, failed });
  }

  return json({ ok: false, reason: "unknown kind" }, 400);
};

export const config = { path: "/api/notify" };
