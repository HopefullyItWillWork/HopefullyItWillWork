/* The digests — a scheduled function, not an endpoint.

   Every morning it mails the DAILY to each club with an address and `daily` on:
   where it stands and who it is chasing, what its starters did last night and
   what it left on the bench, whether tonight's lineup is ready, and the league's
   roster moves (lib/digest.mjs, laid out by lib/format.mjs).

   On Mondays it also mails the WEEKLY, for the Monday–Sunday just finished, to
   each club with `weekly` on: the race, the categories a few rebounds from a
   point either way, which managers have surplus where the club is close, its
   games pace against the cap, and how many minimum pickups it can still afford —
   led by one or two parody tweets about the week's biggest move (lib/tweets.mjs,
   written by Claude once per week and cached; skipped quietly without a key).

   Scoring has run by 09:45 UTC, so last night is in by 12:00. A stats problem
   costs the section, never the mail. `digest` and `digestw` stop a re-invocation
   sending twice. Schedule is UTC: 12:00 is 8am Eastern in summer, 7am in winter. */

import { store, read, sendMail, mailConfigured, underCap } from "./lib/league.mjs";
import { wrap, siteUrl, yesterdayIn, movesOn, movesBetween, prettyDay, dailyBody, weeklyBody,
  isMonday, dayPlus, dayIn, ord } from "./lib/format.mjs";
import { digestDaily, digestWeekly } from "./lib/digest.mjs";
import { weeklyTweets } from "./lib/tweets.mjs";

const ZONE = process.env.LEAGUE_TZ || "America/New_York";
const FOOT = "change this under Email on your My Team tab";

async function sendDaily(s, teams, log, day) {
  const mark = await read(s, "digest");
  if (mark.data && mark.data.day === day) return { skipped: "already sent", day };
  const subs = Object.keys(teams).filter((t) => teams[t] && teams[t].email && teams[t].daily);
  const done = async (sent, extra) => { await s.set("digest", JSON.stringify({ rev: (mark.rev || 0) + 1,
    data: { day, sent, at: new Date().toISOString() } })); return { day, sent, ...extra }; };
  if (!subs.length) return done(0, { reason: "nobody subscribed" });
  if (!(await underCap(s, subs.length))) return { day, reason: "daily send limit reached" };
  const moves = movesOn(log, ZONE, day), pretty = prettyDay(day), cache = {};
  let sent = 0; const failed = [];
  for (const t of subs) {
    let d = null;
    try { d = await digestDaily(s, t, day, cache); } catch { d = null; }
    d = d || { club: t, day };
    const r = await sendMail({
      to: teams[t].email,
      subject: d.standing
        ? `${pretty} — ${ord(d.standing.rank)} of ${d.standing.of}`
          + (d.last ? `, ${(d.last.totals && d.last.totals.PTS) || 0} points last night` : "")
        : `${pretty} — ${moves.length} move${moves.length === 1 ? "" : "s"} in the league`,
      html: wrap(pretty, dailyBody(d, moves, ZONE), FOOT),
      text: `${pretty}\n\n${moves.map((e) => `${e.kind}: ${e.detail || ""}`).join("\n")}\n\n${siteUrl()}`,
    });
    if (r.ok) sent++; else failed.push({ club: t, reason: r.reason });
  }
  return done(sent, { failed });
}

async function sendWeekly(s, teams, log, from, to) {
  const mark = await read(s, "digestw");
  if (mark.data && mark.data.to === to) return { skipped: "already sent", from, to };
  const subs = Object.keys(teams).filter((t) => teams[t] && teams[t].email && teams[t].weekly);
  const done = async (sent, extra) => { await s.set("digestw", JSON.stringify({ rev: (mark.rev || 0) + 1,
    data: { from, to, sent, at: new Date().toISOString() } })); return { from, to, sent, ...extra }; };
  if (!subs.length) return done(0, { reason: "nobody subscribed" });
  if (!(await underCap(s, subs.length))) return { from, to, reason: "daily send limit reached" };
  const moves = movesBetween(log, ZONE, from, to), cache = {};
  const title = `Week of ${prettyDay(from)}`;
  let sent = 0; const failed = [];
  let tweets;                                     // written once, shared by every club's weekly
  for (const t of subs) {
    let w = null;
    try { w = await digestWeekly(s, t, from, to, cache); } catch { w = null; }
    if (!w) continue;
    if (tweets === undefined) { try { tweets = await weeklyTweets(s, from, moves, w.table); } catch { tweets = null; } }
    w.tweets = tweets;
    const r = await sendMail({
      to: teams[t].email,
      subject: w.standing ? `Your week — ${ord(w.standing.rank)} of ${w.standing.of}`
        + (w.gains.length ? `, ${w.gains.length} categor${w.gains.length === 1 ? "y" : "ies"} within reach` : "")
        : `${title} in the league`,
      html: wrap(title, weeklyBody(w, moves, ZONE), FOOT),
      text: `${title}\n\n${siteUrl()}`,
    });
    if (r.ok) sent++; else failed.push({ club: t, reason: r.reason });
  }
  return done(sent, { failed });
}

export default async () => {
  if (!mailConfigured()) return new Response(JSON.stringify({ ok: false, reason: "not configured" }));
  const s = store();
  const teams = (await read(s, "rosters")).data || {};
  const log = (await read(s, "log")).data || [];
  const day = yesterdayIn(ZONE), today = dayIn(ZONE, new Date());
  const out = { ok: true, daily: await sendDaily(s, teams, log, day) };
  if (isMonday(today)) out.weekly = await sendWeekly(s, teams, log, dayPlus(today, -7), day);
  return new Response(JSON.stringify(out));
};

export const config = { schedule: "0 12 * * *" };
