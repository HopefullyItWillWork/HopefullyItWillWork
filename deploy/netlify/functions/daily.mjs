/* The daily digest — a scheduled function, not an endpoint.

   Every morning it mails each club that has an address on file and the digest
   switched on, listing every transaction the league recorded the day before.

   It leads with how the club's starters did last night and where it stands
   (lib/digest.mjs, from the morning's scoring), then the day's transactions.
   Scoring runs at 09:45 UTC, well before this at 12:00, so last night is in.

   Schedule is UTC. 12:00 UTC is 8am Eastern in summer, 7am in winter. */

import { store, read, sendMail, mailConfigured, underCap } from "./lib/league.mjs";
import { wrap, siteUrl, yesterdayIn, movesOn, prettyDay, digestBody, ord } from "./lib/format.mjs";
import { digestStats } from "./lib/digest.mjs";

const ZONE = process.env.LEAGUE_TZ || "America/New_York";

export default async () => {
  const s = store();
  const day = yesterdayIn(ZONE);

  /* One digest per day, whatever else re-invokes this. */
  const mark = await read(s, "digest");
  if (mark.data && mark.data.day === day)
    return new Response(JSON.stringify({ ok: true, skipped: "already sent", day }));

  if (!mailConfigured())
    return new Response(JSON.stringify({ ok: false, reason: "not configured", day }));

  const teams = (await read(s, "rosters")).data || {};
  const log = (await read(s, "log")).data || [];
  const moves = movesOn(log, ZONE, day);

  const subs = Object.keys(teams).filter((t) => teams[t] && teams[t].email && teams[t].daily);
  if (!subs.length) {
    await s.set("digest", JSON.stringify({ rev: (mark.rev || 0) + 1, data: { day, sent: 0 } }));
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: "nobody subscribed" }));
  }
  if (!(await underCap(s, subs.length)))
    return new Response(JSON.stringify({ ok: false, reason: "daily send limit reached" }));

  const pretty = prettyDay(day);
  let sent = 0;
  const failed = [];
  const cache = {};
  for (const t of subs) {
    /* Stats never stop the mail: a scoring problem costs the section, not the digest. */
    let stats = null;
    try { stats = await digestStats(s, t, day, cache); } catch { stats = null; }
    const r = await sendMail({
      to: teams[t].email,
      subject: stats && stats.rank
        ? `${pretty} \u2014 ${stats.totals.PTS || 0} points, ${ord(stats.rank)} of ${stats.of}`
        : `${pretty} \u2014 ${moves.length} transaction${moves.length === 1 ? "" : "s"} in the league`,
      html: wrap(pretty, digestBody(t, teams[t], moves, ZONE, stats),
        "turn this off under Email on your My Team tab"),
      text:
        `${pretty}: ${moves.length} transactions.\n\n` +
        moves.map((e) => `${e.kind || "move"}: ${e.detail || ""}`).join("\n") +
        `\n\n${siteUrl()}`,
    });
    if (r.ok) sent++; else failed.push({ club: t, reason: r.reason });
  }

  await s.set("digest", JSON.stringify({
    rev: (mark.rev || 0) + 1,
    data: { day, sent, at: new Date().toISOString() },
  }));

  return new Response(JSON.stringify({ ok: true, day, moves: moves.length, sent, failed }));
};

export const config = { schedule: "0 12 * * *" };
